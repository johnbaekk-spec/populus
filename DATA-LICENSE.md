<!-- GENERATED FILE — do not edit by hand. Source of truth: src/populus/licenses.json; regenerate with `python scripts/render_licenses.py`. -->

# Populus data conditions register (DATA-LICENSE)

Populus **code** is MIT-licensed (see [LICENSE](LICENSE)). Populus **data** is not one license: every source enters through this conditions register (ARCHITECTURE.md §15), which records what each source permits, what it restricts, and which notices must travel with the data. "Public record" is never treated as synonymous with "public domain". No source is ingested before its entry exists (G11).

Register version: `licenses-1.0.0`.

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
