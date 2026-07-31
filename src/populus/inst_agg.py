"""Cross-filer 13F aggregates (ARCHITECTURE.md §10.2; M2-CONTRACT §5.6 — RUN M2-3).

Pure DB→DB: read the default 13F population (``v_default_holdings`` /
``v_default_inst_filings``) joined to the §5.4 securities registry from a source
connection, and write a fresh, reproducible ``inst_agg.db`` whose four aggregate
tables carry a historically-sound identity contract. There is no network path
here (guarded structurally by ``tests/test_dep_guard.py``); the only inputs are
the source database and an injected ``ingested_at`` — library code never reads
the wall clock.

Identity contracts, all G14-clean (a mapping applies only inside its interval;
no CUSIP→current-ticker chaining, no cross-quarter name matching):

* **QoQ** matches a filer's positions across its two consecutive report periods
  on the as-of ``security_id`` first — correct across a CUSIP change, because the
  registry resolves both CUSIPs to one ``security_id`` — then reconciles any
  still-unmatched pair by an EXACT reported CUSIP within the same filer's
  adjacent quarters (flagged ``identity_reconciled_by_cusip``), bridging a
  resolved/unresolved registry gap without inventing identity.
* **Top holders** rank per ISSUER: a filer's value is summed across every
  security sharing an ``issuer_key`` (``entity_id`` when the link is resolved,
  else the CUSIP-6 issuer block, else the normalized issuer name) BEFORE ranking,
  so share classes never split a holder.
* Δshares is unit-guarded (equal ``ssh_prnamt_type`` both quarters, else NULL +
  a flag); concentration is NULL + a flag when a filer's total is 0 — never a
  fabricated zero, never a divide-by-zero. Every projected numeric is an integer.
"""

from __future__ import annotations

import importlib.resources
import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from populus.amendments import ensure_views
from populus.normalize_inst import NORMALIZATION_VERSION

#: Per-issuer top-holders depth (M2-CONTRACT §5.6). The long tail is not in the
#: aggregate slice; recorded in ``agg_build_meta`` so the cut is legible (TD-M2-3-2).
#: The projected-table allowlist lives in ``digests.LOGICAL_PROJECTIONS['inst']``.
DEFAULT_TOPN = 25


class InstAggError(RuntimeError):
    """An aggregate build was refused (e.g. the output would clobber its source)."""


@dataclass(frozen=True)
class InstAggReport:
    """Row counts of one aggregate build (for the CLI + tests)."""

    filers: int
    qoq_rows: int
    issuer_rows: int
    concentration_rows: int
    topn: int


# --- deterministic identity keys ---------------------------------------------


def _norm_issuer_name(name: str) -> str:
    """Uppercase + whitespace-collapsed issuer name (deterministic name key)."""
    return " ".join(str(name).upper().split())


def _position_key(security_id: str | None, cusip: str | None) -> str | None:
    """``'sid:<id>'`` when resolved, else ``'cusip:<cusip>'``, else ``None``.

    A ``None`` key is an UNKEYABLE holding (neither a resolved security nor a
    reported CUSIP): retained and counted in the filer registry (G3), excluded
    from QoQ (which needs a stable cross-quarter handle).
    """
    if security_id is not None:
        return f"sid:{security_id}"
    if cusip is not None:
        return f"cusip:{cusip}"
    return None


def _put_call_bucket(put_call: str | None) -> str:
    """A non-null grain token: ``'PUT'``/``'CALL'`` or ``'LONG'`` for a long."""
    return put_call if put_call in ("PUT", "CALL") else "LONG"


def _unit_key(ssh_prnamt_type: str | None) -> str:
    """A non-null grain token for the reported unit: ``'SH'``/``'PRN'``/``'UNKNOWN'``.

    The unit is part of the position GRAIN (QA-F2): shares and principal amounts
    are different quantities, so merging an SH and a PRN holding of the same
    security would produce a meaningless share count and bogus Δshares.
    """
    return ssh_prnamt_type if ssh_prnamt_type in ("SH", "PRN") else "UNKNOWN"


def _issuer_key(
    entity_id: str | None,
    entity_link_state: str | None,
    cusip: str | None,
    issuer_name_raw: str,
) -> tuple[str, str]:
    """``(issuer_key, source)`` with ``source`` ∈ ``{entity, cusip6, name}``.

    Resolved ``entity_id`` first (the durable issuer identity), else the CUSIP-6
    issuer block, else the normalized reported issuer name — each fallback is a
    weaker claim, surfaced through ``source`` so a consumer can see how the
    issuer was keyed.
    """
    if entity_id is not None and entity_link_state == "resolved":
        return f"entity:{entity_id}", "entity"
    if cusip is not None and len(cusip) >= 6:
        return f"cusip6:{cusip[:6]}", "cusip6"
    return f"name:{_norm_issuer_name(issuer_name_raw)}", "name"


def _flags_json(flags: set[str]) -> str:
    """Canonical sorted JSON-array text (opaque, stable digest bytes)."""
    return json.dumps(sorted(flags), ensure_ascii=False, separators=(",", ":"))


# --- per-position accumulation ------------------------------------------------


@dataclass
class _Position:
    """A filer's aggregated holding of one keyable security in one period."""

    value_usd: int = 0
    #: Whether ANY constituent holding disclosed a parseable value. Without it a
    #: position whose only value was NULL is indistinguishable from a real zero,
    #: and the QoQ delta fabricates one (QA-VERIFY5-B2).
    has_disclosed_value: bool = False
    units: set[str] = field(default_factory=set)
    has_null_unit: bool = False
    shares_sum: int = 0
    has_null_share: bool = False
    cusips: set[str] = field(default_factory=set)

    def add(self, value_usd, ssh_prnamt, ssh_prnamt_type, cusip) -> None:
        if value_usd is not None:
            self.value_usd += value_usd
            self.has_disclosed_value = True
        if ssh_prnamt_type is None:
            self.has_null_unit = True
        else:
            self.units.add(ssh_prnamt_type)
        if ssh_prnamt is None:
            self.has_null_share = True
        else:
            self.shares_sum += ssh_prnamt
        if cusip is not None:
            self.cusips.add(cusip)

    @property
    def unit(self) -> str | None:
        """The single unambiguous ``ssh_prnamt_type``, else ``None`` (mixed)."""
        if len(self.units) == 1 and not self.has_null_unit:
            return next(iter(self.units))
        return None

    @property
    def shares(self) -> int | None:
        """Summed shares only when the unit is clean and no share is unknown."""
        if self.unit is not None and not self.has_null_share:
            return self.shares_sum
        return None

    @property
    def single_cusip(self) -> str | None:
        """The one reported CUSIP, for exact reconciliation, else ``None``."""
        if len(self.cusips) == 1:
            return next(iter(self.cusips))
        return None


@dataclass(frozen=True)
class _FinalPosition:
    value_usd: int
    has_disclosed_value: bool
    shares: int | None
    unit: str | None
    single_cusip: str | None


def _finalize(pos: _Position) -> _FinalPosition:
    return _FinalPosition(pos.value_usd, pos.has_disclosed_value, pos.shares,
                          pos.unit, pos.single_cusip)


# --- QoQ ----------------------------------------------------------------------


def _qoq_row(
    *,
    cik: str,
    curr_period: str,
    prev_period: str,
    position_key: str,
    put_call: str,
    unit: str,
    prev: _FinalPosition | None,
    curr: _FinalPosition | None,
    reconciled: bool,
    ingested_at: str,
) -> tuple:
    """One ``agg_qoq_deltas`` row tuple, with the F4 unit-guarded Δshares."""
    # A position that existed but disclosed NO parseable value must NOT
    # difference against a fabricated zero (QA-VERIFY5-B2). Absence of the
    # position is a real zero; presence with an undisclosed value is not.
    prev_undisclosed = prev is not None and not prev.has_disclosed_value
    curr_undisclosed = curr is not None and not curr.has_disclosed_value
    prev_value = None if prev_undisclosed else (prev.value_usd if prev else 0)
    curr_value = None if curr_undisclosed else (curr.value_usd if curr else 0)
    delta_value = (
        None if prev_value is None or curr_value is None
        else curr_value - prev_value
    )
    prev_shares = prev.shares if prev is not None else None
    curr_shares = curr.shares if curr is not None else None
    # The grain unit — NOT NULL, because subpositions are unit-distinct (QA-F2).
    ssh_type = unit
    flags: set[str] = set()
    if reconciled:
        flags.add("identity_reconciled_by_cusip")
    if prev_undisclosed or curr_undisclosed:
        flags.add("value_undisclosed_one_side")

    if prev is None:
        change_kind = "new"
        delta_shares = curr_shares
    elif curr is None:
        change_kind = "exit"
        delta_shares = -prev_shares if prev_shares is not None else None
    else:
        units_compatible = (
            prev.unit is not None
            and curr.unit is not None
            and prev.unit == curr.unit
            and prev_shares is not None
            and curr_shares is not None
        )
        if units_compatible:
            delta_shares = curr_shares - prev_shares
        else:
            delta_shares = None
            flags.add("shares_unit_mismatch")
        if delta_shares is not None and delta_shares != 0:
            change_kind = "add" if delta_shares > 0 else "trim"
        elif delta_value is not None:
            change_kind = "add" if delta_value >= 0 else "trim"
            flags.add("classified_by_value")
        else:
            # Neither shares nor value can classify this — say so rather than
            # pick a direction.
            change_kind = "unclassified"
            flags.add("change_kind_undeterminable")

    return (
        cik,
        position_key,
        put_call,
        curr_period,
        prev_period,
        change_kind,
        prev_value,
        curr_value,
        delta_value,
        prev_shares,
        curr_shares,
        delta_shares,
        ssh_type,
        _flags_json(flags),
        ingested_at,
    )


def _match_periods(
    prev: dict[tuple[str, str, str], _FinalPosition],
    curr: dict[tuple[str, str, str], _FinalPosition],
) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """Three-pass matching between one filer's adjacent periods.

    Keys are the full position GRAIN ``(position_key, put_call, unit)``. Returns
    ``(matched, reconciled, unmatched)`` where each ``matched`` / ``reconciled``
    item is ``(grain_key, prev_pos, curr_pos)`` and each ``unmatched`` item is
    ``('new'|'exit', grain_key, pos)``.

    1. **Exact grain.** Identical ``(position_key, put_call, unit)``.
    2. **Same identity, unit transition.** Remaining rows are matched on
       ``(position_key, put_call)`` IGNORING the unit, uniquely on both sides —
       a security reported SH one quarter and PRN the next is ONE continuous
       position. This is a ``position_key`` (security-id-first) match, so it is
       NOT flagged as CUSIP-reconciled; Δshares stays unit-guarded downstream.
       Without this pass the unit-bearing grain would push a legitimate unit
       transition into pass 3 (mislabelled) or into exit+new (QA-F2, round 3).
    3. **Reported-CUSIP reconciliation, ONLY across the resolved↔unresolved
       boundary.** This exists to bridge a registry gap — one quarter resolved to
       a ``sid:`` key, the other still keyed by raw ``cusip:`` — so it requires
       exactly one side to be unresolved and an unambiguous 1:1 pair. Two
       DIFFERENT resolved securities that happen to report the same CUSIP are
       never collapsed; they stay a genuine exit and a genuine new (QA-F1,
       round 3). Anything ambiguous stays unmatched — never a guessed bridge.
    """
    matched: list[tuple] = []
    for key in sorted(set(prev) & set(curr)):
        matched.append((key, prev[key], curr[key]))

    unmatched_prev = {k: v for k, v in prev.items() if k not in curr}
    unmatched_curr = {k: v for k, v in curr.items() if k not in prev}

    # --- pass 2: same (position_key, put_call), unit changed -----------------
    def _by_identity(positions: dict) -> dict[tuple[str, str], list[tuple]]:
        index: dict[tuple[str, str], list[tuple]] = defaultdict(list)
        for grain_key, pos in positions.items():
            pk, put_call, _unit = grain_key
            index[(pk, put_call)].append((grain_key, pos))
        return index

    prev_by_identity = _by_identity(unmatched_prev)
    curr_by_identity = _by_identity(unmatched_curr)
    for identity in sorted(set(prev_by_identity) & set(curr_by_identity)):
        prev_cands, curr_cands = prev_by_identity[identity], curr_by_identity[identity]
        if len(prev_cands) == 1 and len(curr_cands) == 1:
            prev_key, prev_pos = prev_cands[0]
            curr_key, curr_pos = curr_cands[0]
            # A same-identity continuation: emit under the CURRENT quarter's key.
            matched.append((curr_key, prev_pos, curr_pos))
            unmatched_prev.pop(prev_key, None)
            unmatched_curr.pop(curr_key, None)

    # --- pass 3: reported-CUSIP reconciliation across the registry gap -------
    def _resolved(grain_key) -> bool:
        return grain_key[0].startswith("sid:")

    def _by_cusip(positions: dict) -> dict[tuple[str, str], list[tuple]]:
        index: dict[tuple[str, str], list[tuple]] = defaultdict(list)
        for grain_key, pos in positions.items():
            _pk, put_call, _unit = grain_key
            if pos.single_cusip is not None:
                index[(pos.single_cusip, put_call)].append((grain_key, pos))
        return index

    prev_by_cusip = _by_cusip(unmatched_prev)
    curr_by_cusip = _by_cusip(unmatched_curr)
    reconciled: list[tuple] = []
    for cusip_key in sorted(set(prev_by_cusip) & set(curr_by_cusip)):
        prev_cands = prev_by_cusip[cusip_key]
        curr_cands = curr_by_cusip[cusip_key]
        if len(prev_cands) != 1 or len(curr_cands) != 1:
            continue
        prev_full_key, prev_pos = prev_cands[0]
        curr_full_key, curr_pos = curr_cands[0]
        # ONLY a resolved↔unresolved bridge. Two distinct RESOLVED securities
        # sharing a reported CUSIP must not be collapsed (QA-F1).
        if _resolved(prev_full_key) == _resolved(curr_full_key):
            continue
        reconciled.append((curr_full_key, prev_pos, curr_pos))
        unmatched_prev.pop(prev_full_key, None)
        unmatched_curr.pop(curr_full_key, None)

    unmatched: list[tuple] = []
    for key in sorted(unmatched_curr):
        unmatched.append(("new", key, unmatched_curr[key]))
    for key in sorted(unmatched_prev):
        unmatched.append(("exit", key, unmatched_prev[key]))
    return matched, reconciled, unmatched


# --- the build ----------------------------------------------------------------


def _load_ddl() -> str:
    return (
        importlib.resources.files("populus")
        .joinpath("inst_agg.sql")
        .read_text(encoding="utf-8")
    )


def refuse_if_dest_aliases_source(
    source_conn: sqlite3.Connection, dest_path: Path | str
) -> None:
    """Raise :class:`InstAggError` when *dest_path* is the source database.

    REFUSE to write the aggregate over its source. The destination is replaced
    unconditionally, so aliasing it to the ingested store (e.g.
    ``populus inst-agg --db populus.db --out populus.db``) would DESTROY the
    canonical database and leave an aggregate in its place. Compares resolved
    paths against the sqlite ``database_list`` of the LIVE source connection,
    which catches symlinks, ``..`` and relative/absolute spellings of one file.

    This is a PREFLIGHT: callers must run it before any statement that could
    write to the source — schema application, ``ensure_views``, anything — so a
    refused command leaves the source byte-identical (external review F4).
    """
    resolved_dest = Path(dest_path).resolve()
    for _seq, _name, source_file in source_conn.execute("PRAGMA database_list"):
        if not source_file:
            continue  # in-memory or temp database — cannot alias a real path
        if Path(source_file).resolve() == resolved_dest:
            raise InstAggError(
                f"refusing to write the aggregate over its own source database:"
                f" {dest_path} resolves to the same file as {source_file}."
                " Choose a different --out path."
            )


def build_inst_agg(
    source_conn: sqlite3.Connection,
    dest_path: Path | str,
    *,
    ingested_at: str,
    topn: int = DEFAULT_TOPN,
) -> InstAggReport:
    """Build a fresh, reproducible ``inst_agg.db`` at *dest_path*.

    *source_conn* is any connection whose default 13F views resolve (they are
    ensured here); *ingested_at* is injected provenance (excluded from the
    logical digest). A pre-existing *dest_path* is replaced, so a re-run over the
    same source yields the same logical content byte-for-byte under the digest.

    The alias refusal runs FIRST, before ``ensure_views`` or any other statement
    touches the source: since M2-7 ``ensure_views`` REPLACES a stale view
    definition, and a command that is ultimately refused must leave the source
    byte-identical (external review F4).
    """
    dest_path = Path(dest_path)
    refuse_if_dest_aliases_source(source_conn, dest_path)
    ensure_views(source_conn)
    if dest_path.exists():
        dest_path.unlink()

    # The FILING-LEVEL universe: every (cik, period) that has a default filing,
    # independent of whether it contains keyable holdings. Both the QoQ timeline
    # (QA-F3) and the concentration rows (QA-F4) derive from this, so a
    # notice-only or all-unkeyable quarter is a REAL period that breaks adjacency
    # and still gets a concentration row — it never silently disappears (G3).
    filer_periods: dict[str, list[str]] = defaultdict(list)
    for cik, period in source_conn.execute(
        "SELECT DISTINCT cik, period_of_report FROM v_default_inst_filings"
        " ORDER BY cik, period_of_report"
    ):
        filer_periods[cik].append(period)

    # --- default filer set (a notice-only filer still gets a registry row) ----
    filers: dict[str, dict] = {}
    for cik, filer_name, latest_period in source_conn.execute(
        "SELECT fil.cik, fr.name_raw, MAX(fil.period_of_report)"
        " FROM v_default_inst_filings fil"
        " JOIN inst_filers fr ON fr.cik = fil.cik"
        " GROUP BY fil.cik, fr.name_raw"
    ):
        filers[cik] = {
            "filer_name": filer_name,
            "latest_period": latest_period,
            "position_count": 0,
            "total_value_usd": 0,
            "null_value_positions": 0,
            "unkeyed_positions": 0,
        }

    positions: dict[tuple[str, str], dict[tuple[str, str], _Position]] = defaultdict(
        lambda: defaultdict(_Position)
    )
    issuers: dict[tuple[str, str, str], dict] = {}
    conc: dict[tuple[str, str], dict] = defaultdict(
        lambda: {
            "position_count": 0,
            "total_value_usd": 0,
            "null_value_positions": 0,
            "values": defaultdict(int),
        }
    )

    for (
        cik,
        period,
        security_id,
        cusip,
        issuer_name_raw,
        value_usd,
        ssh_prnamt,
        ssh_prnamt_type,
        put_call,
        entity_id,
        entity_link_state,
        holding_id,
    ) in source_conn.execute(
        "SELECT h.cik, h.period_of_report, h.security_id, h.cusip,"
        "       h.issuer_name_raw, h.value_usd, h.ssh_prnamt, h.ssh_prnamt_type,"
        "       h.put_call, s.entity_id, s.entity_link_state, h.holding_id"
        " FROM v_default_holdings h"
        " LEFT JOIN securities s ON s.security_id = h.security_id"
        " ORDER BY h.cik, h.period_of_report, h.holding_id"
    ):
        registry = filers.setdefault(
            cik,
            {
                "filer_name": cik,
                "latest_period": period,
                "position_count": 0,
                "total_value_usd": 0,
                "null_value_positions": 0,
                "unkeyed_positions": 0,
            },
        )
        registry["position_count"] += 1
        if value_usd is not None:
            registry["total_value_usd"] += value_usd
        else:
            registry["null_value_positions"] += 1

        pk = _position_key(security_id, cusip)
        put_bucket = _put_call_bucket(put_call)
        if pk is None:
            registry["unkeyed_positions"] += 1
        else:
            # Unit is part of the GRAIN: an SH position and a PRN position of the
            # same security are different things and must never share an
            # accumulator, or shares/deltas become meaningless (QA-F2).
            positions[(cik, period)][(pk, put_bucket, _unit_key(ssh_prnamt_type))].add(
                value_usd, ssh_prnamt, ssh_prnamt_type, cusip
            )

        # Issuer aggregation retains every holding (unkeyable ones fall back to
        # the normalized name, never dropped — G3).
        issuer_key, source = _issuer_key(
            entity_id, entity_link_state, cusip, issuer_name_raw
        )
        bucket = issuers.setdefault(
            (cik, period, issuer_key),
            {
                "source": source,
                "value_usd": 0,
                "tokens": set(),
                "issuer_name": issuer_name_raw,
            },
        )
        if value_usd is not None:
            bucket["value_usd"] += value_usd
        bucket["tokens"].add(pk if pk is not None else f"row:{holding_id}")
        if issuer_name_raw < bucket["issuer_name"]:
            bucket["issuer_name"] = issuer_name_raw

        cbucket = conc[(cik, period)]
        cbucket["position_count"] += 1
        if value_usd is not None:
            cbucket["total_value_usd"] += value_usd
        else:
            cbucket["null_value_positions"] += 1
        conc_key = f"{pk}|{put_bucket}" if pk is not None else f"row:{holding_id}"
        if value_usd is not None:
            cbucket["values"][conc_key] += value_usd

    # --- rows ----------------------------------------------------------------
    registry_rows = [
        (
            cik,
            data["filer_name"],
            data["latest_period"],
            data["position_count"],
            data["total_value_usd"],
            data["null_value_positions"],
            data["unkeyed_positions"],
            ingested_at,
        )
        for cik, data in sorted(filers.items())
    ]

    final_positions: dict[tuple[str, str], dict[tuple[str, str], _FinalPosition]] = {}
    for key, group in positions.items():
        final_positions[key] = {k: _finalize(pos) for k, pos in group.items()}
    qoq_rows: list[tuple] = []
    for cik in sorted(filer_periods):
        # CONSECUTIVE periods of the filing universe — never a bridge across an
        # intervening quarter that reported no keyable positions, which would
        # fabricate continuity/additions/trims (QA-F3). A period with no keyable
        # positions compares as an EMPTY side, so its neighbours read as genuine
        # exits and new positions.
        ordered = sorted(set(filer_periods[cik]))
        for prev_period, curr_period in zip(ordered, ordered[1:]):
            prev = final_positions.get((cik, prev_period), {})
            curr = final_positions.get((cik, curr_period), {})
            if not prev and not curr:
                continue  # nothing keyable on either side — no delta to state
            matched, reconciled, unmatched = _match_periods(prev, curr)
            for (pk, put_call, unit), prev_pos, curr_pos in matched:
                qoq_rows.append(
                    _qoq_row(
                        cik=cik, curr_period=curr_period, prev_period=prev_period,
                        position_key=pk, put_call=put_call, unit=unit, prev=prev_pos,
                        curr=curr_pos, reconciled=False, ingested_at=ingested_at,
                    )
                )
            for (pk, put_call, unit), prev_pos, curr_pos in reconciled:
                qoq_rows.append(
                    _qoq_row(
                        cik=cik, curr_period=curr_period, prev_period=prev_period,
                        position_key=pk, put_call=put_call, unit=unit, prev=prev_pos,
                        curr=curr_pos, reconciled=True, ingested_at=ingested_at,
                    )
                )
            for kind, (pk, put_call, unit), pos in unmatched:
                qoq_rows.append(
                    _qoq_row(
                        cik=cik, curr_period=curr_period, prev_period=prev_period,
                        position_key=pk, put_call=put_call, unit=unit,
                        prev=None if kind == "new" else pos,
                        curr=pos if kind == "new" else None,
                        reconciled=False, ingested_at=ingested_at,
                    )
                )

    issuer_rows = _issuer_rows(issuers, filers, topn, ingested_at)
    # Every default filer-period gets a concentration row, including a
    # zero-position (notice-only / all-unkeyable) one: total 0 with NULL share
    # and NULL HHI under `concentration_unavailable`, never an omitted row and
    # never a fabricated zero (QA-F4).
    for cik, periods in filer_periods.items():
        for period in periods:
            conc[(cik, period)]  # touch the defaultdict to materialize the bucket
    concentration_rows = _concentration_rows(conc, topn, ingested_at)

    # --- write ---------------------------------------------------------------
    dest = sqlite3.connect(str(dest_path))
    try:
        dest.executescript(_load_ddl())
        dest.executemany(
            "INSERT INTO agg_filer_registry (cik, filer_name, latest_period,"
            " position_count, total_value_usd, null_value_positions,"
            " unkeyed_positions, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            registry_rows,
        )
        dest.executemany(
            "INSERT INTO agg_qoq_deltas (cik, position_key, put_call, curr_period,"
            " prev_period, change_kind, prev_value_usd, curr_value_usd,"
            " delta_value_usd, prev_shares, curr_shares, delta_shares,"
            " ssh_prnamt_type, flags, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            qoq_rows,
        )
        dest.executemany(
            "INSERT INTO agg_issuer_top_holders (issuer_key, period_of_report,"
            " rank, cik, filer_name, issuer_name, issuer_key_source, value_usd,"
            " security_count, flags, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            issuer_rows,
        )
        dest.executemany(
            "INSERT INTO agg_filer_concentration (cik, period_of_report,"
            " position_count, total_value_usd, null_value_positions,"
            " topn_value_usd, topn_share_bps, hhi, flags, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            concentration_rows,
        )
        dest.executemany(
            "INSERT INTO agg_build_meta (key, value) VALUES (?, ?)",
            sorted(
                {
                    "topn": str(topn),
                    "normalization_version": NORMALIZATION_VERSION,
                    "aggregate_version": "1",
                }.items()
            ),
        )
        dest.commit()
    finally:
        dest.close()

    return InstAggReport(
        filers=len(registry_rows),
        qoq_rows=len(qoq_rows),
        issuer_rows=len(issuer_rows),
        concentration_rows=len(concentration_rows),
        topn=topn,
    )


def _issuer_rows(
    issuers: dict[tuple[str, str, str], dict],
    filers: dict[str, dict],
    topn: int,
    ingested_at: str,
) -> list[tuple]:
    """Rank the top-N filers per (issuer, period) by summed value_usd."""
    by_issuer_period: dict[tuple[str, str], list[tuple]] = defaultdict(list)
    for (cik, period, issuer_key), data in issuers.items():
        by_issuer_period[(issuer_key, period)].append(
            (cik, period, issuer_key, data)
        )
    rows: list[tuple] = []
    for (issuer_key, period), entries in by_issuer_period.items():
        ranked = sorted(entries, key=lambda e: (-e[3]["value_usd"], e[0]))
        for rank, (cik, _period, _issuer_key, data) in enumerate(
            ranked[:topn], start=1
        ):
            flags: set[str] = set()
            if data["source"] == "cusip6":
                flags.add("issuer_from_cusip6")
            elif data["source"] == "name":
                flags.add("issuer_from_name")
            rows.append(
                (
                    issuer_key,
                    period,
                    rank,
                    cik,
                    filers.get(cik, {}).get("filer_name", cik),
                    data["issuer_name"],
                    data["source"],
                    data["value_usd"],
                    len(data["tokens"]),
                    _flags_json(flags),
                    ingested_at,
                )
            )
    return rows


def _concentration_rows(
    conc: dict[tuple[str, str], dict], topn: int, ingested_at: str
) -> list[tuple]:
    """Per-filer concentration; NULL top-N share and HHI when the total is 0."""
    rows: list[tuple] = []
    for (cik, period), data in sorted(conc.items()):
        total = data["total_value_usd"]
        # Deduped by security (aggregated per concentration position), so a
        # split-across-rows holding is one weight, not several.
        values = sorted(data["values"].values(), reverse=True)
        flags: set[str] = set()
        if total > 0:
            topn_value = sum(values[:topn])
            topn_share_bps = topn_value * 10000 // total
            hhi = sum(v * v for v in values) * 10000 // (total * total)
        else:
            topn_value = sum(values[:topn])  # 0 when every value is 0/NULL
            topn_share_bps = None
            hhi = None
            flags.add("concentration_unavailable")
        rows.append(
            (
                cik,
                period,
                data["position_count"],
                total,
                data["null_value_positions"],
                topn_value,
                topn_share_bps,
                hhi,
                _flags_json(flags),
                ingested_at,
            )
        )
    return rows
