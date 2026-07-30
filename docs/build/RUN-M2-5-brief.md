# RUN M2-5 — Identity coverage: the SEC Official 13(f) List

**Status:** PLAN — no code yet. Owner decision recorded below; implementation
follows the standard run discipline (plan → review → dev → QA gates).
**Prepared 2026-07-25**, with fresh live source verification the same day.

---

## 1. The problem, restated precisely

The M2-3 coverage gate withholds the `inst` module below **95% identity
coverage by value**: the fraction of reported holdings (weighted by value)
whose CUSIP resolves to a registered security identity **valid as-of the
report period** (G14 — no identity time-travel).

The only identity source admitted so far is **SEC fails-to-deliver (FTD)**,
which observes a CUSIP only on days that security actually failed settlement.
Measured on the real corpus (2026-Q1): all 29 distinct CUSIPs are known, but
only 15 carry intervals covering the period date → **~50% coverage by value**.
The gate fails closed forever on FTD alone. This is the gate working, not a
bug: FTD is structurally sparse.

**We are not missing data — we are missing *dated validity*.** The decision is
which source supplies it.

## 2. What Project Compass did, and why we cannot take it

Investigated on disk 2026-07-25 (`~/projects/Project Compass`):

- Compass's institutional module maps CUSIP→ticker via **Bloomberg OpenFIGI**
  (`compass/data/cusip_map.py`: `map_batch_openfigi`, name-match fallback,
  retry-unmapped tiers), keyed by an optional free API key.
- Its market data comes from **Databento, Yahoo, IEX, Polygon, FMP, IBKR** —
  all vendor feeds.

Three independent disqualifiers for Populus:

1. **G1 / §15 admission test.** Compass *consumes* privately; Populus
   *redistributes* publicly. OpenFIGI is a Bloomberg service under Bloomberg
   terms — not a primary source, not redistribution-clean. Every Compass data
   path fails the admission test ("pullable free from a primary source,
   redistributable under recorded conditions").
2. **G14.** OpenFIGI answers "what does this CUSIP map to **now**" — exactly
   the present-day-mapping inference Populus forbids for historical periods.
   Compass never needed dated validity; it scores recent flows.
3. **Different product.** Compass's identity is a best-effort enrichment for
   private signals. Populus's identity is a published, provenance-tracked
   claim. The bar is different in kind.

**What we DO take from Compass:** the code *patterns* — batch mapping,
counted dispositions, name-normalization fallback, retry-unmapped — are
already reflected in our `parse_company_tickers` discipline. Nothing else
transfers.

**On "something live that updates as data comes in":** liveness was never the
gap. Populus is a nightly re-ingest/re-publish pipeline; FTD updates
twice-monthly and company_tickers daily, and both flow through on every
publish. The gap is that FTD only *mentions* a CUSIP on failure days. A live
feed of the same sparse source would still be sparse.

## 3. Options considered (the A/B/C decision)

| | Option | Verdict |
|---|---|---|
| **A** | **Admit a free primary source with real validity intervals** | **CHOSEN — the SEC Official 13(f) List (§4)** |
| B | Inference layer: assume an observed mapping extends backward unless contradicted, labeled with confidence | **Rejected for now.** Publishing inferred identity contradicts the primary-source brand (G5 tension), and A turns out to be *definitionally* complete — inference buys nothing A doesn't. Revisit only if A's measured coverage disappoints. |
| C | Lower the 95% threshold or change its basis | **Rejected.** The gate caught a real coverage problem; moving the bar because it fired is how honesty projects stop being honest. |

Also evaluated and rejected for the primary role:

- **SEC N-PORT** (monthly fund holdings; CUSIP + issuer name + LEI): strong
  *enrichment* candidate, but third-party-declared (fund filers, not a
  registry), enormous volume, and it answers "what did funds hold", not "what
  is a registered 13(f) security this quarter". **Deferred as follow-up
  enrichment** (ticker/LEI density) — not needed for the gate.
- **OpenFIGI / GLEIF**: vendor / non-primary for this purpose (GLEIF is
  authoritative for LEIs, but LEI→CUSIP is not its data).

## 4. The chosen source — verified live 2026-07-25

**The SEC's Official List of Section 13(f) Securities.** Published by the SEC
**quarterly**; it is the *definitional* universe: the exact securities filers
must report on Form 13F for that quarter, one row per CUSIP, with the SEC's
own canonical issuer name and class.

Verified today (UA `populus-mcp/0.0.1 johnbaekk@gmail.com`):

- Index: `sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities`
  (the old `divisions/investment/13flists.htm` 301-redirects there — both
  recorded).
- Quarterly files at `sec.gov/files/investment/13flist{YYYY}q{N}.pdf`,
  present on the index back through 2024; older quarters exist in the SEC
  archive (backfill range confirmed during the run).
- **2026Q2 additionally ships a plain-text variant**
  (`13flist2026q2-txt.txt`, HTTP 200, 2,051,973 bytes, **25,333 rows**,
  fixed-width: 9-char CUSIP · issuer name · class · flags). Probed 2026q1 and
  2025q2 text variants: **404** — historical quarters are **PDF only**.

**Why this is the right source and not merely an adequate one:** the coverage
gate asks *"is this CUSIP a registered 13(f) security, valid this quarter?"*
This document is the SEC's own answer to that exact question, per quarter. A
well-formed 13F holding's CUSIP appears on that quarter's list **by
construction** — filers report against it. Expected coverage: ~100% minus
malformed rows. And one canonical issuer name per CUSIP, consistent across
every filer, directly strengthens cross-filer issuer keying (today's `name`
tier suffers filer-to-filer spelling drift).

## 5. Requirements

- **R1 — Conditions-register entry** (`sec-13f-list`, §15): source URLs (old +
  new + file pattern), retrieval discipline, license basis (SEC public
  record), and an explicit **counsel-gate flag: CUSIP redistribution** (CUSIP
  Global Services asserts IP in CUSIP identifiers; the SEC publishes them, and
  Populus already redistributes CUSIPs from 13F filings and FTD, so this adds
  no *new* exposure class — but the register must record it and the existing
  P2-entry counsel gate must name it).
- **R2 — Fetcher** through the existing `SecClient` (rate floor, UA, cache,
  breaker — no second HTTP client), quarterly files cached under
  `data-cache/13flist/` with full §5.1 provenance (URL, sha256,
  retrieved_at).
- **R3 — Text parser** for the fixed-width variant. Column layout taken from
  the file itself against committed fixtures — no guessed offsets.
- **R4 — PDF parser** for historical quarters, reusing M1's PDF machinery.
  Legend semantics (option-asterisk, ADDED/DELETED status, flag columns) read
  from the document's own legend page and encoded as tested dispositions —
  never assumed.
- **R5 — Cross-format validation gate:** 2026Q2 exists in BOTH formats; parse
  both and require **row-for-row identity** (CUSIP, name, class, flags). This
  is the PDF parser's ground-truth acceptance and it is non-negotiable.
- **R6 — CUSIP validation**: check-digit verification; malformed rows are
  counted dispositions (the `parse_company_tickers` pattern), never silent
  drops (G3). Parse-coverage gate: ≥99.9% of non-legend lines dispositioned.
- **R7 — Registry seeding**: each quarterly list registers CUSIP identities
  with validity interval **exactly that quarter** — `[quarter_start,
  quarter_end]`, no extrapolation beyond observed lists (G14). Consecutive
  lists yield contiguous coverage. Re-seeding the same list is idempotent
  (replay-zero, the M2-1 discipline). Canonical issuer name recorded with
  source precedence below `securities.yaml` (owner authority) and above
  FTD-observed names.
- **R8 — Backfill scope**: ingest every list covering a period present in the
  loaded corpus (config: start quarter; default = earliest loaded
  `period_of_report`). Archive availability for pre-2024 confirmed during the
  run, recorded in the register entry.
- **R9 — Gate re-measurement (the acceptance)**: on the real Berkshire corpus,
  with lists 2025Q1–2026Q1 ingested, measured value-coverage **≥95%** for
  every covered period (expectation ~99%+). Report the exact figure; never
  assert it.
- **R10 — End-to-end publish acceptance**: build → publish with the gate
  PASSING → `inst` module admitted to the manifest → the already-shipped
  serving lifecycle installs it → `inst_ticker_holders`/`inst_filer_holdings`
  answer from published data with `inst_from_published_manifest=True`. The
  withheld path (gate failing on FTD-only) remains covered by existing tests.
- **R11 — Honest degradation for uncovered quarters**: a period *outside*
  ingested list coverage contributes zero coverage (fail-closed, exactly as
  today) and the gate reason names the uncovered quarters.
- **R12 — No regressions**: full suite green; behavioral fixes
  mutation-verified; composition truth table and pipeline-agreement suites
  untouched and green.

## 6. Non-goals (explicit)

- **No inference layer** (option B not exercised).
- **No gate change** (option C rejected; threshold and basis unchanged).
- **No ticker enrichment beyond existing tiers** — the list has no tickers;
  `inst_ticker_holders` keeps its present-day company_tickers path with its
  existing G14 labeling. N-PORT enrichment is a separate, later decision.
- **No dashboard work** (P3 proceeds independently on the design brief).

## 7. Risks

| Risk | Mitigation |
|---|---|
| PDF layout drift across years | Fixture per sampled era; R5 ground-truth gate on the dual-format quarter; parse-coverage gate fails loud |
| Legend/flag misreading | R4: semantics from the document's own legend, fixture-tested |
| Pre-2024 archive gaps | R8 confirms range first; R11 keeps uncovered quarters honestly failing |
| CUSIP IP claims | R1 counsel flag; no new exposure class vs. current published artifacts |
| List published late in quarter | Filings arrive ≤45 days *after* quarter end; the covering list long precedes ingestion in practice; R11 covers the race honestly |

## 8. Sizing

One orchestrated run, M2-2-scale (fetcher + two parsers + seeding + gate
re-measure + publish acceptance). Smaller than M2-1. The serving side needs
**zero changes** — M2-4 built and hardened it; this run only makes the gate
pass so the existing machinery finally has something to serve.
