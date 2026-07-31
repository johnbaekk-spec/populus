# RUN M2-6 — Dev Notes (code review round 1 remediation)

Supersedes the round-7 orchestrate-harness notes (carried forward at the end,
unchanged and still true). This round is a code change: the four external-review
BLOCKERs in `.codex-review/m26code-3.codex.last.txt` (F1–F4, verdict
CHANGES_REQUESTED) are fixed in the working tree of the `Populus-m25` worktree,
branch `feat/run-m2-6-bulk-13f-corpus-filer-universe-20260730-210233`. Nothing
was committed, pushed, branched, or checked out.

## Detected Stack

Python 3.12, `uv` frozen-lockfile, `pytest -q`, `click`, SQLite/JSON1, `httpx`
only via `SecClient`. Gates: `make test`, `make security`, `make accept-m2-6`.
Unchanged — no new dependency, no second HTTP client.

## Requirement and Task Completion

| Finding | Status | Evidence |
|---|---|---|
| F1 — non-200 responses accepted as document content | fixed | `inst_bulk.py:87-115` (`SecStatusError`/`_require_document`), `:223` discovery, `:352` cover ranking, `:409-418` flush-then-propagate; 9 new tests |
| F2 — short 13F rows silently skipped; unanchored filename search | fixed | `inst_bulk.py:180-191`; 5 new tests |
| F3 — replacement-interruption test could not observe the write order | fixed (test strength; production order already correct) | `tests/test_inst13f_seam.py:329-403` — two mid-replacement boundary tests |
| F4 — `accept-m2-6` did not depend on `sync` | fixed | `Makefile:43-49` `accept-m2-6: sync`; the Make target itself run |

Full per-finding map, including every mutation result:
`.codex-review/RESOLUTION-NOTES.md` → *M2-6 code review — round 1 resolution map*.

R1–R17 remain complete; this round strengthened R1/R2/R13 enforcement and their
guards without changing any requirement's scope.

## Changed Files

Reconciled against `git status` — **13 entries**, exactly the list below and
nothing else. Files this round touched are marked ★.

`DEV-NOTES.md`, `PLAN.md` and `.codex-review/` are workflow artifacts excluded
via `.git/info/exclude`, so they never appear in `git status` and are not part
of the 13. This file and `.codex-review/RESOLUTION-NOTES.md` were both written
this round.

Tracked (` M`), diffstat `3 files changed, 435 insertions(+), 15 deletions(-)`:

- ★ `Makefile` — `accept-m2-6: sync` + the comment stating why (F4). (Earlier in
  the run: the `accept-m2-6` target and its `.PHONY` entry.)
- `src/populus/cli.py` — `inst-bulk` group (`discover`/`ingest`),
  `_live_bulk_client`. **Not touched this round.**
- `src/populus/ingest/inst13f.py` — the default-inert M2-2 seam extension
  (`_read_checkpoint`/`_commit_checkpoint`, resume-aware `_LiveSource`,
  `accessions`/`report_period`/`run_passes`/`resume`, `period_mismatched`,
  `finalize_inst_ingest`). **Not touched this round** — F3 was a test-strength
  defect; `:398-405` already commits the checkpoint before the byte rename.

Untracked (`??`):

- ★ `src/populus/inst_bulk.py` (1172 lines) — discovery, ranking, universe, the
  two journals, `CountingTransport`, `run_bulk_ingest`, `format_bulk_summary`.
  This round added `SecStatusError` / `_ACCEPTABLE_STATUS` / `_require_document`,
  the two status gates, the flush-then-propagate rank loop (F1), and the
  form-before-token-check + `fullmatch` parser fixes (F2).
- ★ `tests/test_inst_bulk.py` (929 lines) — **+14 collected tests** this round
  (listed below); `_FakeTransport` gained a `statuses` map so 403/404/5xx are
  injectable without a socket.
- ★ `tests/test_inst13f_seam.py` (423 lines) — one weak test replaced by two
  mid-replacement boundary tests (**net +1**); `_resume_into_fresh` takes an
  optional url_map; module docstring corrected.
- `scripts/accept_m2_6.py`, `scripts/gen_m2_6_fixtures.py`, `tests/bulk_corpus.py`,
  `tests/test_accept_m2_6.py`,
  `tests/fixtures/inst/bulk/full-index/2026/QTR3/form.idx`,
  `docs/build/RUN-M2-6-plan.md` — **not touched this round.**
- ★ `docs/build/RUN-M2-6-devnotes.md` — the durable run record; its stale test
  count, `accept-m2-6` line and Changed-Files entry were corrected so the tree
  does not carry contradicting figures. See *Plan Deviations* §3.

## Reuse / Duplication Check

No new module, no new primitive, no second HTTP client. `SecStatusError` sits
beside the existing `SecCircuitOpenError` propagation contract and reuses the
`SecClient` status semantics rather than restating them; the rank journal keeps
using `write_journal`/`atomic_write_bytes`.

## Simplicity Audit

Net additions are one exception class, one guard function, two call sites, one
`try/except … raise`, one reordered branch and one anchored regex call. The F3
work is entirely in tests.

## Tech Debt Introduced

None new. TD-M2-6-3 (`form.idx` token parse) is now *stricter*, not looser: a
malformed 13F row is counted and a non-exact filename is refused. TD-M2-6-4
(single filing quarter) and TD-M2-6-5 (affiliation over-count at ranking)
unchanged.

## Memory Touch-Points

[[verify-against-a-frozen-tree]] — extended: a frozen *source* tree is not enough
when stale bytecode can outlive it; hash-and-purge, do not trust `cmp` alone
without clearing `__pycache__`. [[specify-before-rewriting]], [[john-baek-profile]].

---

## Failure-Mode Sweep

- Transient SEC 403/404/5xx at discovery → propagates; no empty universe.
- Transient SEC 403/404/5xx at ranking → propagates; no frozen `cover_failed`;
  parsed covers preserved; a resumed sweep refetches the failed one.
- Corrupt index row (short / prefixed / suffixed) → counted `rejected`, never
  admitted with an invalid source path.
- Crash between the replacement checkpoint and the byte rename → exactly one
  fetch. Crash after the byte rename → zero transport.
- Acceptance gate run outside a frozen-lockfile environment → no longer possible.
- Hidden socket → autouse guard; none opened.

## Tests Run

- `make test` → **1645 passed in 431.84s (0:07:11)**. Round-8 baseline **1630**;
  **+15** (14 + net 1) = 1645. **No regression** — no previously-passing test
  changed state.
- `make security` → `dep_guard: OK — no denylisted vendor dependencies or imports`.
- `make accept-m2-6` → exit **0**, and the target now runs `uv sync --frozen`
  first. Measured: 13 refs / 0 rejected; 6 filers ranked, 0 rank_failed, survivor
  values match the `v_default` oracle; top-5 selected; 5/5 filers loaded, 11
  holdings, reconciled; 41 attempts / 0 retries / 0 304s / 11 cache hits;
  coverage `2070000000/2070000000 = 1.0000` meets gate; `inst` admitted;
  `inst_health` provenance `published-snapshot` (filers 5, build `20260930.1`);
  aggregate query returns corpus data with the snapshot build_id; resume re-read
  every durable document with ZERO transport.

### Tests Added This Round

`tests/test_inst_bulk.py` (+14 collected):

| Test | Params | Guards |
|---|---|---|
| `test_parse_form_index_counts_short_13f_rows_as_rejected` | 1 | F2 — a truncated 13F row is counted in `rejected`; a truncated non-13F row is still out of scope |
| `test_parse_form_index_rejects_prefixed_or_suffixed_filenames` | 4 | F2 — `Xedgar/…`, `/Archives/edgar/…`, `….txt.bak`, `….txt.gz` |
| `test_discovery_propagates_transport_failure_instead_of_an_empty_universe` | 4 | F1 — a 403/404/500/503 index fetch raises before the body is decoded |
| `test_ranking_propagates_a_transport_failed_cover_and_journals_nothing_for_it` | 4 | F1 — a 403/404/500/503 cover raises before parse; nothing is journaled for it; earlier parsed covers are preserved |
| `test_rank_resume_refetches_a_transport_failed_cover` | 1 | F1 — the resume proof: the failed cover is refetched, the journaled ones are not, `rank_failed == ()` |

`tests/test_inst13f_seam.py` (net +1):

| Test | Guards |
|---|---|
| `test_replacement_crash_between_checkpoint_and_byte_rename_refetches_once` | F3 — crash after the checkpoint write: bytes still corrupt on disk, resume performs exactly ONE fetch |
| `test_replacement_crash_after_byte_rename_resumes_with_zero_transport` | F3 — crash after the byte rename: the checkpoint already matches, resume makes ZERO transport calls |
| *(removed)* `test_boundary_replacement_then_resume_reads_from_disk_zero_transport` | let both writes finish before resuming — could not observe the ordering |

All hermetic, under the autouse no-network guard, driven by injected transports.
No test opens a socket.

### Mutation Verification

Seven defects reintroduced one at a time, guard test run, every touched file
restored byte-exactly (harness: `scratchpad/mutate.py`). **7 / 7 killed**, plus
the F4 Make-target check.

| Mutant | Guard result |
|---|---|
| F1a discovery status check removed | 4 failed |
| F1b cover-ranking status check removed | 5 failed |
| F1c parsed covers not flushed before propagating | 5 failed |
| F2a min-token check restored before form identification | 1 failed |
| F2b `fullmatch` reverted to `search` | 4 failed |
| F3 write order reversed (bytes before checkpoint) | 2 failed |
| F3′ same reversal, direct order-assertions neutralised | 2 failed — the behavioural `attempts == 1` / `attempts == 0` assertions catch it alone |
| F4 `sync` prerequisite removed | `make -n accept-m2-6` drops `uv sync --frozen` |

**Bytecode hygiene — a real trap hit this round.** The F3 mutation is a pure
statement SWAP, so the mutant file has the *same size* as the original;
restoring it within the same mtime second left a `.pyc` whose
`(source_mtime, size)` still validated, and CPython reused the **mutant
bytecode** afterwards — the two new F3 guards then failed under a full
`make test` against provably clean source. Every mutation check was therefore
**re-run** under a harness that clears `__pycache__` before and after each swap
and runs pytest with `PYTHONDONTWRITEBYTECODE=1`; the table above is that
bytecode-safe run. Tree integrity was then re-verified from disk — `cmp` against
pre-mutation snapshots for all four mutated files plus a full `__pycache__`
purge: **no mutant residue was found and nothing had to be restored.**

## Plan Deviations

1. **F1 scope held to the finding's remediation line.** Discovery and cover
   ranking now require an acceptable status. The ingest seam's document path
   already refuses to checkpoint or archive a non-200 (`inst13f.py:387-397`), but
   a filing whose documents 404 still becomes a terminal `failed:<kind>` filer
   disposition that a resumed bulk run skips. That is the pre-existing M2-2
   filing outcome model; changing it would alter the disposition state table and
   the journal's terminal-prefix semantics this round must preserve. **Stated,
   not fixed** — a candidate follow-on if the reviewer wants it in scope.
2. **F3 required a byte-different replacement document.** If the refetched cover
   is byte-identical to the archived one, both write orders converge on the same
   end state and no assertion can separate them. `_replacement_map()` serves a
   semantically identical but byte-different cover so the new checkpoint hash
   differs from the old. Documented in the test.
3. **`docs/build/RUN-M2-6-devnotes.md` edited.** Not named in the brief, but
   leaving its `1630 passed / 44 tests / bare accept-m2-6` figures beside this
   round's corrected ones would put two contradicting records in one tree.
4. No other deviation. The 0.95 coverage gate, `compute_coverage`, the M2-4
   serving lifecycle, the M2-5 identity paths, `_TERMINAL_PREFIXES`, the
   disposition state table and replay-zero/journal semantics are untouched.

## Model Provenance

Requested model: `claude-opus-4-8` (orchestrate DEV phase, CLAUDE_MODEL=opus).

- Harness requested model: opus
- Harness primary observed model: claude-opus-4-8
- Harness complete observed modelUsage: `[{"model":"claude-opus-4-8","input_tokens":6,"output_tokens":8134}]`
- Round-1 external-review remediation (this revision): claude-opus-5 subagent via the codex-review bridge session; gates re-run synchronously in the same worktree.

### Superseded — round-7 orchestrate-harness note (unchanged, still true)

The round-7 docs-commit bundle passes the real validator (all seven manifests +
content, exit 0), bound to the canonical Dev Notes `376faefb…`,
`qa-review.round-6`, verified provenance. The recurring `.orchestrate/`
provenance race is a harness behaviour — it persists each fix reply as the
*next* round's `dev-notes.md` before re-running QA, so any bound docs-commit is
superseded the instant it is written — and is not a source-code finding. Owner
action (freeze the canonical Dev Notes, or run docs-commit in its designed
position) remains outstanding and is independent of this code-review round.
