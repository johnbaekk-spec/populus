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
  assert.equal(inst.schema_version, "1.1");
  assert.equal(inst.watermarks.latest_period_of_report, "2026-03-31");
  assert.equal(inst.watermarks.latest_filed_date, "2026-05-15");
  assert.ok(inst.artifacts[0].logical_digest, "the db artifact carries its logical digest");
});

test("filer happy path emitted: /institutional/filers/1067983/ renders the aggregate", () => {
  const page = path.join(DIST_FIXTURE, "institutional", "filers", "1067983", "index.html");
  assert.ok(existsSync(page), "the Berkshire filer page is emitted at the unpadded-CIK route");
  const html = readFileSync(page, "utf-8");
  assert.ok(html.includes("BERKSHIRE HATHAWAY INC"));
  // QA M2-8 M6: this used to assert `ui.ts`'s header copy, which was a SECOND
  // phrasing of the §5 data_note under a heading one character from the
  // canonical box's ("…and is not." vs "…and is not") — both rendering on this
  // page. The header now states its own claim and links into the canonical box,
  // whose presence is asserted clause-by-clause further down this file.
  assert.ok(
    !html.includes("What a 13F is — and is not."),
    "the header carries a second phrasing of the §5 data_note",
  );
  assert.ok(html.includes('id="inst-data-note"'), "the canonical §5 box renders");
  assert.ok(html.includes('href="#inst-data-note"'), "the header links into it");
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

/* ---------- R16 honesty, asserted over REAL rendered HTML ----------

   QA M2-8 M4/M5. Both of these were previously "pinned" by tests that could not
   fail:

   * `css-fold.test.ts` built each surface as
     `pageSource(...) + filerBody(...) + surfaceHtml(...) + institutionalDataNoteHtml()`
     — appending the note ITSELF, as the test. `surfaceHtml` does not emit it;
     the real pages get it from `HoldingsTable.astro`. So deleting that line broke
     every institutional page and broke no test. The backstop
     (`assert.ok(src.includes("institutionalDataNoteHtml()"))`) survived the
     deletion too, because the literal string also appears in a prose comment at
     the top of the same component.
   * the spec promises "a grep-based assertion in the post-build gate enforces"
     the §1.1 wording ban. No such gate existed — `test/post/` had three files and
     none of them scanned `dist/`.

   These run against `dist-fixture/`, which is the only tree in the repo where the
   institutional surfaces are actually rendered (the production dev build ships no
   inst module). The bytes asserted here are the bytes a reader would receive. */

const INST_PAGES = [
  path.join("institutional", "filers", "1067983", "index.html"),
  path.join("institutional", "tickers", "AAPL", "holders", "index.html"),
];

test("POST-BUILD: the §5 data_note renders on every institutional surface, clause by clause", async () => {
  const { INSTITUTIONAL_DATA_NOTE_CLAUSES } = await import("../../src/lib/activity.ts");
  assert.ok(INSTITUTIONAL_DATA_NOTE_CLAUSES.length > 0, "the clause list is not empty");
  for (const rel of INST_PAGES) {
    const file = path.join(DIST_FIXTURE, rel);
    assert.ok(existsSync(file), `${rel} was emitted`);
    const html = readFileSync(file, "utf-8");
    assert.ok(
      html.includes("data-inst-data-note"),
      `${rel} does not render the §5 data_note at all`,
    );
    for (const clause of INSTITUTIONAL_DATA_NOTE_CLAUSES) {
      assert.ok(
        html.includes(`data-note-clause="${clause.id}"`),
        `${rel} is missing §5 clause "${clause.id}" — the note is not removable`,
      );
    }
  }
});

test("POST-BUILD: no §1.1 banned wording anywhere in the rendered institutional tree", async () => {
  const { scanBannedWording } = await import("../../src/lib/activity.ts");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name);
      if (name.isDirectory()) walk(p, out);
      else if (name.name.endsWith(".html") || name.name.endsWith(".json")) out.push(p);
    }
    return out;
  };
  const files = walk(path.join(DIST_FIXTURE, "institutional"));
  assert.ok(files.length > 3, `only ${files.length} institutional files scanned — vacuous`);

  // Control: the scanner must be able to SEE a violation in this exact channel,
  // or "no hits" proves nothing. [[measure-the-mechanism]]
  const sample = readFileSync(files[0]!, "utf-8");
  assert.ok(
    scanBannedWording(sample + "<p>the fund is loading up here</p>").length > 0,
    "the post-build scanner cannot detect a known violation — the gate is blind",
  );

  const offences: string[] = [];
  for (const f of files) {
    const hits = scanBannedWording(readFileSync(f, "utf-8"));
    if (hits.length) offences.push(`${path.relative(DIST_FIXTURE, f)}: ${hits.join(", ")}`);
  }
  assert.deepEqual(offences, [], `banned §1.1 wording in the built tree:\n${offences.join("\n")}`);
});

test("POST-BUILD: no unqualified 'all' claim on the rendered holders surface (R12)", async () => {
  const { unqualifiedAllClaims } = await import("../../src/lib/holdings.ts");
  const html = readFileSync(
    path.join(DIST_FIXTURE, "institutional", "tickers", "AAPL", "holders", "index.html"),
    "utf-8",
  );
  // Control first: the checker must fire on a planted violation in real page bytes.
  assert.ok(
    unqualifiedAllClaims(html + "<p>all holders of this issuer</p>").length > 0,
    "the 'all' checker cannot see a planted claim — the gate is blind",
  );
  assert.deepEqual(unqualifiedAllClaims(html), []);
});
