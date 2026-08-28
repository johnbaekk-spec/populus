/* Client island for /congress: filtering, search, pagination, watchlist.
   All filtering happens on this device over the same-origin dataset shipped
   with the build (ARCHITECTURE §12.1 — no external calls, no accounts).
   Rows render through the same feedItemHtml the build used for page 1. */

import {
  classifyDataset,
  txnFromArray,
  paperFromArray,
  mergeFeed,
  pageSlice,
  pageCountFor,
  PAGE_SIZE,
  feedCountText,
  feedItemHtml,
  fmtInt,
  fmtMoney,
  amountVerdict,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../lib/format.ts";
import { windowMembership, type WindowVerdict } from "../lib/derive.ts";
import { initSortableTable } from "./table-sort.ts";
import { loadWatchStore } from "./entity-client.ts";

interface State {
  chamber: "all" | "house" | "senate";
  party: "all" | "D" | "R" | "I";
  side: "all" | "buy" | "sell" | "exch";
  amountMin: number;
  owner: "all" | "self" | "spouse" | "child" | "joint" | "none";
  late: boolean;
  q: string;
  page: number;
  /* A-1: sort + date range. `amount-*` sorts follow F-16's four-state rule:
     closed and upper-open rows rank on their LOWER bound (the disclosed,
     conservative key); a capped "Under $X" row ranks at its true lower bound
     0; a wholly-unknown row has no key at all and goes to a labeled
     unrankable bucket AFTER the ranked rows. An upper-bound sort is not
     offered — it is not definable over all four states. */
  sort: "filed" | "filed-asc" | "amount-desc" | "amount-asc";
  dateFrom: string; // "" = unbounded
  dateTo: string; // "" = unbounded
  dateBasis: "filed" | "traded";
  /** A-3: restrict to rows whose member or ticker is watched on this device */
  watchedOnly: boolean;
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
  sort: "filed",
  dateFrom: "",
  dateTo: "",
  dateBasis: "filed",
  watchedOnly: false,
};

/** F-16 sort key: the disclosed lower bound, or null when the row has no
    rankable key (wholly unknown). Exported for tests. */
export function amountSortKey(r: Pick<TxnRow, "low" | "high">): number | null {
  if (r.low != null) return r.low; // closed and upper-open: lower bound, normally
  if (r.high != null) return 0; // capped "Under $X" = closed [0,X]: true lower bound 0
  return null; // wholly unknown: no key — unrankable bucket, never coerced
}

/** F-16 amount ordering, pure: ranked rows on the lower-bound key with a
    stable tie-break (filed desc, then load order = txn_id asc within a date);
    wholly-unknown rows in a separate bucket, never interleaved. */
export function amountOrder(
  fTxns: readonly TxnRow[],
  sort: "amount-desc" | "amount-asc",
  orderIndex: ReadonlyMap<TxnRow, number>,
): { ranked: TxnRow[]; unranked: TxnRow[] } {
  const dir = sort === "amount-desc" ? -1 : 1;
  const ranked = fTxns
    .filter((r) => amountSortKey(r) !== null)
    .sort((a, b) => {
      const ka = amountSortKey(a)!;
      const kb = amountSortKey(b)!;
      if (ka !== kb) return dir * (ka - kb);
      if (a.filed !== b.filed) return a.filed < b.filed ? 1 : -1;
      return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
    });
  return { ranked, unranked: fTxns.filter((r) => amountSortKey(r) === null) };
}

/* THE FEED ISLAND IS THE SINGLE FETCH AND DECODE OWNER.

   The congress dataset is large. Exactly one module downloads it and exactly
   one module decodes it, and this is that module. Other sections of the page
   consume the already-parsed rows through `onRows` rather than fetching their
   own copy — a second owner would mean a second download, a second decode, and
   a second failure mode, without removing the first of any of them.

   A shared cached loader module was considered and rejected for the same
   reason: it would be a second owner of the same bytes.

   `onRows` fires EXACTLY ONCE, after a successful decode. It does not fire on
   failure — that is what leaves the server-rendered views standing. */
export interface FeedOptions {
  /** Receives the one decoded row set. Called once, only on success. */
  onRows?: (rows: readonly TxnRow[]) => void;
  /* `onSettled` fires on BOTH outcomes, exactly once, AFTER `onRows`
     on the success path. It exists because a consumer that shows a pending
     state has to clear it on failure too, and `onRows` documents itself as
     firing on success alone — so a pending indicator cleared only there would
     read "applying …" forever after a failed download, which is a false
     statement about a view that will never be painted. `ok` is the outcome, so
     the consumer can say WHY it could not apply rather than merely stopping. */
  onSettled?: (ok: boolean) => void;
}

export function initFeed(options: FeedOptions = {}): void {
  /* Fired once per LOAD ATTEMPT, on either outcome. A consumer's throw
     is contained the same way `onRows`'s is — a broken consumer must not turn a
     successful decode into a failed one.

     This flag is per-attempt, not per-island. It was an
     `initFeed`-lifetime latch, and `loadData()` runs again from the "Try again"
     button and from the filter path — so after ONE failure every later attempt
     was silently unsettleable. A reader who pressed a range control, failed,
     retried and failed again would sit on "Applying …" forever: exactly the
     false statement about an unpainted view that `onSettled` exists to remove,
     reintroduced one layer down. `loadData()` re-arms it. */
  let settled = false;
  function settle(ok: boolean): void {
    if (settled) return;
    settled = true;
    try {
      options.onSettled?.(ok);
    } catch (err) {
      console.error("populus: a feed-settled consumer failed", err);
    }
  }

  const rootEl = document.getElementById("congress-feed");
  const bodyEl = document.getElementById("feed-tbody");
  /* This used to require `#feed`, an id the page LOST when the feed became
     a section — so `initFeed` returned before fetching anything and the whole
     island was dead on the real page: no filtering, no paging, no header
     sorting, and no rows delivered to the momentum section.

     It survived every test because the fake DOM hands out every id it is asked
     for, including one the page no longer had. The element is only used to
     scroll after a page change, so it is now OPTIONAL and resolved against ids
     that actually exist. */
  const feedEl =
    document.getElementById("feed-section") ?? document.getElementById("congress-feed");
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
  // The feed's OWN text filter (ticker prefix + member substring) —
  // distinct from #site-search, which is site navigation.
  const searchInput = document.getElementById("filter-q") as HTMLInputElement | null;

  const dateFromInp = document.getElementById("filter-date-from") as HTMLInputElement | null;
  const dateToInp = document.getElementById("filter-date-to") as HTMLInputElement | null;
  const dateBasisSel = document.getElementById("filter-date-basis") as HTMLSelectElement | null;
  // `feedEl` is deliberately NOT in this guard: it is a scroll target, not a
  // prerequisite, and requiring it is what killed the island.
  if (!rootEl || !bodyEl || !countEl || !rangeEl) return;

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
  const orderIndex = new Map<TxnRow, number>();
  let loadPromise: Promise<void> | null = null;
  let pendingApply = false;

  function loadData(): Promise<void> {
    settled = false; // each attempt settles exactly once.
    loadPromise ??= fetch("/congress/data/feed.v1.json")
      .then((r) => {
        if (!r.ok) throw new Error(`dataset fetch failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        // A cached v1 body decoded with v2 offsets leaves asset
        // fields and txnId undefined — classify before decoding, refuse stale.
        const cls = classifyDataset(d);
        if (cls.outcome !== "ok") {
          throw new Error(
            cls.outcome === "version_mismatch"
              ? `dataset version mismatch: got ${String(cls.got)}`
              : `dataset rejected: ${cls.detail}`,
          );
        }
        txns = cls.txns.map(txnFromArray);
        paper = cls.paper.map(paperFromArray);
        // A-1: the load order (filed desc, txn_id asc within a date) is the
        // stable tie-break for every other sort — reproducible by build.
        txns.forEach((t, i) => orderIndex.set(t, i));
        // Hand the ONE decoded row set to the page's other consumers before
        // this island renders itself, so a consumer's failure surfaces as its
        // own error rather than as a feed that silently stopped rendering.
        try {
          options.onRows?.(txns);
        } catch (err) {
          console.error("populus: a feed-row consumer failed", err);
        }
        if (pendingApply) {
          pendingApply = false;
          apply();
        }
        settle(true);
      })
      .catch((err) => {
        loadPromise = null;
        loadingEl?.setAttribute("hidden", "");
        console.error("populus: feed dataset failed to load", err);
        // A refused or failed dataset states itself on the page
        // unconditionally — not only when an interaction was already pending.
        renderLoadFailure();
        settle(false);
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
  /* The feed no longer owns a window rule. `windowMembership` is the one
     authority in the tree, and it already encodes exactly what this filter
     needed: an explicit basis, filed dates always well-defined, and on the
     traded basis both the date-anomaly exclusion and the undated exclusion
     reported separately so each can be stated rather than silently applied.

     An unbounded window (no from AND no to) still admits every row on the
     filed basis, and the traded basis still applies its exclusions only when a
     range is actually set — the pre-existing behaviour, preserved: an
     unfiltered feed does not drop undated or anomalous rows. */
  function matchDate(r: TxnRow, s: State): WindowVerdict {
    if (!s.dateFrom && !s.dateTo) return "in";
    return windowMembership(r, { start: s.dateFrom, end: s.dateTo }, s.dateBasis);
  }

  function matchTxnExceptAmount(r: TxnRow, s: State): boolean {
    if (matchDate(r, s) !== "in") return false;
    if (
      s.watchedOnly &&
      !(r.bioguide !== null && watched.has(r.bioguide)) &&
      !(r.ticker !== null && watchStore.tickers.has(r.ticker))
    )
      return false;
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
    // A trade-date window cannot place a paper filing (no trade dates parsed).
    if (s.dateBasis === "traded" && (s.dateFrom || s.dateTo)) return false;
    return s.side === "all" && s.amountMin === 0 && s.owner === "all" && !s.late;
  }
  function matchPaper(p: PaperRow, s: State): boolean {
    if (s.chamber !== "all" && p.chamber !== s.chamber) return false;
    if (s.party !== "all" && p.party !== s.party) return false;
    if (s.q && !p.name.toLowerCase().includes(s.q.toLowerCase())) return false;
    // A paper filing has no trade date and no flags, so it is placed by
    // the ONE predicate on the filed basis — the only basis it can support.
    if (
      windowMembership(
        { traded: null, filed: p.filed, flags: [] },
        { start: s.dateFrom, end: s.dateTo },
        "filed",
      ) !== "in"
    )
      return false;
    // A paper filing has no ticker, so watched-only matches on the member.
    if (s.watchedOnly && !(p.bioguide !== null && watched.has(p.bioguide))) return false;
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
    // Constraint 9 disclosure: rows a trade-date window had to exclude because
    // their trade date is flagged impossible.
    const anomalyExcluded =
      state.dateBasis === "traded" && (state.dateFrom || state.dateTo)
        ? txns.filter((r) => matchDate(r, state) === "anomaly").length
        : 0;

    const ctx: RenderCtx = { watched };
    let items: (TxnRow | PaperRow)[];
    let maxPage: number;
    let unrankedStart = -1; // index into the FULL combined list, amount sorts only

    if (state.sort === "filed" || state.sort === "filed-asc") {
      // Page count is derived from the merged feed, so a trailing paper row is
      // always reachable (a counts-only formula cannot see where paper rows sit).
      const merged = mergeFeed(fTxns, fPaper);
      // Oldest-first is the SAME order reversed, never a second merge rule.
      if (state.sort === "filed-asc") merged.reverse();
      maxPage = Math.max(0, pageCountFor(merged) - 1);
      if (state.page > maxPage) state.page = maxPage;
      items = pageSlice(merged, state.page);
    } else {
      // F-16 amount ordering: ranked rows on the lower-bound key; wholly
      // unknown rows (and paper filings, which disclose no amount) go to a
      // LABELED unrankable bucket after every ranked row — never interleaved,
      // never coerced to zero. Stable tie-break: filed desc, then load order
      // (txn_id asc within a date), so the order is reproducible.
      const { ranked, unranked } = amountOrder(
        fTxns,
        state.sort as "amount-desc" | "amount-asc",
        orderIndex,
      );
      const all = [...ranked, ...unranked, ...fPaper];
      unrankedStart = ranked.length;
      maxPage = Math.max(0, Math.ceil(all.length / PAGE_SIZE) - 1);
      if (state.page > maxPage) state.page = maxPage;
      items = all.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    }

    // Keyed on what actually renders — a paper-only result set renders rows,
    // and an empty page must always say so rather than showing a blank frame.
    if (items.length === 0) {
      bodyEl!.innerHTML = "";
      renderEmpty(fTxns.length);
    } else {
      emptyEl?.setAttribute("hidden", "");
      const pageStart = state.page * PAGE_SIZE;
      const parts: string[] = [];
      items.forEach((it, i) => {
        if (unrankedStart >= 0 && pageStart + i === unrankedStart) {
          const nUnrankable = fTxns.filter((r) => amountSortKey(r) === null).length + fPaper.length;
          // A separator INSIDE a tbody must be a row, or the browser hoists it
          // out of the table and the label detaches from the rows it labels.
          parts.push(
            `<tr class="unranked-sep"><td colspan="9">Not rankable by amount — ` +
              `wholly undisclosed or paper (${fmtInt(nUnrankable)} ` +
              `${nUnrankable === 1 ? "row" : "rows"}) · listed after every ranked row, never coerced to $0</td></tr>`,
          );
        }
        parts.push(feedItemHtml(it, ctx));
      });
      bodyEl!.innerHTML = parts.join("\n");
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
    setCounts(
      range +
        (anomalyExcluded > 0
          ? ` · ${fmtInt(anomalyExcluded)} date-anomaly ${
              anomalyExcluded === 1 ? "row" : "rows"
            } excluded from the trade-date window`
          : ""),
    );

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
    if (dateFromInp) dateFromInp.value = "";
    if (dateToInp) dateToInp.value = "";
    if (dateBasisSel) dateBasisSel.value = "filed";
    const watchedReset = document.getElementById("filter-watched") as HTMLInputElement | null;
    if (watchedReset) watchedReset.checked = false;
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

  const watchedChk = document.getElementById("filter-watched") as HTMLInputElement | null;
  watchedChk?.addEventListener("change", () => {
    state.watchedOnly = watchedChk.checked;
    state.page = 0;
    apply();
  });

  searchInput?.addEventListener("input", () => {
    state.q = searchInput.value.trim();
    state.page = 0;
    apply();
  });
  dateFromInp?.addEventListener("change", () => {
    state.dateFrom = dateFromInp.value;
    state.page = 0;
    apply();
  });
  dateToInp?.addEventListener("change", () => {
    state.dateTo = dateToInp.value;
    state.page = 0;
    apply();
  });
  dateBasisSel?.addEventListener("change", () => {
    state.dateBasis = dateBasisSel.value as State["dateBasis"];
    state.page = 0;
    apply();
  });

  /* Sorting goes through the SHARED `initSortableTable` plumbing.
     It briefly bound its own click handlers and
     maintained its own `aria-sort`, which is a second sort state machine beside
     the shared one — free to drift on keyboard behaviour, ARIA, announcements
     and direction defaults, and invisible in review until it did.

     The helper owns NO ordering. Comparison, the ranked/unrankable split and
     the pager stay here: `render` returns the current body and `apply()` does
     the real work, because a feed re-render must also update the pager, the
     count line and the empty state — repainting only the tbody would leave a
     page-2 pager above page-1 rows. */
  const feedTable = bodyEl?.closest("table") ?? null;
  const feedHeaders = feedTable
    ? [...feedTable.querySelectorAll<HTMLElement>("thead th[data-feed-sort]")]
    : [];
  initSortableTable({
    root: { set innerHTML(_v: string) { /* apply() owns the body */ } },
    headers: feedHeaders,
    keyOf: (th) => (th as unknown as HTMLElement).dataset.feedSort,
    initial: { key: "filed", dir: "desc" },
    defaultDir: (key) =>
      ((feedHeaders.find((h) => h.dataset.feedSort === key)?.dataset.feedDir as
        | "asc"
        | "desc") ?? "desc"),
    render: (st) => {
      state.sort =
        st.key === "filed"
          ? st.dir === "desc"
            ? "filed"
            : "filed-asc"
          : st.dir === "desc"
            ? "amount-desc"
            : "amount-asc";
      state.page = 0;
      apply();
      return "";
    },
    announce: (st) =>
      `Sorted by ${st.key === "filed" ? "filed date" : "amount"}, ${
        st.dir === "desc" ? "descending" : "ascending"
      }.`,
    statusEl,
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
