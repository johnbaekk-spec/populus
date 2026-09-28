/* DESIGN-POLISH T1.10 — the ONE milestone map for the ledger geometry checks.

   Plain data, no imports, erasable TypeScript only: `ledger.spec.ts` reads it
   under Playwright and `test/geometry-milestones.test.ts` pins it under
   `node --test` (native type stripping), so nothing here may need a
   transform (no enums, no parameter properties, no namespaces).

   A check whose fix lands in a later milestone than `CURRENT_MILESTONE` is
   PENDING: `ledger.spec.ts` runs it as one `test.fail()` across the routes it
   applies to, so it stays red for the right reason until its milestone, and a
   pending check that starts passing goes red as an unexpected pass (the map
   is then stale and must advance). Every other check runs per route and per
   width and must be green.

   G2 is not pending in any milestone. It instead EXEMPTS, by selector, the
   three scroll containers M2 removes (plan, Tasks: "It is a selector
   exemption, not test.fail(), because those boxes scroll only when their
   table outgrows them, so a test.fail() could flip on the data"). T2.5 empties
   the M2 list. */

export type Milestone = "m1" | "m2" | "m3" | "m4" | "m5";

/** Milestones in order; a check is pending while its milestone sorts after
    the current one. */
export const MILESTONE_ORDER: readonly Milestone[] = ["m1", "m2", "m3", "m4", "m5"];

/** The milestone this tree implements. The dev run bumps it when a milestone
    lands (M2: "m2"), in the same commit as the markup that makes the pending
    checks pass. */
export const CURRENT_MILESTONE: Milestone = "m1";

/** The plan's geometry checks, G1–G12 (Tasks and Verification), plus the four
    T1.2/T1.6 checks the task rows name that are not one of the twelve. */
export const GEOMETRY_CHECKS = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G11b",
  "G12",
] as const;
export const EXTRA_CHECKS = ["headFont", "oneFlex", "metaTruncation", "controlHeights"] as const;

export type GeometryCheck = (typeof GEOMETRY_CHECKS)[number];
export type ExtraCheck = (typeof EXTRA_CHECKS)[number];
export type CheckId = GeometryCheck | ExtraCheck;

/** The milestone in which each check's FIX lands (so from which it must be
    green).

    G6 (empty columns) needs `presentColumns` and the `data-columns` carriage,
    T2.1; G9 (band balance) needs the M2 compositions, T2.2–T2.6.

    G3 (no horizontal overflow at 1440) and G7 (no clipped numbers) are fixed
    by T2.7 in the plan's task table, but the M1 ledger (one `c-flex` column,
    no percentage widths, uncapped numbers) is expected to satisfy both
    already. They are therefore m1 here: measured on the M1 tree, a G3 or G7
    failure moves that check to "m2" in this map, recorded in DEV-NOTES with
    the failing routes. */
export const CHECK_MILESTONE: Readonly<Record<CheckId, Milestone>> = {
  G1: "m1",
  G2: "m1",
  G3: "m1",
  G4: "m1",
  G5: "m1",
  G6: "m2",
  G7: "m1",
  G8: "m1",
  G9: "m2",
  G10: "m1",
  G11: "m1",
  G11b: "m1",
  G12: "m1",
  headFont: "m1",
  oneFlex: "m1",
  metaTruncation: "m1",
  controlHeights: "m1",
};

/** The M1 exemption list for G2: exactly the three containers M2 removes —
    member flows (`late-additions.css:608`), member and filer filing history
    (`:609`) and the filer's reported positions (`:735`). Pinned to exactly
    these three by `test/geometry-milestones.test.ts`. */
export const G2_EXEMPT_M1: readonly string[] = [
  ".design-flow-band > .panel > .table-scroll",
  ".design-history",
  '[data-holdings-surface="filer"] .table-scroll',
];

/** G2's exemptions per milestone. From M2 on (T2.5) nothing is exempt. */
export const G2_EXEMPT: Readonly<Record<Milestone, readonly string[]>> = {
  m1: G2_EXEMPT_M1,
  m2: [],
  m3: [],
  m4: [],
  m5: [],
};

export function milestoneIndex(m: Milestone): number {
  const i = MILESTONE_ORDER.indexOf(m);
  if (i < 0) throw new Error(`unknown milestone ${String(m)}`);
  return i;
}

/** True while the check's fix belongs to a later milestone than `current`. */
export function isPending(check: CheckId, current: Milestone = CURRENT_MILESTONE): boolean {
  return milestoneIndex(CHECK_MILESTONE[check]) > milestoneIndex(current);
}

/** The G2 selectors exempt at `current`. */
export function g2Exemptions(current: Milestone = CURRENT_MILESTONE): readonly string[] {
  return G2_EXEMPT[current];
}
