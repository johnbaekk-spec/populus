/* /signals client island. Two device-local enhancements over a page that is
   complete without them:

   1. the HITS family filter — a `.seg` over rows the server already rendered;
      filtering hides rows, it never fetches or re-renders;
   2. the WATCHLIST band — joins the embedded newest-hits payload against the
      watch-v2 store (members + tickers) and the last-seen cursor, all of which
      live in this browser only. Nothing leaves the device. */

import { fmtInt, fmtUsd, memberHref, tickerHref, pathSafeTicker, genericEntityHref, srcLabel } from "../lib/format.ts";
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

const BIOGUIDE_RE = /^[A-Z]\d{6}$/;
/** rows the watch band renders; the summary line states the bound */
const WATCH_RENDER_CAP = 50;

type Row = [string, string, string | null, string, string | null, number | null, number | null, string | null, string, string];

function magnitude(low: number | null, high: number | null): string {
  if (low == null && high == null) return "not disclosed";
  if (low != null && high == null) return `Over ${fmtUsd(low)}`;
  if (low == null) return `Under ${fmtUsd(high!)}`;
  return `${fmtUsd(low)}–${fmtUsd(high!)}`;
}

const cell = (cls: string, ...children: (Node | string)[]): HTMLTableCellElement => {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  for (const c of children) td.append(c);
  return td;
};
const link = (href: string, text: string, cls = ""): HTMLAnchorElement => {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  if (cls) a.className = cls;
  return a;
};

/** A receipt is re-assembled from its parsed parts under a constant `https://`
    prefix — never assigned as the string that came out of the document — so a
    non-https or malformed receipt renders as "—" and nothing else can reach
    the href. */
function safeReceiptHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname) return null;
  return "https://" + u.hostname + u.pathname + u.search;
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
  chips.replaceChildren(
    ...[...watchedMembers].filter((m) => BIOGUIDE_RE.test(m)).map((m) => link(memberHref(m), m, "chip")),
    ...[...watchedTickers].map((t) => link(pathSafeTicker(t) ? tickerHref(t) : genericEntityHref("t", t), t, "chip")),
  );
  if (nothing) return;

  const hits = payload.rows.filter(
    ([, , bioguide, , ticker]) => (bioguide && watchedMembers.has(bioguide)) || (ticker && watchedTickers.has(ticker)),
  );
  const state = classifyCursor(cursor, coverageFrom);
  const isNew = (filed: string): boolean => state.kind === "current" && filed > state.cursor.lastSeenFiled;
  /* DOM construction, not innerHTML: the payload came out of the document, so
     a string path back into markup is exactly the taint CodeQL flags. Every
     value lands through textContent; every href is validated then set as a
     property; receipts must be https. */
  const render = (): void => {
    body.replaceChildren();
    if (hits.length === 0) {
      const tr = document.createElement("tr");
      const td = cell("si-empty");
      td.colSpan = 7;
      td.textContent = "No signal hits on watched subjects in the retained window — a computed answer, not missing coverage.";
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const [id, kind, bioguide, name, ticker, low, high, traded, filed, receipt] of hits.slice(0, WATCH_RENDER_CAP)) {
      const tr = document.createElement("tr");
      tr.className = "si-hit";
      tr.dataset.signalId = id;
      const short = SHORT[kind] ?? kind;
      tr.append(cell("si-kind", short));
      const subject = cell("si-subject");
      subject.append(bioguide && BIOGUIDE_RE.test(bioguide) ? link(memberHref(bioguide), name) : name);
      if (ticker) {
        subject.append(" ", link(pathSafeTicker(ticker) ? tickerHref(ticker) : genericEntityHref("t", ticker), ticker, "si-ticker"));
      }
      const gold = document.createElement("span");
      gold.className = "si-gold";
      gold.setAttribute("aria-hidden", "true");
      gold.textContent = " ◆";
      subject.append(gold);
      tr.append(subject);
      const evidence = cell("si-evidence", `${short} rule matched · `);
      evidence.append(link("#signal-rulebook", "rule book"));
      tr.append(evidence);
      tr.append(cell("c-num si-mag", magnitude(low, high)));
      tr.append(cell("c-filed si-when", `${traded ? traded.slice(5) : "—"} → ${filed.slice(5)}`));
      const fresh = isNew(filed);
      tr.append(cell(`c-num ${fresh ? "si-new" : "c-muted"}`, fresh ? "NEW" : state.kind === "none" ? "—" : "seen"));
      const rcpt = cell("c-src");
      const safe = safeReceiptHref(receipt);
      if (safe) {
        const a = link(safe, `${srcLabel(safe)} ↗`);
        a.rel = "noopener";
        a.target = "_blank";
        rcpt.append(a);
      } else rcpt.textContent = "—";
      tr.append(rcpt);
      body.append(tr);
    }
  };
  render();
  if (note) {
    const gap = state.kind === "gap"
      ? ` Your last-seen marker (${state.cursor.lastSeenFiled}) predates this window's start (${coverageFrom}) — "new" cannot be stated until you mark all seen.`
      : "";
    const summary = document.createElement("span");
    summary.textContent =
      `${fmtInt(hits.length)} ${hits.length === 1 ? "hit" : "hits"} on ${fmtInt(watchedMembers.size + watchedTickers.size)} watched ${watchedMembers.size + watchedTickers.size === 1 ? "subject" : "subjects"}` +
      (payload.total > payload.cap ? ` · joined against the newest ${fmtInt(payload.cap)} of ${fmtInt(payload.total)} hits` : "") +
      (hits.length > WATCH_RENDER_CAP ? ` · the newest ${fmtInt(WATCH_RENDER_CAP)} rendered here — a render bound, not a data bound; the hits table above carries the rest` : "") +
      `.${gap} `;
    note.prepend(summary);
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
