# RUN 1 — substrate-core

**Source of truth:** `ARCHITECTURE.md` (repo root, v2.12+). Cited sections are normative; where this brief and the architecture disagree, the architecture wins. Do not relitigate settled decisions (DR-1..10, guardrails G1–G15).

## Scope (this run owns these files; touch nothing else except pyproject/tests)

- `pyproject.toml`, `.python-version` — Python **3.12** pinned, `uv`-managed; deps: `httpx`, `lxml`, `pdfplumber`, `pypdf`, `pyyaml`, `click`, `rfc8785` (or vendored JCS if that package is unsuitable — verify on PyPI first), `pytest` (dev). **G1:** no paid/vendor SDKs, ever (denylist: polygon/massive/quiverquant/unusualwhales — add a CI-able check script `scripts/dep_guard.py`).
- `src/populus/__init__.py`, `src/populus/db.py`, `src/populus/schema.sql`, `src/populus/canonical.py`, `src/populus/load.py`, `src/populus/cli.py` (skeleton), `tests/test_schema.py`, `tests/test_canonical.py`, `tests/test_load.py`.

## Requirements

1. **Schema** (§9.4 — transcribe the DDL *exactly*, including CHECK constraints, `json_valid` checks on `raw_row`/`flags`, the temporal `member_aliases` table with `alias_no_overlap` index, `filings.lifecycle` vs `parse_status` separation, `ingest_runs`): `schema.sql` + `populus db init` CLI. Foreign keys ON.
2. **Canonicalization** (`canonical.py`): RFC 8785 (JCS) serialization of `raw_row` objects (NFC at extraction, `null` ≠ empty string); `row_fingerprint = sha256(jcs(raw_row))` full hex; `txn_id = f"{filing_id}:{fingerprint[:32]}"` + `#<dup_seq>` when `dup_seq > 1` (§9.4). `dup_seq` ordering by source coordinates (`source_row_no` else printed order) among identical fingerprints.
3. **Atomic per-filing load** (`load.py`, §9.4): one transaction — `DELETE FROM transactions WHERE filing_id=?` → insert full parsed set → update `filings` row (parse_status, parser_version, row_count). Idempotent re-load proven by test. `license_id` stamped per row from the filing's register entry.
4. **CLI skeleton** (`cli.py`, §5.3): `populus` entry point with subcommand stubs `ingest/reparse/build/publish/verify/stats` (working: `db init`; stubs raise NotImplementedError with the owning RUN number).
5. **Tests** (must pass under `uv run pytest`): DDL executes; invalid `raw_row` JSON rejected by CHECK; boolean CHECKs enforced; fingerprint invariant to key order + normalization-version changes; identical-duplicate `dup_seq` assignment; atomic reload leaves no ghost rows and preserves `txn_id` of unchanged rows; a reload that drops one row removes exactly it.

## Acceptance

`uv sync && uv run pytest -q` green; `uv run populus db init /tmp/t.db` creates all tables/indexes; `scripts/dep_guard.py` passes. No network use in this run.
