/* /signals client island. Two device-local enhancements over a page that is
   complete without them:

   1. the HITS family filter — a `.seg` over rows the server already rendered;
      filtering hides rows, it never fetches or re-renders;
   2. the WATCHLIST band — joins the embedded newest-hits payload against the
      watch-v2 store (members + tickers) and the last-seen cursor, all of which
      live in this browser only. Nothing leaves the device. */

import { fmtInt, fmtUsd, memberHref, tickerHref, pathSafeTicker, genericEntityHref, srcLabel, type RenderCtx } from "../lib/format.ts";
import { loadWatchStore } from "./entity-client.ts";
import { hitRowHtml, hitsRangeText, sortHits, SIGNAL_HITS_PAGE_SIZE } from "../lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../lib/signals.ts";
import { classifyCursor, readCursor, writeCursor, watchBandEmptyText, watchSeenLabel } from "../lib/watchlist.ts";

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

/* R17: a REAL pager over the complete artifact. The server rendered page 1;
   the first page change or filter fetches `signals.v1.json` once (it is
   complete for the window) and every later view renders from it through the
   SAME row renderer the server used. */
const ARTIFACT_HREF = "/signals/data/signals.v1.json";

function initHitPager(): void {
  const section = document.getElementById("signal-hits");
  const seg = document.querySelector<HTMLElement>(".si-hit-filter");
  const body = document.getElementById("signal-hits-body");
  const rangeEl = document.getElementById("signal-hits-range");
  const prev = document.getElementById("signal-hits-prev") as HTMLButtonElement | null;
  const next = document.getElementById("signal-hits-next") as HTMLButtonElement | null;
  const watchedChk = document.getElementById("signal-watched-only") as HTMLInputElement | null;
  const status = document.getElementById("signal-hits-status");
  if (!section || !seg || !body || !rangeEl) return;
  const pageSize = Number(section.dataset.pageSize) || SIGNAL_HITS_PAGE_SIZE;
  const store = loadWatchStore(localStorage);
  const ctx: RenderCtx = { watched: store.members, watchedTickers: store.tickers };
  let page = 0;
  let kind = "all";
  let watchedOnly = false;
  let all: Promise<Signal[]> | null = null;
  let token = 0;

  function loadAll(): Promise<Signal[]> {
    all ??= fetch(ARTIFACT_HREF)
      .then((r) => {
        if (!r.ok) throw new Error(`signals artifact ${r.status}`);
        return r.json() as Promise<SignalArtifact>;
      })
      .then((a) => sortHits((a.signals ?? []).filter((s) => s.status === "active")))
      .catch((err) => {
        all = null;
        throw err;
      });
    return all;
  }

  function matches(s: Signal): boolean {
    if (kind !== "all" && s.kind !== kind) return false;
    if (watchedOnly && !((s.entities.bioguide && store.members.has(s.entities.bioguide)) || (s.entities.ticker && store.tickers.has(s.entities.ticker)))) return false;
    return true;
  }

  function setPager(btn: HTMLButtonElement | null, unavailable: boolean): void {
    if (!btn) return;
    btn.setAttribute("aria-disabled", String(unavailable));
    btn.classList.toggle("is-unavailable", unavailable);
  }

  async function paint(): Promise<void> {
    const mine = ++token;
    let hits: Signal[];
    try {
      hits = await loadAll();
    } catch (err) {
      if (mine !== token) return;
      console.error("populus: signals artifact failed", err);
      if (status) status.textContent = "Couldn't load the signals artifact; the hits shown are unchanged.";
      return;
    }
    if (mine !== token) return;
    const filtered = hits.filter(matches);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > pageCount - 1) page = pageCount - 1;
    const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);
    body!.innerHTML =
      slice.length === 0
        ? `<tr><td colspan="6" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
        : slice.map((s) => hitRowHtml(s, ctx)).join("\n");
    const range = hitsRangeText(page, slice.length, filtered.length, pageSize);
    rangeEl!.textContent = range;
    if (status) status.textContent = `${range} hits${kind === "all" ? "" : ` · rule ${kind}`}${watchedOnly ? " · watched only" : ""}.`;
    setPager(prev, page === 0);
    setPager(next, page >= pageCount - 1);
  }

  seg.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-kind]");
    if (!btn) return;
    kind = btn.dataset.kind ?? "all";
    for (const b of seg.querySelectorAll<HTMLButtonElement>("button[data-kind]")) b.setAttribute("aria-pressed", String(b === btn));
    page = 0;
    void paint();
  });
  watchedChk?.addEventListener("change", () => {
    watchedOnly = watchedChk.checked;
    page = 0;
    void paint();
  });
  prev?.addEventListener("click", () => {
    if (prev.getAttribute("aria-disabled") === "true" || page === 0) return;
    page--;
    void paint();
  });
  next?.addEventListener("click", () => {
    if (next.getAttribute("aria-disabled") === "true") return;
    page++;
    void paint();
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
      td.textContent = watchBandEmptyText(0, payload.total, payload.cap);
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
      const seen = watchSeenLabel(state, filed);
      tr.append(cell(`c-num ${seen === "NEW" ? "si-new" : "c-muted"}`, seen));
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
      (hits.length > WATCH_RENDER_CAP ? ` · the newest ${fmtInt(WATCH_RENDER_CAP)} shown here; the hits table above carries the rest` : "") +
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
  initHitPager();
  initWatchBand();
}
