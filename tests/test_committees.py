"""B-6: dated committee ingest + the as-of membership predicate.

The load-bearing assertions are the DATING rule: a trade date outside the
snapshot's declared validity answers None (unknown), never [] (known-none),
and never a guessed membership.
"""

import sqlite3

import pytest

from populus import committees


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    yield c
    c.close()


@pytest.fixture()
def cache(tmp_path):
    (tmp_path / "committees-current.yaml").write_text(
        "- thomas_id: HSAG\n  name: House Agriculture\n  type: house\n"
        "- thomas_id: SSBK\n  name: Senate Banking\n  type: senate\n"
        "- name: no-id committee\n  type: house\n"
    )
    (tmp_path / "committee-membership-current.yaml").write_text(
        "HSAG:\n- name: A Member\n  bioguide: A000001\n  title: Chair\n"
        "HSAG16:\n- name: A Member\n  bioguide: A000001\n"  # subcommittee → parent, deduped
        "SSBK:\n- name: B Member\n  bioguide: B000002\n- name: No Bioguide\n"
        "ZZZZ:\n- name: Orphan\n  bioguide: C000003\n"  # unknown committee → counted
    )
    return tmp_path


def test_ingest_dating_contract_and_counts(conn, cache):
    report = committees.run_committees_ingest(
        conn, legislators_dir=cache, snapshot_date="2026-08-12", valid_from="2025-01-03"
    )
    assert report.committees == 2
    assert report.memberships == 2  # A on HSAG (deduped with subcommittee), B on SSBK
    assert report.skipped == 3  # no-id committee, no-bioguide member, orphan membership
    assert report.jurisdiction_rows >= 2
    row = conn.execute(
        "SELECT valid_from, valid_to, snapshot_date FROM committee_memberships"
        " WHERE bioguide_id='A000001'"
    ).fetchone()
    assert row == ("2025-01-03", "2026-08-12", "2026-08-12")


def test_ingest_rejects_inverted_window(conn, cache):
    with pytest.raises(ValueError, match="valid_from"):
        committees.run_committees_ingest(
            conn, legislators_dir=cache, snapshot_date="2025-01-01", valid_from="2026-01-01"
        )


def test_membership_as_of_dating_rule(conn, cache):
    committees.run_committees_ingest(
        conn, legislators_dir=cache, snapshot_date="2026-08-12", valid_from="2025-01-03"
    )
    # Inside the window: known.
    assert committees.membership_as_of(conn, "A000001", "2026-01-15") == [
        ("HSAG", "House Agriculture")
    ]
    # Inside the window, no membership: known-none is [], not None.
    assert committees.membership_as_of(conn, "Z000099", "2026-01-15") == []
    # BEFORE the window: unknown is None — the source cannot answer, so we don't.
    assert committees.membership_as_of(conn, "A000001", "2020-06-01") is None
    # After the snapshot: also unknown.
    assert committees.membership_as_of(conn, "A000001", "2027-01-01") is None


def test_membership_as_of_without_any_snapshot_is_unknown(conn):
    committees.ensure_committee_schema(conn)
    assert committees.membership_as_of(conn, "A000001", "2026-01-15") is None


def test_jurisdiction_mapping_versioned_and_nonempty():
    jur = committees.load_jurisdiction()
    assert jur["mapping_version"] >= 1
    assert jur["source"]
    assert all(sectors for sectors in jur["committees"].values())


@pytest.mark.parametrize(
    "bad_date",
    ["2026-02-30", "2023-02-29", "0000-01-01", "2026-13-01", "2026-1-3", "", "not-a-date"],
)
def test_membership_as_of_refuses_dates_that_name_no_real_day(conn, cache, bad_date):
    # Review c2r3-F3: shape is not enough. An impossible date is UNKNOWN
    # (None) — never a membership answer, which would be a fabricated fact.
    committees.run_committees_ingest(
        conn, legislators_dir=cache, snapshot_date="2026-08-12", valid_from="2025-01-03"
    )
    assert committees.membership_as_of(conn, "A000001", bad_date) is None


def test_membership_as_of_accepts_a_real_leap_day(conn, cache):
    committees.run_committees_ingest(
        conn, legislators_dir=cache, snapshot_date="2026-08-12", valid_from="2024-02-01"
    )
    # 2024 IS a leap year — the strict parser must not over-reject
    assert committees.membership_as_of(conn, "A000001", "2024-02-29") == [
        ("HSAG", "House Agriculture")
    ]


@pytest.mark.parametrize("bad_date", ["2026-02-30", "0000-01-01", "2026-1-3"])
def test_ingest_refuses_impossible_snapshot_dates(conn, cache, bad_date):
    with pytest.raises(ValueError, match="real YYYY-MM-DD"):
        committees.run_committees_ingest(
            conn, legislators_dir=cache, snapshot_date=bad_date, valid_from="2025-01-03"
        )
    with pytest.raises(ValueError, match="real YYYY-MM-DD"):
        committees.run_committees_ingest(
            conn, legislators_dir=cache, snapshot_date="2026-08-12", valid_from=bad_date
        )
