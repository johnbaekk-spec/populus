# `tests/fixtures/inst/13flist/` — provenance

**Verbatim** excerpts of the SEC Official List of Section 13(f) Securities,
committed so the RUN M2-5 parsers are gated against the SEC's actual bytes —
the fixed-width text layout, the PDF's x-anchored columns, its legend semantics,
and the cross-format (R5) identity — rather than hand-written stand-ins that
could pass every test while the real files fail.

| Field | Value |
|---|---|
| `license_id` | `sec-13f-list` (see `DATA-LICENSE.md`; the register entry permits redistributing a provenance-recorded excerpt as a repository fixture, with the verbatim CGS/ABA notice attached — see below) |
| Index page | <https://www.sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities> (the old `sec.gov/divisions/investment/13flists.htm` 301-redirects there) |
| File pattern | `https://www.sec.gov/files/investment/13flist{YYYY}q{N}.pdf` and, for the latest quarter only, the `-txt.txt` variant |
| Retrieved | 2026-07-30, User-Agent `populus-mcp/0.0.1 johnbaekk@gmail.com` (recorded in each cached `.meta.json` sidecar) |

## Required notice (CGS/ABA — travels with every excerpt)

> Copyright (c) American Bankers Association (ABA). All rights reserved. CUSIP
> Numbers and descriptions are used with permission by CUSIP Global Services
> (CGS), which is operated by FactSet Research Systems Inc., on behalf of the
> ABA. No redistribution without permission of CGS. CGS does not guarantee the
> accuracy or completeness of the CUSIP Numbers and standard descriptions
> included herein and none of CGS, ABA or FactSet shall be responsible for any
> errors, omissions or damages arising out of the use of such information.

The register entry (`sec-13f-list`) carries the counsel-gate flag
`cusip-redistribution` for this reason.

## Source archives (full files, gitignored under `data-cache/13flist/`)

| Quarter | Archive URL | Archive sha256 |
|---|---|---|
| 2025Q1 pdf | `.../13flist2025q1.pdf` | `6f3369769b5106e1bbe272b46662ff21b42c73cf719e982f9e8c905867ead1e3` |
| 2025Q2 pdf | `.../13flist2025q2.pdf` | `877f9468410bcea6cf74ca3b5951e0c73599a6d7006f61f41faf4c750e3b7da2` |
| 2025Q3 pdf | `.../13flist2025q3.pdf` | `d4af9aa16a339509f1a2a5e08dca7d4098e99651dd954ffad462e5913c2dea8d` |
| 2025Q4 pdf | `.../13flist2025q4.pdf` | `36c17d808a36820526d017850d147983b77203365bf7bbb26ec9141ce21dc3e2` |
| 2026Q1 pdf | `.../13flist2026q1.pdf` | `a1518123a663aa4b7c5c9b4582ccdbf45c2e67a07cf662629c77c8fbe6dea1c2` |
| 2026Q2 pdf | `.../13flist2026q2.pdf` | `9fcf5808794e853e72aa07d73b64329b1c05d5277e12d8189275857f75225891` |
| 2026Q2 txt | `.../13flist2026q2-txt.txt` | `42e524a7d6901bdba97d517441452453b3630466f614a6fe9d9b282b200e0849` |

The full 2026Q2 text file is 2,051,973 bytes / 25,333 rows; the full 2026Q2 PDF
is 748 pages. The full files are the inputs to `make accept-m2-5` (which ERRORS
if they are absent); the committed excerpts here are for the hermetic suite.

## What the excerpts contain

Each excerpt is a **verbatim clip** — no edits, reordering, or redaction:

- **`13flist2026q2-excerpt.pdf`** (sha256 `8eb003bca537b041419a0ca7278f90ebf18a56a9f10ed63ce94cbb9fda7fba3e`, 304,278 bytes) — pages 0–2 of the full 2026Q2 PDF, extracted with `pypdf`: the **cover** (page 0, carrying the CGS/ABA CUSIP copyright + "No redistribution without permission of CGS" notice — the R1 ground truth), the **legend / USER INFORMATION SHEET** (page 1, the ADDED/DELETED and option-asterisk semantics — the R4 ground truth), and the **first data page** (page 2, 34 rows with the repeated `Run Date`/`Run Time`/`CUSIP NO ISSUER NAME ISSUER DESCRIPTION STATUS` header).
- **`13flist2026q2-excerpt.txt`** (sha256 `593a049a62a493ac4d32202eb7ad599dfd02e2a89232d7b94766e3023e065b88`, 2,754 bytes) — the **first 34 rows** of the full 2026Q2 text file, byte-for-byte (each row exactly 80 chars). These are the SAME 34 rows the PDF's first data page carries, so `assert_cross_format_identity` holds on the pair (R5): CUSIP `B38564108` (CMB.TECH NV) through `F21107…`, including the option asterisk on the underlying, the three CALL/PUT legs per optionable issuer, and the STATUS column.
- **`13flist{2025q1,2025q2,2025q3,2025q4,2026q1}-excerpt.pdf`** — pages 0–2 of each historical (PDF-only) quarter, for the per-era PDF parse tests. The **2025Q1** legend deliberately reads "quarter ending March 31, **2024**" (stale SEC boilerplate) while its in-document `Year: 2025 Qtr:1` header and filename are correct — the fixture that pins Locked Decision 1 (the filename/URL, not the legend date, is the authoritative quarter).

| Excerpt | sha256 | bytes | data rows |
|---|---|---|---|
| `13flist2026q2-excerpt.pdf` | `8eb003bca537b041419a0ca7278f90ebf18a56a9f10ed63ce94cbb9fda7fba3e` | 304278 | 34 |
| `13flist2026q2-excerpt.txt` | `593a049a62a493ac4d32202eb7ad599dfd02e2a89232d7b94766e3023e065b88` | 2754 | 34 |
| `13flist2025q1-excerpt.pdf` | `be9441f2157bcb74f3f8c6524aa4220c7a00d49e0f5f6836d28104151a722bc7` | 229110 | 34 |
| `13flist2025q2-excerpt.pdf` | `0edc63d0ed5e71e6479eee3aea1efac2d40a9b6161cb76c9f2b60d4ba8ded0fe` | 247391 | 34 |
| `13flist2025q3-excerpt.pdf` | `f4b2067ac0d6185dd2c6e3998af63e893afd147bd67453876bcf51ff7548e1ee` | 290115 | 34 |
| `13flist2025q4-excerpt.pdf` | `c1e9e3fe2144525d766462ae47fda4fd8ee1975566b3441e07bc0bae00c47b53` | 323919 | 34 |
| `13flist2026q1-excerpt.pdf` | `644fb00e5527a80a995fad2b5ff3207d8da45e5ac878d408955c497674213014` | 338126 | 34 |

`tests/fixtures/inst/expected/list13f-2026q2.expected.json` is the golden parse
of `13flist2026q2-excerpt.txt` (disposition + records + raw rows); regenerate
with `UPDATE_GOLDENS=1` when the parser output legitimately changes.
