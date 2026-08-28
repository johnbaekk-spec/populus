# Runbook — kadoa backfill audit (§9.6 blocking gate)

The kadoa backfill import is gated on a **human verification audit**. This
runbook is the operating procedure for that gate: how worksheets are drawn,
how a reviewer fills them, how the scorer disposes of them, and how the
overall gate composes. RUN 4 ships the protocol and tooling; **the signed
human disposition itself is an operational P1 gate performed after the code
lands — nothing in the repository auto-passes it.**

## What is being verified

Each sampled row is checked against its **source document** (the row's
`doc_url` — the House PDF or Senate eFD page). Six **critical fields** per
row: member identity, ticker, side, amount bucket, transaction date, filed
date. **Cosmetic** issues (name formatting, comment text) are tracked
separately.

## Instruments and pinned sizes

Sizes are pinned constants in `populus.backfill` (`SRS_N=150`,
`MIN_PER_STRATUM=5`, `FOLLOWUP_N=60`). The draw command has **no size
flag**, and the scorer derives required sizes from the mode — worksheet
metadata can never lower them. The sizes are enforced exactly and fail
closed: if the eligible pool cannot supply the pinned size — the whole
population for the SRS, the named stratum for a follow-up, or a non-empty
stratum for its quota — the draw refuses and the scorer returns
`incomplete`, never a passing undersized instrument. A stratum too small to
support its follow-up (fewer than 60 rows) cannot be cleared by a follow-up;
such a stratum is cleared only by remediating the import and re-drawing the
whole gate.

| Mode | Contents | Clears |
|---|---|---|
| `initial` | uniform SRS of 150 over all imported kadoa rows, **plus** quotas of ≥5 per non-empty stratum (chamber × year-band 2012–15/16–19/20–23/24–26 × equity class); empty strata reported as empty | the population bound + stratum smoke checks |
| `redraw` | same shape, drawn from the population **minus** the failed SRS (disjoint by construction, verified at score time) | replaces a failed `initial`/`redraw` |
| `stratum-followup` | uniform 60 confined to one named stratum, zero critical errors to clear | exactly its named stratum |

Equity class is the version-controlled `asset_type` map
(`equity`/`non_equity`/`unknown`) — never ticker presence. `unknown`
(unmapped or absent asset type — 250 of 913 house congressional cache rows
carry none) is audited as its own stratum.

## Procedure

### 1. Draw

```
uv run populus backfill-audit draw --db app.db --out audit/ --mode initial --seed <N>
# redraw:            ... --mode redraw --seed <N'> --exclude audit/worksheet.<failed-run>.json
# stratum follow-up: ... --mode stratum-followup --seed <N''> --stratum 'house|2024-26|unknown'
```

The draw writes three files into `--out`:

- `worksheet.<run_id>.json` — the editable worksheet the reviewer fills;
- `worksheet.<run_id>.md` — a human-readable rendering with document links;
- `draw-record.<run_id>.json` — the **sealed draw record**. Its file SHA-256
  is written into the draw's `ingest_runs` row at draw time. Do not edit or
  regenerate it: the scorer authenticates it against the database anchor and
  independently reconstructs the expected sample from it. The editable
  worksheet carries **no trusted draw metadata**.

### 2. Human review

For every drawn row, open `doc_url` and compare the six critical fields
against the printed source. Fill the row's `verification` object in the
**JSON** worksheet (the Markdown twin is for reading):

- each critical cell: `ok` | `error` | `na` (`na` requires a `note`);
- `cosmetic`: `none` | `error` (`error` requires a `note`);
- `verified_by` and `verified_at` on every row.

Any absent, blank, or unrecognized cell makes the row unverified and the
worksheet `incomplete`. Do not edit any displayed source value, the drawn
row set, or the declared stratum — the scorer re-reads all of them from the
database and rejects any drift as `invalid`.

### 3. Score

```
uv run populus backfill-audit score audit/FILLED.json --db app.db \
    [--draw-record audit/draw-record.<run_id>.json] \
    [--prior-failed audit/FAILED.json]   # required for a redraw worksheet
```

The scorer evaluates, in order and fail-closed: (1) mode + pinned sizes;
(2) population-digest recompute; (3) sealed-record authentication and
independent draw reconstruction (plus exclusion/disjointness for a redraw);
(4) per-row source-value and stratum re-read; (5) cell completeness;
(6) required-stratum-set equality; (7) thresholds; (8) pass. Steps 1–6
yield `incomplete` or `invalid` with the shortfall enumerated and **no
threshold claim and no binomial bound**. The command exits non-zero on
every non-`pass` status.

## Dispositions and required actions

A disposition is a **status plus a set of required actions** — cumulative,
never alternatives:

| Status | Meaning | Actions emitted |
|---|---|---|
| `incomplete` | undersized/unfilled/stratum-missing worksheet | finish the review; nothing is claimed |
| `invalid` | digest, record, reconstruction, exclusion, row-value, or stratum drift | `redraw_clean` — a fresh, untampered draw |
| `fail` | any critical error, and/or cosmetic rate > 5% | every critical error: `investigate_and_fix` **and** `redraw_srs` (fresh disjoint n=150); **additionally** one `stratum_followup:<stratum>` per stratum containing a critical error; cosmetic > 5%: `remediate_cosmetic` (even at zero critical errors) |
| `pass` | valid, complete, correctly sized, reconstruction-matched, zero critical errors in both instruments, cosmetic ≤ 5%, empty action set | for `initial`/`redraw`: the exact-binomial 0/150 one-sided 95% upper bound (≈1.97%) is reported |

## Composing the overall gate

The §9.6 gate is met when **both** hold:

1. an `initial` or `redraw` worksheet scored `pass` with an empty action
   set; and
2. for **every** stratum that ever raised a critical error in any scored
   worksheet, a `stratum-followup` worksheet for that stratum scored `pass`
   (zero critical errors in its 60).

A failed sample is never reused: each `redraw` excludes the failed SRS and
the scorer verifies the exclusion equals the reconstructed failed SRS
exactly, with zero overlap.

## Recording the signed disposition

The audit trail for each round consists of: the draw's `ingest_runs` row
(run id + sealed-record hash), the sealed `draw-record.<run_id>.json`, the
filled worksheet JSON, and the scorer output. Commit all of them under
`audit/` in the private staging data repository (`populus-data`), and
record the final human sign-off — reviewer, date, scorer status line, and
the composed-gate statement from the section above — in the P1 gate
checklist (ARCHITECTURE.md §17). Import remediation (fix + full re-import +
fresh draws) restarts the composition from an empty cleared set, because a
re-import changes the population digest and every prior worksheet scores
`invalid` against the new population — by design.
