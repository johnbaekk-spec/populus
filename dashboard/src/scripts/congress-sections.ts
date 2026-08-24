/* The /congress/ client island for the two RANKING sections: ticker momentum
   and member net-flow.

   IT OWNS NO FETCH AND NO DECODE (R17). The feed island performs the one fetch
   and the one decode of the feed dataset and hands the parsed rows here. This
   module must never call `fetch`, `classifyDataset`, `txnFromArray` or
   `paperFromArray` — `test/r17-single-fetch.test.ts` greps this file for
   exactly that, because a second decode of a large payload is invisible in
   review and expensive in the browser.

   THE SERVER VIEW IS AUTHORITATIVE UNTIL ROWS ARRIVE. Nothing here clears a
   root on load. If the dataset never arrives — offline, blocked, refused — the
   server-rendered default view stays exactly where it is, and the controls say
   why they cannot act instead of emptying the page.

   EVERY RE-RENDER IS ROOT-SCOPED (R18). A sort replaces one `tbody`'s
   innerHTML and nothing else: never the table, thead, caption, or a sibling
   root. That is what keeps the member ranking's two tables two tables. */

import {
  congressRangeBounds,
  congressTickersRollup,
  leadersRollup,
  rankNetRows,
  windowStatement,
  type CongressBasis,
  type CongressRange,
  type CongressRollup,
  type LeaderRow,
} from "../lib/derive.ts";
import type { TxnRow, RenderCtx } from "../lib/format.ts";
import {
  CONGRESS_ROOTS,
  rankingCaveatHtml,
  rankingExclusions,
  rankingRootHtml,
} from "../lib/ui.ts";
import { COMPACT_ROWS, syncTerminusFor } from "../lib/format.ts";
import { initSortableTable, type SortState } from "./table-sort.ts";
import type { CongressSortKey } from "../lib/congress-columns.ts";
import { congressRankingColumns } from "../lib/congress-columns.ts";

/** One sortable, expandable ranking root. */
interface RootBinding {
  el: HTMLElement;
  kind: "leaders" | "tickers";
  rows: LeaderRow[];
  /** collapsed → the compact slice; expanded → every row */
  expanded: boolean;
  disclosure?: HTMLElement | null;
  disclosureBtn?: HTMLElement | null;
  noun?: string;
  state: SortState;
  repaint: () => void;
}

const DEFAULT_SORT: SortState = { key: "net", dir: "desc" };
const BUCKET_SORT: SortState = { key: "name", dir: "asc" };

export interface CongressSections {
  /** Called once by the feed island with the single decoded row set (R17). */
  receiveRows(rows: readonly TxnRow[]): void;
}

export function initCongressSections(): CongressSections {
  const page = document.getElementById("congress-page");
  if (!page) return { receiveRows: () => {} };
  // The build's generated-at date is the window's `end`. It is read from the
  // document rather than the clock: a client that used its own "today" would
  // compute a different window from the server and silently disagree with the
  // view it is replacing.
  const generatedAtDate = page.dataset.generatedAtDate ?? "";
  // The server-rendered defaults, captured once. `page` is narrowed above, so
  // the closures below read these rather than re-reading a nullable element.
  const ssrRange: CongressRange = (page.dataset.range as CongressRange) || "12m";
  const ssrBasis: CongressBasis = (page.dataset.basis as CongressBasis) || "traded";
  const ctx: RenderCtx = { watched: new Set() };

  const bindings = new Map<string, RootBinding>();
  let allRows: readonly TxnRow[] | null = null;
  let range: CongressRange = ssrRange;
  let basis: CongressBasis = ssrBasis;

  /* ---------- sortable roots ---------- */

  function bindRoot(rootId: string, kind: "leaders" | "tickers", initial: SortState): void {
    const el = document.getElementById(rootId);
    if (!el) return;
    const table = el.closest("table");
    const headers = table
      ? [...table.querySelectorAll<HTMLElement>("thead th[data-congress-sort]")]
      : [];
    const statusEl = document.getElementById(`${rootId}-status`);
    const binding: RootBinding = {
      el,
      kind,
      rows: [],
      expanded: false,
      state: { ...initial },
      repaint: () => {},
    };
    const cols = congressRankingColumns(kind);
    const repaint = initSortableTable({
      root: el,
      headers,
      keyOf: (th) => (th as HTMLElement).getAttribute("data-congress-sort") ?? undefined,
      initial,
      defaultDir: (key) => {
        const col = cols.find((c) => c.sortable && c.key === key);
        return col && col.sortable ? col.defaultDir : "desc";
      },
      render: (state) => {
        binding.state = state;
        // Sorting with no rows would blank the server view. Return what is
        // already there instead, so a click before the dataset lands is inert
        // rather than destructive.
        if (binding.rows.length === 0) return el.innerHTML;
        /* SL-R7: `footnotesId` is gone. It existed so a re-sorted row's ≈
           marker addressed THIS section's footnote block; R7 deletes both
           blocks and moves their text onto the Net column's header note, so
           the marker no longer carries an href at all and the server and the
           client are identical again by having one fewer thing to agree on. */
        return rankingRootHtml(binding.rows, state.key as CongressSortKey, state.dir, kind, ctx, {
          compact: binding.expanded ? undefined : COMPACT_ROWS,
        }).html;
      },
      announce: (state) => {
        const col = cols.find((c) => c.sortable && c.key === state.key);
        const label = col ? col.label.replace(/\s*[·§†]+\s*$/, "") : state.key;
        return `Sorted by ${label}, ${state.dir === "desc" ? "descending" : "ascending"}.`;
      },
      statusEl,
    });
    binding.repaint = repaint;
    bindings.set(rootId, binding);
    setHeadersAvailable(headers, false);
  }

  /** Header buttons are not offered as usable before the data that backs them
      exists. `aria-disabled` rather than `disabled` keeps them focusable, so a
      keyboard reader can still find them and hear why. */
  function setHeadersAvailable(headers: readonly HTMLElement[], on: boolean): void {
    for (const th of headers) {
      const btn = th.querySelector("button");
      if (btn) btn.setAttribute("aria-disabled", String(!on));
    }
  }

  function headersOf(rootId: string): HTMLElement[] {
    const el = document.getElementById(rootId);
    const table = el?.closest("table");
    return table ? [...table.querySelectorAll<HTMLElement>("thead th[data-congress-sort]")] : [];
  }

  bindRoot(CONGRESS_ROOTS.momentum, "tickers", DEFAULT_SORT);
  bindRoot(CONGRESS_ROOTS.membersRanked, "leaders", DEFAULT_SORT);
  bindRoot(CONGRESS_ROOTS.membersUndisclosed, "leaders", BUCKET_SORT);

  /* ---------- expand / collapse (R7) ---------- */

  /* F16: the disclosure describes the CURRENT row set, so it is recomputed on
     every render rather than read once from the SSR attributes. Changing the
     momentum range from 12m to 7d changes how many tickers exist; the control
     kept saying "show all 833" from the server-rendered twelve-month view, and
     could even stay on screen after the new range dropped below the compact
     threshold — a control offering rows that are already all visible. */
  document.querySelectorAll<HTMLElement>(".compact-disclosure").forEach((wrap) => {
    const rootId = wrap.dataset.compactFor ?? "";
    const binding = bindings.get(rootId);
    if (!binding) return;
    // The shell may be rendered `hidden` (nothing to disclose yet).
    // `syncDisclosure` decides visibility from the CURRENT rows, so binding
    // happens unconditionally and the control can appear later.
    const btn = wrap.querySelector("button");
    binding.disclosure = wrap;
    binding.disclosureBtn = btn;
    binding.noun = wrap.dataset.compactNoun ?? "rows";
    btn?.addEventListener("click", () => {
      binding.expanded = !binding.expanded;
      binding.repaint();
      syncDisclosure(binding);
    });
    // F25: do NOT sync here. At bind time `rows` is empty, so syncing would
    // compute total=0, hide the control AND hide the server-rendered terminus —
    // deleting honesty content the SSR view legitimately published, before any
    // data has arrived to justify it. The first sync happens once rows exist.
  });

  /** Rewrite one root's disclosure from its CURRENT rows.

      F16: the COMPACT LIMIT and the CURRENT SHOWN COUNT are different numbers
      and are kept separate. Deriving "Show only the first N" from the expanded
      row count made the control promise to keep every row it was about to
      collapse away. And the omission rule is evaluated against the LIMIT, so a
      range change that drops the total to at-or-below it removes the control
      instead of leaving one that expands to the rows already on screen. */
  function syncDisclosure(b: RootBinding): void {
    if (!b.disclosure || !b.disclosureBtn) return;
    const total = b.rows.length;
    const limit = COMPACT_ROWS;
    const hidden = Math.max(0, total - limit);

    // R7's omission rule, evaluated against the LIMIT — never against how many
    // happen to be rendered right now.
    if (hidden === 0) {
      b.disclosure.hidden = true;
      b.expanded = false;
      setTerminus(b, 0);
      return;
    }
    b.disclosure.hidden = false;
    b.disclosureBtn.setAttribute("aria-expanded", String(b.expanded));
    b.disclosureBtn.textContent = b.expanded
      ? `Show only the first ${limit.toLocaleString("en-US")} ${b.noun}`
      : `Show all ${total.toLocaleString("en-US")} ${b.noun} (${hidden.toLocaleString("en-US")} more)`;
    setTerminus(b, b.expanded ? 0 : hidden);
  }

  /** The terminus states the same bound in prose and must not contradict it.

      F6: the update itself now lives beside `terminusRow` in `format.ts`, with
      the leaderboard's and the directory's. Three private copies of one
      contract is three chances for one to drift; only the SENTENCE differs per
      table, and that is what stays here. */
  function setTerminus(b: RootBinding, hidden: number): void {
    syncTerminusFor(b.disclosure, hidden, {
      text:
        `${hidden.toLocaleString("en-US")} further ranked ${b.noun} are not rendered above — ` +
        `a Public Filings render bound, not a data bound.`,
    });
  }

  /* ---------- range and basis (R2/R3) ---------- */

  function setSeg(attr: "range" | "basis", value: string): void {
    document.querySelectorAll<HTMLElement>(`#momentum-controls [data-${attr}]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
    });
  }

  document.querySelectorAll<HTMLElement>("#momentum-controls [data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      range = btn.dataset.range as CongressRange;
      setSeg("range", range);
      recomputeMomentum();
    });
  });
  document.querySelectorAll<HTMLElement>("#momentum-controls [data-basis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      basis = btn.dataset.basis as CongressBasis;
      setSeg("basis", basis);
      recomputeMomentum();
    });
  });

  /** Rewrite the section's window statement and caveat line together with its
      rows. A window that changed while its stated bounds did not would be the
      worst possible outcome of this control. */
  function applyRollup(
    sectionId: string,
    rootId: string,
    kind: "leaders" | "tickers",
    rollup: CongressRollup & { noTickerRows?: number },
  ): void {
    const binding = bindings.get(rootId);
    if (!binding) return;
    const { ranked } = rankNetRows(rollup.rows, (r) => r.net, (r) => r.id);
    binding.rows = ranked;
    binding.repaint();
    // ATOMIC with the rows: the disclosure and terminus describe this rollup,
    // never the one the server rendered.
    syncDisclosure(binding);

    const windowEl = document.getElementById(`${sectionId}-window`);
    if (windowEl) {
      const build = windowEl.textContent?.split(" · build ")[1] ?? "";
      windowEl.textContent =
        windowStatement(rollup.range, rollup.basis, congressRangeBounds(rollup.range, generatedAtDate)) +
        (build ? ` · build ${build}` : "");
    }
    const caveatEl = document.getElementById(`${sectionId}-caveat`);
    if (caveatEl) caveatEl.innerHTML = rankingCaveatHtml(rankingExclusions(rollup, kind));
  }

  function recomputeMomentum(): void {
    if (!allRows) return;
    applyRollup(
      "momentum-section",
      CONGRESS_ROOTS.momentum,
      "tickers",
      congressTickersRollup(allRows, generatedAtDate, { range, basis }),
    );
  }

  /* ---------- R17: rows arrive from the ONE owner ---------- */

  function receiveRows(rows: readonly TxnRow[]): void {
    allRows = rows;
    for (const rootId of [
      CONGRESS_ROOTS.momentum,
      CONGRESS_ROOTS.membersRanked,
      CONGRESS_ROOTS.membersUndisclosed,
    ]) {
      setHeadersAvailable(headersOf(rootId), true);
    }

    // The member section's window is fixed by the page, not by the momentum
    // control — the control belongs to the section that offers it.
    // F25: seed the MOMENTUM binding for the default range too. It was left
    // empty on a successful load, so its headers were enabled while its
    // comparator had no rows — sorting silently did nothing.
    const momentumBinding = bindings.get(CONGRESS_ROOTS.momentum);
    if (momentumBinding) {
      const rollup = congressTickersRollup(rows, generatedAtDate, { range, basis });
      const { ranked: momentumRanked } = rankNetRows(
        rollup.rows,
        (r) => r.net,
        (r) => r.id,
      );
      momentumBinding.rows = momentumRanked;
      // Assign WITHOUT repainting: the server already rendered this exact view,
      // and repainting would risk a flash and mask any server/client
      // disagreement instead of leaving it visible.
      syncDisclosure(momentumBinding);
    }

    const members = leadersRollup(rows, generatedAtDate, { range: "12m", basis: "traded" });
    const split = rankNetRows(members.rows, (r) => r.net, (r) => r.id);
    const rankedBinding = bindings.get(CONGRESS_ROOTS.membersRanked);
    const bucketBinding = bindings.get(CONGRESS_ROOTS.membersUndisclosed);
    if (rankedBinding) {
      rankedBinding.rows = split.ranked;
      syncDisclosure(rankedBinding);
    }
    if (bucketBinding) {
      bucketBinding.rows = split.undisclosedBucket;
      syncDisclosure(bucketBinding);
    }

    // Do NOT repaint the ranked roots here. The server already rendered this
    // exact view at this exact sort; repainting would risk a visible flash and
    // would MASK a server/client disagreement instead of leaving it visible.
    recomputeMomentumIfChanged();
  }

  /** Only recompute the momentum section if the reader has already moved it off
      the server-rendered default — otherwise the SSR view stands. */
  function recomputeMomentumIfChanged(): void {
    if (range !== ssrRange || basis !== ssrBasis) {
      recomputeMomentum();
    }
  }

  return { receiveRows };
}
