"""`scripts/fetch_legislators_cache.py` — the validation that guards the cache.

Network is never touched here: every test drives `validate_yaml`, which is the
sole gate between a response body and the cache directory the `members` ingest
reads. A body that parses but carries no bioguide ids would ingest as an empty
roster and silently re-create the 2026-08-07 outage, so "parsed fine" is not
the bar — "carries a populated roster" is.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "fetch_legislators_cache.py"
SPEC = importlib.util.spec_from_file_location("fetch_legislators_cache", SCRIPT)
assert SPEC and SPEC.loader
FETCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCH)


def _roster(count: int, *, with_id: bool = True) -> bytes:
    entries = []
    for i in range(count):
        if with_id:
            entries.append(f"- id:\n    bioguide: X{i:06d}\n  name:\n    official_full: N{i}\n")
        else:
            entries.append(f"- name:\n    official_full: N{i}\n")
    return "".join(entries).encode("utf-8")


def test_a_populated_roster_passes_and_reports_its_count():
    assert FETCH.validate_yaml("legislators-current.yaml", _roster(450), 400) == 450


def test_a_truncated_roster_is_refused():
    """The failure this floor exists for: a short read that is still valid YAML."""
    with pytest.raises(FETCH.FetchError, match="below the 400 floor"):
        FETCH.validate_yaml("legislators-current.yaml", _roster(12), 400)


def test_entries_without_a_bioguide_do_not_count_toward_the_floor():
    """The ingest's loader SKIPS bioguide-less entries rather than failing, so a
    document full of them would load an empty roster and unjoin every filing.
    Counting entries instead of bioguide ids would let that through."""
    with pytest.raises(FETCH.FetchError, match="carry a bioguide id"):
        FETCH.validate_yaml("legislators-current.yaml", _roster(900, with_id=False), 400)


def test_an_html_error_page_is_refused_rather_than_cached():
    with pytest.raises(FETCH.FetchError, match="expected a YAML list"):
        FETCH.validate_yaml(
            "legislators-current.yaml", b"<html><body>404: Not Found</body></html>", 400
        )


def test_invalid_yaml_is_refused():
    with pytest.raises(FETCH.FetchError, match="not valid UTF-8 YAML"):
        FETCH.validate_yaml("legislators-current.yaml", b"- id:\n  bioguide: [unclosed\n", 400)


def test_both_source_files_are_fetched_with_floors_that_a_stub_cannot_clear():
    """A cache missing either file leaves the ingest with a partial roster: the
    loader reads BOTH names and upserts historical-then-current."""
    assert set(FETCH.FILES) == {
        "legislators-current.yaml",
        "legislators-historical.yaml",
    }
    assert all(floor > 0 for floor in FETCH.FILES.values())


def test_the_user_agent_identifies_the_application_and_a_contact():
    assert FETCH.user_agent("ops@example.org") == "Populus ops@example.org"


def test_an_unsafe_ref_is_refused_before_any_request_is_built(tmp_path):
    for bad in ("../main", "a/b", ".hidden", ""):
        with pytest.raises(FETCH.FetchError, match="unsafe ref"):
            FETCH.fetch(tmp_path, bad, "ops@example.org")
