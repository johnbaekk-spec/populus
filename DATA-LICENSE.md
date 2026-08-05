<!-- GENERATED FILE — do not edit by hand. Source of truth: src/populus/licenses.json; regenerate with `python scripts/render_licenses.py`. -->

# Populus data conditions register (DATA-LICENSE)

Populus **code** is MIT-licensed (see [LICENSE](LICENSE)). Populus **data** is not one license: every source enters through this conditions register (ARCHITECTURE.md §15), which records what each source permits, what it restricts, and which notices must travel with the data. "Public record" is never treated as synonymous with "public domain". No source is ingested before its entry exists (G11).

Register version: `licenses-1.1.0`.

## `us-congress-disclosures` — House Clerk financial disclosures; Senate eFD

- **Instrument:** Public records under the Ethics in Government Act as amended by the STOCK Act; statutory conditions at 5 U.S.C. §13107(c).
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Free public dissemination with provenance (the news/communications-media dissemination posture)
  - Research and analysis over the disclosed records
  - Redistribution with this register's notices attached
- **Restrictions:**
  - Not treated as unrestricted public domain
  - All 5 U.S.C. §13107(c)(1) prohibited uses (see required notices)
  - Notices are non-removable from consumer output
- **Required notices (verbatim):**
  > 5 U.S.C. §13107(c)(1): It shall be unlawful for any person to obtain or use a report— (A) for any unlawful purpose; (B) for any commercial purpose, other than by news and communications media for dissemination to the general public; (C) for determining or establishing the credit rating of any individual; or (D) for use, directly or indirectly, in the solicitation of money for any political, charitable, or other purpose.
- **Attribution:** Source: U.S. House of Representatives Office of the Clerk; U.S. Senate Office of Public Records (eFD).
- **Determination basis:** Public records regime under the Ethics in Government Act / STOCK Act. Populus's posture — free public dissemination, open source, data never sold — is designed to sit inside the §13107(c)(1)(B) media-dissemination exception and matches incumbent practice; 'free product' is not itself a legal determination — counsel review is the P2-entry gate and precedes the first public data artifact.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `us-govworks-sec` — SEC EDGAR / data.sec.gov

- **Instrument:** 17 U.S.C. §105 (works of the US Government) for SEC compilations and site content; public filings redistributed as public records with source URLs.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Redistribution of filing data and documents with source URLs
  - Research and analysis
- **Restrictions:**
  - SEC fair-access conditions (rate limits, identifying User-Agent) encoded in every client
  - §105 does not automatically cover every third-party filing hosted on EDGAR
- **Attribution:** Source: U.S. Securities and Exchange Commission (EDGAR / data.sec.gov).
- **Determination basis:** Facts and figures are not copyrightable; EDGAR's decades-long public-dissemination regime is the operative access framework; fair-access rules are conditions we encode, not barriers to redistribution.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `sec-edgar` — SEC EDGAR endpoints: data.sec.gov/submissions, www.sec.gov/Archives, www.sec.gov/files/company_tickers.json

- **Instrument:** 17 U.S.C. §105 (works of the US Government) for SEC compilations and site content, accessed under SEC's published fair-access conditions; an endpoint-level determination under the §15.2 us-govworks-sec umbrella.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Automated retrieval at or below SEC's published request-rate ceiling with an identifying User-Agent
  - Redistribution of filing data and derived aggregates with the source URL retained per record (§5.1)
  - Research and analysis
- **Restrictions:**
  - Every request carries the SEC-accepted '<app name> <contact email>' User-Agent and 'Accept-Encoding: gzip, deflate' — verified 2026-07-24: the parenthesized 'PopulusBot/<version> (+url; contact: …)' form receives 403 'Request Rate Threshold Exceeded' from SEC's WAF, the '<name> <email>' form receives 200 (encoding held constant). The parenthesized form is never sent to any *.sec.gov host.
  - Request-rate floor of at most 2 requests/second is enforced in code, never in configuration (G6)
  - No User-Agent rotation, no source-address rotation, no retry storm: sustained 403 latches a circuit breaker that stops the job
  - §105 does not automatically cover every third-party document hosted on EDGAR; per-document conditions still govern
  - Per-filer holdings detail is replicated into an ops-local canonical store and served as a derived projection; it is NOT federated-only (amended 2026-08-02, M2-CONTRACT §3/§3.1). Live federation is retained only for filings newer than the published build and periods not yet ingested
- **Attribution:** Source: U.S. Securities and Exchange Commission (EDGAR / data.sec.gov), retrieved per-record with the source URL retained.
- **Determination basis:** Works of the US Government are not subject to domestic copyright (17 U.S.C. §105), and facts and figures in filings are not copyrightable. SEC publishes fair-access conditions (rate ceiling, identifying User-Agent) as access conditions, not redistribution restrictions; Populus encodes them in the client. Endpoints verified live end-to-end on 2026-07-24 (M2-CONTRACT §1), including the User-Agent correction recorded above.
- **Determined:** 2026-07-24 · **Review by:** 2026-10-24

## `sec-ftd` — SEC fails-to-deliver data (cnsfails<YYYYMM>[ab].zip)

- **Instrument:** 17 U.S.C. §105 (works of the US Government): an SEC-compiled market-data publication; an endpoint-level determination under the §15.2 us-govworks-sec umbrella.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Seeding security_identifiers (CUSIP) and the CUSIP<->symbol/issuer-name association, with per-row provenance and review state
  - Redistribution of a provenance-recorded verbatim excerpt as a repository test fixture, with the source URL, retrieval date and archive sha256 recorded alongside it
  - Research and analysis
- **Restrictions:**
  - Identifier seeding only: fails-to-deliver quantities and prices are not republished as a market-data product
  - Rows are point-in-time settlement-date observations — validity is never inferred across a gap between observed dates (G14); identifier validity intervals merge only calendar-adjacent observations
  - Every seeded row keeps provenance 'sec-ftd' and an explicit review_state; unresolved or disputed identifiers surface by issuer name with a flag, never dropped (G3)
  - Retrieved under the same sec-edgar fair-access conditions (SEC-accepted User-Agent, in-code rate floor)
- **Attribution:** Source: U.S. Securities and Exchange Commission, fails-to-deliver data.
- **Determination basis:** Works of the US Government (17 U.S.C. §105); the archive is an SEC compilation of reported settlement facts, and CUSIP values appear here only as they are published by the SEC in that compilation. Populus uses them solely as an identifier seed with recorded provenance, not as a redistributed identifier database. Source page and archive verified live on 2026-07-24 (M2-CONTRACT §1).
- **Determined:** 2026-07-24 · **Review by:** 2026-10-24

## `sec-13f-list` — SEC Official List of Section 13(f) Securities (index: sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities; the old sec.gov/divisions/investment/13flists.htm 301-redirects there; quarterly files at sec.gov/files/investment/13flist{YYYY}q{N}.pdf and, for the most recent quarter, the -txt.txt variant)

- **Instrument:** 17 U.S.C. §105 (works of the US Government): the SEC's own quarterly compilation of the securities institutional managers must report on Form 13F; an endpoint-level determination under the §15.2 us-govworks-sec umbrella. The compilation embeds CUSIP identifiers and descriptions licensed from CUSIP Global Services (CGS)/American Bankers Association (ABA), whose redistribution notice travels with the data.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Seeding security_list_intervals with quarter-exact CUSIP validity intervals and the SEC canonical issuer name, with per-row provenance and review state
  - Redistribution of a provenance-recorded verbatim excerpt as a repository test fixture, with the source URL, retrieval date and archive sha256 recorded alongside it
  - Research and analysis
- **Restrictions:**
  - COUNSEL GATE — CUSIP redistribution: CGS/ABA assert IP in the CUSIP identifiers the SEC publishes here. Populus already redistributes CUSIPs from 13F filings and FTD, so admitting this source adds no NEW exposure class, but the counsel-gate flag records it explicitly and the P2-entry counsel gate must name it (see counsel_flags).
  - The verbatim CGS/ABA notice (see required notices) is non-removable and travels with any redistributed excerpt or derived identity
  - Identity seeding only: the list is used as a definitional CUSIP-validity and canonical-name source, not republished as a CUSIP identifier database
  - Quarter identity comes from the source filename/URL cross-checked against the document's Year/Qtr header; the legend 'current as of' date is not authoritative (it is stale boilerplate on some quarters)
  - Archive availability recorded during RUN M2-5: the index lists quarterly files back through 2024; quarters 2025Q1–2026Q2 were retrieved and cached (2026Q2 in both PDF and text; 2025Q1–2026Q1 PDF only)
  - Retrieved under the same sec-edgar fair-access conditions (SEC-accepted User-Agent, in-code rate floor)
- **Required notices (verbatim):**
  > Copyright (c) American Bankers Association (ABA). All rights reserved. CUSIP Numbers and descriptions are used with permission by CUSIP Global Services (CGS), which is operated by FactSet Research Systems Inc., on behalf of the ABA. No redistribution without permission of CGS. CGS does not guarantee the accuracy or completeness of the CUSIP Numbers and standard descriptions included herein and none of CGS, ABA or FactSet shall be responsible for any errors, omissions or damages arising out of the use of such information.
- **Counsel-gate flags:** `cusip-redistribution`
- **Attribution:** Source: U.S. Securities and Exchange Commission, Official List of Section 13(f) Securities. CUSIP identifiers and descriptions © American Bankers Association, used with permission by CUSIP Global Services.
- **Determination basis:** Works of the US Government (17 U.S.C. §105): the list is an SEC compilation and the definitional answer to the very question the M2 coverage gate asks ('is this CUSIP a registered 13(f) security this quarter?'). CGS/ABA assert IP in the embedded CUSIP identifiers; the SEC publishes them with the redistribution notice recorded above, which Populus carries verbatim. Populus uses the list as a dated identity/name seed with recorded provenance, not as a redistributed CUSIP database — the same posture as sec-ftd. The counsel gate (CUSIP redistribution) is flagged for the P2-entry counsel review; it adds no exposure class beyond the CUSIPs Populus already redistributes from 13F filings and FTD. Source index, quarterly files and the dual-format 2026Q2 verified live 2026-07-25 and cached 2026-07-30.
- **Determined:** 2026-07-30 · **Review by:** 2026-10-30

## `us-govworks-treasury` — Treasury FiscalData; Treasury daily yield-curve XML

- **Instrument:** US-government works (17 U.S.C. §105).
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Redistribution with attribution
  - Research and analysis
- **Attribution:** Source: U.S. Department of the Treasury.
- **Determination basis:** Works of the US Government; attribution shipped as good practice.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `us-govworks-cftc` — CFTC Commitments of Traders (COT)

- **Instrument:** US-government works (17 U.S.C. §105).
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Redistribution with attribution
  - Research and analysis
- **Attribution:** Source: U.S. Commodity Futures Trading Commission.
- **Determination basis:** Works of the US Government; attribution shipped as good practice.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `bls-tos` — BLS API *(placeholder — no ingestion before the entry completes)*

- **Instrument:** US-government work WITH explicit ToS conditions: retrieval-date citation and the BLS verbatim disclaimer are required, not courtesy.
- **Status:** placeholder · **Ingestible:** no
- **Permitted uses:**
  - Redistribution with the required citation and disclaimer attached to every BLS-derived response
- **Restrictions:**
  - Retrieval-date citation required on every BLS-derived output
  - BLS verbatim disclaimer required on every BLS-derived output
  - Keyless-tier limits encoded in the client
- **Required notices (verbatim):**
  > BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.
- **Attribution:** Source: U.S. Bureau of Labor Statistics (retrieval date stated per response).
- **Determination basis:** Placeholder per §15.2 — the full entry (verified ToS text, client limit constants) is completed at M4 phase entry; no BLS data is ingested before that completion (G11).
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `bea-tos` — BEA API *(placeholder — no ingestion before the entry completes)*

- **Instrument:** US-government work; API not yet verified beyond signup/docs pages (free key).
- **Status:** placeholder · **Ingestible:** no
- **Restrictions:**
  - No ingestion before the M4 phase-entry determination completes (G11)
- **Attribution:** Source: U.S. Bureau of Economic Analysis.
- **Determination basis:** Deferred-to-M4 placeholder per §15.2 — entry completed at M4 phase entry.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `fred-per-series` — FRED *(placeholder — no ingestion before the entry completes)*

- **Instrument:** Agency-operated aggregator with per-series third-party licenses; a FRED series is ingestible only with its own sub-entry recording the underlying source's status.
- **Status:** placeholder · **Ingestible:** no
- **Restrictions:**
  - Per-series determination mandatory; primary agency preferred wherever one exists
  - User-supplied key only (§11.5)
  - No ingestion before the M4 per-series determinations (OQ-11, G11)
- **Attribution:** Source: Federal Reserve Bank of St. Louis (FRED), per-series underlying source stated per sub-entry.
- **Determination basis:** Deferred-to-M4 placeholder per §15.2 — per-series determinations at M4 entry (OQ-11).
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `cc0-legislators` — unitedstates/congress-legislators

- **Instrument:** CC0 1.0 Universal — unrestricted.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Unrestricted use and redistribution
- **Attribution:** Source: the unitedstates project, congress-legislators (CC0).
- **Determination basis:** The project dedicates the dataset to the public domain under CC0; attribution shipped as good practice.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `mit-kadoa-seed` — kadoa-org/congress-trading-monitor backfill seed

- **Instrument:** MIT license.
- **Status:** determined · **Ingestible:** yes
- **Permitted uses:**
  - Use and redistribution with the MIT attribution retained
  - Backfill import with provenance and lineage retained (§9.6)
- **Restrictions:**
  - MIT copyright and permission notice retained
  - Provenance (kadoa_id) and crosswalk lineage retained per row; retired rows tombstoned, never deleted
- **Attribution:** Backfill seed: kadoa-org/congress-trading-monitor (MIT).
- **Determination basis:** Regularized register entry, not an ad-hoc exception (G2); MIT-licensed seed with provenance and progressive primary-source replacement per §9.6.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23

## `capitol-api-reference` — crnicholson/capitol-api *(reference only — never ingested)*

- **Instrument:** No license published = all rights reserved.
- **Status:** determined · **Ingestible:** no
- **Permitted uses:**
  - Read for ideas only
- **Restrictions:**
  - Zero code reuse
  - Never ingested, never vendored
- **Determination basis:** Reference-only marker recorded so the repository's position is explicit: an unlicensed repository grants no rights.
- **Determined:** 2026-07-23 · **Review by:** 2026-10-23
