# Handoff Prompt Review — Populus (Congress Trading MCP)

**Reviewer:** Claude (Fable 5), independent review session 2026-07-16
**Subject:** CodexSOL agent-handoff prompt, research dated 2026-07-15
**Verdict:** Sound direction, right decisions, right constraints. Every load-bearing claim was re-verified live on 2026-07-16 — most hold, several are stale or imprecise, and two carry real risk if taken at face value. Corrections are folded into `ARCHITECTURE.md`; this file records what was checked and where I differ.

---

## 1. What I verified independently (2026-07-16)

| # | Claim in handoff | Result | Evidence |
|---|---|---|---|
| 1 | House bulk index at `disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip` | **Confirmed** | Downloaded `2026FD.zip` (50,845 B, last-modified 2026-07-15 13:00 GMT — refreshed daily). Contains `2026FD.xml` + `.txt`. 1,376 filings, 298 with `FilingType=P`. Schema: Prefix/Last/First/Suffix/FilingType/StateDst/Year/FilingDate/DocID. |
| 2 | Yearly archives cover the STOCK Act era | **Confirmed** | Range-request HEAD checks on `2013FD.zip`, `2015FD.zip`, `2020FD.zip`, `2024FD.zip` — all exist. |
| 3 | Individual House PTR PDFs at `public_disc/ptr-pdfs/<YEAR>/<DocID>.pdf`, e-filed ones text-extractable | **Confirmed end-to-end** | Pulled DocID 20034916 (Rep. Wittman, VA-01). `pypdf` extracted every field cleanly: asset "Crown Castle Inc. (CCI)", type S, transaction 06/30/2026, notification 07/02/2026, filed 07/10/2026, amount $1,001–$15,000, owner, broker, cap-gains flag. Dual-date design confirmed necessary and available. |
| 4 | Senate eFD: no API, CSRF/agreement gate, session required | **Confirmed — and easier than described** | Full handshake succeeded with plain `curl`: GET `/search/home/` → Django `csrfmiddlewaretoken` → POST `prohibition_agreement=1` → 302 → POST `/search/report/data/` (a DataTables JSON endpoint, `report_types=[11]` = PTR) returned 19 PTRs filed since 06/01 with detail URLs. |
| 5 | Senate e-filed PTRs are parseable HTML tables | **Confirmed end-to-end** | Fetched `/search/view/ptr/a5fdbba4…/` (Sen. Fetterman, filed 07/09). Clean table: #, Transaction Date, Owner, Ticker, Asset Name, Asset Type, Type, Amount, Comment. Note: ticker is `--` for bonds/non-equity — schema must not assume a ticker. |
| 6 | "Reported Akamai bot protection" on eFD | **Not reproduced** | Zero blocking encountered at single-request cadence with a browser UA from a residential IP. Treat as a *contingency* (design the fallback), not a present obstacle. Untested: sustained crawls, and GitHub Actions datacenter IPs — that's the realistic block scenario. |
| 7 | kadoa-org/congress-trading-monitor: MIT, ~54k transactions 2012–present as static JSON | **Confirmed, better than described** | 111★, MIT, pushed 2026-07-16 (actively maintained, not a dead dump). `public/data/trades.json` is 4.3 MB with a *rich* schema: stable `id`, `source_id`, both dates, `days_to_file`, `is_late`, amount low/high/label, owner, filer/party/state/chamber, `doc_url`. Also covers OGE (executive branch) — a scope decision we must make explicitly. |
| 8 | neelsomani/senator-filings (MIT, 413★) as proven Senate reference | **Confirmed with caveat** | Exists, MIT, 413★ — but last pushed **2024-01-19**, 2.5 years stale. Valid as a protocol reference (the handshake it documents still works — I reproduced it), not as importable code. |
| 9 | unitedstates/congress-legislators public domain | **Confirmed** | CC0-1.0, 2,409★, pushed 2026-07-15. |
| 10 | crnicholson/capitol-api "active 2026" | **Confirmed with a legal flag** | Pushed 2026-07-05, but **9★ and NO license**. Unlicensed = all-rights-reserved: we may read it for ideas, we may not copy code. The handoff didn't flag this. |
| 11 | Competitors: unusual-whales-mcp 71★ paid-key; capitol-trades scraper 3★ abandoned | **Confirmed** | 72★ / 3★ respectively; mcp-capitol-trades last pushed 2025-11-17. |
| 12 | "PulseMCP has zero results for congress trading" | **Confirmed for the exact niche; imprecise as stated** | PulseMCP query "congressional trading" → 0 servers. But "congress" → 10, and three hosted market-data platforms (ClawTerminal, HoldingsIntel, Ko) list congressional trades **as a feature**. The open niche is precisely: *free, open-source, primary-source, no API key, self-hostable, dedicated*. The launch positioning must say those words, because "first congress MCP" is no longer literally true. |
| 13 | Project Compass state | **Handoff is stale — materially** | See §2.1 below. |
| 14 | Stripe math on a $1 price point | **Confirmed** | $0.30 + 2.9% on $1.00 = ~33% take. Reasoning holds. |
| 15 | 5 U.S.C. § 13107(c)(1) prohibited-uses | **Consistent with my knowledge** (recodification of Ethics in Government Act §105(c)); commercial use prohibited except media dissemination to the general public. Non-negotiable posture item; counsel review required before any paid tier. |
| 16 | Package naming | **New finding** | `populus` is taken on PyPI (defunct Ethereum framework). `populus-mcp` and `congress-trading-mcp` are both free (404 on PyPI JSON API). |

## 2. Corrections — facts the handoff gets wrong or stale

### 2.1 Project Compass is not "pre-implementation" — it is live and mature
The handoff hedges ("don't assume code exists — check"), which was the right instinct, but the facts have moved a lot:

- The repo is at **`~/projects/Project Compass`** (with a space), not `~/projects/project-compass/`. There are ~20 sibling worktrees (`compass-theta-*`, `compass-movers-*`, …).
- 153+ merged PRs, launchd jobs, a frontend, Supabase artifacts, QA gates. This is a **production personal trading system**, not a spec.
- The architecture doc is **v2.6** and the handoff's section numbers are from v1: auth/multi-tenancy honesty now lives in **§12/§17** (not §17.7); guardrails are **§19** (not §18); §18 is now open questions. The claims themselves are accurate in substance — Compass is "multi-viewer-ready, not multi-user-ready", and guardrail #1 is a hard scope cap.
- The data vendor is **Massive** (Polygon rebranded 2025-10-30), on the **Advanced plan at $199/mo** — not "Polygon $29–200/mo tiers". Same licensing conclusion, sharper facts.

**Net effect: this strengthens the standalone decision.** Coupling a public scraper product to a *live* revenue-relevant trading system (single-writer DuckDB discipline, market-hours lock-outs, hard scope guardrails) is strictly worse than coupling to a hypothetical one.

### 2.2 The Obsidian-vault pointer is dead weight
`Obsidian Notes/Projects/Project Compass — Architecture.md` was not found; the authoritative, current spec lives in the Compass repo itself (`Project Compass — Architecture v2.md`). Future handoffs should point at the repo.

### 2.3 The Senate is not the "harder half" for the reason given
The handoff frames Senate difficulty as bot protection. In practice (verified): the handshake is two requests and the e-filed PTRs are *easier* to parse than House PDFs — they're clean HTML tables. The real Senate risks are different: (a) datacenter-IP blocking of GitHub Actions runners (untested), (b) paper/scanned filings, (c) session/agreement mechanics changing without notice. The architecture doc designs for those three, not for a generalized "Akamai is scary."

## 3. Where I agree — and it's now evidence, not assertion

- **Standalone repo, shared idioms only.** Agree, upgraded from "lean" to firm decision (DR-1). Compass's own spec forbids this scope; its licensed data must not touch a public product; its DuckDB single-writer model is wrong for a public artifact anyway.
- **Pipeline → MCP → platform.** Agree (DR-2). The MCP server is a thin read layer over the store; the platform is a second consumer. Reversing the order would put the biggest surface (web) on unvalidated data.
- **MIT.** Agree. The EdgarTools-vs-AGPL-incumbent star asymmetry is a fair proxy for the adoption goal.
- **Free posture, never charge for the data itself.** Agree — it is also the *legally safest* reading of § 13107(c), not just a growth tactic. The $5-not-$1 Stripe math holds.
- **Surface both dates on every record.** Agree emphatically; verified both sources provide both dates. This is the single best credibility feature in the plan.
- **Do not copy the capitoltrades.com-scraper approach.** Agree — third-party HTML intermediary is a fragility and provenance failure.
- **Parse-or-flag, never silently drop.** Agree; elevated to a hard guardrail with a published coverage metric.

## 4. Where I push back or go beyond the handoff

1. **"Member portfolio" as promised is not honestly buildable from PTRs alone.** PTRs are *flows*; holdings come from annual FD reports (a different, harder document family the handoff never mentions). Shipping a "portfolio" view from PTR flows without saying so would be exactly the hand-waving John forbids. Resolution (ARCHITECTURE §9): v1 ships *trading activity + net-flow estimates* labeled as such; true holdings ingestion (annual FDs) is a phased, gated addition. Competitors blur this line; we won't — it's a differentiator.
2. **The handoff is silent on amendments.** Both chambers file amended PTRs that supersede originals. Without an explicit supersede model, the dataset double-counts. ARCHITECTURE §7/§8 adds filing lineage and an amendment policy.
3. **Silent on the GitHub Actions 60-day cron auto-disable** on inactive repos, and on Actions runner IPs being the most likely thing eFD ever blocks. Both handled in §12 (ops): the nightly data commit itself keeps the repo active; the Senate job is runnable identically from the Mac mini via launchd as the documented fallback.
4. **Backfill trust boundary.** kadoa is MIT and primary-source-derived, but it is still *someone else's parser output*. The doc treats it as a seed with `source` provenance retained, spot-audited against primary documents (sampled verification gate), and progressively replaceable by our own historical re-scrape. Never presented as our parse.
5. **OGE / executive-branch scope creep.** kadoa includes executive-branch (OGE) filings. Tempting, but it dilutes the "Congress" identity and triples the parsing surface. Explicit non-goal for v1 (§2); the schema's `chamber` field doesn't preclude it later.
6. **Naming.** `populus` (PyPI) is taken. Use `populus-mcp` (verified free) for the package; repo `populus`. Domain TBD — flagged as an open question, ~$12/yr as budgeted.
7. **Registry list should include the official MCP registry** (registry.modelcontextprotocol.io) first — the handoff lists PulseMCP/Smithery/mcpservers.org/"Anthropic registry" loosely; §13 pins the actual submission set.
8. **One structural improvement: split code and data into two repos.** The scraper commits daily; putting artifacts in the code repo buries the code history under bot commits and slowly bloats clones. `populus` (code) + `populus-data` (nightly artifacts + raw filing archive, regenerable) — same pattern kadoa uses. Also solves free hosting: the data repo *is* the CDN (raw URLs / Pages).

## 5. Grade on the handoff itself

**A−.** Research quality is genuinely good — every URL and repo checked out, the legal framing is correct, and the two "open decisions" were the right two questions with the right lean on both. Deductions: stale Compass facts with wrong section pointers (§2.1), the unlicensed-repo flag missed (§1.10), the portfolio-vs-flows conflation (§4.1), and no treatment of amendments — the one omission that would have produced silently wrong data.

*Everything above is folded into [ARCHITECTURE.md](ARCHITECTURE.md), which is the governing document.*
