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

import { esc, fmtCik, fmtInt, fmtUsd, note, presentColumns, type PresentColumns } from "./format.ts";
// The directory body renderer lives here now and needs the filer href
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
  reference?: boolean;
  top5Share?: number | null;
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
  /* Curated typing, or null when this filer is not in the registry.
     Coverage is a CURATED SUBSET — roughly 8,700 filers exist and the seed
     types 113 — so an untyped filer is the common case and renders its FILED
     name, never a guessed type. */
  typing: ManagerTyping | null;
  /* The change cell, RENDERED AT BUILD TIME.

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
  // Constraint 5: a filer with disclosed positions AND NULL-valued ones would
  // score concentration on a partial denominator — withheld from ordering
  // entirely rather than renamed (`hhiNoteFor` states which reason applies).
  const hhi: number | null = conc === null || conc.null_value_positions > 0 || conc.hhi == null ? null : conc.hhi;
  const hhiNote = hhiNoteFor(
    conc === null ? null : conc.position_count,
    conc === null ? null : conc.null_value_positions,
    hhi,
  );
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

/** Why a row's HHI is withheld, or "" when it is shown. ONE function for the
    server row builder and the directory shard reader (launch M7b, LD28): the
    note is derived from the fields a slim shard row carries, so it is never
    shipped a second time per filer and can never disagree with the row. */
export function hhiNoteFor(positions: number | null, nullValuePositions: number | null, hhi: number | null): string {
  if (positions === null) return "no concentration row for this filer's latest period";
  if (nullValuePositions !== null && nullValuePositions > 0) {
    return `${nullValuePositions} of ${positions} positions carry a NULL value — HHI over a partial denominator is not comparable and is withheld`;
  }
  if (hhi === null) return "concentration_unavailable: the producer stores NULL, never a fabricated 0";
  return "";
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
  // `name` orders the DISPLAYED primary identity. The directory renders a
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

/** Search every identity the row PRESENTS — curated display name, the
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

/** Chips are part of the ROW SET, not a post-render DOM pass.

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
    remains pure and the top/tail routing has one owner. */
/** The curated display name when the registry has one, the FILED name
    otherwise. The filed name is never hidden — a curated name is a convenience
    label, and the string the filing actually carries stays beside it so a
    reader can match what they see here against the filing itself. */
function nameCellHtml(r: InstIndexRow, href: string): string {
  const typing = r.typing ?? null;
  /* the row's main link (launch review M2): the name cell is the row's */
  if (typing === null) {
    return `<a data-row-link href="${esc(href)}">${esc(r.name)}</a>`;
  }
  return (
    `<a data-row-link href="${esc(href)}">${esc(typing.display_name)}</a>` +
    (typing.person ? ` <span class="mgr-person">${esc(typing.person)}</span>` : "") +
    `<span class="mono-note filed-name"> filed as ${esc(r.name)}</span>`
  );
}

/** R12 (DESIGN-POLISH M2; review R2-6): the reference directory's columns
    over its FULL collection — every filer any sort, search or chip can show —
    through the ONE presence function. "Top-5" is derived: it exists only when
    the build's concentration slices hold five positions and some filer carries
    a share; otherwise it is removed and the table foot says why. The set
    travels in `data-columns`, which the client re-render reads back. */
export function directoryColumns(rows: readonly InstIndexRow[], topn: number): PresentColumns {
  return presentColumns(rows, [
    { key: "filer", always: true },
    { key: "cik", always: true },
    { key: "value", always: true },
    { key: "positions", always: true },
    {
      key: "top5",
      hasValue: (r) => topn === 5 && r.top5Share != null,
      emptyReason:
        topn === 5
          ? "Not shown: the top-five share — no filer's concentration slice in this build carries one."
          : `Not shown: the top-five share — this build's concentration slices hold the top ${fmtInt(topn)} positions, not five.`,
    },
    { key: "latest-notable", always: true },
  ]);
}

/** `columns`: the table's `data-columns` set (reference rows). Without it the
    row falls back to whether it carries the field — the pre-M2 contract. */
export function instIndexRowHtml(r: InstIndexRow, filerHrefOf: (r: InstIndexRow) => string, columns: readonly string[] | null = null): string {
  /* Four tooltip-only explanations become notes, keyed
     on the row's CIK — one row per CIK per rendered table, so it is singular
     by construction. */
  const nctx = { scope: "inst-index-row" };
  /* DESIGN-POLISH M1 (R6): each note's trigger is the text it explains (the
     label form), so no glyph widens a numeric cell. The reference row's
     period-and-HHI note rides on the value itself; the "+N null" qualifier
     sits BEFORE the value so every value's last digit stays on the edge. */
  const periodText = `Reporting period ${r.period}. HHI ${r.hhi == null ? r.hhiNote : fmtInt(r.hhi) + " bps"}.`;
  const valueCell =
    r.value == null
      ? note(
          `no period-correct value for ${r.period} — never zero-filled` + (r.reference ? `. ${periodText}` : ""),
          nctx,
          `${r.cik}-period`,
          { trigger: "label", textHtml: `<span class="none">n/a ·§</span>`, name: "n/a" },
        )
      : r.reference
        ? note(periodText, nctx, `${r.cik}-period`, { trigger: "label", textHtml: esc(fmtUsd(r.value)) })
        : esc(fmtUsd(r.value));
  const nullNote =
    r.nullValuePositions != null && r.nullValuePositions > 0
      ? note(
          "positions whose value did not parse — excluded from the sum, surfaced beside it",
          nctx,
          `${r.cik}-nullvalue`,
          { trigger: "label", textHtml: `<span class="mono-note">+${fmtInt(r.nullValuePositions)} null</span>` },
        ) + " "
      : "";
  const hhiCell =
    r.hhi == null
      ? note(r.hhiNote, nctx, `${r.cik}-hhi`, { trigger: "label", textHtml: `<span class="none">n/a ·§</span>`, name: "n/a" })
      : `${fmtInt(r.hhi)}`;
  const typing = r.typing ?? null;
  const typeCell =
    typing === null
      ? note(
          "not in the curated registry — this build types a curated subset, not the population",
          nctx,
          `${r.cik}-untyped`,
          { trigger: "label", textHtml: `<span class="none">—</span>`, name: "no type" },
        )
      : `<span class="mgr-chip" data-type="${esc(typing.manager_type)}">${esc(
          MANAGER_TYPE_LABELS[typing.manager_type] ?? typing.manager_type,
        )}</span>${typing.notable ? ` <span class="mgr-chip mgr-chip-notable">notable</span>` : ""}`;
  if (r.reference) {
    return `<tr data-mgr-type="${esc(typing?.manager_type ?? "")}" data-mgr-notable="${typing?.notable ? "1" : "0"}">` +
      `<td class="c-filer c-flex">${nameCellHtml(r, filerHrefOf(r))} <span class="design-directory-type">${typeCell}</span></td>` +
      /* the ledger's cell role (mono 500 --fs-cell), muted — never the 12px
         .mono-id, which the canvas comparison measured once the directory
         rendered rows (DESIGN-POLISH M2 review Q2-8) */
      /* R20 (M3): the CIK a reader sees has no leading zeros; the padded
         form stays in the href and the row's data */
      `<td class="c-num c-muted">${esc(fmtCik(r.cik))}</td>` +
      `<td class="c-num c-strong has-marks">${nullNote}${valueCell}</td>` +
      `<td class="c-num has-marks">${r.positions == null ? "—" : fmtInt(r.positions)}</td>` +
      /* R12 (DESIGN-POLISH M2): the Top-5 cell renders exactly when the
         table's column set holds it (`directoryColumns`, read back from
         `data-columns` by the client). */
      ((columns ? columns.includes("top5") : r.top5Share !== undefined)
        ? `<td class="c-num">${r.top5Share == null ? "—" : (r.top5Share / 100).toFixed(1) + "%"}</td>`
        : "") +
      /* the change line's own role (DESIGN-POLISH M3; M2F-D4 expired): mono,
         the kind word first — the canvas's LATEST NOTABLE line */
      `<td class="c-change">${r.changeHtml ?? "—"}</td></tr>`;
  }
  return (
    `<tr data-mgr-type="${esc(typing?.manager_type ?? "")}" data-mgr-notable="${
      typing?.notable ? "1" : "0"
    }"><td class="c-filer c-flex">${nameCellHtml(r, filerHrefOf(r))}</td>` +
    `<td class="c-type">${typeCell}</td>` +
    `<td class="c-num">${esc(r.period)}</td>` +
    `<td class="c-num c-strong has-marks">${nullNote}${valueCell}</td>` +
    `<td class="c-num has-marks">${r.positions == null ? "—" : fmtInt(r.positions)}</td>` +
    `<td class="c-num has-marks">${hhiCell}</td>` +
    `<td class="c-num">${r.changeHtml ?? ""}</td>` +
    `<td class="c-num c-muted mono-id">CIK ${esc(fmtCik(r.cik))}</td></tr>`
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
  /** the reference table's `data-columns` set (server: `directoryColumns`;
      client: read back off the table) */
  columns: readonly string[] | null = null,
): { html: string; note: string; total: number; shown: number } {
  // Chips, search and sort are ONE pipeline. Chips used to hide <tr>s
  // after render, so any sort or search rebuilt the tbody and silently
  // un-hid every filtered-out manager while the chip stayed pressed.
  const filtered = filterInstIndexRows(applyDirectoryChips(rows, chips), q);
  const { ranked, unranked } = sortInstIndexRows(filtered, sortKey, dir);
  const href = (r: InstIndexRow): string => filerHref(r.cik, r.tier);
  // The separator spans the table's ACTUAL column count, derived from the
  // one column contract rather than a literal that goes stale when a column is
  // added — which is exactly what happened when the directory grew to eight.
  const span = rows.some((r) => r.reference)
    ? columns?.length ?? DESIGN_INST_INDEX_HEADS.length - (rows.some((r) => r.top5Share !== undefined) ? 0 : 1)
    : INST_INDEX_HEADS.length;
  const total = ranked.length + unranked.length;
  const limit = compact ?? total;
  const rankedShown = ranked.slice(0, limit);
  const unrankedShown = unranked.slice(0, Math.max(0, limit - ranked.length));
  /* CD-3 (DESIGN-POLISH M3, carried): a chip or search that leaves NO row
     states why, in one line, instead of an empty table. */
  const html =
    (total === 0 && rows.length > 0 ? `<tr class="directory-empty"><td colspan="${span}" data-empty-state>${esc(directoryEmptyText(rows, q, chips))}</td></tr>` : "") +
    rankedShown.map((r) => instIndexRowHtml(r, href, columns)).join("\n") +
    // The stated absence renders whenever the bucket is non-empty, not only
    // when one of its rows survives the compact slice (the same stated-absence
    // rule the other tables follow).
    (unranked.length > 0
      ? `<tr class="unranked-sep"><td colspan="${span}">${fmtInt(unranked.length)} filers have no ` +
        `value for the active sort key — listed below in CIK order, never treated as zero</td></tr>` +
        unrankedShown.map((r) => instIndexRowHtml(r, href, columns)).join("\n")
      : "");
  const active = chips.types.size + (chips.notableOnly ? 1 : 0);
  const note =
    `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} managers · sorted by ${sortKey} ${dir}` +
    (active > 0 ? ` · ${active} filter${active === 1 ? "" : "s"} active` : "") +
    ` · filtered on this device`;
  return { html, note, total, shown: rankedShown.length + unrankedShown.length };
}

/** Why the directory shows no row (CD-3, DESIGN-POLISH M3), true of the
    collection it filtered. When no filer in the build carries a manager type
    at all, a type or notable chip can match nothing, and the line says the
    build's manager-type registry types none of its filers — the case on a
    build whose aggregate has no registry (`loadTyping` reads it as empty).
    Otherwise it names the search and the filters that matched nothing. Plain
    text; the caller escapes. */
export function directoryEmptyText(
  rows: readonly InstIndexRow[],
  q: string,
  chips: { types: ReadonlySet<string>; notableOnly: boolean },
): string {
  const typed = rows.filter((r) => (r.typing ?? null) !== null).length;
  const labels = [...chips.types].map((t) => MANAGER_TYPE_LABELS[t as keyof typeof MANAGER_TYPE_LABELS] ?? t);
  const chipsActive = chips.types.size > 0 || chips.notableOnly;
  const what = [chips.notableOnly ? "marked notable" : null, labels.length ? `of the type ${labels.join(" or ")}` : null]
    .filter(Boolean)
    .join(" and ");
  if (chipsActive && typed === 0) {
    return `No filer in this build is ${what}: this build's manager-type registry types none of its ${fmtInt(rows.length)} filers.`;
  }
  const query = q.trim();
  if (query !== "") return `No filer matches "${query}"${chipsActive ? ` among those ${what}` : ""}.`;
  return `No filer in this build is ${what}.`;
}

/** Default direction when switching TO a column: names ascend, numbers descend. */
export function instDefaultDir(key: string): "asc" | "desc" {
  return key === "name" ? "asc" : "desc";
}

/** Reference directory; absent analytics retain their columns and explicit notes. */
export const DESIGN_INST_INDEX_HEADS: typeof INST_INDEX_HEADS = [
  { key: "name", label: "Filer" },
  { key: null, label: "CIK", why: "SEC filer identifier." },
  { key: "value", label: "Value" },
  { key: "positions", label: "Pos" },
  { key: null, label: "Top-5", why: "Reported top-five share, available only when the source concentration slice contains five positions." },
  { key: null, label: "Latest notable", why: "Largest reported change within each filer's latest quarter. It is not a cross-filer ranking." },
];

/* ---------- the directory shard family (launch redesign M7b; R32, LD28) ----------

   The directory's rows used to ride the /institutional/ page as one inline
   JSON island (≈3.4 MB on data build 20261019.2, 96% of the page). They now
   ship as a versioned, byte-bounded file family,
   `/institutional/data/directory/{n}.v1.json`, which the page fetches on the
   first search, chip or sort; the server still renders the default first rows,
   so the page is correct before (and without) any fetch.

   A shard row is SLIM: a positional array of exactly the fields
   `instIndexRowHtml` reads, with `reference` implied (every directory row is a
   reference row) and the HHI note derived by `hhiNoteFor` rather than shipped.
   `expandDirectoryRow(slimDirectoryRow(r))` renders byte-identically to `r`
   (pinned by `launch-weight-inst.test.ts`), which is what lets the client draw
   fetched rows through the one row renderer the server uses. */

/** Mirrored from `src/populus/inst_budget.py::INST_DIRECTORY_SHARDS_MAX`; the
    walk FAILS past it and never truncates (a filer missing from the family
    would vanish from search). Pinned against the Python constant by
    `test/post/file-budget.test.ts`. */
export const INST_DIRECTORY_SHARDS_MAX = 8;
/** The LD-10 client-response ceiling (`lib/shards.ts`), restated as this
    family's per-file bound. */
export const INST_DIRECTORY_SHARD_CEILING_BYTES = 1_048_576;
/** The family's transport version; bump it (and keep a tombstone) on any
    breaking change to the slim row, as the filer tail family does. */
export const INST_DIRECTORY_VERSION = 1;

/** `[cik, name, period, value, positions, nullValuePositions, hhi, tier (1 top,
    0 tail), typing ([display_name, person, manager_type, notable 1|0] | null),
    changeHtml, top5Share?]` — `top5Share` is present exactly when the row
    carries the field (the table's Top-5 column exists). */
export type SlimDirectoryRow = [
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  0 | 1,
  [string, string | null, string, 0 | 1] | null,
  string,
  (number | null)?,
];

export function slimDirectoryRow(r: InstIndexRow): SlimDirectoryRow {
  const t = r.typing ?? null;
  const slim: SlimDirectoryRow = [
    r.cik,
    r.name,
    r.period,
    r.value,
    r.positions,
    r.nullValuePositions,
    r.hhi,
    r.tier === "top" ? 1 : 0,
    t === null ? null : [t.display_name, t.person ?? null, t.manager_type, t.notable ? 1 : 0],
    r.changeHtml,
  ];
  if (r.top5Share !== undefined) slim.push(r.top5Share);
  return slim;
}

export function expandDirectoryRow(s: SlimDirectoryRow): InstIndexRow {
  const [cik, name, period, value, positions, nullValuePositions, hhi, tier, t, changeHtml] = s;
  const row: InstIndexRow = {
    reference: true,
    cik,
    name,
    period,
    value,
    positions,
    nullValuePositions,
    hhi,
    hhiNote: hhiNoteFor(positions, nullValuePositions, hhi),
    tier: tier === 1 ? "top" : "tail",
    typing: t === null ? null : { cik, display_name: t[0], person: t[1], manager_type: t[2] as ManagerType, notable: t[3] === 1 },
    changeHtml,
  };
  if (s.length > 10) row.top5Share = s[10] ?? null;
  return row;
}

/** Same-origin path of directory shard `n`. The page inlines the list it
    built from this, so the client never composes a path itself. */
export function directoryShardHref(n: number): string {
  return `/institutional/data/directory/${n}.v1.json`;
}

export interface DirectoryShard {
  name: string;
  body: string;
  rows: number;
}

export interface DirectoryFamily {
  shards: DirectoryShard[];
  total: number;
  /** the tiny list the page inlines (`#inst-index-shards`) */
  listJson: string;
}

/** Envelope keys, in order: `{"v":1,"kind":"inst-directory-shard","shard":n,
    "shard_count":k,"total":T,"rows":[...]}`. */
function shardBody(shard: number, shardCount: number, total: number, rowJsons: readonly string[]): string {
  return (
    `{"v":${INST_DIRECTORY_VERSION},"kind":"inst-directory-shard","shard":${shard},` +
    `"shard_count":${shardCount},"total":${total},"rows":[${rowJsons.join(",")}]}`
  );
}

/** Cut the slim directory rows into the family through the ONE byte-bounded
    filler (`fillShardsByBytes`). The envelope reservation is measured on the
    widest envelope this family can emit (shard and count at the maximum, the
    real total), so no emitted body can exceed the ceiling. Throws past the
    shard maximum or on a single over-ceiling row — never truncates. */
export function planDirectoryShards(
  rows: readonly InstIndexRow[],
  fill: (
    items: readonly { key: string; json: string }[],
    limits: { ceilingBytes: number; overheadBytes: number; itemLimit: number; shardLimit: number },
    policy: { onOverflow: "fail"; onOversizedItem: "fail"; itemNoun: string },
  ) => { shards: { itemJsons: string[] }[] },
  opts: { ceilingBytes?: number; shardLimit?: number } = {},
): DirectoryFamily {
  const ceilingBytes = opts.ceilingBytes ?? INST_DIRECTORY_SHARD_CEILING_BYTES;
  const shardLimit = opts.shardLimit ?? INST_DIRECTORY_SHARDS_MAX;
  const total = rows.length;
  const items = rows.map((r) => ({ key: r.cik, json: JSON.stringify(slimDirectoryRow(r)) }));
  const widest = shardBody(shardLimit, shardLimit, total, []);
  const { shards } = fill(
    items,
    // TextEncoder, not Buffer: this module also ships in the client bundle.
    { ceilingBytes, overheadBytes: new TextEncoder().encode(widest).length, itemLimit: Number.MAX_SAFE_INTEGER, shardLimit },
    { onOverflow: "fail", onOversizedItem: "fail", itemNoun: "directory row" },
  );
  // An empty directory still publishes shard 0, whose body states the empty
  // total — a page that fetches it learns "no filers", never a 404.
  const jsonsPerShard = shards.length === 0 ? [[]] : shards.map((s) => s.itemJsons);
  const out = jsonsPerShard.map((jsons, i) => ({
    name: String(i),
    body: shardBody(i, jsonsPerShard.length, total, jsons),
    rows: jsons.length,
  }));
  return {
    shards: out,
    total,
    listJson: JSON.stringify({ v: INST_DIRECTORY_VERSION, total, shards: out.map((_, i) => directoryShardHref(i)) }),
  };
}

/** The page's inlined shard list, validated; null when it is absent or not
    this version's shape (the client then keeps the server rows and says so). */
export function parseDirectoryShardList(raw: string | null | undefined): { total: number; shards: string[] } | null {
  try {
    const v = JSON.parse(raw ?? "") as { v?: unknown; total?: unknown; shards?: unknown };
    if (v.v !== INST_DIRECTORY_VERSION || !Number.isInteger(v.total) || !Array.isArray(v.shards)) return null;
    if (!v.shards.every((s) => typeof s === "string" && s.startsWith("/institutional/data/directory/"))) return null;
    return { total: v.total as number, shards: v.shards as string[] };
  } catch {
    return null;
  }
}

/** One fetched shard body, validated against its place in the family. Throws
    with a reason on any mismatch — a partial or stale family must never be
    drawn as if it were the whole directory. */
export function parseDirectoryShard(body: unknown, index: number, count: number, total: number): InstIndexRow[] {
  const b = body as { v?: unknown; kind?: unknown; shard?: unknown; shard_count?: unknown; total?: unknown; rows?: unknown };
  if (b === null || typeof b !== "object") throw new Error("directory shard: not an object");
  if (b.v !== INST_DIRECTORY_VERSION) throw new Error(`directory shard ${index}: version ${String(b.v)}`);
  if (b.kind !== "inst-directory-shard") throw new Error(`directory shard ${index}: kind ${String(b.kind)}`);
  if (b.shard !== index || b.shard_count !== count || b.total !== total) {
    throw new Error(`directory shard ${index}: envelope ${String(b.shard)}/${String(b.shard_count)}/${String(b.total)} does not match ${index}/${count}/${total}`);
  }
  if (!Array.isArray(b.rows)) throw new Error(`directory shard ${index}: no rows`);
  return (b.rows as SlimDirectoryRow[]).map((r) => {
    if (!Array.isArray(r) || r.length < 10 || typeof r[0] !== "string") throw new Error(`directory shard ${index}: malformed row`);
    return expandDirectoryRow(r);
  });
}
