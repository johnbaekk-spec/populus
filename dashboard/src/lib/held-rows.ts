/* The held-rows carrier — the SERVER half of pagination-and-counts.md rule 8
   (launch redesign LD26, R27). The client half is the one binder,
   `initDomDisclosures` in `scripts/inst-index-client.ts`, extended with
   `registerHeldRows`.

   A held table renders its first N rows into its `tbody` and NOTHING ELSE of
   rows N+1..M. Those rows travel as JSON in an inline island
   (`<script type="application/json" data-held-for="<tbody id>"
   data-held-render="<name>">`), whose body carries EVERY input the row function
   reads — the rows themselves and any table-wide input — so the client renders
   them through the SAME function and gets byte-identical HTML. Where a reader
   without JavaScript can reach the held rows today, a `<noscript>` after the
   table holds a SECOND table of exactly those rows (never inside a `tbody`:
   the parser would hoist it out); with scripting on, its content is inert text
   and costs no DOM.

   No DOM and no Node APIs here: the module is imported by the server renderers
   and, for its types and `parseHeldIsland`, by the client binder. */

import { serializeInlineJson } from "./inline-json.ts";

/** A row function a held table renders through, on the server AND in the
    client. `index` is the row's ZERO-BASED position in the WHOLE table (the
    first held row is index N), so a rank column numbers identically on both
    sides. The function must read nothing but its three arguments. */
export type HeldRowFn<R, S> = (row: R, index: number, shared: S) => string;

/** The island's JSON body. `offset` is N, the count of rows the server already
    rendered in the tbody; `rows` are rows N..M-1, in order; `shared` is every
    table-wide input the row function reads. */
export interface HeldIsland<R = unknown, S = unknown> {
  v: 1;
  offset: number;
  shared: S;
  rows: R[];
}

/** The second table a `<noscript>` holds: its opening `<table …>` tag (with the
    same class, roles and `data-card` as the first), its visible caption, and
    its `<thead>` (the same header markup as the first table). */
export interface HeldNoscript {
  tableOpen: string;
  caption: string;
  thead: string;
}

export interface HeldTableOpts<R, S> {
  /** id of the first table's `tbody` — the island names it in `data-held-for` */
  rootId: string;
  /** the name the row function is registered under on the client */
  render: string;
  rowFn: HeldRowFn<R, S>;
  /** EVERY row of the table, in display order */
  rows: readonly R[];
  /** N: rows rendered in the tbody */
  shown: number;
  shared: S;
  /** only where a no-JS reader can reach the held rows today (rule 8);
      null or absent ships the island alone */
  noscript?: HeldNoscript | null;
}

export interface HeldTableParts {
  /** the first N rows, for the first table's tbody */
  bodyRows: string;
  /** the island element, or "" when nothing is held */
  island: string;
  /** the `<noscript>` second table, or "" */
  noscript: string;
  total: number;
  shown: number;
  held: number;
}

function attr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Split one table's rows into what the DOM gets now (the first N rows), what
    the client gets as JSON (the island), and what a no-JS reader gets (the
    `<noscript>` second table). Every row, in every carrier, is the output of
    the same `rowFn` over the same inputs. */
export function heldTableParts<R, S>(o: HeldTableOpts<R, S>): HeldTableParts {
  const shown = Math.max(0, Math.min(o.shown, o.rows.length));
  const bodyRows = o.rows
    .slice(0, shown)
    .map((r, i) => o.rowFn(r, i, o.shared))
    .join("\n");
  const heldRows = o.rows.slice(shown);
  if (heldRows.length === 0) {
    return { bodyRows, island: "", noscript: "", total: o.rows.length, shown, held: 0 };
  }
  const body: HeldIsland<R, S> = { v: 1, offset: shown, shared: o.shared, rows: heldRows };
  const island =
    `<script type="application/json" data-held-for="${attr(o.rootId)}" data-held-render="${attr(o.render)}">` +
    serializeInlineJson(body) +
    `</script>`;
  const noscript = o.noscript
    ? `<noscript>` +
      o.noscript.tableOpen +
      `<caption>${o.noscript.caption}</caption>` +
      o.noscript.thead +
      `<tbody role="rowgroup">${heldRows.map((r, j) => o.rowFn(r, shown + j, o.shared)).join("\n")}</tbody>` +
      `</table></noscript>`
    : "";
  return { bodyRows, island, noscript, total: o.rows.length, shown, held: heldRows.length };
}

/** Parse an island body, or null when it is not one. The client binder calls
    this on the island's text — JSON in, never HTML. */
export function parseHeldIsland(text: string | null | undefined): HeldIsland | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<HeldIsland>;
    if (v && v.v === 1 && Array.isArray(v.rows) && typeof v.offset === "number") return v as HeldIsland;
  } catch {
    /* a malformed island renders nothing; the server's first N rows stand */
  }
  return null;
}
