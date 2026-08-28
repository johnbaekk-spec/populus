/* The manager directory: curated display names, orthogonal filter
   chips, and the biggest-position-change column.

   SHARES-BASED CLASSIFICATION IS THE POINT OF THIS MODULE. Change kind is classified from SHARES, not
   value: `src/populus/inst_agg.py` sets add/trim from `delta_shares` whenever
   the units are compatible. A position can therefore be an `add` while its
   dollar delta is NEGATIVE — the manager bought more shares into a falling
   price. So position direction and dollar direction are rendered as SEPARATE
   facts, and the rendered number is the ACTUAL SIGNED delta with its null
   state. Ranking on absolute value and then painting a positive sign would
   fabricate a direction the data does not carry. */

import { esc, fmtInt, fmtUsd } from "./format.ts";
import type { QoqDeltaRow } from "./inst.ts";

export type ManagerType =
  | "hedge_fund"
  | "asset_manager"
  | "pension_swf"
  | "bank"
  | "alt_manager"
  | "insurer"
  | "family_office"
  | "foundation";

/** Reader-facing labels for the curated taxonomy. */
export const MANAGER_TYPE_LABELS: Record<ManagerType, string> = {
  hedge_fund: "Hedge funds",
  asset_manager: "Asset managers",
  pension_swf: "Pensions & SWFs",
  bank: "Banks",
  alt_manager: "Alternatives",
  insurer: "Insurers",
  family_office: "Family offices",
  foundation: "Foundations",
};

export interface ManagerTyping {
  cik: string; // zero-padded, matching agg_filer_registry
  display_name: string;
  person: string | null;
  manager_type: ManagerType;
  /** EDITORIAL and ORTHOGONAL to manager_type: a notable hedge fund is both,
      and BOTH filters must show it. Never collapse these into one field. */
  notable: boolean;
}

/* ---------- the biggest position change ---------- */

export interface BiggestChange {
  row: QoqDeltaRow;
  /** the ACTUAL signed dollar delta — never an absolute value with a sign
      inferred from `change_kind` */
  delta_value_usd: number;
  /** true when the producer classified direction from VALUE because share
      units were not comparable — disclosed, not hidden */
  classifiedByValue: boolean;
}

export interface BiggestChangeResult {
  best: BiggestChange | null;
  /** candidate rows with no disclosed value: they cannot be ranked, and their
      count is stated instead of a fabricated pick */
  unrankable: number;
}

const CANDIDATE_KINDS = new Set(["new", "add", "trim", "exit"]);

/** The manager's largest position change in the selected period.

    Ranking: `ABS(delta_value_usd)` DESC, then `ABS(delta_shares)` DESC with
    NULL shares LAST, then the FULL delta grain as the deterministic remainder:
    position_key ASC, put_call ASC, ssh_prnamt_type ASC.

    The grain matters. The delta row's primary key is
    (filer, position_key, put_call, unit, period), so a tie-break on
    `position_key` alone is NOT a total order — the same position key
    legitimately yields distinct SH/PRN and LONG/PUT rows, which the producer's
    own tests pin. */
export function biggestChange(
  deltas: readonly QoqDeltaRow[],
  period: string,
): BiggestChangeResult {
  const candidates = deltas.filter(
    (d) => d.curr_period === period && CANDIDATE_KINDS.has(d.change_kind),
  );
  const rankable = candidates.filter((d) => d.delta_value_usd != null);
  if (rankable.length === 0) {
    return { best: null, unrankable: candidates.length };
  }
  const sorted = [...rankable].sort((a, b) => {
    const av = Math.abs(a.delta_value_usd!);
    const bv = Math.abs(b.delta_value_usd!);
    if (av !== bv) return bv - av;
    const as = a.delta_shares == null ? null : Math.abs(a.delta_shares);
    const bs = b.delta_shares == null ? null : Math.abs(b.delta_shares);
    if (as !== bs) {
      if (as == null) return 1; // NULL shares order LAST
      if (bs == null) return -1;
      return bs - as;
    }
    if (a.position_key !== b.position_key) return a.position_key < b.position_key ? -1 : 1;
    if (a.put_call !== b.put_call) return a.put_call < b.put_call ? -1 : 1;
    if (a.ssh_prnamt_type !== b.ssh_prnamt_type)
      return a.ssh_prnamt_type < b.ssh_prnamt_type ? -1 : 1;
    return 0;
  });
  const row = sorted[0]!;
  return {
    best: {
      row,
      delta_value_usd: row.delta_value_usd!,
      classifiedByValue: row.flags.includes("classified_by_value"),
    },
    unrankable: candidates.length - rankable.length,
  };
}

/** The change cell. Position direction and dollar direction are SEPARATE, and
    the number carries its own sign. */
export function biggestChangeCellHtml(result: BiggestChangeResult): string {
  if (result.best === null) {
    // An em dash plus the count of changes that cannot be ranked — never a
    // fabricated pick, and never a 0 standing in for "not disclosed".
    return result.unrankable === 0
      ? `<span class="none">—</span>`
      : `<span class="none" title="no disclosed value on any change this period">—</span>` +
          ` <span class="mono-note">${fmtInt(result.unrankable)} unpriced</span>`;
    }
  const { row, delta_value_usd, classifiedByValue } = result.best;
  const signed = delta_value_usd < 0 ? `−${fmtUsd(Math.abs(delta_value_usd))}` : fmtUsd(delta_value_usd);
  const dirCls = delta_value_usd < 0 ? "c-sell" : delta_value_usd > 0 ? "c-buy" : "";
  // The position's classification rides BESIDE the dollar figure, never merged
  // into it: an `add` with a negative dollar delta is a real and common state
  // (more shares, lower price), and collapsing the two would erase it.
  const basis = classifiedByValue
    ? ` <span class="mono-note" title="share units were not comparable, so the producer classified this change from VALUE">by value ·†v</span>`
    : "";
  return (
    `<span class="qoq-chip qoq-${esc(row.change_kind)}">${esc(row.change_kind)}</span> ` +
    `<span class="${dirCls}">${esc(signed)}</span>${basis}`
  );
}

/* ---------- filtering ---------- */

export interface DirectoryFilter {
  /** manager types selected; empty = no type restriction */
  types: ReadonlySet<ManagerType>;
  /** the editorial Notable chip, INDEPENDENT of any type selection */
  notableOnly: boolean;
}

/** Notable and type filter INDEPENDENTLY.

    A notable hedge fund satisfies the Notable chip AND the Hedge funds chip,
    so selecting either shows it and selecting both still shows it. Treating
    `notable` as a ninth type would hide 26 of the seed's hedge funds from the
    Hedge funds chip, which is the exact defect the orthogonality rule exists
    to prevent. */
export function matchesDirectoryFilter(
  typing: ManagerTyping | null,
  filter: DirectoryFilter,
): boolean {
  if (filter.notableOnly && !typing?.notable) return false;
  if (filter.types.size > 0 && (!typing || !filter.types.has(typing.manager_type))) return false;
  return true;
}
