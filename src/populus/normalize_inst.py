"""13F normalization + coverage inputs (ARCHITECTURE.md §10.2 — RUN M2-2).

Pure functions from parsed raw fields to normalized column values. No DB import
(G14, structural): the as-of CUSIP resolver is *injected* as a callable, so a
resolution can never happen without an as-of date. The raw text always survives
in ``raw_row``; normalization never mutates it.

Two era-dependent value regimes (R4/LD-5): a 13F filed **on or after
2023-01-03** reports whole-dollar ``value``; a filing before it reports
thousands. The discriminator is the **filed date**, not the report period, and
``unit_basis`` travels with every value (G5). This module owns the multiplier,
the disjoint flag taxonomy (parallel to ``normalize.py``'s M1 sets — a shared
taxonomy would put a 13F flag in an M1 path), and the per-filing reconciliation
that produces the never-inflated coverage inputs the M2 ≥95% gate consumes at
M2-3 publish time (R16).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date

from populus.identity.registry import normalize_cusip
from populus.parse.inst13f import InfoTableRow

NORMALIZATION_VERSION = "inst-norm-1.0.0"

#: 13F value-unit cutover: filings filed on/after this date report whole dollars,
#: earlier filings report thousands (the form-version era boundary; LD-5).
UNIT_CUTOVER = date(2023, 1, 3)
UNIT_MULTIPLIER = {"thousands": 1000, "whole": 1}

#: Missing issuer name: ``issuer_name_raw`` is NOT NULL in the schema, so an
#: absent cell becomes this deterministic sentinel + ``row_incomplete`` (mirrors
#: normalize.py's UNPARSED_ASSET_SENTINEL); ``raw_row.nameOfIssuer`` stays null.
UNPARSED_ISSUER_SENTINEL = "(unparsed issuer)"

#: The §5.2 / M2-CONTRACT §5 structural caveat, shipped as a non-removable module
#: constant so every consumer of a holdings number carries it (G10).
INST_DATA_NOTE = (
    "13F holdings are a quarter-end snapshot of the long 13(f) securities a"
    " manager exercised investment discretion over; short positions, cash, and"
    " non-13(f) instruments are not reported, and the snapshot is not a full"
    " portfolio (ARCHITECTURE.md §5.2 / M2-CONTRACT §5)."
)

# A parse defect means extraction/normalization could not fully interpret a
# field; a source fact is a faithfully parsed/derived property of the filing.
# Both sets are disjoint and every emitted flag is a member of exactly one.
INST_PARSE_DEFECT_FLAGS = frozenset(
    {
        "value_unparsed",
        "cusip_unparsed",
        "ssh_unparsed",
        "voting_unparsed",
        "put_call_unparsed",
        "other_manager_unparsed",   # non-numeric otherManager component (QA-F3)
        "row_incomplete",
    }
)
INST_SOURCE_FACT_FLAGS = frozenset(
    {
        "missing_security",          # valid CUSIP, no mapping covers period_of_report (R9)
        "confidential_omitted",      # isConfidentialOmitted = true on the cover (R6)
        "conf_denied_expired",       # confDeniedExpired = true on an amendment (R6)
        "cover_failed",              # cover unparseable/missing field; persisted failed (R18)
        "notice_no_table",           # 13F-NT: a notice with no information table (F3)
        "entry_total_mismatch",      # tableEntryTotal != row_count (LD-7, forces partial)
        "amendment_unlinked",        # amendment with zero/many candidate bases (R5/F25)
        "amendment_type_unknown",    # is_amendment but amendmentType absent/unrecognized
        "affiliated_covered",        # covered by a surviving affiliate; excluded (R7)
        "affiliated_mutual_coverage",  # mutual affiliated coverage; both excluded (R7)
        "submissions_meta_missing",  # no submissions-meta.json sidecar (R19)
        "retrieved_at_unknown",      # no fetch-meta.json sidecar (retrieved_at NULL)
    }
)
INST_KNOWN_FLAGS = INST_PARSE_DEFECT_FLAGS | INST_SOURCE_FACT_FLAGS


def inst_has_parse_defect(flags: Iterable[str]) -> bool:
    """Whether *flags* contains any member of :data:`INST_PARSE_DEFECT_FLAGS`."""
    return bool(INST_PARSE_DEFECT_FLAGS.intersection(flags))


def unit_basis_for(filed_date: str) -> str:
    """``'whole'`` for a filing filed on/after 2023-01-03, else ``'thousands'``."""
    return "whole" if date.fromisoformat(filed_date) >= UNIT_CUTOVER else "thousands"


# --- helpers -----------------------------------------------------------------


def _to_int(raw: str | None) -> tuple[int | None, bool]:
    """``(value, ok)`` — ``ok`` is False only when *raw* is present but non-integer."""
    if raw is None:
        return None, True
    text = raw.strip()
    if text and (text.isdigit() or (text[0] == "-" and text[1:].isdigit())):
        return int(text), True
    return None, False


def _seqs(raw: str | None) -> tuple[list[int], bool]:
    """``(sequence numbers, ok)`` — ``ok`` is False when a component was non-numeric."""
    if raw is None:
        return [], True
    out: list[int] = []
    ok = True
    for token in raw.split(","):
        token = token.strip()
        if not token:
            # An EMPTY component inside a non-empty delimited value (`1,,3`) is
            # malformed input, not an absence: skipping it silently would lose a
            # component while the row still reported as fully parsed (QA-F2).
            ok = False
            continue
        if token.isdigit():
            out.append(int(token))
        else:
            # A non-numeric component must NOT be silently discarded: the
            # normalized sequence list would be incomplete while the row still
            # reported as fully parsed (QA-F3, R3/G3). Report it to the caller.
            ok = False
    return out, ok


_PUT_CALL = {"PUT": "PUT", "CALL": "CALL"}


# --- per-holding normalization -----------------------------------------------


@dataclass(frozen=True)
class NormalizedHolding:
    raw_row: Mapping[str, str | None]
    row_ordinal: int
    issuer_name_raw: str
    title_of_class: str | None
    cusip_raw: str | None
    cusip: str | None
    value_raw: int | None
    unit_basis: str
    value_usd: int | None
    ssh_prnamt: int | None
    ssh_prnamt_type: str | None
    put_call: str | None
    investment_discretion: str | None
    other_manager: str | None
    other_manager_seqs: list[int]
    voting_sole: int | None
    voting_shared: int | None
    voting_none: int | None
    security_id: str | None
    flags: list[str] = field(default_factory=list)


def normalize_holding(
    row: InfoTableRow,
    *,
    unit_basis: str,
    period_of_report: str,
    resolve_security: Callable[[str, str], str | None],
) -> NormalizedHolding:
    """Normalize one info-table row; retain-and-flag, never drop (G3/R3/R9).

    *resolve_security* is ``(cusip, as_of_date) -> security_id | None`` — the
    only identity path, so a CUSIP is always resolved as-of ``period_of_report``
    (G14) and an unmapped one keeps its ``issuer_name_raw`` under
    ``missing_security`` rather than being dropped or guessed.
    """
    flags: set[str] = set()

    issuer = row.name_of_issuer
    if issuer is None:
        issuer = UNPARSED_ISSUER_SENTINEL
        flags.add("row_incomplete")

    cusip_raw = row.cusip
    cusip = normalize_cusip(cusip_raw)
    security_id: str | None = None
    if cusip is None:
        flags.add("cusip_unparsed")
    else:
        security_id = resolve_security(cusip, period_of_report)
        if security_id is None:
            flags.add("missing_security")

    value_raw, value_ok = _to_int(row.value)
    if not value_ok or value_raw is None:
        flags.add("value_unparsed")
    multiplier = UNIT_MULTIPLIER[unit_basis]
    value_usd = value_raw * multiplier if value_raw is not None else None

    # An ABSENT required field is a defect too, not "valid optional absence":
    # `_to_int(None)` reports ok=True (nothing to misparse), so a missing
    # sshPrnamt or votingAuthority would otherwise land in a row marked fully
    # parsed. Section 13(f) info tables require nameOfIssuer, titleOfClass,
    # cusip, value, shrsOrPrnAmt{sshPrnamt, sshPrnamtType},
    # investmentDiscretion and votingAuthority{Sole,Shared,None}; only putCall
    # and otherManager are optional. (QA-F2, R3/G3)
    ssh, ssh_ok = _to_int(row.ssh_prnamt)
    if not ssh_ok or ssh is None:
        flags.add("ssh_unparsed")

    put_call = None
    if row.put_call is not None:
        put_call = _PUT_CALL.get(row.put_call.strip().upper())
        if put_call is None:
            flags.add("put_call_unparsed")

    # EACH votingAuthority member (Sole, Shared, None) is required: one
    # individually missing value is structurally incomplete data, not "partial
    # but fine" — flag if ANY is absent or non-numeric. (QA-F2)
    voting_sole, sole_ok = _to_int(row.voting_sole)
    voting_shared, shared_ok = _to_int(row.voting_shared)
    voting_none, none_ok = _to_int(row.voting_none)
    if not (sole_ok and shared_ok and none_ok) or None in (
        voting_sole,
        voting_shared,
        voting_none,
    ):
        flags.add("voting_unparsed")

    other_manager_seqs, seqs_ok = _seqs(row.other_manager)
    if not seqs_ok:
        flags.add("other_manager_unparsed")

    # Remaining required row fields: absent ⇒ the row is structurally incomplete
    # (retained + flagged + filing forced to `partial`, never dropped — G3).
    # `investmentDiscretion` is required by the info-table contract too. (QA-F1)
    if (
        row.title_of_class is None
        or row.ssh_prnamt_type is None
        or row.investment_discretion is None
    ):
        flags.add("row_incomplete")

    return NormalizedHolding(
        raw_row=dict(row.raw_row),
        row_ordinal=row.row_ordinal,
        issuer_name_raw=issuer,
        title_of_class=row.title_of_class,
        cusip_raw=cusip_raw,
        cusip=cusip,
        value_raw=value_raw,
        unit_basis=unit_basis,
        value_usd=value_usd,
        ssh_prnamt=ssh,
        ssh_prnamt_type=row.ssh_prnamt_type,
        put_call=put_call,
        investment_discretion=row.investment_discretion,
        other_manager=row.other_manager,
        other_manager_seqs=other_manager_seqs,
        voting_sole=voting_sole,
        voting_shared=voting_shared,
        voting_none=voting_none,
        security_id=security_id,
        flags=sorted(flags),
    )


# --- per-filing reconciliation + coverage inputs (R16) -----------------------


@dataclass(frozen=True)
class FilingReconciliation:
    table_entry_total: int | None
    table_value_total: int | None
    table_value_total_usd: int | None
    row_count: int
    sum_value_usd: int
    value_total_delta: int | None
    resolved_rows: int
    resolved_value_usd: int
    entry_total_mismatch: bool


def filing_reconciliation(
    *,
    table_entry_total: int | None,
    table_value_total: int | None,
    unit_basis: str,
    holdings: Iterable[NormalizedHolding],
) -> FilingReconciliation:
    """Reconcile a parsed cover against its normalized holdings (R4/R16/LD-7).

    ``table_value_total_usd`` is the cover total scaled by the era multiplier —
    the coverage DENOMINATOR contribution. It is populated for an info-table-
    failed filing too (empty *holdings*, non-zero cover total), so that filing
    drags coverage down rather than vanishing from the denominator (F3). A NULL
    total means the value is UNKNOWN — produced by ingest's cover-failed path and,
    defensively, whenever the cover total itself is absent (never coerced to 0,
    which would inflate coverage — QA-F1). ``value_total_delta`` is reported, not
    fatal; ``entry_total_mismatch`` forces the filing to ``partial``.
    """
    holdings = list(holdings)
    multiplier = UNIT_MULTIPLIER[unit_basis]
    # An UNKNOWN cover total stays NULL — never 0. Coercing it to 0 would let the
    # filing contribute nothing to the coverage denominator without raising
    # `cover_failed_count`, silently inflating identity coverage (QA-F1, R16).
    # `parse_cover` already rejects a missing total on a holdings report, so this
    # is the defence-in-depth half of that contract.
    table_value_total_usd = (
        table_value_total * multiplier if table_value_total is not None else None
    )
    row_count = len(holdings)
    sum_value_usd = sum(h.value_usd for h in holdings if h.value_usd is not None)
    resolved = [h for h in holdings if h.security_id is not None]
    resolved_value_usd = sum(h.value_usd for h in resolved if h.value_usd is not None)
    return FilingReconciliation(
        table_entry_total=table_entry_total,
        table_value_total=table_value_total,
        table_value_total_usd=table_value_total_usd,
        row_count=row_count,
        sum_value_usd=sum_value_usd,
        value_total_delta=(
            sum_value_usd - table_value_total_usd
            if table_value_total_usd is not None
            else None
        ),
        resolved_rows=len(resolved),
        resolved_value_usd=resolved_value_usd,
        entry_total_mismatch=(
            table_entry_total is not None and table_entry_total != row_count
        ),
    )
