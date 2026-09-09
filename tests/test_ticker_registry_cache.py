"""`scripts/fetch_ticker_registry.py` — the fetch invariants that stop a broken
download from becoming a quietly half-mapped site (roadmap B15 / TD-7).

Mirrors `test_legislators_cache.py`: the script is loaded by path (it is not a
package), validation is exercised on bytes, and the network is never touched.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_ticker_registry.py"
SPEC = importlib.util.spec_from_file_location("fetch_ticker_registry", SCRIPT)
assert SPEC and SPEC.loader
FETCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCH)


def _registry(count: int, *, hollow: bool = False) -> bytes:
    entries = {}
    for i in range(count):
        if hollow:
            entries[str(i)] = {"cik_str": None, "ticker": "", "title": ""}
        else:
            entries[str(i)] = {"cik_str": 1000 + i, "ticker": f"T{i}", "title": f"Issuer {i}"}
    return json.dumps(entries).encode("utf-8")


def test_a_populated_registry_passes_and_reports_its_usable_count():
    assert FETCH.validate_registry(_registry(6000)) == 6000


def test_a_truncated_registry_is_refused():
    """A short read that is still valid JSON — the failure the floor exists for."""
    with pytest.raises(FETCH.FetchError, match="below the 5000 floor"):
        FETCH.validate_registry(_registry(120))


def test_hollow_entries_do_not_count_toward_the_floor():
    """The dashboard's parser skips entries without an integer cik_str, a ticker
    and a title, so a document full of them would resolve nothing."""
    with pytest.raises(FETCH.FetchError, match="usable entries"):
        FETCH.validate_registry(_registry(9000, hollow=True))


def test_an_html_error_page_is_refused_rather_than_cached():
    with pytest.raises(FETCH.FetchError, match="not valid UTF-8 JSON"):
        FETCH.validate_registry(b"<html><body>403 Forbidden</body></html>")


def test_a_json_list_is_refused_the_parser_wants_an_object():
    with pytest.raises(FETCH.FetchError, match="expected a JSON object"):
        FETCH.validate_registry(b"[]")


def test_the_source_is_sec_only_and_the_user_agent_is_the_sec_form():
    assert FETCH.SOURCE_URL == "https://www.sec.gov/files/company_tickers.json"
    assert FETCH.ALLOWED_HOST == "www.sec.gov"
    assert FETCH.user_agent("ops@example.org") == "Populus ops@example.org"


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_contact_is_refused_instead_of_building_an_illegal_header(blank):
    with pytest.raises(FETCH.FetchError, match="no contact address"):
        FETCH.user_agent(blank)


def test_an_empty_contact_env_var_falls_back_to_the_default(monkeypatch, tmp_path):
    captured: dict = {}

    def _capture(dest, contact):
        captured["contact"] = contact
        return {"file": {"usable_entries": 1, "bytes": 2}}

    monkeypatch.setattr(FETCH, "fetch", _capture)
    monkeypatch.setenv(FETCH.CONTACT_ENV, "")
    assert FETCH.main(["--dest", str(tmp_path)]) == 0
    assert captured["contact"] == FETCH.DEFAULT_CONTACT
    monkeypatch.setenv(FETCH.CONTACT_ENV, "ops@example.org")
    assert FETCH.main(["--dest", str(tmp_path)]) == 0
    assert captured["contact"] == "ops@example.org"


def test_fetch_writes_atomically_and_records_provenance(monkeypatch, tmp_path):
    body = _registry(6000)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == FETCH.ALLOWED_HOST
        assert request.headers["User-Agent"] == "Populus ops@example.org"
        return httpx.Response(200, content=body)

    real_client = httpx.Client

    def client_factory(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(**kwargs)

    monkeypatch.setattr(FETCH.httpx, "Client", client_factory)
    prov = FETCH.fetch(tmp_path, "ops@example.org")
    assert (tmp_path / FETCH.FILE_NAME).read_bytes() == body
    assert prov["license_id"] == "sec-edgar"
    assert prov["file"]["usable_entries"] == 6000
    written = json.loads((tmp_path / "registry-source.json").read_text())
    assert written["file"]["sha256"] == prov["file"]["sha256"]
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".company_tickers")], "no temp file survives"


def test_a_non_200_leaves_an_existing_good_cache_untouched(monkeypatch, tmp_path):
    good = _registry(6000)
    (tmp_path / FETCH.FILE_NAME).write_bytes(good)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, content=b"busy")

    real_client = httpx.Client
    monkeypatch.setattr(
        FETCH.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    with pytest.raises(FETCH.FetchError, match="HTTP 503"):
        FETCH.fetch(tmp_path, "ops@example.org")
    assert (tmp_path / FETCH.FILE_NAME).read_bytes() == good
