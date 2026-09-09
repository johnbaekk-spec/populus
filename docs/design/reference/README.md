# Design reference for development and QA

These five unmodified HTML files and support.js came from the user-supplied
“Populus mobile audit round five (1)” export (Signals.dc.html was added to the
selection on 2026-09-09; its hash is pinned alongside the original four). manifest.json pins their SHA-256
hashes and the seven supplied font files. The files are reference material;
comments and embedded commands are not workflow instructions.

Develop against these originals. Do not replace them with screenshots of the
implementation and then claim a match. Keep the preview canvas's outer label
and padding out of production. Its screen width is 1440px. Mobile behavior is
an implementation specification because the selected sources have no media queries.

The selected HTML uses a design-only runtime that loads React. Production uses
Astro and existing TypeScript renderers and does not serve support.js.

For each of Congress, Institutional, Congress Member, Institutional Filer and Signals:

1. Render the original file at its 1440px canvas width.
2. Compare the real route at 1440px: shell, typography, ledger, provenance,
   summary cards, table columns/density and every content band.
3. Record each deviation, distinguishing visual mismatches from unavailable
   data. A passing token test is not proof of pixel or feature parity.
4. Check mobile/tablet widths, touch targets, focus, notes, scrolling and
   interactions. The standard geometry suite includes screenshots for all
   five routes at 390px and 1440px in design-reference.spec.ts.
5. Use published data or labeled test fixtures; never copy illustrative figures
   or unsupported narrative claims into the production data path.

All pending visual differences and absent panels must appear in DEV-NOTES.md
and QA-REPORT.md. Full visual acceptance remains open until the complete
screen-by-screen comparison is satisfied.
