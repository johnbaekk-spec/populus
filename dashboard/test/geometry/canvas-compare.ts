/* DESIGN-POLISH T2.9 (R29, R30) — the design-canvas comparison.

   `design-reference.spec.ts` renders each supplied `.dc.html` (the owner's
   design canvas, docs/design/reference) through `page.route`, measures it with
   `measurePage("canvas")`, measures the live route with `measurePage("route")`,
   and hands both to `compareBands`. Every value on the design side is MEASURED
   from the rendered canvas (its computed style and boxes), never typed in
   here: a canvas edit moves the expectation with it.

   What is compared, per band that has a counterpart on the route:
   - the header ledger: label, value and sub roles, the label-to-value gap,
     the gap between figures, and each value's tone (its colour is its
     figure's `--tone-*` token, and a figure the canvas also shows takes the
     canvas's tone);
   - the summary card: padding, tag/title/body roles, the tag's tone by
     position (D-12), the body colour, and the two inner gaps;
   - band heads: title and meta roles, the meta colour, the title/meta
     baseline and the control's centring (G10's own rules, ±1px), and a
     pair's two heads on one line (as the canvas's pair, + 2px);
   - tables: header font roles (family, weight, size, letter-spacing,
     rendered caps) of every `th` and the header colour; the table's base
     body font and, per column the canvas band also draws (matched by header
     label), its cells' type (a data cell's case is its data's); single-line
     row height; gutter x (first text on band left + gutter, last text on
     band right − gutter, on a right-aligned last column); the content-box
     column gap on the header and the first body rows; and the kind column —
     the word the canvas prints for the row's `data-edge`, its text and edge
     colour, its type, and no pill background;
   - segmented controls: outline, dividers, item type, inactive, active and
     tinted colours, height.
   `segTokenFindings` adds the D-4 token checks on every group of a route.

   A difference passes ONLY when `ALLOWED_DEVIATIONS` holds an entry for it,
   and that entry names its record (L3–L6, L13–L16, a section A adoption, a
   numbered departure, or the section B token table the plan specifies) AND
   bounds what production must show instead. Anything else is an unrecorded
   difference and fails (control: a planted 13px header on one band).

   All in-page code lives in ONE self-contained function (`measurePage`),
   serialized into the page by Playwright, so nothing here may close over
   module scope. */

import type { Page } from "@playwright/test";
import path from "node:path";
import { CURRENT_MILESTONE, milestoneIndex, type Milestone } from "./milestones.ts";

export const REFERENCE_DIR = path.resolve(import.meta.dirname, "../../../docs/design/reference");
const CANVAS_ORIGIN = "http://design-reference.local";

/* ------------------------------------------------------------------ types */

export interface Role {
  family: string;
  weight: number;
  size: number;
  /** letter-spacing in em, 3 decimals (normal = 0) */
  tracking: number;
  /** the text RENDERS in capitals: an uppercase transform, or caps in the
      source; null when the text has no letters (a "#" header) */
  caps: boolean | null;
}

export interface LedgerFigure {
  label: string;
  labelRole: Role;
  labelColor: string;
  valueRole: Role;
  valueColor: string;
  subRole: Role | null;
  /** route only: data-tone, and the colour its `--tone-*` token resolves to */
  tone: string | null;
  toneColor: string | null;
  /** value box top − label box bottom */
  labelToValue: number;
  left: number;
  right: number;
  valueTop: number;
}

export interface Card {
  padding: [number, number, number, number];
  tagRole: Role;
  tagColor: string;
  titleRole: Role;
  titleColor: string;
  bodyRole: Role;
  bodyColor: string;
  tagToTitle: number;
  titleToBody: number;
}

export interface Head {
  title: string;
  titleRole: Role;
  metaRole: Role | null;
  metaColor: string | null;
  /** meta baseline − title baseline, when the meta sits on the title's line */
  baselineDelta: number | null;
  /** the meta wrapped below the title (departure 10: it wraps, never cut) */
  metaWrapped: boolean;
  /** control centre − head-row centre (G10's rule), when the head carries one */
  controlOffset: number | null;
  titleBaseline: number;
  top: number;
  /** route: the head's band is a pair collapsed under the empty-state rule */
  collapsed: boolean;
}

export interface KindCell {
  word: string;
  /** the canvas rule book's FAMILY cell beside the kind (signals) */
  family: string | null;
  color: string;
  edge: string | null;
  /** route only: the row's data-edge */
  dataEdge: string | null;
  /** the kind word's type, and its background (a caps word, never a pill) */
  role: Role;
  background: string;
  /** route: the word is a `.qoq-chip` pill (the filer's position changes) */
  chip: boolean;
}

export interface Gap {
  /** the column the gap sits before (its header label) */
  before: string;
  gap: number;
  numeric: boolean;
}

export interface Table {
  title: string;
  headerRoles: { label: string; role: Role; color: string; sorted: boolean }[];
  /** the table's own body font (the canvas row's; the route table element's) */
  bodyRole: Role | null;
  /** per column: its header label (normalized) and its body cells' role */
  columns: { label: string; role: Role | null }[];
  rowHeights: number[];
  gutterL: number | null;
  gutterR: number | null;
  /** the last column is right-aligned, so its text edge IS the right gutter */
  lastRight: boolean;
  gaps: Gap[];
  kinds: KindCell[];
  multiline: boolean;
  compact: boolean;
  grid: boolean;
  rows: number;
  /** the band this table sits in is a pair collapsed under the empty-state rule */
  collapsed: boolean;
}

export interface SegItem {
  text: string;
  color: string;
  background: string;
  dividerWidth: number;
  dividerColor: string;
  active: boolean;
  cue: string | null;
  height: number;
  role: Role;
  tinted: boolean;
}

export interface Seg {
  label: string;
  borderWidth: number;
  borderColor: string;
  items: SegItem[];
}

export interface Tokens {
  [name: string]: string;
}

export interface PageMeasure {
  /** canvas: its ink, the H1's colour (the neutral ledger figures' colour) */
  ink: string;
  /** route: every band, and whether it collapsed under the empty-state rule */
  bands: { cls: string; collapsed: boolean }[];
  ledger: LedgerFigure[];
  cards: Card[];
  heads: Head[];
  tables: Table[];
  segs: Seg[];
  tokens: Tokens;
}

export interface MeasureArg {
  kind: "canvas" | "route";
  /** route: the tables to measure, each under the label the comparison uses */
  tables?: { label: string; selector: string }[];
  /** route: restrict segmented groups to this selector (default: every group) */
  segs?: string;
}

/* ------------------------------------------------------------ the canvas */

/** Serve docs/design/reference under a private origin and open one canvas at
    its 1440px screen (the canvas section adds 40px of padding each side). */
export async function openCanvas(page: Page, file: string): Promise<void> {
  await page.setViewportSize({ width: 1520, height: 1000 });
  await page.route(`${CANVAS_ORIGIN}/**`, async (route) => {
    const requested = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
    const target = path.resolve(REFERENCE_DIR, requested);
    if (!target.startsWith(REFERENCE_DIR + path.sep)) return route.abort();
    await route.fulfill({
      path: target,
      contentType: requested.endsWith(".js") ? "text/javascript" : requested.endsWith(".woff2") ? "font/woff2" : "text/html",
    });
  });
  await page.goto(`${CANVAS_ORIGIN}/${encodeURIComponent(file)}`);
  await page.locator("[data-screen-label]").first().waitFor();
  /* the canvas is a template until its runtime fills every {{ … }} */
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-screen-label]");
    return !!root && !root.textContent!.includes("{{") && root.querySelectorAll("div").length > 50;
  });
  await page.evaluate(() => document.fonts.ready);
}

/* ------------------------------------------------------ in-page measure */

/** Measure the canvas or the route. Self-contained: serialized into the page. */
export function measurePage(arg: MeasureArg): PageMeasure {
  const MARKS = /[§†‡≈¶ⓘ↓↑↗◂▸]/g;
  const px = (v: string | null | undefined): number => {
    const n = parseFloat(v ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  function hex(c: string): string {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c;
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3]! : 1;
    const h = "#" + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
    return a < 1 ? `${h}@${Math.round(a * 100) / 100}` : h;
  }
  function inClosedDetails(el: Element): boolean {
    let child: Element = el;
    for (let p = el.parentElement; p; child = p, p = p.parentElement) {
      if (p instanceof HTMLDetailsElement && !p.open && !(child.tagName === "SUMMARY" && p.querySelector(":scope > summary") === child)) return true;
    }
    return false;
  }
  function visible(el: Element | null): el is Element {
    if (!el) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (inClosedDetails(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function excludedText(p: Element): boolean {
    /* marks and mark triggers hang in the mark slot; carets, footnote
       references, watch stars and hidden text are not the reader's text */
    return !!p.closest(".hang, .sort-caret, .note-btn:not(.note-label), .fn-ref, .star-btn, .reference-watch, .note-pop, .visually-hidden, .sr-only, [aria-hidden='true'], script, style, template");
  }
  function textNodes(root: Element): Text[] {
    const out: Text[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n as Text;
      if (!(t.nodeValue ?? "").replace(MARKS, "").trim()) continue;
      const p = t.parentElement;
      if (!p || excludedText(p) || !visible(p)) continue;
      out.push(t);
    }
    return out;
  }
  /** The element that hosts the first real text inside `el` (marks, carets and
      hidden text skipped): the role a reader sees is that element's style. */
  function host(el: Element): Element {
    return textNodes(el)[0]?.parentElement ?? el;
  }
  function textOf(el: Element): string {
    return textNodes(el).map((t) => t.nodeValue ?? "").join(" ").replace(MARKS, "").replace(/\s+/g, " ").trim();
  }
  /** a header label for matching columns across the canvas and the route */
  function norm(label: string): string {
    return label.toUpperCase().replace(/[§†‡≈¶ⓘ↓↑↗◂▸·]/g, " ").replace(/\s+/g, " ").trim();
  }
  function modeRole(roles: Role[]): Role | null {
    const m = new Map<string, { r: Role; n: number }>();
    for (const r of roles) { const k = JSON.stringify(r); const c = m.get(k); if (c) c.n++; else m.set(k, { r, n: 1 }); }
    let best: { r: Role; n: number } | null = null;
    for (const v of m.values()) if (!best || v.n > best.n) best = v;
    return best ? best.r : null;
  }
  /** `byContent` false: a body role, whose caps come from the transform only
      (a row of tickers is not a caps role). */
  function role(el: Element, byContent = true): Role {
    const cs = getComputedStyle(el);
    const size = px(cs.fontSize);
    const fam = /mono/i.test(cs.fontFamily) ? "mono" : /plex sans/i.test(cs.fontFamily) ? "sans" : cs.fontFamily.split(",")[0]!.trim();
    /* caps in the source: at least 80% of the letters are capitals (a meta
       like "FROM PTRs · 12M" is a caps role with one lower-case plural) */
    const letters = byContent ? textOf(el).replace(/[^A-Za-z]/g, "") : "x";
    const upper = letters.replace(/[^A-Z]/g, "").length;
    const caps = cs.textTransform === "uppercase" ? true : !byContent ? false : letters.length ? upper / letters.length >= 0.8 : null;
    return {
      family: fam,
      weight: Number(cs.fontWeight),
      size,
      tracking: cs.letterSpacing === "normal" ? 0 : Math.round((px(cs.letterSpacing) / size) * 1000) / 1000,
      caps,
    };
  }
  function textRect(el: Element): { left: number; right: number; top: number; bottom: number } | null {
    let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
    for (const t of textNodes(el)) {
      const v = t.nodeValue ?? "";
      /* trim white space and hanging marks from both ends of the run */
      let i = 0, j = v.length;
      while (i < j && /[\s§†‡≈¶ⓘ↓↑↗]/.test(v[i]!)) i++;
      while (j > i && /[\s§†‡≈¶ⓘ↓↑↗]/.test(v[j - 1]!)) j--;
      if (j <= i) continue;
      const rg = document.createRange();
      rg.setStart(t, i);
      rg.setEnd(t, j);
      for (const q of Array.from(rg.getClientRects())) {
        if (q.width <= 0 || q.height <= 0) continue;
        L = Math.min(L, q.left); R = Math.max(R, q.right); T = Math.min(T, q.top); B = Math.max(B, q.bottom);
      }
    }
    for (const chip of Array.from(el.querySelectorAll(".flag, .qoq-chip, .nc-chip, .id-chip, span.mgr-chip, .badge-planned"))) {
      if (!visible(chip)) continue;
      const q = chip.getBoundingClientRect();
      L = Math.min(L, q.left); R = Math.max(R, q.right);
    }
    return L === Infinity ? null : { left: L, right: R, top: T, bottom: B };
  }
  function contentBox(el: Element): { left: number; right: number } {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), right: r.right - px(cs.borderRightWidth) - px(cs.paddingRight) };
  }
  let fontCtx: CanvasRenderingContext2D | null = null;
  function baseline(el: Element): number | null {
    const t = textNodes(el)[0];
    if (!t) return null;
    const p = t.parentElement!;
    const cs = getComputedStyle(p);
    if (!/flex|grid/.test(cs.display)) {
      const s = document.createElement("span");
      s.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline";
      t.parentNode!.insertBefore(s, t);
      const y = s.getBoundingClientRect().bottom;
      s.remove();
      return y;
    }
    if (!fontCtx) fontCtx = document.createElement("canvas").getContext("2d");
    if (!fontCtx) return null;
    fontCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const rg = document.createRange();
    rg.selectNodeContents(t);
    return rg.getClientRects()[0]!.top + fontCtx.measureText("Hxg").fontBoundingBoxAscent;
  }
  function resolveColor(el: Element, value: string): string {
    const s = document.createElement("span");
    s.style.color = value;
    s.style.display = "none";
    el.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return hex(c);
  }
  /** control centre − head-row centre, G10's rule: the row is the head's
      content box when every other child shares the control's line, else the
      union of the children that do. */
  function controlOffset(head: Element, ctl: Element): number | null {
    const cr = ctl.getBoundingClientRect();
    const kids = Array.from(head.children).filter(visible);
    const own = kids.find((k) => k.contains(ctl));
    const others = kids.filter((k) => k !== own);
    const same = others.filter((k) => { const r = k.getBoundingClientRect(); return r.top < cr.bottom && cr.top < r.bottom; });
    let top: number, bottom: number;
    if (!others.length || same.length === others.length) {
      const r = head.getBoundingClientRect();
      const cs = getComputedStyle(head);
      top = r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
      bottom = r.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    } else if (same.length) {
      top = Math.min(...same.map((k) => k.getBoundingClientRect().top));
      bottom = Math.max(...same.map((k) => k.getBoundingClientRect().bottom));
    } else return null;
    return r2((cr.top + cr.bottom) / 2 - (top + bottom) / 2);
  }
  function headOf(titleEl: Element, metaEl: Element | null, ctl: Element | null, ctlHead: Element | null): Head {
    const tb = baseline(titleEl);
    let baselineDelta: number | null = null, wrapped = false;
    if (metaEl) {
      const tr = titleEl.getBoundingClientRect(), mr = metaEl.getBoundingClientRect();
      if (mr.top < tr.bottom && tr.top < mr.bottom) {
        const mb = baseline(metaEl);
        if (tb !== null && mb !== null) baselineDelta = r2(mb - tb);
      } else wrapped = true;
    }
    const mh = metaEl ? host(metaEl) : null;
    return {
      title: textOf(titleEl),
      titleRole: role(host(titleEl)),
      metaRole: mh ? role(mh) : null,
      metaColor: metaEl ? hex(getComputedStyle(metaEl).color) : null,
      baselineDelta,
      metaWrapped: wrapped,
      controlOffset: ctl && ctlHead ? controlOffset(ctlHead, ctl) : null,
      titleBaseline: tb ?? NaN,
      top: titleEl.getBoundingClientRect().top + scrollY,
      collapsed: !!titleEl.closest('[data-collapsed="empty-state"]'),
    };
  }

  const out: PageMeasure = { ink: "", bands: [], ledger: [], cards: [], heads: [], tables: [], segs: [], tokens: {} };

  if (arg.kind === "canvas") {
    /* ============================================================ canvas */
    out.bands = [];
    const root = document.querySelector("[data-screen-label]")!;
    const all = Array.from(root.querySelectorAll<HTMLElement>("*"));
    const cs = (e: Element): CSSStyleDeclaration => getComputedStyle(e);
    const h1 = root.querySelector("h1");
    out.ink = h1 ? hex(cs(h1).color) : "";
    const isMono = (e: Element): boolean => /mono/i.test(cs(e).fontFamily);
    /* the ledger: every 26px mono value div; its figure is the parent */
    const values = all.filter((e) => e.tagName === "DIV" && cs(e).fontSize === "26px" && isMono(e) && e.previousElementSibling);
    for (const v of values) {
      const fig = v.parentElement!, label = v.previousElementSibling!, sub = v.nextElementSibling;
      const fr = fig.getBoundingClientRect();
      out.ledger.push({
        label: textOf(label), labelRole: role(host(label)), labelColor: hex(cs(host(label)).color),
        valueRole: role(host(v)), valueColor: hex(cs(host(v)).color), subRole: sub ? role(host(sub)) : null,
        tone: null, toneColor: null,
        labelToValue: r2(v.getBoundingClientRect().top - label.getBoundingClientRect().bottom),
        left: fr.left, right: fr.right, valueTop: v.getBoundingClientRect().top,
      });
    }
    /* summary cards: the 9.5px tag followed by the 13.5px title */
    const tags = all.filter((e) => e.tagName === "DIV" && cs(e).fontSize === "9.5px" && isMono(e) && e.nextElementSibling && cs(e.nextElementSibling).fontSize === "13.5px");
    for (const tag of tags) {
      const card = tag.parentElement!, title = tag.nextElementSibling!, body = title.nextElementSibling!;
      const c = cs(card);
      out.cards.push({
        padding: [px(c.paddingTop), px(c.paddingRight), px(c.paddingBottom), px(c.paddingLeft)],
        tagRole: role(host(tag)), tagColor: hex(cs(host(tag)).color),
        titleRole: role(host(title)), titleColor: hex(cs(host(title)).color),
        bodyRole: role(host(body)), bodyColor: hex(cs(host(body)).color),
        tagToTitle: r2(title.getBoundingClientRect().top - tag.getBoundingClientRect().bottom),
        titleToBody: r2(body.getBoundingClientRect().top - title.getBoundingClientRect().bottom),
      });
    }
    /* segmented controls: an inline-flex group with a 1px border and hidden
       overflow, its children the items */
    const isSeg = (e: Element): boolean => {
      const s = cs(e);
      /* a flex item's inline-flex computes to flex (blockified) */
      return /flex/.test(s.display) && px(s.borderTopWidth) === 1 && s.overflow === "hidden" && e.children.length >= 2;
    };
    for (const g of all.filter(isSeg)) {
      const gs = cs(g);
      out.segs.push({
        label: Array.from(g.children).map((i) => textOf(i)).join("|"),
        borderWidth: px(gs.borderTopWidth), borderColor: hex(gs.borderTopColor),
        items: Array.from(g.children).map((i) => {
          const s = cs(i);
          return {
            text: textOf(i), color: hex(s.color), background: hex(s.backgroundColor),
            dividerWidth: px(s.borderLeftWidth), dividerColor: hex(s.borderLeftColor),
            active: s.backgroundColor !== "rgba(0, 0, 0, 0)", cue: s.boxShadow === "none" ? null : s.boxShadow,
            height: r2(i.getBoundingClientRect().height), role: role(host(i)), tinted: false,
          };
        }),
      });
    }
    /* band heads: a 600 12–13px sans title in a flex head, the mono meta after it */
    const titles = all.filter((e) => {
      const s = cs(e);
      return e.tagName === "SPAN" && s.fontWeight === "600" && (s.fontSize === "13px" || s.fontSize === "12px") && !isMono(e) &&
        !!e.parentElement && /flex/.test(cs(e.parentElement).display) && textOf(e).length > 0;
    });
    const headByTitle = new Map<string, Element>();
    for (const t of titles) {
      const meta = t.nextElementSibling && isMono(t.nextElementSibling) ? t.nextElementSibling : null;
      /* the control sits in the head, or beside the head's title group */
      let ctlHead: Element | null = null, ctl: Element | null = null;
      for (let h: Element | null = t.parentElement, i = 0; h && i < 2; h = h.parentElement, i++) {
        const c = Array.from(h.children).find(isSeg) ?? null;
        if (c) { ctl = c; ctlHead = h; break; }
      }
      const head = headOf(t, meta, ctl, ctlHead);
      out.heads.push(head);
      headByTitle.set(head.title, t);
    }
    /* tables: a grid header row (600 9.5px mono) and the grid rows after it
       that share its tracks; header-less row lists (the filing-history
       triptych) are tables with no header */
    const grids = all.filter((e) => e.tagName === "DIV" && cs(e).display === "grid");
    const used = new Set<Element>();
    /* a table's band is named by the last band title before it (the feed's
       title sits in the view-tab row above its band) */
    const titleFor = (before: Element): string => {
      let best = "";
      for (const [title, el] of headByTitle) {
        if (el.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING) best = title;
      }
      return best;
    };
    for (const g of grids) {
      if (used.has(g)) continue;
      const s = cs(g);
      const isHeader = s.fontSize === "9.5px" && s.fontWeight === "600" && isMono(g) && g.children.length >= 2;
      const rows: Element[] = [];
      for (let n = g.nextElementSibling; n; n = n.nextElementSibling) {
        if (n.tagName !== "DIV" || cs(n).display !== "grid" || cs(n).gridTemplateColumns !== s.gridTemplateColumns) break;
        rows.push(n);
      }
      if (!isHeader) {
        /* a header-less list: this grid is its first row */
        const prev = g.previousElementSibling;
        if (prev && prev.tagName === "DIV" && cs(prev).display === "grid" && cs(prev).gridTemplateColumns === s.gridTemplateColumns) continue;
        if (rows.length < 1 || g.children.length < 2) continue;
        /* a band grid is not a row list: rows are one line of cells */
        if (g.getBoundingClientRect().height > 60) continue;
        rows.unshift(g);
      }
      for (const r of rows) used.add(r);
      used.add(g);
      const band = g.parentElement!;
      /* the band's padding box: a pair cell's 1px seam is not gutter */
      const bcs = cs(band), bre = band.getBoundingClientRect();
      const br = { left: bre.left + px(bcs.borderLeftWidth), right: bre.right - px(bcs.borderRightWidth) };
      const header = isHeader ? g : null;
      const first = (header ?? rows[0])!;
      /* gutters over the header and the body rows, as on the route */
      let gl = Infinity, gr = -Infinity;
      for (const r of [first, ...rows]) {
        const a = textRect(r.children[0]!), b = textRect(r.children[r.children.length - 1]!);
        if (a) gl = Math.min(gl, a.left);
        if (b) gr = Math.max(gr, b.right);
      }
      const gaps: Gap[] = [];
      const cellsForGaps = Array.from(first.children);
      for (let i = 1; i < cellsForGaps.length; i++) {
        const a = cellsForGaps[i - 1]!.getBoundingClientRect(), b = cellsForGaps[i]!.getBoundingClientRect();
        gaps.push({ before: textOf(header ? header.children[i]! : cellsForGaps[i]!), gap: r2(b.left - a.right), numeric: cs(cellsForGaps[i]!).textAlign === "right" });
      }
      const kinds: KindCell[] = [];
      /* the kind word: mono 600 10px .08em, in the first or (after the rule
         book's FAMILY) the second cell */
      const isKind = (k: Element | undefined): boolean => {
        if (!k) return false;
        const ks = cs(k);
        return ks.fontWeight === "600" && ks.fontSize === "10px" && Math.abs(px(ks.letterSpacing) - 0.8) < 0.05;
      };
      for (const r of rows) {
        const at = isKind(r.children[0]) ? 0 : isKind(r.children[1]) ? 1 : -1;
        if (at < 0) continue;
        const k = r.children[at]!;
        const rs = cs(r);
        kinds.push({
          word: textOf(k).toUpperCase(), family: at === 1 ? textOf(r.children[0]!).toUpperCase() : null,
          color: hex(cs(host(k)).color), edge: px(rs.borderLeftWidth) === 3 ? hex(rs.borderLeftColor) : null, dataEdge: null,
          role: role(host(k)), background: hex(cs(host(k)).backgroundColor), chip: false,
        });
      }
      out.tables.push({
        title: titleFor(first),
        headerRoles: header ? Array.from(header.children).map((c) => ({ label: textOf(c), role: role(host(c)), color: hex(cs(host(c)).color), sorted: false })) : [],
        bodyRole: rows[0] ? role(rows[0], false) : null,
        columns: header ? Array.from(header.children).map((h, i) => ({
          label: norm(textOf(h)),
          role: modeRole(rows.map((r) => r.children[i]).filter((c): c is Element => !!c && textNodes(c).length > 0).map((c) => role(host(c)))),
        })) : [],
        rowHeights: rows.map((r) => r2(r.getBoundingClientRect().height)),
        gutterL: gl === Infinity ? null : r2(gl - br.left),
        gutterR: gr === -Infinity ? null : r2(br.right - gr),
        lastRight: cs(first.children[first.children.length - 1]!).textAlign === "right",
        gaps, kinds,
        multiline: parseFloat(cs(rows[0] ?? g).lineHeight) / px(cs(rows[0] ?? g).fontSize) > 1.25,
        compact: false, grid: true, rows: rows.length, collapsed: false,
      });
    }
    return out;
  }

  /* ============================================================== route */
  /* the tokens the comparison reads, resolved in the page (so a theme or a
     token change moves them) */
  for (const n of [
    "--ink", "--ink2", "--ink3", "--ink-label", "--ink-meta", "--accent",
    "--tone-ink", "--tone-blue", "--tone-gold", "--tone-green",
    "--seg-border", "--seg-text", "--seg-fill", "--seg-text-active", "--seg-cue",
    "--kind-buy-text", "--kind-buy-edge", "--kind-sell-text", "--kind-sell-edge",
    "--kind-exch-text", "--kind-exch-edge", "--kind-late-text", "--kind-late-edge",
    "--kind-new-text", "--kind-new-edge", "--kind-trim-text", "--kind-trim-edge",
    "--kind-nochange-text", "--kind-nochange-edge", "--story-divider", "--buy", "--sell",
  ]) out.tokens[n] = resolveColor(document.body, `var(${n})`);

  for (const b of Array.from(document.querySelectorAll(".design-band, .design-rankings"))) {
    out.bands.push({ cls: b.className, collapsed: b.getAttribute("data-collapsed") === "empty-state" });
  }
  /* the header ledger */
  for (const dl of Array.from(document.querySelectorAll("dl.design-ledger"))) {
    if (!visible(dl)) continue;
    for (const fig of Array.from(dl.querySelectorAll(":scope > .ledger-fig"))) {
      const dt = fig.querySelector(":scope > dt"), v = fig.querySelector(":scope > .ledger-value"), sub = fig.querySelector(":scope > .ledger-sub");
      if (!dt || !v) continue;
      const tone = fig.getAttribute("data-tone");
      const fr = fig.getBoundingClientRect();
      out.ledger.push({
        label: textOf(dt).toUpperCase(), labelRole: role(host(dt)), labelColor: hex(getComputedStyle(host(dt)).color),
        valueRole: role(host(v)), valueColor: hex(getComputedStyle(host(v)).color), subRole: sub && visible(sub) ? role(host(sub)) : null,
        tone, toneColor: tone ? resolveColor(fig, `var(--tone-${tone})`) : null,
        labelToValue: r2(v.getBoundingClientRect().top - dt.getBoundingClientRect().bottom),
        left: fr.left, right: fr.right, valueTop: v.getBoundingClientRect().top,
      });
    }
  }
  /* summary cards (the caller opens a collapsed disclosure first) */
  for (const card of Array.from(document.querySelectorAll(".design-briefing .design-story"))) {
    if (!visible(card)) continue;
    const tag = card.querySelector(".design-story-tag"), title = card.querySelector("h2, h3"), body = card.querySelector("p");
    if (!tag || !title || !body) continue;
    const c = getComputedStyle(card);
    out.cards.push({
      padding: [px(c.paddingTop), px(c.paddingRight), px(c.paddingBottom), px(c.paddingLeft)],
      tagRole: role(host(tag)), tagColor: hex(getComputedStyle(host(tag)).color),
      titleRole: role(host(title)), titleColor: hex(getComputedStyle(host(title)).color),
      bodyRole: role(host(body)), bodyColor: hex(getComputedStyle(host(body)).color),
      tagToTitle: r2(title.getBoundingClientRect().top - tag.getBoundingClientRect().bottom),
      titleToBody: r2(body.getBoundingClientRect().top - title.getBoundingClientRect().bottom),
    });
  }
  /* band heads */
  const GROUPS = ":is(.seg, .chips, .mgr-chips):not(.si-watch-chips):not(#watch-chips)";
  for (const head of Array.from(document.querySelectorAll(".panel-head"))) {
    if (!visible(head)) continue;
    const title = head.querySelector(":scope > .section-h, :scope > h2, :scope > h3");
    if (!title || !visible(title)) continue;
    /* the meta: a panel note that is not only the derived-source tag */
    const notes = Array.from(head.querySelectorAll(":scope > .panel-note")).filter((m) => visible(m) && textNodes(m).length > 0);
    const meta = notes.find((m) => !textNodes(m).every((t) => t.parentElement!.closest(".src-derived"))) ?? notes[0] ?? null;
    const ctl = Array.from(head.querySelectorAll(GROUPS)).find(visible) ?? null;
    out.heads.push(headOf(title, meta, ctl, ctl ? head : null));
  }
  /* tables, by the caller's map: canvas-band title → selector */
  for (const { label: title, selector: sel } of arg.tables ?? []) {
    const t = Array.from(document.querySelectorAll<HTMLTableElement>(sel)).find(visible);
    if (!t) continue;
    const hr = t.tHead ? t.tHead.rows[t.tHead.rows.length - 1] ?? null : null;
    const ths = hr ? Array.from(hr.cells).filter(visible) : [];
    const rows = Array.from(t.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => visible(r) && !r.matches(".si-evidence-row"));
    const band = t.closest(".table-scroll") ?? t.parentElement!;
    const bb = band.getBoundingClientRect();
    const overflowing = band.scrollWidth > band.clientWidth + 1;
    const rightEdge = overflowing ? t.getBoundingClientRect().right : bb.right;
    let L = Infinity, R = -Infinity;
    for (const r of [...(hr && visible(hr) ? [hr] : []), ...rows.slice(0, 20)]) {
      const cells = Array.from(r.cells).filter(visible);
      if (!cells.length || cells.some((c) => c.colSpan > 1)) continue;
      const a = textRect(cells[0]!), b = textRect(cells[cells.length - 1]!);
      if (a) L = Math.min(L, Math.max(a.left, cells[0]!.getBoundingClientRect().left));
      if (b) R = Math.max(R, Math.min(b.right, cells[cells.length - 1]!.getBoundingClientRect().right));
    }
    /* content-box gaps on the header row and the first body rows (a cell
       rule can move the body without the header) */
    const gaps: Gap[] = [];
    for (const gapRow of [...(hr && visible(hr) ? [hr] : []), ...rows.slice(0, 6)]) {
      if (Array.from(gapRow.cells).some((c) => c.colSpan > 1)) continue;
      const cells = Array.from(gapRow.cells).filter(visible);
      for (let i = 1; i < cells.length; i++) {
        const a = cells[i - 1]!, b = cells[i]!;
        const aRight = contentBox(a).right + (a.classList.contains("has-marks") ? 14 : 0);
        const idx = Array.from(gapRow.cells).indexOf(b);
        gaps.push({ before: textOf(ths[idx] ?? b), gap: r2(contentBox(b).left - aRight), numeric: b.classList.contains("c-num") });
      }
    }
    const kinds: KindCell[] = [];
    const multiline = t.matches("[data-multiline]");
    for (const r of rows) {
      const k = r.querySelector(".c-kind");
      if (!k || !visible(k)) continue;
      const word = textOf(k).toUpperCase();
      if (!word) continue;
      const edgeEl = multiline ? r : r.cells[0]!;
      const sh = getComputedStyle(edgeEl).boxShadow;
      const m = sh.match(/(rgba?\([^)]+\))\s+3px\s+0px\s+0px\s+0px\s+inset|inset\s+3px\s+0px\s+0px\s+0px\s+(rgba?\([^)]+\))/);
      kinds.push({
        word, family: null, color: hex(getComputedStyle(host(k)).color), edge: m ? hex(m[1] ?? m[2]!) : null, dataEdge: r.getAttribute("data-edge"),
        role: role(host(k)), background: hex(getComputedStyle(host(k)).backgroundColor),
        chip: !!host(k).closest(".qoq-chip"),
      });
    }
    /* body roles: the table's own font (the ledger spec sets it on the
       table) and, per column, the most common role of its body cells */
    const bodyRows = rows.filter((r) => !Array.from(r.cells).some((c) => c.colSpan > 1)).slice(0, 12);
    const columns = ths.map((th, i) => ({
      label: norm(textOf(th)),
      role: modeRole(bodyRows.map((r) => r.cells[i]).filter((c): c is HTMLTableCellElement => !!c && visible(c) && textNodes(c).length > 0).map((c) => role(host(c)))),
    }));
    out.tables.push({
      title,
      headerRoles: ths.map((th) => ({ label: textOf(th), role: role(host(th)), color: hex(getComputedStyle(host(th)).color), sorted: /ascending|descending/.test(th.getAttribute("aria-sort") ?? "") })),
      bodyRole: role(t, false),
      columns,
      /* a colspan row is an empty-state or group line, not a ledger row */
      rowHeights: rows.filter((r) => !Array.from(r.cells).some((c) => c.colSpan > 1)).slice(0, 50).map((r) => r2(r.getBoundingClientRect().height)),
      gutterL: L === Infinity ? null : r2(L - (bb.left - band.scrollLeft)),
      gutterR: R === -Infinity ? null : r2(rightEdge - R),
      lastRight: (() => { const c = (hr && visible(hr) ? hr : rows[0])?.cells; const l = c ? c[c.length - 1] : null; return !!l && (l.classList.contains("c-num") || getComputedStyle(l).textAlign === "right"); })(),
      gaps, kinds, multiline,
      compact: t.matches(".etable-compact"),
      grid: t.matches(".reference-feed") || multiline,
      rows: rows.length,
      collapsed: !!t.closest('[data-collapsed="empty-state"]'),
    });
  }
  /* segmented groups */
  for (const g of Array.from(document.querySelectorAll(arg.segs ?? GROUPS))) {
    if (!visible(g) || !g.matches(GROUPS)) continue;
    const items = Array.from(g.children).filter((i) => i.matches("button, a") && visible(i));
    if (!items.length) continue;
    const gs = getComputedStyle(g);
    out.segs.push({
      label: items.map((i) => textOf(i)).join("|"),
      borderWidth: px(gs.borderTopWidth), borderColor: hex(gs.borderTopColor),
      items: items.map((i) => {
        const s = getComputedStyle(i);
        const active = i.matches('[aria-pressed="true"], [aria-current="true"], [aria-current="page"], [aria-checked="true"], .chip-active');
        return {
          text: textOf(i), color: hex(s.color), background: hex(s.backgroundColor),
          dividerWidth: px(s.borderLeftWidth), dividerColor: hex(s.borderLeftColor),
          active, cue: s.boxShadow === "none" ? null : s.boxShadow,
          height: r2(i.getBoundingClientRect().height), role: role(host(i)),
          tinted: /\btint-/.test(i.className),
        };
      }),
    });
  }
  return out;
}

/* ============================================================= compare */

/** A recorded deviation: the ONLY way a difference from the canvas passes.
    `id` is the comparison key it answers; `record` names the plan record;
    `production` is what the route must show instead — the entry bounds the
    difference, it never waives the property. */
export interface Deviation {
  id: string;
  record: string;
  canvas: string;
  production: string;
  /** a milestone-scoped allowance: it holds only while the tree's milestone
      sorts BEFORE this one, then expires by itself and the difference fails
      again (the M3 kind-vocabulary tasks, out of M2 scope) */
  until?: Milestone;
}

/** The allowed deviations, as data (T2.9: "allowing only the recorded
    deviations — L3–L6, L13–L16, the section A adoptions and the departures
    list"). Where the plan adopted the prototype's value instead of the
    canvas's, the entry says so. Entries citing the section B token tables
    (D-2, D-3) and section F (D-8) were accepted by the M2 lead. The four
    `until: "m3"` entries are the M3 kind-vocabulary tasks (T3.1, T3.2), out of
    M2 scope: `allowedAt` drops them once CURRENT_MILESTONE reaches m3, and
    the difference fails again. */
export const ALLOWED_DEVIATIONS: readonly Deviation[] = [
  { id: "ledger.label.color", record: "L3", canvas: "ledger label #64748A", production: "--ink-meta (#7B8B9F)" },
  { id: "ledger.value.ink", record: "B (D-3 ledger tones: --tone-ink is --ink)", canvas: "ink figures #FCFDFE", production: "--tone-ink" },
  { id: "card.title.color", record: "A adoption (Summary card, D-12: title --ink)", canvas: "card title #FCFDFE", production: "--ink" },
  { id: "head.meta.color", record: "L3", canvas: "band meta #64748A", production: "--ink-meta" },
  { id: "head.meta.wrap", record: "departure 10", canvas: "one-line meta", production: "the meta wraps below the title, never cut (no baseline pair to compare)" },
  { id: "head.baseline.centred", record: "A adoption (Band head, D-13: every head baseline-aligned)", canvas: "control-bearing heads centre-aligned (meta −1.5px)", production: "meta on the title's baseline ±1" },
  { id: "head.triptych", record: "A adoption (Band head, D-13; R8: one band-head spec)", canvas: "filing-history triptych heads 600 12px / meta 500 9.5px .1em", production: "the one head: title 600 13px sans, meta 500 10px mono caps" },
  { id: "table.role.secondary", record: "A adoption (Roles: one secondary-text role, c-secondary Plex 400 11px; R2)", canvas: "a secondary column at 11.5px (member transactions' asset)", production: "sans 400 11px" },
  { id: "type.floor", record: "R4; B (the 9.5px type floor)", canvas: "a 9px role (the hits' source stamp)", production: "the same role at 9.5px" },
  { id: "table.header.color", record: "L3; A adoption (header label #8494A8)", canvas: "header label #51617A", production: "--ink-label" },
  { id: "table.gap.numeric", record: "A adoption (the 16px numeric lead; D-9)", canvas: "12px before numeric columns", production: "22±2 (16±2 compact) before a c-num column that is not first" },
  { id: "table.gap.list", record: "departure 20", canvas: "14px outside the rule book and bar lists", production: "12±2" },
  { id: "table.row.height", record: "A adoption (Body cell padding 7.5px; R1: 30±1 rows)", canvas: "8px-padded bands (31–32px rows)", production: "30±1" },
  { id: "pair.collapsed", record: "F (D-8: a pair whose one cell holds only its empty-state line collapses)", canvas: "two cells, heads on one line", production: "one full-width column, the empty line under the other cell (data-collapsed=\"empty-state\")" },
  { id: "table.gutter.collapsed", record: "F (D-8: a pair whose one cell holds only its empty-state line collapses)", canvas: "the pair's 28px inner gutter", production: "32px on both sides of the one full-width cell" },
  { id: "seg.item.color", record: "A adoption (segment text #8FA0B3)", canvas: "inactive item #75879B", production: "--seg-text" },
  { id: "seg.item.height", record: "L6", canvas: "~20.5px items", production: "24–26px items at a fine pointer" },
  { id: "seg.active.cue", record: "L16; departure 8", canvas: "no cue", production: "inset 0 -2px 0 --seg-cue" },
  { id: "kind.late", record: "L4; departure 6", canvas: "LATE kind word", production: "the side word (BUY or SELL) in its colour, the LATE edge" },
  { id: "kind.nochange.word", record: "L5", canvas: "HOLD", production: "NO CHANGE" },
  { id: "kind.nochange.text", record: "A adoption (the lifted NO CHANGE grey #8FA0B3)", canvas: "HOLD / FLAT #51617A", production: "--kind-nochange-text" },
  { id: "kind.nochange.edge", record: "B (D-2 kind palette: NO CHANGE / FLAT edge)", canvas: "HOLD / FLAT edge #16202E", production: "--kind-nochange-edge" },
  { id: "kind.exch.word", record: "departure 6", canvas: "(no exchange row in the canvas)", production: "EXCHANGE, spelled out, in --kind-exch-text on the --kind-exch-edge" },
  { id: "kind.flat.none", record: "departure 6", canvas: "FLAT", production: "\"—\" when no direction can be stated" },
  { id: "table.role.dates.feed", record: "M1 D12", canvas: "the dates column at mono 500 11.5px", production: "mono 500 10px (--fs-meta) in the reference feed's TRADED → FILED cell" },
  { id: "table.role.dates", record: "A (prototype adoption, approved preview)", canvas: "the dates column at mono 500 11.5px", production: "mono 500 11px, the approved preview's date role (ledger-preview.css td.pv-date)" },
  { id: "table.role.name", record: "A (Roles: c-issuer is the name role)", canvas: "the issuer at Plex 400 11px (secondary)", production: "Plex 500 12.5px on the reported positions' ISSUER column" },
  /* DESIGN-POLISH M2 review Q2-8: columns the comparison used to skip because
     their table rendered no row on the bounded build, or because their canvas
     twin carries another label; each is answered by a recorded decision */
  { id: "table.role.member", record: "A (Roles: c-member is the name role, Plex 500 12.5px)", canvas: "the hit subject at Plex 500 12px", production: "Plex 500 12.5px on the hits' WHO column" },
  { id: "table.role.number", record: "A (Table: every body cell `500 var(--fs-cell) var(--mono)`; `.c-strong` carries no weight, M2)", canvas: "the directory's VALUE at mono 600", production: "mono 500 11.5px" },
  { id: "table.gutter.d11", record: "D-11 (28px gutters only on Institutional's left band cells and the member's M2 inner gutters; every other pair keeps 32px)", canvas: "the filer's side-cell filing history at a 28px outer gutter", production: "32px" },
  { id: "table.role.poskey", record: "SL-R22 / R21-DEFERRED (the Position changes cells keep their raw position key; the headers carry the notes)", canvas: "an issuer name, Plex 400 11px", production: "the raw position key, mono 400 11px" },
  { id: "table.role.notable.m3", record: "M2-fix DEV-NOTES M2F-D4 (the directory's latest notable change; M3 kind vocabulary, T3.1/T3.2)", canvas: "a mono 500 11px caps change line", production: "the A secondary role, Plex 400 11px", until: "m3" },
  /* M3 kind vocabulary (T3.1, T3.2): allowed only before m3 */
  { id: "kind.late.word.m3", record: "M3 T3.2 (L4, departure 6)", canvas: "a late row reads its side word (L4)", production: "the feed's LATE word in the canvas's LATE colour, on the LATE edge", until: "m3" },
  { id: "kind.side.word.m3", record: "M3 T3.2 (L4, departure 6)", canvas: "BUY / SELL", production: "PURCHASE / SALE on the member's transactions, in the BUY / SELL colours and edges", until: "m3" },
  { id: "kind.netflow.word.m3", record: "M3 T3.2 (departure 6)", canvas: "NET BUY / NET SELL / FLAT", production: "BUY / SELL / MIXED on the member's net flow, in the NET BUY / NET SELL / FLAT colours and edges", until: "m3" },
  { id: "kind.qoq.chip.m3", record: "M3 T3.1 (R19; institutional.css:3-23 deleted there)", canvas: "a mono 600 10px .08em caps word, no background, in the kind's text colour", production: "the .qoq-chip pill: Plex 700 10px .06em, its tint, --buy (add, new) or --sell (trim, exit) text; the row edge stays the kind's edge", until: "m3" },
];

/** The allowances in force at milestone `m` (the milestone-scoped ones drop
    out once `m` reaches their `until`). */
export function allowedAt(m: Milestone = CURRENT_MILESTONE): Deviation[] {
  return ALLOWED_DEVIATIONS.filter((d) => !d.until || milestoneIndex(m) < milestoneIndex(d.until));
}

export interface Finding {
  band: string;
  check: string;
  canvas: string;
  route: string;
  /** set when a recorded deviation answers the difference */
  record: string | null;
  /** how many cells or rows show this same finding */
  count?: number;
}

export interface TableMap {
  /** the canvas band (its head title) */
  canvas: string;
  /** the route table's label in `measurePage`'s `tables` */
  route: string;
  /** a class of the route's pair band: when that band collapsed under the
      empty-state rule, the cell holds its one line and no table (D-8) */
  band?: string;
  /** Route columns (by header label) and kinds (`kind:WORD`) the canvas band
      does not draw, each with its reason. Anything the comparison cannot pair
      with the canvas and that is NOT listed here fails (DESIGN-POLISH M2
      review Q2-8: nothing is skipped silently). */
  unmatched?: Record<string, string>;
  /** the least columns the comparison must pair with the canvas (default 2,
      or the route's column count when smaller) */
  minCompared?: number;
  /** a route column whose canvas twin carries another label (route → canvas) */
  columns?: Record<string, string>;
  /** why this route table may render no body cell on the measured build
      (data-bound); a bodyless table without it fails */
  empty?: string;
  /** why the gutters are not compared: the canvas twin sits in another cell
      position (the Conviction table, I1's right side cell, against the
      Cluster board, the canvas's left cell) */
  noGutters?: string;
  /** a mapped column whose role differs from its canvas twin under a
      recorded deviation: route label → ALLOWED_DEVIATIONS id */
  roleDeviation?: Record<string, string>;
  /** the recorded deviation a gutter difference answers to (an id) */
  gutterDeviation?: string;
}
/** What one mapped table's comparison actually compared (review Q2-8). */
export interface TableCoverage {
  canvas: string;
  route: string;
  columns: number;
  /** no route column rendered a body cell: nothing but the header was measured */
  bodyless: boolean;
  compared: string[];
  /** route column labels, then `kind:WORD` entries, the canvas has no twin for */
  unmatched: string[];
  kinds: number;
}
export interface HeadMap {
  canvas: string;
  /** the route head's title: exact, or a prefix ending in "…" */
  route: string;
}
export interface SegMap {
  /** the canvas group's items joined by "|" */
  canvas: string;
  /** a route group: its items joined by "|" (a prefix ending in "…" allowed) */
  route: string;
}
export interface PairMap {
  /** the canvas pair's two head titles, left then right */
  canvas: [string, string];
  /** the route pair's two head titles (prefix "…" allowed) */
  route: [string, string];
  /** set when the pair follows the approved PREVIEW, not a canvas pair: the
      canvas draws these two heads in different bands, so their canvas
      baseline gap measures nothing. The preview draws them on one line, so
      the route's two heads are held to 0px + 2px. The value is the recorded
      decision (band I1: coordinator decision CD-5). */
  preview?: string;
}
export interface BandMap {
  tables: TableMap[];
  /** paired cells whose heads the canvas draws on one line */
  pairs: PairMap[];
  heads: HeadMap[];
  segs: SegMap[];
  /** compare the header ledger and the summary cards */
  ledger: boolean;
  cards: boolean;
}

const roleText = (r: Role | null): string =>
  r ? `${r.family} ${r.weight} ${r.size}px ${r.tracking}em${r.caps === null ? "" : r.caps ? " caps" : ""}` : "(none)";
function roleDiff(a: Role, b: Role): string[] {
  const out: string[] = [];
  if (a.family !== b.family) out.push("family");
  if (a.weight !== b.weight) out.push("weight");
  if (Math.abs(a.size - b.size) > 0.05) out.push("size");
  if (Math.abs(a.tracking - b.tracking) > 0.006) out.push("letter-spacing");
  if (a.caps !== null && b.caps !== null && a.caps !== b.caps) out.push("case");
  return out;
}
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
}
function mode<T>(xs: T[], key: (x: T) => string): T | null {
  const m = new Map<string, { x: T; n: number }>();
  for (const x of xs) { const k = key(x); const c = m.get(k); if (c) c.n++; else m.set(k, { x, n: 1 }); }
  let best: { x: T; n: number } | null = null;
  for (const v of m.values()) if (!best || v.n > best.n) best = v;
  return best ? best.x : null;
}
function headMatch(pattern: string, title: string): boolean {
  return pattern.endsWith("…") ? title.startsWith(pattern.slice(0, -1)) : title === pattern;
}

/** The canvas-wide kind dictionary: every kind word the five canvases print,
    with its text and edge colour, and the rule book's family colours. */
export interface KindDictionary {
  words: Record<string, { color: string; edge: string | null }>;
  families: Record<string, { color: string; edge: string | null }>;
  /** the canvases' kind-word role and background (every canvas draws one) */
  role: Role | null;
  background: string;
}
export function kindDictionary(canvases: PageMeasure[]): KindDictionary {
  const words: KindDictionary["words"] = {}, families: KindDictionary["families"] = {};
  const all: KindCell[] = [];
  for (const c of canvases) for (const t of c.tables) for (const k of t.kinds) {
    all.push(k);
    if (k.family) { if (!families[k.family]) families[k.family] = { color: k.color, edge: k.edge }; }
    else if (!words[k.word] && k.edge) words[k.word] = { color: k.color, edge: k.edge };
  }
  const r = mode(all, (k) => roleText({ ...k.role, caps: null }));
  const bg = mode(all, (k) => k.background);
  return { words, families, role: r ? r.role : null, background: bg ? bg.background : "" };
}

/** The plan's kind taxonomy: a row's `data-edge` → the word the canvas
    prints for that kind. A taxonomy, not a design value: the colours are
    read from the canvases. */
const EDGE_WORD: Record<string, string> = {
  buy: "BUY", sell: "SELL", new: "NEW", add: "ADD", trim: "TRIM", exit: "EXIT",
  nochange: "HOLD", netbuy: "NET BUY", netsell: "NET SELL", flat: "FLAT",
};

/** Compare one route to its canvas, band by band. */
export function compareBands(canvas: PageMeasure, route: PageMeasure, map: BandMap, dict: KindDictionary, milestone: Milestone = CURRENT_MILESTONE, coverage?: TableCoverage[]): Finding[] {
  const out: Finding[] = [];
  const T = route.tokens;
  const inForce = new Map(allowedAt(milestone).map((d) => [d.id, d]));
  /** `dev` names the allowance that answers the difference; an allowance that
      has expired at `milestone` answers nothing, so the finding is unrecorded */
  const push = (band: string, check: string, c: string, r: string, dev?: string): void => {
    if (dev && !ALLOWED_DEVIATIONS.some((x) => x.id === dev)) throw new Error(`compareBands: no deviation entry "${dev}"`);
    const d = dev ? inForce.get(dev) : undefined;
    out.push({ band, check, canvas: c, route: r, record: d ? (d.until ? `${d.record} [until ${d.until}]` : d.record) : null });
  };
  /** equal, or equal to the token a recorded deviation names */
  const colour = (band: string, check: string, c: string, r: string, dev?: string, token?: string): void => {
    if (r === c) return;
    if (dev && token && T[token] && r === T[token]) push(band, check, c, `${r} (${token})`, dev);
    else push(band, check, c, r);
  };

  /* ------------------------------------------------ the header ledger */
  if (map.ledger) {
    const cl = canvas.ledger, rl = route.ledger;
    if (!cl.length || !rl.length) push("ledger", "present", `${cl.length} figures`, `${rl.length} figures`);
    const c0 = cl[0];
    if (c0) {
      rl.forEach((f) => {
        const b = `ledger ${f.label}`;
        const dl = roleDiff(f.labelRole, c0.labelRole);
        if (dl.length) push(b, `label role (${dl.join(", ")})`, roleText(c0.labelRole), roleText(f.labelRole));
        colour(b, "label colour", c0.labelColor, f.labelColor, "ledger.label.color", "--ink-meta");
        const dv = roleDiff(f.valueRole, c0.valueRole);
        if (dv.length) push(b, `value role (${dv.join(", ")})`, roleText(c0.valueRole), roleText(f.valueRole));
        if (c0.subRole && f.subRole) {
          const ds = roleDiff(f.subRole, c0.subRole);
          if (ds.length) push(b, `sub role (${ds.join(", ")})`, roleText(c0.subRole), roleText(f.subRole));
        }
        if (!near(f.labelToValue, c0.labelToValue, 0.5)) push(b, "label-to-value gap", `${c0.labelToValue}px`, `${f.labelToValue}px`);
        /* D-3: the value is painted in its figure's own tone token */
        if (!f.tone || !f.toneColor) push(b, "tone", "a --tone-* token", "no data-tone");
        else if (f.valueColor !== f.toneColor) push(b, `value colour is --tone-${f.tone}`, f.toneColor, f.valueColor);
        /* a figure the canvas shows too takes the canvas's tone */
        const twin = cl.find((x) => x.label === f.label);
        if (twin) {
          const toneOf = (hexColour: string): string | null =>
            (["ink", "blue", "gold", "green"] as const).find((t) => T[`--tone-${t}`] === hexColour) ?? null;
          /* the canvas's neutral figures are painted in its heading ink */
          const want = toneOf(twin.valueColor) ?? (twin.valueColor === canvas.ink ? "ink" : null);
          if (want === null) push(b, "canvas tone", twin.valueColor, "(no tone token paints the canvas colour)");
          else if (want !== f.tone) push(b, "tone (the canvas's figure)", `${want} (${twin.valueColor})`, `${f.tone ?? "none"} (${f.valueColor})`);
          else if (twin.valueColor !== f.valueColor) push(b, "value colour", twin.valueColor, `${f.valueColor} (--tone-${f.tone})`, want === "ink" ? "ledger.value.ink" : undefined);
        }
      });
      const gaps = (fs: LedgerFigure[]): number[] => fs.slice(1).map((f, i) => Math.round((f.left - fs[i]!.right) * 10) / 10);
      const cg = median(gaps(cl));
      for (const g of gaps(rl)) if (!near(g, cg, 1)) push("ledger", "gap between figures", `${cg}px`, `${g}px`);
      const tops = rl.map((f) => f.valueTop);
      if (tops.length && Math.max(...tops) - Math.min(...tops) > 1) push("ledger", "value tops aligned", "±1px", `${Math.round((Math.max(...tops) - Math.min(...tops)) * 10) / 10}px spread`);
    }
  }

  /* ------------------------------------------------ the summary cards */
  if (map.cards) {
    if (route.cards.length !== canvas.cards.length) push("cards", "count", String(canvas.cards.length), String(route.cards.length));
    route.cards.forEach((rc, i) => {
      const cc = canvas.cards[i] ?? canvas.cards[0];
      if (!cc) return;
      /* the card spec is one spec: its findings aggregate over the cards;
         the tag's tone is per card (by meaning) */
      const b = "cards";
      const sides = ["top", "right", "bottom", "left"];
      rc.padding.forEach((p, j) => { if (!near(p, cc.padding[j]!, 0.5)) push(b, `padding-${sides[j]}`, `${cc.padding[j]}px`, `${p}px`); });
      for (const [k, a, c] of [["tag", rc.tagRole, cc.tagRole], ["title", rc.titleRole, cc.titleRole], ["body", rc.bodyRole, cc.bodyRole]] as const) {
        const d = roleDiff(a, c);
        if (d.length) push(b, `${k} role (${d.join(", ")})`, roleText(c), roleText(a));
      }
      colour(`card ${i + 1}`, "tag colour (by meaning, D-12)", cc.tagColor, rc.tagColor);
      colour(b, "title colour", cc.titleColor, rc.titleColor, "card.title.color", "--ink");
      if (rc.bodyColor !== T["--ink3"]) push(b, "body colour is --ink3", T["--ink3"] ?? "?", rc.bodyColor);
      colour(b, "body colour", cc.bodyColor, rc.bodyColor);
      if (!near(rc.tagToTitle, cc.tagToTitle, 0.5)) push(b, "tag-to-title gap", `${cc.tagToTitle}px`, `${rc.tagToTitle}px`);
      if (!near(rc.titleToBody, cc.titleToBody, 0.5)) push(b, "title-to-body gap", `${cc.titleToBody}px`, `${rc.titleToBody}px`);
    });
  }

  /* ------------------------------------------------------ band heads */
  const standard = mode(canvas.heads.filter((h) => h.titleRole.size === 13), (h) => roleText(h.titleRole) + roleText(h.metaRole));
  const standardDelta = mode(canvas.heads.filter((h) => h.baselineDelta !== null), (h) => String(h.baselineDelta))?.baselineDelta ?? 0;
  for (const hm of map.heads) {
    const ch = canvas.heads.find((h) => h.title === hm.canvas);
    const rh = route.heads.find((h) => headMatch(hm.route, h.title));
    const b = `head ${hm.canvas} → ${hm.route}`;
    if (!ch) { push(b, "canvas head", "(missing)", ""); continue; }
    if (!rh) { push(b, "route head", ch.title, "(missing)"); continue; }
    const triptych = ch.titleRole.size !== 13 && standard;
    const ref = triptych ? standard! : ch;
    for (const [k, a, c] of [["title", rh.titleRole, ref.titleRole], ["meta", rh.metaRole, ref.metaRole]] as const) {
      if (!a || !c) continue;
      const d = roleDiff(a, c);
      if (!d.length) continue;
      push(b, `${k} role (${d.join(", ")})`, roleText(c), roleText(a));
    }
    if (triptych) {
      const d1 = roleDiff(standard!.titleRole, ch.titleRole);
      if (d1.length) push(b, "title role (the triptych head)", roleText(ch.titleRole), roleText(rh.titleRole), "head.triptych");
    }
    if (rh.metaColor && ch.metaColor) colour(b, "meta colour", ch.metaColor, rh.metaColor, "head.meta.color", "--ink-meta");
    /* G10: the meta on the title's baseline ±1; the canvas's own value where
       it is baseline-aligned, else its baseline-aligned heads' value */
    const want = ch.baselineDelta !== null && Math.abs(ch.baselineDelta) <= 1 ? ch.baselineDelta : standardDelta;
    if (rh.metaWrapped) push(b, "meta baseline", "on the title's line", "wrapped below the title", "head.meta.wrap");
    else if (rh.baselineDelta !== null) {
      if (!near(rh.baselineDelta, want, 1)) push(b, "meta baseline − title baseline", `${want}px`, `${rh.baselineDelta}px`);
      else if (ch.baselineDelta !== null && !near(rh.baselineDelta, ch.baselineDelta, 1)) push(b, "meta baseline − title baseline", `${ch.baselineDelta}px`, `${rh.baselineDelta}px`, "head.baseline.centred");
    }
    /* G10: a control's centre ±1 of its head row's, as the canvas's */
    if (rh.controlOffset !== null) {
      const cw = ch.controlOffset ?? 0;
      if (!near(rh.controlOffset, cw, 1)) push(b, "control centring", `${cw}px`, `${rh.controlOffset}px`);
    }
  }

  /* a pair's two heads sit on one line: the route's baselines differ by no
     more than the canvas's own (a control-bearing head sits a few px low in
     the canvas) + 2px */
  for (const pm of map.pairs) {
    const [ca, cb] = pm.canvas.map((t) => canvas.heads.find((h) => h.title === t));
    const [ra, rb] = pm.route.map((t) => route.heads.find((h) => headMatch(t, h.title)));
    const b = `pair ${pm.route[0]} │ ${pm.route[1]}`;
    if (!ca || !cb) { push(b, "canvas pair heads", pm.canvas.join(" │ "), "(missing)"); continue; }
    if (!ra || !rb) { push(b, "route pair heads", pm.canvas.join(" │ "), "(missing)"); continue; }
    if (ra.collapsed || rb.collapsed) { push(b, "the two heads on one line", "paired", "collapsed: the empty cell's line sits under the other cell", "pair.collapsed"); continue; }
    const cd = pm.preview ? 0 : Math.round(Math.abs(ca.titleBaseline - cb.titleBaseline) * 10) / 10;
    const rd = Math.round(Math.abs(ra.titleBaseline - rb.titleBaseline) * 10) / 10;
    if (rd > cd + 2) push(b, "the two heads' title baselines", `${cd}px apart${pm.preview ? " (the approved preview)" : ""}`, `${rd}px apart`);
  }

  /* ---------------------------------------------------------- tables */
  for (const tm of map.tables) {
    const ct = canvas.tables.find((t) => t.title === tm.canvas);
    const rt = route.tables.find((t) => t.title === tm.route);
    const b = `table ${tm.canvas} → ${tm.route}`;
    if (!ct) { push(b, "canvas band", "(missing)", ""); continue; }
    if (!rt) {
      const collapsed = !!tm.band && route.bands.some((x) => x.collapsed && x.cls.split(/\s+/).includes(tm.band!));
      push(b, "route table", ct.title, collapsed ? "(none: the band collapsed, its empty-state line stands for the cell)" : "(missing)", collapsed ? "pair.collapsed" : undefined);
      continue;
    }
    const cov: TableCoverage = { canvas: tm.canvas, route: tm.route, columns: rt.columns.length, bodyless: rt.columns.every((c) => !c.role), compared: [], unmatched: [], kinds: 0 };
    coverage?.push(cov);
    /* header role: every th against the canvas header */
    const ch = mode(ct.headerRoles, (h) => roleText(h.role));
    if (ch) {
      for (const h of rt.headerRoles) {
        const d = roleDiff(h.role, ch.role);
        if (d.length) push(b, `header "${h.label}" role (${d.join(", ")})`, roleText(ch.role), roleText(h.role));
        if (h.sorted) {
          const cs = ct.headerRoles.find((x) => x.color !== ch.color);
          if (cs) colour(b, `sorted header "${h.label}" colour`, cs.color, h.color);
          else if (h.color !== T["--accent"]) push(b, `sorted header "${h.label}" colour`, "--accent", h.color);
        } else colour(b, `header "${h.label}" colour`, ch.color, h.color, "table.header.color", "--ink-label");
      }
    }
    /* body roles: the table's base font, then every column the canvas band
       also draws (matched by header label) */
    /* (a header-less canvas list sets its fonts per cell: no base font) */
    if (ct.headerRoles.length && ct.bodyRole && rt.bodyRole) {
      const d = roleDiff(rt.bodyRole, ct.bodyRole);
      if (d.length) push(b, `body role (${d.join(", ")})`, roleText(ct.bodyRole), roleText(rt.bodyRole));
    }
    for (const col of rt.columns) {
      const twin = tm.columns?.[col.label] ?? col.label;
      const cc = ct.columns.find((c) => c.label === twin);
      if (!cc) { cov.unmatched.push(col.label); continue; }
      if (!cc.role) { cov.unmatched.push(`${col.label} (canvas cell unmeasured)`); continue; }
      if (!col.role) { cov.unmatched.push(`${col.label} (route cell unmeasured)`); continue; }
      cov.compared.push(twin === col.label ? col.label : `${col.label} → ${twin}`);
      const recorded = tm.roleDeviation?.[col.label];
      if (recorded) {
        const d = roleDiff({ ...col.role, caps: null }, { ...cc.role, caps: null });
        if (d.length) push(b, `"${col.label}" cells role (${d.join(", ")})`, roleText(cc.role), roleText(col.role), recorded);
        continue;
      }
      /* a data cell's case is its data's (a ticker is caps, an issuer is
         not): only the type is compared */
      const d = roleDiff({ ...col.role, caps: null }, { ...cc.role, caps: null });
      if (!d.length) continue;
      if (col.role.family === "sans" && col.role.weight === 400 && col.role.size === 11 && cc.role.family === "sans" && cc.role.weight === 400) {
        push(b, `"${col.label}" cells role (${d.join(", ")})`, roleText(cc.role), roleText(col.role), "table.role.secondary");
        continue;
      }
      /* the dates column: 10px in the feed (M1 D12), 11px in the ledger
         tables (the approved preview's date role) — exactly, nothing else */
      if (col.label === "TRADED → FILED" && d.length === 1 && d[0] === "size" && col.role.family === "mono" && col.role.weight === 500) {
        const feed = rt.grid && !rt.multiline;
        const dev = feed && col.role.size === 10 ? "table.role.dates.feed" : !feed && col.role.size === 11 ? "table.role.dates" : undefined;
        push(b, `"${col.label}" cells role (size)`, roleText(cc.role), roleText(col.role), dev);
        continue;
      }
      /* the reported positions' issuer takes the name role (A, Roles) */
      if (col.label === "ISSUER" && col.role.family === "sans" && col.role.weight === 500 && col.role.size === 12.5) {
        push(b, `"${col.label}" cells role (${d.join(", ")})`, roleText(cc.role), roleText(col.role), "table.role.name");
        continue;
      }
      /* R4: nothing renders under the 9.5px floor, so a sub-floor canvas
         role takes the floor and nothing else */
      if (d.length === 1 && d[0] === "size" && cc.role.size < 9.5 && col.role.size === 9.5) push(b, `"${col.label}" cells role (size)`, roleText(cc.role), roleText(col.role), "type.floor");
      else push(b, `"${col.label}" cells role (${d.join(", ")})`, roleText(cc.role), roleText(col.role));
    }
    /* single-line row height */
    if (!ct.multiline && !rt.multiline && rt.rowHeights.length && ct.rowHeights.length) {
      const cm = median(ct.rowHeights), rm = median(rt.rowHeights);
      const off = rt.rowHeights.filter((h) => !near(h, 30, 1));
      if (off.length) push(b, "row height 30±1", "30px", `${off.length} rows off (${[...new Set(off)].slice(0, 4).join(", ")}px)`);
      else if (!near(rm, cm, 1)) push(b, "row height", `${cm}px`, `${rm}px`, "table.row.height");
    }
    /* gutters: first text on band left + gutter, last text on band right − gutter */
    /* a collapsed pair's one cell has no inner side: both of its sides take
       the canvas band's OUTER gutter */
    const collapsed = rt.collapsed;
    const outer = Math.max(Math.round(ct.gutterL ?? 0), Math.round(ct.gutterR ?? 0));
    if (tm.noGutters) cov.unmatched.push("gutters");
    else if (ct.gutterL !== null && rt.gutterL !== null) {
      const want = collapsed ? outer : Math.round(ct.gutterL);
      if (!near(rt.gutterL, want, 1)) push(b, "gutter left", `${want}px`, `${rt.gutterL}px`, tm.gutterDeviation);
      else if (!near(rt.gutterL, ct.gutterL, 1)) push(b, "gutter left", `${ct.gutterL}px`, `${rt.gutterL}px`, "table.gutter.collapsed");
    }
    if (!tm.noGutters && ct.gutterR !== null && rt.gutterR !== null && ct.lastRight && rt.lastRight) {
      const want = collapsed ? outer : Math.round(ct.gutterR);
      if (!near(rt.gutterR, want, 1)) push(b, "gutter right", `${want}px`, `${rt.gutterR}px`, tm.gutterDeviation);
      else if (!near(rt.gutterR, ct.gutterR, 1.5)) push(b, "gutter right", `${ct.gutterR}px`, `${rt.gutterR}px`, "table.gutter.collapsed");
    }
    /* content-box column gap */
    const cgap = median(ct.gaps.map((g) => g.gap));
    for (const g of rt.gaps) {
      if (g.numeric && !rt.grid) {
        const want = rt.compact ? 16 : 22;
        if (!near(g.gap, want, 2)) push(b, `gap before "${g.before}"`, `${want}px (numeric lead)`, `${g.gap}px`);
        else if (!near(g.gap, cgap, 2)) push(b, `gap before "${g.before}"`, `${cgap}px`, `${g.gap}px`, "table.gap.numeric");
      } else if (!near(g.gap, cgap, 2)) {
        if (cgap === 14 && !rt.multiline && near(g.gap, 12, 2)) push(b, `gap before "${g.before}"`, `${cgap}px`, `${g.gap}px`, "table.gap.list");
        else push(b, `gap before "${g.before}"`, `${cgap}px`, `${g.gap}px`);
      }
    }
    /* kind colours and words; the word is the canvas's caps word, never a pill */
    /* the M3 allowance for the filer's .qoq-chip pills, bounded: exactly the
       chip's own type, and its --buy / --sell text */
    const CHIP_ROLE: Role = { family: "sans", weight: 700, size: 10, tracking: 0.06, caps: null };
    const chipToken = (e: string): string | null => (/^(add|new|buy|netbuy)$/.test(e) ? "--buy" : /^(trim|exit|sell|netsell)$/.test(e) ? "--sell" : null);
    /** the kind word's text colour against `want`; a chip may instead show its
        own --buy/--sell token under the M3 allowance */
    const kindText = (band: string, check: string, want: string, k: KindCell, dev?: string, token?: string): void => {
      if (k.color === want) return;
      const ct = chipToken(k.dataEdge ?? "");
      if (k.chip && ct && T[ct] === k.color) push(band, check, want, `${k.color} (${ct}, .qoq-chip)`, "kind.qoq.chip.m3");
      else colour(band, check, want, k.color, dev, token);
    };
    for (const k of rt.kinds) {
      const e = k.dataEdge ?? "";
      cov.kinds++;
      if (dict.role) {
        const d = roleDiff({ ...k.role, caps: null }, { ...dict.role, caps: null });
        if (d.length) {
          const chipRole = k.chip && !roleDiff({ ...k.role, caps: null }, CHIP_ROLE).length;
          push(b, `kind "${k.word}" role (${d.join(", ")})`, roleText(dict.role), roleText(k.role), chipRole ? "kind.qoq.chip.m3" : undefined);
        }
        if (k.role.caps === false) push(b, `kind "${k.word}" case`, "caps", k.word);
      }
      if (k.background !== dict.background) push(b, `kind "${k.word}" background (a pill)`, dict.background, k.background, k.chip ? "kind.qoq.chip.m3" : undefined);
      if (e.startsWith("family-")) {
        const fam = e.slice(7).toUpperCase();
        const want = dict.families[fam];
        if (!want) { cov.unmatched.push(`kind:${k.word}`); continue; } /* a family the design does not have (CONTEXT) */
        colour(b, `${fam} kind "${k.word}" text`, want.color, k.color);
        if (want.edge) colour(b, `${fam} kind "${k.word}" edge`, want.edge, k.edge ?? "(none)");
        continue;
      }
      if (e === "late") {
        const late = dict.words["LATE"];
        const side = k.word === "BUY" || k.word === "SELL" ? dict.words[k.word] : undefined;
        if (side) {
          colour(b, `late ${k.word} text`, side.color, k.color);
          push(b, `late ${k.word} word`, "LATE", k.word, "kind.late");
        } else if (k.word === "LATE") {
          /* until M3 T3.2: the LATE word, in the canvas's LATE colour */
          push(b, "late row kind word", "BUY or SELL (L4)", k.word, "kind.late.word.m3");
          if (late) colour(b, "late LATE text", late.color, k.color);
        } else push(b, `late row kind word "${k.word}"`, "BUY or SELL (L4)", k.word);
        if (late?.edge) colour(b, "late edge", late.edge, k.edge ?? "(none)");
        continue;
      }
      if (e === "exch") {
        /* no exchange row in the canvas: the word is spelled out (departure
           6) and coloured by its section B tokens */
        if (k.word !== "EXCHANGE") push(b, "exchange kind word", "EXCHANGE (departure 6)", k.word);
        else if (k.color === T["--kind-exch-text"] && k.edge === T["--kind-exch-edge"]) push(b, "exchange kind", "(none)", `EXCHANGE ${k.color}/${k.edge}`, "kind.exch.word");
        else push(b, "exchange kind colours", `${T["--kind-exch-text"]}/${T["--kind-exch-edge"]}`, `${k.color}/${k.edge ?? "(none)"}`);
        continue;
      }
      const cw = EDGE_WORD[e];
      if (!cw) { cov.unmatched.push(`kind:${k.word}`); continue; } /* a kind the design does not draw (NO PRIOR) */
      const want = dict.words[cw];
      if (!want) { cov.unmatched.push(`kind:${k.word}`); continue; }
      if (e === "nochange") {
        if (k.word !== "NO CHANGE") push(b, "no-change kind word", "NO CHANGE (L5)", k.word);
        else push(b, "no-change kind word", cw, k.word, "kind.nochange.word");
        kindText(b, "no-change text", want.color, k, "kind.nochange.text", "--kind-nochange-text");
        colour(b, "no-change edge", want.edge ?? "", k.edge ?? "(none)", "kind.nochange.edge", "--kind-nochange-edge");
        continue;
      }
      if (e === "flat") {
        if (k.word === "—") push(b, "flat kind word", cw, k.word, "kind.flat.none");
        else if (k.word !== cw) push(b, `${e} kind word`, cw, k.word, k.word === "MIXED" ? "kind.netflow.word.m3" : undefined);
        colour(b, "flat text", want.color, k.color, "kind.nochange.text", "--kind-nochange-text");
        colour(b, "flat edge", want.edge ?? "", k.edge ?? "(none)", "kind.nochange.edge", "--kind-nochange-edge");
        continue;
      }
      if (k.word !== cw) {
        /* until M3 T3.2: the member's side words and net-flow words */
        const side = (e === "buy" && k.word === "PURCHASE") || (e === "sell" && k.word === "SALE");
        const net = (e === "netbuy" && k.word === "BUY") || (e === "netsell" && k.word === "SELL");
        push(b, `${e} kind word`, cw, k.word, side ? "kind.side.word.m3" : net ? "kind.netflow.word.m3" : undefined);
      }
      kindText(b, `${cw} text`, want.color, k);
      if (want.edge) colour(b, `${cw} edge`, want.edge, k.edge ?? "(none)");
    }
  }

  /* ------------------------------------------------ segmented controls */
  for (const sm of map.segs) {
    const cg = canvas.segs.find((s) => s.label === sm.canvas);
    const rg = route.segs.find((s) => headMatch(sm.route, s.label));
    const b = `control ${sm.canvas} → ${sm.route}`;
    if (!cg) { push(b, "canvas control", "(missing)", ""); continue; }
    if (!rg) { push(b, "route control", cg.label, "(missing)"); continue; }
    if (rg.borderWidth !== cg.borderWidth) push(b, "outline width", `${cg.borderWidth}px`, `${rg.borderWidth}px`);
    colour(b, "outline colour", cg.borderColor, rg.borderColor);
    const cDiv = cg.items.find((i, n) => n > 0);
    const cItem = cg.items[0]!;
    /* the canvas's plain inactive colour: the most common inactive item colour */
    const plain = mode(cg.items.filter((c) => !c.active), (c) => c.color)?.color ?? "";
    rg.items.forEach((it, n) => {
      const ib = `${b} "${it.text}"`;
      /* the item's type (its case is its label's) */
      const d = roleDiff({ ...it.role, caps: null }, { ...cItem.role, caps: null });
      if (d.length) push(b, `item role (${d.join(", ")})`, roleText({ ...cItem.role, caps: null }), roleText({ ...it.role, caps: null }));
      if (n > 0 && cDiv) {
        if (it.dividerWidth !== cDiv.dividerWidth) push(ib, "divider width", `${cDiv.dividerWidth}px`, `${it.dividerWidth}px`);
        else colour(ib, "divider colour", cDiv.dividerColor, it.dividerColor);
      }
      const twin = cg.items.find((c) => c.text.toLowerCase() === it.text.toLowerCase());
      if (it.active) {
        const ca = cg.items.find((c) => c.active);
        if (ca) {
          colour(ib, "active fill", ca.background, it.background);
          colour(ib, "active text", ca.color, it.color);
        }
        if (!it.cue) push(ib, "active cue", "inset 2px bar (L16)", "none");
        else push(ib, "active cue", "none", it.cue, "seg.active.cue");
      } else if (twin && !twin.active && twin.color !== plain) {
        /* party, late, overlap and cross items keep their design colours (D-11) */
        colour(ib, "tinted item colour", twin.color, it.color);
      } else if (!it.tinted) {
        colour(ib, "inactive text", plain, it.color, "seg.item.color", "--seg-text");
      }
      const ch = cg.items[0]!.height;
      if (!near(it.height, ch, 1)) {
        if (it.height >= 24 && it.height <= 26) push(ib, "item height", `${ch}px`, `${it.height}px`, "seg.item.height");
        else push(ib, "item height", `${ch}px (24–26 under L6)`, `${it.height}px`);
      }
    });
  }
  return aggregate(out);
}

/** One finding per distinct (band, check, canvas, route), with a count. */
function aggregate(fs: Finding[]): Finding[] {
  const m = new Map<string, Finding>();
  for (const f of fs) {
    const k = `${f.band}|${f.check}|${f.canvas}|${f.route}|${f.record}`;
    const c = m.get(k);
    if (c) c.count = (c.count ?? 1) + 1;
    else m.set(k, { ...f, count: 1 });
  }
  return [...m.values()];
}

/** D-4 / T-10 on every segmented group of a route, against the tokens: the
    1px `--seg-border` outline and 1px dividers, inactive text `--seg-text`
    (party/late/overlap/cross tints excepted, D-11), and the active item's
    `--seg-fill`, `--seg-text-active` and 2px `--seg-cue` inset bar. */
export function segTokenFindings(route: PageMeasure): Finding[] {
  const T = route.tokens;
  const out: Finding[] = [];
  const f = (band: string, check: string, want: string, got: string): void => { out.push({ band, check, canvas: want, route: got, record: null }); };
  for (const g of route.segs) {
    const b = `control ${g.label}`;
    if (g.borderWidth !== 1) f(b, "outline width", "1px", `${g.borderWidth}px`);
    if (g.borderColor !== T["--seg-border"]) f(b, "outline colour --seg-border", T["--seg-border"]!, g.borderColor);
    g.items.forEach((it, n) => {
      const ib = `${b} "${it.text}"`;
      if (n > 0) {
        if (it.dividerWidth !== 1) f(ib, "divider width", "1px", `${it.dividerWidth}px`);
        else if (it.dividerColor !== T["--seg-border"]) f(ib, "divider colour --seg-border", T["--seg-border"]!, it.dividerColor);
      }
      if (it.active) {
        if (it.background !== T["--seg-fill"]) f(ib, "active fill --seg-fill", T["--seg-fill"]!, it.background);
        if (it.color !== T["--seg-text-active"]) f(ib, "active text --seg-text-active", T["--seg-text-active"]!, it.color);
        const cue = it.cue ?? "";
        const m = cue.match(/rgba?\([^)]+\)/);
        const hexCue = m ? (() => { const p = m[0].match(/[\d.]+/g)!.map(Number); return "#" + p.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(); })() : "";
        if (!/0px -2px 0px 0px inset|inset 0px -2px 0px 0px/.test(cue) || hexCue !== T["--seg-cue"]) f(ib, "active cue: inset 0 -2px 0 --seg-cue", `inset 0 -2px 0 ${T["--seg-cue"]}`, cue || "none");
      } else if (!it.tinted && it.color !== T["--seg-text"]) f(ib, "inactive text --seg-text", T["--seg-text"]!, it.color);
    });
  }
  return out;
}

/** The unrecorded findings only (what fails the comparison). */
export const unrecorded = (fs: Finding[]): Finding[] => fs.filter((f) => f.record === null);

export function formatFindings(fs: Finding[], max = 40): string {
  return fs.slice(0, max).map((f) => `- ${f.band}: ${f.check} — canvas ${f.canvas}, route ${f.route}${f.count && f.count > 1 ? ` (×${f.count})` : ""}${f.record ? ` [${f.record}]` : ""}`).join("\n") +
    (fs.length > max ? `\n… ${fs.length - max} more` : "");
}
