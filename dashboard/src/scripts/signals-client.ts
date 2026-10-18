/* /signals client island. A device-local enhancement over a page that is
   complete without it:

   - the slim hits table's filters — the FAMILY, from the "Hit rate by family"
     rows, and listed stocks only (on by default, never persisted) — and
     "Show 10 more". The first filter fetches the artifact once and repaints
     through the server's own view and row renderer, so a repaint is the
     server's markup (signals-v3 M2, R13);
   - signals-v4 R6 (LD6): the column fit — the hits fill to the height of
     "Filings to read" (`column-fit.ts`), revealing the rows the server holds
     `hidden`, and past them the memoised artifact;
   - signals-v4 R7 (LD7): the pane switch where the band stacks;
   - signals-v4 R4 (LD5): a lead card, or a hash naming a row, opens the row.

   Nothing is stored and nothing leaves the device. */

import { fmtInt, parseDataColumns, type RenderCtx } from "../lib/format.ts";
import { hitsBodyHtml, hitsRangeText, sortHits, SIGNAL_HITS_PAGE_SIZE, SIGNAL_HITS_COMPACT_ROWS, hitsView, hitsHiddenText, type HitFilter } from "../lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../lib/signals.ts";
import { bindFit, type FitBinding, type FitElement, type FitTarget } from "./column-fit.ts";

/** An empty row spans the table's own header — the column list the server
    rendered — never a literal count (DESIGN-POLISH M1, section E). */
function columnCount(body: HTMLElement | null, fallback: number): number {
  const n = body?.closest("table")?.querySelectorAll("thead th").length ?? 0;
  return n > 0 ? n : fallback;
}

/* R13: the server rendered the first lines; the first filter, or a fit or
   "Show more" past the rows the server holds, fetches `signals.v1.json` once
   (it is complete for the window) and every later view renders from it
   through the SAME row renderer the server used. */
const ARTIFACT_HREF = "/signals/data/signals.v1.json";

/** The rows a body holds for `shown` visible lines: the server's
    `SIGNAL_HITS_DOM_ROWS` (`domRows`), or the next multiple of it — so a fit
    that corrects by a row or two past a repaint needs no second repaint. */
export function hitsHeld(shown: number, lines: number, domRows: number): number {
  return Math.min(lines, Math.max(domRows, Math.ceil(shown / domRows) * domRows));
}

/** The view a filter state shows: the server's `hitsView`, the lines the body
    holds (the first `shown` visible, the rest `hidden`), the body markup and
    the range string. Exported so the parity test runs the client's own
    composition against the server's. */
export function hitsRepaint(
  hits: readonly Signal[],
  filter: HitFilter,
  shown: number,
  ctx: RenderCtx,
  columns: readonly string[] | null,
  domRows = 40,
): { body: string; range: string; hidden: number; lines: number; shown: number; held: number; hits: number } {
  const view = hitsView(hits, filter);
  const held = view.lines.slice(0, hitsHeld(shown, view.lines.length, domRows));
  const visible = Math.min(shown, held.length);
  return {
    body: held.length === 0 ? "" : hitsBodyHtml(held, ctx, columns, visible),
    range: hitsRangeText(0, visible, view.lines.length, view.hits, SIGNAL_HITS_PAGE_SIZE),
    hidden: view.hidden,
    lines: view.lines.length,
    shown: visible,
    held: held.length,
    hits: view.hits,
  };
}

/** The hits pager the fit drives: `setBase` is LD6's `apply`. */
export interface HitPager {
  /** set the fitted base: visible = min(lines, base + extra) */
  setBase(n: number): void | Promise<void>;
  /** the column fit's view of the list */
  fitTarget: FitTarget;
  /** called after a filter change repaints (the fit re-runs) */
  onFilter: (() => void) | null;
}

export function initHitPager(): HitPager | null {
  const section = document.getElementById("hits");
  const families = document.getElementById("families");
  const body = document.getElementById("signal-hits-body");
  const rangeEl = document.getElementById("signal-hits-range");
  const more = document.getElementById("signal-hits-more") as HTMLButtonElement | null;
  const stocksChk = document.getElementById("signal-stocks-only") as HTMLInputElement | null;
  const hiddenEl = document.getElementById("signal-hidden-count");
  const status = document.getElementById("signal-hits-status");
  const pillRow = document.getElementById("signal-family-pill-row");
  const pill = document.getElementById("signal-family-pill") as HTMLButtonElement | null;
  const pillName = document.getElementById("signal-family-pill-name");
  const paneN = document.getElementById("signal-pane-hits-n");
  if (!section || !body || !rangeEl) return null;
  const step = Number(section.dataset.step) || SIGNAL_HITS_PAGE_SIZE;
  const domRows = Number(section.dataset.domRows) || 40;
  const ctx: RenderCtx = {};
  /* LD6's contract: visible = min(lines, base + extra) */
  let base = Number(section.dataset.shown) || step;
  let extra = 0;
  let family = "all";
  /* R12: every load starts at the default — listed stocks only — whatever a
     browser restored into the box (plan L8: not persisted). */
  let stocksOnly = true;
  if (stocksChk) stocksChk.checked = true;
  /* the view the body holds rows for: the server's default view until the
     first repaint */
  let lines = Number(section.dataset.lines) || 0;
  let hitsN = Number(section.dataset.hits) || 0;
  let heldKey = "all|true";
  let all: Promise<Signal[]> | null = null;
  let token = 0;

  function loadAll(): Promise<Signal[]> {
    all ??= fetch(ARTIFACT_HREF)
      .then((r) => {
        if (!r.ok) throw new Error(`signals artifact ${r.status}`);
        return r.json() as Promise<SignalArtifact>;
      })
      .then((a) => sortHits((a.signals ?? []).filter((s) => s.status === "active")))
      .catch((err) => {
        all = null;
        throw err;
      });
    return all;
  }

  /* The ONE filter the server page used for its first lines (`hitsView` over
     `hitMatches`): family × listed stocks. */
  function filter(): HitFilter {
    return { family, stocksOnly };
  }
  const key = (): string => `${family}|${stocksOnly}`;
  const rows = (): HTMLElement[] => Array.from(body!.querySelectorAll<HTMLElement>("tr.si-hit"));
  const visibleNow = (): number => rows().filter((r) => !r.hidden).length;

  function setMore(unavailable: boolean): void {
    if (!more) return;
    more.setAttribute("aria-disabled", String(unavailable));
    more.classList.toggle("is-unavailable", unavailable);
  }

  function setFamily(next: string): void {
    family = next;
    for (const b of families?.querySelectorAll<HTMLButtonElement>("button[data-family]") ?? []) {
      b.setAttribute("aria-pressed", String(b.dataset.family === family));
    }
    if (pillRow) pillRow.hidden = family === "all";
    if (pillName) {
      const label = families?.querySelector<HTMLElement>(`button[data-family="${family}"] .si-family-name`)?.textContent ?? family;
      pillName.textContent = label;
    }
  }

  function announce(range: string, hiddenText: string): void {
    if (status) status.textContent = `${range}${family === "all" ? "" : ` · family ${family.toLowerCase()}`} · ${stocksOnly ? "listed stocks only" : "all asset types"} · ${hiddenText}.`;
  }

  /** Show the first `want` held rows, hide the rest — no fetch, no repaint. */
  function reveal(want: number): void {
    const rs = rows();
    rs.forEach((r, i) => {
      r.hidden = i >= want;
    });
    const shown = Math.min(want, rs.length);
    section!.setAttribute("data-shown", String(shown));
    rangeEl!.textContent = hitsRangeText(0, shown, lines, hitsN, step);
    setMore(shown >= lines);
  }

  async function paint(say: boolean): Promise<void> {
    const mine = ++token;
    let hits: Signal[];
    try {
      hits = await loadAll();
    } catch (err) {
      if (mine !== token) return;
      console.error("populus: signals artifact failed", err);
      if (status) status.textContent = "Couldn't load the signals artifact; the hits shown are unchanged.";
      return;
    }
    if (mine !== token) return;
    const v = hitsRepaint(hits, filter(), base + extra, ctx, parseDataColumns(body!.closest("table")?.getAttribute("data-columns")), domRows);
    body!.innerHTML =
      v.held === 0
        ? `<tr><td colspan="${columnCount(body, 6)}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
        : v.body;
    lines = v.lines;
    hitsN = v.hits;
    heldKey = key();
    section!.setAttribute("data-shown", String(v.shown));
    section!.setAttribute("data-lines", String(v.lines));
    section!.setAttribute("data-hits", String(v.hits));
    document.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "hits" } }));
    rangeEl!.textContent = v.range;
    const hiddenText = hitsHiddenText(v.hidden, stocksOnly);
    if (hiddenEl) {
      hiddenEl.textContent = hiddenText;
      hiddenEl.setAttribute("data-hidden", String(v.hidden));
    }
    if (paneN) paneN.textContent = fmtInt(v.hits);
    if (say) announce(v.range, hiddenText);
    setMore(v.shown >= v.lines);
  }

  /** Render the current state: reveal held rows when the body holds enough
      of the current view, else repaint from the artifact. */
  function render(say: boolean): void | Promise<void> {
    const want = Math.min(lines, base + extra);
    if (heldKey === key() && want <= rows().length) {
      reveal(want);
      if (say) announce(rangeEl!.textContent ?? "", hiddenEl?.textContent ?? "");
      return;
    }
    return paint(say);
  }

  const pager: HitPager = {
    setBase(n: number) {
      base = n;
      return render(false);
    },
    fitTarget: {
      list: () => body!.closest("table") as unknown as FitElement | null,
      rows: () => rows() as unknown as FitElement[],
      matching: () => lines,
      visible: visibleNow,
      extra: () => extra,
      apply: (n: number) => pager.setBase(n),
    },
    onFilter: null,
  };

  /** A filter change drops the "Show more" extension (LD6), repaints, and
      lets the fit re-run for the new view. */
  async function refilter(): Promise<void> {
    extra = 0;
    await paint(true);
    pager.onFilter?.();
  }

  families?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-family]");
    if (!btn) return;
    // a pressed family toggles off; another one replaces it
    setFamily(btn.dataset.family === family ? "all" : (btn.dataset.family ?? "all"));
    void refilter();
  });
  pill?.addEventListener("click", () => {
    setFamily("all");
    void refilter();
  });
  stocksChk?.addEventListener("change", () => {
    stocksOnly = stocksChk.checked;
    void refilter();
  });
  more?.addEventListener("click", () => {
    if (more.getAttribute("aria-disabled") === "true") return;
    /* LD6: "Show more" extends PAST the fitted base, deliberately */
    extra += step;
    void render(true);
  });
  return pager;
}

/* ---------------------------------------------------------------- LD7: the pane switch */

/** Where a two-column band stacks. */
export const STACKED_QUERY = "(max-width: 1080px)";

interface BoundSwitch {
  panes: (HTMLElement | null)[];
  select(i: number): void;
}
const switches: BoundSwitch[] = [];

/** LD7: the server renders each `[data-pane-switch]` `hidden` and every pane
    visible. While `(max-width: 1080px)` matches, the switch shows and the
    unselected panes carry `hidden`; when it stops matching, the switch hides
    and every pane shows again. Only the `hidden` attribute moves — no media
    rule hides a pane. */
export function initPaneSwitches(): void {
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(STACKED_QUERY) : null;
  for (const sw of Array.from(document.querySelectorAll<HTMLElement>("[data-pane-switch]"))) {
    if (sw.hasAttribute("data-pane-bound")) continue;
    sw.setAttribute("data-pane-bound", "");
    const buttons = Array.from(sw.querySelectorAll<HTMLButtonElement>("button[aria-controls]"));
    const panes = buttons.map((b) => document.getElementById(b.getAttribute("aria-controls") ?? ""));
    let selected = Math.max(0, buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true"));
    const sync = (): void => {
      const stacked = !!mq?.matches;
      sw.hidden = !stacked;
      panes.forEach((p, i) => {
        if (p) p.hidden = stacked && i !== selected;
      });
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === selected)));
    };
    const bound: BoundSwitch = {
      panes,
      select(i: number): void {
        selected = i;
        sync();
      },
    };
    buttons.forEach((b, i) => b.addEventListener("click", () => bound.select(i)));
    mq?.addEventListener?.("change", sync);
    switches.push(bound);
    sync();
  }
}

/** Select the pane that holds `el`, when a pane switch has hidden it (step 2
    of M2's `revealTarget`). Returns whether it changed anything. */
export function selectPaneFor(el: Element): boolean {
  for (const s of switches) {
    const i = s.panes.findIndex((p) => p !== null && p.id !== "" && el.closest(`#${p.id}`) !== null);
    if (i >= 0 && s.panes[i]!.hidden) {
      s.select(i);
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------- LD5: a card or a hash opens its row */

/** Open a "Filings to read" row from anywhere: the steps M2's `revealTarget`
    generalises — select the pane that holds it, open Routine when it sits in
    the closed tier, open the row's own `<details>` (one open at a time, by
    its `name`), scroll it into view and focus its summary. Returns the row,
    or null when `el` is not in one. */
export function revealRow(el: Element | null): HTMLElement | null {
  const row = el?.closest<HTMLElement>("article.si-row") ?? null;
  if (!row) return null;
  selectPaneFor(row);
  const routine = row.closest<HTMLElement>("details#routine");
  if (routine && !routine.hasAttribute("open")) routine.setAttribute("open", "");
  const details = row.querySelector<HTMLElement>("details.si-row-d");
  if (details && !details.hasAttribute("open")) details.setAttribute("open", "");
  (row as HTMLElement & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }).scrollIntoView?.({ block: "center" });
  const summary = row.querySelector<HTMLElement>("summary.si-row-sum");
  (summary as (HTMLElement & { focus?: (o?: FocusOptions) => void }) | null)?.focus?.({ preventScroll: true });
  return row;
}

/** The id a hash names: decoded, or verbatim when it carries a malformed
    percent-escape (the decode never throws into page init or a
    `hashchange` — the same rule as `tabs.ts`'s `hashId`). */
export function hashTargetId(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The row a hash names, or null. */
function rowFromHash(hash: string): HTMLElement | null {
  const id = hashTargetId(hash);
  if (!id.startsWith("si-row-")) return null;
  return document.getElementById(id);
}

/** A hash on load or a `hashchange`: a row opens (`revealRow`); any other
    element a pane switch has hidden — `#hits`, `#families` on a phone — gets
    its pane selected and is scrolled to (step 2 of M2's `revealTarget`), so
    no deep link lands on a hidden pane. */
export function revealHash(hash: string): Element | null {
  const row = rowFromHash(hash);
  if (row) return revealRow(row);
  const id = hashTargetId(hash);
  const el = id ? document.getElementById(id) : null;
  if (!el || !selectPaneFor(el)) return null;
  (el as HTMLElement & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }).scrollIntoView?.({ block: "start" });
  return el;
}

export function initRowLinks(): void {
  /* a card's stretched link: open the row in place, keeping the hash a real
     history entry (a second click on the same card still opens it) */
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a.si-card-open"))) {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href") ?? "";
      const row = rowFromHash(href);
      if (!row) return;
      (ev as Event | undefined)?.preventDefault?.();
      if (typeof location !== "undefined" && location.hash !== href && typeof history !== "undefined") history.pushState(null, "", href);
      revealRow(row);
    });
  }
  if (typeof window === "undefined") return;
  window.addEventListener("hashchange", () => void revealHash(location.hash));
  if (typeof location !== "undefined" && location.hash) revealHash(location.hash);
}

/* ---------------------------------------------------------------- R-8: scroll regions */

/** The narrow surface `syncScrollRegion` touches, declared structurally so
    it runs under `node --test` as well as on a real element. */
export interface ScrollRegionNode {
  scrollWidth: number;
  clientWidth: number;
  dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** A wrapper is a focusable, named "scroll sideways" region exactly while
    its content overflows it, and a plain box otherwise (review R-8). The
    name is the one the server rendered in `data-scroll-region`. */
export function syncScrollRegion(el: ScrollRegionNode): boolean {
  const name = el.dataset.scrollRegion;
  const scrolls = !!name && el.scrollWidth > el.clientWidth + 1;
  if (scrolls) {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", name!);
  } else {
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
  }
  return scrolls;
}

function initScrollRegions(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-region]"))) {
    const sync = (): void => void syncScrollRegion(el);
    sync();
    // the wrapper's width moves with the viewport, the table's with its rows
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      const table = el.querySelector("table");
      if (table) ro.observe(table);
    } else window.addEventListener("resize", sync);
  }
}

let fit: FitBinding | null = null;

export function initSignalsPage(): void {
  const pager = initHitPager();
  initPaneSwitches();
  initScrollRegions();
  initRowLinks();
  /* LD6 (Congress): the hits fill to the height of "Filings to read" */
  const ref = document.getElementById("triage");
  const col = document.getElementById("signals-side");
  if (pager && ref && col) {
    fit = bindFit(ref as unknown as FitElement, col as unknown as FitElement, pager.fitTarget, { min: SIGNAL_HITS_COMPACT_ROWS, ownRoot: "hits" });
    pager.onFilter = () => void fit?.refit();
  }
}
