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
    /* A hidden tile has a zero box at y=0; counting it would invent a phantom
       first row and make every real row look like "not the last". */
    if (r.width === 0 || r.height === 0) continue;
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

/** The stat tiles `/congress/` is data-backed for, in emission order.

    `buildTiles` (`src/lib/data.ts:783`) returns exactly these four with no
    branch that adds or removes one, so the COUNT is a structural property of the
    producer rather than a snapshot of today's corpus. The labels are patterns
    because their shape is the contract and the numbers inside them are the data:
    pinning the digits would make an ordinary corpus refresh look like a defect,
    and pinning nothing would let a dropped tile pass. R9's matrix row asks for
    tile count to equal data; this is that data. */
export const CONGRESS_TILE_LABELS: RegExp[] = [
  /^rows filed since \d{4}$/,
  /^House parse · \d+ e-filed$/,
  /^Senate parse · \d+ e-filed$/,
  /^paper · need OCR( · \d+ H · \d+ S)?$/,
];

/** Force a `.table-scroll` to overflow at any viewport width, WITHOUT distorting
    the layout in the one way that breaks the measurement.

    The obvious instrument — `.etable { min-width: 4000px }` — is wrong, and it
    took three contradictory measurements to see why. Auto table layout hands the
    extra width to the FIRST column, and that column is
    `.etable[data-sticky-first] td:first-child`: `position: sticky; left: 0`,
    `background: var(--raised)`, `z-index: 2`. Once it grows wider than the
    scroll container it spans the whole visible box and paints its opaque
    background OVER the container's right-edge shadow. `elementFromPoint` at the
    container's right edge then returns `td.c-pos` with
    `background: rgb(255, 254, 251)` instead of a transparent cell, and the cue
    genuinely is invisible — so the instrument manufactures the very defect it
    claims to be testing for. Narrowing the container (`max-width: 240px`) does
    the same thing for the same reason.

    Widening only the NON-identity columns leaves the sticky column its natural
    size, so the container overflows and the cue is measured where it is not
    occluded. Verified at all five widths: scrollable, edge cell transparent,
    cue paints. */
export const FORCE_TABLE_OVERFLOW =
  ".table-scroll .etable td:not(:first-child)," +
  ".table-scroll .etable th:not(:first-child){min-width:260px}";
