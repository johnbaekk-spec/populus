# Populus — agent instructions

The `workflow-gates` block below is read by the v12 workflow
(`~/.claude/skills/_shared/bridge/workflow-artifacts.md`, Declared gates). Its commands come
from Populus's own standing gates: the `Makefile` canonical gate chain, `README.md` "The
two-tier gate model", and `.github/workflows/checks.yml`. Change them there first, then here.

`test` mirrors Makefile `test` (`test-python` + `dashboard-gates`, i.e. dashboard
`package.json` `gates`) step for step, without `test:post`. It is owner-tier: it needs 32 GiB
of physical RAM, Chromium, and a published data build (the Makefile's Environment note). If
`package.json` `gates` changes, the `test` line must change with it. Known conflict as of
2026-10-28: with `POPULUS_INST_DB` or `POPULUS_INST_SERVING_DB` set, `npm test`'s
`activity.test.ts` and `inst.test.ts` load the real serving database and exhaust the default
4 GiB heap, so no single environment passes the whole chain yet.

`test:post` is the report-only `quality` gate, matching its A4-02 report-only treatment in
`publish.yml`. It reads the `dashboard/dist` that the `test` gate builds. The runner runs it
after `test`, but also when `test` failed before `build:bounded`, so a quality record means
something only when the same run's `test` reached the build; otherwise it measures a missing
or older `dist/`. Baseline as of 2026-10-28: 16 of 120 fail on main (publish run 40693709235).

<!-- workflow-gates:begin -->
- test: make test-python && cd dashboard && npm ci && npm run check && npm test && npm run build:bounded && npm run geometry:install && npm run test:geometry && npm run test:holders-browser
- typecheck: cd dashboard && npm ci && npx astro check
- security: make security && make abs-paths
- quality: cd dashboard && npm run test:post
- quality-mode: report-only
- risk-paths: src/populus/deploy/**, src/populus/publish/**, src/populus/*.sql, src/populus/db.py, src/populus/inst_serving.py, src/populus/inst_redaction.py, src/populus/mcp_server/**, src/populus/client/**, scripts/inst_snapshot.py, ops/**, .github/**, dashboard/public/_headers, dashboard/astro.config.mjs
- critical-paths: src/populus/parse/**, src/populus/ingest/**, src/populus/normalize.py, src/populus/normalize_inst.py, src/populus/amendments.py, src/populus/load.py, src/populus/canonical.py, src/populus/parse_gate.py, src/populus/inst_agg.py, src/populus/stats.py
<!-- workflow-gates:end -->
