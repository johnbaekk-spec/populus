/* /signals client island. A device-local enhancement over a page that is
   complete without it:

   - the slim hits table's filters — the FAMILY, from the "Hit rate by family"
     rows, and listed stocks only (on by default, never persisted) — and
     "Show 10 more". The first filter fetches the artifact once and repaints
     through the server's own view and row renderer, so a repaint is the
     server's markup (signals-v3 M2, R13);
   - signals-v4 R6 (LD6): the column fit — the hits fill to the height of
     "Filings to read" (`column-fit.ts`), revealing the lines the page
     carries (launch M7a: the first ten in the DOM, the rest rendered from
     the JSON island on demand), and past them the memoised artifact;
   - signals-v4 R7 (LD7): the pane switch where the band stacks;
   - signals-v4 R4 (LD5): a lead card, or a hash naming a row, opens the row;
   - signals-v4 M2 (R9, R12, R14, LD8, LD11): the tabs (`tabs.ts`), the Named
     moves' chips, name filter and "Show 15 more" over the rows the page
     carries (launch M7a: fifteen in the DOM, the rest in the island, each
     rendered as the server's held row when a view needs it), the Consensus rows and lead cards that set the name filter, the
     Named moves' column fit, and `revealTarget` — the ONE sequence every
     in-page navigation runs (a hash, a card, a Consensus row).
   - signals-v4 M3 (R18, R19, R21, LD8, LD14, LD16): Overlap's relation
     control, Broad accounts toggle and "Show 12 more" over the names the
     server carries; the Playbooks list (one article at a time); the
     Playbooks filter over Filings to read; and every in-page link inside a
     tab — a strip, a row's "Playbook →", a "Triggers now" row, "See {TICKER}
     in Overlap →" — through `revealTarget`.

   Nothing is stored and nothing leaves the device. */

import { fmtInt, parseDataColumns, type RenderCtx } from "../lib/format.ts";
import { hitsBodyHtml, hitsRangeText, sortHits, SIGNAL_HITS_PAGE_SIZE, SIGNAL_HITS_COMPACT_ROWS, hitsView, hitsHiddenText, type HitFilter } from "../lib/ui/index.ts";
import { ctxOfCut, type HeldHits, type HitLine } from "../lib/ui/signals.ts";
import type { Signal, SignalArtifact } from "../lib/signals.ts";
import { NAMED_MOVES_MIN, NAMED_MOVES_STEP, namedMovesSliceKey } from "../lib/notable-moves.ts";
import { moveDetailHtml, moveRowFrom, namedMovesBoundText, namedMovesRangeText, overlapLinkFor, parseNamedMovesTotals, type HeldMoves, type MoveDetail, type MoveRowData } from "../lib/ui/signals-institutional.ts";
import { overlapBoundText, overlapRangeText } from "../lib/ui/signals-overlap.ts";
import { bindFit, type FitBinding, type FitElement, type FitTarget } from "./column-fit.ts";
import { initTabs, selectTabFor, type TabsEnv } from "./tabs.ts";
import { expandDomDisclosureFor } from "./inst-index-client.ts";

/** An empty row spans the table's own header — the column list the server
    rendered — never a literal count (DESIGN-POLISH M1, section E). */
function columnCount(body: HTMLElement | null, fallback: number): number {
  const n = body?.closest("table")?.querySelectorAll("thead th").length ?? 0;
  return n > 0 ? n : fallback;
}

/** launch M7a (D5, LD26/LD27): the JSON island a held list ships in —
    `<script type="application/json" data-held-for="{listId}">` — parsed
    once, or null (no island, or one that does not parse: the list then
    holds what the page rendered). Its rows render through the list's own
    row function; DOM text is never turned back into HTML. */
export function readHeld<T>(listId: string): T | null {
  const el = document.querySelector(`script[type="application/json"][data-held-for="${listId}"]`);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent ?? "") as T;
  } catch {
    return null;
  }
}

/** How many of a held island's rows are already in the DOM. Rows always
    render as the island's next contiguous run, so one count — kept on the
    island element itself — is the state every binder over the list shares
    (a second binder never renders a row twice). */
export function heldRendered(listId: string): number {
  const el = document.querySelector(`script[type="application/json"][data-held-for="${listId}"]`);
  return Number(el?.getAttribute("data-held-rendered") ?? 0) || 0;
}
function setHeldRendered(listId: string, n: number): void {
  document.querySelector(`script[type="application/json"][data-held-for="${listId}"]`)?.setAttribute("data-held-rendered", String(n));
}

/* R13: the server rendered the first lines; the first filter, or a fit or
   "Show more" past the rows the server holds, fetches `signals.v1.json` once
   (it is complete for the window) and every later view renders from it
   through the SAME row renderer the server used. */
const ARTIFACT_HREF = "/signals/data/signals.v1.json";

/** The rows a body holds for `shown` visible lines: the server's
    `SIGNAL_HITS_DOM_ROWS` (`domRows`), or the next multiple of it — so a fit
    that corrects by a row or two past a repaint needs no second repaint. */
export function hitsHeld(shown: number, lines: number, domRows: number): number {
  return Math.min(lines, Math.max(domRows, Math.ceil(shown / domRows) * domRows));
}

/** The view a filter state shows: the server's `hitsView`, the lines the body
    holds (the first `shown` visible, the rest `hidden`), the body markup and
    the range string. Exported so the parity test runs the client's own
    composition against the server's. */
export function hitsRepaint(
  hits: readonly Signal[],
  filter: HitFilter,
  shown: number,
  ctx: RenderCtx,
  columns: readonly string[] | null,
  domRows = 40,
): { body: string; range: string; hidden: number; lines: number; shown: number; held: number; hits: number } {
  const view = hitsView(hits, filter);
  const held = view.lines.slice(0, hitsHeld(shown, view.lines.length, domRows));
  const visible = Math.min(shown, held.length);
  return {
    body: held.length === 0 ? "" : hitsBodyHtml(held, ctx, columns, visible),
    range: hitsRangeText(0, visible, view.lines.length, view.hits, SIGNAL_HITS_PAGE_SIZE),
    hidden: view.hidden,
    lines: view.lines.length,
    shown: visible,
    held: held.length,
    hits: view.hits,
  };
}

/** The hits pager the fit drives: `setBase` is LD6's `apply`. */
export interface HitPager {
  /** set the fitted base: visible = min(lines, base + extra) */
  setBase(n: number): void | Promise<void>;
  /** the column fit's view of the list */
  fitTarget: FitTarget;
  /** called after a filter change repaints (the fit re-runs) */
  onFilter: (() => void) | null;
}

export function initHitPager(): HitPager | null {
  const section = document.getElementById("hits");
  const families = document.getElementById("families");
  const body = document.getElementById("signal-hits-body");
  const rangeEl = document.getElementById("signal-hits-range");
  const more = document.getElementById("signal-hits-more") as HTMLButtonElement | null;
  const stocksChk = document.getElementById("signal-stocks-only") as HTMLInputElement | null;
  const hiddenEl = document.getElementById("signal-hidden-count");
  const status = document.getElementById("signal-hits-status");
  const pillRow = document.getElementById("signal-family-pill-row");
  const pill = document.getElementById("signal-family-pill") as HTMLButtonElement | null;
  const pillName = document.getElementById("signal-family-pill-name");
  const paneN = document.getElementById("signal-pane-hits-n");
  if (!section || !body || !rangeEl) return null;
  const step = Number(section.dataset.step) || SIGNAL_HITS_PAGE_SIZE;
  const domRows = Number(section.dataset.domRows) || 40;
  const ctx: RenderCtx = {};
  /* LD6's contract: visible = min(lines, base + extra) */
  let base = Number(section.dataset.shown) || step;
  let extra = 0;
  let family = "all";
  /* R12: every load starts at the default — listed stocks only — whatever a
     browser restored into the box (plan L8: not persisted). */
  let stocksOnly = true;
  if (stocksChk) stocksChk.checked = true;
  /* the view the body holds rows for: the server's default view until the
     first repaint */
  let lines = Number(section.dataset.lines) || 0;
  let hitsN = Number(section.dataset.hits) || 0;
  let heldKey = "all|true";
  let all: Promise<Signal[]> | null = null;
  let token = 0;
  /* launch M7a (D5, LD27): the default view's lines past the first ten wait
     in the island and render, hidden, through the server's body renderer
     when a reveal needs them; a repaint from the artifact retires them */
  const island = readHeld<HeldHits>("signal-hits-body");
  function materializeLines(want: number): void {
    if (!island || heldKey !== "all|true") return;
    const from = heldRendered("signal-hits-body");
    /* one line past the reveal stays held, so the fit can measure the next line */
    const take: HitLine[] = island.lines.slice(from, from + Math.max(0, want + 1 - rows().length));
    if (take.length === 0) return;
    body!.insertAdjacentHTML("beforeend", "\n" + hitsBodyHtml(take, ctxOfCut(island.cut), island.columns, 0));
    setHeldRendered("signal-hits-body", from + take.length);
  }

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

  /* The ONE filter the server page used for its first lines (`hitsView` over
     `hitMatches`): family × listed stocks. */
  function filter(): HitFilter {
    return { family, stocksOnly };
  }
  const key = (): string => `${family}|${stocksOnly}`;
  const rows = (): HTMLElement[] => Array.from(body!.querySelectorAll<HTMLElement>("tr.si-hit"));
  const visibleNow = (): number => rows().filter((r) => !r.hidden).length;

  function setMore(unavailable: boolean): void {
    if (!more) return;
    more.setAttribute("aria-disabled", String(unavailable));
    more.classList.toggle("is-unavailable", unavailable);
  }

  function setFamily(next: string): void {
    family = next;
    for (const b of families?.querySelectorAll<HTMLButtonElement>("button[data-family]") ?? []) {
      b.setAttribute("aria-pressed", String(b.dataset.family === family));
    }
    if (pillRow) pillRow.hidden = family === "all";
    if (pillName) {
      const label = families?.querySelector<HTMLElement>(`button[data-family="${family}"] .si-family-name`)?.textContent ?? family;
      pillName.textContent = label;
    }
  }

  function announce(range: string, hiddenText: string): void {
    if (status) status.textContent = `${range}${family === "all" ? "" : ` · family ${family.toLowerCase()}`} · ${stocksOnly ? "listed stocks only" : "all asset types"} · ${hiddenText}.`;
  }

  /** Show the first `want` held rows, hide the rest — no fetch, no repaint. */
  function reveal(want: number): void {
    const rs = rows();
    rs.forEach((r, i) => {
      r.hidden = i >= want;
    });
    const shown = Math.min(want, rs.length);
    section!.setAttribute("data-shown", String(shown));
    rangeEl!.textContent = hitsRangeText(0, shown, lines, hitsN, step);
    setMore(shown >= lines);
  }

  async function paint(say: boolean): Promise<void> {
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
    const v = hitsRepaint(hits, filter(), base + extra, ctx, parseDataColumns(body!.closest("table")?.getAttribute("data-columns")), domRows);
    /* a repaint renders from the artifact: the island's lines are retired */
    if (island) setHeldRendered("signal-hits-body", island.lines.length);
    body!.innerHTML =
      v.held === 0
        ? `<tr><td colspan="${columnCount(body, 6)}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
        : v.body;
    lines = v.lines;
    hitsN = v.hits;
    heldKey = key();
    section!.setAttribute("data-shown", String(v.shown));
    section!.setAttribute("data-lines", String(v.lines));
    section!.setAttribute("data-hits", String(v.hits));
    document.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "hits" } }));
    rangeEl!.textContent = v.range;
    const hiddenText = hitsHiddenText(v.hidden, stocksOnly);
    if (hiddenEl) {
      hiddenEl.textContent = hiddenText;
      hiddenEl.setAttribute("data-hidden", String(v.hidden));
    }
    if (paneN) paneN.textContent = fmtInt(v.hits);
    if (say) announce(v.range, hiddenText);
    setMore(v.shown >= v.lines);
  }

  /** Render the current state: reveal held rows when the body holds enough
      of the current view, else repaint from the artifact. */
  function render(say: boolean): void | Promise<void> {
    const want = Math.min(lines, base + extra);
    if (heldKey === key()) materializeLines(want);
    if (heldKey === key() && want <= rows().length) {
      reveal(want);
      if (say) announce(rangeEl!.textContent ?? "", hiddenEl?.textContent ?? "");
      return;
    }
    return paint(say);
  }

  const pager: HitPager = {
    setBase(n: number) {
      base = n;
      return render(false);
    },
    fitTarget: {
      list: () => body!.closest("table") as unknown as FitElement | null,
      rows: () => rows() as unknown as FitElement[],
      matching: () => lines,
      visible: visibleNow,
      extra: () => extra,
      apply: (n: number) => pager.setBase(n),
    },
    onFilter: null,
  };

  /** A filter change drops the "Show more" extension (LD6), repaints, and
      lets the fit re-run for the new view. */
  async function refilter(): Promise<void> {
    extra = 0;
    await paint(true);
    pager.onFilter?.();
  }

  families?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-family]");
    if (!btn) return;
    // a pressed family toggles off; another one replaces it
    setFamily(btn.dataset.family === family ? "all" : (btn.dataset.family ?? "all"));
    void refilter();
  });
  pill?.addEventListener("click", () => {
    setFamily("all");
    void refilter();
  });
  stocksChk?.addEventListener("change", () => {
    stocksOnly = stocksChk.checked;
    void refilter();
  });
  more?.addEventListener("click", () => {
    if (more.getAttribute("aria-disabled") === "true") return;
    /* LD6: "Show more" extends PAST the fitted base, deliberately */
    extra += step;
    void render(true);
  });
  return pager;
}

/* ---------------------------------------------------------------- LD7: the pane switch */

/** Where a two-column band stacks. */
export const STACKED_QUERY = "(max-width: 1080px)";

interface BoundSwitch {
  panes: (HTMLElement | null)[];
  select(i: number): void;
}
const switches: BoundSwitch[] = [];

/** LD7: the server renders each `[data-pane-switch]` `hidden` and every pane
    visible. While `(max-width: 1080px)` matches, the switch shows and the
    unselected panes carry `hidden`; when it stops matching, the switch hides
    and every pane shows again. Only the `hidden` attribute moves — no media
    rule hides a pane. */
export function initPaneSwitches(): void {
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(STACKED_QUERY) : null;
  for (const sw of Array.from(document.querySelectorAll<HTMLElement>("[data-pane-switch]"))) {
    if (sw.hasAttribute("data-pane-bound")) continue;
    sw.setAttribute("data-pane-bound", "");
    const buttons = Array.from(sw.querySelectorAll<HTMLButtonElement>("button[aria-controls]"));
    const panes = buttons.map((b) => document.getElementById(b.getAttribute("aria-controls") ?? ""));
    let selected = Math.max(0, buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true"));
    const sync = (): void => {
      const stacked = !!mq?.matches;
      sw.hidden = !stacked;
      panes.forEach((p, i) => {
        if (p) p.hidden = stacked && i !== selected;
      });
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === selected)));
    };
    const bound: BoundSwitch = {
      panes,
      select(i: number): void {
        selected = i;
        sync();
      },
    };
    buttons.forEach((b, i) => b.addEventListener("click", () => bound.select(i)));
    mq?.addEventListener?.("change", sync);
    switches.push(bound);
    sync();
  }
}

/** Select the pane that holds `el`, when a pane switch has hidden it (step 2
    of M2's `revealTarget`). Returns whether it changed anything. */
export function selectPaneFor(el: Element): boolean {
  for (const s of switches) {
    /* a switch whose panes left the document (a re-render) is skipped */
    if (s.panes.some((p) => p !== null && document.getElementById(p.id) !== p)) continue;
    const i = s.panes.findIndex((p) => p !== null && p.id !== "" && el.closest(`#${p.id}`) !== null);
    if (i >= 0 && s.panes[i]!.hidden) {
      s.select(i);
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------- LD11: the Named moves */

/** The Named moves the fit and `revealTarget` drive. */
export interface MovesPager {
  /** the column fit's view of the list (LD6) */
  fitTarget: FitTarget;
  /** apply a name filter (a Consensus row, a lead card) — it clears the
      kind and type chips, which then refine within the name — or clear it */
  setName(key: string | null): void;
  /** make a held move row visible: clear the filter that hides it (or set
      the name filter to `name`), then extend the page until it shows */
  reveal(item: Element, name?: string | null): void;
  /** LD10: copy the bank's Congress lines into the sides under `root` (an
      opened row, a shown name detail) — each (ticker, side) is rendered once */
  fill(root: Element): void;
  /** the active filter */
  state(): { kind: string | null; type: string | null; name: string | null; base: number; extra: number };
  /** called after a filter change (the fit re-runs) */
  onFilter: (() => void) | null;
  /** called after an in-column height change the fit's observer cannot see
      — a move row or the Congress-lines bank opening or closing, a held
      row's body and its Congress lines inserted — once per `toggle` (the fit
      re-runs, keeping the "Show more" extension and every open row) */
  onLayout: (() => void) | null;
  /** launch M7a: render the island's rows up to and including `id` (a hash
      naming a held row) and return it — the row itself when it is already
      in the DOM — or null when no carried row has it */
  materialize(id: string): Element | null;
}

export function initNamedMoves(): MovesPager | null {
  const section = document.getElementById("named-moves");
  const list = document.getElementById("mv-list");
  if (!section || !list) return null;
  const rangeEl = document.getElementById("mv-range");
  const more = document.getElementById("mv-more");
  const bound = document.getElementById("mv-bound");
  const empty = document.getElementById("mv-empty");
  const status = document.getElementById("mv-status");
  const pillRow = document.getElementById("mv-name-row");
  const pill = document.getElementById("mv-name-pill");
  const pillLabel = document.getElementById("mv-name-label");
  const totals = parseNamedMovesTotals(section.getAttribute("data-mv-totals"));
  const step = Number(section.getAttribute("data-mv-step")) || NAMED_MOVES_STEP;
  const min = Number(section.getAttribute("data-mv-min")) || NAMED_MOVES_MIN;
  /* LD6's contract: visible = min(matching, base + extra) */
  let base = min;
  let extra = 0;
  let kind: string | null = null;
  let type: string | null = null;
  let name: string | null = null;

  const items = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>("article.mv-item"));
  const matchesNow = (el: Element): boolean =>
    (kind === null || el.getAttribute("data-kind") === kind) &&
    (type === null || el.getAttribute("data-type") === type) &&
    (name === null || el.getAttribute("data-ikey") === name);
  const matching = (): HTMLElement[] => items().filter(matchesNow);
  /* launch M7a (D5, LD27): the rows past the first fifteen wait in the
     island, in the page's order; they render — as the server's held rows,
     through `moveRowFrom` — when a view needs them, always as the next
     contiguous run, so the DOM stays in the page's order */
  const held = readHeld<HeldMoves>("mv-list");
  /** the island's rows not yet in the DOM, in the page's order */
  const pending = (): MoveRowData[] => (held ? held.rows.slice(heldRendered("mv-list")) : []);
  const pendingMatches = (r: MoveRowData): boolean => (kind === null || r.kind === kind) && (type === null || r.type === type) && (name === null || r.ikey === name);
  function materializeRun(n: number): void {
    const from = heldRendered("mv-list");
    const take = held ? held.rows.slice(from, from + n) : [];
    if (take.length === 0 || !held) return;
    list!.insertAdjacentHTML("beforeend", "\n" + take.map((r) => moveRowFrom(r, held.sec, true, held.tv)).join("\n"));
    setHeldRendered("mv-list", from + take.length);
  }
  /** Render island rows until the DOM holds `want` rows matching the view —
      and one more, held, so the column fit (and its geometry check) can
      measure the next row — or the island is spent. */
  function ensure(want: number): void {
    const rest = pending();
    let need = want + 1 - matching().length;
    let upTo = 0;
    for (; upTo < rest.length && need > 0; upTo++) if (pendingMatches(rest[upTo]!)) need--;
    materializeRun(upTo);
  }
  /** Every carried row matching the view: the DOM's and the island's. */
  const matchingCount = (): number => matching().length + pending().filter(pendingMatches).length;
  /** The TRUE in-build total for the filter: the slice total for the chips;
      for a name filter the page's own count, which is complete for that key. */
  const total = (): number => (name !== null ? matchingCount() : Number(totals[namedMovesSliceKey(kind, type)] ?? 0));
  const bank = document.getElementById("mv-bank");
  /** LD11: a held row's opened body, from the row's own data and its
      section's — the server's renderer, so the two cannot differ */
  const detailOf = (row: Element): MoveDetail => {
    const tk = row.querySelector(".mv-tk .mono-ticker")?.textContent?.trim() || null;
    const filed = row.querySelector(".mv-fil time")?.textContent?.trim() || null;
    return {
      type: row.getAttribute("data-type") ?? "",
      kind: (row.getAttribute("data-kind") ?? "new") as MoveDetail["kind"],
      filed,
      period: section!.getAttribute("data-mv-period") || "—",
      quarter: section!.getAttribute("data-mv-q"),
      ticker: tk,
      verified: row.hasAttribute("data-tv") ? row.getAttribute("data-tv") || null : section!.getAttribute("data-mv-tv"),
      filerPage: row.getAttribute("data-fp") ?? "",
      congress: Number(row.getAttribute("data-cg")) || 0,
      /* M3 (R21, D8): the name's Overlap row, where the page carries it — the
         server's one predicate, never gated on the side's Congress count */
      overlap: section!.hasAttribute("data-mv-ov") ? overlapLinkFor(tk, (id) => document.getElementById(id)?.classList.contains("ov-item") === true) : null,
    };
  };
  /** LD10: an opened row's (or a shown name's) Congress side lists its lines:
      the bank's block for that (ticker, side), copied in once — after a held
      row's body is rendered (LD11) */
  function fill(root: Element): void {
    for (const det of Array.from(root.querySelectorAll<HTMLElement>(".mv-det"))) {
      const row = det.closest("article.mv-item");
      if (row && row.hasAttribute("data-fp") && det.innerHTML === "") det.innerHTML = moveDetailHtml(detailOf(row));
    }
    for (const ref of Array.from(root.querySelectorAll<HTMLElement>(".mv-cong[data-cong]"))) {
      if (ref.hasAttribute("data-cong-filled") || ref.closest("#mv-bank")) continue;
      const block = bank?.querySelector<HTMLElement>(`[data-cong="${ref.getAttribute("data-cong") ?? ""}"]`) ?? null;
      if (!block) continue;
      ref.innerHTML = block.innerHTML;
      ref.setAttribute("data-cong-filled", "");
    }
  }
  /** the name the filter shows, read off the first row that carries it */
  const labelOf = (key: string): string => {
    const row = items().find((el) => el.getAttribute("data-ikey") === key);
    return (row?.querySelector(".mv-tk")?.textContent ?? key).replace(/\s+/g, " ").trim();
  };

  function render(say = false): void {
    const want = base + extra;
    ensure(want);
    let shown = 0;
    let m = 0;
    for (const el of items()) {
      const on = matchesNow(el);
      if (on) m++;
      const show = on && shown < want;
      el.hidden = !show;
      if (show) shown++;
    }
    /* the matching rows still waiting in the island are carried too */
    m += pending().filter(pendingMatches).length;
    const t = total();
    const range = namedMovesRangeText(shown, t);
    if (rangeEl) rangeEl.textContent = range;
    if (more) {
      const unavailable = shown >= m;
      more.setAttribute("aria-disabled", String(unavailable));
      more.classList.toggle("is-unavailable", unavailable);
    }
    /* the page's own bound, where the DOM runs out before the total (LD11) */
    const cut = shown === m && m < t;
    if (bound) {
      bound.hidden = !cut;
      bound.textContent = namedMovesBoundText(m);
    }
    if (empty) empty.hidden = m > 0;
    section!.setAttribute("data-mv-shown", String(shown));
    for (const b of Array.from(section!.querySelectorAll<HTMLElement>("button[data-mv-kind]"))) b.setAttribute("aria-pressed", String(b.getAttribute("data-mv-kind") === kind));
    for (const b of Array.from(section!.querySelectorAll<HTMLElement>("button[data-mv-type]"))) b.setAttribute("aria-pressed", String(b.getAttribute("data-mv-type") === type));
    if (pillRow) pillRow.hidden = name === null;
    if (pillLabel) pillLabel.textContent = name === null ? "" : labelOf(name);
    /* the name's Congress detail (LD10), and the Consensus row it came from */
    for (const d of Array.from(section!.querySelectorAll<HTMLElement>("[data-mv-detail-for]"))) {
      d.hidden = d.getAttribute("data-mv-detail-for") !== name;
      if (!d.hidden) fill(d);
    }
    for (const b of Array.from(document.querySelectorAll<HTMLElement>("button.cs-pick"))) b.setAttribute("aria-pressed", String(name !== null && b.getAttribute("data-mv-name") === name));
    if (say && status) status.textContent = `${range}${name !== null ? ` · ${labelOf(name)}` : ""}${kind !== null ? ` · ${kind}` : ""}${type !== null ? ` · ${type.replace(/_/g, " ")}` : ""}.`;
  }

  const pager: MovesPager = {
    fitTarget: {
      list: () => list as unknown as FitElement,
      rows: () => matching() as unknown as FitElement[],
      matching: matchingCount,
      visible: () => items().filter((el) => !el.hidden).length,
      extra: () => extra,
      apply: (n: number) => {
        base = n;
        render(false);
      },
      /* LD6 + codex M2 round 2, F1: a refit never hides an OPEN row — the
         base stays at least the last open matching row's place + 1, less the
         extension (visible = base + extra) */
      floor: () => {
        let last = -1;
        matching().forEach((el, i) => {
          if (el.querySelector("details.mv-row")?.hasAttribute("open")) last = i;
        });
        return Math.max(0, last + 1 - extra);
      },
    },
    setName(key: string | null): void {
      name = key;
      kind = null;
      type = null;
      extra = 0;
      render(true);
      pager.onFilter?.();
    },
    reveal(item: Element, nameKey?: string | null): void {
      if (!matchesNow(item)) {
        kind = null;
        type = null;
        name = nameKey ?? null;
        if (!matchesNow(item)) name = null;
        extra = 0;
      }
      const at = matching().indexOf(item as HTMLElement);
      if (at >= base + extra) extra = at + 1 - base;
      render(true);
      pager.onFilter?.();
    },
    fill,
    state: () => ({ kind, type, name, base, extra }),
    onFilter: null,
    onLayout: null,
    materialize(id: string): Element | null {
      const here = list!.querySelector(`#${id}`);
      if (here) return here;
      const at = pending().findIndex((r) => r.id === id);
      if (at < 0) return null;
      materializeRun(at + 1);
      return document.getElementById(id);
    },
  };
  /* a `<details>` in the column opened or closed by the reader — a move row
     (opened: a held row's body is rendered and its side's Congress lines
     copied in) or the Congress-lines bank: the column's height changed, and
     the fit observes only the side column, so it is asked to re-run, ONCE per
     toggle (codex M2 round 2, F1). `toggle` does not bubble, so the section
     listens in the capture phase; a tip's popover also fires `toggle`, but it
     is in the top layer and changes no height, so only `<details>` count. */
  section.addEventListener(
    "toggle",
    (ev) => {
      const d = ev?.target as HTMLElement | undefined;
      if (String(d?.tagName ?? "").toUpperCase() !== "DETAILS") return;
      if (d!.classList?.contains("mv-row") && d!.hasAttribute("open")) fill(d!);
      pager.onLayout?.();
    },
    true,
  );

  /** A filter change drops the "Show more" extension (LD6) and lets the fit
      re-run for the new view. */
  const refilter = (): void => {
    extra = 0;
    render(true);
    pager.onFilter?.();
  };
  section.addEventListener("click", (ev) => {
    const btn = (ev?.target as HTMLElement | undefined)?.closest?.("button[data-mv-kind], button[data-mv-type]") as HTMLElement | null | undefined;
    if (!btn) return;
    const k = btn.getAttribute("data-mv-kind");
    const t = btn.getAttribute("data-mv-type");
    /* single-select per group; a pressed chip toggles off */
    if (k !== null) kind = kind === k ? null : k;
    if (t !== null) type = type === t ? null : t;
    refilter();
  });
  pill?.addEventListener("click", () => {
    name = null;
    refilter();
  });
  more?.addEventListener("click", () => {
    if (more.getAttribute("aria-disabled") === "true") return;
    /* LD6: "Show more" extends PAST the fitted base, deliberately */
    extra += step;
    render(true);
  });
  render(false);
  return pager;
}

/* ---------------------------------------------------------------- M3, LD14: Overlap */

/** The Overlap tab's client state, which `revealTarget` drives. */
export interface OverlapPager {
  /** make a carried name visible: the variant that has it (Broad accounts on
      when only that one does), All when the relation excludes it — or its
      own relation, where All's carried run does not reach it — then extend
      the page until it shows */
  reveal(item: Element): void;
  state(): { variant: "core" | "all"; rel: "all" | "same" | "opposite"; extra: number; shown: number };
}

type OvRel = "all" | "same" | "opposite";

export function initOverlap(): OverlapPager | null {
  const section = document.getElementById("ov-section");
  const list = document.getElementById("ov-list");
  if (!section || !list) return null;
  const rangeEl = document.getElementById("ov-range");
  const more = document.getElementById("ov-more");
  const bound = document.getElementById("ov-bound");
  const empty = document.getElementById("ov-empty");
  const status = document.getElementById("ov-status");
  const broadBtn = document.getElementById("ov-broad");
  const step = Number(section.getAttribute("data-ov-step")) || 12;
  /* each variant's true totals, "core all" (the server's) */
  const pair = (name: string): [number, number] => {
    const [a, b] = String(section.getAttribute(name) ?? "0 0").split(/\s+/).map(Number);
    return [a || 0, b || 0];
  };
  const totals = { all: pair("data-ov-n"), same: pair("data-ov-same"), opposite: pair("data-ov-opp") };
  let variant: 0 | 1 = 0;
  let rel: OvRel = "all";
  let extra = 0;
  let shownNow = 0;
  const items = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>("article.ov-item"));
  const ordOf = (el: Element, v: 0 | 1): number | null => {
    const raw = el.getAttribute(v === 0 ? "data-oc" : "data-oa");
    return raw === null || raw === "" ? null : Number(raw);
  };
  const relOf = (el: Element, v: 0 | 1): string | null => el.getAttribute(v === 0 ? "data-core" : "data-all") || null;
  /** The active view: its carried names in the variant's order, the length of
      the run the page carries from the view's first name (a view is a
      contiguous run of the variant's order: same, then opposite, then mixed),
      and its true total. */
  function view(): { inView: HTMLElement[]; run: number; total: number } {
    const n = totals.all[variant];
    const sm = totals.same[variant];
    const op = totals.opposite[variant];
    const start = rel === "opposite" ? sm : 0;
    const total = rel === "all" ? n : rel === "same" ? sm : op;
    const inView = items()
      .filter((el) => {
        const r = relOf(el, variant);
        return r !== null && (rel === "all" || r === rel);
      })
      .sort((a, b) => ordOf(a, variant)! - ordOf(b, variant)!);
    let run = 0;
    for (const el of inView) {
      if (ordOf(el, variant) === start + run) run++;
      else break;
    }
    return { inView, run, total };
  }
  function render(say = false): void {
    const { inView, run, total } = view();
    const want = Math.min(run, step + extra);
    shownNow = want;
    /* the list in the variant's order (the other variant's names after) */
    const all = items();
    const sorted = [...all].sort((a, b) => (ordOf(a, variant) ?? Infinity) - (ordOf(b, variant) ?? Infinity) || all.indexOf(a) - all.indexOf(b));
    if (sorted.some((el, i) => el !== all[i])) (list as unknown as { append(...n: Element[]): void }).append(...sorted);
    const shown = new Set(inView.slice(0, want));
    for (const el of all) el.hidden = !shown.has(el);
    const v = variant === 0 ? "core" : "all";
    for (const sp of Array.from(section!.querySelectorAll<HTMLElement>("[data-v]"))) sp.hidden = sp.getAttribute("data-v") !== v;
    for (const b of Array.from(section!.querySelectorAll<HTMLElement>("button[data-ov-rel]"))) b.setAttribute("aria-pressed", String(b.getAttribute("data-ov-rel") === rel));
    broadBtn?.setAttribute("aria-pressed", String(variant === 1));
    const range = overlapRangeText(want, total);
    if (rangeEl) rangeEl.textContent = range;
    if (more) {
      const unavailable = want >= run;
      more.setAttribute("aria-disabled", String(unavailable));
      more.classList.toggle("is-unavailable", unavailable);
    }
    if (bound) {
      bound.hidden = !(want === run && run < total);
      bound.textContent = overlapBoundText(run);
    }
    if (empty) empty.hidden = total > 0;
    section!.setAttribute("data-ov-shown", String(want));
    if (say && status) status.textContent = `${range} · ${rel === "all" ? "all relations" : rel === "same" ? "same side" : "opposite"} · broad accounts ${variant === 1 ? "counted" : "not counted"}.`;
  }
  /** the name's place in the active view's carried run, or -1 */
  const reach = (item: Element): number => {
    const { inView, run } = view();
    const at = inView.indexOf(item as HTMLElement);
    return at >= 0 && at < run ? at : -1;
  };
  section.addEventListener("click", (ev) => {
    const btn = (ev?.target as HTMLElement | undefined)?.closest?.("button[data-ov-rel], #ov-broad, #ov-more") as HTMLElement | null | undefined;
    if (!btn) return;
    if (btn.id === "ov-more") {
      if (btn.getAttribute("aria-disabled") === "true") return;
      extra += step;
      render(true);
      return;
    }
    if (btn.id === "ov-broad") variant = variant === 0 ? 1 : 0;
    else rel = (btn.getAttribute("data-ov-rel") as OvRel | null) ?? "all";
    extra = 0;
    render(true);
  });
  render(false);
  return {
    reveal(item: Element): void {
      if (reach(item) < 0) {
        rel = "all";
        extra = 0;
      }
      if (reach(item) < 0) rel = (relOf(item, variant) as OvRel | null) === "same" || relOf(item, variant) === "opposite" ? (relOf(item, variant) as OvRel) : "all";
      if (reach(item) < 0 && relOf(item, variant === 0 ? 1 : 0) !== null) {
        variant = variant === 0 ? 1 : 0;
        rel = "all";
        if (reach(item) < 0) rel = relOf(item, variant) === "same" || relOf(item, variant) === "opposite" ? (relOf(item, variant) as OvRel) : "all";
      }
      const at = reach(item);
      if (at >= step + extra) extra = at + 1 - step;
      render(true);
    },
    state: () => ({ variant: variant === 0 ? "core" : "all", rel, extra, shown: shownNow }),
  };
}

/* ---------------------------------------------------------------- M3, R19: the Playbooks list */

export interface PlaybookList {
  /** show the playbook `id` (its article) and mark its link current */
  select(id: string): boolean;
  selected(): string | null;
}

export function initPlaybooks(): PlaybookList | null {
  const section = document.getElementById("pb-section");
  if (!section) return null;
  const links = Array.from(section.querySelectorAll<HTMLElement>("a[data-pb-pick]"));
  const arts = Array.from(section.querySelectorAll<HTMLElement>("article.pb-main"));
  if (arts.length === 0) return null;
  let current: string | null = null;
  const api: PlaybookList = {
    select(id: string): boolean {
      if (!arts.some((a) => a.id === `pb-${id}`)) return false;
      current = id;
      for (const a of arts) a.hidden = a.id !== `pb-${id}`;
      for (const l of links) {
        if (l.getAttribute("data-pb-pick") === id) l.setAttribute("aria-current", "true");
        else l.removeAttribute("aria-current");
      }
      return true;
    },
    selected: () => current,
  };
  /* with script one article shows; the first until a link, a hash or a
     strip names another */
  api.select(arts[0]!.id.slice(3));
  return api;
}

/* ---------------------------------------------------------------- M3, R21: the Playbooks filter */

export interface PlaybookFilter {
  set(id: string | null): void;
  active(): string | null;
}

export function initPlaybookFilter(): PlaybookFilter | null {
  const triage = document.getElementById("triage");
  if (!triage) return null;
  const chips = Array.from(triage.querySelectorAll<HTMLElement>("button[data-pb-filter]"));
  if (chips.length === 0) return null;
  const status = document.getElementById("si-pb-status");
  let active: string | null = null;
  const nameOf = (id: string): string => (chips.find((c) => c.getAttribute("data-pb-filter") === id)?.textContent ?? id).replace(/\s+\d[\d,]*$/, "").trim();
  function apply(): void {
    let n = 0;
    for (const tier of Array.from(triage!.querySelectorAll<HTMLElement>(".si-tier"))) {
      let m = 0;
      for (const r of Array.from(tier.querySelectorAll<HTMLElement>("article.si-row"))) {
        const on = active === null || (r.getAttribute("data-pb") ?? "").split(" ").includes(active);
        r.hidden = !on;
        if (on) m++;
      }
      n += m;
      const none = tier.querySelector<HTMLElement>(".si-pb-none");
      if (none) none.hidden = active === null || m > 0;
      /* a match in closed Routine opens it */
      if (active !== null && m > 0 && tier.tagName.toUpperCase() === "DETAILS" && !tier.hasAttribute("open")) tier.setAttribute("open", "");
    }
    for (const c of chips) c.setAttribute("aria-pressed", String(c.getAttribute("data-pb-filter") === active));
    if (status) {
      status.hidden = active === null;
      status.textContent = active === null ? "" : `${fmtInt(n)} ${n === 1 ? "row triggers" : "rows trigger"} ${nameOf(active)}. Choose it again to show every row.`;
    }
  }
  const api: PlaybookFilter = {
    set(id: string | null): void {
      active = id;
      apply();
    },
    active: () => active,
  };
  for (const c of chips) {
    c.addEventListener("click", () => {
      if (c.getAttribute("aria-disabled") === "true") return;
      const id = c.getAttribute("data-pb-filter");
      api.set(id === active ? null : id);
    });
  }
  return api;
}

/* ---------------------------------------------------------------- LD8: the one reveal sequence */

let moves: MovesPager | null = null;
let overlap: OverlapPager | null = null;
let playbookList: PlaybookList | null = null;
let pbFilter: PlaybookFilter | null = null;

/** The Named moves `initSignalsPage` bound (null before, or with no moves):
    the fit's and `revealTarget`'s pager, read by the tests that drive the
    page's own wiring. */
export function boundNamedMoves(): MovesPager | null {
  return moves;
}

/** LD8 "Target reveal": the ONE sequence every in-page navigation runs — a
    hash on load or a `hashchange`, a Congress card, an Institutional card or
    Consensus row (with `opts.name`). In order: select the tab whose panel
    holds `el`; select the pane a pane switch has hidden it in; expand the
    DOM-backed disclosure that holds it back (a Consensus row past ten,
    through the "Show all" button's own state change, so the control stays
    in step — codex M2 round 2, F4); open every closed `<details>` around it
    (Routine around a triage row, the Congress-lines bank around a side's
    lines); clear (or set, with `opts.name`) the filter that hides a Named
    move and extend the page until it shows; apply a name filter; open the
    row's own `<details>`; scroll it into view and focus its summary or
    heading. Returns `el`, or null. */
export function revealTarget(el: Element | null, opts: { name?: string | null } = {}): Element | null {
  if (!el) return null;
  selectTabFor(el);
  selectPaneFor(el);
  expandDomDisclosureFor(el);
  /* M3 (LD8 step 3): a playbook's article, or something in it, is selected in the list */
  const art = el.closest<HTMLElement>("article.pb-main");
  if (art && playbookList) playbookList.select(art.id.replace(/^pb-/, ""));
  for (let d = el.parentElement?.closest<HTMLElement>("details") ?? null; d; d = d.parentElement?.closest<HTMLElement>("details") ?? null) {
    if (!d.hasAttribute("open")) d.setAttribute("open", "");
  }
  const row = el.closest<HTMLElement>("article.si-row");
  const mv = el.closest<HTMLElement>("article.mv-item");
  const ov = el.closest<HTMLElement>("article.ov-item");
  /* M3 (LD8 step 4): a triage row the Playbooks filter hides — clear it */
  if (row && row.hidden && pbFilter && pbFilter.active() !== null) pbFilter.set(null);
  if (ov && overlap) overlap.reveal(ov);
  if (moves) {
    if (mv) moves.reveal(mv, opts.name);
    else if (opts.name !== undefined) moves.setName(opts.name);
  }
  const details = (row ?? mv ?? ov)?.querySelector<HTMLElement>("details") ?? null;
  if (details && !details.hasAttribute("open")) details.setAttribute("open", "");
  if (mv && details && moves) moves.fill(details);
  /* a Consensus row is scrolled to whole, as a move row is */
  const cs = row || mv || ov ? null : el.closest<HTMLElement>(".cs-row");
  const target = (row ?? mv ?? ov ?? cs ?? el) as HTMLElement & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void };
  target.scrollIntoView?.({ block: row || mv || ov || cs ? "center" : "start" });
  const focusEl = (details?.querySelector<HTMLElement>("summary") ?? (row || mv || ov ? null : el.querySelector<HTMLElement>("h2, h3"))) as
    | (HTMLElement & { focus?: (o?: FocusOptions) => void })
    | null;
  if (focusEl) {
    if (focusEl.tagName !== "SUMMARY" && focusEl.tagName !== "summary" && !focusEl.hasAttribute("tabindex")) focusEl.setAttribute("tabindex", "-1");
    focusEl.focus?.({ preventScroll: true });
  }
  return el;
}

/** The id a hash names: decoded, or verbatim when it carries a malformed
    percent-escape (the decode never throws into page init or a
    `hashchange` — the same rule as `tabs.ts`'s `hashId`). */
export function hashTargetId(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A hash on load or a `hashchange`: the element it names runs the reveal
    sequence (a row opens, a hidden pane is selected, a held move shows). */
export function revealHash(hash: string): Element | null {
  const id = hashTargetId(hash);
  /* launch M7a: a held move row is rendered from its island first */
  return id ? revealTarget(document.getElementById(id) ?? moves?.materialize(id) ?? null) : null;
}

export function initRowLinks(): void {
  /* a Congress card's stretched link: open the row in place, keeping the
     hash a real history entry (a second click on the same card still opens
     it). An Institutional card's link carries `data-mv-name`: it filters the
     Named moves to its name. */
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a.si-card-open"))) {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href") ?? "";
      const nameKey = a.getAttribute("data-mv-name");
      if (nameKey !== null) {
        if (!moves) return;
        (ev as Event | undefined)?.preventDefault?.();
        revealTarget(document.getElementById("named-moves"), { name: nameKey });
        return;
      }
      const id = hashTargetId(href);
      const row = id.startsWith("si-row-") ? document.getElementById(id) : null;
      if (!row) return;
      (ev as Event | undefined)?.preventDefault?.();
      if (typeof location !== "undefined" && location.hash !== href && typeof history !== "undefined") history.pushState(null, "", href);
      revealTarget(row);
    });
  }
  /* LD12 / R14: a Consensus row filters the Named moves to its issuer key;
     pressed again, it clears the filter */
  for (const b of Array.from(document.querySelectorAll<HTMLElement>("button.cs-pick[data-mv-name]"))) {
    b.addEventListener("click", () => {
      const key = b.getAttribute("data-mv-name");
      if (!moves || key === null) return;
      if (b.getAttribute("aria-pressed") === "true") moves.setName(null);
      else revealTarget(document.getElementById("named-moves"), { name: key });
    });
  }
  if (typeof window === "undefined") return;
  window.addEventListener("hashchange", () => void revealHash(location.hash));
  if (typeof location !== "undefined" && location.hash) revealHash(location.hash);
}

/** signals-v4 M3 (LD8): every in-page link inside a tab — a playbook strip, a
    row's "Playbook →", a "Triggers now" row, "All {n} in Filings to read",
    "See {TICKER} in Overlap →", a list link, a panel link — runs
    `revealTarget` on what it names, keeping the hash a real history entry
    (a second click on the same link still reveals it). A card's own link
    (`a.si-card-open`) keeps its binder; a tab is `tabs.ts`'s. */
export function initInPageLinks(): void {
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'))) {
    panel.addEventListener("click", (ev) => {
      const a = (ev?.target as HTMLElement | undefined)?.closest?.("a") as HTMLAnchorElement | null | undefined;
      if (!a || a.classList.contains("si-card-open")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("#") || href.length < 2) return;
      const target = document.getElementById(hashTargetId(href));
      if (!target || !target.closest('[role="tabpanel"]')) return;
      (ev as Event | undefined)?.preventDefault?.();
      const filter = a.getAttribute("data-pb-filter");
      if (filter !== null && pbFilter) pbFilter.set(filter);
      if (typeof location !== "undefined" && location.hash !== href && typeof history !== "undefined") history.pushState(null, "", href);
      revealTarget(target);
    });
  }
}

/* ---------------------------------------------------------------- R-8: scroll regions */

/** The narrow surface `syncScrollRegion` touches, declared structurally so
    it runs under `node --test` as well as on a real element. */
export interface ScrollRegionNode {
  scrollWidth: number;
  clientWidth: number;
  dataset: Record<string, string | undefined>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** A wrapper is a focusable, named "scroll sideways" region exactly while
    its content overflows it, and a plain box otherwise (review R-8). The
    name is the one the server rendered in `data-scroll-region`.

    signals-v4 LD8: `data-scroll-region` goes only on a ROLE-LESS wrapper. An
    element that carries a role or an accessible name of its own in the
    server HTML (a tablist, a group) is never re-roled: the first sync finds
    it, logs a console error and leaves it untouched — the roles this
    function writes are recorded (`data-scroll-region-owned`), so a later
    sync can tell them from the server's. */
export function syncScrollRegion(el: ScrollRegionNode): boolean {
  if (el.getAttribute("data-scroll-region-owned") !== "1") {
    if (el.getAttribute("role") !== null || el.getAttribute("aria-label") !== null) {
      console.error("populus: [data-scroll-region] on an element with its own role or name; it is not re-roled", el);
      return false;
    }
    el.setAttribute("data-scroll-region-owned", "1");
  }
  const name = el.dataset.scrollRegion;
  const scrolls = !!name && el.scrollWidth > el.clientWidth + 1;
  if (scrolls) {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", name!);
  } else {
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
  }
  return scrolls;
}

function initScrollRegions(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-region]"))) {
    const sync = (): void => void syncScrollRegion(el);
    sync();
    // the wrapper's width moves with the viewport, its content's (the hits
    // table, the tablist, a chip row) with what it holds
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      const content = el.querySelector("table") ?? el.firstElementChild;
      if (content) ro.observe(content);
    } else window.addEventListener("resize", sync);
  }
}

let fit: FitBinding | null = null;
let movesFit: FitBinding | null = null;

export function initSignalsPage(opts: { tabsEnv?: TabsEnv } = {}): void {
  /* LD8: the tabs bind first, so a hash selects its tab before anything
     else reads the page (a test passes its own address bar) */
  initTabs(document, opts.tabsEnv);
  const pager = initHitPager();
  moves = initNamedMoves();
  /* M3: before the row links, which reveal a hash on load */
  overlap = initOverlap();
  playbookList = initPlaybooks();
  pbFilter = initPlaybookFilter();
  initPaneSwitches();
  initScrollRegions();
  initInPageLinks();
  initRowLinks();
  /* LD6 (Congress): the hits fill to the height of "Filings to read" */
  const ref = document.getElementById("triage");
  const col = document.getElementById("signals-side");
  if (pager && ref && col) {
    fit = bindFit(ref as unknown as FitElement, col as unknown as FitElement, pager.fitTarget, { min: SIGNAL_HITS_COMPACT_ROWS, ownRoot: "hits" });
    pager.onFilter = () => void fit?.refit();
  }
  /* LD6 (Institutional): the Named moves fill to the height of Consensus
     and the new-position leaders */
  const iref = document.getElementById("inst-side");
  const icol = document.getElementById("named-moves");
  if (moves && iref && icol) {
    movesFit = bindFit(iref as unknown as FitElement, icol as unknown as FitElement, moves.fitTarget, { min: NAMED_MOVES_MIN, ownRoot: "named-moves" });
    moves.onFilter = () => void movesFit?.refit();
    moves.onLayout = () => void movesFit?.refit();
  }
}
