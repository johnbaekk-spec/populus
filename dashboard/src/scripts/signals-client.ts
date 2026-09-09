/* /signals client island. Two device-local enhancements over a page that is
   complete without them:

   1. the HITS family filter — a `.seg` over rows the server already rendered;
      filtering hides rows, it never fetches or re-renders;
   2. the WATCHLIST band — joins the embedded newest-hits payload against the
      watch-v2 store (members + tickers) and the last-seen cursor, all of which
      live in this browser only. Nothing leaves the device. */

import { esc, fmtInt, fmtUsd, memberHref, tickerHref, pathSafeTicker, genericEntityHref, srcLink } from "../lib/format.ts";
import { loadWatchStore } from "./entity-client.ts";
import { classifyCursor, readCursor, writeCursor } from "../lib/watchlist.ts";

const SHORT: Record<string, string> = {
  "s1-large": "LARGE",
  "s2-first": "FIRST FILING",
  "s3-cooccurrence": "CO-OCCURRENCE",
  "s4-infrequent": "INFREQUENT",
  "s5-jurisdiction": "COMMITTEE",
  "s6-late-large": "LATE",
};

type Row = [string, string, string | null, string, string | null, number | null, number | null, string | null, string, string];

function magnitude(low: number | null, high: number | null): string {
  if (low == null && high == null) return "not disclosed";
  if (low != null && high == null) return `Over ${fmtUsd(low)}`;
  if (low == null) return `Under ${fmtUsd(high!)}`;
  return `${fmtUsd(low)}–${fmtUsd(high!)}`;
}

function initHitFilter(): void {
  const seg = document.querySelector<HTMLElement>(".si-hit-filter");
  const body = document.getElementById("signal-hits-body");
  const count = document.getElementById("signal-hits-count");
  if (!seg || !body) return;
  seg.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-family]");
    if (!btn) return;
    const fam = btn.dataset.family ?? "all";
    for (const b of seg.querySelectorAll<HTMLButtonElement>("button[data-family]"))
      b.setAttribute("aria-pressed", String(b === btn));
    let shown = 0;
    for (const tr of body.querySelectorAll<HTMLTableRowElement>("tr.si-hit")) {
      const on = fam === "all" || tr.dataset.family === fam;
      tr.hidden = !on;
      if (on) shown++;
    }
    const status = document.getElementById("signal-hits-status");
    if (status) status.textContent = `${fmtInt(shown)} rendered ${shown === 1 ? "hit" : "hits"} match the ${fam === "all" ? "unfiltered" : fam.toLowerCase()} view.`;
    count?.setAttribute("data-visible", String(shown));
  });
}

function initWatchBand(): void {
  const root = document.getElementById("signal-watch");
  const data = document.getElementById("signal-watch-data");
  const body = document.getElementById("signal-watch-body");
  const chips = document.getElementById("signal-watch-chips");
  const seenBtn = document.getElementById("signal-watch-seen") as HTMLButtonElement | null;
  const note = document.getElementById("signal-watch-note");
  if (!root || !data || !body || !chips) return;
  let payload: { rows: Row[]; total: number; cap: number };
  try {
    payload = JSON.parse(data.textContent ?? "{}");
    if (!Array.isArray(payload.rows)) return;
  } catch {
    return;
  }
  const store = loadWatchStore(localStorage);
  const buildId = root.dataset.buildId ?? "";
  const coverageFrom = root.dataset.coverageFrom ?? "";
  let cursor = readCursor(localStorage);

  const watchedMembers = store.members;
  const watchedTickers = store.tickers;
  const nothing = watchedMembers.size === 0 && watchedTickers.size === 0;
  chips.innerHTML =
    [...watchedMembers].map((m) => `<a class="chip" href="${memberHref(m)}">${esc(m)}</a>`).join("") +
    [...watchedTickers]
      .map((t) => `<a class="chip" href="${pathSafeTicker(t) ? tickerHref(t) : genericEntityHref("t", t)}">${esc(t)}</a>`)
      .join("");
  if (nothing) return;

  const hits = payload.rows.filter(
    ([, , bioguide, , ticker]) => (bioguide && watchedMembers.has(bioguide)) || (ticker && watchedTickers.has(ticker)),
  );
  const state = classifyCursor(cursor, coverageFrom);
  const isNew = (filed: string): boolean => state.kind === "current" && filed > state.cursor.lastSeenFiled;
  const render = (): void => {
    if (hits.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="si-empty">No signal hits on watched subjects in the retained window — a computed answer, not missing coverage.</td></tr>`;
      return;
    }
    body.innerHTML = hits
      .map(([id, kind, bioguide, name, ticker, low, high, traded, filed, receipt]) => {
        const subject = bioguide ? `<a href="${memberHref(bioguide)}">${esc(name)}</a>` : esc(name);
        const tk = ticker ? ` <a class="si-ticker" href="${pathSafeTicker(ticker) ? tickerHref(ticker) : genericEntityHref("t", ticker)}">${esc(ticker)}</a>` : "";
        const fresh = isNew(filed);
        return (
          `<tr class="si-hit" data-signal-id="${esc(id)}">` +
          `<td class="si-kind">${esc(SHORT[kind] ?? kind)}</td>` +
          `<td class="si-subject">${subject}${tk}<span class="si-gold" aria-hidden="true"> ◆</span></td>` +
          `<td class="si-evidence">${esc(SHORT[kind] ?? kind)} rule matched · <a href="#signal-rulebook">rule book</a></td>` +
          `<td class="c-num si-mag">${esc(magnitude(low, high))}</td>` +
          `<td class="c-filed si-when">${esc(traded ? traded.slice(5) : "—")} → ${esc(filed.slice(5))}</td>` +
          `<td class="c-num ${fresh ? "si-new" : "c-muted"}">${fresh ? "NEW" : state.kind === "none" ? "—" : "seen"}</td>` +
          `<td class="c-src">${receipt ? srcLink(receipt) : "—"}</td></tr>`
        );
      })
      .join("");
  };
  render();
  if (note) {
    const gap = state.kind === "gap"
      ? ` Your last-seen marker (${esc(state.cursor.lastSeenFiled)}) predates this window's start (${esc(coverageFrom)}) — "new" cannot be stated until you mark all seen.`
      : "";
    note.insertAdjacentHTML(
      "afterbegin",
      `<span>${fmtInt(hits.length)} ${hits.length === 1 ? "hit" : "hits"} on ${fmtInt(watchedMembers.size + watchedTickers.size)} watched ${watchedMembers.size + watchedTickers.size === 1 ? "subject" : "subjects"}` +
        (payload.total > payload.cap ? ` · joined against the newest ${fmtInt(payload.cap)} of ${fmtInt(payload.total)} hits` : "") +
        `.${gap}</span> `,
    );
  }
  if (seenBtn) {
    seenBtn.disabled = false;
    seenBtn.addEventListener("click", () => {
      const latest = payload.rows.reduce((m, r) => (r[8] > m ? r[8] : m), "");
      if (!latest) return;
      cursor = { v: 1, lastSeenFiled: latest, buildId, at: new Date().toISOString() };
      writeCursor(localStorage, cursor);
      location.reload();
    });
  }
}

export function initSignalsPage(): void {
  initHitFilter();
  initWatchBand();
}
