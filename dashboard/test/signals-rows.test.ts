/* signals-v4 M1 (R2, R3, R4, R7, LD4, LD5, LD7; T1.3, T1.5, T1.7): the
   two-line row, the card that opens it, and the pane switch.

   The row's anatomy over every golden row is pinned in signals-page.test.ts
   (its v3 tests, edited to the new structure). Here: the removal controls
   (deleting an honesty field fails the reading), the ticker page's opened
   variant, and the client — a hash or a card opens the row (through closed
   Routine and a hidden pane), and the pane switch moves only the `hidden`
   attribute, only while the band is stacked. The client runs over the
   server's own markup (`mini-dom`), so it can only find what the page holds. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { signalsBody, triageRowHtml } from "../src/lib/ui/index.ts";
import { tickerOnSignalsHtml, triageRowId } from "../src/lib/ui/signals.ts";
import { buildTriage, type TriageResult } from "../src/lib/signal-triage.ts";
import type { SignalArtifact } from "../src/lib/signals.ts";
import { hashTargetId, initPaneSwitches, initRowLinks, revealHash, revealRow, STACKED_QUERY } from "../src/scripts/signals-client.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";

const CTX = {};
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}

let golden: { art: SignalArtifact; t: TriageResult; html: string } | null = null;
function goldenPage(): { art: SignalArtifact; t: TriageResult; html: string } {
  if (golden) return golden;
  const f = loadTriageFixture();
  const t = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  golden = { art: f.artifact, t, html: signalsBody(f.artifact, CTX, { rowsEvaluated: 2051, triage: t }) };
  return golden;
}

/* ---------------------------------------------------------------- T1.3 */

test("signals-v4 T1.3 removal controls: deleting the owner, either date or the receipt from a row fails the row reading", () => {
  const { t } = goldenPage();
  const row = t.rows.find((r) => r.lead.txn.traded && r.lead.txn.ticker === "WMB")!;
  /** the honesty fields the collapsed row must carry */
  const problems = (html: string): string[] => {
    const a = domOf(html);
    const sum = a.querySelector("summary.si-row-sum");
    const out: string[] = [];
    if (!sum?.querySelector(".owner-note")) out.push("owner");
    if (sum?.querySelector(".si-row-filed time")?.getAttribute("datetime") !== row.lead.txn.filed) out.push("filed");
    if (sum?.querySelector(".si-row-traded time")?.getAttribute("datetime") !== row.lead.txn.traded) out.push("traded");
    if (a.querySelector(".si-row-src a")?.getAttribute("href") !== row.lead.doc) out.push("receipt");
    return out;
  };
  const html = triageRowHtml(row, CTX);
  assert.deepEqual(problems(html), []);
  const cut = (re: RegExp, what: string): string[] => {
    const m = html.replace(re, "");
    assert.notEqual(m, html, `control: ${what} found`);
    return problems(m);
  };
  assert.deepEqual(cut(/<span class="owner-note">[^<]*<\/span>/, "owner (the summary's, the first)"), ["owner"]);
  assert.deepEqual(cut(/<span class="si-row-filed">.*?<\/span>/, "filed"), ["filed"]);
  assert.deepEqual(cut(/<span class="si-row-traded">.*?<\/span><\/span>/, "traded"), ["traded"]);
  assert.deepEqual(cut(/<span class="si-row-src">.*<\/span><\/article>$/, "receipt"), ["receipt"]);
});

test("signals-v4 LD4: every row shares one details name (one open at a time); on /signals/ rows are closed and link the ticker page, on the ticker page the same row is OPEN with no self-link", () => {
  const { t, html } = goldenPage();
  const root = domOf(html);
  const ds = root.querySelectorAll("details.si-row-d");
  assert.equal(ds.length, t.rows.length);
  assert.ok(ds.every((d) => d.getAttribute("name") === "si-rows" && !d.hasAttribute("open")));
  const bac = t.byTicker.get("BAC")!.find((r) => r.tier !== "routine")!;
  const onSignals = domOf(triageRowHtml(bac, CTX));
  assert.ok(onSignals.querySelector('.si-row-links a[href="/tickers/BAC/#on-signals"]'));
  const block = domOf(tickerOnSignalsHtml(t.byTicker.get("BAC")!, t.hitsByTicker.get("BAC") ?? [], CTX));
  const d = block.querySelector("details.si-row-d")!;
  assert.ok(d.hasAttribute("open"), "rendered open");
  assert.equal(block.querySelectorAll(".si-row-links a").filter((a) => (a.getAttribute("href") ?? "").startsWith("/tickers/")).length, 0, "no link to the page it is on");
  assert.equal(block.querySelector("article.si-row")!.getAttribute("id"), triageRowId(bac));
  // and the opened row's honesty: the full sentence, every meter in words, the receipt
  assert.equal(block.querySelector(".si-row-reason")!.textContent, bac.sentence);
  assert.equal(block.querySelectorAll(".si-row-mw .si-mw-word").length, 4);
  assert.ok(block.querySelectorAll(".si-row-links a").some((a) => a.getAttribute("href") === bac.lead.doc));
});

/* ---------------------------------------------------------------- the client */

interface FakeWindow {
  matches: boolean;
  listeners: Map<string, (() => void)[]>;
  mqListeners: (() => void)[];
}
/** Install the server's markup and a window whose `(max-width: 1080px)` answer is `stacked`. */
function mount(html: string, stacked: boolean, hash = ""): { doc: ReturnType<typeof installDom>["doc"]; win: FakeWindow; restore(): void } {
  const dom = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, history: g.history };
  const win: FakeWindow = { matches: stacked, listeners: new Map(), mqListeners: [] };
  g.window = {
    matchMedia: (q: string) => ({
      get matches() {
        return q === STACKED_QUERY ? win.matches : false;
      },
      addEventListener: (_t: string, fn: () => void) => void win.mqListeners.push(fn),
    }),
    addEventListener: (t: string, fn: () => void) => void win.listeners.set(t, [...(win.listeners.get(t) ?? []), fn]),
  };
  const loc = { hash };
  g.location = loc;
  g.history = { pushState: (_s: unknown, _t: string, url: string) => void (loc.hash = url) };
  return {
    doc: dom.doc,
    win,
    restore() {
      dom.restore();
      g.window = prev.window;
      g.location = prev.location;
      g.history = prev.history;
    },
  };
}

test("signals-v4 T1.7 (LD7): the pane switch is hidden in the server HTML; stacked, it shows and hides the unselected pane; side by side, it hides and both panes show — only the hidden attribute moves", () => {
  const { html } = goldenPage();
  const root = domOf(html);
  const sw = root.querySelector("[data-pane-switch]")!;
  assert.ok(sw.hasAttribute("hidden"), "server: hidden");
  assert.deepEqual([sw.getAttribute("role"), sw.getAttribute("aria-label")], ["group", "Show"]);
  assert.ok(sw.classList.contains("seg"), "a segmented control: its buttons meet the G12 hit area");
  assert.deepEqual(sw.querySelectorAll("button").map((b) => [b.getAttribute("aria-controls"), b.getAttribute("aria-pressed")]), [["triage", "true"], ["signals-side", "false"]]);
  assert.ok(!root.querySelector("#triage")!.hasAttribute("hidden") && !root.querySelector("#signals-side")!.hasAttribute("hidden"), "server: every pane visible (no JS)");
  // stacked
  const m = mount(html, true);
  try {
    initPaneSwitches();
    const doc = m.doc;
    const s = doc.querySelector("[data-pane-switch]")!;
    assert.equal(s.hasAttribute("hidden"), false, "stacked: the switch shows");
    assert.equal(doc.getElementById("triage")!.hasAttribute("hidden"), false);
    assert.equal(doc.getElementById("signals-side")!.hasAttribute("hidden"), true, "the unselected pane carries hidden");
    (s.querySelectorAll("button")[1] as unknown as MiniElement).click();
    assert.equal(doc.getElementById("triage")!.hasAttribute("hidden"), true);
    assert.equal(doc.getElementById("signals-side")!.hasAttribute("hidden"), false);
    assert.deepEqual(s.querySelectorAll("button").map((b) => b.getAttribute("aria-pressed")), ["false", "true"]);
    // a deep link into the hidden pane selects it (no deep link lands on a hidden pane)
    (s.querySelectorAll("button")[0] as unknown as MiniElement).click();
    assert.equal(doc.getElementById("signals-side")!.hasAttribute("hidden"), true, "precondition: Hits is hidden");
    assert.equal(revealHash("#hits")?.getAttribute("id"), "hits");
    assert.equal(doc.getElementById("signals-side")!.hasAttribute("hidden"), false, "#hits selects the Hits pane");
    assert.equal(revealHash("#nothing-here"), null, "a hash naming nothing selects nothing");
    // the band widens: the query stops matching
    m.win.matches = false;
    for (const fn of m.win.mqListeners) fn();
    assert.equal(s.hasAttribute("hidden"), true, "side by side: the switch hides");
    assert.ok(!doc.getElementById("triage")!.hasAttribute("hidden") && !doc.getElementById("signals-side")!.hasAttribute("hidden"), "and both panes show");
  } finally {
    m.restore();
  }
  // side by side from the start: nothing is hidden
  const w = mount(html, false);
  try {
    initPaneSwitches();
    assert.equal(w.doc.querySelector("[data-pane-switch]")!.hasAttribute("hidden"), true);
    assert.ok(!w.doc.getElementById("signals-side")!.hasAttribute("hidden"));
  } finally {
    w.restore();
  }
});

test("signals-v4 T1.5 (LD5): a hashchange to a row id opens that row's <details>; a card's link opens its row and records the hash; a row in closed Routine opens Routine; a row in a hidden pane selects its pane", () => {
  const { html, t } = goldenPage();
  const routineRow = t.rows.find((r) => r.tier === "routine")!;
  const m = mount(html, true);
  try {
    initPaneSwitches();
    initRowLinks();
    const doc = m.doc;
    const open = () => doc.querySelectorAll("details.si-row-d").filter((d) => d.hasAttribute("open")).map((d) => d.closest("article")!.getAttribute("id"));
    // hashchange
    const target = t.rows.find((r) => r.tier === "stands")!;
    (globalThis as unknown as { location: { hash: string } }).location.hash = `#${triageRowId(target)}`;
    for (const fn of m.win.listeners.get("hashchange") ?? []) fn();
    assert.deepEqual(open(), [triageRowId(target)], "the named row opens");
    // a hash into closed Routine opens Routine too
    doc.getElementById(triageRowId(target))!.querySelector("details.si-row-d")!.removeAttribute("open");
    assert.equal(doc.getElementById("routine")!.hasAttribute("open"), false, "precondition: Routine is closed");
    (globalThis as unknown as { location: { hash: string } }).location.hash = `#${triageRowId(routineRow)}`;
    for (const fn of m.win.listeners.get("hashchange") ?? []) fn();
    assert.equal(doc.getElementById("routine")!.hasAttribute("open"), true, "Routine opened");
    assert.ok(open().includes(triageRowId(routineRow)));
    // a card, while the Hits pane is selected: the Filings pane is selected, then the row opens
    (doc.querySelectorAll("[data-pane-switch] button")[1] as unknown as MiniElement).click();
    assert.equal(doc.getElementById("triage")!.hasAttribute("hidden"), true, "precondition: Filings is the hidden pane");
    const card = doc.querySelector("a.si-card-open")!;
    const href = card.getAttribute("href")!;
    (card as unknown as MiniElement).click();
    assert.equal(doc.getElementById("triage")!.hasAttribute("hidden"), false, "its pane is selected");
    assert.ok(open().includes(href.slice(1)), "the card's row opens");
    assert.equal((globalThis as unknown as { location: { hash: string } }).location.hash, href, "the hash is recorded");
    // a hash naming nothing that is a row opens nothing
    assert.equal(revealRow(doc.getElementById("hits") as never), null);
  } finally {
    m.restore();
  }
  // on load with a hash
  const target = t.rows.find((r) => r.tier === "look")!;
  const l = mount(html, false, `#${triageRowId(target)}`);
  try {
    initRowLinks();
    assert.ok(l.doc.getElementById(triageRowId(target))!.querySelector("details.si-row-d")!.hasAttribute("open"), "a hash on load opens the row");
  } finally {
    l.restore();
  }
});

test("QA M1: hashTargetId decodes a hash, and returns a malformed one verbatim instead of throwing", () => {
  assert.equal(hashTargetId("#si-row-single%3Aab12"), "si-row-single:ab12");
  assert.equal(hashTargetId("#%E0%A4%A"), "%E0%A4%A");
  assert.equal(hashTargetId(""), "");
});
