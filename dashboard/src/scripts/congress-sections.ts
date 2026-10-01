/* The /congress/ client island for the two RANKING sections: ticker momentum
   and member net-flow.

   IT OWNS NO FETCH AND NO DECODE. The feed island performs the one fetch
   and the one decode of the feed dataset and hands the parsed rows here. This
   module must never call `fetch`, `classifyDataset`, `txnFromArray` or
   `paperFromArray` — `test/r17-single-fetch.test.ts` greps this file for
   exactly that, because a second decode of a large payload is invisible in
   review and expensive in the browser.

   THE SERVER VIEW IS AUTHORITATIVE UNTIL ROWS ARRIVE. Nothing here clears a
   root on load. If the dataset never arrives — offline, blocked, refused — the
   server-rendered default view stays exactly where it is, and the controls say
   why they cannot act instead of emptying the page.

   EVERY RE-RENDER IS ROOT-SCOPED. A sort replaces one `tbody`'s
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
  defaultRankingSortKey,
  emptyWindowHtml,
  rankingAlternatives,
  rankingRootHtml,
  rankingWindowHtml,
} from "../lib/ui/index.ts";
import { COMPACT_ROWS, COMPACT_STEP, compactBoundCountFor, syncCompactDisclosure } from "../lib/format.ts";
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
  /** R13 (DESIGN-POLISH M2, R36): the rows currently offered. Each press of
      "Show 50 more" adds COMPACT_STEP; the last press shows every row; the
      collapse control returns to the compact slice. The label and the rows
      it reveals therefore always agree. */
  limit: number;
  /** A "Show 50 more" pressed before the dataset arrived, past the rows the
      server prefetched: it WAITS (the button is `aria-busy`) and its step lands
      on delivery, or is withdrawn when the dataset fails (review R2-1). */
  morePending?: boolean;
  disclosure?: HTMLElement | null;
  disclosureBtn?: HTMLElement | null;
  noun?: string;
  state: SortState;
  repaint: () => void;
}

const DEFAULT_SORT: SortState = { key: "net", dir: "desc" };
const BUCKET_SORT: SortState = { key: "name", dir: "asc" };

export interface CongressSections {
  /** Called once by the feed island with the single decoded row set. */
  receiveRows(rows: readonly TxnRow[]): void;
  /** Called once by the feed island on EITHER outcome, so a pending
      indicator clears on the failure path too. `ok` is false when the dataset
      did not load, and the section then says so rather than staying "applying". */
  feedSettled(ok: boolean): void;
}

export interface CongressSectionsOptions {
  /** R12: the full dataset is no longer downloaded at load. A control that
      needs every row — a range or basis change, a sort, expanding past the
      server-rendered rows — asks the feed island for it through this hook;
      the rows still arrive through `receiveRows` from the ONE owner. */
  requestRows?: () => void;
}

/** SIGNALS-CLARITY M3 (R18): the Monthly flow panel's two-state toggle.
    Both variants are server-rendered; this only flips `hidden` and
    `aria-pressed`. It reads no rows and fetches nothing (L4), so the panel is
    complete before — and without — the dataset. Returns whether it bound. */
export function initMonthlyFlowToggle(): boolean {
  const section = document.getElementById("monthly-flow-section");
  if (!section) return false;
  const buttons = [...section.querySelectorAll<HTMLElement>("[data-flow-toggle]")];
  const variants = [...section.querySelectorAll<HTMLElement>(".mf-variant")];
  if (!buttons.length || !variants.length) return false;
  const show = (value: string): void => {
    for (const v of variants) v.hidden = v.dataset.flowVariant !== value;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.flowToggle === value));
  };
  for (const b of buttons) b.addEventListener("click", () => show(b.dataset.flowToggle ?? ""));
  return true;
}

export function initCongressSections(options: CongressSectionsOptions = {}): CongressSections {
  const page = document.getElementById("congress-page");
  if (!page) return { receiveRows: () => {}, feedSettled: () => {} };
  initMonthlyFlowToggle();
  const requestRows = (): void => {
    try {
      options.requestRows?.();
    } catch (err) {
      console.error("populus: requesting the dataset failed", err);
    }
  };
  // The build's generated-at date is the window's `end`. It is read from the
  // document rather than the clock: a client that used its own "today" would
  // compute a different window from the server and silently disagree with the
  // view it is replacing.
  const generatedAtDate = page.dataset.generatedAtDate ?? "";
  // The server-rendered defaults, captured once. `page` is narrowed above, so
  // the closures below read these rather than re-reading a nullable element.
  const ssrRange: CongressRange = (page.dataset.range as CongressRange) || "12m";
  const ssrBasis: CongressBasis = (page.dataset.basis as CongressBasis) || "traded";
  const ctx: RenderCtx = { watched: new Set(), referenceRankings: true };
  const compactLimit = Number(page.dataset.compactLimit) || COMPACT_ROWS;

  const bindings = new Map<string, RootBinding>();
  /* R12: roots whose reader pressed a sort before the rows landed. The press
     asked for the rows; the sort paints when they arrive (see receiveRows). */
  const sortPending = new Set<string>();
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
      limit: compactLimit,
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
        // rather than destructive — and ask for the rows it needs.
        if (binding.rows.length === 0) {
          sortPending.add(rootId);
          requestRows();
          return el.innerHTML;
        }
        /* `footnotesId` is gone. It existed so a re-sorted row's ≈
           marker addressed THIS section's footnote block; both blocks are
           deleted and their text moved onto the Net column's header note, so
           the marker no longer carries an href at all and the server and the
           client are identical again by having one fewer thing to agree on. */
        return rankingRootHtml(binding.rows, state.key as CongressSortKey, state.dir, kind, ctx, {
          compact: binding.expanded ? undefined : binding.limit,
          prefetch: COMPACT_STEP,
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
    /* R12: with a `requestRows` hook a press is usable before the dataset
       exists — it asks for the rows and the sort paints on delivery. Without
       one, nothing can bring the rows, so the headers wait for them. */
    setHeadersAvailable(headers, Boolean(options.requestRows));
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

  // D4: the tickers section defaults to disclosure count — the SAME key the
  // server rendered (`defaultRankingSortKey`), so the two cannot disagree.
  bindRoot(CONGRESS_ROOTS.momentum, "tickers", { key: defaultRankingSortKey("tickers"), dir: "desc" });
  bindRoot(CONGRESS_ROOTS.membersRanked, "leaders", DEFAULT_SORT);
  bindRoot(CONGRESS_ROOTS.membersUndisclosed, "leaders", BUCKET_SORT);

  /* ---------- expand / collapse ---------- */

  /* The disclosure describes the CURRENT row set, so it is recomputed on
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
      const total = totalOf(binding);
      if (binding.expanded || binding.limit >= total) {
        // The collapse control: back to the compact slice.
        binding.expanded = false;
        binding.limit = compactLimit;
        setMorePending(binding, false);
      } else if (binding.rows.length === 0) {
        /* R13, before the dataset arrives: the server-rendered rows past the
           compact slice are already in the DOM, hidden, and revealing them is
           the first "Show 50 more" — nothing is downloaded for it. Rows past
           the prefetched ones need the dataset. A press that asks for them
           WAITS: the limit stays at the rows on screen, so the count never
           states rows that are not there ("1–110 of 833" over 60 rows), the
           button is busy, and the step lands on delivery (receiveRows) or is
           withdrawn if the dataset fails (feedSettled) — review R2-1. */
        const avail = Math.min(total, compactLimit + prefetchedOf(binding));
        if (binding.limit < avail) {
          binding.limit = Math.min(avail, binding.limit + COMPACT_STEP);
          binding.expanded = binding.limit >= total;
        } else {
          setMorePending(binding, true);
        }
      } else {
        // "Show 50 more" adds one step; the last step shows every row.
        binding.limit = Math.min(total, binding.limit + COMPACT_STEP);
        binding.expanded = binding.limit >= total;
      }
      if (binding.rows.length === 0) {
        revealPrefetched(binding);
        if (binding.limit > compactLimit || binding.morePending) requestRows();
      } else {
        binding.repaint();
      }
      syncDisclosure(binding);
    });
    /* Sync NOW, from the server's own total (`data-compact-total`) — the rows
       have not arrived, and `syncDisclosure` reads the element's total until
       they do. This reveals the button beside the count the server published
       (R36: after load every disclosure with rows held back has a working
       toggle); it never hides the published count. */
    syncDisclosure(binding);
  });

  /** Rows the server rendered past the compact slice (hidden until pressed). */
  function prefetchedOf(b: RootBinding): number {
    return b.el.querySelectorAll("tr[data-compact-hidden]").length;
  }

  /** Before delivery: show exactly the prefetched rows the limit offers. */
  function revealPrefetched(b: RootBinding): void {
    const extra = b.limit - compactLimit;
    b.el.querySelectorAll<HTMLElement>("tr[data-compact-hidden]").forEach((tr, i) => {
      tr.hidden = i >= extra;
    });
  }

  /** A press waiting for the dataset says so on its button (`aria-busy`). */
  function setMorePending(b: RootBinding, on: boolean): void {
    b.morePending = on;
    if (on) b.disclosureBtn?.setAttribute("aria-busy", "true");
    else b.disclosureBtn?.removeAttribute("aria-busy");
  }

  /** The table's row count: its delivered rows, or the server's own total. */
  function totalOf(b: RootBinding): number {
    return b.rows.length || Number(b.disclosure?.dataset?.compactTotal ?? 0);
  }

  /** Rewrite one root's disclosure from its CURRENT rows.

      The COMPACT LIMIT and the CURRENT SHOWN COUNT are different numbers
      and are kept separate. Deriving "Show only the first N" from the expanded
      row count made the control promise to keep every row it was about to
      collapse away. And the omission rule is evaluated against the LIMIT, so a
      range change that drops the total to at-or-below it removes the control
      instead of leaving one that expands to the rows already on screen. */
  function syncDisclosure(b: RootBinding): void {
    if (!b.disclosure) return;
    // Before the dataset arrives the server's own total is the truth.
    const total = totalOf(b);
    if (b.limit > total) b.limit = Math.max(compactLimit, total);
    const limit = b.expanded ? total : b.limit;
    const hidden = Math.max(0, total - limit);
    const noun = b.noun ?? "rows";
    // The bound noun (and whether the total is a bound) is the SERVER's, read
    // back off the element by the one shared reader: this one function serves
    // the ranked tables and the wholly-undisclosed bucket, and composing
    // "ranked …" for all three would relabel the bucket.

    /* The count clause, the button and the wrapper commit TOGETHER,
       in one call to the shared updater. Three private copies of that contract
       was three chances for one to drift out of step with the renderer; only
       the NOUN differs per table, and that is what stays here.

       The omission rule is evaluated against the LIMIT, never against how many
       rows happen to be rendered right now — a range change that drops the
       total to at-or-below it must retract the control rather than leave one
       that expands to the rows already on screen. */
    /* Expanded = every row offered and more than the slice exists; with
       nothing past the compact slice there is no control at all. */
    b.expanded = hidden === 0 && total > compactLimit && b.limit > compactLimit;
    if (total <= compactLimit) b.limit = compactLimit;
    syncCompactDisclosure(b.disclosure, {
      total,
      hidden: b.expanded ? 0 : hidden,
      expanded: b.expanded,
      noun,
      // The range grammar (R8): "1–10 of 833 ranked tickers", the server's words.
      count: { text: compactBoundCountFor(b.disclosure, total - hidden, total, `ranked ${noun}`) },
      // The expand label counts from the rows on offer ("Show 50 more" while
      // more than a step is held back); the collapse label names the slice.
      shown: b.expanded ? compactLimit : limit,
    });
  }

  /* ---------- range and basis, and the pending-control honesty ---------- */

  function setSeg(attr: "range" | "basis", value: string): void {
    document.querySelectorAll<HTMLElement>(`#momentum-controls [data-${attr}]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
    });
  }

  /* This adds NO state and NO queue. A pre-arrival click already
     applies: `range` and `basis` are module-scoped and `receiveRows` ends by
     calling `recomputeMomentumIfChanged()`. What was wrong is that `setSeg`
     paints the button pressed immediately while the table still shows the
     server's window — so for as long as the 22 MB dataset takes to arrive, the
     control asserts a view it has not painted. It now says which. */
  function setPending(text: string | null): void {
    const el = document.getElementById("momentum-section-pending");
    if (!el) return;
    if (text === null) {
      el.textContent = "";
      el.setAttribute("hidden", "");
      return;
    }
    el.textContent = text;
    el.removeAttribute("hidden");
  }

  function markPendingIfUnpainted(): void {
    if (allRows) return;
    setPending(
      `Applying ${windowStatement(range, basis, congressRangeBounds(range, generatedAtDate))} — ` +
        `the full dataset is downloading. The table below is still the window the page was ` +
        `built with, and it is real published data.`,
    );
  }

  document.querySelectorAll<HTMLElement>("#momentum-controls [data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      range = btn.dataset.range as CongressRange;
      setSeg("range", range);
      markPendingIfUnpainted();
      if (!allRows) requestRows();
      recomputeMomentum();
    });
  });
  document.querySelectorAll<HTMLElement>("#momentum-controls [data-basis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      basis = btn.dataset.basis as CongressBasis;
      setSeg("basis", basis);
      markPendingIfUnpainted();
      if (!allRows) requestRows();
      recomputeMomentum();
    });
  });

  /* The empty-window block's own controls. They are DELEGATED on the
     section, not bound per button, because the block is replaced by
     `innerHTML` on every window change — a per-button binder would leave the
     second empty window's offers inert, which is the same lifecycle problem
     the notes delegation solved. Pressing one drives the SAME `range`/`basis` state
     the segmented control drives; it does not fork a second path. */
  const emptyHost = document.getElementById("momentum-section-empty");
  emptyHost?.addEventListener?.("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    const btn = t?.closest?.<HTMLElement>("[data-range], [data-basis]") ?? null;
    if (!btn) return;
    if (btn.dataset.range) {
      range = btn.dataset.range as CongressRange;
      setSeg("range", range);
    } else if (btn.dataset.basis) {
      basis = btn.dataset.basis as CongressBasis;
      setSeg("basis", basis);
    } else {
      return;
    }
    markPendingIfUnpainted();
    if (!allRows) requestRows();
    recomputeMomentum();
  });

  /* Fired by `initFeed` on BOTH outcomes. On success the rows have
     already been applied by `receiveRows`, so the indicator simply clears. On
     failure there is nothing to clear it later — `onRows` never fires — so the
     section states that the selection could not be applied, and why. */
  function feedSettled(ok: boolean): void {
    if (ok) {
      setPending(null);
      return;
    }
    /* The dataset did not load: a "Show 50 more" waiting for it is withdrawn,
       and every ranking re-syncs to the rows it actually has on screen (review
       R2-1). A later press asks for the dataset again. */
    for (const b of bindings.values()) {
      if (b.rows.length > 0) continue;
      setMorePending(b, false);
      b.limit = Math.min(b.limit, compactLimit + prefetchedOf(b));
      b.expanded = b.limit >= totalOf(b) && totalOf(b) > compactLimit;
      revealPrefetched(b);
      syncDisclosure(b);
    }
    const el = document.getElementById("momentum-section-pending");
    if (!el || el.hasAttribute("hidden")) return;
    setPending(
      `That selection could not be applied: the full dataset did not load. The table below is ` +
        `still the window the page was built with, and it is real published data.`,
    );
  }

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
    /* The `" · build "` split is gone with the stamp it preserved.
         It existed only so a re-render did not drop a build id the server had
         put there; the server no longer puts one there, and parsing a suffix
         back out of rendered text to re-append it was the fragile half of that
         arrangement. */
      /* The window statement, its excluded-row TOTAL and the note body
         are rewritten in ONE call to the SAME function the server used, so the
         three cannot drift apart on a range or basis change. The separate
       `#<sectionId>-caveat` element is gone; its clauses are the
       note's body. */
    /* The empty-window block is rewritten with the rows, through the
       SAME renderer the server used and over the SAME row set the control will
       paint if the reader takes one of its offers — so a stated count cannot
       disagree with what pressing it produces. */
    const emptyEl = document.getElementById(`${sectionId}-empty`);
    if (emptyEl) {
      emptyEl.innerHTML =
        binding.rows.length === 0 && allRows
          ? emptyWindowHtml(
              rollup.range,
              rollup.basis,
              rankingAlternatives(allRows, generatedAtDate, kind, rollup.range, rollup.basis),
              kind === "tickers" ? "tickers" : "members",
            )
          : "";
    }

    if (windowEl) {
      windowEl.innerHTML = rankingWindowHtml(
        windowStatement(rollup.range, rollup.basis, congressRangeBounds(rollup.range, generatedAtDate)),
        rollup,
        kind,
        sectionId,
      );
    }
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

  /* ---------- rows arrive from the ONE owner ---------- */

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
    // Seed the MOMENTUM binding for the default range too. It was left
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
    // A sort pressed before delivery was recorded but could not paint; it
    // paints now, over the delivered rows.
    for (const rootId of sortPending) bindings.get(rootId)?.repaint();
    sortPending.clear();
    /* A "Show 50 more" pressed before delivery past the prefetched rows was
       waiting (R2-1): its one step lands now. Every root the reader expanded
       paints at the limit the reader chose. */
    for (const b of [momentumBinding, rankedBinding, bucketBinding]) {
      if (!b) continue;
      if (b.morePending) {
        setMorePending(b, false);
        const total = totalOf(b);
        b.limit = Math.min(total, b.limit + COMPACT_STEP);
        b.expanded = b.limit >= total;
      }
      if (b.limit > compactLimit) {
        b.repaint();
        syncDisclosure(b);
      }
    }
    recomputeMomentumIfChanged();
    // The rows are painted, so the control no longer asserts anything
    // it has not shown. Cleared here as well as in `feedSettled` because this
    // is the moment the claim becomes true.
    setPending(null);
  }

  /** Only recompute the momentum section if the reader has already moved it off
      the server-rendered default — otherwise the SSR view stands. */
  function recomputeMomentumIfChanged(): void {
    if (range !== ssrRange || basis !== ssrBasis) {
      recomputeMomentum();
    }
  }

  return { receiveRows, feedSettled };
}
