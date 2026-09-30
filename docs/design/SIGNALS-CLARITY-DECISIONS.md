# Signals clarity — decision record

Dated record for the SIGNALS-CLARITY run (plan: `PLAN.md` in the `signals-clarity` worktree,
Codex-approved round 3; owner decisions taken in chat on 2026-09-28). This file records the
decisions that **reverse an earlier reviewed placement**, so the reversal is on the record rather
than read off a changed test.

## 2026-09-29 — M1: the minimal footer

### What was measured

- **Before.** On the live build of 2026-09-28 the footer was five blocks — the prohibited-uses
  (or 13F caveat) paragraph, the source list with DATA-LICENSE / NOTICE links, the Financials and
  Macro SOON links with Methodology, the theme toggle, and the build/code watermark with the
  "no cookies" line — and **206 px** tall at 1440 px width (plan measurement).
- **After.** One row (brand, three links, theme toggle) plus one notice sentence: **79.5 px** tall
  at 1440 px on `/`, `/institutional/` and `/methodology/` (target ≤ 96 px), with the row on one
  line; 152.5 px at 375 px, where the row wraps and nothing is hidden. Measured 2026-09-29 in
  Chromium on a local build of data build 20260817.1 (`getBoundingClientRect` of
  `footer.site-footer`); the geometry suite re-asserts ≤ 96 px at 1440 on every run.

### Decisions

**L1 — the notice property is kept; the mechanism changes (reversal named).**
`ARCHITECTURE.md` §12.2 / §15.2 and `docs/frontend/design-principles.md` §1 placed the required
notices — the §13107(c) prohibited-uses text, source attributions, "not financial advice" and the
build id — *in the footer and on /methodology*. This run **reverses the footer half of that
placement.** The property the register protects (`src/populus/licenses.json`: "Notices are
non-removable from consumer output") is kept:

- every page still carries the §13107(c) restriction and "not financial advice", in one footer
  sentence: "Not financial advice. Use of congressional disclosure reports for commercial
  purposes, credit decisions or solicitation is restricted by 5 U.S.C. §13107(c)." It names the
  same prohibited uses as the former paragraph;
- the three 13F pages carry one 13F sentence instead, which keeps all eight clauses of the former
  caveat (quarter-end, long positions, Section 13(f) securities only, up to 45 days late, managers
  under $100M do not file, not current holdings, not a census, not financial advice);
- the full prohibited-uses text and the attributions with the DATA-LICENSE / NOTICE links are one
  click away at `/methodology/#notices` ("Legal"); the sources and their conditions at
  `/methodology/#sources` ("Sources & licenses").

Nothing about *what* is published changes, only its placement; counsel posture is unchanged. The
sentence is honesty copy: `.footer-notice` is in the css-fold `HONESTY_SELECTORS`, so no width may
hide it.

**D2 — "Legal" points at /methodology, not a new `/legal` page.** The owner's chat wording was
"moves to /legal". Every moved item already had a home on /methodology, so a `/legal` HTML page
would have duplicated it. The only `/legal/` paths remain the two text files
(`DATA-LICENSE.md`, `NOTICE.txt`), linked from `#notices`.

**R5 — the build watermark moves from the footer to /methodology (reversal named).** R4 of the
original M1 layout run pinned "exactly one build watermark, in the footer". The property —
one visible watermark, with the `populus:build_id` / `populus:code_sha` `<meta>` markers as the
machine-readable copy that deploy verification parses — is unchanged. Its home moves to
/methodology's Publication & verification section as `build <id> · code <sha7>` (`#build-stamp`),
printed exactly once; the footer prints no build text. The `<meta>` markers are byte-unchanged on
every page.

### Where each moved item lives now

| Former footer item | Home on /methodology |
|---|---|
| Prohibited-uses paragraph (§13107(c), not financial advice) | `#notices` — Required notices |
| 13F caveat paragraph | the footer sentence (all clauses) and `#13f-scope` |
| Source list (House Clerk, Senate eFD, SEC EDGAR, congress-legislators, kadoa) | `#sources` — Sources & conditions (SEC EDGAR row added: it was the one source without a row) |
| DATA-LICENSE / NOTICE links | `#notices` |
| Financials SOON / Macro SOON links | not moved: the routes stay built but unlinked (plan debt TD-1) |
| Build / code text | `#build-stamp` in Publication & verification |
| "no cookies · no account required · no cross-site tracking" | Principles ("No cookies, no account required") and `#privacy` |

### The tests that pin it

- `dashboard/test/footer.test.ts` — the row, both sentences word for word, every 13F clause on
  each of the three 13F pages, each moved item gone from the footer and present on /methodology.
- `dashboard/test/m1-layout.test.ts` — the layout reads the build only into the two `<meta>`
  markers; /methodology prints the watermark exactly once (re-pointed from "in the footer").
- `dashboard/test/geometry/layout.spec.ts` — the watermark once on /methodology and in no footer;
  footer ≤ 96 px at 1440; one row at ≥ 721 px; nothing hidden at any width.
- `dashboard/test/post/http-status.test.ts` — on the built pages: one `.footer-notice` per page,
  the 13F sentence exactly on the /institutional/ routes, no build id in any footer, the
  watermark once on /methodology, both anchors resolve.
- `dashboard/test/css-fold.test.ts` — `.footer-notice` swept at the fold with planted controls;
  `nav-shell`, `footer-block`, `footer-build` retired; `.badge-soon` still emitted and styled.

### Residual risk

- A reader who never follows a link sees the prohibited-use list and "not financial advice", but
  not the attribution text; attribution is one click away on every page. This is the stated
  trade of L1.
- `/financials/` and `/macro/` are built but no longer linked (TD-1). Removal condition: the
  module ships and is linked from the masthead, or the owner deletes the routes with
  `test/post/http-status.test.ts`'s nav-route check.
