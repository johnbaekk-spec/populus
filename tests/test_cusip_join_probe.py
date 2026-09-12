"""`scripts/cusip_join_probe.py` is the release's EVIDENCE for C1 — the
"0 published CUSIP-ticker pairs" measurement. These are its negative controls:
a probe that cannot fail cannot be read as a pass.

Both cases are ones the probe missed before this round's review:

* a CUSIP reached only through a shared ``security_id`` (the producer closes
  over that edge; the probe used to close over the CUSIP-6 block alone), and the
  further block that CUSIP then carries;
* a CUSIP published inside an ISIN, where the token-bounded ``CUSIP_RE``
  lookarounds reject the match even though the producer extracts it.
"""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

from populus.identity.registry import anchor, provisional_security_id

REPO = Path(__file__).resolve().parents[1]
MAPPED_CUSIP = "88579Y101"     # 3M CO / COM -> MMM in the reviewed mapping
BLOCK_SIBLING = "88579Y200"    # same CUSIP-6 block
FAR_CUSIP = "594918104"        # a different block, reached only by security_id
FAR_SIBLING = "594918302"      # ...and the block that one carries
UNRELATED = "123456789"        # no reviewed row names it


@pytest.fixture(scope="module")
def probe():
    spec = importlib.util.spec_from_file_location(
        "cusip_join_probe", REPO / "scripts" / "cusip_join_probe.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def truth_db(tmp_path):
    """A source snapshot whose withheld set can ONLY be closed by following both
    edges: the mapped row shares a security_id with a differently named issuer
    in an unrelated block."""
    shared = provisional_security_id(anchor("cusip", MAPPED_CUSIP))
    path = tmp_path / "truth.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE inst_holdings (issuer_name_raw TEXT, title_of_class TEXT,"
        " cusip TEXT, security_id TEXT)"
    )
    conn.executemany(
        "INSERT INTO inst_holdings VALUES (?, ?, ?, ?)",
        [
            ("3M CO", "COM", MAPPED_CUSIP, shared),
            ("3M CO", "NOTE 2.25% 2026", BLOCK_SIBLING, None),
            ("RENAMED HOLDCO", "COM", FAR_CUSIP, shared),
            ("RENAMED HOLDCO", "CLASS B", FAR_SIBLING, None),
            ("SOME OTHER CORP", "COM", UNRELATED, None),
        ],
    )
    conn.commit()
    conn.close()
    return path


def test_truth_covers_the_whole_producer_closure_including_the_security_id_edge(
    probe, truth_db
):
    cusips, blocks = probe.truth_pairs(truth_db)
    assert MAPPED_CUSIP in cusips, "the mapped row"
    assert BLOCK_SIBLING in cusips, "the CUSIP-6 block edge"
    assert FAR_CUSIP in cusips, "the shared-security_id edge"
    assert FAR_SIBLING in cusips, "the block the security-id edge reached"
    assert UNRELATED not in cusips, "the closure is closed, not everything"
    assert cusips[FAR_CUSIP] == "MMM", "the label travels the edge it was reached by"
    assert "88579Y" in blocks and "594918" in blocks


def test_a_token_reached_only_through_the_security_id_edge_is_DETECTED(probe, truth_db):
    """The killing mutant for the closure fix: with the old single-hop truth,
    this planted leak scanned CLEAN."""
    cusips, blocks = probe.truth_pairs(truth_db)
    sids: dict[str, str] = {}
    leaked = f'{{"issuer":"RENAMED HOLDCO","id":"{FAR_CUSIP}"}}'.encode()
    found = probe.scan(leaked, cusips, sids, blocks)
    assert found, "a published CUSIP in the withheld closure was not detected"
    assert found[FAR_CUSIP] == {"MMM"}


def test_a_cusip_published_inside_an_ISIN_is_DETECTED(probe, truth_db):
    """CUSIP_RE's token boundaries reject a CUSIP flanked by the ISIN's country
    code and check digit. The producer extracts it, so the probe must too."""
    cusips, blocks = probe.truth_pairs(truth_db)
    isin = f"US{MAPPED_CUSIP}5".encode()
    assert not probe.CUSIP_RE.search(isin), "the premise: the plain scan cannot see it"
    found = probe.scan(b'{"isin":"' + isin + b'"}', cusips, {}, blocks)
    assert found[MAPPED_CUSIP] == {"MMM"}


def test_a_clean_stream_reports_nothing(probe, truth_db):
    """The other half of a usable probe: it must be capable of zero."""
    cusips, blocks = probe.truth_pairs(truth_db)
    clean = f'{{"issuer":"SOME OTHER CORP","id":"{UNRELATED}","key":"pos:41"}}'.encode()
    assert probe.scan(clean, cusips, {}, blocks) == {}
