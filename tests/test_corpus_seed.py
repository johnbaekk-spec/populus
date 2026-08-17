"""R42/R44 — seed-forward corpus restoration and the identity-based floor.

Organised by the defect each test exists to catch.

* trust chain — a seed may only come from a pointer→manifest→asset chain that
  passed every landed validator. Five negative cases, one per link.
* digest — a mismatched asset refuses AND leaves no partial file behind.
* no-fallback — no pointer and no override is a REFUSAL. Building from an empty
  database is the disease (B24, B25), never the rollback.
* blank-as-unset — an unset repository variable arrives as the EMPTY STRING.
* inst isolation — a seeded store must not republish the seed's institutional
  snapshot when POPULUS_INST_DB arrives blank.
* the floor — identities, not counts. Three legitimate operations lower a count
  without losing anything, so each has a POSITIVE control proving the floor
  does not fire on it, beside the negative proving it fires on real loss.

The publish helpers are imported from ``test_publish`` (an established pattern
here — ``test_pointer_state`` does the same) so these tests run against a real
published repository rather than a hand-built fixture that could encode my own
misunderstanding of the manifest shape.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest
from test_publish import (
    NOW,
    latest_pointer,
    make_repo,
    publish_build,
    read_manifest,
    seed_db,
)

from populus.db import connect, init_db
from populus.amendments import ensure_views
from populus.load import ParsedRow, insert_filing, load_filing
from populus.publish.build import LocalDirBackend
from populus.publish.manifest import find_artifact
from populus.publish.seed import (
    SEED_COUNTS_SCHEMA_VERSION,
    SeedError,
    assert_corpus_floor,
    blank_as_unset,
    clear_inline_inst_data,
    resolve_seed,
    verify_and_place,
    write_seed_counts,
)

RUN_START = "2026-08-15T12:00:00+00:00"
BEFORE_RUN = "2026-08-15T11:00:00+00:00"
AFTER_RUN = "2026-08-15T12:30:00+00:00"


def backend_factory(data_repo: Path):
    return LocalDirBackend(data_repo)


@pytest.fixture
def published(tmp_path):
    """A real published release: database, data repo, build id."""
    db = seed_db(tmp_path / "source.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    return db, repo, report.build_id


def repoint(repo: Path, build_id: str, manifest: dict) -> None:
    """Write an edited manifest and re-mint the pointer's manifest_sha256.

    Without this, every edit would fail at the BYTES check and the later links
    would never be exercised — a negative test that passes for the wrong
    reason.
    """
    text = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    (repo / "builds" / build_id / "manifest.json").write_text(text, encoding="utf-8")
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    (repo / "latest.json").write_text(json.dumps(pointer), encoding="utf-8")


# ---------------------------------------------------------------------------
# the trust chain — one negative per link
# ---------------------------------------------------------------------------


def test_seed_resolves_from_a_valid_release(published):
    _db, repo, build_id = published
    result, payload = resolve_seed(repo, backend_factory)
    assert result.build_id == build_id
    assert result.origin == "release"
    entry = find_artifact(read_manifest(repo, build_id), "congress.db")
    assert hashlib.sha256(payload).hexdigest() == entry["sha256"]
    assert len(payload) == entry["bytes"]


def test_malformed_pointer_refuses(published):
    _db, repo, _build_id = published
    (repo / "latest.json").write_text('{"build_id": "nope"}', encoding="utf-8")
    with pytest.raises(SeedError, match="latest.json is invalid"):
        resolve_seed(repo, backend_factory)


def test_unparseable_pointer_refuses(published):
    _db, repo, _build_id = published
    (repo / "latest.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(SeedError, match="unreadable or unparseable"):
        resolve_seed(repo, backend_factory)


def test_manifest_bytes_not_matching_the_pointer_digest_refuses(published):
    _db, repo, build_id = published
    path = repo / "builds" / build_id / "manifest.json"
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(SeedError, match="manifest_sha256"):
        resolve_seed(repo, backend_factory)


def test_manifest_scoped_to_a_different_build_refuses(published):
    _db, repo, build_id = published
    manifest = read_manifest(repo, build_id)
    manifest["build_id"] = "20991231.9"
    repoint(repo, build_id, manifest)
    # validate_manifest catches this first, at path scoping — earlier than the
    # identity binding. Both are links in the chain; this pins which one fires.
    with pytest.raises(SeedError, match="manifest is invalid"):
        resolve_seed(repo, backend_factory)


def test_cross_build_pointer_identity_refuses(published):
    """The identity link ISOLATED.

    The test above never reaches it, because an edited manifest fails schema
    validation first. Here the manifest is internally consistent and valid —
    only the POINTER names a different build. That is the cross-binding
    pointer_manifest_identity_error exists for, and nothing earlier catches it.
    """
    db, repo, build_a = published
    report_b = publish_build(db, repo, moment=NOW + timedelta(days=1))
    build_b = report_b.build_id
    assert build_b != build_a

    # Build B's manifest is internally consistent and VALID — its artifact
    # paths are scoped to B. Serve it from build A's manifest path, with a
    # pointer that names A. validate_pointer passes (manifest_path is scoped to
    # A), the bytes check passes, validate_manifest passes (self-consistent for
    # B). Only the identity binding is left to catch the cross-bind.
    manifest_bytes = (repo / "builds" / build_b / "manifest.json").read_bytes()
    (repo / "builds" / build_a / "manifest.json").write_bytes(manifest_bytes)
    pointer = latest_pointer(repo)
    pointer["build_id"] = build_a
    pointer["manifest_path"] = f"builds/{build_a}/manifest.json"
    pointer["manifest_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    (repo / "latest.json").write_text(json.dumps(pointer), encoding="utf-8")

    with pytest.raises(SeedError, match="identity"):
        resolve_seed(repo, backend_factory)


def test_missing_congress_db_module_entry_refuses(published):
    _db, repo, build_id = published
    manifest = read_manifest(repo, build_id)
    artifacts = manifest["modules"]["congress"]["artifacts"]
    manifest["modules"]["congress"]["artifacts"] = [
        entry for entry in artifacts if entry.get("name") != "congress.db"
    ]
    repoint(repo, build_id, manifest)
    with pytest.raises(SeedError):
        resolve_seed(repo, backend_factory)


def test_malformed_artifact_entry_refuses(published):
    _db, repo, build_id = published
    manifest = read_manifest(repo, build_id)
    find_artifact(manifest, "congress.db")["sha256"] = "not-a-digest"
    repoint(repo, build_id, manifest)
    with pytest.raises(SeedError):
        resolve_seed(repo, backend_factory)


def test_no_pointer_and_no_override_refuses_rather_than_building_fresh(tmp_path):
    repo = make_repo(tmp_path)
    with pytest.raises(SeedError, match="never the fallback"):
        resolve_seed(repo, backend_factory)


# ---------------------------------------------------------------------------
# digest verification and placement
# ---------------------------------------------------------------------------


def test_digest_mismatch_refuses_and_removes_the_partial(tmp_path):
    source = tmp_path / "seed.db"
    source.write_bytes(b"pretend database")
    destination = tmp_path / "populus.db"
    with pytest.raises(SeedError, match="digest mismatch"):
        verify_and_place(destination, source=source, expected_sha256="0" * 64)
    assert not destination.exists(), "a refused seed must not be placed"
    leftovers = list(tmp_path.glob("*.seed-partial"))
    assert leftovers == [], f"a partial seed was left behind: {leftovers}"


def test_override_places_a_digest_matching_file(tmp_path):
    source = tmp_path / "seed.db"
    source.write_bytes(b"pretend database")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    destination = tmp_path / "populus.db"
    result = verify_and_place(destination, source=source, expected_sha256=digest)
    assert destination.read_bytes() == b"pretend database"
    assert result.origin == "override" and result.sha256 == digest


def test_override_path_that_is_not_a_file_refuses(tmp_path):
    with pytest.raises(SeedError, match="not a file"):
        verify_and_place(
            tmp_path / "populus.db",
            source=tmp_path / "absent.db",
            expected_sha256="0" * 64,
        )


# ---------------------------------------------------------------------------
# blank-as-unset — an unset repository variable is "", not absent
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["", "   ", "\n", "\t "])
def test_blank_repository_variables_read_as_unset(value):
    assert blank_as_unset(value) is None


def test_a_real_value_survives_blank_as_unset():
    # The control: if this helper swallowed everything the refusal paths above
    # would pass for the wrong reason.
    assert blank_as_unset("  /Volumes/seed/congress.db \n") == "/Volumes/seed/congress.db"
    assert blank_as_unset(None) is None


# ---------------------------------------------------------------------------
# institutional isolation on the seeded copy
# ---------------------------------------------------------------------------


def _seeded_store_with_inst(tmp_path) -> tuple[sqlite3.Connection, Path]:
    path = tmp_path / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    # init_db already applied inst.sql, so the tables exist and are empty —
    # exactly the shape a fresh store has. Seed them the way a published
    # congress.db arrives: with a stale institutional snapshot inside.
    conn.execute(
        "INSERT INTO inst_filers (cik, name_raw, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES ('0000000001', 'Stale Capital', 'sec-edgar',"
        " 'https://example.invalid/cik', '0000000001', 't-1', 't-1',"
        " '2026-07-16T00:00:00Z')"
    )
    conn.execute(
        "INSERT INTO inst_filings (filing_id, cik, accession, submission_type,"
        " period_of_report, filed_date, unit_basis, is_amendment,"
        " filing_manager_raw, parse_status, doc_url, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES ('inst:0001-26-000001', '0000000001', '0001-26-000001',"
        " '13F-HR', '2026-06-30', '2026-07-15', 'thousands', 0,"
        " 'Stale Capital', 'parsed', 'https://example.invalid/doc.xml',"
        " 'sec-edgar', 'https://example.invalid/doc.xml', '0001-26-000001',"
        " 't-1', 't-1', '2026-07-16T00:00:00Z')"
    )
    conn.commit()
    return conn, path


def test_inline_inst_data_is_cleared_from_the_seeded_copy(tmp_path):
    # stage_build derives the WHOLE institutional module from inline tables
    # when --inst-db is unset, so a seeded store would otherwise republish the
    # seed's institutional snapshot as current.
    conn, _path = _seeded_store_with_inst(tmp_path)
    cleared = clear_inline_inst_data(conn)
    assert "inst_filers" in cleared and "inst_filings" in cleared
    (rows,) = conn.execute("SELECT COUNT(*) FROM inst_filers").fetchone()
    assert rows == 0
    conn.close()


def test_a_cleared_store_reads_as_institutionally_ABSENT(tmp_path):
    """The assertion that actually matters: the predicate stage_build uses.

    Testing "the rows are gone" would pass even if `_inst_data_present` keyed
    off something else entirely. This calls the real predicate.
    """
    from populus.publish.build import _inst_data_present

    conn, _path = _seeded_store_with_inst(tmp_path)
    ensure_views(conn)
    assert _inst_data_present(conn) is True, "the fixture must start present"
    clear_inline_inst_data(conn)
    assert _inst_data_present(conn) is False
    conn.close()


def test_the_cleared_store_matches_a_FRESH_store_table_for_table(tmp_path):
    # The stated goal is "degrade to exactly today's honest congress-only
    # build", and today's build runs on a freshly initialized store. Prove the
    # shapes agree rather than asserting it in a comment.
    seeded, _p1 = _seeded_store_with_inst(tmp_path)
    clear_inline_inst_data(seeded)
    fresh_path = tmp_path / "fresh.db"
    init_db(str(fresh_path))
    fresh = connect(str(fresh_path))
    q = ("SELECT name FROM sqlite_master WHERE type='table'"
         " AND name LIKE 'inst%' ORDER BY name")
    assert [r[0] for r in seeded.execute(q)] == [r[0] for r in fresh.execute(q)]
    seeded.close()
    fresh.close()


def test_clearing_inst_data_leaves_the_congressional_corpus_intact(tmp_path):
    # The drop must be surgical: it is a blunt LIKE, so prove it does not take
    # the congressional tables with it.
    conn, _path = _seeded_store_with_inst(tmp_path)
    insert_filing(
        conn,
        filing_id="house:1",
        chamber="house",
        filer_name_raw="Doe, Jane",
        filing_kind="ptr",
        filed_date="2026-01-10",
        doc_url="https://example.invalid/1.pdf",
        source="house-clerk",
        ingested_at="2026-01-11T00:00:00Z",
    )
    conn.commit()
    clear_inline_inst_data(conn)
    (count,) = conn.execute("SELECT COUNT(*) FROM filings").fetchone()
    assert count == 1
    conn.close()


def test_clearing_is_a_noop_on_a_store_with_no_inst_rows(tmp_path):
    path = tmp_path / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    assert clear_inline_inst_data(conn) == []
    conn.close()


# ---------------------------------------------------------------------------
# the floor — identities, not counts
# ---------------------------------------------------------------------------


def _filing(conn, filing_id, *, bioguide_id=None, source="house-clerk", chamber="house"):
    insert_filing(
        conn,
        filing_id=filing_id,
        chamber=chamber,
        bioguide_id=bioguide_id,
        filer_name_raw="Doe, Jane",
        filing_kind="ptr",
        filed_date="2026-01-10",
        doc_url=f"https://example.invalid/{filing_id}.pdf",
        source=source,
        ingested_at="2026-01-11T00:00:00Z",
    )


def _rows(conn, filing_id, n, *, offset=0):
    load_filing(
        conn,
        filing_id,
        [
            ParsedRow(
                raw_row={"asset": f"A{i + offset}", "side": "purchase"},
                row_ordinal=i + 1,
                asset_name=f"Asset {i + offset}",
                side="purchase",
                transaction_date="2026-01-02",
            )
            for i in range(n)
        ],
        parse_status="parsed",
        parser_version="t-1",
        normalization_version="t-1",
    )


def _member(conn, bioguide_id="D000001"):
    conn.execute(
        "INSERT OR IGNORE INTO members (bioguide_id, full_name, chamber, party,"
        " state, district, terms, raw) VALUES (?, 'Jane Doe', 'house',"
        " 'Democrat', 'CA', '12', '[]', '{}')",
        (bioguide_id,),
    )


def _members_run(conn, started_at, *, status="ok"):
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status)"
        " VALUES (?, 'members', ?, ?)",
        (f"members-{started_at}-{status}", started_at, status),
    )
    conn.commit()


@pytest.fixture
def store(tmp_path):
    path = tmp_path / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    _member(conn, "D000001")
    _member(conn, "D000002")
    _filing(conn, "house:1", bioguide_id="D000001")
    _filing(conn, "house:2", bioguide_id="D000002")
    _rows(conn, "house:1", 3)
    _rows(conn, "house:2", 2)
    conn.commit()
    yield conn, path
    conn.close()


@pytest.fixture
def baseline(store, tmp_path):
    conn, _path = store
    path = tmp_path / "seed-counts.json"
    write_seed_counts(
        conn,
        path,
        seed_build_id="20260802.2",
        seed_sha256="a" * 64,
        run_started_at=RUN_START,
    )
    return path


def test_baseline_records_identities_not_just_counts(store, baseline):
    document = json.loads(baseline.read_text(encoding="utf-8"))
    assert document["schema_version"] == SEED_COUNTS_SCHEMA_VERSION
    (pair,) = document["pairs"]
    assert pair["source"] == "house-clerk" and pair["chamber"] == "house"
    assert pair["filing_ids"] == ["house:1", "house:2"]
    assert pair["joined"] == [["house:1", "D000001"], ["house:2", "D000002"]]
    assert pair["transactions_by_filing"] == {"house:1": 3, "house:2": 2}


def test_an_empty_store_cannot_produce_a_baseline(tmp_path):
    path = tmp_path / "empty.db"
    init_db(str(path))
    conn = connect(str(path))
    with pytest.raises(SeedError, match="no filings"):
        write_seed_counts(
            conn,
            tmp_path / "counts.json",
            seed_build_id=None,
            seed_sha256="a" * 64,
            run_started_at=RUN_START,
        )
    conn.close()


def test_floor_passes_an_intact_corpus(store, baseline):
    conn, _path = store
    _members_run(conn, AFTER_RUN)
    assert assert_corpus_floor(conn, baseline) == []


def test_floor_passes_a_grown_corpus(store, baseline):
    conn, _path = store
    _filing(conn, "house:3", bioguide_id="D000001")
    _rows(conn, "house:3", 5)
    _members_run(conn, AFTER_RUN)
    assert assert_corpus_floor(conn, baseline) == []


def test_floor_refuses_a_vanished_seed_filing(store, baseline):
    conn, _path = store
    conn.execute("DELETE FROM transactions WHERE filing_id = 'house:2'")
    conn.execute("DELETE FROM filings WHERE filing_id = 'house:2'")
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="absent from this"):
        assert_corpus_floor(conn, baseline)


def test_floor_refuses_a_lost_join_even_when_the_totals_are_offset(store, baseline):
    """The offset-roster case — the one only pair identity catches.

    A truncated-but-nonempty roster NULLs a historical identity while the join
    pass, which rewrites EVERY filing, resolves a new one. Aggregate joined
    counts are unchanged, so a count-based floor sees nothing at all.
    """
    conn, _path = store
    conn.execute("UPDATE filings SET bioguide_id = NULL WHERE filing_id = 'house:1'")
    _filing(conn, "house:9", bioguide_id="D000001")  # a NEW join, holding the total
    conn.commit()
    before = 2
    (after,) = conn.execute(
        "SELECT COUNT(*) FROM filings WHERE bioguide_id IS NOT NULL"
    ).fetchone()
    assert after == before, "the fixture must hold the aggregate level to be meaningful"
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="member join"):
        assert_corpus_floor(conn, baseline)


def test_floor_refuses_an_unauthorized_transaction_decrease(store, baseline):
    conn, _path = store
    _rows(conn, "house:1", 1)  # load_filing DELETEs and replaces the whole set
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="without\n?\\s*authorization|authorization"):
        assert_corpus_floor(conn, baseline)


def test_floor_passes_an_authorized_corrective_reparse(store, baseline):
    # The positive control for the clause above: a reparse NAMED in the
    # authorization list is a reviewed event, not a refusal.
    conn, _path = store
    _rows(conn, "house:1", 1)
    _members_run(conn, AFTER_RUN)
    assert assert_corpus_floor(conn, baseline, allow_reparse=frozenset({"house:1"})) == []


def test_floor_passes_amendment_healing(store, baseline):
    """Healing lowers the DEFAULT VIEW without losing an identity.

    An amendment supersedes an original: v_default_transactions drops the
    original's rows, so a count-based floor would fire on a correct pipeline.
    The raw identities all survive, so the floor must not.
    """
    conn, _path = store
    _filing(conn, "house:1a", bioguide_id="D000001")
    conn.execute(
        "UPDATE filings SET supersedes = 'house:1' WHERE filing_id = 'house:1a'"
    )
    conn.execute("UPDATE filings SET lifecycle = 'superseded' WHERE filing_id = 'house:1'")
    _rows(conn, "house:1a", 4)
    conn.commit()
    (default_rows,) = conn.execute(
        "SELECT COUNT(*) FROM v_default_transactions"
    ).fetchone()
    (raw_rows,) = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()
    assert default_rows < raw_rows, "the fixture must actually exercise healing"
    _members_run(conn, AFTER_RUN)
    assert assert_corpus_floor(conn, baseline) == []


def test_floor_refuses_when_this_runs_member_join_never_executed(store, baseline):
    """The B24 clause.

    A seeded store arrives with historical joins already nonzero, so
    stage_build's total-absence guard is permanently satisfied whether or not
    the members step ran. Only a THIS-run ingest_runs row proves it did.
    """
    conn, _path = store
    _members_run(conn, BEFORE_RUN)  # a PREVIOUS run's join, carried in by the seed
    with pytest.raises(SeedError, match="members` ingest ran in THIS build"):
        assert_corpus_floor(conn, baseline)


def test_floor_refuses_a_failed_member_join(store, baseline):
    conn, _path = store
    _members_run(conn, AFTER_RUN, status="failed")
    with pytest.raises(SeedError, match="members` ingest ran in THIS build"):
        assert_corpus_floor(conn, baseline)


def test_floor_refuses_a_missing_sidecar(store, tmp_path):
    conn, _path = store
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="no corpus baseline"):
        assert_corpus_floor(conn, tmp_path / "absent.json")


def test_floor_refuses_an_unparseable_sidecar(store, tmp_path):
    conn, _path = store
    path = tmp_path / "counts.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(SeedError, match="unparseable"):
        assert_corpus_floor(conn, path)


def test_floor_refuses_a_sidecar_with_no_pairs(store, tmp_path):
    conn, _path = store
    path = tmp_path / "counts.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": SEED_COUNTS_SCHEMA_VERSION,
                "run_started_at": RUN_START,
                "pairs": [],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(SeedError, match="no \\(source, chamber\\) pairs"):
        assert_corpus_floor(conn, path)


def test_floor_refuses_a_sidecar_whose_pairs_are_empty(store, tmp_path):
    # Fail closed, never vacuous: a baseline that records a pair carrying zero
    # filings would otherwise pass every identity check trivially.
    conn, _path = store
    path = tmp_path / "counts.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": SEED_COUNTS_SCHEMA_VERSION,
                "run_started_at": RUN_START,
                "pairs": [
                    {
                        "source": "house-clerk",
                        "chamber": "house",
                        "filing_ids": [],
                        "joined": [],
                        "transactions_by_filing": {},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(SeedError, match="zero filings"):
        assert_corpus_floor(conn, path)


def test_floor_refuses_an_unknown_schema_version(store, tmp_path):
    conn, _path = store
    path = tmp_path / "counts.json"
    path.write_text(
        json.dumps({"schema_version": 999, "run_started_at": RUN_START, "pairs": []}),
        encoding="utf-8",
    )
    with pytest.raises(SeedError, match="schema_version"):
        assert_corpus_floor(conn, path)


def test_floor_covers_every_source_chamber_pair_not_just_house(tmp_path):
    # F0 full-set: a guard that only watches one chamber would have missed B25
    # in the other direction (the CI store lost HOUSE while Senate was whole).
    path = tmp_path / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    _member(conn, "D000001")
    _filing(conn, "house:1", bioguide_id="D000001")
    _filing(conn, "senate:1", bioguide_id="D000001", source="senate-efd", chamber="senate")
    _rows(conn, "house:1", 2)
    _rows(conn, "senate:1", 2)
    conn.commit()
    counts = tmp_path / "counts.json"
    document = write_seed_counts(
        conn, counts, seed_build_id=None, seed_sha256="a" * 64, run_started_at=RUN_START
    )
    assert len(document["pairs"]) == 2, "both pairs must be baselined"
    conn.execute("DELETE FROM transactions WHERE filing_id = 'senate:1'")
    conn.execute("DELETE FROM filings WHERE filing_id = 'senate:1'")
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="senate-efd/senate"):
        assert_corpus_floor(conn, counts)
    conn.close()


# ---------------------------------------------------------------------------
# Round-1 remediation — the defects external review found.
# ---------------------------------------------------------------------------


def test_floor_refuses_a_filing_REASSIGNED_to_another_source_chamber(store, baseline):
    """F1: identity is the PAIR plus the id, not the id alone.

    Nothing is deleted here — the filing is still in `filings`. A global
    filing_id set answers "does this id exist anywhere?", which is the wrong
    question: a chamber could be emptied into its sibling and every check would
    pass. The seeded pair lost an identity, so the floor must refuse.
    """
    conn, _path = store
    conn.execute(
        "UPDATE filings SET source = 'senate-efd', chamber = 'senate'"
        " WHERE filing_id = 'house:2'"
    )
    conn.commit()
    (still_present,) = conn.execute(
        "SELECT COUNT(*) FROM filings WHERE filing_id = 'house:2'"
    ).fetchone()
    assert still_present == 1, "the fixture must MOVE the filing, not delete it"
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="house-clerk/house"):
        assert_corpus_floor(conn, baseline)


def test_floor_refuses_transactions_moved_out_of_their_seeded_pair(store, baseline):
    # The same reassignment, seen through the per-filing transaction counts:
    # they must be counted within the pair, not globally.
    conn, _path = store
    conn.execute("UPDATE filings SET source = 'kadoa' WHERE filing_id = 'house:1'")
    conn.commit()
    _members_run(conn, AFTER_RUN)
    with pytest.raises(SeedError, match="house-clerk/house"):
        assert_corpus_floor(conn, baseline)


# ---------------------------------------------------------------------------
# F6 — the plan requires SEEDED-STORE BUILD tests, not predicate tests.
#
# `_inst_data_present` flipping is necessary but not sufficient: it proves the
# probe, not the branch stage_build actually takes, nor that an external
# snapshot still wins when one is supplied. These run the real build.
# ---------------------------------------------------------------------------


def _seeded_congress_store_with_stale_inst(tmp_path, name="seeded.db") -> Path:
    """A store shaped like a real seed: congressional corpus + a STALE
    institutional snapshot inline, exactly what a published congress.db
    carries."""
    path = seed_db(tmp_path / name)
    conn = connect(str(path))
    conn.execute(
        "INSERT INTO inst_filers (cik, name_raw, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES ('0000000001', 'Stale Capital', 'sec-edgar',"
        " 'https://example.invalid/cik', '0000000001', 't-1', 't-1',"
        " '2026-07-16T00:00:00Z')"
    )
    conn.execute(
        "INSERT INTO inst_filings (filing_id, cik, accession, submission_type,"
        " period_of_report, filed_date, unit_basis, is_amendment,"
        " filing_manager_raw, parse_status, doc_url, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES ('inst:0001-26-000001', '0000000001', '0001-26-000001',"
        " '13F-HR', '2026-06-30', '2026-07-15', 'thousands', 0,"
        " 'Stale Capital', 'parsed', 'https://example.invalid/doc.xml',"
        " 'sec-edgar', 'https://example.invalid/doc.xml', '0001-26-000001',"
        " 't-1', 't-1', '2026-07-16T00:00:00Z')"
    )
    conn.commit()
    conn.close()
    return path


def _staged_manifest(staged) -> dict:
    return json.loads(
        (Path(staged.staging_dir) / "build" / "manifest.json").read_text(encoding="utf-8")
    )


def _inst_branch_state(staged) -> dict:
    """The four fields stage_build sets from its institutional branch.

    Asserted instead of "is there an inst module in the manifest?" because a
    derived module can still be WITHHELD by the M2 coverage gate — so an absent
    module conflates "the derive branch never ran" with "it ran and withheld",
    and the whole point here is which BRANCH was taken.
    """
    return {
        key: staged._state.get(key)
        for key in (
            "inst_logical",
            "inst_serving_logical",
            "inst_withheld",
            "inst_period_coverage",
        )
    }


def test_a_seeded_store_with_BLANK_inst_db_builds_congress_only(tmp_path):
    """The unset-variable path, which is the DEFAULT production shape whenever
    the inst snapshot is not provisioned — an unset repository variable arrives
    blank, not absent."""
    from test_publish import pin

    from populus.publish.build import LocalDirBackend as Backend
    from populus.publish.build import stage_build

    path = _seeded_congress_store_with_stale_inst(tmp_path)
    conn = connect(str(path))
    ensure_views(conn)
    clear_inline_inst_data(conn)
    conn.close()

    repo = make_repo(tmp_path)
    staged = stage_build(path, repo, now=pin(), backend=Backend(repo), inst_db_path=None)
    assert _inst_branch_state(staged) == {
        "inst_logical": None,
        "inst_serving_logical": None,
        "inst_withheld": None,
        "inst_period_coverage": None,
    }, "a cleared seeded store must take the institutionally-ABSENT branch"
    assert "congress" in _staged_manifest(staged)["modules"]


def test_the_UNCLEARED_seed_would_have_derived_from_the_stale_snapshot(tmp_path):
    """The control that gives the test above its meaning.

    Without it, "absent branch" could equally mean stage_build never derives
    from inline tables at all, and the clear would be proven to guard nothing.
    It does derive: the uncleared seed produces a withheld institutional notice
    computed from the SEED's filings, naming the seed's stale quarter. With a
    seed whose coverage clears the M2 gate this is stale DATA, not just a stale
    notice.
    """
    from test_publish import pin

    from populus.publish.build import LocalDirBackend as Backend
    from populus.publish.build import stage_build

    path = _seeded_congress_store_with_stale_inst(tmp_path)
    conn = connect(str(path))
    ensure_views(conn)
    conn.close()  # deliberately NOT cleared

    repo = make_repo(tmp_path)
    staged = stage_build(path, repo, now=pin(), backend=Backend(repo), inst_db_path=None)
    withheld = _inst_branch_state(staged)["inst_withheld"]
    assert withheld is not None, (
        "the uncleared seed was expected to reach the derive branch — if it"
        " does not, clear_inline_inst_data is guarding nothing"
    )
    assert "2026-06-30" in (withheld.get("uncovered_quarters") or []), (
        f"the notice must come from the SEED's own stale quarter: {withheld}"
    )


def test_a_seeded_store_with_an_EXTERNAL_snapshot_uses_that_snapshot(tmp_path):
    """The set-variable path: the accepted external snapshot stays
    authoritative, and clearing the inline tables does not disturb it."""
    from test_inst_external_store import make_inst_snapshot
    from test_publish import pin

    from populus.publish.build import INST_SOURCE_ARTIFACT, LocalDirBackend as Backend
    from populus.publish.build import stage_build

    path = _seeded_congress_store_with_stale_inst(tmp_path)
    conn = connect(str(path))
    ensure_views(conn)
    clear_inline_inst_data(conn)
    conn.close()

    snapshot = make_inst_snapshot(tmp_path)
    repo = make_repo(tmp_path)
    staged = stage_build(
        path, repo, now=pin(), backend=Backend(repo), inst_db_path=snapshot
    )
    manifest = _staged_manifest(staged)
    assert manifest["modules"].get("inst", {}).get("artifacts"), (
        "the external snapshot must still produce an institutional module"
    )
    # R24: the source identity is recorded, and it is the SNAPSHOT's.
    assert (Path(staged.staging_dir) / "build" / INST_SOURCE_ARTIFACT).is_file()
