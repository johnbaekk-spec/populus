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
   sort, and that the button and the bound it states move together.

   The DOM is `mini-dom.ts`, which can only find what is really in the markup —
   unlike `fake-dom.ts`, which returns any id it is handed and is precisely how
   F1 stayed invisible. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { installDom, type MiniElement } from "./lib/mini-dom.ts";
import { CONGRESS_ROOTS, congressRankingSection, type BuildStamps } from "../src/lib/ui/index.ts";
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

/* RETARGETED — SL-R10 (LD6). The bound used to be a `terminusRow` element
   BESIDE the control, reached through `previousElementSibling`. It is now the
   control's own first child, because a statement the reader needs without
   JavaScript cannot live on a button a script has to reveal. The tests below
   assert the same behaviour against the moved element: the count clause is the
   thing that appears, retracts and reappears with the row set. */
function boundFor(doc: Harness["doc"], rootId: string): MiniElement {
  const t = disclosureFor(doc, rootId).querySelector(".compact-bound-count");
  assert.ok(t, `#${rootId} states no bound inside its control`);
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
      bound: boundFor(doc, CONGRESS_ROOTS.momentum).outerHTML,
      // RETARGETED — RUN SURFACES-LEGIBILITY, SL-R11 (LD6): the exclusion
      // clauses are no longer a separate `.caveat-line` element; they are the
      // body of the note on the window statement, and their summed row total is
      // the note's visible anchor. Same honesty content, one element up.
      windowNote: doc.getElementById("momentum-section-window")!.innerHTML,
      window: doc.getElementById("momentum-section-window")!.textContent,
    };
    // Re-reading after init is the whole test: `syncDisclosure` used to run at
    // bind time against an EMPTY row set, compute total = 0, and hide both the
    // control and the server-rendered statement of the bound — deleting
    // published honesty content on load, before any data justified it (F25).
    assert.equal(doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML, before.momentumRows);
    assert.equal(doc.getElementById(CONGRESS_ROOTS.membersRanked)!.innerHTML, before.memberRows);
    assert.equal(boundFor(doc, CONGRESS_ROOTS.momentum).outerHTML, before.bound);
    assert.equal(doc.getElementById("momentum-section-window")!.innerHTML, before.windowNote);
    assert.equal(doc.getElementById("momentum-section-window")!.textContent, before.window);
    assert.equal(
      boundFor(doc, CONGRESS_ROOTS.momentum).hidden,
      false,
      "the server published this notice because rows ARE held back; init must not retract it",
    );
    /* SL-R10, state (c), REWRITTEN in DESIGN-POLISH M2 (R36, T2.11). The
       property is unchanged: the bound is stated by the SERVER, in real text,
       and init never retracts it (asserted above, byte for byte). The
       mechanism changed: the island now syncs at bind time from the server's
       own total (`data-compact-total`) — never from the empty row set that
       caused F25 — so after load the control is REVEALED and works before the
       dataset arrives (R36: every disclosure holding rows back has a working
       toggle after load). It reveals the prefetched rows, exactly one step,
       and says so. */
    const btn = disclosureFor(doc, CONGRESS_ROOTS.momentum).querySelector("button")!;
    const heldInDom = doc.getElementById(CONGRESS_ROOTS.momentum)!.querySelectorAll("tr[data-compact-hidden]").length;
    assert.equal(btn.hidden, false, "after load the control is offered (R36)");
    assert.equal(btn.getAttribute("aria-expanded"), "false");
    assert.ok(heldInDom > 0, "the server prefetched held rows for the first press");
    // The button uses the table's noun ("tickers"); the count clause beside it
    // the bound noun ("ranked tickers").
    assert.match(btn.textContent ?? "", /^Show (50 more|all [\d,]+ tickers)$/, "its label promises one step (R13)");
    // DESIGN-POLISH M1 (R8): the count is the range grammar, in the server's words.
    assert.match(
      boundFor(doc, CONGRESS_ROOTS.momentum).textContent,
      /^1–10 of \d+ ranked tickers$/,
      "…and the reader is told the count regardless",
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

test("R12: with a requestRows hook, a header press asks for the rows and the sort paints on delivery", () => {
  const { doc, restore } = installDom(pageHtml(corpus()));
  try {
    let asked = 0;
    const sections = initCongressSections({ requestRows: () => void asked++ });
    const root = doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const btn = doc.querySelector('th[data-congress-sort=name] button');
    assert.equal(btn!.getAttribute("aria-disabled"), "false", "a press can fetch its own rows, so it is offered");
    const before = root.innerHTML;
    doc.querySelector('th[data-congress-sort=name]')!.click();
    assert.equal(asked > 0, true, "the press requested the dataset");
    assert.equal(root.innerHTML, before, "…and did not blank the server view meanwhile");
    sections.receiveRows(corpus());
    assert.notEqual(root.innerHTML, before, "the pending sort painted once the rows arrived");
  } finally {
    restore();
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

/* ---------- 3. the button and the stated bound move TOGETHER ---------- */

test("F12/F16: expanding updates the control and the terminus in one step", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    h.sections.receiveRows(corpus());
    const wrap = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const bound = boundFor(doc, CONGRESS_ROOTS.momentum);
    const btn = wrap.querySelector("button")!;

    // collapsed: the control offers the hidden rows and the sentence states them
    assert.equal(wrap.hidden, false);
    assert.equal(btn.hidden, false, "rows arrived, so the button is revealed");
    /* SL-R10: the button carries the TOTAL and no longer repeats "(14 more)".
       The count of held-back rows is stated ONCE, by the sentence above it —
       which is the duplication R10 set out to remove, and the reason the
       terminus row could go. */
    assert.match(btn.textContent, /^Show all 24 tickers$/);
    assert.equal(bound.hidden, false);
    assert.equal(bound.textContent, "1–10 of 24 ranked tickers"); // R8: the range grammar

    btn.click();
    // expanded: nothing is held back, so the sentence retracts WITH the label
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    assert.match(btn.textContent, /^Show only the first 10 tickers$/);
    assert.equal(bound.hidden, true, "nothing is withheld, so nothing is claimed to be");
    /* …and the remainder does NOT retract with it: "every row remains in the
       published dataset" is true in both states, and it was the deleted
       terminus's other half. */
    const extra = wrap.querySelector(".compact-bound-extra")!;
    assert.equal(extra.hidden, false);
    assert.match(extra.textContent, /published dataset/);
    const rowCount = (doc.getElementById(CONGRESS_ROOTS.momentum)!.innerHTML.match(/<tr\b/g) ?? []).length;
    assert.equal(rowCount, 24, "expanding renders every row in place");

    btn.click();
    assert.equal(bound.hidden, false, "collapsing restates the bound");
    assert.match(btn.textContent, /^Show all 24 tickers$/);
  } finally {
    h.restore();
  }
});

test("SL-R10: the client restates each root's bound in the SERVER's words, not one shared phrasing", () => {
  /* One `syncDisclosure` serves three roots with three different bound nouns —
     "ranked tickers", "ranked members", and the wholly-undisclosed bucket's.
     Composing "ranked …" for all of them relabelled the bucket as ranked, which
     is the one thing that table exists to deny. The noun travels on the element
     (`data-compact-bound-noun`), so the client cannot invent a different one. */
  const rows = [
    ...Array.from({ length: 14 }, (_, i) =>
      txn({ txnId: `d${i}`, bioguide: `D${i}`, name: `Disclosed ${i}`, low: 1001 + i, high: 15000 + i }),
    ),
    ...Array.from({ length: 14 }, (_, i) =>
      txn({ txnId: `u${i}`, bioguide: `U${i}`, name: `Undisclosed ${i}`, low: null, high: null }),
    ),
  ];
  const h = mount(rows);
  try {
    const { doc } = h;
    h.sections.receiveRows(rows);
    // DESIGN-POLISH M1 (R8): each root's range count keeps its OWN bound noun.
    assert.equal(boundFor(doc, CONGRESS_ROOTS.membersRanked).textContent, "1–10 of 14 ranked members");
    assert.match(
      boundFor(doc, CONGRESS_ROOTS.membersUndisclosed).textContent,
      /^1–10 of 14 wholly-undisclosed members$/,
      "the unrankable bucket must never be restated as ranked",
    );
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
    const bound = boundFor(doc, CONGRESS_ROOTS.momentum);
    const btn = wrap.querySelector("button")!;

    const sevenDay = doc.querySelector("#momentum-controls [data-range=7d]");
    assert.ok(sevenDay, "the momentum section offers a 7d range control");
    sevenDay!.click();

    // whatever the 7d window holds, the control and the sentence AGREE about it
    assert.equal(
      bound.hidden,
      btn.hidden,
      "the button and the sentence appear and disappear together, never one alone",
    );
    /* SL-R10: the WRAPPER stays on screen either way, because the link to the
       published dataset it also carries is true at every row count. What the
       reader is offered is the button, and that is what the omission rule
       governs. */
    assert.equal(wrap.hidden, false, "the published-dataset link is not conditional on the window");
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
    assert.equal(boundFor(doc, CONGRESS_ROOTS.momentum).hidden, false);
  } finally {
    h.restore();
  }
});

/* ---------- DESIGN-POLISH M2 (R36, T2.11; R13): one press, one step ----------

   The property: the ranking's toggle reveals EXACTLY what its label promises
   — "Show 50 more" one step of rows, "Show all N" every held row — before the
   dataset arrives as after, and collapsing returns to the compact slice. The
   old control toggled a boolean "every row" while its label said "Show 50
   more", and before the dataset arrived it revealed only the prefetched rows
   and never painted the rest on delivery. */

/** The rows a press is expected to reveal, read from the label alone. */
function promisedByLabel(label: string, total: number, shown: number): number {
  if (/^Show 50 more$/.test(label)) return Math.min(50, total - shown);
  const all = /^Show all ([\d,]+) /.exec(label);
  return all ? Number(all[1]!.replace(/,/g, "")) - shown : NaN;
}

test("R36/R13: a press before the dataset arrives reveals exactly the rows its label promises; collapse returns to the slice", () => {
  const h = mount(corpus());
  try {
    const { doc } = h;
    const root = doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const visible = (): number => root.querySelectorAll("tr").filter((tr) => !tr.hidden && !tr.hasAttribute("class")).length;
    const control = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const btn = control.querySelector("button")!;
    const total = Number(control.getAttribute("data-compact-total"));
    const before = visible();
    assert.equal(before, 10, "the compact slice");
    const promised = promisedByLabel(btn.textContent ?? "", total, before);
    btn.click();
    assert.equal(visible() - before, promised, `"${btn.textContent}" revealed ${visible() - before}, promised ${promised}`);
    assert.equal(btn.getAttribute("aria-expanded"), visible() === total ? "true" : "false");
    // control: the promise predicate distinguishes a one-step label from an all-rows one
    assert.equal(promisedByLabel("Show 50 more", 130, 10), 50);
    assert.equal(promisedByLabel("Show all 130 tickers", 130, 10), 120);
    /* review Q2-9: unconditional — this fixture's held rows (under one step)
       are all prefetched, so one press shows every row and the next collapses */
    assert.ok(total - 10 <= 50, `the fixture holds at most one step back (${total})`);
    assert.equal(visible(), total, "one press reveals every prefetched row");
    btn.click();
    assert.equal(visible(), 10, "collapse returns to the compact slice");
    assert.equal(btn.getAttribute("aria-expanded"), "false");
  } finally {
    h.restore();
  }
});

test("R36/R13: after delivery, \"Show 50 more\" adds exactly one step and \"Show all\" the rest (control: the old all-rows toggle)", () => {
  const big = Array.from({ length: 130 }, (_, i) =>
    txn({ txnId: `b${i}`, ticker: `B${String(i).padStart(3, "0")}`, bioguide: `N${i}`, name: `Member B${i}`, low: 1001 + i * 1000, high: 15000 + i * 1000 }),
  );
  const h = mount(big);
  try {
    const { doc } = h;
    h.sections.receiveRows(big);
    const root = doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const visible = (): number => root.querySelectorAll("tr").filter((tr) => !tr.hidden && !tr.hasAttribute("class")).length;
    const control = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const btn = control.querySelector("button")!;
    const total = Number(control.getAttribute("data-compact-total"));
    assert.ok(total > 110, `a fixture with more than two steps held back (${total})`);
    const steps: number[] = [];
    for (let i = 0; i < 4 && btn.getAttribute("aria-expanded") !== "true"; i++) {
      const shown = visible();
      const label = btn.textContent ?? "";
      const promised = promisedByLabel(label, total, shown);
      btn.click();
      steps.push(visible() - shown);
      assert.equal(visible() - shown, promised, `press ${i + 1}: "${label}" revealed ${visible() - shown}, promised ${promised}`);
    }
    assert.deepEqual(steps.slice(0, 2), [50, 50], "the first two presses each add one step");
    assert.equal(visible(), total, "the last press shows every row");
    // control: the pre-M2 model expanded to EVERY row on the first "Show 50 more"
    const oldModelFirstPress = total - 10;
    assert.notEqual(oldModelFirstPress, promisedByLabel("Show 50 more", total, 10), "the old all-rows toggle breaks its own label");
  } finally {
    h.restore();
  }
});

/* ---------- DESIGN-POLISH M2 review R2-1: the press past the prefetched rows ----------

   The property: before the dataset arrives, the count and the button never
   state rows that are not on screen. The first "Show 50 more" reveals the
   server's prefetched rows; a second press asks for the dataset and WAITS
   (the button is busy, the count still "1–60 of N"), its step landing on
   delivery. If the dataset fails, the waiting press is withdrawn and the
   ranking re-syncs to the rows it has. The pre-fix island added 50 to its
   limit per press regardless, so the second press read "1–110 of 130" over 60
   rows, and a failed fetch never re-synced. */

test("R2-1: a second \"Show 50 more\" before delivery waits for the dataset — the count never runs past the rows on screen; delivery lands the step", () => {
  const big = Array.from({ length: 130 }, (_, i) =>
    txn({ txnId: `b${i}`, ticker: `B${String(i).padStart(3, "0")}`, bioguide: `N${i}`, name: `Member B${i}`, low: 1001 + i * 1000, high: 15000 + i * 1000 }),
  );
  let requested = 0;
  const { doc, restore } = installDom(pageHtml(big));
  try {
    const sections = initCongressSections({ requestRows: () => { requested++; } });
    const root = doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const visible = (): number => root.querySelectorAll("tr").filter((tr) => !tr.hidden && !tr.hasAttribute("class")).length;
    const control = disclosureFor(doc, CONGRESS_ROOTS.momentum);
    const btn = control.querySelector("button")!;
    const count = (): string => (boundFor(doc, CONGRESS_ROOTS.momentum).hidden ? "" : boundFor(doc, CONGRESS_ROOTS.momentum).textContent);
    /** The count's shown end ("1–60 of …" → 60) must equal the rows on screen. */
    const honest = (): string[] => {
      const m = /^1–([\d,]+) of /.exec(count());
      return m && Number(m[1]!.replace(/,/g, "")) !== visible() ? [`the count "${count()}" states ${m[1]} rows, ${visible()} show`] : [];
    };
    assert.equal(visible(), 10);
    btn.click(); // reveals the prefetched rows
    assert.equal(visible(), 60, "the first press reveals the 50 prefetched rows");
    assert.deepEqual(honest(), []);
    assert.ok(requested > 0, "the first press already asks for the dataset");
    btn.click(); // past the prefetched rows: waits
    assert.equal(visible(), 60, "no row can show before the dataset arrives");
    assert.deepEqual(honest(), [], "the count still states the rows on screen");
    assert.equal(btn.getAttribute("aria-busy"), "true", "the waiting press says so on its button");
    assert.equal(btn.textContent, "Show 50 more", "the offer stands");
    sections.receiveRows(big);
    assert.equal(visible(), 110, "the waiting step lands on delivery — exactly one step");
    assert.equal(btn.getAttribute("aria-busy"), null);
    assert.deepEqual(honest(), []);
    // control: a count running one step past the rows on screen (the pre-fix state) is caught by the same predicate
    boundFor(doc, CONGRESS_ROOTS.momentum).textContent = "1–160 of 130 ranked tickers";
    assert.deepEqual(honest(), ["the count \"1–160 of 130 ranked tickers\" states 160 rows, 110 show"], "control: the pre-fix count is caught");
  } finally {
    restore();
  }
});

test("R2-1: a dataset that fails withdraws the waiting press and re-syncs the ranking to the rows it has", () => {
  const big = Array.from({ length: 130 }, (_, i) =>
    txn({ txnId: `f${i}`, ticker: `F${String(i).padStart(3, "0")}`, bioguide: `P${i}`, name: `Member F${i}`, low: 1001 + i * 1000, high: 15000 + i * 1000 }),
  );
  const { doc, restore } = installDom(pageHtml(big));
  try {
    const sections = initCongressSections({ requestRows: () => {} });
    const root = doc.getElementById(CONGRESS_ROOTS.momentum)!;
    const visible = (): number => root.querySelectorAll("tr").filter((tr) => !tr.hidden && !tr.hasAttribute("class")).length;
    const btn = disclosureFor(doc, CONGRESS_ROOTS.momentum).querySelector("button")!;
    btn.click();
    btn.click();
    assert.equal(btn.getAttribute("aria-busy"), "true");
    sections.feedSettled(false);
    assert.equal(btn.getAttribute("aria-busy"), null, "the waiting press is withdrawn");
    assert.equal(visible(), 60, "the rows on screen stay");
    assert.match(boundFor(doc, CONGRESS_ROOTS.momentum).textContent, /^1–60 of 130 /, "the count restates exactly those rows");
    assert.equal(btn.textContent, "Show 50 more", "a later press may ask again");
    btn.click(); // collapse is not what this press means: it asks again, and waits
    assert.equal(btn.getAttribute("aria-busy"), "true", "the retry waits like the first");
  } finally {
    restore();
  }
});
