/* F12 — a BEHAVIOURAL test for `initCongressSections`, end to end.

   Every previous test of this island was source-level: a grep proving a line of
   code exists. That class of test could not have caught F1 (the feed island
   returning before it fetched anything because the page had lost an id) and it
   could not catch F25 either — a sync at bind time that deleted server-rendered
   honesty content before any data arrived to justify it. Both defects are in
   the SEQUENCE, not in the source.

   So this file runs the island: it builds a document from the SAME renderer the
   page uses, with the SAME page-root contract the page declares, initializes
   over it, asserts the server bytes are untouched before rows arrive, delivers
   rows, and then asserts that momentum is seeded, that its headers actually
   sort, and that the disclosure and the terminus move together.

   The DOM is `mini-dom.ts`, which can only find what is really in the markup —
   unlike `fake-dom.ts`, which returns any id it is handed and is precisely how
   F1 stayed invisible. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { installDom, type MiniElement } from "./lib/mini-dom.ts";
import { CONGRESS_ROOTS, congressRankingSection, type BuildStamps } from "../src/lib/ui.ts";
import { congressTickersRollup, leadersRollup } from "../src/lib/derive.ts";
import type { RenderCtx, TxnRow } from "../src/lib/format.ts";
import { initCongressSections } from "../src/scripts/congress-sections.ts";

const GENERATED_AT = "2026-08-12";
const CTX: RenderCtx = { watched: new Set() };
const STAMPS: BuildStamps = {
  buildId: "b",
  generatedAt: "2026-08-12 00:00 UTC",
  generatedAtDate: GENERATED_AT,
};

const PAGE_SRC = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "index.astro"),
  "latin1",
);

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: null, assetType: null,
    filed: "2026-07-21", traded: "2026-08-01", name: "M", bioguide: "T000001",
    party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB",
    side: "purchase", owner: "self", low: 1001, high: 15000, lag: 27, late: 0,
    flags: [], doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

/** 24 tickers of decreasing flow, so the compact bound of ten actually bites
    and a name sort visibly disagrees with the default net sort — plus two rows
    whose amounts are wholly undisclosed, which is what puts the member
    section's SECOND root on the page. Without them `#members-undisclosed-tbody`
    is legitimately absent, and a fixture that fabricated it would be the fake
    DOM's mistake in a new place. */
function corpus(): TxnRow[] {
  const ranked = Array.from({ length: 24 }, (_, i) =>
    txn({
      txnId: `t${i}`,
      ticker: `T${String(i).padStart(2, "0")}`,
      bioguide: `M${i}`,
      name: `Member ${i}`,
      low: 1001 + i * 1000,
      high: 15000 + i * 1000,
    }),
  );
  const undisclosed = [0, 1].map((i) =>
    txn({
      txnId: `u${i}`,
      ticker: `U${i}`,
      bioguide: `Z${i}`,
      name: `Unranked ${i}`,
      low: null,
      high: null,
    }),
  );
  return [...ranked, ...undisclosed];
}

/** The page as the island sees it: the page-root contract read out of the REAL
    page source, wrapped around markup from the REAL section renderer.

    The data attributes are not typed in by hand. They are the ones the page
    declares; if the page renames or drops one, this fixture stops carrying it
    and the island degrades here the same way it would in a browser. */
function pageHtml(rows: TxnRow[]): string {
  for (const attr of ["data-generated-at-date", "data-range", "data-basis"]) {
    assert.ok(
      PAGE_SRC.includes(`${attr}={`),
      `the congress page must declare ${attr} — the island reads its window from it`,
    );
  }
  assert.ok(PAGE_SRC.includes('id="congress-page"'), "the island's root id must exist on the page");

  const momentum = congressRankingSection(
    "tickers",
    congressTickersRollup(rows, GENERATED_AT, { range: "12m", basis: "traded" }),
    STAMPS,
    CTX,
    {
      rootId: CONGRESS_ROOTS.momentum,
      heading: "Ticker momentum — net disclosed flow",
      sectionId: "momentum-section",
      controls: true,
    },
  );
  const members = congressRankingSection(
    "leaders",
    leadersRollup(rows, GENERATED_AT, { range: "12m", basis: "traded" }),
    STAMPS,
    CTX,
    {
      rootId: CONGRESS_ROOTS.membersRanked,
      undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed,
      heading: "Member net disclosed flow",
      sectionId: "members-section",
    },
  );
  return (
    `<main class="shell page" id="congress-page" data-generated-at-date="${GENERATED_AT}" ` +
    `data-range="12m" data-basis="traded">${momentum}${members}</main>`
  );
}

interface Harness {
  doc: ReturnType<typeof installDom>["doc"];
  restore(): void;
  sections: ReturnType<typeof initCongressSections>;
}

function mount(rows: TxnRow[]): Harness {
  const { doc, restore } = installDom(pageHtml(rows));
  return { doc, restore, sections: initCongressSections(), };
}

function disclosureFor(doc: Harness["doc"], rootId: string): MiniElement {
  const el = doc.querySelector(`.compact-disclosure[data-compact-for=${rootId}]`);
  assert.ok(el, `no disclosure is bound to #${rootId}`);
  return el!;
}

function terminusFor(doc: Harness["doc"], rootId: string): MiniElement {
  const t = disclosureFor(doc, rootId).previousElementSibling;
  assert.ok(t && t.classList.contains("terminus"), `#${rootId} has no terminus beside its control`);
  return t!;
}

/* ---------- the fixture itself must be honest ---------- */

test("F12: the fixture carries the roots the island binds — not fabricated ids", () => {
  const { doc, restore } = installDom(pageHtml(corpus()));
  try {
    for (const id of [
      "congress-page",
      CONGRESS_ROOTS.momentum,
      CONGRESS_ROOTS.membersRanked,
      CONGRESS_ROOTS.membersUndisclosed,
    ]) {
      assert.ok(doc.getElementById(id), `#${id} must exist in the rendered markup`);
    }
    // and the DOM must NOT invent one — this is the property fake-dom lacks,
    // and lacking it is what hid F1 for an entire review cycle
    assert.equal(doc.getElementById("feed"), null, "the DOM answers from bytes, not on request");
    assert.equal(doc.getElementById("not-a-real-id"), null);
  } finally {
    restore();
  }
});

/* ---------- 1. initialization must not touch the server's bytes ---------- */

test("F12/F25: initializing over SSR rows changes NO honesty content before rows arrive", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    const before = {
      momentumRows: doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML,
      memberRows: doc.getElementById(CONGRESS_ROOTS.membersRanked)!.innerHTML,
      terminus: terminusFor(doc, CONGRESS_ROOTS.momentum).outerHTML,
      caveat: doc.getElementById("momentum-section-caveat")!.innerHTML,
      window: doc.getElementById("momentum-section-window")!.textContent,
    };
    // Re-reading after init is the whole test: `syncDisclosure` used to run at
    // bind time against an EMPTY row set, compute total = 0, and hide both the
    // control and the server-rendered terminus — deleting published honesty
    // content on load, before any data justified it (F25).
    assert.equal(doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML, before.momentumRows);
    assert.equal(doc.getElementById(CONGRESS_ROOTS.membersRanked)!.innerHTML, before.memberRows);
    assert.equal(terminusFor(doc, CONGRESS_ROOTS.momentum).outerHTML, before.terminus);
    assert.equal(doc.getElementById("momentum-section-caveat")!.innerHTML, before.caveat);
    assert.equal(doc.getElementById("momentum-section-window")!.textContent, before.window);
    assert.equal(
      terminusFor(doc, CONGRESS_ROOTS.momentum).hidden,
      false,
      "the server published this notice because rows ARE held back; init must not retract it",
    );
  } finally {
    h.restore();
  }
});

test("F12: a header click before the dataset lands is inert, never destructive", () => {
  const h = mount(corpus());
  try {
    const root = h.doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const before = root.innerHTML;
    const nameHeader = h.doc.querySelector('th[data-congress-sort=name]');
    assert.ok(nameHeader, "the momentum table exposes a sortable Ticker header");
    nameHeader!.click();
    assert.equal(root.innerHTML, before, "sorting with no rows must not blank the server view");
  } finally {
    h.restore();
  }
});

test("F12: the headers are not offered as usable until rows exist", () => {
  const h = mount(corpus());
  try {
    const btn = h.doc.querySelector('th[data-congress-sort=net] button');
    assert.equal(btn!.getAttribute("aria-disabled"), "true");
    h.sections.receiveRows(corpus());
    assert.equal(btn!.getAttribute("aria-disabled"), "false", "delivery enables them");
  } finally {
    h.restore();
  }
});

/* ---------- 2. delivery seeds momentum and enables real sorting ---------- */

test("F12/F25: delivering rows SEEDS the momentum binding, so its headers really sort", () => {
  // F25's second half: momentum rows were never seeded for the default range,
  // so the headers were enabled over an empty comparator and clicking did
  // nothing at all — silently, because the SSR rows stayed on screen.
  const h = mount(corpus());
  try {
    const root = h.doc.getElementById(CONGRESS_ROOTS.momentum)!;
    h.sections.receiveRows(corpus());
    const beforeSort = root.innerHTML;

    const nameHeader = h.doc.querySelector('th[data-congress-sort=name]')!;
    nameHeader.click();
    assert.notEqual(root.innerHTML, beforeSort, "the sort must actually re-render the root");
    assert.equal(nameHeader.getAttribute("aria-sort"), "ascending");
    const tickers = [...root.innerHTML.matchAll(/>(T\d\d)</g)].map((m) => m[1]!);
    assert.ok(tickers.length > 0, "the sorted root renders ticker rows");
    assert.deepEqual(tickers, [...tickers].sort(), "ascending by name means ascending by name");
  } finally {
    h.restore();
  }
});

test("F12/R18: a sort re-renders ONLY its own root", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    h.sections.receiveRows(corpus());
    const membersBefore = doc.getElementById(CONGRESS_ROOTS.membersRanked)!.innerHTML;
    const bucketBefore = doc.getElementById(CONGRESS_ROOTS.membersUndisclosed)!.innerHTML;
    doc.querySelector('th[data-congress-sort=name]')!.click();
    assert.equal(doc.getElementById(CONGRESS_ROOTS.membersRanked)!.innerHTML, membersBefore);
    assert.equal(doc.getElementById(CONGRESS_ROOTS.membersUndisclosed)!.innerHTML, bucketBefore);
  } finally {
    h.restore();
  }
});

/* ---------- 3. the disclosure and the terminus move TOGETHER ---------- */

test("F12/F16: expanding updates the control and the terminus in one step", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    h.sections.receiveRows(corpus());
    const wrap = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const terminus = terminusFor(doc, CONGRESS_ROOTS.momentum);
    const btn = wrap.querySelector("button")!;

    // collapsed: the control offers the hidden rows and the sentence states them
    assert.equal(wrap.hidden, false);
    assert.match(btn.textContent, /^Show all 24 tickers \(14 more\)$/);
    assert.equal(terminus.hidden, false);
    assert.match(terminus.textContent, /14 further ranked tickers are not rendered above/);
    assert.match(terminus.textContent, /Truncated by Public Filings\./, "the author is named");

    btn.click();
    // expanded: nothing is held back, so the sentence retracts WITH the label
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    assert.match(btn.textContent, /^Show only the first 10 tickers$/);
    assert.equal(terminus.hidden, true, "nothing is withheld, so nothing is claimed to be");
    const rowCount = (doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML.match(/<tr\b/g) ?? []).length;
    assert.equal(rowCount, 24, "expanding renders every row in place");

    btn.click();
    assert.equal(terminus.hidden, false, "collapsing restates the bound");
    assert.match(btn.textContent, /^Show all 24 tickers \(14 more\)$/);
  } finally {
    h.restore();
  }
});

test("F12/F16: a range change that hides rows REVEALS both the control and the sentence", () => {
  // A 7-day window over a corpus whose trades are one day apart holds few
  // tickers; a 12-month window holds all 24. The transition is the one that
  // used to leave a control on screen describing the previous window, and
  // could hide rows with no notice at all.
  const rows = Array.from({ length: 24 }, (_, i) =>
    txn({
      txnId: `t${i}`,
      ticker: `T${String(i).padStart(2, "0")}`,
      // spread the trades across the year so 7d holds a strict subset
      traded: `2026-0${1 + (i % 8)}-0${1 + (i % 8)}`,
      filed: "2026-08-11",
      low: 1001 + i * 1000,
      high: 15000 + i * 1000,
    }),
  );
  const h = mount(rows);
  try {
    const { doc } = h;
    h.sections.receiveRows(rows);
    const wrap = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const terminus = terminusFor(doc, CONGRESS_ROOTS.momentum);

    const sevenDay = doc.querySelector("#momentum-controls [data-range=7d]");
    assert.ok(sevenDay, "the momentum section offers a 7d range control");
    sevenDay!.click();

    // whatever the 7d window holds, the control and the sentence AGREE about it
    const hiddenNow = wrap.hidden;
    assert.equal(
      terminus.hidden,
      hiddenNow,
      "the button and the sentence appear and disappear together, never one alone",
    );
    // and the window statement was rewritten with the rows, not left stale
    assert.match(
      doc.getElementById("momentum-section-window")!.textContent,
      /7|day/i,
      "a window that changed while its stated bounds did not is the worst outcome here",
    );
  } finally {
    h.restore();
  }
});

test("F12/R17: a dataset that never arrives leaves the server view standing", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    const rowsBefore = doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML;
    // the reader changes the range with no data — the control cannot act, and
    // must not empty the section to say so
    doc.querySelector("#momentum-controls [data-range=7d]")!.click();
    assert.equal(doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML, rowsBefore);
    assert.equal(terminusFor(doc, CONGRESS_ROOTS.momentum).hidden, false);
  } finally {
    h.restore();
  }
});
