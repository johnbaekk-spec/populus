/* The midpoint clip for hit areas (DESIGN-POLISH M1, R7 / H-16).

   A note trigger and a sort button reach the `--hit-min` square through a
   layout-neutral `::before` (entities.css, the ledger region's controls
   section). Where two targets sit closer than `--hit-min` — stacked profile
   rows, a band-head note above a table, a chip above a note — their squares
   would overlap and the later one would steal the earlier one's edge. The rule
   is that each square stops at the MIDPOINT of the gap between the two
   controls' boxes, on the axis that separates them.

   CSS cannot know a neighbour's position, so this module measures once the
   layout settles and writes each trigger's allowed extension beyond its own box
   as four custom properties (`--hit-x-l/r/t/b`, in px), which the `::before`
   insets read through `max()`. Without scripting the insets fall back to the
   plain square: the clip is an enhancement, the target never shrinks below its
   own box, and nothing here changes layout.

   Inside a scrolling table a square stays within the table's sides and clear
   of a sticky identity column — SHIFTED there, keeping its full side (M2). A
   shifted square reaches past the centred one on one side, which the insets
   alone cannot draw (they only cut the centred square), so such a trigger
   also gets its own, wider `--hit-min`, read only by its `::before`. */

const PSEUDO = ".note-btn, .th-sort";
const CONTROLS =
  ".note-btn, .th-sort, .seg > button, .chips > button, .mgr-chips > button, .pager-btn, .compact-toggle";

interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}

interface Box extends Rect {
  el: HTMLElement;
  /** The nearest ancestor that scrolls or hides its overflow, if any. */
  sc: HTMLElement | null;
  /** The part of the box its scrollers leave on screen; null when none is. */
  vis: Rect | null;
}

/** The ancestors that clip a control by scrolling (or hiding) their overflow,
    nearest first. `overflow: clip` on an ellipsis cell is not one: it clips
    the control's own text, never moves it. */
function scrollersOf(el: HTMLElement, cache: Map<Element, boolean>): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    let scrolls = cache.get(a);
    if (scrolls === undefined) {
      const cs = getComputedStyle(a);
      scrolls = /auto|scroll|hidden/.test(`${cs.overflowX} ${cs.overflowY}`);
      cache.set(a, scrolls);
    }
    if (scrolls) out.push(a);
  }
  return out;
}

/** The rectangle a scroller shows (its padding box), in document coordinates. */
function viewportOf(a: HTMLElement, sx: number, sy: number): Rect {
  const r = a.getBoundingClientRect();
  const l = r.left + a.clientLeft + sx;
  const t = r.top + a.clientTop + sy;
  return { l, r: l + a.clientWidth, t, b: t + a.clientHeight };
}

/** The hit square's side, read from the `--hit-min` token on the root.

    It is READ, never probed: an earlier version measured a probe box appended
    to `<body>` on every run, and the body's MutationObserver saw that append,
    scheduled another run, and so re-measured the page on every animation frame
    forever (review R-1). Reading a computed custom property touches no DOM. */
function hitMin(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hit-min"));
  return Number.isFinite(v) && v > 0 ? v : 24;
}

/** The square a control's hit area occupies, in document coordinates. */
function square(x: Rect, min: number): Rect {
  const cx = (x.l + x.r) / 2;
  const cy = (x.t + x.b) / 2;
  const w = Math.max(x.r - x.l, min);
  const h = Math.max(x.b - x.t, min);
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
}

function squareOverlaps(x: Rect, y: Rect): boolean {
  return x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b;
}

/** The sticky identity cell in `el`'s row that `el` itself is not in, if any
    (the `.c-pos` issuer column of `[data-sticky-issuer]` tables, the first
    column of `[data-sticky-first]` ones — read from the computed position, so
    whichever rule makes a cell sticky, this sees it). */
function stickyCellBeside(el: HTMLElement, cache: Map<Element, HTMLElement | null>): HTMLElement | null {
  const own = el.closest("td, th");
  const tr = own?.parentElement;
  if (!own || !tr || tr.tagName !== "TR") return null;
  let sticky = cache.get(tr);
  if (sticky === undefined) {
    sticky = null;
    for (const c of Array.from(tr.children)) {
      if (getComputedStyle(c).position === "sticky") {
        sticky = c as HTMLElement;
        break;
      }
    }
    cache.set(tr, sticky);
  }
  return sticky && sticky !== own ? sticky : null;
}

/** The horizontal room a control's square may use inside its scrolling table:
    the table's own sides, and — beside a sticky identity column — that
    column's right edge AS IT SITS NOW, because a square that slides under the
    sticky column is covered by it (a table scrolled sideways moves every other
    column under it; this re-runs on every inner scroll). Document coordinates. */
function tableRoom(el: HTMLElement, table: Element, sx: number, cache: Map<Element, HTMLElement | null>): { l: number; r: number } {
  const tb = table.getBoundingClientRect();
  let l = tb.left + sx;
  const sticky = stickyCellBeside(el, cache);
  if (sticky) {
    const s = sticky.getBoundingClientRect();
    // the identity column sits left of the data it identifies
    if (s.left < el.getBoundingClientRect().left) l = Math.max(l, s.right + sx);
  }
  return { l, r: tb.right + sx };
}

/** Fit a square into [room.l, room.r] by SHIFTING it, never by shortening it
    (DESIGN-POLISH M2, follow-up to the M1 delta review: clamping each side on
    its own cut the holders page's last-column square to 22.3px of a 24px
    minimum). Only a room narrower than the square shortens it, to the room. */
function shiftInto(sq: { l: number; r: number }, room: { l: number; r: number }): void {
  if (sq.r > room.r) {
    const d = sq.r - room.r;
    sq.l -= d;
    sq.r -= d;
  }
  if (sq.l < room.l) {
    const d = room.l - sq.l;
    sq.l += d;
    sq.r += d;
  }
  if (sq.r > room.r) sq.r = room.r; // a room narrower than the square
}

/** A table with a sticky identity column scrolls a focused (or scrolled-to)
    control clear of that column: its scroll padding is the column's width.
    This only READS; `applyScrollPadding` writes, after every read of the run
    (review R-5: interleaving the two forced a layout per table). */
interface ScrollPad {
  box: HTMLElement;
  left: string;
  right: string;
  top: string;
}
function planScrollPadding(min: number): ScrollPad[] {
  const plan: ScrollPad[] = [];
  for (const box of Array.from(document.querySelectorAll<HTMLElement>(".table-scroll"))) {
    /* the sticky identity column is keyed to its ROLE, `.c-pos` (T2.1 re-key):
       the positional `:nth-child(3)` it replaced named a data column once the
       Kind column left the reference table, so the padding stopped matching
       the sticky column and a scrolled-to control landed under it */
    const first = box.querySelector<HTMLElement>(
      ".etable[data-sticky-first] > tbody > tr > :first-child, .etable[data-sticky-first] > thead > tr > :first-child, " +
        ".etable[data-sticky-issuer] > thead > tr > .c-pos",
    );
    const w = first ? first.getBoundingClientRect().width : 0;
    // a box whose head row sticks keeps scrolled-to rows clear of it
    const head = box.querySelector<HTMLElement>(":scope > .etable > thead");
    const sticky = !!head && getComputedStyle(head).position === "sticky";
    plan.push({
      box,
      left: w > 0 ? `${Math.ceil(w)}px` : "",
      right: `${Math.ceil(min / 2)}px`,
      top: sticky ? `${Math.ceil(head!.getBoundingClientRect().height)}px` : "",
    });
  }
  return plan;
}
/** A value that did not change is not rewritten. */
function applyScrollPadding(plan: readonly ScrollPad[]): void {
  for (const { box, left, right, top } of plan) {
    const st = box.style;
    if (st.scrollPaddingLeft !== left) st.scrollPaddingLeft = left;
    if (st.scrollPaddingRight !== right) st.scrollPaddingRight = right;
    if (st.scrollPaddingTop !== top) st.scrollPaddingTop = top;
  }
}

export function clipHitAreas(): void {
  /* ---- read: every measurement of the run, before any write ---- */
  const min = hitMin();
  const pads = planScrollPadding(min);
  const sx = window.scrollX;
  const sy = window.scrollY;
  const boxes: Box[] = [];
  const cache = new Map<Element, boolean>();
  const views = new Map<HTMLElement, Rect>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONTROLS))) {
    const r = el.getBoundingClientRect();
    // not a target: unrendered, visually hidden (1px clip), invisible, or inside
    // a closed disclosure (laid out, never painted)
    if (r.width < 2 || r.height < 2) continue;
    if (typeof el.checkVisibility === "function" ? !el.checkVisibility({ visibilityProperty: true }) : getComputedStyle(el).visibility === "hidden") continue;
    const box: Box = { el, l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy, sc: null, vis: null };
    /* A row scrolled out of its box still has a box — under whatever sits
       beside the scroller. It is no target there, so it clips nothing
       outside its own scroller until it scrolls back into view. */
    let v: Rect | null = { l: box.l, r: box.r, t: box.t, b: box.b };
    const scs = scrollersOf(el, cache);
    box.sc = scs[0] ?? null;
    for (const a of scs) {
      let w = views.get(a);
      if (!w) views.set(a, (w = viewportOf(a, sx, sy)));
      v = { l: Math.max(v.l, w.l), r: Math.min(v.r, w.r), t: Math.max(v.t, w.t), b: Math.min(v.b, w.b) };
      if (v.r - v.l < 1 || v.b - v.t < 1) {
        v = null;
        break;
      }
    }
    box.vis = v;
    boxes.push(box);
  }
  const stickyCache = new Map<Element, HTMLElement | null>();
  const squares = boxes.map((x) => {
    const sq = square(x, min);
    // a header control's square ends at its header row (CSS clamps the same)
    const tr = x.el.closest("thead") ? x.el.closest("tr") : null;
    if (tr) sq.b = Math.min(sq.b, tr.getBoundingClientRect().bottom + sy);
    /* a control in a scrolling table never reaches past the table's own
       sides: out there its scroller shows nothing of it, and the overhang only
       made the table scroll sideways by a pixel or two (the holders page's
       last-column trigger, measured 2px at 1440 — M1 review Q-1). Nor under a
       sticky identity column, which covers it. The square is SHIFTED inside
       that room, keeping its full side (M2): clamping each side on its own
       shortened the holders page's last-column square to 22.3px. */
    const table = x.sc ? x.el.closest("table") : null;
    if (table) shiftInto(sq, tableRoom(x.el, table, sx, stickyCache));
    return sq;
  });

  /* ---- compute: a two-sided sweep over the squares sorted by top ----
     A neighbour's square can only overlap vertically if its top lies within
     (this top − the tallest square, this bottom); both directions stop at
     that window instead of scanning every earlier control (review R-5). */
  const order = squares.map((_q, i) => i).sort((x, y) => squares[x]!.t - squares[y]!.t);
  const tallest = squares.reduce((m, q) => Math.max(m, q.b - q.t), 0);
  const writes: { el: HTMLElement; ext: Rect; ownMin: string }[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const a = boxes[i]!;
    if (!a.el.matches(PSEUDO)) continue;
    const sa = squares[i]!;
    // the extension allowed beyond the box on each side; the square's own first
    const ext: Rect = { l: a.l - sa.l, r: sa.r - a.r, t: a.t - sa.t, b: sa.b - a.b };
    /* A square SHIFTED inside its table reaches further on one side than the
       centred square the CSS draws (whose side is --hit-min). The CSS clips
       the centred square by --hit-x-*, never grows it, so a shifted control
       gets its own, wider --hit-min: w + 2 × its longer reach. The --hit-x-*
       written below then cut that square back to the shifted one exactly
       (the far side and the vertical keep their own reach). "" = the root's. */
    const w = a.r - a.l;
    const reach = Math.max(ext.l, ext.r);
    const ownMin = reach > Math.max(0, (min - w) / 2) + 0.01 ? `${(w + 2 * reach).toFixed(2)}px` : "";
    const visit = (j: number): void => {
      const sb = squares[j]!;
      if (!squareOverlaps(sa, sb)) return;
      const n = boxes[j]!;
      if (n.el.contains(a.el) || a.el.contains(n.el)) return;
      /* Two controls in one scroller keep their spacing whatever the scroll;
         across scrollers only what is on screen counts, and it is measured by
         the part on screen. */
      let own: Rect = a;
      let nb: Rect = n;
      if (n.sc !== a.sc) {
        if (!a.vis || !n.vis) return;
        own = a.vis;
        nb = n.vis;
        if (!squareOverlaps(square(own, min), square(nb, min))) return;
      }
      const gx = Math.max(nb.l - own.r, own.l - nb.r);
      const gy = Math.max(nb.t - own.b, own.t - nb.b);
      if (gx < 0 && gy < 0) return; // the boxes themselves overlap: nothing to split
      /* the split is the midpoint of the gap, expressed as an extension
         beyond the control's own (whole) box */
      if (gx >= gy) {
        if (nb.l >= own.r) ext.r = Math.min(ext.r, (own.r + nb.l) / 2 - a.r);
        else ext.l = Math.min(ext.l, a.l - (nb.r + own.l) / 2);
      } else if (nb.t >= own.b) ext.b = Math.min(ext.b, (own.b + nb.t) / 2 - a.b);
      else ext.t = Math.min(ext.t, a.t - (nb.b + own.t) / 2);
    };
    for (let f = k + 1; f < order.length && squares[order[f]!]!.t < sa.b; f++) visit(order[f]!);
    for (let r = k - 1; r >= 0 && squares[order[r]!]!.t > sa.t - tallest; r--) visit(order[r]!);
    writes.push({ el: a.el, ext, ownMin });
  }

  /* ---- write: only what changed ---- */
  applyScrollPadding(pads);
  for (const { el, ext, ownMin } of writes) {
    const s = el.style;
    if (s.getPropertyValue("--hit-min") !== ownMin) {
      if (ownMin) s.setProperty("--hit-min", ownMin);
      else s.removeProperty("--hit-min");
    }
    for (const [side, v] of [["l", ext.l], ["r", ext.r], ["t", ext.t], ["b", ext.b]] as const) {
      const value = `${Math.max(0, v).toFixed(2)}px`;
      // an unchanged value is not rewritten: this runs on every inner scroll
      if (s.getPropertyValue(`--hit-x-${side}`) !== value) s.setProperty(`--hit-x-${side}`, value);
    }
  }
}

let scheduled = false;
let observer: MutationObserver | null = null;
/** One clip per frame at most. The records a run's own writes queued (none
    today: the properties it writes live in `style`, which is not observed)
    are dropped after it, so a run can never schedule the next one (R-1). */
function run(): void {
  clipHitAreas();
  observer?.takeRecords();
}
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    run();
  });
}

let bound = false;
/** Clip now, once fonts settle, and again after any resize or re-render. */
export function initHitAreas(): void {
  if (bound || typeof document === "undefined") return;
  bound = true;
  void document.fonts?.ready.then(schedule);
  window.addEventListener("resize", schedule);
  /* an inner scroller moving changes which of its rows are on screen beside
     the controls outside it; the page's own scroll changes nothing */
  document.addEventListener(
    "scroll",
    (e) => {
      if (e.target !== document) schedule();
    },
    { capture: true, passive: true },
  );
  window.addEventListener("load", schedule);
  document.addEventListener("populus:rerender", schedule);
  /* Rows are revealed and collapsed by attribute (`hidden`, `open`,
     `data-collapsed`) as often as they are re-rendered, and either moves every
     control below them. The custom properties this writes live in `style`,
     which is deliberately not observed. */
  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "class", "data-collapsed", "aria-expanded"],
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(schedule).observe(document.body);
  run();
}
