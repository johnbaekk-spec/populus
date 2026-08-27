# M2 — Institutional holdings (13F): phase-entry module contract (§7)

**Status:** phase-entry gate for Module 2. `ARCHITECTURE.md` is the source of truth
(§5.4 registries, §5.6 consumer matrix, §10.2 M2 outline, §11.4 federated client,
§15 conditions register, §17 gates). This one-pager finalizes the §10.2 outline with
**fresh live source verification (2026-07-24)** per §7/§10, and decomposes M2 into
four orchestrated build-runs. G12 holds: M1 gates are green (all 6 runs merged,
936 tests, integration-verified), so M2 may start.

---

## 1. Sources — verified live end-to-end (2026-07-24)

All verified today with a real record pulled end-to-end. Cached under
`data-cache/inst/` (gitignored) for hermetic dev/test.

| Source | Endpoint | Result (2026-07-24) |
|---|---|---|
| Ticker→CIK bootstrap | `https://www.sec.gov/files/company_tickers.json` | 200, ~10k entries (`{cik_str,ticker,title}`) |
| Filer filing history | `https://data.sec.gov/submissions/CIK##########.json` | 200; lists `13F-HR`, `13F-HR/A` with accession, filingDate, reportDate, primaryDocument |
| Filing index | `https://www.sec.gov/Archives/edgar/data/<cik>/<accn_nodash>/index.json` | 200; **info-table XML filename is variable/numeric** (observed `53405.xml`, `50240.xml`) — must be discovered from the index, never hardcoded |
| Cover page | `.../primary_doc.xml` | `submissionType, periodOfReport` (MM-DD-YYYY), `isAmendment, amendmentType, amendmentNo, filingManager.name, form13FFileNumber, reportType, tableEntryTotal, tableValueTotal, isConfidentialOmitted, confDeniedExpired, otherIncludedManagersCount` |
| Information table | `.../<infotable>.xml` | per holding: `nameOfIssuer, titleOfClass, cusip, value, shrsOrPrnAmt{sshPrnamt, sshPrnamtType}, putCall?, investmentDiscretion, otherManager, votingAuthority{Sole,Shared,None}` |
| CUSIP↔symbol bootstrap (OQ-8) | SEC fails-to-deliver: `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data` → `.../files/data/fails-deliver-data/cnsfails<YYYYMM>[ab].zip` | page 200; monthly zip serves 206 on range GET (CUSIP + symbol + issuer-name pairs, primary SEC data) |
| Cross-sectional bulk (secondary) | `https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets` | 200 (the old `/dera/data/form-13f` now 301-redirects here) |

**Verified records (real, cached):**
- Berkshire Hathaway (CIK 1067983) `13F-HR` accession `0001193125-26-226661`, period **2026-03-31**, 90 positions, `tableValueTotal` 263,095,703,570, `otherIncludedManagersCount` 14.
- Berkshire `13F-HR` `0001193125-26-054580`, period **2025-12-31**, 110 positions, 274,160,086,701 (prior quarter → real QoQ delta for aggregates).
- Berkshire `13F-HR/A` `0000950123-25-008361`, period 2025-03-31, `amendmentType=NEW HOLDINGS`, `confDeniedExpired=true` — the real confidential-treatment-expiry → NEW-HOLDINGS-merge case.

**Unit basis confirmed arithmetically:** ALLY row value 498,992,850 ÷ 12,719,675 sh = **$39.23/sh** ⇒ **whole-dollars** regime (post-2023 form). Matches §10.2.

### ⚠ Two corrections to carry into the build (verified discrepancies)

1. **SEC User-Agent format.** SEC's WAF returns **403 "Request Rate Threshold Exceeded"** to the parenthesized UA the architecture writes for M1 (`PopulusBot/<ver> (+https://…; contact: …)`). SEC's **recommended `<name> <email>` format** (e.g. `Populus johnbaekk@gmail.com`) returns 200. The §11.4 federated client **must** send an SEC-accepted UA (truthful, identifiable: app name + monitored contact) and **must not** send the parenthesized form to `*.sec.gov`. This is not evasion (G6) — it is using the exact identifiable format the agency asks for. Isolated test: parenthesized UA → 403; `<name> <email>` UA → 200 (encoding held constant). Send `Accept-Encoding: gzip, deflate` as well.
2. **Datasets page moved.** `/dera/data/form-13f` → 301 → `/data-research/sec-markets-data/form-13f-data-sets`. Only relevant to the secondary bulk source; the primary per-filer chain above is unaffected.

## 2. Conditions register entries (§15, G11 — precede ingestion)

New `licenses.json` / register entries, written **before** any M2 ingest:
- `sec-edgar` — SEC EDGAR (submissions API, `Archives/`, `company_tickers.json`): US-government work, public domain; fair-access UA + rate policy recorded; no attribution legally required but source URL retained per record (§5.1).
- `sec-ftd` — SEC fails-to-deliver data: US-government work; used only to seed `security_identifiers` (CUSIP↔symbol) with per-row provenance + review state.
Each passes the §2.2 admission test (primary, free, redistributable, adds cross-entity value). Recorded in §15's register with determination basis + date + review-by.

## 3. Consumer-access matrix (§5.6, DR-10) + size table

| Dataset | Pipeline | MCP | Dashboard (P3, declared only) |
|---|---|---|---|
| M2 13F cross-filer aggregates (filer registry, QoQ deltas, top-holders, concentration) | R → `inst_agg.db` | snapshot | build-time slices, top filers ≤1,500 pages |
| ~~M2 13F per-filer holdings detail~~ | ~~—~~ | ~~**F** (EDGAR live via §11.4 client)~~ | ~~not served — link out to EDGAR~~ |
| **M2 13F per-filer holdings detail** *(amended 2026-08-01)* | **R** → serving projection | **snapshot** (published) + **F** (live, scoped per §3.1) | **served** — full position list, bucketed shards in the Pages bundle |
| Identity registries (`entities/securities/*_identifiers/entity_tickers`) | R (substrate) | (internal join) | — |

~~Size: `inst_agg.db` snapshot bounded to aggregates (not the full holdings universe); per-filer detail is federated (zero Populus storage of the long tail). Registry tables are small (≤ low-MB). No new always-on infra ($0/mo holds; DR-8 federate-live for the tail).~~

**Size *(amended 2026-08-01)*:** `inst_agg.db` snapshot bounded to aggregates.
Per-filer detail is **replicated**: a canonical audit store (~950 B/row measured —
per-row §5.1 provenance + `raw_row`, ops-local, **never published**, reconstructible
from archived raw XML) and a derived **serving projection** (≤90 B/row target,
published as bucketed JSON shards inside the Pages bundle, **current period and
the immediately prior period** — owner decision OD-5, 2026-08-02, so a reader can
inspect what was added and removed behind any displayed change; both periods share
one bucket file, so this costs bytes, not files).
Registry tables remain small (≤ low-MB). **No new always-on infra — $0/mo still
holds**; the constraint that binds is the §12.1 static-file cap, not storage
(worst case, including M3's committed reservation, metadata and a hard-capped
spill list: **bucketed = 13,224 files vs the 15,000 cap**, 1,776 headroom;
per-entity sharding would be ~21,251 and breach both that cap and Cloudflare's
20,000 limit).

### 3.1 Retained federated boundary *(normative, added 2026-08-01)*

Live EDGAR via the §11.4 client remains the path for exactly two cases, and must be
asserted on both sides in tests:

1. **Filings newer than the published build** — answered live, flagged as
   post-snapshot.
2. **Filers outside the published universe.** OD-2 (2026-08-02) locks a **no-cutoff**
   universe, so this set is empty by construction for any discovered period. Retained
   only for a filer appearing in EDGAR after discovery ran, or a period not yet
   ingested — never a value-ranked cutoff.

> **Reversal notice.** The struck row above was the original Pattern-F treatment
> (introduced `db8adc2`, per `ARCHITECTURE.md` DR-8). It is reversed by owner
> decision 2026-08-01. DR-8 itself is **not** overturned — it assigns "cross-entity
> aggregation products" to Pattern R, and per-filer holdings are the inseparable
> substrate of three such products (all-holders-of-issuer, cross-filer activity,
> outsized-vs-own-history) that no per-entity API can answer. Full rationale,
> measurements, retained properties, and residual risk:
> [`holdings-publication.md`](../decisions/holdings-publication.md).
> (The build plan that executed the reversal, `RUN-M2-8-plan.md`, is completed
> process history and lives in Git history.)
>
> **Parameters locked by the owner 2026-08-02** (superseding this amendment's
> earlier "four owner decisions still open" note): **OD-1** backfill via the
> primary per-filer EDGAR walk — SEC bulk datasets are *not* adopted as a source;
> **OD-2** every eligible filer, discovered independently per period (no cutoff);
> **OD-3** outsized-flag thresholds `MIN_BASELINE_PERIODS=4`, `MULT=150`,
> `FLOOR_BPS=500`; **OD-4** ops storage ceiling **40 GB** (raised from 20 GB on 2026-08-02 after
> measurement) covering canonical store and raw archives, with **K = 6 periods**
> measuring ~32 GB; **OD-5** the current *and prior*
> period are browsable. OQ-9's source half is closed by OD-1; its
> archival-for-reproducibility half remains open.

## 4. Schema (canonical tables; raw/normalized twins; §5.4 + §9.4 idioms)

**Identity substrate (new; §5.4 — shared, M3 reuses):**
- `entities(entity_id PK, cik UNIQUE, …)` + `entity_names(entity_id, name, valid_from, valid_to, source)` — CIK-anchored, dated names.
- `securities(security_id PK, class, …)` surrogate-keyed.
- `security_identifiers(security_id, id_type ∈ {cusip,…}, value, valid_from, valid_to, provenance, confidence, review_state)`.
- `entity_tickers(entity_id, ticker, valid_from, valid_to, provenance, confidence, review_state)`.
- As-of resolution helpers; **G14: no CUSIP→current-ticker→CIK time-travel**; unmapped ⇒ name-only + flag, never dropped/guessed.

**M2 data (new):**
- `inst_filers(cik, name_raw, form13f_file_number, …)` — 13F managers.
- `inst_filings(filing_id PK, cik, accession UNIQUE, submission_type, period_of_report, filed_date, form_version, unit_basis ∈ {thousands,whole}, is_amendment, amendment_type ∈ {RESTATEMENT,NEW_HOLDINGS,NULL}, amendment_no, is_confidential_omitted, conf_denied_expired, other_managers JSON, table_entry_total, table_value_total, raw_path, response_hash, parse_status, lifecycle, source, ingested_at)`.
- `inst_holdings(holding_id PK, filing_id FK, security_id?, cusip_raw, issuer_name_raw, title_of_class, value_raw, value_usd, ssh_prnamt, ssh_prnamt_type, put_call, investment_discretion, other_manager, voting_sole, voting_shared, voting_none, flags, raw_row JSON)`.
- Lifecycle/supersede model reuses M1 idioms; a `v_default_holdings` view (analogous to `v_default_transactions`) applies restatement-supersede + new-holdings-merge + affiliated-filer de-dup.

## 5. Structural caveat (`data_note`, §5.2/§9.8 idiom, non-removable — G4/G10)

> 13F reports cover **long positions in Section 13(f) securities** (US exchange-traded
> equities plus reportable options, warrants, certain convertibles) held by managers
> with ≥$100M in such securities. **No short positions, no cash, no non-13(f) assets.**
> Positions are **quarter-end snapshots filed up to 45 days late** — not current
> holdings. Values are the manager's stated market value at quarter-end (**era-dependent
> units**: whole dollars for form versions effective 2023-01-03+, thousands before).
> Affiliated managers may report the same position (`otherManager`), and confidential
> positions may be omitted until a later amendment. These are disclosures, not
> investment advice.

## 6. MCP tools (≤5, analyst questions, DR-9 budget; §11.2/§11.3 envelope)

1. `inst_filer_lookup(query)` — name/CIK → canonical filer(s).
2. `inst_filer_holdings(cik, period?, mode='snapshot'|'qoq')` — a filer's holdings for a period, with QoQ deltas; ~~**F** for arbitrary/latest per-filer detail (live EDGAR via §11.4), snapshot for published aggregates.~~ ***Amended 2026-08-01 (§3.1):*** **snapshot** serves published per-filer detail and aggregates for the published universe; **F** (live EDGAR via §11.4) is scoped to post-build filings and off-universe filers.
3. `inst_ticker_holders(ticker, period?)` — which 13F filers hold an issuer (CUSIP→security→as-of ticker), ranked by value.
4. `inst_biggest_moves(period?, side='new'|'add'|'trim'|'exit', limit=50)` — largest QoQ position changes across filers.
5. `inst_health()` — coverage (filings parsed, value-coverage % of CUSIPs resolved), freshness, unit-regime mix, caveats.

`populus_health` gains the `inst` module. Value coverage gate ≥95% by reported value.

## 7. Dashboard surfaces + page budget

Deferred to P3 (declared, not built this module): `/institutional` filer/issuer slices,
top filers ≤1,500 static pages against the global cap (§12.1), long tail client-rendered
from published aggregate JSON. No browser calls to SEC (G7).

## 8. Gates (numbers / named fixtures / drills — §17 policy)

- **Value coverage ≥95%** of reported 13F value has a resolved security identity (as-of period); unresolved surface by issuer name + flag (never dropped — G3).
- **Unit basis:** golden fixtures prove whole-dollar (Berkshire 2026-Q1, real) and thousands (crafted pre-2023) normalize to identical `value_usd` semantics; a filing's `unit_basis` is keyed on form version/filed date, not report period.
- **Amendments:** golden fixtures prove RESTATEMENT supersedes and NEW HOLDINGS merges; the real Berkshire NEW-HOLDINGS/`confDeniedExpired` amendment round-trips through the merge path; no double-count across affiliated filers (`otherManager`).
- **Reproducibility:** two independent builds of the same cached inputs yield identical `inst` logical digest (extends the §5.5 two-build gate to the inst module).
- **Federated client:** politeness floors in code (≤2 req/s SEC), SEC-accepted UA, ETag cache, backoff, circuit breaker — unit-tested with an injectable transport; **no live network in tests**.
- `uv run pytest -q` green (whole repo); `scripts/maintenance/dependency_guard.py` clean (G1); end-to-end cache-mode ingest → build → publish → verify on real cached filings.

---

## Run decomposition (dependency-ordered; one orchestrate invocation each)

- **RUN M2-1** — identity registries (§5.4) + conservative SEC federated client (§11.4, corrected UA) + conditions-register entries (§15). Shared substrate; no 13F data yet.
- **RUN M2-2** — 13F ingest/parse/normalize: submissions→index→cover+infotable; `unit_basis`; typed amendments + confidential-treatment merge; affiliated-filer de-dup; identity resolution; golden fixtures (real + crafted edge cases).
- **RUN M2-3** — cross-filer aggregates → `inst_agg.db`; multi-module build/publish/verify integration (generalize `build.py`, admit `inst` in `manifest.py`); inst logical digest.
- **RUN M2-4** — 5 `inst_*` MCP tools (snapshot aggregates + federated per-filer detail) + M2 envelope/`data_note`/`license_notices` + `populus_health` inst module + golden Q&A corpus.

Each run: Opus doer (`CLAUDE_MODEL=claude-opus-4-8`, no Fable), Codex sol reviewer, full
plan→review→dev→QA→review loop, merged before the next (G12).
