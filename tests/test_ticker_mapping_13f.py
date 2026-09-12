"""R3 (refinement 20260910) — the Tier C name-keyed 13F ticker mapping.

The loader is the ONLY path by which a 13F row acquires a ticker, so every
refusal it makes is pinned here: CUSIP-shaped fields, duplicate keys, malformed
or unknown tickers, unverified rows, unknown methods. The draft script's two
owner-facing properties are pinned too: it refuses the newest (open) period,
and the target set is computed over the whole population — a notable-only
tail security below the top-N cut and every holder beyond any aggregate's
top-N cutoff are in it.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from populus.ticker_mapping_13f import (
    SAMPLE_SIZE,
    TickerMappingError,
    derive_sample,
    load_ticker_mapping,
    mapping_key,
    normalize_class,
    normalize_issuer_name,
    normalize_ticker,
)

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "draft_ticker_mapping_13f.py"
KNOWN = ("AAPL", "MSFT", "NVDA", "BRK-B", "BRK-A", "GOOGL", "GOOG")


def _row(**over):
    base = {
        "issuer_name_canonical": "APPLE INC",
        "title_of_class": "COM",
        "ticker": "AAPL",
        "verified_date": "2026-09-10",
        "verified_by": "test",
        "method": "exact-name",
    }
    base.update(over)
    return base


def _write(tmp_path, rows, **top):
    doc = {"version": 1, "rows": rows, **top}
    p = tmp_path / "map.yaml"
    p.write_text(yaml.safe_dump(doc), encoding="utf-8")
    return p


# --- normalization is the identity test --------------------------------------


def test_normalization_folds_suffixes_punctuation_and_case():
    assert normalize_issuer_name("Apple Inc.") == normalize_issuer_name("APPLE INC") == "APPLE"
    assert normalize_issuer_name("NVIDIA CORPORATION") == normalize_issuer_name("NVIDIA CORP") == "NVIDIA"
    assert normalize_issuer_name("AT&T INC") == normalize_issuer_name("AT&T Inc.") == "AT AND T"
    assert normalize_issuer_name("ISHARES TR") == "ISHARES"
    assert normalize_issuer_name("TRUST") == "TRUST"  # never folds to nothing
    assert normalize_class(" Cl  A ") == "CL A" and normalize_class(None) == ""
    assert normalize_ticker("brk.b") == normalize_ticker("BRK-B") == "BRK-B"
    assert mapping_key("Alphabet Inc.", "CL A") == ("ALPHABET", "CL A")


# --- loader refusals -----------------------------------------------------------


def test_a_valid_file_loads_with_its_verification_fields(tmp_path):
    m = load_ticker_mapping(_write(tmp_path, [_row(), _row(issuer_name_canonical="ALPHABET INC", title_of_class="CL A", ticker="GOOGL", method="manual", note="Class A")]), known_tickers=KNOWN)
    assert len(m.rows) == 2
    assert m.by_key()[("ALPHABET", "CL A")].ticker == "GOOGL"
    assert m.tickers() == {"AAPL", "GOOGL"}


@pytest.mark.parametrize("field", ["issuer_name_canonical", "title_of_class", "ticker", "verified_date", "verified_by", "method"])
def test_an_unverified_or_incomplete_row_is_rejected(tmp_path, field):
    with pytest.raises(TickerMappingError, match="missing"):
        load_ticker_mapping(_write(tmp_path, [_row(**{field: None})]))


def test_a_cusip_named_field_is_rejected(tmp_path):
    with pytest.raises(TickerMappingError, match="CUSIP-named"):
        load_ticker_mapping(_write(tmp_path, [_row(cusip="037833100")]))
    with pytest.raises(TickerMappingError, match="CUSIP-named"):
        load_ticker_mapping(_write(tmp_path, [_row(issuer_cusip6="037833")]))


def test_a_cusip_shaped_value_is_rejected_whatever_the_field(tmp_path):
    with pytest.raises(TickerMappingError, match="CUSIP-shaped"):
        load_ticker_mapping(_write(tmp_path, [_row(note="037833100")]))
    with pytest.raises(TickerMappingError, match="CUSIP-shaped"):
        load_ticker_mapping(_write(tmp_path, [_row(issuer_name_canonical="594918104")]))


def test_duplicate_keys_are_rejected_after_normalization(tmp_path):
    with pytest.raises(TickerMappingError, match="share the key"):
        load_ticker_mapping(_write(tmp_path, [_row(), _row(issuer_name_canonical="Apple Inc.", title_of_class="com")]))


@pytest.mark.parametrize("bad", ["aapl1", "TOOLONGX", "AA PL", "", "AAPL$"])
def test_a_malformed_ticker_is_rejected(tmp_path, bad):
    with pytest.raises(TickerMappingError):
        load_ticker_mapping(_write(tmp_path, [_row(ticker=bad)]))


def test_a_ticker_absent_from_the_pinned_snapshot_is_rejected(tmp_path):
    with pytest.raises(TickerMappingError, match="not in the pinned SEC company list"):
        load_ticker_mapping(_write(tmp_path, [_row(ticker="ZZZZ")]), known_tickers=KNOWN)
    # Without a snapshot at hand the check is skipped, never faked.
    assert load_ticker_mapping(_write(tmp_path, [_row(ticker="ZZZZ")])).rows[0].ticker == "ZZZZ"


def test_an_unknown_method_is_rejected(tmp_path):
    with pytest.raises(TickerMappingError, match="method"):
        load_ticker_mapping(_write(tmp_path, [_row(method="guessed")]))


def test_the_shipped_mapping_loads_and_every_row_is_verified():
    m = load_ticker_mapping()
    assert m.company_tickers_sha256 is not None
    for r in m.rows:
        assert r.verified_date and r.verified_by and r.method
    keys = [r.key for r in m.rows]
    assert len(keys) == len(set(keys))


# --- the spot-check sample re-derives from its seed ----------------------------


def test_sample_manifest_rederives_from_the_recorded_seed():
    m = load_ticker_mapping()
    manifest = json.loads((REPO / "src" / "populus" / "ticker_mapping_13f.sample.json").read_text())
    assert manifest["size"] == min(SAMPLE_SIZE, len(m.rows))
    assert derive_sample(m, seed=manifest["seed"]) == manifest["rows"]
    if len(m.rows) > SAMPLE_SIZE:
        assert derive_sample(m, seed=manifest["seed"] + 1) != manifest["rows"]


# --- the draft script: open-period refusal and whole-population targets --------


def _source_fixture(tmp_path):
    """A source-shaped SQLite with the two views the draft reads."""
    db = tmp_path / "src.db"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE v_filer_reported_filings (filing_id TEXT, cik TEXT, period_of_report TEXT);
        CREATE TABLE inst_holdings (
          filing_id TEXT, cik TEXT, period_of_report TEXT, issuer_name_raw TEXT,
          title_of_class TEXT, value_usd INTEGER);
        """
    )
    # Closed quarter 2026-03-31 and an open 2026-06-30. One filing per (cik, period).
    filings = [("0001067983", "2026-03-31"), ("0000000005", "2026-03-31"), ("0000000006", "2026-03-31"),
               ("0000000005", "2026-06-30")] + [(f"{100 + i:010d}", "2026-03-31") for i in range(30)]
    conn.executemany("INSERT INTO v_filer_reported_filings VALUES (?,?,?)",
                     [(f"f:{cik}:{p}", cik, p) for cik, p in filings])
    rows = [
        # Alphabet in two classes — two keys, two candidate tickers.
        ("0000000005", "2026-03-31", "ALPHABET INC", "CL A", 900),
        ("0000000006", "2026-03-31", "ALPHABET INC", "CL C", 800),
        # Apple, big.
        ("0000000005", "2026-03-31", "APPLE INC", "COM", 5000),
        ("0000000006", "2026-03-31", "APPLE INC", "COM", 4000),
        # A notable-only tail security below any top cut (Berkshire = notable).
        ("0001067983", "2026-03-31", "TINY WIDGET CO", "COM", 1),
        # Holders beyond a top-N cutoff: 30 filers of MSFT.
    ] + [(f"{100 + i:010d}", "2026-03-31", "MICROSOFT CORP", "COM", 10) for i in range(30)]
    conn.executemany("INSERT INTO inst_holdings VALUES (?,?,?,?,?,?)",
                     [(f"f:{cik}:{p}", cik, p, n, c, v) for cik, p, n, c, v in rows])
    conn.commit()
    conn.close()
    tickers = tmp_path / "company_tickers.json"
    tickers.write_text(json.dumps({
        "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        "1": {"cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP"},
        "2": {"cik_str": 1652044, "ticker": "GOOGL", "title": "Alphabet Inc."},
        "3": {"cik_str": 1652044, "ticker": "GOOG", "title": "Alphabet Inc."},
    }))
    return db, tickers


def _run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True,
                          cwd=REPO, env={"PYTHONPATH": str(REPO / "src"), "PATH": "/usr/bin:/bin"})


def test_draft_refuses_the_newest_open_period(tmp_path):
    db, tickers = _source_fixture(tmp_path)
    r = _run("draft", "--inst-db", db, "--period", "2026-06-30", "--company-tickers", tickers, "--out", tmp_path / "d.json")
    assert r.returncode == 2 and "newest period" in r.stderr
    assert not (tmp_path / "d.json").exists()


def test_draft_targets_are_computed_over_the_whole_population(tmp_path):
    db, tickers = _source_fixture(tmp_path)
    out = tmp_path / "d.json"
    r = _run("draft", "--inst-db", db, "--period", "2026-03-31", "--company-tickers", tickers, "--out", out, "--top", "2")
    assert r.returncode == 0, r.stderr
    doc = json.loads(out.read_text())
    by_key = {(x["name_key"], x["class_key"]): x for x in doc["rows"]}
    assert doc["population"] == 5
    # Top 2 by value: Apple (9000) and Alphabet CL A (900).
    assert by_key[("APPLE", "COM")]["in_top"] and by_key[("ALPHABET", "CL A")]["in_top"]
    assert not by_key[("MICROSOFT", "COM")]["in_top"]
    # The notable-only tail security (value 1) is in the target set anyway.
    assert by_key[("TINY WIDGET", "COM")]["in_target"] and by_key[("TINY WIDGET", "COM")]["notable_holders"] == 1
    # Holders are counted over the whole population, not an aggregate top-N.
    assert by_key[("MICROSOFT", "COM")]["holders"] == 30
    # Candidates: two classes of one issuer → the same two-ticker candidate set.
    assert by_key[("ALPHABET", "CL A")]["status"] == "multi-ticker"
    assert by_key[("ALPHABET", "CL A")]["candidates"] == by_key[("ALPHABET", "CL C")]["candidates"]
    assert by_key[("APPLE", "COM")]["status"] == "single"
    assert by_key[("TINY WIDGET", "COM")]["status"] == "no-match"

    # Promote: Apple by exact-name, Alphabet A by the recorded class rule,
    # Tiny Widget unmapped; the manifest re-derives; the loader accepts the file.
    r = _run("promote", "--draft", out, "--company-tickers", tickers, "--verified-by", "test agent",
             "--date", "2026-09-10", "--seed", "7", "--out-yaml", tmp_path / "m.yaml",
             "--out-sample", tmp_path / "s.json", "--out-report", tmp_path / "r.md")
    assert r.returncode == 0, r.stderr
    m = load_ticker_mapping(tmp_path / "m.yaml", known_tickers=("AAPL", "MSFT", "GOOGL", "GOOG"))
    got = {k: v.ticker for k, v in m.by_key().items()}
    # Alphabet CL C (800) is outside `--top 2` and not notable-held, so it is
    # not a target row and is NOT promoted — the target set is the boundary.
    assert got == {("APPLE", "COM"): "AAPL", ("ALPHABET", "CL A"): "GOOGL"}
    # Rule-accepted rows are never `manual`: that label is reserved for the
    # per-row review pass.
    assert {v.method for v in m.rows} == {"exact-name", "class-resolved"}
    sample = json.loads((tmp_path / "s.json").read_text())
    assert sample["rows"] == derive_sample(m, seed=7)
    report = (tmp_path / "r.md").read_text()
    assert "TINY WIDGET" in report and "Verified rows shipped" in report


def test_tier_c_key_normalization_matches_the_shared_fixture():
    """The TS half (dashboard/src/lib/format.ts) reads the SAME fixture."""
    fixture = json.loads((REPO / "tests" / "fixtures" / "refinement" / "tier_c_keys.json").read_text())
    assert len(fixture["cases"]) >= 8
    for c in fixture["cases"]:
        assert mapping_key(c["name"], c["cls"]) == (c["name_key"], c["class_key"]), c
