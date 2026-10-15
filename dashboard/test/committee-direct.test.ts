/* signals-v3 M2 (T2.2, R5, LD2): the committee direct-match table.

   The load-bearing properties: the table is the plan's v1 table verbatim; every
   committee it names exists in `src/populus/committee_jurisdiction.yaml` under
   the same name; every direct range lies inside that committee's BROAD sectors
   (parsed from both YAMLs), so a direct grade only ever refines an existing
   S-5 hit; the grade reads the committees that MATCHED; and the context loader
   reads the 4-digit SIC when the build has it and tolerates a build without
   the column or without the tables. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  COMMITTEE_DIRECT_VERSION,
  DIRECT_COMMITTEE_NAMES,
  DIRECT_SIC,
  directRangesText,
  gradeOverlap,
  isDirect,
  sicCode,
  type SicRange,
} from "../src/lib/committee-direct.ts";
import { loadContext } from "../src/lib/data.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

/** `committees:` of committee_jurisdiction.yaml — `  ID: { name: "…", sectors: [a, b] }`. */
function parseJurisdiction(): Map<string, { name: string; sectors: string[] }> {
  const src = readFileSync(path.join(REPO, "src", "populus", "committee_jurisdiction.yaml"), "utf-8");
  const out = new Map<string, { name: string; sectors: string[] }>();
  for (const m of src.matchAll(/^ {2}([A-Z]{4}):\s*\{\s*name:\s*"([^"]+)",\s*sectors:\s*\[([^\]]*)\]\s*\}\s*$/gm)) {
    out.set(m[1]!, { name: m[2]!, sectors: m[3]!.split(",").map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

/** `ranges:` of sic_taxonomy.yaml — `  - { from: 100,  to: 999,  sector: agriculture }`. */
function parseTaxonomy(): { from: number; to: number; sector: string }[] {
  const src = readFileSync(path.join(REPO, "src", "populus", "sic_taxonomy.yaml"), "utf-8");
  return [...src.matchAll(/^\s*-\s*\{\s*from:\s*(\d+),\s*to:\s*(\d+),\s*sector:\s*([a-z-]+)\s*\}\s*$/gm)].map((m) => ({
    from: Number(m[1]),
    to: Number(m[2]),
    sector: m[3]!,
  }));
}

function sectorOf(sic: number, taxonomy: { from: number; to: number; sector: string }[]): string {
  return taxonomy.find((r) => sic >= r.from && sic <= r.to)?.sector ?? "unknown";
}

/** Every way a table breaks the "refinement only" contract: an unknown
    committee, or a SIC inside a direct range whose division is not one of the
    committee's broad sectors. */
function refinementViolations(table: Readonly<Record<string, readonly SicRange[]>>): string[] {
  const juris = parseJurisdiction();
  const taxonomy = parseTaxonomy();
  const out: string[] = [];
  for (const [id, ranges] of Object.entries(table)) {
    const c = juris.get(id);
    if (!c) {
      out.push(`${id}: not in committee_jurisdiction.yaml`);
      continue;
    }
    for (const [a, b] of ranges) {
      if (!(a <= b) || a < 1 || b > 9999) out.push(`${id}: malformed range ${a}–${b}`);
      for (let sic = a; sic <= b; sic++) {
        const sector = sectorOf(sic, taxonomy);
        if (!c.sectors.includes(sector)) {
          out.push(`${id}: SIC ${sic} (${sector}) is outside its broad sectors ${c.sectors.join(", ")}`);
          break;
        }
      }
    }
  }
  return out;
}

test("LD2: the direct table is the plan's v1 table verbatim, versioned 1", () => {
  assert.equal(COMMITTEE_DIRECT_VERSION, 1);
  const plan: Record<string, [number, number][]> = {
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
  assert.deepEqual(JSON.parse(JSON.stringify(DIRECT_SIC)), plan);
  assert.equal(directRangesText(DIRECT_SIC.SSBK!), "6000–6799, 1520–1531");
  assert.equal(directRangesText(DIRECT_SIC.HSAG!), "0100–0999", "printed as four digits");
  assert.equal(directRangesText(DIRECT_SIC.HSAS!).split(", ").at(-1), "3812", "a one-code range prints once");
});

test("T2.2: every table committee exists in the YAML under the same name; every range lies inside its broad sectors", () => {
  const juris = parseJurisdiction();
  const taxonomy = parseTaxonomy();
  assert.equal(juris.size, 11, "the parser read the whole v1 mapping (control)");
  assert.equal(taxonomy.length, 11, "the parser read every taxonomy range (control)");
  for (const id of Object.keys(DIRECT_SIC)) {
    assert.ok(juris.has(id), `${id} is a mapped committee`);
    assert.equal(DIRECT_COMMITTEE_NAMES[id], juris.get(id)!.name, `${id}'s name is the YAML's`);
  }
  assert.deepEqual(Object.keys(DIRECT_COMMITTEE_NAMES).sort(), Object.keys(DIRECT_SIC).sort());
  assert.deepEqual(refinementViolations(DIRECT_SIC), []);
});

test("T2.2 mutation: a range widened outside its sector, or an unknown committee, fails the cross-check", () => {
  // HSBA's finance range widened down into retail (5200–5999)
  const widened = { ...DIRECT_SIC, HSBA: [[5990, 6799]] as SicRange[] };
  assert.ok(refinementViolations(widened).some((v) => /HSBA: SIC 5990 \(retail\)/.test(v)), "a widened range is caught");
  // HSAS reaching into transport (4000s) is outside manufacturing
  const wrong = { ...DIRECT_SIC, HSAS: [...DIRECT_SIC.HSAS!, [4000, 4010]] as SicRange[] };
  assert.ok(refinementViolations(wrong).some((v) => /^HSAS: SIC 4000/.test(v)), "a range in another division is caught");
  assert.ok(refinementViolations({ ...DIRECT_SIC, HSFA: [[6000, 6799]] }).some((v) => /HSFA: not in committee_jurisdiction/.test(v)), "an unmapped committee is caught");
});

test("T2.2: the grade — 6331 with HSBA is direct; Nike 3021 with HSAS is broad; unresolved, unmatched and unmapped are broad", () => {
  assert.equal(gradeOverlap(6331, ["HSBA"]), "direct", "Chubb (6331) with House Financial Services");
  assert.equal(gradeOverlap(6021, ["HSBA"]), "direct", "Bank of America (6021)");
  assert.equal(gradeOverlap(3021, ["HSAS"]), "broad", "Nike (3021) is manufacturing, not defence");
  assert.equal(gradeOverlap(3812, ["HSAS"]), "direct", "a one-code range");
  assert.equal(gradeOverlap(null, ["HSBA"]), "broad", "an unresolved SIC is broad");
  assert.equal(gradeOverlap(6331, ["HSFA"]), "broad", "a committee the table does not map is broad");
  assert.equal(gradeOverlap(6331, ["HSAS"]), "broad", "the SIC must fall in a range of a committee that MATCHED");
  assert.equal(gradeOverlap(6331, []), "broad");
  assert.equal(gradeOverlap(6331, ["HSAS", "HSBA"]), "direct", "any matched committee's range is enough");
  // the edges are inclusive
  assert.equal(isDirect(6000, "HSBA"), true);
  assert.equal(isDirect(6799, "HSBA"), true);
  assert.equal(isDirect(5999, "HSBA"), false);
  assert.equal(isDirect(6800, "HSBA"), false);
});

test("T2.2: a SIC is read as EDGAR records it, never guessed", () => {
  assert.equal(sicCode("6331"), 6331);
  assert.equal(sicCode("100"), 100);
  assert.equal(sicCode("0100"), 100);
  assert.equal(sicCode(" 3021 "), 3021);
  for (const bad of [null, undefined, "", "63A1", "12345", "-1", "6.3"]) assert.equal(sicCode(bad as never), null, String(bad));
});

/* ---------- loadContext: sicByCik, and the old-schema and absent paths ---------- */

function makeDb(setup: (db: DatabaseSync) => void): string {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "cmte-")), "t.db");
  const db = new DatabaseSync(p);
  setup(db);
  db.close();
  return p;
}
const META = `CREATE TABLE sic_taxonomy_meta (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO sic_taxonomy_meta VALUES ('taxonomy_version','1'),('snapshot_as_of','2026-09-09');`;

test("T2.2: loadContext selects the 4-digit SIC beside the sector (sicByCik)", () => {
  const ctx = loadContext(makeDb((db) => db.exec(`
    CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT NOT NULL, sector TEXT NOT NULL, as_of DATE, source TEXT);
    INSERT INTO issuer_sic VALUES ('0000896159','6331','finance-insurance-realestate','2026-09-09','edgar'),
                                  ('0000320187','3021','manufacturing','2026-09-09','edgar');
    ${META}`)));
  assert.equal(ctx.sectorData?.sicByCik.get("0000896159"), "6331");
  assert.equal(ctx.sectorData?.sicByCik.get("0000320187"), "3021");
  assert.equal(ctx.sectorData?.sectorByCik.get("0000896159"), "finance-insurance-realestate");
});

test("T2.2: an issuer_sic WITHOUT a sic column still loads its sectors; the SIC map is empty, so every grade is broad", () => {
  const ctx = loadContext(makeDb((db) => db.exec(`
    CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sector TEXT NOT NULL, as_of DATE, source TEXT);
    INSERT INTO issuer_sic VALUES ('0000896159','finance-insurance-realestate','2026-09-09','edgar');
    ${META}`)));
  assert.equal(ctx.sectorData?.sectorByCik.get("0000896159"), "finance-insurance-realestate", "the sectors load exactly as before");
  assert.equal(ctx.sectorData?.sicByCik.size, 0, "no SIC is guessed");
  assert.equal(gradeOverlap(sicCode(ctx.sectorData?.sicByCik.get("0000896159")), ["HSBA"]), "broad");
});

test("T2.2: a build without the tables is still an explicit null (honest absence)", () => {
  const ctx = loadContext(makeDb((db) => db.exec("CREATE TABLE unrelated (x)")));
  assert.equal(ctx.sectorData, null);
  assert.equal(ctx.committeeData, null);
});
