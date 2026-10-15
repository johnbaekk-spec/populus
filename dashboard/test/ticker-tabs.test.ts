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
