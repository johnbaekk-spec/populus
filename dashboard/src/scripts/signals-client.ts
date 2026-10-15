/* /signals client island. A device-local enhancement over a page that is
   complete without it: the slim hits table's filters — the FAMILY, from the
   "Hit rate by family" rows, and listed stocks only (on by default, never
   persisted) — and "Show 10 more". The first change fetches the artifact once
   and repaints through the server's own view and row renderer, so a repaint
   is the server's markup (signals-v3 M2, R13). Nothing is stored and nothing
   leaves the device. */

import { parseDataColumns, type RenderCtx } from "../lib/format.ts";
import { hitsBodyHtml, hitsRangeText, sortHits, SIGNAL_HITS_PAGE_SIZE, hitsView, hitsHiddenText, type HitFilter } from "../lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../lib/signals.ts";

/** An empty row spans the table's own header — the column list the server
    rendered — never a literal count (DESIGN-POLISH M1, section E). */
function columnCount(body: HTMLElement | null, fallback: number): number {
  const n = body?.closest("table")?.querySelectorAll("thead th").length ?? 0;
  return n > 0 ? n : fallback;
}

/* R13: the server rendered the first lines; the first filter or "Show more"
   fetches `signals.v1.json` once (it is complete for the window) and every
   later view renders from it through the SAME row renderer the server used. */
const ARTIFACT_HREF = "/signals/data/signals.v1.json";

/** The view a filter state shows: the server's `hitsView`, its first `shown`
    lines, the body markup and the range string. Exported so the parity test
    runs the client's own composition against the server's. */
export function hitsRepaint(hits: readonly Signal[], filter: HitFilter, shown: number, ctx: RenderCtx, columns: readonly string[] | null): { body: string; range: string; hidden: number; lines: number; shown: number } {
  const view = hitsView(hits, filter);
  const slice = view.lines.slice(0, shown);
  return {
    body: slice.length === 0 ? "" : hitsBodyHtml(slice, ctx, columns),
    range: hitsRangeText(0, slice.length, view.lines.length, view.hits, SIGNAL_HITS_PAGE_SIZE),
    hidden: view.hidden,
    lines: view.lines.length,
    shown: slice.length,
  };
}

function initHitPager(): void {
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
  if (!section || !body || !rangeEl) return;
  const step = Number(section.dataset.step) || SIGNAL_HITS_PAGE_SIZE;
  const ctx: RenderCtx = {};
  let shown = Number(section.dataset.shown) || step;
  let family = "all";
  /* R12: every load starts at the default — listed stocks only — whatever a
     browser restored into the box (plan L8: not persisted). */
  let stocksOnly = true;
  if (stocksChk) stocksChk.checked = true;
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

  async function paint(): Promise<void> {
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
    const v = hitsRepaint(hits, filter(), shown, ctx, parseDataColumns(body!.closest("table")?.getAttribute("data-columns")));
    body!.innerHTML =
      v.shown === 0
        ? `<tr><td colspan="${columnCount(body, 6)}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
        : v.body;
    section!.dataset.shown = String(v.shown);
    document.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "hits" } }));
    rangeEl!.textContent = v.range;
    const hiddenText = hitsHiddenText(v.hidden, stocksOnly);
    if (hiddenEl) {
      hiddenEl.textContent = hiddenText;
      hiddenEl.setAttribute("data-hidden", String(v.hidden));
    }
    if (status) status.textContent = `${v.range}${family === "all" ? "" : ` · family ${family.toLowerCase()}`} · ${stocksOnly ? "listed stocks only" : "all asset types"} · ${hiddenText}.`;
    setMore(v.shown >= v.lines);
  }

  families?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-family]");
    if (!btn) return;
    // a pressed family toggles off; another one replaces it
    setFamily(btn.dataset.family === family ? "all" : (btn.dataset.family ?? "all"));
    shown = step;
    void paint();
  });
  pill?.addEventListener("click", () => {
    setFamily("all");
    shown = step;
    void paint();
  });
  stocksChk?.addEventListener("change", () => {
    stocksOnly = stocksChk.checked;
    shown = step;
    void paint();
  });
  more?.addEventListener("click", () => {
    if (more.getAttribute("aria-disabled") === "true") return;
    shown += step;
    void paint();
  });
}

/** The narrow surface `syncScrollRegion` touches, declared structurally so
    it runs under `node --test` as well as on a real element. */
export interface ScrollRegionNode {
  scrollWidth: number;
  clientWidth: number;
  dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** A table wrapper is a focusable, named "scroll sideways" region exactly
    while its table overflows it, and a plain box otherwise (review R-8). The
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

export function initSignalsPage(): void {
  initHitPager();
  initScrollRegions();
}
