#!/usr/bin/env python
"""RUN M2-11 T6 (plan R11) — the T0 measurement ladder, strictly read-only.

Ordered rungs, each printed before the next is attempted, so an aborted run
still leaves every number it reached on the record:

  (i)   view gate            — verify_views against the snapshot (R3)
  (ii)  cardinality projection — corpus counts + worst_case_file_count (R27)
  (iii) resource snapshot    — free RAM and free disk, measured not assumed
  (iv)  EXPLAIN QUERY PLAN   — the coverage and aggregation queries
  (v)   pilot derivation     — bounded to one period or <=500 filers, with
                               peak-RSS sampling (resource.getrusage)
  (vi)  full run (--full)    — aborts below 8 GiB free RAM / 30 GiB free disk;
                               per-phase wall clock
  plus  LD-10 tail payload   — the REAL FilerPayloadV1 per tail filer (the
                               R22 literal field set), serialized exactly as
                               the shard planner serializes it, bucketed by
                               the production byte rule into shards, with the
                               derived shard count checked against the
                               inst_budget file headroom; any payload over the
                               1 MiB ceiling or a shard count over the
                               headroom is a STOP (nonzero exit — R11/LD-10)

Every derived database is written to a disposable temp directory; the snapshot
itself is opened ``mode=ro`` everywhere. Refuses to run without an explicit
``--snapshot``.
"""

from __future__ import annotations

import argparse
import functools
import json
import re
import math
import resource
import shutil
import sqlite3
import subprocess  # nosec B404 — sysctl/vm_stat probes, argv lists only
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from populus.amendments import (  # noqa: E402
    ViewVerificationError,
    ensure_views,
    materialized_inst_derivation_views,
    verify_views,
)
from populus.ingest.inst13f import (  # noqa: E402
    _production_coverage_queries,
    compute_coverage,
    compute_period_coverage,
)
from populus.inst_agg import (  # noqa: E402
    _PreparedAggregate,
    _production_aggregate_queries,
    build_inst_agg,
    prepared_materialized_inst_aggregate,
)
from populus.inst_budget import (  # noqa: E402
    FILER_FRAGMENT_PARTS_MAX,
    FILER_FRAGMENT_SIZING_SENTINEL,
    FILER_FRAGMENT_TARGET_BYTES,
    FILER_ROUTING_INDEX_FILES,
    FILER_SHARD_BYTE_CEILING,
    FILER_TAIL_SHARDS_RESERVED,
    FILER_V1_TRANSITION_FILES,
    GLOBAL_FILE_CAP,
    M2_FILER_PAGES,
    worst_case_file_count,
)
from populus.inst_serving import (  # noqa: E402
    build_serving_projection,
    publication_periods,
)
from populus.load import ensure_inst_schema  # noqa: E402
from populus.publish.digests import sha256_file  # noqa: E402

GIB = 1 << 30
MIB = 1 << 20
#: LD-10: the client-response ceiling a tail shard must never exceed — read
#: from inst_budget so this measurement and the enforcing gate share one term.
CLIENT_RESPONSE_CEILING_BYTES = FILER_SHARD_BYTE_CEILING
#: The R22 pre-rendered cut; filers ranked below it form the shard tail.
#: Bound to the budget contract (`inst_budget.M2_FILER_PAGES` = the LD-7 1,500).
TOP_FILER_CUT = M2_FILER_PAGES
#: The file-headroom bound the derived shard count must fit inside: the tail
#: family's reservation in `inst_budget` (its terms in the R27 projection).
TAIL_SHARD_LIMIT = FILER_TAIL_SHARDS_RESERVED
SQLITE_PHASE_TIMEOUT_SECONDS = 180
SQLITE_PROGRESS_OPCODES = 10_000
R12_AGGREGATE_LIMIT_BYTES = 3 * (1 << 29)  # exactly 1.5 * 2^30

#: PARITY with the dashboard embed cap (`dashboard/src/lib/holdings.ts::
#: HOLDINGS_EMBED_ROW_CAP` / `HOLDINGS_EMBED_BYTE_CAP`), used verbatim by the
#: production assembler's `capRows`.
HOLDINGS_EMBED_ROW_CAP = 20_000
HOLDINGS_EMBED_BYTE_CAP = 2 * MIB

#: The FilingWindow half of the payload is computed by the site build from its
#: own generated-at date (`dashboard/src/lib/derive.ts::filingWindow`) — a value
#: this offline measurement cannot know. Its SHAPE is fixed
#: (`{open, quarterEnd, deadline}`) but its BYTES ARE NOT: `false` serializes one
#: byte wider than `true` (measured: 64 vs 63 bytes), so a "representative"
#: open window silently under-measures every closed-window payload and can
#: certify a payload sitting on the 1 MiB boundary (delta review F2).
#:
#: The measurement therefore takes the WIDEST valid serialization — the
#: conservative direction: a payload that fits under this fits under either real
#: window state. `--build-date` supplies the real date when the caller knows it,
#: and then the real window is computed instead of the bound.
WIDEST_FILING_WINDOW = {
    "open": False,          # one byte wider than True — the conservative choice
    "quarterEnd": "2026-06-30",
    "deadline": "2026-08-14",
}


def filing_window_for(build_date: str | None) -> dict:
    """Mirror of `derive.ts::filingWindow` when the build date is known.

    45 days after quarter end is the 13F deadline; `open` is true while the
    build date sits inside that window. With no build date the caller gets the
    WIDEST serialization instead of a guess."""
    if build_date is None:
        return dict(WIDEST_FILING_WINDOW)
    from datetime import date, timedelta

    # Mirrors `dashboard/src/lib/derive.ts::filingWindow` exactly, including its
    # candidate-list form (string compare on ISO dates, latest candidate <= d).
    d = build_date[:10]
    y = int(d[:4])
    quarter_end = f"{y - 1}-12-31"
    for candidate in (f"{y - 1}-12-31", f"{y}-03-31", f"{y}-06-30",
                      f"{y}-09-30", f"{y}-12-31"):
        if candidate <= d:
            quarter_end = candidate
    deadline = (date.fromisoformat(quarter_end) + timedelta(days=45)).isoformat()
    return {"open": d <= deadline, "quarterEnd": quarter_end, "deadline": deadline}
#: Full-run abort thresholds (R11): stop rather than thrash the machine.
MIN_FREE_RAM_BYTES = 8 * GIB
MIN_FREE_DISK_BYTES = 30 * GIB
PILOT_FILER_LIMIT = 500

#: The serving-projection read is static; aggregate reads are selected from the
#: live production oracle/bulk path by ``_production_aggregate_queries``.
AGGREGATION_QUERIES = {
    "serving_filer_registry": (
        "SELECT fil.cik, fr.name_raw, MAX(fil.period_of_report)"
        " FROM v_filer_reported_filings fil"
        " JOIN inst_filers fr ON fr.cik = fil.cik"
        " GROUP BY fil.cik, fr.name_raw"
    ),
}

class _SQLitePhaseTimeout(RuntimeError):
    def __init__(self, phase: str) -> None:
        super().__init__(phase)
        self.phase = phase


class _SQLiteExecutionGuard:
    """One monotonic deadline shared by every SQLite handle in a T0 phase."""

    def __init__(self, phase: str) -> None:
        self.phase = phase
        self.deadline = time.monotonic() + SQLITE_PHASE_TIMEOUT_SECONDS
        self.interrupted = False
        self._connections: dict[int, sqlite3.Connection] = {}
        self._lock = threading.Lock()
        self._timer = threading.Timer(
            max(0.0, self.deadline - time.monotonic()), self._expire
        )
        self._timer.daemon = True
        self._timer.start()

    def _expired(self) -> bool:
        return self.interrupted or time.monotonic() >= self.deadline

    def _progress(self) -> int:
        if self._expired():
            self.interrupted = True
            return 1
        return 0

    def _expire(self) -> None:
        with self._lock:
            self.interrupted = True
            connections = tuple(self._connections.values())
        for connection in connections:
            try:
                connection.interrupt()
            except sqlite3.Error:
                pass

    def register(self, conn: sqlite3.Connection) -> None:
        with self._lock:
            self._connections[id(conn)] = conn
        conn.set_progress_handler(self._progress, SQLITE_PROGRESS_OPCODES)
        if self._expired():
            conn.interrupt()

    def unregister(self, conn: sqlite3.Connection) -> None:
        with self._lock:
            self._connections.pop(id(conn), None)
        conn.set_progress_handler(None, 0)

    def checkpoint(self) -> None:
        if self._expired():
            self._expire()
            raise _SQLitePhaseTimeout(self.phase)

    def close(self) -> None:
        self._timer.cancel()
        was_interrupted = self.interrupted
        with self._lock:
            connections = tuple(self._connections.values())
            self._connections.clear()
        for connection in connections:
            try:
                connection.set_progress_handler(None, 0)
            except sqlite3.Error:
                pass
            if was_interrupted:
                # ``sqlite3_interrupt`` may have landed between statements and
                # mark the next VM operation. Consume that pending interrupt on
                # a harmless read so enclosing TEMP-owner cleanup is not masked.
                for _attempt in range(2):
                    try:
                        connection.execute("SELECT 1").fetchone()
                        break
                    except sqlite3.OperationalError:
                        continue


@contextmanager
def _sqlite_execution_bound(
    conn: sqlite3.Connection, phase: str
) -> Iterator[_SQLiteExecutionGuard]:
    """Bound all registered SQLite work for one phase; always clear handlers."""
    guard = _SQLiteExecutionGuard(phase)
    guard.register(conn)
    try:
        yield guard
        guard.checkpoint()
    except sqlite3.OperationalError as exc:
        if (
            guard.interrupted
            or getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_INTERRUPT
            or "interrupted" in str(exc).lower()
        ):
            raise _SQLitePhaseTimeout(phase) from exc
        raise
    finally:
        guard.close()


def _snapshot_state(snapshot: Path) -> dict:
    """Complete D1 identity, main-schema, and sidecar state for *snapshot*."""
    conn = sqlite3.connect(
        f"file:{snapshot}?mode=ro&immutable=1",
        uri=True,
        isolation_level=None,
    )
    try:
        schema_rows = conn.execute(
            "SELECT type, name, tbl_name, COALESCE(sql, '')"
            " FROM main.sqlite_schema ORDER BY type, name, tbl_name, sql"
        ).fetchall()
    finally:
        conn.close()
    return {
        "sha256": sha256_file(snapshot),
        "main_sqlite_schema": [list(row) for row in schema_rows],
        "sidecars": {
            suffix: Path(f"{snapshot}{suffix}").exists()
            for suffix in ("-journal", "-wal", "-shm")
        },
    }


def _snapshot_state_has_sidecar(state: dict) -> bool:
    return any(state["sidecars"].values())


def _ro_connect(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(
        f"file:{path}?mode=ro&immutable=1", uri=True, isolation_level=None
    )


@contextmanager
def _owned_derivation_connection(
    db_path: Path, *, label: str
) -> Iterator[sqlite3.Connection]:
    """Own one pilot/full source connection and its complete finalizer.

    The aggregate destination is attached only for the serving phase.  On a
    failure the retained materializer unwinds before this owner, then this
    finalizer rolls back, detaches that derived database, and closes without
    replacing the primary error with cleanup noise.
    """
    conn = (
        _ro_connect(db_path)
        if label == "full"
        else sqlite3.connect(str(db_path), isolation_level=None)
    )
    try:
        yield conn
    finally:
        primary_error_active = sys.exc_info()[0] is not None
        cleanup_error: sqlite3.Error | None = None
        if conn.in_transaction:
            rollback_error: sqlite3.OperationalError | None = None
            for _attempt in range(2):
                try:
                    conn.execute("ROLLBACK")
                    rollback_error = None
                    break
                except sqlite3.OperationalError as exc:
                    rollback_error = exc
                    if "interrupted" not in str(exc).lower():
                        break
            cleanup_error = rollback_error
        try:
            attached = any(
                row[1] == "inst_agg" for row in conn.execute("PRAGMA database_list")
            )
            if attached:
                conn.execute("DETACH DATABASE inst_agg")
        except sqlite3.Error as exc:
            if cleanup_error is None:
                cleanup_error = exc
        try:
            conn.close()
        except sqlite3.Error as exc:
            if cleanup_error is None:
                cleanup_error = exc
        if cleanup_error is not None and not primary_error_active:
            raise cleanup_error


def _peak_rss_bytes() -> int:
    """Peak RSS of this process. ru_maxrss is bytes on macOS, KiB on Linux."""
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024


def free_ram_bytes() -> int | None:
    """Free (usable) RAM, measured — None when the platform offers no probe."""
    if sys.platform == "darwin":
        try:
            page_size = int(
                subprocess.run(  # nosec B603 B607 — fixed argv
                    ["sysctl", "-n", "hw.pagesize"], capture_output=True, text=True
                ).stdout.strip()
            )
            vm_stat = subprocess.run(  # nosec B603 B607 — fixed argv
                ["vm_stat"], capture_output=True, text=True
            ).stdout
            pages = 0
            for line in vm_stat.splitlines():
                for label in ("Pages free:", "Pages inactive:"):
                    if line.startswith(label):
                        pages += int(line.split(":")[1].strip().rstrip("."))
            return pages * page_size
        except (OSError, ValueError, IndexError):
            return None
    try:
        return os_sysconf_free()
    except (OSError, ValueError):
        return None


def os_sysconf_free() -> int:
    import os

    return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")


def cardinality(conn: sqlite3.Connection) -> dict:
    counts = {}
    for name, sql in (
        ("filers", "SELECT COUNT(*) FROM inst_filers"),
        ("filings", "SELECT COUNT(*) FROM inst_filings"),
        ("holdings", "SELECT COUNT(*) FROM inst_holdings"),
        (
            "periods",
            "SELECT COUNT(DISTINCT period_of_report) FROM inst_filings",
        ),
        (
            "reported_filers",
            "SELECT COUNT(DISTINCT cik) FROM v_filer_reported_filings",
        ),
    ):
        counts[name] = conn.execute(sql).fetchone()[0]
    return counts


def explain_plans(conn: sqlite3.Connection) -> dict[str, list[str]]:
    plans: dict[str, list[str]] = {}
    queries = dict(AGGREGATION_QUERIES)
    queries.update(_production_aggregate_queries(conn))
    queries.update(_production_coverage_queries(conn))
    for name, sql in queries.items():
        plans[name] = [
            row[-1]
            for row in conn.execute(f"EXPLAIN QUERY PLAN {sql}")  # nosec B608
        ]
    return plans


def build_pilot_subset(
    snapshot: Path, pilot_db: Path, *, filer_limit: int = PILOT_FILER_LIMIT
) -> int:
    """A bounded copy: the first *filer_limit* filers (ascending CIK) plus
    their filings/holdings and the full securities/entities registries.

    The snapshot is ATTACHed read-only; the pilot database is the only thing
    written. Returns the number of filers copied.
    """
    conn = sqlite3.connect(str(pilot_db), isolation_level=None, uri=True)
    try:
        ensure_inst_schema(conn)
        conn.execute(
            "ATTACH DATABASE ? AS src",
            (f"file:{snapshot}?mode=ro&immutable=1",),
        )
        for table in ("entities", "securities", "security_list_intervals"):
            exists_in_src = conn.execute(
                "SELECT 1 FROM src.sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if exists_in_src is None:
                continue
            exists_here = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if exists_here is None:
                (ddl,) = conn.execute(
                    "SELECT sql FROM src.sqlite_master WHERE type='table'"
                    " AND name=?",
                    (table,),
                ).fetchone()
                conn.execute(ddl)
            conn.execute(  # nosec B608 — table names from the fixed tuple above
                f"INSERT INTO {table} SELECT * FROM src.{table}"
            )
        conn.execute(
            "INSERT INTO inst_filers SELECT * FROM src.inst_filers"
            " WHERE cik IN (SELECT cik FROM src.inst_filers ORDER BY cik LIMIT ?)",
            (filer_limit,),
        )
        conn.execute(
            "INSERT INTO inst_filings SELECT * FROM src.inst_filings"
            " WHERE cik IN (SELECT cik FROM inst_filers)"
        )
        conn.execute(
            "INSERT INTO inst_holdings SELECT * FROM src.inst_holdings"
            " WHERE filing_id IN (SELECT filing_id FROM inst_filings)"
        )
        conn.execute("DETACH DATABASE src")
        ensure_views(conn)
        return conn.execute("SELECT COUNT(*) FROM inst_filers").fetchone()[0]
    finally:
        conn.close()


def _derive_from_materialized(
    conn: sqlite3.Connection,
    scratch: Path,
    *,
    label: str,
    window: dict | None,
    materialization_s: float,
    prepared: _PreparedAggregate | None = None,
) -> dict:
    """Run post-materialization phases with transaction/attachment containment."""
    try:
        return _derive_from_materialized_inner(
            conn,
            scratch,
            label=label,
            window=window,
            materialization_s=materialization_s,
            prepared=prepared,
        )
    except BaseException as primary_error:
        cleanup_errors: list[BaseException] = []
        if conn.in_transaction:
            try:
                conn.execute("ROLLBACK")
            except BaseException as exc:
                cleanup_errors.append(exc)
        attached = False
        if not conn.in_transaction:
            try:
                attached = any(
                    row[1] == "inst_agg"
                    for row in conn.execute("PRAGMA database_list")
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        if attached:
            try:
                conn.execute("DETACH DATABASE inst_agg")
            except BaseException:
                try:
                    conn.execute("DETACH DATABASE inst_agg")
                except BaseException as exc:
                    cleanup_errors.append(exc)
        for error in cleanup_errors:
            primary_error.add_note(
                f"T0 derive cleanup also failed: {type(error).__name__}: {error}"
            )
        raise


def _derive_from_materialized_inner(
    conn: sqlite3.Connection,
    scratch: Path,
    *,
    label: str,
    window: dict | None,
    materialization_s: float,
    prepared: _PreparedAggregate | None,
) -> dict:
    """Run the exact post-materialization phases in an active source transaction."""
    if not conn.in_transaction:
        raise RuntimeError(
            "refusing derivation outside an active materialized source transaction"
        )
    if set(_production_aggregate_queries(conn)) != {
        "agg_input_sign_preflight",
        "agg_materialized_positions",
    }:
        raise RuntimeError(
            "refusing derivation without the complete owned materialized namespace"
        )
    if prepared is None:
        raise RuntimeError(
            "refusing derivation without the active prepared aggregate namespace"
        )

    record: dict = {"label": label}
    record["materialization_s"] = round(materialization_s, 3)
    record["prepared_bulk_eligible"] = prepared.bulk_eligible
    record["prepared_fallback_reason"] = prepared.fallback_reason
    agg_path = scratch / f"{label}-inst_agg.db"
    t0 = time.monotonic()
    with _sqlite_execution_bound(conn, "coverage"):
        coverage = compute_coverage(conn)
    record["coverage_s"] = round(time.monotonic() - t0, 3)
    record["coverage"] = coverage.coverage
    record["meets_threshold"] = coverage.meets_threshold

    t0 = time.monotonic()
    with _sqlite_execution_bound(conn, "period coverage"):
        period_coverage = compute_period_coverage(conn)
    record["period_coverage_s"] = round(time.monotonic() - t0, 3)
    record["period_coverage_rows"] = len(period_coverage)

    t0 = time.monotonic()
    with _sqlite_execution_bound(conn, "aggregate") as aggregate_guard:
        build_inst_agg(
            conn,
            agg_path,
            ingested_at="2026-01-01T00:00:00Z",
            _execution_guard=aggregate_guard,
            _prepared=prepared,
        )
    record["aggregate_s"] = round(time.monotonic() - t0, 3)
    record["aggregate_bytes"] = agg_path.stat().st_size

    t0 = time.monotonic()
    with _sqlite_execution_bound(conn, "serving"):
        periods = publication_periods(conn)
        conn.execute("ATTACH DATABASE ? AS inst_agg", (str(agg_path),))
        projection = build_serving_projection(conn, periods=periods)
        latest_filed = conn.execute(
            "SELECT MAX(filed_date) FROM v_default_inst_filings"
        ).fetchone()[0]
    record["serving_projection_s"] = round(time.monotonic() - t0, 3)
    record["filer_rows"] = len(projection.filer_rows)
    conn.execute("COMMIT")
    conn.execute("DETACH DATABASE inst_agg")
    record["peak_rss_bytes"] = _peak_rss_bytes()
    record["tail_payloads"] = tail_payload_distribution(
        projection,
        agg_path=agg_path,
        latest_filed=latest_filed,
        window=window,
    )
    return record


def derive_once(
    db_path: Path, scratch: Path, *, label: str, window: dict | None = None
) -> dict:
    """One full derivation (coverage -> aggregate -> serving projection) with
    per-phase wall clock and peak RSS; every write lands under *scratch*."""
    with _owned_derivation_connection(db_path, label=label) as conn:
        conn.execute("BEGIN")
        with ExitStack() as stack:
            t0 = time.monotonic()
            with _sqlite_execution_bound(conn, "materialization") as guard:
                stack.enter_context(materialized_inst_derivation_views(conn))
                prepared = stack.enter_context(
                    prepared_materialized_inst_aggregate(
                        conn, _execution_guard=guard
                    )
                )
            materialization_s = time.monotonic() - t0
            return _derive_from_materialized(
                conn,
                scratch,
                label=label,
                window=window,
                materialization_s=materialization_s,
                prepared=prepared,
            )


#: Lone surrogates, which JS `JSON.stringify` escapes as `\udXXX` and Python's
#: `json.dumps(ensure_ascii=False)` emits raw — after which `.encode("utf-8")`
#: raises instead of producing bytes (Codex F5).
_LONE_SURROGATE_RE = re.compile("[\ud800-\udfff]")


def _dumps(obj) -> str:
    """Serialize exactly as the shard planner does: `JSON.stringify` emits no
    whitespace and leaves non-ASCII unescaped.

    PARITY (Codex F5): the one place the two serializers disagreed was a LONE
    surrogate. JS emits `\ud800` — six ASCII characters — while Python emits the
    raw code point and then cannot encode it at all, so the reference
    implementation raised `UnicodeEncodeError` where the production runtime
    produced 14 well-formed bytes. Escaping here keeps the SERIALIZED BYTES
    identical, not merely their length, which is what the byte-parity fixture
    actually compares. Unreachable from SQLite TEXT (always well-formed UTF-8),
    so this is a robustness floor rather than a live data path."""
    out = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    if _LONE_SURROGATE_RE.search(out):
        out = _LONE_SURROGATE_RE.sub(lambda m: f"\\u{ord(m.group(0)):04x}", out)
    return out


def _byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


def select_top_filers(rows: list[dict], budget: int | None = None) -> list[str]:
    """LD-7 selection, REIMPLEMENTED for parity with the exported TS rule.

    PARITY SOURCE: ``dashboard/src/lib/holdings.ts::selectTopFilers`` —
    descending latest-period reported total value, NULL values sorting after
    every number (an unknown total is not a small one), ties broken by
    ASCENDING CIK, cut at the budget. The Python and TS implementations are
    pinned against each other by the shared interchange fixture
    ``tests/fixtures/filer_selection_parity.v1.json``: both must produce the
    identical ordered CIK list from the same input rows.

    *rows*: ``[{"cik": str, "latestPeriodValueUsd": number | None}, ...]`` —
    the value is the LATEST-period concentration row's ``total_value_usd``
    (``dashboard/src/lib/data.ts::instTopFilerCiks``), never the registry's
    cumulative all-period total.
    """
    if budget is None:
        budget = TOP_FILER_CUT
    ordered = sorted(
        rows,
        key=lambda r: (
            r["latestPeriodValueUsd"] is None,        # nulls after every number
            -(r["latestPeriodValueUsd"] or 0),        # descending value
            r["cik"],                                 # ties: ascending CIK
        ),
    )
    return [r["cik"] for r in ordered[:budget]]


def _flags_list(raw) -> list[str]:
    """The aggregate stores flags as text; the payload contract carries a
    string list. Accept the JSON-array form and the comma-joined form."""
    if raw is None or raw == "":
        return []
    if isinstance(raw, str) and raw.startswith("["):
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, list):
                return [str(x) for x in loaded]
        except ValueError:
            pass
    return [part for part in str(raw).split(",") if part]


def _load_aggregate_inputs(agg_path: Path) -> dict:
    """The aggregate half of every FilerPayloadV1, read from the just-built
    ``inst_agg.db``: registry (cik → name, latest period), per-period
    concentration rows (`ConcentrationRow` shape), per-period QoQ deltas
    (`QoqDeltaRow` shape), and topn — exactly the fields
    ``dashboard/src/lib/data.ts::filerAggregateInputs`` feeds the assembler."""
    conn = _ro_connect(agg_path)
    try:
        topn = int(
            conn.execute(
                "SELECT value FROM agg_build_meta WHERE key = 'topn'"
            ).fetchone()[0]
        )
        registry: dict[str, dict] = {}
        for cik, name, latest_period in conn.execute(
            "SELECT cik, filer_name, latest_period FROM agg_filer_registry"
        ):
            registry[cik] = {"filer_name": name, "latest_period": latest_period}
        conc_by_filer: dict[str, dict[str, dict]] = {}
        for (
            cik, period, position_count, total_value_usd, null_value_positions,
            topn_value_usd, topn_share_bps, hhi, flags,
        ) in conn.execute(
            "SELECT cik, period_of_report, position_count, total_value_usd,"
            " null_value_positions, topn_value_usd, topn_share_bps, hhi, flags"
            " FROM agg_filer_concentration"
        ):
            conc_by_filer.setdefault(cik, {})[period] = {
                # `ConcentrationRow` (dashboard/src/lib/inst.ts), field-for-field.
                "cik": cik,
                "period_of_report": period,
                "position_count": position_count,
                "total_value_usd": total_value_usd,
                "null_value_positions": null_value_positions,
                "topn_value_usd": topn_value_usd,
                "topn_share_bps": topn_share_bps,
                "hhi": hhi,
                "flags": _flags_list(flags),
            }
        deltas_by_filer: dict[str, dict[str, list[dict]]] = {}
        for (
            cik, position_key, put_call, curr_period, prev_period, change_kind,
            prev_value_usd, curr_value_usd, delta_value_usd,
            prev_shares, curr_shares, delta_shares, ssh_prnamt_type, flags,
        ) in conn.execute(
            "SELECT cik, position_key, put_call, curr_period, prev_period,"
            " change_kind, prev_value_usd, curr_value_usd, delta_value_usd,"
            " prev_shares, curr_shares, delta_shares, ssh_prnamt_type, flags"
            " FROM agg_qoq_deltas"
        ):
            deltas_by_filer.setdefault(cik, {}).setdefault(curr_period, []).append(
                {
                    # `QoqDeltaRow` (dashboard/src/lib/inst.ts), field-for-field.
                    "cik": cik,
                    "position_key": position_key,
                    "put_call": put_call,
                    "curr_period": curr_period,
                    "prev_period": prev_period,
                    "change_kind": change_kind,
                    "prev_value_usd": prev_value_usd,
                    "curr_value_usd": curr_value_usd,
                    "delta_value_usd": delta_value_usd,
                    "prev_shares": prev_shares,
                    "curr_shares": curr_shares,
                    "delta_shares": delta_shares,
                    "ssh_prnamt_type": ssh_prnamt_type,
                    "flags": _flags_list(flags),
                }
            )
        return {
            "topn": topn,
            "registry": registry,
            "conc_by_filer": conc_by_filer,
            "deltas_by_filer": deltas_by_filer,
        }
    finally:
        conn.close()


"""F2 PARITY BLOCK — the production row normalization, field for field.

The production assembler (``dashboard/src/lib/filer-payload.ts::
assembleFilerPayload``) never copies a serving row unchanged: every row runs
through ``holdings.ts::parseFilerShard``, which normalizes each field
(``str`` / ``strOrNull`` / ``format.ts::intOrNull`` / ``flagsOf``) — most
visibly turning the artifact's raw flag TEXT (a JSON-array string) into a
string list. The T0 measurement must serialize EXACTLY what the shard planner
will serialize, so each helper below mirrors its named TS source one-for-one
and is pinned by the shared byte-parity fixture
``tests/fixtures/filer_payload_parity.v1.json`` (both runtimes must reproduce
the same canonical bytes)."""

#: PARITY: ``holdings.ts::CHANGE_FIELDS`` — the grain ban parseFilerShard
#: enforces before normalizing.
_CHANGE_FIELDS = (
    "change_kind",
    "delta_value_usd",
    "delta_shares",
    "prev_value_usd",
    "curr_value_usd",
)


def _js_str(v) -> str:
    """PARITY: ``holdings.ts::str`` — ``String(v ?? "")``."""
    if v is None:
        return ""
    if isinstance(v, bool):  # JS String(true) === "true"
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():  # JS String(4.0) === "4"
        return str(int(v))
    return str(v)


def _js_str_or_null(v):
    """PARITY: ``holdings.ts::strOrNull`` — ``v == null ? null : String(v)``."""
    return None if v is None else _js_str(v)


def _js_int_or_null(v):
    """PARITY: ``format.ts::intOrNull`` — null/blank-string -> None, else
    ``Number(v)`` when finite. Integral results stay ``int`` so ``_dumps``
    matches ``JSON.stringify`` (which prints ``900``, never ``900.0``)."""
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n):
        return None
    return int(n) if n.is_integer() else n


def _js_flags(v) -> list[str]:
    """PARITY: ``holdings.ts::flagsOf`` — a real array maps to strings; a
    non-empty string is parsed as a JSON array (else ``[]``); anything else is
    ``[]``."""
    if isinstance(v, list):
        return [_js_str(x) for x in v]
    if isinstance(v, str) and v:
        try:
            parsed = json.loads(v)
        except ValueError:
            return []
        return [_js_str(x) for x in parsed] if isinstance(parsed, list) else []
    return []


def _normalize_filer_row(r: dict) -> dict:
    """PARITY: ``holdings.ts::parseFilerShard`` row mapping, field for field
    and in the SAME key order (key order is serialization order for both
    ``JSON.stringify`` and ``_dumps``)."""
    for field in _CHANGE_FIELDS:
        if field in r:
            raise ValueError(
                f'filer row carries the change field "{field}" — holding and'
                " change records keep separate grains (parseFilerShard parity)"
            )

    def _coalesce(*names):
        # PARITY with JS `??`: only null/absent falls through, "" does not.
        for name in names:
            if name in r and r[name] is not None:
                return r[name]
        return None

    return {
        "cik": _js_str(r.get("cik")),
        "period": _js_str(_coalesce("period", "period_of_report")),
        "filing_key": _js_str_or_null(r.get("filing_key")),
        "security_id": _js_str_or_null(r.get("security_id")),
        "cusip": _js_str_or_null(r.get("cusip")),
        "issuer_name": _js_str(r.get("issuer_name")),
        "title_of_class": _js_str_or_null(r.get("title_of_class")),
        "value_usd": _js_int_or_null(r.get("value_usd")),
        "shares": _js_int_or_null(_coalesce("shares", "ssh_prnamt")),
        "ssh_type": _js_str_or_null(_coalesce("ssh_type", "ssh_prnamt_type")),
        "put_call": _js_str_or_null(r.get("put_call")),
        "position_key": _js_str_or_null(r.get("position_key")),
        "put_call_bucket": _js_str_or_null(r.get("put_call_bucket")),
        "unit_key": _js_str_or_null(r.get("unit_key")),
        "flags": _js_flags(r.get("flags")),
    }


def _position_identity(r: dict) -> str:
    """PARITY: ``holdings.ts::positionIdentity`` called WITHOUT a rowIndex —
    exactly how ``compareHoldingRows`` calls it — over ``grainOf`` (producer
    tokens preferred, derived only when the shard predates them)."""
    bucket = r.get("put_call_bucket")
    if bucket is None:
        put_call = r.get("put_call")
        bucket = put_call if put_call in ("PUT", "CALL") else "LONG"
    unit = r.get("unit_key")
    if unit is None:
        ssh_type = r.get("ssh_type")
        unit = ssh_type if ssh_type in ("SH", "PRN") else "UNKNOWN"
    grain = f"{bucket}|{unit}"
    if r.get("position_key") is None:
        period = r["period"] if r.get("period") is not None else "?"
        return f"unkeyable:{period}:?|{grain}"
    return f"{r['position_key']}|{grain}"


def _compare_holding_rows(a: dict, b: dict) -> int:
    """PARITY: ``holdings.ts::compareHoldingRows`` — disclosed value
    descending, NULL values LAST, then issuer name, then position identity;
    equal identities TIE so the stable sort preserves the artifact's own
    ``ORDER BY period, rowid`` order (the TS comparator defers to `Array#sort`
    ES2019 stability the same way)."""
    if a["value_usd"] is None and b["value_usd"] is not None:
        return 1
    if b["value_usd"] is None and a["value_usd"] is not None:
        return -1
    if (
        a["value_usd"] is not None
        and b["value_usd"] is not None
        and a["value_usd"] != b["value_usd"]
    ):
        return -1 if a["value_usd"] > b["value_usd"] else 1
    if a["issuer_name"] != b["issuer_name"]:
        return -1 if a["issuer_name"] < b["issuer_name"] else 1
    ia = _position_identity(a)
    ib = _position_identity(b)
    if ia == ib:
        return 0
    return -1 if ia < ib else 1


def _sort_holding_rows(rows: list[dict]) -> list[dict]:
    """PARITY: ``dashboard/src/lib/holdings.ts::sortHoldingRows`` — the ONE
    comparator, mirrored above, under a stable sort."""
    return sorted(rows, key=functools.cmp_to_key(_compare_holding_rows))


def _js_key_order(keys) -> list[str]:
    """PARITY: ECMA-262 OrdinaryOwnPropertyKeys — array-index keys ascending
    first, remaining string keys in insertion order."""

    def _is_index(k: str) -> bool:
        return (
            k.isdigit()
            and (k == "0" or not k.startswith("0"))
            and int(k) < 2**32 - 1
        )

    indexed = sorted((k for k in keys if _is_index(k)), key=int)
    rest = [k for k in keys if not _is_index(k)]
    return indexed + rest


def _utf8_len(text: str) -> int:
    """PARITY: ``dashboard/src/lib/holdings.ts::utf8ByteLength`` — UTF-8 BYTES.

    Codex F5: both runtimes previously measured UTF-16 code units, so they
    agreed with each other while disagreeing with the byte ceiling they
    claimed to enforce. They now measure the unit the cap is declared in."""
    return len(text.encode("utf-8"))


def _cap_rows(rows: list[dict]) -> tuple[list[dict], int]:
    """PARITY: ``dashboard/src/lib/holdings.ts::capRows`` — cap by row count
    AND serialized SIZE, whichever binds first; `total` is the PRE-cap true
    row count. The TS fill measures ``utf8ByteLength(JSON.stringify(row))``,
    starts at 2 for `[]`, and each later element adds one separator —
    mirrored exactly, including the unit (UTF-8 bytes, Codex F5)."""
    limit = min(HOLDINGS_EMBED_ROW_CAP, len(rows))
    out: list[dict] = []
    size = 2
    for i in range(limit):
        encoded = _dumps(rows[i])
        nxt = size + _utf8_len(encoded) + (1 if out else 0)
        if nxt > HOLDINGS_EMBED_BYTE_CAP and out:
            break
        out.append(rows[i])
        size = nxt
    return out, len(rows)


def _compare_qoq_deltas(a: dict, b: dict) -> int:
    """PARITY: ``dashboard/src/lib/holdings.ts::compareQoqDeltas``.

    Exported (module-level, not a closure) for the same reason the TS mirror is:
    reflexivity cannot be observed from a sorted list, because a stable sort
    keeps the input order whether the tie-break returns 0 or 1. Codex proved that
    hole by passing the first regression test against the very defect it claimed
    to pin, so the property is asserted on the comparator itself in
    tests/test_qoq_parity.py."""
    av = a.get("curr_value_usd")
    av = a.get("prev_value_usd") if av is None else av
    av = -1 if av is None else av
    bv = b.get("curr_value_usd")
    bv = b.get("prev_value_usd") if bv is None else bv
    bv = -1 if bv is None else bv
    if bv != av:
        return -1 if bv < av else 1
    # Codex F2: this returned 1 for EQUAL keys, so the comparator was not
    # reflexive and therefore not a total order — and it diverged from the
    # corrected TS mirror on exact ties.
    if a["position_key"] == b["position_key"]:
        return 0
    return -1 if a["position_key"] < b["position_key"] else 1


def _sort_qoq_deltas(deltas: list[dict]) -> list[dict]:
    """PARITY: ``dashboard/src/lib/holdings.ts::sortQoqDeltas`` — largest
    current value first, falling back to the previous value for an exited
    position, ties by ``position_key`` so the order is total."""
    return sorted(deltas, key=functools.cmp_to_key(_compare_qoq_deltas))


def _bound_qoq_deltas(deltas: list[dict]) -> tuple[list[dict], int]:
    """PARITY: ``dashboard/src/lib/holdings.ts::boundQoqDeltas`` (RUN M2-12) —
    order first, then cap through the SAME ``_cap_rows`` fill the holdings
    embed uses. Unbounded, this list put a 29.1 MiB page against a 25 MiB
    provider limit."""
    return _cap_rows(_sort_qoq_deltas(deltas))


def build_filer_payload(
    cik: str,
    *,
    filer_name: str,
    latest_period: str,
    rows: list[dict],
    filings_by_key: dict[str, dict],
    agg: dict,
    latest_filed: str | None,
    window: dict | None,
) -> dict:
    """One FULL FilerPayloadV1 (the plan's R22 literal interface), assembled
    the way ``dashboard/src/lib/filer-payload.ts::assembleFilerPayload``
    assembles it: raw rows normalized through the ``parseFilerShard`` parity
    block above (F2 — the production assembler NEVER serializes raw artifact
    rows), OD-5 current+prior rows only, display-ordered, embed-capped,
    pre-cap true totals beside them, referenced-only filing entries, and the
    aggregate half from ``data.ts::filerAggregateInputs``. ``window`` is a
    required input because null is a VALID window state, not a default."""
    rows = [_normalize_filer_row(r) for r in rows]
    periods = sorted({r["period"] for r in rows})
    if not periods:
        current = latest_period
    elif latest_period in periods:
        current = latest_period
    else:
        current = periods[-1]
    earlier = [p for p in periods if p < current]
    prior = earlier[-1] if earlier else None
    rows_by_period: dict[str, list[dict]] = {}
    totals_by_period: dict[str, int] = {}
    if periods:
        for period in ([prior, current] if prior else [current]):
            capped, total = _cap_rows(
                _sort_holding_rows([r for r in rows if r["period"] == period])
            )
            rows_by_period[period] = capped
            totals_by_period[period] = total
    filings: dict[str, dict] = {}
    for row_list in rows_by_period.values():
        for row in row_list:
            key = row["filing_key"]
            if key is not None and key in filings_by_key:
                filings[key] = filings_by_key[key]
    # PARITY: JS object property order — array-index-like keys (canonical
    # numeric strings < 2^32-1) enumerate NUMERICALLY ASCENDING regardless of
    # insertion order, then the rest in insertion order. `JSON.stringify`
    # serializes in that order, and filing keys are numeric strings.
    filings = {k: filings[k] for k in _js_key_order(filings)}
    filer_periods = sorted(agg["conc_by_filer"].get(cik, {}))
    bounded_deltas = {
        p: _bound_qoq_deltas(agg["deltas_by_filer"].get(cik, {}).get(p, []))
        for p in filer_periods
    }
    return {
        "v": 1,
        "kind": "filer",
        "cik": cik,
        "filerName": filer_name,
        "latestPeriod": latest_period,
        "periods": periods,
        "current": current,
        "prior": prior,
        "filings": filings,
        "rowsByPeriod": rows_by_period,
        "totalsByPeriod": totals_by_period,
        "concByPeriod": {
            p: agg["conc_by_filer"].get(cik, {}).get(p) for p in filer_periods
        },
        "deltasByPeriod": {p: bounded_deltas[p][0] for p in filer_periods},
        "deltaTotalsByPeriod": {p: bounded_deltas[p][1] for p in filer_periods},
        "latestFiled": latest_filed,
        "topn": agg["topn"],
        "window": window,
    }


def _fragment_value(
    *, cik: str, part: int, parts: int, section: str,
    period: str | None, start: int, data,
) -> dict:
    return {
        "v": 2,
        "kind": "filer-fragment",
        "cik": cik,
        "part": part,
        "parts": parts,
        "section": section,
        "period": period,
        "start": start,
        "data": data,
    }


def _fragment_entry_json(fragment: dict) -> str:
    key = f"{fragment['cik']}:{fragment['part']}"
    return f"{_dumps(key)}:{_dumps(fragment)}"


def _chunk_fragment_records(
    cik: str, section: str, period: str | None, records: list,
) -> list[tuple]:
    """Linear parity with TypeScript ``chunkFragmentRecords``.

    The five-digit sentinel is deliberately conservative and is part of the
    reviewed cut contract, not an allowed actual part count.
    """
    chunks: list[tuple] = []
    current: list = []
    start = 0

    def empty_bytes(at: int) -> int:
        return _byte_len(_fragment_entry_json(_fragment_value(
            cik=cik,
            part=FILER_FRAGMENT_SIZING_SENTINEL,
            parts=FILER_FRAGMENT_SIZING_SENTINEL,
            section=section,
            period=period,
            start=at,
            data=[],
        )))

    current_bytes = empty_bytes(start)
    for record in records:
        record_bytes = _byte_len(_dumps(record))
        cost = record_bytes + (1 if current else 0)
        if current and current_bytes + cost > FILER_FRAGMENT_TARGET_BYTES:
            chunks.append((section, period, start, current))
            start += len(current)
            current = []
            current_bytes = empty_bytes(start)
        current.append(record)
        current_bytes += record_bytes + (1 if len(current) > 1 else 0)
    if current:
        chunks.append((section, period, start, current))
    return chunks


def fragment_filer_payload(payload: dict) -> list[dict]:
    """Record-boundary v2 transport for one unchanged FilerPayloadV1."""
    cik = payload["cik"]
    meta = {
        "v": payload["v"],
        "kind": payload["kind"],
        "cik": cik,
        "filerName": payload["filerName"],
        "latestPeriod": payload["latestPeriod"],
        "periods": payload["periods"],
        "current": payload["current"],
        "prior": payload["prior"],
        "filingKeys": list(payload["filings"]),
        "rowPeriods": list(payload["rowsByPeriod"]),
        "deltaPeriods": list(payload["deltasByPeriod"]),
        "totalsByPeriod": payload["totalsByPeriod"],
        "concByPeriod": payload["concByPeriod"],
        "deltaTotalsByPeriod": payload["deltaTotalsByPeriod"],
        "latestFiled": payload["latestFiled"],
        "topn": payload["topn"],
        "window": payload["window"],
    }
    descriptors: list[tuple] = [("meta", None, 0, meta)]
    descriptors.extend(_chunk_fragment_records(
        cik, "filings", None, list(payload["filings"].items())
    ))
    for period, rows in payload["rowsByPeriod"].items():
        descriptors.extend(_chunk_fragment_records(cik, "rows", period, rows))
    for period, rows in payload["deltasByPeriod"].items():
        descriptors.extend(_chunk_fragment_records(cik, "deltas", period, rows))
    parts = len(descriptors)
    return [
        _fragment_value(
            cik=cik,
            part=part,
            parts=parts,
            section=section,
            period=period,
            start=start,
            data=data,
        )
        for part, (section, period, start, data) in enumerate(descriptors)
    ]


def reassemble_filer_fragments(fragments: list[dict]) -> dict:
    """Strict-enough T0 mirror of the browser reassembler; never sorts/repairs."""
    if not fragments:
        raise ValueError("fragment sequence is empty")
    parts = fragments[0]["parts"]
    if len(fragments) != parts:
        raise ValueError("fragment sequence length contradicts total")
    cik = fragments[0]["cik"]
    for index, fragment in enumerate(fragments):
        if fragment["part"] != index:
            raise ValueError("fragment sequence is reordered or incomplete")
        if fragment["parts"] != parts or fragment["cik"] != cik:
            raise ValueError("fragment total or CIK contradicts sequence")
    first = fragments[0]
    if (first["section"], first["period"], first["start"]) != ("meta", None, 0):
        raise ValueError("part zero is not metadata")
    meta = first["data"]
    filings: dict = {}
    rows = {period: [] for period in meta["rowPeriods"]}
    deltas = {period: [] for period in meta["deltaPeriods"]}
    group_order = {("filings", None): 1}
    group_order.update({("rows", p): 2 + i for i, p in enumerate(meta["rowPeriods"])})
    group_order.update({
        ("deltas", p): 2 + len(meta["rowPeriods"]) + i
        for i, p in enumerate(meta["deltaPeriods"])
    })
    prior_group = 0
    for fragment in fragments[1:]:
        group = group_order.get((fragment["section"], fragment["period"]), -1)
        if group < 1 or group < prior_group or not fragment["data"]:
            raise ValueError("fragment section order is invalid")
        prior_group = group
        if fragment["section"] == "filings":
            if fragment["start"] != len(filings):
                raise ValueError("filing start is not contiguous")
            for key, value in fragment["data"]:
                if key in filings:
                    raise ValueError("duplicate filing key")
                filings[key] = value
        else:
            target = rows if fragment["section"] == "rows" else deltas
            period = fragment["period"]
            if period not in target or fragment["start"] != len(target[period]):
                raise ValueError("fragment period/start is not contiguous")
            target[period].extend(fragment["data"])
    if list(filings) != meta["filingKeys"]:
        raise ValueError("filing key sequence disagrees with metadata")
    return {
        "v": meta["v"],
        "kind": meta["kind"],
        "cik": meta["cik"],
        "filerName": meta["filerName"],
        "latestPeriod": meta["latestPeriod"],
        "periods": meta["periods"],
        "current": meta["current"],
        "prior": meta["prior"],
        "filings": filings,
        "rowsByPeriod": rows,
        "totalsByPeriod": meta["totalsByPeriod"],
        "concByPeriod": meta["concByPeriod"],
        "deltasByPeriod": deltas,
        "deltaTotalsByPeriod": meta["deltaTotalsByPeriod"],
        "latestFiled": meta["latestFiled"],
        "topn": meta["topn"],
        "window": meta["window"],
    }


def _shard_envelope_overhead(shard_limit: int) -> int:
    """Worst v2 fragment-shard envelope, mirrored by the dashboard."""
    worst = max(shard_limit, 1)
    return _byte_len(
        f'{{"v":2,"kind":"filer-fragment-shard","shard":{worst - 1},'
        f'"shard_count":{worst},"entries":{{}}}}'
    )


def fill_tail_shards(
    entries: list[dict], *, ceiling: int, shard_limit: int
) -> dict:
    """Greedy fail/no-truncate parity over ordered fragment entries."""
    overhead = _shard_envelope_overhead(shard_limit)
    oversized: list[str] = []
    shards: list[list[dict]] = []
    current: list[dict] = []
    current_bytes = overhead
    for entry in entries:
        cost = _byte_len(entry["json"]) + (1 if current else 0)
        if overhead + _byte_len(entry["json"]) > ceiling:
            oversized.append(entry["key"])
            continue
        if current and current_bytes + cost > ceiling:
            shards.append(current)
            current = []
            current_bytes = overhead
            cost = _byte_len(entry["json"])
        current.append(entry)
        current_bytes += cost
    if current:
        shards.append(current)
    shard_count = len(shards)
    shard_sizes = [
        _byte_len(
            f'{{"v":2,"kind":"filer-fragment-shard","shard":{index},'
            f'"shard_count":{shard_count},"entries":{{'
            + ",".join(entry["json"] for entry in shard)
            + "}}"
        )
        for index, shard in enumerate(shards)
    ]
    routes: dict[str, list[int]] = {}
    seen_parts: dict[str, list[int]] = {}
    for index, shard in enumerate(shards):
        for entry in shard:
            route = routes.setdefault(
                entry["cik"], [index, index, entry["parts"]]
            )
            if route[2] != entry["parts"]:
                raise ValueError("fragment total drifted inside the family")
            route[1] = index
            seen_parts.setdefault(entry["cik"], []).append(entry["part"])
    index_body = _dumps({
        "v": 2,
        "kind": "filer-index",
        "absent": None,
        "routes": routes,
    })
    return {
        "shard_count": shard_count,
        "shard_bytes": shard_sizes,
        "oversized_fragments": oversized,
        "overflow": shard_count > shard_limit,
        "routes": routes,
        "seen_parts": seen_parts,
        "index_bytes": _byte_len(index_body),
    }


def _percentile(sizes: list[int], q: float) -> int:
    if not sizes:
        return 0
    return sizes[min(len(sizes) - 1, int(q * len(sizes)))]


def tail_payload_distribution(
    projection, *, agg_path: Path, latest_filed: str | None,
    window: dict | None = None,
) -> dict:
    """Measure logical payloads, v2 fragments, reassembly, routes, and shards."""
    window = dict(WIDEST_FILING_WINDOW) if window is None else window
    agg = _load_aggregate_inputs(agg_path)
    by_filer: dict[str, list[dict]] = {}
    for row in projection.filer_rows:
        # F2: raw projection rows — build_filer_payload runs them through the
        # parseFilerShard parity normalization, exactly as the production
        # assembler does. No ad-hoc per-field fixups here.
        by_filer.setdefault(row["cik"], []).append(dict(row))
    # The published-filer universe and the LD-7 inputs come from the aggregate
    # registry + latest-period concentration rows (data.ts::instTopFilerCiks).
    selection_rows = [
        {
            "cik": cik,
            "latestPeriodValueUsd": (
                agg["conc_by_filer"]
                .get(cik, {})
                .get(entry["latest_period"], {})
                .get("total_value_usd")
            ),
        }
        for cik, entry in agg["registry"].items()
    ]
    tops = set(select_top_filers(selection_rows, TOP_FILER_CUT))
    tail = sorted(cik for cik in agg["registry"] if cik not in tops)
    # projection.filings is keyed by filing_id; payload entries by str(filing_key).
    filings_by_key = {
        str(ref.filing_key): {
            "accession": ref.accession,
            "submission_type": ref.submission_type,
            "period_of_report": ref.period_of_report,
            "filed_date": ref.filed_date,
            "doc_url": ref.doc_url,
            "source": ref.source,
        }
        for ref in projection.filings.values()
    }
    entries: list[dict] = []
    sizes: list[int] = []
    part_counts: list[int] = []
    reassembly_mismatches: list[str] = []
    expected_parts: dict[str, int] = {}
    for cik in tail:
        payload = build_filer_payload(
            cik,
            filer_name=agg["registry"][cik]["filer_name"],
            latest_period=agg["registry"][cik]["latest_period"],
            rows=by_filer.get(cik, []),
            filings_by_key=filings_by_key,
            agg=agg,
            latest_filed=latest_filed,
            window=window,
        )
        entry_json = f"{_dumps(cik)}:{_dumps(payload)}"
        sizes.append(_byte_len(entry_json))
        fragments = fragment_filer_payload(payload)
        expected_parts[cik] = len(fragments)
        part_counts.append(len(fragments))
        if _dumps(reassemble_filer_fragments(fragments)) != _dumps(payload):
            reassembly_mismatches.append(cik)
        for fragment in fragments:
            entries.append({
                "key": f"{cik}:{fragment['part']}",
                "cik": cik,
                "part": fragment["part"],
                "parts": fragment["parts"],
                "json": _fragment_entry_json(fragment),
            })
    ordered_sizes = sorted(sizes)
    ordered_parts = sorted(part_counts)
    ceiling = CLIENT_RESPONSE_CEILING_BYTES
    fill = fill_tail_shards(entries, ceiling=ceiling, shard_limit=TAIL_SHARD_LIMIT)
    over_ceiling = fill["oversized_fragments"]
    route_mismatches: list[str] = []
    for cik, parts in expected_parts.items():
        route = fill["routes"].get(cik)
        seen = fill["seen_parts"].get(cik, [])
        if (
            route is None
            or route[2] != parts
            or route[1] - route[0] + 1 > parts
            or seen != list(range(parts))
        ):
            route_mismatches.append(cik)
    max_parts = ordered_parts[-1] if ordered_parts else 0
    headroom_ok = (
        fill["shard_count"] <= TAIL_SHARD_LIMIT
        and not fill["overflow"]
        and max_parts <= FILER_FRAGMENT_PARTS_MAX
    )
    index_over = fill["index_bytes"] > ceiling
    stop = bool(
        over_ceiling
        or reassembly_mismatches
        or route_mismatches
        or index_over
        or not headroom_ok
    )
    return {
        "tail_filers": len(tail),
        "total_bytes": sum(sizes),
        "min_bytes": ordered_sizes[0] if ordered_sizes else 0,
        "median_bytes": _percentile(ordered_sizes, 0.5),
        "p90_bytes": _percentile(ordered_sizes, 0.9),
        "max_bytes": ordered_sizes[-1] if ordered_sizes else 0,
        "ceiling_bytes": ceiling,
        "over_ceiling_count": len(over_ceiling),
        "over_ceiling_ciks": over_ceiling,
        "fragment_target_bytes": FILER_FRAGMENT_TARGET_BYTES,
        "fragment_count": len(entries),
        "fragment_parts_median": _percentile(ordered_parts, 0.5),
        "fragment_parts_p90": _percentile(ordered_parts, 0.9),
        "fragment_parts_max": max_parts,
        "fragment_parts_limit": FILER_FRAGMENT_PARTS_MAX,
        "fragment_sizing_sentinel": FILER_FRAGMENT_SIZING_SENTINEL,
        "reassembly_mismatch_count": len(reassembly_mismatches),
        "reassembly_mismatch_ciks": reassembly_mismatches,
        "route_mismatch_count": len(route_mismatches),
        "route_mismatch_ciks": route_mismatches,
        "index_bytes": fill["index_bytes"],
        "index_over_ceiling": index_over,
        "shard_count": fill["shard_count"],
        "shard_bytes_max": max(fill["shard_bytes"], default=0),
        "shard_limit": TAIL_SHARD_LIMIT,
        "routing_index_files": FILER_ROUTING_INDEX_FILES,
        "v1_transition_files": FILER_V1_TRANSITION_FILES,
        "headroom_ok": headroom_ok,
        "stop": stop,
    }


def _r12_decision(aggregate_bytes: int) -> dict:
    no_compression = aggregate_bytes <= R12_AGGREGATE_LIMIT_BYTES
    return {
        "aggregate_bytes": aggregate_bytes,
        "limit_bytes": R12_AGGREGATE_LIMIT_BYTES,
        "branch": "no_compression" if no_compression else "new_delta_required",
        "stop": not no_compression,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="R11 T0 measurement ladder over an accepted inst snapshot"
        " (read-only; all derived output goes to a temp directory)."
    )
    parser.add_argument("--snapshot", required=True, help="The accepted snapshot.")
    parser.add_argument(
        "--measured-files",
        type=int,
        default=None,
        help="The measured M1 dist/ page count, for the R27 projection;"
        " omitted -> the projection rung reports 'not measured' honestly.",
    )
    parser.add_argument(
        "--pilot-filers", type=int, default=PILOT_FILER_LIMIT,
        help="Pilot bound (<=500 filers).",
    )
    parser.add_argument(
        "--build-date",
        default=None,
        help="The site build's generated-at date (YYYY-MM-DD). Supplied: the REAL"
             " FilingWindow is computed. Omitted: the WIDEST valid serialization is"
             " measured instead, so the result is conservative, never optimistic.",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="After the pilot, run the full derivation (abort thresholds apply).",
    )
    args = parser.parse_args(argv)

    # Codex F4: argparse's `type=int` accepts NEGATIVE integers, and both
    # numeric inputs are load-bearing in opposite directions:
    #
    #   --pilot-filers -1  flows into `min(args.pilot_filers, PILOT_FILER_LIMIT)`
    #     -> -1, and SQLite reads a negative LIMIT as NO LIMIT. The "bounded"
    #     pilot then derives the FULL corpus, consuming full-run resources with
    #     none of the --full abort thresholds (free disk / free RAM) applied.
    #   --measured-files -N  shrinks `worst_case_file_count`'s largest term, so
    #     the projection fabricates global headroom and the run certifies an
    #     IMPOSSIBLE measurement.
    #
    # Both refuse at parse time with a named message and a nonzero exit; the
    # upper bound on --pilot-filers is still enforced at the call site.
    # (These are the only numeric CLI inputs; --build-date is validated by
    # `filing_window_for`, --snapshot by the is_file() check below.)
    if args.pilot_filers < 1:
        print(
            f"REFUSED: --pilot-filers {args.pilot_filers} is below 1;"
            " a non-positive pilot bound becomes an unbounded SQLite LIMIT",
            file=sys.stderr,
        )
        return 1
    if args.measured_files is not None and args.measured_files < 0:
        print(
            f"REFUSED: --measured-files {args.measured_files} is negative;"
            " a negative measured tree count fabricates headroom the corpus"
            " does not have",
            file=sys.stderr,
        )
        return 1

    window = filing_window_for(args.build_date)
    snapshot = Path(args.snapshot)
    if not snapshot.is_file():
        print(f"REFUSED: --snapshot {snapshot} is not a file", file=sys.stderr)
        return 1

    pre_state = _snapshot_state(snapshot)
    try:
        try:
            return _run_ladder(args, snapshot, window)
        except _SQLitePhaseTimeout as exc:
            print(
                f"STOP: SQLite execution bound ({SQLITE_PHASE_TIMEOUT_SECONDS}s)"
                f" interrupted phase {exc.phase}; later phases suppressed",
                file=sys.stderr,
            )
            return 4
    finally:
        try:
            post_state = _snapshot_state(snapshot)
        except Exception as exc:
            print(f"D1 post-state: ERROR {type(exc).__name__}", file=sys.stderr)
            print("STOP (D1): snapshot post-state could not be captured", file=sys.stderr)
            return 5
        print(f"D1 pre-state: {json.dumps(pre_state, sort_keys=True)}")
        print(f"D1 post-state: {json.dumps(post_state, sort_keys=True)}")
        if (
            pre_state != post_state
            or _snapshot_state_has_sidecar(pre_state)
            or _snapshot_state_has_sidecar(post_state)
        ):
            print(
                "STOP (D1): snapshot state changed or a SQLite sidecar exists",
                file=sys.stderr,
            )
            return 5
        print("snapshot_immutability: PASS")


def _run_ladder(args: argparse.Namespace, snapshot: Path, window: dict) -> int:
    if args.build_date is None:
        print(
            "serialization_mode: WIDEST valid FilingWindow"
            " (--build-date intentionally omitted)"
        )
    else:
        print(f"serialization_mode: build-date {args.build_date}")

    # Rungs (i)-(iv) and (vi) share this one full-snapshot connection.  The
    # independently owned materializer stays live across the pilot, but its
    # phase deadline ends immediately after materialized EXPLAIN.
    with _owned_derivation_connection(snapshot, label="full") as conn:
        # (i) view gate
        try:
            verify_views(conn)
            print("(i) view gate: PASS")
        except ViewVerificationError as exc:
            print(f"(i) view gate: FAIL — {exc}", file=sys.stderr)
            return 1

        # (ii) cardinality projection
        counts = cardinality(conn)
        print(f"(ii) cardinality: {json.dumps(counts, sort_keys=True)}")
        if args.measured_files is not None:
            projected = worst_case_file_count(measured_files=args.measured_files)
            print(
                f"(ii) worst_case_file_count(measured_files="
                f"{args.measured_files}) = {projected}"
            )
        else:
            print(
                "(ii) worst_case_file_count: not computed — pass"
                " --measured-files with a MEASURED dist/ count (the formula"
                " refuses defaults for its largest term)"
            )

        # (iii) resource snapshot
        free_disk = shutil.disk_usage(snapshot.parent).free
        free_ram = free_ram_bytes()
        ram_text = f"{free_ram / GIB:.1f} GiB" if free_ram is not None else "unmeasurable"
        print(
            f"(iii) resources: free disk {free_disk / GIB:.1f} GiB,"
            f" free RAM {ram_text}"
        )

        # (iv) EXPLAIN QUERY PLAN — exact production SQL, before and after the
        # connection-local namespace is installed.
        for name, plan in explain_plans(conn).items():
            print(f"(iv) baseline plan {name}:")
            for line in plan:
                print(f"      {line}")
        conn.execute("BEGIN")
        with ExitStack() as full_stack:
            t0 = time.monotonic()
            with _sqlite_execution_bound(conn, "materialization") as guard:
                full_stack.enter_context(materialized_inst_derivation_views(conn))
                full_prepared = full_stack.enter_context(
                    prepared_materialized_inst_aggregate(
                        conn, _execution_guard=guard
                    )
                )
                full_materialization_s = time.monotonic() - t0
                materialized_plans = explain_plans(conn)
            print(f"(iv) materialization_s: {full_materialization_s:.3f}")
            for name, plan in materialized_plans.items():
                print(f"(iv) materialized plan {name}:")
                for line in plan:
                    print(f"      {line}")

            with tempfile.TemporaryDirectory(
                prefix="inst-derive-t0-"
            ) as scratch_name:
                scratch = Path(scratch_name)

                # (v) pilot, bounded and independently materialized.
                pilot_db = scratch / "pilot.db"
                copied = build_pilot_subset(
                    snapshot,
                    pilot_db,
                    filer_limit=min(args.pilot_filers, PILOT_FILER_LIMIT),
                )
                print(f"(v) pilot subset: {copied} filers")
                pilot = derive_once(pilot_db, scratch, label="pilot", window=window)
                print(f"(v) pilot: {json.dumps(pilot, sort_keys=True)}")
                stop = _report_tail_stop(
                    pilot["tail_payloads"],
                    rung="(v) pilot",
                    measured_files=args.measured_files,
                )

                # (vi) full, optional and threshold-gated.  Reuse the exact
                # rung-(iv) namespace; do not rebuild it or revive its deadline.
                if args.full:
                    free_disk = shutil.disk_usage(snapshot.parent).free
                    free_ram = free_ram_bytes()
                    if free_disk < MIN_FREE_DISK_BYTES:
                        print(
                            f"(vi) ABORT: free disk {free_disk / GIB:.1f} GiB <"
                            f" {MIN_FREE_DISK_BYTES / GIB:.0f} GiB threshold",
                            file=sys.stderr,
                        )
                        return 2
                    if free_ram is not None and free_ram < MIN_FREE_RAM_BYTES:
                        print(
                            f"(vi) ABORT: free RAM {free_ram / GIB:.1f} GiB <"
                            f" {MIN_FREE_RAM_BYTES / GIB:.0f} GiB threshold",
                            file=sys.stderr,
                        )
                        return 2
                    print(
                        "(vi) materialization reuse: rung (iv)"
                        f" {full_materialization_s:.3f}s; no rebuild"
                    )
                    full = _derive_from_materialized(
                        conn,
                        scratch,
                        label="full",
                        window=window,
                        materialization_s=full_materialization_s,
                        prepared=full_prepared,
                    )
                    print(f"(vi) full: {json.dumps(full, sort_keys=True)}")
                    r12 = _r12_decision(full["aggregate_bytes"])
                    print(f"(vi) R12: {json.dumps(r12, sort_keys=True)}")
                    if r12["stop"]:
                        print(
                            "(vi) STOP (R12): aggregate exceeds exactly 1.5 * 2^30"
                            " bytes; another owner-reviewed delta is required",
                            file=sys.stderr,
                        )
                    stop = (
                        _report_tail_stop(
                            full["tail_payloads"],
                            rung="(vi) full",
                            measured_files=args.measured_files,
                        )
                        or r12["stop"]
                        or stop
                    )
    # F1 (delta review): the pilot is bounded at PILOT_FILER_LIMIT filers, which
    # is SMALLER than the TOP_FILER_CUT prerender boundary — so a pilot contains
    # no tail filer at all and its tail measurement is structurally vacuous. A
    # pilot-only run therefore CANNOT certify LD-10; it exits nonzero and says so.
    # Certification requires --full (the bounded full-corpus derivation).
    if not args.full:
        print(
            "NOT CERTIFIED: the pilot is bounded at"
            f" {PILOT_FILER_LIMIT} filers, below the {TOP_FILER_CUT}-filer prerender"
            " cut, so it measures NO tail payload. Re-run with --full to certify"
            " LD-10 byte and file headroom (R11 rung (vi)).",
            file=sys.stderr,
        )
        return 3
    # A full run that measured no tail filer is equally non-certifying: an empty
    # measurement must never read as a pass (the vacuity guard for rung (vi)).
    measured_tail = full["tail_payloads"].get("tail_filers", 0)
    if measured_tail <= 0:
        print(
            "NOT CERTIFIED: the full derivation measured 0 tail payloads —"
            " a vacuous measurement cannot certify LD-10.",
            file=sys.stderr,
        )
        return 3
    # R11/LD-10 stop conditions: a payload over the client-response ceiling,
    # or a derived shard count over the reserved file headroom, is a STOP for
    # an architecture decision — a nonzero exit, never a warning.
    return 3 if stop else 0


def _report_tail_stop(tail: dict, *, rung: str, measured_files: int | None) -> bool:
    stop = bool(tail["stop"])
    if tail["over_ceiling_count"] > 0:
        print(
            f"{rung} STOP (LD-10): {tail['over_ceiling_count']} tail fragment(s)"
            f" exceed the {tail['ceiling_bytes']}-byte client-response ceiling:"
            f" {tail['over_ceiling_ciks']}",
            file=sys.stderr,
        )
    if tail["reassembly_mismatch_count"] > 0:
        print(
            f"{rung} STOP: {tail['reassembly_mismatch_count']} logical payload(s)"
            f" failed exact fragment reassembly: {tail['reassembly_mismatch_ciks']}",
            file=sys.stderr,
        )
    if tail["route_mismatch_count"] > 0:
        print(
            f"{rung} STOP: {tail['route_mismatch_count']} filer route(s) are"
            f" incomplete or contradictory: {tail['route_mismatch_ciks']}",
            file=sys.stderr,
        )
    if tail["index_over_ceiling"]:
        print(
            f"{rung} STOP: routing index is {tail['index_bytes']} bytes, over"
            f" the {tail['ceiling_bytes']}-byte client-response ceiling",
            file=sys.stderr,
        )
    if tail["fragment_parts_max"] > tail["fragment_parts_limit"]:
        print(
            f"{rung} STOP: maximum filer fan-out {tail['fragment_parts_max']}"
            f" exceeds {tail['fragment_parts_limit']} fragments",
            file=sys.stderr,
        )
    if not tail["headroom_ok"]:
        print(
            f"{rung} STOP (R11): derived shard count {tail['shard_count']}"
            f" exceeds the reserved file headroom of {tail['shard_limit']}"
            " shards (inst_budget.FILER_TAIL_SHARDS_RESERVED)",
            file=sys.stderr,
        )
    # The fixed shard reservation above is NOT a headroom
    # measurement. The binding check is against the MEASURED tree: global
    # headroom = the 18,000 cap minus (measured tree + chrome + filer pages +
    # activity + M3 + both index/tombstone files + the DERIVED shard count), every term from
    # inst_budget's real constants via worst_case_file_count. Without a
    # measured tree count the tail-geometry step REFUSES rather than passing
    # on the reservation alone.
    if measured_files is None:
        print(
            f"{rung} STOP (R11/LD-10): measured tree count required — pass"
            " --measured-files; the tail-geometry step refuses to certify"
            " headroom against an unmeasured tree (the fixed shard reservation"
            " is a budget, not a measurement)",
            file=sys.stderr,
        )
        return True
    projected = worst_case_file_count(
        measured_files=measured_files,
        filer_tail_shards=tail["shard_count"],
    )
    headroom = GLOBAL_FILE_CAP - projected
    print(
        f"{rung} measured global headroom: {GLOBAL_FILE_CAP} cap -"
        f" {projected} projected (measured tree {measured_files} + committed"
        f" terms + {tail['shard_count']} derived shard(s) +"
        f" {tail['routing_index_files']} routing index +"
        f" {tail['v1_transition_files']} v1 transition file) = {headroom}"
    )
    if headroom < 0:
        print(
            f"{rung} STOP (R11/LD-10): the projection exceeds the"
            f" {GLOBAL_FILE_CAP}-file global cap by {-headroom} file(s) —"
            " measured global headroom is negative",
            file=sys.stderr,
        )
        return True
    return stop


if __name__ == "__main__":
    raise SystemExit(main())
