# Signals v3 — decision record

- Approved mock: https://claude.ai/artifact/EBjCQcDUuCidmjwieM9Zid (owner "Approve as-is", 2026-10-13).
- Plan: `PLAN.md` at the worktree root (plan-v1; Codex plan review APPROVED in round 2, 2026-10-14).
- Milestones: M1 watchlist removal → M2 Signals page → M3 ticker page. Each ships as its own PR.

## Baseline

This is task T0, run on a clean detached worktree at `origin/main` 631a0aa on 2026-10-14. The tree hash was unchanged before and after the run.

The owner tier ran against data build 20260817.1. That is the build behind `POPULUS_BUILD_DIR`, `POPULUS_DB`, `POPULUS_INST_DB` and `POPULUS_INST_SERVING_DB`, and it is the same build the signals-clarity milestones used.

| Command | Exit | Pass / Fail / Skip |
|---|---|---|
| `uv run pytest -q` | 1 | 3811 / 2 / 11 |
| `npx astro check` | 0 | 0 errors, 0 warnings, 1 hint |
| `npm test` | 0 | 979 / 0 / 0 |
| `make security` | 0 | clean |
| `make abs-paths` | 0 | clean |
| `npm run build:bounded` | 0 | 9661 pages |
| `npm run test:post` | 1 | 79 / 13 / 0 |
| `npm run test:geometry` | 1 | 927 / 17 / 130 |
| `npm run test:holders-browser` | 0 | 33 / 0 / 0 |

**Failing on clean `main`.** A later run regresses only if a test outside this list fails, or a listed test fails for a different reason.

- **pytest (2)**, both in `tests/test_maintenance_tooling.py`:
  - `test_cross_run_exits_zero_on_the_current_tree`
  - `test_cross_run_f34_round_two_forms_do_not_move_a_live_span`

  Both read untracked owner plan documents in the main checkout, which name files that do not exist at 631a0aa.
- **test:post (13).**
  - `fixture-preview.test.ts`: 10 tests at :44, :56, :85, :97, :106, :114, :156, :191, :211 and :240. All fail the same way: the fixture build in the `before()` hook exceeds its 240 s `spawnSync` limit. These are timing noise.
  - `http-status.test.ts:85`: the search index exceeds 128 KiB (542,106 bytes).
  - `http-status.test.ts:257`: the institutional fixture-leak check. This dist legitimately carries 1,500 filer pages.
  - `refinement-dist.test.ts:304`: no NVDA holders page in this data build.
- **test:geometry (17).**
  - `design-reference.spec.ts:96`: the Institutional Filer canvas at 1440 has one period chip.
  - `ledger.spec.ts:427`: "G1, G6, G7, G8 measured nothing on /institutional/". The test fails 16 times: 2 widths × 2 projects, which is 4 runs, × 4 checks.

The machine-specific raw log is kept outside the tree, in the review artifacts directory (`.codex-review/t0-baseline.txt`).

## M2 — Signals page

M2 rebuilds `/signals/` as a triage (PLAN R4–R15). The decisions below are the plan's locked ones (LD1–LD10, LD13) as implemented; where the implementation had to choose, the choice is stated.

- **Where it runs (LD1).** `buildTriage` (`dashboard/src/lib/signal-triage.ts`, `TRIAGE_VERSION = "1.0.0"`) is memoised per build as `getTriage()` in `data.ts`. It reads signals through the read-only `signalIdentity` accessor and never writes onto them. Nothing is serialized: no route, no file. `signals.v1.json` is byte-identical before and after M2 (pinned in `signals.test.ts` against a pre-change sha256 of three corpora, plain, chained and with S-5).
- **Committee grade (LD2).** `dashboard/src/lib/committee-direct.ts`, table version 1, below. A test parses `src/populus/committee_jurisdiction.yaml` and `src/populus/sic_taxonomy.yaml` and fails unless every range lies inside its committee's broad sectors, so a direct grade only refines an S-5 hit. An unresolved SIC, an unmapped committee, or an `issuer_sic` without the `sic` column grades broad.
- **Rows, meters, tiers (LD3, LD4).** Exactly the plan's rules. Two readings the plan left open are stated in DEV-NOTES: a cluster row forms only when it absorbs at least one in-window filing (so "on a listed ticker" is met by its absorbed lead line), and a late batch takes all of the member's ranked filings on that date. When S-5 did not run (its inputs are not in the build, or it was withheld), Cmte reads unknown on every row and the page says why. A row's date block is its lead line's own chronology — that line's filed date, trade date, the lag between them and its filing's receipt — and a row grouping several filings labels the group's latest filing apart ("+2 filings · latest of 3 filings: {date}"); rows still sort by that latest date (DEV-NOTES D21).
- **Sentences (LD5).** The plan's templates; when no template applies, a fallback names the rules the row's lines matched ("Rules matched: first disclosure of the ticker."). Pronoun-free, at most 160 characters, and scanned by both banned-wording gates.
- **Cards (LD6).** Committee (direct before broad), Largest buy and Largest sell, each "Own record" (≥ 20 prior disclosures spanning ≥ 365 days, low ≥ $50,001, ranked by brackets above the record) or "Absolute $". Every card links to its ticker page, so a listed-stock line with no ticker never becomes one (DEV-NOTES D20). The committee card states only what is on record: a direct grade names the matched SIC; a broad grade with no SIC on record says the SIC is not on record, and only a known SIC is said to sit outside the matched committees' direct ranges (DEV-NOTES D22). The control is two radio inputs and `:checked ~` CSS; it works with JavaScript off (a geometry test runs it so).
- **Methodology (R14).** `#signal-rules` (the rule book, moved), `#signal-lag` (the lag distribution, moved), `#signals-ranking` (every constant interpolated from `signal-triage.ts`) and `#committee-direct` (the table below, from `DIRECT_SIC`).
- **Principle (LD13).** `ARCHITECTURE.md` §2.4's first bullet is now "Not an advice product … published, rule-based classifications of a disclosure against the filer's own record".

### Committee direct-match table, v1 — for the owner's sign-off

Inclusive 4-digit SIC ranges, read from House Rule X and Senate Rule XXV. Memberships are committee-level (debt TD-4: subcommittee seats are collapsed onto the parent at ingest).

| Committee | Name (as the YAML prints it) | Direct SIC ranges |
|---|---|---|
| HSAG | House Agriculture | 0100–0999 |
| SSAF | Senate Agriculture, Nutrition, and Forestry | 0100–0999 |
| HSBA | House Financial Services | 6000–6799 |
| SSBK | Senate Banking, Housing, and Urban Affairs | 6000–6799, 1520–1531 |
| HSIF | House Energy and Commerce | 2830–2836, 2911, 3661–3669, 3841–3851, 4800–4899, 4900–4949 |
| SSEG | Senate Energy and Natural Resources | 1000–1499, 4610–4619, 4900–4949 |
| SSEV | Senate Environment and Public Works | 1600–1629, 4940–4959 |
| HSPW | House Transportation and Infrastructure | 1600–1629, 4000–4789 |
| SSCM | Senate Commerce, Science, and Transportation | 4000–4789, 4800–4899 |
| HSAS | House Armed Services | 3480–3489, 3720–3729, 3730–3732, 3760–3769, 3795, 3812 |
| SSAS | Senate Armed Services | 3480–3489, 3720–3729, 3730–3732, 3760–3769, 3795, 3812 |

### Golden cases (PLAN success criterion 2)

Cut from public rows of live build 20261013.1 into `dashboard/test/fixtures/signal-triage-cases.json`: each golden member's full history, every row of the S-3 windows the cases read, the live artifact's signals verbatim, and committee and SIC inputs read from the data-20260802.2 release database (`issuer_sic`, `committees`, `committee_memberships`, `committee_jurisdiction`; the membership snapshot is valid 2025-01-03 → 2026-09-09). Where the locked rule disagrees with the plan's expectation, the rule wins (`signal-triage.test.ts` asserts the computed value).

| Case | Plan expected | Computed under LD3/LD4 |
|---|---|---|
| Cory A. Booker, filed 2026-09-09 | Stands out; Size 3, Pattern 3 (AMZN) | **Differs.** Stands out; Pattern 3 ("First trades since Aug 2014."); **Size 0, led by NVDA**. The AMZN line ($100,001–$250,000) carries no active signal (AMZN was disclosed in 2014, so no first disclosure; it is below S-1's $250K floor), so it is not a ranked line. |
| April McClain Delaney, MLM, filed 2026-09-09 | Stands out; Size 3 | Matches: Stands out; Size 3 ("3 brackets above anything in 408 prior disclosures."). |
| Alan Armstrong, filed 2026-07-21 (703 lines) | One row, WMB; Stands out; Size -1; Pattern 3; "701 of 703 lines late" | Matches. |
| SPCX purchase cluster, traded 2026-06-12 to 06-18 | One cluster row, 6 members; Others 3; absorbs Moskowitz 2026-07-26 | Matches. |
| James A. Himes, filed 2026-07-20 | Stands out; Pattern 3; Committee 2 (BAC ↔ HSBA, direct) | Matches (BAC SIC 6021, HSBA, direct). |
| Maria Elvira Salazar, CB, filings 2026-08-07, 09-09, 10-07 | One row; Committee 2 | **Differs in the filings.** One CB row (Worth a look), Committee 2, of the **2026-08-07 and 2026-09-09** filings. The 2026-10-07 filing's CB trade (2026-09-24) falls outside the sourced membership snapshot, so its CB line reads Cmte unknown, the filing's lead line is SNOW, and it stands as its own row. With a snapshot covering that date, the rule would group all three. |
| Tommy Tuberville, eight filings on 2026-08-05 | One late-batch row | Matches (8 filings, 10 completed clusters). |
| Kevin Hern, filed 2026-09-25, led by an exchange | Routine | Matches (OKE exchange). |
| Lead cards | Committee Salazar CB sale 2026-08-19; Buy Pelosi BE $1M–$5M on both; Sell absolute Armstrong WMB; Sell own record Delaney MLM | Matches. |

### M2 measurements

Measured with `getTriage()` and on the built `/signals/` page of the T0 owner-tier inputs (data build 20260817.1, S-5 withheld: "inputs-not-in-build"), 2026-10-14. The mock's numbers were never targets.

| Measure | Value |
|---|---|
| Hits (listed stocks) | 716 (580) |
| Rows ranked | 51: Stands out 13, Worth a look 2, Routine 36 |
| Groupings | single 47, cluster 3, late batch 1 |
| Committee card | stated absence: committee data is not in this build (inputs-not-in-build) |
| Largest buy, own record | John Boozman, XFIV, $50K–$100K, traded 2026-05-13, filed 2026-06-16 ("1 bracket above anything in 369 prior disclosures.") |
| Largest buy, absolute | Alan Armstrong, AAPL, $250K–$500K, traded 2026-03-27, filed 2026-07-21 (after DEV-NOTES D20; before it, David McCormick's listed-stock line with no ticker, which R11 forbids as a card) |
| Largest sell, own record | Sara Jacobs, QCOM, $500K–$1M, traded 2026-05-06, filed 2026-05-20 ("1 bracket below the largest of 64 prior disclosures.") |
| Largest sell, absolute | Alan Armstrong, WMB, $5M–$25M, traded 2026-06-24, filed 2026-07-21 |

A second measurement with only `POPULUS_DB` pointed at the data-20260802.2 release database (committee data present) and every other input from data build 20260817.1 does not measure what it was meant to: the database's corpus (58,059 transactions) does not match the build directory's, and with the development ticker map the owner tier uses (five issuers) S-5 fired 30 times against its calibrated minimum of 100 and was withheld ("volume-out-of-bounds"). Cmte read unknown on every row there too (43 rows: 12 / 1 / 30). It is reported and not used. The committee meter's behaviour on sourced data is pinned by the golden fixture instead.

## M3 — Ticker page

M3 rebuilds `/tickers/<T>/` (PLAN R16–R21, LD8, LD9). The layout record is SV3-M3 in `docs/frontend/design-principles.md`; the decisions below are the ones the implementation had to make, each stated in DEV-NOTES.

- **Tabs (R16).** `tickerUnifiedBody` emits a sticky `role="tablist"` bar of two `<a role="tab">` links over two `<section role="tabpanel">`s, `#congress` and `#institutional`. The server HTML shows both panels and marks no tab selected, so without JavaScript the page is two stacked sections with in-page links. `dashboard/src/scripts/tabs.ts` (`initTabs`) selects a tab from the hash — a panel's own id, or the panel holding a deep-linked element — puts `hidden` on the other panel, keeps a roving tabindex with Arrow, Home and End, writes the hash with `history.replaceState`, and follows `hashchange`. The ticker page binds it on load; `/e/` re-binds after every `populus:rerender` (`runGenericRoute`). `tabs.ts` is imported through `entity-client.ts`, so it ships in that chunk: the built site has the same 17,256 files and 29 `_astro` assets as the M2 build.
- **Head (R17).** The title source is unchanged (the ticker, then the SEC present-day issuer name with its † footnote, or the ticker alone). Five figures: Congress txns, Members · 12m, Latest PTR, Filed late, 13F holders. Filed late takes a fifth ledger tone, `sell`, when a row was late; its sub-line carries "N of M undated: timeliness unknown" when a row has no trade date, and its label note says why. The lede and the three story cards are gone; "Each section keeps its own clock …" is in the provenance strip. The section index's "as of … · build" stamp left with the index; the "as of" stays in the provenance strip and the build id keeps its one home on Methodology.
- **On Signals (R18).** `tickerOnSignalsHtml` (in `ui/signals.ts`, beside the member page's signals panel) renders, before the tabs: the FULL block — the ticker's strongest Stands out or Worth a look row through `triageRowHtml` itself (its heading link dropped on its own page), the tier as a heading, "← Back to Signals", and the committee caveat when Cmte is 1 or more; else the COMPACT block — up to five hit lines through the slim hits row `hitRowHtml`, "1–5 of N lines · M hits", and the caveat once, prefixed "COMMITTEE:", when a COMMITTEE hit is shown; else nothing. `/e/` passes no triage and renders no block.
- **Pinned rows (R19, R20).** The disclosures preview is the block's own lines on this ticker — the full block's row lines in LD4 line order (lead first), or the compact block's shown hits' lines from the triage's own LD3 mapping (`TriageResult.hitLines`) — deduplicated, at most five, each `<tr class="on-signals" data-txn>` with an "On Signals" marker beside the member; then the newest rows, ten in all, and "all N rows ↗". Every preview row carries `data-txn`. With pinned rows the Filed header claims no sort and the panel note says "ON SIGNALS ROWS FIRST, THEN FILED ↓". The universal-flag hoist reads every shown row. The timeline gains $15K, $250K and $5M gridlines and rings the marks of pinned rows inside its 24-month window.
- **Institutional tab (R21).** Holders 1–10 show; 11–N sit in `<details>` "Show all N holders" in the same HTML. With the list split, each part table is marked `data-paged` (a part of the collection whose hoist was computed over all N), so a flag only the first ten carry stays on their rows instead of being hoisted as universal. The terminus counts all N. "full holders view ↗" only when that page is built. Then the overlap band and "Do the two regimes agree?". `tickerSignalsHtml` is deleted.
- **No PLANNED markup (success criterion 4; Codex code round 1, F1).** When the overlap band cannot read its notable-manager side, the ticker page renders that half through `tickerOverlapHtml` as a plain statement with the reason the band knows (`OverlapBand.instAbsence`): the reviewed 13F name-and-class mapping does not name the ticker yet (with the "how tickers are mapped ↗" link), no closed 13F quarter, the institutional module not in the build, or its aggregate missing — for example "Not available for AAPL: the reviewed 13F name-and-class mapping does not name this ticker yet, so no notable manager's holding of it can be read." The "Notable managers PLANNED" badge stays only on `/institutional/tickers/<T>/holders/`, the renderer's default. `post/ticker-page.test.ts` rejects PLANNED markup on every built ticker page, with a negative control over the band's badge branch.

### M3 measurements

Measured on the built ticker pages of the T0 owner-tier inputs (data build 20260817.1, S-5 withheld: "inputs-not-in-build"), 2026-10-15.

| Measure | Value |
|---|---|
| Ticker pages | 3,852 |
| Tickers with an active hit in the build's artifact | 437 (429 with a page; 7 are budget-cut tickers that render on `/e/`, which shows no block, and 1 is the malformed "--…AMCR" ticker, which gets no page) |
| `#on-signals` | full 13 (Stands out 12, Worth a look 1), compact 416, none 3,423 |
| Committee caveat shown | 0 (S-5 withheld in this build; the golden fixture pins both branches) |
| Pinned rows per page | 1: 287 · 2: 84 · 3: 28 · 4: 13 · 5: 17 |
| Pages with "Show all N holders" | 0 — no ticker page in this build carries aggregate holder rows (3,848 not resolved to an issuer, 4 mapped with no rows), so the split is pinned by unit tests |
| Ticker page HTML | 12,953 to 50,626 bytes, median 17,174 |
| Built files | 17,256, 29 `_astro` assets (unchanged from M2) |
