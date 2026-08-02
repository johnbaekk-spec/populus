"""Chamber-neutral normalization maps and the locked flag taxonomy (RUN 2+3).

Pure functions from raw extracted cell text to normalized column values
(ARCHITECTURE.md §9 + Appendix C). The raw text always survives in
``raw_row``; normalization never mutates it (G5 — ranges stay labeled).
The maps serve both chambers: House PTR PDFs print coded tokens
(``P``/``SP``/``[ST]``); Senate eFD pages print spelled-out labels
(``Purchase``/``Spouse``/an Asset Type column) — both feed the same
canonical vocabulary.

Flag taxonomy (single source of truth): every flag any RUN-2/RUN-3 code
path can emit is a member of exactly one of two disjoint frozensets. A
*parse defect* means extraction/normalization could not fully interpret the
source; a *source fact* is a faithfully parsed property of the filing
itself. Both the filing-status decision (``parsed`` vs ``partial``) and the
clean-row metric read :func:`has_parse_defect` — never a second list.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import date

from populus.load import ParsedRow

NORMALIZATION_VERSION = "norm-1.1.0"

PARSE_DEFECT_FLAGS = frozenset(
    {
        "side_unparsed",
        "owner_unparsed",
        "amount_unparsed",
        "date_missing",
        "asset_unparsed",
        "capgains_unparsed",
        "row_incomplete",
        "row_orphan",
        "text_fallback",
        # A printed Senate '#' cell that is not a positive integer: the row's
        # dup_seq coordinate falls back to presentation order VISIBLY (LD15).
        "source_row_no_unparsed",
    }
)
SOURCE_FACT_FLAGS = frozenset(
    {
        "missing_ticker",
        "amount_spouse_cap",
        "date_anomaly",
        # Every transaction row of a Senate amendment filing carries this
        # until OQ-13 settles amendment semantics (§9.5 conservative default).
        "amendment_unresolved",
    }
)
KNOWN_FLAGS = PARSE_DEFECT_FLAGS | SOURCE_FACT_FLAGS


def has_parse_defect(flags: Iterable[str]) -> bool:
    """Whether *flags* contains any member of :data:`PARSE_DEFECT_FLAGS`."""
    return bool(PARSE_DEFECT_FLAGS.intersection(flags))


# --- side / owner ------------------------------------------------------------

_SIDE_MAP = {
    # House codes.
    "p": "purchase",
    "s": "sale",
    "s(partial)": "sale_partial",
    "e": "exchange",
    # Senate printed labels (whitespace removed by the key derivation).
    "purchase": "purchase",
    "sale(full)": "sale",
    "sale(partial)": "sale_partial",
    "exchange": "exchange",
}
_OWNER_MAP = {
    # House codes.
    "sp": "spouse",
    "dc": "child",
    "jt": "joint",
    "self": "self",
    # Senate printed labels.
    "spouse": "spouse",
    "child": "child",
    "joint": "joint",
}


def normalize_side(raw: str | None) -> tuple[str, frozenset[str]]:
    """P/S/S (partial)/E → schema side enum; anything else ``other`` + flag."""
    if raw is not None:
        key = "".join(raw.split()).lower()
        if key in _SIDE_MAP:
            return _SIDE_MAP[key], frozenset()
    return "other", frozenset({"side_unparsed"})


def normalize_owner(raw: str | None) -> tuple[str | None, frozenset[str]]:
    """SP/DC/JT/self → canonical owner; blank → NULL unflagged (LD5)."""
    if raw is None or not raw.strip():
        return None, frozenset()
    key = raw.strip().lower()
    if key in _OWNER_MAP:
        return _OWNER_MAP[key], frozenset()
    return None, frozenset({"owner_unparsed"})


# --- ticker / asset ----------------------------------------------------------


def normalize_ticker(raw: str | None) -> tuple[str | None, frozenset[str]]:
    """Uppercase the printed ticker; ``--``/blank/absent → NULL + flag."""
    if raw is None or not raw.strip() or raw.strip() == "--":
        return None, frozenset({"missing_ticker"})
    return raw.strip().upper(), frozenset()


_ASSET_TYPE_TAG = re.compile(r"\[([A-Za-z]{2})\]")

UNPARSED_ASSET_SENTINEL = "(unparsed asset)"


def normalize_asset(raw: str | None) -> tuple[str, str | None, frozenset[str]]:
    """Whitespace-collapsed asset text plus the trailing ``[XX]`` type code.

    ``asset_name`` is NOT NULL in the schema, so a missing asset cell becomes
    the deterministic sentinel ``(unparsed asset)`` + ``asset_unparsed``
    (LD18); ``raw_row.asset_name`` stays ``null``.
    """
    if raw is None or not raw.strip():
        return UNPARSED_ASSET_SENTINEL, None, frozenset({"asset_unparsed"})
    collapsed = " ".join(raw.split())
    tags = _ASSET_TYPE_TAG.findall(collapsed)
    asset_type = tags[-1].upper() if tags else None
    return collapsed, asset_type, frozenset()


# --- amounts (Appendix C) ----------------------------------------------------

# The ten statutory buckets, exactly as the corpus prints them. Keyed on the
# whitespace-collapsed, lowercased label so print-time spacing differences
# cannot fork the table.
_AMOUNT_BUCKETS: dict[str, tuple[int, int | None]] = {
    "$1,001 - $15,000": (1_001, 15_000),
    "$15,001 - $50,000": (15_001, 50_000),
    "$50,001 - $100,000": (50_001, 100_000),
    "$100,001 - $250,000": (100_001, 250_000),
    "$250,001 - $500,000": (250_001, 500_000),
    "$500,001 - $1,000,000": (500_001, 1_000_000),
    "$1,000,001 - $5,000,000": (1_000_001, 5_000_000),
    "$5,000,001 - $25,000,000": (5_000_001, 25_000_000),
    "$25,000,001 - $50,000,000": (25_000_001, 50_000_000),
    "Over $50,000,000": (50_000_001, None),
}
_AMOUNT_LOOKUP = {label.lower(): bounds for label, bounds in _AMOUNT_BUCKETS.items()}
# Both printed spouse/dependent-cap forms: the bare Appendix C label and the
# corpus-verified 2026 rendering "Spouse/DC Over $1,000,000" (e.g. DocID
# 20033695).
_SPOUSE_CAP_LABELS = frozenset({"over $1,000,000", "spouse/dc over $1,000,000"})


def normalize_amount(
    raw: str | None,
) -> tuple[int | None, int | None, frozenset[str]]:
    """Map a printed amount label to its statutory bucket (Appendix C).

    The >$1M spouse/dependent cap form maps to ``(1_000_001, NULL)`` +
    ``amount_spouse_cap``. Any other unrecognized non-empty label —
    including a wrapped fragment such as ``"$50,001 -"`` — is
    ``amount_unparsed`` with the raw label preserved by the caller. This
    asymmetry is what makes this function the wrapped-cell completion oracle
    (R24): a fragment does not parse, the rejoined label does. An absent cell
    returns no flags; ``row_incomplete`` covers absence.
    """
    if raw is None or not raw.strip():
        return None, None, frozenset()
    canon = " ".join(raw.split()).lower()
    if canon in _SPOUSE_CAP_LABELS:
        return 1_000_001, None, frozenset({"amount_spouse_cap"})
    bounds = _AMOUNT_LOOKUP.get(canon)
    if bounds is None:
        return None, None, frozenset({"amount_unparsed"})
    return bounds[0], bounds[1], frozenset()


# --- dates -------------------------------------------------------------------

_MDY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def date_stats(
    transaction_iso: str | None, filed_iso: str
) -> tuple[str | None, int | None, int | None, frozenset[str]]:
    """``(transaction_date_iso, days_to_file, is_late, flags)`` from ISO dates.

    The single authority for the derived date statistics (shared by the
    chamber parsers via :func:`normalize_dates` and by the kadoa backfill,
    whose seed prints ISO dates directly). ``is_late`` is
    ``days_to_file > 45``; ``date_anomaly`` (filed before transacted) keeps
    the computed values and flags — never drops (G3). An absent or invalid
    transaction date is NULL + ``date_missing`` (the schema's only
    sanctioned NULL-date state).
    """
    if transaction_iso is None:
        return None, None, None, frozenset({"date_missing"})
    try:
        transacted = date.fromisoformat(transaction_iso)
    except ValueError:
        return None, None, None, frozenset({"date_missing"})
    filed = date.fromisoformat(filed_iso)
    days_to_file = (filed - transacted).days
    flags = frozenset({"date_anomaly"}) if filed < transacted else frozenset()
    return transacted.isoformat(), days_to_file, int(days_to_file > 45), flags


def normalize_dates(
    raw: str | None, filed_date: str
) -> tuple[str | None, int | None, int | None, frozenset[str]]:
    """``(transaction_date_iso, days_to_file, is_late, flags)`` (R10).

    Source dates print as non-zero-padded ``M/D/YYYY``; the statistics
    themselves are delegated to :func:`date_stats` so the rules cannot fork
    across sources. An absent or unparseable date is NULL + ``date_missing``.
    """
    if raw is None:
        return None, None, None, frozenset({"date_missing"})
    match = _MDY.match(raw.strip())
    if match is None:
        return None, None, None, frozenset({"date_missing"})
    month, day, year = (int(g) for g in match.groups())
    try:
        transacted = date(year, month, day)
    except ValueError:
        return None, None, None, frozenset({"date_missing"})
    return date_stats(transacted.isoformat(), filed_date)


# --- comment -----------------------------------------------------------------


def normalize_comment(raw: str | None) -> str | None:
    """Whitespace-collapsed free text; ``--``/blank/absent → NULL, unflagged.

    The Senate comment column prints the literal ``--`` for "no comment"
    (like its ticker column); House comments are already collapsed at
    segmentation, so collapsing here is behavior-preserving for RUN 2
    (proven by the untouched House goldens).
    """
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    if not collapsed or collapsed == "--":
        return None
    return collapsed


# --- cap gains ---------------------------------------------------------------

# The House PDF checkbox extracts as a Wingdings glyph run: "gfedcb" when
# checked (verified against the checked certification box and the checked
# rows of fixture 2020_20016556), "gfedc" when unchecked. 2026-era PDFs
# extract no glyph at all for an unchecked box (verified: zero chars in the
# Cap-Gains column of 2026_20034916), so an empty cell under a present
# column reads as unmarked (LD11).
_CAPGAINS_CHECKED = "gfedcb"
_CAPGAINS_UNCHECKED = "gfedc"


def normalize_capgains(
    raw: str | None, *, column_present: bool
) -> tuple[int | None, frozenset[str]]:
    """LD11: absent column → NULL unflagged; marked 1 / empty 0 / other flag."""
    if not column_present:
        return None, frozenset()
    if raw is None or not raw.strip():
        return 0, frozenset()
    token = raw.strip().lower()
    if token == _CAPGAINS_CHECKED:
        return 1, frozenset()
    if token == _CAPGAINS_UNCHECKED:
        return 0, frozenset()
    return None, frozenset({"capgains_unparsed"})


# --- row composition ---------------------------------------------------------


def normalize_row(
    raw_row: Mapping[str, str | None],
    *,
    filed_date: str,
    cap_gains_cell: str | None,
    cap_gains_column_present: bool,
    row_ordinal: int,
    source_row_no: int | None,
    structural_flags: Iterable[str] = (),
    asset_display_cell: str | None = None,
    asset_type_cell: str | None = None,
    filing_status: str | None = None,
    subholding_of: str | None = None,
    location: str | None = None,
) -> ParsedRow:
    """Compose the field normalizers into a loadable :class:`ParsedRow`.

    *structural_flags* (``row_incomplete``/``row_orphan``/``text_fallback``/
    ``source_row_no_unparsed``/``amendment_unresolved``) come from the
    parser/orchestrator and are unioned with the map flags; every emitted
    flag is a :data:`KNOWN_FLAGS` member.

    Senate seams (LD2 — ``raw_row`` keeps the closed seven-key shape):
    *asset_display_cell* is the clean asset text (bond annotation excluded,
    whitespace collapsed) and, when supplied, is the source of the
    normalized ``asset_name`` while ``raw_row.asset_name`` stays lossless;
    *asset_type_cell* is the printed Asset Type column and, when non-blank,
    supplies ``asset_type`` directly. The defaults preserve the House
    behavior exactly (asset name and ``[XX]`` type tag from the raw cell).
    """
    owner, owner_flags = normalize_owner(raw_row.get("owner"))
    ticker, ticker_flags = normalize_ticker(raw_row.get("ticker"))
    asset_source = (
        asset_display_cell
        if asset_display_cell is not None
        else raw_row.get("asset_name")
    )
    asset_name, asset_type, asset_flags = normalize_asset(asset_source)
    if asset_type_cell is not None and asset_type_cell.strip():
        asset_type = " ".join(asset_type_cell.split())
    side, side_flags = normalize_side(raw_row.get("side"))
    transaction_date, days_to_file, is_late, date_flags = normalize_dates(
        raw_row.get("transaction_date"), filed_date
    )
    amount_label = raw_row.get("amount_label")
    amount_low, amount_high, amount_flags = normalize_amount(amount_label)
    cap_gains, capgains_flags = normalize_capgains(
        cap_gains_cell, column_present=cap_gains_column_present
    )
    flags = sorted(
        set(structural_flags)
        | owner_flags
        | ticker_flags
        | asset_flags
        | side_flags
        | date_flags
        | amount_flags
        | capgains_flags
    )
    return ParsedRow(
        raw_row=dict(raw_row),
        row_ordinal=row_ordinal,
        source_row_no=source_row_no,
        asset_name=asset_name,
        asset_type=asset_type,
        side=side,
        owner=owner,
        ticker=ticker,
        transaction_date=transaction_date,
        days_to_file=days_to_file,
        is_late=is_late,
        amount_low=amount_low,
        amount_high=amount_high,
        amount_label=amount_label,
        cap_gains_over_200=cap_gains,
        comment=normalize_comment(raw_row.get("comment")),
        filing_status=normalize_comment(filing_status),
        subholding_of=normalize_comment(subholding_of),
        location=normalize_comment(location),
        flags=flags,
    )
