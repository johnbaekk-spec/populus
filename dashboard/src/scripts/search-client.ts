/* Global header search (R11, HANDOFF.md): a prebuilt same-origin index,
   fetched lazily on first focus. Free text never leaves the device — the
   query runs entirely over the shipped index. "/" focuses (except while
   typing), Esc closes, results group Tickers · Members · Filers with
   combobox/listbox semantics. The pre-query state is the v2 watchlist's
   quick links, or the S6 empty-watchlist starters (Locked #5). */

import { esc } from "../lib/format.ts";
import { searchQuery, searchIndexValid, type SearchIndex, type SearchHit } from "../lib/derive.ts";
import { loadWatchStore, type WatchStore } from "./entity-client.ts";

export const SEARCH_INDEX_PATH = "/search/index.v1.json";

/* ---------- pure panel renderers (unit-tested without a DOM) ---------- */

export function optionId(i: number): string {
  return `search-opt-${i}`;
}

export function renderResults(hits: SearchHit[], active: number): string {
  if (hits.length === 0) {
    return `<div class="search-empty">Nothing in this build matches — tickers match by prefix, names by substring. The index covers every ticker, member, and filer published in this build.</div>`;
  }
  const groups: { label: string; kind: SearchHit["kind"] }[] = [
    { label: "Tickers", kind: "ticker" },
    { label: "Members", kind: "member" },
    { label: "Filers", kind: "filer" },
  ];
  let i = 0;
  return groups
    .map(({ label, kind }) => {
      const rows = hits.filter((h) => h.kind === kind);
      if (rows.length === 0) return "";
      const items = rows
        .map((h) => {
          const idx = hits.indexOf(h);
          return (
            `<a class="search-opt${idx === active ? " active" : ""}" role="option" id="${optionId(idx)}"` +
            ` aria-selected="${idx === active}" href="${esc(h.href)}">` +
            `<span class="opt-label">${esc(h.label)}</span><span class="opt-sub">${esc(h.sub)}</span></a>`
          );
        })
        .join("");
      i += rows.length;
      return `<div class="search-group" role="group" aria-label="${label}"><div class="search-group-h">${label}</div>${items}</div>`;
    })
    .join("");
}

/** Pre-query state: watchlist quick links when anything is starred, else the
    S6 empty-watchlist block with build-derived starters. The starter caption
    is "most-active in this build" — ranking comes from the build's own
    records, never from traffic. The site does measure page traffic
    (Cloudflare Web Analytics, see the methodology page), but that data is
    aggregate, lives outside the build, and yields no per-page view count
    this code could rank by (Locked #5 rewording, register entry). */
export function renderPreQuery(watch: WatchStore, index: SearchIndex | null): string {
  const watchedMembers = [...watch.members];
  const watchedTickers = [...watch.tickers];
  if (watchedMembers.length > 0 || watchedTickers.length > 0) {
    const nameOf = new Map((index?.members ?? []).map((m) => [m[0], m[1]]));
    const links = [
      ...watchedTickers.map(
        (t) => `<a class="quick-link" href="/tickers/${esc(encodeURIComponent(t))}/">★ ${esc(t)}</a>`,
      ),
      ...watchedMembers.map(
        (b) =>
          `<a class="quick-link" href="/congress/members/${esc(encodeURIComponent(b))}/">★ ${esc(
            nameOf.get(b) ?? b,
          )}</a>`,
      ),
    ].join("");
    return (
      `<div class="search-prequery"><div class="search-group-h">Watching · saved on this device</div>` +
      `<div class="quick-links">${links}</div></div>`
    );
  }
  // S6 — empty watchlist
  const starters: string[] = [];
  if (index) {
    const topTickers = [...index.tickers].sort((a, b) => b[2] - a[2]).slice(0, 2);
    const topMembers = [...index.members].sort((a, b) => b[3] - a[3]).slice(0, 2);
    for (const [t] of topTickers) {
      starters.push(`<a class="quick-link" href="/tickers/${esc(encodeURIComponent(t))}/">☆ ${esc(t)}</a>`);
    }
    for (const [b, name] of topMembers) {
      starters.push(
        `<a class="quick-link" href="/congress/members/${esc(encodeURIComponent(b))}/">☆ ${esc(name)}</a>`,
      );
    }
  }
  return (
    `<div class="search-prequery s6-block">` +
    `<div class="s6-h">Nothing watched yet</div>` +
    `<p class="s6-body">Star a member or a ticker (☆) to pin it here. Watchlists live in <strong>this browser only</strong> — no account is required and nothing is transmitted. Clearing site data clears the list.</p>` +
    (starters.length > 0
      ? `<div class="quick-links">${starters.join("")}<span class="mono-note s6-note">← most-active in this build, as starters</span></div>`
      : "") +
    `</div>`
  );
}

/* ---------- the browser wiring ---------- */

export function initSearch(): void {
  const input = document.getElementById("site-search") as HTMLInputElement | null;
  const panel = document.getElementById("search-panel");
  const list = document.getElementById("search-panel-list");
  if (!input || !panel || !list) return;
  const watch = loadWatchStore(window.localStorage);

  let index: SearchIndex | null = null;
  let loadPromise: Promise<void> | null = null;
  let hits: SearchHit[] = [];
  let active = -1;

  function loadIndex(): Promise<void> {
    loadPromise ??= fetch(SEARCH_INDEX_PATH)
      .then((r) => {
        if (!r.ok) throw new Error(`search index fetch failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (searchIndexValid(d)) index = d;
        else throw new Error("search index shape unexpected");
      })
      .catch(() => {
        loadPromise = null;
        if (list)
          list.innerHTML = `<div class="search-empty">The search index failed to download — <a href="${SEARCH_INDEX_PATH}">open it raw ↗</a> or try again.</div>`;
      });
    return loadPromise;
  }

  function open(): void {
    panel!.hidden = false;
    input!.setAttribute("aria-expanded", "true");
  }
  function close(): void {
    panel!.hidden = true;
    input!.setAttribute("aria-expanded", "false");
    input!.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function apply(): void {
    const q = input!.value.trim();
    if (!q) {
      hits = [];
      active = -1;
      list!.innerHTML = renderPreQuery(watch, index);
      return;
    }
    if (!index) {
      list!.innerHTML = `<div class="search-empty">loading the index…</div>`;
      void loadIndex().then(apply);
      return;
    }
    hits = searchQuery(index, q);
    if (active >= hits.length) active = hits.length - 1;
    list!.innerHTML = renderResults(hits, active);
    if (active >= 0) input!.setAttribute("aria-activedescendant", optionId(active));
    else input!.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("focus", () => {
    void loadIndex().then(apply);
    apply();
    open();
  });
  input.addEventListener("input", () => {
    active = -1;
    apply();
    open();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      close();
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (hits.length === 0) return;
      ev.preventDefault();
      active =
        ev.key === "ArrowDown"
          ? (active + 1) % hits.length
          : (active - 1 + hits.length) % hits.length;
      list!.innerHTML = renderResults(hits, active);
      input.setAttribute("aria-activedescendant", optionId(active));
      return;
    }
    if (ev.key === "Enter" && active >= 0 && hits[active]) {
      ev.preventDefault();
      window.location.href = hits[active]!.href;
    }
  });

  // "/" focuses the search from anywhere except a typing context.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    )
      return;
    ev.preventDefault();
    input.focus();
  });

  // Click outside closes; click on a result navigates naturally (anchor).
  document.addEventListener("click", (ev) => {
    if (panel.hidden) return;
    const target = ev.target as Element;
    if (target.closest("#site-search-box")) return;
    close();
  });
}
