#!/usr/bin/env python
"""C1 probe (refinement 20260910): can a (CUSIP, ticker) pair be recovered from
what Public Filings publishes?

The property under test — owner decision 2026-09-11, counsel concern:

    For every security whose (issuer_name, title_of_class) resolves to a
    reviewed ticker, NO published artifact exposes its CUSIP, or any key
    derived from its CUSIP, in a way that can be joined to that ticker.

Why the probe counts occurrences rather than walking join paths one by one: the
reviewed mapping itself is published (``agg_ticker_keys``, the ticker pages), so
the (issuer name, class) -> ticker link is available in every published build by
construction. Any artifact that also carries the security's CUSIP — or a key
computed from it — therefore completes the pair through SOME shared column. The
probe is deliberately a SUPERSET of the individual join paths: a withheld token
appearing ANYWHERE in a published byte stream counts as a recovered pair, no
matter which column, row or file it sits in. A probe that finds zero has ruled
out same-row, same-position_key, same-issuer_key, same-name+class and every
other shared-column join at once.

Tokens searched, per withheld security:

* the CUSIP itself (9 characters, token-bounded);
* ``cusip6:<block>`` — the CUSIP-6 issuer key;
* ``sec:prov:<hex32>`` — ``sha256({"id_type":"cusip","value":<cusip>})[:32]``,
  the unsalted provisional security id (identity/registry.py), recomputable by
  anyone holding a CUSIP list.

A sibling CUSIP inside a withheld issuer block counts too: it carries the
block, which the shared issuer key or issuer name joins to the ticker.

Databases are scanned as RAW BYTES, so a value left behind in a freed page or a
stale index entry is caught, not only live rows.

Usage:
    uv run python scripts/cusip_join_probe.py \
        --truth <serving-or-source.db> --mapping-from-package \
        --artifact dist=<dist dir> --artifact inst_agg=<inst_agg.db> ... \
        [--json <out.json>]

Exit status is 1 when any pair is recovered from an artifact that is NOT listed
in --allow-residual, so the gate fails closed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from populus.identity.registry import anchor, provisional_security_id  # noqa: E402
from populus.inst_redaction import close_withheld_cusips  # noqa: E402

CUSIP_RE = re.compile(rb"(?<![0-9A-Za-z])[0-9A-Z]{9}(?![0-9A-Za-z])")
#: An ISIN carries the CUSIP as its middle nine characters ("US0378331005"), so
#: the token-bounded CUSIP_RE above cannot see it — the nine characters are
#: flanked by alphanumerics and both lookarounds reject the match. The PRODUCER
#: extracts it (`inst_redaction._ISIN_RE`), so a probe that does not would
#: report zero on a published ISIN that pairs perfectly well.
ISIN_RE = re.compile(rb"(?<![0-9A-Za-z])[A-Z]{2}([0-9A-Z]{9})[0-9](?![0-9A-Za-z])")
HEX32_RE = re.compile(rb"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])")
BLOCK_KEY_RE = re.compile(rb"cusip6:([0-9A-Z]{6})")


def truth_pairs(truth_db: Path) -> tuple[dict[str, str], dict[str, set[str]]]:
    """``(cusip -> ticker, block -> tickers)`` over the PRODUCER's closed
    withheld set — every CUSIP the producer withholds, not a subset of it.

    The truth source is INTERNAL data (the source snapshot, or a pre-change
    serving database): the probe must know what to look for even after the
    published files stop carrying it.

    The closure comes from `inst_redaction.close_withheld_cusips`, the same
    function the producer plans with. It used to be re-derived here with ONE
    hop — a mapped CUSIP plus its CUSIP-6 siblings — which silently omitted the
    shared-``security_id`` edge and everything reachable through it. That made
    the probe's population NARROWER than the producer's, so a token leaked
    through a security-id edge would have been published while the probe
    reported zero pairs. The probe is the release's evidence for the
    withholding property; it has to look for all of it.
    """
    import sqlite3

    conn = sqlite3.connect(f"file:{truth_db}?mode=ro", uri=True)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "serving_filer_rows" in tables:
        sql = ("SELECT issuer_name, title_of_class, cusip, security_id"
               " FROM serving_filer_rows WHERE cusip IS NOT NULL GROUP BY 1,2,3,4")
    elif "inst_holdings" in tables:
        sql = ("SELECT issuer_name_raw, title_of_class, cusip, security_id"
               " FROM inst_holdings WHERE cusip IS NOT NULL GROUP BY 1,2,3,4")
    else:
        raise SystemExit(f"{truth_db} carries neither serving_filer_rows nor inst_holdings")
    closure = close_withheld_cusips(conn.execute(sql))
    conn.close()
    blocks: dict[str, set[str]] = defaultdict(set)
    for cusip, tickers in closure.tickers.items():
        blocks[cusip[:6]] |= set(tickers)
    # Every member of the closed set is reportable. A member reached only by an
    # edge carries the label that reached it; one with no label at all still
    # has to be LOOKED FOR, so it is reported against its block.
    mapped: dict[str, str] = {}
    for cusip, tickers in closure.tickers.items():
        label = sorted(tickers) or sorted(blocks.get(cusip[:6], ()))
        mapped[cusip] = label[0] if label else f"cusip6:{cusip[:6]}"
    return mapped, blocks


def scan(data: bytes, cusips: dict[str, str], sids: dict[str, str],
         blocks: dict[str, set[str]]) -> dict[str, set[str]]:
    """Pairs recovered from one byte stream: ``cusip-or-block -> {tickers}``."""
    found: dict[str, set[str]] = defaultdict(set)
    for regex, group in ((CUSIP_RE, 0), (ISIN_RE, 1)):
        for m in regex.finditer(data):
            value = m.group(group).decode("ascii")
            ticker = cusips.get(value)
            if ticker is not None:
                found[value].add(ticker)
    for m in HEX32_RE.finditer(data):
        cusip = sids.get(m.group(0).decode("ascii"))
        if cusip is not None:
            found[cusip].add(cusips[cusip])
    for m in BLOCK_KEY_RE.finditer(data):
        block = m.group(1).decode("ascii")
        if block in blocks:
            found[block] |= blocks[block]
    return found


def scan_path(path: Path, *args) -> tuple[dict[str, set[str]], dict[str, int]]:
    """Scan a file or, for a directory, every file under it."""
    pairs: dict[str, set[str]] = defaultdict(set)
    per_file: dict[str, int] = {}
    files = sorted(p for p in path.rglob("*") if p.is_file()) if path.is_dir() else [path]
    for file in files:
        found = scan(file.read_bytes(), *args)
        if found:
            per_file[str(file.relative_to(path) if path.is_dir() else file.name)] = sum(
                len(v) for v in found.values()
            )
            for key, tickers in found.items():
                pairs[key] |= tickers
    return pairs, per_file


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--artifact", action="append", default=[], metavar="NAME=PATH",
                    help="a published artifact: a file or a directory scanned recursively")
    ap.add_argument("--allow-residual", action="append", default=[], metavar="NAME",
                    help="artifact whose pairs are REPORTED but do not fail the probe")
    ap.add_argument("--json", type=Path)
    ap.add_argument("--top", type=int, default=8)
    args = ap.parse_args(argv)

    cusips, blocks = truth_pairs(args.truth)
    sids = {provisional_security_id(anchor("cusip", c))[len("sec:prov:"):]: c for c in cusips}
    print(f"truth: {len(cusips)} withheld CUSIPs in {len(blocks)} reviewed-ticker "
          f"CUSIP-6 blocks (probe searches CUSIP, cusip6:<block> and sec:prov:<hex32>)")

    report: dict[str, dict] = {}
    failures = 0
    for spec in args.artifact:
        name, _, raw_path = spec.partition("=")
        path = Path(raw_path)
        if not path.exists():
            print(f"{name}: MISSING {path}")
            return 2
        pairs, per_file = scan_path(path, cusips, sids, blocks)
        count = sum(len(v) for v in pairs.values())
        residual = name in args.allow_residual
        status = "PASS" if count == 0 else ("RESIDUAL" if residual else "FAIL")
        if count and not residual:
            failures += count
        print(f"{name}: {count} (cusip|cusip6, ticker) pairs recoverable — {status}")
        for file, n in sorted(per_file.items(), key=lambda kv: -kv[1])[: args.top]:
            print(f"    {n:>9} {file}")
        report[name] = {
            "pairs": count,
            "keys": len(pairs),
            "status": status,
            "files": dict(sorted(per_file.items(), key=lambda kv: -kv[1])[: args.top]),
            "examples": [
                [key, sorted(tickers)[0]] for key, tickers in sorted(pairs.items())[:5]
            ],
        }
    if args.json:
        args.json.write_text(json.dumps(
            {"withheld_cusips": len(cusips), "blocks": len(blocks), "artifacts": report},
            indent=1) + "\n")
    print(f"TOTAL failing pairs: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
