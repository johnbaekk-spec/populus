/* RUN SURFACES-LEGIBILITY — T10, the member page (SL-R19, SL-R20).

   `sl-` prefix per Constraint 9: this run's R-numbers collide with earlier
   runs', so nothing here may be named `r<n>-`.

   Every assertion here reads RENDERED OUTPUT. The two defects this run's
   review found were both invisible to a source grep — a key that is null on the
   branch where its note renders, and a renderer that was never called — so the
   fixtures below build real entities and read the html the page would ship. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  memberBody,
  memberStatTiles,
  memberV2Sections,
  entityTxnTable,
  flowRibbon,
  memberSignalsPanel,
  NON_ALLEGATION_CAVEAT,
  type BuildStamps,
  type MemberV2Deps,
} from "../src/lib/ui/index.ts";
import { statTiles, noteId, esc, type RenderCtx, type TxnRow } from "../src/lib/format.ts";
import { quarterlyFlow, type MemberEntity } from "../src/lib/derive.ts";
import type { Signal, SignalArtifact } from "../src/lib/signals.ts";

const STAMPS: BuildStamps = {
  buildId: "t.1",
  generatedAt: "2026-08-12 00:00 UTC",
  generatedAtDate: "2026-08-12",
};
const CTX: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t-1", asset: null, assetType: null,
    filed: "2026-07-21", traded: "2026-06-24", name: "Test Member",
    bioguide: "T000001", party: "R", state: "OK", district: null,
    chamber: "senate", ticker: "WMB", side: "purchase", owner: "spouse",
    low: 1001, high: 15000, lag: 27, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

const TXNS: TxnRow[] = [
  txn({ txnId: "a", ticker: "AAA", low: 15001, high: 50000 }),
  txn({ txnId: "b", ticker: "AAA", side: "sale" }),
  txn({ txnId: "c", ticker: "BBB", traded: "2026-02-02", filed: "2026-03-01" }),
  txn({ txnId: "d", ticker: null }),
  txn({ txnId: "e", ticker: "CCC", low: null, high: null }),
];

const MEMBER: MemberEntity = {
  bioguide: "T000001", name: "Test Member", party: "R", state: "OK",
  district: null, chamber: "senate", servingSince: "2015",
  filingCount: 3, txns: TXNS, paper: [],
};

const V2_DEPS: MemberV2Deps = { resolveSector: null, sectorMeta: null, committees: null };
/** The same page WITH both optional datasets, so the committee panel renders
    its real body — which is where `NON_ALLEGATION_CAVEAT` lives. The absent
    branch cannot exercise it, and asserting the caveat against a fixture that
    never renders it would have been a test that could not fail. */
const V2_DEPS_FULL: MemberV2Deps = {
  resolveSector: () => ({ state: "sector", sector: "agriculture" }),
  sectorMeta: { taxonomyVersion: "1", asOf: "2026-08-12" },
  committees: {
    memberships: [
      { committeeId: "HSAG", name: "House Agriculture", role: "Chair", validFrom: "2025-01-03", validTo: "2026-08-12" },
    ],
    windowFrom: "2025-01-03",
    windowTo: "2026-08-12",
    jurisdictionByCommittee: new Map([["HSAG", ["agriculture"]]]),
    mappingVersion: "1",
    snapshotDate: "2026-08-12",
  },
};
const FLOW = quarterlyFlow(TXNS, STAMPS.generatedAtDate, 8);

/** The panel body for one note id, so a test can assert WHICH explanation
    landed where — not merely that some panel exists. */
function panelTextOf(html: string, id: string): string {
  const re = new RegExp(`<span class="note-pop" popover id="${id}"[^>]*>([\\s\\S]*?)</span>`);
  const m = re.exec(html);
  assert.ok(m, `no panel rendered for #${id}`);
  return m![1]!;
}

const PANEL_ID = /<span class="note-pop" popover id="([^"]+)"/g;

/* ---------------------------------------------------- SL-R20: signal rules */

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "sig-1",
    kind: "s1-large",
    rule: "S-1 fires when a single disclosed transaction's LOWER bound is at or above $500,000.",
    thresholdVersion: "t1",
    entities: { bioguide: "T000001", memberName: "Test Member", ticker: "WMB" },
    magnitude: { low: 500_001, high: 1_000_000 },
    receipts: ["https://efdsearch.senate.gov/x"],
    occurrence: { tradeDate: "2026-07-20", filedDate: "2026-08-01" },
    sourceAvailableAt: "2026-08-01",
    computedAt: "2026-08-12",
    firstSeenBuild: "b", lastSeenBuild: "b",
    status: "active", cohort: "senate",
    ...over,
  };
}

function artifact(signals: Signal[]): SignalArtifact {
  return {
    v: 1, buildId: "b", computedAt: "2026-08-12", thresholdVersion: "t1",
    retentionDays: 90, coverageFrom: "2026-05-14", coverageTo: "2026-08-12",
    lifecycleNote: "", compaction: "", dateAnomaliesExcluded: 0,
    signals, withheld: [],
    lagCaveat: "Signals are computed over FILED dates; a trade may precede its filing by up to 45 days.",
  };
}

test("SL-R20: the signal rule is a note on EACH ROW'S KIND CELL — mixed kinds, every exact rule reachable", () => {
  /* Fixture one of two. `signals.ts` composes ONE rule per kind, so a note on
     the shared Kind header could carry only one of them at a time. */
  const kinds = [
    ["s1-large", "S-1 fires on a lower bound at or above $500,000."],
    ["s2-first", "S-2 fires the first time a member discloses a ticker inside the retained window."],
    ["s6-late-large", "S-6 fires when a disclosure is both late and large."],
  ] as const;
  const html = memberSignalsPanel(
    artifact(kinds.map(([kind, rule], i) => signal({ id: `sig-${i}`, kind, rule }))),
    "T000001",
    CTX,
  );

  assert.doesNotMatch(html, /signal-rule-inline/, "the inline rule block is retired from the page surface");
  for (const [, rule] of kinds) {
    assert.ok(html.includes(esc(rule)), `the exact rule "${rule.slice(0, 24)}…" is still published`);
  }
  const ids = [...html.matchAll(PANEL_ID)].map((m) => m[1]!);
  assert.equal(ids.length, 3, "one note per row");
  assert.equal(new Set(ids).size, 3, "three rows, three distinct panels");
  // each panel is the one its own row addresses
  for (let i = 0; i < 3; i++) {
    assert.equal(panelTextOf(html, noteId("member-signals", `sig-${i}`)), esc(kinds[i]![1]));
  }
});

test("SL-R20/SL-R26: a SAME-MEMBER DUPLICATE-KIND fixture emits unique panel ids — the kind-keyed failure", () => {
  /* Fixture two, and the one LD10 actually rests on. A mixed-kind test can
     never see this case: one member holding three signals of the SAME kind,
     differing only in their occurrence. Keyed on the kind they collapse to one
     id three times over and `aria-describedby` addresses the wrong rule on two
     of the three rows; keyed on `Signal.id` they do not. */
  const html = memberSignalsPanel(
    artifact([
      signal({ id: "s1-aaa", occurrence: { tradeDate: "2026-07-01", filedDate: "2026-07-10" } }),
      signal({ id: "s1-bbb", occurrence: { tradeDate: "2026-07-02", filedDate: "2026-07-11" } }),
      signal({ id: "s1-ccc", occurrence: { tradeDate: "2026-07-03", filedDate: "2026-07-12" } }),
    ]),
    "T000001",
    CTX,
  );
  const ids = [...html.matchAll(PANEL_ID)].map((m) => m[1]!);
  assert.equal(ids.length, 3, "three same-kind rows each render their rule");
  assert.equal(new Set(ids).size, 3, "…and no two share a panel id");
  for (const id of ids) {
    assert.ok(
      html.includes(`popovertarget="${id}"`) && html.includes(`aria-describedby="${id}"`),
      `#${id} is addressed by exactly the button beside it`,
    );
  }
});

/* -------------------------------------------------- SL-R19: the identity lede */

test("SL-R19: the member `.entity-lede` is gone and BOTH its claims are anchored on what they qualify", () => {
  const html = memberBody(MEMBER, STAMPS, CTX, 0);
  assert.doesNotMatch(html, /class="entity-lede"/, "the identity paragraph is off the page surface");

  // Claim one — statutory ranges — on the stamp line it qualifies.
  const stamp = noteId("member-stamp", "statutory-ranges");
  assert.match(
    panelTextOf(html, stamp),
    /Amounts are statutory ranges; totals on this page are therefore ranges too\./,
  );
  assert.match(panelTextOf(html, stamp), /methodology\/#amount-ranges/, "and its methodology anchor");

  // Claim two — owner codes — on the column that renders the SP/DC/JT badge,
  // not on a stamp line three panels above it.
  const owner = panelTextOf(html, noteId("member-txns", "side-owner"));
  assert.match(owner, /spouse \(SP\), dependent children \(DC\), and joint accounts \(JT\)/);
  assert.match(owner, /the STOCK Act does not distinguish who directed a trade/);
  assert.match(owner, /methodology\/#owner-codes/, "T1 moved the sentence there; the note links it");
});

test("SL-R19: the member tiles carry their breakdown as a note keyed on the tile LABEL, and only once", () => {
  const html = memberBody(MEMBER, STAMPS, CTX, 0);
  const withTitles = memberStatTiles(MEMBER, STAMPS).filter((t) => t.title);
  assert.ok(withTitles.length > 0, "the fixture exercises tiles that HAVE a breakdown");
  for (const t of withTitles) {
    const id = noteId("member-tiles", t.label);
    assert.equal(panelTextOf(html, id), esc(t.title!), `"${t.label}" carries its breakdown verbatim`);
    // …and NOT also in a `.visually-hidden` sibling, which would read it to a
    // screen reader twice now that the panel is real DOM.
    assert.ok(
      !html.includes(`<span class="visually-hidden">${esc(t.title!)}</span>`),
      `"${t.label}" publishes its breakdown once, not twice`,
    );
  }
});

/* --------------------------------------------- SL-R20: chart and card feet */

test("SL-R20: the chart caption and the net-flow card foot become notes, clause for clause", () => {
  const head = memberBody(MEMBER, STAMPS, CTX, 0);
  const caption = panelTextOf(head, noteId("member-chart", "chart-method"));
  for (const clause of ["gaps are gaps", "no midpoints", "House Clerk + Senate eFD"]) {
    assert.ok(caption.includes(esc(clause)), `the caption clause "${clause}" survives`);
  }
  // the marker stays VISIBLE as the note's cue (LD3) — the text moved channel,
  // the reader's signal that there IS text did not.
  assert.match(head, /class="rb-caption rb-caption-note"/);
  assert.match(head, /how this chart is drawn/);

  const v2 = memberV2Sections(MEMBER, STAMPS, CTX, V2_DEPS);
  const foot = panelTextOf(v2, noteId("member-netflow", "scope"));
  assert.match(foot, /PTRs are flows, not holdings/, "the card-foot text moved channel, not meaning");
  assert.match(foot, /rows disclose no ticker and are outside this table/, "with its exclusion count attached");
  assert.match(v2, /flows, not holdings&nbsp;·§/, "and its visible marker");
});

test("SL-R20: the two ABSENT panels and NON_ALLEGATION_CAVEAT stay VISIBLE, verbatim", () => {
  /* R20 names these three as text that does NOT move. An absent panel is a
     stated absence — the thing this repository refuses to simulate — and the
     non-allegation caveat is a legal statement, not a definition. Neither is a
     hover candidate at any width. */
  const absent = memberV2Sections(MEMBER, STAMPS, CTX, V2_DEPS);
  assert.match(absent, /aria-label="Sector mix"/, "the absent Sector mix panel is on the page");
  assert.match(absent, /Sector data is not in this build/, "…stating its absence in visible text");
  assert.match(absent, /Committee/, "as is the Committees panel");

  const full = memberV2Sections(MEMBER, STAMPS, CTX, V2_DEPS_FULL);
  assert.ok(
    full.includes(`<div class="caveat-line non-allegation">${esc(NON_ALLEGATION_CAVEAT)}</div>`),
    "and the non-allegation caveat is byte-identical, in a VISIBLE line — never a note",
  );
  assert.doesNotMatch(
    full.slice(full.indexOf("non-allegation")),
    /^[\s\S]{0,200}class="note"/,
    "…with no note anchored on it",
  );
});

/* --------------------------------------------------------------- SL-R2b */

test("SL-R2b: entityTxnTable, statTiles and flowRibbon are BYTE-UNCHANGED without a scope", () => {
  /* The routes this run does not own render through all three. The contract is
     not "they still work" — it is that they emit the same bytes, which is the
     only form of the claim a leak cannot slip past. */
  const table = entityTxnTable(TXNS, { kind: "ticker", caption: "c", page: 0, ctx: CTX });
  assert.doesNotMatch(table, /class="note"/, "no note markup reaches a ticker page's txn table");
  assert.ok(table.includes(`<th scope="col">Side · Owner</th>`), "…and its header is the literal it was");

  const tiles = statTiles([{ value: "1", label: "L", title: "the full breakdown" }]);
  assert.doesNotMatch(tiles, /class="note"/, "no note markup on a no-scope tile group");
  assert.ok(
    tiles.includes(`<span class="visually-hidden">the full breakdown</span>`),
    "the sibling `format.test.ts` guards — a tooltip is never the only channel — is intact",
  );

  const ribbon = flowRibbon(FLOW, { twoSided: true, sourceLine: "src" });
  assert.match(ribbon, /<div class="rb-caption">/, "the visible caption stands on the deep ticker page");
  assert.doesNotMatch(ribbon, /class="note"/);
});
