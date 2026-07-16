# Populus — Architecture (v2.2)

**The open financial-data commons: finance data that is free to pull from primary sources and redistributable under recorded conditions, served as an MCP server and a public dashboard. Congressional trading ships first.**

| | |
|---|---|
| Status | Draft for owner review — no implementation until approved (P0 gate) |
| Author | Claude (Fable 5), 2026-07-16, on the Mac mini |
| v2.2 | Revision addressing external review **round 2** (REQUEST CHANGES; 4 critical, 5 high, 6 medium). Key changes: counsel review now precedes the **first public data artifact** (P1 runs against a private staging repo); the M1 identity contract is reproducible from the schema (raw fields stored, canonical serialization, 128-bit fingerprints, source-coordinate duplicate identity); the artifact trust model is real (immutable releases enabled, Sigstore attestations consumer-verified, all consumed files build-scoped); 13F confidential-treatment and unit-cutover semantics corrected; unresolved amendments no longer double-count. Round-2 dispositions in [REVIEW-RESPONSE.md](REVIEW-RESPONSE.md). |
| v2.1 | Addressed external review round 1 (15 findings). **This document is self-contained and supersedes v1.0/v2.0/v2.1 entirely; no earlier version is normative.** v2.1 is commit `f7985f6` — rounds are now diffable. |
| Inputs | CodexSOL handoff (2026-07-15); live verification 2026-07-16 in three rounds (Appendices A, B); external review 2026-07-16; Project Compass — Architecture v2.6 (read, not reused) |
| Companions | [HANDOFF-REVIEW.md](HANDOFF-REVIEW.md) (review of the original handoff) · [REVIEW-RESPONSE.md](REVIEW-RESPONSE.md) (finding dispositions) |
| License | MIT (code). Data: per-source conditions register, §15 |
| Repos | `populus` (code) · `populus-data` (published artifacts) |

---

## 1. Executive summary

Populus aggregates financial data that meets a strict admission test — **pullable for free from a primary source, and redistributable under conditions we record and honor** (§2.2) — into one canonical, provenance-tracked platform with two consumers: an MIT-licensed MCP server (`uvx populus-mcp`) and a static public dashboard. It is built as **domain modules on a shared substrate**, strictly one module at a time:

| Module | Domain | Primary sources | Verification state (2026-07-16) |
|---|---|---|---|
| **M1 — Congressional trading** | House + Senate PTRs | House Clerk bulk index; Senate eFD | **Fully specified (§9); all sources verified end-to-end (App. A); builds first** |
| M2 — Institutional holdings | 13F filings | SEC EDGAR (keyless) | Scoped (§10.2); filing path + datasets page verified (App. B) |
| M3 — Company financials | XBRL facts, submissions | SEC `data.sec.gov` + nightly bulk archives | Scoped (§10.3); APIs + `companyfacts.zip` (1.39 GB) verified |
| M4 — Macro | Yields, CPI, employment, GDP, COT | Treasury, BLS, CFTC (verified); BEA, FRED (keyed; **not yet verified beyond signup/docs pages**) | Scoped (§10.4) |
| M5+ — Backlog | Form 4, annual FDs, FTD, N-PORT… | SEC and agency sources | Cataloged (§10.5) |

The substrate — pipeline framework, provenance and licensing model, temporal identity registries, artifact publication protocol, honesty layer, ops, security, one MCP server, one dashboard — is built once during M1. Later modules are bounded increments admitted under a written **module contract** (§7) and sequenced by guardrail G12.

Three properties are the product:

1. **Primary-source, end to end.** Every fact is reproducibly traceable to a government document or API response (§5.1). No unlicensed third-party intermediaries anywhere (G2).
2. **Honest by construction.** Disclosure lags on every record; coverage, freshness, and known gaps published per module; estimates labeled; each source's redistribution conditions recorded *before* ingestion and shipped machine-readably with the data (§15).
3. **≈$0/month, within stated limits.** GitHub Actions + Release-asset distribution + Cloudflare Pages + user-side MCP execution, each used inside its provider's published limits with measured thresholds and named migration triggers (§6, §13.4). Only bill: ~$12/yr domain.

Reputation play first, revenue second. Launch sequence: M1 pipeline → MCP server (registry listings + launch post) → dashboard → subsequent modules, each a launch event on the same compounding assets. A paid tier, if ever ($5/mo-class), charges for convenience, never for data (G13), and is gated on counsel review — which is *also* required **before the first public data artifact exists**: P1 builds and publishes against a **private staging repo**; the data repo flips public only after the P2-entry counsel gate (§15.3, §17).

---

## 2. Product thesis and scope boundary

### 2.1 Thesis

Free financial data exists in abundance but is fragmented across agency sites, bulk files, and undocumented endpoints. The people who have unified it sell it back ($30–200/mo keys). Populus unifies the free layer and keeps it free, with provenance and honesty as differentiators, distributed where analysts now work — inside LLM clients via MCP — plus a public dashboard. "Populus": the people's data, returned to the people.

### 2.2 The admission test

A source is ingested only if it passes all four, with the determination recorded in the conditions register (§15) first (G11):

1. **Primary source** — a government agency or the legally-designated disclosure venue. Licensed seeds and agency-operated aggregators may enter only through the conditions register with provenance retained (G2).
2. **Free to pull** — no paid key anywhere in the chain. Free-registration keys (BLS enhanced, BEA, FRED) only under the key policy (§11.5).
3. **Redistributable under recorded conditions** — public domain, an open license, or public records whose statutory/terms-of-service conditions we can record, honor, and pass through to users. *This is deliberately not "unrestricted":* congressional disclosures carry statutory prohibited-use conditions (5 U.S.C. § 13107(c)); BLS requires retrieval-date citation and a disclaimer; FRED is per-series. Each condition becomes a machine-readable register entry shipped with the data. "Public record" is never treated as synonymous with "public domain" (§15).
4. **Analyst-relevant** — earns its maintenance cost against the roadmap.

**Permanently out of scope by this test:** exchange market data (real-time or historical prices/quotes/bars) as a redistributed dataset; paid-vendor data (Massive/Polygon, QuiverQuant, Unusual Whales, Bloomberg…); scraped aggregator content. Where a module needs a value reference it uses values embedded in the primary filings themselves (13F `value`, disclosed amount ranges) — never a quote feed.

### 2.3 Goals

- Make "what has Congress traded / what does Berkshire hold / what did AAPL report / where are yields?" answerable inside any MCP client in under a minute, free, with provenance.
- Build the substrate once; make each domain a bounded, gated module.
- Publish data quality per module: freshness, coverage, join rates, known gaps.
- Compound one reputation asset across module launches.
- Keep run cost ≈$0/mo, within providers' published limits, with measured escape hatches.

### 2.4 Non-goals

- **Not a signal or advice product.** Populus reports disclosures and statistics; it never scores, recommends, or backtests. "Not financial advice" is a design constraint.
- **Not a market-data terminal** (§2.2).
- **Not everything at once.** Strictly sequential modules (G12).
- **No accounts, payments, alerts, or hosted write APIs** through M1–M4.
- **Not a Compass extension** (DR-1) — no shared runtime, data, or code with the private trading system.

---

## 3. Decision records

### DR-1 — Standalone repo; Project Compass contributes idioms only

**Context.** Project Compass (`~/projects/Project Compass`) is John's live, mature private trading radar: architecture doc at v2.6, 153+ merged PRs, launchd-scheduled jobs, a frontend, QA-gated milestones. It is single-user by design ("multi-viewer-ready, not multi-user-ready", Compass §12/§17), carries a hard anti-scope-creep guardrail (Compass §19.1), runs on licensed **Massive** market data (Polygon rebranded 2025-10-30; Advanced plan, $199/mo), and enforces a single-writer embedded-DB discipline that locks its analytical store during market hours.

**Decision.** Populus shares **no runtime, database, process, or code dependency** with Compass, in either direction. What carries over is discipline, by copying: QA-gated phases, versioned data pins, parse-or-flag honesty, watchdog patterns, decision records, anti-pattern guardrails.

**Justification.** (1) License isolation — Massive data is contractually restricted; a public free product must be provably clean, and the only way to prove a negative is structural separation plus a CI dependency guard (G1). (2) Shape mismatch — public/multi-consumer/zero-cost/append-mostly vs. private/single-user/paid-realtime/market-hours-locked; no component survives both requirement sets. (3) Blast radius — a public project's contributors and CI churn must not be able to touch a live system John trades with. (4) Compass's own constitution forbids the coupling.

**Consequences.** Some idiom duplication (logging, retry helpers). Extraction into a shared package only after the same code exists three times and hurts.

### DR-2 — Build order: data layer → MCP tools → dashboard, per module

**Decision.** Within every module: data first, MCP second, dashboard third. M1 additionally builds the substrate.

**Justification.** The data layer carries the technical risk (scrapers, parsers, reconciliation); both consumers are thin. MCP-first produces the earliest reputation event (registry listings + launch post) and free QA — real analyst questions surface normalization bugs before the dashboard bakes them into rendered pages and SEO'd URLs. Dashboard-first was rejected: largest surface, slowest loop, and its differentiator (honesty/provenance UI) depends on machinery the data phase builds anyway.

### DR-3 — Language: Python 3.12, `uv`-managed

**Decision.** Python for pipeline and MCP server, one package. TypeScript only in the static-site toolchain.

**Justification.** The work is dominated by document extraction and API normalization — `httpx`, `lxml`, `pdfplumber`/`pypdf` (verified working on a real House PTR), later `pytesseract`; Python's extraction ecosystem has no TS peer. MCP SDK quality is a tie (`uvx` = `npx` for install friction); tie goes to the pipeline language, and one language lets the server import the store layer directly. Operator fluency: the proven Senate reference scraper and all Compass idioms John reviews are Python.

**Consequences.** A Cloudflare-Workers-hosted MCP endpoint (TS-native) is not free; the deferred hosted-HTTP option (§11.6) targets the Mac mini behind a Cloudflare Tunnel instead. Acceptable: stdio via `uvx` is the primary distribution.

### DR-4 — SQLite canonical stores; published artifacts are the API

**Decision.** Each Pattern-R module owns a SQLite database built by the pipeline; consumers read **published, immutable, manifest-verified artifacts** (§5.5), never the pipeline's live handle. No server RDBMS anywhere.

**Justification.** M1 is ~54k rows ≈ tens of MB — a server database adds an ops surface, a credential, and a free-tier suspension risk while solving nothing. SQLite beats static-JSON-only because MCP tools need ad-hoc filtering; the dashboard, which doesn't, gets flat JSON. Single-writer is natural (one serialized publish pipeline, §13.3). Nothing in M1–M4 requires shared mutable state.

**Consequences.** A hosted API tier (P-Ω) would put a service in front of the same artifacts — consumer-side change only.

### DR-5 — Two repos; git for manifests/registries, Releases for artifacts; data repo starts private

**Decision.** `populus` (code) and `populus-data` (artifacts) are separate repos. `populus` is public from day one (MIT code). **`populus-data` starts private (staging) and flips public only after the P2-entry counsel gate** (§15.3) — so no data artifact is publicly distributed before legal review. Within `populus-data`, git tracks only build manifests, `latest.json`, registries, and `licenses.json`; **all consumed data files — SQLite snapshots, JSON slices, `stats.json`, raw-archive bundles — are Release assets or build-scoped files referenced by the manifest** (§5.5).

**Justification.** Separation keeps code history reviewable while the data repo commits daily (which also keeps its scheduled workflows active, §13.4). Release assets avoid binary-artifact git bloat, clone degradation, and GitHub's documented right to throttle repositories used as CDNs. **GitHub Release immutability is a repository feature that must be explicitly enabled — it is not automatic**; enabling *immutable releases* on `populus-data` is a P0 setup item verified by the §14 checklist.

**Consequences.** Growth thresholds and a migration trigger are defined in §13.4 (successor: Cloudflare R2 free tier). Raw filings are bundled into periodic Release assets rather than committed individually. While private, Actions minutes are metered (2,000/mo free tier) — P1's nightly jobs are estimated <300 min/mo, within it (§13.6); the external monitor's PAT needs read scope on the staging repo until the flip.

### DR-6 — Names

`populus` on PyPI is taken (defunct Ethereum framework). **Package: `populus-mcp`** — availability observed 2026-07-16 (PyPI 404), which is *not* a reservation: **P0 includes publishing a `0.0.1` placeholder immediately upon approval** (owner executes or explicitly delegates; it is an outward-facing action). Repos `populus`/`populus-data`. Domain: OQ-1, ~$12/yr.

### DR-7 — Multi-domain modular platform; congressional is Module 1

**Context.** Owner re-scope 2026-07-16: the target is the full free-and-redistributable layer of finance data, not a congressional-only product.

**Decision.** Populus is a module platform: shared substrate + domain modules conforming to the §7 contract. M1 = congressional trading (also carries the substrate build). Order thereafter: M2 institutional → M3 company financials → M4 macro → backlog (owner's stated order).

**Justification.** (1) The wedge logic survives re-scoping — congressional is the highest-attention niche where, as of 2026-07-16 registry searches, no free/open-source/primary-source dedicated MCP exists. (2) The substrate is genuinely shared — provenance, publication, honesty, registries, dashboard shell are identical needs in every domain. (3) Sequential depth preserves the institutional bar; a parallel build would produce four shallow modules.

**Consequences.** M1 carries substrate cost (framework interfaces, not one-off scripts) — repaid at M2. Scope sprawl becomes the platform's top risk — countered by G12 and §17's gates.

### DR-8 — Two ingestion patterns: replicate-and-publish vs. federate-live

**Decision.** Every dataset declares a pattern: **Pattern R** (pipeline owns a canonical store; immutable snapshots published; consumers read snapshots) for sources without APIs and for cross-entity aggregation products; **Pattern F** (fetch from the government API at question time, from the user's machine, cached and normalized locally; Populus stores only routing registries) for sources that already are free, keyless, automation-tolerant JSON APIs.

**Justification.** (1) Cost containment: federated reads are made by each user against infrastructure the agencies operate for exactly this purpose, within published fair-access rules — Populus's own infra carries none of it. (2) Freshness: federated answers are as fresh as the agency. (3) Replication only where it adds value: cross-entity aggregates (all-of-Congress feeds, QoQ 13F deltas) are precisely what per-entity APIs can't answer.

**Consequences.** Pattern-F tools require network at question time (declared in tool descriptions; caches serve offline with staleness notes). Aggregate load across all installations still grows with adoption — so the federated client is deliberately conservative (§11.4): defaults far below agency ceilings, caching, coalescing, bulk-endpoints-first, and honest per-install identification. No "at any scale" claims; if an agency ever signals displeasure, the affected dataset moves to Pattern R extracts or is dropped (G6).

### DR-9 — One MCP server, domain-namespaced tools, hard tool budget

**Decision.** A single `populus-mcp` exposes all modules, tools prefixed by domain (`congress_*`, `inst_*`, `fin_*`, `macro_*`), hard budget ~25 tools. Module data loads lazily. Escape hatch if the budget is genuinely exceeded: split by domain under one brand — decided then, not pre-built.

**Justification.** One install line; one registry listing that compounds per module launch; one snapshot/caching layer. The budget forces composable analyst-question tools over endpoint mirroring.

### DR-10 — Access patterns are declared per consumer, not per module *(new in v2.1)*

**Context.** External review F2: SEC's APIs do not serve CORS headers, so a static dashboard cannot call `data.sec.gov` from the browser; "Pattern F end-to-end" for M3 contradicted the no-backend static dashboard.

**Decision.** The module contract declares the pattern **per (dataset × consumer)** in a consumer-access matrix (§5.6). The MCP server (a local process — no CORS constraint) may consume a dataset live-federated while the dashboard consumes **bounded build-time extracts** of the same dataset (built preferentially from the agencies' bulk archives, e.g. SEC's nightly `companyfacts.zip`, verified 1.39 GB — one download instead of thousands of API calls).

**Consequences.** "Pattern F module" is shorthand only; the matrix is normative. Dashboard extracts are bounded by page/size budgets (§7, §12.1) and are ordinary artifacts under the §5.5 protocol.

---

## 4. System overview

```
 PRIMARY SOURCES (verification state per Appendices A–B)
 ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────────┐ ┌─────────────────────┐
 │ M1 Congressional│ │ M2 Institutional │ │ M3 Company financials│ │ M4 Macro            │
 │ House Clerk zips│ │ SEC EDGAR 13F    │ │ SEC data.sec.gov APIs│ │ Treasury, BLS, CFTC │
 │ Senate eFD      │ │ XML + qtr        │ │ + nightly bulk zips  │ │ (verified); BEA,    │
 │ (no API→scrape) │ │ datasets(keyless)│ │ (keyless)            │ │ FRED (keyed, TBV)   │
 └───────┬─────────┘ └───────┬──────────┘ └──────────┬───────────┘ └──────────┬──────────┘
         │                   │                       │                        │
         ▼                   ▼                       ▼ (bulk, build-time)     ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │ PIPELINE  (Python pkg `populus`; GitHub Actions, serialized publish group;            │
 │ Mac-mini launchd fallback) — discover → fetch(+archive raw) → parse-or-flag →         │
 │ normalize(versioned) → load(atomic per-filing) → stats → BUILD                        │
 └───────────────────────────────┬───────────────────────────────────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │ populus-data — PUBLICATION (protocol §5.5)                                            │
 │  git: manifest.json · latest.json · licenses.json · registries · small JSON · stats   │
 │  Releases (immutable): congress.db · inst_agg.db · macro.db · dashboard extracts ·    │
 │  raw-archive bundles                                                                  │
 └──────┬────────────────────────────────────────────────┬───────────────────────────────┘
        │ manifest → verify sha256 → atomic cache        │ build-time fetch → deploy hook
        ▼                                                ▼
 ┌──────────────────────────────┐          ┌──────────────────────────────────────────┐
 │ MCP SERVER populus-mcp       │          │ DASHBOARD (Astro static, CF Pages,       │
 │ uvx · stdio · ≤25 tools      │          │ page budgets §12.1)                      │
 │ snapshots + conservative     │          │ /congress /institutional /financials     │
 │ federated client (§11.4)     │          │ /macro /methodology                      │
 └──────────────────────────────┘          └──────────────────────────────────────────┘
      EXTERNAL MONITOR: Mac-mini launchd heartbeat → Discord (independent of GitHub, §13.2)
```

---

## 5. Shared substrate

### 5.1 Provenance model

Every fact row carries:

- `source` — which parser or API client produced it (enumerated per module);
- `source_url` — the government document URL, or for API-derived rows the **endpoint + exact request parameters**;
- `source_record_id` — the source's own identity where one exists (DocID, eFD UUID, accession number, series ID + observation date);
- `retrieved_at`, and `response_hash` (SHA-256 of the raw response/document) so a later change at a mutable source is detectable;
- `vintage`/`effective_date` where the source has revision semantics (macro observations, restated financials);
- `raw_path` where a raw copy is archived;
- `parser_version` and `normalization_version` — every transformation is versioned code;
- `license_id` — resolved through the conditions register (§15), at record level where sources mix within a table, else at table/artifact level in the manifest.

Derived aggregates additionally carry lineage: the input `build_id`(s) and the identity of the query/computation (name + version) that produced them. Published artifacts carry `snapshot_version`, build metadata, and per-artifact `license_id`s in the manifest.

### 5.2 Honesty layer

Per module, always published (in `stats.json`, the `*_health` tools, and `/methodology`): freshness (source-side latest vs. ours), coverage (parsed/total, joined/total), known-gap counts (`needs_ocr`, unjoined names, unmapped identifiers), and a standing `data_note` stating the domain's structural caveat — M1: the 45-day STOCK Act lag and range-only amounts; M2: 13F is long-US-equity, quarter-end, up-to-45-days-late, no shorts/bonds/cash, era-dependent value units; M3: as-reported XBRL ≠ normalized comparables; M4: series are revised, vintage semantics stated per series. These are response-envelope content, not footnotes.

### 5.3 Pipeline framework and CLI contract

A module implements: `discover()` (what's new at the source) → `fetch()` (retrieve + archive raw) → `parse()` (parse-or-flag against a golden corpus) → `normalize()` (versioned) → `load()` (idempotent, atomic per source document, §9.4) → `stats()`. The framework owns scheduling, retries/backoff, per-source politeness floors, circuit breakers, run audit (`ingest_runs`), publication (§5.5), and alerting.

CLI (each command host-agnostic — identical behavior in Actions, on the mini, or locally):

```
populus ingest <job>      # congress-house | congress-senate | congress-backfill | inst-13f | macro-core …
populus reparse <job> [--filing ID | --since DATE | --parser-version V]   # from raw archive, atomic per filing
populus build             # assemble artifacts + manifest for all modules with changes
populus publish [--dry-run]   # §5.5 publication order; refuses partial builds
populus verify            # recompute artifact hashes vs manifest; DB integrity checks
populus stats             # print/refresh stats.json
```

`ingest` and `reparse` write the canonical store; `build`/`publish` are the only paths to `populus-data`; nothing else writes anywhere shared.

### 5.4 Temporal identity registries

Identity is modeled to be historically safe (review F8). Two separate identity families plus dated mappings:

- **`entities`** — issuers/companies, anchored on **CIK** (the only stable public company key). Attributes (names) are dated.
- **`securities`** — instruments, surrogate-keyed; attributes include CUSIP(s) and class. A company has many securities; CUSIPs change on corporate actions.
- **Mappings** — `entity_tickers(entity_id, ticker, valid_from, valid_to, provenance, confidence, review_state)` and `security_identifiers(security_id, id_type ∈ {cusip,…}, value, valid_from, valid_to, …)`. One-to-many is normal; intervals may be open-ended.
- **`members`** — Congress members, **bioguide ID** canonical (from congress-legislators, CC0), with dated terms.
- **`series`** — macro series catalog: agency, series ID, units, frequency, seasonal adjustment, revision policy, `license_id`.

Join rules: historical records join **as-of their own date** (transaction date, report period); mapping rows used outside their validity interval are a defect. **Silent chaining CUSIP → current ticker → CIK for historical data is prohibited (G14).** Unresolved identifiers surface as name-only rows with a flag — never dropped, never guessed. Bootstrap sources: SEC `company_tickers.json` (current tickers; verified) seeded as current-interval rows; CUSIP mappings from free primary candidates (SEC fails-to-deliver pairs — OQ-8) with per-row provenance and review state. Registry edits beyond automated ingest are version-controlled commits.

### 5.5 Artifact publication protocol *(normative; review F4)*

**Build identity.** Every publish is a **build**: `build_id = YYYYMMDD.N` (UTC date + same-day sequence). Builds are immutable; a correction is a new build.

**Manifest.** One `manifest.json` per build, committed to `populus-data` (git) at `builds/<build_id>/manifest.json`:

```json
{
  "build_id": "20260716.1",
  "created_at": "2026-07-16T15:04:22Z",
  "previous_build_id": "20260715.1",
  "publisher": {"pipeline_version": "1.4.0"},
  "modules": {
    "congress": {
      "schema_version": "1.2",
      "client_compat": ">=1.0,<2",
      "deprecation": null,
      "watermarks": {"house_index_last_modified": "…", "senate_max_filed_date": "…"},
      "artifacts": [
        {"name": "congress.db", "sha256": "…", "bytes": 18234511,
         "logical_digest": "…",
         "url": "https://github.com/…/releases/download/data-20260716.1/congress.db",
         "license_ids": ["us-congress-disclosures"]},
        {"name": "feed.json", "sha256": "…", "bytes": 412300,
         "path": "builds/20260716.1/congress/feed.json",
         "license_ids": ["us-congress-disclosures"]}
      ]
    }
  }
}
```

Field semantics: `client_compat` is a **PEP 440 version-specifier string** evaluated against the client's own version (no `1.6.x`-style informal grammar); `logical_digest` is the canonical logical-content digest defined below; **every consumed file — SQLite, JSON slices, `stats.json` — is an enumerated artifact under a build-scoped path or Release URL.** `latest.json` (git) holds only `{ "build_id": …, "manifest_path": … }` and is **the sole mutable path any consumer ever reads**; unversioned convenience copies may exist for humans but are non-normative and never consumed programmatically. Old and new builds therefore cannot mix: everything else a consumer touches is under `builds/<build_id>/…` or an immutable release tag.

**Trust model.** GitHub **immutable releases are enabled on `populus-data`** (explicit repository setting — release assets are *not* immutable by default; verified in the §14 checklist and re-checked by the external monitor). At publish, the workflow generates **GitHub artifact attestations (Sigstore)** for `manifest.json` and every Release asset, binding them to the repository's publish-workflow identity via GitHub OIDC. **Consumers verify the manifest's attestation** (via `sigstore-python`/`gh attestation verify`-equivalent bundled in the client) **before trusting it**, then verify each downloaded artifact against the manifest's SHA-256 + byte size. The root of trust is the Sigstore attestation chain — not branch protection, which is an access control, not a signature.

**Logical digest (for reproducibility checks).** Per SQLite artifact, `logical_digest` = SHA-256 over a canonical logical export: each table's rows serialized in canonical form (RFC 8785-style JSON per row), sorted by primary key, **excluding operational columns** (`ingested_at`, run ids, host metadata). File bytes are *not* reproducible (SQLite page layout, insertion order, and library version all perturb them); logical content is. The disaster-recovery drill (§13.5) compares logical digests and row counts, never file hashes.

**Publication order (atomic from a consumer's view):** (1) upload all Release assets under tag `data-<build_id>` + generate attestations; (2) commit `builds/<build_id>/` (manifest + build-scoped JSON); (3) update `latest.json` **last**. A consumer that resolves `latest.json` always finds a complete, attested, verifiable build; `populus publish` refuses to advance the pointer while any enumerated artifact is missing or fails verification (`populus verify` gate).

**Consumer protocol (MCP server and site build):** resolve `latest.json` → fetch manifest → **verify manifest attestation** → evaluate `client_compat` against own version — **on incompatibility, refuse with a self-explanatory message and continue serving the last compatible cached build** → download artifacts to temp files → verify SHA-256 + byte size → for SQLite, `PRAGMA integrity_check` → atomic rename into `~/.cache/populus/<module>/<build_id>/` → update a local per-build `current` pointer. Any failure at any step leaves the prior cache untouched; artifacts from different builds are never mixed.

**Compatibility policy.** `schema_version` is `MAJOR.MINOR`: clients accept same-MAJOR. MAJOR bumps ship in this order — a client release supporting both MAJORs first; the data flips only after a **deprecation window declared in the manifest** (`deprecation: {new_major, flips_at}`). CI enforces fail-safe behavior: the **previously released** client runs against each new manifest and must work or refuse cleanly (automated gate from P2 on, §17).

**Retention & rollback.** Builds are retained for **the entire supported-client window including any declared deprecation period, with an absolute floor of 90 days** — retention is derived from the compatibility promise, not a fixed number. Rollback = repoint `latest.json` at a prior build (runbook §13.5); clients follow the pointer, not "newest".

### 5.6 Consumer-access matrix *(normative; DR-10)*

| Dataset | Pipeline | MCP server | Dashboard |
|---|---|---|---|
| M1 congressional | R (scrape → `congress.db`) | snapshot | build-time JSON, deployed in the Pages bundle |
| M2 13F aggregates (deltas, top-holders) | R (→ `inst_agg.db`) | snapshot | build-time slices in the Pages bundle (top-filer budget) |
| M2 13F per-filer detail | — | **F** (EDGAR live) | **not served** — link out to EDGAR; only published aggregates render |
| M3 company financials | — | **F** (`data.sec.gov` live) | build-time extract from bulk `companyfacts.zip`, curated universe, **sharded** (§10.3) |
| M4 curated macro core | R (→ `macro.db`) | snapshot | build-time series JSON in the Pages bundle |
| M4 long-tail series | — | **F** (agency APIs live) | **not served** |

Two rules make this coherent: (1) the dashboard never calls external APIs from the browser (SEC serves no CORS; G7 forbids hidden load paths); (2) **dashboard data ships inside the Pages deployment itself** — build-scoped by construction, same-origin (no cross-origin/CORS/caching design needed), every file within Pages' 25 MiB limit and counted against the file budget (§12.1). **Dashboard coverage is therefore exactly the published extract — bounded, not "unbounded":** entities outside a module's published slices do not render; they link out to the primary source.

---

## 6. Storage and size tiers

| Store | Engine | Location | Size (verified/estimated) |
|---|---|---|---|
| `congress.db` | SQLite | Release assets per build | ~10–20 MB; +kB/day |
| `inst_agg.db` | SQLite | Release assets | aggregates ~tens of MB/qtr; full quarterly holdings **not** replicated (source datasets ≈95 MB/qtr compressed per SEC page — archived as Release assets only if OQ-9 decides yes) |
| M3 dashboard extract | sharded JSON (~64 shards by CIK prefix) | deployed inside the Pages bundle | curated universe × key metrics — ≤50 MB total, every shard ≪25 MiB (from the 1.39 GB bulk zip, at build time, in Actions) |
| `macro.db` | SQLite | Release assets | few MB |
| Raw archives | bundled zips | Release assets (monthly bundles) | M1 ≈60 MB/yr; others per contract |
| Registries, manifests, small slices, stats | JSON | git | MBs |

No server database anywhere. Growth thresholds and migration triggers: §13.4.

---

## 7. The module contract

A module is not started until this one-pager is approved (phase-entry gate):

1. **Sources** — verified live, a real record pulled end-to-end, logged in an appendix.
2. **Conditions register entries** — the §2.2 test per source, recorded in §15's register *before* ingestion (G11).
3. **Consumer-access matrix rows** (DR-10) with a size table.
4. **Schema** — canonical tables, natural keys/fingerprints, lifecycle model, flags; raw/normalized twins.
5. **Structural caveat** — the module's `data_note`.
6. **Tools** — ≤6 MCP tools phrased as analyst questions, within the DR-9 budget.
7. **Dashboard surfaces + page budget** — pages added, static-file count against the global cap (§12.1), long-tail strategy.
8. **Gates** — measurable exit criteria only: numbers, named fixtures, or pass/fail drills (§17 policy).

M1's contract is §9 (fully expanded). M2–M4 outlines (§10) are finalized, with fresh verification, at phase entry.

---

## 8. — *(section number reserved to keep §9/§10 stable across review rounds)*

## 9. Module M1 — Congressional trading (fully specified)

### 9.1 Sources (verified end-to-end, Appendix A)

**House (Clerk).** Bulk index `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip` → `<YEAR>FD.xml`; fields `Prefix, Last, First, Suffix, FilingType, StateDst, Year, FilingDate, DocID`. 2026 YTD: 1,376 filings, 298 `FilingType=P` (PTR). Yearly archives **sampled back to 2013** (2013/2015/2020/2024 probed — Appendix A; the full 2013–2025 sweep is a P1 item); the 2026 file's Last-Modified moves daily. Documents at `public_disc/ptr-pdfs/<YEAR>/<DocID>.pdf`; e-filed PTRs are text-native (verified: DocID 20034916 extracted field-perfect — asset+ticker, type, transaction date 06/30, notification date 07/02, filed 07/10, amount bucket, owner, broker, cap-gains flag). Paper filings are scans. The index carries filed date only; transaction data lives in the documents. Observed FilingType codes `{P,C,X,W,D,A,H,T}`; only `P` is confirmed — full map is OQ-2.

**Senate (eFD).** No API. Verified session flow: GET `/search/home/` → Django `csrfmiddlewaretoken` → POST `prohibition_agreement=1` → 302 + session cookie → POST `/search/report/data/` (DataTables JSON; `report_types=[11]` = PTR; filterable by submitted date; paginated; returns filer, title, **filed date**, detail URL). E-filed detail pages (`/search/view/ptr/<uuid>/`) are clean 9-column HTML tables: `#, Transaction Date, Owner, Ticker, Asset Name, Asset Type, Type, Amount, Comment`; ticker `--` on non-equity rows (verified on a real bond filing); `Type` distinguishes `Sale (Full)`/`Sale (Partial)`. Paper filings (`/search/view/paper/…`) are scans. No bot-blocking observed at polite cadence from a residential IP; GitHub-Actions IPs untested → fallback §13.1.

**Backfill seed.** kadoa-org/congress-trading-monitor (MIT, actively maintained): `public/data/trades.json`, 4.3 MB, ~54k rows 2012–present, schema includes stable id, both dates, `days_to_file`, `is_late`, amount bounds, owner, filer/party/chamber, `doc_url`. Trust boundary and audit: §9.6. **OGE (executive-branch) rows are not imported** — the raw seed file is archived; congressional rows only enter the store.

**Members.** unitedstates/congress-legislators (CC0): bioguide ID, name variants, party, state, district, dated terms.

### 9.2 Ingest jobs

**House (nightly).** Conditional-GET the current year's ZIP (ETag/Last-Modified; plus previous year through January). Diff DocIDs vs `filings`. For each new PTR: fetch PDF → archive raw → classify e-file/paper by text-extraction yield (heuristic; OQ-3) → parse-or-flag → normalize → atomic load. Historical re-scrape 2013–2025 is the same code pointed at old years, run paced from the mini during P1 (OQ-6 covers old-schema drift).

**Senate (nightly).** Handshake as verified; query `submitted_start_date = watermark − 90 days` (the re-scan window catches late amendments and paper-to-e-file conversions); diff UUIDs; fetch/archive/parse detail pages; paper → `needs_ocr`.

**Politeness contract (floors in code, not config — G6).** ≥2 s + jitter between eFD requests, strictly sequential; identifying UA `PopulusBot/<ver> (+https://<domain>; <contact>)`; exponential backoff on 429/5xx; circuit breaker on persistent 403 — stop, alert, relocate per §13.1; never rotate IPs or disguise UAs. Typical nightly volume <30 requests.

### 9.3 Parsing

| Class | Method | On failure |
|---|---|---|
| House e-filed PDF | `pdfplumber` layout-aware extraction; `pypdf` text fallback; field regexes | `parse_status='partial'|'failed'`; filing retained; alert |
| Senate e-filed HTML | `lxml` over the verified table | same |
| Paper/scanned | v1: `parse_status='needs_ocr'`, metadata + doc link recorded; visible-but-unparsed on all surfaces | OCR (tesseract) is backlog, gated on measured volume (OQ-4) |

Golden corpus in `populus/tests/fixtures/`: ≥20 House PDFs across years/layouts and ≥10 Senate pages, including bonds, exchanges, multi-page filings, and — once obtained — amended filings (OQ-13). Expected-output JSON per fixture; CI-blocking. `parser_version` stamped per filing; improved parsers trigger `populus reparse` **from the raw archive** — no re-fetching.

### 9.4 Schema and load semantics *(revised per review F5)*

```sql
CREATE TABLE members (
  bioguide_id   TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  chamber       TEXT NOT NULL CHECK (chamber IN ('house','senate')),
  party TEXT, state TEXT, district TEXT,
  terms         JSON NOT NULL,              -- dated; joins are as-of
  raw           JSON NOT NULL
);

CREATE TABLE member_aliases (               -- every fuzzy-match decision is a reviewed commit
  alias_id    INTEGER PRIMARY KEY,
  alias       TEXT NOT NULL,                -- normalized filer-name string
  chamber     TEXT NOT NULL,
  state       TEXT,                         -- disambiguators; NULL = matches any
  district    TEXT,
  valid_from  DATE NOT NULL,                -- temporal: the same alias may map to
  valid_to    DATE,                         -- different members across eras
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  note        TEXT NOT NULL                 -- why this mapping exists
);
CREATE UNIQUE INDEX alias_no_overlap
  ON member_aliases (alias, chamber, state, district, valid_from);
-- resolution (§9.7): an alias row applies only if the filing's filed_date falls in
-- [valid_from, valid_to) AND the member has a term overlapping that date; overlapping
-- candidate rows for one (alias, date) are a defect caught by a CI invariant test.

CREATE TABLE filings (
  filing_id     TEXT PRIMARY KEY,           -- 'house:<DocID>' | 'senate:<uuid>' | 'kadoa:<id>'
  chamber       TEXT NOT NULL CHECK (chamber IN ('house','senate')),
  bioguide_id   TEXT REFERENCES members(bioguide_id),      -- NULL = unresolved (visible, flagged)
  filer_name_raw TEXT NOT NULL,
  filing_kind   TEXT NOT NULL,              -- 'ptr' | 'ptr_amendment' | … (map: OQ-2)
  filed_date    DATE NOT NULL,
  doc_url       TEXT NOT NULL,
  raw_path      TEXT,
  response_hash TEXT,                       -- sha256 of archived document
  parse_status  TEXT NOT NULL CHECK (parse_status IN
                  ('parsed','partial','needs_ocr','failed')),   -- OUTCOME only
  lifecycle     TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN
                  ('active','superseded','retired','withdrawn')), -- LIFECYCLE, separate
  supersedes    TEXT REFERENCES filings(filing_id),  -- amendment lineage
  primary_filing_id TEXT REFERENCES filings(filing_id), -- kadoa→primary crosswalk (§9.6)
  parser_version TEXT, normalization_version TEXT,
  row_count     INTEGER,
  source        TEXT NOT NULL CHECK (source IN ('house-clerk','senate-efd','kadoa')),
  license_id    TEXT NOT NULL DEFAULT 'us-congress-disclosures',
  ingested_at   TEXT NOT NULL
);

CREATE TABLE transactions (
  txn_id        TEXT PRIMARY KEY,           -- '<filing_id>:<fingerprint32>[#<dup_seq>]' (§ below)
  filing_id     TEXT NOT NULL REFERENCES filings(filing_id),
  raw_row       TEXT NOT NULL,              -- JSON: the exact extracted raw field object —
                                            -- the fingerprint's input, stored so identity is
                                            -- reproducible and auditable from the row itself
  row_fingerprint TEXT NOT NULL,            -- full sha256 hex of canonical raw_row (§ below)
  dup_seq       INTEGER NOT NULL DEFAULT 1, -- 1..n among identical raw_rows in one filing
  row_ordinal   INTEGER NOT NULL,           -- display order as printed (presentation only)
  source_row_no INTEGER,                    -- the source's own row number where printed
                                            -- (Senate '#' column; House table position)
  bioguide_id   TEXT REFERENCES members(bioguide_id),  -- denormalized from filing; CI
                                            -- invariant: equals its filing's bioguide_id
  chamber       TEXT NOT NULL,
  owner         TEXT,                       -- canonical: self|spouse|child|joint|NULL
  ticker        TEXT,                       -- normalized; NULL for bonds/funds/'--'
  asset_name    TEXT NOT NULL,              -- normalized (raw lives in raw_row)
  asset_type    TEXT,
  side          TEXT NOT NULL CHECK (side IN
                  ('purchase','sale','sale_partial','exchange','other')),
  transaction_date DATE,                    -- NULL only with flag date_missing
  filed_date    DATE NOT NULL,
  days_to_file  INTEGER,
  is_late       INTEGER CHECK (is_late IN (0,1)),
  amount_low INTEGER, amount_high INTEGER,  -- statutory buckets, Appendix C
  amount_label  TEXT,                       -- as printed
  cap_gains_over_200 INTEGER CHECK (cap_gains_over_200 IN (0,1)),
  comment       TEXT,
  flags         TEXT NOT NULL DEFAULT '[]', -- JSON array: ["missing_ticker","date_anomaly",…]
  source        TEXT NOT NULL,
  license_id    TEXT NOT NULL,              -- record-level (sources mix in this table, §5.1)
  kadoa_id      TEXT,                       -- original seed id where source='kadoa'
  UNIQUE (filing_id, row_fingerprint, dup_seq)   -- matches the identity, exactly
);

CREATE TABLE ingest_runs (
  run_id TEXT PRIMARY KEY, job TEXT, started_at TEXT, finished_at TEXT,
  new_filings INTEGER, rows_loaded INTEGER, parse_failures INTEGER,
  status TEXT, host TEXT, log_ref TEXT
);
```

**Row identity — reproducible from the schema.** `raw_row` stores the exact extracted raw field object: `{owner, asset_name, ticker, side, transaction_date, amount_label, comment}` — values exactly as the source printed them (missing field = JSON `null`, distinct from empty string; text NFC-normalized at extraction, otherwise untouched). `row_fingerprint = SHA-256 over the RFC 8785 (JCS) canonical serialization of raw_row` — length-delimited by construction, so delimiter injection, embedded `|`, whitespace, and Unicode ambiguity cannot collide; computed from raw values so it is invariant to normalization changes. `txn_id = <filing_id>:<first 32 hex chars of row_fingerprint>` (128 bits — collision-safe at any realistic scale), with `#<dup_seq>` appended only when `dup_seq > 1`. Anyone holding a row can recompute its identity from its own `raw_row` column.

**Duplicate rows and the exact stability guarantee.** Identical `raw_row`s within one filing occur legitimately; `dup_seq` numbers them **in source-coordinate order** (`source_row_no` where the source prints one — the Senate table's `#` column — else printed table position). Stability guarantee, stated precisely: a reparse never changes the identity of any row whose `raw_row` is **unique within its filing** (the overwhelmingly common case). For identical duplicates, identity is stable exactly when the source coordinates are; a reparse that newly discovers an identical duplicate *earlier* in the document shifts later duplicates' `dup_seq`. This residual instability is confined to same-filing identical rows, is resolved atomically with the filing's replace (below), and is accepted — inventing stronger identity than the source provides would be false precision.

**Atomic load.** `load()` for a filing is one transaction: `DELETE FROM transactions WHERE filing_id = ?` → insert the full parsed set → update the `filings` row (parse_status, parser_version, row_count). Re-ingest and reparse are idempotent; corrected parses cannot leave ghost rows. `license_id` is stamped per row from the filing's register entry (`us-congress-disclosures` or `mit-kadoa-seed`), satisfying §5.1's record-level requirement for this mixed-source table.

**Lifecycle vs. parse outcome.** `parse_status` records only what parsing achieved; `lifecycle` records the filing's standing. A cleanly parsed original later amended is `parsed` + `superseded`. **Default views select `lifecycle='active'` AND apply the unresolved-amendment-pair rule (§9.5)** — no double counting from either mechanism; history remains queryable.

### 9.5 Amendments *(verify-first; review F5)*

Amendment semantics differ by chamber and are **not yet verified against real amended filings**. Policy: (1) OQ-13 — during P1, collect ≥3 real amended PTRs per chamber and establish empirically whether an amendment restates the full report or appends/corrects rows; encode the finding as golden fixtures. (2) Until then, when an amendment is detected (same filer + explicit reference or matching document lineage), the two filings are linked as a pair (`supersedes` on the amendment) and the **unresolved-pair rule** applies: **default feeds and ALL quantitative aggregates include only the later filing (the amendment), flagged `amendment_unresolved`; the paired original is excluded from default views entirely** — a flag alone does not stop a SUM from counting both, so the pair never contributes twice to any number. A dedicated uncertainty view (`congress_latest_filings` and a dashboard filter) exposes both sides of pending pairs for inspection. (3) Only after OQ-13 lands does supersede automation flip lifecycle to `superseded` — and only in the empirically verified mode. Wrong-but-flagged beats silently wrong; excluded-and-flagged beats double-counted.

### 9.6 Backfill import and kadoa lineage *(revised per reviews F5, F13)*

- Import congressional rows from the kadoa seed as filings with `filing_id='kadoa:<id>'`, `source='kadoa'`, `kadoa_id` preserved per row, `license_id='mit-kadoa-seed'`. OGE rows: not imported.
- **Audit gate (blocking, statistically stated).** Two separate instruments, because one sample cannot honestly do both jobs:
  1. **Population bound — simple random sample, n = 150 drawn uniformly from all importable congressional rows, zero critical-field errors accepted.** The estimator is the exact binomial: 0/150 gives a one-sided 95% upper bound of ≈1.97% on the population critical-error rate, meeting the <2% target. (A stratified allocation does not support this bound without weights; this sample is deliberately unstratified.)
  2. **Coverage quotas — smoke checks, not bounds:** additionally ≥5 rows verified from each key stratum (chamber × year-band 2012–15/16–19/20–23/24–26 × equity/non-equity), drawn independently of sample 1, to make sure no stratum goes entirely uninspected.
  Any critical error in either instrument → investigate, fix or renegotiate the import, then redraw a fresh n=150 (no reuse of the failed sample). A stratum-localized failure additionally requires a targeted follow-up sample in that stratum (n=60, zero errors) before import. Critical fields: member identity, ticker, side, amount bucket, both dates. Cosmetic errors (name formatting, comments) tracked separately across both instruments, ≤5%.
- **Progressive replacement with lineage:** when our primary-source re-scrape parses a document that a kadoa filing represents (matched on `doc_url`/DocID), the kadoa filing gets `lifecycle='retired'` + `primary_filing_id=<ours>`; retired rows are retained (tombstones), never deleted. `stats.json` reports the source mix (`% rows primary` vs `% kadoa`) so replacement progress is public.

### 9.7 Member join

Normalize filer name (case, punctuation, suffixes, nicknames via the source's alternate names) → match against `members` constrained by chamber + state (+ district for House) + term overlap with `filed_date`. Exactly one candidate → join. Zero or many → `bioguide_id=NULL`, counted in join-coverage, resolved only by adding a `member_aliases` row in version control. Unjoined rows appear in every feed under the raw filer name — never dropped. Gate: ≥98% of transactions joined.

### 9.8 Structural caveat (`data_note`)

STOCK Act: disclosure within 45 days — "filed today" ≠ "bought today"; both dates on every record, always (G4). Amounts are statutory ranges (G5). PTRs are **flows, not holdings** — anything portfolio-shaped is a labeled flow-estimate until annual FDs are ingested (backlog; G10). Statutory prohibited-use notice attached (§15).

### 9.9 MCP tools (6 against the budget)

All follow the envelope convention (§11.3). Filters are optional unless marked.

1. `congress_recent_trades(window_days=30, chamber?, party?, state?, side?, ticker?, bioguide_id?, min_amount?, limit=50, cursor?)` — the workhorse feed.
2. `congress_member_lookup(query)` — name search → canonical members (bioguide, chamber, party, state, active terms).
3. `congress_member_activity(bioguide_id, since?, until?)` — trades + habit summary (top tickers, buy/sell mix by bucket-bounds, median `days_to_file`, late count, flow-estimate note).
4. `congress_ticker_activity(ticker, window_days=90, mode='detail'|'top'|'biggest')` — who trades X; `top` = most-traded tickers ranked; `biggest` = largest by bucket upper bound (mode collapses three question shapes into one tool for budget discipline).
5. `congress_latest_filings(since_iso)` — filing-level awareness for polling clients; includes `needs_ocr` and amendment-flagged filings.
6. `congress_health()` — snapshot build_id + freshness, parse/join coverage, source mix, open caveats.

### 9.10 Dashboard surfaces and page budget

`/congress` feed (client-side filters) · `/congress/members/<bioguide>` (all current + historical members with data: ~700 pages) · `/congress/tickers/<ticker>` (active tickers: ~2,500 pages) · methodology section. **Page budget: ≤4,000 static files** against the global cap (§12.1). Follow/watch = localStorage only.

---

## 10. Modules M2+ — scoped outlines (contracts finalized at phase entry)

### 10.1 Sequencing

Owner-specified: institutional → company financials → macro. Also the dependency order: M2 forces the temporal identity registries M3 reuses; M3 is the cheapest build once registries exist; M4 is independent.

### 10.2 M2 — Institutional holdings (13F)

- **Sources (verified).** Per-filer: `data.sec.gov/submissions/CIK<n>.json` → accession → `/Archives/edgar/data/<cik>/<accn>/index.json` → `primary_doc.xml` + information-table XML (verified live: Berkshire 13F-HR filed 2026-05-15; fields `nameOfIssuer, titleOfClass, cusip, value, sshPrnamt, sshPrnamtType, putCall?, investmentDiscretion, otherManager, votingAuthority`). Cross-sectional: SEC's quarterly **structured 13F datasets** — page verified HTTP 200 on re-check (earlier 503 was transient; OQ-10 closed), latest quarterly archive ≈95 MB per the SEC page.
- **Value units are era-dependent, keyed on the filing, not the report period.** Filings on the pre-2023 form report `value` in **thousands of dollars**; filings on the amended Form 13F (effective **2023-01-03**, EDGAR release 22.4.1) report **whole dollars** (verified arithmetically: Berkshire's ALLY row, 498,992,850 ÷ 12,719,675 sh = $39.23/sh). The discriminator is the **form version / filing date, not the report period** — a Q4 2022 report filed after the transition uses whole dollars. The schema carries `unit_basis` derived from the filed document; mixing regimes unnormalized is a defect.
- **Amendments are typed.** `13F-HR/A` carries an amendment type: **RESTATEMENT** (supersedes the original in full) vs. **NEW HOLDINGS** (must be **merged** with the original). The M1 supersede model applies only to restatements; new-holdings amendments compose. **Confidential treatment, correctly modeled:** a **13F-CTR is the *request* for confidential treatment** — positions under it are simply *omitted* from the public filing; when treatment expires or is denied, the holdings surface via a **public 13F-HR/A NEW HOLDINGS amendment** (per the SEC's Form 13F FAQ). The pipeline flags filings whose cover indicates confidential omissions and merges the later disclosing amendment through the same NEW-HOLDINGS path. `otherManager`/related-filer structures are modeled to avoid double counting the same positions across affiliated filers. All four behaviors get golden fixtures before the module ships.
- **Consumer matrix.** Pipeline: R for cross-filer aggregates (filer registry, QoQ deltas, top-holders per issuer, concentration) into `inst_agg.db`. MCP: snapshot for aggregates + F for arbitrary per-filer detail. Dashboard: build-time slices, static pages budgeted to the top filers only (≤1,500 pages), long tail client-rendered from published JSON.
- **Identity.** CUSIP-only in filings → resolved through §5.4's dated `security_identifiers` (bootstrap: OQ-8), as-of the report period; unmapped CUSIPs surface by issuer name + flag. Coverage gate ≥95% by reported value.
- **Caveat.** Long US-equity positions of ≥$100M managers; quarter-end snapshots filed up to 45 days late; no shorts, bonds, cash; era-dependent units; affiliated-filer overlap.
- **Candidate tools (≤5):** `inst_filer_lookup`, `inst_filer_holdings` (+QoQ deltas), `inst_ticker_holders`, `inst_biggest_moves`, `inst_health`.

### 10.3 M3 — Company financials

- **Sources (verified).** `data.sec.gov/api/xbrl/companyfacts/CIK<n>.json` (verified: Apple, 3.7 MB), `/api/xbrl/frames/...` (verified), `/submissions/` (verified), `company_tickers.json` (verified) — all keyless. **Bulk:** nightly `companyfacts.zip` (verified: `Content-Length 1,389,620,072`) and `submissions.zip` (verified 200/206).
- **Consumer matrix (resolves review F2; delivery per round-2 F7).** MCP: **F** — live `data.sec.gov` with the conservative client (§11.4). Dashboard: **build-time extract** — the nightly Actions build downloads `companyfacts.zip` once, extracts a curated universe (initial: companies with congressional or 13F activity plus a liquid-large-cap core; target ≤2,000 companies × key reported metrics), and emits it as **sharded JSON by CIK prefix (~64 shards, each well under Pages' 25 MiB file limit), deployed inside the Pages bundle** — same-origin, build-scoped, counted in the file budget. Companies outside the curated universe do not render on the dashboard (bounded coverage; MCP covers the long tail live). No browser calls to SEC (no CORS; G7). Pipeline stores nothing beyond registries.
- **Caveat.** As-reported XBRL: tag choices vary by company/year; restatements exist; Populus surfaces reported values with tags and periods, flags gaps, never silently constructs "clean" comparables (G10).
- **Candidate tools (≤5):** `fin_company_lookup`, `fin_company_facts` (metric history), `fin_metric_across_companies` (frames), `fin_filings` (recent 10-K/Q/8-K with links), `fin_health`.

### 10.4 M4 — Macro

- **Sources.** Verified 2026-07-16: Treasury FiscalData (keyless JSON), Treasury daily yield-curve XML, BLS API v2 keyless GET, CFTC COT (`dea/newcot/deafut.txt` + yearly history zips). **Not yet verified beyond signup/docs pages: BEA (free key) and FRED (free key)** — full verification is a phase-entry item; the module can ship on the verified four alone.
- **Licensing specifics.** Treasury/BLS/BEA/CFTC: US-government works. **BLS terms nonetheless require retrieval-date citation and their verbatim disclaimer** — encoded in the `bls-tos` register entry and emitted with BLS-derived responses. FRED: agency-operated aggregator with **per-series** third-party licenses — used only for series whose underlying source passes §2.2, per-series `license_id` mandatory, user-supplied key only, primary agency preferred wherever one exists (OQ-11).
- **Consumer matrix.** R for a curated core (~30–60 series: yield curve, CPI, unemployment, payrolls, GDP, COT — final list is OQ-12, owner input requested) → `macro.db` + dashboard series JSON. F for the long tail by series ID (MCP only).
- **Caveat.** Macro series are revised; latest-vintage semantics stated per series; units/frequency/seasonal-adjustment always attached; `vintage` recorded per observation (§5.1).
- **Candidate tools (≤5):** `macro_series`, `macro_snapshot`, `macro_yield_curve`, `macro_release_calendar` (only if a primary calendar source verifies), `macro_health`.

### 10.5 Backlog (each requires a §7 contract)

Insider Form 4 (EDGAR structured XML); annual FD reports (true congressional holdings — retires M1's flows caveat); SEC fails-to-deliver (also feeds `security_identifiers`); N-PORT; FDIC; Treasury auctions. Admission via §2.2; sequencing via G12.

---

## 11. MCP server (`populus-mcp`)

### 11.1 Shape

Official Python MCP SDK (FastMCP), stdio, PyPI, `uvx populus-mcp`. Data layer per the consumer matrix: snapshot modules use the §5.5 client protocol (lazy per-module download, verified, atomically cached, `--refresh`, `--db PATH` override, offline = last cached build + staleness note); federated modules use the conservative client (§11.4).

### 11.2 Tool surface

≤25 tools: 6 congress + ~5 inst + ~5 fin + ~5 macro + `populus_health` (aggregate freshness/coverage/caveats/build ids).

### 11.3 Envelope conventions

Every response: `{as_of, build_id | live_source, data_note, license_notices[], results[], next_cursor?}`. Every record: provenance URL(s); M1 records: both dates. Validation errors return corrective hints. Tool descriptions are analyst questions. `license_notices` carries the register-required attributions (e.g., BLS retrieval-date + disclaimer) — non-removable.

### 11.4 Federated client (Pattern F) — conservative by design

Defaults far below agency ceilings: **≤2 req/s to SEC** (published limit 10 req/s), single-flight request coalescing, response cache (ETag-aware, TTLs per endpoint class), bulk-endpoints-first where the query shape allows. **UA policy (truthful, no tracking):** `populus-mcp/<ver> (+https://github.com/<org>/populus; contact:$POPULUS_CONTACT)` — application, version, and repository URL (a genuinely monitored contact channel), plus the operator's own contact when `POPULUS_CONTACT` is set; the server warns at startup when it is unset and explains why (SEC fair-access asks automated clients to be identifiable, and the operator — not the project — is the party the agency would need to reach). **No per-install identifier is sent**: a persistent random ID would not make an anonymous operator contactable; it would only create a pseudonymous tracking token (privacy cost, zero fair-access benefit). No claim is made that adoption is load-free; if any agency signals distress (sustained 403/429 patterns), the affected tools degrade to published extracts or are disabled in a patch release (G6).

### 11.5 Key policy

Modules default to keyless operation (SEC, Treasury, keyless-BLS — verified). Sources needing free registration keys (FRED, BEA, enhanced BLS) are optional enhancements: user-supplied key via env var; tools state what works without one; Populus never proxies keyed requests through shared infrastructure and never ships keys.

### 11.6 Hosted HTTP transport

Designed-for (the SDK's Streamable-HTTP entry point exists in code), not operated. Revisit on demand (OQ-7) — and **not before the deployment acceptance checklist is written and passed**, per the MCP Python SDK's deployment guidance: Host/Origin header allowlists (DNS-rebinding defense), TLS/tunnel trust chain, an explicit authentication decision (even if "none, read-only, documented"), session behavior, request/body size limits, per-IP rate limits, and an end-to-end security drill against the deployed endpoint. Candidate host remains Mac mini + Cloudflare Tunnel, but the checklist gates any deployment, not the host choice.

### 11.7 Registry publication requirements (P2 scope)

Official MCP registry requires a versioned `server.json` and, for PyPI packages, an ownership marker in the package README — both are P2 deliverables and P2 gate items. Then PulseMCP, Smithery, Glama, mcpservers.org.

---

## 12. Dashboard

### 12.1 Platform and budgets

Astro static on Cloudflare Pages; nightly rebuild via deploy hook from the publish workflow; no backend; localStorage personalization; no browser calls to external APIs (§5.6). **Cloudflare Pages free-tier limits are design inputs: 20,000 files, 25 MiB/file, 500 builds/month, 20-minute builds.** Global static-file cap: **15,000 files (75%)** — counting pages *and* deployed data shards — tracked per build in `stats.json` with a hard CI failure at the cap. Builds: 1 nightly + manual ≈ ~35/month. Per-module budgets are contract items (M1 ≤4,000 files; M2 ≤1,500 filer pages + aggregate slices; M3 ≤2,000 company pages + ~64 data shards). **Long-tail strategy (bounded):** entities within a module's *published extract* but beyond its pre-rendered page budget are served by a generic client-rendered route that fetches the **same-origin data shards deployed with the build** — no cross-origin fetches, no unversioned paths, coverage exactly equal to what §5.6 says is published. Entities outside the published extract link out to the primary source instead of rendering.

### 12.2 Surfaces

`/congress` (§9.10) → `/institutional` (top-filer pages + ticker-holder views) → `/financials` (curated-universe company pages from the build-time extract) → `/macro` (curated-core dashboard: curve, inflation, labor, positioning). `/methodology` gains a per-module page — sources, conditions-register entries, coverage stats, caveats — the honesty layer as a public artifact and each launch post's anchor. Footer: prohibited-uses notice, attributions, "not financial advice" (§15).

---

## 13. Ops

### 13.1 What runs where

| Job | Default | Fallback | Notes |
|---|---|---|---|
| M1 House / backfill / builds / publish | GitHub Actions | Mac mini launchd | no bot-protection concerns |
| M1 Senate | GitHub Actions | **Mac mini launchd (documented, credentialed — §14)** | eFD vs datacenter IPs untested; circuit breaker makes a block a clean alert |
| M2/M3 bulk builds | Actions | mini | bulk zips are large; Actions bandwidth is fine, time budgeted ≤20 min |
| Historical re-scrapes | Mac mini (paced) | — | politeness-paced, long-running |
| External monitor | **Mac mini launchd only** | — | §13.2 — deliberately outside GitHub |
| MCP execution | user machines | — | zero hosting |

### 13.2 Monitoring — external and internal

- **External heartbeat (independent of GitHub — review F12):** a launchd job on the Mac mini every 6 h fetches `latest.json` + `stats.json` from `populus-data` raw URLs and alerts to Discord if: build age >36 h, `stats.json` freshness lags its own watermarks, or fetch fails twice consecutively. This catches disabled schedules, dropped cron events, and GitHub outages — the failure classes an Actions-hosted watchdog shares with the thing it watches. Operational-by-P1 is a gate.
- **Internal:** Actions failure e-mail + auto-filed issue (deduped by title) + Discord webhook per failed job; freshness assertions inside the pipeline (House index Last-Modified vs. DB watermark) fail the run loudly rather than publishing stale-but-green.

### 13.3 Publication coordination

All publishing workflows share one Actions `concurrency` group (`data-publish`, no cancellation) — module jobs serialize; only one build is ever assembled/published at a time. Git push conflicts: rebase-retry ×3 then fail loudly (no force push ever). The manifest/pointer ordering (§5.5) means a consumer can never observe a torn publish.

### 13.4 Provider-limit thresholds and migration triggers

Tracked in `stats.json` per build; crossing any threshold auto-files a P1-severity issue:

| Metric | Threshold | Trigger action |
|---|---|---|
| `populus-data` git repo size | >1 GB | move more artifact classes to Releases; prune strategy review |
| Fresh-clone time | >2 min | same |
| Any GitHub throttling/AUP signal | any | migrate artifact hosting to Cloudflare R2 free tier (≤10 GB) — the named successor |
| Static files on Pages | >15,000 (hard CI fail) | expand client-rendered long tail |
| Pages build time | >15 min | split/prune extract |
| Actions scheduled-run gaps | any missed nightly | external monitor alerts (§13.2); investigate; the daily data commit already keeps schedules active |

### 13.5 Runbooks (shipped in-repo under `docs/runbooks/`)

- **Rollback:** repoint `latest.json` to a prior `build_id`; verify a consumer picks it up; file the incident issue. (Drilled in P1 — gate.)
- **Disaster recovery:** clean machine → clone `populus` → download raw-archive bundles → `populus reparse --all` → `populus build` → **row counts and per-artifact `logical_digest`s (§5.5) must reconcile with the last manifest** — logical content, never file bytes, which SQLite page layout and library version legitimately perturb. (Drilled in P1, target ≤2 h — gate.)
- **eFD block:** circuit breaker fired → confirm from mini (residential) → relocate Senate job to mini (PAT already provisioned) → file issue → do not raise request rates.
- **Backfill/gap recovery:** widen the re-scan window (`--since`), rerun idempotent ingest; §9.4 atomicity makes overlaps safe.

### 13.6 Cost table

| Item | Provider | $/mo |
|---|---|---|
| Repos, Actions, Releases | GitHub (public tiers, within §13.4 limits) | 0 |
| Dashboard | Cloudflare Pages (within §12.1 budgets) | 0 |
| MCP distribution | PyPI | 0 |
| Federated reads | agency APIs (per-user, within fair-access) | 0 |
| Alerting | GitHub + Discord webhook | 0 |
| Fallback compute + external monitor | Mac mini (owned) | 0 |
| Domain | registrar | ~1 |
| **Total** | | **≈$1/mo** |

Any new cost is flagged before it enters the tree (G8). One metering note: while `populus-data` is private staging (P1), Actions minutes are metered — 2,000 free/mo against an estimated <300 used; the flip to public (P2) restores unmetered. If P1 ever approaches the cap, the nightly moves to the Mac mini for the staging period at $0.

---

## 14. Security & supply chain *(new; review F14)*

- **Workflow least privilege.** Every workflow declares an explicit `permissions:` block; default `contents: read`. Only the publish job gets `contents: write` (and only in `populus-data`).
- **Untrusted-PR isolation.** PR-triggered jobs run without secrets; `pull_request_target` is banned; publish jobs trigger only on `schedule`/`workflow_dispatch` from the default branch.
- **Action pinning.** All third-party Actions pinned to full commit SHAs; Dependabot watches the pins.
- **Branch protection + CODEOWNERS** on both repos, mandatory review for: `parse/` (parsers), `member_aliases`, identity registries, `licenses.json` and the conditions register, and `.github/workflows/`.
- **Dependencies.** `uv.lock` with hashes; CI dependency audit (vulnerabilities + license check) — which also implements guardrail G1's paid-vendor denylist.
- **Artifact integrity — verified chain, not trust-by-location.** GitHub **immutable releases enabled** on `populus-data` (explicit repo setting; checked here and re-checked by the external monitor); the publish workflow generates **Sigstore artifact attestations** for the manifest and every asset; **clients verify the manifest attestation before trusting it**, then verify per-asset SHA-256 from the manifest (§5.5). Branch protection guards the repo but is not the root of trust — the attestation chain is.
- **Secrets inventory (exactly three, reviewed quarterly):** Discord webhook URL (alerting); Cloudflare Pages deploy-hook URL (rotated on any suspicion; invocations visible in Pages logs); one fine-grained PAT for the Mac mini — `populus-data: contents` write for fallback publishing, plus read scope while the repo is private staging (stored in macOS Keychain on the mini, never in dotfiles; read scope dropped at the P2 public flip).
- **User-side.** `~/.cache/populus/` written `0700`/files `0600`; cache paths never include secrets; the MCP server runs read-only against verified artifacts.
- A security checklist covering all of the above is a **P1 gate** and re-run at every module launch.

---

## 15. Legal & licensing *(rewritten; review F3)*

### 15.1 The conditions register

`licenses.json` — machine-readable, version-controlled in `populus-data`, shipped with every build and mirrored in `DATA-LICENSE.md` (human-readable) + `NOTICE` (required attributions). Each entry: `license_id`, source, legal instrument, permitted uses, restrictions, required notices (verbatim where the source specifies), attribution text, determination basis, determination date, review-by date. Every artifact and (where sources mix) record carries a `license_id` (§5.1). **No source is ingested before its entry exists (G11).**

### 15.2 Initial register entries

| `license_id` | Source | Instrument & determination basis |
|---|---|---|
| `us-congress-disclosures` | House Clerk, Senate eFD | Public records under the Ethics in Government Act as amended by the STOCK Act. **Not treated as unrestricted public domain:** 5 U.S.C. § 13107(c)(1) prohibits use for commercial purposes (exception: news/communications media dissemination to the general public), credit determination, or solicitation. Populus's posture — free public dissemination, open source, data never sold — is designed to sit inside the media-dissemination exception and matches incumbent practice, **but "free product" is not itself a legal determination: counsel review is the P2-entry gate, and no data artifact is publicly distributed before it — P1 builds live in the private staging repo (DR-5); the launch post is marketing, the repo flip is the legally relevant distribution event, and counsel precedes the flip.** The prohibited-uses notice ships in README, MCP `data_note`/`license_notices`, and the dashboard footer. The eFD click-through (accepted programmatically, as the session requires) restates these conditions; we honor them in substance (posture) and behavior (politeness contract, G6). |
| `us-govworks-sec` | SEC EDGAR / data.sec.gov | 17 U.S.C. § 105 covers works of the US Government — which is the SEC's own compilations and site content, **not automatically every third-party filing hosted there**. Determination for filing *data*: facts and figures are not copyrightable; EDGAR's decades-long public-dissemination regime is the operative access framework; SEC fair-access rules (rate limits, identifying UA) are conditions we encode in every client. Documents are redistributed as public filings with source URLs. |
| `us-govworks-treasury` / `us-govworks-cftc` | Treasury FiscalData, yield XML; CFTC COT | US-government works; attribution shipped as good practice. |
| `bls-tos` | BLS API | US-government work **with explicit ToS conditions**: retrieval-date citation and BLS's verbatim disclaimer are **required**, not courtesy — emitted in `license_notices` on every BLS-derived response and on dashboard surfaces. Keyless tier limits encoded in the client. |
| `bea-tos` | BEA API | Entry completed at M4 phase entry (API not yet verified; free key). |
| `fred-per-series` | FRED | Agency-operated aggregator; **per-series** third-party licenses. A FRED series is ingestible only with its own sub-entry recording the underlying source's status; primary agency preferred wherever one exists; user-key only (§11.5). Determinations at M4 entry (OQ-11). |
| `cc0-legislators` | congress-legislators | CC0 — unrestricted. |
| `mit-kadoa-seed` | kadoa backfill | MIT — attribution shipped; provenance + lineage retained (§9.6). Regularized register entry, not an ad-hoc exception (G2). |
| *(reference only)* | crnicholson/capitol-api | **No license = all rights reserved.** Read for ideas; zero code reuse. Recorded so nobody "helpfully" vendored it later. |

### 15.3 Posture rules

- Data is never behind a paywall (G13); a future convenience tier (P-Ω) requires fresh counsel review of the full register.
- Notices are non-removable from consumer output (§11.3).
- This section records posture, process, and determination bases — not conclusions of law. **Counsel reviews the register and the § 13107 posture before the first public data artifact exists (P2-entry gate; the data repo is private staging until then), not merely before monetization.**

---

## 16. Launch & distribution

Repo quality first: README with the what/why in three sentences, 60-second MCP quickstart, real transcript examples, the honesty section up top, badges (freshness, coverage, license) fed by `stats.json`; MIT LICENSE, CONTRIBUTING, issue templates from day one. M1 launch post: *"I asked Claude what Congress bought this week"* — a real session, closing on the differentiators. Positioning claim, kept precise and dated: **as of 2026-07-16 registry searches, no free, open-source, primary-source dedicated congressional-trading MCP exists** (hosted paid platforms list congress trades among their features; PulseMCP's "congressional trading" query returned zero) — re-checked before the post ships. Registry sweep per §11.7. Each later module is a fresh launch on compounding assets; the platform narrative ("the open financial-data commons") arrives with M2. Between launches, freshness badges and `/methodology` do the quiet marketing.

---

## 17. Phasing & gates

Policy: **every gate is a number, a named fixture, or a pass/fail drill.** No phase starts before the prior phase's gates are green; one module in flight at a time (G12).

**P0 — Foundation.** Scope: this doc approved; `populus` public + **`populus-data` created private (staging, DR-5)** with **immutable releases enabled**; MIT, README stubs, branch protection, CODEOWNERS; CI skeleton (lint, tests, dependency/license audit, G1 denylist); **`populus-mcp 0.0.1` placeholder published to PyPI** (owner executes/delegates); domain chosen (OQ-1). Gates: owner approval recorded; CI green on both repos; PyPI name secured; §14 checklist passes including the immutable-releases setting.

**P1 — M1 data layer + substrate.** Scope: §9 complete; §5.5 publication protocol; §13.2 external monitor; §14 controls; runbooks. **All P1 publishes go to the private staging repo — nothing is publicly distributed in this phase (C1).** Gates:
- 7 consecutive green nightly publishes (Actions, to staging), zero manual intervention.
- Attestation chain demonstrated: a consumer verifies the manifest attestation and rejects a tampered artifact (fixture test).
- Logical-digest reproducibility: two independent builds from the same raw archive produce identical `logical_digest`s.
- E-filed parse coverage ≥97%; member-join ≥98%; golden corpus (≥30 fixtures incl. bond/exchange/multi-page) green in CI.
- kadoa acceptance sample per §9.6: n=150 stratified, 0 critical errors, cosmetic ≤5%.
- Completeness reconciliation: every DocID/UUID in the sources' indexes for the covered window is present with exactly one `parse_status` — counted, zero unaccounted.
- Freshness <24 h vs. House index Last-Modified.
- **Drills passed:** rollback (repoint `latest.json`, consumer follows) · disaster recovery (raw → rebuilt DB ≤2 h, counts/hashes reconcile with manifest) · publish-conflict (concurrent dispatch serializes, no torn build).
- External monitor live and demonstrated (kill a scheduled run; alert fires ≤12 h).
- Security checklist §14: all items pass.
- OQ-13 amendment study complete; amendment fixtures encoded; supersede automation enabled only in the verified mode.
- License conformance: 100% of artifacts carry `license_id`; `licenses.json`, `DATA-LICENSE.md`, `NOTICE` shipped.

**P2 — MCP server (M1 tools) + public launch.** **Entry gate (before anything else in this phase): counsel review of the §15 register + § 13107 posture, completed and recorded.** Then, in order: flip `populus-data` public (the first public data artifact — the legally relevant distribution event, after counsel); MCP server (§9.9 tools + `populus_health`; §5.5 client; §11.4 federated client skeleton); packaging; `server.json` + PyPI ownership marker; registries; launch post. Gates:
- Golden-question suite: 20 analyst questions with pinned expected answers, 100% pass in CI.
- `uvx populus-mcp` cold start on a clean macOS machine ≤60 s to first successful tool call.
- Latency: snapshot tools p95 ≤2 s on the reference corpus.
- Schema-compat drill: previously released client vs. new manifest → works or refuses cleanly (CI-automated from here on).
- Listed on the official MCP registry (+ ≥1 more); `server.json` validated.
- Counsel entry-gate record on file; repo flip executed after it (order verified in the phase log).
- Launch post published.

**P3 — Dashboard (M1).** Scope: §9.10 + `/methodology`; nightly rebuild; localStorage follows. Gates: live on the domain; Lighthouse ≥90 (performance + accessibility) on feed, one member page, one ticker page; every rendered claim traceable to `doc_url` (spot-audit fixture: 25 random rendered rows, 100% link-resolve); static file count within budget; second post published.

**P4 — M2 institutional.** Scope: §7 contract finalized (OQ-8/9 resolved; datasets re-verified; amendment-type + unit-basis fixtures) → data layer → tools → `/institutional`. Gates: amendment fixtures (RESTATEMENT supersede + NEW-HOLDINGS merge + confidential-omission flag with its later disclosing NEW-HOLDINGS amendment + otherManager dedup) 100% green; CUSIP-map coverage ≥95% by value, unmapped rows visible; QoQ delta correctness on 2 hand-checked filers (Berkshire + one mid-size), 100% row match; unit normalization spot-check across a pre-2023 and post-2023 filing; page budget held; module launch post.

**P5 — M3 financials.** Scope: contract → federated client + bulk extract → tools → `/financials`. Gates: golden-question suite extended (10 questions with values hand-verified against filings, 100%); sparse-tagging behavior: 3 named fixture companies (chosen for known odd tagging) return flagged partials with zero unhandled exceptions; latency: federated p95 ≤4 s cold / ≤1 s warm-cache on the reference question set; extract build ≤15 min in Actions, ≤50 MB total across shards, no shard ≥5 MiB; page + file budget held including shards; launch post.

**P6 — M4 macro.** Scope: contract (BEA/FRED verification + per-series determinations, OQ-11; curated list OQ-12) → curated core + federated tail → tools → `/macro`. Gates: every curated series equals the agency-published value on 3 dated reference points each (fixtures); 100% of series carry `license_id` + required notices (BLS disclaimer emission verified by test); revision handling demonstrated on one revised observation (CPI revision fixture); launch post.

**P7+ — Backlog.** One §7 contract at a time; per-contract gates.

**P-Ω — Convenience tier (maybe never).** Entered only on sustained organic usage; fresh counsel review; data stays free (G13).

---

## 18. Risks

| Risk | L×I | Mitigation |
|---|---|---|
| **Scope sprawl** (platform framing read as license to parallel-build) | H×H | G12; §7 contract as phase-entry gate; §17 sequencing |
| Source format drift | M×H | Golden corpora fail CI loudly; raw archives + `populus reparse`; parse-or-flag turns drift into a visible coverage drop |
| eFD blocks Actions IPs | M×M | Host-agnostic jobs; credentialed mini fallback; circuit breaker; never evade |
| License/ToS misread (esp. FRED series, § 13107 posture) | M×H | Conditions register before ingestion (G11); counsel gate **before public launch**; per-series determinations; notices in-band |
| Identity-join errors (names, tickers, CUSIPs, historical drift) | M×H | Temporal registries (§5.4), as-of joins, G14, version-controlled aliases, coverage gates, visible non-joins |
| Amendment mishandling (M1 PTR; M2 typed 13F/A) | M×H | Verify-first policy (OQ-13); typed amendment model with fixtures; conservative flagged defaults until verified |
| Artifact corruption / client-data version skew | M×H | §5.5 protocol: hashes, integrity checks, atomic cache, compat policy, CI compat drill, rollback runbook |
| Provider-limit breach (GitHub CDN use, Pages file caps, Actions crons) | M×M | §13.4 measured thresholds + named triggers (R2); Releases not git for bulk; page budgets with hard CI fail; external monitor |
| Supply-chain compromise of a published artifact | L×H | §14: least privilege, PR isolation, SHA pinning, attestations, manifest verification on every consumer |
| kadoa seed errors inherited | M×M | n=150/0-critical acceptance sampling; lineage + tombstoned progressive replacement |
| Aggregate federated load draws agency ire | L×M | §11.4 conservative defaults, per-install UA, bulk-first; degrade-or-disable response (G6) |
| Legal challenge to posture | L×H | Conservative posture; counsel gate; notices everywhere |
| Copycat forks (MIT) | H×L | Accepted; freshness, honesty record, and registry position don't fork |
| Single-maintainer bus factor | H×M | Everything reproducible from public repos + raw archives (drilled); three inventoried secrets; runbooks in-repo; CONTRIBUTING day one |

### 18.1 Declared tech debt (known compromises, on the record)

Open questions are unknowns; these are *known* compromises accepted deliberately:

1. **Duplicate-row identity inherits source-coordinate stability** (§9.4): identical same-filing rows can renumber if a reparse finds a new identical duplicate earlier in the document. Accepted — the source provides no stronger identity; confined to same-filing duplicates and resolved atomically.
2. **Member identity is name-based at the root** (§9.7): the temporal alias table constrains it, but a same-name/same-state/same-era collision would still need a human decision. Accepted with the version-controlled alias process as the control.
3. **Client attestation verification depends on Sigstore tooling** (§5.5): `sigstore-python` is the assumed verifier; if it proves too heavy for the MCP client, the fallback is manifest-hash verification with attestation checked only by the external monitor — a weaker but stated trust posture. Decided at P2 implementation.
4. **`transactions.bioguide_id` is denormalized** (§9.4) for query speed; guarded by a CI invariant test (must equal its filing's), not by normalization.
5. **Hosted HTTP transport is deferred with a written acceptance checklist** (§11.6) rather than designed now. The checklist is the control; the debt is that it is unexercised.
6. **kadoa-sourced history remains in the store until progressively re-parsed** (§9.6): audited seed data with provenance, but still third-party parser output, visible in the public `source` mix until replacement completes.

---

## 19. Anti-patterns & guardrails

1. **G1 — No paid or license-restricted vendor data, ever.** CI denylist (Massive/Polygon, QuiverQuant, Unusual Whales, …) over lockfile + imports; review.
2. **G2 — Primary sources only; recorded entries are the only door.** No unlicensed third-party intermediaries (the capitoltrades-scraper anti-reference). Licensed seeds (kadoa) and agency-operated aggregators (FRED) enter **only** through the §15 conditions register, with provenance retained. Anything not in the register is out.
3. **G3 — Never silently drop a record.** Every source document/API row ends in exactly one status; completeness reconciles against source indexes nightly.
4. **G4 — Disclosure lags on every surface.** M1 both dates always; M2 quarter-end + filed date. Envelope `data_note`s are non-removable.
5. **G5 — Ranges and estimates stay labeled.** No invented midpoints; no unlabeled derived values.
6. **G6 — Politeness floors, never evasion.** Per-source rate floors in code; on refusal: stop, alert, relocate or degrade — never rotate IPs, never disguise UAs, never raise rates in response to blocks.
7. **G7 — Consumers read published artifacts or make their own fair-access API calls.** No consumer may create a hidden load path (browser calls to agencies, scraping from clients). User growth must never translate into load on Populus infra or covert load on agencies.
8. **G8 — Any new cost is flagged before it enters the tree.** §13.6 is a contract.
9. **G9 — No Compass coupling**, either direction, any layer.
10. **G10 — Flows are not holdings; as-reported is not normalized.** Labels are structural, not optional.
11. **G11 — The conditions-register entry precedes ingestion.** "It's on the internet" is not a determination.
12. **G12 — One module at a time.** No M(n+1) work — including "just the schema" — before M(n)'s gates are green.
13. **G13 — Data is never behind a paywall.** A paid tier may charge for convenience only; any design gating data access is a defect.
14. **G14 — No identity time travel.** Historical records join identity mappings as-of their own dates; silent CUSIP→current-ticker→CIK chaining is a defect (§5.4).

---

## 20. Open questions

| # | Question | Resolve by |
|---|---|---|
| OQ-1 | Domain name | P0 — owner pick; ~$12/yr |
| OQ-2 | House FilingType code map beyond `P` (feeds `filing_kind` + amendment detection) | P1, vs. Clerk documentation + corpus |
| OQ-3 | House paper-vs-e-file discriminator (v1: extraction-yield heuristic; confirm vs. DocID patterns) | P1 |
| OQ-4 | Senate paper-filing share (sets OCR priority) | P1 +30 days |
| OQ-5 | Raw-archive bundling cadence and size trajectory | P1; §13.4 thresholds govern |
| OQ-6 | Older-year House ZIP schema drift (2013–2015 exist; schemas undiffed) | P1 re-scrape |
| OQ-7 | Hosted HTTP MCP: demand signal, host, and the §11.6 security acceptance checklist (Host/Origin allowlists, TLS trust, authn decision, session behavior, size + rate limits, end-to-end drill) | P4+ review; checklist gates any deployment |
| OQ-8 | CUSIP↔security bootstrap source (candidate: SEC fails-to-deliver CUSIP+ticker pairs) — coverage and interval quality | P4 entry |
| OQ-9 | Archive SEC quarterly 13F datasets (~95 MB/qtr) as Release assets for reproducibility, or rely on SEC availability? | P4 entry, with real numbers |
| OQ-10 | ~~13F structured datasets availability~~ **Closed 2026-07-16:** page verified HTTP 200 (earlier 503 transient); latest quarterly archive ≈95 MB per the page | closed |
| OQ-11 | FRED per-series determinations; BEA API verification + key ergonomics | P6 entry |
| OQ-12 | Macro curated-core series list — **owner input requested** | P6 entry |
| OQ-13 | **Empirical amendment semantics per chamber** (restate vs. append; original-identification reliability) from ≥3 real amended PTRs each; encode as fixtures | P1 — blocks supersede automation (§9.5) |

---

## Appendix A — Verification log, congressional sources (executed 2026-07-16)

1. `2026FD.zip`: HTTP 200, 50,845 B, Last-Modified 2026-07-15 13:00 GMT; contains `2026FD.xml` (369,925 B). Parsed: 1,376 filings; FilingType counts `{W:94, C:650, X:241, P:298, D:59, A:30, H:2, T:2}`; index schema confirmed.
2. Yearly archives: **four sampled years** (2013/2015/2020/2024) exist (HTTP 206 range probes). Intervening years are unprobed; the full sweep runs in P1.
3. `ptr-pdfs/2026/20034916.pdf` (Rep. Wittman, VA-01): 64,839 B, 1 page; pypdf extracted every schema field (CCI sale; transacted 06/30/2026; notified 07/02/2026; filed 07/10/2026; $1,001–$15,000; broker; cap-gains flag; digital signature).
4. Senate eFD handshake (plain curl, browser UA, residential IP, zero blocking): GET `/search/home/` 200 → CSRF token + agreement text → POST agreement → 302 → POST `/search/report/data/` (`report_types=[11]`, submitted ≥06/01) → JSON `recordsTotal: 19` (Tuberville 07/16, Boozman ×2 07/13, Fetterman 07/09, Whitehouse 07/08 …) with detail URLs.
5. eFD PTR detail (Fetterman, `a5fdbba4-…`): 200, 15,344 B; 9-column table parsed; ticker `--` on bond rows; `Sale (Full)`/`Purchase`; child-owned rows.
6. GitHub API: kadoa-org/congress-trading-monitor 111★ MIT pushed 2026-07-16 · neelsomani/senator-filings 413★ MIT pushed 2024-01-19 (protocol reference only) · unitedstates/congress-legislators 2,409★ CC0 · crnicholson/capitol-api 9★ **no license** · erikmaday/unusual-whales-mcp 72★ · anguslin/mcp-capitol-trades 3★ abandoned.
7. kadoa `trades.json`: 4,337,935 B; sample row carries id, both dates, days_to_file, is_late, amount bounds, owner, filer/party/chamber, doc_url.
8. PulseMCP API (2026-07-16): "congressional trading" → 0 servers; "congress" → 10 (legislative-data servers; hosted paid platforms — ClawTerminal, HoldingsIntel, Ko — list congress trades among features). Dated observation, re-checked before launch (§16).
9. PyPI: `populus` taken; `populus-mcp`, `congress-trading-mcp` returned 404 (observation, not reservation — DR-6).
10. Project Compass: live at `~/projects/Project Compass` (v2.6 doc, 153+ PRs); vendor Massive Advanced $199/mo; guardrails at its §19; multi-user honesty at its §12/§17.

## Appendix B — Verification log, platform-scope sources (executed 2026-07-16, rounds 2–3)

1. **SEC companyfacts** `CIK0000320193.json` (Apple): HTTP 200, 3,748,682 B, keyless (identifying UA).
2. **SEC submissions** `CIK0000320193.json`: 200, 164,394 B.
3. **SEC XBRL frames** `us-gaap/Revenues/USD/CY2025Q4.json`: 200, 57,325 B.
4. **SEC company_tickers.json**: 200, 797,593 B.
5. **13F end-to-end** (Berkshire, CIK 1067983): submissions → latest 13F-HR accession `0001193125-26-226661` (filed 2026-05-15) → `index.json` → `primary_doc.xml` (5,555 B) → information table `53405.xml` (45,259 B): `nameOfIssuer/titleOfClass/cusip/value/sshPrnamt/investmentDiscretion/otherManager/votingAuthority` confirmed. CUSIP-only → OQ-8.
6. **13F structured-datasets page**: re-verified HTTP 200 (round 3; round-2 503 was transient). OQ-10 closed.
7. **13F value units**: ALLY row 498,992,850 ÷ 12,719,675 sh = **$39.23/sh → whole dollars** in post-modernization filings; pre-2023 filings are in thousands. Era-dependent normalization specified (§10.2).
8. **SEC bulk archives**: `companyfacts.zip` HTTP 206 range probe, `Content-Length: 1,389,620,072` (~1.39 GB); `submissions.zip` HTTP 200/206. Basis for the M3 dashboard extract (DR-10).
9. **Treasury FiscalData** (keyless): 200, JSON. **Treasury daily yield-curve XML** (2026): 200, 209,248 B.
10. **BLS API v2, keyless GET** (`LNS14000000`): 200, JSON.
11. **CFTC COT**: `dea/newcot/deafut.txt` and `files/dea/history/fut_fin_txt_2026.zip` exist (206 probes).
12. **BEA**: signup page 200 only — **API not verified**; phase-entry item. **FRED**: docs page 200 only — key required; per-series licensing → §15, OQ-11.

## Appendix C — Statutory amount buckets (M1 PTRs)

$1,001–$15,000 · $15,001–$50,000 · $50,001–$100,000 · $100,001–$250,000 · $250,001–$500,000 · $500,001–$1,000,000 · $1,000,001–$5,000,000 · $5,000,001–$25,000,000 · $25,000,001–$50,000,000 · Over $50,000,000. Spouse/dependent filings may cap at "Over $1,000,000" → `amount_low=1_000_001, amount_high=NULL` + flag. **The exact label set must be verified against the corpus in P1** (it has not been yet); unrecognized labels flag `amount_unparsed` and preserve the raw label.

---

*End of ARCHITECTURE.md v2.2 — draft for owner review; supersedes v1.0/v2.0/v2.1 entirely (v2.1 = commit `f7985f6`). Finding dispositions for both review rounds: [REVIEW-RESPONSE.md](REVIEW-RESPONSE.md). No implementation begins until this document is approved (P0 gate).*
