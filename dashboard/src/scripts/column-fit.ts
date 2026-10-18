/* The column fit (signals-v4 R6, LD6): a filled list — the hits beside
   "Filings to read" (M1), the Named moves beside Consensus and Conviction
   leaders (M2) — shows as many rows as make its column's CONTENT end within
   one row of the neighbouring column's content.

   ONE endpoint for fitting and for verification: `contentBottom`, the largest
   bottom among an element's visible in-flow children. The fitter and every
   alignment test read it; neither reads a grid cell's box, so a stretched
   cell can neither satisfy nor break the fit.

   `fitCount` is the estimate (rows differ in height: a wrapped name, a
   grouped hit); `bindFit` applies it, then corrects it against the live
   layout, reading `contentBottom` only:
   - while the column ends past the reference (+1px) and n is above the
     minimum: one fewer;
   - then, while a next matching row exists: reveal it; if the column then
     ends past the reference, hide it again and stop.
   Each step changes only the filled list's `hidden` rows (through `apply`),
   the work is bounded by twice the rows available, and the ResizeObserver
   watches only the reference, so a correction cannot retrigger itself.

   The contract: visible = min(matching, base + extra). `base` is the fitted
   count, recomputed on every trigger; `extra` is the "Show more" extension,
   0 at load and after a filter change. The list never shrinks below its
   FLOOR: the larger of its minimum and the target's `floor()` — for the
   Named moves, the place of the last OPEN row in the matching order + 1
   (less the extension), so a refit never hides a row a reader has open
   (codex M2 round 2, F1). Alignment is claimed only when none of the four
   stated exceptions holds:
   1. a "Show more" extension stands (extra > 0);
   2. the list is shorter than the fit asks for (every matching row shows);
   3. the reference is shorter than the minimum list (the column ends past it
      at the minimum);
   4. an open row forces the floor past the fit (a tall opened row, or one
      far down the list): the column ends past the reference with that row
      still visible.
   Re-runs: a ResizeObserver over the REFERENCE only, a `populus:rerender`
   that is not the list's own, and `refit()` — which the page calls after a
   filter change AND after every in-column height change the observer cannot
   see (a Named move or the Congress-lines bank opening or closing, a held
   row's body inserted). */

/** The narrow surface the fit reads, declared structurally so the math and
    the binder run under `node --test` over a fake layout as well as on a
    real element. */
export interface FitBox {
  getBoundingClientRect(): { top: number; bottom: number; left?: number; right?: number; width?: number; height?: number };
}
export interface FitElement extends FitBox {
  readonly children: ArrayLike<FitElement>;
  hidden?: boolean;
  checkVisibility?(): boolean;
}

export interface FitInput {
  /** the reference column's content bottom (`contentBottom(ref)`) */
  refEnd: number;
  /** the filled column's top */
  colTop: number;
  /** the filled column's content bottom (`contentBottom(col)`) */
  colEnd: number;
  /** the list's box height: its visible rows plus its own chrome (head, borders) */
  listHeight: number;
  /** the list's visible rows now */
  rows: number;
  /** the median height of the first 8 visible rows */
  rowHeight: number;
  /** the list never shrinks below this */
  min: number;
}

/** LD6's estimate: the rows that fill what the column has left beside the
    reference, after everything in the column that is not a row — the content
    above the list AND below it (`other`), and the list's own chrome
    (`extra`). Never fewer than `min`. */
export function fitCount(i: FitInput): number {
  if (!(i.rowHeight > 0)) return i.min;
  const other = i.colEnd - i.colTop - i.listHeight;
  const extra = Math.max(0, i.listHeight - i.rows * i.rowHeight);
  return Math.max(i.min, Math.floor((i.refEnd - i.colTop - other - extra) / i.rowHeight));
}

/** Rendered and in flow: not `hidden`, not display:none (checkVisibility),
    not absolutely or fixed positioned (a visually-hidden status line, a
    stretched link) — those do not end a column. */
export function isInFlowVisible(el: FitElement): boolean {
  if (el.hidden) return false;
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  if (typeof getComputedStyle === "function" && typeof Element !== "undefined" && el instanceof Element) {
    const p = getComputedStyle(el).position;
    if (p === "absolute" || p === "fixed") return false;
  }
  return true;
}

/** The content bottom: the largest bottom among `el`'s visible in-flow
    children, or its own top when it shows none. Never `el`'s own box: a
    stretched grid cell ends where the row ends, not where its content does. */
export function contentBottom(el: FitElement): number {
  let max = -Infinity;
  for (const c of Array.from(el.children)) if (isInFlowVisible(c)) max = Math.max(max, c.getBoundingClientRect().bottom);
  return max === -Infinity ? el.getBoundingClientRect().top : max;
}

/** The median height of the first 8 visible rows (0 with none). */
export function medianRowHeight(rows: readonly FitElement[]): number {
  const h = rows
    .filter(isInFlowVisible)
    .slice(0, 8)
    .map((r) => {
      const b = r.getBoundingClientRect();
      return b.bottom - b.top;
    })
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  if (h.length === 0) return 0;
  const mid = Math.floor(h.length / 2);
  return h.length % 2 === 1 ? h[mid]! : (h[mid - 1]! + h[mid]!) / 2;
}

/** What the binder drives: the filled list, through its own pager. */
export interface FitTarget {
  /** the list element: its box holds the rows and the list's own chrome */
  list(): FitElement | null;
  /** the rows the DOM holds, in order, visible or not */
  rows(): FitElement[];
  /** rows matching the active filter */
  matching(): number;
  /** rows visible now */
  visible(): number;
  /** the "Show more" extension now, in rows */
  extra(): number;
  /** set the fitted base: visible becomes min(matching, base + extra).
      Returns a promise only when it must repaint (rows the DOM does not hold). */
  apply(base: number): void | Promise<void>;
  /** the base the fit may never go below beside the minimum — the rows that
      must stay visible (an open row's place + 1, less the extension); absent
      or 0 when nothing pins the list */
  floor?(): number;
}

export interface FitOptions {
  /** the list's floor */
  min: number;
  /** a `populus:rerender` whose `detail.root` is this is the list's own repaint: ignored */
  ownRoot?: string;
  /** observe the reference (default true; tests drive `refit` directly) */
  observe?: boolean;
}

export interface FitBinding {
  /** run the fit now (a filter change, a pane change) */
  refit(): Promise<void>;
  /** stop observing */
  disconnect(): void;
}

/** Both columns side by side: their tops within 2px. Stacked — or where
    nothing is laid out to measure — the list takes its minimum. */
function sideBySide(ref: FitBox, col: FitBox): boolean {
  if (typeof ref.getBoundingClientRect !== "function" || typeof col.getBoundingClientRect !== "function") return false;
  return Math.abs(ref.getBoundingClientRect().top - col.getBoundingClientRect().top) <= 2;
}

/** Bind the fit of `col`'s list (through `target`) to the reference column
    `ref`. Re-runs on a ResizeObserver over `ref` — its size moves with the
    viewport, with a row or Routine opening, and with a Consensus "Show all" —
    and on a `populus:rerender` that is not the list's own; `refit()` runs it
    after a filter change and after a height change inside `col` (a row
    opening or closing), which the observer does not watch. A newer run cancels an older one still waiting on a
    repaint (the token guard the pager's `paint()` uses). */
export function bindFit(ref: FitElement, col: FitElement, target: FitTarget, opts: FitOptions): FitBinding {
  let token = 0;
  /** the reference's content height and width at the last fit: a resize
      notification that changed neither (a stretched cell growing with the
      filled column) runs nothing */
  let memo: { h: number; w: number } | null = null;

  const step = async (n: number, mine: number): Promise<boolean> => {
    const r = target.apply(n);
    if (r) await r;
    return mine === token;
  };

  /** the list's floor now: its minimum, or more where an open row pins it */
  const floor = (): number => Math.max(opts.min, Math.floor(target.floor?.() ?? 0));

  async function fit(): Promise<void> {
    const mine = ++token;
    if (!sideBySide(ref, col)) {
      memo = null;
      await step(floor(), mine);
      return;
    }
    const rb = ref.getBoundingClientRect();
    memo = { h: contentBottom(ref) - rb.top, w: (rb.right ?? 0) - (rb.left ?? 0) };
    const list = target.list();
    const rowHeight = medianRowHeight(target.rows());
    if (!list || rowHeight <= 0) {
      await step(floor(), mine);
      return;
    }
    const lb = list.getBoundingClientRect();
    let n = fitCount({
      refEnd: contentBottom(ref),
      colTop: col.getBoundingClientRect().top,
      colEnd: contentBottom(col),
      listHeight: lb.bottom - lb.top,
      rows: target.rows().filter(isInFlowVisible).length,
      rowHeight,
      min: opts.min,
    });
    /* a list shorter than the fit asks for shows all of it; an open row is
       never hidden (exception 4: no alignment is claimed past it) */
    const lo = floor();
    n = Math.max(lo, Math.min(n, target.matching()));
    if (!(await step(n, mine))) return;
    /* the exact correction holds the alignment claim, so it runs only where
       the claim is made: no "Show more" extension */
    if (target.extra() > 0) return;
    const over = (): boolean => contentBottom(col) > contentBottom(ref) + 1;
    let guard = 2 * Math.max(target.matching(), n) + 4;
    while (n > lo && over() && guard-- > 0) {
      n -= 1;
      if (!(await step(n, mine))) return;
    }
    while (!over() && target.visible() < target.matching() && guard-- > 0) {
      const before = target.visible();
      if (!(await step(n + 1, mine))) return;
      if (target.visible() <= before || over()) {
        // the next row could not be shown, or ends past the reference: keep n
        await step(n, mine);
        return;
      }
      n += 1;
    }
  }

  const onResize = (): void => {
    if (typeof ref.getBoundingClientRect !== "function") return;
    const rb = ref.getBoundingClientRect();
    const now = { h: contentBottom(ref) - rb.top, w: (rb.right ?? 0) - (rb.left ?? 0) };
    if (memo && Math.abs(now.h - memo.h) < 0.5 && Math.abs(now.w - memo.w) < 0.5) return;
    void fit();
  };
  const onRerender = (ev: Event): void => {
    const root = (ev as CustomEvent<{ root?: string }>).detail?.root;
    if (opts.ownRoot && root === opts.ownRoot) return;
    void fit();
  };

  let ro: ResizeObserver | null = null;
  if (opts.observe !== false) {
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(onResize);
      ro.observe(ref as unknown as Element);
    } else if (typeof window !== "undefined") window.addEventListener("resize", onResize);
    if (typeof document !== "undefined") document.addEventListener("populus:rerender", onRerender);
  }
  return {
    refit: fit,
    disconnect(): void {
      ro?.disconnect();
      if (typeof window !== "undefined" && !ro) window.removeEventListener?.("resize", onResize);
      if (typeof document !== "undefined") document.removeEventListener?.("populus:rerender", onRerender);
      token++;
    },
  };
}
