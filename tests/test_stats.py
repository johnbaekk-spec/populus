"""stats.json: default-view sourcing, inventory totals, determinism,
freshness, and schema validation (RUN 4; R10–R11)."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from populus.stats import (
    DATA_NOTE,
    compute_stats,
    read_house_meta,
    render_stats,
)

SCHEMA = json.loads(
    (Path(__file__).parent / "schemas" / "stats.schema.json").read_text()
)
NOW = lambda: "2026-07-23T00:00:00Z"  # noqa: E731


@pytest.fixture
def stats_db(initialized_db, make_filing, make_row, make_member, make_amendment_pair):
    """A hand-computable database exercising every stats dimension:

    - house:1 (joined member, one late + one on-time row)
    - house:2 (unjoined, needs_ocr, zero rows)
    - kadoa active + kadoa retired filings (one row each)
    - a senate unresolved amendment pair (one row per side)
    """
    from populus.load import load_filing

    conn = initialized_db
    make_member(conn, "D000001", first="Jane", last="Doe")
    make_filing(
        conn,
        filing_id="house:1",
        bioguide_id="D000001",
        filed_date="2026-02-01",
        doc_url="https://example.invalid/house1",
    )
    load_filing(
        conn,
        "house:1",
        [
            make_row(asset_name="Late", days_to_file=60, is_late=1),
            make_row(asset_name="OnTime", row_ordinal=2, days_to_file=10, is_late=0),
        ],
        parse_status="parsed",
        parser_version="t",
        normalization_version="t",
    )
    make_filing(
        conn,
        filing_id="house:2",
        filer_name_raw="Unjoined, Name",
        filed_date="2020-05-01",
        parse_status="needs_ocr",
        doc_url="https://example.invalid/house2",
    )
    for filing_id, lifecycle in (("kadoa:house_1_g0", "active"), ("kadoa:house_2_g0", "retired")):
        make_filing(
            conn,
            filing_id=filing_id,
            filer_name_raw="Doe, Jane",
            source="kadoa",
            license_id="mit-kadoa-seed",
            filed_date="2026-03-01",
            lifecycle=lifecycle,
            doc_url=f"https://example.invalid/{filing_id}",
        )
        load_filing(
            conn,
            filing_id,
            [make_row(asset_name=f"K {filing_id}", days_to_file=5, is_late=0)],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )
    make_amendment_pair(conn)  # senate pair: original excluded from default
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, finished_at, status, host)"
        " VALUES ('r1', 'congress-house', '2026-07-01T00:00:00Z',"
        " '2026-07-01T00:05:00Z', 'ok', 'test')"
    )
    return conn


def test_default_aggregates_read_the_default_view(stats_db):
    stats = compute_stats(stats_db, now=NOW)
    # Default view: house:1 (2 rows) + active kadoa (1) + amendment side (1).
    # EXCLUDED: retired kadoa row, and the paired original's row — the
    # §9.5 unresolved-pair fixture proves the original contributes to NO
    # default aggregate.
    assert stats["default"]["row_count"] == 4
    mix = stats["default"]["source_mix"]
    assert mix["kadoa_count"] == 1  # the retired kadoa row is out
    assert mix["primary_count"] == 3
    assert mix["primary_count"] + mix["kadoa_count"] == stats["default"]["row_count"]
    assert mix["by_source"] == {"house-clerk": 2, "kadoa": 1, "senate-efd": 1}

    # ...while the totals section counts the whole archive, excluded rows
    # included, under explicitly suffixed names.
    assert stats["totals"]["transaction_count_including_excluded"] == 6
    assert stats["totals"]["filing_count_including_excluded"] == 6
    assert stats["totals"]["unresolved_pair_count"] == 1
    assert stats["totals"]["needs_ocr_filing_count_including_excluded"] == 1
    assert stats["totals"]["member_count"] == 1


def test_late_filing_and_join_coverage(stats_db):
    stats = compute_stats(stats_db, now=NOW)
    late = stats["default"]["late_filing"]
    # House rows in the default view carrying is_late: house:1's two plus
    # the active kadoa row (chamber house); the amendment row has none.
    assert late["by_chamber"]["house"]["rows_with_late_status"] == 3
    assert late["by_chamber"]["house"]["late_count"] == 1
    assert late["by_chamber"]["house"]["late_rate"] == pytest.approx(1 / 3)
    # days_to_file present: 60, 10, 5 → median 10.
    assert late["by_chamber"]["house"]["median_days_to_file"] == pytest.approx(10.0)

    join = stats["default"]["join_coverage"]
    # Primary rows in the default view: 2 joined (house:1) + 1 unjoined
    # (the amendment's filer resolves to nobody in this fixture).
    assert join["primary_rows"] == 3
    assert join["primary_joined"] == 2
    assert join["primary_join_rate"] == pytest.approx(2 / 3)
    assert join["by_source"]["house-clerk"] == {
        "rows": 2,
        "joined": 2,
        "join_rate": 1.0,
    }


def test_unresolved_names_listed_never_dropped(stats_db):
    stats = compute_stats(stats_db, now=NOW)
    names = {entry["filer_name_raw"] for entry in stats["unresolved_names"]}
    assert "Unjoined, Name" in names
    total = sum(e["filing_count"] for e in stats["unresolved_names"])
    assert total == stats_db.execute(
        "SELECT COUNT(*) FROM filings WHERE bioguide_id IS NULL"
    ).fetchone()[0]


def test_freshness_section(stats_db):
    stats = compute_stats(
        stats_db,
        now=NOW,
        house_meta={
            "2020": "Wed, 01 Jul 2020 00:00:00 GMT",
            "2026": "Thu, 23 Jul 2026 06:00:00 GMT",
            "2015": None,
        },
    )
    freshness = stats["freshness"]
    assert freshness["house_index_last_modified"] == "Thu, 23 Jul 2026 06:00:00 GMT"
    assert freshness["house_db_max_filed_date"] == "2026-02-01"
    assert freshness["senate_db_max_filed_date"] == "2026-06-01"
    assert freshness["last_ingest_runs"]["congress-house"]["run_id"] == "r1"


def test_freshness_unknowns_are_explicit_nulls(initialized_db):
    stats = compute_stats(initialized_db, now=NOW)
    freshness = stats["freshness"]
    assert freshness["house_index_last_modified"] is None
    assert freshness["house_db_max_filed_date"] is None
    assert freshness["senate_db_max_filed_date"] is None
    assert freshness["last_ingest_runs"] == {}
    # Zero-denominator rates are null, never fabricated zeros.
    assert stats["default"]["source_mix"]["primary_rate"] is None


def test_read_house_meta(tmp_path):
    (tmp_path / "2026FD.zip.meta.json").write_text(
        json.dumps({"etag": "x", "last_modified": "Thu, 23 Jul 2026 06:00:00 GMT"})
    )
    (tmp_path / "2020FD.zip.meta.json").write_text("not json {")
    (tmp_path / "unrelated.json").write_text("{}")
    meta = read_house_meta(tmp_path)
    assert meta == {"2026": "Thu, 23 Jul 2026 06:00:00 GMT"}
    assert read_house_meta(tmp_path / "absent") == {}


def test_render_is_byte_stable_and_sorted(stats_db):
    first = render_stats(compute_stats(stats_db, now=NOW))
    second = render_stats(compute_stats(stats_db, now=NOW))
    assert first == second
    assert first.endswith("\n")
    parsed = json.loads(first)
    assert list(parsed) == sorted(parsed)


def test_data_note_states_the_structural_caveat(stats_db):
    stats = compute_stats(stats_db, now=NOW)
    assert stats["data_note"] == DATA_NOTE
    for fragment in ("45 days", "statutory ranges", "flows", "13107"):
        assert fragment in DATA_NOTE


def test_stats_validate_against_schema(stats_db):
    jsonschema.validate(compute_stats(stats_db, now=NOW), SCHEMA)


def test_empty_db_stats_validate_against_schema(initialized_db):
    jsonschema.validate(compute_stats(initialized_db, now=NOW), SCHEMA)


def test_cli_stats_writes_and_prints(stats_db, tmp_path, make_filing):
    # The CLI path: --out writes the rendered file; bare prints it.
    from click.testing import CliRunner

    from populus.cli import main as cli_main
    from populus.db import init_db

    db_path = tmp_path / "s.db"
    init_db(str(db_path))
    runner = CliRunner()
    out = tmp_path / "stats.json"
    result = runner.invoke(
        cli_main, ["stats", "--db", str(db_path), "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    document = json.loads(out.read_text())
    jsonschema.validate(document, SCHEMA)

    result = runner.invoke(cli_main, ["stats", "--db", str(db_path)])
    assert result.exit_code == 0
    assert json.loads(result.output)["stats_version"] == "stats-1.0.0"


# --- per-era gate + join keys (RUN M1-B, R6/R15) -----------------------------


def test_efile_parse_gate_key_is_published_per_chamber_year(stats_db):
    from populus.amendments import ensure_views

    ensure_views(stats_db)
    totals = compute_stats(stats_db, now=NOW)["totals"]
    gate = totals["efile_parse_gate_by_chamber_year_including_excluded"]

    # house 2026: one parsed e-file filing, two clean rows → a passing era.
    house_2026 = gate["house"]["2026"]
    assert house_2026 == {
        "clean_efile_rows": 2,
        "efile_rows": 2,
        "efile_parse_rate": 1.0,
        "row_denominator_known": True,
        "efile_filings": 1,
        "measurable_efile_filings": 1,
        "unmeasurable_efile_filings": 0,
        "efile_filing_measurable_rate": 1.0,
        "status": "pass",
        "meets_gate": True,
    }
    # house 2020 holds only the needs_ocr filing — no e-file census at all.
    assert gate["house"]["2020"]["efile_filings"] == 0
    assert gate["house"]["2020"]["status"] == "no_efile_filings"
    # kadoa filings are excluded from the gate entirely.
    assert "kadoa" not in gate


def test_member_join_key_is_published_per_chamber_year(stats_db):
    from populus.amendments import ensure_views

    ensure_views(stats_db)
    totals = compute_stats(stats_db, now=NOW)["totals"]
    join = totals["member_join_primary_by_chamber_year_including_excluded"]

    assert join["house"]["2026"] == {
        "filings": 1,
        "filings_joined": 1,
        "rows": 2,
        "rows_joined": 2,
        "join_rate": 1.0,
    }
    # The unjoined senate filers surface per era rather than being averaged
    # away by the modern corpus.
    assert join["senate"]["2026"]["filings_joined"] == 0
    assert join["senate"]["2026"]["join_rate"] == 0.0


def test_the_published_gate_figures_are_the_same_computation_as_the_summary(stats_db):
    """One computation, not two that can disagree: stats.json sources its era
    figures from populus.parse_gate, the module the ingest summary prints."""
    from populus.amendments import ensure_views
    from populus.parse_gate import compute_parse_gate

    ensure_views(stats_db)
    published = compute_stats(stats_db, now=NOW)["totals"][
        "efile_parse_gate_by_chamber_year_including_excluded"
    ]
    for era in compute_parse_gate(stats_db).eras:
        cell = published[era.chamber][era.year]
        assert cell["status"] == era.status
        assert cell["meets_gate"] == era.meets_gate
        assert cell["efile_parse_rate"] == era.efile_parse_rate
        assert cell["unmeasurable_efile_filings"] == era.unmeasurable_efile_filings


def test_the_existing_per_year_key_is_untouched_by_the_additive_keys(stats_db):
    from populus.amendments import ensure_views

    ensure_views(stats_db)
    totals = compute_stats(stats_db, now=NOW)["totals"]
    coverage = totals["parse_coverage_primary_by_chamber_year_including_excluded"]
    # Same shape as before: chamber → year → {status: count, total}.
    assert coverage["house"]["2026"] == {"parsed": 1, "total": 1}
    assert coverage["house"]["2020"] == {"needs_ocr": 1, "total": 1}


def test_stats_with_the_new_keys_validate_and_render_byte_stably(stats_db):
    from populus.amendments import ensure_views

    ensure_views(stats_db)
    first = compute_stats(stats_db, now=NOW)
    jsonschema.validate(first, SCHEMA)
    second = compute_stats(stats_db, now=NOW)
    assert render_stats(first) == render_stats(second)
    # The nested era dicts are sorted like everything else in the document.
    rendered = render_stats(first)
    assert rendered.endswith("\n")
    assert json.loads(rendered) == first


def test_an_unmeasurable_era_is_published_as_such_not_hidden(
    initialized_db, make_filing, make_row
):
    from populus.amendments import ensure_views
    from populus.load import load_filing

    conn = initialized_db
    ensure_views(conn)
    make_filing(
        conn, filing_id="house:hist", filed_date="2015-04-01",
        parse_status="failed", doc_url="https://example.invalid/hist",
    )
    load_filing(
        conn, "house:hist", [], parse_status="failed",
        parser_version="t", normalization_version="t",
    )
    stats = compute_stats(conn, now=NOW)
    jsonschema.validate(stats, SCHEMA)
    era = stats["totals"]["efile_parse_gate_by_chamber_year_including_excluded"][
        "house"
    ]["2015"]
    assert era["status"] == "unmeasurable"
    assert era["meets_gate"] is False
    assert era["row_denominator_known"] is False
    assert era["efile_parse_rate"] is None


@pytest.mark.parametrize(
    "key",
    [
        "efile_parse_gate_by_chamber_year_including_excluded",
        "member_join_primary_by_chamber_year_including_excluded",
        "parse_coverage_primary_by_chamber_year_including_excluded",
    ],
)
def test_the_schema_requires_each_per_year_key(stats_db, key):
    """`additionalProperties: false` catches an ADDED key; only `required`
    catches a key that silently stops being published. Dropping one from the
    schema must therefore fail here, not pass quietly."""
    from populus.amendments import ensure_views

    ensure_views(stats_db)
    stats = compute_stats(stats_db, now=NOW)
    jsonschema.validate(stats, SCHEMA)

    del stats["totals"][key]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(stats, SCHEMA)
