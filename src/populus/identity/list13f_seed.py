"""Seed the definitional 13(f)-list identity intervals.

One quarterly list registers each of its CUSIPs with the validity interval
EXACTLY that quarter — ``[quarter_start, next_quarter_start)`` — intersected
with the ``securities.yaml`` authority ownership windows, so a mid-quarter
reassignment splits the interval at the boundary and each piece resolves to its
own owner (G14 — no identity time travel; a quarter-end owner is never
back-filled across a mid-quarter reassignment). The seeding is a pure function
of (records, authority, quarter) applied through the SAME ``owner_windows`` /
``cut_interval`` machinery the registry migration uses, so seed-then-revise
converges bit-for-bit with revise-then-seed.

Identity comes from the authority (``target_for`` via ``owner_windows``), never
from arrival order; re-seeding the same list is replay-zero; re-seeding a
quarter whose cached list has a DIFFERENT sha256 is a hard error unless the
caller passes ``replace_quarter`` (an auditable, transactional correction).

Seeding is SET-BASED: a quarter's owner resolution and bind-tuple
construction happen in pure Python, then the whole quarter is written in two
``executemany`` batches (securities, then intervals) rather than per-record SQL —
a ~22,000-row quarter costs two prepared statements, not O(rows) round trips.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass

from populus.identity.bootstrap import Mutations, _require_transaction
from populus.identity.registry import (
    IdentityRegistry,
    _assert_reconstructs,
    authority_state,
    cut_interval,
    insert_list_intervals,
    list_interval_row,
    owner_windows,
)
from populus.parse.list13f import (
    LIST13F_PARSER_VERSION,
    ParsedList13f,
    quarter_bounds,
)

#: Provenance and record-level license (§5.1). The register entry exists before
#: this module runs (G11 — see src/populus/licenses.json).
LIST13F_PROVENANCE = "sec-13f-list"
LIST13F_LICENSE_ID = "sec-13f-list"
#: The transformation version stamped onto every seeded fact row alongside the
#: parser version (§5.1). Bumped when the seeding normalization changes.
LIST13F_NORMALIZATION_VERSION = "list13f-norm-1.0.0"


class List13fReseedError(ValueError):
    """A quarter is being re-seeded from a list with a different sha256.

    Names both hashes; the operator either corrected the wrong file or must pass
    ``replace_quarter`` to supersede the prior seeding in one transaction.
    """


@dataclass(frozen=True)
class List13fBootstrapReport:
    """POST-WRITE facts for one quarter's seeding (identical on replay)."""

    quarter: str
    list_sha256: str
    records_seeded: int
    intervals_present: int
    options_present: int
    replaced: bool

    @property
    def mutated(self) -> bool:
        return self.replaced


def bootstrap_13f_list(
    conn: sqlite3.Connection,
    parsed: ParsedList13f,
    *,
    quarter: str,
    registry: IdentityRegistry,
    source_meta: Mapping[str, object],
    license_id: str = LIST13F_LICENSE_ID,
    provenance: str = LIST13F_PROVENANCE,
    replace_quarter: bool = False,
    mutations: Mutations | None = None,
) -> List13fBootstrapReport:
    """Seed one quarter's definitional CUSIP intervals.

    *source_meta* is the retrieval sidecar (``source_url``, ``sha256``,
    ``retrieved_at``) plus ``raw_path``. Every accepted, seed-worthy record
    registers ``[quarter_start, next_quarter_start)`` for its CUSIP, cut at any
    interior ``securities.yaml`` ownership boundary, one row per sub-interval.
    DELETED-only and status-conflict CUSIPs were already excluded from
    ``parsed.records`` by the parser (Locked Decisions 3-4), so they seed
    nothing here.
    """
    _require_transaction(conn, "bootstrap_13f_list")
    if mutations is None:
        mutations = Mutations()

    new_sha = str(source_meta["sha256"])
    source_url = str(source_meta["source_url"])
    retrieved_at = source_meta.get("retrieved_at")
    raw_path = source_meta.get("raw_path")

    # The replay/replacement decision is driven from the quarter-level SEED
    # LEDGER, NOT from security_list_intervals: a valid DELETED-only quarter
    # seeds zero interval rows, so an interval-only hash history was blind to it
    # and a different-sha reseed of such a quarter slipped through without the
    # mandated hard error. The ledger carries the source hash even for a
    # zero-record quarter, so the check is closed for every quarter.
    existing = conn.execute(
        "SELECT list_sha256 FROM security_list_seed_ledger"
        " WHERE quarter = ? AND provenance = ?",
        (quarter, provenance),
    ).fetchone()
    replaced = False
    if existing is not None and existing[0] != new_sha:
        if not replace_quarter:
            raise List13fReseedError(
                f"quarter {quarter} was already seeded from a different"
                f" {provenance} list: existing sha256 {existing[0]}"
                f" != new {new_sha}. Pass replace_quarter=True to supersede the"
                " prior seeding in one transaction (an auditable correction),"
                " never a silent overwrite."
            )
        cursor = conn.execute(
            "DELETE FROM security_list_intervals WHERE quarter = ? AND provenance = ?",
            (quarter, provenance),
        )
        mutations.list_intervals_removed += max(cursor.rowcount, 0)
        ledger_cursor = conn.execute(
            "DELETE FROM security_list_seed_ledger WHERE quarter = ? AND provenance = ?",
            (quarter, provenance),
        )
        mutations.list_seed_ledger_removed += max(ledger_cursor.rowcount, 0)
        replaced = True

    quarter_from, quarter_to = quarter_bounds(quarter)
    retrieved_at_text = retrieved_at if retrieved_at is None else str(retrieved_at)
    raw_path_text = raw_path if raw_path is None else str(raw_path)

    # PHASE 1 (pure, no SQL) — resolve every record's owner pieces and build the
    # bind tuples in memory. Records are walked in CUSIP order and pieces in
    # interval order, so the batch is deterministic and a replay produces the
    # identical statement sequence (this replaces the per-record
    # security/interval SQL that made a ~22,000-row quarter O(rows) round trips).
    security_rows: dict[str, tuple[str, str, str | None, str]] = {}
    interval_rows: list[tuple] = []
    for record in sorted(parsed.records, key=lambda item: item.cusip):
        windows = owner_windows(registry, "cusip", record.cusip)
        pieces = cut_interval((quarter_from, quarter_to), windows)
        _assert_reconstructs((quarter_from, quarter_to), pieces)
        for security_id, piece_from, piece_to in pieces:
            id_state, class_, review_state = authority_state(registry, security_id)
            security_rows.setdefault(
                security_id, (security_id, id_state, class_, review_state)
            )
            interval_rows.append(
                list_interval_row(
                    security_id=security_id,
                    value=record.cusip,
                    valid_from=piece_from,
                    valid_to=piece_to,
                    quarter=quarter,
                    issuer_name=record.issuer_name,
                    security_class=record.security_class,
                    is_option=record.is_option,
                    status_flag=record.status_flag,
                    provenance=provenance,
                    license_id=license_id,
                    review_state=review_state,
                    source_url=source_url,
                    list_sha256=new_sha,
                    retrieved_at=retrieved_at_text,
                    raw_path=raw_path_text,
                    row_ordinal=record.row_ordinal,
                    parser_version=LIST13F_PARSER_VERSION,
                    normalization_version=LIST13F_NORMALIZATION_VERSION,
                    # §5.1: the verbatim source line behind this identity.
                    source_row=record.raw_source,
                )
            )

    # PHASE 2 (set-based) — two batches for the whole quarter. `securities` is
    # inserted first so the interval FK is satisfiable; both use ON CONFLICT DO
    # NOTHING, so a same-sha replay writes nothing and both counters stay at zero.
    if security_rows:
        before = conn.total_changes
        conn.executemany(
            "INSERT INTO securities (security_id, id_state, class, review_state)"
            " VALUES (?, ?, ?, ?) ON CONFLICT (security_id) DO NOTHING",
            [security_rows[key] for key in sorted(security_rows)],
        )
        mutations.securities_created += conn.total_changes - before
    insert_list_intervals(conn, interval_rows, mutations=mutations)

    # Record the quarter in the seed ledger — ALWAYS, even when zero records
    # seeded. ON CONFLICT DO NOTHING keeps a same-sha replay at zero writes;
    # a different sha was already deleted above (replace_quarter) or hard-errored,
    # so the (quarter, provenance) key is free here.
    ledger_cursor = conn.execute(
        "INSERT INTO security_list_seed_ledger (quarter, provenance, list_sha256,"
        " source_url, retrieved_at, raw_path, records_seeded, parser_version,"
        " normalization_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (quarter, provenance) DO NOTHING",
        (
            quarter,
            provenance,
            new_sha,
            source_url,
            retrieved_at if retrieved_at is None else str(retrieved_at),
            raw_path if raw_path is None else str(raw_path),
            len(parsed.records),
            LIST13F_PARSER_VERSION,
            LIST13F_NORMALIZATION_VERSION,
        ),
    )
    mutations.list_seed_ledger_written += max(ledger_cursor.rowcount, 0)

    intervals_present = conn.execute(
        "SELECT COUNT(*) FROM security_list_intervals WHERE quarter = ? AND provenance = ?",
        (quarter, provenance),
    ).fetchone()[0]
    options_present = conn.execute(
        "SELECT COUNT(*) FROM security_list_intervals"
        " WHERE quarter = ? AND provenance = ? AND is_option = 1",
        (quarter, provenance),
    ).fetchone()[0]
    return List13fBootstrapReport(
        quarter=quarter,
        list_sha256=new_sha,
        records_seeded=len(parsed.records),
        intervals_present=intervals_present,
        options_present=options_present,
        replaced=replaced,
    )
