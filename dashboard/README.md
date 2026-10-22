# Public Filings dashboard

The public static dashboard (ARCHITECTURE §12): Astro, static output,
deployed publisher-side on Cloudflare Pages, live at
[publicfilings.org](https://publicfilings.org). It renders congressional
trading and institutional (13F) surfaces from **one published data build**,
with the honesty layer (dual dates, range amounts, provenance links,
published imperfection) as first-class content — the design contract is
[docs/frontend/design-principles.md](../docs/frontend/design-principles.md).

## Build and gates

```bash
cd dashboard
npm ci
npm run check        # astro check / tsc
npm test             # node --test over test/*.test.ts
npm run build        # emits dist/
npm run preview      # serves dist/ on :4321
npm run gates        # check + test + build + test:post + geometry — the full chain
```

`npm run gates` sequences `test:post` (`test/post/*.test.ts`) **strictly
after** the build so post-build checks never run against a stale `dist/`; it
spawns `astro preview` for the served status contract, performs an isolated
forced-cut build into `dist-cut/`, and builds the institutional fixture
preview into `dist-fixture/`. The build carries a 32 GiB physical-memory
preflight and a 24 GiB Node heap, and the geometry lane needs Chromium, so
the full chain is **owner-tier** (see the root README's gate model); `check`
and `test` run anywhere. The whole chain also runs under the repository's
canonical `make test`. Node is pinned by `.node-version`; the DB is read with
`node:sqlite` — no native dependencies.

**`test:post` does not exit 0 on any tree.** Several of its expectations
describe a build the local toolchain cannot produce (a dev build with no
institutional module, a holders cut the baseline data does not contain), and one
lane shells out to a nested build that times out under load. The expected
failures are recorded **by name** in
[`docs/maintenance/POST-BUILD-BASELINE.md`](../docs/maintenance/POST-BUILD-BASELINE.md),
with the date and the data build they were measured against. Compare a run
against that list by name: a failure whose name is not on it is a new failure,
whatever the total count is.

`src/lib/format.ts`, `src/lib/derive.ts`, and the `src/lib/ui/` domain
modules (entry point `src/lib/ui/index.ts`) are pure and
environment-agnostic precisely so the honesty rules can be tested without a
browser or a database.

## Data inputs

The site builds from **one published data build** and never resolves
`latest.json` (the dashboard is not a pointer consumer — §12.1):

| Variable | Meaning |
|---|---|
| `POPULUS_BUILD_DIR` | path to `builds/<build_id>` of the data repo (CI: required, from the staged verified build) |
| `POPULUS_DB` | path to the matching `congress.db` release snapshot (CI: required) |
| `POPULUS_DATA_REPO` | **dev only** — a local data-repo checkout; the newest `builds/<id>` is used. Defaults to `../populus-data`. |
| `SITE_CODE_SHA` | the commit the site was generated from. Emitted verbatim as `<meta name="populus:code_sha">` on every page; CI passes the **full** `github.sha` because deploy verification compares the marker exactly. Dev fallback: `git rev-parse --short HEAD`. |
| `POPULUS_TICKER_MAP` | path to a `company_tickers.json` snapshot (SEC primary source) — the ticker→issuer mapping input. Dev default: the committed pipeline fixture. **Under `CI` a path resolving into `tests/fixtures/` is refused** (fixture data must never ship as production truth). An absent path → every ticker renders the honest no-map state, which is what the deployed site ships (TD-7). |
| `POPULUS_INST_DB` | optional override for the institutional aggregate path; default `$POPULUS_BUILD_DIR/inst_agg.db`. The module renders only when the manifest declares `inst` AND the artifact is readable. |
| `POPULUS_TEST_PAGE_BUDGET` | **test only** — forces a small entity-page budget so the rank-cut → `/e/` path is provable. Production uses the §9.10-derived constant. |

What is read, all of it from published artifacts (published artifacts are the
API): `builds/<id>/congress/stats.json` (tiles, as-of, data note — and its
raw bytes re-served verbatim at `/stats.json`), `builds/<id>/manifest.json`
(module availability), `builds/<id>/DATA-LICENSE.md` + `NOTICE` (served
verbatim under `/legal/`), and `releases/data-<id>/congress.db` plus, when
declared, `inst_agg.db`.

## Route map

- `/` — Home; `/methodology/` — the honesty ledger, a first-class surface
- `/congress/` — the feed (SSR page 1 + a vanilla-TS client island over the
  byte-bounded parts under `/congress/data/feed/`, indexed by
  `/congress/data/feed/index.v1.json` and listed for a human reader at
  `/congress/data/`; the former single-asset `/congress/data/feed.v1.json` is a
  retirement tombstone — see
  `docs/architecture/data-contracts/congress-feed-transport.md`);
  `/congress/members/[bioguide]/`,
  `/congress/tickers/[ticker]/` (+ index), `/congress/leaders/`
- `/institutional/` — filer index; `/institutional/filers/[cik]/`;
  `/institutional/tickers/[t]/holders/`; versioned JSON shards under
  `/institutional/data/`
- `/tickers/[ticker]/` — the unified ticker view; `/signals/`,
  `/search/index.v1.json`
- `/e/` — the generic client-rendered entity route for budget-cut entities,
  rendering through the **same** pure body functions (`src/lib/ui/`) the
  static pages use — parity by construction
- `/financials/`, `/macro/` — forward-looking module shells
- `/legal/DATA-LICENSE.md`, `/legal/NOTICE.txt`, `/stats.json`, `404`

Entity pages render through pure body functions under `src/lib/ui/` — domain
modules re-exported by the single consumer entry `src/lib/ui/index.ts`; the G1–G7
honesty components are pure string renderers in `src/lib/format.ts` — one
implementation each (grep-enforced by test), consumed by SSR pages and the
client drivers alike, because forked render paths break byte-parity
verification.

## Rendering contracts

- Pagination and count semantics are specified in
  [docs/frontend/pagination-and-counts.md](../docs/frontend/pagination-and-counts.md);
  quarter-over-quarter presentation is producer-authoritative per
  [docs/frontend/qoq-presentation.md](../docs/frontend/qoq-presentation.md).
- The uncertainty grammar (denominators stated, NULL vs 0, hatched ranges,
  indeterminate rows counted, no-map and withheld states, universal-caveat
  hoisting) is specified in
  [docs/frontend/design-principles.md](../docs/frontend/design-principles.md) §3;
  the mobile fold is §5 of the same document, enforced by
  `test/css-fold.test.ts`.
- The only browser storage is the reader's light or dark theme choice
  (`localStorage` key `populus:theme`), in this browser only and never
  transmitted. `public/theme-init.js` also removes, once and best-effort, the
  four `populus:watch*` keys the device-local watchlist wrote before it was
  removed (declared debt TD-1; remove the cleanup on or after 2027-01-31). No
  cookies and no accounts; fonts are self-hosted, and the only third-party
  requests are the cookieless Cloudflare Web Analytics beacon's (see
  `/methodology/#privacy`).

## Deviation register — the Signals v4 mock

The approved mock (https://claude.ai/artifact/GUFeqGmfBnTfHY6C44tpb8) is
authoritative on layout, behaviour and copy intent. It is not authoritative
where following it would remove honesty content or break a site rule
(design-principles §1, §4, §5). Each departure is recorded here with its
measurement, so it can be reconciled design-side rather than rediscovered;
the full record is `docs/frontend/signals-v4.md`.

- **LD22-1.** **Phone rows keep the trade date, the lag and the receipt.** The mock's
   ≤720px rows hid them (`display: none`). Here the receipt holds the row's
   first line and "traded {date} · {lag}d" its third (151px for the longest,
   "traded 2025-04-15 · 477d"); the fold gate sweeps both, and the geometry
   suite reads both unclipped at 320–430px.
- **LD22-2.** **The owner word is on the collapsed row**, not only in the opened one
   ("Self" … "owner not stated", 25–85px in the filer cell).
- **LD22-3.** **The slim hits keep traded → filed**; the mock showed the filed date only.
- **LD22-7.** **Tap targets follow G12** — 44px at ≤720px or under a coarse pointer, not
   the mock's 32px (the pane switch's buttons measure 44px at 390px).
- **LD22-8.** **No `title=` tooltips.** Every hover text is a tip or an `aria-label`; the
   `src/lib` `title=` survivor count stays 18.
- **LD22-11.** **A long filer name gives way to an ellipsis** on the collapsed row above
   720px — the mock's own `.a-who` behaviour, kept so the row is two lines at every
   width. Only the name shrinks; party and state, owner, ×N, tags and LATE keep their
   width, a cluster's member count never shrinks, and the full name stays in the DOM
   and the opened row (no `title=`). Filer cell ≥283px at 1081px, 348px at 1440px.
- **LD22-4.** **Every Congress line on the Institutional tab shows both dates** —
   "traded {date} → filed {date} · {lag}d" — with its range, owner word and receipt,
   through the one `congressLineHtml`; the mock's moves showed the trade date only.
- **LD22-5.** **Banned wording replaced:** the mock's "Both bought / Both sold",
   "▼ sold" and "highest-conviction" are side nouns and counts here (purchase, sale,
   ▲/▼ with their words for assistive technology); "Conviction leaders" renders only
   through its markup-bound reference label, and its anchor is
   `#new-position-leaders` (the §0 gate reads raw bytes, ids included).
- **LD22-6.** **Listed stock is the filed ST / Stock only** in the Congress column; the
   mock also counted untyped rows, so its counts are not this build's.
- **LD22-9.** **The opened move row carries only what the row does not say** — the
   manager type, the filing and quarter, the ticker's verification, the filer page and
   the Congress side — not the mock's sentence repeating the row's numbers.
- **LD22-10.** **The mock's "Mock only" moves-file tip is the page's real bound:** the
   page carries the first 30 moves of every filter (20 when the page would pass its
   2 MiB budget) and every move on a Consensus or lead-card name; where a filter
   runs past them the count keeps the build's true total and says so.
- **LD22-5 (M3).** **Banned wording replaced on Overlap and Playbooks:** "Both bought /
   Both sold" are SAME · BUY SIDE / SAME · SELL SIDE, "▲n bought ▼n sold" are ▲n · ▼n
   with their words, "highest-conviction" left the best-ideas pattern, and "Opportunistic
   insider buying" is "Opportunistic insider purchases".
- **LD22-6 (M3).** **Overlap counts listed stock as filed only**, as the Congress column
  does, so its names are not the mock's 142 and 41.
- **LD22-8 (M3).** **No `title=` on the playbook strips or the evidence:** a strip is a
  link that names its playbook for assistive technology; each finding's venue and
  sample are visible under its citation.
- **LD22-12.** **Overlap carries a bounded run of names per view** — the first 24 of
  each view (12 when the page would pass its budget) — with every count the true total
  and the bound stated where a view runs past it; the mock rendered every name.
- **LD22-13.** **An opened Overlap row lists each member's newest Congress line** (at
  most 12 a side, every line with its range, owner, both dates and receipt; the rest on
  the ticker page) **and each manager's largest change** (at most 5 a side, with its
  13F receipt); the mock listed every line with its trade date only.
- **LD22-14.** **Overlap's relation control starts at All**, with and without script;
  the mock started at Same.
- **LD22-15.** **"Triggers now" rows are full Congress lines** (ticker, member, owner,
  side, range, both dates, receipt) with a link to the row, not the mock's abbreviated
  row.
- **LD22-16.** **The phone playbook strip keeps each playbook's status**; the mock hid it.

Design-side reconciliation is still owed for each.

## Deviation register — the launch redesign mock

The approved launch mock (Design canvas version 9,
https://claude.ai/artifact/9xxeAvHRP53NHgRZ1k4jVU, approved 2026-10-20) is
authoritative on structure, behaviour and copy intent, never on numbers. Each
departure is recorded here with its reason. DV1–DV20 are the plan's (LD35);
DV21 onward were made during the build. The full record is
`docs/frontend/launch-redesign.md`.

**Home**

- **DV1.** The committee card keeps `COMMITTEE_CAVEAT`; the mock dropped it.
- **DV2.** Notable managers keep Filed (Manager, Ticker, Change, Δ $, Filed);
  the header word is Change, never Move.
- **DV4.** The trust strip says only what is true: members and committees come
  from CC0 congress-legislators and the jurisdiction map is the site's own (in
  a tip), and the site is "rebuilt on each publish", not every day.
- **DV5.** No "Today" and no live dot on the ledger.
- **DV7.** Counts and labels say "13F filers", never "funds".
- **DV13.** No "updated daily" kicker (design-principles §8: no cadence claim).
- **DV14.** The hero search is a launcher into the masthead combobox
  (`#site-search`), not a second search field.
- **DV24.** The Try chips come from the build: the search index's two most
  active tickers and two most active members, and the notable 13F filer
  reporting the largest value. The mock's five chips are literals (Pelosi,
  NVDA, Berkshire Hathaway, Tuberville, MSFT), which `MOCKUP_LITERALS` keeps
  out.

**Every page**

- **DV3.** The footer keeps three links (Methodology, Sources & licenses,
  Legal); the mock's fourth, Privacy, is not added (LD9).
- **DV15.** No as-of stamp in the footer; the build date shows on the home
  ledger and on Methodology.
- **DV20.** The 13F footer sentence stays verbatim (D7): global-03 and the
  footer half of holders-02 are not applied.
- **DV12.** The phone drawer has no Home entry (the brand links home) and no
  Sign in or Sign up (D2).
- **DV21.** The drawer's section counts ship `hidden` and show only when the
  drawer opens, so a closed drawer adds no words to any page's served HTML
  (the SC5 ruler) and the nav's three-link pin stands.
- **DV9.** No line clamp on owner, partial or flag text; the mock's `.csub`
  clamp could hide them.
- **DV23.** Tables stay `<table>` elements and fold into row cards at ≤720px
  (D4); the mock draws div grids with ARIA roles. One renderer serves desktop
  and phone, the roster and post-build parsers keep reading tables, and
  explicit roles (`withTableRoles` over the page body, `rolesFor` on client
  repaints) keep the table semantics WebKit drops under the card layout (R40,
  LD37).

**Congress**

- **DV6.** Monthly flow says "with a purchase / with a sale", not the mock's
  banned "buying / selling".
- **DV17.** Party and the EXCHANGE side stay under More filters; the mock
  dropped them.
- **DV18.** No "All tickers →" link to the stub; the boards expand in place
  ("Show 50 more").
- **DV22.** The pager's count is visually hidden at every width (congress-23).
  The count line above the feed states the same range with the hidden rows and
  "filtered on this device", so the mock's pager text says it twice; with the
  pager's count visible again the fixture page reads over its 240-word gate
  (`launch-congress-budget.test.ts`).

**Member pages**

- **DV10.** Trades page 25 rows (`MEMBER_PAGE_SIZE`) where the mock's desktop
  board shows 20; the feed's transport page size is unchanged.
- **DV19.** Top tickers adds "Show all N tickers"; the mock showed 8 rows, so
  the rest were unreachable.
- **DV25.** Top tickers' Net keeps the interval grammar (≥ when one-signed, ≈
  when it overlaps the row above), lists tickers with a wholly undisclosed side
  last behind a separator, never as zero, and announces the bar's ranges.
- **DV26.** The quarterly readout counts "purchases and sales", not the mock's
  "trades"; the open quarter reads "so far (inside the 45-day filing window)";
  exchange and unparsed-side rows are stated as not drawn (review H2: 140 of
  283 member pages read "26Q4: 0 trades").

**Signals and Methodology**

- **DV11.** Triage row bodies stay server-rendered (D6), so /signals/ stays
  over 3,000 elements; the overage is in the decision record.
- **DV16.** Playbooks stay anchors (`a.pbi`), one article shown at a time by
  script, not a tablist; every article is in the served HTML.
- **DV8.** Methodology's roster stays a table, folded as cards on phones; the
  mock's definition list would break the roster parse.

**Copy**

- **DV27.** Of the copy audit's 120 items, 60 are applied, 7 applied by #163,
  48 adapted and 5 not applied (`test/fixtures/launch-copy-ledger.json`).
  Adaptations keep what a test pins or a ban forbids: 33 for honesty pins (2
  of them not applied, signals-05 and signals-08), 2 for banned wording
  (congress-10 "buying", signals-15 "move" as a verb), 17 superseded by the
  layout (home-09 and home-10 not applied) and 1 owner decision (global-03,
  D7). Two cuts were reverted at review to keep a caveat: an opened triage row
  with a committee overlap keeps "Context, not an allegation." (signals-07),
  and the lead cards keep "listed-stock … in the window" (signals-04).

**Matches the mock, departs from the live page** (recorded so neither reads as
a regression): the quick filters (Rows, Side, Chamber) carry no visible label,
each group keeping its aria-label; Top tickers has the mock's four columns
(Ticker, the purchases ◂ ▸ sales bar, B·S, Net), so the live page's Issuer and
Last traded columns are gone.

Design-side reconciliation is still owed for each.

## Build markers and `/stats.json`

Deploy verification reads two things out of the built site:

- **`<meta name="populus:build_id">` and `<meta name="populus:code_sha">`**
  on every page, parsed by name and compared **exactly** — never a substring
  search over visible text. `/methodology` shows the same two values once as
  text (`build <id> · code <sha7>`, the first seven characters of the sha); the
  footer no longer prints them (SIGNALS-CLARITY M1, 2026-09-29,
  `docs/design/SIGNALS-CLARITY-DECISIONS.md`). No page renders a **digest**:
  the manifest is re-assembled after the site builds, so any rendered digest
  would be stale by construction.
- **`/stats.json`** — the raw bytes of `builds/<id>/congress/stats.json`
  passed through verbatim. The route must never parse and re-serialize;
  `test/post/http-status.test.ts` pins the served bytes, the emitted `dist/`
  bytes, and the canonical copy together.

Note for CI runners: the gates are not runnable under a bare `CI=1` (the data
layer refuses the newest-local-build fallback there), and the two builds that
deliberately use fixture inputs (`fixture-preview`, `entity-orchestration`)
need `CI` cleared in their child environment. Neither is a shipping build.

## Response-header defense in depth (RUN PUBLIC-SECURITY-HARDENING PR 5)

`public/_headers` is the one Cloudflare Pages provider control this site ships
(LD13): the locked CSP (`script-src 'self'` plus only the R28 analytics beacon
origins — no inline hashes, no `unsafe-eval`), HSTS `max-age=31536000`
(deliberately without `includeSubDomains`/`preload`, so `max-age=0` remains an
emergency rollback), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and (security audit R2,
L12) `Permissions-Policy: camera=(), microphone=(), geolocation=(),
payment=(), usb=()`. The deploy verifier locks every one of these values
exactly (`REQUIRED_RESPONSE_HEADERS` in `src/populus/deploy/verify.py`), so a
change here is a change there, and to the tests that pin both. The same
audit added `public/.well-known/security.txt` (RFC 9116), which points at the
repository's `SECURITY.md` and carries a one-year `Expires` that the
post-build suite refuses once past.

Because `script-src` carries no hashes, **no executable inline script may exist
anywhere in the built tree**. Two mechanisms keep that true:

- the pre-paint theme IIFE lives in `public/theme-init.js`, loaded
  synchronously from `<head>` (`is:inline src=` — external, unbundled, no
  FOUC), and
- `vite.build.assetsInlineLimit: 0` in `astro.config.mjs` stops the bundler
  from re-inlining small modules (the masthead toggle module was one).

`test/post/inline-surface.test.ts` gates both after every build: the emitted
executable-inline-script set must be EMPTY, the policy must pin zero hashes,
`theme-init.js` must be referenced synchronously from every page's head, and
`dist/_headers` must be byte-identical to `public/_headers`.
`<script type="application/json">` data islands are inert and exempt.

Deploy-side, `_headers` is an **attested control**: site inventory v2 lists it
under `controls` (kind `cloudflare-pages-headers`), and preview/production
verification requires the exact header values on representative HTML/JS/CSS/
JSON responses while `/_headers` itself still answers 404 (Pages consumes it
as configuration). `src/populus/deploy/verify.py` pins
`LOCKED_CONTENT_SECURITY_POLICY` against the shipped bytes — edit the policy in
both places or the deploy refuses.
