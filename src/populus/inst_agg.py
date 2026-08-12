"""Cross-filer 13F aggregates (ARCHITECTURE.md §10.2; M2-CONTRACT §5.6 — RUN M2-3).

Pure DB→DB: read the default 13F population (``v_default_holdings`` /
``v_default_inst_filings``) joined to the §5.4 securities registry from a source
connection, and write a fresh, reproducible ``inst_agg.db`` whose four aggregate
relations carry a historically-sound identity contract. There is no network path
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

import heapq
import importlib.resources
import json
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from populus.amendments import _INST_AGG_INPUT_NAME, ensure_views
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


_BULK_BATCH_SIZE = 10_000
_BULK_PAGE_SIZE = 32_768
_BULK_CACHE_KIB = 262_144
_BASE = 1_000
_SHARE_DIGIT_ROW_LIMIT = (2**63 - 1) // _BASE
_SQUARE_COEFFICIENT_ROW_LIMIT = (2**63 - 1) // (7 * 999 * 999)
_INT64_MAX_DIGITS = (807, 775, 854, 36, 372, 223, 9)
_AGG_SIGN_PREFLIGHT_SQL = (
    f"SELECT 1 FROM temp.{_INST_AGG_INPUT_NAME}"  # nosec B608
    " WHERE value_usd < 0 OR ssh_prnamt < 0 LIMIT 1"
)

_PREPARED_SENTINEL = object()
_ACTIVE_PREPARED_CONNECTION_IDS: set[int] = set()


class _PreparedAggregate:
    """Opaque, single-use capability for one owned prepared TEMP namespace."""

    __slots__ = (
        "_active",
        "_bulk_eligible",
        "_connection",
        "_fallback_reason",
        "_used",
    )

    def __init__(
        self,
        sentinel: object,
        connection: sqlite3.Connection,
        *,
        bulk_eligible: bool,
        fallback_reason: str | None,
    ) -> None:
        if sentinel is not _PREPARED_SENTINEL:
            raise TypeError("prepared aggregate tokens are context-owned")
        self._connection = connection
        self._bulk_eligible = bulk_eligible
        self._fallback_reason = fallback_reason
        self._active = True
        self._used = False

    @property
    def bulk_eligible(self) -> bool:
        """Whether the token selected exact bulk execution."""
        return self._bulk_eligible

    @property
    def fallback_reason(self) -> str | None:
        """The explicit oracle-fallback reason, or ``None`` for bulk."""
        return self._fallback_reason

_BULK_TEMP_OBJECTS = (
    ("INDEX", "_populus_inst_agg_positions_cusip"),
    ("INDEX", "_populus_inst_agg_positions_grain"),
    ("TABLE", "_populus_inst_agg_positions"),
    ("TABLE", "_populus_inst_agg_periods"),
    ("TABLE", "_populus_inst_agg_matches"),
    ("TABLE", "_populus_inst_agg_issuer_names"),
    ("TABLE", "_populus_inst_agg_issuer_holders"),
    ("INDEX", "_populus_inst_agg_raw_periods_key"),
    ("TABLE", "_populus_inst_agg_raw_periods"),
    ("TABLE", "_populus_inst_agg_conc_positions"),
)

_MATERIALIZED_AGG_NAMESPACE = {
    ("table", "v_inst_reconciled_filings"),
    ("table", "_populus_inst_coverage_totals"),
    ("index", "_populus_inst_coverage_totals_by_filing"),
    ("table", "v_filer_reported_filings"),
    ("index", "v_filer_reported_filings_by_filing"),
    ("view", "v_filer_reported_holdings"),
    ("table", "v_default_inst_filings"),
    ("index", "v_default_inst_filings_by_filing"),
    ("view", "v_default_holdings"),
    ("table", _INST_AGG_INPUT_NAME),
}

_AGG_INPUT_COLUMNS = (
    "cik", "period_of_report", "security_id", "cusip", "issuer_name_raw",
    "value_usd", "ssh_prnamt", "ssh_prnamt_type", "put_call", "entity_id",
    "entity_link_state", "unkeyed_token", "is_default",
)


def _materialized_agg_namespace_available(conn: sqlite3.Connection) -> bool:
    rows = conn.execute(
        "SELECT type, name FROM sqlite_temp_schema"
        " WHERE name LIKE '_populus_inst_%'"
        " OR name LIKE 'v_filer_reported_%'"
        " OR name LIKE 'v_default_%'"
        " OR name = 'v_inst_reconciled_filings'"
    ).fetchall()
    if not _MATERIALIZED_AGG_NAMESPACE.issubset(set(rows)):
        return False
    columns = tuple(
        row[1]
        for row in conn.execute(
            f"PRAGMA temp.table_info({_INST_AGG_INPUT_NAME})"  # nosec B608
        ).fetchall()
    )
    return columns == _AGG_INPUT_COLUMNS


def _deadline_checkpoint(guard: Any | None) -> None:
    if guard is not None:
        guard.checkpoint()


def _register_deadline_connection(guard: Any | None, conn: sqlite3.Connection) -> None:
    if guard is not None:
        guard.register(conn)


def _unregister_deadline_connection(
    guard: Any | None, conn: sqlite3.Connection
) -> None:
    if guard is not None:
        guard.unregister(conn)


def _drop_bulk_temp_objects(conn: sqlite3.Connection) -> None:
    failed: list[tuple[str, str]] = []
    for object_type, name in _BULK_TEMP_OBJECTS:
        try:
            conn.execute(
                f"DROP {object_type} IF EXISTS temp.{name}"  # nosec B608
            )
        except sqlite3.Error:
            failed.append((object_type, name))
    first_error: sqlite3.Error | None = None
    for object_type, name in failed:
        try:
            conn.execute(
                f"DROP {object_type} IF EXISTS temp.{name}"  # nosec B608
            )
        except sqlite3.Error as exc:
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error


def _preflight_bulk_stage_collisions(conn: sqlite3.Connection) -> None:
    names = tuple(name for _kind, name in _BULK_TEMP_OBJECTS)
    placeholders = ", ".join("?" for _ in names)
    collisions = conn.execute(
        f"SELECT name FROM sqlite_temp_schema WHERE name IN ({placeholders})"
        " ORDER BY name",  # nosec B608 -- fixed placeholder count
        names,
    ).fetchall()
    if collisions:
        raise InstAggError(
            "refusing aggregate bulk staging because caller-owned TEMP object(s)"
            f" already exist: {', '.join(row[0] for row in collisions)}"
        )


def _position_stage_sql() -> str:
    digit_sums = ",\n".join(
        "  SUM(CASE WHEN ssh_prnamt IS NULL THEN 0 ELSE "
        f"(ssh_prnamt / {_BASE ** i}) % {_BASE} END) AS s{i}"
        for i in range(7)
    )
    max_check = " OR ".join(
        ["carry7 > 0", f"d6 > {_INT64_MAX_DIGITS[6]}"]
        + [
            "(" + " AND ".join(
                [f"d{higher} = {_INT64_MAX_DIGITS[higher]}" for higher in range(6, i, -1)]
                + [f"d{i} > {_INT64_MAX_DIGITS[i]}"]
            ) + ")"
            for i in range(5, -1, -1)
        ]
    )
    share_value = "d6"
    for i in range(5, -1, -1):
        share_value = f"(({share_value}) * {_BASE} + d{i})"
    return f"""
CREATE TEMP TABLE _populus_inst_agg_positions AS
WITH grouped AS (
 SELECT cik, period_of_report,
        CASE WHEN security_id IS NOT NULL THEN 'sid:' || security_id
             ELSE 'cusip:' || cusip END AS position_key,
        CASE WHEN put_call IN ('PUT','CALL') THEN put_call ELSE 'LONG' END AS put_call,
        CASE WHEN ssh_prnamt_type IN ('SH','PRN') THEN ssh_prnamt_type
             ELSE 'UNKNOWN' END AS grain_unit,
        COALESCE(SUM(value_usd), 0) AS value_usd,
        MAX(value_usd IS NOT NULL) AS has_disclosed_value,
        CASE WHEN COUNT(DISTINCT ssh_prnamt_type) = 1
                   AND SUM(ssh_prnamt_type IS NULL) = 0
             THEN MIN(ssh_prnamt_type) ELSE NULL END AS clean_unit,
        MAX(ssh_prnamt IS NULL) AS has_null_share,
        CASE WHEN COUNT(DISTINCT cusip) = 1 THEN MIN(cusip) ELSE NULL END AS single_cusip,
{digit_sums}
 FROM temp.{_INST_AGG_INPUT_NAME}
 WHERE is_default = 1 AND (security_id IS NOT NULL OR cusip IS NOT NULL)
 GROUP BY cik, period_of_report, position_key, put_call, grain_unit
), c0 AS (
 SELECT *, s0 % {_BASE} AS d0, s1 + s0 / {_BASE} AS t1 FROM grouped
), c1 AS (
 SELECT *, t1 % {_BASE} AS d1, s2 + t1 / {_BASE} AS t2 FROM c0
), c2 AS (
 SELECT *, t2 % {_BASE} AS d2, s3 + t2 / {_BASE} AS t3 FROM c1
), c3 AS (
 SELECT *, t3 % {_BASE} AS d3, s4 + t3 / {_BASE} AS t4 FROM c2
), c4 AS (
 SELECT *, t4 % {_BASE} AS d4, s5 + t4 / {_BASE} AS t5 FROM c3
), c5 AS (
 SELECT *, t5 % {_BASE} AS d5, s6 + t5 / {_BASE} AS t6 FROM c4
), normalized AS (
 SELECT *, t6 % {_BASE} AS d6, t6 / {_BASE} AS carry7 FROM c5
), checked AS (
 SELECT *, CASE WHEN {max_check} THEN 1 ELSE 0 END AS shares_overflow
 FROM normalized
)
SELECT cik, period_of_report, position_key, put_call, grain_unit,
       value_usd, has_disclosed_value, clean_unit,
       CASE WHEN clean_unit IS NULL OR has_null_share OR shares_overflow
            THEN NULL ELSE {share_value} END
         AS shares,
       single_cusip, shares_overflow
FROM checked
"""


def _production_aggregate_queries(
    conn: sqlite3.Connection,
) -> dict[str, str]:
    """Exact aggregate reads selected by the live oracle/bulk path."""
    if _materialized_agg_namespace_available(conn):
        position_select = _position_stage_sql().split(
            "CREATE TEMP TABLE _populus_inst_agg_positions AS\n", 1
        )[1]
        return {
            "agg_input_sign_preflight": _AGG_SIGN_PREFLIGHT_SQL,
            "agg_materialized_positions": position_select,
        }
    return {
        "agg_default_holdings_pass": (
            "SELECT h.cik, h.period_of_report, h.security_id, h.cusip,"
            " h.issuer_name_raw, h.value_usd, h.ssh_prnamt, h.ssh_prnamt_type,"
            " h.put_call, s.entity_id, s.entity_link_state, h.holding_id"
            " FROM v_default_holdings h"
            " LEFT JOIN securities s ON s.security_id = h.security_id"
            " ORDER BY h.cik, h.period_of_report, h.holding_id"
        ),
        "agg_filer_reported_periods": (
            "SELECT DISTINCT cik, period_of_report FROM v_filer_reported_filings"
            " ORDER BY cik, period_of_report"
        ),
    }


def _create_position_stage(
    conn: sqlite3.Connection, *, default_rows: int | None = None
) -> bool:
    if default_rows is None:
        default_rows = conn.execute(
            f"SELECT COUNT(*) FROM temp.{_INST_AGG_INPUT_NAME}"  # nosec B608
            " WHERE is_default = 1"
        ).fetchone()[0]
    if default_rows > _SHARE_DIGIT_ROW_LIMIT:
        return False
    conn.execute(_position_stage_sql())
    if conn.execute(
        "SELECT 1 FROM temp._populus_inst_agg_positions"
        " WHERE shares_overflow = 1 LIMIT 1"
    ).fetchone() is not None:
        conn.execute("DROP TABLE temp._populus_inst_agg_positions")
        return False
    conn.execute(
        "CREATE UNIQUE INDEX temp._populus_inst_agg_positions_grain"
        " ON _populus_inst_agg_positions"
        " (cik, period_of_report, position_key, put_call, grain_unit)"
    )
    conn.execute(
        "CREATE INDEX temp._populus_inst_agg_positions_cusip"
        " ON _populus_inst_agg_positions"
        " (cik, period_of_report, single_cusip, put_call)"
    )
    return True


def _create_match_stages(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TEMP TABLE _populus_inst_agg_periods AS"
        " WITH periods AS ("
        "   SELECT DISTINCT cik, period_of_report"
        "   FROM temp.v_filer_reported_filings"
        " ), paired AS ("
        "   SELECT cik, period_of_report AS curr_period,"
        "          LAG(period_of_report) OVER"
        "            (PARTITION BY cik ORDER BY period_of_report) AS prev_period"
        "   FROM periods"
        " )"
        " SELECT cik, curr_period, prev_period FROM paired"
        " WHERE prev_period IS NOT NULL"
    )
    conn.execute(
        "CREATE TEMP TABLE _populus_inst_agg_matches ("
        " cik TEXT NOT NULL, curr_period TEXT NOT NULL, prev_period TEXT NOT NULL,"
        " prev_id INTEGER NOT NULL UNIQUE, curr_id INTEGER NOT NULL UNIQUE,"
        " reconciled INTEGER NOT NULL)"
    )
    conn.execute(
        "INSERT INTO _populus_inst_agg_matches"
        " (cik,curr_period,prev_period,prev_id,curr_id,reconciled)"
        " SELECT p.cik,p.curr_period,p.prev_period,a.rowid,b.rowid,0"
        " FROM _populus_inst_agg_periods p"
        " JOIN _populus_inst_agg_positions a"
        "   ON a.cik=p.cik AND a.period_of_report=p.prev_period"
        " JOIN _populus_inst_agg_positions b"
        "   ON b.cik=p.cik AND b.period_of_report=p.curr_period"
        "  AND b.position_key=a.position_key AND b.put_call=a.put_call"
        "  AND b.grain_unit=a.grain_unit"
    )
    conn.execute(
        "WITH prev AS ("
        " SELECT p.cik,p.curr_period,p.prev_period,a.rowid AS id,"
        "        a.position_key,a.put_call,"
        "        COUNT(*) OVER (PARTITION BY p.cik,p.curr_period,"
        "          a.position_key,a.put_call) AS n"
        " FROM _populus_inst_agg_periods p"
        " JOIN _populus_inst_agg_positions a"
        "  ON a.cik=p.cik AND a.period_of_report=p.prev_period"
        " LEFT JOIN _populus_inst_agg_matches m ON m.prev_id=a.rowid"
        " WHERE m.prev_id IS NULL"
        "), curr AS ("
        " SELECT p.cik,p.curr_period,p.prev_period,b.rowid AS id,"
        "        b.position_key,b.put_call,"
        "        COUNT(*) OVER (PARTITION BY p.cik,p.curr_period,"
        "          b.position_key,b.put_call) AS n"
        " FROM _populus_inst_agg_periods p"
        " JOIN _populus_inst_agg_positions b"
        "  ON b.cik=p.cik AND b.period_of_report=p.curr_period"
        " LEFT JOIN _populus_inst_agg_matches m ON m.curr_id=b.rowid"
        " WHERE m.curr_id IS NULL"
        ")"
        " INSERT INTO _populus_inst_agg_matches"
        " (cik,curr_period,prev_period,prev_id,curr_id,reconciled)"
        " SELECT p.cik,p.curr_period,p.prev_period,p.id,c.id,0"
        " FROM prev p JOIN curr c"
        " ON c.cik=p.cik AND c.curr_period=p.curr_period"
        " AND c.position_key=p.position_key AND c.put_call=p.put_call"
        " WHERE p.n=1 AND c.n=1"
    )
    conn.execute(
        "WITH prev AS ("
        " SELECT p.cik,p.curr_period,p.prev_period,a.rowid AS id,"
        "        a.single_cusip,a.put_call,a.position_key,"
        "        COUNT(*) OVER (PARTITION BY p.cik,p.curr_period,"
        "          a.single_cusip,a.put_call) AS n"
        " FROM _populus_inst_agg_periods p"
        " JOIN _populus_inst_agg_positions a"
        "  ON a.cik=p.cik AND a.period_of_report=p.prev_period"
        " LEFT JOIN _populus_inst_agg_matches m ON m.prev_id=a.rowid"
        " WHERE m.prev_id IS NULL AND a.single_cusip IS NOT NULL"
        "), curr AS ("
        " SELECT p.cik,p.curr_period,p.prev_period,b.rowid AS id,"
        "        b.single_cusip,b.put_call,b.position_key,"
        "        COUNT(*) OVER (PARTITION BY p.cik,p.curr_period,"
        "          b.single_cusip,b.put_call) AS n"
        " FROM _populus_inst_agg_periods p"
        " JOIN _populus_inst_agg_positions b"
        "  ON b.cik=p.cik AND b.period_of_report=p.curr_period"
        " LEFT JOIN _populus_inst_agg_matches m ON m.curr_id=b.rowid"
        " WHERE m.curr_id IS NULL AND b.single_cusip IS NOT NULL"
        ")"
        " INSERT INTO _populus_inst_agg_matches"
        " (cik,curr_period,prev_period,prev_id,curr_id,reconciled)"
        " SELECT p.cik,p.curr_period,p.prev_period,p.id,c.id,1"
        " FROM prev p JOIN curr c"
        " ON c.cik=p.cik AND c.curr_period=p.curr_period"
        " AND c.single_cusip=p.single_cusip AND c.put_call=p.put_call"
        " WHERE p.n=1 AND c.n=1"
        " AND (p.position_key LIKE 'sid:%') <> (c.position_key LIKE 'sid:%')"
    )


_QOQ_SOURCE_SQL = """
WITH pairs AS (
 SELECT m.cik,m.curr_period,m.prev_period,b.position_key,b.put_call,
        b.grain_unit,m.reconciled,m.prev_id,m.curr_id
 FROM _populus_inst_agg_matches m
 JOIN _populus_inst_agg_positions b ON b.rowid=m.curr_id
 UNION ALL
 SELECT p.cik,p.curr_period,p.prev_period,b.position_key,b.put_call,
        b.grain_unit,0,NULL,b.rowid
 FROM _populus_inst_agg_periods p
 JOIN _populus_inst_agg_positions b
  ON b.cik=p.cik AND b.period_of_report=p.curr_period
 LEFT JOIN _populus_inst_agg_matches m ON m.curr_id=b.rowid
 WHERE m.curr_id IS NULL
 UNION ALL
 SELECT p.cik,p.curr_period,p.prev_period,a.position_key,a.put_call,
        a.grain_unit,0,a.rowid,NULL
 FROM _populus_inst_agg_periods p
 JOIN _populus_inst_agg_positions a
  ON a.cik=p.cik AND a.period_of_report=p.prev_period
 LEFT JOIN _populus_inst_agg_matches m ON m.prev_id=a.rowid
 WHERE m.prev_id IS NULL
), sides AS (
 SELECT q.*,
   CASE WHEN q.prev_id IS NULL THEN 0 WHEN a.has_disclosed_value=0 THEN NULL ELSE a.value_usd END AS prev_value,
   CASE WHEN q.curr_id IS NULL THEN 0 WHEN b.has_disclosed_value=0 THEN NULL ELSE b.value_usd END AS curr_value,
   a.shares AS prev_shares,b.shares AS curr_shares,
   (a.clean_unit IS NOT NULL AND b.clean_unit IS NOT NULL
    AND a.clean_unit=b.clean_unit AND a.shares IS NOT NULL AND b.shares IS NOT NULL) AS units_ok,
   ((q.prev_id IS NOT NULL AND a.has_disclosed_value=0)
    OR (q.curr_id IS NOT NULL AND b.has_disclosed_value=0)) AS value_undisclosed
 FROM pairs q
 LEFT JOIN _populus_inst_agg_positions a ON a.rowid=q.prev_id
 LEFT JOIN _populus_inst_agg_positions b ON b.rowid=q.curr_id
), deltas AS (
 SELECT *,CASE WHEN prev_value IS NULL OR curr_value IS NULL THEN NULL
               ELSE curr_value-prev_value END AS delta_value,
   CASE WHEN prev_id IS NULL THEN curr_shares
        WHEN curr_id IS NULL THEN -prev_shares
        WHEN units_ok THEN curr_shares-prev_shares ELSE NULL END AS delta_shares
 FROM sides
), classified AS (
 SELECT *,CASE WHEN prev_id IS NULL THEN 'new' WHEN curr_id IS NULL THEN 'exit'
        WHEN delta_shares IS NOT NULL AND delta_shares<>0
          THEN CASE WHEN delta_shares>0 THEN 'add' ELSE 'trim' END
        WHEN delta_value IS NOT NULL
          THEN CASE WHEN delta_value>=0 THEN 'add' ELSE 'trim' END
        ELSE 'unclassified' END AS change_kind,
   (prev_id IS NOT NULL AND curr_id IS NOT NULL AND NOT units_ok) AS shares_mismatch,
   (prev_id IS NOT NULL AND curr_id IS NOT NULL
    AND (delta_shares IS NULL OR delta_shares=0) AND delta_value IS NOT NULL) AS by_value,
   (prev_id IS NOT NULL AND curr_id IS NOT NULL
    AND (delta_shares IS NULL OR delta_shares=0) AND delta_value IS NULL) AS undeterminable
 FROM deltas
)
SELECT cik,position_key,put_call,curr_period,prev_period,change_kind,
       prev_value,curr_value,delta_value,prev_shares,curr_shares,delta_shares,
       grain_unit AS ssh_prnamt_type,
       '[' || rtrim(
         CASE WHEN undeterminable THEN '"change_kind_undeterminable",' ELSE '' END ||
         CASE WHEN by_value THEN '"classified_by_value",' ELSE '' END ||
         CASE WHEN reconciled THEN '"identity_reconciled_by_cusip",' ELSE '' END ||
         CASE WHEN shares_mismatch THEN '"shares_unit_mismatch",' ELSE '' END ||
         CASE WHEN value_undisclosed THEN '"value_undisclosed_one_side",' ELSE '' END,
         ',') || ']' AS flags, ? AS ingested_at
FROM classified
ORDER BY cik,position_key,put_call,ssh_prnamt_type,curr_period
"""


def _stream_insert(
    cursor: sqlite3.Cursor,
    dest: sqlite3.Connection,
    insert_sql: str,
    *,
    transform: Callable[[tuple], tuple] | None = None,
    guard: Any | None = None,
) -> int:
    count = 0
    while True:
        _deadline_checkpoint(guard)
        batch = cursor.fetchmany(_BULK_BATCH_SIZE)
        if not batch:
            break
        rows = [transform(row) for row in batch] if transform else batch
        _deadline_checkpoint(guard)
        dest.executemany(insert_sql, rows)
        count += len(rows)
        _deadline_checkpoint(guard)
    return count


def _build_inst_agg_python(
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
        "SELECT DISTINCT cik, period_of_report FROM v_filer_reported_filings"
        " ORDER BY cik, period_of_report"
    ):
        filer_periods[cik].append(period)

    # --- filer set (a notice-only filer still gets a registry row) -----------
    # QA-1 (RUN M2-8): seeded from v_filer_reported_filings, NOT the
    # affiliation-suppressed default set. The registry is a PER-FILER identity
    # structure and the dashboard's getStaticPaths iterates it, so seeding it from
    # the suppressed view meant a filer covered by an affiliate had correct
    # holdings and a correct concentration row but NO registry row — and therefore
    # no page at all. That left the F13 fix delivering nothing end-to-end.
    # Cross-entity issuer aggregates still read v_default_holdings below, so an
    # affiliate relationship is still counted exactly once in issuer totals.
    filers: dict[str, dict] = {}
    for cik, filer_name, latest_period in source_conn.execute(
        "SELECT fil.cik, fr.name_raw, MAX(fil.period_of_report)"
        " FROM v_filer_reported_filings fil"
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
        # QA-1: registry COUNTS are accumulated in the second pass, over
        # v_filer_reported_holdings, for the same reason as concentration — they
        # describe the filer's own reported book, not the deduplicated one.
        pk = _position_key(security_id, cusip)
        put_bucket = _put_call_bucket(put_call)
        if pk is not None:
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

        # NOTE (RUN M2-8 T6): per-filer concentration is NOT accumulated here.
        # This loop reads v_default_holdings, which suppresses a filer covered by
        # an affiliate — correct for cross-entity issuer totals, wrong for a
        # filer's own book, and the flag baseline inherits the error (external
        # review round 3, F5). Concentration is accumulated in the second pass
        # below, over v_filer_reported_holdings.

    # --- second pass: PER-FILER inputs, from the non-suppressed view ---------
    # v_filer_reported_holdings applies restatement/NEW-HOLDINGS composition and
    # cover reconciliation but NOT cross-filer affiliation suppression, so a
    # filer's concentration is measured over the book it actually reported
    # (plan R8/R14; review round 3 F5, round 4 F4). Cross-entity aggregates above
    # keep reading v_default_holdings so an issuer total counts an affiliate once.
    for (
        cik,
        period,
        security_id,
        cusip,
        value_usd,
        put_call,
        holding_id,
    ) in source_conn.execute(
        "SELECT h.cik, h.period_of_report, h.security_id, h.cusip, h.value_usd,"
        "       h.put_call, h.holding_id"
        " FROM v_filer_reported_holdings h"
        " ORDER BY h.cik, h.period_of_report, h.holding_id"
    ):
        pk = _position_key(security_id, cusip)
        put_bucket = _put_call_bucket(put_call)

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
        if pk is None:
            registry["unkeyed_positions"] += 1

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
        filer_ids, period_ids = _prepare_qoq_dictionaries(
            dest,
            ciks=(row[0] for row in qoq_rows),
            periods=(period for row in qoq_rows for period in (row[3], row[4])),
        )
        dest.executemany(
            _QOQ_INSERT,
            (
                _compact_qoq_row(
                    row, filer_ids=filer_ids, period_ids=period_ids
                )
                for row in qoq_rows
            ),
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
            " topn_value_usd, topn_share_bps, hhi, max_position_share_bps,"
            " flags, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            concentration_rows,
        )
        dest.executemany(
            "INSERT INTO agg_build_meta (key, value) VALUES (?, ?)",
            sorted(
                {
                    "topn": str(topn),
                    "normalization_version": NORMALIZATION_VERSION,
                    "aggregate_version": "2",
                    "ingested_at": ingested_at,
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
            # The LARGEST SINGLE position's share (R14) — a different statistic
            # from topn_share_bps, and the one the outsized flag compares against.
            max_position_share_bps = (values[0] * 10000 // total) if values else 0
        else:
            topn_value = sum(values[:topn])  # 0 when every value is 0/NULL
            topn_share_bps = None
            hhi = None
            max_position_share_bps = None
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
                max_position_share_bps,
                _flags_json(flags),
                ingested_at,
            )
        )
    return rows


_REGISTRY_INSERT = (
    "INSERT INTO agg_filer_registry (cik, filer_name, latest_period,"
    " position_count, total_value_usd, null_value_positions,"
    " unkeyed_positions, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
)
_QOQ_INSERT = (
    "INSERT INTO _agg_qoq_deltas (filer_id, position_key, put_call_code,"
    " curr_period_id, prev_period_id, change_kind_code, prev_value_usd,"
    " curr_value_usd, delta_value_usd, prev_shares, curr_shares, delta_shares,"
    " unit_code, flags_mask)"
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
_ISSUER_INSERT = (
    "INSERT INTO agg_issuer_top_holders (issuer_key, period_of_report, rank,"
    " cik, filer_name, issuer_name, issuer_key_source, value_usd,"
    " security_count, flags, ingested_at)"
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
_CONCENTRATION_INSERT = (
    "INSERT INTO agg_filer_concentration (cik, period_of_report,"
    " position_count, total_value_usd, null_value_positions,"
    " topn_value_usd, topn_share_bps, hhi, max_position_share_bps,"
    " flags, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)

_QOQ_PUT_CALL_CODES = {"LONG": 0, "PUT": 1, "CALL": 2}
_QOQ_CHANGE_KIND_CODES = {
    "new": 0,
    "add": 1,
    "trim": 2,
    "exit": 3,
    "unclassified": 4,
}
_QOQ_UNIT_CODES = {"SH": 0, "PRN": 1, "UNKNOWN": 2}
_QOQ_FLAG_BITS = {
    "change_kind_undeterminable": 1,
    "classified_by_value": 2,
    "identity_reconciled_by_cusip": 4,
    "shares_unit_mismatch": 8,
    "value_undisclosed_one_side": 16,
}
_QOQ_FLAG_MASKS = {
    _flags_json(
        {flag for flag, bit in _QOQ_FLAG_BITS.items() if mask & bit}
    ): mask
    for mask in range(32)
}

_QOQ_SCHEMA_SENTINELS = (
    "agg_qoq_deltas",
    "agg_build_meta",
    "_agg_qoq_filers",
    "_agg_qoq_periods",
    "_agg_qoq_deltas",
)
_QOQ_PRIVATE_TABLES = frozenset(_QOQ_SCHEMA_SENTINELS[2:])
_QOQ_PUBLIC_COLUMNS = (
    "cik",
    "position_key",
    "put_call",
    "curr_period",
    "prev_period",
    "change_kind",
    "prev_value_usd",
    "curr_value_usd",
    "delta_value_usd",
    "prev_shares",
    "curr_shares",
    "delta_shares",
    "ssh_prnamt_type",
    "flags",
    "ingested_at",
)
_QOQ_PRIVATE_SHAPES = {
    "_agg_qoq_filers": (
        ("filer_id", "INTEGER", 0, 1, 0),
        ("cik", "TEXT", 1, 0, 0),
    ),
    "_agg_qoq_periods": (
        ("period_id", "INTEGER", 0, 1, 0),
        ("period", "TEXT", 1, 0, 0),
    ),
    "_agg_qoq_deltas": (
        ("filer_id", "INTEGER", 1, 1, 0),
        ("position_key", "TEXT", 1, 2, 0),
        ("put_call_code", "INTEGER", 1, 3, 0),
        ("curr_period_id", "INTEGER", 1, 5, 0),
        ("prev_period_id", "INTEGER", 1, 0, 0),
        ("change_kind_code", "INTEGER", 1, 0, 0),
        ("prev_value_usd", "INTEGER", 0, 0, 0),
        ("curr_value_usd", "INTEGER", 0, 0, 0),
        ("delta_value_usd", "INTEGER", 0, 0, 0),
        ("prev_shares", "INTEGER", 0, 0, 0),
        ("curr_shares", "INTEGER", 0, 0, 0),
        ("delta_shares", "INTEGER", 0, 0, 0),
        ("unit_code", "INTEGER", 1, 4, 0),
        ("flags_mask", "INTEGER", 1, 0, 0),
    ),
}
_QOQ_META_SHAPE = (
    ("key", "TEXT", 0, 1, 0),
    ("value", "TEXT", 0, 0, 0),
)
_QOQ_PUT_CALL_VALUES = {code: value for value, code in _QOQ_PUT_CALL_CODES.items()}
_QOQ_CHANGE_KIND_VALUES = {
    code: value for value, code in _QOQ_CHANGE_KIND_CODES.items()
}
_QOQ_UNIT_VALUES = {code: value for value, code in _QOQ_UNIT_CODES.items()}
_QOQ_FLAG_VALUES = {mask: value for value, mask in _QOQ_FLAG_MASKS.items()}


def _quote_sqlite_identifier(value: str) -> str:
    """Quote one SQLite identifier discovered from SQLite itself."""
    return '"' + value.replace('"', '""') + '"'


def _qoq_table_shape(
    conn: sqlite3.Connection, *, schema: str, table: str
) -> tuple[tuple[str, str, int, int, int], ...]:
    quoted_schema = _quote_sqlite_identifier(schema)
    rows = conn.execute(
        f"PRAGMA {quoted_schema}.table_xinfo({_quote_sqlite_identifier(table)})"
    ).fetchall()
    return tuple(
        (str(row[1]), str(row[2]).upper(), int(row[3]), int(row[5]), int(row[6]))
        for row in rows
    )


def _qoq_unique_indexes(
    conn: sqlite3.Connection, *, schema: str, table: str
) -> set[tuple[str, ...]]:
    quoted_schema = _quote_sqlite_identifier(schema)
    indexes: set[tuple[str, ...]] = set()
    for row in conn.execute(
        f"PRAGMA {quoted_schema}.index_list({_quote_sqlite_identifier(table)})"
    ).fetchall():
        if not int(row[2]):
            continue
        index = str(row[1])
        columns = tuple(
            str(info[2])
            for info in conn.execute(
                f"PRAGMA {quoted_schema}.index_info({_quote_sqlite_identifier(index)})"
            ).fetchall()
        )
        indexes.add(columns)
    return indexes


def _validate_compact_qoq_schema(
    conn: sqlite3.Connection, *, schema: str
) -> bool:
    """Return True for exact v2 compact storage, False for genuine legacy.

    Any state other than one complete v2 schema or one physical legacy public
    table is contradictory and raises before an activity row can be emitted.
    """
    quoted_schema = _quote_sqlite_identifier(schema)
    placeholders = ",".join("?" for _ in _QOQ_SCHEMA_SENTINELS)
    object_types = {
        str(name): str(object_type)
        for name, object_type in conn.execute(
            f"SELECT name,type FROM {quoted_schema}.sqlite_master"
            f" WHERE name IN ({placeholders})",
            _QOQ_SCHEMA_SENTINELS,
        )
    }
    public_type = object_types.get("agg_qoq_deltas")
    if public_type not in {"table", "view"}:
        raise InstAggError("aggregate schema has no public agg_qoq_deltas relation")

    private_present = _QOQ_PRIVATE_TABLES.intersection(object_types)
    meta_type = object_types.get("agg_build_meta")
    version_rows: list[tuple[str]] = []
    if meta_type is not None:
        if meta_type != "table":
            raise InstAggError("aggregate build metadata is not a table")
        version_rows = conn.execute(
            f"SELECT value FROM {quoted_schema}.agg_build_meta"
            " WHERE key='aggregate_version'"
        ).fetchall()

    if not private_present:
        if public_type == "table" and version_rows != [("2",)]:
            public_columns = tuple(
                row[0]
                for row in _qoq_table_shape(
                    conn, schema=schema, table="agg_qoq_deltas"
                )
            )
            if public_columns != _QOQ_PUBLIC_COLUMNS:
                raise InstAggError(
                    "aggregate public QoQ relation has an incompatible shape"
                )
            return False
        raise InstAggError("aggregate compact metadata exists without private storage")

    if private_present != _QOQ_PRIVATE_TABLES:
        raise InstAggError("aggregate compact storage is partial")
    if public_type != "view" or meta_type != "table" or version_rows != [("2",)]:
        raise InstAggError("aggregate compact storage has contradictory version metadata")
    public_columns = tuple(
        row[0]
        for row in _qoq_table_shape(
            conn, schema=schema, table="agg_qoq_deltas"
        )
    )
    if public_columns != _QOQ_PUBLIC_COLUMNS:
        raise InstAggError("aggregate public QoQ relation has an incompatible shape")
    if _qoq_table_shape(conn, schema=schema, table="agg_build_meta") != _QOQ_META_SHAPE:
        raise InstAggError("aggregate build metadata has an incompatible shape")
    for table, expected in _QOQ_PRIVATE_SHAPES.items():
        if object_types.get(table) != "table":
            raise InstAggError(f"aggregate compact object {table} is not a table")
        if _qoq_table_shape(conn, schema=schema, table=table) != expected:
            raise InstAggError(f"aggregate compact object {table} has an incompatible shape")
    if ("cik",) not in _qoq_unique_indexes(
        conn, schema=schema, table="_agg_qoq_filers"
    ):
        raise InstAggError("aggregate compact filer dictionary is not unique")
    if ("period",) not in _qoq_unique_indexes(
        conn, schema=schema, table="_agg_qoq_periods"
    ):
        raise InstAggError("aggregate compact period dictionary is not unique")

    filer_rows = conn.execute(
        f"SELECT filer_id,cik FROM {quoted_schema}._agg_qoq_filers"
        " ORDER BY filer_id"
    ).fetchall()
    if filer_rows != [
        (index, cik)
        for index, cik in enumerate(sorted(str(row[1]) for row in filer_rows), start=1)
    ]:
        raise InstAggError("aggregate compact filer dictionary is not canonical")
    period_rows = conn.execute(
        f"SELECT period_id,period FROM {quoted_schema}._agg_qoq_periods"
        " ORDER BY period_id"
    ).fetchall()
    if period_rows != [
        (index, period)
        for index, period in enumerate(
            sorted(str(row[1]) for row in period_rows), start=1
        )
    ]:
        raise InstAggError("aggregate compact period dictionary is not canonical")

    invalid = conn.execute(
        f"SELECT CASE WHEN f.filer_id IS NULL OR cp.period_id IS NULL"
        " OR pp.period_id IS NULL THEN 'orphan' ELSE 'domain' END"
        f" FROM {quoted_schema}._agg_qoq_deltas q"
        f" LEFT JOIN {quoted_schema}._agg_qoq_filers f"
        " ON f.filer_id=q.filer_id"
        f" LEFT JOIN {quoted_schema}._agg_qoq_periods cp"
        " ON cp.period_id=q.curr_period_id"
        f" LEFT JOIN {quoted_schema}._agg_qoq_periods pp"
        " ON pp.period_id=q.prev_period_id"
        " WHERE f.filer_id IS NULL OR cp.period_id IS NULL"
        " OR pp.period_id IS NULL"
        " OR q.put_call_code NOT BETWEEN 0 AND 2"
        " OR q.change_kind_code NOT BETWEEN 0 AND 4"
        " OR q.unit_code NOT BETWEEN 0 AND 2"
        " OR q.flags_mask NOT BETWEEN 0 AND 31 LIMIT 1"
    ).fetchone()
    if invalid is not None:
        if invalid[0] == "orphan":
            raise InstAggError(
                "aggregate compact storage has an orphaned dictionary reference"
            )
        raise InstAggError("invalid compact QoQ enum or flags domain")
    return True


def _decode_compact_qoq_row(row: tuple, *, curr_period: str) -> tuple:
    try:
        return (
            row[0],
            row[1],
            _QOQ_PUT_CALL_VALUES[row[2]],
            curr_period,
            row[3],
            _QOQ_CHANGE_KIND_VALUES[row[4]],
            *row[5:11],
            _QOQ_UNIT_VALUES[row[11]],
            _QOQ_FLAG_VALUES[row[12]],
        )
    except (IndexError, KeyError, TypeError) as exc:
        raise InstAggError(f"invalid compact QoQ enum or row shape: {row!r}") from exc


def _compact_qoq_period_stream(
    conn: sqlite3.Connection,
    *,
    schema: str,
    period_id: int,
    curr_period: str,
) -> Iterator[tuple]:
    """Decode one period in public sort order with at most nine buffered rows."""
    quoted_schema = _quote_sqlite_identifier(schema)
    cursor = conn.execute(
        f"SELECT f.cik,q.position_key,q.put_call_code,pp.period,"
        " q.change_kind_code,q.prev_value_usd,q.curr_value_usd,"
        " q.delta_value_usd,q.prev_shares,q.curr_shares,q.delta_shares,"
        " q.unit_code,q.flags_mask"
        f" FROM {quoted_schema}._agg_qoq_deltas q"
        f" JOIN {quoted_schema}._agg_qoq_filers f ON f.filer_id=q.filer_id"
        f" JOIN {quoted_schema}._agg_qoq_periods pp"
        " ON pp.period_id=q.prev_period_id"
        " WHERE q.curr_period_id=?"
        " ORDER BY q.filer_id,q.position_key,q.put_call_code,q.unit_code",
        (period_id,),
    )
    buffered: list[tuple] = []
    key: tuple[str, str] | None = None
    for raw in cursor:
        decoded = _decode_compact_qoq_row(raw, curr_period=curr_period)
        next_key = (decoded[0], decoded[1])
        if key is not None and next_key != key:
            yield from sorted(buffered, key=lambda item: (item[2], item[12]))
            buffered.clear()
        key = next_key
        buffered.append(decoded)
        if len(buffered) > 9:
            raise InstAggError("compact QoQ group exceeds the schema-bounded row count")
    if buffered:
        yield from sorted(buffered, key=lambda item: (item[2], item[12]))


def compact_qoq_rows(
    conn: sqlite3.Connection, *, schema: str, periods: tuple[str, ...]
) -> Iterator[tuple] | None:
    """Return exact decoded v2 rows, or None for one genuine legacy table.

    Schema, dictionary order, and all relational references are checked before
    this function returns an iterator, so no malformed compact row can be
    silently discarded by the inner joins in the streaming queries.
    """
    if not _validate_compact_qoq_schema(conn, schema=schema):
        return None
    if not periods:
        return iter(())
    quoted_schema = _quote_sqlite_identifier(schema)
    placeholders = ",".join("?" for _ in periods)
    selected = conn.execute(
        f"SELECT period_id,period FROM {quoted_schema}._agg_qoq_periods"
        f" WHERE period IN ({placeholders}) ORDER BY period",
        periods,
    ).fetchall()
    streams = (
        _compact_qoq_period_stream(
            conn,
            schema=schema,
            period_id=int(period_id),
            curr_period=str(period),
        )
        for period_id, period in selected
    )
    return heapq.merge(
        *streams,
        key=lambda item: (item[0], item[3], item[1], item[2], item[12]),
    )


def _prepare_qoq_dictionaries(
    dest: sqlite3.Connection,
    *,
    ciks: Iterable[str],
    periods: Iterable[str],
) -> tuple[dict[str, int], dict[str, int]]:
    """Populate deterministic compact dictionaries and return their IDs."""
    filer_ids = {
        cik: filer_id
        for filer_id, cik in enumerate(sorted(set(ciks)), start=1)
    }
    period_ids = {
        period: period_id
        for period_id, period in enumerate(sorted(set(periods)), start=1)
    }
    dest.executemany(
        "INSERT INTO _agg_qoq_filers (filer_id, cik) VALUES (?, ?)",
        ((filer_id, cik) for cik, filer_id in filer_ids.items()),
    )
    dest.executemany(
        "INSERT INTO _agg_qoq_periods (period_id, period) VALUES (?, ?)",
        ((period_id, period) for period, period_id in period_ids.items()),
    )
    return filer_ids, period_ids


def _compact_qoq_row(
    row: tuple,
    *,
    filer_ids: dict[str, int],
    period_ids: dict[str, int],
) -> tuple:
    """Encode one public QoQ row into the schema-1.1 private tuple."""
    if len(row) != 15:
        raise InstAggError(f"QoQ encoder expected 15 columns, received {len(row)}")
    try:
        filer_id = filer_ids[row[0]]
        put_call_code = _QOQ_PUT_CALL_CODES[row[2]]
        curr_period_id = period_ids[row[3]]
        prev_period_id = period_ids[row[4]]
        change_kind_code = _QOQ_CHANGE_KIND_CODES[row[5]]
        unit_code = _QOQ_UNIT_CODES[row[12]]
    except (KeyError, TypeError) as exc:
        raise InstAggError(f"unknown QoQ dictionary or enum value: {exc}") from exc
    try:
        flags_mask = _QOQ_FLAG_MASKS[row[13]]
    except (KeyError, TypeError) as exc:
        raise InstAggError(f"unknown or non-canonical QoQ flags: {row[13]!r}")

    return (
        filer_id,
        row[1],
        put_call_code,
        curr_period_id,
        prev_period_id,
        change_kind_code,
        *row[6:12],
        unit_code,
        flags_mask,
    )


def _create_raw_period_stage(source: sqlite3.Connection) -> None:
    source.execute(
        f"CREATE TEMP TABLE _populus_inst_agg_raw_periods AS"
        f" SELECT cik,period_of_report,COUNT(*) AS position_count,"
        f"        COALESCE(SUM(value_usd),0) AS total_value_usd,"
        f"        SUM(value_usd IS NULL) AS null_value_positions,"
        f"        SUM(unkeyed_token IS NOT NULL) AS unkeyed_positions"
        f" FROM temp.{_INST_AGG_INPUT_NAME} GROUP BY cik,period_of_report"
    )
    source.execute(
        "CREATE UNIQUE INDEX temp._populus_inst_agg_raw_periods_key"
        " ON _populus_inst_agg_raw_periods(cik,period_of_report)"
    )


def _write_bulk_registry(
    source: sqlite3.Connection,
    dest: sqlite3.Connection,
    *,
    ingested_at: str,
    guard: Any | None,
) -> int:
    cursor = source.execute(
        f"WITH holdings AS ("
        f" SELECT cik,SUM(position_count) AS position_count,"
        f"        SUM(total_value_usd) AS total_value_usd,"
        f"        SUM(null_value_positions) AS null_value_positions,"
        f"        SUM(unkeyed_positions) AS unkeyed_positions"
        f" FROM _populus_inst_agg_raw_periods GROUP BY cik"
        f"), filers AS ("
        f" SELECT cik, MAX(period_of_report) AS latest_period"
        f" FROM temp.v_filer_reported_filings GROUP BY cik"
        f")"
        f" SELECT f.cik, COALESCE(r.name_raw,f.cik), f.latest_period,"
        f"        COALESCE(h.position_count,0),COALESCE(h.total_value_usd,0),"
        f"        COALESCE(h.null_value_positions,0),"
        f"        COALESCE(h.unkeyed_positions,0), ?"
        f" FROM filers f LEFT JOIN main.inst_filers r ON r.cik=f.cik"
        f" LEFT JOIN holdings h ON h.cik=f.cik ORDER BY f.cik",
        (ingested_at,),
    )
    return _stream_insert(cursor, dest, _REGISTRY_INSERT, guard=guard)


def _create_issuer_stages(
    source: sqlite3.Connection, *, guard: Any | None
) -> None:
    source.execute(
        "CREATE TEMP TABLE _populus_inst_agg_issuer_holders ("
        " cik TEXT NOT NULL, period_of_report TEXT NOT NULL,"
        " issuer_key TEXT NOT NULL, issuer_key_source TEXT NOT NULL,"
        " issuer_name_raw TEXT NOT NULL, value_usd INTEGER NOT NULL,"
        " security_count INTEGER NOT NULL)"
    )
    source.execute(
        f"WITH keyed AS (SELECT cik,period_of_report,"
        f"        CASE WHEN entity_id IS NOT NULL"
        f"                  AND entity_link_state='resolved'"
        f"             THEN 'entity:' || entity_id"
        f"             ELSE 'cusip6:' || substr(cusip,1,6) END AS issuer_key,"
        f"        CASE WHEN entity_id IS NOT NULL"
        f"                  AND entity_link_state='resolved'"
        f"             THEN 'entity' ELSE 'cusip6' END AS issuer_key_source,"
        f"        issuer_name_raw,value_usd,"
        f"        CASE WHEN security_id IS NOT NULL THEN 'sid:' || security_id"
        f"             WHEN cusip IS NOT NULL THEN 'cusip:' || cusip"
        f"             ELSE 'row:' || unkeyed_token END AS security_token"
        f" FROM temp.{_INST_AGG_INPUT_NAME}"
        f" WHERE is_default=1 AND ((entity_id IS NOT NULL"
        f"   AND entity_link_state='resolved') OR length(cusip)>=6))"
        f" INSERT INTO _populus_inst_agg_issuer_holders"
        f" (cik,period_of_report,issuer_key,issuer_key_source,"
        f"  issuer_name_raw,value_usd,security_count)"
        f" SELECT cik,period_of_report,issuer_key,issuer_key_source,"
        f"        MIN(issuer_name_raw),COALESCE(SUM(value_usd),0),"
        f"        COUNT(DISTINCT security_token) FROM keyed"
        f" GROUP BY cik,period_of_report,issuer_key,issuer_key_source,"
        f"          issuer_key_source"
    )
    source.execute(
        "CREATE TEMP TABLE _populus_inst_agg_issuer_names ("
        " cik TEXT NOT NULL, period_of_report TEXT NOT NULL,"
        " normalized_name TEXT NOT NULL, issuer_name_raw TEXT NOT NULL,"
        " value_usd INTEGER NOT NULL, security_token TEXT NOT NULL)"
    )
    cursor = source.execute(
        f"WITH keyed AS (SELECT cik,period_of_report,issuer_name_raw,value_usd,"
        f"       CASE WHEN security_id IS NOT NULL THEN 'sid:' || security_id"
        f"            WHEN cusip IS NOT NULL THEN 'cusip:' || cusip"
        f"            ELSE 'row:' || unkeyed_token END AS security_token"
        f" FROM temp.{_INST_AGG_INPUT_NAME}"
        f" WHERE is_default=1"
        f" AND NOT (entity_id IS NOT NULL AND entity_link_state='resolved')"
        f" AND (cusip IS NULL OR length(cusip)<6))"
        f" SELECT cik,period_of_report,issuer_name_raw,"
        f"        COALESCE(SUM(value_usd),0),security_token FROM keyed"
        f" GROUP BY cik,period_of_report,issuer_name_raw,security_token"
    )
    while True:
        _deadline_checkpoint(guard)
        batch = cursor.fetchmany(_BULK_BATCH_SIZE)
        if not batch:
            break
        normalized = [
            (row[0], row[1], _norm_issuer_name(row[2]), row[2], row[3], row[4])
            for row in batch
        ]
        source.executemany(
            "INSERT INTO _populus_inst_agg_issuer_names"
            " (cik,period_of_report,normalized_name,issuer_name_raw,"
            "  value_usd,security_token) VALUES (?,?,?,?,?,?)",
            normalized,
        )
    source.execute(
        "INSERT INTO _populus_inst_agg_issuer_holders"
        " (cik,period_of_report,issuer_key,issuer_key_source,"
        "  issuer_name_raw,value_usd,security_count)"
        " SELECT cik,period_of_report,'name:' || normalized_name,'name',"
        "        MIN(issuer_name_raw),SUM(value_usd),"
        "        COUNT(DISTINCT security_token)"
        " FROM _populus_inst_agg_issuer_names"
        " GROUP BY cik,period_of_report,normalized_name"
    )


def _write_bulk_issuers(
    source: sqlite3.Connection,
    dest: sqlite3.Connection,
    *,
    topn: int,
    ingested_at: str,
    guard: Any | None,
    stages_prepared: bool = False,
) -> int:
    if not stages_prepared:
        _create_issuer_stages(source, guard=guard)
    cursor = source.execute(
        "WITH ranked AS ("
        " SELECT *,ROW_NUMBER() OVER (PARTITION BY issuer_key,period_of_report"
        "  ORDER BY value_usd DESC,cik ASC) AS rank"
        " FROM _populus_inst_agg_issuer_holders"
        ")"
        " SELECT x.issuer_key,x.period_of_report,x.rank,x.cik,"
        "        COALESCE(f.name_raw,x.cik),x.issuer_name_raw,x.issuer_key_source,"
        "        x.value_usd,x.security_count,"
        "        CASE x.issuer_key_source"
        "          WHEN 'cusip6' THEN '[\"issuer_from_cusip6\"]'"
        "          WHEN 'name' THEN '[\"issuer_from_name\"]'"
        "          ELSE '[]' END,?"
        " FROM ranked x LEFT JOIN main.inst_filers f ON f.cik=x.cik"
        " WHERE x.rank<=?"
        " ORDER BY x.issuer_key,x.period_of_report,x.rank",
        (ingested_at, topn),
    )
    return _stream_insert(cursor, dest, _ISSUER_INSERT, guard=guard)


def _square_coefficient_sql() -> str:
    digits = [f"((value_usd / {_BASE ** i}) % {_BASE})" for i in range(7)]
    columns = []
    for coefficient in range(13):
        terms = [
            f"({digits[i]} * {digits[coefficient - i]})"
            for i in range(7)
            if 0 <= coefficient - i < 7
        ]
        columns.append(
            f"SUM({' + '.join(terms)}) AS square_c{coefficient}"
        )
    return ",".join(columns)


def _create_concentration_stage(source: sqlite3.Connection) -> None:
    source.execute(
        f"CREATE TEMP TABLE _populus_inst_agg_conc_positions AS"
        f" SELECT cik,period_of_report,"
        f"        CASE WHEN security_id IS NOT NULL"
        f"             THEN 'sid:' || security_id || '|' ||"
        f"                  CASE WHEN put_call IN ('PUT','CALL')"
        f"                       THEN put_call ELSE 'LONG' END"
        f"             WHEN cusip IS NOT NULL"
        f"             THEN 'cusip:' || cusip || '|' ||"
        f"                  CASE WHEN put_call IN ('PUT','CALL')"
        f"                       THEN put_call ELSE 'LONG' END"
        f"             ELSE 'row:' || unkeyed_token END AS concentration_key,"
        f"        SUM(value_usd) AS value_usd"
        f" FROM temp.{_INST_AGG_INPUT_NAME}"
        f" WHERE value_usd IS NOT NULL"
        f" GROUP BY cik,period_of_report,concentration_key"
    )
    count = source.execute(
        "SELECT COUNT(*) FROM _populus_inst_agg_conc_positions"
    ).fetchone()[0]
    if count > _SQUARE_COEFFICIENT_ROW_LIMIT:
        raise InstAggError(
            "concentration position population exceeds exact coefficient bound"
        )


def _validate_prepared_token(
    token: _PreparedAggregate, source: sqlite3.Connection
) -> None:
    if not isinstance(token, _PreparedAggregate):
        raise InstAggError("invalid prepared aggregate token")
    if token._connection is not source:
        raise InstAggError("prepared aggregate token belongs to another connection")
    if not token._active or id(source) not in _ACTIVE_PREPARED_CONNECTION_IDS:
        raise InstAggError("prepared aggregate token is no longer active")
    if token._used:
        raise InstAggError("prepared aggregate token has already been consumed")
    token._used = True


@contextmanager
def prepared_materialized_inst_aggregate(
    source: sqlite3.Connection,
    *,
    _execution_guard: Any | None = None,
) -> Iterator[_PreparedAggregate]:
    """Prepare and own the reusable heavy aggregate TEMP stages.

    The caller enters this only after the base materialized namespace is
    complete.  The yielded capability is connection-bound and single-use; this
    context owns all aggregate TEMP objects and restores both SQLite suggestions
    after aggregate and serving consumers have finished.
    """
    if not _materialized_agg_namespace_available(source):
        raise InstAggError(
            "prepared aggregate requires the complete materialized namespace"
        )
    connection_id = id(source)
    if connection_id in _ACTIVE_PREPARED_CONNECTION_IDS:
        raise InstAggError("prepared aggregate context is not re-entrant")
    _preflight_bulk_stage_collisions(source)

    previous_threads = int(source.execute("PRAGMA threads").fetchone()[0])
    previous_temp_cache = int(
        source.execute("PRAGMA temp.cache_size").fetchone()[0]
    )
    _ACTIVE_PREPARED_CONNECTION_IDS.add(connection_id)
    token: _PreparedAggregate | None = None
    primary_error: BaseException | None = None
    cleanup_errors: list[BaseException] = []
    try:
        source.execute("PRAGMA threads=8")
        if int(source.execute("PRAGMA threads").fetchone()[0]) != 8:
            raise InstAggError("aggregate source worker configuration failed")
        source.execute(f"PRAGMA temp.cache_size=-{_BULK_CACHE_KIB}")
        if (
            int(source.execute("PRAGMA temp.cache_size").fetchone()[0])
            != -_BULK_CACHE_KIB
        ):
            raise InstAggError("aggregate source cache configuration failed")
        _deadline_checkpoint(_execution_guard)

        fallback_reason: str | None = None
        if source.execute(_AGG_SIGN_PREFLIGHT_SQL).fetchone() is not None:
            fallback_reason = "signed_input"
        else:
            total_rows, default_rows = source.execute(
                f"SELECT COUNT(*), COALESCE(SUM(is_default = 1), 0)"  # nosec B608
                f" FROM temp.{_INST_AGG_INPUT_NAME}"
            ).fetchone()
            if (
                total_rows > _SQUARE_COEFFICIENT_ROW_LIMIT
                or default_rows > _SHARE_DIGIT_ROW_LIMIT
            ):
                fallback_reason = "population_guard"
            elif not _create_position_stage(
                source, default_rows=int(default_rows)
            ):
                fallback_reason = "share_overflow"
            else:
                _deadline_checkpoint(_execution_guard)
                _create_issuer_stages(source, guard=_execution_guard)
                _deadline_checkpoint(_execution_guard)

        token = _PreparedAggregate(
            _PREPARED_SENTINEL,
            source,
            bulk_eligible=fallback_reason is None,
            fallback_reason=fallback_reason,
        )
        yield token
    except BaseException as exc:
        primary_error = exc
    finally:
        if token is not None:
            token._active = False

        def _restore_temp_cache() -> None:
            source.execute(f"PRAGMA temp.cache_size={previous_temp_cache}")
            if int(source.execute("PRAGMA temp.cache_size").fetchone()[0]) != previous_temp_cache:
                raise InstAggError("aggregate source cache restoration failed")

        def _restore_threads() -> None:
            source.execute(f"PRAGMA threads={previous_threads}")
            if int(source.execute("PRAGMA threads").fetchone()[0]) != previous_threads:
                raise InstAggError("aggregate source worker restoration failed")

        for cleanup in (
            lambda: _drop_bulk_temp_objects(source),
            _restore_temp_cache,
            _restore_threads,
        ):
            try:
                cleanup()
            except BaseException:
                try:
                    cleanup()
                except BaseException as exc:
                    cleanup_errors.append(exc)
        _ACTIVE_PREPARED_CONNECTION_IDS.discard(connection_id)

    if primary_error is not None:
        for error in cleanup_errors:
            primary_error.add_note(
                f"prepared aggregate cleanup also failed:"
                f" {type(error).__name__}: {error}"
            )
        raise primary_error
    if cleanup_errors:
        first, *later = cleanup_errors
        for error in later:
            first.add_note(
                f"later prepared aggregate cleanup failed:"
                f" {type(error).__name__}: {error}"
            )
        raise first


def _concentration_from_bulk_row(row: tuple, ingested_at: str) -> tuple:
    total = row[3]
    topn_value = row[5]
    max_value = row[6]
    square_sum = sum(int(row[7 + i]) * (_BASE ** i) for i in range(13))
    if total > 0:
        topn_share = topn_value * 10_000 // total
        hhi = square_sum * 10_000 // (total * total)
        max_share = max_value * 10_000 // total if max_value is not None else 0
        flags = "[]"
    else:
        topn_share = None
        hhi = None
        max_share = None
        flags = '["concentration_unavailable"]'
    return (
        row[0], row[1], row[2], total, row[4], topn_value,
        topn_share, hhi, max_share, flags, ingested_at,
    )


def _write_bulk_concentration(
    source: sqlite3.Connection,
    dest: sqlite3.Connection,
    *,
    topn: int,
    ingested_at: str,
    guard: Any | None,
) -> int:
    _create_concentration_stage(source)
    _deadline_checkpoint(guard)
    coefficients = _square_coefficient_sql()
    cursor = source.execute(
        f"WITH periods AS ("
        f" SELECT DISTINCT cik,period_of_report"
        f" FROM temp.v_filer_reported_filings"
        f"), ranked AS ("
        f" SELECT *,ROW_NUMBER() OVER (PARTITION BY cik,period_of_report"
        f"  ORDER BY value_usd DESC) AS rn"
        f" FROM _populus_inst_agg_conc_positions"
        f"), position_stats AS ("
        f" SELECT cik,period_of_report,"
        f"        SUM(CASE WHEN rn<=? THEN value_usd ELSE 0 END) AS topn_value,"
        f"        MAX(value_usd) AS max_value,{coefficients}"
        f" FROM ranked GROUP BY cik,period_of_report"
        f")"
        f" SELECT p.cik,p.period_of_report,COALESCE(r.position_count,0),"
        f"        COALESCE(r.total_value_usd,0),"
        f"        COALESCE(r.null_value_positions,0),"
        f"        COALESCE(x.topn_value,0),x.max_value,"
        + ",".join(f"COALESCE(x.square_c{i},0)" for i in range(13))
        + " FROM periods p LEFT JOIN _populus_inst_agg_raw_periods r"
        " ON r.cik=p.cik AND r.period_of_report=p.period_of_report"
        " LEFT JOIN position_stats x"
        " ON x.cik=p.cik AND x.period_of_report=p.period_of_report"
        " ORDER BY p.cik,p.period_of_report",
        (topn,),
    )
    return _stream_insert(
        cursor,
        dest,
        _CONCENTRATION_INSERT,
        transform=lambda row: _concentration_from_bulk_row(row, ingested_at),
        guard=guard,
    )


def _build_inst_agg_bulk(
    source_conn: sqlite3.Connection,
    dest_path: Path,
    *,
    ingested_at: str,
    topn: int,
    guard: Any | None,
    prepared: _PreparedAggregate | None,
) -> InstAggReport:
    if prepared is None:
        with prepared_materialized_inst_aggregate(
            source_conn, _execution_guard=guard
        ) as owned:
            return _build_inst_agg_bulk(
                source_conn,
                dest_path,
                ingested_at=ingested_at,
                topn=topn,
                guard=guard,
                prepared=owned,
            )
    _validate_prepared_token(prepared, source_conn)
    if not prepared.bulk_eligible:
        return _build_inst_agg_python(
            source_conn, dest_path, ingested_at=ingested_at, topn=topn
        )
    return _build_inst_agg_bulk_eligible(
        source_conn,
        dest_path,
        ingested_at=ingested_at,
        topn=topn,
        guard=guard,
    )


def _build_inst_agg_bulk_eligible(
    source_conn: sqlite3.Connection,
    dest_path: Path,
    *,
    ingested_at: str,
    topn: int,
    guard: Any | None,
) -> InstAggReport:

    dest: sqlite3.Connection | None = None
    primary_error: BaseException | None = None
    try:
        if dest_path.exists():
            dest_path.unlink()
        dest = sqlite3.connect(str(dest_path))
        _register_deadline_connection(guard, dest)
        dest.execute(f"PRAGMA page_size={_BULK_PAGE_SIZE}")
        dest.execute(f"PRAGMA cache_size=-{_BULK_CACHE_KIB}")
        if dest.execute("PRAGMA page_size").fetchone()[0] != _BULK_PAGE_SIZE:
            raise InstAggError("aggregate destination page-size configuration failed")
        if dest.execute("PRAGMA cache_size").fetchone()[0] != -_BULK_CACHE_KIB:
            raise InstAggError("aggregate destination cache configuration failed")
        dest.executescript(_load_ddl())
        _create_match_stages(source_conn)
        _create_raw_period_stage(source_conn)
        filers = _write_bulk_registry(
            source_conn, dest, ingested_at=ingested_at, guard=guard
        )
        filer_ids, period_ids = _prepare_qoq_dictionaries(
            dest,
            ciks=(
                row[0]
                for row in source_conn.execute(
                    "SELECT DISTINCT cik FROM _populus_inst_agg_periods"
                    " ORDER BY cik"
                )
            ),
            periods=(
                row[0]
                for row in source_conn.execute(
                    "SELECT curr_period FROM _populus_inst_agg_periods"
                    " UNION SELECT prev_period FROM _populus_inst_agg_periods"
                    " ORDER BY 1"
                )
            ),
        )
        qoq = _stream_insert(
            source_conn.execute(_QOQ_SOURCE_SQL, (ingested_at,)),
            dest,
            _QOQ_INSERT,
            transform=lambda row: _compact_qoq_row(
                row, filer_ids=filer_ids, period_ids=period_ids
            ),
            guard=guard,
        )
        issuers = _write_bulk_issuers(
            source_conn,
            dest,
            topn=topn,
            ingested_at=ingested_at,
            guard=guard,
            stages_prepared=True,
        )
        concentration = _write_bulk_concentration(
            source_conn,
            dest,
            topn=topn,
            ingested_at=ingested_at,
            guard=guard,
        )
        dest.executemany(
            "INSERT INTO agg_build_meta (key, value) VALUES (?, ?)",
            sorted(
                {
                    "topn": str(topn),
                    "normalization_version": NORMALIZATION_VERSION,
                    "aggregate_version": "2",
                    "ingested_at": ingested_at,
                }.items()
            ),
        )
        _deadline_checkpoint(guard)
        dest.commit()
        _deadline_checkpoint(guard)
        return InstAggReport(filers, qoq, issuers, concentration, topn)
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        if dest is not None:
            try:
                _unregister_deadline_connection(guard, dest)
            finally:
                dest.close()
        if primary_error is not None and dest_path.exists():
            dest_path.unlink()


def build_inst_agg(
    source_conn: sqlite3.Connection,
    dest_path: Path | str,
    *,
    ingested_at: str,
    topn: int = DEFAULT_TOPN,
    _execution_guard: Any | None = None,
    _prepared: _PreparedAggregate | None = None,
) -> InstAggReport:
    """Build the aggregate, using bounded SQL only in the owned materializer."""
    dest = Path(dest_path)
    refuse_if_dest_aliases_source(source_conn, dest)
    if _prepared is not None:
        if not _materialized_agg_namespace_available(source_conn):
            raise InstAggError(
                "prepared aggregate token requires the materialized namespace"
            )
        return _build_inst_agg_bulk(
            source_conn,
            dest,
            ingested_at=ingested_at,
            topn=topn,
            guard=_execution_guard,
            prepared=_prepared,
        )
    ensure_views(source_conn)
    if _materialized_agg_namespace_available(source_conn):
        return _build_inst_agg_bulk(
            source_conn,
            dest,
            ingested_at=ingested_at,
            topn=topn,
            guard=_execution_guard,
            prepared=_prepared,
        )
    return _build_inst_agg_python(
        source_conn, dest, ingested_at=ingested_at, topn=topn
    )
