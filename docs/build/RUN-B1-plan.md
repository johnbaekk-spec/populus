Fixture arithmetic verified against `src/populus/views.sql:106-115` (NULL-total filings stay in the default view) and the cover-failed predicate at `src/populus/ingest/inst13f.py:1414-1419` (requires the flag). Here is the revised plan.

# plan-v1 — B1 (KI-4): institutional value-coverage must never publish above 100%

Transport: `orchestrated-artifact`. Scope class: **S** (one mechanism file, eight render sites, tests, three docs). Branch (existing, current): `fix/b1-ki4-coverage-never-above-one`, cut from `main` @ `89f6a18`.

## Goal and Success Criteria

Fix BACKLOG.md item B1 (KI-4): `compute_coverage` and `compute_period_coverage` in `src/populus/ingest/inst13f.py` report `numerator / denominator` unconditionally (`src/populus/ingest/inst13f.py:1440`, `src/populus/ingest/inst13f.py:1526`), so a population that is not measurable can publish a coverage ratio above 1 — a G5 honesty defect (`ARCHITECTURE.md:902`) on a live path.

Success means:
- No surface in the repo can render an institutional coverage ratio above 1 — including from a **pre-fix gate record already staged on disk**.
- A population that is not measurable (inflated, cover-failed, or numerator over denominator) reports `coverage = None` and renders as **unmeasurable** — never clamped, never 0%, never blank, never 100%.
- Raw `numerator`, `denominator`, `cover_failed_count`, and `inflated_filing_count` stay on the record unchanged, so the defect remains diagnosable.
- `certifiable` and `meets_threshold` are byte-identical to today for every input.
- Every changed renderer has its own `None`-arm and exact-numeric-arm test and its own named mutation; the missed mutation in `docs/build/M2-KNOWN-ISSUES.md:106-108` ("set the reported coverage to 99.0") is closed.
- Every current repository record stops presenting KI-4 as open, historical records preserved as historical.
- `make test` (no regression vs the pre-change baseline), `make security`, and `make accept-m2-6` green.

## Requirements

- **R1** — `compute_coverage` and `compute_period_coverage` must never return a `coverage` value above 1, under any database state (including stale-view and hand-built databases).
- **R2** — A population that is **not measurable** reports `coverage = None`, never a clamped or truncated number. Not measurable means any of: zero denominator, `numerator > denominator`, an unresolved cover conflict (`inflated_filing_count > 0`), or a cover-failed filing (`cover_failed_count > 0` — its unknown total contributes 0 to the denominator, so any ratio built over it is not a proportion), **regardless of whether the raw ratio is above or below 1**.
- **R3** — `numerator`, `denominator`, `cover_failed_count`, and `inflated_filing_count` on the returned records stay exactly as computed today (per-period sums included), so inflation and cover failure remain diagnosable.
- **R4** — `certifiable` and `meets_threshold` are computed from the same raw inputs as today and produce identical values for every input. No currently-refused population becomes publishable; no currently-publishable population becomes refused.
- **R5** — Every consumer of the coverage value handles `None` without crashing and states it as **unmeasurable** — never 0%, never blank, never 100%, never a bare "N/A" — while continuing to render a measurable value in its existing units and precision. Audited set: `scripts/accept_m2_5.py`, `scripts/accept_m2_6.py`, CLI build and publish reporting (`src/populus/cli.py`), the M2-3 publish path (`src/populus/publish/build.py`), the ingest summary (`src/populus/ingest/inst13f.py`), the bulk summary (`src/populus/inst_bulk.py`), and the `inst_health` MCP tool (audit outcome recorded even where no change is needed).
- **R6** — Per-period coverage carries the same obligations: a period that is inflated, cover-failed, or over-run reports `None`; unaffected periods keep their numeric ratio.
- **R7** — New tests FAIL against the current code for both `compute_coverage` and `compute_period_coverage`; **every changed renderer has its own `None`-rendering test and its own exact-numeric-output test**; every new or changed assertion has a named mutation that breaks it (mutation table in Testing Strategy).
- **R8** — `make test` green with no regression against the pre-change baseline (BACKLOG.md:8 cites 1645 at P3-2; the exact count on `89f6a18` is recorded from a baseline run before editing).
- **R9** — `make security` (dep_guard) clean.
- **R10** — `make accept-m2-6` green. `make accept-m2-5` runs only if its corpus is present locally and needs no network; otherwise its skip is reported explicitly with the missing prerequisite, never faked.
- **R11** — **Every current repository record stops presenting KI-4 as open**, and historical records stay historical: `BACKLOG.md` B1 marked done; `docs/build/M2-KNOWN-ISSUES.md` §4 (KI-4) and §5 annotated as remediated (dated); `STATUS.md:7` (the standing "⚠ M2 KNOWN ISSUES — four findings shipped open" callout, which still states an inflated filing "publishes `coverage = 1.2`") and `STATUS.md:62-67` (Pending, which directs the reader to start with B1/KI-4) corrected to the post-fix state. Dated build-log entries in `STATUS.md` and everything under `docs/build/RUN-*` are historical narrative and are **not** rewritten; `docs/build/M2-7-cover-tolerance-spec.md:12` describes M2-7's own motivation and is likewise left as written.
- **R12** — A **persisted** coverage value that is out of range, non-finite, or non-numeric (a pre-fix `.staging/` gate record carrying `1.2`, a `NaN`, a bool) renders as **unmeasurable** at the publish boundary, with the record's raw `numerator`/`denominator` still stated for diagnosis. Dataclass guards cannot protect mappings loaded from disk; this is the mapping-side guard.

## Scope

- `src/populus/ingest/inst13f.py`: the reported-ratio rule in `compute_coverage` and `compute_period_coverage`; a per-period cover-failed set; `CoverDisposition.period_of_report`; construction-time `> 1` guards on `InstCoverage` and `PeriodCoverage`; a shared `render_coverage_ratio`; docstrings on the changed symbols.
- The eight ratio-printing sites: `src/populus/ingest/inst13f.py:1943`, `src/populus/inst_bulk.py:1151-1155`, `src/populus/cli.py:724`, `src/populus/cli.py:752-756`, `src/populus/cli.py:936`, `scripts/accept_m2_5.py:192-196`, `scripts/accept_m2_5.py:222-232`, `scripts/accept_m2_6.py:271`.
- Tests: new KI-4 section in `tests/test_cover_tolerance.py`; per-surface renderer tests in `tests/test_inst_bulk.py`, `tests/test_publish.py`, `tests/test_accept_m2_5.py`, `tests/test_accept_m2_6.py`; restatement of the crafted-corpus assertions in `tests/test_inst_ingest.py`.
- Docs: `BACKLOG.md`, `docs/build/M2-KNOWN-ISSUES.md`, `STATUS.md`.

## Non-goals

- B2 (KI-1/KI-2 parse substrate) — the backlog forbids individual patches and requires a design review of `docs/build/RUN-M2-5-parse-substrate.md` first (BACKLOG.md:27-37). B3 (KI-3) and B4 likewise excluded.
- The dashboard (untouched; it renders no inst coverage ratio — `inst_agg` carries aggregates, not the gate ratio).
- The 0.95 threshold (`src/populus/ingest/inst13f.py:1295`), the M2-4 serving lifecycle, the M2-7 tolerance semantics, the denominator/numerator definitions, and the definitions of `certifiable` / `meets_threshold` / `inflated_filing_count` / `cover_failed_count`.
- Rewriting historical narrative: dated `STATUS.md` build-log updates and `docs/build/RUN-*` records stay as written (R11).
- **Changing which populations publish.** Named consequence, deliberately not fixed here: a NULL-total filing that is *not* flagged `cover_failed` and still carries resolved holdings produces `numerator > denominator` with `certifiable = True` (the default view keeps NULL-total filings — `src/populus/views.sql:109` — and the cover-failed count requires the flag — `src/populus/ingest/inst13f.py:1414-1419`), so it can clear the gate today. After this change it still clears the gate (R4 forbids flipping it) but reports **unmeasurable** instead of a >1 number. No known live trigger — a `13F-NT` notice reports no holdings (`src/populus/ingest/inst13f.py:1410-1413`) — so this is an edge/hand-built shape, and the `numerator <= denominator` term is defence-in-depth against it. Recorded as a follow-up under Tech Debt Introduced; changing gate semantics is a separate owner decision, not B1.
- No network access, no `populus publish`, no live ingest.

## Constraints

- Work only inside this worktree (`/Users/johnbaek/projects/Populus-ki4`); concurrent sessions write `../Populus-ops` and `../Populus-m25`; never touch `../populus-data`.
- Gates run offline: `make test`, `make security`, `make accept-m2-6` (`scripts/accept_m2_6.py` builds its own fixture and publishes to a LocalDirBackend). `make accept-m2-5` "ERRORS (never skips) when the full 13(f)-list files or the tracked Berkshire corpus are absent" (Makefile:61-66) — run only after confirming its inputs exist locally.
- Gate-record compatibility runs **both ways**: new records may carry `"coverage": null` in more cases, and old records may carry a >1 number. `_read_inst_gate_record` (`src/populus/cli.py:891-923`) already tolerates arbitrary JSON, and `cover_dispositions_from_mapping` (`src/populus/ingest/inst13f.py:1376-1383`) is the precedent for tolerant mapping readers. No published-artifact schema changes.
- Hash the tree before/after gate runs (frozen-tree discipline; BACKLOG.md:104-108).

## Current State

**The defect, on today's code (post-M2-7, `89f6a18`):**

- Corpus ratio: `coverage = numerator / denominator if denominator > 0 else None` (`src/populus/ingest/inst13f.py:1440`); per-period identically (`src/populus/ingest/inst13f.py:1526`). Neither bounds the ratio nor consults `inflated_filing_count` or `cover_failed_count`.
- The denominator banks `max(declared, resolved)` per filing via `_DENOMINATOR_TERM` (`src/populus/ingest/inst13f.py:1305-1312`) and `v_default_inst_filings` excludes beyond-tolerance conflicts (`src/populus/views.sql:106-115`), so the M2-5-era reproduction (declared 100 / resolved 120 → 1.2) no longer produces >1 — `tests/test_list13f_coverage.py:96-128` proves both routes land at ≤ 1.0. `docs/build/M2-KNOWN-ISSUES.md:95-115` is correct about the defect but stale about this mechanism.
- **The live >1 arithmetic today:** a filing with NULL `table_value_total_usd` contributes **0** to the denominator (`CASE WHEN … NULL THEN 0`, `src/populus/ingest/inst13f.py:1306`) while staying in the default view (`src/populus/views.sql:109`) and having its resolved holdings counted fully in the numerator (`src/populus/ingest/inst13f.py:1406-1409`). One such filing beside a small corpus pushes the reported ratio above 1, corpus-wide and per period. When it is flagged `cover_failed`, `certifiable` goes False (`src/populus/ingest/inst13f.py:1414-1419`, `1446-1451`) — but the number publishes either way.
- **Masked inflation:** an unresolved cover conflict (stale-view backstop, §I6) sets `inflated_filing_count > 0` and fails closed, yet the reported ratio is a fabricated-looking 1.0 built on a contradicted filing — `tests/test_cover_tolerance.py:308-331` asserts the gate outcome and (the missed mutation) never the reported value. Its comment still claims "publish at 1.001" (`tests/test_cover_tolerance.py:312`), stale since max-banking.
- **Numeric ratio over a non-measurable population:** cover-failed corpora report a number today with `certifiable = False`. The crafted test corpus is exactly this shape (`tests/test_inst_ingest.py:435` — `cover_failed_count >= 2`).
- **Legacy persisted values:** `src/populus/cli.py:936` formats any numeric gate-record `coverage` as a percentage with no range check, so a `.staging/` record written before this fix renders `120.00%` at the publish boundary regardless of any in-process guard.
- Per-period has no inflation or cover-failure input: `compute_period_coverage` (`src/populus/ingest/inst13f.py:1494-1544`) computes only sums; `CoverDisposition` (`src/populus/ingest/inst13f.py:1205-1216`) does not carry `period_of_report`; `_PER_FILING_COVER_SQL` (`src/populus/ingest/inst13f.py:1223-1231`) does not select it and skips NULL totals. Sole constructor site: `src/populus/ingest/inst13f.py:1249`.

**Consumers of the coverage value (full sweep, grep-verified):**

| # | Surface | Site | Measurable format today | Today on `None` |
|---|---|---|---|---|
| S1 | Ingest summary | `src/populus/ingest/inst13f.py:1943` | `{v*100:.2f}%` | `"N/A"` |
| S2 | Bulk summary | `src/populus/inst_bulk.py:1151-1155` | `{v*100:.2f}%` | `"N/A"` |
| S3 | CLI build, withheld notice | `src/populus/cli.py:724` | `{v*100:.2f}%` | `"N/A"` |
| S4 | CLI build, per-period lines | `src/populus/cli.py:752-756` | `{v*100:.2f}%` | `"N/A"` |
| S5 | CLI publish, gate record | `src/populus/cli.py:936` | `{v*100:.2f}%` | `"N/A"`; **no range check on numerics** |
| S6 | M2-5 acceptance, corpus line | `scripts/accept_m2_5.py:192-196` | `{v:.4f}` | `"N/A"` |
| S7 | M2-5 acceptance, period line | `scripts/accept_m2_5.py:222`, `230` | `{v:.4f}` | `"N/A"`, marked "BELOW 0.95 GATE" |
| S8 | M2-6 acceptance | `scripts/accept_m2_6.py:271`, `290-291` | `{v:.4f}` | `"N/A"`; `None` fails its gate check (correct) |
| — | M2-3 publish path | `src/populus/publish/build.py:1708-1763` | — | passes the field through as data; no arithmetic, no formatting |
| — | `inst_health` MCP tool | `src/populus/mcp_server/` | — | renders **no** ratio (`src/populus/mcp_server/inst_queries.py:485-487`; zero grep hits for `compute_coverage`/`InstCoverage` under that tree) |

Two distinct measurable formats (percent at 2 decimals; fraction at 4 decimals) exist and must both survive — this is what makes the shared renderer's `digits`/`percent` parameters behavioural rather than cosmetic. No consumer crashes on `None` today (per-period `None` already occurs for a zero denominator, `tests/test_publish.py:2311`), so R5's `None` arm is a wording obligation; R12 is the one genuine safety hole.

**Stale repository records (R11):** `STATUS.md:7` still states "four findings shipped open" and that "**KI-4** an inflated filing still *publishes* `coverage = 1.2`… the one to fix first"; `STATUS.md:65` still directs the reader to "start with **B1/KI-4**, the published-coverage-above-100% honesty defect"; `BACKLOG.md:17-25` and `docs/build/M2-KNOWN-ISSUES.md:95-115`, `130-134` describe it as open.

**Existing tests that pin behaviour (must stay green unless named below):** healthy `== 1.0` (`tests/test_cover_tolerance.py:171`, `224`, `466`), 0.9 below-threshold (`tests/test_cover_tolerance.py:186`, `tests/test_publish.py:2148` — `certifiable is True`, stays numeric), FTD-only 0.5 (`tests/test_list13f_coverage.py:150-157` — known totals, `cover_failed_count == 0`, stays numeric), per-period ≤1 sweep (`tests/test_publish.py:2264-2272`), determinism (`tests/test_cover_tolerance.py:431-443`), cover-failed gate outcome (`tests/test_cover_tolerance.py:474-493`, `tests/test_publish.py:2406-2412` — assert flags, not the ratio; unaffected).

**Existing tests this change necessarily rewrites:** `tests/test_inst_ingest.py:398-423` (`test_failed_zero_row_filing_drags_coverage_down`) runs over `crafted_conn`, whose corpus carries ≥2 cover-failed filings, so under R2 both `with_failed.coverage` and `without.coverage` become `None` and the assertions at `tests/test_inst_ingest.py:418`, `421-423` break (`<` on `None` raises `TypeError`). Restated in T2a. `tests/test_accept_m2_5.py:64-65` constructs `InstCoverage(..., coverage=1.2, ...)`, which the new guard forbids.

## Detected Stack

Python 3.12+ package under `src/populus/` (uv/Hatch, `uv sync --frozen`, committed lockfile), stdlib `sqlite3` with SQL views in `src/populus/views.sql`, `click` CLI (tests use `CliRunner().invoke(cli_main, [...])`, e.g. `tests/test_publish.py:2334`), `pytest` under `tests/` with cross-fixture reuse from `tests/test_inst_agg.py`, Makefile gates (`test`, `security` = `scripts/dep_guard.py`, `accept-m2-5`, `accept-m2-6`), plus an Astro 7/TypeScript 6 dashboard gate chain (npm, `node:test`) untouched here. MCP server under `src/populus/mcp_server/`.

## Reuse Map

- `classify_cover` / `cover_dispositions` (`src/populus/ingest/inst13f.py:1196-1257`) — **reuse** for per-period inflation via a `period_of_report` field, rather than a third copy of the tolerance predicate (it exists exactly twice by design — SQL in `views.sql`, Python here — with `tests/test_cover_tolerance.py:99-117` pinning agreement).
- The cover-failed predicate (`src/populus/ingest/inst13f.py:1414-1419`) — **reuse verbatim**, re-grouped by `period_of_report`, for the per-period cover-failed set; the two cannot drift because the predicate text is shared.
- `_DENOMINATOR_TERM` (`src/populus/ingest/inst13f.py:1305`) — **unchanged**.
- `format_cover_dispositions` / `cover_dispositions_from_mapping` (`src/populus/ingest/inst13f.py:1355-1383`) — **pattern followed**: one shared renderer plus a mapping-tolerant wrapper, exactly the shape R12 needs.
- Existing consumer tests — **reuse rather than rebuild**: `format_summary` assertions (`tests/test_cover_tolerance.py:288-302`), bulk CLI output assertions (`tests/test_inst_bulk.py:881`), `CliRunner` build/publish pattern (`tests/test_publish.py:2334`, `2361`), `_inst_absence_notice` direct-call pattern (`tests/test_inst_agg.py:686-705`, `tests/test_publish.py:2343-2360`), `_report_path` sink capture (`tests/test_accept_m2_5.py:103-132`), and the `dataclasses.replace`-on-the-way-out technique (`tests/test_accept_m2_6.py:61-96`).
- Fixtures `_fresh`/`_security`/`_file` (`tests/test_cover_tolerance.py:37-72`) and `_filer`/`_hold`/`_load` (`tests/test_inst_agg.py:45-109`, where `_load(total=None)` is the documented UNKNOWN-total form and `_hold(security_id=None)` the unresolved-holding form) — **reuse** for all new fixtures.

## Architecture

One rule, one renderer.

1. **The reported-ratio rule.** Reported coverage is a ratio only for a **measurable** population; otherwise `None`. In `compute_coverage` (`src/populus/ingest/inst13f.py:1440-1463`): keep `raw = numerator / denominator if denominator > 0 else None`; compute `certifiable` and `meets_threshold` from `raw` exactly as today (R4, gate byte-identical); then return `coverage = raw if (certifiable and numerator <= denominator) else None`. `certifiable` already encodes zero-denominator, cover-failed and inflated (`src/populus/ingest/inst13f.py:1446-1451`), so the rule reads as one sentence. The `numerator <= denominator` term is **independent and load-bearing**: it catches a NULL-total filing not flagged `cover_failed`, which no other term covers. It is an **integer** comparison, never `raw <= 1.0` — correctly-rounded division can return exactly 1.0 for a quotient marginally above 1 at 10^12 scale, silently passing a masked over-run.
2. **Per-period rule** (`src/populus/ingest/inst13f.py:1494-1544`): compute two period sets once — `inflated_periods` from `cover_dispositions(conn, view="v_default_inst_filings")` filtered to `COVER_CONFLICT`, and `cover_failed_periods` from the reused cover-failed predicate grouped by `period_of_report` — then per period `coverage = numerator / denominator if (denominator > 0 and numerator <= denominator and period not in inflated_periods and period not in cover_failed_periods) else None`. Same three disqualifiers as the corpus rule, so the two figures cannot disagree about measurability.
3. **`CoverDisposition`** gains `period_of_report: str`; `_PER_FILING_COVER_SQL` selects `f.period_of_report`; the single constructor site (`src/populus/ingest/inst13f.py:1249`) and row unpack update. The closed-set `view` interpolation and its `# nosec B608` (`src/populus/ingest/inst13f.py:1247`) are unchanged; the added column is a static identifier.
4. **Two guards, two populations.** `__post_init__` on `InstCoverage` and `PeriodCoverage` raises `ValueError` when `coverage is not None and coverage > 1` — R1 becomes structural for in-process records. Dataclass guards **cannot** protect values loaded from disk, so `render_coverage_ratio(value, *, digits=2, percent=True) -> str` in `src/populus/ingest/inst13f.py` (beside `format_cover_dispositions`) is the mapping-side guard: it returns `"unmeasurable"` unless the value is a real `int`/`float` (explicitly excluding `bool`, an `int` subclass), finite (not NaN/±inf), and `0 <= value <= 1`; otherwise it formats to the requested precision, scaling by 100 and appending `%` when `percent=True`. Both parameters are behavioural — S1–S5 call it as `percent=True, digits=2`, S6–S8 as `percent=False, digits=4` — matching each surface's existing output byte-for-byte. This is R12 and the single point of correctness for R5.
5. **Rendering.** All eight sites route their ratio token through `render_coverage_ratio`, keeping their surrounding format and always printing raw `numerator`/`denominator` beside it (R3 diagnosis). `src/populus/cli.py:936` additionally appends the record's raw `numerator`/`denominator` when present, so a legacy out-of-range record is readable rather than merely refused. `scripts/accept_m2_5.py:230` splits its `None` branch out of the "BELOW 0.95 GATE" marker into an explicit `UNMEASURABLE` marker (still `ok = False`).
6. **No change** to `src/populus/publish/build.py` (pure pass-through; its `reason` derivation at `1732-1738` reads `cover_failed_count`/`certifiable`, not the ratio) and **no change** to `src/populus/mcp_server/` (audited: renders no ratio). Both audit outcomes recorded in Dev Notes for R5.

## Locked Decisions

- **`None`, never clamp** (owner-mandated; `docs/build/M2-KNOWN-ISSUES.md:131-134`).
- **Not measurable ⇒ `None`**, where not measurable = `certifiable` is False (zero denominator, cover-failed, or inflated) **or** `numerator > denominator` — independent of whether the raw ratio is above or below 1.
- **Gate flags computed from the raw ratio before the reported field is derived** — R4 holds by construction.
- **Integer overrun test (`numerator <= denominator`), not a float bound.**
- **Per-period disqualifiers = the corpus disqualifiers**, from the same two predicates.
- **Masked inflation reports `None`** (the stale-view 1.0 is built on a contradicted filing).
- **Two guards:** dataclass `__post_init__` for in-process records, `render_coverage_ratio` type/finite/range validation for persisted mappings.
- **One rendering token, `unmeasurable`, from one helper**, at all eight sites; the helper preserves each surface's existing units and precision via `percent`/`digits`.
- `inflated_filing_count` and `cover_failed_count` keep their M2-7 definitions.
- **Gate semantics unchanged**, including for the unflagged NULL-total shape named under Non-goals.
- **Historical records stay historical** (R11): only standing/current statements are corrected.

## Alternatives Considered

- **Clamp to `min(ratio, 1.0)`** — rejected, explicitly forbidden: presents inflation as perfection.
- **Keep a numeric ratio for cover-failed populations** (an earlier revision) — rejected on review: the denominator excludes an unknown total, so the number is not a proportion of anything; `certifiable = False` already says "not measurable", and printing a percentage beside it contradicts it.
- **No shared renderer, per-site inline formatting** (an earlier revision) — reversed: the legacy-record hole (R12) needs a validating renderer anyway, and eight independently-edited sites are eight places to regress.
- **A renderer without `percent`/`digits` (one canonical output)** — rejected: it would silently change the acceptance scripts' 4-decimal fraction output and the CLI's 2-decimal percentage into one format, breaking existing output contracts; the parameters keep each surface byte-identical on the measurable path, and M16/M17 prove they are load-bearing.
- **Derive `certifiable`/`meets_threshold` from the new reported value** — rejected: couples the gate to the reporting change and risks flipping publishability (violates R4).
- **Per-period inflation via a third SQL copy of the tolerance predicate** — rejected: recreates the drift class M2-7 §I3 eliminated.
- **A `raw_coverage` field on `InstCoverage`** — rejected: `numerator`/`denominator` already carry the diagnosis (R3).
- **Float bound `raw <= 1.0`** — rejected: rounding can mask a marginal over-run.
- **Fix the gate for the unflagged NULL-total shape inside B1** — rejected: R4 forbids changing publishability; recorded as a follow-up instead.
- **Rewriting `STATUS.md`'s dated build-log entries** — rejected: they are historical narrative; only the standing callout and Pending pointer are corrected (R11).

## Planned Files

- `src/populus/ingest/inst13f.py` — reported-ratio rule (both functions); per-period cover-failed and inflated sets; `CoverDisposition.period_of_report`; `_PER_FILING_COVER_SQL`; `__post_init__` guards; `render_coverage_ratio`; S1 render site; docstrings.
- `src/populus/inst_bulk.py` — S2.
- `src/populus/cli.py` — S3, S4, S5 (S5 including the R12 legacy path and the raw-sum append).
- `scripts/accept_m2_5.py` — S6, S7 (`UNMEASURABLE` marker).
- `scripts/accept_m2_6.py` — S8.
- `tests/test_cover_tolerance.py` — new KI-4 section (core tests 1, 2, 3, 5, 6, 7, 8 and the S1 renderer test); extend `test_a_conflict_left_inside_the_view_still_fails_closed` (core test 4) and fix its stale comment.
- `tests/test_inst_bulk.py` — S2 renderer test.
- `tests/test_publish.py` — S3, S4, S5, S5-legacy renderer tests.
- `tests/test_accept_m2_5.py` — S6, S7 renderer tests; the hand-built inflated record becomes `coverage=None`.
- `tests/test_accept_m2_6.py` — S8 renderer test.
- `tests/test_inst_ingest.py` — restate the crafted-corpus assertions (T2a).
- `BACKLOG.md` — B1 done (R11).
- `docs/build/M2-KNOWN-ISSUES.md` — §4 and §5 remediated, dated (R11).
- `STATUS.md` — line 7 standing callout and the Pending block at lines 62-67 reconciled (R11).

## Implementation Tasks

- **T0 — Baseline (R8):** on the clean tree run `make test`; record the exact pass/skip count and a tree hash.
- **T1 — Red tests first (R7, R1, R2, R3, R6, R12):** add the tests below; record which FAIL on unmodified code and which gate assertions already pass (the R4 baseline).
- **T2 — Corpus rule (R1, R2, R3, R4):** implement Architecture §1; update the `InstCoverage.coverage` field docstring (`src/populus/ingest/inst13f.py:1327`) and the function docstring to state the three disqualifiers.
- **T2a — Restate the crafted-corpus test (R3, R4):** rewrite `tests/test_inst_ingest.py:398-423` so its property survives `coverage is None` on a cover-failed corpus — assert `with_failed.denominator - without.denominator == 5000000000`, `with_failed.numerator == without.numerator`, the drag computed from raw sums (`with_failed.numerator / with_failed.denominator < with_failed.numerator / without.denominator`), and `without.coverage is None` with `without.certifiable is False`. Then grep the suite for every remaining numeric `.coverage` assertion and confirm each sits on a certifiable population; restate any that does not.
- **T3 — Per-period rule (R1, R3, R6):** extend `CoverDisposition`/`_PER_FILING_COVER_SQL`/constructor with `period_of_report`; add the per-period cover-failed set; implement Architecture §2; docstring update.
- **T4 — Guards (R1, R6, R12):** `__post_init__` on both dataclasses; `render_coverage_ratio` with type/finite/range validation and `percent`/`digits`; update `tests/test_accept_m2_5.py:64-65` to `coverage=None`.
- **T5 — Renderers (R5, R12):** route S1–S8 through `render_coverage_ratio` with each surface's existing units/precision; append raw sums at S5; split the S7 `None` branch into `UNMEASURABLE`. Record the two no-change audit outcomes (`src/populus/publish/build.py`, `src/populus/mcp_server/`) in Dev Notes. Close with a grep proving no `"N/A"` remains on an inst-coverage surface.
- **T6 — Green + mutation verification (R7):** full suite green; then apply each mutation in the table singly, confirm the named test fails, revert. Record the table with outcomes in Dev Notes.
- **T7 — Docs propagation (R11):** BACKLOG.md B1 checked with a pointer; `docs/build/M2-KNOWN-ISSUES.md` §4 and §5 annotated as remediated (dated), noting the mechanism moved under M2-7 (the live >1 arithmetic is the NULL-total shape) and that non-measurable populations now report `None`; `STATUS.md:7` corrected from "four findings shipped open" to the post-fix count with KI-4 marked fixed and its `coverage = 1.2` sentence restated; `STATUS.md:62-67` Pending pointer updated so it no longer directs the reader to start with B1. Dated build-log entries and `docs/build/RUN-*` left untouched. Close with the R11 grep over `*.md` excluding `docs/build/RUN-*`, confirming no current statement presents KI-4 as open.
- **T8 — Gates (R8, R9, R10):** `make test` (compare to T0), `make security`, `make accept-m2-6`; `make accept-m2-5` run-or-report-skip. Hash the tree before/after each run.

## Testing Strategy

Core-rule tests live in a `KI-4` section of `tests/test_cover_tolerance.py` using `_fresh`/`_security`/`_file` and `_filer`/`_hold`/`_load`. Every multi-filing fixture uses **distinct CIKs** (so restatement/affiliation stages never merge them — `src/populus/views.sql:78-104`) and distinct CUSIPs where two filings share a period. **(RED)** marks a test that must fail against current code.

**Core rule:**

1. `test_corpus_coverage_is_none_for_a_cover_failed_overrun` — filing A (cik `0000000001`, APPLE, period `2026-03-31`) declared 1,000,000 / resolved 1,000,000; filing B (cik `0000000002`, MSFT, same period) `_load(total=None, flags=["cover_failed"], parse_status="failed", failure_kind="cover_malformed")` with one resolved holding of 500,000. Denominator 1,000,000 (B contributes 0 — `src/populus/ingest/inst13f.py:1306`), numerator 1,500,000. Assert `denominator == 1_000_000` and `numerator == 1_500_000` (R3); `coverage is None` **(RED — currently 1.5)**; `cover_failed_count == 1`, `inflated_filing_count == 0`, `certifiable is False`, `meets_threshold is False` (R4 pins, identical to today).
2. `test_corpus_coverage_is_none_when_the_numerator_exceeds_a_certifiable_denominator` — filing A (cik `0000000001`, APPLE) declared 1,000,000 / resolved 1,000,000 → **positive denominator**; filing B (cik `0000000002`, MSFT, same period) `_load(total=None, flags=[])` — NULL total, **no** `cover_failed` flag, `parse_status="parsed"` — with one resolved holding of 500,000. B is in the default view (`src/populus/views.sql:109`), contributes 0 to the denominator and 500,000 to the numerator; it is invisible to the cover-failed count (which requires the flag, `src/populus/ingest/inst13f.py:1414-1419`) and to `cover_dispositions` (which skips NULL totals, `src/populus/ingest/inst13f.py:1229`). Assert `denominator == 1_000_000`, `numerator == 1_500_000`, `cover_failed_count == 0`, `inflated_filing_count == 0`, **`certifiable is True`**, and `coverage is None` **(RED — currently 1.5)** — proving the `numerator <= denominator` term is independent of `certifiable` and that gate flags did not move (R1, R4).
3. `test_corpus_coverage_is_none_for_a_cover_failed_population_below_one` — filing A (cik `0000000001`, APPLE) declared 1,000,000 / resolved 800,000 → **positive denominator, raw ratio 0.8**; filing B (cik `0000000002`, MSFT, same period) `_load(total=None, flags=["cover_failed"])` with a single `_hold(..., security_id=None)` (unresolved, so it adds nothing to the numerator). Assert `denominator == 1_000_000` (explicitly `> 0`, so the `None` cannot come from the zero-denominator path), `numerator == 800_000`, `cover_failed_count == 1`, `certifiable is False`, and `coverage is None` **(RED — currently 0.8)** (R2: measurability is not about the ratio's size).
4. Extend `test_a_conflict_left_inside_the_view_still_fails_closed` (`tests/test_cover_tolerance.py:308-331`) — add `coverage is None` **(RED — currently 1.0, masked)**; keep `inflated_filing_count == 1`, `certifiable is False`, `meets_threshold is False`; fix the stale "1.001" comment.
5. `test_period_coverage_is_none_for_overrun_and_cover_failed_periods_only` — no view surgery. P1 `2026-03-31` = test 1's pair (ciks `0000000001`/`0000000002`); P2 `2026-06-30` = test 3's pair (ciks `0000000003`/`0000000004`); P3 `2026-09-30` = one clean filing (cik `0000000005`, APPLE) declared 10,000,000 / resolved 9,000,000. Assert P1 `coverage is None` **(RED — currently 1.5)** with `denominator == 1_000_000`, `numerator == 1_500_000`; P2 `coverage is None` **(RED — currently 0.8)** with raw sums retained; P3 `coverage == 0.9` (no over-Noneing) (R1, R3, R6).
6. `test_period_coverage_is_none_for_an_inflated_period` — stale-view rebuild (the technique at `tests/test_cover_tolerance.py:316-325`, which is global but only readmits conflicts). P1 `2026-03-31` = a conflict filing (cik `0000000001`, APPLE) declared 10,000,000 / resolved 10,010,001 → readmitted, denominator banks max = 10,010,001, numerator 10,010,001, raw 1.0 masked; P2 `2026-06-30` = a clean filing (cik `0000000002`, MSFT) declared 10,000,000 / resolved 9,000,000. Assert P1 `coverage is None` **(RED — currently 1.0)** with raw sums retained; P2 `coverage == 0.9` (R6).
7. `test_coverage_dataclasses_refuse_a_ratio_above_one` — `pytest.raises(ValueError)` for `InstCoverage(..., coverage=1.2, ...)` and the `PeriodCoverage` equivalent; `None` and `1.0` construct fine **(RED — no guard)**.
8. `test_render_coverage_ratio_domain_units_and_precision` — domain: `None`, `1.2`, `-0.1`, `float("nan")`, `float("inf")`, `True`, `"0.99"` → `"unmeasurable"`. Units and precision, on the same value: `render_coverage_ratio(0.9996, percent=True, digits=2) == "99.96%"` and `render_coverage_ratio(0.9996, percent=False, digits=4) == "0.9996"`; `render_coverage_ratio(1.0, percent=True, digits=2) == "100.00%"` (a genuinely measured 100% is still printable — only unmeasurable values are refused) **(RED — no helper)** (R5, R12).

**Per-surface renderer tests (R7), each with two arms.** *Unmeasurable arm:* output contains `unmeasurable` and the raw `numerator`/`denominator`, and contains none of `0.00%`, `100.00%`, `N/A`, or an empty ratio token. *Measurable arm:* a fixture or record whose coverage is exactly **0.9996** (e.g. `_file(declared=10_000_000, resolved=9_996_000)` for DB-driven surfaces) asserting the **exact** string — `"99.96%"` at S1–S5, `"0.9996"` at S6–S8 — which pins units and precision per surface.

| Surface | Test home | Technique (reused) |
|---|---|---|
| S1 ingest summary | `tests/test_cover_tolerance.py` | `format_summary(InstIngestReport(...))` as at `tests/test_cover_tolerance.py:288-302` |
| S2 bulk summary | `tests/test_inst_bulk.py` | bulk summary output assertion as at `tests/test_inst_bulk.py:881` |
| S3 CLI build withheld | `tests/test_publish.py` | `CliRunner().invoke(cli_main, ["build", ...])` over a cover-failed corpus, as at `tests/test_publish.py:2334` |
| S4 CLI build per-period | `tests/test_publish.py` | same invocation; assert the period line |
| S5 CLI publish, current record | `tests/test_publish.py` | `_inst_absence_notice` direct call, as at `tests/test_inst_agg.py:686-705`; both arms assert the raw sums appear |
| S5-legacy CLI publish, **stale `coverage: 1.2` record** | `tests/test_publish.py` | write a pre-fix record dict; assert `unmeasurable`, assert `"120.00%"` absent, assert the record's raw `numerator`/`denominator` present **(RED — currently renders 120.00%)** (R12) |
| S6/S7 M2-5 acceptance | `tests/test_accept_m2_5.py` | `_report_path` sink capture as at `tests/test_accept_m2_5.py:103-132`; assert the `UNMEASURABLE` period marker and `is False` |
| S8 M2-6 acceptance | `tests/test_accept_m2_6.py` | `dataclasses.replace(..., coverage=None)` / `coverage=0.9996` on the way out of ingest, as at `tests/test_accept_m2_6.py:61-96`; assert `unmeasurable` and a non-zero exit on the `None` arm |

**Mutation table (R7) — each applied singly at T6; the named test must fail:**

| # | Mutation | Killed by |
|---|---|---|
| M1 | Corpus rule → unconditional `numerator / denominator` | tests 1, 3 |
| M2 | Clamp: reported `= min(raw, 1.0)` | tests 1, 4 |
| M3 | Reported coverage `= 99.0` (the KI-4 named miss) | test 7 guard + test 1 |
| M4 | Drop the `inflated == 0` contribution to the reported rule | test 4 |
| M5 | Drop the `cover_failed == 0` contribution | tests 1, 3 |
| M6 | Drop the independent `numerator <= denominator` term | test 2 |
| M7 | Weaken `numerator <= denominator` to `<` | healthy pins `tests/test_cover_tolerance.py:171`, `224`, `466` |
| M8 | Per-period rule → unconditional ratio | test 5 (P1 and P2) |
| M9a | Drop the per-period cover-failed set | test 5 (P2) |
| M9b | Drop the per-period inflated set | test 6 (P1) |
| M10 | Zero out `numerator`/`denominator` when reporting `None` | raw-sum assertions in tests 1, 3, 5, 6 |
| M11 | Delete either `__post_init__` guard | test 7 |
| M12a–M12h | Render `None` as `"0.00%"`, `""`, `"N/A"`, or `"100.00%"` at each of S1, S2, S3, S4, S5, S6, S7, S8 (eight separate mutations) | the matching per-surface unmeasurable arm |
| M13 | Remove the range check from `render_coverage_ratio` | test 8 domain cases + S5-legacy |
| M14 | Remove the finite/type check (accept NaN, inf, bool, str) | test 8 domain cases |
| M15 | Derive `certifiable`/`meets_threshold` from the reported (None-able) value such that either flag flips | R4 pins in tests 1, 2, 4 + existing `tests/test_cover_tolerance.py:187-188`, `328-330` |
| M16 | `render_coverage_ratio` ignores `percent` (never scales by 100, never appends `%`) | test 8 units case + the exact `"99.96%"` measurable arms at S1, S2, S3, S4, S5 |
| M17 | `render_coverage_ratio` ignores `digits` (hardcodes 2 decimals) | test 8 precision case + the exact `"0.9996"` measurable arms at S6, S7, S8 |
| M18 | Delete the S5 raw `numerator`/`denominator` append | S5 current-record test and S5-legacy test |

## Verification Matrix

- **R1** → tests 1, 2, 5, 6, 7; mutations M1, M3, M6, M7, M8; existing ≤1 sweeps (`tests/test_publish.py:2264-2272`, `tests/test_cover_tolerance.py:273`, `535-536`).
- **R2** → tests 1, 3, 4; mutations M2, M4, M5.
- **R3** → raw-sum assertions in tests 1, 3, 5, 6 and in every per-surface test; mutations M10, M18.
- **R4** → gate-flag pins in tests 1, 2, 4; mutation M15; unchanged existing gate tests (`tests/test_cover_tolerance.py:136-138`, `186-188`, `328-330`, `486-489`; `tests/test_publish.py:2145-2152`, `2307-2313`, `2406-2412`); T2a restatement; T0-vs-T8 comparison.
- **R5** → all eight per-surface tests (both arms); mutations M12a–M12h, M16, M17; the T5 closing grep; Dev-Notes audit record for `src/populus/publish/build.py` and `src/populus/mcp_server/`.
- **R6** → tests 5, 6; mutations M8, M9a, M9b; existing per-period pins (`tests/test_cover_tolerance.py:505-542`, `tests/test_list13f_coverage.py:156`).
- **R7** → T1 red-run evidence + the complete T6 mutation table with per-mutation outcomes in Dev Notes.
- **R8** → `make test` at T0 and T8, identical-or-explained count, frozen-tree hashes.
- **R9** → `make security` exit 0.
- **R10** → `make accept-m2-6` exit 0; `make accept-m2-5` run-or-reported-skip with the concrete missing prerequisite.
- **R11** → BACKLOG.md B1 checked; `docs/build/M2-KNOWN-ISSUES.md` §4 and §5 annotated; `STATUS.md:7` and `STATUS.md:62-67` corrected; T7's closing grep over `*.md` (excluding `docs/build/RUN-*`) shows no current statement presenting KI-4 as open, and the dated build-log entries plus `docs/build/M2-7-cover-tolerance-spec.md:12` are unchanged.
- **R12** → test 8 and the S5-legacy stale-record test; mutations M13, M14, M18.

## Rollout / Rollback

Ordinary commit(s) on the existing branch `fix/b1-ki4-coverage-never-above-one`, merged to `main` after QA/review per the pipeline. No schema migration, no data rebuild, no view change, no published-artifact format change. Gate-record compatibility is two-way and covered: new records may carry `"coverage": null` in more cases (readers already tolerate it — `tests/test_publish.py:2311`), and pre-fix records carrying a >1 number now render as unmeasurable with their raw sums (R12). No coordination needed with the concurrent `../Populus-ops` / `../Populus-m25` sessions — this change alters no on-disk state they read.

Rollback: a single `git revert` of the merge; no state to clean up. Blast radius if reverted: the reported ratio regresses to today's defect and the docs overstate the fix; the gate is unaffected in both directions by design (R4).

## Simplicity Audit

Minimum coherent design: one measurability rule expressed twice (corpus, per-period) over shared predicates, one validating renderer, two construction guards. Complete enumeration of new surface:
- New function: `render_coverage_ratio` (one validating formatter with two parameters; ~12 lines).
- New field: `CoverDisposition.period_of_report`.
- New methods: `InstCoverage.__post_init__`, `PeriodCoverage.__post_init__` (three lines each).
- New local query: the per-period cover-failed set (the existing predicate, re-grouped).
- No new files, modules, classes, config, dependencies, or SQL views.

The shared renderer is a reversal of an earlier revision that planned eight inline edits, justified on two grounds: the persisted-record hole (R12) requires validation no inline format string performs, and eight independently-edited sites are eight independent regressions. Its `percent`/`digits` parameters are not decoration — the repo genuinely has two output contracts (2-decimal percent at S1–S5, 4-decimal fraction at S6–S8), and M16/M17 exist to prove both are preserved.

Still rejected: a `CoverageReport` wrapper type, a `raw_coverage` field, and a per-surface renderer family.

## Tech Debt Introduced

**None introduced.** Two pre-existing items are surfaced rather than hidden:

1. **Gate semantics for the unflagged NULL-total shape** (owner: project owner; impact: a hand-built or edge database with a NULL-total, non-`cover_failed` filing carrying resolved holdings can clear the ≥0.95 gate on an unmeasurable population — after this change it publishes while reporting `unmeasurable`, where today it publishes reporting a >1 number). Not fixed here because R4 forbids changing publishability. Removal condition: an owner decision on whether `numerator > denominator` should also de-certify — a one-line change to `certifiable` plus a re-run of the gate-outcome tests. Core test 2 is the executable demonstration of the shape, and T7 records it as a candidate backlog item.
2. **Pre-fix `.staging/` gate records** on disk still contain out-of-range values. Handled, not deferred: R12 renders them as unmeasurable with raw sums. No migration is performed because `.staging/` is operational state cleared after a publish (`src/populus/cli.py:949-956`).

Documentation debt is explicitly closed rather than accepted: R11 covers `STATUS.md` as well as `BACKLOG.md` and `docs/build/M2-KNOWN-ISSUES.md`, so no current operational record is knowingly left stale. The stale comment at `tests/test_cover_tolerance.py:312` is corrected in T1. No TODOs, temporary flags, or tolerated inconsistencies remain planned.

## Memory Touch-Points

- `plan-v1-literal-rid-tokens` — every R-id is written literally everywhere it appears; no ranges anywhere in this plan.
- `rebaseline-plan-when-code-lands` (failure-modes F1) — plan re-grounded on the M2-7 code at `89f6a18`; Current State records where `docs/build/M2-KNOWN-ISSUES.md` is stale about the mechanism.
- `verify-against-a-frozen-tree` — T0/T8 hash the tree around gate runs; a mismatch invalidates the run.
- `mutation-tests-pin-properties` — the mutation table pins properties (never-above-1, None-on-unmeasurable, raw-retention, gate-invariance, per-surface rendering, units and precision), and M7 exists specifically to catch an over-tightened predicate.
- `review-scope-decides-the-verdict` — Dev Notes will scope QA/review to the code diff and gate evidence, harness provenance out of scope.
- `orchestrate-worktree-isolation` — work confined to this worktree; concurrency restated under Constraints.
- `specify-before-rewriting` — consulted; not triggered (first fix round on this mechanism; B2's spec-first warning respected in Non-goals).
- `design-handoff-honesty-fold` — the principle it encodes (never let a surface delete honesty content) is why every renderer prints raw sums beside `unmeasurable`, and why the S5 append is mutation-pinned (M18).

## Failure-Mode Sweep

- **F0 full-set sweep** — applied: S1–S8 enumerated by grep across `src/`, `scripts/`, `tests/` (`"N/A"`, `coverage.coverage`, `compute_coverage`, `CoverDisposition(`), extended to *tests* (which surfaced T2a's crafted-corpus breakage) and to *docs* (which surfaced `STATUS.md:7`); dashboard exclusion justified.
- **F0 verify-don't-assume** — applied: the ">1 is still reachable post-M2-7" claim is derived from the actual `CASE WHEN NULL THEN 0` term, the numerator SQL, and `src/populus/views.sql:109`; the crafted corpus's cover-failed count is read from `tests/test_inst_ingest.py:435`; each new fixture's denominator/numerator arithmetic is stated explicitly so the asserted state is reachable; T1 proves each RED test red before any fix lands.
- **F0 secrets** — n/a.
- **F1 enumerate all consumers** — applied (S1–S8 plus two audited no-change surfaces, with each surface's measurable format recorded).
- **F1 gate-list completeness** — applied: `make test` (= `test-python` + `dashboard-gates`), `make security`, `make accept-m2-6`, conditional `make accept-m2-5` (Makefile:61-66).
- **F1 units + NULL state for every served field** — applied: `coverage` is a unitless ratio in [0, 1] or `None`; both the `None` rendering and the measurable units/precision are specified per surface and mutation-pinned (M16, M17).
- **F1 config renames / prod writes** — n/a.
- **F1 rebaseline on moved upstream** — applied.
- **F1 simplicity audit completeness** — applied (every new function, field, method, and query enumerated).
- **F2 full-tree gate scope** — applied: Makefile entrypoints over the whole tree, new tests included.
- **F2 behavioral-test validity** — applied: RED-first (T1) plus a mutation per behavioural change, including one per renderer and one per renderer parameter.
- **F2 stale comments after change** — applied: `tests/test_cover_tolerance.py:312` corrected; changed docstrings updated in T2/T3.
- **F2 SQL nosec / parameterization** — reviewed: `_PER_FILING_COVER_SQL` keeps its closed-set `view` interpolation and `# nosec B608`; the added column is a static identifier; the per-period cover-failed query takes no caller input.
- **F2 bulk SQL / pooled read-only / deploy runbook / CSS** — n/a.
- **F3 verify function end-to-end** — applied via `make accept-m2-6` (ingest→gate→publish) and the `CliRunner` build/publish renderer tests, not unit tests alone.
- **F3 doc-number reconciliation** — applied: R11 reconciles BACKLOG, M2-KNOWN-ISSUES and STATUS with a closing grep; T8 records the actual test count rather than restating 1645.
- **F3 ACL/RLS / destructive repair** — n/a.
- **F4 propagation sweep** — applied twice: T5's `"N/A"` grep over code, T7's KI-4 grep over `*.md` with historical paths excluded by rule, not by omission.
- **F5 transport/provenance** — harness-owned; out of plan scope.

## Definition of Done

- **R1** done when tests 1, 2, 5, 6, 7 pass, mutations M1, M3, M6, M7, M8 are killed, and no code path can return or construct a coverage above 1.
- **R2** done when tests 1, 3, 4 pass and mutations M2, M4, M5 are killed — every non-measurable population reports `None`, unclamped, whether its raw ratio is above or below 1.
- **R3** done when the raw-sum assertions in tests 1, 3, 5, 6 and every per-surface test pass and mutations M10 and M18 are killed.
- **R4** done when every pre-existing gate-outcome test passes unmodified, the R4 pins in tests 1, 2, 4 pass (including `certifiable is True` in test 2), M15 is killed, T2a's restatement preserves the original property, and the T0-vs-T8 comparison shows no behavioural regression.
- **R5** done when all eight per-surface tests pass on both arms, mutations M12a–M12h, M16 and M17 are killed, no inst-coverage surface renders `"N/A"`/blank/0%/100% for `None`, every surface's measurable output is byte-identical to today, and the publish-path and MCP audit outcomes are in Dev Notes.
- **R6** done when tests 5 and 6 pass and mutations M8, M9a, M9b are killed.
- **R7** done when the T1 red-run evidence and the complete T6 mutation table with per-mutation outcomes appear in Dev Notes.
- **R8** done when `make test` exits 0 with a count consistent with the T0 baseline on a hash-stable tree.
- **R9** done when `make security` exits 0.
- **R10** done when `make accept-m2-6` exits 0, and `make accept-m2-5` either exits 0 locally or its skip is reported with the concrete missing prerequisite.
- **R11** done when BACKLOG.md shows B1 complete, `docs/build/M2-KNOWN-ISSUES.md` §4 and §5 carry the dated remediation annotation, `STATUS.md:7` and the Pending block no longer present KI-4 as open, the closing grep is clean, and the dated build-log entries and `docs/build/RUN-*` records are unchanged.
- **R12** done when test 8 and the S5-legacy stale-record test pass, mutations M13, M14 and M18 are killed, and a pre-fix record carrying `1.2` renders as unmeasurable with its raw sums at the publish boundary.
