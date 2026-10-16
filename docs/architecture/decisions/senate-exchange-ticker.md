# Senate exchange legs — both tickers, never the joined cell text

**Status:** accepted (owner decisions D1 and D2, John Baek, 2026-10-16)
**Date:** 2026-10-16 · `NORMALIZATION_VERSION` norm-1.1.0 → **norm-1.2.0**

## The live defect

Two active signals on build 20261016.1 carried `entities.ticker` = `--`,
newlines, runs of spaces, then `AMCR`:

- `s2-first:4926f726211a32f8`
- `s6-late-large:32aa0975024978e5`

Both come from one row: Ron Wyden, spouse, the 2025-04-30 exchange of Berry Global for Amcor
(eFD PTR `5ecc9b5c-07c1-4ec1-bd4a-2db759eff299`, filed 2026-08-08).

## Mechanism, read in the bytes

The archived page has sha256 `64d820d2…`, which equals the store's `filings.response_hash`. For
an exchange, eFD prints the row's two legs in one ticker cell, separated by `<br/>`: the exchanged
security, then the received one.

```
<td>
    --
    <br/>
    <a href="https://finance.yahoo.com/quote/AMCR" target="_blank">AMCR</a>
</td>
```

The exchanged leg is `--` because eFD links no ticker for BERY; the asset cell names it in text,
`BERY - Berry Global Group, Inc. (Exchanged) <br/> Amcor plc Ordinary Shares (Received)`.

The parser is correct by contract. `parse/senate_ptr.py` `_raw_cell` keeps the cell's exact
`text_content()` (LD3), because `raw_row` is the identity input.

The defect was in normalization. `normalize.py` `normalize_ticker` was `raw.strip().upper()`, and
its only placeholder test was a cell whose whole text is `--`. Interior newlines survived, and the
two-leg cell became one "ticker".

## Every affected row

The rule is the congress entity-key grammar `^[A-Z0-9][A-Z0-9.:$\-]{0,15}$`
(`dashboard/src/lib/derive.ts`).

| Where | Failing rows | Breakdown |
|---|---|---|
| Owner store 20260817.1 | 80 | 77 two-leg Senate exchange rows in 55 filings (54 `T <br/> T`, 23 `-- <br/> T`), and 3 option-symbol rows `SPY160219P00180000` (18 characters, a single token, all outside the default view) |
| Live build 20261016.1, all 29 feed parts | 73 | All two-leg rows: 50 `T T` and 23 `-- T`, from 17 members in 52 filings. The gap to the store is exactly the 7 rows outside `v_default_transactions`. |

House and kadoa rows: 0.

Over all 16,558 stored Senate rows, every multi-token cell is a two-leg exchange cell. A DOM pass
over the 2,409 archived pages confirms `<br/>` is the separator. No `T <br/> --` shape exists, so
the received leg is always linked.

## Decision

D1 = C, carry both legs. The design is additive:

- **`ticker`** keeps its meaning. On a two-leg exchange it is the **received** leg.
- **`exchanged_ticker`** is a new nullable column holding the **given-up** leg. It is NULL for
  every other row and when eFD prints `--`.

One function holds the rule, `normalize.ticker_legs`, and it decides by token count first:

| Cell | Result |
|---|---|
| 0 tokens, or a lone `--` | NULL + `missing_ticker` |
| 1 other token | that token, uppercased |
| 2 tokens on an exchange row | the leg rule: a `--` received leg is NULL + `missing_ticker`, a `--` exchanged leg is NULL, and there is never a fallback from one leg to the other |
| Anything else | NULL + `ticker_unparsed` (a new parse defect; 0 rows today) |

Printed legs are taken verbatim, as a single printed ticker is. The caret symbols `^MWE` and
`^RGP`, which eFD printed on two 2017 Toomey rows, are therefore preserved, as the owner asked.

### Where the exchanged leg appears

- **Shown:** on the row's asset line (the `/congress/` ledger and the member tables, both
  server-rendered and in the `/e/` client), as `· exchanged ETRN`. It sits outside the ellipsis,
  like the owner qualifiers.
- **Not in the ticker cell.** That cell is 76px, and two symbols would clip the canonical leg.
- **Not on the exchanged ticker's page.** Every per-ticker structure keys on `ticker`, and a
  second membership rule would double-count one disclosure.
- **Not in signals.** Signals key on `ticker` only.
- **Not a link,** because an exchanged-only symbol may have no page.

## Contract versions, each by the repository's own rule

| Contract | Change | Rule |
|---|---|---|
| Congress logical-digest projection | `"2"` → `"3"` | `digests.py`: a module's projection version bumps exactly when its byte envelope changes. `transactions` gained a column. |
| Congress manifest `schema_version` | `"1.0"` → `"1.1"` | ARCHITECTURE.md §5.5 MAJOR.MINOR policy (clients accept the same MAJOR). This is an additive, backward-compatible change; precedent: inst 1.0 → 1.1. |
| Client `DATASET_VERSION` | 2 → 3 | Every payload embeds the version, so a stale cached dataset is refused. `exchangedTicker` is appended last to `TXN_COLS`, so no index moves. Precedent: B-7. |
| Producer feed | `_FEED_COLUMNS` gains `exchanged_ticker` | feed.json and the per-entity slices |
| Normalization | norm-1.1.0 → norm-1.2.0 | recorded in the manifest; digests compare within like pairs |

Existing stores gain the column from `load.ensure_transaction_columns`, a guarded
`ALTER TABLE ... ADD COLUMN`. It was `ensure_subline_columns`, renamed now that it adds more than
the sub-lines. The column is outside `raw_row`, so no `txn_id` changes.

Every entry point that writes or publishes the store migrates it first:

- every `populus ingest` job;
- `seed-corpus`;
- `reparse` (both chambers);
- `stage_build`, which covers `populus build` and `stage-build`, on the source store before the
  snapshot. A published snapshot therefore always carries the 1.1 columns its manifest declares.

A 1.1 reader also accepts a 1.0 store, as the same-MAJOR rule requires. The dashboard's row
loader checks the table's own column list (`exchangedTickerSelect` in `data.ts`), and a store
without `exchanged_ticker` reads every leg as NULL. The newest local release, which the holders
preview and the fixture builds read, is such a store. The owner-tier holders lane timed out
against it until this was added.

## Correcting the published rows (D2)

The nightly store is seeded from the previous release, and settled filings are never re-fetched,
so a code fix alone would reach only new filings.

`ingest/senate.py` `rederive_senate_tickers` closes that gap. It runs at the end of every
`ingest congress-senate` and re-derives both columns from each stored row's lossless `raw_row`,
using the same `ticker_from_raw_row` that ingest uses.

- **Change detection is semantic.** It compares the ticker, the exchanged ticker, and the *set*
  of ticker-owned flags. 429 stored Senate rows keep `amendment_unresolved` appended after load,
  in non-sorted order, so a byte or sorted comparison would rewrite them for nothing.
- **Flag bytes are preserved.** Stored flags are left byte-for-byte unless the ticker-owned set
  changes.
- **Narrow stamping.** Only the filings of changed rows get the new `normalization_version`.
- **Refusal.** The pass refuses, writing nothing, if any row would gain a parse defect.
- **Idempotent:** 0 rows change on every later run.

Measured on a full copy of the 20260817.1 store (`ensure_transaction_columns`, then the pass):

| | Result |
|---|---|
| first pass / second pass | 77 rows / 0 rows |
| `ticker` changed | 77 rows |
| `exchanged_ticker` non-NULL | 54 |
| `flags` rewritten | 0 |
| unsorted-flag rows byte-identical | 429 of 429 |
| filings stamped norm-1.2.0 | 55 |
| any other column of any table | unchanged |
| tickers failing the rule afterwards | 5: the 3 SPY rows, `^MWE`, `^RGP` (all preserved) |

## Signals: through the D-1c lifecycle, nothing hand-edited

Measured with the real engine over all 72,399 live rows, with the live artifact as the prior.
S-5 is not evaluable without committee tables, but it is `txnId`-keyed, so a correction could
only add an S-5 record, never re-key one. Exactly three records change:

| Record | Next build |
|---|---|
| `s6-late-large:32aa0975024978e5` (`txnId`-keyed) | stays active with the same id and first-seen build 20260814.1; its ticker becomes `AMCR` |
| `s2-first:4926f726211a32f8` (keyed by bioguide + ticker) | becomes a superseded tombstone that keeps the old string verbatim. It is never rendered as a row, and is compacted out by the first build dated 2026-11-07 (filed 2026-08-08 plus 90 days). |
| `s2-first:b019bbc82e0ab61e` | new and active (Wyden, AMCR) |

`PINNED_IDS` is a synthetic corpus and is unchanged.

## Verification after deploy (owner)

```bash
# 1. dataset v3, the column appended last, and only the preserved caret rows still failing
curl -s https://publicfilings.org/congress/data/feed/index.v1.json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["dataset_version"]); [print(p["part"]) for p in d["parts"]]' > parts.txt
head -1 parts.txt   # expect 3
for p in $(tail -n +2 parts.txt); do curl -s "https://publicfilings.org/congress/data/feed/$p.v1.json" > "part-$p.json"; done
python3 - <<'PY'
import glob, json, re
rule = re.compile(r"^[A-Z0-9][A-Z0-9.:$\-]{0,15}$")
bad, legs = [], {}
for f in glob.glob("part-*.json"):
    d = json.load(open(f)); ix = {c: i for i, c in enumerate(d["txn_cols"])}
    assert d["txn_cols"][-1] == "exchangedTicker"
    for r in d["rows"]:
        if r[0] != "t": continue
        r = r[1:]
        if r[ix["ticker"]] and not rule.match(r[ix["ticker"]]): bad.append(r[ix["ticker"]])
        legs[r[ix["txnId"]]] = (r[ix["ticker"]], r[ix["exchangedTicker"]])
print("failing:", sorted(bad))   # expect ['^MWE', '^RGP']
print(legs["senate:5ecc9b5c-07c1-4ec1-bd4a-2db759eff299:11c6d72045e828c575da77981cbc388d"])  # ('AMCR', None)
print(legs["senate:f60cfac8-0389-4a5e-8619-095312492adc:83bf53e4538a1119b5d7208946b733d0"])  # ('EQT', 'ETRN')
PY
# 2. the signal lifecycle
curl -s https://publicfilings.org/signals/data/signals.v1.json | python3 -c '
import json, sys
a = json.load(sys.stdin); by = {s["id"]: s for s in a["signals"]}
for i in ("s6-late-large:32aa0975024978e5", "s2-first:4926f726211a32f8", "s2-first:b019bbc82e0ab61e"):
    s = by.get(i); print(i, s and (s["status"], s["entities"]["ticker"], s["firstSeenBuild"], s.get("supersededInBuild")))
print([s["id"] for s in a["signals"] if s["kind"] == "s5-jurisdiction" and "5ecc9b5c" in " ".join(s["receipts"])])'
```

## Declared debt

- **The exchanged ticker's page does not list the row.** The leg shows on the row's asset line.
- **MCP congress tools return only `ticker`,** now the received leg. Their output contract is
  unchanged.
- **The feed text filter does not match the exchanged leg.**
- **The caret symbols and the option symbols** still fail the key grammar. Both are preserved.
- **58 one-token exchange cells** keep an ambiguous leg; the source does not say which.

## Rollback

The preferred rollback is a forward fix. The correction pass re-derives every row from the rule
the code holds, so no data is hand-edited.

A plain `git revert` leaves the column in the seeded store, where the old code would digest it
under the label "2". So a revert ships with one owner-run step on the next working store, before
stage-build:

```sql
ALTER TABLE transactions DROP COLUMN exchanged_ticker;  -- SQLite >= 3.35; no index or view names it
```

After a revert, corrected tickers persist: the seed carries them forward. Only new two-leg filings
would regress.
