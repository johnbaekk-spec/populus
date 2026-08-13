/* A-3 client island for /watchlist. Everything is device-local: the watch-v2
   store, the last-seen cursor, and the same-origin dataset — no accounts, no
   external calls. Rows render through the same feedItemHtml as everywhere. */

import {
  classifyDataset,
  txnFromArray,
  paperFromArray,
  mergeFeed,
  feedItemHtml,
  fmtInt,
  esc,
  memberHref,
  tickerHref,
  pathSafeTicker,
  genericEntityHref,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../lib/format.ts";
import { loadWatchStore } from "./entity-client.ts";
import {
  classifyCursor,
  isNewSince,
  latestFiledByKey,
  readCursor,
  watchedRows,
  writeCursor,
  type SeenCursor,
} from "../lib/watchlist.ts";

const RENDER_CAP = 100;

export function initWatchlist(): void {
  const rootEl = document.getElementById("watchlist-root");
  const chipsEl = document.getElementById("watch-chips");
  const bannerEl = document.getElementById("watch-banner");
  const bodyEl = document.getElementById("watch-body");
  const countEl = document.getElementById("watch-count");
  const emptyEl = document.getElementById("watch-empty");
  const newOnlyChk = document.getElementById("watch-new-only") as HTMLInputElement | null;
  const markBtn = document.getElementById("watch-mark-seen") as HTMLButtonElement | null;
  if (!rootEl || !chipsEl || !bannerEl || !bodyEl || !countEl || !emptyEl) return;

  const buildId = rootEl.dataset.buildId ?? "";
  const datasetFrom = rootEl.dataset.filedFrom ?? "";
  const store = loadWatchStore(localStorage);
  let cursor = readCursor(localStorage);
  let newOnly = false;
  let txns: TxnRow[] = [];
  let paper: PaperRow[] = [];
  // Review F5: the mark-seen action must not exist before a VALIDATED dataset
  // is on hand — an early click would advance the cursor past unseen filings.
  let loaded = false;
  if (markBtn) markBtn.disabled = true;

  function renderBanner(latestFiled: string | null): void {
    const state = classifyCursor(cursor, datasetFrom);
    if (state.kind === "none") {
      bannerEl!.innerHTML =
        `<div class="watch-note">First visit on this device — there is no last-seen marker yet. ` +
        `“Mark all seen” starts the clock; after that, this page separates what is new since your last look.</div>`;
      return;
    }
    if (state.kind === "gap") {
      // D-1c: the cursor predates what this build retains — say so, offer reset.
      bannerEl!.innerHTML =
        `<div class="watch-gap" role="note"><strong>Coverage gap.</strong> Your last-seen marker ` +
        `(${esc(state.cursor.lastSeenFiled)}) predates the earliest filing this build retains ` +
        `(${esc(state.datasetFrom)}). Filings between the two may exist that this page cannot show, ` +
        `so the “new since you last looked” list below would be incomplete — it is withheld rather ` +
        `than presented as complete. Mark all seen to reset the marker against this build.</div>`;
      return;
    }
    const fresh = [...watched(), ...watchedPaper()].filter((r) => isNewSince(r, state.cursor)).length;
    bannerEl!.innerHTML =
      `<div class="watch-note">${fmtInt(fresh)} watched ${fresh === 1 ? "filing" : "filings"} new since ` +
      `you last looked (marker: filed through ${esc(state.cursor.lastSeenFiled)}, set against build ` +
      `${esc(state.cursor.buildId)}).${latestFiled ? ` Latest watched filing: ${esc(latestFiled)}.` : ""}</div>`;
  }

  function watched(): TxnRow[] {
    return watchedRows(txns, store.members, store.tickers);
  }

  /** Paper filings for watched MEMBERS (a paper filing discloses no ticker).
      Review F4: a watched member's latest filing can be paper-only; dropping
      them made the latest date stale and hid needs-OCR filings entirely. */
  function watchedPaper(): PaperRow[] {
    return paper.filter((p) => p.bioguide !== null && store.members.has(p.bioguide));
  }

  function chipHtml(kind: "m" | "t", key: string, label: string, latest: string | undefined): string {
    const href =
      kind === "m"
        ? memberHref(key)
        : pathSafeTicker(key)
          ? tickerHref(key)
          : genericEntityHref("t", key);
    return (
      `<span class="chip watch-chip"><a href="${href}">${esc(label)}</a>` +
      `<span class="mono-note">${latest ? ` latest ${esc(latest)}` : " no filings in this build"}</span>` +
      `<button class="chip-x" data-unwatch="${kind}:${esc(key)}" aria-label="stop watching ${esc(label)}">×</button></span>`
    );
  }

  function render(): void {
    const rows = watched();
    const paperRows = watchedPaper();
    const latest = latestFiledByKey(
      [...txns, ...paper.map((p) => ({ bioguide: p.bioguide, ticker: null, filed: p.filed }))],
      store.members,
      store.tickers,
    );

    // entity chips — names come from the rows themselves (the store holds keys only)
    const nameOf = new Map<string, string>();
    for (const r of rows) if (r.bioguide) nameOf.set(r.bioguide, r.name);
    chipsEl!.innerHTML =
      [...store.members]
        .sort()
        .map((b) => chipHtml("m", b, nameOf.get(b) ?? b, latest.get(`m:${b}`)))
        .join("") +
      [...store.tickers]
        .sort()
        .map((t) => chipHtml("t", t, t, latest.get(`t:${t}`)))
        .join("");

    if (store.members.size === 0 && store.tickers.size === 0) {
      emptyEl!.removeAttribute("hidden");
      bodyEl!.innerHTML = "";
      bannerEl!.innerHTML = "";
      countEl!.textContent = "";
      return;
    }
    emptyEl!.setAttribute("hidden", "");

    const state = classifyCursor(cursor, datasetFrom);
    let visible = mergeFeed(rows, paperRows);
    if (newOnly) {
      // The new-only view exists ONLY when the cursor is inside the retained
      // window — under a gap it would be an incomplete list wearing a
      // confident face (D-1c).
      visible = state.kind === "current" ? visible.filter((r) => isNewSince(r, state.cursor)) : [];
    }
    const ctx: RenderCtx = { watched: store.members, watchedTickers: store.tickers };
    const shown = visible.slice(0, RENDER_CAP);
    bodyEl!.innerHTML = shown
      .map((r) => {
        const isNew = state.kind === "current" && isNewSince(r, state.cursor);
        return `<div class="${isNew ? "watch-new" : ""}">${feedItemHtml(r, ctx)}</div>`;
      })
      .join("\n");
    countEl!.textContent =
      `${fmtInt(shown.length)} of ${fmtInt(visible.length)} watched ${visible.length === 1 ? "row" : "rows"}` +
      (visible.length > RENDER_CAP ? ` — first ${RENDER_CAP} by filed date; refine your watchlist to narrow` : "") +
      ` · stored on this device only`;
    renderBanner(mergeFeed(rows, paperRows)[0]?.filed ?? null);
  }

  fetch("/congress/data/feed.v1.json")
    .then((r) => {
      if (!r.ok) throw new Error(`dataset fetch failed: ${r.status}`);
      return r.json();
    })
    .then((d) => {
      // Review F3: classify before decoding — a stale v1 body must be refused,
      // never read with v2 column offsets.
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
      loaded = true;
      if (markBtn) markBtn.disabled = false;
      render();
    })
    .catch(() => {
      bodyEl!.innerHTML = "";
      bannerEl!.innerHTML =
        `<div class="watch-gap" role="note">The dataset failed to download — the watchlist cannot ` +
        `render without it. Nothing shown here is stale or invented.</div>`;
    });

  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-unwatch]");
    if (!btn) return;
    const [kind, ...rest] = btn.dataset.unwatch!.split(":");
    store.toggle(kind === "m" ? "member" : "ticker", rest.join(":"));
    render();
  });
  newOnlyChk?.addEventListener("change", () => {
    newOnly = newOnlyChk.checked;
    render();
  });
  markBtn?.addEventListener("click", () => {
    // Review F5: only a VERIFIED dataset high-water mark ever becomes the
    // cursor — never the wall clock, and never before the dataset loads.
    if (!loaded) return;
    const maxFiled = [txns[0]?.filed, paper[0]?.filed]
      .filter((d): d is string => d != null)
      .sort()
      .at(-1);
    if (maxFiled === undefined) return; // an empty dataset marks nothing seen
    const next: SeenCursor = {
      v: 1,
      lastSeenFiled: maxFiled,
      buildId,
      at: new Date().toISOString(),
    };
    writeCursor(localStorage, next);
    cursor = next;
    render();
  });
}
