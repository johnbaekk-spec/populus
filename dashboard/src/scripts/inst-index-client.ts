/* A-2 client island for /institutional: name/CIK search + sortable headers
   over the embedded index rows. Sorting and filtering are the SAME pure
   functions the SSR page used, so the re-rendered order can never drift from
   the pre-rendered one. All work happens on this device.

   R48: the header/direction/aria/announcement plumbing now comes from the
   shared `initSortableTable`, which owns NO ordering semantics. Comparison,
   the ranked/unranked split and the tie-break stay here, in the domain — that
   separation is the whole point (external plan review F2), and it is why this
   refactor changes no observable behaviour. `inst-index-client.test.ts` pins
   that: it captures this island's output and asserts it is unchanged. */

import {
  filterInstIndexRows,
  instIndexRowHtml,
  sortInstIndexRows,
  type InstIndexRow,
  type InstSortKey,
} from "../lib/inst-index.ts";
import { fmtInt } from "../lib/format.ts";
import { filerHref } from "../lib/holdings.ts";
import { initSortableTable } from "./table-sort.ts";

/** The rendered body for a given query and sort. Exported so a characterization
    test can prove the refactor preserved it byte-for-byte. */
export function instIndexBodyHtml(
  rows: readonly InstIndexRow[],
  q: string,
  sortKey: InstSortKey,
  dir: "asc" | "desc",
): { html: string; note: string } {
  const filtered = filterInstIndexRows(rows, q);
  const { ranked, unranked } = sortInstIndexRows(filtered, sortKey, dir);
  const href = (r: InstIndexRow): string => filerHref(r.cik, r.tier);
  const html =
    ranked.map((r) => instIndexRowHtml(r, href)).join("\n") +
    (unranked.length > 0
      ? `<tr class="unranked-sep"><td colspan="6">${fmtInt(unranked.length)} filers have no ` +
        `value for the active sort key — listed below in CIK order, never treated as zero</td></tr>` +
        unranked.map((r) => instIndexRowHtml(r, href)).join("\n")
      : "");
  const note = `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} filers · sorted by ${sortKey} ${dir} · filtered on this device`;
  return { html, note };
}

/** Default direction when switching TO a column: names ascend, numbers descend. */
export function instDefaultDir(key: string): "asc" | "desc" {
  return key === "name" ? "asc" : "desc";
}

export function initInstIndex(): void {
  const dataEl = document.getElementById("inst-index-data");
  const bodyEl = document.getElementById("inst-index-body");
  const searchEl = document.getElementById("inst-index-q") as HTMLInputElement | null;
  const countEl = document.getElementById("inst-index-count");
  const statusEl = document.getElementById("inst-index-status");
  if (!dataEl || !bodyEl) return;

  let rows: InstIndexRow[];
  try {
    rows = JSON.parse(dataEl.textContent ?? "[]") as InstIndexRow[];
  } catch {
    return; // SSR table stays — the island is a convenience, never load-bearing
  }

  let q = "";
  let lastNote = "";

  const rerender = initSortableTable({
    root: bodyEl,
    headers: Array.from(document.querySelectorAll<HTMLElement>("[data-inst-sort]")),
    keyOf: (th) => (th as HTMLElement).dataset.instSort,
    initial: { key: "value", dir: "desc" },
    defaultDir: instDefaultDir,
    render: (state) => {
      const { html, note } = instIndexBodyHtml(rows, q, state.key as InstSortKey, state.dir);
      lastNote = note;
      if (countEl) countEl.textContent = note;
      return html;
    },
    announce: () => lastNote,
    statusEl,
  });

  searchEl?.addEventListener("input", () => {
    q = searchEl.value;
    rerender();
  });
}
