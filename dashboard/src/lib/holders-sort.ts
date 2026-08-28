/* Ordering semantics for the ranked-holders table. Domain-owned on purpose:
   `scripts/table-sort.ts` deliberately holds no comparison or bucketing, so the
   rule about what an unrankable value means lives here, next to the data it
   describes — the same shape `sortInstIndexRows` uses for the filer index,
   without pretending the two are one function.

   The no-sentinel rule (see the institutional index's own comment): a
   row with no value for the active key goes to a trailing bucket in a stated
   order, never interleaved as if it were zero.

   PRECEDENT WORTH KNOWING: the sibling `IssuerHolderRow` in `holdings.ts` models
   this correctly already — `value_usd: number | null` with a companion
   `value_undisclosed_component` flag, commented "NULL = at least one component
   undisclosed. Never a partial sum." That is exactly the producer-side shape
   this module cannot synthesize for `agg_issuer_top_holders`, and it means the
   recommended fix is not hypothetical: it exists one module over.

   IMPORTANT LIMIT, found in external code review and confirmed against the
   producer: for THIS table the rule cannot be enforced here, because the
   collapse already happened upstream. `agg_issuer_top_holders.value_usd` is
   declared NOT NULL and is populated with `COALESCE(SUM(value_usd), 0)`, so an
   issuer bucket whose every holding had an undisclosed value arrives as a real
   `0` that is indistinguishable from a genuinely reported zero. No column on
   this row is nullable, so the trailing bucket never fires for real data.

   Two consequences, both deliberate:
     1. The bucket is kept as a GUARD, not a feature — if a future schema change
        makes a column nullable, rows land in the bucket instead of silently
        sorting as zero. Its test says so, rather than pretending it fires today.
     2. The ambiguity the producer created is DISCLOSED in the table caveat
        instead of being hidden behind a guarantee this layer cannot make. */

import type { TopHolderRow } from "./inst.ts";

export type HolderSortKey = "rank" | "filer" | "value" | "securities" | "keysrc";

export interface HolderSortColumn {
  /** null = deliberately not sortable; `why` must then say why. */
  key: HolderSortKey | null;
  label: string;
  /** Required whenever `key` is null. An unexplained non-sortable data column
      is indistinguishable from one that was simply forgotten — external code
      review caught exactly that. */
  why?: string;
}

/** Column set for the holders table, in render order. Kept beside the sort so a
    new column cannot be added to the markup without a decision about ordering. */
export const HOLDER_COLUMNS: readonly HolderSortColumn[] = [
  { key: "rank", label: "#" },
  { key: "filer", label: "Filer" },
  { key: "value", label: "Value" },
  { key: "securities", label: "Securities" },
  { key: "keysrc", label: "Issuer key" },
  {
    key: null,
    label: "Flags",
    // Flags are an unordered SET of caveats. Any total order over a set has to
    // be invented — by count, or lexically — and a reader would reasonably read
    // "most flags first" as a significance ranking the data does not carry.
    // This product does not invent orderings, so the column stays unsorted.
    why: "flags are an unordered set; any ordering over them would be invented, and would read as a ranking the data does not carry",
  },
  {
    key: null,
    label: "Src",
    why: "a source link, not a data value — there is nothing to order",
  },
];

/** Direction applied when switching TO a column: text ascends, numbers descend.
    Matches the filer index so the two surfaces feel the same. */
export function holderDefaultDir(key: string): "asc" | "desc" {
  return key === "filer" || key === "keysrc" ? "asc" : "desc";
}

function keyOf(row: TopHolderRow, key: HolderSortKey): number | string | null {
  switch (key) {
    case "filer":
      return row.filer_name.toLowerCase();
    case "keysrc":
      return row.issuer_key_source;
    // Real nullability only. An earlier version used Number.isFinite(), which
    // tested for NaN — a value this column cannot hold — and so proved nothing.
    case "value":
      return row.value_usd ?? null;
    case "securities":
      return row.security_count ?? null;
    case "rank":
      return row.rank ?? null;
  }
}

/** Order ranked-holder rows, splitting unrankable rows into a trailing bucket.

    NAMED `orderRankedHolders`, not `sortHolderRows`: `holdings.ts` already exports
    a `sortHolderRows` over `IssuerHolderRow` for the M2-8 holdings component.
    Two exported functions with one name across two modules is a maintenance
    trap, and code review was right that the reuse check missed it.

    Ties break on rank, then CIK, so the order is reproducible across builds and
    identical between the server render and the client re-render. */
export function orderRankedHolders(
  rows: readonly TopHolderRow[],
  key: HolderSortKey,
  dir: "asc" | "desc",
): { ranked: TopHolderRow[]; unranked: TopHolderRow[] } {
  const rankable = (r: TopHolderRow): boolean => keyOf(r, key) !== null;
  const tieBreak = (a: TopHolderRow, b: TopHolderRow): number => {
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    return a.cik < b.cik ? -1 : a.cik > b.cik ? 1 : 0;
  };
  const unranked = rows.filter((r) => !rankable(r)).slice().sort(tieBreak);
  const sign = dir === "desc" ? -1 : 1;
  const ranked = rows
    .filter(rankable)
    .slice()
    .sort((a, b) => {
      const ka = keyOf(a, key)!;
      const kb = keyOf(b, key)!;
      if (ka !== kb) return ka < kb ? sign * -1 : sign;
      return tieBreak(a, b);
    });
  return { ranked, unranked };
}

/** What a zero in the value column can mean. The aggregate coalesces a bucket
    of undisclosed values to 0 before this layer sees it, so the table must say
    so rather than let a reader infer "this filer reported nothing". */
export const HOLDER_ZERO_CAVEAT =
  "Values here are sums of disclosed holdings only: a holding whose value was not disclosed " +
  "is omitted from the sum rather than making it unknown, so any value may be a partial " +
  "total, and $0 means nothing disclosed at all — not necessarily a reported zero. This " +
  "aggregate carries no signal separating a complete total from a partial one.";

/** The one sentence describing the active sort, used for the status line and
    the live-region announcement. */
export function holderSortNote(key: HolderSortKey, dir: "asc" | "desc", unranked: number): string {
  const label = HOLDER_COLUMNS.find((c) => c.key === key)?.label ?? key;
  const base = `sorted by ${label.toLowerCase()} ${dir === "desc" ? "descending" : "ascending"}`;
  return unranked > 0
    ? `${base} · ${unranked} row${unranked === 1 ? "" : "s"} have no value for this column and are listed last, never treated as zero`
    : base;
}
