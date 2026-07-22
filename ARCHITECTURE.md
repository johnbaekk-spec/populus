# Populus — Architecture (v2.11)

**The open financial-data commons: finance data that is free to pull from primary sources and redistributable under recorded conditions, served as an MCP server and a public dashboard. Congressional trading ships first.**

| | |
|---|---|
| Status | Draft for owner review — no implementation until approved (P0 gate) |
| Author | Claude (Fable 5), 2026-07-16, on the Mac mini |
| v2.11 | Revision addressing external review **round 10** (REQUEST CHANGES: 1 critical, 1 high, 1 medium). **C1 (marker verification ≠ tree authentication):** the record signer checked only `build_id`/`code_sha`/`stats.json` on the live site while attesting a record bound to the *whole* `dist_digest` — a compromised deploy job could keep those three correct and alter every HTML/JS/CSS file. Fixed by publishing a **path → SHA-256 inventory** with the artifact and having the signer **fetch and hash-verify every inventory path from the identified deployment** before attesting, with an honest machine-readable `verification_scope` (`full`/`partial` + `files_verified`/`files_total`) so a record can never overstate its own coverage; marker-preserving-tamper fixture added to P3. **H1 (signer identity):** GitHub attestations identify a *workflow*, not a job, and `needs.<job>.outputs` are not signed — record verification/signing moved into a **separate pinnable reusable workflow (`record-sign.yml`)**, the "signed outputs" claim removed, and trusted inputs restated (attested manifest, self-downloaded artifact, Cloudflare API, served bytes). **M1:** REVIEW-RESPONSE header propagated to v2.10/§I. New declared debt **TD-10** (point-in-time scope + the gated `partial` mode). | §5.5, §12.1, §14, §17, §18.1 |
| v2.10 | Revision addressing external review **round 9** (REQUEST CHANGES: 1 critical, 2 high, 1 medium — the last narrow deploy-trust gaps; reviewer committed to P0 approval once fixed). **C1 (false security invariant):** the record job was a *signing oracle* — it attested whatever the privileged deploy job handed it. It is now a **verifier**: it re-derives `build_id`/`code_sha`/`workflow_run_id`/`dist_artifact_id` from GitHub context + the publish job's signed outputs, **independently downloads the artifact and recomputes `dist_digest`**, and accepts the deploy job's `cf_production_deployment_id` only after **live-verifying that deployment's URL and the custom domain** serve the expected build — a compromised deploy job can deface pixels (TD-8) but cannot forge a record. **H1:** `dist_digest` is now a defined, versioned **canonical tree digest** (path-sorted, per-file size+hash framing, symlinks/non-regular files rejected), recomputed at every boundary incl. immediately before *each* upload. **H2:** because the record job runs after production is live, a record-job failure left a matching-`build_id` site with no divergence to detect — the monitor now **requires a valid attested deployment generation for the live build** and gates the next publish without one; records are **append-only generations** (`deployments/<gen>.json`) so redeploys never overwrite an attestation. **M1:** round-8 audit-count corrected (7 findings incl. the M3 marker, not 6). | §5.5, §12.1, §13.2, §13.5, §14, §17 |
| v2.9 | Revision addressing external review **round 8** (REQUEST CHANGES: 2 critical, 1 high, 2 medium). **C1:** the dashboard deployment record no longer mutates the immutable, already-attested manifest — it is a **separate, independently-attested `builds/<build_id>/deployment.json`** written by a dedicated **record job** after production verifies (three-job split: publish / deploy / record, none holding both the Cloudflare token and GitHub-write). **C2:** analytics reduced to what a cookieless page-analytics tool actually supports — **interest read from resolved page paths, raw search text never collected**; no custom-event collector, no new infrastructure, and the consent-banner question left to OQ-14 instead of predetermined. **H1:** the deploy is described honestly as **two uploads of one locally-hash-pinned artifact (preview-verified first) with a compensating production rollback — not a provider-side "promotion"** (Cloudflare exposes neither a promote op nor a deployment content digest). **M1:** PyPI "installs" → "download events (noisy proxy)". **M2:** title/footer/review-trail version drift corrected (this doc was mislabelled v2.7 while its row/footer said v2.8). **L1:** a `$0`→shell-expansion typo in the v2.8 commit body is noted in the audit trail. |
| v2.8 | **Owner-requested content addition** (not a review round): new §12.3 **Usage analytics** — how usage is measured without accounts or login. Aggregate + cookieless: privacy-first web analytics (top pages, referrers, anonymized search queries) + platform-published download/adoption stats for the MCP server, which never phones home. Establishes that no free surface (M1–M4) requires login or collects identity; identity-linked tracking arrives only with opt-in P-Ω accounts. Propagated: guardrail **G15** (no identified tracking / no silent telemetry / no login wall on free surfaces), a $0 analytics cost row (§13.6), a P3 no-PII verification gate (§17), and **OQ-14** (confirm the cookieless tool at P3). |
| v2.7 | Revision addressing external review **round 7** (REQUEST CHANGES: 2 critical, 1 high, 2 medium). Makes the deploy path **transactional**: the site is deployed to a **preview** deployment and live-verified there *before* production ever receives the bytes — production is promoted only from an already-verified `dist`, and a post-promote check failure triggers an **automatic compensating rollback to the captured prior production deployment ID**, itself re-verified (closing the "unverified build may already be live" gap). Rollback is made **reproducible** by a durable, build-scoped **deployment record** in the manifest (dashboard code SHA, canonical `dist` digest, workflow run + artifact IDs, Cloudflare deployment ID, retention deadline tied to the supported rollback window) — no more unspecified "retained `dist/`". `stats.json` finalization now writes the real count into **both** the canonical artifact **and** `dist/` with a byte-equality gate, so the deployed site cannot disagree with the immutable manifest. Production-branch identity is **asserted via the Cloudflare project API** before upload, not assumed from the `--branch` flag. Stale v2.5 footer corrected (a v2.6 propagation miss). TD-8 extended to name the preview-window exposure; TD-9 declared (deployment-record retention). |
| v2.6 | Addressed external review **round 6** (REQUEST CHANGES: 1 critical, 4 high, 1 medium). The publisher-side deploy path becomes a complete trust boundary: a **normative §12.1 deployment protocol** — pinned code SHA + Node toolchain (committed lockfile, frozen install, exact Wrangler pin), the site built from the staged verified build **before** publication so the real `dist/` file count lands in immutable `stats.json`, an **isolated least-privilege deploy job** holding only the Cloudflare token, an explicit production branch, and **per-deploy live-domain verification** of the embedded `build_id` + code SHA. **Rollback now redeploys the dashboard** and the monitor alarms on any-direction site/pointer divergence past a deploy grace window, not only backward lag. The pointer state machine gains **universal preconditions before the version branch** — an equal-but-expired pointer fails refresh (expiry enforced on every poll, not only upgrades); future-issued pointers rejected. **TD-7 broadened to every missing-state bootstrap** (cache wipe/reinstall/corruption reopen the bounded window; the monitor instead fails closed until an operator restores state); **TD-8 declared** (deploy-job toolchain exposure). **Cloudflare Pages Edit is account-scoped** — isolation comes from a dedicated Cloudflare account containing only Populus; the account id is non-secret configuration; the 500-deploys/month ceiling stays tracked (§13.4) — only the 20-minute Pages build timeout is inapplicable to direct upload. |
| v2.5 | Revision addressing external review **round 5** (REQUEST CHANGES: 1 critical, 2 high, 1 medium). The pointer protocol is now closed over its whole consumer set: **the dashboard is removed from that set entirely — deployed publisher-side** (the publish workflow builds the site with the exact build it just verified and pushes via `wrangler pages deploy`; no `latest.json` resolution, no replay state, no recurring-TOFU hole in ephemeral Pages builds); pointer verification is a **four-way state machine over a persisted `(pointer_version, pointer_sha256)` tuple** (lower = replay; equal+same bytes = idempotent accept — repeat polling works; equal+different bytes = equivocation alarm; higher = verify → install → persist), fixing the strict-greater check that would have rejected the unchanged current pointer; **signed rollback propagated everywhere it was still the old unsigned procedure** (§5.5 retention, §13.5 runbook as an exact mint→attest→verify→replace-last sequence, §14 chain now pointer→manifest→artifacts, P1 drill, and a positive authorized-rollback fixture in the P2 gate); TD-7 corrected and rescoped to MCP first-run only; session memory-capture marker created per the workflow convention. Secrets stay at three (Pages deploy-hook URL → Cloudflare API token). |
| v2.4 | Addressed external review **round 4** (REQUEST CHANGES: 1 critical, 4 high, 4 medium). The trust protocol is now executable end to end: **`latest.json` is itself attested and versioned** (monotonic `pointer_version`, expiry, highest-seen enforcement — closing the authenticated-rollback replay hole; legitimate rollback = a new signed pointer generation targeting an older build); **attestation-bundle acquisition specified exactly** (GitHub attestation API by subject digest, candidate filtering, pinned identity/issuer, TUF-refreshed trusted root); **publication sequences split into P1 (private, unattested, ACL-bounded) and P2+ (attested)** with an executable cutover — and the honest invariant *"no supported client trusts an unattested build"* replacing the false "impossible by ordering" access-control claim; monitor PAT gains `Administration: read` for the immutable-setting check; DR-5 storage map reconciled with §5.5/§6; manifest example carries `digest_projection_version` + `normalization_version` and the digest's byte-level framing is pinned (stored TEXT treated as opaque — never parsed). New declared debt: TD-7 (first-run pointer TOFU, expiry-bounded). |
| v2.3 | Addressed external review **round 3** (REQUEST CHANGES, narrow: 2 critical, 2 high, 5 medium). One trust protocol, locked: GitHub artifact attestations are **public-repo-only on the Free plan**, so attestation creation + the tamper gate move to the **P2 flip sequence** (repo public → attested build → `latest.json` consumer-readable); private-P1 staging relies on the repo's own access control with hash verification; the unsigned client fallback (old TD-3) is **removed** — clients always verify attestations from P2 on, with pinned certificate identity + OIDC issuer. Monitor now follows the manifest protocol; P1-gate residues (stratified wording, counts/hashes) reconciled; logical-digest projection made explicit and versioned; 13F caveat widened to Section 13(f) securities; JSON CHECK constraints added; per-install UA residues removed. |
| v2.2 | Addressed external review **round 2** (REQUEST CHANGES; 4 critical, 5 high, 6 medium). Key changes: counsel review now precedes the **first public data artifact** (P1 runs against a private staging repo); the M1 identity contract is reproducible from the schema (raw fields stored, canonical serialization, 128-bit fingerprints, source-coordinate duplicate identity); the artifact trust model is real (immutable releases enabled, Sigstore attestations consumer-verified, all consumed files build-scoped); 13F confidential-treatment and unit-cutover semantics corrected; unresolved amendments no longer double-count. Round-2 dispositions in [REVIEW-RESPONSE.md](REVIEW-RESPONSE.md). |
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
- **No accounts, payments, alerts, or hosted write APIs** through M1–M4. Usage is measured anonymously (aggregate, cookieless — no login, no identity; §12.3).
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

**Decision.** `populus` (code) and `populus-data` (artifacts) are separate repos. `populus` is public from day one (MIT code). **`populus-data` starts private (staging) and flips public only after the P2-entry counsel gate** (§15.3) — so no data artifact is publicly distributed before legal review. Within `populus-data`, the authoritative storage map (single source of truth; §5.5 and §6 conform to it) is: **git tracks** (a) build metadata — `builds/<build_id>/manifest.json` and the `latest.json` pointer; (b) registries and `licenses.json`; (c) **build-scoped small text artifacts** — the JSON slices and `stats.json` under `builds/<build_id>/…`, capped at 5 MB total per build (CI-enforced). **Release assets hold everything else** — SQLite snapshots, raw-archive bundles, and any artifact over 1 MB. Every consumed file, git-tracked or Release-hosted, is enumerated and hashed in the manifest.

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

**Consequences.** Pattern-F tools require network at question time (declared in tool descriptions; caches serve offline with staleness notes). Aggregate load across all installations still grows with adoption — so the federated client is deliberately conservative (§11.4): defaults far below agency ceilings, caching, coalescing, bulk-endpoints-first, and a truthful application UA plus optional operator contact. No "at any scale" claims; if an agency ever signals displeasure, the affected dataset moves to Pattern R extracts or is dropped (G6).

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
        │ pointer → manifest → verify → atomic cache     │ publisher-side build → wrangler deploy
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

Per module, always published (in `stats.json`, the `*_health` tools, and `/methodology`): freshness (source-side latest vs. ours), coverage (parsed/total, joined/total), known-gap counts (`needs_ocr`, unjoined names, unmapped identifiers), and a standing `data_note` stating the domain's structural caveat — M1: the 45-day STOCK Act lag and range-only amounts; M2: 13F covers long positions in Section 13(f) securities (including reportable options, warrants, certain convertibles) — no shorts or cash — quarter-end, up-to-45-days-late, era-dependent value units; M3: as-reported XBRL ≠ normalized comparables; M4: series are revised, vintage semantics stated per series. These are response-envelope content, not footnotes.

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
      "normalization_version": "1.1",
      "digest_projection_version": "1",
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

Field semantics: `client_compat` is a **PEP 440 version-specifier string** evaluated against the client's own version (no `1.6.x`-style informal grammar); `normalization_version` and `digest_projection_version` key digest comparability (below); `logical_digest` is the canonical logical-content digest defined below; **every consumed file — SQLite, JSON slices, `stats.json` — is an enumerated artifact under a build-scoped path or Release URL.**

**The dashboard deployment record is a *separate* document, not part of the manifest.** The manifest is assembled, hashed, attested, and pointed-to *before* the dashboard is deployed (§12.1), and it is immutable thereafter — so nothing about the deployment can live inside it (a post-deploy write would break the pointer's `manifest_sha256` and the manifest attestation). Instead, after production is verified, a dedicated **record job** (§12.1 step 6, §14) writes and attests an **append-only deployment generation** at `builds/<build_id>/deployments/<gen>.json` (`<gen>` a monotonic integer per build — a build may be deployed more than once across manual recovery or rollback, so records are never overwritten; the highest attested generation is current):

```json
{
  "build_id": "20260716.1",
  "generation": 1,
  "code_sha": "…",
  "dist_digest": "…",
  "dist_digest_version": "1",
  "inventory_digest": "…",
  "verification_scope": "full",
  "files_verified": 3812,
  "files_total": 3812,
  "workflow_run_id": "…",
  "dist_artifact_id": "…",
  "dist_artifact_expires_at": "…",
  "cf_production_deployment_id": "…",
  "verified_at": "…"
}
```

**The record job is a *verifier*, not a signing oracle (round-9 C1) — and it verifies the *served tree*, not just liveness markers (round-10 C1).** An attestation proves only *who emitted* bytes, so the record job trusts **no value from the privileged deploy job**. Its inputs are:

- **`build_id`** — from the published, attestation-verified manifest/pointer (§5.5), not a job output.
- **`code_sha`, `dist_digest`, and the file inventory** — from the **immutable `dist/` workflow artifact, which the record job locates via GitHub Actions context (`workflow_run` id + artifact name) and downloads itself**, then recomputes (canonical tree digest, §12.1). GitHub job outputs are ordinary workflow data, **not signed** — nothing here relies on them.
- **`cf_production_deployment_id`** — read from the **Cloudflare Pages API as the project's current production deployment**, then cross-checked against the deploy job's claim; a mismatch is itself a finding, not an input to trust.
- **The served bytes** — see below.

**Full served-tree verification.** The build publishes a **path → SHA-256 inventory** of `dist/` (the same enumeration that produces `dist_digest`; `inventory_digest` covers it). Before attesting, the record job **fetches every path in that inventory from the identified deployment's Cloudflare deployment-specific URL and verifies each file's hash**, then confirms the live custom domain serves that same deployment (Pages API) with matching markers. Marker checks alone (`build_id`, `code_sha`, `stats.json`) are **not** sufficient — a compromised deploy job could preserve exactly those three while altering every HTML/JS/CSS file, which is precisely the attack this closes. At the enforced page budgets (M1 ≤4,000 files; global cap 15,000, §12.1) this is a bounded, concurrency-limited fetch measured in tens of seconds.

**Honest scope declaration.** The record states what was actually checked: `verification_scope: "full"` when every inventory path was fetched and hash-matched, plus `files_verified`/`files_total`. If a tree ever exceeds the verification budget (or fetches fail past retry), the job **degrades explicitly** to `verification_scope: "partial"` — all executable assets (JS/CSS) and entry pages plus a random sample — and that value is attested, so **the record can never overstate its own coverage**; partial mode is an alarm condition and is bounded by TD-10.

**What the record does and does not certify.** With `scope: full` it certifies: these exact bytes (by inventory hash) were served by this Cloudflare deployment at `verified_at`, and this deployment was the project's production deployment. It does **not** certify anything after that instant (a later re-deploy is a new generation), and it is **operational metadata outside the data trust chain** — MCP clients never read it; the dashboard is not a pointer consumer (§5.5). It is discovered by `build_id`/`generation` convention, never referenced from the immutable manifest.

**Signer identity, stated precisely (round-10 H1).** GitHub attestations identify a **workflow**, not an individual job within one, so "the record job's identity" is not a verifiable thing. Record verification and signing therefore live in their own **reusable workflow** (`.github/workflows/record-sign.yml`), called by the publishing workflow; its `job_workflow_ref` is a distinct, pinnable identity. Verifiers pin **`…/record-sign.yml@refs/heads/main`** for deployment generations and **`…/publish.yml@refs/heads/main`** for the manifest and pointer (§5.5 client verification), both with issuer `https://token.actions.githubusercontent.com`. Because the deploy job runs in the publishing workflow and holds the Cloudflare token, while signing runs in the separate reusable workflow that holds no token, the compromise of the deploy job cannot produce a record bearing the record-signer identity.

**The pointer.** `latest.json` (git) is **the sole mutable path any consumer ever reads** — and because it selects which build is current, it is inside the root of trust, not outside it:

```json
{
  "pointer_version": 412,
  "issued_at": "2026-07-16T15:04:22Z",
  "expires_at": "2026-07-23T15:04:22Z",
  "build_id": "20260716.1",
  "manifest_path": "builds/20260716.1/manifest.json",
  "manifest_sha256": "…"
}
```

`pointer_version` is a strictly monotonic integer across all generations; `expires_at` bounds staleness (7 days — refreshed by every nightly publish). From P2 on, **each pointer generation is itself attested** (its exact bytes are an attestation subject like any artifact).

**Pointer state machine.** Every verifier persists the last accepted `(pointer_version, pointer_sha256)` tuple. **Universal preconditions run on every fetched pointer BEFORE any version comparison:** schema validity; `expires_at` in the future and `issued_at` not in the future (beyond small skew) — both **evaluated against the current wall clock on every refresh**, because they are time-dependent and no cached result can satisfy them; attestation verified (P2 on — the digest-keyed verification cache satisfies this for byte-identical pointers without refetching bundles). A pointer failing any universal check fails the refresh regardless of version — **an unchanged-but-expired pointer is therefore rejected, never idempotently accepted**: if publishing stops for longer than the expiry window, every consumer's next refresh fails with a stale status while it keeps serving its last verified build — the seven-day staleness bound holds even when the pointer bytes never change. Only after the universal checks does the version branch run: **lower version** → reject as replay · **equal version, identical bytes** → **idempotent accept** — the normal case for every poll between publishes; no state change, no alarm · **equal version, different bytes** → reject and **alarm as equivocation** (two distinct pointers at one version can only mean publisher error or compromise) · **higher version** → verify `manifest_sha256`, install, then **atomically persist the new tuple**. A verifier holding no tuple — a first run, or any later loss of its persisted state — cannot evaluate the lower-version test and accepts one pointer that passes the universal checks (TD-7; the window is expiry-bounded and applies to MCP clients only — the monitor fails closed instead, §13.2). A compromised contents-write credential can rewrite the file but cannot mint a valid attestation for it; re-serving an older legitimately attested pointer fails the lower-version check. **Legitimate rollback is a new, higher, attested `pointer_version` targeting an older `build_id`** (exact sequence: runbook §13.5) — cryptographically distinguishable from replay.

**The pointer's consumer set is exactly: MCP clients and the external monitor.** Both hold durable state (the client's cache directory; the monitor's disk on the mini). **The dashboard is deliberately not a pointer consumer** — it is deployed publisher-side with the build the publisher just verified (§12.1), so ephemeral site builds hold no replay state and have no TOFU window at all. Unversioned convenience copies may exist for humans but are non-normative and never consumed programmatically; everything else a consumer touches is under `builds/<build_id>/…` or an immutable release tag, so builds cannot mix.

**Trust model — one protocol, two phases, no unsigned fallback.** GitHub **immutable releases are enabled on `populus-data`** (explicit repository setting — release assets are *not* immutable by default; verified in the §14 checklist and re-checked by the external monitor, §13.2).

- *Private staging phase (P1) — unattested by necessity, ACL-bounded by design.* **GitHub artifact attestations are unavailable to private repositories on the Free plan** (Enterprise-only), so P1 builds carry none. None are needed: the only consumers are the pipeline itself and the external monitor, both reading through the **authenticated GitHub API inside the private repo's access boundary**, verifying manifest-listed SHA-256s and the (unattested) pointer. The trust boundary *is* the repo ACL — stated as such, not disguised as cryptography.
- *Public phase (P2 on) — every publish attests.* The publish job (with `permissions: id-token: write, attestations: write`, §14) generates **GitHub artifact attestations** for every Release asset, `manifest.json`, and **each `latest.json` pointer generation**.
- *The cutover, stated honestly and executably.* Flipping the repo public **immediately exposes all files, history, and releases — documentation confers no access control**, and immutable release assets cannot be re-uploaded, so there is no "republish the current build" mutation. The executable sequence: (1) counsel entry gate passes; (2) repo flips public — pre-cutover staging builds become *visible*; (3) the P2 publish workflow runs, producing a **fresh build** (new release tag, attestations for all assets + manifest, and the first attested pointer generation); (4) `populus verify --remote` passes against it; (5) only then does the MCP client ship. **The security invariant is therefore not "old builds can't be read" — it is "no supported client ever trusts an unattested build":** every shipped client requires an attested pointer and manifest from its first release, and those exist only from the cutover build onward. Pre-cutover artifacts are visible history, trusted by nothing.
- *Client verification, specified end to end.* Given fetched bytes (pointer or manifest): compute their SHA-256 → **fetch attestation candidates from the GitHub attestation API** (`GET /repos/<org>/populus-data/attestations/sha256:<hex>` — public endpoint, no authentication) → filter candidates to the expected predicate type (SLSA provenance) whose subject digest matches → verify the bundle with `sigstore-python`, requiring **certificate identity `https://github.com/<org>/populus-data/.github/workflows/publish.yml@refs/heads/main`** and **OIDC issuer `https://token.actions.githubusercontent.com`**, against the **Sigstore trusted root shipped with the client and refreshed via Sigstore's TUF workflow** (verification itself is offline once the bundle and root are held) → cache verified results keyed by subject digest. Then verify each downloaded artifact against the manifest's SHA-256 + byte size. **There is no unsigned mode:** a client that cannot verify does not trust a new pointer or manifest — it keeps serving its last verified build and says so. The root of trust is the attestation chain; branch protection is an access control, not a signature.

**Logical digest (for reproducibility checks).** Per SQLite artifact, `logical_digest` = SHA-256 over a canonical logical export under an **explicit, versioned projection** (`digest_projection_version` recorded in the manifest). Projection v1 for `congress.db`, stated as an allowlist, not an exclusion heuristic: `ingest_runs` is **excluded entirely** (every column is operational); `members`, `member_aliases`, `filings`, and `transactions` are included with **all columns except** `filings.ingested_at`; the byte envelope is exact: tables in ascending lexicographic table-name order, each framed as the line `T:<table_name>\n`, followed by one line per row in ascending primary-key order — the row as an RFC 8785 canonical JSON object (column names as keys; SQL NULL → JSON `null`; INTEGER/REAL as JSON numbers; **TEXT as a JSON string of its stored bytes, never parsed — a JSON-typed TEXT column like `raw_row` is opaque here**, so the digest cannot depend on any JSON parser's behavior) followed by `\n`; `logical_digest` = SHA-256 over the concatenation. Changing the projection or envelope bumps `digest_projection_version`; digests are compared only within like `(digest_projection_version, normalization_version)` pairs — both fields are in the manifest per module. File bytes are *not* reproducible (SQLite page layout, insertion order, and library version all perturb them); logical content under a pinned projection is. The disaster-recovery drill (§13.5) compares logical digests and row counts, never file hashes.

**Publication sequences (atomic from a consumer's view), split by phase:**

- **P1 (private staging):** (1) upload Release assets under tag `data-<build_id>`; (2) commit `builds/<build_id>/` (manifest + build-scoped JSON); (3) update `latest.json` (unattested; `pointer_version` still monotonic) **last**. No attestation steps — they are unavailable and unneeded inside the ACL boundary.
- **P2+ (public):** (1) upload Release assets under tag `data-<build_id>` and **attest every asset**; (2) commit `builds/<build_id>/` and **attest `manifest.json`**; (3) write the new pointer generation (`pointer_version` +1) and **attest its exact bytes**; (4) update `latest.json` **last**. A consumer that resolves the pointer always finds a complete, attested, verifiable build; `populus publish` refuses to advance the pointer while any enumerated artifact or attestation is missing or fails verification (`populus verify` gate).

**Consumer protocol (MCP clients; the monitor follows the same chain per §13.2 — the dashboard is not a pointer consumer, §12.1):** fetch `latest.json` → **evaluate the pointer state machine** (universal checks first — schema, expiry/issuance against the current clock, attestation or cached verification — then the version comparison; an unchanged, **unexpired** current pointer is an idempotent accept and the MCP refresh ends here, while an unchanged-but-expired pointer **fails the refresh** with a stale status and the last verified build keeps serving; the monitor never ends early — §13.2 continues through the manifest and `stats.json` after an equal-pointer pass) → on a higher version: fetch the manifest at `manifest_path`, check it hashes to `manifest_sha256`, **verify its attestation** → evaluate `client_compat` against own version — **on incompatibility, refuse with a self-explanatory message and continue serving the last compatible cached build** → download artifacts to temp files → verify SHA-256 + byte size → for SQLite, `PRAGMA integrity_check` → atomic rename into `~/.cache/populus/<module>/<build_id>/` → **atomically persist the accepted `(pointer_version, pointer_sha256)` tuple** → update a local per-build `current` pointer. Any failure at any step leaves the prior cache and persisted tuple untouched; artifacts from different builds are never mixed.

**Compatibility policy.** `schema_version` is `MAJOR.MINOR`: clients accept same-MAJOR. MAJOR bumps ship in this order — a client release supporting both MAJORs first; the data flips only after a **deprecation window declared in the manifest** (`deprecation: {new_major, flips_at}`). CI enforces fail-safe behavior: the **previously released** client runs against each new manifest and must work or refuse cleanly (automated gate from P2 on, §17).

**Retention & rollback.** Builds are retained for **the entire supported-client window including any declared deprecation period, with an absolute floor of 90 days** — retention is derived from the compatibility promise, not a fixed number. Rollback = **publish a new, higher, attested pointer generation targeting the older `build_id`** (exact sequence: runbook §13.5); clients follow pointer generations, never "newest build" — a bare rewrite of `latest.json` to an old generation is rejected as replay by every post-P2 client.

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
  raw_row       TEXT NOT NULL               -- JSON: the exact extracted raw field object —
                                            -- the fingerprint's input, stored so identity is
                                            -- reproducible and auditable from the row itself
                CHECK (json_valid(raw_row) AND json_type(raw_row) = 'object'),
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
  flags         TEXT NOT NULL DEFAULT '[]'  -- JSON array: ["missing_ticker","date_anomaly",…]
                CHECK (json_valid(flags) AND json_type(flags) = 'array'),
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
- **Caveat.** Long positions in **Section 13(f) securities** — US exchange-traded equities plus reportable equity options, warrants, and certain convertibles (which is why the schema models `putCall`) — of ≥$100M managers; quarter-end snapshots filed up to 45 days late; **no short positions, no cash**; era-dependent units; affiliated-filer overlap.
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

Astro static on Cloudflare Pages, **deployed publisher-side** (no `latest.json` resolution — the dashboard is not a pointer consumer and holds no replay state, which is what closes the ephemeral-build TOFU hole) via `wrangler pages deploy` (direct upload, free tier). The Pages-side build system is unused, so its **20-minute build timeout does not apply**; the free tier's **500 monthly deployments remain a tracked ceiling** (§13.4) — Cloudflare's limits page words it against Git builds and the Direct Upload guide does not explicitly exempt uploads, so at ~70 deploys/month (each nightly is **two uploads** — a preview then a production upload of the same bytes, steps 4–5 below) the >7× headroom is tracked, not assumed away. No backend; localStorage personalization; no browser calls to external APIs (§5.6).

**Canonical `dist_digest` and the file inventory (versioned; `dist_digest_version` = `1`).** A reproducible tree digest so every trust boundary can independently confirm the *same bytes*: enumerate `dist/` regular files only — **symlinks, devices, and any non-regular file fail the build** (a static site has none); for each, take its path relative to `dist/` as UTF-8 with `/` separators; sort ascending bytewise by that path; frame each as `path` `0x00` `decimal(byte-length of contents)` `0x00` `sha256hex(contents)` `0x0a`; `dist_digest = sha256(` the concatenation `)`. File mode is **not** included (static assets don't execute; content changes are caught by the per-file hash); empty directories are irrelevant (no files). Bumping the framing bumps `dist_digest_version`; digests compare only within equal versions. This digest is recomputed and checked at **every** boundary below: at artifact creation, after each independent download, immediately before the preview upload, immediately before the production upload, and independently in the record workflow.

**The same enumeration is published as the `dist` inventory** — the ordered `path → {bytes, sha256}` list, shipped inside the `dist/` workflow artifact and covered by `inventory_digest`. It exists because a digest over the whole tree cannot tell you *which* served file diverged: the record signer fetches **every** inventory path from the deployed site and verifies it file by file (§5.5). Verifying only a few marker files would let a compromised deploy job preserve `build_id`/`code_sha`/`stats.json` while replacing all the HTML and JS.

**Publisher-side deployment protocol (normative — the complete sequence, run identically on every deploy, nightly and manual):**

1. **Pinned inputs.** The site builds in the same workflow run as the data build, from the same `populus` checkout — the run records that code SHA, and the site embeds it in the footer beside `build_id`. Node toolchain pinned: a committed `.node-version`, a committed lockfile with a frozen install (`npm ci`), and Wrangler pinned to an exact version in that lockfile (never `@latest`) — all under §14's SHA-pinning and Dependabot discipline.
2. **Build before publish; count before freeze; stats into the bundle.** Stage the data build → build the site from the staged verified data → **enumerate `dist/` files (hard CI fail at the 15,000 cap; the count is a function of the file *list*, so it is final once the build exists) → write that count into the one `stats.json` in *both* places identically: the canonical staged artifact and `dist/stats.json`** → **assert the two `stats.json` copies are byte-equal** (writing a count into an existing file adds no files, so the enumeration stands) → **compute `dist_digest` over the finished `dist/`** → assemble and hash the manifest over the canonical artifacts → `populus verify` → publish per §5.5 (assets → manifest → pointer). The published immutable `stats.json` and the `stats.json` inside the deployed bundle are therefore the same bytes; the per-deploy gate (step 5) re-checks this against the live site. The built `dist/` is handed forward as an **immutable workflow artifact**; its artifact id and `dist_digest` are exported as **publish-job outputs** (which the record job trusts; the deploy job's copies are not trusted, step 6).
3. **Isolated deploy job.** Deployment is a separate job that runs **only after the publish job succeeds**. It holds **no GitHub write scopes** (no `contents: write`, no `id-token`, no `attestations`) and receives `CLOUDFLARE_API_TOKEN` as step-scoped env on the deploy steps only; the publish job never sees the token. `CLOUDFLARE_ACCOUNT_ID` is a non-secret Actions variable (§14). It **downloads the immutable `dist/` workflow artifact** into a read-only directory and **recomputes `dist_digest`, asserting it equals the publish-job output** (a tampered download aborts here). Before any upload it **asserts production identity via the Cloudflare API** — reads the Pages project and checks that the workflow-locked branch name equals the project's configured `production_branch` (Pages project creation and that configuration are P3 setup items, §17); a mismatch aborts before uploading, because `--branch` selects production only when it matches the project's configured production branch.
4. **Preview upload, verify the preview first.** **Recompute `dist_digest` immediately before uploading** (guards against any mutation since download), then upload the recovered `dist/` to a **non-production preview** deployment (`wrangler pages deploy dist/ --project-name <locked> --branch <preview alias>`), capturing the returned preview deployment ID and URL, then **live-verify the preview URL** (cache-busted fetch; asserts the served page embeds this run's `build_id` + code SHA; asserts served `stats.json` hash equals the manifest-listed artifact). **Production is untouched** — a preview failure aborts here and alerts, production still serving the prior build.
5. **Production upload of the *same bytes*, verify, compensate on failure.** Only after the preview passes: **capture the current live production deployment ID** (the rollback anchor) → **recompute `dist_digest` immediately before the production upload and assert it still equals the value verified on preview** (a file mutated between the two uploads aborts here) → **upload the identical recovered `dist/`** (Cloudflare Direct Upload has no preview→production "promote" operation, so this is a second upload of provably the same bytes, not a provider-side promotion) to the production branch → **live-verify the production custom domain** (same assertions). There is a brief window between the production upload and passing verification during which the domain serves the new build unverified-at-the-edge; the bytes are the same ones already verified on preview, and **any verification failure triggers an automatic Cloudflare rollback to the captured prior production deployment ID, re-verified** to confirm the domain serves the prior `build_id`. (Cloudflare rollback is an explicit API operation, not an automatic consequence of a failed external check — the job performs and verifies it.) A deployment is green only on live production proof, never on wrangler's exit status. **Honest characterization: two uploads of one artifact re-hashed before each upload, preview-verified first, with a compensating production rollback — not a transactional promotion** (the provider offers none).
6. **Record the deployment durably — separate document, separate *workflow*, full served-tree verification.** After production verifies, the publishing workflow calls the **`record-sign.yml` reusable workflow** (`contents: write` + `id-token: write` + `attestations: write`, **no Cloudflare token** — §14), which writes and attests the next append-only generation `builds/<build_id>/deployments/<gen>.json` (§5.5). It trusts **no deploy-job output**: `build_id` comes from the attested published manifest/pointer; `code_sha`, `dist_digest`, and the inventory come from the **immutable artifact it locates via GitHub context and downloads itself**; the production deployment id is read from the **Cloudflare Pages API** and cross-checked against the deploy job's claim. It then **fetches every path in the inventory from that deployment's URL and verifies each file's hash**, confirms the custom domain serves the same deployment, and attests with `verification_scope` recording exactly what it checked. Any mismatch → refuse to attest + alarm. A separate reusable workflow is what makes the signer identity distinct and pinnable (attestations identify workflows, not jobs — §5.5). If no verified record can be produced, it **fails closed** and the next publish is gated (§13.2, §17) until a valid attested generation exists for the live build.

If data publication fails after the site is built, the deploy job never runs — a site embedding an unpublished `build_id` cannot reach the domain. **Cloudflare Pages free-tier limits that do bind: 20,000 files, 25 MiB/file.** Global static-file cap: **15,000 files (75%)** — counting pages *and* deployed data shards — tracked per build in `stats.json` with a hard CI failure at the cap. Deploys: ~2 per nightly (preview + production) + manual — tracked against the 500/mo ceiling (§13.4). Per-module budgets are contract items (M1 ≤4,000 files; M2 ≤1,500 filer pages + aggregate slices; M3 ≤2,000 company pages + ~64 data shards). **Long-tail strategy (bounded):** entities within a module's *published extract* but beyond its pre-rendered page budget are served by a generic client-rendered route that fetches the **same-origin data shards deployed with the build** — no cross-origin fetches, no unversioned paths, coverage exactly equal to what §5.6 says is published. Entities outside the published extract link out to the primary source instead of rendering.

### 12.2 Surfaces

`/congress` (§9.10) → `/institutional` (top-filer pages + ticker-holder views) → `/financials` (curated-universe company pages from the build-time extract) → `/macro` (curated-core dashboard: curve, inflation, labor, positioning). `/methodology` gains a per-module page — sources, conditions-register entries, coverage stats, caveats — the honesty layer as a public artifact and each launch post's anchor. Footer: prohibited-uses notice, attributions, "not financial advice" (§15).

### 12.3 Usage analytics — aggregate, cookieless, no accounts

**Decision.** Populus measures usage **without identifying users** — no login, no accounts, no cookies, no per-user profiles on any free surface (M1–M4). This is both a brand commitment and a scope one. Brand: a transparency-first civic-data tool that quietly profiled its readers would contradict its own methodology page (§10); the same honesty that surfaces the 45-day lag surfaces here as "we don't track you." Scope/cost: identity means PII storage, a load-bearing privacy policy, GDPR/CCPA-class obligations, and the first operated backend — all deliberately deferred to P-Ω with accounts (§16), never taken on merely to *read* public data. Requiring a login to browse public government records would also add exactly the adoption friction the whole reputation play is built to avoid, and — because the primary surface is a local MCP process with no browser (§11.1) — would capture none of the largest audience anyway.

**Two aggregate channels, both $0, both within what the providers already supply — no custom collector, no event pipeline, no stored free-text:**

- **Web (dashboard).** Cookieless, privacy-first web analytics (candidate: **Cloudflare Web Analytics** — native to the Pages host, no cookies, no cross-site identifiers; exact tool + free-tier terms + any consent obligation confirmed at P3, OQ-14). It captures exactly what that class of tool documents: page views and trend, **top page paths, referrers, coarse geography, and device/browser class** — no query strings, no custom events, no per-visitor identity. **Interest is read from resolved page paths, not from raw search.** Because member and ticker pages are their own routes (`/congress/tickers/NVDA`, `/congress/members/<id>`), "what draws attention" falls straight out of top-paths — a search for NVDA that resolves to its page is counted as a page view, so we never collect, transmit, or store the raw query text at all (free-text search can contain names, emails, or sensitive strings; the safest handling is to not capture it). Deliberately **not** claimed: raw queries, custom events, or a cookie-based new-vs-returning metric — none are within a cookieless page-analytics tool, and adding a collector for them would be undeclared infrastructure and a PII surface.
- **MCP (server).** The server runs on users' machines and **must not phone home** — silent telemetry from a local dev tool would violate the trust the project trades on (G15). Adoption is read only from aggregate signals the platforms already publish: **PyPI download events** (from the public PyPI BigQuery `file_downloads` dataset / `pypistats` — download counts, a noisy adoption proxy, *not* installs or unique users), **GitHub Release asset download counts** (snapshot pulls), registry listing views, stars/forks. The reputation metric is a download trend, named honestly as such, and it needs no telemetry.

**Not collected, at all, before P-Ω:** identity, cross-device linkage, per-user history, raw search text, or any behavioral profile tied to a person. Those arrive only with **opt-in** accounts where the user trades identity for a feature (synced watchlist, alerts, API key) — never as a condition of reading public data, and even then login stays optional on the free tier.

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

- **External heartbeat (independent of GitHub — review F12), protocol-conformant:** a launchd job on the Mac mini every 6 h behaves like any other consumer (§5.5): resolve `latest.json` → evaluate the §5.5 pointer state machine against its own durably persisted `(pointer_version, pointer_sha256)` tuple on the mini's disk (**an unchanged current pointer is an idempotent pass — a 6-hour poll cadence against nightly publishes must never alarm on sameness**; a lower version or a same-version/different-bytes equivocation alarms immediately; attestation verified from P2 on, authenticated-API during P1) → authenticate the manifest → fetch the **manifest-listed** `stats.json` artifact → verify its SHA-256 → then evaluate: build age >36 h, freshness lagging the manifest watermarks, or two consecutive fetch/verification failures → Discord alert. It never reads a mutable root path other than `latest.json`, so pointer state and statistics can never mix across builds. It additionally re-checks that the **immutable-releases setting is still enabled** on `populus-data` — via the repository-settings API, which requires the PAT's **Administration: read** scope (inventoried in §14) — and alerts if it ever flips off. From P3 on it also fetches the live dashboard's embedded `build_id` (the site footer publishes it) and alerts on **any site-vs-pointer `build_id` mismatch persisting beyond a 90-minute deploy grace window — in either direction**: a site behind the pointer is a silently failed deploy; a site ahead of it or diverged from it is a rollback that skipped the dashboard, or a deploy from the wrong source (§12.1, §13.5). It **additionally requires a valid, attestation-verified deployment generation (`builds/<live-build_id>/deployments/<gen>.json`, §5.5) whose `cf_production_deployment_id` and `code_sha` match what the live domain serves** — because the record job runs *after* production is already live, a record-job failure would otherwise leave a new build serving with a matching `build_id` and *no* divergence to detect (H2). A live build lacking a valid attested record past the grace window is its own alarm class, and **the next data publish is gated (§17) until the record exists** so the system never accumulates un-recorded live deployments. After an equal-pointer idempotent pass it still proceeds through the manifest and `stats.json` checks — sameness short-circuits nothing but the version branch. **Its own persisted tuple is load-bearing trust state: missing or corrupt ⇒ fail closed** — alert and stay failed until the operator restores the backed-up tuple or pins a trusted floor (§13.5); the monitor never silently re-bootstraps trust. This catches disabled schedules, dropped cron events, GitHub outages, and setting drift — the failure classes an Actions-hosted watchdog shares with the thing it watches. Operational-by-P1 is a gate.
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
| Site build+deploy job time (Actions, §12.1) | >15 min | split/prune extract |
| Pages deployments/month | >400 (of the free tier's 500; ~70/mo expected — preview + production per nightly, §12.1) | reduce manual deploys; confirm direct-upload metering with Cloudflare before relying on more |
| Actions scheduled-run gaps | any missed nightly | external monitor alerts (§13.2); investigate; the daily data commit already keeps schedules active |

### 13.5 Runbooks (shipped in-repo under `docs/runbooks/`)

- **Rollback (signed generation — the only supported procedure):** select the target older `build_id` → mint a **new pointer generation** (`pointer_version` + 1, fresh `issued_at`/`expires_at`, `manifest_sha256` of the older build's manifest) → **attest its exact bytes** (P2+; the P1 staging variant runs the identical sequence minus attestation) → `populus verify --remote` against the new pointer → replace `latest.json` **last** → verify a consumer follows it → **from P3 on: restore the dashboard to the rollback target deterministically** — read and attestation-verify the target `build_id`'s **latest deployment generation** (`builds/<build_id>/deployments/<gen>.json`, §5.5): if its `cf_production_deployment_id` is still present in Cloudflare, roll production back to it directly and live-verify; else recover the exact bytes from `dist_artifact_id` (retained through its deadline), assert they recompute to the recorded `dist_digest`, and re-deploy them through the §12.1 preview-verify-then-production protocol; else (artifact aged out) rebuild from the recorded `code_sha`, assert the rebuilt tree matches `dist_digest`, and deploy that — never "rebuild from the current checkout," which would not reproduce the target if application code caused the incident. **Any re-deploy of an existing build writes a new appended generation** (§5.5) — records are never overwritten, so the original attestation stays intact and the rollback deployment is itself recorded. In every path **live-verify the domain now embeds the target `build_id` + `code_sha`**; a rollback that fixes MCP clients while the public site keeps serving the rejected build is half a rollback, and the §13.2 any-direction divergence alarm pages exactly that state → file the incident issue. Clients experience it as an ordinary higher-version update; a bare repoint of `latest.json` to an old generation is **rejected as replay** by every post-P2 client, which is the point. (Sequence drilled in P1; signed acceptance + replay rejection drilled in P2; the dashboard-inclusive variant drilled in P3 — gates.)
- **Monitor state loss:** the monitor is alerting because its tuple is missing or corrupt (it fails closed, §13.2) → restore the tuple from the mini's backup, or pin a trusted floor (`pointer_version` + `pointer_sha256` from the last known-good publish log) and let the next poll re-verify forward. **Never delete the tuple to clear an alarm.**
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
| Usage analytics | Cloudflare Web Analytics (cookieless) + PyPI/GitHub download stats | 0 |
| Fallback compute + external monitor | Mac mini (owned) | 0 |
| Domain | registrar | ~1 |
| **Total** | | **≈$1/mo** |

Any new cost is flagged before it enters the tree (G8). One metering note: while `populus-data` is private staging (P1), Actions minutes are metered — 2,000 free/mo against an estimated <300 used; the flip to public (P2) restores unmetered. If P1 ever approaches the cap, the nightly moves to the Mac mini for the staging period at $0.

---

## 14. Security & supply chain *(new; review F14)*

- **Workflow least privilege — three jobs, disjoint privilege (§12.1).** Every workflow declares an explicit `permissions:` block; default `contents: read`. The **publish job** gets `contents: write` (only in `populus-data`) plus — from the P2 flip on — `id-token: write` + `attestations: write` (attestation scopes, §5.5); **no Cloudflare token**. The **deploy job** gets **only** `CLOUDFLARE_API_TOKEN` (step-scoped) and **no GitHub write scopes**. The **record signer** is a **separate reusable workflow** (`record-sign.yml`, §5.5) with `contents: write` + `id-token: write` + `attestations: write` and **no Cloudflare token** — separate because GitHub attestations identify a *workflow*, not a job, so only a distinct workflow gives the record a pinnable signer identity. Three invariants, stated precisely: (a) **no single job holds both the Cloudflare token and GitHub-write**; (b) the record signer **derives every attested field from sources the deploy job cannot influence** — the attested manifest, the immutable artifact it downloads itself via GitHub context, the Cloudflare API, and the served bytes — never from job outputs (`needs.<job>.outputs` is ordinary workflow data, *not* signed, and the document no longer claims otherwise); (c) it **verifies the whole served tree against the published inventory**, not just marker files. Consequence: a compromised deploy job can deface the live dashboard for as long as it takes the signer to catch it (residual TD-8) but **cannot obtain an attested record that pairs a clean digest with an altered deployment** — the file-by-file check fails and nothing is signed.
- **Untrusted-PR isolation.** PR-triggered jobs run without secrets; `pull_request_target` is banned; publish jobs trigger only on `schedule`/`workflow_dispatch` from the default branch.
- **Action pinning.** All third-party Actions pinned to full commit SHAs; Dependabot watches the pins.
- **Branch protection + CODEOWNERS** on both repos, mandatory review for: `parse/` (parsers), `member_aliases`, identity registries, `licenses.json` and the conditions register, and `.github/workflows/`.
- **Dependencies.** `uv.lock` with hashes; CI dependency audit (vulnerabilities + license check) — which also implements guardrail G1's paid-vendor denylist.
- **Artifact integrity — verified chain, not trust-by-location.** GitHub **immutable releases enabled** on `populus-data` (explicit repo setting; checked here and re-checked by the external monitor); from the P2 flip on, the publish workflow generates **GitHub artifact attestations** for **each `latest.json` pointer generation, the manifest, and every asset** (attestations are public-repo-only on the Free plan — the private P1 staging boundary is the repo ACL, §5.5). **Clients verify the full chain pointer → manifest → artifacts:** the pointer through the §5.5 state machine (attestation with pinned certificate identity and OIDC issuer, monotonic version + digest idempotency, expiry), the manifest against the pointer's `manifest_sha256` plus its own attestation, artifacts against the manifest's SHA-256s. **No unsigned client mode exists.** Branch protection guards the repo but is not the root of trust — the attestation chain is.
- **Secrets inventory (exactly three, reviewed quarterly):** Discord webhook URL (alerting); a Cloudflare API token whose `Cloudflare Pages Edit` permission is **account-scoped — it can create, edit, and delete every Pages project in its account; Cloudflare offers no per-project token scope** — which is why it lives in a **dedicated Cloudflare account containing only the Populus dashboard project** (free tier): the account-wide permission's blast radius equals the one project by construction. Exposed only to the §12.1 deploy job's single deploy step; rotated on any suspicion; `CLOUDFLARE_ACCOUNT_ID` is a non-secret Actions variable and the project name is locked in the workflow file. Third: one fine-grained PAT for the Mac mini — `populus-data`: **Contents read/write** (fallback publishing; read needed while the repo is private staging) **plus Administration: read, permanently** — the immutable-releases settings endpoint requires it, and the monitor's setting-drift check (§13.2) runs forever, not just during staging. Stored in macOS Keychain on the mini, never in dotfiles; Contents-read necessity lapses at the P2 flip, Administration-read does not.
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
- Hash-verification fixture: a consumer detects and rejects an artifact whose bytes don't match the manifest (attestation drills belong to P2 — attestations are unavailable on the private Free-plan staging repo, §5.5).
- Logical-digest reproducibility: two independent builds from the same raw archive produce identical `logical_digest`s under the pinned projection version.
- E-filed parse coverage ≥97%; member-join ≥98%; golden corpus (≥30 fixtures incl. bond/exchange/multi-page) green in CI.
- kadoa acceptance sampling per §9.6: simple-random n=150 population sample (0 critical errors) plus the §9.6 coverage quotas; cosmetic ≤5%.
- Completeness reconciliation: every DocID/UUID in the sources' indexes for the covered window is present with exactly one `parse_status` — counted, zero unaccounted.
- Freshness <24 h vs. House index Last-Modified.
- **Drills passed:** rollback via the §13.5 signed-generation sequence (staging variant, unattested: mint higher-version pointer targeting the older build → verify → replace last → consumer follows) · disaster recovery (raw → rebuilt DB ≤2 h, row counts plus logical digests reconcile with the manifest) · publish-conflict (concurrent dispatch serializes, no torn build).
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
- Counsel entry-gate record on file; **cutover executed in order and verified in the phase log: repo public → fresh attested build including the first attested pointer generation → `populus verify --remote` green → client shipped** (§5.5; pre-cutover staging builds are acknowledged visible history, trusted by no supported client).
- Pointer/attestation drill (fixture tests, CI-retained): the shipped client **rejects** (a) a tampered artifact, (b) a manifest attested by a different workflow identity, (c) a replayed older attested pointer (lower-version fixture), and (d) a same-version pointer with different bytes (equivocation fixture — also alarms); and **accepts** (e) an unchanged current pointer idempotently on repeated fetch (no state change, no alarm) and (f) an **authorized signed rollback** — a higher-version attested generation targeting an older `build_id` — the positive case; plus the universal-check fixtures: (g) an **equal-but-expired** pointer fails the refresh — stale status reported, last verified build keeps serving (expiry precedes the version branch); (h) a **future-issued** pointer is rejected; (i) **state-loss bootstrap** — with the persisted tuple deleted or corrupted, the client accepts only an unexpired attested pointer (the reopened TD-7 window, expiry-bounded), and the monitor variant instead fails closed and alerts (§13.2).
- Launch post published.

**P3 — Dashboard (M1).** Scope: §9.10 + `/methodology`; Cloudflare Pages project created and its `production_branch` configured (§12.1 step 3); nightly rebuild via the §12.1 deployment protocol; localStorage follows. Gates: live on the domain; **per-deploy live verification green across ≥3 consecutive nightly deploys** (preview-then-production two-upload sequence, §12.1 steps 4–5: cache-busted fetch asserts embedded `build_id` + code SHA and that served `stats.json` hash equals the manifest artifact — every nightly proven, not just the first); **production-branch assertion fixture** — a deploy with a mismatched project `production_branch` aborts before upload; **deploy-failure + record-integrity fixtures** — (a) a preview that fails verification leaves production untouched; (b) a production-upload that fails post-upload verification triggers the compensating Cloudflare rollback to the captured prior deployment ID and re-verifies the restored `build_id`; (c) **a file mutated between the preview and production uploads aborts the production upload** (the immediately-before-upload `dist_digest` recompute, H1); (d) **the record signer rejects tampered deploy-job claims** — a falsified `dist_digest` or a `cf_production_deployment_id` whose URL serves the wrong `build_id`/`code_sha` fails independent verification and is not attested; (e) **a record-signer failure raises the "live build lacks an attested deployment generation" alarm and gates the next publish**; (f) **marker-preserving tamper fixture** — a deployment in which `build_id`, `code_sha`, and `stats.json` are all correct but an HTML page and a JS asset are altered is **caught by the file-by-file inventory check and not attested** (round-10 C1); (g) verification runs at `scope: "full"` with `files_verified == files_total` across ≥3 consecutive nightlies (a `partial` scope in normal operation is a gate failure); `deployment` generation written + attestation-verifiable **against the pinned `record-sign.yml` signer identity** (distinct from `publish.yml`); `stats.json` byte-equality (canonical vs `dist/` vs live) holds; Lighthouse ≥90 (performance + accessibility) on feed, one member page, one ticker page; every rendered claim traceable to `doc_url` (spot-audit: 25 random rendered rows, 100% link-resolve); static file count within budget, **reported from the §12.1 pre-publication `dist/` count in `stats.json`**; **usage analytics live and verified privacy-clean** (§12.3 — a network trace of a page load shows no cookies and no cross-site identifiers, **no raw search text is transmitted or stored**, and OQ-14's consent-obligation determination for the chosen tool is on file); **dashboard-inclusive rollback drill** — the §13.5 sequence executed end to end from the target build's latest attested deployment generation with the domain live-verified on the rollback target (and the rollback recorded as a new appended generation), plus the §13.2 any-direction divergence alarm demonstrated against an artificially skewed deploy; second post published.

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
| Aggregate federated load draws agency ire | L×M | §11.4 conservative defaults, truthful application UA + operator contact, bulk-first; degrade-or-disable response (G6) |
| Legal challenge to posture | L×H | Conservative posture; counsel gate; notices everywhere |
| Copycat forks (MIT) | H×L | Accepted; freshness, honesty record, and registry position don't fork |
| Single-maintainer bus factor | H×M | Everything reproducible from public repos + raw archives (drilled); three inventoried secrets; runbooks in-repo; CONTRIBUTING day one |

### 18.1 Declared tech debt (known compromises, on the record)

Open questions are unknowns; these are *known* compromises accepted deliberately:

1. **Duplicate-row identity inherits source-coordinate stability** (§9.4): identical same-filing rows can renumber if a reparse finds a new identical duplicate earlier in the document. Accepted — the source provides no stronger identity; confined to same-filing duplicates and resolved atomically.
2. **Member identity is name-based at the root** (§9.7): the temporal alias table constrains it, but a same-name/same-state/same-era collision would still need a human decision. Accepted with the version-controlled alias process as the control.
3. **Client attestation verification cost is unmeasured** (§5.5): `sigstore-python` is the planned verifier and its weight in a `uvx` cold start is unknown until P2. **All resolution options are verified implementations** — e.g., offline bundle verification against Sigstore's published trusted root instead of online calls; there is no unsigned fallback, and a client that cannot verify serves only its last verified build. The debt is the unmeasured cost, not the trust requirement.
4. **`transactions.bioguide_id` is denormalized** (§9.4) for query speed; guarded by a CI invariant test (must equal its filing's), not by normalization.
5. **Hosted HTTP transport is deferred with a written acceptance checklist** (§11.6) rather than designed now. The checklist is the control; the debt is that it is unexercised.
6. **kadoa-sourced history remains in the store until progressively re-parsed** (§9.6): audited seed data with provenance, but still third-party parser output, visible in the public `source` mix until replacement completes.
7. **Pointer trust bootstraps on TOFU whenever no persisted tuple exists — MCP clients** (§5.5): on a client's very first run AND after any loss of its persisted state (cache wipe, reinstall, disk loss, detected corruption), there is no `(pointer_version, pointer_sha256)` baseline, so a replayed older-but-attested, unexpired pointer would be accepted once; the tuple closes the window only while it exists. Bounded on every such bootstrap by the universal checks — an expired or future-issued pointer is never accepted, with or without state — so exposure is ≤7 days of staleness per state-loss event. **The other consumers do not share this window:** the external monitor **fails closed on missing or corrupt state** — it alerts until the operator restores its backed-up tuple or pins a trusted floor (§13.2, §13.5), never silently re-bootstrapping — and the dashboard is not a pointer consumer at all (§12.1). Shipping a pinned floor version in each client release would shrink every bootstrap window and is noted as a P2 implementation option.
8. **The deploy job runs a second toolchain against a production credential** (§12.1): Node/Astro/Wrangler execute with the Cloudflare token in scope. Bounded by: the committed lockfile + frozen install, the exact Wrangler pin, SHA-pinned actions, the job split (no GitHub write scopes co-resident with the token), the dedicated Cloudflare account (§14), preview-first verification, the compensating production rollback, and — critically — the record signer's **independent, full served-tree** verification against the published inventory, which means this residual **cannot forge a deployment record** (a marker-preserving alteration of HTML/JS/CSS now fails the file-by-file check) and is bounded to defacement that is *detected and unsigned*, not silently blessed. Three residuals, all accepted and reviewed with §14's quarterly secret review, all worst-casing at dashboard defacement never data-artifact tampering (artifacts stay attestation-verified end to end): an npm-ecosystem compromise inside the deploy job; a **preview-window exposure** — the preview deployment is publicly reachable at its alias URL between the preview upload and the production upload, so a defaced preview is briefly fetchable by anyone with the alias (not the custom domain, not linked, but not secret); and a **production-verification window** — because Cloudflare Direct Upload has no preview→production promote and no atomic swap, the production upload goes live before its own post-upload verification completes, so the custom domain briefly serves the new build unverified-at-the-edge (the bytes are the same ones already verified on preview; a verification failure triggers the compensating rollback, §12.1 step 5).
9. **Dashboard deployment records are retention-bound** (§5.5 deployment generations, §12.1 step 6): reproducible rollback depends on the `dist` workflow artifact existing until `dist_artifact_expires_at`, which CI sets ≥ the supported rollback window. If an artifact is deleted early (manual purge, policy change) the fallback is deterministic rebuild from `code_sha` against `dist_digest` — sound unless the recorded toolchain itself has drifted out of availability. Bounded by pinning the Node toolchain in-repo (`.node-version` + lockfile) so the rebuild inputs are versioned; the residual is an aged-out artifact *and* an unreconstructable toolchain simultaneously, accepted for builds past the rollback window.
10. **Served-tree verification is point-in-time, and `partial` scope is a real (if gated) mode** (§5.5): a `scope: full` record certifies the served bytes matched the inventory *at `verified_at`* — it says nothing about later minutes, which is why the §13.2 monitor keeps checking the live build independently and any re-deploy writes a new generation. If a tree ever exceeds the verification budget or fetches fail past retry, the signer degrades to `verification_scope: "partial"` (executable assets + entry pages + random sample) and **attests that scope honestly** rather than overstating; partial mode raises an alarm, and the unsampled-content residual it implies is the accepted debt. At the CI-enforced page budgets (M1 ≤4,000; global cap 15,000) full mode is the expected path and partial should never fire in normal operation.

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
15. **G15 — No identified user tracking; no silent telemetry; no login wall on free surfaces.** Analytics are aggregate and cookieless (§12.3); the MCP server never transmits usage from a user's machine; no M1–M4 read surface may require login or collect identity. A login requirement to read public data, any client→home telemetry, or any per-user profile before opt-in P-Ω accounts is a defect.

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
| OQ-14 | Confirm the cookieless web-analytics tool + free-tier terms (Cloudflare Web Analytics vs. self-hosted Plausible/Umami); confirm no consent-banner obligation for the chosen tool (§12.3) | P3 entry |

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

*End of ARCHITECTURE.md v2.11 — draft for owner review; supersedes all earlier versions (v2.1 = `f7985f6`, v2.2 = `5a665ce`, v2.3 = `cfdb972`, v2.4 = `1618fec`, v2.5 = `c85250b`, v2.6 = `a7dee2f`, v2.7 = `3784b25`, v2.8 = `b2ed2ea`, v2.9 = `0f44bec`, v2.10 = `5010258`). Finding dispositions for all review rounds: [REVIEW-RESPONSE.md](REVIEW-RESPONSE.md). No implementation begins until this document is approved (P0 gate).*
