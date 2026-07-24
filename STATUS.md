# Populus — Build Status (autonomous build session, 2026-07-22 → 07-23)

**Bottom line:** M1 (congressional trading) is **5 of 6 build-runs complete and merged to `main`**, and the merged system **works end-to-end on real government data**. The final run (Run 6, the MCP server) is **blocked only by a hard monthly Fable spend limit** — not by any technical problem. See **Resume** below.

## What is built, merged, and verified

All on `~/projects/populus` `main` (private GitHub: `johnbaekk-spec/populus`). Each run went through the full orchestrate.sh loop — Fable plan → Codex (gpt-5.6-sol xhigh) plan review to approval → Fable dev → deterministic gates → Opus QA synthesis → Codex QA review to approval → squash-merge — and I independently re-ran the suite + real-corpus acceptance before each merge.

| Run | PR | Scope | Real-data result |
|---|---|---|---|
| 1 substrate | #1 | schema (§9.4 DDL), RFC-8785 canonical identity, atomic per-filing load, CLI skeleton, G1 dep-guard | 148 tests |
| 2 house | #2 | House ZIP index + PTR PDF ingest/classify/parse/normalize, golden corpus, reconciliation | **97.5%** e-file parse coverage on the real 312-PTR 2026 corpus (P1 gate ≥97%) |
| 3 senate | #3 | eFD session handshake, DataTables watermark query, 9-col HTML parser, paper→needs_ocr, politeness floors + circuit breaker | **100%** e-file parse on the real 53-filing corpus |
| 4 members/backfill | #4 | congress-legislators join (temporal aliases), kadoa import (OGE excluded) + crosswalk + sealed-draw audit sampler, amendment views, stats, license register | **100%** member-join coverage (P1 gate ≥98%) |
| 5 publish | #5 | §5.5 build/manifest/signed-pointer state machine/logical digest, §12.1 dist-digest+inventory, crash-consistent snapshot client, journal publish + fresh-runner recovery, external monitor, workflow files, licensing artifacts | 918 tests; see note below |

**End-to-end integration test (real data, this session), on merged `main`:**
`db init → ingest house(312) + senate(53) + backfill + members → stats → build → publish → verify` all succeed — build `20260724.1`, 906 artifacts, logical digest computed, pointer v1, verify recomputed all 906 artifacts OK. The pipeline is real and working.

**Test suite:** `uv run pytest -q` → **918 passed** on `main`. `scripts/dep_guard.py` clean (no paid/vendor deps — G1).

### Note on Run 5 (publish protocol)
The most security-sensitive subsystem; it took **nine external Codex review rounds** (QA-only mode), every finding fixed and verified load-bearing, hardened by class: uncaught decode/sqlite, auth-token scoping (token only to api.github.com, stripped on cross-origin redirect), deep JSON shape validation, path containment via single chokepoints (`_safe_path`/`_safe_under`/`resolve_within` + strict build_id/module grammar), cache/pointer trust-binding, manifest completeness, publish/rollback ordering, owned-base symlink refusal. An independent Opus QA synthesis returned **PASS (no functional defects)**. Two items are **owner-accepted, documented** boundaries (in `docs/runbooks/disaster-recovery.md` + the RUN-5 dev notes), reaffirmed under review:
1. The pre-draft crash boundary is benign safe-refuse+rebuild, not same-build_id recovery (committing the ~35 MB DB-inlining journal to git would regress DR-5 git-bloat).
2. The configured `data_repo`/`state_dir` roots themselves are trusted operator inputs; a symlinked configured-root is out of the §14 threat model (precondition = publisher-filesystem compromise). Populus-owned base subdirs/files *are* symlink-refused.
The merge was made on this convergent evidence (918 green + nine all-fixed Codex rounds + Opus PASS + documented out-of-scope perimeter) after tooling flakiness (a transient Codex failure and a synthesis heading-schema error) denied a clean tenth machine-verdict; the substance was unambiguous.

## Blocker (why Run 6 hasn't run)

**Monthly Fable 5 spend limit reached.** The orchestrate loop spawns headless `claude -p` (Fable) subprocesses for plan/dev/fix/synthesis; these now fail immediately with *"You've hit your monthly spend limit."* This is a billing cap, not a technical issue, and cannot be worked around from here (I will not bypass a spend cap). Codex reviews are unaffected (separate ChatGPT subscription).

## Pending

1. **Run 6 — MCP server (`populus-mcp`).** Brief: `docs/build/RUN-6-brief.md`. Six analyst tools (`congress_recent_trades`, `congress_member_lookup`, `congress_member_activity`, `congress_ticker_activity` w/ modes, `congress_latest_filings`, `congress_health`) + `populus_health`, FastMCP stdio over the Run-5 snapshot client, response envelope (dual dates, `doc_url`, `license_notices`, §9.8 lag `data_note`), 20-question golden suite computed from the real cache corpus.
2. **Integration QA + adversarial review pass** across the whole M1 (planned after Run 6).
3. **Not started / deferred by design:** M2 13F, M3 financials, M4 macro (later modules, one at a time per G12); the P3 dashboard; OQ-1 domain (deferred by owner — `populusfinance.com` collides with Populus Financial Group; candidates listed in ARCHITECTURE OQ-1); the PyPI `populus-mcp 0.0.1` placeholder (P0 owner action).

## Resume (when the spend limit is lifted / resets)

```bash
# Run 6 (MCP server) — resumes the exact same orchestrated flow:
cd ~/projects && ORCH_ASSUME_YES=skip-human-gate ORCH_PROFILE=quality WORKFLOW_MAX_ARTIFACT_BYTES=8388608 \
  ./orchestrate-tool/orchestrate.sh Populus "Implement RUN 6 (MCP server) per docs/build/RUN-6-brief.md; ARCHITECTURE.md governs (§9.9, §11); reuse RUNs 1-5 seams incl. the Run-5 snapshot client; 20-question golden suite from the real data-cache corpus; tests green under 'uv run pytest -q'."
```
Real source corpus is cached under `~/projects/Populus/data-cache/` (gitignored): House 2013/2015/2020/2026 indexes + 312 2026 PTR PDFs, 53 Senate pages, kadoa `trades.json`, legislators YAML. Golden fixtures are committed under `tests/fixtures/`.

*Tooling note:* two orchestrate.sh bugs found and fixed during the build (committed in `~/projects/orchestrate-tool`): a `RESOLUTION NOTES` heading case/markdown-tolerance gate, and a reviewer-prompt that mis-flagged stripped plan revisions. A `WORKFLOW_MAX_ARTIFACT_BYTES=8388608` override is needed for runs with large golden-fixture diffs.
