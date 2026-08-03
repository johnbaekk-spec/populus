# plan-v1: RUN M2-9 — Portfolio intelligence layer (sector, index-proxy, composition, cross-filer anomaly)

**Transport mode:** `interactive-disk`. **Scope class: L.**
**Status: DRAFT — NOT APPROVED.** Six owner decisions (OD-1..OD-6) are open.
**Depends on: RUN M2-8** (full holdings corpus + multi-period history). M2-9 is a
layer *on top of* M2-8 and cannot start before it lands. **M2-8 is unchanged by
this plan and is under external review as written** — nothing here modifies it.

---

## Goal and Success Criteria

Turn the holdings corpus into something that answers portfolio-shape questions a
reader cannot get from EDGAR at any price of effort:

1. **How is this manager's book organized?** Sector allocation (the pie chart),
   concentration, single-name vs fund/ETF exposure.
2. **Are they index-shaped or stock-picking?** What share of the book sits in
   broad-market funds vs individual operating companies.
3. **Who is buying off-index?** Positions in issuers that appear in none of the
   major index-proxy baskets.
4. **Who just changed character?** A manager whose book is habitually large-cap
   taking a first meaningful small-cap position — measured against *their own*
   history, not a market-wide norm.
5. **Where are managers converging?** The same issuer newly bought or materially
   added by many unrelated filers in the same period.
6. **Which of these are activist situations?** Schedule 13D/13G overlay from
   primary EDGAR filings.

Success = each of the six renders from published data with a stated, testable
definition; every classification carries its source and its coverage percentage;
and no surface presents a derived label as if it were a reported fact.

**Explicitly out of scope and deferred to RUN M2-10:** anything involving prices,
returns, excess-vs-benchmark, or hit rates. See §Non-goals and the feasibility
finding in Current State — it is buildable from primary sources, but it is a
different and far riskier class of claim and must not be bolted onto this run.

---

## Requirements

- **R1** — **Issuer identity resolution.** Populate the CUSIP → issuer (CIK) and
  CUSIP → ticker links in the existing §5.4 identity substrate, with per-row
  provenance, confidence, and review state. Unresolved rows stay visible and
  flagged (G3), never dropped or guessed. **This is the hard prerequisite for R2,
  R5 and every ticker display; it is measured at 0% today.**
- **R2** — **Sector classification** from SEC-assigned SIC (`sic`,
  `sicDescription` on `data.sec.gov/submissions/CIK<n>.json`), joined via R1.
  Labelled as SIC, never as GICS. Unclassified value is reported, not hidden.
- **R3** — **Security-type classification** distinguishing operating company /
  ETF or registered fund / trust / other, so "index exposure" is not conflated
  with "stock picking". Derived from primary EDGAR attributes, with an explicit
  `unknown` state.
- **R4** — **Index-proxy baskets** built from the index ETFs' own **N-PORT
  filings** on EDGAR (SPY → S&P 500, QQQ → Nasdaq-100, IWM → Russell 2000),
  matched **CUSIP ↔ CUSIP** so R4 does **not** depend on R1. Every basket carries
  its source accession, its period, and its filing lag. Presented as *"as held by
  SPY per its N-PORT filing of <date>"* — **never** as index membership.
- **R5** — **Sector-allocation surface** per filer per period: value and share by
  sector, with unclassified value shown as its own explicit slice, never
  redistributed across known sectors and never dropped.
- **R6** — **Composition surface** per filer per period: share of book in
  broad-market funds vs individual operating companies vs unknown.
- **R7** — **Off-index accumulation detector**: new or added positions whose
  issuer appears in **none** of the R4 baskets for the matching period, with the
  basket set and its as-of date stated on every row.
- **R8** — **Style-drift detector**: a filer taking a position in a basket
  segment it has historically not used (e.g. first material Russell-2000-proxy
  position from a filer whose prior-`K` books were large-cap-proxy). Defined
  against the filer's **own** prior history, with an explicit `awaiting_baseline`
  NULL state when history is too shallow.
- **R9** — **Cluster detector**: issuers newly bought or materially added by ≥N
  unrelated filers in the same period. **Unrelated** must exclude the
  affiliated-manager duplication 13F already produces (`otherManager`) — an
  affiliate group is one decision, not N.
- **R10** — **Activist overlay** from Schedule **13D / 13G** filings on EDGAR,
  joined to issuer and filer. 13D and 13G are distinguished (control intent vs
  passive) and never merged into one "activist" label.
- **R11** — **Honesty rules for every derived claim in this run.** Each of R7, R8,
  R9 carries: a published definition, an explicit NULL/`awaiting_baseline` state,
  annotation-only status (no decision path reads the flag), a banned-wording list,
  and the non-removable 13F `data_note`. Coverage percentage is displayed wherever
  a classification is used to compute a share.
- **R12** — **Conditions-register entries (§15, G11) written before any ingest**
  for every new source: `sec-nport` (ETF portfolio filings) and `sec-13d`
  (Schedule 13D/13G). SIC arrives via the existing `sec-edgar` submissions entry;
  confirm rather than assume.
- **R13** — **Budgets.** New shard classes (sector rollups, basket membership,
  cluster feed) are counted into the §12.1 file-count and per-file-size gates and
  hard-fail CI at the caps, together with M2-8's shards.
- **R14** — The full standing gate set stays green: `make test` (pytest +
  `dashboard-gates`), `make security` (`dep_guard`), two-build reproducibility
  digest, ≥0.95 value-coverage certification, plus a new `accept-m2-9`.

---

## Scope

Python: `src/populus/identity/resolve_issuers.py` (R1),
`src/populus/inst_sector.py` (R2/R3), `src/populus/inst_baskets.py` (R4),
`src/populus/inst_signals.py` (R7/R8/R9), `src/populus/ingest/nport.py`,
`src/populus/ingest/sc13d.py`, extensions to `inst_agg.sql`, `publish/build.py`,
`cli.py`.

Dashboard: composition and sector components, a signals feed, and extensions to
the three institutional surfaces M2-8 fills.

Docs: `M2-9-signal-definitions-spec.md` (the R7/R8/R9 definitions, reviewed before
code), register entries, contract amendment for the new datasets.

## Non-goals

- **No prices, no returns, no excess-vs-benchmark, no hit rates, no manager
  scoring.** Deferred to RUN M2-10 under its own spec and review.
- **No GICS.** Licensed; SIC is the primary-source substitute and must be named as
  such.
- **No index constituent lists.** S&P 500 / Nasdaq-100 / Russell 2000 membership
  lists are licensed IP; only ETF N-PORT holdings are used, labelled as a proxy.
- **No editorial manager labels.** "value / growth / macro" style tags and quality
  tiers are opinions about real firms; if any tag ships it must be mechanically
  derived and named for its mechanism (e.g. "has filed a 13D in the last N
  quarters"), never a house judgement. See OD-5.
- No change to M2-8's contract, schema, or gates.
- No deployment.

## Constraints

- **Primary sources only**, free to pull *and* free to redistribute.
- **No exchange price data ever** (founding scope rule) — binds RUN M2-10, and is
  why the price substrate must come from the filings themselves if it comes at all.
- Cloudflare Pages 20,000 files / 25 MiB per file; Populus global cap 15,000 files
  shared with M1, M2-8 and M3.
- SEC politeness floor ≤2 req/s, SEC-accepted UA, ETag cache, breaker; all HTTP
  through `SecClient`. G7: no browser calls to SEC.
- NULL-honest integer semantics; no float in a digest; G3 never-drop; G4 as-of;
  G14 no CUSIP→current-ticker→CIK time-travel.
- $0/mo infra.

---

## Current State

**Live-verified 2026-08-01/02. Measured, not assumed.**

### The prerequisite nobody has built (the single most important finding)

| Measurement | Value |
|---|---|
| Holdings with a `security_id` | 598,530 / 602,496 = **99.3%** |
| Holdings resolving to an issuer **CIK** | **0 — zero** |
| `securities.entity_link_state` distribution | **`unresolved`: 22,521. `resolved`: 0.** |
| `security_identifiers` rows (CUSIP↔ticker etc.) | **empty — 0 rows** |
| `entities` rows carrying a CIK | 8,017 (the *filer* side; issuers are not linked) |

The §5.4 identity substrate exists **as schema and is unpopulated on the issuer
side.** Every screenshot ambition that needs a *company* rather than a *CUSIP* —
sector, industry, ticker display, SIC-based anything — is blocked on R1. This was
not visible from the plan documents and only surfaced by querying the corpus.
**R1 is therefore the critical path of this entire run, not a detail.**

R4 (index proxies) is deliberately designed to match **CUSIP ↔ CUSIP** precisely so
it is *not* blocked on R1 and can proceed in parallel.

### Sources verified live against SEC this session

| Source | Probe | Result |
|---|---|---|
| **SIC / sector** | `data.sec.gov/submissions/CIK0001045810.json` | **200** — `sic: "3674"`, `sicDescription: "Semiconductors & Related Devices"`, `ownerOrg: "04 Manufacturing"`. Free, primary, per-issuer. |
| **N-PORT / index proxy** | `data.sec.gov/submissions/CIK0000884394.json` (SPDR S&P 500 ETF Trust) | **200** — files **`NPORT-P`**; 27 in the recent window; latest **2026-05-28**, accession `0001410368-26-055357`. Confirms the primary-source path to basket membership. |
| **Activist overlay** | same submissions payload | `SC 13G` present among form types — Schedule 13D/13G are ordinary EDGAR forms and are reachable by the same machinery. |

**Filing-lag caveat, stated up front:** SPY's latest N-PORT was *filed* 2026-05-28
and covers an earlier period. A basket is therefore always **as-of its filing**,
never "today", and R4 must render that date beside every use.

### Price feasibility — a finding for RUN M2-10, not for this run

The screenshots that prompted this work include a *forward-excess-vs-SPY* table.
That needs prices, which the founding scope rule forbids buying. **Prices are
nevertheless derivable from the filings themselves** — every 13F row reports both
value and share count, so `value_usd / ssh_prnamt` is an implied quarter-end price,
and across ~1,800 independent filers the median is stable:

| Issuer | Holders | Median implied price | Within ±1% of median | Within ±5% |
|---|---|---|---|---|
| NVIDIA | 1,821 | **$200.09** | 77.7% | 80.8% |
| Apple | 1,803 | **$289.36** | 79.5% | 81.6% |
| Microsoft | 1,592 | **$373.02** | 86.2% | 89.8% |
| **SPY (the benchmark itself)** | 1,164 | **$746.77** | 88.5% | 93.2% |

Naive mean is useless (spread >100,000% — unit-basis and share-count errors);
**median plus a minimum-holder floor is robust.** Because SPY is itself widely
held, a benchmark exists on the same footing.

**Why this is still deferred.** It yields **quarter-end points only** — so 1M and
6M horizons of the kind shown in the screenshots are *impossible*, and only
quarter-to-quarter (~3M) and multiples are computable. It is ex-dividend, not
split-adjusted without separate detection, and it is a *consensus estimate*, not an
exchange print. Above all it converts the product from *reporting what was filed*
into *asserting how a named manager performed* — the strongest claim in the
building. That deserves its own spec, its own review, and its own run.

### What already exists to build on

`inst_bulk.py` (discovery/ranking/resumable ingest), `SecClient` (the only HTTP
path), the `agg_*` aggregate tables, the three institutional dashboard surfaces,
the §5.4 identity schema (populated on the filer side, empty on the issuer side),
and cached SEC fails-to-deliver zips under `data-cache/inst/ftd/`
(`cnsfails202603b.zip`, `cnsfails202606b.zip`) — the CUSIP↔ticker bootstrap named
by OQ-8 and the natural seed for R1.

---

## Detected Stack

Python 3.12, `uv` frozen lockfile, `pytest -q`, `click`, SQLite/JSON1, `httpx`
only via `SecClient`. Dashboard: Astro 7 static, Node 24.16.0, `node:sqlite`,
`node:test` + post-build gates. Gates: `make test` (= `test-python` + `dashboard-gates`),
`make security`, `make check`, `accept-m2-*`. No stack-cache block exists (no
`CLAUDE.md`/`AGENTS.md` at root); detected fresh from `pyproject.toml`, `uv.lock`,
`Makefile`, `dashboard/package.json`.

## Reuse Map

| Need | Existing symbol / path | Decision | Why |
|---|---|---|---|
| Fetching anything from SEC | `SecClient` (§11.4) | **Reuse — mandatory** | `dep_guard` forbids a second HTTP client; politeness floor, UA, ETag, breaker already correct. |
| N-PORT / 13D discovery + fetch | `inst_bulk.py` discovery + journal pattern | **Extend** | Same submissions→accession→document walk already implemented and resumable; new form types, same machinery. |
| CUSIP↔ticker seed for R1 | `data-cache/inst/ftd/*.zip` + the `sec-ftd` register entry (OQ-8) | **Reuse** | Already admitted, already cached, purpose-built for exactly this. |
| Identity storage for R1 | `securities`, `security_identifiers`, `entities`, `entity_tickers` | **Reuse — populate, do not reshape** | Schema already models provenance/confidence/review-state and the NULL+reason invariant; it is empty, not wrong. |
| Per-filer per-period rollups | `agg_filer_concentration` pattern in `inst_agg.sql` | **Extend** | Sector/composition rollups are the same grain (cik × period) with a new dimension. |
| Change classification for R7/R9 | `agg_qoq_deltas` (`change_kind`) | **Reuse** | new/add/trim/exit is producer-owned; signals read it rather than recomputing. |
| Own-history baselines for R8 | the M2-8 cross-period baseline view + `awaiting_baseline` state | **Reuse the pattern exactly** | One baseline mechanism for both runs; a second would drift. |
| Affiliate de-dup for R9 | M2-2 `otherManager` de-dup already applied in `v_default_holdings` | **Reuse** | Prevents an affiliate group counting as N independent buyers. |
| Shard emission + budget gate | `publish/build.py` count-before-freeze | **Extend** | Add new shard classes to the same hard CI cap. |
| Surfaces | the three `institutional/*` routes + `lib/format.ts` | **Extend** | Same components, new panels. |

New implementations justified: `resolve_issuers.py` (no issuer-resolution code
exists — measured 0% resolved), `inst_baskets.py` (no N-PORT parser exists),
`inst_signals.py` (isolated so each derived definition is independently testable),
`ingest/nport.py` and `ingest/sc13d.py` (new form parsers).

## Architecture

**Layering (each layer is independently useful and independently revertable):**

```
M2-8 corpus (full holdings, K periods)
   │
   ├── R1 issuer identity  ──► R2 sector (SIC) ──► R5 sector allocation
   │        (critical path)     R3 security type ─► R6 composition
   │
   ├── R4 index-proxy baskets (CUSIP↔CUSIP, NOT blocked on R1)
   │        └──► R7 off-index accumulation
   │        └──► R8 style drift (+ own-history baseline)
   │
   ├── R9 cluster detection  (pure 13F — no external dependency at all)
   └── R10 activist overlay  (Schedule 13D/13G)
```

**Sequencing consequence:** R9 has no prerequisite and can ship first; R4/R7 need
only N-PORT; R2/R5 wait on R1. If R1 proves harder than estimated, the run still
delivers R4, R7, R8, R9, R10 — sector allocation is the only casualty. This is
deliberate: the plan is staged so the riskiest dependency cannot sink everything.

**Basket semantics (R4).** A basket is a *set of CUSIPs held by one ETF as of one
N-PORT filing*. It is not an index. Three named baskets (SPY, QQQ, IWM) with an
explicit `basket_asof` and `basket_accession` on every derived row. "In no basket"
means "absent from these three baskets as of these dates" — which the UI must say
in those words, because an issuer can be in a real index and absent here through
lag, sampling, or share-class mismatch.

**Signal definitions (R7/R8/R9)** are written and reviewed in
`M2-9-signal-definitions-spec.md` **before** `inst_signals.py` exists, with integer
predicates, explicit NULL states, and a truth table per signal.

## Locked Decisions

1. **No prices in this run.** Any return, excess, or hit-rate metric is M2-10.
2. **SIC, not GICS.** Named as SIC everywhere it appears.
3. **ETF N-PORT baskets, not index membership.** Always rendered with the ETF name
   and the filing date; never "S&P 500 member".
4. **R4 matches CUSIP↔CUSIP** so the index dimension is not hostage to R1.
5. **Unclassified is a visible slice**, never redistributed and never dropped.
6. **Affiliated managers collapse to one decision** in R9 clustering.
7. **13D and 13G stay distinct**; neither is renamed "activist" without the form
   name attached.
8. **All R7/R8/R9 flags are annotation only** — no ranking, filtering, or exclusion
   reads them (the rule M2-7 established for `cover_conflict`).

### Open — unresolved, and they block approval

- **OD-1 — R1 resolution strategy and its acceptance bar.** FTD-seeded CUSIP↔ticker
  then ticker↔CIK via `company_tickers.json`, vs a direct CUSIP↔CIK path. What
  coverage percentage (by value) is acceptable to ship a sector pie? *Recommendation:*
  ≥90% by value, with the unclassified remainder always displayed.
- **OD-2 — Basket set.** SPY + QQQ + IWM only, or add a total-market and a
  mid-cap basket? *Recommendation:* start with the three; each added basket is
  permanent surface area and another lag caveat.
- **OD-3 — R9 cluster thresholds.** Minimum unrelated-filer count and minimum
  position size to qualify as a cluster.
- **OD-4 — R8 style-drift thresholds** and `MIN_BASELINE_PERIODS`, consistent with
  M2-8's OD-3 so the product has one baseline notion, not two.
- **OD-5 — Manager style/tier labels.** Ship a mechanically-derived label
  (e.g. "filed a 13D in the last N quarters"), or ship none? *Recommendation:*
  none beyond mechanical 13D/13G facts. A "value/growth/macro" tag on a named firm
  is an opinion the filings do not support, and it is the one element of the
  reference screenshots with no primary-source basis.
- **OD-6 — Does RUN M2-10 (prices/returns) proceed at all?** The feasibility
  measurement above says it *can* be built honestly at quarterly granularity. It is
  a separate question whether it *should*.

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| License GICS sectors | Not redistributable; breaks the commons' founding scope test. |
| Scrape index constituent lists from index-provider sites | Licensed IP and non-redistributable; also not a primary source. |
| Buy a price feed for the returns table | Violates "no exchange price data ever"; the licensed Compass feed must never touch Populus. |
| Bolt prices/returns onto this run | Conflates "classify what was filed" with "assert how a manager performed". Different risk class, different review. |
| Ship sector allocation before R1 is solved | Would require guessing issuer identity from names — precisely the G3/G14 violation the substrate exists to prevent. |
| Skip R1; classify by CUSIP-6 issuer block only | Gives grouping but no sector, no ticker, no SIC — most of the ask. Retained as the *fallback* rendering when R1 leaves a row unresolved. |
| Editorial style/tier tags to match the reference UI | Unsupported opinion about named firms. See OD-5. |

## Planned Files

**New — Python**
- `src/populus/identity/resolve_issuers.py`
- `src/populus/inst_sector.py`
- `src/populus/inst_baskets.py`
- `src/populus/inst_signals.py`
- `src/populus/ingest/nport.py`
- `src/populus/ingest/sc13d.py`
- `tests/test_resolve_issuers.py`
- `tests/test_inst_sector.py`
- `tests/test_inst_baskets.py`
- `tests/test_inst_signals.py`
- `tests/test_nport_parse.py`
- `tests/test_sc13d_parse.py`
- `scripts/accept_m2_9.py`
- `tests/test_accept_m2_9.py`

**New — docs**
- `docs/build/M2-9-signal-definitions-spec.md`
- `docs/build/RUN-M2-9-brief.md`

**New — dashboard**
- `dashboard/src/lib/composition.ts`
- `dashboard/src/components/SectorAllocation.astro`
- `dashboard/src/components/CompositionBar.astro`
- `dashboard/src/components/SignalsFeed.astro`
- `dashboard/src/pages/institutional/signals.astro`
- `dashboard/test/composition.test.ts`
- `dashboard/test/signals-fold.test.ts`

**Modified**
- `src/populus/inst_agg.sql`
- `src/populus/inst_agg.py`
- `src/populus/publish/build.py`
- `src/populus/cli.py`
- `Makefile`
- `docs/build/M2-CONTRACT.md`
- `ARCHITECTURE.md`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/README.md`

## Implementation Tasks

**T0 — Register entries first (R12).** Write §15 conditions-register entries for
`sec-nport` and `sec-13d`, and confirm SIC is covered by the existing `sec-edgar`
entry. **No ingest of a new form type before its entry exists (G11).**

**T1 — Signal-definitions spec (R11).** Write and get reviewed
`M2-9-signal-definitions-spec.md`: integer predicates and truth tables for R7, R8,
R9; NULL/`awaiting_baseline` states; banned-wording list; the exact sentence each
surface uses to describe a basket. **Reviewed to APPROVED before `inst_signals.py`.**

**T2 — Issuer identity resolution (R1) — critical path.** Seed CUSIP↔ticker from
the cached FTD data, join to `company_tickers.json` for CIK, write
`security_identifiers` and the `securities.entity_id` link with provenance,
confidence, and `review_state`. Enforce the existing invariant that a NULL link
carries an explicit reason. **Report measured coverage by row and by value** — the
number, not an adjective.

**T3 — Sector + security type (R2, R3).** Fetch `sic`/`sicDescription` per
resolved issuer through `SecClient`; classify security type; store with as-of
semantics (G4). Unknown is a first-class value.

**T4 — N-PORT ingest and baskets (R4).** Parse `NPORT-P` for SPY/QQQ/IWM; build
CUSIP sets with `basket_asof` + `basket_accession`; no R1 dependency.

**T5 — Schedule 13D/13G ingest (R10).** Parse the forms; join issuer and filer;
keep 13D and 13G distinct.

**T6 — Rollups (R5, R6).** Sector and composition aggregates at cik × period,
integer-only, NULL-honest, with an explicit unclassified bucket and a stored
coverage figure per rollup.

**T7 — Signals (R7, R8, R9).** Implement to the T1 spec. Mutation-verify every
branch — especially that a thin baseline yields `awaiting_baseline` rather than a
flag, and that an affiliate group cannot inflate a cluster count.

**T8 — Surfaces.** Sector allocation and composition on the filer page; a signals
feed at `/institutional/signals`; basket as-of dates and coverage percentages
rendered wherever a derived share appears.

**T9 — Honesty sweep (R11).** Enumerate what every breakpoint drops; extend the
fold test to the new components; confirm the `data_note`, coverage figures, and
basket as-of dates survive at 375px.

**T10 — Budgets (R13).** Count new shard classes into the §12.1 gate alongside
M2-8's.

**T11 — Acceptance + gates (R14).** `accept_m2_9.py` end-to-end on the real
corpus; `make test`, `make security`, digest equality, coverage certification.

## Testing Strategy

- **Hermetic** — fake transport, no sockets; committed N-PORT and 13D fixtures.
- **R1** — provenance and review-state written on every link; a NULL link always
  carries a reason; no name-based guessing; G14 respected (no
  CUSIP→current-ticker→CIK time-travel across periods).
- **Baskets** — a fixture N-PORT round-trips to an exact CUSIP set; `basket_asof`
  is the filing's period, not ingest time; a stale basket is detectable.
- **Signals** — the T1 truth tables; `awaiting_baseline` asserted for every history
  depth below the minimum; an affiliated pair asserted to count once in a cluster.
- **Rollups** — sector shares plus the unclassified slice sum exactly to the total
  (integer arithmetic, no rounding leak); a NULL/zero total yields no share and no
  division.
- **Mutation verification** — reintroduce each defect and confirm *behaviour*
  changes: drop the `awaiting_baseline` guard; redistribute unclassified value
  across known sectors; let an affiliate group count twice; let a flag feed a
  filter; drop `basket_asof` from a rendered row.
- **Dashboard** — `node:test` on `composition.ts`; `signals-fold.test.ts` asserting no
  coverage figure, basket date, or caveat is `display:none` at 375/720/desktop.
- **Real-corpus acceptance** — read-only against the ops corpus, hash-verified.

## Verification Matrix

| Req | Verified by | Evidence |
|---|---|---|
| R1 | `test_resolve_issuers` + T2 report | measured coverage by row and by value; provenance on every link |
| R2 | `test_inst_sector` | SIC values match the live submissions payload for named fixtures |
| R3 | `test_inst_sector` | ETF vs operating company separated; `unknown` preserved |
| R4 | `test_inst_baskets`, `test_nport_parse` | fixture N-PORT → exact CUSIP set; as-of + accession stored |
| R5 | `test_inst_sector` + post-build gate | sector shares + unclassified sum to total exactly |
| R6 | `composition.test.ts` | fund vs single-name vs unknown shares render with coverage |
| R7 | `test_inst_signals` | off-basket rows carry basket set and as-of date |
| R8 | `test_inst_signals` + mutation | `awaiting_baseline` below the minimum; drift measured vs own history |
| R9 | `test_inst_signals` | affiliated pair counts once; threshold boundary at ±1 |
| R10 | `test_sc13d_parse` | 13D and 13G distinct; joined to issuer and filer |
| R11 | `signals-fold.test.ts` + T9 | no honesty element hidden at any breakpoint; banned wording absent |
| R12 | register diff | entries exist and predate ingest |
| R13 | `test_inst_shard_budget` (extended) + `stats.json` | measured counts under caps |
| R14 | `make test`, `make security`, digest gate | full suite green; two builds identical |

## Rollout / Rollback

Staged so no layer can sink the others: T0/T1 (records + spec) → T2 (R1, critical
path, ops-local) → T4/T5 in parallel (no R1 dependency) → T3/T6 (need R1) →
T7 → T8/T9 → T10/T11. Nothing is published until the budget gate passes.

**Rollback** is the existing immutable-build + pointer-generation mechanism; no new
machinery. If R1 coverage lands below the OD-1 bar, sector surfaces (R2/R5) are
withheld while R4/R7/R8/R9/R10 still ship — the layering makes that a
configuration outcome, not a code rewrite.

## Simplicity Audit

Minimum coherent design: **six new Python modules, four new dashboard components,
one new route.**

- `resolve_issuers.py` — the measured 0%-resolved gap; nothing exists.
- `inst_sector.py` — SIC + security-type classification, one module because both
  are per-issuer attributes on the same join.
- `inst_baskets.py` — basket sets and membership tests, separate from the N-PORT
  *parser* so basket semantics are testable without XML.
- `ingest/nport.py`, `ingest/sc13d.py` — one parser per new form type, matching the
  existing `ingest/` layout.
- `inst_signals.py` — all three derived signals in one reviewable module; they
  share the baseline and affiliate-collapse helpers, and splitting them would
  duplicate both.
- Four components + one route — the surfaces the requirements name, no more.

**Rejected abstractions:** a generic "classification framework" over sector/type/
basket (three concrete dimensions do not justify it); a pluggable signal-rule
engine (makes definitions less reviewable — the same reason M2-8 rejected it); a
generic form-parser factory (two forms, different shapes); caching layers beyond
`SecClient`'s existing ETag cache.

## Tech Debt Introduced

- **TD-M2-9-1 — Basket lag is structural.** Owner: pipeline. A basket is always
  as-of an N-PORT filing that trails the 13F period, so "in no basket" can be wrong
  for a genuinely-indexed issuer. Impact: false positives in R7. Removal condition:
  none available — mitigated permanently by rendering the as-of date and by wording
  the claim as "absent from these baskets as of these dates".
- **TD-M2-9-2 — SIC is coarse and dated.** Owner: product. SIC predates modern
  sector taxonomies and misclassifies conglomerates and newer business models.
  Impact: sector pie is approximate. Removal condition: only a licensed taxonomy
  would fix it, which the scope rule forbids — so it stays, named as SIC.
- **TD-M2-9-3 — R1 coverage will be partial.** Owner: pipeline. Some CUSIPs will
  never resolve (foreign issuers, private placements, expired identifiers). Impact:
  a permanent unclassified slice. Removal condition: none; the slice is displayed
  rather than removed.
- **TD-M2-9-4 — Three baskets is an arbitrary cut.** Owner: product (OD-2).
  Mid-cap and total-market exposure are invisible. Removal condition: an owner
  decision to add baskets, each with its own lag caveat.

## Memory Touch-Points

- `~/.claude/skills/_shared/failure-modes.md` — always loaded; sweep below.
- **`specify-before-rewriting`** — T1 writes and reviews all three signal
  definitions before any signal code exists. Three derived claims in one run is
  exactly the condition that produced the repo's worst patch-spirals.
- **`measure-the-mechanism`** — why the corpus was queried before planning; it is
  the only reason the 0%-resolved blocker surfaced instead of being discovered
  mid-build.
- **`mockups-are-not-measurements`** — the reference screenshots are a *target*,
  not a data source; several of their columns (style, tier, forward excess) have no
  primary-source basis and are called out rather than copied.
- **`design-handoff-honesty-fold`** — new components mean new fold risk; T9 and
  `signals-fold.test.ts` exist for it.
- **`mutation-tests-pin-properties`** — the mutation list above.
- **`reversing-a-reviewed-decision`** — M2-8 amended the contract; M2-9 adds new
  datasets to it and must amend additively the same way.
- **`john-baek-profile`** — every source in Current State was probed live this
  session; every corpus figure is measured; estimates are labelled.
- **`populus-project`** — scope test (free to pull *and* redistribute, primary
  sources, no exchange price data) is what forces SIC-not-GICS, N-PORT-not-index,
  and the deferral of returns.

## Failure-Mode Sweep

- **F0 full-set sweep — ✓.** All three institutional surfaces plus the new signals
  route are in scope; every new dataset gets a register entry, a contract row, a
  coverage figure, and a fold test.
- **F0 secrets — N/A.** No credentials; all sources are public and keyless.
- **F0 verify-don't-assume — ✓.** SIC, N-PORT and 13G availability were probed live
  against SEC this session with the SEC-accepted UA; the 0%-resolved identity gap
  was measured, not inferred. Filing lag was observed, not assumed.
- **F1 enumerate all consumers — ✓.** Dashboard, MCP snapshot, published aggregate,
  and the federated boundary each considered.
- **F1 exact full gate set — ✓.** `make test` (pytest + `dashboard-gates`),
  `make security`, two-build digest, ≥0.95 coverage certification, `accept-m2-9`.
- **F1 units + NULL/awaiting state — ✓.** Every share is integer bps; every signal
  has an explicit NULL/`awaiting_baseline`; unclassified is a value, not an absence.
- **F1 re-baseline against the live tree — ✓.** Written against the merged P3-2 +
  M2-7 tree and the live ops corpus.
- **F1 simplicity audit completeness — ✓.** Every new file enumerated; matches
  Planned Files.
- **F2 full-tree gate scope — ✓ (planned).** `make test` covers the repo.
- **F2 behavioural test validity — ✓ (planned).** Mutation list per signal.
- **F2 bulk SQL — ✓ (planned).** Rollups are set-based over the corpus, not
  per-row loops over ~1M rows.
- **F2 dead CSS selectors — ✓ (planned).** Fold test verifies against rendered DOM.
- **F3 verify function not liveness — ✓ (planned).** Acceptance asserts rendered
  values, not that a build completed.
- **F3 doc-drift — ✓ (planned).** Contract and architecture amended additively.
- **F4 propagation sweep — ✓ (planned).** After the contract amendment, re-grep for
  every parallel dataset claim.
- **F5 transport — ✓.** `plan-v1`, interactive-disk; planned files extractable.
- **N/A:** prod-write auth (no production writes), config→settings rename,
  connection-pooler read-only, RLS/ACL simulation, deploy runbook (out of scope).

## Definition of Done

1. **R12** — register entries for `sec-nport` and `sec-13d` exist and predate any
   ingest of those forms; SIC coverage under `sec-edgar` confirmed.
2. **R11** — `M2-9-signal-definitions-spec.md` reviewed to APPROVED before signal
   code; banned-wording check passes on every surface.
3. **R1** — issuer resolution coverage reported **measured** by row and by value
   against the OD-1 bar; every unresolved row carries an explicit reason.
4. **R2, R3** — SIC and security type match live SEC payloads for named fixtures;
   `unknown` preserved.
5. **R4** — fixture N-PORT yields an exact CUSIP set; `basket_asof` and accession
   stored and rendered.
6. **R5, R6** — sector and composition shares plus unclassified sum exactly to the
   total; coverage figure displayed.
7. **R7** — every off-basket row states the basket set and as-of dates.
8. **R8** — style drift measured against own history; `awaiting_baseline` renders
   for a filer with insufficient history.
9. **R9** — an affiliated manager pair counts once; threshold boundary tested.
10. **R10** — 13D and 13G distinct and joined correctly.
11. **R13** — measured file count and max shard bytes inside §12.1 caps with M2-8's
    shards included; CI fails at the cap.
12. **R14** — `make test` green, `make security` clean, coverage ≥0.95 certifiable,
    `make accept-m2-9` exit 0 — all reported measured.
13. Every figure in the dev notes labelled **measured** or **estimated**; no
    estimate presented as a measurement.
14. **No price, return, excess, or hit-rate value appears anywhere in this run's
    output.**
