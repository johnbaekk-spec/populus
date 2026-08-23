/* R5/R6/R18 — the congress ranking tables' column contract and comparators.

   COMPARATORS STAY CALLER-OWNED. `initSortableTable` is plumbing that owns no
   ordering semantics, by a prior review decision that rejected a shared
   comparator. This module is the CALLER for the two congress ranking tables
   (ticker momentum and member net-flow), which order the same `LeaderRow`
   shape and therefore legitimately share one contract between themselves —
   that is reuse within one caller, not a comparator shared across surfaces.

   EVERY UNSORTABLE COLUMN STATES WHY. A column without a well-defined order is
   not silently inert: `why` is required by the type and asserted by a test, so
   a reader who clicks nothing learns the reason and a later maintainer cannot
   add a mute column. */

import {
  compareNet,
  netOverlaps,
  toNetInterval,
  type LeaderRow,
  type NetInterval,
} from "./derive.ts";

/** A sortable column names its key; an unsortable one states `why` instead.
    The two are mutually exclusive by construction — `why` exists only on the
    unsortable variant, so a sortable column cannot carry a dead reason and an
    unsortable one cannot omit it. */
export type CongressColumn =
  | {
      sortable: true;
      key: CongressSortKey;
      label: string;
      /** direction applied when the reader switches TO this column */
      defaultDir: "asc" | "desc";
      numeric: boolean;
    }
  | { sortable: false; key: null; label: string; why: string; numeric: boolean };

export type CongressSortKey =
  | "name"
  | "txns"
  | "buys"
  | "sells"
  | "purchases"
  | "sales"
  | "net"
  | "late";

/** The ranking columns, in render order. Ticker momentum and member net-flow
    differ only in what the identity column is called. */
export function congressRankingColumns(kind: "leaders" | "tickers"): CongressColumn[] {
  return [
    {
      sortable: false,
      key: null,
      label: "#",
      numeric: true,
      // Not a hedge: the position is a rendering of whatever sort is active,
      // so ordering by it would order rows by their own current order.
      why:
        "the rank number is produced by the active sort, not held by the row — ordering by it " +
        "would be circular, so it renumbers with every sort instead",
    },
    {
      sortable: true,
      key: "name",
      label: kind === "leaders" ? "Member" : "Ticker",
      defaultDir: "asc",
      numeric: false,
    },
    { sortable: true, key: "txns", label: "Txns †", defaultDir: "desc", numeric: true },
    { sortable: true, key: "buys", label: "Purch. †", defaultDir: "desc", numeric: true },
    { sortable: true, key: "sells", label: "Sales †", defaultDir: "desc", numeric: true },
    {
      sortable: true,
      key: "purchases",
      label: "Gross purchases ·§",
      defaultDir: "desc",
      numeric: true,
    },
    { sortable: true, key: "sales", label: "Gross sales ·§", defaultDir: "desc", numeric: true },
    {
      sortable: true,
      key: "net",
      label: "Net disclosed flow ·§",
      defaultDir: "desc",
      numeric: true,
    },
    { sortable: true, key: "late", label: "Late †", defaultDir: "desc", numeric: true },
  ];
}

/** The interval columns. Ordering these reuses the SAME six-state comparator
    the net column uses (`compareNet` over `toNetInterval`), so no second
    interval ordering exists — and a wholly-undisclosed value in the active
    column has no endpoints, so it cannot be ranked by it. */
const INTERVAL_KEYS = new Set<CongressSortKey>(["purchases", "sales", "net"]);

function intervalOf(r: LeaderRow, key: CongressSortKey): NetInterval {
  return key === "net"
    ? r.net
    : toNetInterval(key === "purchases" ? r.purchases : r.sales);
}

function scalarOf(r: LeaderRow, key: CongressSortKey): number {
  switch (key) {
    case "txns":
      return r.txns;
    case "buys":
      return r.buys;
    case "sells":
      return r.sells;
    case "late":
      // The exact count of late filings, never a rate: rates over different
      // denominators are not comparable, and the denominator renders beside
      // the count so the reader sees what the number is out of.
      return r.late;
    default:
      return 0;
  }
}

/** Rows split into those the ACTIVE column can rank and those it cannot.

    This is NOT the wholly-undisclosed bucket (R6/R18): that bucket is fixed by
    the row's NET interval, computed once, and lives in its own table and its
    own DOM root, where no sort can reach it. This split is narrower — within
    one table, a row whose value in the CURRENTLY SORTED interval column is
    wholly undisclosed has no endpoints for that column, so it is listed after
    the rows that do, never coerced to zero and never merged into the other
    bucket. A scalar column ranks every row it is given. */
export interface RankedSplit {
  ranked: LeaderRow[];
  unrankable: LeaderRow[];
}

export function sortRankingRows(
  rows: readonly LeaderRow[],
  key: CongressSortKey,
  dir: "asc" | "desc",
): RankedSplit {
  const sign = dir === "desc" ? 1 : -1;

  if (key === "name") {
    const ranked = [...rows].sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      if (an !== bn) return (an < bn ? -1 : 1) * -sign;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return { ranked, unrankable: [] };
  }

  if (INTERVAL_KEYS.has(key)) {
    const ranked: LeaderRow[] = [];
    const unrankable: LeaderRow[] = [];
    for (const r of rows) {
      (intervalOf(r, key).kind === "undisclosed" ? unrankable : ranked).push(r);
    }
    // `compareNet` is a DESCENDING display key by construction, so ascending is
    // its negation — one comparator, never a second ordering for the reverse.
    ranked.sort(
      (a, b) => sign * compareNet(intervalOf(a, key), intervalOf(b, key), a.id, b.id),
    );
    unrankable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ranked, unrankable };
  }

  const ranked = [...rows].sort((a, b) => {
    const ka = scalarOf(a, key);
    const kb = scalarOf(b, key);
    if (ka !== kb) return sign * (kb - ka);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { ranked, unrankable: [] };
}

/** The incomparability marker, RECOMPUTED from the order actually rendered
    (R18). Carrying it over from a previous sort would assert an overlap
    against a row that is no longer above this one — a stale claim about data
    the reader can see is wrong.

    The marker is about the NET interval in every sort, because that is what the
    footnote defines it as. Under a non-net sort, adjacency is still adjacency,
    and two adjacent overlapping nets are still incomparable. */
export function overlapFlags(rows: readonly LeaderRow[]): boolean[] {
  return rows.map((r, i) => (i === 0 ? false : netOverlaps(r.net, rows[i - 1]!.net) === true));
}
