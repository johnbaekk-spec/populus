/* signals-v3 M3 (R16, LD8, T3.1): the ticker page's tab binder, driven over
   the REAL rendered body.

   The DOM is `test/lib/mini-dom.ts`, built by parsing the bytes
   `tickerUnifiedBody` emits — an element the renderer stops emitting is an
   element this DOM does not have. The browser seams the binder touches
   (`location.hash`, `history.replaceState`, `hashchange`) are passed in as
   its `TabsEnv`, so each test states exactly what the address bar says. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { tickerUnifiedBody } from "../src/lib/ui/index.ts";
import { initTabs, type TabsEnv } from "../src/scripts/tabs.ts";
import { installDom, type MiniElement } from "./lib/mini-dom.ts";
import type { TxnRow } from "../src/lib/format.ts";

const STAMPS = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
const ROW: TxnRow = {
  kind: "txn", txnId: "t-1", asset: null, assetType: null, filed: "2026-07-21", traded: "2026-06-24", name: "Fixture Member",
  bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB", side: "purchase", owner: "joint",
  low: 1001, high: 15000, lag: 27, late: 0, flags: [], doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
};

function body(): string {
  const holders = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, cik: String(i + 1).padStart(10, "0"), name: `HOLDER ${i + 1}`, value: 1000 - i, securities: 1, keySource: "entity", flags: [] }));
  return tickerUnifiedBody(
    { ticker: "WMB", txns: [ROW] },
    { state: "data", name: "Williams Cos Inc", cik: "0000107263", period: "2026-03-31", latestFiled: "2026-05-01", topn: 25, holders },
    STAMPS,
    {},
    { fullTable: false },
  );
}

interface Harness {
  doc: ReturnType<typeof installDom>["doc"];
  env: TabsEnv & { location: { hash: string } };
  replaced: string[];
  fireHashChange(hash: string): void;
  tabs(): MiniElement[];
  panel(id: string): MiniElement;
  restore(): void;
}

function harness(hash = "", html = body()): Harness {
  const { doc, restore } = installDom(`<main id="root">${html}</main>`);
  const replaced: string[] = [];
  let onHash: (() => void) | null = null;
  const env = {
    location: { hash },
    history: { replaceState: (_d: unknown, _u: string, url?: string) => void replaced.push(url ?? "") },
    getElementById: (id: string) => doc.getElementById(id) as unknown as Element | null,
    onHashChange: (fn: () => void) => void (onHash = fn),
  };
  return {
    doc,
    env,
    replaced,
    fireHashChange(h: string) {
      env.location.hash = h;
      onHash?.();
    },
    tabs: () => doc.querySelectorAll('[role="tab"]'),
    panel: (id: string) => doc.getElementById(id)!,
    restore,
  };
}

/** The selected tab's aria-controls, after asserting the WHOLE state is
    consistent: one tab selected, it alone in the tab order, its panel alone
    visible. */
function selected(h: Harness): string {
  const tabs = h.tabs();
  const on = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
  assert.equal(on.length, 1, "exactly one tab is selected");
  for (const t of tabs) {
    const isOn = t === on[0];
    assert.equal(t.getAttribute("aria-selected"), String(isOn));
    assert.equal(t.getAttribute("tabindex"), isOn ? "0" : "-1", "roving tabindex: only the selected tab is in the tab order");
    assert.equal(h.panel(t.getAttribute("aria-controls")!).hasAttribute("hidden"), !isOn, "only the selected tab's panel shows");
  }
  return on[0]!.getAttribute("aria-controls")!;
}

const key = (k: string) => {
  let prevented = false;
  return { ev: { key: k, preventDefault: () => void (prevented = true) }, prevented: () => prevented };
};

test("R16: before the binder runs both panels show and no tab is selected (the no-JS page); after it, Congress is selected and Institutional is hidden", () => {
  const h = harness();
  try {
    assert.deepEqual(h.tabs().map((t) => t.getAttribute("aria-controls")), ["congress", "institutional"]);
    for (const id of ["congress", "institutional"]) assert.ok(!h.panel(id).hasAttribute("hidden"), `${id} shows before init`);
    assert.ok(h.tabs().every((t) => !t.hasAttribute("aria-selected")), "nothing selected before init");
    initTabs(h.doc as unknown as ParentNode, h.env);
    assert.equal(selected(h), "congress", "no hash: the first tab");
    assert.deepEqual(h.replaced, [], "loading writes no hash");
  } finally {
    h.restore();
  }
});

test("R16: the hash selects on load — a panel's own id, and an element INSIDE a panel selects the panel that holds it; an id outside both leaves the default", () => {
  for (const [hash, want] of [["#institutional", "institutional"], ["#congress", "congress"], ["#ticker-holders", "institutional"], ["#ticker-inst-footnotes", "institutional"], ["#on-signals", "congress"], ["#no-such-id", "congress"]] as const) {
    const h = harness(hash);
    try {
      initTabs(h.doc as unknown as ParentNode, h.env);
      assert.equal(selected(h), want, `${hash} → ${want}`);
    } finally {
      h.restore();
    }
  }
  // an element inside the Congress panel (the disclosures foot's note) selects Congress even after Institutional was chosen
  const h = harness("#institutional");
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    const inner = h.panel("congress").querySelectorAll("[id]")[0]!;
    assert.ok(inner, "the Congress panel holds an element with an id");
    h.fireHashChange(`#${inner.getAttribute("id")}`);
    assert.equal(selected(h), "congress");
  } finally {
    h.restore();
  }
});

test("R16: hashchange re-selects — a link to #institutional, then back to #congress", () => {
  const h = harness();
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    h.fireHashChange("#institutional");
    assert.equal(selected(h), "institutional");
    h.fireHashChange("#congress");
    assert.equal(selected(h), "congress");
    h.fireHashChange("#on-signals");
    assert.equal(selected(h), "congress", "a hash outside both panels keeps the selection");
  } finally {
    h.restore();
  }
});

test("R16: a click selects, writes the hash with replaceState and cancels the jump to the anchor", () => {
  const h = harness();
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    const [, inst] = h.tabs();
    const k = key("");
    inst!.dispatch("click", k.ev);
    assert.equal(selected(h), "institutional");
    assert.ok(k.prevented(), "the link's own jump is cancelled");
    assert.deepEqual(h.replaced, ["#institutional"], "the hash is replaced, not pushed");
    // a click with no event object (mini-dom's click()) still selects
    h.tabs()[0]!.click();
    assert.equal(selected(h), "congress");
  } finally {
    h.restore();
  }
});

test("R16: ArrowRight / ArrowLeft wrap, Home and End jump (WAI-ARIA tabs, automatic activation); other keys do nothing", () => {
  const h = harness();
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    const focused: string[] = [];
    for (const t of h.tabs()) (t as unknown as { focus: () => void }).focus = () => void focused.push(t.getAttribute("aria-controls")!);
    const press = (from: number, k: string): { sel: string; prevented: boolean } => {
      const e = key(k);
      h.tabs()[from]!.dispatch("keydown", e.ev);
      return { sel: selected(h), prevented: e.prevented() };
    };
    assert.deepEqual(press(0, "ArrowRight"), { sel: "institutional", prevented: true });
    assert.deepEqual(press(1, "ArrowRight"), { sel: "congress", prevented: true }, "wraps past the last tab");
    assert.deepEqual(press(0, "ArrowLeft"), { sel: "institutional", prevented: true }, "wraps before the first tab");
    assert.deepEqual(press(1, "Home"), { sel: "congress", prevented: true });
    assert.deepEqual(press(0, "End"), { sel: "institutional", prevented: true });
    assert.deepEqual(focused, ["institutional", "congress", "institutional", "congress", "institutional"], "focus follows the selection");
    assert.deepEqual(press(1, "a"), { sel: "institutional", prevented: false }, "an unrelated key is left alone");
    assert.deepEqual(h.replaced.at(-1), "#institutional", "the hash follows the keys too");
  } finally {
    h.restore();
  }
});

test("R16: binding twice binds once; a re-rendered body (the /e/ populus:rerender path) is bound fresh and re-selected from the hash", () => {
  const h = harness("#institutional");
  try {
    const root = h.doc.getElementById("root")!;
    initTabs(root as unknown as ParentNode, h.env);
    initTabs(root as unknown as ParentNode, h.env);
    assert.ok(h.tabs().every((t) => t.listenerCount("click") === 1 && t.listenerCount("keydown") === 1), "one listener of each kind per tab");
    // the driver replaces the body, then dispatches populus:rerender → initTabs(root)
    root.innerHTML = body();
    assert.ok(h.tabs().every((t) => !t.hasAttribute("aria-selected")), "the fresh body is unbound");
    initTabs(root as unknown as ParentNode, h.env);
    assert.equal(selected(h), "institutional", "the hash still names the Institutional panel");
    h.tabs()[0]!.click();
    assert.equal(selected(h), "congress", "and its tabs work");
  } finally {
    h.restore();
  }
});

test("R16: the ticker page binds the tabs, and /e/ binds them after every populus:rerender, through the one module that provides the binder", () => {
  const src = (rel: string) => readFileSync(path.resolve(import.meta.dirname, "..", "src", rel), "utf-8");
  const page = src("pages/tickers/[ticker].astro");
  const script = page.slice(page.indexOf("<script>"), page.indexOf("</script>"));
  assert.match(script, /import \{ initTabs \} from "\.\.\/\.\.\/scripts\/tabs";/);
  assert.match(script, /^\s*initTabs\(document\);/m);
  const client = src("scripts/entity-client.ts");
  assert.match(client, /import \{ initTabs \} from "\.\/tabs\.ts";/);
  const route = client.slice(client.indexOf("export function runGenericRoute"));
  assert.match(route, /document\.addEventListener\("populus:rerender", \(\) => initTabs\(root\)\)/);
  assert.match(src("scripts/tabs.ts"), /export function initTabs\(/);
});

/* signals-v4 M2 (R9, LD8): the binder gained `[data-tab-for]` toggling and
   `selectTabFor(el)` for the Signals page. The ticker page carries no linked
   element, so its behaviour is unchanged; `selectTabFor` selects the panel
   holding a deep-link target here too, through the same `select()`. */
import { selectTabFor } from "../src/scripts/tabs.ts";

test("signals-v4 LD8: on the ticker page selectTabFor selects the panel holding an element and writes its hash; with no [data-tab-for] nothing else moves", () => {
  const h = harness();
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    assert.equal(selected(h), "congress");
    assert.equal(h.doc.querySelectorAll("[data-tab-for]").length, 0, "the ticker page has no linked element");
    const inside = h.panel("institutional").querySelector("section, div, p")!;
    assert.equal(selectTabFor(inside as unknown as Element), true);
    assert.equal(selected(h), "institutional");
    assert.equal(h.replaced.at(-1), "#institutional");
    // an element outside every panel selects nothing
    assert.equal(selectTabFor(h.doc.querySelector(".page-head") as unknown as Element), false);
    assert.equal(selected(h), "institutional");
  } finally {
    h.restore();
  }
});

/* ------------------------- launch redesign M6: the ticker head and Congress tab */

/* Launch copy audit ticker-01 … ticker-08 (PLAN R29, R30, R2; LD3 gives M6 the
   ticker page's header and Congress tab; ticker-09 … 13 are M7b's). Applied
   text present, replaced text gone, every caveat the items touched kept, and
   each element within the audit's words_after by the audit's own counting
   rule. The tab-level gate (≤ 206 on the served HTML) is the post-build word
   predicate's on the integrated build: it also needs M7a's signals-03 and
   signals-07, which shorten the open row the "On Signals" block shares. */
import { BANNED_PATTERNS, redactFiledNames } from "./lib/banned-scan.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

function auditWordsOf(el: MiniElement | null): number {
  if (!el) return 0;
  const text = (n: MiniElement): string =>
    n.nodes.map((c) => (typeof c === "string" ? c : c.classList.contains("visually-hidden") || c.classList.contains("note-pop") ? " " : text(c))).join("");
  return text(el).replace(/&[a-z#0-9]+;/g, " ").replace(/[⏎↗↓→←▲▼◂▸ⓘ§†‡·|/⌕☰]/g, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function m6Body(rows: TxnRow[]): string {
  return tickerUnifiedBody(
    { ticker: "WMB", txns: rows },
    { state: "data", name: "Williams Cos Inc", cik: "0000107263", period: "2026-03-31", latestFiled: "2026-05-01", topn: 25, holders: [] },
    STAMPS,
    {},
    { fullTable: false },
    { crowding: null, committees: { byMember: new Map(), windowFrom: "2025-01-01", windowTo: "2026-12-31", snapshotDate: "2026-07-20" } },
  );
}

const UNDATED: TxnRow = { ...ROW, txnId: "t-2", traded: null, lag: null, bioguide: "T000002", name: "Second Member" };
const LATE: TxnRow = { ...ROW, txnId: "t-3", traded: "2026-04-01", lag: 111, late: 1, side: "sale", bioguide: "T000003", name: "Third Member" };

test("launch M6 (ticker-01…08): the shipped copy, the replaced copy gone, every touched caveat kept", () => {
  const html = m6Body([ROW, UNDATED, LATE]);
  const dom = domOf(html);
  const one = (sel: string): MiniElement => {
    const el = dom.querySelector(sel);
    assert.ok(el, `${sel} renders`);
    return el!;
  };
  // ticker-01: no kicker over the H1
  assert.equal(dom.querySelectorAll(".page-head .kicker").length, 0);
  // ticker-02: the † is its own tip (G14), not a link to a footnote at the foot
  const h1 = one("h1.entity-title");
  assert.equal(visibleText(h1.querySelector("button.note-mark")!), "†");
  assert.match(visibleText(one("#n-ticker-head-mapped-name")), /present-day mapping, not the name as of each filing/);
  assert.equal(dom.querySelectorAll("#ticker-footnotes").length, 0);
  // ticker-03 (the remainder #163 left): the PTR jargon out of the labels; the undated count stays
  const ledger = dom.querySelectorAll(".ledger-fig").map((f) => visibleText(f));
  assert.ok(ledger[0]!.startsWith("Congress trades") && ledger[0]!.endsWith("all time"));
  assert.ok(ledger[2]!.startsWith("Latest filing") && ledger[2]!.endsWith("2026-07-21"));
  assert.match(ledger[3]!, /1 of 3 undated: timeliness unknown$/, "an undated row's timeliness is still stated");
  // ticker-04: each regime's clock once, with the as-of date
  assert.equal(visibleText(one(".design-provenance .tk-clock")), "Congress: statutory ranges, filed up to 45 days after the trade · 13F: quarter-end snapshots, filed up to 45 days later");
  assert.equal(visibleText(one(".design-provenance .stamp-line")), "as of 2026-07-24");
  // ticker-06: one meta line; rows that cannot be placed are counted in it; the legend is its tip
  assert.equal(visibleText(one(".design-timeline .panel-note")), "By trade date · 24 months · 2 rows · 1 undated, not placed ⓘ");
  assert.match(visibleText(one("#n-ticker-timeline-legend")), /^▲ buy, ▼ sell; height = lower bound \(log scale\)\. Trade date, not filing date — the filing lag is in the table below\.$/);
  assert.equal(dom.querySelectorAll(".design-timeline p.section-note").length, 0, "no note under the plot");
  // ticker-07: the window and the order; the two method lines are its tip
  assert.equal(visibleText(one(".design-members-active .panel-note")), "12 months · most active first ⓘ");
  assert.match(visibleText(one("#n-ticker-members-method")), /^Rows = number of disclosures, not dollars\. Net = lower bound of the net range\. Committees as of each member's latest trade in the window \(roster snapshot 2026-07-20\)\.$/);
  assert.equal(visibleText(dom.querySelectorAll(".design-members-active p.section-note").at(-1)!), "2 members", "pre-marketing: 12 months by trade date, as /congress/ counts; the undated row is stated in the ledger instead");
  // ticker-08: the order in a few words, one link to every row, no card foot
  const disclosures = one('[aria-label="Congressional disclosures"]');
  assert.equal(visibleText(disclosures.querySelector(".panel-note")!), "Newest filed first");
  assert.equal(visibleText(disclosures.querySelector("a.section-link")!), "All 3 rows ↗");
  assert.equal(disclosures.querySelectorAll(".card-foot").length, 0);

  for (const gone of [
    "Public record / Tickers", 'href="#ticker-footnotes"', "Congress txns", "all PTR rows naming", "Latest PTR", "Congress = transactions", "keeps its own clock",
    "a disclosure record, not a chart", "TRADE DATES", "HEIGHT = LOG LOWER BOUND", "the lag lives in the table below", "rows placed", "NET LOWER BOUND",
    "COMMITTEES AS OF TRADE DATE", "in the window, most active first", "counts of disclosures, not dollars.</p>", "ALL PTR ROWS NAMING", "SORTED FILED",
    "STATUTORY RANGES · FILED ≤45D LATE", "full congressional view", "Traded → filed dates on every row", "filed past the 45-day window</dd>",
  ]) {
    assert.ok(!html.includes(gone), `replaced copy is gone: "${gone}"`);
  }
  for (const kept of ["statutory ranges", "filed up to 45 days after the trade", "quarter-end snapshots", "undated, not placed", "not the name as of each filing", "Rows filed past the STOCK Act&#39;s 45-day window"]) {
    assert.ok(html.includes(kept), `the caveat stays: "${kept}"`);
  }
  const scanned = redactFiledNames(html);
  assert.deepEqual(BANNED_PATTERNS.filter((p) => p.re.test(scanned)).map((p) => p.name), []);
});

test("launch M6 (ticker-01…08): each element within the audit's words_after, counted by the audit's rule", () => {
  const dom = domOf(m6Body([ROW]));
  const words = (sel: string): number => auditWordsOf(dom.querySelector(sel));
  assert.equal(words(".page-head .kicker"), 0, "ticker-01: 0");
  /* ticker-04, adapted: 23 against the audit's 20 — the 13F clause keeps the
     13F lag ("filed up to 45 days later") where the audit wrote "not current
     holdings", a phrase the ticker page never prints (pages-render.test.ts) */
  assert.ok(words(".design-provenance") <= 23, `ticker-04: ${words(".design-provenance")}`);
  assert.ok(words(".design-timeline .panel-note") <= 7, `ticker-06: ${words(".design-timeline .panel-note")}`);
  const members = auditWordsOf(dom.querySelector(".design-members-active .panel-note")) + auditWordsOf(dom.querySelectorAll(".design-members-active p.section-note").at(-1) ?? null);
  assert.ok(members <= 8, `ticker-07: ${members}`);
  // and with more than eight members the count line is the bare range, as the audit wrote it
  const many = Array.from({ length: 10 }, (_, i) => ({ ...ROW, txnId: `m-${i}`, bioguide: `M00000${i}`, name: `Member ${i}` }));
  const manyDom = domOf(m6Body(many));
  assert.equal(visibleText(manyDom.querySelectorAll(".design-members-active p.section-note").at(-1)!), "1–8 of 10");
  const disclosures = dom.querySelector('[aria-label="Congressional disclosures"] .panel-head')!;
  assert.ok(auditWordsOf(disclosures) - 2 <= 8, `ticker-08: ${auditWordsOf(disclosures) - 2} besides the 2-word heading`);
  // ticker-02 and the tips: a tip's words are never visible copy
  assert.equal(auditWordsOf(dom.querySelector("h1.entity-title")), 4, "the H1 reads 'WMB — Williams Cos Inc'; the † tip adds nothing");
});
