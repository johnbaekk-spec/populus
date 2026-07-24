# `cnsfails-real-excerpt.txt` — provenance

A **verbatim** excerpt of a real SEC fails-to-deliver archive, committed so the
parser is gated against the provider's actual bytes rather than a hand-written
header that could pass every test while the real archive fails (R14).

| Field | Value |
|---|---|
| `license_id` | `sec-ftd` (see `DATA-LICENSE.md`; the register entry permits redistributing a provenance-recorded excerpt as a repository fixture) |
| Source page | <https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data> |
| Archive URL | <https://www.sec.gov/files/data/fails-deliver-data/cnsfails202606b.zip> |
| Archive filename | `cnsfails202606b.zip` (the filename named in the plan; **no substitution was needed** — it returned 200) |
| Archive sha256 | `eacc947fdf3661a33bbcbcf112ae92dd05740083ef8fa82a6d4a4498b4622a2c` |
| Archive member | `cnsfails202606b.txt` (4,395,070 bytes, 69,964 lines) |
| Retrieved | 2026-07-24, `curl -H 'User-Agent: Populus johnbaekk@gmail.com' -H 'Accept-Encoding: gzip, deflate'` |
| Excerpt sha256 | `3d29d94087f3eb7498a132652d784f1c1f08884dcaedd409646a549e803f8946` |

## What the excerpt contains

Byte-for-byte, with no edits, reordering, or redaction:

- **line 1** — the archive's real header:
  `SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE`
- **lines 2–21** — the archive's first 20 data rows (settlement date `20260615`),
  including the international-issue CUSIPs (`B38564108`, `G0R38G112`, …) that
  prove a CUSIP is **not** all-numeric, and issuer descriptions containing the
  `|`-free but parenthesis-bearing text the parser must not choke on.
- **lines 22–23** — the archive's two real trailer lines,
  `Trailer record count 69961` and `Trailer total quantity of shares 5742687574`,
  which carry no `|` and must be dispositioned as `rejected_blank`, never as
  malformed data rows.

## Whole-archive counts (recorded 2026-07-24)

The full archive holds **69,964** lines: 1 header + **69,961** data rows + 2
trailer lines. `Trailer record count 69961` reconciles exactly with the data-row
count, which is how the acceptance run in the plan's Rollout §6 is checked.

## Condition carried from the register

`sec-ftd` rows are **point-in-time settlement-date observations**. Validity is
never inferred across a gap between observed dates (G14): the excerpt's rows all
share one settlement date and therefore produce one one-day validity interval per
CUSIP, not a range.
