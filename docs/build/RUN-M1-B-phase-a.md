# RUN M1-B — Phase A decision record

**Status: Phase A measured. The run halts here for the owner's decision. No Phase B work was performed or scheduled.**

Every number below is **measured** from the live operational stage, never asserted
or estimated. Where something was not measured, it says so.

- **Date of operation:** 2026-07-31
- **Phase A database:** `ops/m1-b/phase-a.db` — a copy, never the canonical corpus.
- **Provenance:** published build **`20260724.3`**, `congress.db`
  sha256 `a2c38f24670d38a94324906e49d53437cc5b56bed44487e16eee4d028f78f918`
  (26,447,872 bytes), resolved `latest.json` → `builds/20260724.3/manifest.json` →
  the `congress.db` artifact entry → `releases/data-20260724.3/congress.db`, sha256
  and byte length verified equal to that entry, copied through SQLite's backup API,
  `PRAGMA integrity_check` = `ok`, and the pre-ingest counts asserted equal to the
  manifest-listed `congress/stats.json`: filings **1,469**, transactions **4,765**,
  `v_default_transactions` **3,911**.

---

## 1. What was executed

| # | Step | Outcome |
|---|---|---|
| 1 | `scripts/phase_a_snapshot.py` — resolve + verify + backup-copy | **done** (build `20260724.3`) |
| 2 | Verify `congress-legislators` historical inputs, assert era term coverage | **done** — house **484**, senate **126** members with terms overlapping 2015 |
| 3 | House **2015** live ingest (728 PTRs) | **done** |
| 4 | Senate **01/01/2015 → 03/31/2016** live ingest | **NOT COMPLETED — eFD source outage (HTTP 503).** See §6. |
| 5 | Member join over the enlarged corpus | **done** |
| 6 | `populus stats` + gate report | **done** |
| 7 | Same acceptance re-run on the real corpus (`--db`) | **done — PASSED** |

---

## 2. House 2015 — the measured era

### Dispositions (from the real 728-PTR 2015 index)

| Filed year | parsed | partial | needs_ocr | failed | total |
|---|---|---|---|---|---|
| 2015 | 364 | 26 | **300** | 0 | 690 |
| 2016 | — | — | 35 | — | 35 |
| 2017 | — | — | 3 | — | 3 |
| **all** | **364** | **26** | **338** | **0** | **728** |

The 2015 index carries 38 filings whose **filed date** falls in 2016–2017 (late
filings). They are reported under the year they were filed and are all paper.

### e-file / paper mix

- e-file filings (2015): **390** — 56.5% of the era's 690 filings
- paper (`needs_ocr`, 2015): **300** — 43.5%
- paper across the whole 2015 index: **338 / 728 = 46.4%**

Paper is retained with its document link, counted in dispositions, and excluded
from **both** e-file censuses. No OCR was performed (non-goal).

### Parse coverage against the ≥97% gate

| | measured |
|---|---|
| clean e-file rows | **3,952** |
| total e-file rows | **4,039** |
| **e-file row rate** | **97.8%** (0.97846) |
| gate | 0.97 |
| e-file filings | 390 |
| measurable | **390** |
| unmeasurable | **0** |
| `row_denominator_known` | **true** |
| **status** | **`pass`** |

Measured on the same ruler as the 2026 baseline (97.5% on the 312-PTR 2026
corpus, `STATUS.md:39`) — the 2015 template era parses **slightly better** than
the current one.

### The gate's honesty, demonstrated on real data

The first run left **one** filing with an unknown expected row count —
`house:9107852` (Long, Billy, filed 2015-11-03), whose PTR fetch was answered
**403**. With that document uncounted the era read:

> `house 2015 | e-file rows 3952/4039 = 97.8% (floor) … unmeasurable 1 … status unmeasurable`
> `OWNER DECISION REQUIRED: 1 era(s) did not pass the 97% e-file row gate.`

The row rate was already above 0.97, and the gate still refused to certify —
because one unmeasured document can hold disproportionately many rows, so no
percentage of filings can bound row coverage. The re-run refetched exactly that
document (see §4), it classified as **paper → `needs_ocr`**, left both e-file
censuses, and the era moved to **`pass`** with a knowable denominator.

That transition is the whole point of the rule: **97.8% with an unknown
denominator was not a pass; 97.8% with a known one is.**

### Member join (per era, primary sources)

| | measured |
|---|---|
| filings joined | **684 / 690** (99.1%) |
| filings unjoined | **6** |
| rows joined | **4,015 / 4,039** = **99.4%** |

Unjoined 2015 filer names — retained, flagged NULL, counted, never dropped:
`Cassidy, William M.`, `Castor, Kathy`, `Grijalva, Raúl M.`,
`Rahall, Nick J. II`, `Schneider, Bradley S.` (×2 filings).

Cross-check query (read-only, reproduces the row figures above):

```sql
SELECT chamber, substr(filed_date,1,4) AS yr,
       COUNT(*) AS rows_total, COUNT(bioguide_id) AS rows_joined
FROM v_default_transactions WHERE source != 'kadoa'
GROUP BY chamber, yr ORDER BY chamber, yr;
```

---

## 3. Request / retry / wall-clock instrumentation (the Phase B sizing input)

| Command | attempts | retries | status mix | backoff | elapsed |
|---|---|---|---|---|---|
| House 2015, first run | **729** | 0 | `200:728, 403:1` | 0.0 s | **301.8 s** |
| House 2015, resume run | **2** | 0 | `200:1, 304:1` | 0.0 s | **0.9 s** |
| Senate window, attempt 1 | 6 | 3 | `200:1, 302:1, 503:4` | 14.0 s | 22.7 s |
| Senate window, attempt 2 | 6 | 3 | `200:1, 302:1, 503:4` | 14.0 s | 21.8 s |
| Senate window, attempt 3 | 6 | 3 | `200:1, 302:1, 503:4` | 14.0 s | 21.2 s |

Log provenance for those three rows: **2 of the 3 attempt logs are retained** —
`ops/m1-b/senate-2015.log` is attempt 2 and `ops/m1-b/senate-2015-attempt3.log`
is attempt 3. Attempt 1 wrote to the same path as attempt 2 and was overwritten;
its row is transcribed from that run's console output. (Corrected in
code-review round 1, F5: §9 previously described three retained logs.)

**Measured House per-request cost: 301.8 s / 729 requests = 0.414 s/request** at
the unchanged 0.25 s politeness floor — i.e. real latency ≈ 0.16 s on top of the
floor. This **replaces the planning prior of ~1 s/request** and is the basis of
the Phase B arithmetic in the dev notes.

The Senate per-request cost was **not measured**: no index page was ever served.

---

## 4. Resume / transport counters (R3 verified-settled, on the real archive)

Two snapshots, explicitly labelled, because the resume run changed the archive.
**Column A is the state after the first run** (the 403 document still missing);
**column B is the state after the resume run**, which is what
`ops/m1-b/raw/house/` holds today.

| | A: after the first run | B: after the resume run (current tree) |
|---|---|---|
| archived PTR documents | **727** | **728** |
| provenance sidecars written | **727** | **728** |
| archive size | **65 MB** | **65 MB** |
| `settled_verified` (measured on the resume run) | — | **727** |
| `settled_reobtained` (measured on the resume run) | — | **0** |
| PTR transport on the resume run | — | **1 request** (the previously-403 document) |
| index transport on the resume run | — | **1 request**, answered **304** |

**727 sidecars for 728 index PTRs, after the first run.** The missing one is the
403: it was never checkpointed and never archived, its `raw_path` and
`response_hash` stayed NULL, and it remained re-fetch-eligible — the non-200
guard behaving in production exactly as the hermetic test pins it. A durable
empty file would have frozen that filing out of the corpus permanently.

**The resume run then closed it**, which is the point of the guard: the single
`200:1` in the resume run's status mix is that document, fetched on the second
attempt, so the archive now stands at **728 PDFs and 728 sidecars** — one sidecar
per index PTR, no gap. The `settled_verified` figure of **727** is a *resume-run*
counter, not an archive size: it counts the documents that were already settled
and verified when that run started, which is correctly one fewer than the 728 the
run finished with.

*(Correction, code-review round 1 F5: this table previously carried the
first-run figure of 727 with no label, while the operational tree holds 728.
Both snapshots are now stated and named. Documentation only — no runtime
behaviour is affected, and no operational artifact was modified.)*

Re-running the whole era cost **2 requests and 0.9 seconds** against **301.8
seconds** for the initial pass. Phase B is therefore safe to interrupt and resume
at any point.

---

## 5. Publication on the enlarged corpus (the same acceptance, `--db`)

`scripts/accept_m1_b.py --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw/house
--data-repo ops/m1-b/data-repo` → **ACCEPTANCE PASSED**.

| | measured |
|---|---|
| corpus filings | **2,197** (from 1,469) |
| corpus transactions | **8,804** (from 4,765) |
| `v_default_transactions` | **7,950** (from 3,911) |
| build | `20260731.1` |
| **verify** | **ok**, 1,603 artifacts checked |
| `congress/feed.json` | equals the DB's expected latest **500**, same ids, same order |
| slices carrying 2015 rows | **997** (66 member + 932 ticker entities) |
| member pages | **166** (§9.10 assumed ~700) |
| ticker pages | **1,431** (§9.10 assumed ~2,500) |
| **published files** | **1,603 / 4,000** M1 budget |

The 2015 era doubled the corpus and the published file count still sits at **40%
of the hard budget**. The §9.10 entity assumptions are not yet approached.

---

## 6. Finding: the Senate historical window was not ingested (eFD 503)

The Senate window `01/01/2015 → 03/31/2016` could **not** be fetched. Three runs,
spaced across ~40 minutes, each: handshake **succeeded** (home `200`, agreement
`302` — so the session, CSRF token, and prohibition agreement are all healthy),
then `POST /search/report/data/` answered **503** four times, exhausting the
backoff schedule (2 s + 4 s + 8 s = 14 s slept) and failing the discovery.

**This is a source-side outage, not the window seam and not a protocol
regression.** Verified independently of Populus code with a direct handshake +
POST: the **bounded** window body and the **unchanged open-ended default** body
both returned 503 from the same endpoint in the same session. A CSRF or protocol
regression would present as 403 and trip the consecutive-403 breaker; it did not.

Consequences, stated plainly:

- **No Senate cross-year amendment pair was measured on live data.** The
  mechanism is proven hermetically (`accept-m1-b` links a 2015-12-15 original to
  a 2016-01-20 amendment, flags both sides, and excludes the original from
  `v_default_transactions`), but the live count is **not measured** and must not
  be reported as if it were.
- **No Senate historical era figures exist** — no e-file/paper mix, no per-era
  gate, no per-era join for senate 2015/2016.
- **`N_win` (the window's `recordsTotal`) is unknown**, so the Senate half of the
  Phase B arithmetic remains measured-at-operation.
- **Nothing was persisted**: 0 new filings, 0 rows. The store's Senate watermark
  is unchanged, so nothing about the corpus was left in a partial state.

**Recovery is exactly one command**, unchanged, whenever eFD is serving again:

```
uv run populus ingest congress-senate --db ops/m1-b/phase-a.db \
    --raw-root ops/m1-b/raw/senate \
    --submitted-start 01/01/2015 --submitted-end 03/31/2016
```

---

## 7. Gate outcome and the three options

Current gate report (`ops/m1-b/gate-report.log`):

```
house 2015 | e-file rows 3952/4039 = 97.8% (rate) vs gate 97% | e-file filings 390 (measurable 390, unmeasurable 0) | needs_ocr 300 | status pass
house 2016 | e-file rows 0/0 = n/a vs gate 97% | e-file filings 0 | needs_ocr 35 | status no_efile_filings
house 2017 | e-file rows 0/0 = n/a vs gate 97% | e-file filings 0 | needs_ocr 3  | status no_efile_filings
house 2026 | e-file rows 2604/2670 = 97.5% (rate) vs gate 97% | e-file filings 279 (measurable 279, unmeasurable 0) | needs_ocr 33 | status pass
senate 2026 | e-file rows 991/991 = 100.0% (rate) vs gate 97% | e-file filings 49 (measurable 49, unmeasurable 0) | needs_ocr 4 | status pass
```

**No era is currently `miss` or `unmeasurable`, so no `OWNER DECISION REQUIRED`
banner is raised.** The 2015 template era parses clean at 97.8%, above the gate.

The three options remain on the table and are recorded because the brief makes
the decision itself the gate — a clean pass does **not** authorize Phase B:

- **(a)** era-scoped gates published honestly per year in `stats.json`
  — *already implemented and published*: `stats.json` carries
  `efile_parse_gate_by_chamber_year_including_excluded` and
  `member_join_primary_by_chamber_year_including_excluded` per `(chamber, year)`.
- **(b)** a parser extension for the older template era, then
  `populus reparse congress-house --parser-version <old>` (archive-only, no
  refetch). **Measured as not needed for 2015**: the existing parser reaches
  97.8% on the real era. The reparse machinery is verified ready if a later era
  needs it. No parser change was made in this run.
- **(c)** accepting a higher `needs_ocr` share as counted-not-parsed. **This is
  the live question for 2015**: paper is **43.5%** of the era's filings versus
  **10.6%** in 2026 (33 of 312). Those 300 documents are retained, linked, and
  counted — but they carry **zero rows**, so the era's transaction coverage is
  structurally thinner than 2026's even at a better parse rate.

---

## 8. The Phase A stop point

Phase A is measured and recorded. **This run performs no Phase B work.**

The decision the owner is asked to record:

1. Does the measured 2015 result — **97.8% e-file row coverage, 99.4% member-join
   row coverage, and a 43.5% paper share carrying no rows** — authorize the Phase
   B 2013–2025 remainder under option (c)?
2. Should the Senate historical window be completed first (one command, §6), so
   Phase A carries a Senate era before Phase B is sized?

Phase B begins only in a subsequent operation, authorized by that recorded
decision. Its sizing, re-derived from the measured per-request cost above, is in
`docs/build/RUN-M1-B-devnotes.md`.

**Rollback:** `rm -rf ops/m1-b`. The Phase A database, raw archive, and local data
repo are a copy and a scratch tree; the canonical corpus and the published data
repo were never written to.

## 9. Artifacts

| Path | Contents |
|---|---|
| `ops/m1-b/phase-a.db` | the Phase A corpus (copy of build `20260724.3` + the 2015 era) |
| `ops/m1-b/raw/house/` | **728** archived PTRs + **728** provenance sidecars + the index (post-resume; 727 each after the first run) |
| `ops/m1-b/stats.json` | `populus stats` on the enlarged corpus |
| `ops/m1-b/gate-report.log` | the per-era gate + join report |
| `ops/m1-b/house-2015.log` | the first House run (the 301.8 s / 729-request record) |
| `ops/m1-b/house-2015-resume.log` | the resume run (727 already settled + verified, 2 requests) |
| `ops/m1-b/senate-2015.log`, `ops/m1-b/senate-2015-attempt3.log` | **2 of the 3** 503 attempts retained: `senate-2015.log` is **attempt 2** (elapsed 21.8 s) and `senate-2015-attempt3.log` is **attempt 3** (21.2 s). **Attempt 1's log was not kept** — it was written to the same `senate-2015.log` path and overwritten by attempt 2; its §3 figures (elapsed 22.7 s) come from that run's console output, recorded at the time |
| `ops/m1-b/members-join.log` | the member join over the enlarged corpus |
| `ops/m1-b/accept-operational.log` | the acceptance re-run on the real corpus |
| `ops/m1-b/data-repo/` | the local build → publish → verify output |

`ops/` is external operational state: never published, never committed, safe to delete.
