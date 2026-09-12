#!/usr/bin/env python3
"""Tier C 13F ticker mapping — draft candidates, then promote verified rows (R3).

    uv run python scripts/draft_ticker_mapping_13f.py draft \\
        --inst-db <inst source snapshot> --period 2026-03-31 \\
        --company-tickers data-cache/inst/registry/company_tickers.json \\
        --out <draft.json> [--top 2000]

    uv run python scripts/draft_ticker_mapping_13f.py promote \\
        --draft <draft.json> --company-tickers <company_tickers.json> \\
        --verified-by "<who>" --date 2026-09-10 --seed 20260910 \\
        --out-yaml src/populus/ticker_mapping_13f.yaml \\
        --out-sample src/populus/ticker_mapping_13f.sample.json \\
        --out-report docs/design/TICKER-MAPPING-13F-COVERAGE.md

DRAFT reads SECURITY-GRAIN holdings from the composed institutional source
(`v_filer_reported_holdings`: cik, issuer_name_raw, title_of_class, value_usd
per holding) — never `inst_agg.db`, whose issuer rows collapse classes and
truncate holders. `--period` must be a CLOSED quarter: the newest period in
the source is refused. The population is every normalized
`(issuer name, title of class)` key with its value summed over ALL filers; the
target set is the top `--top` keys by that sum plus every key held by any
`notable` registry manager, both computed over the whole population. Each key
gets its candidate(s) by exact normalized-name match against the SEC company
list. A draft NEVER ships: nothing here writes the packaged mapping.

PROMOTE applies the automated verification rules row by row over the target
set and writes only the rows that pass, each with `verified_date`,
`verified_by` and `method`; everything else stays UNMAPPED (no ticker, never a
guess) and is counted in the coverage report. The rules, exactly:

  exact-name   the normalized name matches exactly ONE SEC issuer (one CIK),
               that issuer lists exactly ONE ticker, and the class is a
               common-equity class (COM / COMMON / ORD / SHS / CL A … / ADR);
  class-resolved  the issuer lists several tickers and either (a) exactly one
               is un-hyphenated beside preferred-series listings, or (b) the
               small recorded issuer/class table below (`MANUAL_CLASS_RULES`)
               names the line; the row's `note` says which. A rule whose ticker
               is absent from the SEC list is dropped and reported.
  manual       reserved for rows a person, or the named agent's per-row
               review pass, checked individually (identity AND class against
               the SEC canonical name); the promote step never emits it.

The 50-row spot-check manifest is drawn with the recorded seed over the
promoted rows, so the owner's pre-merge check re-derives on any machine.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from populus.manager_registry import load_manager_registry  # noqa: E402
from populus.ticker_mapping_13f import (  # noqa: E402
    SAMPLE_SIZE,
    TICKER_RE,
    derive_sample,
    issuer_index,
    load_company_tickers,
    load_ticker_mapping,
    normalize_class,
    normalize_issuer_name,
    sha256_of,
)

#: A class names the issuer's common equity (or its ADR) when EVERY token of
#: the normalized class is in this vocabulary and at least one is an equity
#: word. Measured on the 2026-03-31 draft: COM, COMMON STOCK, COM NEW, CMN,
#: EQUITY, SHS, ORD SHS, USD CL A ORD SHS, CAP STK CL A, CL A COM, CLASS A COM,
#: SPONSORED ADS, SPON ADR NEW, DEPOSITORY RECEIPT … A fund share class
#: ("CORE S P500 ETF", "TR UNIT"), an option ("EQUITY OPTION"), a preferred
#: ("PFD SER A") or a note carries a token outside it and never passes.
_EQUITY_WORDS = frozenset({
    "COM", "COMMON", "CMN", "STK", "STOCK", "SHS", "SH", "SHARES", "ORD", "ORDINARY",
    "EQUITY", "ADR", "ADS", "ADRS", "RECEIPT", "RECEIPTS",
})
_COMMON_FILLER = frozenset({
    "CL", "CLASS", "A", "B", "C", "NEW", "USD", "CAP", "SER", "SERIES", "SPONSORED",
    "UNSPONSORED", "SPON", "SP", "DEPOSITORY", "DEPOSITARY", "AMERICAN", "DEP",
    "VOTING", "NON", "PAR", "VALUE", "NPV", "LTD", "REIT", "REG", "REGISTERED",
    "1", "2", "3", "I", "II", "III",
})

#: The ONLY class-resolution knowledge this run adds by hand, and every entry
#: says what it asserts. Keys are (normalized issuer name, class regex); the
#: value is the SEC-spelled ticker. A rule only ships when the SEC list carries
#: BOTH the issuer name and the ticker under one CIK — otherwise it is dropped
#: and reported. These are listing conventions any exchange page confirms; they
#: are recorded as `manual` (agent run), not as a human review.
MANUAL_CLASS_RULES: tuple[tuple[str, str, str, str], ...] = (
    ("ALPHABET", r"^CL(ASS)? A\b|^CAP STK CL A", "GOOGL", "Alphabet Class A (voting) trades as GOOGL"),
    ("ALPHABET", r"^CL(ASS)? C\b|^CAP STK CL C", "GOOG", "Alphabet Class C (non-voting) trades as GOOG"),
    ("BERKSHIRE HATHAWAY", r"^CL(ASS)? A\b", "BRK-A", "Berkshire Class A trades as BRK-A (BRK.A)"),
    ("BERKSHIRE HATHAWAY", r"^CL(ASS)? B\b", "BRK-B", "Berkshire Class B trades as BRK-B (BRK.B)"),
    ("FOX", r"^CL(ASS)? A\b", "FOXA", "Fox Corp Class A trades as FOXA"),
    ("FOX", r"^CL(ASS)? B\b", "FOX", "Fox Corp Class B trades as FOX"),
    ("NEWS", r"^CL(ASS)? A\b", "NWSA", "News Corp Class A trades as NWSA"),
    ("NEWS", r"^CL(ASS)? B\b", "NWS", "News Corp Class B trades as NWS"),
    ("ZILLOW GROUP", r"^CL(ASS)? A\b", "ZG", "Zillow Class A trades as ZG"),
    ("ZILLOW GROUP", r"^CL(ASS)? C\b", "Z", "Zillow Class C trades as Z"),
    ("UNDER ARMOUR", r"^CL(ASS)? A\b", "UAA", "Under Armour Class A trades as UAA"),
    ("UNDER ARMOUR", r"^CL(ASS)? C\b", "UA", "Under Armour Class C trades as UA"),
    ("LENNAR", r"^CL(ASS)? A\b", "LEN", "Lennar Class A trades as LEN"),
    ("LENNAR", r"^CL(ASS)? B\b", "LEN-B", "Lennar Class B trades as LEN-B"),
    ("HEICO", r"^COM( |$)|^COMMON", "HEI", "HEICO common trades as HEI"),
    ("HEICO", r"^CL(ASS)? A\b", "HEI-A", "HEICO Class A trades as HEI-A"),
    ("BROWN FORMAN", r"^CL(ASS)? A\b", "BF-A", "Brown-Forman Class A trades as BF-A"),
    ("BROWN FORMAN", r"^CL(ASS)? B\b", "BF-B", "Brown-Forman Class B trades as BF-B"),
    ("LIBERTY BROADBAND", r"^CL(ASS)? A\b", "LBRDA", "Liberty Broadband Series A trades as LBRDA"),
    ("LIBERTY BROADBAND", r"^CL(ASS)? C\b", "LBRDK", "Liberty Broadband Series C trades as LBRDK"),
    ("MOOG", r"^CL(ASS)? A\b", "MOG-A", "Moog Class A trades as MOG-A"),
    ("MOOG", r"^CL(ASS)? B\b", "MOG-B", "Moog Class B trades as MOG-B"),
)


class DraftError(RuntimeError):
    pass


# --- draft --------------------------------------------------------------------


def _registry_notable_ciks() -> frozenset[str]:
    return frozenset(
        r.cik_padded for r in load_manager_registry().rows if r.notable and r.status == "active"
    )


def draft(args: argparse.Namespace) -> int:
    conn = sqlite3.connect(f"file:{args.inst_db}?mode=ro&immutable=1", uri=True)
    try:
        (newest,) = conn.execute(
            "SELECT MAX(period_of_report) FROM v_filer_reported_filings"
        ).fetchone()
        if newest is None:
            raise DraftError("source carries no filings")
        if args.period >= newest:
            raise DraftError(
                f"--period {args.period} is the newest period in the source ({newest}) —"
                " an open quarter is under-reported by construction; pick a closed one"
            )
        (present,) = conn.execute(
            "SELECT COUNT(*) FROM v_filer_reported_filings WHERE period_of_report=?",
            (args.period,),
        ).fetchone()
        if not present:
            raise DraftError(f"--period {args.period} has no filings in the source")

        notable = _registry_notable_ciks()
        keys: dict[tuple[str, str], dict] = {}
        # Filings first (period index), then holdings by filing id: the same
        # rows `v_filer_reported_holdings` yields, without the planner's full
        # scan of the holdings table (measured: SCAN h on the 21 GB store).
        for name_raw, class_raw, cik, value, count in conn.execute(
            "SELECT h.issuer_name_raw, h.title_of_class, h.cik, SUM(h.value_usd), COUNT(*)"
            " FROM v_filer_reported_filings f"
            " CROSS JOIN inst_holdings h ON h.filing_id=f.filing_id"
            " WHERE f.period_of_report=?"
            " GROUP BY h.issuer_name_raw, h.title_of_class, h.cik",
            (args.period,),
        ):
            key = (normalize_issuer_name(name_raw), normalize_class(class_raw))
            bucket = keys.setdefault(
                key,
                {
                    "names": collections.Counter(),
                    "classes": collections.Counter(),
                    "value_usd": 0,
                    "holders": set(),
                    "notable_holders": set(),
                    "rows": 0,
                },
            )
            bucket["names"][" ".join(str(name_raw).split())] += int(count)
            bucket["classes"][" ".join(str(class_raw or "").split())] += int(count)
            if value is not None:
                bucket["value_usd"] += int(value)
            bucket["holders"].add(cik)
            if cik in notable:
                bucket["notable_holders"].add(cik)
            bucket["rows"] += int(count)
    finally:
        conn.close()

    ranked = sorted(keys.items(), key=lambda kv: (-kv[1]["value_usd"], kv[0]))
    top_keys = {k for k, _ in ranked[: args.top]}
    notable_keys = {k for k, b in keys.items() if b["notable_holders"]}
    target = top_keys | notable_keys

    entries = load_company_tickers(args.company_tickers)
    index = issuer_index(entries)
    rows = []
    for key, bucket in ranked:
        norm_name, norm_class = key
        match = index.get(norm_name, {})
        if not match:
            status = "no-match"
        elif len(match) > 1:
            status = "ambiguous-issuer"
        elif len(next(iter(match.values()))) == 1:
            status = "single"
        else:
            status = "multi-ticker"
        rows.append(
            {
                "issuer_name_canonical": bucket["names"].most_common(1)[0][0],
                "title_of_class": bucket["classes"].most_common(1)[0][0],
                "name_key": norm_name,
                "class_key": norm_class,
                "value_usd": bucket["value_usd"],
                "holders": len(bucket["holders"]),
                "notable_holders": len(bucket["notable_holders"]),
                "rows": bucket["rows"],
                "in_top": key in top_keys,
                "in_target": key in target,
                "status": status,
                "candidates": [
                    {"cik": cik, "tickers": sorted(tickers)} for cik, tickers in sorted(match.items())
                ],
            }
        )
    out = {
        "schema": "ticker-mapping-13f-draft/v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period": args.period,
        "newest_period_in_source": newest,
        "source_db": str(args.inst_db),
        "company_tickers": str(args.company_tickers),
        "company_tickers_sha256": sha256_of(args.company_tickers),
        "top": args.top,
        "population": len(keys),
        "target": len(target),
        "target_top": len(top_keys),
        "target_notable_only": len(notable_keys - top_keys),
        "notable_ciks": len(notable),
        "rows": rows,
    }
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(
        f"draft: period {args.period} · population {len(keys):,} keys · target {len(target):,}"
        f" (top {len(top_keys):,} ∪ notable-held {len(notable_keys):,}) → {args.out}"
    )
    return 0


# --- promote ------------------------------------------------------------------


def _is_common_class(class_key: str) -> bool:
    if not class_key:
        return False
    tokens = class_key.split()
    if not all(t in _EQUITY_WORDS or t in _COMMON_FILLER for t in tokens):
        return False
    if any(t in _EQUITY_WORDS for t in tokens):
        return True
    # A bare share-class label ("CL A", "CLASS A", "CL A NEW") IS an equity
    # class — measured: META PLATFORMS INC / CL A, 3,943 holders.
    return bool(re.match(r"^CL(ASS)? [A-C]( |$)", class_key))


def _base_ticker(tickers: set[str]) -> str | None:
    """Among an issuer's listed tickers, the ONE without a hyphen suffix —
    the common line beside its preferred series (`JPM` among `JPM-PC` …).
    None when zero or several bases exist: two bases (GOOG / GOOGL) are two
    classes, and only a recorded rule may pick between them."""
    bases = [t for t in tickers if "-" not in t]
    return bases[0] if len(bases) == 1 else None


def promote(args: argparse.Namespace) -> int:
    draft_doc = json.loads(Path(args.draft).read_text(encoding="utf-8"))
    if draft_doc.get("schema") != "ticker-mapping-13f-draft/v1":
        raise DraftError("not a ticker-mapping draft")
    snapshot_sha = sha256_of(args.company_tickers)
    if snapshot_sha != draft_doc["company_tickers_sha256"]:
        raise DraftError(
            "the SEC company list differs from the one the draft was built against;"
            " re-run draft so verification and candidates agree on one snapshot"
        )
    entries = load_company_tickers(args.company_tickers)
    index = issuer_index(entries)
    known_tickers = {e["ticker"] for e in entries}

    verified: list[dict] = []
    unmapped: collections.Counter = collections.Counter()
    unmapped_value: collections.Counter = collections.Counter()
    unmapped_rows: list[dict] = []
    dropped_rules: list[str] = []
    target_rows = [r for r in draft_doc["rows"] if r["in_target"]]
    for r in target_rows:
        name_key, class_key = r["name_key"], r["class_key"]
        match = index.get(name_key, {})
        reason = None
        ticker = method = note = None
        if not match:
            reason = "no SEC issuer with this normalized name"
        elif len(match) > 1:
            reason = "ambiguous identity: several SEC issuers share this normalized name"
        else:
            cik, tickers = next(iter(match.items()))
            if len(tickers) == 1:
                if _is_common_class(class_key):
                    ticker, method = next(iter(tickers)), "exact-name"
                    note = f"one SEC issuer (CIK {cik}), one listed ticker, common-equity class"
                else:
                    reason = "class is not the issuer's common equity (or its ADR)"
            elif _base_ticker(tickers) is not None and _is_common_class(class_key) and not re.search(r"\bCL(ASS)? [B-Z]\b", class_key):
                # Preferred-series listings (BASE-PA, BASE-PC …) beside one
                # common line: the common-equity class is that line. A Class
                # B/C… label never takes it — those are separate lines.
                ticker, method = _base_ticker(tickers), "class-resolved"
                note = (
                    f"one SEC issuer (CIK {cik}); the single un-hyphenated ticker among"
                    f" {len(tickers)} listings (the rest are -suffixed series);"
                    " common-equity class"
                )
            else:
                for rule_name, rule_class, rule_ticker, rule_note in MANUAL_CLASS_RULES:
                    if rule_name == name_key and re.search(rule_class, class_key):
                        if rule_ticker not in tickers:
                            dropped_rules.append(
                                f"{rule_name} / {class_key} → {rule_ticker}: ticker not listed"
                                f" under CIK {cik} in the SEC list ({sorted(tickers)})"
                            )
                            break
                        # A recorded issuer/class RULE accepted this row — it
                        # was not reviewed individually, so it is never `manual`.
                        ticker, method, note = rule_ticker, "class-resolved", f"recorded class rule: {rule_note}"
                        break
                if ticker is None and reason is None:
                    reason = "issuer lists several tickers and no recorded class rule applies"
        if ticker is not None:
            assert TICKER_RE.fullmatch(ticker) and ticker in known_tickers
            verified.append(
                {
                    "issuer_name_canonical": r["issuer_name_canonical"],
                    "title_of_class": r["title_of_class"] or "",
                    "ticker": ticker,
                    "verified_date": args.date,
                    "verified_by": args.verified_by,
                    "method": method,
                    "note": note,
                }
            )
        else:
            unmapped[reason] += 1
            unmapped_value[reason] += r["value_usd"]
            unmapped_rows.append({**r, "reason": reason})

    # Every promoted row must survive the loader — the same validator the
    # build runs — including the pinned-snapshot ticker check.
    doc = {
        "version": 1,
        "company_tickers_sha256": snapshot_sha,
        "draft_period": draft_doc["period"],
        "rows": sorted(verified, key=lambda v: (normalize_issuer_name(v["issuer_name_canonical"]),
                                                normalize_class(v["title_of_class"]))),
    }
    header = (
        "# Tier C 13F ticker mapping — REVIEWED rows only (R3, refinement 20260910).\n"
        "#\n"
        "# Keyed on the normalized filed issuer name + title of class. NO CUSIP\n"
        "# column, NO CUSIP-derived key: the loader (`populus.ticker_mapping_13f`)\n"
        "# refuses any CUSIP-shaped field. Symbols are never inferred at build time;\n"
        "# only rows in this file supply a 13F ticker (G14, ARCHITECTURE.md).\n"
        "#\n"
        "# Every row carries verified_date / verified_by / method. `verified_by`\n"
        "# names WHO checked it — for this run an automated agent, not a human;\n"
        "# the owner's 50-row spot check (ticker_mapping_13f.sample.json) is the\n"
        "# pre-merge human step. Drafted from the CLOSED quarter `draft_period`\n"
        "# by scripts/draft_ticker_mapping_13f.py; unverified keys are absent.\n"
        "#\n"
        f"# company_tickers_sha256 pins the SEC company list the tickers were checked\n"
        f"# against ({Path(args.company_tickers).name}).\n"
    )
    yaml_text = header + _dump_yaml(doc)
    _atomic_write(Path(args.out_yaml), yaml_text)
    mapping = load_ticker_mapping(args.out_yaml, known_tickers=known_tickers)
    assert len(mapping.rows) == len(verified)

    sample = derive_sample(mapping, seed=args.seed, size=SAMPLE_SIZE)
    _atomic_write(
        Path(args.out_sample),
        json.dumps(
            {
                "schema": "ticker-mapping-13f-sample/v1",
                "seed": args.seed,
                "size": len(sample),
                "mapping_sha256": sha256_of(args.out_yaml),
                "how_to_rederive": "populus.ticker_mapping_13f.derive_sample(load_ticker_mapping(), seed=seed)",
                "rows": sample,
            },
            indent=1,
        )
        + "\n",
    )

    # --- coverage report ------------------------------------------------------
    target_value = sum(r["value_usd"] for r in target_rows)
    population_value = sum(r["value_usd"] for r in draft_doc["rows"])
    verified_keys = {(normalize_issuer_name(v["issuer_name_canonical"]), normalize_class(v["title_of_class"])) for v in verified}
    verified_value = sum(r["value_usd"] for r in target_rows if (r["name_key"], r["class_key"]) in verified_keys)
    by_method = collections.Counter(v["method"] for v in verified)
    status_counts = collections.Counter(r["status"] for r in draft_doc["rows"])
    target_status = collections.Counter(r["status"] for r in target_rows)
    unmapped_rows.sort(key=lambda r: -r["value_usd"])
    lines = [
        "# Tier C 13F ticker mapping — coverage report",
        "",
        f"Generated {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by"
        f" `scripts/draft_ticker_mapping_13f.py promote` (R3, refinement 20260910).",
        "",
        f"- Drafted from the closed quarter **{draft_doc['period']}** (newest period in the"
        f" source: {draft_doc['newest_period_in_source']}, refused as open).",
        f"- SEC company list snapshot sha256 `{snapshot_sha}`.",
        f"- `verified_by`: {args.verified_by}",
        "",
        "## Counts",
        "",
        f"| Population keys (closed quarter) | {draft_doc['population']:,} |",
        "|---|---|",
        f"| Target keys (top {draft_doc['top']:,} by value ∪ notable-held) | {len(target_rows):,} |",
        f"| … of which notable-held only (below the top cut) | {draft_doc['target_notable_only']:,} |",
        f"| Drafted candidates, population: single / multi-ticker / ambiguous / no-match | {status_counts['single']:,} / {status_counts['multi-ticker']:,} / {status_counts['ambiguous-issuer']:,} / {status_counts['no-match']:,} |",
        f"| Drafted candidates, target: single / multi-ticker / ambiguous / no-match | {target_status['single']:,} / {target_status['multi-ticker']:,} / {target_status['ambiguous-issuer']:,} / {target_status['no-match']:,} |",
        f"| **Verified rows shipped** | **{len(verified):,}** |",
        f"| … by method exact-name / class-resolved / manual | {by_method['exact-name']:,} / {by_method['class-resolved']:,} / {by_method['manual']:,} |",
        f"| Target rows left UNMAPPED (no ticker) | {len(target_rows) - len(verified):,} |",
        "",
        "## Dollar coverage",
        "",
        f"- Verified target value: ${verified_value:,} of ${target_value:,} target value"
        f" (**{(100 * verified_value / target_value if target_value else 0):.1f}%**).",
        f"- Verified target value as a share of the whole population value"
        f" (${population_value:,}): **{(100 * verified_value / population_value if population_value else 0):.1f}%**.",
        "",
        "## Unmapped residue (target rows), by reason",
        "",
        "| Reason | Rows | Value |",
        "|---|---|---|",
    ]
    for reason, n in unmapped.most_common():
        lines.append(f"| {reason} | {n:,} | ${unmapped_value[reason]:,} |")
    lines += ["", "## Largest unmapped target rows", "", "| Issuer (filed) | Class | Value | Holders | Reason |", "|---|---|---|---|---|"]
    for r in unmapped_rows[:40]:
        lines.append(
            f"| {r['issuer_name_canonical']} | {r['title_of_class']} | ${r['value_usd']:,} | {r['holders']:,} | {r['reason']} |"
        )
    if dropped_rules:
        lines += ["", "## Manual class rules dropped (not confirmed by the SEC list)", ""]
        lines += [f"- {d}" for d in dropped_rules]
    lines += [
        "",
        "## What verification meant here",
        "",
        "RULE-BASED, not row-by-row: every shipped row was ACCEPTED BY AN AUTOMATED RULE and its"
        " `method` names that rule. `exact-name`: the normalized filed issuer name matches exactly"
        " one issuer (one CIK) in the pinned SEC company list, that issuer lists one ticker, and"
        " the class is a common-equity (or ADR) class. `class-resolved`: a multi-ticker issuer"
        " where one un-hyphenated line sits beside preferred-series listings, or a recorded"
        " issuer/class rule in `scripts/draft_ticker_mapping_13f.py` names the line. No row was"
        " reviewed individually by this step; `manual` is reserved for the per-row review pass."
        " Anything else ships no ticker. The owner's spot check over"
        " `src/populus/ticker_mapping_13f.sample.json` is the pre-merge human step.",
        "",
    ]
    Path(args.out_report).write_text("\n".join(lines), encoding="utf-8")
    print(
        f"promote: {len(verified):,} verified of {len(target_rows):,} target rows;"
        f" {len(target_rows) - len(verified):,} unmapped; sample {len(sample)} rows (seed {args.seed})"
    )
    return 0


def _atomic_write(path: Path, text: str) -> None:
    """Write via a sibling temp file + rename: a build that reads the packaged
    mapping mid-promote sees the old file or the new one, never a torn one."""
    import os

    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _dump_yaml(doc: dict) -> str:
    """Deterministic, readable YAML: header keys, then one block per row."""
    out = [f"version: {doc['version']}", f"company_tickers_sha256: {doc['company_tickers_sha256']}",
           f"draft_period: {doc['draft_period']}", "rows:"]
    for r in doc["rows"]:
        out.append(f"  - issuer_name_canonical: {json.dumps(r['issuer_name_canonical'])}")
        out.append(f"    title_of_class: {json.dumps(r['title_of_class'])}")
        out.append(f"    ticker: {json.dumps(r['ticker'])}")
        out.append(f"    verified_date: {json.dumps(r['verified_date'])}")
        out.append(f"    verified_by: {json.dumps(r['verified_by'])}")
        out.append(f"    method: {r['method']}")
        if r.get("note"):
            out.append(f"    note: {json.dumps(r['note'])}")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("draft")
    d.add_argument("--inst-db", type=Path, required=True)
    d.add_argument("--period", required=True)
    d.add_argument("--company-tickers", type=Path, required=True)
    d.add_argument("--out", type=Path, required=True)
    d.add_argument("--top", type=int, default=2000)
    p = sub.add_parser("promote")
    p.add_argument("--draft", type=Path, required=True)
    p.add_argument("--company-tickers", type=Path, required=True)
    p.add_argument("--verified-by", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--out-yaml", type=Path, required=True)
    p.add_argument("--out-sample", type=Path, required=True)
    p.add_argument("--out-report", type=Path, required=True)
    args = ap.parse_args(argv)
    try:
        return draft(args) if args.cmd == "draft" else promote(args)
    except DraftError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
