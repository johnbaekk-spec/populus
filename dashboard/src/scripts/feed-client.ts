/* Client island for /congress: filtering, search, pagination, watchlist.
   All filtering happens on this device over the same-origin dataset shipped
   with the build (ARCHITECTURE §12.1 — no external calls, no accounts).
   Rows render through the same feedItemHtml the build used for page 1. */

import {
  txnFromArray,
  paperFromArray,
  mergeFeed,
  pageSlice,
  feedItemHtml,
  fmtInt,
  PAGE_SIZE,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../lib/format";

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

const WATCH_KEY = "populus:watch:members";

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
  const resetBtn = document.getElementById("filter-reset") as HTMLButtonElement | null;
  const resetWrap = document.getElementById("filter-reset-wrap");
  const newerBtn = document.getElementById("pager-newer") as HTMLButtonElement | null;
  const olderBtn = document.getElementById("pager-older") as HTMLButtonElement | null;
  const amountSel = document.getElementById("filter-amount") as HTMLSelectElement | null;
  const ownerSel = document.getElementById("filter-owner") as HTMLSelectElement | null;
  const lateChk = document.getElementById("filter-late") as HTMLInputElement | null;
  const searchInput = document.getElementById("site-search") as HTMLInputElement | null;
  if (!rootEl || !bodyEl || !feedEl || !countEl || !rangeEl) return;

  const totalAll = Number(rootEl.dataset.txnCount ?? 0);
  const state: State = { ...DEFAULTS };
  resetWrap?.removeAttribute("hidden");

  /* ---------- watchlist (localStorage, this browser only) ---------- */

  let watched = new Set<string>();
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (raw) watched = new Set(JSON.parse(raw) as string[]);
  } catch {}

  function persistWatched(): void {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify([...watched]));
    } catch {}
  }
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
    const id = btn.dataset.watch!;
    if (watched.has(id)) watched.delete(id);
    else watched.add(id);
    persistWatched();
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
      });
    return loadPromise;
  }
  const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => loadData());

  /* ---------- filtering ---------- */

  function matchTxn(r: TxnRow, s: State): boolean {
    if (s.chamber !== "all" && r.chamber !== s.chamber) return false;
    if (s.party !== "all" && r.party !== s.party) return false;
    if (s.side === "buy" && r.side !== "purchase") return false;
    if (s.side === "sell" && r.side !== "sale" && r.side !== "sale_partial") return false;
    if (s.side === "exch" && r.side !== "exchange") return false;
    if (s.amountMin > 0 && !(r.low != null && r.low > s.amountMin)) return false;
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
    emptyDetailEl.textContent =
      `This build holds ${fmtInt(totalAll)} transaction rows; the current ` +
      `combination matches ${fmtInt(currentCount)}.` +
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
      pendingApply = true;
      loadingEl?.removeAttribute("hidden");
      if (bodyEl) bodyEl.innerHTML = "";
      emptyEl?.setAttribute("hidden", "");
      loadData();
      return;
    }
    loadingEl?.setAttribute("hidden", "");

    const fTxns = txns.filter((r) => matchTxn(r, state));
    const fPaper = paperVisible(state) ? paper.filter((p) => matchPaper(p, state)) : [];

    const maxPage = Math.max(0, Math.ceil(fTxns.length / PAGE_SIZE) - 1);
    if (state.page > maxPage) state.page = maxPage;

    const merged = mergeFeed(fTxns, fPaper);
    const items = pageSlice(merged, state.page);
    const ctx: RenderCtx = { watched };

    if (fTxns.length === 0 && fPaper.length === 0) {
      bodyEl!.innerHTML = "";
      renderEmpty(0);
    } else {
      emptyEl?.setAttribute("hidden", "");
      bodyEl!.innerHTML = items.map((it) => feedItemHtml(it, ctx)).join("\n");
    }

    const lo = fTxns.length === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const hi = Math.min((state.page + 1) * PAGE_SIZE, fTxns.length);
    const range =
      fTxns.length === 0 ? `0 of ${fmtInt(totalAll)}` : `${fmtInt(lo)}–${fmtInt(hi)} of ${fmtInt(fTxns.length)}`;
    countEl!.textContent = range;
    rangeEl!.textContent = range;

    if (newerBtn) newerBtn.hidden = state.page === 0;
    if (olderBtn) olderBtn.disabled = state.page >= maxPage;
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

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      state.page = 0;
      apply();
    }, 150);
  });

  resetBtn?.addEventListener("click", resetAll);
  newerBtn?.addEventListener("click", () => {
    if (state.page > 0) {
      state.page--;
      apply();
      feedEl.scrollIntoView({ block: "start" });
    }
  });
  olderBtn?.addEventListener("click", () => {
    state.page++;
    apply();
    feedEl.scrollIntoView({ block: "start" });
  });
}
