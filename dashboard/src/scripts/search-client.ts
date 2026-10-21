/* Global header search (see HANDOFF.md): a prebuilt same-origin index,
   fetched lazily on first focus. Free text never leaves the device — the
   query runs entirely over the shipped index. "/" focuses (except while
   typing), Esc closes, results group Tickers · Members · Filers with
   combobox/listbox semantics. The pre-query state is the S6 block: how the
   search matches, and build-derived starters. */

import { esc } from "../lib/format.ts";
import { searchQuery, searchIndexValid, searchStarters, type SearchIndex, type SearchHit } from "../lib/derive.ts";

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

/** Pre-query state: the S6 block — how the search matches, then build-derived
    starters. The starter caption is "most-active in this build" — ranking
    comes from the build's own records, never from traffic. The site does
    measure page traffic (Cloudflare Web Analytics, see the methodology page),
    but that data is aggregate, lives outside the build, and yields no
    per-page view count this code could rank by. */
export function renderPreQuery(index: SearchIndex | null): string {
  const starters: string[] = [];
  if (index) {
    /* launch M2 (LD17): the ranking the home's "Try" chips share */
    const { tickers: topTickers, members: topMembers } = searchStarters(index);
    for (const [t] of topTickers) {
      starters.push(`<a class="quick-link" href="/tickers/${esc(encodeURIComponent(t))}/">${esc(t)}</a>`);
    }
    for (const [b, name] of topMembers) {
      starters.push(
        `<a class="quick-link" href="/congress/members/${esc(encodeURIComponent(b))}/">${esc(name)}</a>`,
      );
    }
  }
  return (
    `<div class="search-prequery s6-block">` +
    `<div class="s6-h">Search this build</div>` +
    `<p class="s6-body">Tickers match by prefix, names by substring. Free-text search never leaves your device: it runs against an index that ships with the build.</p>` +
    (starters.length > 0
      ? `<div class="quick-links">${starters.join("")}<span class="mono-note s6-note">← most-active in this build, as starters</span></div>`
      : "") +
    `</div>`
  );
}

/* ---------- the hero's search launcher (launch M2, LD17, DV14) ---------- */

/** The narrow surface `launchSearch` touches, declared structurally so the
    rule runs under `node --test` as well as on real elements. */
export interface SearchLaunchTargets {
  /** the ONE masthead combobox, `#site-search` */
  input: { focus(): void; getClientRects(): { length: number } } | null;
  /** its box, `#site-search-box` (the phone sheet while it carries `.open`) */
  box: { classList: { contains(token: string): boolean } } | null;
  /** the masthead's own search toggle, `.search-toggle` */
  toggle: { click(): void } | null;
}

/** What a launcher press does: focus the one masthead combobox. Where the
    masthead folds its search behind the toggle (phones: the box renders
    nothing until it is open), the press goes through that toggle, which
    opens the sheet and focuses the input itself — the same path as the
    masthead's own button, so the launcher is never a second search. Returns
    what it did, for the tests. */
export function launchSearch(t: SearchLaunchTargets): "focused" | "opened" | "none" {
  if (!t.input) return "none";
  const folded = t.input.getClientRects().length === 0 && !!t.box && !t.box.classList.contains("open");
  if (folded && t.toggle) {
    t.toggle.click();
    return "opened";
  }
  t.input.focus();
  return "focused";
}

/** Every `[data-search-launcher]` (the home hero's field-styled link to
    `#site-search`) runs `launchSearch` instead of following its fragment.
    Without JavaScript the link still lands on the masthead search. */
export function initSearchLaunchers(doc: Document = document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-search-launcher]"))) {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      launchSearch({
        input: doc.getElementById("site-search") as HTMLInputElement | null,
        box: doc.getElementById("site-search-box"),
        toggle: doc.querySelector<HTMLButtonElement>(".search-toggle"),
      });
    });
  }
}

/* ---------- the browser wiring ---------- */

export function initSearch(): void {
  const input = document.getElementById("site-search") as HTMLInputElement | null;
  const panel = document.getElementById("search-panel");
  const list = document.getElementById("search-panel-list");
  if (!input || !panel || !list) return;
  // launch M2 (LD17): the home hero's launcher focuses this same combobox
  initSearchLaunchers();

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
      list!.innerHTML = renderPreQuery(index);
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

  // Click outside closes; click on a result navigates naturally (anchor). A
  // launcher press is not "outside": it is what just opened the panel.
  document.addEventListener("click", (ev) => {
    if (panel.hidden) return;
    const target = ev.target as Element;
    if (target.closest("#site-search-box, [data-search-launcher]")) return;
    close();
  });
}
