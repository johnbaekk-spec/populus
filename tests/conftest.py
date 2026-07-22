"""Shared RUN-1 fixtures: tmp-DB, filing/row factories, no-network guard."""

from __future__ import annotations

import socket

import pytest

from populus.db import connect, init_db
from populus.load import ParsedRow, insert_filing


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
