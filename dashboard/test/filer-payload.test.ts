/* RUN M2-11 T5 (plan R22, R27, LD-7, LD-9, LD-10) — the bounded-delivery
   contracts: LD-7 selection, the ONE filer-href primitive, the FilerPayloadV1
   round trip through the ONE assembler and the strict validator, the
   fail-not-truncate shard geometry, plan-level completeness, and the
   link-producer sweep.

   The sweep and the mirrors are grep-based over the SOURCE deliberately: the
   defect class they pin (an unconditional pre-rendered-route literal; a
   second copy of a budget constant) lives in source text, not in behaviour a
   fixture can reach. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import {
  FILER_PAGE_BUDGET,
  compareHoldingRows,
  filerHref,
  selectTopFilers,
  type FilerSelectionInput,
} from "../src/lib/holdings.ts";
import {
  FILER_FRAGMENT_PARTS_MAX,
  FILER_FRAGMENT_SHARD_ENVELOPE_BYTES,
  FILER_FRAGMENT_SIZING_SENTINEL,
  FILER_FRAGMENT_TARGET_BYTES,
  FILER_INDEX_PATH,
  FilerPayloadError,
  assembleFilerPayload,
  filerShardPath,
  fragmentFilerPayload,
  parseFilerFragmentV2,
  parseFilerPayload,
  readServingFilings,
  reassembleFilerFragments,
  serializeFilerFragmentEntry,
  type FilerFragmentV2,
  type FilerPayloadV1,
} from "../src/lib/filer-payload.ts";
import {
  SHARD_RESPONSE_CEILING_BYTES,
  fillShardsByBytes,
  paginateByBytes,
} from "../src/lib/shards.ts";
import { FILER_TAIL_SHARDS_MAX, filerTailShards } from "../src/lib/data.ts";
import type { ConcentrationRow, QoqDeltaRow } from "../src/lib/inst.ts";

const DASH = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(DASH, "..");

/* ---------- LD-7: the selection rule, deterministic and boundary-exact ----- */

function selectionRow(cik: string, value: number | null): FilerSelectionInput {
  return { cik, latestPeriodValueUsd: value };
}

test("LD-7: descending latest-period value, ties ascending CIK, nulls last", () => {
  const rows = [
    selectionRow("0000000005", 100),
    selectionRow("0000000001", null),
    selectionRow("0000000003", 900),
    selectionRow("0000000004", 100),
    selectionRow("0000000002", 900),
  ];
  assert.deepEqual(selectTopFilers(rows, 4), [
    "0000000002", // 900, tie broken by ascending CIK
    "0000000003",
    "0000000004", // 100, tie broken by ascending CIK
    "0000000005",
  ]);
  // A NULL total is unknown, not small: it sorts after every number, so a
  // filer with no concentration row can only enter on CIK order at the end.
  assert.deepEqual(selectTopFilers(rows, 5).at(-1), "0000000001");
});

test("LD-7 determinism: input order cannot change the selection", () => {
  const rows = Array.from({ length: 50 }, (_, i) =>
    selectionRow(String(i + 1).padStart(10, "0"), (i * 7919) % 13),
  );
  const a = selectTopFilers(rows, 20);
  const b = selectTopFilers([...rows].reverse(), 20);
  const c = selectTopFilers(
    [...rows].sort((x, y) => (x.cik < y.cik ? 1 : -1)),
    20,
  );
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test("LD-7 boundary: rank 1,500 is pre-rendered, rank 1,501 is tail", () => {
  assert.equal(FILER_PAGE_BUDGET, 1_500, "the LD-7 cut is a contract number");
  // 1,501 filers with strictly descending value: the cut must include exactly
  // the first 1,500 and exclude the 1,501st — the boundary CIKs of the plan.
  const rows = Array.from({ length: 1_501 }, (_, i) =>
    selectionRow(String(i + 1).padStart(10, "0"), 2_000_000 - i),
  );
  const tops = new Set(selectTopFilers(rows));
  assert.equal(tops.size, 1_500);
  const rank1500 = String(1_500).padStart(10, "0");
  const rank1501 = String(1_501).padStart(10, "0");
  assert.ok(tops.has(rank1500), "rank 1,500 is inside the budget");
  assert.ok(!tops.has(rank1501), "rank 1,501 is tail");
  // Mutation guard (plan: "lift the 1,500 cut"): the default budget IS the cut.
  assert.equal(selectTopFilers(rows).length, 1_500);
  // Mutation guard (plan: "break LD-7 ties"): equal values on the boundary
  // resolve by ascending CIK, so the LOWER CIK is pre-rendered.
  const tied = Array.from({ length: 3 }, (_, i) =>
    selectionRow(String(3 - i).padStart(10, "0"), 500),
  );
  assert.deepEqual(selectTopFilers(tied, 2), ["0000000001", "0000000002"]);
});

/* ---------- the ONE href primitive ---------- */

test("filerHref: top -> the unpadded pre-rendered route, tail -> /e/", () => {
  assert.equal(filerHref("0001067983", "top"), "/institutional/filers/1067983/");
  assert.equal(filerHref("0001067983", "tail"), "/e/?k=f:1067983");
  // The tail key is the `f:` entity key parseEntityKey accepts (it pads).
  assert.equal(filerHref("42", "tail"), "/e/?k=f:42");
});

test("link-producer sweep: no filer-page literal outside the href primitive", () => {
  /* R22: the closure is a TEST, not a convention. Any quoted or templated
     `/institutional/filers/` outside `lib/holdings.ts` (the primitive's home)
     is an unconditional link a tail filer would 404 on. Comments are allowed —
     the sweep matches string/template contexts only. */
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|astro)$/.test(name)) continue;
      const rel = path.relative(path.join(DASH, "src"), p).split(path.sep).join("/");
      if (rel === "lib/holdings.ts") continue; // the primitive itself
      const src = readFileSync(p, "utf-8");
      for (const line of src.split("\n")) {
        if (/["'`][^"'`\n]*\/institutional\/filers\//.test(line)) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
  };
  walk(path.join(DASH, "src"));
  assert.deepEqual(
    offenders,
    [],
    "unconditional filer-page links outside filerHref — route them through the primitive",
  );
  // The sweep itself must be able to see a hit, or it proves nothing.
  assert.ok(/["'`][^"'`\n]*\/institutional\/filers\//.test(`href="/institutional/filers/1/"`));
});

/* ---------- the assembler + validator round trip ---------- */

const SCHEMA = (() => {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_serving.py"), "utf-8");
  const m = py.match(/SERVING_SCHEMA = """([\s\S]*?)"""/);
  assert.ok(m, "the producer's DDL is where the dashboard expects it");
  return m![1]!;
})();

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const filing = db.prepare(
    `INSERT INTO serving_filings (filing_key, accession, submission_type, period_of_report,
       filed_date, doc_url, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  filing.run(1, "0000000000-26-000001", "13F-HR", "2026-03-31", "2026-05-15", "https://x/f1.xml", "sec-edgar");
  filing.run(2, "0000000000-25-000002", "13F-HR", "2025-12-31", "2026-02-10", null, "sec-edgar");
  filing.run(9, "0000000000-26-000009", "13F-HR", "2026-03-31", "2026-05-01", null, "sec-edgar");
  const row = db.prepare(
    `INSERT INTO serving_filer_rows (cik, period, filing_key, security_id, cusip, issuer_name,
       title_of_class, value_usd, shares, ssh_type, put_call, position_key,
       put_call_bucket, unit_key, flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Two periods for the filer under test; one undisclosed value (NULL-honest).
  row.run("0001067983", "2026-03-31", 1, "sec:aapl", "037833100", "APPLE INC", "COM", 900, 5, "SH", "LONG", "sid:sec:aapl", "LONG", "SH", "[]");
  row.run("0001067983", "2026-03-31", 1, null, "594918104", "MICROSOFT CORP", "COM", null, null, "SH", "LONG", "cusip:594918104", "LONG", "SH", "[]");
  row.run("0001067983", "2025-12-31", 2, "sec:aapl", "037833100", "APPLE INC", "COM", 700, 4, "SH", "LONG", "sid:sec:aapl", "LONG", "SH", "[]");
  // Another filer, so per-entity reads are proven per-entity.
  row.run("0000000042", "2026-03-31", 9, null, "111111111", "TAIL CO", "COM", 5, 1, "SH", "LONG", "cusip:111111111", "LONG", "SH", "[]");
  return db;
}

function fixtureConc(period: string): ConcentrationRow {
  return {
    cik: "0001067983",
    period_of_report: period,
    position_count: 2,
    total_value_usd: 900,
    null_value_positions: 1,
    topn_value_usd: 900,
    topn_share_bps: null, // NULL-honest: concentration_unavailable stays NULL
    hhi: null,
    flags: [],
  };
}

function fixtureDelta(period: string): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "sid:sec:aapl",
    put_call: "LONG",
    curr_period: period,
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 700,
    curr_value_usd: 900,
    delta_value_usd: 200,
    prev_shares: 4,
    curr_shares: 5,
    delta_shares: 1,
    ssh_prnamt_type: "SH",
    flags: [],
  };
}

function assemble(db: DatabaseSync, cik = "0001067983"): FilerPayloadV1 {
  return assembleFilerPayload(db, {
    cik,
    filerName: "BERKSHIRE HATHAWAY INC",
    latestPeriod: "2026-03-31",
    requestedPeriod: "2026-03-31",
    filings: readServingFilings(db),
    agg: {
      concByPeriod: { "2026-03-31": fixtureConc("2026-03-31"), "2025-12-31": null },
      deltasByPeriod: { "2026-03-31": [fixtureDelta("2026-03-31")], "2025-12-31": [] },
      latestFiled: "2026-05-15",
      topn: 25,
      window: { open: false, quarterEnd: "2026-06-30", deadline: "2026-08-14" },
    },
  });
}

test("round trip: assembleFilerPayload -> JSON -> parseFilerPayload, exact structural equality", () => {
  const db = fixtureDb();
  try {
    const payload = assemble(db);
    const parsed = parseFilerPayload(JSON.parse(JSON.stringify(payload)));
    assert.deepStrictEqual(parsed, payload);
  } finally {
    db.close();
  }
});

test("v2 fragments reconstruct the identical logical payload bytes", () => {
  const db = fixtureDb();
  try {
    const payload = assemble(db);
    const fragments = fragmentFilerPayload(payload);
    assert.ok(fragments.length > 1);
    assert.ok(fragments.length <= FILER_FRAGMENT_PARTS_MAX);
    fragments.forEach((fragment, part) => {
      assert.equal(fragment.part, part);
      assert.equal(fragment.parts, fragments.length);
      assert.ok(
        FILER_FRAGMENT_SHARD_ENVELOPE_BYTES
          + Buffer.byteLength(serializeFilerFragmentEntry(fragment))
          <= SHARD_RESPONSE_CEILING_BYTES,
      );
    });
    const rebuilt = reassembleFilerFragments(JSON.parse(JSON.stringify(fragments)), payload.cik);
    assert.equal(JSON.stringify(rebuilt), JSON.stringify(payload));
  } finally {
    db.close();
  }
});

test("v2 fragment transport rejects missing, reordered, duplicate, cross-CIK, offset, and unknown data", () => {
  const db = fixtureDb();
  try {
    const fragments = fragmentFilerPayload(assemble(db));
    const clone = (): FilerFragmentV2[] => structuredClone(fragments);
    assert.throws(() => reassembleFilerFragments(clone().slice(0, -1)), /declares|sequence/);
    const reordered = clone();
    [reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
    assert.throws(() => reassembleFilerFragments(reordered), /expected part|order/);
    const duplicate = clone();
    duplicate[2] = structuredClone(duplicate[1]!);
    assert.throws(() => reassembleFilerFragments(duplicate), /expected part|duplicate/);
    const cross = clone();
    cross[1]!.cik = "0000000042";
    assert.throws(() => reassembleFilerFragments(cross), /cross-CIK/);
    const offset = clone();
    offset[1]!.start += 1;
    assert.throws(() => reassembleFilerFragments(offset), /period\/start/);
    const unknown = structuredClone(fragments[0]) as FilerFragmentV2 & { smuggled?: boolean };
    unknown.smuggled = true;
    assert.throws(() => parseFilerFragmentV2(unknown), /unknown key/);
  } finally {
    db.close();
  }
});

test("fragmenter refuses a one-entry response over 1 MiB and a 65-part filer", () => {
  const db = fixtureDb();
  try {
    const oversized = structuredClone(assemble(db));
    oversized.rowsByPeriod[oversized.current]![0]!.issuer_name = "X".repeat(1_100_000);
    assert.throws(() => fragmentFilerPayload(oversized), /one-entry shard/);

    const fanout = structuredClone(assemble(db));
    const template = fanout.rowsByPeriod[fanout.current]![0]!;
    fanout.filings = {};
    fanout.rowsByPeriod = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`P${String(i).padStart(2, "0")}`, [template]]),
    );
    fanout.totalsByPeriod = Object.fromEntries(Object.keys(fanout.rowsByPeriod).map((p) => [p, 1]));
    fanout.concByPeriod = {};
    fanout.deltasByPeriod = {};
    assert.throws(() => fragmentFilerPayload(fanout), /65 fragments|64-part/);
  } finally {
    db.close();
  }
});

test("the assembler is the pre-rendered page's inputs, field for field (parity)", () => {
  const db = fixtureDb();
  try {
    const p = assemble(db);
    // Surface half: periods from the projection, OD-5 current+prior, rows
    // display-ordered by the ONE comparator, pre-cap true totals.
    assert.deepEqual(p.periods, ["2025-12-31", "2026-03-31"]);
    assert.equal(p.current, "2026-03-31");
    assert.equal(p.prior, "2025-12-31");
    assert.deepEqual(Object.keys(p.rowsByPeriod).sort(), ["2025-12-31", "2026-03-31"]);
    assert.equal(p.totalsByPeriod["2026-03-31"], 2);
    for (const rows of Object.values(p.rowsByPeriod)) {
      const sorted = [...rows].sort(compareHoldingRows);
      assert.deepEqual(rows, sorted, "rows arrive display-ordered");
    }
    // NULL-honest: the undisclosed value survives as null, never 0.
    const msft = p.rowsByPeriod["2026-03-31"]!.find((r) => r.issuer_name === "MICROSOFT CORP");
    assert.equal(msft!.value_usd, null);
    // Aggregate half: exactly the filerBody signature inputs (ui.ts, verified),
    // topn SEPARATE from topn_share_bps.
    assert.equal(p.topn, 25);
    assert.equal(p.concByPeriod["2026-03-31"]!.topn_share_bps, null);
    assert.equal(p.latestFiled, "2026-05-15");
    assert.deepEqual(p.window, { open: false, quarterEnd: "2026-06-30", deadline: "2026-08-14" });
    // R22: filings are REFERENCED-ONLY — key 9 belongs to the other filer and
    // must not ride along; keys 1 and 2 are cited by the included rows.
    assert.deepEqual(Object.keys(p.filings).sort(), ["1", "2"]);
    // Per-entity read: the other filer's rows never leak in.
    assert.ok(
      Object.values(p.rowsByPeriod).every((rows) => rows.every((r) => r.cik === "0001067983")),
    );
  } finally {
    db.close();
  }
});

test("a filer with no serving rows still assembles (empty periods, honest absence)", () => {
  const db = fixtureDb();
  try {
    const p = assembleFilerPayload(db, {
      cik: "0000009999",
      filerName: "NO ROWS LLC",
      latestPeriod: "2026-03-31",
      requestedPeriod: "2026-03-31",
      filings: readServingFilings(db),
      agg: { concByPeriod: {}, deltasByPeriod: {}, latestFiled: null, topn: 25, window: null },
    });
    assert.deepEqual(p.periods, []);
    assert.deepEqual(p.rowsByPeriod, {});
    assert.deepEqual(p.filings, {});
    assert.equal(p.current, "2026-03-31");
    // ...and it still round-trips.
    assert.deepStrictEqual(parseFilerPayload(JSON.parse(JSON.stringify(p))), p);
  } finally {
    db.close();
  }
});

test("parseFilerPayload: version discriminator is strict-checked", () => {
  const db = fixtureDb();
  try {
    const payload = JSON.parse(JSON.stringify(assemble(db)));
    payload.v = 2;
    assert.throws(
      () => parseFilerPayload(payload),
      (err: unknown) => err instanceof FilerPayloadError && err.code === "version" && err.got === 2,
    );
    delete payload.v;
    assert.throws(
      () => parseFilerPayload(payload),
      (err: unknown) => err instanceof FilerPayloadError && err.code === "bad_payload",
    );
  } finally {
    db.close();
  }
});

test("parseFilerPayload rejects, never defaults — every required field", () => {
  const db = fixtureDb();
  try {
    const good = assemble(db);
    for (const field of [
      "kind",
      "cik",
      "filerName",
      "latestPeriod",
      "periods",
      "current",
      "prior",
      "filings",
      "rowsByPeriod",
      "totalsByPeriod",
      "concByPeriod",
      "deltasByPeriod",
      "latestFiled",
      "topn",
      "window",
    ]) {
      const mutant = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      delete mutant[field];
      assert.throws(
        () => parseFilerPayload(mutant),
        FilerPayloadError,
        `dropping ${field} must be rejected, not defaulted`,
      );
    }
    // NULL-honest: a fabricated string where the contract says number|null.
    const mutant = JSON.parse(JSON.stringify(good));
    mutant.concByPeriod["2026-03-31"].topn_share_bps = "0";
    assert.throws(() => parseFilerPayload(mutant), FilerPayloadError);
    // ...while the legitimate nulls pass (asserted by the round trip above).
  } finally {
    db.close();
  }
});

test("F4: every required nested field rejects when ABSENT — per field, naming it", () => {
  /* Codex F4: the earlier strict fix rejected UNKNOWN keys but not MISSING
     required ones — a holding row containing only `period` parsed fine, with
     every other field silently defaulted. NULL-honest means an explicit null
     on the wire; absence must reject, naming the field path. One deletion
     test PER field, not one sample. */
  const db = fixtureDb();
  try {
    const good = assemble(db);
    const del = (mutate: (p: any) => void, label: string): void => {
      const mutant = JSON.parse(JSON.stringify(good));
      mutate(mutant);
      assert.throws(
        () => parseFilerPayload(mutant),
        (err: unknown) =>
          err instanceof FilerPayloadError &&
          err.code === "bad_payload" &&
          err.message.includes(label),
        `deleting ${label} must reject naming it, never default`,
      );
    };
    // FilerHoldingRow: every contract field (nullable ones must be PRESENT
    // with explicit null, never absent).
    for (const field of [
      "cik", "period", "filing_key", "security_id", "cusip", "issuer_name",
      "title_of_class", "value_usd", "shares", "ssh_type", "put_call",
      "position_key", "put_call_bucket", "unit_key", "flags",
    ]) {
      del((p) => delete p.rowsByPeriod["2026-03-31"][0][field], field);
    }
    // A row carrying ONLY `period` is the reported repro — reject, not default.
    del((p) => void (p.rowsByPeriod["2026-03-31"][0] = { period: "2026-03-31" }), "cik");
    // ConcentrationRow.
    for (const field of [
      "cik", "period_of_report", "position_count", "total_value_usd",
      "null_value_positions", "topn_value_usd", "topn_share_bps", "hhi", "flags",
    ]) {
      del((p) => delete p.concByPeriod["2026-03-31"][field], field);
    }
    // QoqDeltaRow.
    for (const field of [
      "cik", "position_key", "put_call", "curr_period", "prev_period",
      "change_kind", "prev_value_usd", "curr_value_usd", "delta_value_usd",
      "prev_shares", "curr_shares", "delta_shares", "ssh_prnamt_type", "flags",
    ]) {
      del((p) => delete p.deltasByPeriod["2026-03-31"][0][field], field);
    }
    // FilingRef entries.
    for (const field of [
      "accession", "submission_type", "period_of_report", "filed_date",
      "doc_url", "source",
    ]) {
      del((p) => delete p.filings["1"][field], field);
    }
    // FilingWindow.
    for (const field of ["open", "quarterEnd", "deadline"]) {
      del((p) => delete p.window[field], `window.${field}`);
    }
  } finally {
    db.close();
  }
});

test("parseFilerPayload keeps the change-field grain ban on the client", () => {
  const db = fixtureDb();
  try {
    const mutant = JSON.parse(JSON.stringify(assemble(db)));
    mutant.rowsByPeriod["2026-03-31"][0].delta_value_usd = 5;
    assert.throws(
      () => parseFilerPayload(mutant),
      (err: unknown) =>
        err instanceof FilerPayloadError && /change field/.test(err.message),
    );
  } finally {
    db.close();
  }
});

/* ---------- shard geometry (LD-10): fail, never truncate ---------- */

function item(key: string, bytes: number): { key: string; json: string } {
  return { key, json: `"${key}":"${"x".repeat(Math.max(0, bytes - key.length - 5))}"` };
}

test("paginateByBytes: byte ceiling closes a shard before it is crossed", () => {
  const plan = paginateByBytes([item("a", 400), item("b", 400), item("c", 400)], {
    ceilingBytes: 900,
    overheadBytes: 20,
  });
  assert.equal(plan.shards.length, 2);
  assert.deepEqual(plan.shards[0]!.entries.map((e) => e.key), ["a", "b"]);
  assert.deepEqual(plan.shards[1]!.entries.map((e) => e.key), ["c"]);
  for (const s of plan.shards) assert.ok(s.projectedBytes <= 900);
});

test("LD-10: a single item over the ceiling is a build ERROR naming the filer", () => {
  /* Round-6 N1 / R22 binding: an oversized payload never gets a dedicated
     shard — the 1 MiB ceiling is the owner's invariant, and widening it here
     would be silent. The removal-fails pin for the over-ceiling case. */
  assert.throws(
    () => paginateByBytes([item("0009999999", 2_000)], { ceilingBytes: 1_000, overheadBytes: 10, itemNoun: "filer" }),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes("0009999999") &&
      err.message.includes("filer") &&
      /architecture decision/.test(err.message),
  );
});

test("paginateByBytes FAILS past the shard limit — never truncates", () => {
  assert.throws(
    () =>
      paginateByBytes([item("a", 400), item("b", 400), item("c", 400)], {
        ceilingBytes: 450,
        overheadBytes: 10,
        shardLimit: 2,
        itemNoun: "filer",
      }),
    /never truncates/,
  );
  // The SAME core, configured as activity is, truncates and says so.
  const truncated = fillShardsByBytes(
    [item("a", 400), item("b", 400), item("c", 400)].map((i) => ({ ...i })),
    { ceilingBytes: 450, overheadBytes: 10, itemLimit: 10, shardLimit: 2 },
    { onOverflow: "truncate", onOversizedItem: "own-shard" },
  );
  assert.equal(truncated.droppedCount, 1);
});

test("shard completeness at the plan level: every item in exactly one shard", () => {
  const items = Array.from({ length: 40 }, (_, i) => item(`f${String(i).padStart(3, "0")}`, 150));
  const plan = paginateByBytes(items, { ceilingBytes: 700, overheadBytes: 30 });
  const seen = new Map<string, number>();
  for (const s of plan.shards)
    for (const e of s.entries) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
  assert.equal(seen.size, items.length, "every item is placed");
  for (const [key, count] of seen) assert.equal(count, 1, `${key} appears in exactly one shard`);
  assert.equal(plan.totalItems, items.length);
});

/* ---------- mirrors: one source of truth in inst_budget.py ---------- */

function pyInt(source: string, name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, "m").exec(source);
  assert.ok(m, `${name} is defined in inst_budget.py`);
  const rhs = m![1]!.replace(/[_\s]/g, "");
  assert.match(rhs, /^[0-9*+]+$/, `${name} is a plain integer expression`);
  return rhs
    .split("+")
    .map((term) => term.split("*").reduce((a, b) => a * Number(b), 1))
    .reduce((a, b) => a + b, 0);
}

test("the shard constants MIRROR src/populus/inst_budget.py — no second source", () => {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_budget.py"), "utf-8");
  assert.equal(SHARD_RESPONSE_CEILING_BYTES, pyInt(py, "FILER_SHARD_BYTE_CEILING"));
  assert.equal(SHARD_RESPONSE_CEILING_BYTES, 1_048_576, "LD-10: 1 MiB, the reader's bound");
  assert.equal(FILER_TAIL_SHARDS_MAX, pyInt(py, "FILER_TAIL_SHARDS_RESERVED"));
  assert.equal(FILER_FRAGMENT_TARGET_BYTES, pyInt(py, "FILER_FRAGMENT_TARGET_BYTES"));
  assert.equal(FILER_FRAGMENT_PARTS_MAX, pyInt(py, "FILER_FRAGMENT_PARTS_MAX"));
  assert.equal(FILER_FRAGMENT_SIZING_SENTINEL, pyInt(py, "FILER_FRAGMENT_SIZING_SENTINEL"));
  const m2FilerPages = pyInt(py, "M2_FILER_PAGES");
  assert.equal(FILER_PAGE_BUDGET, m2FilerPages, "LD-7 cut == the budget's M2 term");
  const source = readFileSync(path.join(DASH, "src", "lib", "filer-payload.ts"), "utf-8");
  assert.match(
    source,
    /fragmentValue\(cik, FILER_FRAGMENT_SIZING_SENTINEL,\s*FILER_FRAGMENT_SIZING_SENTINEL/,
    "the conservative five-digit sentinel must remain load-bearing in the cut",
  );
});

test("the routing-index and shard paths agree between producer and driver", () => {
  assert.equal(FILER_INDEX_PATH, "/institutional/data/filers/index.v2.json");
  assert.equal(filerShardPath(0), "/institutional/data/filers/0.v2.json");
});

/* ---------- STRICT: unknown fields reject at every level (Codex F6) ---------- */

test("STRICT: an unknown top-level key is rejected, naming the key", () => {
  const db = fixtureDb();
  try {
    const mutant = JSON.parse(JSON.stringify(assemble(db)));
    mutant.extraneous = true;
    assert.throws(
      () => parseFilerPayload(mutant),
      (err: unknown) =>
        err instanceof FilerPayloadError &&
        err.code === "bad_payload" &&
        /unknown key at extraneous/.test(err.message),
    );
  } finally {
    db.close();
  }
});

test("STRICT: an unknown nested key in a ConcentrationRow is rejected with its path", () => {
  const db = fixtureDb();
  try {
    const mutant = JSON.parse(JSON.stringify(assemble(db)));
    mutant.concByPeriod["2026-03-31"].sneaky = 1;
    assert.throws(
      () => parseFilerPayload(mutant),
      (err: unknown) =>
        err instanceof FilerPayloadError &&
        err.code === "bad_payload" &&
        /concByPeriod\["2026-03-31"\]\.sneaky/.test((err as Error).message),
    );
  } finally {
    db.close();
  }
});

test("STRICT: an unknown key in window is rejected with its path", () => {
  const db = fixtureDb();
  try {
    const mutant = JSON.parse(JSON.stringify(assemble(db)));
    mutant.window.grace_days = 5;
    assert.throws(
      () => parseFilerPayload(mutant),
      (err: unknown) =>
        err instanceof FilerPayloadError &&
        err.code === "bad_payload" &&
        /window\.grace_days/.test((err as Error).message),
    );
  } finally {
    db.close();
  }
});

test("STRICT: unknown keys in filings entries, delta rows, and holding rows reject", () => {
  const db = fixtureDb();
  try {
    const base = () => JSON.parse(JSON.stringify(assemble(db)));
    const inFiling = base();
    inFiling.filings["1"].smuggled = "x";
    assert.throws(
      () => parseFilerPayload(inFiling),
      (err: unknown) => err instanceof FilerPayloadError && /filings\["1"\]\.smuggled/.test((err as Error).message),
    );
    const inDelta = base();
    inDelta.deltasByPeriod["2026-03-31"][0].smuggled = "x";
    assert.throws(
      () => parseFilerPayload(inDelta),
      (err: unknown) => err instanceof FilerPayloadError && /smuggled/.test((err as Error).message),
    );
    const inRow = base();
    inRow.rowsByPeriod["2026-03-31"][0].smuggled = "x";
    assert.throws(
      () => parseFilerPayload(inRow),
      (err: unknown) => err instanceof FilerPayloadError && /rowsByPeriod\["2026-03-31"\]\[0\]\.smuggled/.test((err as Error).message),
    );
  } finally {
    db.close();
  }
});

/* ---------- Codex F7: present module + broken serving artifact = build failure ---------- */

const SERVING_ENV_KEYS = ["POPULUS_INST_SERVING_DB", "POPULUS_INST_DB", "POPULUS_BUILD_DIR"] as const;

function withServingEnv(dbPath: string | null, fn: () => void): void {
  const saved = SERVING_ENV_KEYS.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of SERVING_ENV_KEYS) delete process.env[k];
    if (dbPath !== null) process.env.POPULUS_INST_SERVING_DB = dbPath;
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function fakeBuild(buildId: string, present: boolean): Parameters<typeof filerTailShards>[0] {
  const inst = present
    ? { present: true, filers: [] }
    : { present: false, reason: "module-absent" };
  return { buildId, inst } as unknown as Parameters<typeof filerTailShards>[0];
}

test("F7: inst present + missing serving artifact THROWS naming the path — never an empty index", () => {
  const missing = path.join(DASH, "no-such-dir", "inst_serving.db");
  withServingEnv(missing, () => {
    assert.throws(
      () => filerTailShards(fakeBuild("f7-missing", true)),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(missing) &&
        /refusing to publish an empty filer routing index/.test(err.message),
    );
  });
});

test("F7: inst present + no resolvable serving path THROWS — never an empty index", () => {
  withServingEnv(null, () => {
    assert.throws(
      () => filerTailShards(fakeBuild("f7-unlocatable", true)),
      /no serving artifact path resolves/,
    );
  });
});

test("F7: the absent family is reserved for a genuinely absent module", () => {
  withServingEnv(null, () => {
    const family = filerTailShards(fakeBuild("f7-absent", false));
    assert.equal(family.present, false);
    assert.equal(family.reason, "module-absent");
    assert.deepEqual(family.routes, {});
    assert.ok(family.indexBody.includes('"absent":"module-absent"'));
    assert.ok(family.indexBody.includes('"v":2'));
  });
});

/* ---------- LD-7 parity: ONE interchange fixture, two implementations ---------- */

test("LD-7 parity: selectTopFilers matches the shared Python interchange fixture exactly", () => {
  /* tests/fixtures/filer_selection_parity.v1.json is consumed by BOTH
     implementations of the LD-7 rule — scripts/measure_inst_derive.py
     (asserted in tests/test_inst_snapshot_script.py) and this one — so the
     rule cannot drift silently between the T0 measurement and the build.
     The fixture carries the null-vs-disclosed-0 case (a null must lose even
     to a disclosed 0 with a higher CIK) and value ties. */
  const fixture = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "tests", "fixtures", "filer_selection_parity.v1.json"),
      "utf-8",
    ),
  ) as { budget: number; rows: FilerSelectionInput[]; expected: string[] };
  assert.ok(fixture.rows.length > fixture.budget, "the fixture exercises the cut");
  assert.ok(
    fixture.rows.some((r) => r.latestPeriodValueUsd === null) &&
      fixture.rows.some((r) => r.latestPeriodValueUsd === 0),
    "the fixture carries both null and disclosed-0 values",
  );
  assert.deepEqual(selectTopFilers(fixture.rows, fixture.budget), fixture.expected);
});

/* ---------- F2 byte parity: ONE serialized payload, two runtimes ---------- */

interface ParityCase {
  name: string;
  args: { cik: string; filerName: string; latestPeriod: string; requestedPeriod: string };
  rawRows: unknown[][];
  generateRows?: { count: number; period: string; padLength: number; padChar: string };
  filings: Record<string, unknown>;
  agg: {
    concByPeriod: Record<string, ConcentrationRow | null>;
    deltasByPeriod: Record<string, QoqDeltaRow[]>;
    latestFiled: string | null;
    topn: number;
    window: { open: boolean; quarterEnd: string; deadline: string } | null;
  };
  expected?: string;
  expected_sha256: string;
  expected_utf8_bytes: number;
  fragment_summary_v2: {
    parts: number;
    fragments: {
      part: number;
      section: string;
      period: string | null;
      start: number;
      records: number | null;
      entry_utf8_bytes: number;
    }[];
  };
}

function expandParityRows(c: ParityCase): unknown[][] {
  const rows = [...c.rawRows];
  if (c.generateRows) {
    const g = c.generateRows;
    for (let i = 0; i < g.count; i++) {
      const issuer = `PAD CORP ${String(i).padStart(4, "0")} ` + g.padChar.repeat(g.padLength);
      rows.push([
        c.args.cik, g.period, null, null, String(i).padStart(9, "0"), issuer, "COM",
        1_000_000 - i, i + 1, "SH", "LONG", `sid:p${i}`, "LONG", "SH", "[]",
      ]);
    }
  }
  return rows;
}

test("F2 byte parity: assembleFilerPayload reproduces the shared fixture's canonical bytes", () => {
  /* Codex F2: the T0 measurement (scripts/measure_inst_derive.py) and THIS
     production assembler must serialize the identical FilerPayloadV1 from the
     same composed serving fixture — flags normalization, sort tie-break, the
     embed-cap boundary, a null-heavy row, both window states, referenced-only
     filings. Canonical form is JSON.stringify (no whitespace, non-ASCII
     unescaped); the Python half asserts the SAME expected bytes in
     tests/test_inst_snapshot_script.py. Byte equality is asserted directly on
     small cases and via sha256+length over the full serialization on the
     multi-MB cap case (a hash over all bytes IS byte equality). */
  const fixture = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "filer_payload_parity.v1.json"), "utf-8"),
  ) as { columns: string[]; cases: ParityCase[] };
  assert.deepEqual(
    fixture.cases.map((c) => c.name),
    ["flags_sort_ties_null_heavy_referenced_only", "window_null_empty_rows", "cap_boundary_over_embed_cap"],
  );
  for (const c of fixture.cases) {
    // FK enforcement off: the fixture's filing DICTIONARY is an assembler
    // argument (readServingFilings is not under test here), so serving_filings
    // stays empty — including key 3, cited by a row and deliberately absent
    // from the dictionary (the referenced-only "not in dictionary" state).
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    try {
      db.exec(SCHEMA);
      const insert = db.prepare(
        `INSERT INTO serving_filer_rows (${fixture.columns.join(", ")})
         VALUES (${fixture.columns.map(() => "?").join(", ")})`,
      );
      for (const row of expandParityRows(c)) {
        insert.run(...(row as (string | number | null)[]));
      }
      const payload = assembleFilerPayload(db, {
        cik: c.args.cik,
        filerName: c.args.filerName,
        latestPeriod: c.args.latestPeriod,
        requestedPeriod: c.args.requestedPeriod,
        filings: c.filings as Parameters<typeof assembleFilerPayload>[1]["filings"],
        agg: c.agg,
      });
      const serialized = JSON.stringify(payload);
      const fragments = fragmentFilerPayload(payload);
      const fragmentSummary = {
        parts: fragments.length,
        fragments: fragments.map((fragment) => ({
          part: fragment.part,
          section: fragment.section,
          period: fragment.period,
          start: fragment.start,
          records: Array.isArray(fragment.data) ? fragment.data.length : null,
          entry_utf8_bytes: Buffer.byteLength(serializeFilerFragmentEntry(fragment)),
        })),
      };
      assert.deepEqual(
        fragmentSummary,
        c.fragment_summary_v2,
        `${c.name}: exact shared v2 fragment summary`,
      );
      assert.equal(
        JSON.stringify(reassembleFilerFragments(fragments, payload.cik)),
        serialized,
        `${c.name}: v2 fragment reassembly bytes`,
      );
      assert.ok(fragments.length <= FILER_FRAGMENT_PARTS_MAX, `${c.name}: bounded fan-out`);
      if (c.expected !== undefined) {
        assert.equal(serialized, c.expected, `${c.name}: canonical bytes diverge`);
      }
      assert.equal(Buffer.byteLength(serialized), c.expected_utf8_bytes, `${c.name}: length`);
      assert.equal(
        createHash("sha256").update(serialized, "utf-8").digest("hex"),
        c.expected_sha256,
        `${c.name}: sha256 of the canonical serialization`,
      );
      if (c.generateRows) {
        // The cap case genuinely crossed the embed cap: capped < true total.
        const period = c.generateRows.period;
        assert.equal(payload.totalsByPeriod[period], c.generateRows.count);
        assert.ok(payload.rowsByPeriod[period]!.length < c.generateRows.count);
        assert.ok(fragments.length > 1, "multi-megabyte cap case must exercise fragmentation");
      }
    } finally {
      db.close();
    }
  }
});


test("F3: a holding row carrying another filer's cik is bad_payload naming the path", () => {
  const payload = structuredClone(assemble(fixtureDb()));
  payload.rowsByPeriod[payload.current][0].cik = "0009999999";
  assert.throws(
    () => parseFilerPayload(payload),
    (e: unknown) =>
      e instanceof FilerPayloadError && e.code === "bad_payload" && /rowsByPeriod\[/.test(e.message),
  );
});

test("F3: a concentration row with a foreign cik is bad_payload", () => {
  const payload = structuredClone(assemble(fixtureDb()));
  const period = Object.keys(payload.concByPeriod).find((k) => payload.concByPeriod[k] !== null)!;
  payload.concByPeriod[period]!.cik = "0009999999";
  assert.throws(
    () => parseFilerPayload(payload),
    (e: unknown) => e instanceof FilerPayloadError && /concByPeriod\[/.test(e.message),
  );
});

/* Codex F3 (delta round) — period/map-key agreement. Each map is keyed by
   period AND its records carry their own period field; a disagreement renders
   one quarter's positions under another quarter's heading. One test per row
   type, because each type names its period differently and validating the
   wrong field for a type is exactly the defect these pin. */

test("F3: a holding row whose period disagrees with its map key is bad_payload naming the path", () => {
  const payload = structuredClone(assemble(fixtureDb()));
  const period = payload.current;
  payload.rowsByPeriod[period]![0]!.period = "2019-06-30";
  assert.throws(
    () => parseFilerPayload(payload),
    (e: unknown) =>
      e instanceof FilerPayloadError &&
      e.code === "bad_payload" &&
      /rowsByPeriod\["2026-03-31"\]\[0\]\.period 2019-06-30 != map key 2026-03-31/.test(e.message),
  );
});

test("F3: a concentration row whose period_of_report disagrees with its map key is bad_payload", () => {
  const payload = structuredClone(assemble(fixtureDb()));
  const period = Object.keys(payload.concByPeriod).find((k) => payload.concByPeriod[k] !== null)!;
  payload.concByPeriod[period]!.period_of_report = "2019-06-30";
  assert.throws(
    () => parseFilerPayload(payload),
    (e: unknown) =>
      e instanceof FilerPayloadError &&
      e.code === "bad_payload" &&
      /concByPeriod\["2026-03-31"\]\.period_of_report 2019-06-30 != map key 2026-03-31/.test(
        e.message,
      ),
  );
});

test("F3: a delta row whose curr_period disagrees with its map key is bad_payload", () => {
  const payload = structuredClone(assemble(fixtureDb()));
  const period = Object.keys(payload.deltasByPeriod).find(
    (k) => payload.deltasByPeriod[k]!.length > 0,
  )!;
  payload.deltasByPeriod[period]![0]!.curr_period = "2019-06-30";
  assert.throws(
    () => parseFilerPayload(payload),
    (e: unknown) =>
      e instanceof FilerPayloadError &&
      e.code === "bad_payload" &&
      /deltasByPeriod\["2026-03-31"\]\[0\]\.curr_period 2019-06-30 != map key 2026-03-31/.test(
        e.message,
      ),
  );
});

test("F3: prev_period is deliberately NOT cross-checked — it names the comparison quarter", () => {
  // The delta's prev_period legitimately differs from the map key; a
  // cross-check there would reject every valid QoQ record.
  const payload = structuredClone(assemble(fixtureDb()));
  const parsed = parseFilerPayload(structuredClone(payload));
  assert.equal(parsed.deltasByPeriod["2026-03-31"]![0]!.prev_period, "2025-12-31");
  assert.notEqual(parsed.deltasByPeriod["2026-03-31"]![0]!.prev_period, "2026-03-31");
});
