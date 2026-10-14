/* /signals client island. A device-local enhancement over a page that is
   complete without it: the HITS pager and filters — rule and listed stocks
   only (SIGNALS-CLARITY M2, on by default, never persisted). The first change
   fetches the artifact once and repaints through the server's own view.
   Nothing is stored and nothing leaves the device. */

import { parseDataColumns, type RenderCtx } from "../lib/format.ts";
import { hitsBodyHtml, hitsRangeText, sortHits, SIGNAL_HITS_PAGE_SIZE, hitsView, hitsHiddenText, type HitFilter } from "../lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../lib/signals.ts";

/** An empty row spans the table's own header — the column list the server
    rendered — never a literal count (DESIGN-POLISH M1, section E). */
function columnCount(body: HTMLElement | null, fallback: number): number {
  const n = body?.closest("table")?.querySelectorAll("thead th").length ?? 0;
  return n > 0 ? n : fallback;
}

/* R17: a REAL pager over the complete artifact. The server rendered page 1;
   the first page change or filter fetches `signals.v1.json` once (it is
   complete for the window) and every later view renders from it through the
   SAME row renderer the server used. */
const ARTIFACT_HREF = "/signals/data/signals.v1.json";

function initHitPager(): void {
  const section = document.getElementById("signal-hits");
  const seg = document.querySelector<HTMLElement>(".si-hit-filter");
  const body = document.getElementById("signal-hits-body");
  const rangeEl = document.getElementById("signal-hits-range");
  const prev = document.getElementById("signal-hits-prev") as HTMLButtonElement | null;
  const next = document.getElementById("signal-hits-next") as HTMLButtonElement | null;
  const stocksChk = document.getElementById("signal-stocks-only") as HTMLInputElement | null;
  const hiddenEl = document.getElementById("signal-hidden-count");
  const status = document.getElementById("signal-hits-status");
  if (!section || !seg || !body || !rangeEl) return;
  const pageSize = Number(section.dataset.pageSize) || SIGNAL_HITS_PAGE_SIZE;
  /* The page's FIXED compact N (DESIGN-POLISH M2, CD-1: 12 of the 50): every
     repaint compacts through the same body renderer, restates the bound on the
     page's disclosure and announces the re-render to the named binder. */
  const compactN = Number(section.dataset.compactRows) || pageSize;
  const disclosure = section.querySelector<HTMLElement>('.compact-disclosure[data-compact-for="signal-hits-body"]');
  const ctx: RenderCtx = {};
  let page = 0;
  let kind = "all";
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

  /* The ONE filter the server page used for its first page (`hitsView` over
     `hitMatches`): rule × listed stocks. */
  function filter(): HitFilter {
    return { kind, stocksOnly };
  }

  function setPager(btn: HTMLButtonElement | null, unavailable: boolean): void {
    if (!btn) return;
    btn.setAttribute("aria-disabled", String(unavailable));
    btn.classList.toggle("is-unavailable", unavailable);
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
    const view = hitsView(hits, filter());
    const pageCount = Math.max(1, Math.ceil(view.lines.length / pageSize));
    if (page > pageCount - 1) page = pageCount - 1;
    const slice = view.lines.slice(page * pageSize, (page + 1) * pageSize);
    body!.innerHTML =
      slice.length === 0
        ? `<tr><td colspan="${columnCount(body, 7)}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
        : hitsBodyHtml(slice, ctx, compactN, parseDataColumns(body!.closest("table")?.getAttribute("data-columns")));
    body!.setAttribute("data-collapsed", String(slice.length > compactN));
    if (disclosure) {
      disclosure.setAttribute("data-compact-total", String(slice.length));
      disclosure.setAttribute("data-compact-shown", String(Math.min(compactN, slice.length)));
    }
    document.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "signal-hits" } }));
    const range = hitsRangeText(page, slice.length, view.lines.length, view.hits, pageSize);
    rangeEl!.textContent = range;
    const hiddenText = hitsHiddenText(view.hidden, stocksOnly);
    if (hiddenEl) {
      hiddenEl.textContent = hiddenText;
      hiddenEl.setAttribute("data-hidden", String(view.hidden));
    }
    if (status) status.textContent = `${range}${kind === "all" ? "" : ` · rule ${kind}`} · ${stocksOnly ? "listed stocks only" : "all asset types"} · ${hiddenText}.`;
    setPager(prev, page === 0);
    setPager(next, page >= pageCount - 1);
  }

  seg.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-kind]");
    if (!btn) return;
    kind = btn.dataset.kind ?? "all";
    for (const b of seg.querySelectorAll<HTMLButtonElement>("button[data-kind]")) b.setAttribute("aria-pressed", String(b === btn));
    page = 0;
    void paint();
  });
  stocksChk?.addEventListener("change", () => {
    stocksOnly = stocksChk.checked;
    page = 0;
    void paint();
  });
  prev?.addEventListener("click", () => {
    if (prev.getAttribute("aria-disabled") === "true" || page === 0) return;
    page--;
    void paint();
  });
  next?.addEventListener("click", () => {
    if (next.getAttribute("aria-disabled") === "true") return;
    page++;
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
