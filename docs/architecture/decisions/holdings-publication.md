# M2-8 — Publishing per-filer 13F holdings: reversal of M2-CONTRACT §3

**Status:** DECISION RECORD. Owner decision 2026-08-01.
**Reverses:** `docs/build/M2-CONTRACT.md` §3 row *"M2 13F per-filer holdings
detail … not served — link out to EDGAR"* (introduced `db8adc2`) and
`ARCHITECTURE.md` §5.6 line 371 (introduced `f7985f6`, architecture v2.1).
**Does NOT reverse:** DR-8. See §3 — DR-8 is applied *more* faithfully by this
change, not less.

---

## 1. The decision

Per-filer 13F holdings detail moves from **Pattern F** (federate-live, link out to
EDGAR) to **Pattern R** (replicate-and-publish) for the **dashboard and MCP
snapshot** consumers. Populus will hold the full reported holdings corpus and serve
it directly: a filer's complete position list, every institutional holder of an
issuer, a cross-filer activity feed, and positions flagged as outsized against the
filer's own history.

Owner statement of intent, 2026-08-01:

> "if I'm putting something out there it needs to be legit… someone should be able
> to see their portfolio across the board. If we gonna do it let's do it right."

Federated live EDGAR is **retained**, scoped (§6).

## 2. Why the original decision existed

DR-8 (`ARCHITECTURE.md:143-149`) assigns every dataset a pattern. Its justification
has three parts:

1. **Cost containment** — federated reads hit agency infrastructure operated for
   exactly that purpose; Populus's own infra carries none of it.
2. **Freshness** — federated answers are as fresh as the agency.
3. **Replication only where it adds value** — "cross-entity aggregates … are
   precisely what per-entity APIs can't answer."

M2-CONTRACT §3 applied this by classifying per-filer holdings as the *long tail* —
data EDGAR already serves per filer, therefore not worth mirroring. The dashboard
was told to render aggregates and link out. `dashboard/src/pages/institutional/
filers/[cik].astro:5` records the consequence in the code itself:

> `// The mockup's full holdings table is contractually unservable (M2-CONTRACT §3)`
> `// → changes table + EDGAR link-out.`

The full holdings table had been designed (`docs/design/handoff/Institutional
Filer.dc.html`) and was removed at implementation time solely to obey §3.

## 3. Why that classification was wrong — the property is preserved, not abandoned

**DR-8's own text assigns this dataset to Pattern R.** Line 145 defines Pattern R as
covering "sources without APIs **and for cross-entity aggregation products**."

§3 classified per-filer holdings as a *per-entity lookup*, which EDGAR does serve
well. But the same rows are simultaneously the **substrate for cross-entity and
cross-time products** that no per-entity API can answer:

| Product question | Can EDGAR's per-filer API answer it? |
|---|---|
| Every institutional holder of NVDA this quarter | **No** — requires every filer at once |
| Largest position changes across all filers | **No** — requires every filer at once |
| Is this position outsized vs this filer's own history? | **No** — requires the filer's prior quarters, joined |
| One filer's portfolio for one quarter | Yes |

Three of the four are exactly the category DR-8 reserves for Pattern R, and they
are impossible without **holding** the per-filer rows internally.

**Correction, external review round 2 (2026-08-02).** An earlier draft of this
record went further and claimed those products are *inseparable from publishing*
the per-filer detail. **That claim was unsound and is withdrawn.** Holding is not
publishing. DR-8 justifies **internal Pattern-R replication** of the holdings rows
so cross-entity products can be computed; it does **not** by itself justify serving
the complete per-filer position list to readers, because purpose-built holder,
activity, and flag aggregates could satisfy those three products while publishing
far less.

So the reversal has two distinct parts, and only the first is a derivation:

1. **Internal replication of per-filer holdings — derived from DR-8.** The
   cross-entity products cannot be computed any other way.
2. **Publishing the complete per-filer position list — an owner product decision,
   2026-08-01, not a logical consequence of anything.** The owner's stated basis:
   *"if I'm putting something out there it needs to be legit… someone should be
   able to see their portfolio across the board."* It is recorded here as a
   product judgement and must be defended as one.

Conflating the two would have presented a product expansion as an architectural
necessity. It is named separately so review can accept or reject each on its own
terms. §3's original error remains real — it classified the dataset by whether an
API serves the row rather than by what the product must answer — but correcting it
delivers part 1, not part 2.

With that distinction drawn, the protected properties survive as follows:

| DR-8 property | How it survives |
|---|---|
| **Populus infra cost ~$0** | The serving projection ships inside the existing Pages bundle, within the existing §12.1 file and byte budgets. No new always-on infra. The heavy audit store stays ops-local and unpublished. R2 is not introduced. |
| **Don't push load onto SEC** | ~~**Net SEC load falls.**~~ **Claim withdrawn 2026-08-02 (external review round 2) — it was asserted, not measured.** The site is **not deployed**, so current federated reader volume is **zero and unmeasurable**; there is no baseline against which a reduction could be shown. What *is* certain is that this plan **adds** load: a full-universe quarterly refresh plus a one-time historical backfill of **K = 6 periods** (OD-4 fixes K=6; the earlier "8 periods" figure predates that lock — review r6 F2). **Measured**: 4.04 req/filer at ~1.97 req/s, 3,673 ranked filers/period ⇒ ≈14,800 requests and ≈2.1 h of ingest per period, plus ≈33 min of discovery — ≈15.5 h for K=6. The honest position: SEC load **increases** by a known, bounded, operator-side amount, incurred once per quarter at the politeness floor rather than scaling with readership. Whether that trade is acceptable is part of OD-1, and it must be decided against a stated worst-case operator request budget and refresh cadence — not against a comparison to a readership that does not yet exist. |
| **Replicate only where it adds value** | Satisfied by DR-8's own test — these are cross-entity aggregation products (§3 table above). |
| **Freshness** | Preserved by retaining federated live EDGAR for filings newer than the published build and filers outside the published universe (§6). |
| **G6 agency-displeasure escape hatch** | Unchanged and still armed: if SEC signals displeasure, the dataset reverts to bounded extracts or is dropped. |

## 4. The measurements that made this decidable

All measured read-only 2026-08-01 against the live ops corpus
(`~/projects/Populus-ops/populus.db`, sha-verified unchanged before and after).

**Storage was never the binding constraint — and the reason matters.**

| Measurement | Value |
|---|---|
| Corpus: 1 period (2026-06-30), 1,000 filers, 1,013 filings | 602,496 `inst_holdings` rows |
| `inst_holdings` table | 590 MB allocated / 546 MB payload — **92.5% page-packed** (not fragmentation) |
| Indexes | 174 MB |
| **Per-row payload** | **~950 bytes** |
| `raw_row` JSON duplicate | 150 MB (avg 261 B/row) |
| All other TEXT columns combined | ~22 MB |

The ~950 B/row is **audit envelope, not data**: per-row §5.1 provenance
(`source_url`, `source_record_id`, `response_hash`, `raw_path`, `parser_version`,
`retrieved_at`, `row_fingerprint`), denormalized `cik`/`accession`/
`period_of_report`/`filed_date`, plus a `raw_row` duplicate of the parsed fields.
Correct for an audit store; wrong for a serving format. A derived serving
projection carrying only the served columns targets **≤90 B/row** — roughly a
tenfold reduction — which is what makes publication fit inside existing budgets.

**The binding constraint is file count, not bytes.**

| Scheme | Files | Verdict |
|---|---|---|
| M1 pages (committed) | 8,500 | — |
| + per-entity shards (one per filer ~3,673 + one per issuer ~7,578) + 1,500 M2 pages | ~21,251 | **Breaches the 15,000 cap and Cloudflare's 20,000 hard limit** |
| + **bucketed** (512 filer + 512 issuer + 64 activity + 8 metadata + 64 spill cap) + 1,500 pages + **M3's committed 2,064** | **13,224** | **Fits — 1,776 headroom under the 15,000 cap** |

**Universe — measured 2026-08-02 by a live discovery run.** The 2026q3 form index
yields **3,913 refs across all periods** (it was 3,706 on 2026-07-31 — the open
quarter is still accreting), which rank to **3,673 ranked filers** for
`period_of_report = 2026-06-30`, declaring **$5.33T**. Positions per filer (from the
loaded 1,000): min 1, avg 602, **max 37,140**. Distinct issuer CUSIP-6 blocks: 7,578.

> **Three successive figures, recorded rather than quietly replaced.** This record
> first said "3,706 filings / $6.76T" (summing *every* period in the index), then
> "3,502 / $4.93T" (filtering a stale journal), and now the measured **3,673 /
> $5.33T**. They differ because `refs` ≠ `target-period filings` ≠ `ranked filers`,
> **and the index grows**. No conclusion here depends on the size of one quarter's
> universe; the reversal rests on what the product must answer.

**Every full-universe row count remains an extrapolation.** The tail (ranks
1,001–3,706) is not measured. RUN M2-8 task T0 measures it exactly from the
`tableEntryTotal` field on cover pages the ranking sweep already fetches. No
parameter in this record is load-bearing until T0 reports.

## 5. Parameters — locked by the owner 2026-08-02

An earlier version of this section said four parameters remained open. **All five
are now locked** (review round 5 F1):

| | Decision |
|---|---|
| **OD-1** | Backfill via the **primary per-filer EDGAR walk**. SEC bulk datasets are **not** adopted as a source, so no new §15 register entry is required and the commons stays primary-source-only. |
| **OD-2** | **Every eligible filer, discovered independently per period.** No cutoff. |
| **OD-3** | Outsized-flag thresholds `MIN_BASELINE_PERIODS=4`, `MULT=150`, `FLOOR_BPS=500`. |
| **OD-4** | Ops storage ceiling **20 GB**, covering canonical store *and* raw archives — which fixes **K = 6 periods**. |
| **OD-5** | The **current and prior** period are browsable, so a reader can see what was added and removed behind any displayed change. |

**OQ-9's source half is closed by OD-1** (bulk datasets not used). Only the
archival-for-reproducibility question remains open.

## 6. The retained federated boundary

Live EDGAR via the §11.4 client remains the path for:

1. **Filings newer than the published build** — a 13F-HR filed after the last build
   is not in the snapshot; the federated plane answers it, flagged as such.
2. **Filers outside the published universe** — whatever OD-2 sets as the cutoff,
   anything beyond it links out rather than rendering fabricated absence.

This boundary is normative, must be stated in the contract, and must be asserted on
both sides in tests (plan R11).

## 7. Residual risk, stated rather than absorbed

- **Corpus growth is unbounded over time.** Each period adds ~1.0–1.3M rows
  (estimated). Only the current period is browsable in-bundle, which bounds the
  published surface — but the ops-local store grows without limit. Mitigation: the
  §12.1 budget gate fails CI at the cap; TD-M2-8-2 and TD-M2-8-3 record the debt.
- **SEC load during backfill and refresh is real, and is stated as a budget rather
  than as a comparison.** Measured basis (`ops/m2-6/ingest-journal-2026-06-30.json`):
  **4,039 requests for 1,000 filers in 2,055 s** — 4.04 req/filer, ~1.97 req/s
  effective at the ≤2 req/s floor. For K=6 periods at full universe the operator
  request budget is therefore **bounded and one-time for the backfill, plus one
  full-universe refresh per quarter thereafter**. *(The earlier phrasing "far below
  the recurring load the link-out design imposes" is **withdrawn 2026-08-02,
  external review round 3 F12** — it reintroduced by the back door the same
  unmeasured comparison withdrawn in §3, against a readership that does not exist.)*
- **A derived claim enters the product.** The outsized-position flag is Populus
  asserting something about a filer that the filer did not report. It requires a
  published, testable definition, an explicit `awaiting_baseline` NULL state, and
  wording that cannot read as investment advice. Specified before implementation in
  `docs/build/M2-8-outsized-position-spec.md` (plan T2).
- **If OD-1 chooses bulk datasets,** a secondary source enters a primary-source-only
  commons and needs its own §15 register entry, permanent per-row source
  distinction, and disclosure on every affected surface.
- **The honesty surface widens.** Serving full holdings means the §5 `data_note`
  (long-only, no shorts/cash/non-13(f), quarter-end snapshot filed up to 45 days
  late, era-dependent units, affiliated-manager duplication, confidential
  omissions) now attaches to far more of what a reader sees. It is non-removable
  and must survive every breakpoint (plan R10).

## 8. How the property is pinned going forward

Per house practice, the replacement mechanism is held by a test sharper than the
rule it replaces:

- `test_inst_shard_budget.py` — fails if published file count or per-file bytes
  approach the §12.1 / Cloudflare caps. This is the mechanical guarantee that
  "Populus infra cost stays ~$0" survives the reversal; the old rule guaranteed it
  by refusing to publish at all.
- The 37,140-position filer is a named fixture — the measured worst case, not a
  hypothetical.
- `test_inst_federated_boundary` — asserts both sides of §6, so the retained
  Pattern-F role cannot silently erode.

---

**Supersedes:** the §3 consumer-matrix row and `ARCHITECTURE.md:371` for the
dashboard and snapshot consumers only. Amendments to both documents are additive
(strikethrough + replacement row); neither reviewed decision is rewritten in place.
