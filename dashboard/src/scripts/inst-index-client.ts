/* A-2 client island for /institutional: name/CIK search + sortable headers
   over the embedded index rows. Sorting and filtering are the SAME pure
   functions the SSR page used, so the re-rendered order can never drift from
   the pre-rendered one. All work happens on this device. */

import {
  filterInstIndexRows,
  instIndexRowHtml,
  sortInstIndexRows,
  type InstIndexRow,
  type InstSortKey,
} from "../lib/inst-index.ts";
import { fmtInt } from "../lib/format.ts";
import { filerHref } from "../lib/holdings.ts";

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

  let sortKey: InstSortKey = "value";
  let dir: "asc" | "desc" = "desc";
  let q = "";

  function render(): void {
    const filtered = filterInstIndexRows(rows, q);
    const { ranked, unranked } = sortInstIndexRows(filtered, sortKey, dir);
    const href = (r: InstIndexRow): string => filerHref(r.cik, r.tier);
    bodyEl!.innerHTML =
      ranked.map((r) => instIndexRowHtml(r, href)).join("\n") +
      (unranked.length > 0
        ? `<tr class="unranked-sep"><td colspan="6">${fmtInt(unranked.length)} filers have no ` +
          `value for the active sort key — listed below in CIK order, never treated as zero</td></tr>` +
          unranked.map((r) => instIndexRowHtml(r, href)).join("\n")
        : "");
    const text = `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} filers · sorted by ${sortKey} ${dir} · filtered on this device`;
    if (countEl) countEl.textContent = text;
    if (statusEl) statusEl.textContent = text;
    document.querySelectorAll<HTMLElement>("[data-inst-sort]").forEach((th) => {
      const active = th.dataset.instSort === sortKey;
      th.setAttribute("aria-sort", active ? (dir === "desc" ? "descending" : "ascending") : "none");
    });
  }

  document.querySelectorAll<HTMLElement>("[data-inst-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.instSort as InstSortKey;
      if (key === sortKey) dir = dir === "desc" ? "asc" : "desc";
      else {
        sortKey = key;
        dir = key === "name" ? "asc" : "desc";
      }
      render();
    });
  });
  searchEl?.addEventListener("input", () => {
    q = searchEl.value;
    render();
  });
}
