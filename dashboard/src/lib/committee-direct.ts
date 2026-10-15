/* signals-v3 M2 (R5, LD2): the committee DIRECT-match table.

   S-5 matches a disclosed trade to a committee the member sat on as of the
   trade date when the issuer's SIC DIVISION (the sector key of
   `src/populus/sic_taxonomy.yaml`) falls inside that committee's mapped
   sectors (`src/populus/committee_jurisdiction.yaml`). Divisions are coarse —
   "manufacturing" spans footwear and fighter aircraft — so every active S-5
   hit is graded here, presentation-only:

     direct — the issuer's 4-digit SIC falls inside a DIRECT range of a
              committee that matched the hit;
     broad  — every other hit, an unresolved SIC, or an unmapped committee.

   The ranges are inclusive 4-digit SIC codes, read from House Rule X and
   Senate Rule XXV (the committees' own jurisdiction clauses). Each range lies
   inside the committee's broad sectors — `committee-direct.test.ts` parses
   both YAMLs and fails otherwise — so a direct grade only ever REFINES an
   existing S-5 hit and never makes a new claim. The grade lives in build-time
   memory only: nothing here is serialized into `signals.v1.json` (R4).

   Like S-5 itself the grade is context, never an allegation: it states that
   an issuer's industry code sits inside a committee's stated jurisdiction,
   and nothing about intent or conduct. Every surface that renders it carries
   that caveat.

   The table is presented for the owner's sign-off with M2, as the v1 YAML
   was (debt TD-2: it lives beside the Python YAML until the committee mapping
   next changes its schema). Subcommittee memberships are collapsed onto the
   parent at ingest (debt TD-4), so a grade is committee-level only. */

/** Bumped on any change to `DIRECT_SIC`. */
export const COMMITTEE_DIRECT_VERSION = 1;

/** Where the ranges come from. */
export const COMMITTEE_DIRECT_SOURCE =
  "House Rule X and Senate Rule XXV committee jurisdiction clauses, read against the 1987 SIC Manual's industry codes";

/** An inclusive 4-digit SIC range. */
export type SicRange = readonly [from: number, to: number];

/** Committee id (thomas_id) → its DIRECT SIC ranges. LD2 v1, verbatim. */
export const DIRECT_SIC: Readonly<Record<string, readonly SicRange[]>> = {
  HSAG: [[100, 999]],
  SSAF: [[100, 999]],
  HSBA: [[6000, 6799]],
  SSBK: [[6000, 6799], [1520, 1531]],
  HSIF: [[2830, 2836], [2911, 2911], [3661, 3669], [3841, 3851], [4800, 4899], [4900, 4949]],
  SSEG: [[1000, 1499], [4610, 4619], [4900, 4949]],
  SSEV: [[1600, 1629], [4940, 4959]],
  HSPW: [[1600, 1629], [4000, 4789]],
  SSCM: [[4000, 4789], [4800, 4899]],
  HSAS: [[3480, 3489], [3720, 3729], [3730, 3732], [3760, 3769], [3795, 3795], [3812, 3812]],
  SSAS: [[3480, 3489], [3720, 3729], [3730, 3732], [3760, 3769], [3795, 3795], [3812, 3812]],
};

/** Each table committee's name as `src/populus/committee_jurisdiction.yaml`
    prints it (the cross-check test reads the YAML and fails on any drift). */
export const DIRECT_COMMITTEE_NAMES: Readonly<Record<string, string>> = {
  HSAG: "House Agriculture",
  SSAF: "Senate Agriculture, Nutrition, and Forestry",
  HSBA: "House Financial Services",
  SSBK: "Senate Banking, Housing, and Urban Affairs",
  HSIF: "House Energy and Commerce",
  SSEG: "Senate Energy and Natural Resources",
  SSEV: "Senate Environment and Public Works",
  HSPW: "House Transportation and Infrastructure",
  SSCM: "Senate Commerce, Science, and Transportation",
  HSAS: "House Armed Services",
  SSAS: "Senate Armed Services",
};

/** A SIC code as EDGAR records it ("6331", "100"), as an integer; null when it
    is absent or not 1–4 digits. Never guessed. */
export function sicCode(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
}

/** The SIC as the table prints it: four digits ("0100", "6331"). */
export function sicText(sic: number): string {
  return String(sic).padStart(4, "0");
}

/** A committee's direct ranges as text ("6000–6799, 1520–1531"). */
export function directRangesText(ranges: readonly SicRange[]): string {
  return ranges.map(([a, b]) => (a === b ? sicText(a) : `${sicText(a)}–${sicText(b)}`)).join(", ");
}

/** Does `sic` fall inside one of `committeeId`'s direct ranges? */
export function isDirect(sic: number | null, committeeId: string): boolean {
  if (sic === null) return false;
  const ranges = Object.hasOwn(DIRECT_SIC, committeeId) ? DIRECT_SIC[committeeId]! : [];
  return ranges.some(([a, b]) => sic >= a && sic <= b);
}

/** The grade of one S-5 hit: direct when the issuer's SIC falls inside a
    direct range of a committee that MATCHED the hit; broad otherwise —
    including an unresolved SIC and a committee the table does not map. */
export function gradeOverlap(sic: number | null, matchedCommitteeIds: readonly string[]): "direct" | "broad" {
  return matchedCommitteeIds.some((c) => isDirect(sic, c)) ? "direct" : "broad";
}
