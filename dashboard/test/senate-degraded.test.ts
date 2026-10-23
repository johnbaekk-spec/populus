/* Senate DEGRADED mode on the site (PLAN: Senate eFD degraded publish, R7).

   When the Senate eFD site refuses the nightly handshake, the publish carries
   the previous release's Senate rows forward and stats.json sets
   `freshness.senate_degraded`. The property pinned here: every named surface
   prints ONE plain statement of how stale the Senate data is, and ONLY in a
   degraded build. Each positive case has its control (the same input with the
   key null), so a renderer that always or never prints the sentence fails. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  senateDegraded,
  senateNoticeMeta,
  senateStaleLineHtml,
  senateStalenessShort,
  senateStalenessSentence,
} from "../src/lib/senate-freshness.ts";
import { homeFigures, homeLedgerHtml, type HomeFigureInputs } from "../src/lib/ui/home.ts";
import { memberBody, type BuildStamps } from "../src/lib/ui/index.ts";
import { memberPayloadJson, type BuildData } from "../src/lib/data.ts";
import type { MemberEntity } from "../src/lib/derive.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { scanBannedWording } from "../src/lib/activity.ts";

const SRC = path.join(import.meta.dirname, "..", "src");
const SENTENCE =
  "Senate filings through 2026-10-22 (the last successful Senate check, 2026-10-23); the Senate site has not allowed automated access since then.";
const SHORT = "Senate filings through 2026-10-22, not updated since 2026-10-23.";

function stats(degraded: boolean): Record<string, any> {
  return {
    freshness: {
      house_db_max_filed_date: "2026-10-20",
      senate_db_max_filed_date: "2026-10-22",
      senate_degraded: degraded
        ? { blocked_since: "2026-10-24", last_good_ingest_at: "2026-10-23T07:22:33.000000+00:00" }
        : null,
    },
  };
}

/* ---------- the sentence ---------- */

test("the sentence names both dates, and exists only when degraded", () => {
  assert.equal(senateStalenessSentence(stats(true)), SENTENCE);
  assert.equal(senateStalenessShort(stats(true)), SHORT);
  assert.equal(senateStalenessSentence(stats(false)), null);
  assert.equal(senateStalenessShort(stats(false)), null);
  assert.equal(senateStaleLineHtml(stats(false)), "");
  // A build that predates the key is not degraded.
  assert.equal(senateStalenessSentence({ freshness: { senate_db_max_filed_date: "2026-10-22" } }), null);
  assert.equal(senateStalenessSentence(undefined), null);
  assert.deepEqual(senateDegraded(stats(true)), { filedThrough: "2026-10-22", lastGood: "2026-10-23" });
});

test("the date stated is the last successful check, never blocked_since (an upper bound only)", () => {
  // blocked_since is 2026-10-24 in the fixture: it must appear nowhere.
  for (const text of [senateStalenessSentence(stats(true))!, senateStalenessShort(stats(true))!, senateStaleLineHtml(stats(true))]) {
    assert.ok(!text.includes("2026-10-24"), text);
    assert.ok(text.includes("2026-10-23"), text);
  }
  // control: moving last_good_ingest_at moves the stated date
  const s = stats(true);
  s.freshness.senate_degraded.last_good_ingest_at = "2026-10-20T07:00:00Z";
  assert.ok(senateStalenessSentence(s)!.includes("check, 2026-10-20)"));
  // a naive or non-UTC stamp is not trusted as a date
  s.freshness.senate_degraded.last_good_ingest_at = "2026-10-20T07:00:00";
  assert.ok(senateStalenessSentence(s)!.includes("check, a date not stated)"));
});

test("a malformed date is stated as unstated, never invented", () => {
  const s = stats(true);
  s.freshness.senate_db_max_filed_date = null;
  s.freshness.senate_degraded.last_good_ingest_at = "yesterday";
  assert.equal(
    senateStalenessSentence(s),
    "Senate filings through a date not stated (the last successful Senate check, a date not stated); the Senate site has not allowed automated access since then.",
  );
});

/* ---------- home ledger: Updated ---------- */

function homeInputs(degraded: boolean): HomeFigureInputs {
  return {
    txns: [], paper: [], members: [], filedFrom: "2014",
    stats: stats(degraded),
    coverage: { housePct: "93.9", senatePct: "100", needsOcr: 0 },
    inst: { present: false },
    signals: { active: 0, retentionDays: 45, coverageFrom: "2026-09-04", coverageTo: "2026-10-19" },
    triage: null,
    generatedAtDate: "2026-10-23",
  };
}

test("home Updated figure: not updated + the sentence when degraded, neither otherwise", () => {
  const degraded = homeLedgerHtml(homeFigures(homeInputs(true)));
  assert.ok(degraded.includes("Senate to 2026-10-22, not updated"), degraded);
  assert.ok(degraded.includes(SENTENCE));
  const current = homeLedgerHtml(homeFigures(homeInputs(false)));
  assert.ok(current.includes("Senate to 2026-10-22"));
  assert.ok(!current.includes("not updated"));
  assert.ok(!current.includes("automated access"));
});

/* ---------- senator member pages (static and /e/, one renderer) ---------- */

function txn(chamber: "senate" | "house"): TxnRow {
  return {
    kind: "txn", txnId: "t1", asset: null, assetType: null, filed: "2026-10-20", traded: "2026-10-01",
    name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK", district: chamber === "house" ? "1" : null,
    chamber, ticker: "WMB", side: "purchase", owner: null, low: 1001, high: 15000, lag: 19, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
  } as TxnRow;
}

function member(chamber: "senate" | "house"): MemberEntity {
  return {
    bioguide: "T000001", name: "Fixture Member", party: "R", state: "OK", district: chamber === "house" ? "1" : null,
    chamber, servingSince: "2019", filingCount: 1, txns: [txn(chamber)], paper: [],
  };
}

const STAMPS: BuildStamps = { buildId: "20261023.2", generatedAt: "2026-10-23 12:00 UTC", generatedAtDate: "2026-10-23" };

test("a senator's page states the sentence when degraded; not when current", () => {
  const degraded = memberBody(member("senate"), { ...STAMPS, senateNotice: senateStalenessSentence(stats(true)) }, {});
  assert.ok(degraded.includes(SENTENCE));
  assert.ok(degraded.includes("data-senate-stale"));
  const current = memberBody(member("senate"), { ...STAMPS, senateNotice: senateStalenessSentence(stats(false)) }, {});
  assert.ok(!current.includes("automated access"));
  assert.ok(!current.includes("data-senate-stale"));
  // Stamps without the field (every caller before this change) render as before.
  assert.equal(memberBody(member("senate"), STAMPS, {}), current);
});

test("a House member's page never carries the Senate sentence", () => {
  const html = memberBody(member("house"), { ...STAMPS, senateNotice: SENTENCE }, {});
  assert.ok(!html.includes("automated access"));
});

test("the member endpoint carries the notice for /e/ only when degraded", () => {
  const m = member("senate");
  const build = (degraded: boolean) =>
    ({
      membersByKey: new Map([[m.bioguide, m]]),
      buildId: STAMPS.buildId,
      generatedAt: STAMPS.generatedAt,
      generatedAtDate: STAMPS.generatedAtDate,
      stats: stats(degraded),
    }) as unknown as BuildData;
  const degraded = JSON.parse(memberPayloadJson(build(true), m.bioguide)!);
  assert.equal(degraded.meta.senateNotice, SENTENCE);
  const current = JSON.parse(memberPayloadJson(build(false), m.bioguide)!);
  assert.ok(!("senateNotice" in current.meta), "a current build's payload must not change");
  assert.deepEqual(senateNoticeMeta(stats(false)), {});
});

test("the client entity route reads the notice back into its stamps", () => {
  const client = readFileSync(path.join(SRC, "scripts", "entity-client.ts"), "utf-8");
  assert.match(client, /senateNotice: typeof meta\.senateNotice === "string" \? meta\.senateNotice : null/);
});

/* ---------- the four Astro surfaces (source wiring) ---------- */

for (const [page, marker] of [
  [["pages", "congress", "index.astro"], "{senateStaleHtml && <div class=\"stamp-line\" id=\"congress-senate-stale\""],
  [["pages", "congress", "members", "[bioguide].astro"], "senateNotice: senateStalenessSentence(build.stats)"],
  [["pages", "methodology", "index.astro"], "{senateNotice && <div data-senate-stale>"],
  [["pages", "congress", "data", "index.astro"], "{senateNotice && ("],
] as const) {
  test(`${page.join("/")} renders the sentence only behind the degraded check`, () => {
    const src = readFileSync(path.join(SRC, ...page), "utf-8");
    assert.ok(/senateSta\w+\(build\.stats\)/.test(src), "computed from this build's stats.json");
    assert.ok(src.includes(marker), `wired as ${marker}`);
    // No page spells the sentence itself: one function owns the wording.
    assert.ok(!src.includes("automated access"));
  });
}

/* ---------- /congress/ served as a degraded build ---------- */

test("/congress/ states the sentence when degraded and still fits its budgets (SC5 words, R35 elements)", async () => {
  const { congressPageFixture } = await import("./lib/congress-page.ts");
  const { servedWords } = await import("./lib/served-words.ts");
  const { firstLoadElements } = await import("./lib/astro-template.ts");
  const degraded = congressPageFixture({ senateStaleHtml: senateStaleLineHtml(stats(true)) }).html;
  const current = congressPageFixture().html;
  // the short form is visible; the full sentence rides in the line's tip
  assert.ok(degraded.includes(`id="congress-senate-stale"`) && degraded.includes(SHORT) && degraded.includes(SENTENCE));
  // control: a current build serves no statement
  assert.ok(!current.includes("congress-senate-stale") && !current.includes("automated access"));
  assert.ok(servedWords(degraded) <= 240, `the degraded page reads ${servedWords(degraded)} words`);
  assert.ok(firstLoadElements(degraded) <= 3_000);
});

test("every piece of copy the change added passes the banned-wording scan", () => {
  const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), "utf-8");
  const copy = [
    SENTENCE,
    SHORT,
    senateStaleLineHtml(stats(true)),
    homeLedgerHtml(homeFigures(homeInputs(true))),
    memberBody(member("senate"), { ...STAMPS, senateNotice: SENTENCE }, {}),
    // the page-local copy around the sentence, read from source
    /\{senateNotice && <div data-senate-stale>([^{]*)\{senateNotice\}([^<]*)</.exec(read("pages", "methodology", "index.astro"))!.slice(1).join(" "),
    /<strong>([^<]*)<\/strong>/.exec(read("pages", "congress", "data", "index.astro").slice(read("pages", "congress", "data", "index.astro").indexOf("data-senate-stale")))![1]!,
  ];
  for (const text of copy) assert.deepEqual(scanBannedWording(text), [], text.slice(0, 120));
  // control: the scan is live on this copy's shape
  assert.notDeepEqual(scanBannedWording(`${SENTENCE} Members are buying.`), []);
});
