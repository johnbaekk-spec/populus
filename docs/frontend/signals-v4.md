# Signals v4 — decision record

- Approved mock: https://claude.ai/artifact/GUFeqGmfBnTfHY6C44tpb8 (Design canvas, artboard `Main.dc.html`; owner approval 2026-10-17: "Plan Signals v4 from this mock: plan, then dev, then Codex review, same as v3."). The mock specifies layout, behaviour and copy intent; its numbers are not targets — every figure below is recomputed from build data.
- Plan: `PLAN.md` at the worktree root (plan-v1, Codex plan review APPROVED).
- Milestones: M1 the Congress tab re-laid → M2 tabs, the Institutional tab and the reduced `/institutional/` → M3 Overlap and Playbooks. Each ships as its own PR.

## Baseline

Task T0, run on a clean detached worktree (`.claude/worktrees/signals-v4-base`) at `origin/main` 0ed2d50 on 2026-10-18. The tree hash was unchanged before and after the run (`da39a3ee…`, an empty diff).

The owner tier ran against data build 20260817.1 (`POPULUS_BUILD_DIR`, `POPULUS_DB`, `POPULUS_INST_DB` and `POPULUS_INST_SERVING_DB` under `_local/populus-build-20260817.1/`), the build v3 used.

| Command | Exit | Pass / Fail / Skip |
|---|---|---|
| `uv run pytest -q` | 1 | 3853 / 2 / 11 |
| `npm run check` | 0 | 0 errors, 0 warnings, 1 hint |
| `npm test` | 0 | 1076 / 0 / 0 |
| `make security` | 0 | clean |
| `make abs-paths` | 0 | clean |
| `npm run build:bounded` | 0 | 9660 pages; `dist/signals/index.html` 153,648 bytes |
| `npm run test:post` | 1 | 89 / 13 / 0 |
| `npm run test:geometry` | 1 | 946 / 17 / 132 |
| `npm run test:holders-browser` | 0 | 33 / 0 / 0 |

**Failing on clean `main`.** A later run regresses only if a test outside this list fails, or a listed test fails for a different reason.

- **pytest (2)**, `tests/test_maintenance_tooling.py`: `test_cross_run_exits_zero_on_the_current_tree` and `test_cross_run_f34_round_two_forms_do_not_move_a_live_span`. Both read untracked owner plan documents in the main checkout; they fail only in a worktree.
- **test:post (13)**, all institutional or packaging tests this data build cannot satisfy: `/institutional landing lists the fixture filers when the module is present`; `POST-BUILD R20: /institutional/tickers/NVDA/holders/ exists …`; `no unqualified 'all' claim on the rendered holders surface (R12)`; `no §1.1 banned wording anywhere in the rendered institutional tree`; `the §5 data_note renders on every institutional surface, clause by clause`; `filer happy path emitted: /institutional/filers/1067983/ …`; `holders happy path emitted: /institutional/tickers/AAPL/holders/ via the mapping`; `holders pages exist ONLY for mapped, entity-keyed issuers`; `production dist has NO institutional fixture routes (Locked #19 leakage check)`; `production leakage: the NORMAL dist/ carries no fixture-derived paths`; `real search index: allowlist shape + ≤128 KiB budget (R11)`; `the envelope's manifest declares the inst module per producer policy`; `the unified AAPL page's institutional section binds the same data`.
- **test:geometry (17)**: `design-reference.spec.ts:97` (the Institutional Filer canvas at 1440), and `ledger.spec.ts:409` G1, G6, G7 and G8 on `/institutional/` at 1440 and 390, in the chromium and touch projects (16) — the v3 baseline's same 17.

The bytes T1.1 compares (`test/post/signals-v4-dist.test.ts` reads this block; it applies only to a dist built from the same data build):

<!-- t0-baseline:begin -->
build_id: 20260817.1
dist_routes: 17228 files, sha256 1fb6fbaa9cc00687e5d1dc272eb196bf8e20ddf1647426c6237ca6b91361cd22
0e91491f76af7b95179b9148d0df9050d982a971a1d528a11f64bb84463acd09  signals/data/signals.v1.json
0322876ccf006ead49696d39a09aeacd6a7416995a38f749f1c94fe592b24675  institutional/data/notable-moves/2026-03-31.v1.json
<!-- t0-baseline:end -->

`dist_routes` is the sorted list of every file outside `_astro/` (`find . -type f -not -path './_astro/*' | sort`), one `./path` per line, newline-terminated. The machine-specific raw logs stay outside the tree, in `.claude/worktrees/signals-v4-base/.codex-review/t0/`.

## M1 — the Congress tab, re-laid

M1 keeps the page's title and h1, "Congress signals" (the `LD9` reversal to "Signals" lands with the tabs in M2); its lede is "What stands out in Congress trades, each against the filer's own record." The triage is unchanged in value: `TRIAGE_VERSION` 1.0.0, the golden cases, tiers, meters, sentences and cards are as pinned, and every `getTriage()` row renders once. `signal-triage.ts` and `signals.v1.json` are untouched.

- **Tips (R1, LD3).** Every explanation on the page is an ⓘ: the `note()` primitive with the mark trigger. Above 720px it opens on hover, focus or click, anchored as before. At ≤720px an open note is a bottom sheet — `position: fixed`, inset 10px from the sides and bottom, at most 70vh, over a 55% scrim — through placement and top-layer rules only (`.note-pop` never gets `display:none`). It is one component, so the sheet applies wherever `note()` renders. Without JavaScript `popovertarget` opens it and a tap on the scrim light-dismisses it. With JavaScript, `notes.ts` stops anchoring the panel at that width (it clears the inline coordinates) and appends one `Close` button (`popovertargetaction="hide"`) on the first opening, from the script only, so the server markup and every parity capture are unchanged.
- **Rows (R2, R3, LD4).** A row is `article.si-row > details.si-row-d[name="si-rows"] > summary.si-row-sum`, plus the receipt (`.si-row-src`) as a sibling of the `<details>`, laid over the summary's reserved cell — no link is nested in the disclosure button. Line 1: ticker; the filer (party and state, the owner word, the LATE and grouping tags), one line in which only the name gives way to an ellipsis; range; the four meters; the filed date. Line 2: the side chip; the reason, cut to one line; "traded {date} · {lag}d"; a chevron. Below 1440px (the stacked band at 721–1080px and the split band's 1.5fr share up to 1439px) the meters move to line 2, between the reason and the trade date, so the row stays two lines at every width above the fold. Clicking the row, or Enter or Space on it, opens it in place with the full reason, the lead line's chronology, the grouping (a grouped row's latest filing labelled apart, D21), the members of a cluster, the owner, the LATE detail, every meter as a word with its definition (the Cmte line saying "context, never an allegation"), and links to the ticker page, the member page and the receipt. One row is open at a time (`details[name]`). The ticker page's On Signals block renders the same row opened, without the link to the page it is on.
- **Phones (R3).** At ≤720px a row is three lines: ticker, side, range, filed date and the receipt's cell; the filer, party and state, owner and tags beside the four meters, each labelled over its bars; the reason, the trade date and lag, and the chevron. A filer that needs more room wraps onto a further line rather than dropping a field.
- **Lead cards (R4, LD5).** v3's three cards, picks and CSS-only "Own record │ Absolute $" control are unchanged. Each pick carries `a.si-card-open` to its row (`#si-row-{slug(key)}`), stretched under the card's own ticker, member and receipt links; the client opens the row on the click and on `hashchange` (and for a hash on load), selecting the Filings pane and opening Routine first when the row needs them. At ≤1080px the cards swipe sideways in their own strip (`scroll-snap-type: x mandatory`), a named scroll region while it overflows.
- **Hits and the fit (R5, R6, LD6).** The server renders the first 40 hit lines (`SIGNAL_HITS_DOM_ROWS`), the first 10 visible and the rest `hidden`; the no-script view and its count are those 10. `scripts/column-fit.ts` fills the hits to the height of Filings to read: `fitCount` estimates from the content bottoms (`contentBottom`, the largest bottom among an element's visible in-flow children — never a cell box), then `bindFit` corrects against the live layout one row at a time. It re-fits on a ResizeObserver over `#triage` (a resize, a row or Routine opening) and after a filter change. The contract is visible = min(matching, base + extra): "Show 10 more" adds to `extra`, past the neighbour by design; a filter change resets it; a list shorter than the fit shows all of it. Rows past the 40 held come from the one memoised artifact fetch. The band's cells do not stretch (`align-items: start`); the fit does not depend on it.
- **Pane switch (R7, LD7).** `div.seg.pane-switch[data-pane-switch][hidden]` with Filings and Hits buttons (`aria-pressed`, `aria-controls`). The client shows it, and puts `hidden` on the unselected pane, only while `(max-width: 1080px)` matches; no media rule hides a pane. A hash naming an element in a hidden pane (`#hits`, `#families`, a row) selects that pane first, so no deep link lands on a hidden pane (step 2 of M2's `revealTarget`). Without JavaScript both panes show.
- **Fewer words (R8, LD19).** Each caveat that left the visible page is in a tip: v3's nine "How signals work" sentences (beside the h1), the lead cards' and the triage's panel notes, the meter legend ("What the bars mean", by the column head: the levels key, then one paragraph per meter with its short definition and v3's full rule — every level, Size's minimum history and what "prior" means, Pattern's and Others' filed-by-the-cutoff limits, Cmte's direct / sector / none / unknown distinction and the committee caveat), one tip per tier, the families' rate definition and evaluated-row and date-anomaly counts, and the hits' panel note and key. The `#signal-method-links` paragraph and the superseded foot became the foot's link row (Rule book, How rows are ranked, Lag distribution, Committee table, `signals.v1.json`, and "changes since last build" when signals left the window). The live state stays visible: the hidden-hits count, "Cmte reads unknown …", each withheld kind on one line (its reason's detail in a tip) with its carried-forward count.

### Deviations from the mock (LD22, M1's share)

Each keeps an honesty element the mock dropped or a site rule the mock did not follow; each is also in `dashboard/README.md`'s deviation register.

- **LD22-1.** **Phone rows keep the trade date, the lag and the receipt.** The mock's ≤720px block set `.a-src, .a-trd { display: none }`. Here the receipt holds line 1's last cell and "traded {date} · {lag}d" holds line 3 (151px at the 10.5px mono size for "traded 2025-04-15 · 477d"); `css-fold.test.ts` sweeps `.si-row-traded` and `.si-row-src`, and the geometry suite reads both, unclipped, at 320–430px.
- **LD22-2.** **The owner word is on the collapsed row.** The mock put it in the opened row only. `.owner-note` sits in the filer cell at every width ("Self" to "owner not stated", 25–85px).
- **LD22-3.** **The slim hits keep traded → filed.** The mock's hits showed the filed date only. The v3 hits row is unchanged.
- **LD22-7.** **Tap targets follow the site's G12 rule:** `--hit-min` is 44px at ≤720px or under a coarse pointer, stricter than the mock's 32px. The pane switch's buttons are 44px tall at 390px (measured), and every ⓘ reaches its 44px square there.
- **LD22-8.** **No `title=` tooltips.** The mock used `title` on meters, reasons, kinds and Consensus chips. Every hover text here is a tip or an `aria-label`; the `src/lib` survivor count stays 18 (`sl-notes.test.ts`).

- **LD22-11.** **A long filer name gives way to an ellipsis on the collapsed row** (codex M1 round 1, F1). This is the mock's own behaviour (`.a-who { overflow: hidden }`), adopted so a row stays two lines at every width ≥721px. Only the name (`.si-row-member`) shrinks: the party and state, the owner word, the ×N count, the group tag and every LATE tag keep their full width (`flex: none`) and are never cut, and a cluster's "N members" is a count, so it never shrinks either. The full name stays in the DOM (assistive technology reads it whole) and in the opened row; no `title=` is added. Honesty fields — the range, both dates, the lag, the owner, the receipt, LATE — are never truncated. Measured on the T0 build: the widest fixed part (Tuberville's late batch without its name) is 238px and the widest whole line ≈339px; the filer cell is ≥283px at 1081px (the split band's narrowest width; the late batch's name keeps ≈45px there), ≥354px from 1200px and 348px at 1440px, so from 1200px no T0 name is cut. `signals-v4.spec.ts` reads every row of the three tiers at 721, 900, 1081, 1200 and 1440px.

### Implementation readings recorded against the plan

- **Desktop row columns.** At ≥1440px `minmax(52px, max-content) minmax(0,1fr) 92px 104px 108px 34px`, with line 2 `"sd why why trd trd chv"` (the plan: `58px minmax(0,1fr) 104px 104px 132px 40px`, `"sd why why why trd chv"`). The trade date and lag ("traded 2025-04-15 · 477d", 151px) does not fit 132px; spanning it under the meters and the filed date frees the filer cell to 348px at 1440, which holds the widest T0 and golden filer lines (Tuberville's late batch, ≈339px) on one line. At 721–1439px (codex M1 round 1, F1) the tracks are `minmax(52px, max-content) minmax(0,1fr) 88px 80px 104px 34px` with 6px gaps, line 1 `"tk who who amt fil src"` and line 2 `"sd why met trd trd chv"`: the meters (88px) move under the filer cell's tail, beside the reason, and the column head's meter labels sit over them. The ticker track grows past 52px for the rare ticker that would otherwise wrap ("no ticker", 70px; T0's malformed "-- AMCR", 55px), so the ticker never takes a second line. Above the fold the filer cell never wraps (LD22-11).
- **The phone row** is a flex row broken into three lines by two zero-height pseudo-elements, in the plan's three-line order; the plan's five-column phone grid would size line 3's reason to the ticker and side columns. The DOM (reading) order is the same at every width.
- **Meter labels.** The visible labels are the short names the desktop column head uses — Size, Patt, Oth, Cmte — over the bars on a phone; each meter's accessible name keeps the full word ("Pattern: strong"). Four meters labelled with full names at the 9.5px type floor take ≈214px, leaving a 375px row's filer ≈120px, so most rows would take a fourth line.
- **Compact tags on line 1.** A multi-line LATE tag reads "LATE 701/703" on screen ("701 of 703 lines late" for assistive technology; the opened row states it in full); a grouped row's count reads "×8" (", 8 filings"). The group's latest filing sits beside the receipt for assistive technology and, visibly, in the opened row's grouping.
- **The sheet is opened by activation.** At ≤720px hover and focus do not raise a sheet, leaving the trigger does not close it, and a tap inside it is not an outside click — a hover-opened sheet covers its own trigger and flickered closed (measured in the preview). Escape, the scrim, Close and the trigger dismiss it.

### Measured on the owner-tier build (20260817.1)

Measured on the M1 owner-tier build of the T0 inputs (`.codex-review/m1/measured-counts.json`, outside the tree):

| Measure | Value |
|---|---|
| Rows ranked ("of N rows ranked") | 51 — Stands out 13, Worth a look 2, Routine 36; the same 51 row keys, in the same order, as T0's page |
| Hits | 716 active; 580 listed-stock lines (the default view), 580 hits |
| Hit lines in the server's DOM | 40 (`SIGNAL_HITS_DOM_ROWS`), the first 10 visible |
| Fitted base at 1440 × 900, at load | 24 lines; Filings to read's content ends 20px below the hits column's, under one hit row |
| Fitted base at 1440 with Routine open | 91 lines (past the 40 held: one artifact fetch) |
| Base where the band stacks (1080, 390) | 10 (the minimum) |
| `dist/signals/index.html` | 293,962 bytes (T0: 153,648) — the 30 held hit lines and the opened-row bodies |
| `signals.v1.json`, the notable-moves shard, the route set | byte-identical to T0 (the `t0-baseline` block above) |

One row of this data build takes a fourth line at 375px: Ron Wyden's AMCR exchange, whose ticker in this pre-fix data build is the malformed two-leg cell "-- AMCR" (the Senate exchange fix, 933b3d6, corrected it at ingest after 20260817.1). Beside "EXCHANGE" its range wraps rather than overlapping the filed date; it takes three lines from 390px.

## Reversed decisions

None in M1. The SIGNALS-CLARITY title, "Congress signals", is kept until M2 adds the 13F tabs (`LD9`).
