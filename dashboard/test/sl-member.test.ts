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
import { MiniElement } from "./lib/mini-dom.ts";

const STAMPS: BuildStamps = {
  buildId: "t.1",
  generatedAt: "2026-08-12 00:00 UTC",
  generatedAtDate: "2026-08-12",
};
const CTX: RenderCtx = {};

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
  // R21: the card's footer ⓘ (cardFoot) is not a row note.
  const ids = [...html.matchAll(PANEL_ID)].map((m) => m[1]!).filter((id) => !id.includes("signals-foot"));
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
  const ids = [...html.matchAll(PANEL_ID)].map((m) => m[1]!).filter((id) => !id.includes("signals-foot"));
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
  // launch M4b (R25): the owner codes anchor on "Asset · owner", the column that prints them
  const owner = panelTextOf(html, noteId("member-txns", "asset"));
  assert.match(owner, /spouse \(SP\), dependent children \(DC\), and joint accounts \(JT\)/);
  assert.match(owner, /the STOCK Act does not distinguish who directed a trade/);
  assert.match(owner, /methodology\/#owner-codes/, "T1 moved the sentence there; the note links it");
});

/* DESIGN-POLISH M2 (T2.1 / T2.10; plan milestone map `sl-member.test.ts:265`).
   The member table's owner qualifiers left the combined "Side · Owner" header
   for their own Owner column, which renders BY PRESENCE (R12). The property:
   whenever ANY row of the table's collection carries a qualifier — an owner
   code (SP, DC, JT) or the partial-sale qualifier, both printed in that cell by
   `ownerNote` (H-18) — the Owner header renders and names what the codes mean
   through its label trigger; when no row carries one, the column is removed
   and the table foot says so. The header never disappears while a row still
   needs it. */
/* launch M4b (R25) — replaces the DESIGN-POLISH M2 Owner-column pin. The
   owner and partial qualifiers moved onto the asset line ("Asset · owner"),
   which every row has, so no presence rule can remove the column that names
   the codes. The property kept, sharper: whatever the collection holds, the
   "Asset · owner" header names what SP, DC and JT mean, and every qualifier
   prints on its own row — on page 1 or on a later page alike. */
function assetOwner(txns: TxnRow[], page = 0): { head: MiniElement | undefined; note: string | null; quals: string[] } {
  const root = new MiniElement("body");
  root.innerHTML = entityTxnTable(txns, { kind: "member", caption: "c", page, ctx: CTX, notes: { scope: "member-txns" } });
  const head = root.querySelectorAll("thead th").find((th) => th.getAttribute("data-col") === "asset");
  const pop = head?.querySelector(".note-pop");
  const quals = root.querySelectorAll("tbody td.c-asset .owner-note").map((el) => el.textContent.replace(/\s*\(.*\)$/, "").trim());
  return { head, note: pop ? pop.textContent : null, quals };
}

test("SL-R19 → launch M4b: the Asset · owner header always names the owner codes; each qualifier prints on its own row", () => {
  const plain = { owner: "self" as const, side: "purchase" as const };
  for (const [label, rows, want] of [
    ["an owner code on one row", [txn({ ...plain, txnId: "p1" }), txn({ txnId: "sp", owner: "joint" })], ["JT"]],
    ["only the partial-sale qualifier", [txn({ ...plain, txnId: "p1" }), txn({ ...plain, txnId: "pp", side: "sale_partial" })], ["partial"]],
    ["no qualifier anywhere", [txn({ ...plain, txnId: "p1" }), txn({ ...plain, txnId: "p2" })], []],
  ] as const) {
    const h = assetOwner([...rows]);
    assert.ok(h.head, `${label}: the Asset · owner header renders`);
    assert.equal(h.head!.querySelector(".note-btn.note-label")?.textContent, "Asset · owner", `${label}: the header is its note's label trigger`);
    assert.match(h.note!, /spouse \(SP\), dependent children \(DC\), and joint accounts \(JT\)/, `${label}: the note names the codes`);
    assert.deepEqual(h.quals, [...want], `${label}: the qualifiers print on their rows, and only there`);
  }
  // a qualifier on the OLDEST row of a 60-row collection (page 3 at 25 a page) prints there; the header names it on every page
  const many = Array.from({ length: 60 }, (_, i) => txn({ ...plain, txnId: `r${i}`, filed: `2026-0${i < 30 ? 7 : 6}-${String((i % 28) + 1).padStart(2, "0")}` }));
  many[59] = { ...many[59]!, filed: "2026-01-01", owner: "child" };
  assert.ok(assetOwner(many, 0).head && assetOwner(many, 0).note, "page 1 names the codes");
  assert.deepEqual(assetOwner(many, 2).quals, ["DC"], "page 3 prints the dependent-child code on its row");
  // control: the retired Owner column is not back — nothing can empty it away
  assert.equal(new MiniElement("body").querySelector("th[data-col=\"owner\"]"), null);
});

/* launch M4b (member-09): the Profile's summary line keeps only the figure
   no other part of the page states — gross flow over 12 months — and the
   Profile renders at ten or more trades (LD24). The property is unchanged
   for the tile that remains: its breakdown is a note keyed on its LABEL, and
   it is published once, never also in a visually-hidden sibling. */
test("SL-R19: the member's remaining tile carries its breakdown as a note keyed on the tile LABEL, and only once", () => {
  const ten: MemberEntity = { ...MEMBER, txns: Array.from({ length: 10 }, (_, i) => txn({ txnId: `x${i}`, ticker: i % 2 ? "AAA" : "BBB" })) };
  const html = memberBody(ten, STAMPS, CTX, 0);
  const gross = memberStatTiles(ten, STAMPS).find((t) => t.label === "disclosed flow · trailing 12m")!;
  assert.ok(gross.title, "the fixture exercises a tile that HAS a breakdown");
  assert.equal(panelTextOf(html, noteId("member-tiles", gross.label)), esc(gross.title!), "the gross-flow tile carries its breakdown verbatim");
  assert.ok(!html.includes(`<span class="visually-hidden">${esc(gross.title!)}</span>`), "…published once, not twice");
  // control: a member under ten trades has no Profile, so the tile is not on its page
  assert.ok(!memberBody(MEMBER, STAMPS, CTX, 0).includes(noteId("member-tiles", gross.label)));
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
  assert.match(absent, /<strong>Sector rotation<\/strong> — not available in this build\./, "the absent Sector mix surface is stated on the page (R24: one line, no empty frame)");
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
  /* DOM parse (DESIGN-POLISH M1, T1.9): the header now carries its role class
     (`c-kind`), so it is read from the parsed table — its text is still the
     bare label, with no trigger inside it. */
  const root = new MiniElement("body");
  root.innerHTML = table;
  const sideOwner = root.querySelectorAll("thead th").find((th) => th.textContent.trim() === "Side · Owner");
  assert.ok(sideOwner, "…and its header is the label it was");
  assert.equal(sideOwner!.children.length, 0, "a plain label: no note, no button");
  assert.equal(sideOwner!.getAttribute("class"), "c-kind");

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
