# QoQ presentation, `sumRanges`, S4 failure states, the ticker→issuer mapping, and the institutional time stamp — specification

**Status:** normative for `src/lib/derive.ts`, `src/lib/inst.ts`, `src/lib/ui.ts`,
`src/scripts/entity-client.ts` and their callers (RUN P3-2, T1).
**Why this exists:** the standing *specify-before-rewriting* lesson — each of
these mechanisms is either producer-owned business logic the frontend must map
without re-deciding, or a state machine whose branches were previously left to
implementation improvisation. The spec precedes the code.

## 1. QoQ presentation mapping (Locked #8)

The producer (`src/populus/inst_agg.py`) is the **only** owner of QoQ
classification. It emits `change_kind ∈ {new, add, trim, exit, unclassified}`
plus a canonical sorted flag array per `agg_qoq_deltas` row. The frontend
**maps** that output to presentation; it never reclassifies, never compares
values itself, and never resolves a producer "unclassified" into a direction.

### Chip mapping (from `change_kind`)

| `change_kind` | chip text | chip class | notes |
|---|---|---|---|
| `new` | `new` | `qoq-new` (outlined, buy tint) | |
| `add` | `add` | `qoq-add` (buy tint) | |
| `trim` | `trim` | `qoq-trim` (sell tint) | |
| `exit` | `exit ‡e` | `qoq-exit` (outlined, sell tint) | `‡e` resolves to the exit-semantics footnote line |
| `unclassified` | `n/c` | `qoq-nc` (hatched) | fail-closed |
| *anything else* | `n/c` | `qoq-nc` (hatched) | **fail-closed**: an unknown kind is presented as not-classifiable, never guessed |

### Flag mapping (producer flags → presentation)

| producer flag | presentation |
|---|---|
| `value_undisclosed_one_side` | the **value delta cell** renders a hatched `n/c` (never a number, never `$0`); the flag also renders as a dashed tag |
| `shares_unit_mismatch` | the **shares delta cell** renders an em-dash `—` and the chip carries the `‡u` marker; dashed tag |
| `classified_by_value` | the chip carries the `†v` marker (direction taken from reported value, not shares); dashed tag |
| `change_kind_undeterminable` | accompanies `unclassified`; dashed tag (the chip is already `n/c`) |
| `identity_reconciled_by_cusip` | the position cell carries the `‡r` marker (dotted underline); dashed tag |
| *unknown flag* | **fail-visible**: rendered as a raw dashed tag with the machine name verbatim — never dropped |

Markers are page-scoped and each resolves to exactly one printed footnote line
(G5). To avoid the one-mark/two-meanings collision the base `†`/`‡` are
suffixed (`†v`, `‡u`, `‡r`, `‡e`) so every marker resolves unambiguously; the
raw machine flag name prints in the footnote line.

### Cell value rules (NULL-honest, G4)

- A NULL integer column (`prev_value_usd`, `curr_value_usd`, `delta_value_usd`,
  `prev_shares`, `curr_shares`, `delta_shares`) renders an em-dash `—`
  (absent-in-source), **never** `0`.
- A real `0` prints `0` (a disclosed zero is a disclosure).
- `delta_value_usd` NULL **with** `value_undisclosed_one_side` renders the
  hatched `n/c` treatment above (a stronger claim than plain absence: one side
  was filed but its value did not parse).
- The grain is disclosed: `put_call` other than `LONG` and `ssh_prnamt_type`
  other than `SH` print beside the position key (e.g. `PUT · PRN`);
  `UNKNOWN` prints as `unit —`.

Every mapping row above has an executable test in `test/inst.test.ts` against
rows produced by the real `build_inst_agg` over the identity-seeded fixture
corpus (Locked #19), plus synthetic rows for combinations the fixture cannot
produce (unknown kind, unknown flag).

## 2. Typed `sumRanges` (G1)

`sumRanges(rows)` aggregates statutory ranges. Its result is a discriminated
union — the aggregate's *kind* is part of the contract, so a caller can never
print `$0+` for an all-unparsed quarter:

```ts
type SumRanges =
  | { kind: "empty" }                        // no rows at all
  | { kind: "undisclosed"; rows: number }    // every row unparsed (low+high null)
  | { kind: "closed"; low: number; high: number; rows: number; undisclosed: 0 }
  | { kind: "open"; low: number; high: null; rows: number; undisclosed: number }
```

Rules:

- Bucket floors are display-normalized via the statutory `$X+1` boundary
  (`floorBoundary`), matching the row-level `amountText`.
- A row with `low = null, high = H` ("Under $H") contributes `0` to the low
  bound and `H` to the high bound — the floor of that bucket is not in the
  source, and the minimum honest claim is zero.
- Any row with `high = null` (open cap) makes the aggregate **open**: the sum
  has no upper bound.
- Any fully-unparsed row (`low` and `high` both null) also makes the aggregate
  **open** — the disclosed subset's low bound survives as a minimum, but no
  upper bound can be claimed — and increments `undisclosed`.
- All rows unparsed → kind `undisclosed`. Rendered as a hatched "not disclosed"
  treatment, **never** `$0+`, never an em-dash (the rows exist).
- The hatch/caption fraction is **count-based**: `undisclosed / rows`
  (`rows` = total rows in the aggregate), rendered as a percentage in the
  chart caption ("N% of the bound rests on unparsed amounts").

Display (`sumRangesText`): closed → `$A–$B`; open → `Over $A` (`$A` may be
`$0`: "Over $0" collapses to the undisclosed treatment only when kind is
`undisclosed`; an open aggregate whose disclosed floor is 0 prints `Over $0`
with the hatch, because rows disclosed "Under $X" bounds); empty → em-dash;
undisclosed → the hatched "not disclosed" block.

## 3. S4 failure-state taxonomy (generic entity route `/e/`)

The client driver (`entity-client.ts`) is a pure orchestration over injected
seams (`fetch`, DOM adapter, timers). Every terminal state is enumerated; the
skeleton is never indefinite.

| outcome | trigger | rendered state |
|---|---|---|
| `ok` | 200 + valid payload + renderer succeeds | entity body via the same `ui.ts` renderer the prerendered pages use |
| `not_found` | HTTP 404 | **S2** out-of-extract: what is missing, why, primary-source CTA (members → bioguide.congress.gov profile; tickers/filers → SEC EDGAR) |
| `server_error` | HTTP 5xx (or any non-404 non-2xx) | honest error block: status code, retry, raw-endpoint link |
| `network_error` | fetch rejects | honest error block: "the request did not complete", retry, raw-endpoint link |
| `bad_payload` | 2xx but body is not JSON or misses the `{v, t, p, meta}` shape | honest error block naming the defect, retry, raw-endpoint link |
| `version_mismatch` | payload `v` ≠ the client's supported version | honest error block naming both versions, raw-endpoint link (retry is pointless and not offered) |
| `render_error` | the body renderer throws | honest error block ("the record loaded but this page failed to draw it"), raw-endpoint link so the reader can still reach the data |
| `timeout` | watchdog fires before any outcome | honest error block ("taking too long"), retry, raw-endpoint link; the watchdog **ends** the skeleton |

An invalid or absent `?k=` key renders the key-error state (no fetch is made).
Every error block names the endpoint path it tried, per the S4 mockup's
"skeleton only below the already-painted shell" rule.

## 4. Ticker→issuer mapping contract (Locked #18)

Input: `POPULUS_TICKER_MAP` — path to a `company_tickers.json` snapshot
(SEC primary source, public domain). Dev default: the committed fixture
`tests/fixtures/inst/mcp/company_tickers.json`. Missing/unset in a build with
the institutional module present → every ticker renders the honest
unresolved state; never a guessed join.

Parse rules (mirroring `src/populus/identity/bootstrap.py::parse_company_tickers`
and `identity/registry.py` normalizers):

- Accept an object keyed by stringified rank or a list; iterate rank order.
- Per entry: `cik_str` → 10-digit zero-padded CIK (reject >10 significant
  digits or non-digits); `ticker` → NFC, trimmed, uppercased, must match
  `^[A-Z0-9][A-Z0-9.\-]{0,15}$`; `title` → NFC, whitespace-collapsed.
  Any failure → the entry is malformed and dropped (counted).
- **DC1 title conflict:** a CIK carrying two distinct normalized titles in one
  snapshot has ALL of its rows rejected (decided across every valid row before
  duplicate bucketing).
- `(cik, ticker)` duplicates after the first are dropped.
- Resolution direction (ticker → issuer): a ticker mapping to **more than one
  CIK** is ambiguous → deterministic rejection (honest state, never a pick).
  Several tickers for one CIK (share classes) are ordinary one-to-many data.
- `issuer_key = "entity:cik:<10-digit>"` — matched **only** against
  `agg_issuer_top_holders` rows whose `issuer_key_source = 'entity'`. CUSIP-6
  and name-keyed issuer rows are never matched from a ticker (identity
  guessing).
- The mapping is a **present-day snapshot** (G14): every surface it feeds
  carries the `†` marker resolving to a printed line that says so.

## 5. Institutional time stamp (Locked #20)

The published aggregate (`inst_agg.sql`) carries `period_of_report` but **no
per-row filed date**; the module manifest carries the watermarks
`latest_period_of_report` and `latest_filed_date`. The G2 dual-date rule is
scoped to sources that publish both dates per row. Institutional tables
therefore carry the defined replacement stamp, verbatim form:

> quarter-end `{period_of_report}` · latest filing in build filed
> `{latest_filed_date}`

plus the printed caveat line:

> per-filer filing dates are not in the published aggregate — the filed-date
> watermark is build-wide, not per row

and never the phrase "current holdings". Congressional tables keep the full
per-row dual dates (traded + filed + lag) — the source publishes both.

## Changing these mechanisms

Amend this file **before** editing the implementing code, and land the test in
the same change (the *specify-before-rewriting* corollary). The producer
mapping table in §1 may only change when `inst_agg.py`'s vocabulary changes.
