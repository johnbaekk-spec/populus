/* Pins the LOADER's coercion against the real code path.

   Code review (cycle 4, F4) rejected an earlier version of this claim twice, and
   was right both times. First I asserted a `NaN` the column cannot hold. Then I
   asserted `Number(null) === 0` myself and fed the result to the sorter — which
   pins my belief about the loader, not the loader.

   This builds a real SQLite database with a genuine NULL `value_usd`, points
   `POPULUS_INST_DB` at it, and calls `loadInstitutional`. Whatever the loader
   does is what this observes. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadInstitutional, holdersFor } from "../src/lib/inst.ts";
import { orderRankedHolders } from "../src/lib/holders-sort.ts";

function buildDbWithNullValue(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "inst-coercion-"));
  const dbPath = path.join(dir, "inst_agg.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE agg_build_meta (key TEXT, value TEXT);
    CREATE TABLE agg_filer_registry (cik TEXT, filer_name TEXT, latest_period TEXT,
      position_count INTEGER, total_value_usd INTEGER, null_value_positions INTEGER,
      unkeyed_positions INTEGER);
    CREATE TABLE agg_filer_concentration (cik TEXT, period_of_report TEXT, position_count INTEGER,
      total_value_usd INTEGER, null_value_positions INTEGER, topn_value_usd INTEGER,
      topn_share_bps INTEGER, hhi INTEGER, max_position_share_bps INTEGER, flags TEXT);
    CREATE TABLE agg_qoq_deltas (cik TEXT, position_key TEXT, put_call TEXT, curr_period TEXT,
      prev_period TEXT, change_kind TEXT, prev_value_usd INTEGER, curr_value_usd INTEGER,
      delta_value_usd INTEGER, prev_shares INTEGER, curr_shares INTEGER, delta_shares INTEGER,
      ssh_prnamt_type TEXT, flags TEXT);
    CREATE TABLE agg_issuer_top_holders (issuer_key TEXT, period_of_report TEXT, rank INTEGER,
      cik TEXT, filer_name TEXT, issuer_name TEXT, issuer_key_source TEXT,
      value_usd INTEGER, security_count INTEGER, flags TEXT);
  `);
  // A genuine SQL NULL — the state the aggregate is claimed never to emit.
  db.prepare(
    `INSERT INTO agg_issuer_top_holders VALUES ('entity:1','2026-03-31',1,'0000001',
     'NULL VALUE FUND','APPLE INC','entity', NULL, 3, '[]')`,
  ).run();
  db.prepare(
    `INSERT INTO agg_issuer_top_holders VALUES ('entity:1','2026-03-31',2,'0000002',
     'REAL VALUE FUND','APPLE INC','entity', 500, 4, '[]')`,
  ).run();
  db.close();
  return { dir, dbPath };
}

test("LOADER: a genuine SQL NULL arrives at the consumer as 0, not as null", () => {
  const { dir, dbPath } = buildDbWithNullValue();
  const prev = process.env.POPULUS_INST_DB;
  process.env.POPULUS_INST_DB = dbPath;
  try {
    const inst = loadInstitutional(dir, { modules: { inst: {} } });
    assert.equal(inst.present, true, "the fixture database must load");
    const rows = holdersFor(inst as never, "entity:1", "2026-03-31");
    assert.equal(rows.length, 2);

    const nullRow = rows.find((r) => r.filer_name === "NULL VALUE FUND")!;
    // THE POINT: observed from the real loader, not asserted about it.
    assert.equal(nullRow.value_usd, 0, "Number(null) === 0 happens inside the loader");
    assert.notEqual(nullRow.value_usd, null, "null does not survive the loader");
  } finally {
    if (prev === undefined) delete process.env.POPULUS_INST_DB;
    else process.env.POPULUS_INST_DB = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LOADER consequence: the unranked bucket cannot fire on loaded rows", () => {
  const { dir, dbPath } = buildDbWithNullValue();
  const prev = process.env.POPULUS_INST_DB;
  process.env.POPULUS_INST_DB = dbPath;
  try {
    const inst = loadInstitutional(dir, { modules: { inst: {} } });
    const rows = holdersFor(inst as never, "entity:1", "2026-03-31");
    const { ranked, unranked } = orderRankedHolders(rows, "value", "asc");
    assert.equal(unranked.length, 0, "nothing reaches the bucket once the loader has run");
    assert.equal(ranked[0].filer_name, "NULL VALUE FUND", "the NULL sorts first, as the 0 it became");
    // This is why the no-sentinel guarantee cannot live in the presentation
    // layer: by the time rows arrive, "not reported" and "reported zero" are
    // the same number. A real guarantee needs the loader or the producer.
  } finally {
    if (prev === undefined) delete process.env.POPULUS_INST_DB;
    else process.env.POPULUS_INST_DB = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
