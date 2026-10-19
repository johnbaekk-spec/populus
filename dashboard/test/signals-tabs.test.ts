/* signals-v4 M2 (R9, R10, LD8, LD9; T2.2): the Signals tabs — one tablist of
   Congress and Institutional, and from M3 (T3.5) Overlap and Playbooks too,
   every panel present and visible in the server HTML, the per-tab ledger
   groups, and the scroll region that never re-roles the tablist.

   The DOM is `mini-dom` over the bytes `signalsBody` emits; the address bar
   and history are the binder's `TabsEnv`. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { signalsBody } from "../src/lib/ui/index.ts";
import { initTabs, selectTabFor, type TabsEnv } from "../src/scripts/tabs.ts";
import { initSignalsPage } from "../src/scripts/signals-client.ts";
import type { SignalArtifact } from "../src/lib/signals.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { playbookTriggers } from "../src/lib/playbooks.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";

const CTX = {};
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

let page: string | null = null;
function goldenPage(): string {
  if (page) return page;
  const f = loadTriageFixture();
  const t = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const inst = fixtureInstitutional();
  page = signalsBody(f.artifact, CTX, {
    rowsEvaluated: 2051, triage: t, institutional: inst, overlap: fixtureOverlap(),
    playbooks: { triggers: playbookTriggers(t, f.rows), triage: t, bestIdeas: inst.leaders!.qualifying, consensus: inst.board!.qualifying, cmteUnavailableReason: t.cmteUnavailableReason },
  });
  return page;
}

interface Harness {
  doc: ReturnType<typeof installDom>["doc"];
  env: TabsEnv & { location: { hash: string } };
  replaced: string[];
  fire(hash: string): void;
  restore(): void;
}
function harness(html: string, hash = ""): Harness {
  const { doc, restore } = installDom(html);
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
    fire(h: string) {
      env.location.hash = h;
      onHash?.();
    },
    restore,
  };
}
const key = (k: string) => ({ key: k, preventDefault() {} });

test("T2.2 / T3.5 (R9, LD8): one tablist — Congress, Institutional, Overlap, Playbooks — in a role-less scroll wrapper; every panel is present and visible without script, Congress first", () => {
  const root = domOf(goldenPage());
  const lists = root.querySelectorAll('[role="tablist"]');
  assert.equal(lists.length, 1);
  const list = lists[0]!;
  assert.ok(list.classList.contains("tk-tabs") && list.classList.contains("sig-tabs"), "it binds through tabs.ts's one selector");
  assert.equal(list.getAttribute("aria-label"), "Signal sources");
  const wrap = list.parent!;
  assert.ok(wrap.classList.contains("sig-tabs-scroll"));
  assert.match(wrap.getAttribute("data-scroll-region")!, /scroll sideways/);
  assert.equal(wrap.getAttribute("role"), null, "the scroll region is the role-less wrapper");
  const tabs = list.querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map((t) => [t.getAttribute("id"), t.getAttribute("href"), t.getAttribute("aria-controls")]), [
    ["tab-congress", "#congress", "congress"],
    ["tab-institutional", "#institutional", "institutional"],
    ["tab-overlap", "#overlap", "overlap"],
    ["tab-playbooks", "#playbooks", "playbooks"],
  ]);
  assert.match(text(tabs[1]), /^Institutional 200$/, "the Institutional tab counts the quarter's moves");
  assert.equal(text(tabs[2]), "Overlap 26 New", "Overlap counts its same-side names, and says it is new");
  assert.equal(text(tabs[3]), "Playbooks 7 New");
  const panels = root.querySelectorAll('[role="tabpanel"]');
  assert.deepEqual(panels.map((p) => [p.getAttribute("id"), p.getAttribute("aria-labelledby")]), [["congress", "tab-congress"], ["institutional", "tab-institutional"], ["overlap", "tab-overlap"], ["playbooks", "tab-playbooks"]]);
  assert.ok(panels.every((p) => !p.hasAttribute("hidden")), "no panel is hidden in the server HTML (no-JS: stacked)");
  assert.equal(panels[1]!.getAttribute("data-quarter"), "2026-03-31");
  // v3's Congress anchors keep their order inside the Congress panel
  const congress = root.querySelector("#congress")!;
  for (const id of ["lead-cards", "triage", "stands", "look", "routine", "families", "hits"]) assert.ok(congress.querySelector(`#${id}`), `#${id} in #congress`);
  for (const id of ["named-moves", "consensus", "new-position-leaders", "inst-lead-cards"]) assert.ok(root.querySelector(`#institutional #${id}`), `#${id} in #institutional`);
  assert.ok(root.querySelector("#overlap #ov-section #ov-list article.ov-item"), "the Overlap rows in #overlap");
  assert.equal(root.querySelectorAll("#playbooks article.pb-main").length, 7, "the seven playbooks in #playbooks");
});

test("T2.2 (R10, LD9): the head — h1 Signals, the M2 lede, the How tip — and one ledger group per tab, three figures each; Congress shows, Institutional is hidden", () => {
  const root = domOf(goldenPage());
  assert.equal(text(root.querySelector("h1")), "Signals");
  assert.equal(text(root.querySelector(".page-lede")), "What stands out in Congress trades and 13F moves.");
  const groups = root.querySelectorAll(".page-head [data-tab-for]");
  assert.deepEqual(groups.map((g) => [g.getAttribute("data-tab-for"), g.hasAttribute("hidden")]), [["congress", false], ["institutional", true], ["overlap", true], ["playbooks", true]]);
  assert.deepEqual(groups.map((g) => g.querySelectorAll(".ledger-fig").length), [3, 3, 3, 3]);
  const labels = (g: MiniElement) => g.querySelectorAll(".ledger-fig dt").map((d) => text(d).replace(/,? explain$/, "").split(" ")[0]);
  assert.deepEqual(labels(groups[1]!), ["Moves", "Top", "Quarter"]);
  assert.deepEqual(labels(groups[2]!), ["Same", "Opposite", "Quarter"]);
  assert.deepEqual(labels(groups[3]!), ["Playbooks", "Triggered", "Needs"]);
  assert.deepEqual(groups[2]!.querySelectorAll(".ledger-value").map((x) => text(x)), ["26", "12", "Q1 2026"], "LD9: Overlap's core same and opposite names, the quarter");
  assert.equal(groups[3]!.querySelectorAll(".ledger-value").map((x) => text(x))[0], "7");
  // every value in a hidden group is stated inside its panel (LD9)
  for (const [g, id] of [[groups[1]!, "institutional"], [groups[2]!, "overlap"], [groups[3]!, "playbooks"]] as const) {
    const panel = text(root.querySelector(`#${id}`));
    for (const v of g.querySelectorAll(".ledger-value").map((x) => text(x))) assert.ok(panel.includes(v), `"${v}" in the ${id} panel`);
  }
  // control: a value the panel does not state is caught by the same check
  assert.ok(!text(root.querySelector("#overlap")).includes("Q9 2099"), "control");
});

test("T2.2 (R9, LD8): selecting Institutional shows its panel and its ledger group and hides Congress's; arrow keys, Home and End follow the tabs pattern; a hash inside a panel selects it", () => {
  const h = harness(goldenPage());
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    const tab = (id: string) => h.doc.getElementById(`tab-${id}`)!;
    const group = (id: string) => h.doc.querySelector(`.page-head [data-tab-for="${id}"]`)!;
    assert.equal(tab("congress").getAttribute("aria-selected"), "true", "no hash: Congress");
    assert.equal(h.doc.getElementById("institutional")!.hasAttribute("hidden"), true);
    assert.equal(group("congress").hasAttribute("hidden"), false);
    tab("institutional").click();
    assert.equal(h.doc.getElementById("institutional")!.hasAttribute("hidden"), false);
    assert.equal(h.doc.getElementById("congress")!.hasAttribute("hidden"), true);
    assert.equal(group("institutional").hasAttribute("hidden"), false, "its ledger group shows");
    assert.equal(group("congress").hasAttribute("hidden"), true, "and Congress's hides");
    assert.deepEqual(h.replaced, ["#institutional"], "the hash is written with replaceState");
    // keys (M3: four tabs)
    tab("institutional").dispatch("keydown", key("ArrowRight"));
    assert.equal(tab("overlap").getAttribute("aria-selected"), "true", "ArrowRight moves to the next");
    assert.equal(group("overlap").hasAttribute("hidden"), false, "with its ledger group");
    tab("overlap").dispatch("keydown", key("ArrowRight"));
    tab("playbooks").dispatch("keydown", key("ArrowRight"));
    assert.equal(tab("congress").getAttribute("aria-selected"), "true", "ArrowRight wraps to the first");
    tab("congress").dispatch("keydown", key("End"));
    assert.equal(tab("playbooks").getAttribute("aria-selected"), "true");
    tab("playbooks").dispatch("keydown", key("ArrowLeft"));
    tab("overlap").dispatch("keydown", key("ArrowLeft"));
    assert.equal(tab("institutional").getAttribute("aria-selected"), "true");
    tab("institutional").dispatch("keydown", key("Home"));
    assert.equal(tab("congress").getAttribute("aria-selected"), "true");
    assert.equal(group("congress").hasAttribute("hidden"), false);
    // a hash naming an element inside a panel selects that panel
    h.fire("#consensus");
    assert.equal(tab("institutional").getAttribute("aria-selected"), "true");
    h.fire("#hits");
    assert.equal(tab("congress").getAttribute("aria-selected"), "true");
    // selectTabFor: the first step of every in-page navigation
    assert.equal(selectTabFor(h.doc.getElementById("named-moves") as unknown as Element), true);
    assert.equal(tab("institutional").getAttribute("aria-selected"), "true");
    assert.equal(group("institutional").hasAttribute("hidden"), false);
    assert.equal(h.replaced.at(-1), "#institutional", "the address bar names the panel shown");
    assert.equal(selectTabFor(null), false);
  } finally {
    h.restore();
  }
  // a hash on load
  const l = harness(goldenPage(), "#named-moves");
  try {
    initTabs(l.doc as unknown as ParentNode, l.env);
    assert.equal(l.doc.getElementById("tab-institutional")!.getAttribute("aria-selected"), "true", "#named-moves selects Institutional on load");
    assert.equal(l.doc.querySelector('.page-head [data-tab-for="institutional"]')!.hasAttribute("hidden"), false);
  } finally {
    l.restore();
  }
});

test("T2.2 (LD8): the tab markup and tabs.ts take four tabs — the two M3 adds bind with no binder change", () => {
  const four =
    `<div class="tk-tabs sig-tabs" role="tablist" aria-label="Signal sources">` +
    ["congress", "institutional", "overlap", "playbooks"].map((id) => `<a class="tk-tab sig-tab" role="tab" id="tab-${id}" href="#${id}" aria-controls="${id}">${id}</a>`).join("") +
    `</div>` +
    ["congress", "institutional", "overlap", "playbooks"].map((id) => `<div data-tab-for="${id}">${id}</div><section class="tk-panel" role="tabpanel" id="${id}" aria-labelledby="tab-${id}"><p id="in-${id}">x</p></section>`).join("");
  const h = harness(four, "#in-playbooks");
  try {
    initTabs(h.doc as unknown as ParentNode, h.env);
    assert.equal(h.doc.getElementById("tab-playbooks")!.getAttribute("aria-selected"), "true");
    assert.deepEqual(["congress", "institutional", "overlap", "playbooks"].map((id) => h.doc.querySelector(`[data-tab-for="${id}"]`)!.hasAttribute("hidden")), [true, true, true, false]);
    h.doc.getElementById("tab-playbooks")!.dispatch("keydown", key("ArrowRight"));
    assert.equal(h.doc.getElementById("tab-congress")!.getAttribute("aria-selected"), "true", "the fourth wraps to the first");
  } finally {
    h.restore();
  }
});

test("T2.2 (LD8): initTabs and the scroll regions together — as the wrapper starts and stops overflowing, only the WRAPPER gains and loses its region role; the tablist keeps its role and name, and the hash and keys still select", () => {
  const { doc, restore } = installDom(goldenPage());
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, history: g.history };
  const resize: (() => void)[] = [];
  g.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (t: string, fn: () => void) => void (t === "resize" ? resize.push(fn) : undefined) };
  let onHash: (() => void) | null = null;
  const env = { location: { hash: "" }, history: { replaceState() {} }, getElementById: (id: string) => doc.getElementById(id) as unknown as Element | null, onHashChange: (fn: () => void) => void (onHash = fn) };
  try {
    const wrap = doc.querySelector(".sig-tabs-scroll")! as MiniElement & { scrollWidth: number; clientWidth: number };
    wrap.scrollWidth = 300;
    wrap.clientWidth = 300;
    initSignalsPage({ tabsEnv: env });
    const list = doc.querySelector('[role="tablist"]')!;
    const roles = () => [wrap.getAttribute("role"), list.getAttribute("role"), list.getAttribute("aria-label")];
    assert.deepEqual(roles(), [null, "tablist", "Signal sources"], "fits: a plain box");
    for (const over of [true, false, true]) {
      wrap.scrollWidth = over ? 420 : 300;
      for (const fn of resize) fn();
      assert.deepEqual(roles(), [over ? "region" : null, "tablist", "Signal sources"], `overflowing ${over}: only the wrapper's role moves`);
      assert.equal(wrap.getAttribute("aria-label"), over ? "Signal tabs · scroll sideways" : null);
      env.location.hash = "#institutional";
      onHash?.();
      assert.equal(doc.getElementById("tab-institutional")!.getAttribute("aria-selected"), "true", "the hash still selects");
      doc.getElementById("tab-institutional")!.dispatch("keydown", key("ArrowLeft"));
      assert.equal(doc.getElementById("tab-congress")!.getAttribute("aria-selected"), "true", "and the keys");
    }
  } finally {
    restore();
    g.window = prev.window;
    g.location = prev.location;
    g.history = prev.history;
  }
});

/** LD8's rule as a scan: no element carries both `data-scroll-region` and a
    role (or a name) of its own in the server HTML. */
function regionRoleProblems(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<[a-z][\w-]*\b[^>]*\sdata-scroll-region="[^"]*"[^>]*>/g)) {
    if (/\s(?:role|aria-label)="/.test(m[0])) out.push(m[0].slice(0, 120));
  }
  return out;
}

test("T2.2 (LD8): no element in the page carries data-scroll-region together with a role or a name of its own; a planted one is caught", () => {
  const html = goldenPage();
  assert.ok((html.match(/data-scroll-region="/g) ?? []).length >= 4, "the page carries its scroll regions (tabs, cards ×2, hits, chips)");
  assert.deepEqual(regionRoleProblems(html), []);
  const planted = html.replace('<div class="sig-tabs-scroll" data-scroll-region="Signal tabs · scroll sideways"><div class="tk-tabs sig-tabs" role="tablist" aria-label="Signal sources">', '<div class="tk-tabs sig-tabs" role="tablist" aria-label="Signal sources" data-scroll-region="Signal tabs · scroll sideways"><div>');
  assert.notEqual(planted, html, "control planted");
  assert.equal(regionRoleProblems(planted).length, 1, "control: the tablist as its own scroll region is caught");
});

test("T2.2 / T3.5: an artifact-only view still renders every tab, the Institutional, Overlap and Playbooks panels stating they are computed on the server", () => {
  const html = signalsBody({ ...(loadTriageFixture().artifact as SignalArtifact) }, CTX);
  const root = domOf(html);
  assert.equal(root.querySelectorAll('[role="tab"]').length, 4);
  assert.match(text(root.querySelector("#overlap")), /Overlap is computed on the server from the build's Congress rows and 13F changes; this view carries the Congress artifact only\./);
  assert.match(text(root.querySelector('[data-tab-for="overlap"]')), /not computed in this view/);
  assert.equal(text(root.querySelector("#tab-overlap")), "Overlap New", "no count it cannot state");
  assert.equal(text(root.querySelector("#playbooks .pb-disc")), "Published research on the patterns these rows show. Not advice.");
  assert.match(text(root.querySelector("#playbooks")), /The Playbooks tab is computed on the server from the build's triage/);
  assert.match(text(root.querySelector('[data-tab-for="playbooks"]')), /not computed in this view/);
  assert.match(text(root.querySelector("#institutional")), /computed on the server from the build's 13F data; this view carries the Congress artifact only/);
  assert.match(text(root.querySelector('[data-tab-for="institutional"]')), /not computed in this view/);
  assert.equal(text(root.querySelector("#tab-institutional")), "Institutional", "no count it cannot state");
});
