/* Institutional adapter tests against a PRODUCER-BUILT fixture aggregate
   (Locked #19): the identity-seeded mini-corpus runs through the real
   populus.inst_agg.build_inst_agg (spawned via uv — no re-implementation, no
   hand-written aggregate rows), then the loader and the period-correct
   accessors (Locked #6) are exercised over its actual bytes.

   Pins the two semantics reviews kept catching: registry counts are
   CUMULATIVE across periods (identity context only), and two periods render
   two different totals through agg_filer_concentration. */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadInstitutional,
  filerPeriods,
  concentrationFor,
  deltasFor,
  holdersFor,
  issuerPeriods,
  entityKeyedIssuers,
  readTickerMapJson,
  type InstData,
} from "../src/lib/inst.ts";
import { qoqPresentation } from "../src/lib/derive.ts";
import { filerPeriodSectionHtml, filerTiles } from "../src/lib/ui.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BRK = "0001067983";
const BOND = "0009000077";
const AAPL_KEY = "entity:cik:0000320193";

let buildDir: string;
let inst: InstData;

before(() => {
  buildDir = mkdtempSync(path.join(tmpdir(), "populus-inst-fixture-"));
  execFileSync(
    "uv",
    ["run", "python", "dashboard/test/fixtures/make-inst-preview.py", buildDir, "--agg-only"],
    { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "inherit"] },
  );
  inst = loadInstitutional(buildDir, {
    modules: {
      inst: {
        watermarks: {
          latest_period_of_report: "2026-03-31",
          latest_filed_date: "2026-05-15",
        },
      },
    },
  });
});

test("absence is discriminated: no module vs missing artifact", () => {
  const absent = loadInstitutional(buildDir, { modules: {} });
  assert.deepEqual(absent, { present: false, reason: "module-absent" });
  const missing = loadInstitutional(path.join(buildDir, "nonexistent"), {
    modules: { inst: { watermarks: {} } },
  });
  assert.deepEqual(missing, { present: false, reason: "artifact-missing" });
});

test("loader binds the published schema; watermarks come from the manifest", () => {
  assert.ok(inst.present);
  if (!inst.present) return;
  assert.equal(inst.filers.length, 3);
  assert.equal(inst.watermarks.latest_period_of_report, "2026-03-31");
  assert.equal(inst.watermarks.latest_filed_date, "2026-05-15");
  assert.equal(inst.topn, 25, "topn read from agg_build_meta");
});

test("registry counts are CUMULATIVE across periods — identity context, never a quarter (Locked #6)", () => {
  if (!inst.present) return;
  const brk = inst.filers.find((f) => f.cik === BRK)!;
  assert.equal(brk.filer_name, "BERKSHIRE HATHAWAY INC");
  assert.equal(brk.latest_period, "2026-03-31");
  assert.equal(brk.position_count, 4, "2 holdings × 2 periods accumulate in the registry");
  assert.equal(brk.total_value_usd, 3800, "1000+500+2000+300 across ALL periods");
  // The proof that period tiles must NOT come from the registry:
  const q1 = concentrationFor(inst, BRK, "2026-03-31")!;
  assert.notEqual(brk.total_value_usd, q1.total_value_usd);
});

test("period-correct tiles: two fixture periods render two different totals (R7)", () => {
  if (!inst.present) return;
  assert.deepEqual(filerPeriods(inst, BRK), ["2025-12-31", "2026-03-31"]);
  const q4 = concentrationFor(inst, BRK, "2025-12-31")!;
  const q1 = concentrationFor(inst, BRK, "2026-03-31")!;
  assert.equal(q4.total_value_usd, 1500);
  assert.equal(q1.total_value_usd, 2300);
  assert.notEqual(q4.total_value_usd, q1.total_value_usd);
  const htmlQ4 = filerPeriodSectionHtml(q4, deltasFor(inst, BRK, "2025-12-31"), "2025-12-31", "2026-05-15", 25);
  const htmlQ1 = filerPeriodSectionHtml(q1, deltasFor(inst, BRK, "2026-03-31"), "2026-03-31", "2026-05-15", 25);
  assert.ok(htmlQ4.includes("$1.5K"), "period Q4 renders its own total");
  assert.ok(htmlQ1.includes("$2.3K"), "period Q1 renders its own total");
  assert.notEqual(htmlQ4, htmlQ1, "changing the period changes every period-scoped number");
});

test("producer QoQ rows classify the fixture timeline; the frontend only maps", () => {
  if (!inst.present) return;
  const deltas = deltasFor(inst, BRK, "2026-03-31");
  const byKey = new Map(deltas.map((d) => [d.position_key, d]));
  const aapl = byKey.get("sid:sec:aapl")!;
  assert.equal(aapl.change_kind, "add");
  assert.equal(aapl.delta_value_usd, 1000);
  assert.equal(aapl.delta_shares, 50);
  const msft = byKey.get("sid:sec:msft")!;
  assert.equal(msft.change_kind, "exit");
  const nvda = byKey.get("sid:sec:nvda")!;
  assert.equal(nvda.change_kind, "new");
  assert.equal(qoqPresentation(aapl).chipText, "add");
  assert.equal(qoqPresentation(msft).chipText, "exit");
});

test("SH→PRN unit transition: Δshares NULL + shares_unit_mismatch, mapped to em-dash + ‡u", () => {
  if (!inst.present) return;
  const bond = deltasFor(inst, BOND, "2026-03-31");
  assert.equal(bond.length, 1);
  const row = bond[0]!;
  assert.equal(row.delta_shares, null, "the producer withholds a cross-unit share delta");
  assert.ok(row.flags.includes("shares_unit_mismatch"));
  assert.ok(row.flags.includes("classified_by_value"), "direction fell back to value");
  const p = qoqPresentation(row);
  assert.equal(p.sharesDeltaText, "—");
  assert.ok(p.chipMarkers.includes("‡u"));
  assert.ok(p.chipMarkers.includes("†v"));
});

test("holders: entity-keyed AAPL issuer ranks by summed value; bond issuer is name-keyed", () => {
  if (!inst.present) return;
  const holders = holdersFor(inst, AAPL_KEY, "2026-03-31");
  assert.deepEqual(
    holders.map((h) => [h.rank, h.cik, h.value_usd]),
    [
      [1, BRK, 2000],
      [2, "0009000099", 800],
    ],
  );
  assert.ok(holders.every((h) => h.issuer_key_source === "entity"));
  assert.deepEqual(issuerPeriods(inst, AAPL_KEY), ["2025-12-31", "2026-03-31"]);
  const keyed = entityKeyedIssuers(inst);
  assert.ok(keyed.has(AAPL_KEY));
  assert.ok(
    ![...keyed].some((k) => k.startsWith("name:")),
    "name-keyed issuers are never entity-keyed candidates",
  );
});

test("filerTiles: NULL concentration renders n/a ·§, never 0 (synthetic)", () => {
  const tiles = filerTiles(
    {
      cik: "0000000001",
      period_of_report: "2026-03-31",
      position_count: 2,
      total_value_usd: 0,
      null_value_positions: 2,
      topn_value_usd: 0,
      topn_share_bps: null,
      hhi: null,
      flags: ["concentration_unavailable"],
    },
    0,
  );
  const topn = tiles.find((t) => t.label.startsWith("top-N"))!;
  assert.equal(topn.value, "n/a ·§");
  const hhi = tiles.find((t) => t.label.startsWith("HHI"))!;
  assert.equal(hhi.value, "n/a ·§");
  assert.ok(!topn.value.includes("0%"), "an unavailable concentration is never a fabricated 0");
});

/* ---------- the CI ticker-map refusal (R1 / TD-7) ---------- */

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const FIXTURE_MAP = path.join(REPO_ROOT, "tests", "fixtures", "inst", "mcp", "company_tickers.json");

test("CI refuses a tests/fixtures ticker map — the PATH, not merely an unset variable (R1)", () => {
  // Explicitly pointed at the fixture: the served bytes would faithfully match
  // the built bytes, so no served-tree sweep could ever catch this.
  withEnv({ CI: "true", POPULUS_TICKER_MAP: FIXTURE_MAP }, () => {
    assert.throws(() => readTickerMapJson(REPO_ROOT), /tests\/fixtures/);
  });
  // Unset is the same defect wearing a different hat — the dev default IS the
  // fixture, which is exactly why refusing only "unset" would not close it.
  withEnv({ CI: "true", POPULUS_TICKER_MAP: undefined }, () => {
    assert.throws(() => readTickerMapJson(REPO_ROOT), /must not ship fixture-derived/);
  });
  // The check resolves the path, so a relative spelling is not an escape hatch.
  withEnv({ CI: "true", POPULUS_TICKER_MAP: "../tests/fixtures/inst/mcp/company_tickers.json" }, () => {
    assert.throws(() => readTickerMapJson(REPO_ROOT), /must not ship fixture-derived/);
  });
});

test("TD-7: under CI an ABSENT path is the honest no-map state, not a failure", () => {
  withEnv({ CI: "true", POPULUS_TICKER_MAP: path.join(REPO_ROOT, "no-such-map.json") }, () => {
    assert.equal(readTickerMapJson(REPO_ROOT), null, "the production setting must not throw");
  });
});

test("outside CI the committed fixture stays the dev default — the refusal is CI-scoped", () => {
  withEnv({ CI: undefined, POPULUS_TICKER_MAP: undefined }, () => {
    const map = readTickerMapJson(REPO_ROOT);
    assert.ok(map && typeof map === "object", "local renders keep the mapped path");
  });
});
