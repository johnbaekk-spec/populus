/* R-8 / R10 (signals-v4 LD8; global since the launch integration): every
   sideways scroller a renderer names with `data-scroll-region` — the Signals
   tabs, chip and tool rows, the lead-card strips on /signals/ and the home,
   the home's "Try" strip, the playbook list — becomes a focusable, named
   region exactly while its content overflows it, and a plain box otherwise.
   It ran only on /signals/ until the launch redesign put scroll regions on
   the home; `Base.astro` now runs it on every page. Imported from the
   layout's script alone, so it rides that script's chunk (no new dist
   file). */

/** The narrow surface `syncScrollRegion` touches, declared structurally so
    it runs under `node --test` as well as on a real element. */
export interface ScrollRegionNode {
  scrollWidth: number;
  clientWidth: number;
  dataset: Record<string, string | undefined>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** A wrapper is a focusable, named "scroll sideways" region exactly while
    its content overflows it, and a plain box otherwise (review R-8). The
    name is the one the server rendered in `data-scroll-region`.

    signals-v4 LD8: `data-scroll-region` goes only on a ROLE-LESS wrapper. An
    element that carries a role or an accessible name of its own in the
    server HTML (a tablist, a group) is never re-roled: the first sync finds
    it, logs a console error and leaves it untouched — the roles this
    function writes are recorded (`data-scroll-region-owned`), so a later
    sync can tell them from the server's. */
export function syncScrollRegion(el: ScrollRegionNode): boolean {
  if (el.getAttribute("data-scroll-region-owned") !== "1") {
    if (el.getAttribute("role") !== null || el.getAttribute("aria-label") !== null) {
      console.error("populus: [data-scroll-region] on an element with its own role or name; it is not re-roled", el);
      return false;
    }
    el.setAttribute("data-scroll-region-owned", "1");
  }
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

const bound = new WeakSet<object>();

/** Sync every named scroller on the page now and whenever its box or its
    content's changes size. Idempotent: an element is observed once. */
export function initScrollRegions(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-region]"))) {
    if (bound.has(el)) continue;
    bound.add(el);
    const sync = (): void => void syncScrollRegion(el);
    sync();
    // the wrapper's width moves with the viewport, its content's (the hits
    // table, the tablist, a chip row) with what it holds
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      const content = el.querySelector("table") ?? el.firstElementChild;
      if (content) ro.observe(content);
    } else if (typeof window !== "undefined") window.addEventListener("resize", sync);
  }
}
