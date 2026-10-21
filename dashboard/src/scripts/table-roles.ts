/* launch M1a (R40, LD37): the client half of the explicit table semantics.

   Every client sink that paints table markup — a page of feed rows, a member's
   transactions, a sorted body, a period's holders — passes the markup through
   `rolesFor` before it lands, so a repaint carries exactly the roles (and the
   card labels) the server's first paint carried: `withTableRoles` is the same
   pure function `Base.astro` runs over the page body. A FRAGMENT of rows takes
   its column labels from the live table head it is painted into; markup that
   holds a whole table takes them from its own head.

   Structural typing (`closest`, `querySelectorAll`, `getAttribute`) rather than
   the DOM's own types, so the fake-DOM roots the unit tests pass keep working:
   a target with no `closest` simply has no head to read. */

import { esc, withTableRoles } from "../lib/format.ts";

interface NodeLike {
  readonly tagName?: string;
  readonly children?: ArrayLike<NodeLike>;
  getAttribute?(name: string): string | null;
}
interface Paintable {
  closest?: (selector: string) => NodeLike | null;
}

const childrenNamed = (el: NodeLike, tag: string): NodeLike[] =>
  Array.from(el.children ?? []).filter((c) => (c.tagName ?? "").toLowerCase() === tag);

/** The attribute-encoded `data-label` of each column of the table `target`
    sits in, from the head's last row (colspans expanded); undefined when the
    target is not inside a table with a head. Walks `children` rather than a
    `:scope` selector, so a nested table's head is never read. */
export function headLabels(target: unknown): (string | null)[] | undefined {
  const el = target as Paintable | null;
  const table = el && typeof el.closest === "function" ? el.closest("table") : null;
  if (!table) return undefined;
  const head = childrenNamed(table, "thead")[0];
  const rows = head ? childrenNamed(head, "tr") : [];
  const last = rows[rows.length - 1];
  if (!last) return undefined;
  const out: (string | null)[] = [];
  for (const cell of Array.from(last.children ?? [])) {
    const span = Math.max(1, Number.parseInt(cell.getAttribute?.("colspan") ?? "1", 10) || 1);
    const label = cell.getAttribute?.("data-label") ?? null;
    out.push(label == null ? null : esc(label));
    for (let i = 1; i < span; i++) out.push(null);
  }
  return out;
}

/** `html` with the explicit table roles, ready to assign to `target`. */
export function rolesFor(target: unknown, html: string): string {
  return withTableRoles(html, { labels: headLabels(target) });
}
