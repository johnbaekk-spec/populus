"""Shared fixtures: tmp-DB, filing/row/member/pair factories, no-network guard."""

from __future__ import annotations

import json
import socket

import pytest

from populus.db import connect, init_db
from populus.load import ParsedRow, insert_filing, load_filing


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """RUN-1 code and tests must never touch the network (brief line 20).

    Autouse: every test runs under a socket/DNS-blocked interpreter, so any
    real I/O attempt fails the test rather than silently escaping.
    """

    def _blocked(*args, **kwargs):
        raise AssertionError("network access is forbidden in RUN-1 tests")

    monkeypatch.setattr(socket, "getaddrinfo", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", _blocked)


@pytest.fixture
def initialized_db(tmp_path):
    """A freshly initialized §9.4 database, connected with foreign keys ON."""
    path = tmp_path / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    yield conn
    conn.close()


@pytest.fixture
def make_filing():
    """Insert a valid ``filings`` row; overrides replace any column value."""

    def _make_filing(conn, **overrides):
        values = dict(
            filing_id="house:10042026",
            chamber="house",
            filer_name_raw="Doe, Jane",
            filing_kind="ptr",
            filed_date="2026-01-10",
            doc_url="https://disclosures-clerk.house.gov/ptr/10042026.pdf",
            source="house-clerk",
            ingested_at="2026-01-11T00:00:00Z",
        )
        values.update(overrides)
        insert_filing(conn, **values)
        return values["filing_id"]

    return _make_filing


@pytest.fixture
def make_row():
    """Build a ParsedRow; the default raw_row varies with asset_name/side so
    distinct rows get distinct fingerprints unless a raw_row is supplied."""

    def _make_row(
        *,
        asset_name="Apple Inc",
        side="purchase",
        row_ordinal=1,
        raw_row=None,
        **overrides,
    ):
        if raw_row is None:
            raw_row = {
                "owner": None,
                "asset_name": asset_name,
                "ticker": None,
                "side": side,
                "transaction_date": "2026-01-02",
                "amount_label": "$1,001 - $15,000",
                "comment": None,
            }
        return ParsedRow(
            raw_row=raw_row,
            row_ordinal=row_ordinal,
            asset_name=asset_name,
            side=side,
            **overrides,
        )

    return _make_row


@pytest.fixture
def make_member():
    """Insert a ``members`` row shaped like a legislators entry (RUN 4)."""

    def _make_member(
        conn,
        bioguide_id="D000001",
        *,
        first="Jane",
        last="Doe",
        middle=None,
        nickname=None,
        official_full=None,
        chamber="house",
        state="CA",
        district="12",
        party="Democrat",
        terms=None,
        other_names=None,
    ):
        if terms is None:
            term = {
                "type": "rep" if chamber == "house" else "sen",
                "start": "2013-01-03",
                "end": "2027-01-03",
                "state": state,
                "party": party,
            }
            if chamber == "house" and district is not None:
                term["district"] = int(district)
            terms = [term]
        name = {"first": first, "last": last}
        if middle:
            name["middle"] = middle
        if nickname:
            name["nickname"] = nickname
        if official_full:
            name["official_full"] = official_full
        raw = {"id": {"bioguide": bioguide_id}, "name": name, "terms": terms}
        if other_names:
            raw["other_names"] = other_names
        conn.execute(
            "INSERT INTO members (bioguide_id, full_name, chamber, party,"
            " state, district, terms, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bioguide_id,
                official_full or f"{first} {last}",
                chamber,
                party,
                state,
                district,
                json.dumps(terms),
                json.dumps(raw),
            ),
        )
        return bioguide_id

    return _make_member


@pytest.fixture
def make_alias():
    """Insert a ``member_aliases`` row (alias normalized at insert)."""

    def _make_alias(
        conn,
        *,
        alias,
        bioguide_id,
        chamber="house",
        state=None,
        district=None,
        valid_from="2013-01-03",
        valid_to=None,
        note="test alias",
    ):
        from populus.members import normalize_filer_name

        conn.execute(
            "INSERT INTO member_aliases (alias, chamber, state, district,"
            " valid_from, valid_to, bioguide_id, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                normalize_filer_name(alias),
                chamber,
                state,
                district,
                valid_from,
                valid_to,
                bioguide_id,
                note,
            ),
        )

    return _make_alias


@pytest.fixture
def make_amendment_pair(make_filing, make_row):
    """An original + amendment filing pair with loaded rows (RUN 4).

    Mirrors the Senate ingest outcome: ``supersedes`` on the amendment,
    the amendment's rows flagged ``amendment_unresolved`` (normalization
    does that), the original's rows NOT yet flagged (the propagation pass
    owns that side).
    """

    def _make_pair(
        conn,
        *,
        original_id="senate:00000000-0000-4000-8000-000000000201",
        amendment_id="senate:00000000-0000-4000-8000-000000000202",
        chamber="senate",
        filer="Doe, Jane",
        original_filed="2026-05-10",
        amendment_filed="2026-06-01",
    ):
        for filing_id, filed, kind, supersedes in (
            (original_id, original_filed, "ptr", None),
            (amendment_id, amendment_filed, "ptr_amendment", original_id),
        ):
            make_filing(
                conn,
                filing_id=filing_id,
                chamber=chamber,
                filer_name_raw=filer,
                filed_date=filed,
                filing_kind=kind,
                supersedes=supersedes,
                source="senate-efd" if chamber == "senate" else "house-clerk",
                doc_url=f"https://example.invalid/{filing_id}",
            )
            load_filing(
                conn,
                filing_id,
                [
                    make_row(
                        asset_name=f"Asset of {filing_id}",
                        flags=["amendment_unresolved"] if supersedes else [],
                    )
                ],
                parse_status="parsed",
                parser_version="test-1",
                normalization_version="test-1",
            )
        return original_id, amendment_id

    return _make_pair
