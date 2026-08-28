# Slice 4 — residual classification (T4.4)

Program scaffolding for REPOSITORY-PROFESSIONALIZATION; deleted with the plan at
program end.

## Plan error: the mandated scan under-matches on this machine

The T4.1 command (`git grep -nE "$RX" …`) is defective here: this git's `-E`
engine treats `\b` as a literal, so all seven `\b`-anchored token families
(bare `R<n>`, `F<n>`, `B<n>`, `C<n>-C<n>`, `T<n>.<n>`, `SL-R<n>`, `KI-*`,
`OQ-*`) silently never matched. The plan's "326 matches / 80 files" baseline
was measured with the same defective command. Measured here at slice start:
`-E` 331 matches / 85 files; the same pattern under `git grep -P` found
~1,164 matched lines. The slice therefore ran the mandated `-E` sweep first
and a full PCRE (`-P`) follow-up sweep second; the classification below is
against the **stricter `-P` scan**, which subsumes the `-E` one (final `-E`
count: 0).

## Final scan result

`git grep -nP "$RX" -- src dashboard/src` → 49 matched lines, 0 in
`dashboard/src`, all in `src/populus`, every one classified below. Zero
unclassified matches; zero opaque provenance markers remain.

## Classification — every surviving match

(a) legitimate identifier or prose — not a provenance marker:

- `# nosec B608` (33 lines: amendments.py, backfill.py, identity/registry.py,
  ingest/house.py, ingest/senate.py, ingest/inst13f.py, inst_agg.py,
  inst_serving.py, load.py, publish/build.py, publish/digests.py,
  publish/seed.py, stats.py) — Bandit rule id for the SQL-string check; a
  live lint-suppression directive, not provenance. Includes seed.py:332,
  which *names* the annotation in a comment.
- `# nosec B404` / `# nosec B603` / `# nosec B607` (upload.py:61,154;
  publish/build.py:26,391) — Bandit subprocess rule ids, same class.
- `# noqa: B007` (inst_serving.py:200) — flake8-bugbear rule id, same class.
- `src/populus/aliases.yaml:169` `bioguide_id: F000468` — a real
  congressional bioguide identifier (data value).
- `src/populus/schema.sql:32` `(map: OQ-2)` — sits inside a `CREATE TABLE`
  body whose exact DDL bytes are stored in `sqlite_master` of every published
  snapshot; editing the comment would make packaged DDL diverge from live
  databases. Left for a future schema-touching change to carry.

(c) historical incident provenance, deliberately kept and test-pinned:

- `publish/seed.py:8,10,151,440,534` — **B24**/**B25** name the two real
  corpus-loss incidents this module exists to prevent. The module docstring
  defines both in full, so the ids are documented terms, not opaque tags, and
  `tests/test_corpus_seed.py` + `tests/test_workflow_governance.py` (out of
  scope for this slice) assert message text containing them.

(d) durable, test-pinned contract text:

- `deploy/orchestrator.py:1011` `"bytes (R10); aborting with production
  untouched."` — exception message asserted verbatim by the deploy test
  suite; test files are out of slice scope, so the message is unchanged.
  A future test-touching change can retire the token with its assertion.

No (b) active-run artifact names survive in production source.

## Also out of scope by plan

Test filenames (`dashboard/test/r10-*`, `r16-*`, `sl-*`, `r-codex-*`) and
everything under `tests/`/`dashboard/test/` — T4.1 scopes the sweep to
`src/` and `dashboard/src/` only.
