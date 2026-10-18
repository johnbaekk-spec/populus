/* signals-v3 M3 (R16, LD8): the ticker page's two real tabs — Congress and
   Institutional — on the sticky `.tk-tabs` bar.

   Progressive by construction. The server HTML (`tickerUnifiedBody`) carries
   a `role="tablist"` of two `<a role="tab" href="#…" aria-controls="…">`
   links and two `<section role="tabpanel">`s, BOTH visible: without
   JavaScript the tabs are plain in-page links over two stacked sections, and
   nothing on the page is hidden. This binder is the only thing that ever hides
   a panel, and only once it has run:

   - it selects one tab (`aria-selected`, a roving `tabindex`) and puts
     `hidden` on the other panel;
   - the selection follows `location.hash` on load and on `hashchange`: the
     hash of a panel (`#congress`, `#institutional`) selects it, and a deep
     link to an element INSIDE a panel (a member row, a holders anchor)
     selects the panel that holds it, then scrolls the element back into
     view — the browser scrolled to it before the other panel was hidden;
   - a click, or ArrowLeft / ArrowRight / Home / End on a focused tab
     (WAI-ARIA tabs, automatic activation), selects and writes the hash with
     `history.replaceState`: no history entry and no jump to the anchor.

   `/e/` renders the same body on the client and dispatches
   `populus:rerender` after every render; its route re-binds through the same
   function (`runGenericRoute`). Re-binding the same tablist is a no-op.

   signals-v4 M2 (R9, LD8): the Signals page binds through the same selector
   (its list carries `.tk-tabs`), with up to four tabs. Every `[data-tab-for]`
   element under the bound root — the head's per-tab ledger groups — shows
   exactly when its panel does. `selectTabFor(el)` selects the tab whose panel
   holds `el`: the first step of every in-page navigation
   (`signals-client.ts` `revealTarget`). */

/** What the binder reads and writes outside the tab list — the browser by
    default; a test passes its own. */
export interface TabsEnv {
  location: { readonly hash: string };
  history: { replaceState(data: unknown, unused: string, url?: string): void } | null;
  getElementById(id: string): Element | null;
  /** subscribe to `hashchange` (called once per environment) */
  onHashChange(fn: () => void): void;
}

function browserEnv(): TabsEnv {
  return {
    location: window.location,
    history: window.history,
    getElementById: (id) => document.getElementById(id),
    onHashChange: (fn) => window.addEventListener("hashchange", fn),
  };
}

interface TabSet {
  tabs: Element[];
  panels: (Element | null)[];
  /** the `[data-tab-for]` elements under the bound root */
  linked: Element[];
}

const BOUND = "data-tabs-bound";
const TABLIST = '.tk-tabs[role="tablist"]';

function tabSetOf(list: Element, env: TabsEnv, root: ParentNode): TabSet {
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  return {
    tabs,
    panels: tabs.map((t) => env.getElementById(t.getAttribute("aria-controls") ?? "")),
    linked: Array.from(root.querySelectorAll("[data-tab-for]")),
  };
}

function setHidden(el: Element, hidden: boolean): void {
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}

/** Select tab `i`: the one selected tab is in the tab order, every other tab
    is reached with the arrow keys; only the selected tab's panel shows. */
function select(set: TabSet, i: number): void {
  set.tabs.forEach((tab, j) => {
    const on = j === i;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.setAttribute("tabindex", on ? "0" : "-1");
    const panel = set.panels[j];
    if (panel) setHidden(panel, !on);
  });
  /* LD8: an element linked to a panel (`data-tab-for`) toggles with it */
  const selected = set.tabs[i]?.getAttribute("aria-controls") ?? null;
  const ids = new Set(set.tabs.map((t) => t.getAttribute("aria-controls")));
  for (const el of set.linked) {
    const forId = el.getAttribute("data-tab-for");
    if (forId !== null && ids.has(forId)) setHidden(el, forId !== selected);
  }
}

/** The id a hash names, or null for an empty hash. */
function hashId(hash: string): string | null {
  if (!hash || hash === "#") return null;
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The tab whose panel IS or HOLDS the element the hash names (-1 for none),
    and that element. */
function tabForHash(set: TabSet, env: TabsEnv): { index: number; target: Element | null } {
  const id = hashId(env.location.hash);
  if (id === null) return { index: -1, target: null };
  const own = set.panels.findIndex((p) => p !== null && p.getAttribute("id") === id);
  if (own >= 0) return { index: own, target: set.panels[own]! };
  const target = env.getElementById(id);
  const panel = target?.closest('[role="tabpanel"]') ?? null;
  const index = panel === null ? -1 : set.panels.indexOf(panel);
  return { index, target: index >= 0 ? target : null };
}

/** Apply the hash to a tab set: select the tab it names (the first tab when it
    names none of this set's panels and no tab is selected yet), and bring a
    deep-linked element back into view. */
function applyHash(set: TabSet, env: TabsEnv): void {
  const { index, target } = tabForHash(set, env);
  if (index >= 0) select(set, index);
  else if (!set.tabs.some((t) => t.getAttribute("aria-selected") === "true")) select(set, 0);
  if (target && typeof (target as HTMLElement).scrollIntoView === "function") (target as HTMLElement).scrollIntoView();
}

const KEYS: Readonly<Record<string, (i: number, n: number) => number>> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** Every root bound so far, re-read on `hashchange` (a re-rendered `/e/`
    body replaces the tab list under the same root). */
const roots = new Map<ParentNode, TabsEnv>();
const subscribed = new WeakSet<TabsEnv>();
let defaultEnv: TabsEnv | null = null;

/** Bind every `.tk-tabs` tab list under `root`. Safe to call again after a
    re-render: an already-bound list is only re-synced to the hash. */
export function initTabs(root: ParentNode = document, env?: TabsEnv): void {
  const e = env ?? (defaultEnv ??= browserEnv());
  for (const list of Array.from(root.querySelectorAll(TABLIST))) {
    const set = tabSetOf(list, e, root);
    if (set.tabs.length === 0) continue;
    if (!list.hasAttribute(BOUND)) {
      list.setAttribute(BOUND, "");
      set.tabs.forEach((tab, i) => {
        tab.addEventListener("click", (ev?: Event) => {
          ev?.preventDefault?.();
          select(set, i);
          const id = tab.getAttribute("aria-controls");
          if (id) e.history?.replaceState(null, "", `#${id}`);
        });
        tab.addEventListener("keydown", (ev?: Event) => {
          const key = (ev as KeyboardEvent | undefined)?.key ?? "";
          const move = KEYS[key];
          if (!move) return;
          ev?.preventDefault?.();
          const j = move(i, set.tabs.length);
          select(set, j);
          const id = set.tabs[j]!.getAttribute("aria-controls");
          if (id) e.history?.replaceState(null, "", `#${id}`);
          (set.tabs[j] as HTMLElement).focus?.();
        });
      });
    }
    applyHash(set, e);
  }
  roots.set(root, e);
  if (!subscribed.has(e)) {
    subscribed.add(e);
    e.onHashChange(() => {
      for (const [r, re] of roots) if (re === e) for (const list of Array.from(r.querySelectorAll(TABLIST))) applyHash(tabSetOf(list, e, r), e);
    });
  }
}

/** LD8 step 1: select the tab whose panel holds `el` (through the same
    `select()`), and — unless the address bar already names an element inside
    that panel — write the panel's hash with `replaceState`, as a tab click
    does. Returns whether a bound tab set holds `el`. */
export function selectTabFor(el: Element | null): boolean {
  if (!el) return false;
  const panel = el.closest('[role="tabpanel"]');
  if (!panel) return false;
  for (const [r, e] of roots) {
    for (const list of Array.from(r.querySelectorAll(TABLIST))) {
      const set = tabSetOf(list, e, r);
      const i = set.panels.indexOf(panel);
      if (i < 0) continue;
      if (set.tabs[i]!.getAttribute("aria-selected") !== "true") select(set, i);
      const id = hashId(e.location.hash);
      const named = id === null ? null : e.getElementById(id);
      if (!named || named.closest('[role="tabpanel"]') !== panel) {
        const pid = panel.getAttribute("id");
        if (pid) e.history?.replaceState(null, "", `#${pid}`);
      }
      return true;
    }
  }
  return false;
}
