/* The geometry predicates, in ONE place, so the suite and its negative control
   exercise the same code. A control that re-implements the check proves only
   that the copy works. */

export interface Box { x: number; y: number; width: number; height: number }

/** Intersection area in px². Zero means the boxes do not share pixels. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How far the document exceeds the viewport horizontally. */
export const horizontalOverflow = (): number =>
  document.documentElement.scrollWidth - window.innerWidth;

/** Width left unused at the end of each `.tile` row of a strip, top row first.

    Lives here, not in the spec, for the same reason `overlap` does: the R9
    packing assertion and the negative control that proves it can fail must
    exercise ONE implementation. Serialized into the page by `evaluate`, so it
    closes over nothing. */
export function stripRowTrailing(strip: Element): number[] {
  const sb = strip.getBoundingClientRect();
  const byRow = new Map<number, DOMRect[]>();
  for (const t of Array.from(strip.querySelectorAll(".tile"))) {
    const r = t.getBoundingClientRect();
    const k = Math.round(r.y);
    byRow.set(k, [...(byRow.get(k) ?? []), r]);
  }
  return [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const row = byRow.get(k)!;
      const last = row[row.length - 1]!;
      return sb.x + sb.width - (last.x + last.width);
    });
}

/** A row is packed if it leaves no more than this behind.

    This is NOT a threshold tuned until the suite went green. With the R9 fix in
    place the measured trailing width is **1.0px on every row at every one of the
    five widths** — the strip's own 1px border, which sits outside the last
    tile's box by construction. 6 is headroom for sub-pixel rounding at other
    zoom levels, six times the observed value and two orders of magnitude below
    the defect it guards against: the unpacked row this replaced measured 191px
    at 720px. `layout-negative.spec.ts` reintroduces that defect and REQUIRES
    this constant to catch it, so the number cannot be quietly relaxed into
    uselessness without that control going red. */
export const PACKED_TRAILING_PX = 6;
