/* Post-build suite, part 3 (Locked #19): the institutional fixture-preview
   envelope. Runs the nonshipping builder (identity-seeded corpus → REAL
   build_inst_agg → manifest extended per populus.publish.manifest policy →
   self-check for entity:cik:0000320193), builds the site against the
   envelope, and verifies BOTH happy-path URLs are emitted with institutional
   content — plus the production-leakage assertion against the normal dist/. */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DASH = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(DASH, "..");
const DIST_FIXTURE = path.join(DASH, "dist-fixture");

let envelope: { build_id: string; build_dir: string; congress_db: string; ticker_map: string };

before(() => {
  const out = mkdtempSync(path.join(tmpdir(), "populus-inst-preview-"));
  const stdout = execFileSync(
    "uv",
    ["run", "python", "dashboard/test/fixtures/make-inst-preview.py", out],
    { cwd: REPO, encoding: "utf-8", timeout: 240_000 },
  );
  const lines = stdout.trim().split("\n");
  envelope = JSON.parse(lines.at(-1)!);
  execFileSync("npx", ["astro", "build", "--outDir", "dist-fixture"], {
    cwd: DASH,
    env: {
      ...process.env,
      POPULUS_BUILD_DIR: envelope.build_dir,
      POPULUS_DB: envelope.congress_db,
      POPULUS_TICKER_MAP: envelope.ticker_map,
      POPULUS_TEST_PAGE_BUDGET: "", // never inherit a cut into the fixture build
    },
    stdio: "ignore",
    timeout: 240_000,
  });
});

test("the envelope's manifest declares the inst module per producer policy", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(envelope.build_dir, "manifest.json"), "utf-8"),
  );
  const inst = manifest.modules.inst;
  assert.ok(inst, "inst module present");
  assert.equal(inst.schema_version, "1.0");
  assert.equal(inst.watermarks.latest_period_of_report, "2026-03-31");
  assert.equal(inst.watermarks.latest_filed_date, "2026-05-15");
  assert.ok(inst.artifacts[0].logical_digest, "the db artifact carries its logical digest");
});

test("filer happy path emitted: /institutional/filers/1067983/ renders the aggregate", () => {
  const page = path.join(DIST_FIXTURE, "institutional", "filers", "1067983", "index.html");
  assert.ok(existsSync(page), "the Berkshire filer page is emitted at the unpadded-CIK route");
  const html = readFileSync(page, "utf-8");
  assert.ok(html.includes("BERKSHIRE HATHAWAY INC"));
  assert.ok(html.includes("What a 13F is — and is not."));
  assert.ok(html.includes("Position changes"));
  assert.ok(html.includes("2026-03-31"), "period chips from the aggregate");
  assert.ok(html.includes("2025-12-31"));
  assert.ok(html.includes("M2-CONTRACT §3"), "the EDGAR link-out block ships");
  assert.ok(html.includes("latest filing in build filed 2026-05-15"), "Locked #20 stamp");
  assert.ok(
    html.includes("not current holdings"),
    "the page denies currency explicitly — the only permitted use of the phrase (G2)",
  );
});

test("holders happy path emitted: /institutional/tickers/AAPL/holders/ via the mapping", () => {
  const page = path.join(DIST_FIXTURE, "institutional", "tickers", "AAPL", "holders", "index.html");
  assert.ok(existsSync(page), "the AAPL holders page is emitted (mapped + entity-keyed)");
  const html = readFileSync(page, "utf-8");
  assert.ok(html.includes("BERKSHIRE HATHAWAY INC"), "the ranked holder renders");
  assert.ok(html.includes("OTHER CAPITAL LLC"));
  assert.ok(html.includes("quarter-end 2026-03-31"));
  assert.ok(html.includes("company_tickers.json"), "the mapping's provenance is printed");
  assert.ok(html.includes('data-terminus-author="populus"'));
  assert.ok(html.includes("Apple Inc."), "the mapped present-day issuer name (G14, †)");
});

test("holders pages exist ONLY for mapped, entity-keyed issuers", () => {
  const dirs = readdirSync(path.join(DIST_FIXTURE, "institutional", "tickers")).sort();
  assert.deepEqual(
    dirs,
    ["AAPL", "MSFT", "NVDA"],
    "exactly the three fixture issuers that resolve through the map AND are entity-keyed",
  );
});

test("the unified AAPL page's institutional section binds the same data", () => {
  const page = path.join(DIST_FIXTURE, "tickers", "AAPL", "index.html");
  const html = readFileSync(page, "utf-8");
  assert.ok(html.includes("Institutional holders"));
  assert.ok(html.includes("BERKSHIRE HATHAWAY INC"));
  assert.ok(html.includes("full holders view ↗"));
});

test("/institutional landing lists the fixture filers when the module is present", () => {
  const html = readFileSync(path.join(DIST_FIXTURE, "institutional", "index.html"), "utf-8");
  assert.ok(html.includes("Filers on record"));
  assert.ok(html.includes("BERKSHIRE HATHAWAY INC"));
  assert.ok(html.includes("all periods on record") || html.includes("§"), "cumulative labeling");
});

test("production leakage: the NORMAL dist/ carries no fixture-derived paths", () => {
  const dist = path.join(DASH, "dist");
  assert.ok(existsSync(path.join(dist, "index.html")), "normal dist still present and untouched");
  assert.ok(!existsSync(path.join(dist, "institutional", "filers")));
  assert.ok(!existsSync(path.join(dist, "institutional", "tickers")));
  const search = readFileSync(path.join(dist, "search", "index.v1.json"), "utf-8");
  assert.ok(!search.includes("BERKSHIRE"), "no fixture filer leaks into the production search index");
});
