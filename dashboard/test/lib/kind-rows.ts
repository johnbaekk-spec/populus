/* DESIGN-POLISH M3 (T3.1, T-5): the ADD and TRIM rows of a filer page's
   Position changes table, read by DOM PARSE rather than by a regex over the
   row markup.

   The pre-M3 check (`refinement-dist.test.ts`, R8) matched rows with
   `<tr>…qoq-chip qoq-(add|trim)…</tr>`. Once M1 put `id` and `data-edge` on
   every change row, `<tr>` never matched, and the check passed on nothing — it
   collected zero rows and asserted that none of them was wrong. This reader
   finds the table by its tbody id, reads its header to locate the Δ shares
   column by label (column presence can remove columns, so no index is
   hard-coded), and returns every row whose kind cell READS "ADD" or "TRIM",
   with the text of that row's Δ shares cell and whether its kind cell carries
   the producer's †v (classified_by_value) marker. The caller asserts that at
   least one such row exists and that none has a Δ shares of exactly "0"
   unless the row itself discloses the pre-R8 value classification. */

import { domOf, visibleText } from "./ledger-dom.ts";

export interface KindRow {
  kind: string;
  deltaShares: string;
  /** the kind cell carries the producer's `classified_by_value` marker (†v):
      a row from an aggregate built before R8 (refinement 20260910), whose
      direction was inferred from the reported value — the one case in which
      an ADD or TRIM may sit on an unchanged share count, disclosed on the row */
  valueClassified: boolean;
}

/** The ADD / TRIM rows of the `#filer-changes-tbody` table in `html`, or
    `null` when the page renders no such table. Throws when the table is there
    but its header has no Δ shares column: a check that cannot find the column
    it reads must not read as "no violation". */
export function addTrimRows(html: string): KindRow[] | null {
  const at = html.indexOf('id="filer-changes-tbody"');
  if (at < 0) return null;
  const start = html.lastIndexOf("<table", at);
  const end = html.indexOf("</table>", at);
  if (start < 0 || end < 0) throw new Error("the changes tbody sits outside a closed <table>");
  const table = domOf(html.slice(start, end + "</table>".length));
  const heads = table.querySelectorAll("thead th").map((th) => {
    /* a header's accessible suffix (", explain") is not its label */
    const label = visibleText(th).replace(/, explain/g, "").replace(/\s+/g, " ").trim();
    return label;
  });
  const col = heads.findIndex((h) => h === "Δ shares");
  if (col < 0) throw new Error(`no "Δ shares" column in the changes table header (${heads.join(" | ")})`);
  const out: KindRow[] = [];
  for (const tr of table.querySelectorAll("tbody tr")) {
    const kindCell = tr.children.find((c) => c.tagName === "td" && c.classList.contains("c-kind"));
    if (!kindCell) continue;
    const raw = visibleText(kindCell).replace(/\s+/g, " ").trim();
    const kind = raw.replace(/[‡†][a-z]/g, "").trim();
    if (kind !== "ADD" && kind !== "TRIM") continue;
    const cells = tr.children.filter((c) => c.tagName === "td");
    out.push({ kind, deltaShares: visibleText(cells[col]!).replace(/\s+/g, " ").trim(), valueClassified: raw.includes("†v") });
  }
  return out;
}

/** The R8 violations among `rows` (P-5, M3 review): an ADD or TRIM whose Δ
    shares is exactly "0". A row that carries the producer's †v disclosure is
    exempt ONLY when the aggregate the build read PREDATES R8 (`preR8`, read
    from the artifact by the caller, the way R1 reads its display relation):
    such an aggregate classified some share-unchanged changes by value and
    says so on the row. A post-R8 aggregate classifies every unchanged share
    count as NO CHANGE and sets no †v, so there the rule is the plan's own —
    no exemption at all (P-4 / M3-D12 as revised by the review). */
export function r8Violations(rows: readonly KindRow[], preR8: boolean): KindRow[] {
  return rows.filter((r) => r.deltaShares === "0" && !(preR8 && r.valueClassified));
}

/** Whether a quarter-over-quarter view's DDL predates R8 (refinement
    20260910): R8 added the `held` (NO CHANGE) kind to `agg_qoq_deltas`, so a
    view whose SQL never names 'held' was produced before it. `null` when no
    view SQL is available — the caller treats that as NOT pre-R8 (strict). */
export function qoqViewPredatesR8(viewSql: string | null | undefined): boolean | null {
  if (viewSql == null || viewSql.trim() === "") return null;
  return !/'held'/.test(viewSql);
}

