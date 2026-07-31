/* Client island for /congress: filtering, search, pagination, watchlist.
   All filtering happens on this device over the same-origin dataset shipped
   with the build (ARCHITECTURE §12.1 — no external calls, no accounts).
   Rows render through the same feedItemHtml the build used for page 1. */

import {
  txnFromArray,
  paperFromArray,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
  feedItemHtml,
  fmtInt,
  fmtMoney,
  amountVerdict,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../lib/format";
import { loadWatchStore } from "./entity-client";

interface State {
  chamber: "all" | "house" | "senate";
  party: "all" | "D" | "R" | "I";
  side: "all" | "buy" | "sell" | "exch";
  amountMin: number;
  owner: "all" | "self" | "spouse" | "child" | "joint" | "none";
  late: boolean;
  q: string;
  page: number;
}

const DEFAULTS: State = {
  chamber: "all",
  party: "all",
  side: "all",
  amountMin: 0,
  owner: "all",
  late: false,
  q: "",
  page: 0,
};

export function initFeed(): void {
  const rootEl = document.getElementById("congress-feed");
  const bodyEl = document.getElementById("feed-body");
  const feedEl = document.getElementById("feed");
  const loadingEl = document.getElementById("feed-loading");
  const emptyEl = document.getElementById("feed-empty");
  const emptyDetailEl = document.getElementById("feed-empty-detail");
  const emptySuggestEl = document.getElementById("feed-empty-suggestions");
  const countEl = document.getElementById("filter-count-line");
  const rangeEl = document.getElementById("pager-range");
  const statusEl = document.getElementById("feed-status");
  const resetBtn = document.getElementById("filter-reset") as HTMLButtonElement | null;
  const resetWrap = document.getElementById("filter-reset-wrap");
  const newerBtn = document.getElementById("pager-newer") as HTMLButtonElement | null;
  const olderBtn = document.getElementById("pager-older") as HTMLButtonElement | null;
  const amountSel = document.getElementById("filter-amount") as HTMLSelectElement | null;
  const ownerSel = document.getElementById("filter-owner") as HTMLSelectElement | null;
  const lateChk = document.getElementById("filter-late") as HTMLInputElement | null;
  // #site-search belongs to the global search client now (R11); the feed no
  // longer filters on it — search is site navigation, not a feed filter.
  const searchInput = null as HTMLInputElement | null;
  if (!rootEl || !bodyEl || !feedEl || !countEl || !rangeEl) return;

  const totalAll = Number(rootEl.dataset.txnCount ?? 0);
  const state: State = { ...DEFAULTS };
  resetWrap?.removeAttribute("hidden");

  /* ---------- watchlist (shared v2 store; legacy write-through) ---------- */

  const watchStore = loadWatchStore(localStorage);
  const watched = watchStore.members;

  function paintStars(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-watch]").forEach((btn) => {
      const on = watched.has(btn.dataset.watch!);
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? "★" : "☆";
    });
  }
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-watch]");
    if (!btn) return;
    watchStore.toggle("member", btn.dataset.watch!);
    paintStars();
  });
  paintStars();

  /* ---------- dataset loading (lazy, same-origin) ---------- */

  let txns: TxnRow[] | null = null;
  let paper: PaperRow[] | null = null;
  let loadPromise: Promise<void> | null = null;
  let pendingApply = false;

  function loadData(): Promise<void> {
    loadPromise ??= fetch("/congress/data/feed.v1.json")
      .then((r) => {
        if (!r.ok) throw new Error(`dataset fetch failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        txns = (d.txns as unknown[][]).map(txnFromArray);
        paper = (d.paper as unknown[][]).map(paperFromArray);
        if (pendingApply) {
          pendingApply = false;
          apply();
        }
      })
      .catch((err) => {
        loadPromise = null;
        loadingEl?.setAttribute("hidden", "");
        console.error("populus: feed dataset failed to load", err);
        if (pendingApply) renderLoadFailure();
      });
    return loadPromise;
  }

  /** A failed dataset fetch is stated on the page, not only in the console.
      The server-rendered first page is still on screen, so say exactly that. */
  function renderLoadFailure(): void {
    if (!emptyEl || !emptyDetailEl || !emptySuggestEl) return;
    setHeading("Couldn't load the full dataset.");
    emptyDetailEl.textContent =
      "Filtering, search and paging need the full dataset, which failed to " +
      "download. The first page above is still the real published data — " +
      "nothing here is stale or invented.";
    emptySuggestEl.innerHTML = "";
    const retry = document.createElement("button");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      emptyEl.setAttribute("hidden", "");
      loadingEl?.removeAttribute("hidden");
      loadData();
    });
    emptySuggestEl.appendChild(retry);
    const raw = document.createElement("a");
    raw.className = "plain";
    raw.href = "/congress/data/feed.v1.json";
    raw.textContent = "open the raw dataset";
    emptySuggestEl.appendChild(raw);
    emptyEl.removeAttribute("hidden");
    // every count sink, or the pager keeps asserting a total we cannot back
    setCounts("full dataset unavailable — showing the first page only");
  }

  /** The #feed-empty block serves three states; whichever renders owns the
      heading explicitly, so a stale one can never sit above a fresh detail. */
  function setHeading(text: string): void {
    const h = emptyEl?.querySelector("h2");
    if (h) h.textContent = text;
  }
  const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => loadData());

  /* ---------- filtering ---------- */

  /** Everything except the amount threshold — so the indeterminate-amount
      population can be counted against the same other filters. */
  function matchTxnExceptAmount(r: TxnRow, s: State): boolean {
    if (s.chamber !== "all" && r.chamber !== s.chamber) return false;
    if (s.party !== "all" && r.party !== s.party) return false;
    if (s.side === "buy" && r.side !== "purchase") return false;
    if (s.side === "sell" && r.side !== "sale" && r.side !== "sale_partial") return false;
    if (s.side === "exch" && r.side !== "exchange") return false;
    if (s.owner === "none") {
      if (r.owner != null) return false;
    } else if (s.owner !== "all" && r.owner !== s.owner) return false;
    if (s.late && r.late !== 1) return false;
    if (s.q) {
      const ql = s.q.toLowerCase();
      const nameHit = r.name.toLowerCase().includes(ql);
      const tickerHit = r.ticker != null && r.ticker.toUpperCase().startsWith(s.q.toUpperCase());
      if (!nameHit && !tickerHit) return false;
    }
    return true;
  }

  function matchTxn(r: TxnRow, s: State): boolean {
    return matchTxnExceptAmount(r, s) && amountVerdict(r, s.amountMin) === "in";
  }

  /** Rows this threshold can neither include nor exclude: open-ended
      "Over $1M" caps and unparsed amounts. Reported, never silently dropped. */
  function indeterminateCount(s: State): number {
    if (!txns || s.amountMin <= 0) return 0;
    return txns.filter(
      (r) => matchTxnExceptAmount(r, s) && amountVerdict(r, s.amountMin) === "indeterminate",
    ).length;
  }

  // A paper filing has no side/amount/owner/late/ticker — it can only honestly
  // match filters on dimensions it possesses; any other active filter hides it.
  function paperVisible(s: State): boolean {
    return s.side === "all" && s.amountMin === 0 && s.owner === "all" && !s.late;
  }
  function matchPaper(p: PaperRow, s: State): boolean {
    if (s.chamber !== "all" && p.chamber !== s.chamber) return false;
    if (s.party !== "all" && p.party !== s.party) return false;
    if (s.q && !p.name.toLowerCase().includes(s.q.toLowerCase())) return false;
    return true;
  }

  /* ---------- empty-state suggestions (S3) ---------- */

  interface Relaxation {
    label: string;
    active: (s: State) => boolean;
    relax: (s: State) => State;
    applyToUi: () => void;
  }

  const relaxations: Relaxation[] = [
    {
      label: "Drop the amount floor",
      active: (s) => s.amountMin > 0,
      relax: (s) => ({ ...s, amountMin: 0 }),
      applyToUi: () => { if (amountSel) amountSel.value = "0"; state.amountMin = 0; },
    },
    {
      label: "Include on-time filings",
      active: (s) => s.late,
      relax: (s) => ({ ...s, late: false }),
      applyToUi: () => { if (lateChk) lateChk.checked = false; state.late = false; },
    },
    {
      label: "Any side",
      active: (s) => s.side !== "all",
      relax: (s) => ({ ...s, side: "all" }),
      applyToUi: () => { setSeg("side", "all"); state.side = "all"; },
    },
    {
      label: "Any owner",
      active: (s) => s.owner !== "all",
      relax: (s) => ({ ...s, owner: "all" }),
      applyToUi: () => { if (ownerSel) ownerSel.value = "all"; state.owner = "all"; },
    },
    {
      label: "Any party",
      active: (s) => s.party !== "all",
      relax: (s) => ({ ...s, party: "all" }),
      applyToUi: () => { setSeg("party", "all"); state.party = "all"; },
    },
    {
      label: "Both chambers",
      active: (s) => s.chamber !== "all",
      relax: (s) => ({ ...s, chamber: "all" }),
      applyToUi: () => { setSeg("chamber", "all"); state.chamber = "all"; },
    },
    {
      label: "Clear the search",
      active: (s) => s.q !== "",
      relax: (s) => ({ ...s, q: "" }),
      applyToUi: () => { if (searchInput) searchInput.value = ""; state.q = ""; },
    },
  ];

  function renderEmpty(currentCount: number): void {
    if (!emptyEl || !emptyDetailEl || !emptySuggestEl || !txns) return;
    emptySuggestEl.innerHTML = "";
    let shown = 0;
    for (const rel of relaxations) {
      if (shown >= 2) break;
      if (!rel.active(state)) continue;
      const n = txns.filter((r) => matchTxn(r, rel.relax(state))).length;
      if (n === 0) continue;
      const b = document.createElement("button");
      b.textContent = `${rel.label} (${fmtInt(n)} rows)`;
      b.addEventListener("click", () => {
        rel.applyToUi();
        state.page = 0;
        apply();
      });
      emptySuggestEl.appendChild(b);
      shown++;
    }
    const unknown = indeterminateCount(state);
    // With indeterminate rows present, "no disclosures match" would convert a
    // cannot-know into a confirmed-none — the headline has to hedge too, not
    // just the detail underneath it.
    setHeading(
      unknown > 0
        ? "No disclosures are known to match."
        : "No disclosures match — and that's an answer, not an error.",
    );
    emptyDetailEl.textContent =
      `This build holds ${fmtInt(totalAll)} transaction rows; the current ` +
      `combination matches ${fmtInt(currentCount)}.` +
      (unknown > 0
        ? ` ${fmtInt(unknown)} further ${unknown === 1 ? "row discloses" : "rows disclose"}` +
          ` only an open-ended or unparsed amount and can be neither ruled in nor out of` +
          ` “≥ ${fmtMoney(state.amountMin)}”.`
        : "") +
      (shown > 0 ? " Nearest matches:" : " No single filter is responsible — reset and refine.");
    const reset = document.createElement("button");
    reset.className = "plain";
    reset.textContent = "reset all";
    reset.addEventListener("click", resetAll);
    emptySuggestEl.appendChild(reset);
    emptyEl.removeAttribute("hidden");
  }

  /* ---------- rendering ---------- */

  function apply(): void {
    if (!txns || !paper) {
      // Do NOT clear the server-rendered rows: if the dataset never arrives,
      // page 1 stays readable instead of leaving a blank table under a count
      // line that still claims thousands of rows.
      pendingApply = true;
      loadingEl?.removeAttribute("hidden");
      emptyEl?.setAttribute("hidden", "");
      loadData();
      return;
    }
    loadingEl?.setAttribute("hidden", "");

    const fTxns = txns.filter((r) => matchTxn(r, state));
    const fPaper = paperVisible(state) ? paper.filter((p) => matchPaper(p, state)) : [];

    // Page count is derived from the merged feed, so a trailing paper row is
    // always reachable (a counts-only formula cannot see where paper rows sit).
    const merged = mergeFeed(fTxns, fPaper);
    const maxPage = Math.max(0, pageCountFor(merged) - 1);
    if (state.page > maxPage) state.page = maxPage;

    const items = pageSlice(merged, state.page);
    const ctx: RenderCtx = { watched };

    // Keyed on what actually renders — a paper-only result set renders rows,
    // and an empty page must always say so rather than showing a blank frame.
    if (items.length === 0) {
      bodyEl!.innerHTML = "";
      renderEmpty(fTxns.length);
    } else {
      emptyEl?.setAttribute("hidden", "");
      bodyEl!.innerHTML = items.map((it) => feedItemHtml(it, ctx)).join("\n");
    }

    // One assembled string, every sink — no fragment can reach some readers
    // and not others (the indeterminate-amount disclosure previously reached
    // only a desktop-visible element and a visually-hidden live region).
    const range = feedCountText({
      page: state.page,
      txnMatched: fTxns.length,
      paperMatched: fPaper.length,
      txnOnPage: items.filter((it) => it.kind === "txn").length,
      paperOnPage: items.filter((it) => it.kind === "paper").length,
      txnTotal: totalAll,
      indeterminate: indeterminateCount(state),
    });
    setCounts(range);

    // Keep both pager controls focusable at the boundaries — removing the
    // control that was just activated dumps keyboard focus to <body>.
    setPagerState(newerBtn, state.page === 0);
    setPagerState(olderBtn, state.page >= maxPage);
  }

  /** Write the count to every sink at once, so none can fall out of step. */
  function setCounts(text: string): void {
    if (countEl) countEl.textContent = text;
    if (rangeEl) rangeEl.textContent = text;
    if (statusEl) statusEl.textContent = text;
  }

  function setPagerState(btn: HTMLButtonElement | null, unavailable: boolean): void {
    if (!btn) return;
    btn.hidden = false;
    btn.setAttribute("aria-disabled", String(unavailable));
    btn.classList.toggle("is-unavailable", unavailable);
  }

  function resetAll(): void {
    Object.assign(state, DEFAULTS);
    document
      .querySelectorAll<HTMLButtonElement>(".seg button[data-group]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "all")));
    if (amountSel) amountSel.value = "0";
    if (ownerSel) ownerSel.value = "all";
    if (lateChk) lateChk.checked = false;
    if (searchInput) searchInput.value = "";
    apply();
  }

  /* ---------- control wiring ---------- */

  function setSeg(group: string, value: string): void {
    document
      .querySelectorAll<HTMLButtonElement>(`.seg button[data-group="${group}"]`)
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
  }

  document.querySelectorAll<HTMLButtonElement>(".seg button[data-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group as "chamber" | "party" | "side";
      const value = btn.dataset.value!;
      setSeg(group, value);
      (state as any)[group] = value;
      state.page = 0;
      apply();
    });
  });

  amountSel?.addEventListener("change", () => {
    state.amountMin = Number(amountSel.value);
    state.page = 0;
    apply();
  });
  ownerSel?.addEventListener("change", () => {
    state.owner = ownerSel.value as State["owner"];
    state.page = 0;
    apply();
  });
  lateChk?.addEventListener("change", () => {
    state.late = lateChk.checked;
    state.page = 0;
    apply();
  });

  resetBtn?.addEventListener("click", resetAll);
  newerBtn?.addEventListener("click", () => {
    if (newerBtn.getAttribute("aria-disabled") === "true" || state.page === 0) return;
    state.page--;
    apply();
    afterPageChange();
  });
  olderBtn?.addEventListener("click", () => {
    if (olderBtn.getAttribute("aria-disabled") === "true") return;
    state.page++;
    apply();
    afterPageChange();
  });

  /** Move focus to the (now-updated) range readout rather than letting it fall
      to <body> when the activated pager control becomes unavailable. */
  function afterPageChange(): void {
    feedEl?.scrollIntoView({ block: "start" });
    const active = document.activeElement;
    const lost =
      active === document.body ||
      active === null ||
      (active instanceof HTMLButtonElement && active.getAttribute("aria-disabled") === "true");
    if (lost && rangeEl instanceof HTMLElement) rangeEl.focus();
  }
}
