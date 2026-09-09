"""`scripts/fetch_sic_snapshot.py` — bounded, floor-checked SIC snapshot (B-5).

Loaded by path like the other fetch scripts; the network is a mocked
transport and sleeping is a no-op, so the pacing and retry paths are exercised
without waiting.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_sic_snapshot.py"
SPEC = importlib.util.spec_from_file_location("fetch_sic_snapshot", SCRIPT)
assert SPEC and SPEC.loader
FETCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCH)


def _registry(tmp_path: Path) -> Path:
    p = tmp_path / "company_tickers.json"
    p.write_text(
        json.dumps(
            {
                "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
                "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft Corp"},
                "2": {"cik_str": 100, "ticker": "DUP", "title": "One"},
                "3": {"cik_str": 200, "ticker": "DUP", "title": "Two"},
                "4": {"cik_str": 300, "ticker": "FUND", "title": "A Fund"},
            }
        )
    )
    return p


def _db(tmp_path: Path, tickers: list[str | None]) -> Path:
    p = tmp_path / "populus.db"
    p.unlink(missing_ok=True)
    conn = sqlite3.connect(p)
    conn.execute("CREATE TABLE v_default_transactions (ticker TEXT)")
    conn.executemany("INSERT INTO v_default_transactions VALUES (?)", [(t,) for t in tickers])
    conn.commit()
    conn.close()
    return p


def _mock(monkeypatch, handler):
    real = httpx.Client
    monkeypatch.setattr(FETCH.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_resolution_skips_unmapped_and_ambiguous_tickers_and_dedupes_ciks(tmp_path):
    reg = FETCH.load_registry(_registry(tmp_path))
    ciks, unmapped, ambiguous = FETCH.resolve(["AAPL", "aapl", "DUP", "ZZZZ", "MSFT"], reg)
    assert ciks == ["0000320193", "0000789019"]
    assert (unmapped, ambiguous) == (1, 1)


def test_sic_is_taken_from_submissions_and_a_blank_sic_is_none():
    assert FETCH.extract_sic(b'{"sic": "3571", "name": "APPLE"}') == "3571"
    assert FETCH.extract_sic(b'{"sic": "", "name": "A FUND"}') is None
    assert FETCH.extract_sic(b'{"sic": "abc"}') is None
    with pytest.raises(FETCH.FetchError, match="not valid UTF-8 JSON"):
        FETCH.extract_sic(b"<html>blocked</html>")


def test_only_data_sec_gov_is_contacted_and_unsafe_ciks_are_refused():
    assert FETCH.submissions_url("0000320193") == "https://data.sec.gov/submissions/CIK0000320193.json"
    with pytest.raises(FETCH.FetchError, match="unsafe CIK"):
        FETCH.submissions_url("../etc")


def test_run_writes_the_snapshot_with_provenance_and_paces_requests(monkeypatch, tmp_path):
    sics = {"0000320193": "3571", "0000789019": "7372", "0000000300": ""}
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "data.sec.gov"
        assert request.headers["User-Agent"] == "Populus ops@example.org"
        cik = request.url.path.split("CIK")[1].split(".")[0]
        seen.append(cik)
        return httpx.Response(200, json={"sic": sics[cik]})

    _mock(monkeypatch, handler)
    sleeps: list[float] = []
    prov = FETCH.run(tmp_path / "out", _registry(tmp_path), _db(tmp_path, ["AAPL", "MSFT", "FUND", None, "ZZZZ"]), "ops@example.org", sleep=sleeps.append)
    written = json.loads((tmp_path / "out" / FETCH.FILE_NAME).read_text())
    assert written == {"0000320193": "3571", "0000789019": "7372"}
    assert prov["no_sic"] == 1 and prov["fetched"] == 3 and prov["unmapped_tickers"] == 1
    assert prov["license_id"] == "sec-edgar"
    # one spacing sleep between each pair of requests, none before the first
    assert sleeps == [FETCH.REQUEST_SPACING_SECONDS] * (len(seen) - 1)
    side = json.loads((tmp_path / "out" / "sic-source.json").read_text())
    assert side["file"]["entries"] == 2


def test_a_mostly_failed_fetch_refuses_to_write_rather_than_hollowing_issuer_sic(monkeypatch, tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, content=b"blocked")

    _mock(monkeypatch, handler)
    out = tmp_path / "out"
    with pytest.raises(FETCH.FetchError, match="below the 90% floor"):
        FETCH.run(out, _registry(tmp_path), _db(tmp_path, ["AAPL", "MSFT"]), "ops@example.org", sleep=lambda _s: None)
    assert not (out / FETCH.FILE_NAME).exists()


def test_transient_statuses_are_retried_with_backoff_then_counted_failed(monkeypatch, tmp_path):
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429) if len(calls) < 3 else httpx.Response(200, json={"sic": "3571"})

    _mock(monkeypatch, handler)
    sleeps: list[float] = []
    sics, counters = FETCH.fetch_sics(["0000320193"], "ops@example.org", sleep=sleeps.append)
    assert sics == {"0000320193": "3571"} and counters["fetched"] == 1
    assert sleeps == list(FETCH.RETRY_BACKOFF_SECONDS[:2])


def test_no_resolvable_ticker_is_a_refusal_not_an_empty_snapshot(monkeypatch, tmp_path):
    with pytest.raises(FETCH.FetchError, match="no corpus ticker resolves"):
        FETCH.run(tmp_path / "out", _registry(tmp_path), _db(tmp_path, ["ZZZZ"]), "ops@example.org", sleep=lambda _s: None)


def _wide_registry(tmp_path: Path, n: int) -> Path:
    p = tmp_path / "wide_registry.json"
    p.write_text(json.dumps({str(i): {"cik_str": 1000 + i, "ticker": f"T{i}", "title": f"Issuer {i}"} for i in range(n)}))
    return p


def _coverage_run(monkeypatch, tmp_path: Path, n: int, failing: int, out: Path):
    """n resolvable tickers; the first `failing` CIKs get a hard 403, the rest a SIC."""
    reg = _wide_registry(tmp_path, n)
    db = _db(tmp_path, [f"T{i}" for i in range(n)])
    failing_ciks = {str(1000 + i).zfill(10) for i in range(failing)}

    def handler(request: httpx.Request) -> httpx.Response:
        cik = request.url.path.split("CIK")[1].split(".")[0]
        return httpx.Response(403, content=b"blocked") if cik in failing_ciks else httpx.Response(200, json={"sic": "3571"})

    _mock(monkeypatch, handler)
    return FETCH.run(out, reg, db, "ops@example.org", sleep=lambda _s: None)


def test_the_floor_is_the_actual_90_percent_boundary_and_a_refusal_keeps_the_old_snapshot(monkeypatch, tmp_path):
    """Codex F4: a floor test that only exercises total failure would pass with the
    floor replaced by `fetched == 0`. Pin the boundary from both sides: 89/100 refuses
    (and leaves an existing snapshot byte-identical), 90/100 writes."""
    out = tmp_path / "out"
    out.mkdir()
    prior = b'{"0000000001": "9999"}\n'
    (out / FETCH.FILE_NAME).write_bytes(prior)
    with pytest.raises(FETCH.FetchError, match=r"only 89 of 100 .*below the 90% floor"):
        _coverage_run(monkeypatch, tmp_path, 100, 11, out)
    assert (out / FETCH.FILE_NAME).read_bytes() == prior, "refusal must not touch the existing snapshot"
    prov = _coverage_run(monkeypatch, tmp_path, 100, 10, out)
    assert prov["fetched"] == 90 and prov["http_failed"] == 10
    assert len(json.loads((out / FETCH.FILE_NAME).read_text())) == 90
