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

/* `CONGRESS_TILE_LABELS` is DELETED. It pinned the emission order of
   `buildTiles`, and RUN ALPHA-SURFACES-V2 (R8/R26) deleted both the builder and
   the strip: the methodology page publishes the same four measures in full,
   from its own `coverageSummary` derivation, which still throws rather than
   publish a coverage claim it cannot source. */

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

/** R7's matrix row names a 20-character member name. Exactly 20, asserted at
    use — round 2's F5 was a "40-character" fixture that was 37. */
export const WORST_CASE_MEMBER = "Alexandra Fitzgerald";

/** True intrinsic content width of an element, in px.

    `scrollWidth > clientWidth` only detects overflow that the box is ALREADY
    showing; a cell with `overflow: hidden` and `text-overflow: ellipsis`
    reports `scrollWidth === clientWidth` whether it has room to spare or is
    clipping by a hair, so it cannot answer "is this truncated". Measuring a
    detached clone at `width: max-content` can. Runs in the page. */
export function intrinsicWidth(el: Element): number {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;width:auto;";
  document.body.appendChild(host);
  const cs = getComputedStyle(el);
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.cssText =
    `width:max-content;max-width:none;overflow:visible;white-space:nowrap;` +
    `display:block;font:${cs.font};padding:${cs.padding};`;
  host.appendChild(clone);
  const w = Math.ceil(clone.getBoundingClientRect().width);
  document.body.removeChild(host);
  return w;
}

/** Plant a member name into a `.cell-member` and report what the cell now shows.

    The visible identity is the `<a>` (`format.ts:661`); the cell ALSO opens with
    a `visually-hidden` "Member " label. Round 1's F1: planting into
    `firstElementChild` hit that hidden label, so the promised 20-character
    fixture was never rendered and the assertion silently measured whatever name
    the corpus happened to sort first.

    Returning the planted element's own text is NOT enough to prove that was
    fixed — verified by mutation: restoring `firstElementChild` still returns the
    fixture, so such a check passes while planting into the wrong element. The
    caller must re-read the VISIBLE anchor independently of this helper. The
    hidden label is returned too, so the caller can assert it survived. */
export function plantMemberName(
  cell: Element,
  name: string,
): { linkText: string; hiddenLabel: string } {
  const link = cell.querySelector("a");
  if (link) link.textContent = name;
  const hidden = cell.querySelector(".visually-hidden");
  return {
    linkText: (link?.textContent ?? "").trim(),
    hiddenLabel: (hidden?.textContent ?? "").trim(),
  };
}
