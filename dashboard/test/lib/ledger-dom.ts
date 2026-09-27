/* Reading the ONE page-header ledger (DESIGN-POLISH M2, R15 / T2.8) by DOM
   parse, for every test that pins a header figure.

   The ledger is a valid description list: one `<div class="ledger-fig">`
   group per figure holding its `<dt>` label (plain, or a label-trigger note),
   the value as `<dd class="ledger-value">` and the optional sub as a second
   `<dd class="ledger-sub">`. The pre-M2 string shapes (`<dt>L</dt><dd>V</dd>`,
   `<div class="tile-label">`) no longer describe the markup, so the figures are
   read from the parsed tree instead — a label is the dt's VISIBLE text (a
   note's popover body is not part of it), in document order. */

import { MiniElement } from "./mini-dom.ts";

export function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}

/** The text a reader sees: a note's popover body is not visible text. */
export function visibleText(el: MiniElement): string {
  return el.nodes
    .map((n) => (typeof n === "string" ? n.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : n.classList.contains("note-pop") ? "" : visibleText(n)))
    .join("");
}

export interface LedgerFigure {
  label: string;
  value: string;
  sub: string | null;
  tone: string | null;
  group: MiniElement;
}

/** Every `dl.design-ledger` in `html`, in document order. */
export function ledgers(html: string | MiniElement): MiniElement[] {
  const root = typeof html === "string" ? domOf(html) : html;
  return root.querySelectorAll("dl.design-ledger");
}

/** The figures of ONE ledger element, in order. */
export function figuresOf(dl: MiniElement): LedgerFigure[] {
  return dl.children.map((g) => {
    const dt = g.children.find((c) => c.tagName === "dt");
    const value = g.children.find((c) => c.tagName === "dd" && c.classList.contains("ledger-value"));
    const sub = g.children.find((c) => c.tagName === "dd" && c.classList.contains("ledger-sub"));
    return {
      label: dt ? visibleText(dt).trim() : "",
      value: value ? visibleText(value).trim() : "",
      sub: sub ? visibleText(sub).trim() : null,
      tone: g.getAttribute("data-tone"),
      group: g,
    };
  });
}

/** The figures of the FIRST ledger in `html` (throws when there is none, so a
    lost ledger fails loudly rather than reading as "no figures"). */
export function ledgerFigures(html: string | MiniElement): LedgerFigure[] {
  const dl = ledgers(html)[0];
  if (!dl) throw new Error("ledgerFigures: no dl.design-ledger in the markup");
  return figuresOf(dl);
}

/** The structural problems of one ledger: a group that holds anything but
    `dt`/`dd`, a group without exactly one `dt` and one `.ledger-value`, or a
    direct child of the `dl` that is not a figure group. Empty = valid. */
export function ledgerStructureProblems(dl: MiniElement): string[] {
  const out: string[] = [];
  if (dl.tagName !== "dl") out.push(`the ledger is a <${dl.tagName}>, not a <dl>`);
  for (const g of dl.children) {
    if (g.tagName !== "div" || !g.classList.contains("ledger-fig")) {
      out.push(`a <${g.tagName}> sits directly in the list, outside a figure group`);
      continue;
    }
    const tags = g.children.map((c) => c.tagName);
    const stray = tags.filter((t) => t !== "dt" && t !== "dd");
    if (stray.length) out.push(`a group holds ${stray.map((t) => `<${t}>`).join(", ")} — only dt and dd are valid`);
    if (tags.filter((t) => t === "dt").length !== 1) out.push("a group without exactly one dt");
    if (g.children.filter((c) => c.tagName === "dd" && c.classList.contains("ledger-value")).length !== 1) out.push("a group without exactly one value dd");
    const firstDd = tags.indexOf("dd");
    if (firstDd >= 0 && tags.indexOf("dt") > firstDd) out.push("a group whose dt does not lead");
  }
  return out;
}
