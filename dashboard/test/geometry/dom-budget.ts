/* Launch redesign R35 / LD31 / D6 — the ONE map of which phone view the
   ≤3,000-element first-load budget gates.

   Plain data, no imports, erasable TypeScript only: `phone.spec.ts` reads it
   under Playwright and `test/launch-dom-budget.test.ts` pins it under
   `node --test` (native type stripping).

   LD31 hands each route's gate to the milestone that reshaped it: M2 home,
   M3b /congress/, M4a/M4b the member pages (active, heavy, one-trade) and
   `/e/`, M7b the ticker (both tabs), holders, /institutional/ and
   Methodology; filer, Congress data and the 404 were gated from M1c. All of
   those milestones are integrated, so every one of those views gates.

   /congress/ gates at the budget even while the board slimming (prefetched
   board rows, Monthly flow's hidden variants) lands on its own branch: a red
   gate there is the honest state until it does.

   /signals/ is NOT gated. D6 (owner decision): triage-row bodies stay in the
   page, and whatever each tab still carries after LD27's step 1 is recorded
   for the owner — measured and reported, never a gate, never a further cut
   without a new owner decision. The record is in
   docs/frontend/launch-redesign.md §"D6 — /signals/ first-load DOM".

   The Congress ticker page and the two redirect stubs are not LD31 routes:
   measured and reported only. */

export const DOM_BUDGET = 3000;

/** LD31: gated views (the phone spec's view ids). */
export const DOM_GATED: ReadonlySet<string> = new Set([
  "home",
  "congress",
  "member-active",
  "member-sparse",
  "member-heavy",
  "e-member",
  "ticker",
  "ticker-inst",
  "institutional",
  "holders",
  "methodology",
  "filer",
  "congress-data",
  "not-found",
]);

/** D6: measured exceptions — recorded for the owner, never gated. */
export const DOM_D6_MEASURED: ReadonlySet<string> = new Set(["signals", "signals-inst", "signals-overlap", "signals-playbooks"]);

/** Not LD31 routes: measured and reported only. */
export const DOM_MEASURED_ONLY: ReadonlySet<string> = new Set(["congress-ticker", "stub-leaders", "stub-tickers"]);

/** The gate's verdict for one view: a problem line, or null. A D6 view is
    never a problem (its count is recorded in the result instead). */
export function domBudgetProblem(viewId: string, dom: number): string | null {
  if (!DOM_GATED.has(viewId) || dom <= DOM_BUDGET) return null;
  return `R35 DOM ${dom} elements, budget ${DOM_BUDGET} (LD31)`;
}
