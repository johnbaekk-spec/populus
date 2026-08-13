/* Review F9: the optional B-5/B-6 context loader distinguishes ABSENCE
   (tables not in this build → null, honest absence) from BREAKAGE (tables
   present but wrong → thrown build failure). A catch-all that reclassified
   corruption as absence would let schema drift impersonate the legitimate
   "not in this build" page — the same disguise as the F-26 outage. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadContext } from "../src/lib/data.ts";

function makeDb(setup: (db: DatabaseSync) => void): string {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "ctx-")), "t.db");
  const db = new DatabaseSync(p);
  setup(db);
  db.close();
  return p;
}

test("absent tables → explicit nulls (honest absence)", () => {
  const p = makeDb((db) => db.exec("CREATE TABLE unrelated (x)"));
  const ctx = loadContext(p);
  assert.equal(ctx.sectorData, null);
  assert.equal(ctx.committeeData, null);
});

test("valid tables → loaded context with provenance and snapshot window", () => {
  const p = makeDb((db) => {
    db.exec(`
      CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT, sector TEXT, as_of DATE, source TEXT);
      INSERT INTO issuer_sic VALUES ('0000320193','3571','manufacturing','2026-08-12','edgar');
      CREATE TABLE sic_taxonomy_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO sic_taxonomy_meta VALUES ('taxonomy_version','1'),('snapshot_as_of','2026-08-12');
      CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
      INSERT INTO committees VALUES ('HSAG','House Agriculture','house',NULL);
      CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
        snapshot_date DATE, valid_from DATE, valid_to DATE);
      INSERT INTO committee_memberships VALUES ('HSAG','A000001','Chair','2026-08-12','2025-01-03','2026-08-12');
      CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
      INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'rule x');
    `);
  });
  const ctx = loadContext(p);
  assert.equal(ctx.sectorData?.sectorByCik.get("0000320193"), "manufacturing");
  assert.equal(ctx.sectorData?.taxonomyVersion, "1");
  assert.equal(ctx.committeeData?.windowFrom, "2025-01-03");
  assert.equal(ctx.committeeData?.windowTo, "2026-08-12");
});

test("populated issuer_sic without taxonomy provenance is a BUILD FAILURE, not absence", () => {
  const p = makeDb((db) => {
    db.exec(`
      CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT, sector TEXT, as_of DATE, source TEXT);
      INSERT INTO issuer_sic VALUES ('0000320193','3571','manufacturing','2026-08-12','edgar');
      CREATE TABLE sic_taxonomy_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  });
  assert.throws(() => loadContext(p), /taxonomy provenance/);
});

test("present-but-malformed committee tables propagate as errors, never absence", () => {
  const p = makeDb((db) => {
    db.exec(`
      CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
      CREATE TABLE committee_memberships (wrong_shape TEXT);
      CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
    `);
  });
  assert.throws(() => loadContext(p));
});

test("review r2-F7: a PARTIAL table family is a build failure, never absence", () => {
  // sector family: data table present, metadata peer missing
  const p1 = makeDb((db) =>
    db.exec("CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT, sector TEXT, as_of DATE, source TEXT)"),
  );
  assert.throws(() => loadContext(p1), /PARTIALLY present/);

  // committee family: two of three tables present
  const p2 = makeDb((db) => {
    db.exec(`
      CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
      CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
        snapshot_date DATE, valid_from DATE, valid_to DATE);
    `);
  });
  assert.throws(() => loadContext(p2), /PARTIALLY present/);
});

test("review r3-F8: mixed mapping versions, mixed snapshot dates, or a missing jurisdiction family are build failures", () => {
  const base = `
    CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
    INSERT INTO committees VALUES ('HSAG','House Agriculture','house',NULL);
    CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
      snapshot_date DATE, valid_from DATE, valid_to DATE);
    CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
  `;
  // mixed mapping versions → one page would attribute overlaps to an arbitrary revision
  const mixedVersions = makeDb((db) => {
    db.exec(base + `
      INSERT INTO committee_memberships VALUES ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12');
      INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x'),('HSAG','mining',2,'x');
    `);
  });
  assert.throws(() => loadContext(mixedVersions), /mapping versions/);

  // mixed snapshot dates → a partial full-replace ingest
  const mixedDates = makeDb((db) => {
    db.exec(base + `
      INSERT INTO committee_memberships VALUES
        ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12'),
        ('HSAG','B000002',NULL,'2026-07-01','2025-01-03','2026-07-01');
      INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x');
    `);
  });
  assert.throws(() => loadContext(mixedDates), /snapshot dates/);

  // memberships present but jurisdiction empty → overlap claims with no version
  const noJurisdiction = makeDb((db) => {
    db.exec(base + `
      INSERT INTO committee_memberships VALUES ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12');
    `);
  });
  assert.throws(() => loadContext(noJurisdiction), /jurisdiction/);
});

test("review r3-F7: a COMPLETE but EMPTY family is a defect, never honest absence", () => {
  // sector family: both tables exist, zero issuer rows (failed/never-run ingest)
  const emptySector = makeDb((db) => {
    db.exec(`
      CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT, sector TEXT, as_of DATE, source TEXT);
      CREATE TABLE sic_taxonomy_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  });
  assert.throws(() => loadContext(emptySector), /exist but hold no issuer rows/);

  // committee family: all three tables exist, no memberships
  const emptyCommittee = makeDb((db) => {
    db.exec(`
      CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
      CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
        snapshot_date DATE, valid_from DATE, valid_to DATE);
      CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
      INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x');
    `);
  });
  assert.throws(() => loadContext(emptyCommittee), /exist but hold no memberships/);
});

test("review c2-F2: mixed validity windows are rejected, never widened to the outer hull", () => {
  const mk = (rows: string) =>
    makeDb((db) => {
      db.exec(`
        CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
        INSERT INTO committees VALUES ('HSAG','House Agriculture','house',NULL);
        CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
          snapshot_date DATE, valid_from DATE, valid_to DATE);
        CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
        INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x');
        ${rows}
      `);
    });

  // mixed valid_from: widening would claim knowledge of dates a member's own
  // rows never covered
  const mixedFrom = mk(`
    INSERT INTO committee_memberships VALUES
      ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12'),
      ('HSAG','B000002',NULL,'2026-08-12','2025-06-01','2026-08-12');
  `);
  assert.throws(() => loadContext(mixedFrom), /valid_from/);

  // mixed valid_to, same rule
  const mixedTo = mk(`
    INSERT INTO committee_memberships VALUES
      ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12'),
      ('HSAG','B000002',NULL,'2026-08-12','2025-01-03','2026-07-01');
  `);
  assert.throws(() => loadContext(mixedTo), /valid_to/);

  // one coherent snapshot loads, and the window is the snapshot's own pair
  const coherent = mk(`
    INSERT INTO committee_memberships VALUES
      ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12'),
      ('HSAG','B000002',NULL,'2026-08-12','2025-01-03','2026-08-12');
  `);
  const ctx = loadContext(coherent);
  assert.equal(ctx.committeeData?.windowFrom, "2025-01-03");
  assert.equal(ctx.committeeData?.windowTo, "2026-08-12");
});

test("review c2r2-F2: window bounds must be REAL, ordered calendar dates", () => {
  const mk = (frm: string, to: string, snap = "2026-08-12") =>
    makeDb((db) => {
      db.exec(`
        CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
        INSERT INTO committees VALUES ('HSAG','House Agriculture','house',NULL);
        CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
          snapshot_date DATE, valid_from DATE, valid_to DATE);
        INSERT INTO committee_memberships VALUES ('HSAG','A000001',NULL,'${snap}','${frm}','${to}');
        CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
        INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x');
      `);
    });

  // blank
  assert.throws(() => loadContext(mk("", "2026-08-12")), /not a real YYYY-MM-DD/);
  // malformed
  assert.throws(() => loadContext(mk("2025-1-3", "2026-08-12")), /not a real YYYY-MM-DD/);
  // impossible — the shape is right but the date does not exist
  assert.throws(() => loadContext(mk("0000-00-00", "9999-99-99")), /not a real YYYY-MM-DD/);
  assert.throws(() => loadContext(mk("2026-02-30", "2026-08-12")), /not a real YYYY-MM-DD/);
  // a bad snapshot_date is caught by the same rule
  assert.throws(() => loadContext(mk("2025-01-03", "2026-08-12", "not-a-date")), /not a real YYYY-MM-DD/);
  // inverted: every date would be both inside and outside the window
  assert.throws(() => loadContext(mk("2026-08-12", "2025-01-03")), /inverted/);
  // the coherent case still loads
  const ok = loadContext(mk("2025-01-03", "2026-08-12"));
  assert.equal(ok.committeeData?.windowFrom, "2025-01-03");
});

test("review c2r2-F2: a malformed sector as-of date is refused too (full-set sweep)", () => {
  const p = makeDb((db) => {
    db.exec(`
      CREATE TABLE issuer_sic (cik TEXT PRIMARY KEY, sic TEXT, sector TEXT, as_of DATE, source TEXT);
      INSERT INTO issuer_sic VALUES ('0000320193','3571','manufacturing','2026-02-30','edgar');
      CREATE TABLE sic_taxonomy_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO sic_taxonomy_meta VALUES ('taxonomy_version','1'),('snapshot_as_of','2026-02-30');
    `);
  });
  assert.throws(() => loadContext(p), /real YYYY-MM-DD/);
});

test("review c2r3-F2: an ORPHAN membership row fails the load, never a silent drop", () => {
  // One valid membership keeps the family non-empty; the orphan would vanish in
  // the inner join and its member would then be answered "known-none".
  const p = makeDb((db) => {
    db.exec(`
      CREATE TABLE committees (committee_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, url TEXT);
      INSERT INTO committees VALUES ('HSAG','House Agriculture','house',NULL);
      CREATE TABLE committee_memberships (committee_id TEXT, bioguide_id TEXT, role TEXT,
        snapshot_date DATE, valid_from DATE, valid_to DATE);
      INSERT INTO committee_memberships VALUES
        ('HSAG','A000001',NULL,'2026-08-12','2025-01-03','2026-08-12'),
        ('ZZZZ','B000002',NULL,'2026-08-12','2025-01-03','2026-08-12');
      CREATE TABLE committee_jurisdiction (committee_id TEXT, sector TEXT, mapping_version INTEGER, source TEXT);
      INSERT INTO committee_jurisdiction VALUES ('HSAG','agriculture',1,'x');
    `);
  });
  assert.throws(() => loadContext(p), /name a committee absent from/);
});
