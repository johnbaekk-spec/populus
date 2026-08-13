/* A-2 (ALPHA-UX): the institutional index ranking. Pure — shared by the SSR
   page and the client sort/search island, so both orders are the same code.

   Period-correct sourcing (constraint 4): every number here comes from
   `agg_filer_concentration` for the filer's LATEST period — never from the
   registry's cross-period accumulators. The period renders beside the value.

   Naming (constraint 3): the metric is "reported 13(f) long value" — it
   excludes cash, shorts and non-13(f) assets, so it is never called AUM or
   fund size, and a large multi-asset manager can legitimately look small.

   HHI honesty (constraint 5): HHI is shown and sortable ONLY when the
   period's book has zero NULL-valued positions. A partial denominator makes
   the number a false concentration claim, so it renders as n/a with the
   reason, and n/a rows are excluded from HHI ordering — bucketed after,
   never given a sentinel. */

import { esc, fmtInt, fmtUsd } from "./format.ts";

export interface InstIndexRow {
  cik: string;
  name: string;
  period: string; // the filer's latest period on record
  /** reported 13(f) long value for `period`; null = no concentration row or
      producer NULL — excluded from value ordering, never zero-filled */
  value: number | null;
  positions: number | null;
  nullValuePositions: number | null;
  /** HHI in bps; null when unavailable OR when the denominator is partial
      (nullValuePositions > 0) — the constraint-5 rule applied at build */
  hhi: number | null;
  /** why hhi is null, for the cell title; "" when hhi is present */
  hhiNote: string;
  tier: "top" | "tail";
}

export function buildInstIndexRow(
  filer: { cik: string; filer_name: string; latest_period: string },
  conc: {
    total_value_usd: number;
    position_count: number;
    null_value_positions: number;
    hhi: number | null;
  } | null,
  tier: "top" | "tail",
): InstIndexRow {
  let hhi: number | null = null;
  let hhiNote = "";
  if (conc === null) {
    hhiNote = "no concentration row for this filer's latest period";
  } else if (conc.hhi == null) {
    hhiNote = "concentration_unavailable: the producer stores NULL, never a fabricated 0";
  } else if (conc.null_value_positions > 0) {
    // Constraint 5: a filer with disclosed positions AND NULL-valued ones
    // would score concentration on a partial denominator — withheld from
    // ordering entirely rather than renamed.
    hhiNote = `${conc.null_value_positions} of ${conc.position_count} positions carry a NULL value — HHI over a partial denominator is not comparable and is withheld`;
  } else {
    hhi = conc.hhi;
  }
  return {
    cik: filer.cik,
    name: filer.filer_name,
    period: filer.latest_period,
    value: conc === null ? null : conc.total_value_usd,
    positions: conc === null ? null : conc.position_count,
    nullValuePositions: conc === null ? null : conc.null_value_positions,
    hhi,
    hhiNote,
    tier,
  };
}

export type InstSortKey = "value" | "hhi" | "name" | "positions";

/** Sort with the no-sentinel rule: rows whose active key is null go to a
    trailing bucket in CIK order — never interleaved as if zero. Name sort has
    no null case. Ties break on CIK asc so the order is reproducible. */
export function sortInstIndexRows(
  rows: readonly InstIndexRow[],
  key: InstSortKey,
  dir: "asc" | "desc",
): { ranked: InstIndexRow[]; unranked: InstIndexRow[] } {
  const keyOf = (r: InstIndexRow): number | string | null =>
    key === "name" ? r.name.toLowerCase() : key === "value" ? r.value : key === "hhi" ? r.hhi : r.positions;
  const ranked = rows.filter((r) => keyOf(r) !== null);
  const unranked = rows.filter((r) => keyOf(r) === null).sort((a, b) => (a.cik < b.cik ? -1 : 1));
  const sign = dir === "desc" ? -1 : 1;
  ranked.sort((a, b) => {
    const ka = keyOf(a)!;
    const kb = keyOf(b)!;
    if (ka !== kb) return ka < kb ? sign * -1 : sign;
    return a.cik < b.cik ? -1 : a.cik > b.cik ? 1 : 0;
  });
  return { ranked, unranked };
}

/** Case-insensitive name substring + CIK prefix search. */
export function filterInstIndexRows(rows: readonly InstIndexRow[], q: string): InstIndexRow[] {
  const query = q.trim().toLowerCase();
  if (!query) return [...rows];
  return rows.filter(
    (r) => r.name.toLowerCase().includes(query) || r.cik.replace(/^0+/, "").startsWith(query),
  );
}

/** One row of the index table. `filerHrefOf` stays injected so this module
    remains pure and the R22 top/tail routing has one owner. */
export function instIndexRowHtml(r: InstIndexRow, filerHrefOf: (r: InstIndexRow) => string): string {
  const valueCell =
    r.value == null
      ? `<span class="none" title="no period-correct value for ${esc(r.period)} — never zero-filled">n/a ·§</span>`
      : esc(fmtUsd(r.value));
  const nullNote =
    r.nullValuePositions != null && r.nullValuePositions > 0
      ? ` <span class="mono-note" title="positions whose value did not parse — excluded from the sum, surfaced beside it">+${fmtInt(r.nullValuePositions)} null</span>`
      : "";
  const hhiCell =
    r.hhi == null
      ? `<span class="none" title="${esc(r.hhiNote)}">n/a ·§</span>`
      : `${fmtInt(r.hhi)}`;
  return (
    `<tr><td class="c-filer"><a href="${esc(filerHrefOf(r))}">${esc(r.name)}</a></td>` +
    `<td class="c-num">${esc(r.period)}</td>` +
    `<td class="c-num c-strong">${valueCell}${nullNote}</td>` +
    `<td class="c-num">${r.positions == null ? "—" : fmtInt(r.positions)}</td>` +
    `<td class="c-num">${hhiCell}</td>` +
    `<td class="c-num c-muted mono-id">CIK ${esc(r.cik)}</td></tr>`
  );
}

export const INST_INDEX_HEADS: { key: InstSortKey | null; label: string }[] = [
  { key: "name", label: "Filer" },
  { key: null, label: "Period" },
  { key: "value", label: "Reported 13(f) long value ·§" },
  { key: "positions", label: "Positions" },
  { key: "hhi", label: "HHI (bps) ·§" },
  { key: null, label: "CIK" },
];
