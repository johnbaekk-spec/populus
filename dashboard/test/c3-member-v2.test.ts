/* C-3 member page v2: net-by-ticker interval subtraction, sector-mix
   coverage buckets, the dated committee join (unknown ≠ known-none), the
   jurisdiction overlap, and the NON-REMOVABLE non-allegation caveat. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  memberNetByTicker,
  sectorMix,
  membershipAsOf,
  jurisdictionOverlap,
  type CommitteeMembership,
  type MembershipSnapshot,
  type SectorResolution,
  type MemberEntity,
} from "../src/lib/derive.ts";
import { memberV2Sections, NON_ALLEGATION_CAVEAT, type BuildStamps, type MemberV2Deps } from "../src/lib/ui.ts";
import type { TxnRow, RenderCtx } from "../src/lib/format.ts";

const stamps: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: "2026-08-12" };
const ctx: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-06-24",
    name: "Test Member",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

const memberships: CommitteeMembership[] = [
  { committeeId: "HSAG", name: "House Agriculture", role: "Chair", validFrom: "2025-01-03", validTo: "2026-08-12" },
];
const snapshot: MembershipSnapshot = {
  memberships,
  windowFrom: "2025-01-03",
  windowTo: "2026-08-12",
};

test("memberNetByTicker: interval subtraction per ticker, no-ticker rows counted out", () => {
  const rows = [
    txn({ ticker: "AAA", side: "purchase", low: 15001, high: 50000 }),
    txn({ ticker: "AAA", side: "sale", low: 1001, high: 15000 }),
    txn({ ticker: null }),
  ];
  const { rows: net, noTickerRows } = memberNetByTicker(rows);
  assert.equal(noTickerRows, 1);
  assert.equal(net.length, 1);
  // net = [pL−sU, pU−sL] over the DISPLAYED statutory boundaries (sumRanges
  // floors $X+1 bucket lows to $X): [15000−15000, 50000−1000] = [0, 49000].
  assert.deepEqual(net[0]!.net, { kind: "finite", low: 0, high: 49000 });
});

test("sectorMix: every failure mode is its own labeled coverage bucket", () => {
  const resolve = (t: string): SectorResolution =>
    t === "AAA" ? { state: "sector", sector: "manufacturing" } : t === "BBB" ? { state: "no-sic" } : { state: "unresolved-ticker" };
  const mix = sectorMix(
    [txn({ ticker: "AAA" }), txn({ ticker: "BBB" }), txn({ ticker: "CCC" }), txn({ ticker: null })],
    resolve,
  );
  const keys = mix.map((r) => `${r.key}${r.bucket ? "!" : ""}`);
  assert.ok(keys.includes("manufacturing"));
  assert.ok(keys.includes("issuer has no SIC on record!"));
  assert.ok(keys.includes("ticker not resolved to an issuer!"));
  assert.ok(keys.includes("no ticker disclosed!"));
  // real sectors sort before buckets
  assert.equal(mix[0]!.key, "manufacturing");
});

test("membershipAsOf (TS twin): unknown is null, known-none is [] — never collapsed", () => {
  assert.deepEqual(membershipAsOf(snapshot, "2026-01-15")?.map((m) => m.committeeId), ["HSAG"]);
  assert.equal(membershipAsOf(snapshot, "2020-01-01"), null); // before the window: unknown
  assert.equal(membershipAsOf(snapshot, "2027-01-01"), null); // after: unknown
  assert.equal(membershipAsOf(null, "2026-01-15"), null); // no snapshot: unknown
  assert.equal(membershipAsOf(snapshot, null), null); // undated trade: unanswerable
  // Review F7: a member with NO rows inside a valid snapshot is KNOWN-NONE
  // ([]) — the snapshot window belongs to the snapshot, not the member.
  const emptyMember: MembershipSnapshot = { memberships: [], windowFrom: "2025-01-03", windowTo: "2026-08-12" };
  assert.deepEqual(membershipAsOf(emptyMember, "2026-01-15"), []);
  assert.equal(membershipAsOf(emptyMember, "2020-01-01"), null);
});

test("jurisdictionOverlap: joins as of the trade date; undatable trades counted, not cleared", () => {
  const jur = new Map([["HSAG", ["agriculture"]]]);
  const resolve = (): SectorResolution => ({ state: "sector", sector: "agriculture" });
  const inWindow = txn({ ticker: "AGRO", traded: "2026-01-15" });
  const preWindow = txn({ ticker: "AGRO", traded: "2020-01-15" });
  const anomaly = txn({ ticker: "AGRO", traded: "3031-04-30", flags: ["date_anomaly"] });
  const { rows, undatable } = jurisdictionOverlap([inWindow, preWindow, anomaly], snapshot, jur, resolve);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.committees[0]!.committeeId, "HSAG");
  assert.equal(undatable, 1); // the pre-window trade — the anomaly was excluded before dating
});

test("jurisdictionOverlap (review F8): an unmapped committee is coverage-unknown, never a non-overlap", () => {
  // The member sits on a committee the deliberately-partial mapping omits.
  const snap: MembershipSnapshot = {
    memberships: [
      { committeeId: "ZZZZ", name: "Unmapped Committee", role: null, validFrom: "2025-01-03", validTo: "2026-08-12" },
    ],
    windowFrom: "2025-01-03",
    windowTo: "2026-08-12",
  };
  const jur = new Map([["HSAG", ["agriculture"]]]); // ZZZZ absent from the mapping
  const resolve = (): SectorResolution => ({ state: "sector", sector: "agriculture" });
  const res = jurisdictionOverlap([txn({ ticker: "AGRO", traded: "2026-01-15" })], snap, jur, resolve);
  assert.equal(res.rows.length, 0);
  assert.equal(res.coverageUnknown, 1, "unanswerable, not cleared");
  assert.deepEqual(res.unmappedCommittees, ["ZZZZ"]);
});

function member(txns: TxnRow[]): MemberEntity {
  return {
    bioguide: "T000001",
    name: "Test Member",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    servingSince: "2015",
    filingCount: 1,
    txns,
    paper: [],
  };
}

test("memberV2Sections: absent B-5/B-6 context renders stated absence, never an empty mix", () => {
  const html = memberV2Sections(member([txn()]), stamps, ctx, {
    resolveSector: null,
    sectorMeta: null,
    committees: null,
  });
  assert.match(html, /Sector data is not in this build/);
  assert.match(html, /Committee membership data is not in this build/);
  assert.match(html, /Net disclosed flow by ticker/);
});

test("memberV2Sections: the non-allegation caveat is present whenever committees render", () => {
  const deps: MemberV2Deps = {
    resolveSector: () => ({ state: "sector", sector: "agriculture" }),
    sectorMeta: { taxonomyVersion: "1", asOf: "2026-08-12" },
    committees: {
      memberships,
      windowFrom: "2025-01-03",
      windowTo: "2026-08-12",
      jurisdictionByCommittee: new Map([["HSAG", ["agriculture"]]]),
      mappingVersion: "1",
      snapshotDate: "2026-08-12",
    },
  };
  const html = memberV2Sections(member([txn({ ticker: "AGRO", traded: "2026-01-15" })]), stamps, ctx, deps);
  assert.ok(html.includes(NON_ALLEGATION_CAVEAT.slice(0, 60)), "the caveat must render verbatim");
  assert.match(html, /jurisdiction mapping v1/);
  assert.match(html, /House Agriculture/);
  // And it renders even when there is NO overlap — the caveat is structural.
  const none = memberV2Sections(member([txn({ ticker: "AGRO", traded: "2020-01-01" })]), stamps, ctx, deps);
  assert.ok(none.includes(NON_ALLEGATION_CAVEAT.slice(0, 60)));
  assert.match(none, /unanswerable, not cleared/);
});

test("CODE-REVIEW F1: the net-flow table's ·§ markers still carry their clause", async () => {
  const { RANKING_FOOTNOTES } = await import("../src/lib/ui.ts");
  const clause = (RANKING_FOOTNOTES as { mark: string; html: string }[]).find((f) => f.mark === "§")!.html;

  // SL-R7 deleted `footnoteBlock(RANKING_FOOTNOTES, …)`. This table hand-rolls
  // its own <thead>, so the header conversion missed it and left three `·§`
  // markers pointing at an explanation that existed nowhere on the page. A
  // marker without its clause is the §7 failure this run exists to prevent.
  const deps: MemberV2Deps = {
    resolveSector: () => ({ state: "sector", sector: "agriculture" }),
    sectorMeta: { taxonomyVersion: "1", asOf: "2026-08-12" },
    committees: {
      memberships,
      windowFrom: "2025-01-03",
      windowTo: "2026-08-12",
      jurisdictionByCommittee: new Map([["HSAG", ["agriculture"]]]),
      mappingVersion: "1",
      snapshotDate: "2026-08-12",
    },
  };
  const html = memberV2Sections(member([txn({ ticker: "AGRO" })]), stamps, ctx, deps);
  assert.ok(html.includes("Gross purchases"), "fixture renders the net-flow table");
  assert.ok(html.includes(clause), "the § clause is reachable from the columns that carry the mark");
  assert.match(html, /class="note-pop"/, "and it lives in the note channel");
  assert.ok(!html.includes('href="#member-footnotes"'), "no link into the deleted footnote block survives");
});
