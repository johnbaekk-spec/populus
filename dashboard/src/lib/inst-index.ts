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
// F3: the directory body renderer lives here now and needs the filer href
// builder the page and the island both used.
import { filerHref } from "./holdings.ts";
import {
  MANAGER_TYPE_LABELS,
  biggestChangeCellHtml,
  matchesDirectoryFilter,
  type BiggestChangeResult,
  type ManagerType,
  type ManagerTyping,
} from "./manager-directory.ts";

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
  /* R11: curated typing, or null when this filer is not in the registry.
     Coverage is a CURATED SUBSET — roughly 8,700 filers exist and the seed
     types 113 — so an untyped filer is the common case and renders its FILED
     name, never a guessed type. */
  typing: ManagerTyping | null;
  /* R11/R22: the change cell, RENDERED AT BUILD TIME.

     The cell is precomputed rather than carrying its source delta row into the
     page's embedded JSON. The client island re-renders rows on sort and
     search, so it needs the cell — but embedding a whole delta row per filer
     to recompute one string would multiply the page's payload for no gain, and
     the SSR and client bytes would then depend on two renders agreeing rather
     than on one string being reused. */
  changeHtml: string;
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
  typing: ManagerTyping | null = null,
  change: BiggestChangeResult = { best: null, unrankable: 0 },
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
    typing: typing ?? null,
    changeHtml: biggestChangeCellHtml(change),
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
  // F14: `name` orders the DISPLAYED primary identity. The directory renders a
  // curated display name as the manager's name whenever one exists, so sorting
  // on the filed name ordered the column by text the reader cannot see.
  const keyOf = (r: InstIndexRow): number | string | null =>
    key === "name"
      ? displayNameOf(r).toLowerCase()
      : key === "value"
        ? r.value
        : key === "hhi"
          ? r.hhi
          : r.positions;
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
/** The name the directory actually shows as primary. */
export function displayNameOf(r: InstIndexRow): string {
  return r.typing?.display_name ?? r.name;
}

/** F14: search every identity the row PRESENTS — curated display name, the
    filed name printed beside it, the person named on the row, and the CIK.
    Searching only the filed name meant typing a curated name, or the name of
    the person the directory prints, returned nothing. */
export function filterInstIndexRows(rows: readonly InstIndexRow[], q: string): InstIndexRow[] {
  const query = q.trim().toLowerCase();
  if (!query) return [...rows];
  return rows.filter((r) => {
    const person = r.typing?.person ?? "";
    return (
      displayNameOf(r).toLowerCase().includes(query) ||
      r.name.toLowerCase().includes(query) ||
      person.toLowerCase().includes(query) ||
      r.cik.replace(/^0+/, "").startsWith(query)
    );
  });
}

/** F13: chips are part of the ROW SET, not a post-render DOM pass.

    They used to be applied by hiding `<tr>`s after render, so any sort or
    search replaced the tbody and silently un-hid every filtered-out manager
    while the chip stayed pressed. Filtering happens here, in the same pure
    pipeline as search and sort, so the three cannot disagree. */
export function applyDirectoryChips(
  rows: readonly InstIndexRow[],
  filter: { types: ReadonlySet<string>; notableOnly: boolean },
): InstIndexRow[] {
  return rows.filter((r) => matchesDirectoryFilter(r.typing ?? null, {
    types: filter.types as ReadonlySet<ManagerType>,
    notableOnly: filter.notableOnly,
  }));
}

/** One row of the index table. `filerHrefOf` stays injected so this module
    remains pure and the R22 top/tail routing has one owner. */
/** R11: the curated display name when the registry has one, the FILED name
    otherwise. The filed name is never hidden — a curated name is a convenience
    label, and the string the filing actually carries stays beside it so a
    reader can match what they see here against the filing itself. */
function nameCellHtml(r: InstIndexRow, href: string): string {
  const typing = r.typing ?? null;
  if (typing === null) {
    return `<a href="${esc(href)}">${esc(r.name)}</a>`;
  }
  return (
    `<a href="${esc(href)}">${esc(typing.display_name)}</a>` +
    (typing.person ? ` <span class="mgr-person">${esc(typing.person)}</span>` : "") +
    `<span class="mono-note filed-name"> filed as ${esc(r.name)}</span>`
  );
}

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
  const typing = r.typing ?? null;
  const typeCell =
    typing === null
      ? `<span class="none" title="not in the curated registry — this build types a curated subset, not the population">—</span>`
      : `<span class="mgr-chip" data-type="${esc(typing.manager_type)}">${esc(
          MANAGER_TYPE_LABELS[typing.manager_type] ?? typing.manager_type,
        )}</span>${typing.notable ? ` <span class="mgr-chip mgr-chip-notable">notable</span>` : ""}`;
  return (
    `<tr data-mgr-type="${esc(typing?.manager_type ?? "")}" data-mgr-notable="${
      typing?.notable ? "1" : "0"
    }"><td class="c-filer">${nameCellHtml(r, filerHrefOf(r))}</td>` +
    `<td class="c-type">${typeCell}</td>` +
    `<td class="c-num">${esc(r.period)}</td>` +
    `<td class="c-num c-strong">${valueCell}${nullNote}</td>` +
    `<td class="c-num">${r.positions == null ? "—" : fmtInt(r.positions)}</td>` +
    `<td class="c-num">${hhiCell}</td>` +
    `<td class="c-num">${r.changeHtml ?? ""}</td>` +
    `<td class="c-num c-muted mono-id">CIK ${esc(r.cik)}</td></tr>`
  );
}

export const INST_INDEX_HEADS: { key: InstSortKey | null; label: string; why?: string }[] = [
  { key: "name", label: "Manager" },
  {
    key: null,
    label: "Type",
    why:
      "type comes from a curated registry covering a subset of filers, so ordering by it would " +
      "rank the curated rows above every untyped one — filter with the chips instead",
  },
  { key: null, label: "Period", why: "each row states its own latest period; the column is not a common scale" },
  { key: "value", label: "Reported 13(f) long value ·§" },
  { key: "positions", label: "Positions" },
  { key: "hhi", label: "HHI (bps) ·§" },
  {
    key: null,
    label: "Biggest change ·¶",
    why:
      "the largest change is ranked within each manager separately, so it is not a quantity two " +
      "managers can be ordered on — sort by reported value to compare managers",
  },
  { key: null, label: "CIK", why: "an identifier, not a magnitude" },
];

/** The rendered body for a given query and sort. Exported so a characterization
    test can prove the refactor preserved it byte-for-byte. */
export function instIndexBodyHtml(
  rows: readonly InstIndexRow[],
  q: string,
  sortKey: InstSortKey,
  dir: "asc" | "desc",
  chips: { types: ReadonlySet<string>; notableOnly: boolean } = {
    types: new Set<string>(),
    notableOnly: false,
  },
  compact?: number,
): { html: string; note: string; total: number; shown: number } {
  // F13: chips, search and sort are ONE pipeline. Chips used to hide <tr>s
  // after render, so any sort or search rebuilt the tbody and silently
  // un-hid every filtered-out manager while the chip stayed pressed.
  const filtered = filterInstIndexRows(applyDirectoryChips(rows, chips), q);
  const { ranked, unranked } = sortInstIndexRows(filtered, sortKey, dir);
  const href = (r: InstIndexRow): string => filerHref(r.cik, r.tier);
  // F20: the separator spans the table's ACTUAL column count, derived from the
  // one column contract rather than a literal that goes stale when a column is
  // added — which is exactly what happened when the directory grew to eight.
  const span = INST_INDEX_HEADS.length;
  const total = ranked.length + unranked.length;
  const limit = compact ?? total;
  const rankedShown = ranked.slice(0, limit);
  const unrankedShown = unranked.slice(0, Math.max(0, limit - ranked.length));
  const html =
    rankedShown.map((r) => instIndexRowHtml(r, href)).join("\n") +
    // The stated absence renders whenever the bucket is non-empty, not only
    // when one of its rows survives the compact slice (the F5 rule, applied
    // to this table too).
    (unranked.length > 0
      ? `<tr class="unranked-sep"><td colspan="${span}">${fmtInt(unranked.length)} filers have no ` +
        `value for the active sort key — listed below in CIK order, never treated as zero</td></tr>` +
        unrankedShown.map((r) => instIndexRowHtml(r, href)).join("\n")
      : "");
  const active = chips.types.size + (chips.notableOnly ? 1 : 0);
  const note =
    `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} managers · sorted by ${sortKey} ${dir}` +
    (active > 0 ? ` · ${active} filter${active === 1 ? "" : "s"} active` : "") +
    ` · filtered on this device`;
  return { html, note, total, shown: rankedShown.length + unrankedShown.length };
}

/** Default direction when switching TO a column: names ascend, numbers descend. */
export function instDefaultDir(key: string): "asc" | "desc" {
  return key === "name" ? "asc" : "desc";
}
