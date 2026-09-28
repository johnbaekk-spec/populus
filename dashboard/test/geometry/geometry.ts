/* The geometry predicates, in ONE place, so the suite and its negative control
   exercise the same code. A control that re-implements the check proves only
   that the copy works. */

import type { Page } from "@playwright/test";

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

/* =============================================================================
   DESIGN-POLISH T1.10 — the ledger geometry probe, G1–G12.

   ONE in-page measurement library. `installLedgerProbe` is serialized into the
   page by Playwright (`page.evaluate(installLedgerProbe)`), so it defines every
   helper inside its own body and closes over nothing at module scope. It
   assigns `window.__ledger`; `ledger.spec.ts` (the gate), the route negative
   controls and the synthetic self-tests in `layout-negative.spec.ts` all call
   the SAME predicates through it.

   Every predicate returns structured findings and ALWAYS reports how many
   things it measured: a check that measured nothing has not passed, it has
   not run (`measured === 0`), and the spec fails it as such.

   Visible text runs (success criterion 1, T-6/T-7/T-8, and the five traps in
   the table-alignment-instrument memory):
   - a text node counts when its parent passes
     `checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })`, it is
     not inside a closed `<details>` (its own `<summary>` excepted), not inside
     screen-reader-only text (`.visually-hidden`, `.sr-only`, or a
     clip/clip-path/1px absolute box), and its client rects are not all empty;
   - for ALIGNMENT (G1, G6, G7, the G10 edges) it must also not be inside a
     hanging mark `.hang`, the `.sort-caret`, a `.note-pop` panel, or a
     `.note-btn` other than a label trigger (`.note-btn.note-label` text IS the
     label), and the mark glyphs § † ‡ ≈ ¶ ⓘ are cut out of every run, so a mark
     left inline in a label moves the measured label edge (a hung mark cannot);
   - generated text: an element whose `::before`/`::after` computes a
     non-empty string `content` is text too. G4/G5/G11 read the pseudo's own
     font size and colour; G1 extends the owning element's text edge to that
     element's content-box edge (the `.sort-caret` excluded: it sits in the
     reserved mark slot).
   ========================================================================== */

/** One finding. `tableIndex` is the table's index in
    `document.querySelectorAll("table")`, `columnIndex` its column (header
    cells mapped through `colspan`), `row` the index among the table's
    VISIBLE body rows — enough for a control to find the defect it planted. */
export interface LedgerFinding {
  table?: string;
  tableIndex?: number;
  column?: string;
  columnIndex?: number;
  row?: number;
  el?: string;
  detail: string;
  delta?: number;
  count?: number;
}

export interface LedgerResult {
  check: string;
  /** failureCount === 0 and the check measured something (or does not apply) */
  ok: boolean;
  /** false when the check does not apply at this width/pointer (e.g. the
      1440-fine-only control heights under a coarse pointer) */
  applicable: boolean;
  measured: number;
  failures: LedgerFinding[];
  failureCount: number;
  unmeasured: LedgerFinding[];
  unmeasuredCount: number;
  excluded: LedgerFinding[];
  excludedCount: number;
  notes: string[];
  /** a check's own sub-counts, where it has parts (G10: gaps, slack, edges,
      colours, baselines, centring) */
  sub?: Record<string, number>;
}

/** G10's six parts. */
export type G10Part = "gaps" | "slack" | "edges" | "colours" | "baselines" | "centring";

export interface LedgerEnv {
  width: number;
  coarse: boolean;
  /** fine pointer AND wider than the 720px fold: the 24px/30px arm */
  desktopFine: boolean;
  /** what the plan requires here — derived from the viewport and pointer,
      never from the stylesheet under test */
  expectedHitMin: number;
  expectedRow: number;
  /** what `--hit-min` actually computes to */
  computedHitMin: number;
}

export interface LedgerCensus {
  tables: number;
  columns: number;
  detail: string[];
}

export interface LedgerProbe {
  env(): LedgerEnv;
  census(): LedgerCensus;
  g1(): LedgerResult;
  g2(opts: { exempt: readonly string[] }): LedgerResult;
  /** `documentOnly`: the page itself never scrolls sideways — the property
      between the fold and 1440, where a wide table may still scroll inside
      its own container (C-3) */
  g3(opts?: { documentOnly?: boolean }): LedgerResult;
  g4(): LedgerResult;
  g5(): LedgerResult;
  g6(): LedgerResult;
  g7(): LedgerResult;
  g8(): LedgerResult;
  g9(opts: { expectedPairs: number | null }): LedgerResult;
  /** `min`: the least each sub-check must measure on this page (Q-12) */
  g10(opts?: { min?: Partial<Record<G10Part, number>> }): LedgerResult;
  g11(): LedgerResult;
  g11b(): LedgerResult;
  /** G11b's focus half: focuses one control of each kind (the caller presses
      Tab first so programmatic focus inherits keyboard modality) */
  focusRing(): LedgerResult;
  /** async: after scrolling a control into view it waits for the page's own
      clip to re-run (scripts/hit-areas.ts re-measures on every inner scroll),
      so the square it samples is the one the page draws at that scroll.
      `tableClamp: "shrink"` re-plants the pre-M2 table-side clamp — for the
      negative control ONLY. */
  g12(opts?: { tableClamp?: "shift" | "shrink" }): Promise<LedgerResult>;
  /** the G12 audit over `only` (at most `limit` of them), with the
      fine-pointer inflation check: the holders and note lanes' hit-test */
  hits(opts: { only: string; limit?: number }): Promise<LedgerResult>;
  headFont(): LedgerResult;
  oneFlex(): LedgerResult;
  metaTruncation(): LedgerResult;
  controlHeights(): LedgerResult;
}

declare global {
  interface Window {
    __ledger?: LedgerProbe;
  }
}

/** Install `window.__ledger`. Self-contained: serialized into the page. */
export function installLedgerProbe(): void {
  /* ---------------------------------------------------------------- scope */
  const LEDGER = "table.etable, table.reference-feed, table.si-table, table[data-multiline]";
  const FEED = "table.feed-table";
  const CLASSIC_FEED = "table.feed-table:not(.reference-feed)";
  const MARK_CHARS = "§†‡≈¶ⓘ";
  const CONTROLS =
    ".note-btn, .th-sort, .seg > button, .chips > button, .mgr-chips > button, .pager-btn, .compact-toggle";
  const SEGMENT_ITEMS = ".seg > button, .chips > button, .mgr-chips > button, .pager-btn, .compact-toggle";
  const ACTIVE_ITEMS =
    ':is(.seg, .chips, .mgr-chips) > :is([aria-pressed="true"], [aria-current]:not([aria-current="false"]), [aria-checked="true"])';
  const BARS = ".band-fill, .design-diverging > span, .si-bar-fill, .book-track > span";
  /** the reserved mark slot (contract: `--mark-slot` 14px). A constant, not
      the token, so a broken token cannot make the check agree with itself. */
  const SLOT = 14;
  const CAP = 300;
  const EDGE_TOKEN: Record<string, string> = {
    buy: "--kind-buy-edge",
    add: "--kind-buy-edge",
    netbuy: "--kind-buy-edge",
    sell: "--kind-sell-edge",
    exit: "--kind-sell-edge",
    netsell: "--kind-sell-edge",
    exch: "--kind-exch-edge",
    late: "--kind-late-edge",
    new: "--kind-new-edge",
    trim: "--kind-trim-edge",
    nochange: "--kind-nochange-edge",
    flat: "--kind-nochange-edge",
    noprior: "--kind-noprior-edge",
    "family-behaviour": "--kind-behaviour-edge",
    "family-structure": "--kind-behaviour-edge",
    "family-novelty": "--kind-novelty-edge",
    "family-context": "--kind-compliance-edge",
    "family-compliance": "--kind-compliance-edge",
    "family-withheld": "--kind-withheld-edge",
  };

  type Rect = { left: number; right: number; top: number; bottom: number };
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  type Run = { node: Text; parent: Element; rects: DOMRect[]; text: string };
  type Cell = { cell: HTMLTableCellElement; span: number };

  /* ------------------------------------------------------------ utilities */
  const px = (v: string | null | undefined): number => {
    const n = parseFloat(v ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const isMark = (ch: string): boolean => MARK_CHARS.includes(ch);
  const stripMarks = (s: string): string => s.replace(/[§†‡≈¶ⓘ]/g, "").replace(/\s+/g, " ").trim();

  function describe(el: Element | null): string {
    if (!el) return "(nothing)";
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
      : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function newResult(check: string): LedgerResult {
    return {
      check, ok: true, applicable: true, measured: 0,
      failures: [], failureCount: 0, unmeasured: [], unmeasuredCount: 0,
      excluded: [], excludedCount: 0, notes: [],
    };
  }
  function fail(res: LedgerResult, f: LedgerFinding): void {
    res.failureCount += f.count ?? 1;
    if (res.failures.length < CAP) res.failures.push(f);
  }
  function unmeasured(res: LedgerResult, f: LedgerFinding): void {
    res.unmeasuredCount += f.count ?? 1;
    if (res.unmeasured.length < CAP) res.unmeasured.push(f);
  }
  function exclude(res: LedgerResult, f: LedgerFinding): void {
    res.excludedCount += f.count ?? 1;
    if (res.excluded.length < CAP) res.excluded.push(f);
  }
  function done(res: LedgerResult): LedgerResult {
    res.ok = res.failureCount === 0 && (res.measured > 0 || !res.applicable);
    return res;
  }
  /** Aggregates repeated findings (same key) into one with a count. */
  function aggregator(res: LedgerResult) {
    const m = new Map<string, LedgerFinding>();
    return {
      add(key: string, f: LedgerFinding): void {
        const cur = m.get(key);
        if (cur) cur.count = (cur.count ?? 1) + 1;
        else m.set(key, { ...f, count: 1 });
      },
      flush(): void {
        for (const f of m.values()) fail(res, f);
      },
    };
  }

  /* ----------------------------------------------------------- visibility */
  let visMemo = new Map<Element, boolean>();
  let srMemo = new Map<Element, boolean>();
  let bgMemo = new Map<Element, { layers: RGBA[]; images: Element[] }>();
  let opMemo = new Map<Element, number>();
  function reset(): void {
    visMemo = new Map();
    srMemo = new Map();
    bgMemo = new Map();
    opMemo = new Map();
  }

  function srOnlySelf(el: Element): boolean {
    if (el.matches(".visually-hidden, .sr-only")) return true;
    const cs = getComputedStyle(el);
    if (cs.position !== "absolute" && cs.position !== "fixed") return false;
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) return true;
    if (cs.clipPath === "inset(50%)") return true;
    const r = el.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1 && cs.overflowX === "hidden";
  }
  function inSrOnly(el: Element | null): boolean {
    if (!el) return false;
    const m = srMemo.get(el);
    if (m !== undefined) return m;
    const v = srOnlySelf(el) || inSrOnly(el.parentElement);
    srMemo.set(el, v);
    return v;
  }
  function inClosedDetails(el: Element): boolean {
    let child: Element = el;
    let p = el.parentElement;
    while (p) {
      if (p instanceof HTMLDetailsElement && !p.open) {
        const ownSummary = child.tagName === "SUMMARY" && p.querySelector(":scope > summary") === child;
        if (!ownSummary) return true;
      }
      child = p;
      p = p.parentElement;
    }
    return false;
  }
  function isVisible(el: Element): boolean {
    const m = visMemo.get(el);
    if (m !== undefined) return m;
    let v = true;
    if (el.closest("script, style, template, noscript, title, head")) v = false;
    else if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) v = false;
    else if (inClosedDetails(el)) v = false;
    else if (inSrOnly(el)) v = false;
    visMemo.set(el, v);
    return v;
  }
  function hasBox(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  /** Excluded from ALIGNMENT measurement (not from the type or contrast checks). */
  function alignExcluded(el: Element): boolean {
    if (el.closest(".hang, .sort-caret, .note-pop")) return true;
    const nb = el.closest(".note-btn");
    return !!nb && !nb.classList.contains("note-label");
  }

  /* ------------------------------------------------------------ text runs */
  function nodeRects(t: Text): DOMRect[] {
    const r = document.createRange();
    r.selectNodeContents(t);
    return Array.from(r.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
  }
  /** Rects of the node's text with the mark glyphs cut out and each piece
      trimmed of white space. */
  function alignRects(t: Text): DOMRect[] {
    const v = t.nodeValue ?? "";
    const out: DOMRect[] = [];
    let i = 0;
    while (i < v.length) {
      while (i < v.length && (isMark(v[i]!) || /\s/.test(v[i]!))) i++;
      if (i >= v.length) break;
      let j = i;
      while (j < v.length && !isMark(v[j]!)) j++;
      let e = j;
      while (e > i && /\s/.test(v[e - 1]!)) e--;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, e);
      for (const q of Array.from(r.getClientRects())) if (q.width > 0 && q.height > 0) out.push(q);
      i = j;
    }
    return out;
  }
  function textRuns(root: Element, align: boolean): Run[] {
    const out: Run[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n as Text;
      const v = t.nodeValue ?? "";
      if (!v.trim()) continue;
      const p = t.parentElement;
      if (!p || !isVisible(p)) continue;
      if (align && (alignExcluded(p) || !stripMarks(v))) continue;
      const rects = align ? alignRects(t) : nodeRects(t);
      if (!rects.length) continue;
      out.push({ node: t, parent: p, rects, text: align ? stripMarks(v) : v.replace(/\s+/g, " ").trim() });
    }
    return out;
  }
  /** Text a stylesheet asked for and markup holds, whether or not it renders:
      tells "hidden label" (a defect) from "no label" (nothing to measure). */
  function hasStructuralText(root: Element): boolean {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || !stripMarks(n.nodeValue ?? "")) continue;
      if (p.closest("script, style, template, noscript")) continue;
      if (inSrOnly(p) || alignExcluded(p)) continue;
      return true;
    }
    return false;
  }
  /** The pseudo-element's style when it renders text, else null. */
  function generated(el: Element, pseudo: "::before" | "::after"): CSSStyleDeclaration | null {
    const cs = getComputedStyle(el, pseudo);
    const c = cs.content;
    if (!c || c === "none" || c === "normal" || /^url\(/.test(c)) return null;
    if (cs.display === "none" || cs.visibility !== "visible" || cs.opacity === "0") return null;
    const unquoted = c.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (_m, a, b) => (a ?? b ?? ""));
    if (!unquoted.replace(/\s+/g, "")) return null;
    return cs;
  }
  function contentBox(el: Element): Rect {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
      right: r.right - px(cs.borderRightWidth) - px(cs.paddingRight),
      top: r.top + px(cs.borderTopWidth) + px(cs.paddingTop),
      bottom: r.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom),
    };
  }
  function paddingBox(el: Element): Rect {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + px(cs.borderLeftWidth),
      right: r.right - px(cs.borderRightWidth),
      top: r.top + px(cs.borderTopWidth),
      bottom: r.bottom - px(cs.borderBottomWidth),
    };
  }
  /** The visible-text edge of a header or cell for alignment (G1). */
  function textEdge(el: Element): (Rect & { n: number }) | null {
    let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity, n = 0;
    for (const run of textRuns(el, true)) {
      for (const q of run.rects) {
        L = Math.min(L, q.left); R = Math.max(R, q.right);
        T = Math.min(T, q.top); B = Math.max(B, q.bottom);
        n++;
      }
    }
    const els = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const e of els) {
      if (!isVisible(e) || alignExcluded(e)) continue;
      for (const ps of ["::before", "::after"] as const) {
        if (!generated(e, ps)) continue;
        const cb = contentBox(e);
        if (ps === "::after") {
          R = Math.max(R, cb.right);
          if (L === Infinity) L = cb.left;
        } else {
          L = Math.min(L, cb.left);
          if (R === -Infinity) R = cb.right;
        }
        T = Math.min(T, cb.top); B = Math.max(B, cb.bottom);
        n++;
      }
    }
    return n ? { left: L, right: R, top: T, bottom: B, n } : null;
  }
  /** Horizontal extent of everything visible in a cell (text, marks, glyphs,
      bars, chips), clipped to the cell's content box. For the slack check:
      what the column actually has to hold. */
  function contentExtent(cell: Element): number {
    const cb = contentBox(cell);
    let L = Infinity, R = -Infinity;
    const take = (l: number, r: number): void => {
      const a = Math.max(l, cb.left), b = Math.min(r, cb.right);
      if (b > a) { L = Math.min(L, a); R = Math.max(R, b); }
    };
    for (const run of textRuns(cell, false)) for (const q of run.rects) take(q.left, q.right);
    for (const e of Array.from(cell.querySelectorAll("*"))) {
      if (!isVisible(e) || !hasBox(e)) continue;
      const leaf = !Array.from(e.children).some((c) => isVisible(c) && hasBox(c));
      /* A box that paints its own track (a range band, a bar track, a chip) is
         content across its whole width, not only where its fill sits. */
      const cs = getComputedStyle(e);
      const paints = cs.backgroundImage !== "none" || (parseColor(cs.backgroundColor)?.[3] ?? 0) > 0
        || parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0;
      if (leaf || paints) { const r = e.getBoundingClientRect(); take(r.left, r.right); }
      for (const ps of ["::before", "::after"] as const) {
        if (generated(e, ps)) { const b = contentBox(e); take(b.left, b.right); }
      }
    }
    return R > L ? R - L : 0;
  }
  /** The cell's visible value, marks and hidden text removed (G6). */
  function visibleString(cell: Element): string {
    return textRuns(cell, true).map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
  }
  /** A visible painted leaf that is not text (a bar, an image, a control). */
  function hasGraphic(cell: Element): boolean {
    for (const e of Array.from(cell.querySelectorAll("*"))) {
      if (!isVisible(e) || !hasBox(e) || alignExcluded(e)) continue;
      if (e instanceof SVGSVGElement || e instanceof HTMLImageElement || e instanceof HTMLCanvasElement
        || e instanceof HTMLInputElement || e instanceof HTMLSelectElement) return true;
      if (Array.from(e.children).some((c) => isVisible(c) && hasBox(c))) continue;
      const cs = getComputedStyle(e);
      const bg = parseColor(cs.backgroundColor);
      if ((bg && bg[3] > 0) || cs.backgroundImage !== "none") return true;
    }
    return false;
  }
  function lineCount(rects: DOMRect[]): number {
    const rs = [...rects].sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const q of rs) {
      if (q.top >= bottom - 1) { lines++; bottom = q.bottom; } else bottom = Math.max(bottom, q.bottom);
    }
    return lines;
  }

  /* --------------------------------------------------------------- tables */
  function allTables(): HTMLTableElement[] {
    return Array.from(document.querySelectorAll("table"));
  }
  function visibleTables(sel: string): HTMLTableElement[] {
    return Array.from(document.querySelectorAll(sel)).filter(
      (t): t is HTMLTableElement => t instanceof HTMLTableElement && isVisible(t) && hasBox(t),
    );
  }
  const nested = (t: Element): boolean => !!t.parentElement?.closest("table");
  function tableLabel(t: HTMLTableElement): string {
    const idx = allTables().indexOf(t);
    const host = t.closest("section, .panel, details, .design-band");
    const h = host?.querySelector("h2, h3, .section-h, summary");
    const name = (h?.textContent || t.caption?.textContent || t.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ").trim().slice(0, 44);
    const cls = t.className.trim().split(/\s+/).slice(0, 2).join(".");
    return `table#${idx}${cls ? "." + cls : ""} "${name}"`;
  }
  function colLabel(th: Element | undefined, c: number): string {
    const seen = th ? textRuns(th, true).map((r) => r.text).join(" ").trim() : "";
    return `[${c}] ${seen.slice(0, 24)}`;
  }
  function headerRow(t: HTMLTableElement): HTMLTableRowElement | null {
    const rows = t.tHead?.rows;
    return rows && rows.length ? rows[rows.length - 1]! : null;
  }
  function bodyRows(t: HTMLTableElement): HTMLTableRowElement[] {
    const out: HTMLTableRowElement[] = [];
    for (const tb of Array.from(t.tBodies)) {
      for (const r of Array.from(tb.rows)) if (isVisible(r) && r.getBoundingClientRect().height > 0) out.push(r);
    }
    return out;
  }
  function colMap(tr: HTMLTableRowElement): Cell[] {
    const out: Cell[] = [];
    for (const c of Array.from(tr.cells)) {
      const s = Math.max(1, c.colSpan || 1);
      for (let k = 0; k < s; k++) out.push({ cell: c, span: s });
    }
    return out;
  }
  const isRight = (el: Element): boolean => /^(right|end|-webkit-right)$/.test(getComputedStyle(el).textAlign);

  /* ------------------------------------------------------------- lengths */
  /** Resolve a length expression (e.g. `var(--gutter)`) in `host`'s context.
      NaN when the expression is invalid there. */
  function resolveLength(host: Element, expr: string): number {
    /* A custom property's computed value is its token text with var()
       substituted; a plain length (or a bare 0, which calc() would reject)
       is read directly, anything else is resolved by a probe box. */
    const v = /^var\((--[\w-]+)\)$/.exec(expr.trim());
    if (v) {
      const raw = getComputedStyle(host).getPropertyValue(v[1]!).trim();
      if (!raw) return NaN;
      if (/^-?(\d+\.?\d*|\.\d+)(px)?$/.test(raw)) return parseFloat(raw);
      expr = raw;
    }
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;height:0;padding:0;border:0;display:block";
    probe.style.width = `calc(${expr} + 1000px)`;
    host.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w >= 999 ? w - 1000 : NaN;
  }
  function envInfo(): LedgerEnv {
    const coarse = matchMedia("(any-pointer: coarse)").matches;
    const width = window.innerWidth;
    const desktopFine = !coarse && width > 720;
    return {
      width, coarse, desktopFine,
      expectedHitMin: desktopFine ? 24 : 44,
      expectedRow: desktopFine ? 30 : 44,
      computedHitMin: resolveLength(document.body, "var(--hit-min)"),
    };
  }

  /* --------------------------------------------------------------- colour */
  let cvx: CanvasRenderingContext2D | null = null;
  function parseColor(s: string | null | undefined): RGBA | null {
    if (!s) return null;
    const v = s.trim();
    if (v === "transparent") return [0, 0, 0, 0];
    let m = /^rgba?\(([^)]*)\)$/.exec(v);
    if (m) {
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
      if (p.length >= 3) return [p[0]!, p[1]!, p[2]!, p.length > 3 ? (m[1]!.includes("%") && /\/\s*[\d.]+%/.test(m[1]!) ? p[3]! / 255 : p[3]!) : 1];
    }
    m = /^color\(srgb\s+([^)]*)\)$/.exec(v);
    if (m) {
      const p = m[1]!.split(/[\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3) return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p.length > 3 ? p[3]! : 1];
    }
    if (!cvx) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      cvx = cv.getContext("2d", { willReadFrequently: true });
    }
    if (!cvx) return null;
    cvx.clearRect(0, 0, 1, 1);
    cvx.fillStyle = "#000";
    cvx.fillStyle = v;
    cvx.fillRect(0, 0, 1, 1);
    const d = cvx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  }
  const over = (fg: RGBA, bg: RGB): RGB => [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  ];
  function lum(c: RGB): number {
    const ch = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  }
  function contrast(a: RGB, b: RGB): number {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const hex = (c: RGB | RGBA): string =>
    "#" + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") +
    (c.length === 4 && c[3] < 1 ? `/${r2(c[3])}` : "");
  /** Split a computed list at top-level commas. */
  function splitTop(s: string): string[] {
    const out: string[] = [];
    let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  /** Resolve a colour expression (e.g. `var(--kind-buy-edge)`) in `host`'s
      context; null when it does not resolve there. */
  function resolveColor(host: Element, expr: string): RGBA | null {
    const outer = document.createElement("span");
    outer.style.cssText = "position:absolute;visibility:hidden;color:rgb(1, 2, 3)";
    const inner = document.createElement("span");
    inner.style.color = expr;
    outer.appendChild(inner);
    host.appendChild(outer);
    const c = getComputedStyle(inner).color;
    outer.remove();
    return c === "rgb(1, 2, 3)" ? null : parseColor(c);
  }
  const sameColor = (a: RGBA, b: RGBA): boolean =>
    Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1 && Math.abs(a[3] - b[3]) <= 0.02;

  function bgInfo(el: Element): { layers: RGBA[]; images: Element[] } {
    const m = bgMemo.get(el);
    if (m) return m;
    const cs = getComputedStyle(el);
    const c = parseColor(cs.backgroundColor) ?? [0, 0, 0, 0];
    const img = !!cs.backgroundImage && cs.backgroundImage !== "none";
    let info: { layers: RGBA[]; images: Element[] };
    if (c[3] >= 1) info = { layers: [c], images: img ? [el] : [] };
    else {
      const up = el.parentElement ? bgInfo(el.parentElement) : { layers: [] as RGBA[], images: [] as Element[] };
      info = { layers: c[3] > 0 ? [c, ...up.layers] : up.layers, images: img ? [el, ...up.images] : up.images };
    }
    bgMemo.set(el, info);
    return info;
  }
  /** Where each background-image layer of `el` paints; null = unknown
      (treated as the whole box). */
  function imageRects(el: Element): Rect[] | null {
    const cs = getComputedStyle(el);
    const imgs = splitTop(cs.backgroundImage);
    const sizes = splitTop(cs.backgroundSize);
    const px_ = splitTop(cs.backgroundPositionX);
    const py_ = splitTop(cs.backgroundPositionY);
    const reps = splitTop(cs.backgroundRepeat);
    const atts = splitTop(cs.backgroundAttachment);
    const pb = paddingBox(el);
    const out: Rect[] = [];
    for (let i = 0; i < imgs.length; i++) {
      if (imgs[i] === "none") continue;
      const rep = reps[i % reps.length] ?? "repeat";
      if (rep !== "no-repeat") return null;
      const local = (atts[i % atts.length] ?? "scroll") === "local";
      const area = local
        ? { left: pb.left - el.scrollLeft, top: pb.top - el.scrollTop, w: el.scrollWidth, h: el.scrollHeight }
        : { left: pb.left, top: pb.top, w: pb.right - pb.left, h: pb.bottom - pb.top };
      const sz = (sizes[i % sizes.length] ?? "auto").split(/\s+/);
      const len = (s: string | undefined, whole: number): number | null =>
        !s ? null : s.endsWith("px") ? parseFloat(s) : s.endsWith("%") ? (parseFloat(s) / 100) * whole : null;
      const w = len(sz[0], area.w);
      const h = len(sz[1] ?? "auto", area.h);
      if (w === null || h === null) return null;
      const pos = (s: string | undefined, whole: number, size: number): number | null =>
        !s ? null : s.endsWith("%") ? ((whole - size) * parseFloat(s)) / 100 : s.endsWith("px") ? parseFloat(s) : null;
      const x = pos(px_[i % px_.length], area.w, w);
      const y = pos(py_[i % py_.length], area.h, h);
      if (x === null || y === null) return null;
      out.push({ left: area.left + x, right: area.left + x + w, top: area.top + y, bottom: area.top + y + h });
    }
    return out;
  }
  const intersects = (a: Rect, b: Rect): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  /** The colour behind `el`, composited from its ancestors' background
      colours; unmeasurable when a background image paints under `rect`. */
  function effectiveBg(el: Element, rect: Rect | null): { rgb: RGB; unmeasurable?: string } {
    const info = bgInfo(el);
    for (const img of info.images) {
      const rs = rect ? imageRects(img) : null;
      if (!rect || rs === null || rs.some((q) => intersects(q, rect))) {
        return { rgb: [0, 0, 0], unmeasurable: `${describe(img)} paints background-image under it` };
      }
    }
    let base: RGB = [255, 255, 255];
    for (let i = info.layers.length - 1; i >= 0; i--) base = over(info.layers[i]!, base);
    return { rgb: base };
  }
  function pageBg(): RGB {
    return effectiveBg(document.body, null).unmeasurable ? [255, 255, 255] : effectiveBg(document.body, null).rgb;
  }
  function opacityChain(el: Element | null): number {
    if (!el) return 1;
    const m = opMemo.get(el);
    if (m !== undefined) return m;
    const v = (parseFloat(getComputedStyle(el).opacity) || 0) * opacityChain(el.parentElement);
    opMemo.set(el, v);
    return v;
  }
  function textColor(el: Element, cs: CSSStyleDeclaration): RGBA | null {
    if (el instanceof SVGElement) {
      const f = parseColor(cs.fill);
      if (f) return f;
    }
    const fill = cs.webkitTextFillColor;
    return parseColor(fill && fill !== cs.color ? fill : cs.color);
  }
  function renderedSize(el: Element, cs: CSSStyleDeclaration): number {
    let s = px(cs.fontSize);
    if (el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      if (m) s *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    }
    return s;
  }
  /** Parse one computed box-shadow entry: colour, offsets, inset. */
  function shadows(v: string): { color: RGBA | null; x: number; y: number; blur: number; spread: number; inset: boolean }[] {
    if (!v || v === "none") return [];
    return splitTop(v).map((s) => {
      const inset = /\binset\b/.test(s);
      const colorM = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/i.exec(s);
      const lens = s.replace(colorM ? colorM[0] : "", "").replace(/\binset\b/, "").trim().split(/\s+/).map(px);
      return {
        color: colorM ? parseColor(colorM[0]) : null,
        x: lens[0] ?? 0, y: lens[1] ?? 0, blur: lens[2] ?? 0, spread: lens[3] ?? 0, inset,
      };
    });
  }

  /* ----------------------------------------------------------- G1 align */
  /* The columns G1 measures are chosen by ROLE, never by how they happen to
     render (M1 review Q-3): every column whose header or any cell is `c-num`,
     plus any other column that renders right-aligned. A `c-num` header or cell
     that is NOT right-aligned FAILS — selecting columns by their computed
     alignment made a deleted `c-num { text-align: right }` rule skip every
     numeric column instead of failing it. The one exemption is a DECLARED
     identity first column (column 0 carrying `c-flex`: a filing history's date
     is the row's name, set left like every identity), recorded as excluded. */
  function g1(): LedgerResult {
    reset();
    const res = newResult("G1");
    for (const t of visibleTables("table")) {
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      const hr = headerRow(t);
      if (!hr) { exclude(res, { table, tableIndex, detail: "no <thead> row: no header to align to" }); continue; }
      if (!isVisible(hr) || !hasBox(hr)) { exclude(res, { table, tableIndex, detail: "header row not rendered at this width" }); continue; }
      const hmap = colMap(hr);
      const maps = bodyRows(t).map(colMap);
      for (let c = 0; c < hmap.length; c++) {
        const { cell: th, span } = hmap[c]!;
        if (span > 1 || !isVisible(th) || !hasBox(th)) continue;
        if (hmap.findIndex((x) => x.cell === th) !== c) continue;
        const bodyCells = maps
          .map((m) => m[c])
          .filter((e): e is Cell => !!e && e.span === 1 && isVisible(e.cell));
        const numeric = th.classList.contains("c-num") || bodyCells.some((e) => e.cell.classList.contains("c-num"));
        const right = isRight(th) || bodyCells.some((e) => isRight(e.cell));
        if (!numeric && !right) continue;
        const column = colLabel(th, c);
        if (numeric && c === 0 && th.classList.contains("c-flex")) {
          exclude(res, { table, tableIndex, column, columnIndex: c, detail: "a declared identity first column (c-flex): set left as the row's name" });
          continue;
        }
        if (numeric) {
          /* the role's alignment, header and every c-num cell */
          const off: string[] = [];
          if (!isRight(th)) off.push("the header");
          const leftCells = bodyCells.filter((e) => e.cell.classList.contains("c-num") && !isRight(e.cell));
          if (leftCells.length) off.push(`${leftCells.length} c-num cell${leftCells.length === 1 ? "" : "s"}`);
          if (off.length) {
            res.measured++;
            fail(res, {
              table, tableIndex, column, columnIndex: c,
              detail: `numeric (c-num) column is not right-aligned: ${off.join(" and ")} (text-align ${getComputedStyle(off[0] === "the header" ? th : leftCells[0]!.cell).textAlign})`,
            });
            continue;
          }
        }
        const he = textEdge(th);
        if (!he) {
          const f: LedgerFinding = { table, tableIndex, column, columnIndex: c, detail: "" };
          if (hasStructuralText(th)) {
            f.detail = "UNMEASURED: the header's label is in the markup but no run of it is visible, so its edge cannot be measured";
            unmeasured(res, f);
            fail(res, f);
          } else {
            f.detail = "header has no visible label (nothing to align to)";
            unmeasured(res, f);
          }
          continue;
        }
        maps.forEach((m, ri) => {
          const e = m[c];
          if (!e || e.span > 1 || !isVisible(e.cell)) return;
          const ce = textEdge(e.cell);
          if (!ce) return;
          res.measured++;
          const d = ce.right - he.right;
          if (Math.abs(d) > 1) {
            fail(res, {
              table, tableIndex, column, columnIndex: c, row: ri, delta: r2(d),
              detail: `cell "${visibleString(e.cell).slice(0, 24)}" ends at ${r2(ce.right)}, header label at ${r2(he.right)}`,
            });
          }
        });
      }
    }
    return done(res);
  }

  /* ----------------------------------------------------- G2 inner scroll */
  function accessibleName(el: Element): string {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      return lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    }
    return el.getAttribute("aria-label") ?? "";
  }
  function g2(opts: { exempt: readonly string[] }): LedgerResult {
    reset();
    const res = newResult("G2");
    const exempt = opts?.exempt ?? [];
    const seen = new Set<Element>();
    for (const t of visibleTables("table")) {
      res.measured++;
      for (let a = t.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (!/(auto|scroll)/.test(cs.overflowY)) continue;
        if (a.scrollHeight <= a.clientHeight + 1) continue;
        if (seen.has(a)) continue;
        seen.add(a);
        const f: LedgerFinding = {
          table: tableLabel(t), tableIndex: allTables().indexOf(t), el: describe(a),
          delta: a.scrollHeight - a.clientHeight,
          detail: `${describe(a)} scrolls vertically: scrollHeight ${a.scrollHeight} > clientHeight ${a.clientHeight} + 1 (overflow-y ${cs.overflowY}, max-height ${cs.maxHeight})`,
        };
        const sel = exempt.find((s) => a!.matches(s));
        if (sel) exclude(res, { ...f, detail: `${f.detail}; exempt in this milestone by "${sel}"` });
        else fail(res, f);
      }
    }
    for (const el of Array.from(document.querySelectorAll("[aria-label], [aria-labelledby]"))) {
      const name = accessibleName(el);
      if (/scroll for more rows/i.test(name)) fail(res, { el: describe(el), detail: `${describe(el)} is named "${name.trim()}"` });
    }
    return done(res);
  }

  /* ------------------------------------------------------ G3 overflow */
  function g3(opts?: { documentOnly?: boolean }): LedgerResult {
    reset();
    const res = newResult("G3");
    const de = document.documentElement;
    res.measured++;
    if (de.scrollWidth > de.clientWidth) {
      fail(res, { el: "document", delta: de.scrollWidth - de.clientWidth, detail: `document scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}` });
    }
    if (opts?.documentOnly) return done(res);
    const containers = new Map<Element, HTMLTableElement | null>();
    for (const s of Array.from(document.querySelectorAll(".table-scroll"))) if (isVisible(s) && hasBox(s)) containers.set(s, s.querySelector("table"));
    for (const t of visibleTables("table")) if (t.parentElement && !containers.has(t.parentElement)) containers.set(t.parentElement, t);
    for (const [c, t] of containers) {
      res.measured++;
      if (c.scrollWidth > c.clientWidth + 1) {
        fail(res, {
          el: describe(c), table: t ? tableLabel(t) : undefined, tableIndex: t ? allTables().indexOf(t) : undefined,
          delta: c.scrollWidth - c.clientWidth,
          detail: `${describe(c)} scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth} + 1`,
        });
      }
    }
    return done(res);
  }

  /* ------------------------------------------------- G4/G5 type census */
  type SizeSample = { size: number; where: string; el: Element; text: string };
  function sizeCensus(): SizeSample[] {
    const out: SizeSample[] = [];
    for (const run of textRuns(document.body, false)) {
      const cs = getComputedStyle(run.parent);
      out.push({ size: renderedSize(run.parent, cs), where: describe(run.parent), el: run.parent, text: run.text.slice(0, 24) });
    }
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (!isVisible(el) || !hasBox(el)) continue;
      for (const ps of ["::before", "::after"] as const) {
        const g = generated(el, ps);
        if (g) out.push({ size: px(g.fontSize), where: `${describe(el)}${ps}`, el, text: g.content.slice(0, 24) });
      }
      const isText = (el instanceof HTMLInputElement && !/^(hidden|checkbox|radio|range|color|file|image|submit|reset|button)$/.test(el.type) && !!(el.value || el.placeholder))
        || el instanceof HTMLSelectElement || (el instanceof HTMLTextAreaElement && !!(el.value || el.placeholder));
      if (isText) out.push({ size: px(getComputedStyle(el).fontSize), where: describe(el), el, text: "(control text)" });
    }
    return out;
  }
  function g4(): LedgerResult {
    reset();
    const res = newResult("G4");
    const agg = aggregator(res);
    for (const s of sizeCensus()) {
      res.measured++;
      if (s.size < 9.5 - 0.01) {
        agg.add(`${s.size}|${s.where}`, { el: s.where, delta: r2(s.size - 9.5), detail: `${r2(s.size)}px text "${s.text}" in ${s.where} (floor 9.5px)` });
      }
    }
    agg.flush();
    return done(res);
  }
  function fsTokens(): { name: string; px: number }[] {
    const names = new Set<string>();
    const rootCs = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootCs.length; i++) {
      const n = rootCs[i]!;
      if (n.startsWith("--fs-")) names.add(n);
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try { rules = sheet.cssRules; } catch { rules = null; }
      if (!rules) continue;
      const scan = (list: CSSRuleList): void => {
        for (const r of Array.from(list)) {
          if ("cssRules" in r && (r as CSSGroupingRule).cssRules) scan((r as CSSGroupingRule).cssRules);
          const text = r.cssText;
          for (const m of text.matchAll(/(--fs-[a-z0-9-]+)\s*:/gi)) names.add(m[1]!);
        }
      };
      scan(rules);
    }
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;visibility:hidden;font-size:1.2345px";
    const probe = document.createElement("span");
    host.appendChild(probe);
    document.body.appendChild(host);
    const out: { name: string; px: number }[] = [];
    for (const n of names) {
      if (!rootCs.getPropertyValue(n).trim()) continue;
      probe.style.fontSize = "";
      probe.style.fontSize = `var(${n})`;
      const v = px(getComputedStyle(probe).fontSize);
      if (Math.abs(v - 1.2345) > 1e-3 && v > 0) out.push({ name: n, px: v });
    }
    host.remove();
    return out;
  }
  function g5(): LedgerResult {
    reset();
    const res = newResult("G5");
    const tokens = fsTokens();
    const values = [...new Set(tokens.map((t) => r2(t.px)))].sort((a, b) => a - b);
    res.notes.push(`tokens: ${tokens.map((t) => `${t.name}=${r2(t.px)}`).join(" ")}`);
    if (tokens.length < 14) {
      fail(res, { detail: `only ${tokens.length} --fs-* tokens resolve here (need the 14 of Architecture B): ${tokens.map((t) => t.name).join(", ")}` });
    }
    const agg = aggregator(res);
    const sizes = new Map<number, number>();
    for (const s of sizeCensus()) {
      res.measured++;
      const k = r2(s.size);
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
      if (!values.some((v) => Math.abs(v - s.size) <= 0.01)) {
        agg.add(`${k}|${s.where}`, { el: s.where, detail: `${k}px text "${s.text}" in ${s.where} is not a type token (${values.join(", ")})` });
      }
    }
    agg.flush();
    const distinct = [...sizes.keys()].sort((a, b) => a - b);
    res.notes.push(`rendered sizes: ${distinct.map((d) => `${d}px×${sizes.get(d)}`).join(" ")}`);
    if (distinct.length > 14) fail(res, { detail: `${distinct.length} distinct rendered sizes (at most 14): ${distinct.join(", ")}` });
    return done(res);
  }

  /* ------------------------------------------------- G6 empty columns */
  function g6(): LedgerResult {
    reset();
    const res = newResult("G6");
    for (const t of visibleTables("table")) {
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      const hr = headerRow(t);
      if (!hr || !isVisible(hr)) { exclude(res, { table, tableIndex, detail: "no rendered header row" }); continue; }
      const listed = (t.getAttribute("data-columns") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      /* Only a column a VALUE proved over the full collection is excused
         (`data-columns-proven`, review Q2-5): an `always` column is listed in
         data-columns without a value check, so all-empty on the page it fails. */
      const proven = (t.getAttribute("data-columns-proven") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const hmap = colMap(hr);
      const maps = bodyRows(t).map(colMap);
      if (!maps.length) { exclude(res, { table, tableIndex, detail: "no visible body rows" }); continue; }
      for (let c = 0; c < hmap.length; c++) {
        const { cell: th, span } = hmap[c]!;
        if (span > 1 || !isVisible(th) || !hasBox(th)) continue;
        let n = 0, empty = 0;
        for (const m of maps) {
          const e = m[c];
          if (!e || e.span > 1 || !isVisible(e.cell)) continue;
          n++;
          const s = visibleString(e.cell);
          if ((s === "" || s === "—" || s === "-") && !hasGraphic(e.cell)) empty++;
        }
        if (!n) continue;
        res.measured++;
        if (empty === n) {
          const key = th.getAttribute("data-col");
          const f: LedgerFinding = { table, tableIndex, column: colLabel(th, c), columnIndex: c, detail: "" };
          if (key && proven.includes(key)) exclude(res, { ...f, detail: `all ${n} visible cells empty; kept because a value elsewhere in the collection proved "${key}" (data-columns-proven)` });
          else fail(res, { ...f, detail: `every one of ${n} visible cells is empty or a dash, and data-columns-proven ${proven.length ? `("${proven.join(",")}")` : "(absent)"} does not list ${key ? `"${key}"` : "it (no data-col)"}${key && listed.includes(key) ? ` — data-columns keeps "${key}" without a value (an always column must show one)` : ""}` });
        }
      }
    }
    return done(res);
  }

  /* ---------------------------------------------- G7 clipped numbers */
  function g7(): LedgerResult {
    reset();
    const res = newResult("G7");
    for (const t of visibleTables("table")) {
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      const hr = headerRow(t);
      const hmap = hr ? colMap(hr) : [];
      bodyRows(t).forEach((r, ri) => {
        colMap(r).forEach(({ cell }, c) => {
          if (colMap(r).findIndex((x) => x.cell === cell) !== c) return;
          if (!cell.classList.contains("c-num") || !isVisible(cell)) return;
          const runs = textRuns(cell, true);
          if (!runs.length) return;
          res.measured++;
          const cb = contentBox(cell);
          let L = Infinity, R = -Infinity;
          for (const run of runs) for (const q of run.rects) { L = Math.min(L, q.left); R = Math.max(R, q.right); }
          const base: LedgerFinding = { table, tableIndex, column: colLabel(hmap[c]?.cell, c), columnIndex: c, row: ri, detail: "" };
          const w = R - L, cw = cb.right - cb.left;
          if (w > cw + 0.5) {
            fail(res, { ...base, delta: r2(w - cw), detail: `text "${visibleString(cell).slice(0, 24)}" is ${r2(w)}px wide in a ${r2(cw)}px content box` });
            return;
          }
          for (const run of runs) {
            for (let a: Element | null = run.parent; a; a = a.parentElement) {
              const cs = getComputedStyle(a);
              const clipsX = cs.overflowX !== "visible", clipsY = cs.overflowY !== "visible";
              if (clipsX || clipsY) {
                const pb = paddingBox(a);
                for (const q of run.rects) {
                  const outX = clipsX && (q.left < pb.left - 0.5 || q.right > pb.right + 0.5);
                  const outY = clipsY && (q.top < pb.top - 0.5 || q.bottom > pb.bottom + 0.5);
                  if (outX || outY) {
                    fail(res, { ...base, el: describe(a), detail: `text "${run.text.slice(0, 24)}" is clipped by ${describe(a)} (overflow ${cs.overflowX}/${cs.overflowY}, ${r2(pb.right - pb.left)}px wide)` });
                    return;
                  }
                }
              }
              if (a === cell) break;
            }
          }
        });
      });
    }
    return done(res);
  }

  /* -------------------------------------------------- G8 row heights */
  /* G8 and G12 measure the three M2 scroll boxes too (M1 review Q-2): they
     used to borrow G2's M2 exemption, which left 35 of the filer's 58
     controls unmeasured by G12. Run without it, the boxes' rows and controls
     pass both checks, so no exemption (and no pending check) is needed. */
  /** True when a flex line of `el`'s children wraps onto a second line. */
  function wrapsChildren(el: Element): boolean {
    const tops = Array.from(el.children)
      .filter((k) => isVisible(k) && hasBox(k))
      .map((k) => Math.round(k.getBoundingClientRect().top));
    return new Set(tops).size > 1;
  }
  function g8(): LedgerResult {
    reset();
    const res = newResult("G8");
    const env = envInfo();
    const want = env.expectedRow;
    res.notes.push(`expected single-line row ${want}px (${env.desktopFine ? "fine pointer above 720px" : "coarse pointer or at/below 720px"})`);
    for (const t of visibleTables(`${LEDGER}, ${FEED}`)) {
      if (nested(t)) continue;
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      if (t.matches("[data-multiline]")) { exclude(res, { table, tableIndex, detail: "declared prose table ([data-multiline])" }); continue; }
      if (t.matches(CLASSIC_FEED) && env.width > 720) { exclude(res, { table, tableIndex, detail: "classic feed: measured at the fold only (declared debt, A-4)" }); continue; }
      const fold = t.matches(FEED) && env.width <= 1080;
      const foldRows: { ri: number; h: number }[] = [];
      /* Multi-line rows at the fold or under a coarse pointer, by line count
         (M1 review Q-8): a table whose rows are two lines by design there (the
         member's dates, then the lag) is measured, never skipped — each group
         of equal line count uniform to ±1px, and no row under the hit square. */
      const multi = new Map<number, { ri: number; h: number }[]>();
      bodyRows(t).forEach((r, ri) => {
        const h = r.getBoundingClientRect().height;
        if (r.classList.contains("unranked-sep") || Array.from(r.cells).some((c) => c.colSpan > 1)) {
          exclude(res, { table, tableIndex, row: ri, detail: "separator row (colspan)" });
          return;
        }
        if (r.querySelector("details[open]")) { exclude(res, { table, tableIndex, row: ri, detail: "row holds an open <details>" }); return; }
        if (fold) {
          /* flags WRAP rather than truncate (§5): a row whose chips run onto
             a second line is taller by design, and says so */
          const range = r.querySelector(".cell-range");
          if (range && wrapsChildren(range)) { exclude(res, { table, tableIndex, row: ri, detail: `its flags wrap (${r1(h)}px)` }); return; }
          foldRows.push({ ri, h });
          return;
        }
        let lines = 1;
        for (const c of Array.from(r.cells)) {
          if (!isVisible(c)) continue;
          lines = Math.max(lines, lineCount(textRuns(c, false).flatMap((x) => x.rects)));
        }
        if (lines > 1) {
          if (env.desktopFine) { exclude(res, { table, tableIndex, row: ri, detail: `wraps to ${lines} lines (${r1(h)}px)` }); return; }
          const g = multi.get(lines) ?? [];
          g.push({ ri, h });
          multi.set(lines, g);
          return;
        }
        res.measured++;
        if (Math.abs(h - want) > 1) fail(res, { table, tableIndex, row: ri, delta: r2(h - want), detail: `single-line row is ${r2(h)}px, expected ${want}±1` });
      });
      if (foldRows.length) {
        res.measured += foldRows.length;
        const hs = foldRows.map((x) => x.h);
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (hi - lo > 1) {
          const odd = foldRows.filter((x) => Math.abs(x.h - lo) > 1).slice(0, 12).map((x) => `${x.ri}:${r1(x.h)}`);
          fail(res, { table, tableIndex, delta: r2(hi - lo), detail: `fold rows are not uniform: ${r1(lo)}–${r1(hi)}px (rows ${odd.join(", ")})` });
        }
      }
      for (const [lines, rows] of multi) {
        res.measured += rows.length;
        const short = rows.filter((x) => x.h < env.expectedHitMin - 1);
        if (short.length) {
          fail(res, { table, tableIndex, count: short.length, detail: `${lines}-line rows under the ${env.expectedHitMin}px hit square: ${short.slice(0, 8).map((x) => `${x.ri}:${r1(x.h)}`).join(", ")}` });
        }
        const hs = rows.map((x) => x.h);
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (hi - lo > 1) {
          const odd = rows.filter((x) => Math.abs(x.h - lo) > 1).slice(0, 12).map((x) => `${x.ri}:${r1(x.h)}`);
          fail(res, { table, tableIndex, delta: r2(hi - lo), detail: `${lines}-line rows are not uniform: ${r1(lo)}–${r1(hi)}px (rows ${odd.join(", ")})` });
        }
      }
    }
    return done(res);
  }

  /* -------------------------------------------------- G9 band balance */
  /** The bottom of the cell's last VISIBLE content: text and leaf boxes,
      each cut at the bottom of any box between it and the cell that clips
      vertically (rows scrolled out of an inner scroll box are not visible). */
  function contentBottom(cell: Element): number | null {
    const clipMemo = new Map<Element, number>();
    const clipBottom = (el: Element | null): number => {
      if (!el || el === cell.parentElement) return Infinity;
      const m = clipMemo.get(el);
      if (m !== undefined) return m;
      const cs = getComputedStyle(el);
      const own = cs.overflowY !== "visible" ? paddingBox(el).bottom : Infinity;
      const v = Math.min(own, el === cell ? Infinity : clipBottom(el.parentElement));
      clipMemo.set(el, v);
      return v;
    };
    let b = -Infinity;
    for (const run of textRuns(cell, false)) {
      const cut = clipBottom(run.parent);
      for (const q of run.rects) b = Math.max(b, Math.min(q.bottom, cut));
    }
    for (const e of Array.from(cell.querySelectorAll("*"))) {
      if (!isVisible(e) || !hasBox(e)) continue;
      if (Array.from(e.children).some((c) => isVisible(c) && hasBox(c))) continue;
      b = Math.max(b, Math.min(contentBox(e).bottom, clipBottom(e.parentElement)));
    }
    return b === -Infinity ? null : b;
  }
  /** A band cell that is ONLY its empty-state line (R10): marked
      `data-empty-state` by its renderer, or the one-line unavailable panel. */
  function emptyStateCell(c: Element): boolean {
    return c.hasAttribute("data-empty-state") || c.classList.contains("design-unavailable-line");
  }
  /** A cell that shows its WHOLE collection (DESIGN-POLISH M2 delta review):
      every table in it carries its own count — the compact disclosure naming
      its tbody (`data-compact-for`) — with `data-compact-total` ≤
      `data-compact-shown`, and its rows agree: the tbody holds exactly `total`
      rows and every one shows. Read off the table's own count attributes and
      its rows, never off a flag the page could set for G9. A cell with no
      table, or a table carrying no count, is not proved complete. */
  function completeCell(cell: Element): { complete: boolean; detail: string } {
    const tables = Array.from(cell.querySelectorAll("table")).filter((t) => isVisible(t) && hasBox(t) && !nested(t));
    if (!tables.length) return { complete: false, detail: "it has no table" };
    const done: string[] = [];
    for (const t of tables) {
      const counted = Array.from(t.tBodies)
        .map((b) => ({ b, w: b.id ? document.querySelector<HTMLElement>(`.compact-disclosure[data-compact-for="${CSS.escape(b.id)}"]`) : null }))
        .filter((x): x is { b: HTMLTableSectionElement; w: HTMLElement } => x.w !== null);
      if (!counted.length) return { complete: false, detail: `${describe(t)} carries no count (no compact disclosure names its tbody)` };
      for (const { b, w } of counted) {
        const total = Number(w.dataset.compactTotal), shown = Number(w.dataset.compactShown);
        if (!Number.isFinite(total) || !Number.isFinite(shown) || total > shown) return { complete: false, detail: `#${b.id} holds rows back (${shown} of ${total})` };
        const rows = Array.from(b.rows).filter((r) => !r.classList.contains("si-evidence-row"));
        const showing = rows.filter((r) => isVisible(r) && hasBox(r)).length;
        if (rows.length !== total || showing !== total) return { complete: false, detail: `#${b.id} counts ${total} of ${total}, but ${showing} of its ${rows.length} rows show` };
        done.push(`#${b.id} ${total} of ${total}`);
      }
    }
    return { complete: true, detail: done.join(", ") };
  }
  /* G9, rewritten for coordinator decision CD-1 (DESIGN-POLISH M2 review
     Q2-2, Q2-3). A pair has ONE primary cell (`data-pair-primary`, the wider
     one the reader came for), and the rule is ASYMMETRIC: the primary is never
     cut to balance its side, so the side may end earlier, but it may not end
     more than 96px later — no void opens under the primary. At the desktop
     width the primary must be the wider (or equal) cell. A band counts as
     collapsed only when its cells SHOW it: its last cell is its one
     empty-state line (or every cell is one). A COMPLETE primary — its table
     shows its whole collection, total ≤ shown on its own count (a Consensus
     board of one to three issuers) — may end more than 96px above its side:
     there are no more rows to show (M2 delta review). A primary holding rows
     back still fails. */
  function g9(opts: { expectedPairs: number | null }): LedgerResult {
    reset();
    const res = newResult("G9");
    const cands = new Set(Array.from(document.querySelectorAll(".design-band, .design-rankings, .design-pair")));
    const desktop = window.innerWidth >= 1081;
    let collapsed = 0;
    const pairs: { el: Element; cells: Element[] }[] = [];
    const cellsOf = (el: Element): Element[] =>
      Array.from(el.children).filter((c) => isVisible(c) && hasBox(c) && !c.matches(".planned-line, script, style, template"));
    for (const el of cands) {
      if (!isVisible(el)) continue;
      const cells = cellsOf(el);
      if (el.matches('[data-collapsed="empty-state"]')) {
        const empties = cells.filter(emptyStateCell);
        const last = cells[cells.length - 1];
        const shows = !!last && emptyStateCell(last) && (empties.length === 1 || empties.length === cells.length);
        res.measured++;
        if (!shows) {
          fail(res, { el: describe(el), detail: `${describe(el)} claims an empty-state collapse, but ${empties.length} of its ${cells.length} cells is an empty-state line${last && !emptyStateCell(last) ? " and its last cell is not one" : ""}` });
          continue;
        }
        collapsed++;
        /* CD-2: a lone table of at most three columns left by the collapse
           keeps the design's cell width — half the band — at the desktop width. */
        const content = cells.filter((c) => !emptyStateCell(c));
        if (desktop && content.length === 1) {
          const tables = Array.from(content[0]!.querySelectorAll("table")).filter((t) => isVisible(t) && hasBox(t));
          const head = tables.length === 1 ? headerRow(tables[0]!) : null;
          const cols = head ? Array.from(head.cells).reduce((n, c) => n + Math.max(1, c.colSpan), 0) : 0;
          if (tables.length === 1 && cols > 0 && cols <= 3) {
            res.measured++;
            const bw = el.getBoundingClientRect().width, cw = content[0]!.getBoundingClientRect().width;
            if (cw > bw / 2 + 1) fail(res, { el: describe(content[0]!), delta: r1(cw - bw / 2), detail: `a lone ${cols}-column table left by the collapse spans ${r1(cw)}px of the ${r1(bw)}px band (at most half: CD-2)` });
          }
        }
        continue;
      }
      if (cells.length === 2) pairs.push({ el, cells });
    }
    for (const p of pairs) {
      const name = `${describe(p.el)} [${describe(p.cells[0]!)} | ${describe(p.cells[1]!)}]`;
      const primaries = p.cells.filter((c) => c.hasAttribute("data-pair-primary"));
      res.measured++;
      if (primaries.length !== 1) {
        fail(res, { el: name, detail: `${name}: ${primaries.length} primary cells (a pair names exactly one, data-pair-primary)` });
        continue;
      }
      const primary = primaries[0]!, side = p.cells.find((c) => c !== primary)!;
      if (desktop) {
        const pw = primary.getBoundingClientRect().width, sw = side.getBoundingClientRect().width;
        if (pw < sw - 1) fail(res, { el: name, delta: r1(sw - pw), detail: `${name}: the primary cell is ${r1(pw)}px, narrower than its ${r1(sw)}px side cell` });
      }
      const pb = contentBottom(primary), sb = contentBottom(side);
      if (pb === null || sb === null) { fail(res, { el: name, detail: `${name}: a cell has no visible content` }); continue; }
      const d = sb - pb;
      if (d > 96) {
        const c = completeCell(primary);
        if (c.complete) res.notes.push(`${name}: the side ends ${r1(d)}px below a COMPLETE primary (${c.detail}) — exempt`);
        else fail(res, { el: name, delta: r1(d), detail: `${name}: the side cell ends ${r1(d)}px below the primary (a void under the primary; ≤96 — not a complete primary: ${c.detail})` });
      }
    }
    res.notes.push(`pairs: ${pairs.map((p) => describe(p.el)).join(", ") || "none"}; collapsed: ${collapsed}`);
    if (opts?.expectedPairs != null) {
      /* The pair COUNT is itself a measurement (T-4): a route whose every
         pair collapsed under the empty-state rule (Institutional's I1 on the
         bounded build) has measured its bands by counting them — a pair lost
         any other way would fail right here. */
      res.measured++;
      const want = opts.expectedPairs - collapsed;
      if (pairs.length !== want) {
        fail(res, { detail: `found ${pairs.length} pair(s), expected ${opts.expectedPairs} less ${collapsed} collapsed = ${want}` });
      }
    } else if (!pairs.length && !collapsed) res.applicable = false;
    return done(res);
  }

  /* -------------------------------------- G10 spacing, slack, edges, colour */
  let fontCtx: CanvasRenderingContext2D | null = null;
  function baselineOf(el: Element): number | null {
    const run = textRuns(el, false)[0];
    if (!run) return null;
    const cs = getComputedStyle(run.parent);
    const disp = getComputedStyle(run.parent).display;
    if (!/flex|grid/.test(disp)) {
      const s = document.createElement("span");
      s.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline";
      run.node.parentNode!.insertBefore(s, run.node);
      const y = s.getBoundingClientRect().bottom;
      s.remove();
      return y;
    }
    if (!fontCtx) fontCtx = document.createElement("canvas").getContext("2d");
    if (!fontCtx) return null;
    fontCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return run.rects[0]!.top + fontCtx.measureText("Hxg").fontBoundingBoxAscent;
  }
  function g10(opts?: { min?: Partial<Record<G10Part, number>> }): LedgerResult {
    reset();
    const res = newResult("G10");
    const sub: Record<G10Part, number> = { gaps: 0, slack: 0, edges: 0, colours: 0, baselines: 0, centring: 0 };
    const gapAgg = aggregator(res);
    for (const t of visibleTables(LEDGER)) {
      if (nested(t)) continue;
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      const multiline = t.matches("[data-multiline]");
      const feed = t.matches(".reference-feed");
      const compact = t.matches(".etable-compact");
      const hr = headerRow(t);
      const rows = bodyRows(t);
      const all = [...(hr && isVisible(hr) && hasBox(hr) ? [hr] : []), ...rows];
      /* (a) the gap between adjacent cells' content boxes */
      for (const r of all) {
        if (Array.from(r.cells).some((c) => c.colSpan > 1)) continue;
        const cells = Array.from(r.cells).filter((c) => isVisible(c) && hasBox(c));
        for (let i = 1; i < cells.length; i++) {
          const a = cells[i - 1]!, b = cells[i]!;
          const ca = contentBox(a), cb = contentBox(b);
          if (cb.top >= ca.bottom || ca.top >= cb.bottom || cb.left < ca.right - 1) continue;
          const idx = Array.from(r.cells).indexOf(b);
          const aRight = ca.right + (a.classList.contains("has-marks") ? SLOT : 0);
          const gap = cb.left - aRight;
          const want = multiline ? 14 : feed ? 12 : b.classList.contains("c-num") && idx > 0 ? (compact ? 16 : 22) : 12;
          sub.gaps++;
          res.measured++;
          if (Math.abs(gap - want) > 2) {
            gapAgg.add(`${tableIndex}|${idx}|${r === hr ? "h" : "b"}`, {
              table, tableIndex, column: colLabel(hr?.cells[idx], idx), columnIndex: idx, delta: r2(gap - want),
              detail: `gap before this column is ${r2(gap)}px between content boxes, expected ${want}±2 (${r === hr ? "header" : "body"} row)`,
            });
          }
        }
      }
      /* (b) slack: only the c-flex column may be wider than its content */
      if (!feed && !multiline) {
        const hmap = hr && isVisible(hr) ? colMap(hr) : [];
        const bmaps = rows.map(colMap);
        const ncol = Math.max(hmap.length, ...bmaps.map((m) => m.length), 0);
        for (let c = 0; c < ncol; c++) {
          const cells = [hmap[c], ...bmaps.map((m) => m[c])]
            .filter((e): e is Cell => !!e && e.span === 1 && isVisible(e.cell) && hasBox(e.cell))
            .map((e) => e.cell);
          if (!cells.length || cells.some((x) => x.classList.contains("c-flex"))) continue;
          const cb = contentBox(cells[0]!);
          const colW = cb.right - cb.left;
          let widest = 0, declared = 0;
          for (const x of cells) {
            widest = Math.max(widest, contentExtent(x));
            const cs = getComputedStyle(x);
            const mw = px(cs.minWidth);
            const inner = cs.boxSizing === "border-box"
              ? mw - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)
              : mw;
            declared = Math.max(declared, inner);
          }
          sub.slack++;
          res.measured++;
          const allowed = Math.max(widest, declared) + 1;
          if (colW > allowed) {
            fail(res, {
              table, tableIndex, column: colLabel(hmap[c]?.cell, c), columnIndex: c, delta: r2(colW - allowed + 1),
              detail: `column content box ${r2(colW)}px holds at most ${r2(widest)}px (declared minimum ${r2(declared)}px): slack outside the c-flex column`,
            });
          }
        }
      }
      /* (c) first text on the gutter, last text on band right − gutter. The
         band is the table's .table-scroll, which the ledger extends to the
         band edges. The gutter is the computed --gutter on the table, read
         per side where the ledger splits it (--gutter-l / --gutter-r: a
         pair's inner gutter can differ from its outer, D-11). The text edge
         is the digit/label edge: marks and the caret hang in the slot and
         are not the edge. */
      const band = t.closest(".table-scroll") ?? t.parentElement;
      const firstCell = t.rows[0]?.cells[0];
      if (band && firstCell) {
        const bb = band.getBoundingClientRect();
        const side = (name: string): { px: number; from: string } => {
          const own = resolveLength(firstCell, `var(${name})`);
          return Number.isFinite(own) ? { px: own, from: name } : { px: resolveLength(firstCell, "var(--gutter)"), from: "--gutter" };
        };
        const gl = side("--gutter-l"), gr = side("--gutter-r");
        if (!Number.isFinite(gl.px) || !Number.isFinite(gr.px)) {
          fail(res, { table, tableIndex, detail: "--gutter does not resolve on this table" });
        } else {
          let L = Infinity, R = -Infinity;
          /* A chip (flag, kind pill, tag) is a box: its own padding is part of
             it, so its edge is its border box, not the text inset within. */
          const CHIPS = ".flag, .qoq-chip, .nc-chip, .id-chip, span.mgr-chip, .badge-planned";
          const take = (cell: Element): void => {
            const box = cell.getBoundingClientRect();
            const e = textEdge(cell);
            if (!e) return;
            let l = e.left, r = e.right;
            for (const chip of Array.from(cell.querySelectorAll(CHIPS))) {
              if (!isVisible(chip) || !hasBox(chip)) continue;
              const cb = chip.getBoundingClientRect();
              l = Math.min(l, cb.left);
              r = Math.max(r, cb.right);
            }
            L = Math.min(L, Math.max(l, box.left));
            R = Math.max(R, Math.min(r, box.right));
          };
          for (const r of all) {
            const cells = Array.from(r.cells).filter((c) => isVisible(c) && hasBox(c));
            if (!cells.length) continue;
            if (feed) for (const c of cells) take(c);
            else {
              if (r.cells[0] && r.cells[0].colSpan === 1) take(r.cells[0]);
              const last = r.cells[r.cells.length - 1]!;
              if (last.colSpan === 1) take(last);
            }
          }
          if (L !== Infinity) {
            sub.edges += 2;
            res.measured += 2;
            const overflowing = band.scrollWidth > band.clientWidth + 1;
            const wantL = bb.left - band.scrollLeft + gl.px;
            const right = overflowing ? t.getBoundingClientRect().right : bb.right;
            const wantR = right - gr.px;
            if (Math.abs(L - wantL) > 1) fail(res, { table, tableIndex, el: describe(band), delta: r2(L - wantL), detail: `first text x ${r2(L)} ≠ band left ${r2(bb.left)} + gutter ${gl.px} (${gl.from})` });
            if (Math.abs(R - wantR) > 1) fail(res, { table, tableIndex, el: describe(band), delta: r2(R - wantR), detail: `last text right ${r2(R)} ≠ ${overflowing ? "table" : "band"} right ${r2(right)} − gutter ${gr.px} (${gr.from})` });
          }
        }
      }
      /* (f) row-edge colour = the kind's edge token */
      rows.forEach((r, ri) => {
        const edge = r.getAttribute("data-edge");
        if (!edge) {
          /* A row whose kind cell states NO kind carries no edge (plan, section
             B: "n/c (unclassified) — none; the hatch is the cue"): the hatched
             n/c chip, an undisclosed "—", and a paper filing. Any other kind
             word without an edge fails. */
          const k = r.querySelector(".c-kind");
          const kindless =
            !!k &&
            (!!k.querySelector(".qoq-nc, .nc-chip") ||
              /^(?:—|n\/c|paper)$/i.test((k.textContent ?? "").replace(/\s+/g, " ").trim()) ||
              r.classList.contains("reference-paper"));
          if (k && !kindless) fail(res, { table, tableIndex, row: ri, detail: "a row with a kind cell (.c-kind) carries no data-edge" });
          return;
        }
        const token = EDGE_TOKEN[edge];
        /* a declared prose table's row is a grid: the ROW paints its edge
           (the first cell cannot run the row's height), not its first cell */
        const first = multiline ? r : r.cells[0];
        if (!token) { fail(res, { table, tableIndex, row: ri, detail: `unknown data-edge="${edge}"` }); return; }
        if (!first) return;
        sub.colours++;
        res.measured++;
        const want = resolveColor(first, `var(${token})`);
        const got = shadows(getComputedStyle(first).boxShadow).find((s) => s.inset && Math.abs(s.x - 3) <= 0.5 && s.y === 0);
        if (!want) fail(res, { table, tableIndex, row: ri, detail: `${token} does not resolve` });
        else if (!got || !got.color) fail(res, { table, tableIndex, row: ri, detail: `data-edge="${edge}" row: ${multiline ? "the row" : "the first cell"} paints no inset 3px edge` });
        else if (!sameColor(got.color, want)) fail(res, { table, tableIndex, row: ri, detail: `data-edge="${edge}" edge is ${hex(got.color)}, ${token} is ${hex(want)}` });
      });
    }
    gapAgg.flush();
    /* (d) band-head baselines and (e) control centring */
    for (const head of Array.from(document.querySelectorAll(".panel-head"))) {
      if (!isVisible(head) || !hasBox(head)) continue;
      const title = head.querySelector(":scope > .section-h, :scope > h2, :scope > h3");
      const note = head.querySelector(":scope > .panel-note");
      const name = (title?.textContent ?? describe(head)).replace(/\s+/g, " ").trim().slice(0, 40);
      if (title && note && isVisible(title) && isVisible(note) && hasBox(note) && textRuns(note, false).length) {
        const tr = title.getBoundingClientRect(), nr = note.getBoundingClientRect();
        if (nr.top < tr.bottom && tr.top < nr.bottom) {
          const bt = baselineOf(title), bn = baselineOf(note);
          if (bt !== null && bn !== null) {
            sub.baselines++;
            res.measured++;
            if (Math.abs(bt - bn) > 1) fail(res, { el: `band head "${name}"`, delta: r2(bn - bt), detail: `band head "${name}": meta baseline ${r2(bn)} vs title baseline ${r2(bt)}` });
          }
        } else exclude(res, { el: `band head "${name}"`, detail: "meta wraps below the title" });
      }
      const kids = Array.from(head.children).filter((k) => isVisible(k) && hasBox(k));
      for (const ctl of Array.from(head.querySelectorAll(".seg, .chips, .mgr-chips"))) {
        if (!isVisible(ctl) || !hasBox(ctl)) continue;
        const cr = ctl.getBoundingClientRect();
        const own = kids.find((k) => k.contains(ctl));
        const others = kids.filter((k) => k !== own);
        const sameLine = others.filter((k) => { const r = k.getBoundingClientRect(); return r.top < cr.bottom && cr.top < r.bottom; });
        let top: number, bottom: number;
        if (sameLine.length === others.length) {
          const cb = contentBox(head);
          top = cb.top; bottom = cb.bottom;
        } else if (sameLine.length) {
          top = Math.min(...sameLine.map((k) => k.getBoundingClientRect().top));
          bottom = Math.max(...sameLine.map((k) => k.getBoundingClientRect().bottom));
        } else { exclude(res, { el: describe(ctl), detail: `band head "${name}": control alone on its line` }); continue; }
        sub.centring++;
        res.measured++;
        const d = (cr.top + cr.bottom) / 2 - (top + bottom) / 2;
        if (Math.abs(d) > 1) fail(res, { el: `band head "${name}"`, delta: r2(d), detail: `band head "${name}": ${describe(ctl)} centre is ${r2(d)}px off the head row's` });
      }
    }
    res.notes.push(`measured: ${Object.entries(sub).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    res.sub = { ...sub };
    /* A part that measured nothing has not passed (M1 review Q-12): where a
       page is known to carry kind rows or band-head controls, the route states
       the least its edge-colour and centring parts must measure. */
    for (const [k, n] of Object.entries(opts?.min ?? {}) as [G10Part, number][]) {
      if (sub[k] < n) fail(res, { detail: `G10's ${k} part measured ${sub[k]} here; this page must give it at least ${n}` });
    }
    return done(res);
  }

  /* -------------------------------------------------- G11 text contrast */
  function g11(): LedgerResult {
    reset();
    const res = newResult("G11");
    const agg = aggregator(res);
    const samples: { el: Element; cs: CSSStyleDeclaration; rect: Rect | null; text: string; where: string }[] = [];
    for (const run of textRuns(document.body, false)) {
      const r = run.rects;
      const rect = { left: Math.min(...r.map((q) => q.left)), right: Math.max(...r.map((q) => q.right)), top: Math.min(...r.map((q) => q.top)), bottom: Math.max(...r.map((q) => q.bottom)) };
      samples.push({ el: run.parent, cs: getComputedStyle(run.parent), rect, text: run.text.slice(0, 24), where: describe(run.parent) });
    }
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (!isVisible(el) || !hasBox(el)) continue;
      for (const ps of ["::before", "::after"] as const) {
        const g = generated(el, ps);
        if (g) samples.push({ el, cs: g, rect: el.getBoundingClientRect(), text: g.content.slice(0, 24), where: `${describe(el)}${ps}` });
      }
    }
    let exempt = 0;
    for (const s of samples) {
      if (s.el.closest(":disabled, [aria-disabled='true']")) { exempt++; continue; }
      const fg = textColor(s.el, s.cs);
      const bg = effectiveBg(s.el, s.rect);
      if (!fg) { unmeasured(res, { el: s.where, detail: `unparseable colour ${s.cs.color}` }); continue; }
      if (bg.unmeasurable) { unmeasured(res, { el: s.where, detail: `"${s.text}": ${bg.unmeasurable}` }); continue; }
      const a = fg[3] * opacityChain(s.el);
      const eff = over([fg[0], fg[1], fg[2], a], bg.rgb);
      const ratio = contrast(eff, bg.rgb);
      res.measured++;
      const size = renderedSize(s.el, s.cs);
      const weight = parseInt(s.cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 600);
      const min = large ? 3 : 4.5;
      if (ratio < min - 0.005) {
        agg.add(`${s.where}|${hex(eff)}|${hex(bg.rgb)}`, {
          el: s.where, delta: r2(ratio - min),
          detail: `"${s.text}" ${hex(eff)} on ${hex(bg.rgb)} = ${r2(ratio)}:1 (needs ${min}:1 at ${r2(size)}px/${weight})`,
        });
      }
    }
    agg.flush();
    if (exempt) res.notes.push(`${exempt} runs in disabled controls exempt (WCAG 1.4.3 inactive components)`);
    return done(res);
  }

  /* ---------------------------------------------- G11b non-text contrast */
  function g11b(): LedgerResult {
    reset();
    const res = newResult("G11b");
    const page = pageBg();
    for (const item of Array.from(document.querySelectorAll(ACTIVE_ITEMS))) {
      if (!isVisible(item) || !hasBox(item)) continue;
      const cue = shadows(getComputedStyle(item).boxShadow).find((s) => s.inset && s.x === 0 && Math.abs(s.y) >= 1 && s.color && s.color[3] > 0);
      const fill = effectiveBg(item, item.getBoundingClientRect());
      res.measured++;
      if (!cue || !cue.color) { fail(res, { el: describe(item), detail: `active item ${describe(item)} "${(item.textContent ?? "").trim().slice(0, 20)}" has no inset cue bar` }); continue; }
      if (fill.unmeasurable) { unmeasured(res, { el: describe(item), detail: fill.unmeasurable }); continue; }
      const ratio = contrast(over(cue.color, fill.rgb), fill.rgb);
      if (ratio < 3 - 0.005) fail(res, { el: describe(item), delta: r2(ratio - 3), detail: `active cue ${hex(cue.color)} on the item fill ${hex(fill.rgb)} = ${r2(ratio)}:1 (needs 3:1)` });
    }
    const agg = aggregator(res);
    let trackImages = 0;
    for (const bar of Array.from(document.querySelectorAll(BARS))) {
      if (!isVisible(bar)) continue;
      const r = bar.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(bar);
      if (cs.backgroundImage !== "none") { unmeasured(res, { el: describe(bar), detail: `${describe(bar)} fill is an image/gradient` }); continue; }
      const fill = parseColor(cs.backgroundColor);
      if (!fill || fill[3] === 0) { unmeasured(res, { el: describe(bar), detail: `${describe(bar)} paints no background colour` }); continue; }
      const track = bar.parentElement ? effectiveBg(bar.parentElement, r) : { rgb: page };
      res.measured++;
      const onPage = contrast(over(fill, page), page);
      if (onPage < 3 - 0.005) agg.add(`p|${describe(bar)}|${hex(fill)}`, { el: describe(bar), delta: r2(onPage - 3), detail: `bar ${describe(bar)} ${hex(fill)} on the page ${hex(page)} = ${r2(onPage)}:1 (needs 3:1)` });
      /* A track that paints an image (the feed's ticked range band) cannot be
         reduced to one colour, so the fill is held to the page it sits on —
         measured, never skipped (M1 review Q-9) — and the track half is noted. */
      if (track.unmeasurable) { trackImages++; continue; }
      const onTrack = contrast(over(fill, track.rgb), track.rgb);
      if (onTrack < 3 - 0.005) agg.add(`t|${describe(bar)}|${hex(fill)}|${hex(track.rgb)}`, { el: describe(bar), delta: r2(onTrack - 3), detail: `bar ${describe(bar)} ${hex(fill)} on its track ${hex(track.rgb)} = ${r2(onTrack)}:1 (needs 3:1)` });
    }
    agg.flush();
    if (trackImages) res.notes.push(`${trackImages} bar(s) on an image track measured against the page only`);
    if (!res.measured) res.applicable = false;
    return done(res);
  }
  function focusRing(): LedgerResult {
    reset();
    const res = newResult("G11b-focus");
    const page = pageBg();
    const groups = ["main a[href]", ".th-sort", ".seg > button", ".chips > button", ".mgr-chips > button", ".note-btn",
      ".pager-btn", ".compact-toggle", "main summary", "main input:not([type=hidden])", "main select"];
    const x0 = window.scrollX, y0 = window.scrollY;
    for (const sel of groups) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => isVisible(e) && hasBox(e));
      if (!el) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) { unmeasured(res, { el: describe(el), detail: `${sel}: not focusable` }); continue; }
      if (!el.matches(":focus-visible")) { unmeasured(res, { el: describe(el), detail: `${sel}: focus did not match :focus-visible` }); el.blur(); continue; }
      const cs = getComputedStyle(el);
      res.measured++;
      let color: RGBA | null = null;
      if (cs.outlineStyle !== "none" && px(cs.outlineWidth) > 0) {
        if (cs.outlineStyle === "auto") { res.notes.push(`${sel}: the UA's two-tone auto ring`); el.blur(); continue; }
        color = parseColor(cs.outlineColor);
      } else {
        const ring = shadows(cs.boxShadow).find((s) => !s.inset && s.spread > 0 && s.color && s.color[3] > 0);
        color = ring?.color ?? null;
      }
      if (!color) fail(res, { el: describe(el), detail: `${sel} ${describe(el)}: no focus indicator (outline none, no ring)` });
      else {
        const ratio = contrast(over(color, page), page);
        if (ratio < 3 - 0.005) fail(res, { el: describe(el), delta: r2(ratio - 3), detail: `${sel}: focus outline ${hex(color)} on the page ${hex(page)} = ${r2(ratio)}:1 (needs 3:1)` });
      }
      el.blur();
    }
    window.scrollTo({ left: x0, top: y0, behavior: "instant" });
    return done(res);
  }

  /* --------------------------------------------------- G12 hit areas */
  type Sq = { l: number; t: number; r: number; b: number };
  const squareOf = (b: Rect, min: number): Sq => {
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const w = Math.max(b.right - b.left, min), h = Math.max(b.bottom - b.top, min);
    return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  };
  const sqOverlap = (a: Sq, b: Sq): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  /** The sticky identity cell in `c`'s row that `c` is not in (the page's
      `stickyCellBeside`, read the same way: by computed position). */
  function stickyCellBeside(c: Element): Element | null {
    const own = c.closest("td, th");
    const tr = own?.parentElement;
    if (!own || !tr || tr.tagName !== "TR") return null;
    const sticky = Array.from(tr.children).find((x) => getComputedStyle(x).position === "sticky") ?? null;
    return sticky && sticky !== own ? sticky : null;
  }
  /** How the table-side clamp fits a square into its table. "shift" is the
      page's rule since M2 (scripts/hit-areas.ts `shiftInto`); "shrink" is the
      pre-fix rule — each side cut on its own, and the table's sides only, no
      sticky column — kept ONLY so a negative control can re-plant it and
      prove the size assertion below catches it. */
  type TableClamp = "shift" | "shrink";
  let tableClamp: TableClamp = "shift";
  /** The horizontal room inside a control's scrolling table (the page's
      `tableRoom`): its sides, and beside a sticky identity column that
      column's right edge as it sits now. null outside a scrolling table. */
  function tableRoom(c: Element): { l: number; r: number } | null {
    const table = scrollersOf(c).length ? c.closest("table") : null;
    if (!table) return null;
    const tb = table.getBoundingClientRect();
    let l = tb.left;
    const sticky = tableClamp === "shift" ? stickyCellBeside(c) : null;
    if (sticky) {
      const sr = sticky.getBoundingClientRect();
      if (sr.left < c.getBoundingClientRect().left) l = Math.max(l, sr.right);
    }
    return { l, r: tb.right };
  }
  function clampedSquare(c: Element, min: number): Sq {
    const s = squareOf(c.getBoundingClientRect(), min);
    if (c.closest("thead")) {
      const tr = c.closest("tr");
      if (tr) s.b = Math.min(s.b, tr.getBoundingClientRect().bottom);
    }
    /* the page's rule (scripts/hit-areas.ts): a control in a scrolling table
       never reaches past the table's sides, where its scroller shows nothing,
       nor under a sticky identity column; the square is SHIFTED into that
       room, keeping its full side unless the room is narrower (M2) */
    const room = tableRoom(c);
    if (room) {
      if (tableClamp === "shrink") {
        s.l = Math.max(s.l, room.l);
        s.r = Math.min(s.r, room.r);
      } else {
        if (s.r > room.r) { const d = s.r - room.r; s.l -= d; s.r -= d; }
        if (s.l < room.l) { const d = room.l - s.l; s.l += d; s.r += d; }
        if (s.r > room.r) s.r = room.r;
      }
    }
    return s;
  }
  function clipAt(s: Sq, own: Rect, nb: Rect): void {
    const gx = Math.max(nb.left - own.right, own.left - nb.right);
    const gy = Math.max(nb.top - own.bottom, own.top - nb.bottom);
    if (gx < 0 && gy < 0) return;
    if (gx >= gy) {
      if (nb.left >= own.right) s.r = Math.min(s.r, (own.right + nb.left) / 2);
      else s.l = Math.max(s.l, (nb.right + own.left) / 2);
    } else if (nb.top >= own.bottom) s.b = Math.min(s.b, (own.bottom + nb.top) / 2);
    else s.t = Math.max(s.t, (nb.bottom + own.top) / 2);
  }
  /* A control scrolled out of its box still has a box, under whatever sits
     beside the scroller; it is no target there. The page's clip
     (src/scripts/hit-areas.ts) treats two controls in ONE scroller as
     neighbours whatever the scroll (their spacing never changes), and two in
     different scrollers only by the parts each scroller leaves on screen. */
  function scrollersOf(el: Element): Element[] {
    const out: Element[] = [];
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/auto|scroll|hidden/.test(`${cs.overflowX} ${cs.overflowY}`)) out.push(a);
    }
    return out;
  }
  function onScreenPart(el: Element): Rect | null {
    const b = el.getBoundingClientRect();
    let v: Rect = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    for (const a of scrollersOf(el)) {
      const r = a.getBoundingClientRect();
      const l = r.left + a.clientLeft, t = r.top + a.clientTop;
      v = { left: Math.max(v.left, l), right: Math.min(v.right, l + a.clientWidth), top: Math.max(v.top, t), bottom: Math.min(v.bottom, t + a.clientHeight) };
      if (v.right - v.left < 1 || v.bottom - v.top < 1) return null;
    }
    return v;
  }
  /** The two rectangles a pair is split by right now, or null when the pair
      are not neighbours at this scroll (the page's rule, step for step). */
  function pairRects(c: Element, o: Element, min: number): [Rect, Rect] | null {
    if (!sqOverlap(clampedSquare(c, min), clampedSquare(o, min))) return null;
    if ((scrollersOf(c)[0] ?? null) === (scrollersOf(o)[0] ?? null)) return [c.getBoundingClientRect(), o.getBoundingClientRect()];
    const a = onScreenPart(c), b = onScreenPart(o);
    return a && b && sqOverlap(squareOf(a, min), squareOf(b, min)) ? [a, b] : null;
  }
  /* THE hit-area audit (M1 review Q-11): G12 over every control, and the
     holders and note lanes' target hit-tests (`hitMisses`), are this one
     function — they were three copies sampling 2px and 1px inside. Each
     measured control's square (max(box, --hit-min), clamped to its header row,
     split at the midpoint to every neighbour the page's own clip splits
     against) must return the control at its four corners, sampled 1px inside;
     its area must not reach the first body row; each neighbour pair's centres
     must return their own controls; and, with `inflation`, a fine-pointer
     control's own box is at most its text's height + 2px. */
  interface HitOpts {
    /** measure only controls matching this selector (the rest stay neighbours) */
    only?: string;
    /** measure at most this many of them */
    limit?: number;
    inflation?: boolean;
    /** the negative control's plant (see `TableClamp`); default "shift" */
    tableClamp?: TableClamp;
  }
  const frames = (n: number): Promise<void> =>
    new Promise((done) => {
      const step = (k: number): void => { if (k <= 0) done(); else requestAnimationFrame(() => step(k - 1)); };
      step(n);
    });
  async function hitAudit(name: string, opts: HitOpts = {}): Promise<LedgerResult> {
    tableClamp = opts.tableClamp ?? "shift";
    try {
      return await hitAuditRun(name, opts);
    } finally {
      tableClamp = "shift";
    }
  }
  async function hitAuditRun(name: string, opts: HitOpts): Promise<LedgerResult> {
    reset();
    const res = newResult(name);
    const env = envInfo();
    const min = env.expectedHitMin;
    res.notes.push(`hit square ${min}px (${env.desktopFine ? "fine pointer above 720px" : "coarse pointer or at/below 720px"}); --hit-min computes to ${env.computedHitMin}px`);
    if (!(Math.abs(env.computedHitMin - min) <= 0.5)) {
      fail(res, { el: ":root", detail: `--hit-min computes to ${env.computedHitMin}px here; the plan requires ${min}px` });
    }
    const ctls = Array.from(document.querySelectorAll<HTMLElement>(CONTROLS)).filter((c) => isVisible(c) && hasBox(c));
    let targets = opts.only
      ? Array.from(document.querySelectorAll<HTMLElement>(opts.only)).filter((c) => isVisible(c) && hasBox(c))
      : ctls;
    if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
    const all = [...new Set([...ctls, ...targets])];
    const x0 = window.scrollX, y0 = window.scrollY;
    /* candidate neighbours, widened by a whole square on each side: the
       table-side clamp SHIFTS a square by up to its side, and beside a sticky
       column it depends on the inner scroll, which changes below — each pair
       is then decided at the scroll it is measured at (`pairRects`) */
    const doc = all.map((c) => {
      const s = clampedSquare(c, min);
      return { l: s.l + x0 - min, r: s.r + x0 + min, t: s.t + y0, b: s.b + y0 };
    });
    const order = all.map((_c, i) => i).sort((a, b) => doc[a]!.t - doc[b]!.t);
    const nbrs: number[][] = all.map(() => []);
    for (let a = 0; a < order.length; a++) {
      const i = order[a]!;
      for (let k = a + 1; k < order.length; k++) {
        const j = order[k]!;
        if (doc[j]!.t >= doc[i]!.b) break;
        if (sqOverlap(doc[i]!, doc[j]!) && !all[i]!.contains(all[j]!) && !all[j]!.contains(all[i]!)) {
          nbrs[i]!.push(j);
          nbrs[j]!.push(i);
        }
      }
    }
    const hitOk = (target: Element, x: number, y: number): Element | null => {
      const h = document.elementFromPoint(x, y);
      return h && (h === target || target.contains(h)) ? null : h ?? document.documentElement;
    };
    const checkedPairs = new Set<string>();
    const measure = new Set(targets);
    /* every inner scroller a scrollIntoView moves is put back afterwards, so
       the checks that run after this one on the same page see it at rest */
    const scrolled = new Map<Element, [number, number]>();
    let shifted = 0;
    for (let i = 0; i < all.length; i++) {
      const c = all[i]!;
      if (!measure.has(c)) continue;
      const inner: [Element, number, number][] = [];
      for (let a = c.parentElement; a; a = a.parentElement) {
        if (a.scrollWidth > a.clientWidth || a.scrollHeight > a.clientHeight) {
          if (!scrolled.has(a)) scrolled.set(a, [a.scrollLeft, a.scrollTop]);
          if (a !== document.body && a !== document.documentElement) inner.push([a, a.scrollLeft, a.scrollTop]);
        }
      }
      c.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      /* An inner scroller that moved makes the page re-run its clip on the
         next frame (hit-areas.ts listens for inner scrolls; the sticky-column
         room depends on the scroll). Sample what the page draws THEN, as a
         pointer arriving after the scroll would. */
      if (inner.some(([a, l, t]) => a.scrollLeft !== l || a.scrollTop !== t)) await frames(3);
      const own = c.getBoundingClientRect();
      const s = clampedSquare(c, min);
      /* The table-side clamp keeps the whole square (M2 follow-up to the M1
         delta review): after it — and before the midpoint clip, which may
         rightly shorten a square between two close neighbours (H-16) — a
         square is at least --hit-min on each axis, unless its room is
         narrower (the table's sides, less a sticky identity column). The
         header row still ends a header control's square (H-16), so the
         vertical is held to that row. */
      const room = tableRoom(c);
      if (room) {
        const wantW = Math.min(Math.max(own.width, min), room.r - room.l);
        const head = c.closest("thead") ? c.closest("tr") : null;
        const wantH = head ? Math.min(Math.max(own.height, min), head.getBoundingClientRect().bottom - s.t) : Math.max(own.height, min);
        const sq0 = squareOf(own, min);
        if (Math.abs(s.l - sq0.l) > 0.5) shifted++;
        if (s.r - s.l < wantW - 0.5 || s.b - s.t < wantH - 0.5) {
          const lbl = `${describe(c)} "${(c.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 16)}"`;
          fail(res, {
            el: lbl,
            detail: `${lbl}: the table-side clamp left a ${r1(s.r - s.l)}×${r1(s.b - s.t)} square (needs ${r1(wantW)}×${r1(wantH)}: --hit-min ${min}px, room ${r1(room.r - room.l)}px) — shortened, not shifted`,
          });
        }
      }
      for (const j of nbrs[i]!) {
        const pr = pairRects(c, all[j]!, min);
        if (pr) clipAt(s, pr[0], pr[1]);
      }
      res.measured++;
      const label = `${describe(c)} "${(c.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 16)}"`;
      const bad: string[] = [];
      /* Sampled 1px inside the square, on the PIXEL GRID a pointer lands on:
         the square's edges are snapped inward to whole pixels first. At a 2px
         corner radius (D-4) the point 1px in from a snapped corner is √2px
         from the arc's centre, inside the arc; the same point taken from an
         unsnapped fractional edge (309.42 → 308.42) can fall past the arc,
         which is no pixel a finger or cursor can land on. */
      const IN = 1;
      const L = Math.ceil(s.l) + IN, R = Math.floor(s.r) - IN, T = Math.ceil(s.t) + IN, B = Math.floor(s.b) - IN;
      /* a corner past the viewport edge is sampled at the edge: no finger
         lands off screen, and the on-screen part must still be the control's */
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const onVp = (v: number, max: number) => Math.min(Math.max(v, IN), max - IN);
      for (const [x0c, y0c, n] of [[L, T, "top-left"], [R, T, "top-right"], [L, B, "bottom-left"], [R, B, "bottom-right"]] as const) {
        const x = onVp(x0c, vw), y = onVp(y0c, vh);
        const h = hitOk(c, x, y);
        if (h) bad.push(`${n} (${r1(x)},${r1(y)}) → ${describe(h)}`);
      }
      if (bad.length) {
        fail(res, { el: label, detail: `${label}: hit square ${r1(s.r - s.l)}×${r1(s.b - s.t)} corners miss: ${bad.join("; ")}` });
      }
      if (opts.inflation && env.desktopFine) {
        const range = document.createRange();
        range.selectNodeContents(c);
        const text = range.getBoundingClientRect();
        if (text.height > 0 && own.height > text.height + 2) {
          fail(res, { el: label, detail: `${label}: its box is ${r1(own.height)}px tall, its text ${r1(text.height)}px — the hit area inflates layout` });
        }
      }
      /* a header control's area never reaches into the first body row (H-16) */
      const head = c.closest("thead");
      const tr = c.closest("tr");
      const table = c.closest("table");
      if (head && tr && table) {
        const rowB = tr.getBoundingClientRect().bottom;
        const body = Array.from(table.tBodies).flatMap((tb) => Array.from(tb.rows)).find((r) => isVisible(r) && hasBox(r));
        if (body && body.getBoundingClientRect().top < rowB + 3) {
          const y = rowB + 2;
          const x = (own.left + own.right) / 2;
          const h = document.elementFromPoint(x, y);
          if (h && (h === c || c.contains(h))) {
            fail(res, { el: label, detail: `${label}: its hit area reaches into the first body row (${r1(x)},${r1(y)} returns the header control)` });
          }
        }
      }
      /* each pair once, both centres: each must return its own control */
      for (const j of nbrs[i]!) {
        const key = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (checkedPairs.has(key)) continue;
        const pr = pairRects(c, all[j]!, min);
        if (!pr) continue; // not neighbours at this scroll
        checkedPairs.add(key);
        for (const [who, by, r] of [[all[j]!, c, pr[1]], [c, all[j]!, pr[0]]] as const) {
          const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
          const h = hitOk(who, cx, cy);
          if (h) {
            fail(res, {
              el: `${describe(who)}`,
              detail: `neighbour ${describe(who)}'s centre (${r1(cx)},${r1(cy)}) returns ${describe(h)}, not the neighbour (beside ${describe(by)})`,
            });
          }
        }
      }
    }
    res.notes.push(`table-side clamp: ${shifted} square(s) shifted inside their table`);
    res.sub = { ...(res.sub ?? {}), shifted };
    for (const [a, [l, t]] of scrolled) { a.scrollLeft = l; a.scrollTop = t; }
    window.scrollTo({ left: x0, top: y0, behavior: "instant" });
    return done(res);
  }
  function g12(opts?: { tableClamp?: TableClamp }): Promise<LedgerResult> {
    return hitAudit("G12", { tableClamp: opts?.tableClamp });
  }
  function hits(opts: { only: string; limit?: number }): Promise<LedgerResult> {
    return hitAudit("hits", { only: opts.only, limit: opts.limit, inflation: true });
  }

  /* ------------------------------------- T1.2 / T1.6 companion checks */
  function headFont(): LedgerResult {
    reset();
    const res = newResult("headFont");
    const agg = aggregator(res);
    for (const t of visibleTables(LEDGER)) {
      if (nested(t)) continue;
      const hr = headerRow(t);
      if (!hr || !isVisible(hr)) continue;
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      Array.from(hr.cells).forEach((cell, c) => {
        if (!isVisible(cell)) return;
        for (const run of textRuns(cell, true)) {
          const cs = getComputedStyle(run.parent);
          res.measured++;
          const fam = cs.fontFamily.split(",")[0]!.replace(/["']/g, "").trim();
          const size = px(cs.fontSize);
          const ls = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
          const bad: string[] = [];
          if (fam !== "JetBrains Mono") bad.push(`family ${fam}`);
          if (cs.fontWeight !== "600") bad.push(`weight ${cs.fontWeight}`);
          if (Math.abs(size - 9.5) > 0.01) bad.push(`size ${r2(size)}px`);
          if (Math.abs(ls - 0.12 * size) > 0.05) bad.push(`letter-spacing ${r2(ls)}px (.12em = ${r2(0.12 * size)}px)`);
          if (cs.textTransform !== "uppercase") bad.push(`transform ${cs.textTransform}`);
          if (bad.length) {
            agg.add(`${tableIndex}|${c}|${bad.join()}`, {
              table, tableIndex, column: colLabel(cell, c), columnIndex: c,
              detail: `header "${run.text.slice(0, 20)}": ${bad.join(", ")} (spec: JetBrains Mono 600 9.5px, .12em, uppercase)`,
            });
          }
        }
      });
    }
    agg.flush();
    return done(res);
  }
  function oneFlex(): LedgerResult {
    reset();
    const res = newResult("oneFlex");
    for (const t of visibleTables(LEDGER)) {
      if (nested(t) || t.matches(".reference-feed, [data-multiline]")) continue;
      const table = tableLabel(t);
      const tableIndex = allTables().indexOf(t);
      const hr = headerRow(t);
      const ref = hr ?? bodyRows(t)[0] ?? null;
      if (!ref) continue;
      const map = colMap(ref);
      const uniq = [...new Set(
        map.map((e) => (e.cell.classList.contains("c-flex") ? map.findIndex((x) => x.cell === e.cell) : -1)).filter((i) => i >= 0),
      )];
      res.measured++;
      if (uniq.length !== 1) { fail(res, { table, tableIndex, detail: `${uniq.length} c-flex columns (exactly one: D-1)${uniq.length ? ` at ${uniq.join(", ")}` : ""}` }); continue; }
      const c = uniq[0]!;
      if (t.closest(".design-history") && c !== 0) fail(res, { table, tableIndex, columnIndex: c, detail: `a filing history's flexible column is its first (D-1), found column ${c}` });
      /* the first body row that is a data row: an empty-state or separator
         row is one cell spanning the table, and has no column to check */
      const body = bodyRows(t).find((r) => !(r.cells.length === 1 && r.cells[0]!.colSpan > 1));
      if (hr && body) {
        const cell = colMap(body)[c]?.cell;
        if (cell && !cell.classList.contains("c-flex")) fail(res, { table, tableIndex, columnIndex: c, detail: "the header is c-flex but the body cells of that column are not" });
      }
    }
    return done(res);
  }
  function metaTruncation(): LedgerResult {
    reset();
    const res = newResult("metaTruncation");
    for (const n of Array.from(document.querySelectorAll(".panel-note"))) {
      if (!isVisible(n) || !hasBox(n)) continue;
      const cs = getComputedStyle(n);
      res.measured++;
      const why: string[] = [];
      if (cs.textOverflow === "ellipsis") why.push("text-overflow: ellipsis");
      const clips = cs.overflowX !== "visible";
      if (clips && /nowrap|pre$/.test(cs.whiteSpace)) why.push(`overflow ${cs.overflowX} with white-space ${cs.whiteSpace}`);
      if (clips && n.scrollWidth > n.clientWidth + 1) why.push(`clipped: ${n.scrollWidth} > ${n.clientWidth}`);
      const clamp = cs.getPropertyValue("-webkit-line-clamp");
      if (clamp && clamp !== "none") why.push(`line-clamp ${clamp}`);
      if (why.length) fail(res, { el: describe(n), detail: `band meta "${(n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}" can truncate: ${why.join("; ")}` });
    }
    return done(res);
  }
  function controlHeights(): LedgerResult {
    reset();
    const res = newResult("controlHeights");
    const env = envInfo();
    if (!env.desktopFine) {
      res.applicable = false;
      res.notes.push("applies at a fine pointer above 720px only");
      return done(res);
    }
    for (const el of Array.from(document.querySelectorAll(SEGMENT_ITEMS))) {
      if (!isVisible(el) || !hasBox(el)) continue;
      const h = el.getBoundingClientRect().height;
      res.measured++;
      if (h < 24 - 0.01 || h > 26 + 0.01) fail(res, { el: describe(el), delta: r2(h - 25), detail: `${describe(el)} "${(el.textContent ?? "").trim().slice(0, 16)}" is ${r2(h)}px tall (24–26 at 1440 fine)` });
    }
    for (const b of Array.from(document.querySelectorAll(".th-sort"))) {
      if (!isVisible(b) || !hasBox(b)) continue;
      const e = textEdge(b);
      if (!e) continue;
      const h = b.getBoundingClientRect().height;
      res.measured++;
      if (h > e.bottom - e.top + 2 + 0.01) fail(res, { el: describe(b), delta: r2(h - (e.bottom - e.top) - 2), detail: `sort button "${stripMarks(b.textContent ?? "").slice(0, 16)}" is ${r2(h)}px tall over a ${r2(e.bottom - e.top)}px text box (+2 at most)` });
      const th = b.closest("th");
      if (th) {
        const th_h = th.getBoundingClientRect().height;
        if (th_h > 25 + 0.01) fail(res, { el: describe(th), delta: r2(th_h - 25), detail: `sortable header cell "${stripMarks(th.textContent ?? "").slice(0, 16)}" is ${r2(th_h)}px tall (≤25)` });
      }
    }
    return done(res);
  }

  function census(): LedgerCensus {
    reset();
    const detail: string[] = [];
    let tables = 0, columns = 0;
    for (const t of visibleTables("table")) {
      if (nested(t)) continue;
      const rows = bodyRows(t);
      if (!rows.length) continue;
      const hr = headerRow(t);
      const n = hr ? colMap(hr).length : colMap(rows[0]!).length;
      tables++;
      columns += n;
      detail.push(`${tableLabel(t)}: ${rows.length} rows × ${n} cols`);
    }
    return { tables, columns, detail };
  }

  window.__ledger = {
    env: envInfo, census, g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g11b, focusRing, g12, hits,
    headFont, oneFlex, metaTruncation, controlHeights,
  };
}

/** The harness skip rule (T-12): off the owner-tier build a check with
    nothing to run on may skip; with POPULUS_BUILD_DIR set (the full data
    build, where every route and page must exist) the same skip is a failure,
    because a skipped check there is an unrun check reading as covered. */
export function skipDecision(
  env: Record<string, string | undefined>,
  reason: string,
): { skip: string } | { fail: string } {
  return env.POPULUS_BUILD_DIR
    ? { fail: `would skip (${reason}), but POPULUS_BUILD_DIR is set: on the owner-tier build a skip is a failure` }
    : { skip: reason };
}

/** Install the probe in the current document (idempotent per document). */
export async function installProbe(page: Page): Promise<void> {
  await page.evaluate(installLedgerProbe);
}

/** The probe's predicates, by name (everything but `env` and `census`). */
export type PredicateName = Exclude<keyof LedgerProbe, "env" | "census">;

/** Run one predicate by name in the page (installing the probe first). */
export async function probe(page: Page, name: PredicateName, arg?: unknown): Promise<LedgerResult> {
  await installProbe(page);
  return page.evaluate(
    ([n, a]) => (window.__ledger![n as PredicateName] as (x?: unknown) => LedgerResult)(a),
    [name, arg] as const,
  );
}

/** The lanes' target hit-test, through the ONE audit G12 runs (M1 review
    Q-11): settles (fonts, then two frames for the page's midpoint clip), then
    returns every miss for the first `limit` controls matching `selector`. A
    selector that matches nothing is itself a miss. */
export async function hitMisses(page: Page, selector: string, limit = 6): Promise<string[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const r = await probe(page, "hits", { only: selector, limit });
  const out = r.failures.map((f) => f.detail);
  if (r.failureCount > r.failures.length) out.push(`… ${r.failureCount - r.failures.length} more`);
  if (r.measured === 0) out.push(`no visible ${selector} to measure`);
  return out;
}

/** The body backgrounds the two themes must paint (success criteria, the
    theme paragraph): a dark pass cannot stand in for light, or the reverse. */
export const THEME_BACKGROUND = { dark: "rgb(4, 7, 13)", light: "rgb(250, 249, 245)" } as const;
export type Theme = keyof typeof THEME_BACKGROUND;

/** null when the body paints `theme`'s background, else what it paints. */
export async function themeBackgroundProblem(page: Page, theme: Theme): Promise<string | null> {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  return bg === THEME_BACKGROUND[theme]
    ? null
    : `body background is ${bg}, the ${theme} theme paints ${THEME_BACKGROUND[theme]}`;
}

/** A readable summary of a result for an assertion message. */
export function formatResult(r: LedgerResult, max = 25): string {
  const lines = [
    `${r.check}: ${r.failureCount} failure(s), measured ${r.measured}, unmeasured ${r.unmeasuredCount}, excluded ${r.excludedCount}`,
    ...r.notes.map((n) => `  note: ${n}`),
    ...r.failures.slice(0, max).map((f) => {
      const where = [f.table, f.column, f.row !== undefined ? `row ${f.row}` : "", f.count && f.count > 1 ? `×${f.count}` : ""]
        .filter(Boolean)
        .join(" ");
      return `  - ${where ? where + ": " : ""}${f.detail}${f.delta !== undefined ? ` (Δ ${f.delta})` : ""}`;
    }),
  ];
  if (r.failures.length > max) lines.push(`  … ${r.failureCount - max} more`);
  return lines.join("\n");
}
