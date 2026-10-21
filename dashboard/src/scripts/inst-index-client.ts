/* A-2 client island for /institutional: name/CIK search + sortable headers
   over the embedded index rows. Sorting and filtering are the SAME pure
   functions the SSR page used, so the re-rendered order can never drift from
   the pre-rendered one. All work happens on this device.

   The header/direction/aria/announcement plumbing now comes from the
   shared `initSortableTable`, which owns NO ordering semantics. Comparison,
   the ranked/unranked split and the tie-break stay here, in the domain — that
   separation is the whole point, and it is why this
   refactor changes no observable behaviour. `inst-index-client.test.ts` pins
   that: it captures this island's output and asserts it is unchanged. */

import { parseDirectoryShard, parseDirectoryShardList, type InstIndexRow, type InstSortKey } from "../lib/inst-index.ts";
import { COMPACT_ROWS, compactBoundCountFor, fmtInt, parseDataColumns, rangeOfTotal, syncCompactDisclosure } from "../lib/format.ts";
import { initSortableTable } from "./table-sort.ts";
import {
  addsBoundNoun,
  addsNoteHtml,
  addsPayloadHref,
  sortAddsRows,
  type AddsMode,
  type AddsPayload,
  type AddsRow,
  type AddsSortKey,
} from "../lib/inst-adds.ts";
import { addsBoundHtml, addsRowsHtml } from "../lib/inst-adds-render.ts";
import { parseHeldIsland, type HeldIsland } from "../lib/held-rows.ts";
import { rolesFor } from "./table-roles.ts";

/* `instIndexBodyHtml` and `instDefaultDir` MOVED to `lib/inst-index.ts`.

   The SSR page rendered the directory body itself and the client rendered it
   again here, and the two disagreed: the client applied ONE compact budget
   across the ranked and unranked buckets, while the page sliced the ranked
   rows and then appended every unranked row outside that budget — so a
   directory with unrankable managers rendered far more rows than its own
   disclosure claimed. Two renderers for one table is what allowed that, so
   there is one, and both callers import it.

   They are re-exported here because the client island is where they have
   always been imported from. */
export { instIndexBodyHtml, instDefaultDir } from "../lib/inst-index.ts";
import { instIndexBodyHtml, instDefaultDir } from "../lib/inst-index.ts";

/* Launch M7b (R32, LD28): the directory's rows are no longer in the page.
   The server renders the default view (the first rows, Hedge funds pressed,
   by value); the page inlines only the list of the directory shard family
   (`#inst-index-shards`), and the rows are fetched on the FIRST search, chip,
   sort or "Show all". Until they arrive nothing the reader sees changes —
   no header, chip or count claims an order or a filter the rows do not show
   — and a failed fetch is stated in place, visibly, while the server's rows
   stay as they are (they are correct for the default view). */

type FetchLike = (href: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Fetch and validate every shard of the family, in order. Resolves to the
    whole directory or rejects with a reason; never a partial directory. */
export async function loadDirectoryRows(list: { total: number; shards: string[] }, fetcher: FetchLike): Promise<InstIndexRow[]> {
  const bodies = await Promise.all(
    list.shards.map(async (href) => {
      const res = await fetcher(href);
      if (!res.ok) throw new Error(`directory shard ${href}: HTTP ${res.status}`);
      return res.json();
    }),
  );
  const rows = bodies.flatMap((b, i) => parseDirectoryShard(b, i, list.shards.length, list.total));
  if (rows.length !== list.total) throw new Error(`directory: ${rows.length} rows, expected ${list.total}`);
  return rows;
}

export function initInstIndex(): void {
  const listEl = document.getElementById("inst-index-shards");
  const bodyEl = document.getElementById("inst-managers-tbody");
  const searchEl = document.getElementById("inst-index-q") as HTMLInputElement | null;
  const countEl = document.getElementById("inst-index-count");
  const statusEl = document.getElementById("inst-index-status");
  const loadEl = document.getElementById("inst-index-load");
  if (!listEl || !bodyEl) return;
  // A missing or foreign-shaped list leaves the server's table alone: the
  // controls then never claim anything they cannot show.
  const list = parseDirectoryShardList(listEl.textContent);
  if (!list) return;

  /* ONE state machine for the directory.

     Search, sort, the type chips and the notable chip all feed the same pure
     pipeline and the same single render. They used to be two owners of one
     `<tbody>` — the sort/search island rebuilt it, and a separate chip island
     hid rows in it afterwards — so any sort silently un-hid every manager the
     chips had filtered out while the chip stayed pressed. */
  let rows: InstIndexRow[] | null = null;
  let q = "";
  let lastNote = "";
  /* R14: the server pressed *Hedge funds* by default; the client starts from
     the pressed chips so its first render equals the server's, for every
     visitor. */
  const types = new Set<string>(
    Array.from(document.querySelectorAll<HTMLElement>('#mgr-chips [data-mgr-type][aria-pressed="true"]'))
      .map((b) => b.dataset.mgrType ?? "")
      .filter((t) => t !== ""),
  );
  let notableOnly = false;
  let expanded = false;
  /* The sort the server rendered, and the one the reader has asked for while
     the rows are loading — committed to the headers only with the rows. */
  let sort: { key: string; dir: "asc" | "desc" } = { key: "value", dir: "desc" };
  let rerender: (() => void) | null = null;

  const disclosure = document.querySelector<HTMLElement>(
    '.compact-disclosure[data-compact-for="inst-managers-tbody"]',
  );
  const disclosureBtn = disclosure?.querySelector("button") ?? null;
  const noun = disclosure?.dataset.compactNoun ?? "managers";
  const headers = Array.from(document.querySelectorAll<HTMLElement>("[data-inst-sort]"));
  const keyOf = (th: { dataset?: DOMStringMap }): string | undefined => th.dataset?.instSort;
  // The headers keep the server's `aria-sort` until the rows arrive; the
  // shared helper becomes their one owner from then on (F27).

  function setLoad(text: string): void {
    if (!loadEl) return;
    loadEl.textContent = text;
    loadEl.hidden = text === "";
  }

  let pending: Promise<boolean> | null = null;
  /** The rows, fetched once; a failure is stated and the next interaction
      retries. Resolves true once `rows` holds the whole directory. */
  function ensureRows(): Promise<boolean> {
    if (rows) return Promise.resolve(true);
    if (pending) return pending;
    setLoad(`Loading all ${fmtInt(list!.total)} filers…`);
    const fetcher: FetchLike = (href) => fetch(href);
    pending = loadDirectoryRows(list!, fetcher).then(
      (loaded) => {
        rows = loaded;
        setLoad("");
        return true;
      },
      (err: unknown) => {
        console.error("populus: directory shards failed", err);
        pending = null;
        setLoad(
          "Couldn't load the full filer directory, so search, filters and sorting are unavailable right now. " +
            "The rows shown are this page's default view, unchanged.",
        );
        return false;
      },
    );
    return pending;
  }

  function start(): void {
    if (rerender) return;
    rerender = initSortableTable({
      root: bodyEl!,
      headers,
      keyOf: (th) => keyOf(th as HTMLElement),
      initial: sort,
      defaultDir: instDefaultDir,
      render: (state) => {
        sort = { key: state.key, dir: state.dir };
        const out = instIndexBodyHtml(
          rows ?? [],
          q,
          state.key as InstSortKey,
          state.dir,
          { types, notableOnly },
          expanded ? undefined : COMPACT_ROWS,
          // R12 (review R2-6): the column set the server decided, read back
          parseDataColumns(bodyEl!.closest?.("table")?.getAttribute("data-columns")),
        );
        lastNote = out.note;
        if (countEl) countEl.textContent = out.note;
        // The disclosure describes THIS render. Updating it in the same pass is
        // what keeps its hidden count from describing a previous filter.
        syncDisclosure(out.total, out.shown);
        return out.html;
      },
      announce: () => lastNote,
      statusEl,
    });
  }

  /** Run `commit` with the rows: at once when they are here, otherwise after
      they load — and not at all if they cannot, so no control changes state
      over rows that never changed. */
  function withRows(commit: () => void): void {
    if (rows) {
      commit();
      start();
      rerender!();
      return;
    }
    void ensureRows().then((ok) => {
      if (!ok) return;
      commit();
      start();
      rerender!();
    });
  }

  function syncDisclosure(total: number, _shown: number): void {
    // The label and the omission rule are derived from the COMPACT LIMIT,
    // not from how many rows are rendered right now. Using the shown count made
    // an expanded control promise to keep every row it was about to collapse
    // away.
    const hidden = Math.max(0, total - COMPACT_ROWS);
    if (hidden === 0) expanded = false;
    /* The sentence and the button commit TOGETHER, in this one pass.
       A chip that drops the directory below the compact bound must retract
       both. The "every filer has its own page" remainder is untouched here:
       it is true at every row count, so no filter can invalidate it. */
    syncCompactDisclosure(disclosure, {
      total,
      hidden: expanded ? 0 : hidden,
      expanded,
      noun,
      // the server's bound noun and `definite`, read off the element (Q-4)
      count: { text: compactBoundCountFor(disclosure, total - hidden, total, noun) },
    });
  }

  /* Before the rows arrive, a header press is ANSWERED here: it requests a
     sort (the same toggle rule the shared helper applies) and the table
     starts at that sort once the rows are in. After they arrive the shared
     helper owns every header press and this listener stands aside. */
  for (const th of headers) {
    th.addEventListener("click", (ev?: { target?: unknown }) => {
      if (rerender) return;
      const t = ev?.target as { closest?: (sel: string) => unknown } | undefined;
      if (t && typeof t.closest === "function" && t.closest(".note-btn")) return;
      const key = keyOf(th);
      if (!key) return;
      const next = key === sort.key ? { key, dir: sort.dir === "desc" ? ("asc" as const) : ("desc" as const) } : { key, dir: instDefaultDir(key) };
      withRows(() => {
        sort = next;
      });
    });
  }

  // A DIRECTORY with nothing held back has no button to press; with one, the
  // press waits for the rows like every other control.
  disclosureBtn?.addEventListener("click", () => {
    withRows(() => {
      expanded = !expanded;
    });
  });

  searchEl?.addEventListener("input", () => {
    withRows(() => {
      q = searchEl.value;
    });
  });

  document.querySelectorAll<HTMLElement>("#mgr-chips [data-mgr-type],#mgr-chips [data-mgr-notable]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        withRows(() => {
          const t = btn.dataset.mgrType;
          if (t) {
            if (types.has(t)) types.delete(t);
            else types.add(t);
          } else {
            notableOnly = !notableOnly;
          }
          btn.setAttribute("aria-pressed", String(t ? types.has(t) : notableOnly));
        });
      });
    });
}

/** The closed-period selector and the new-only toggle.

    EVERY VISIBLE CLAIM COMMITS TOGETHER, AFTER the payload arrives.
    Previously the pressed state changed on click, the rows changed later, the
    caption never changed at all, a note that started empty could not be
    inserted, failures only reached the console, and two overlapping requests
    could land out of order. Any one of those left the table showing one quarter
    while its controls or its omission notice described another — which is the
    same class of defect as an unstated truncation: the reader is told something
    the bytes do not support. */
export function initAddsControls(): void {
  const section = document.getElementById("inst-adds-section");
  const tbody = document.getElementById("inst-adds-tbody");
  if (!section || !tbody) return;

  const pressed = (attr: string, key: "addsPeriod" | "addsMode"): string =>
    section.querySelector<HTMLElement>(`[data-${attr}][aria-pressed='true']`)?.dataset[key] ?? "";
  let period = pressed("adds-period", "addsPeriod");
  let mode: AddsMode = (pressed("adds-mode", "addsMode") as AddsMode) || "all";
  // Monotonic request token: only the NEWEST request may commit. Without it a
  // slow first click can land after a fast second one and repaint stale rows.
  let token = 0;
  /* The rows currently on the page. Launch M7b (R32, LD28): they no longer
     travel inside the page — the server renders the compact slice, and the
     whole bounded payload for this quarter is fetched from the SAME published
     file its no-JS link names (`addsPayloadHref`) the first time the drawer
     opens, or the first time a control needs it. `null` until then. */
  let rows: AddsRow[] | null = null;
  let sort: { key: AddsSortKey; dir: "asc" | "desc" } = { key: "value", dir: "desc" };
  let expanded = false;

  const disclosure = section.querySelector<HTMLElement>(
    '.compact-disclosure[data-compact-for="inst-adds-tbody"]',
  );
  const disclosureBtn = disclosure?.querySelector("button") ?? null;
  const statusEl = document.getElementById("inst-adds-status");
  const headers = [...section.querySelectorAll<HTMLElement>("[data-adds-sort]")];
  const keyOf = (th: { dataset?: DOMStringMap }): string | undefined => th.dataset?.addsSort;
  const dirOf = (key: string): "asc" | "desc" =>
    ((section!.querySelector<HTMLElement>(`[data-adds-sort="${key}"]`)?.dataset.addsDir as "asc" | "desc") ?? "desc");

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  /* The SHARED plumbing owns header wiring, direction toggling,
     `aria-sort` and the announcement — the same helper every other sortable
     table on the site uses. Only the ORDERING stays here, in `sortAddsRows`,
     because only this module knows a null value means "undisclosed" rather
     than zero. It starts once rows exist, at the sort the reader asked for. */
  let repaint: (() => void) | null = null;
  /** A sort the reader asked for before the rows arrived; the table starts
      at it. */
  let requested: { key: AddsSortKey; dir: "asc" | "desc" } | null = null;
  function start(): void {
    if (repaint) return;
    if (requested) sort = requested;
    requested = null;
    repaint = initSortableTable({
      root: tbody!,
      headers,
      keyOf: (th) => keyOf(th as unknown as HTMLElement),
      initial: sort,
      defaultDir: dirOf,
      render: (st) => {
        sort = { key: st.key as AddsSortKey, dir: st.dir };
        // The disclosure describes THIS render, so it updates in the same pass.
        queueMicrotask(syncDisclosure);
        return addsRowsHtml(
          sortAddsRows(rows ?? [], sort.key, sort.dir),
          expanded ? undefined : COMPACT_ROWS,
        );
      },
      announce: (st) =>
        `Sorted by ${st.key}, ${st.dir === "desc" ? "descending" : "ascending"}.`,
      statusEl: document.getElementById("inst-adds-status"),
    });
  }

  function paint(): void {
    start();
    repaint!();
  }

  function syncDisclosure(): void {
    if (rows === null) return; // the server's statement stands until rows exist
    // Derived from the LIMIT, not from the rendered count.
    const hidden = Math.max(0, rows.length - COMPACT_ROWS);
    if (hidden === 0) expanded = false;
    /* The named bound moves with the quarter. Its REMAINDER carries
       the link to THIS period and mode's published payload, so the no-JS route
       the server-rendered view offered is still correct after a selection —
       which is why this one rewrites the remainder as well as the count, and
       why it writes html rather than text. */
    syncCompactDisclosure(disclosure, {
      total: rows.length,
      hidden: expanded ? 0 : hidden,
      expanded,
      noun: "issuers",
      count: { text: compactBoundCountFor(disclosure, rows.length - hidden, rows.length, "issuers") },
      extra: { html: addsBoundHtml(addsPayloadHref(period, mode)) },
    });
  }

  disclosureBtn?.addEventListener("click", () => {
    if (rows === null) return; // hidden until the rows exist
    expanded = !expanded;
    paint();
  });

  function press(kind: "period" | "mode", value: string): void {
    const sel = kind === "period" ? "[data-adds-period]" : "[data-adds-mode]";
    const key = kind === "period" ? "addsPeriod" : "addsMode";
    section!.querySelectorAll<HTMLElement>(sel).forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset[key] === value));
    });
  }

  async function select(nextPeriod: string, nextMode: AddsMode, first = false): Promise<boolean> {
    const mine = ++token;
    setStatus(first ? `Loading every issuer for the quarter ended ${nextPeriod}…` : `Loading the quarter ended ${nextPeriod}…`);
    let payload: AddsPayload;
    try {
      // Through `addsPayloadHref`, the SAME builder the section's no-JS
      // links render. This was a hardcoded template while Dev Notes claimed one
      // authority — so the claim was false and a path change could have sent
      // the scripted selector somewhere the published link does not go.
      const res = await fetch(addsPayloadHref(nextPeriod, nextMode));
      if (!res.ok) throw new Error(`adds payload ${res.status}`);
      payload = (await res.json()) as AddsPayload;
    } catch (err) {
      if (mine !== token) return false; // superseded — say nothing about a stale request
      console.error("populus: adds payload failed", err);
      // A VISIBLE failure. The rows on screen are untouched and still correctly
      // labelled, because nothing was relabelled.
      setStatus(
        first
          ? `Couldn't load the rest of the quarter ended ${nextPeriod}. The rows shown are unchanged; the published JSON link below has every issuer.`
          : `Couldn't load the quarter ended ${nextPeriod}. The quarter shown below is unchanged.`,
      );
      return false;
    }
    if (mine !== token) return false; // a newer selection already committed

    // --- commit: rows, controls, caption, window and note, together ---------
    rows = payload.rows;
    if (!first) expanded = false;
    /* The count's noun moves with the quarter: a truncated payload's total is
       the leaderboard's bound (review R-4). Written onto the element the
       server rendered, where the shared reader takes it from. */
    if (disclosure) {
      const b = addsBoundNoun(payload.truncated);
      disclosure.setAttribute("data-compact-bound-noun", b.boundNoun);
      if (b.definite) disclosure.setAttribute("data-compact-definite", "1");
      else disclosure.removeAttribute("data-compact-definite");
    }
    period = nextPeriod;
    mode = nextMode;
    paint();
    press("period", period);
    press("mode", mode);

    const win = document.getElementById("inst-adds-window");
    /* Same split, same removal as the congress window statement: this
       is the second site doing exactly the same thing for the adds window, and
       leaving it would have re-appended a build id the server no longer
       renders — reconstructing a stamp from an empty capture group. */
    if (win) win.textContent = `quarter ended ${payload.period}`;
    const caption = section!.querySelector("caption");
    if (caption) {
      caption.textContent =
        `Issuers ranked by disclosed value added in the quarter ended ${payload.period}`;
    }
    const note = document.getElementById("inst-adds-note");
    if (note) {
      note.outerHTML =
        addsNoteHtml(payload) || `<div class="caveat-line" id="inst-adds-note"></div>`;
    }
    setStatus(
      first
        ? ""
        : `Showing the quarter ended ${payload.period}, ${
            mode === "new" ? "new positions only" : "new and added positions"
          }.`,
    );
    return true;
  }

  let firstLoad: Promise<boolean> | null = null;
  /** The shown quarter's whole bounded payload, fetched once (the first open
      of the drawer, or the first control that needs rows); a failure is
      stated and the next request retries. */
  function ensureRows(): Promise<boolean> {
    if (rows !== null) return Promise.resolve(true);
    if (firstLoad) return firstLoad;
    firstLoad = select(period, mode, true).then((ok) => {
      if (!ok) firstLoad = null;
      return ok;
    });
    return firstLoad;
  }

  /* A header press before the rows arrive requests the sort (the shared
     helper's toggle rule) and the table starts at it with the rows; after
     that the shared helper owns every press and this listener stands aside. */
  for (const th of headers) {
    th.addEventListener("click", (ev?: { target?: unknown }) => {
      if (repaint) return;
      const t = ev?.target as { closest?: (sel: string) => unknown } | undefined;
      if (t && typeof t.closest === "function" && t.closest(".note-btn")) return;
      const key = keyOf(th) as AddsSortKey | undefined;
      if (!key) return;
      const cur = requested ?? sort;
      requested = key === cur.key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: dirOf(key) };
      // The first load paints at `requested` (start() reads it); a failed
      // load drops the request, so no header claims an order it never drew.
      void ensureRows().then((ok) => {
        if (!ok) requested = null;
      });
    });
  }

  section.querySelectorAll<HTMLElement>("[data-adds-period]").forEach((btn) => {
    btn.addEventListener("click", () => void select(btn.dataset.addsPeriod!, mode));
  });
  section.querySelectorAll<HTMLElement>("[data-adds-mode]").forEach((btn) => {
    btn.addEventListener("click", () => void select(period, btn.dataset.addsMode as AddsMode));
  });

  // The first OPEN of the drawer fetches the shown quarter; a section that is
  // not inside a drawer fetches on its first control instead.
  const drawer = section.closest?.("details") ?? null;
  if (drawer) {
    if ((drawer as HTMLDetailsElement).open) void ensureRows();
    else drawer.addEventListener("toggle", () => {
      if ((drawer as HTMLDetailsElement).open) void ensureRows();
    });
  }
}

/* ---------- the ONE named binder for DOM-backed compact tables (R36) ----------

   A table whose full body is already in the DOM shows its first N rows
   (`tbody[data-collapsed] tr[data-compact-extra]`); this binder reveals the
   button beside the server's visible count and toggles the held rows. It
   re-reads every count off the element on each sync and re-syncs on
   `populus:rerender`, which every client re-render dispatches, so a re-rendered
   table always restates its own count. Callers: /institutional/, the filer
   page, /e/, the member page and /signals/ (DESIGN-POLISH M2, T2.11). It stays
   in this module — the plan's home for it — because a module of its own became
   a new `_astro` chunk (+1 dist file, measured in the m2-dev gate), and the
   dist file count must not grow (success criterion 11). */

/** The generic compact-disclosure owner for tables whose FULL body is
    already in the DOM (the institutional activity feed).

    The congress ranking sections and the manager directory re-render their
    rows from data, so they own their own disclosures. This one has no data to
    re-render from: the rows are present and the control simply reveals them.
    Two mechanisms, because the two situations are genuinely different — but
    every named root now has exactly one owner, which the root-scoped
    re-render rule asks for. */
export function initDomDisclosures(): void {
  bindDomDisclosures();
  bindHeldLists();
  /* R15/R36: every client re-render announces itself with `populus:rerender`
     (the /e/ driver, both period switches, the holdings surface). A re-render
     can bring NEW wrappers — bound here — and can leave a wrapper in place
     with different counts — re-read and re-synced here, so a re-rendered table
     restates its own count. Idempotent: the click listener is attached once
     per wrapper, and a sync only restates what the element says. A re-render
     can also bring a new held list's island (the /e/ driver): bound once each. */
  if (typeof document.addEventListener === "function") {
    document.addEventListener("populus:rerender", () => {
      bindDomDisclosures();
      bindHeldLists();
    });
  }
  bindHeldPrint();
  bindHeldTargets();
}

/* ---------- held rows: the ONE binder for every island (pagination-and-counts.md rule 8) ----------

   LD26: one binder, two carriers. A rule-7 table holds its extra rows in the
   DOM (`tr[data-compact-extra]`); a HELD list holds them only as JSON, in the
   one island the server writes after it (`heldIslandHtml` in
   `lib/held-rows.ts`: `<script type="application/json" data-held-for="<root
   id>" data-held-render="<name>">`, body `{ v, offset, shared, rows }`).
   Every held list on the site uses it — the member page's compact tables, the
   Signals hits, Named moves, Congress-lines bank and Overlap names, and the
   holders lists — and every island row reaches the DOM through ONE function
   here, `heldRowsHtml`: the row function registered under the island's name
   (the SAME function the server rendered the list's first rows with) over the
   island's own inputs, then the explicit table roles of the table the row
   lands in (`rolesFor`, launch M1a R40), so a drawn row is byte-identical to
   the server page's row. What differs between lists is only WHEN rows are
   drawn: a compact table's "Show all" (`materializeHeldRows`), a holders
   list's "Show all N holders" steps (`bindHeldLists`), the Signals pagers
   (`signals-client.ts`, through `drawHeldRun` / `drawHeldRows`), and a deep
   link to a held row (`revealHeldTarget`). Nothing here reads a `<noscript>`,
   and DOM text never becomes HTML: the island is parsed as JSON and only the
   registered function's output is written. */

/** A row function as the binder calls it: the island row, its zero-based
    position in the WHOLE list, and the island's list-wide inputs. */
export type HeldRowRenderer = (row: unknown, index: number, shared: unknown) => string;

interface HeldRenderEntry {
  render: HeldRowRenderer;
  /** the text a held list's local search matches (a holder's filer name) */
  text: ((row: unknown) => string) | null;
}
const heldRenderers = new Map<string, HeldRenderEntry>();

/** Register the row function a page's held lists render through, under the
    name its islands carry in `data-held-render` — and, for a list a reader
    can search, the text a search matches. Call before `initDomDisclosures()`
    (or before a pager that draws from the island). Registering a name twice
    keeps the latest function. */
export function registerHeldRows<R, S>(
  name: string,
  render: (row: R, index: number, shared: S) => string,
  opts: { text?: (row: R) => string } = {},
): void {
  /* the island's JSON was produced from exactly the R and S this function
     takes (`heldIslandHtml` in `lib/held-rows.ts`), so the widening is the
     binder's, in one place */
  heldRenderers.set(name, {
    render: render as unknown as HeldRowRenderer,
    text: opts.text ? (opts.text as unknown as (row: unknown) => string) : null,
  });
}

/** Every island on the page, in document order. */
function heldIslands(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('script[type="application/json"][data-held-for]'));
}
function heldIslandEl(rootId: string): HTMLElement | null {
  if (!rootId) return null;
  return heldIslands().find((el) => el.getAttribute("data-held-for") === rootId) ?? null;
}
/* An island is parsed once per element: the pagers read its rows on every
   view change. */
const parsedIslands = new WeakMap<object, HeldIsland | null>();
function islandData(el: HTMLElement): HeldIsland | null {
  if (!parsedIslands.has(el)) parsedIslands.set(el, parseHeldIsland(el.textContent));
  return parsedIslands.get(el) ?? null;
}

/** A root's island, parsed, with its registered renderer — or null when the
    island, its body or its renderer is missing (the list then holds what the
    page rendered, and nothing claims rows it cannot show). */
function heldSource(rootId: string): { el: HTMLElement; data: HeldIsland; entry: HeldRenderEntry } | null {
  const el = heldIslandEl(rootId);
  const data = el ? islandData(el) : null;
  const entry = heldRenderers.get(el?.getAttribute("data-held-render") ?? "");
  return el && data && entry ? { el, data, entry } : null;
}

/** The island rows a root's list holds (for a pager's counts and filters),
    or null when it has no usable island. */
export function heldRows<R = unknown>(rootId: string): readonly R[] | null {
  return (heldSource(rootId)?.data.rows as R[] | undefined) ?? null;
}

/** THE render path: the island rows at `positions` (indexes into the
    island's `rows`), each through the registered row function at its place in
    the whole list, joined as the server joins rows, with the explicit table
    roles of the table the root sits in. Null when the island cannot render. */
export function heldRowsHtml(rootId: string, positions: readonly number[]): string | null {
  const src = heldSource(rootId);
  if (!src) return null;
  const { data, entry } = src;
  const html = positions
    .filter((p) => p >= 0 && p < data.rows.length)
    .map((p) => entry.render(data.rows[p], data.offset + p, data.shared))
    .join("\n");
  return rolesFor(document.getElementById(rootId), html);
}

/** How many of an island's rows are already drawn as the root's next
    contiguous run — kept on the island element, so every view over the list
    (a pager, a fit, a deep link) shares one count and never draws a row twice. */
export function heldDrawn(rootId: string): number {
  return Number(heldIslandEl(rootId)?.getAttribute("data-held-drawn") ?? 0) || 0;
}
/** Record the drawn run — e.g. a repaint from the full data retires the
    island (every row counts as drawn). */
export function markHeldDrawn(rootId: string, n: number): void {
  heldIslandEl(rootId)?.setAttribute("data-held-drawn", String(n));
}

/** Append the island rows at `positions` to the root, after a separator
    (`lead`), in the order given. Returns how many rows it drew. */
export function drawHeldRows(rootId: string, positions: readonly number[], lead = "\n"): number {
  const root = document.getElementById(rootId);
  const html = root ? heldRowsHtml(rootId, positions) : null;
  if (!root || html === null || positions.length === 0) return 0;
  root.insertAdjacentHTML("beforeend", lead + html);
  return positions.length;
}

/** Draw the island's next `n` rows as the root's contiguous run. Returns how
    many it drew. */
export function drawHeldRun(rootId: string, n: number): number {
  const rows = heldRows(rootId);
  if (rows === null) return 0;
  const from = heldDrawn(rootId);
  const take = Math.max(0, Math.min(n, rows.length - from));
  if (take === 0) return 0;
  const drawn = drawHeldRows(rootId, Array.from({ length: take }, (_, i) => from + i));
  markHeldDrawn(rootId, from + drawn);
  return drawn;
}

/** Bring a compact held table's island rows into the DOM, once, marked as
    the rule-7 toggle's held rows. True when every row the disclosure counts is
    now in the DOM (always true for a rule-7 root); false when the island or
    its renderer is missing, so the caller reveals nothing rather than claim
    rows it cannot show. */
function materializeHeldRows(root: HTMLElement): boolean {
  if (root.getAttribute("data-held") !== "json") return true;
  const rows = heldRows(root.id);
  if (rows === null) return false;
  const before = root.children.length;
  drawHeldRun(root.id, rows.length);
  for (let i = before; i < root.children.length; i++) root.children[i]!.setAttribute("data-compact-extra", "");
  return heldDrawn(root.id) >= rows.length;
}

/** Expand the disclosure that controls the root with this id — rendering its
    held rows first when they live in an island. For a caller that must reach
    a held row by navigation (a deep link, a search hit). True when it
    expanded one. */
export function expandDisclosureByRoot(rootId: string): boolean {
  for (const wrap of Array.from(document.querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]"))) {
    if (wrap.dataset.compactFor !== rootId) continue;
    const s = readDomDisclosure(wrap);
    if (!s || s.expanded || s.hidden <= 0) return false;
    setDomDisclosure(wrap, true);
    return readDomDisclosure(wrap)?.expanded === true;
  }
  return false;
}

/** A deep link or an in-page link to an element only a HELD row carries: find
    the island row that renders an element with that id, then open what holds
    it back — a compact table's "Show all" (`expandDisclosureByRoot`) or a
    holders list's steps — and return the element, now in the DOM. Null when
    the element is already present (the browser's own navigation stands), when
    no held row carries it, or when what holds it cannot open. The Signals
    pagers resolve their own rows first (`signals-client.ts` `revealHash`) and
    call this for the rest. */
export function revealHeldTarget(targetId: string): Element | null {
  if (!targetId || document.getElementById(targetId)) return null;
  const needle = `id="${targetId.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}"`;
  for (const island of heldIslands()) {
    const rootId = island.getAttribute("data-held-for") ?? "";
    const list = heldListReveal.get(rootId);
    const compact = document.querySelector(`.compact-disclosure[data-compact-dom][data-compact-for="${rootId}"]`);
    if (!list && !compact) continue; // a pager's island: the pager owns its rows
    const src = heldSource(rootId);
    if (!src) continue;
    const at = src.data.rows.findIndex((row, j) => src.entry.render(row, src.data.offset + j, src.data.shared).includes(needle));
    if (at < 0) continue;
    if (compact) expandDisclosureByRoot(rootId);
    else list!(at);
    return document.getElementById(targetId);
  }
  return null;
}

/* The deep-link half of `revealHeldTarget`, bound once per page by
   `initDomDisclosures`: a hash on load, a later `hashchange`, and a click on
   an in-page link whose target is a held row each open what holds it and
   bring it into view. A link whose target is in the DOM is left to the
   browser; a click another handler already took (the Signals reveal
   sequence) is left alone. */
const heldTargetWindows = new WeakSet<object>();
const heldTargetRoots = new WeakSet<object>();
function heldHashId(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
function landHeldTarget(el: Element | null): void {
  (el as (Element & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }) | null)?.scrollIntoView?.({ block: "center" });
}
function bindHeldTargets(): void {
  const root = document.documentElement as unknown as { addEventListener?: (t: string, fn: (ev: unknown) => void) => void } | null;
  if (root && typeof root.addEventListener === "function" && !heldTargetRoots.has(root)) {
    heldTargetRoots.add(root);
    root.addEventListener("click", (ev) => {
      const e = ev as { target?: { closest?: (s: string) => Element | null }; defaultPrevented?: boolean; preventDefault?: () => void } | undefined;
      if (e?.defaultPrevented) return;
      const a = e?.target?.closest?.("a[href]");
      const href = a?.getAttribute("href") ?? "";
      if (!href.startsWith("#") || href.length < 2) return;
      const el = revealHeldTarget(heldHashId(href));
      if (!el) return;
      e?.preventDefault?.();
      if (typeof location !== "undefined" && location.hash !== href && typeof history !== "undefined") history.pushState(null, "", href);
      landHeldTarget(el);
    });
  }
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || heldTargetWindows.has(window)) return;
  heldTargetWindows.add(window);
  window.addEventListener("hashchange", () => landHeldTarget(revealHeldTarget(heldHashId(location.hash))));
  if (typeof location !== "undefined" && location.hash) landHeldTarget(revealHeldTarget(heldHashId(location.hash)));
}

/* Print shows every held row (rule 8): `beforeprint` expands each collapsed
   held table, `afterprint` collapses exactly the ones it opened. Bound once
   per page. */
let heldPrintBound = false;
function bindHeldPrint(): void {
  if (heldPrintBound || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  heldPrintBound = true;
  let opened: HTMLElement[] = [];
  window.addEventListener("beforeprint", () => {
    opened = [];
    for (const wrap of Array.from(document.querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]"))) {
      const s = readDomDisclosure(wrap);
      if (!s || s.expanded || s.hidden <= 0 || s.root.getAttribute("data-held") !== "json") continue;
      setDomDisclosure(wrap, true);
      if (readDomDisclosure(wrap)?.expanded) opened.push(wrap);
    }
  });
  window.addEventListener("afterprint", () => {
    for (const wrap of opened) setDomDisclosure(wrap, false);
    opened = [];
  });
}

/** The state one sync restates, read off the element AT THAT SYNC — never
    cached at bind time (R36). Caching is what let a table that re-rendered
    from 25 rows to 40 keep saying "of 25". */
function readDomDisclosure(wrap: HTMLElement): {
  root: HTMLElement;
  total: number;
  shown: number;
  hidden: number;
  noun: string;
  expanded: boolean;
} | null {
  const root = document.getElementById(wrap.dataset.compactFor ?? "");
  if (!root) return null;
  const total = Number(wrap.dataset.compactTotal ?? 0);
  const shown = Number(wrap.dataset.compactShown ?? 0);
  const hidden = total - shown;
  /* The expanded state lives ON THE ELEMENT (`data-compact-expanded`), and it
     holds only while the tbody it controls still agrees: a brand-new tbody the
     server rendered collapsed starts collapsed, even under a wrapper that was
     expanded, so the control and the rows can never disagree. Nothing held
     back means nothing to be expanded (the omission rule). */
  const expanded =
    hidden > 0 &&
    wrap.getAttribute("data-compact-expanded") === "1" &&
    root.getAttribute("data-collapsed") === "false";
  return { root, total, shown, hidden, noun: wrap.dataset.compactNoun ?? "rows", expanded };
}

function syncDomDisclosure(wrap: HTMLElement): void {
  const s = readDomDisclosure(wrap);
  if (!s) return;
  if (s.expanded) wrap.setAttribute("data-compact-expanded", "1");
  else wrap.removeAttribute("data-compact-expanded");
  // The SERVER already rendered this state, so this is normally a no-op. It
  // stays because an island that assumes the server did its half acquires a
  // second precondition, and this one is idempotent.
  if (s.hidden > 0) s.root.setAttribute("data-collapsed", String(!s.expanded));
  /* This REVEALS THE BUTTON (or, with nothing held back, hides and empties
     it). The count clause is RESTATED from the element on every sync, through
     the one composer that reads the bound noun and `definite` back off it, so
     after load the client prints exactly the server's text — and after a
     re-render, the re-rendered table's own count. Expanding retracts the count
     clause; the publication bound beside it stays. */
  syncCompactDisclosure(wrap, {
    total: s.total,
    hidden: s.expanded ? 0 : Math.max(0, s.hidden),
    expanded: s.expanded,
    noun: s.noun,
    count: { text: compactBoundCountFor(wrap, s.shown, s.total, s.noun) },
    // the table's own slice, and one press reveals every held row
    shown: s.shown,
    all: true,
  });
}

function bindDomDisclosures(): void {
  document
    .querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]")
    .forEach((wrap) => {
      const btn = wrap.querySelector("button");
      if (!btn) return;
      // ONE listener per wrapper element, however many re-renders announce
      // themselves; the handler reads the element's state when it fires.
      if (wrap.getAttribute("data-compact-bound") !== "1") {
        wrap.setAttribute("data-compact-bound", "1");
        btn.addEventListener("click", () => {
          const s = readDomDisclosure(wrap);
          if (!s || s.hidden <= 0) return; // an inert control discloses nothing
          setDomDisclosure(wrap, !s.expanded);
        });
      }
      syncDomDisclosure(wrap);
    });
}

/** The ONE state change of a DOM-backed disclosure — the "Show all" button
    and `expandDomDisclosureFor` both run it, so the rows, the control's
    label and `aria-expanded`, and `data-compact-expanded` move together. */
function setDomDisclosure(wrap: HTMLElement, expanded: boolean): void {
  const s = readDomDisclosure(wrap);
  if (!s || s.hidden <= 0) return;
  /* rule 8: a held root renders its island rows before it may say it is
     expanded; with no island or renderer it stays collapsed */
  if (expanded && !materializeHeldRows(s.root)) return;
  s.root.setAttribute("data-collapsed", String(!expanded));
  if (expanded) wrap.setAttribute("data-compact-expanded", "1");
  else {
    wrap.removeAttribute("data-compact-expanded");
    /* A disclosure opened inside a row that is now held back closes
       with it (review R2-2): a held signal hit's evidence row must
       never stay open under the visible hits, where its receipts
       would read as another hit's. The stylesheet hides it as well. */
    s.root.querySelectorAll("tr[data-compact-extra] details[open]").forEach((d) => d.removeAttribute("open"));
  }
  syncDomDisclosure(wrap);
}

/** signals-v4 LD8 (codex M2 round 2, F4): an in-page navigation to an element
    a DOM-backed disclosure holds back — inside a `[data-compact-extra]` row
    of a collapsed root (a Consensus row past ten) — expands that disclosure
    first, through the same state change as its "Show all" button. Returns
    whether it expanded one. */
export function expandDomDisclosureFor(el: Element): boolean {
  if (!el.closest("[data-compact-extra]")) return false;
  let changed = false;
  for (const wrap of Array.from(document.querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]"))) {
    const s = readDomDisclosure(wrap);
    if (!s || s.expanded || s.hidden <= 0) continue;
    const extra = el.closest("[data-compact-extra]");
    if (!extra || !s.root.id || extra.closest(`#${s.root.id}`) !== s.root) continue;
    setDomDisclosure(wrap, true);
    changed = true;
  }
  return changed;
}

/* ---------- held lists: "Show all N holders" (launch M7b, R33) ----------

   A holders list opens at its first rows; the rest are held in the one island
   (`heldIslandHtml`, offset = the rows shown, `shared` = the row function's
   `ctx` and the view's step, total and noun) and drawn by `heldRowsHtml` —
   the one render path above — into the empty table inside the "Show all N
   holders" disclosure. Controls, all keyed by the held tbody's id and all
   server-rendered hidden until this binder proves it can work: the
   `<details data-held-more>`, the search (`data-held-search`), the count
   (`data-held-count`), the table wrapper (`data-held-wrap`) and the step
   button (`data-held-step`). Opening the disclosure draws the first step;
   each press draws the next; a search filters the held rows by the
   registered search text and shows the first step of the result.
   `beforeprint` draws EVERY held row and opens the disclosure; `afterprint`
   restores the reader's state. A deep link to a held row draws through it
   (`revealHeldTarget`). */

/** The count line for one state of a held list. Plain text. */
export function heldCountText(s: { shown: number; total: number; held: number; rendered: number; matches: number | null; query: string; of?: number | null }): string {
  if (s.matches === null) {
    /* H1: a capped list counts against the true holder count, never its cap */
    return s.rendered === 0 ? "" : rangeOfTotal(s.shown + 1, s.shown + s.rendered, Math.max(s.total, s.of ?? 0), "holders");
  }
  const scope = `holders ${fmtInt(s.shown + 1)}–${fmtInt(s.total)}`;
  if (s.matches === 0) return `No filer among ${scope} matches "${s.query}".`;
  return `${fmtInt(s.matches)} of ${scope} ${s.matches === 1 ? "matches" : "match"} "${s.query}"` + (s.rendered < s.matches ? ` · ${fmtInt(s.rendered)} shown` : "");
}

/** The step button's label for what is still held back; "" when nothing is. */
export function heldStepLabel(remaining: number, step: number): string {
  if (remaining <= 0) return "";
  return remaining > step ? `Show ${fmtInt(step)} more` : `Show the last ${fmtInt(remaining)}`;
}

/** Each bound held list's deep-link hook: draw through island position `at`. */
const heldListReveal = new Map<string, (at: number) => void>();

function bindHeldLists(): void {
  for (const island of heldIslands()) {
    if (island.getAttribute("data-held-bound") === "1") continue;
    const id = island.getAttribute("data-held-for") ?? "";
    const more = document.querySelector<HTMLElement>(`details[data-held-more="${id}"]`);
    const tbody = document.getElementById(id);
    const src = heldSource(id);
    /* not a held list (a compact table, a pager), or one that cannot render:
       its controls stay hidden and the no-JS copy stands */
    if (!more || !tbody || !src) continue;
    island.setAttribute("data-held-bound", "1");
    const { data, entry } = src;
    // `open` through the attribute, which the property reflects in a browser
    const isOpen = (): boolean => more.hasAttribute("open");
    const setOpen = (on: boolean): void => {
      if (on) more.setAttribute("open", "");
      else more.removeAttribute("open");
    };
    const shared = (data.shared ?? {}) as { step?: number; total?: number; of?: number };
    const sel = (attr: string): HTMLElement | null => document.querySelector<HTMLElement>(`[${attr}="${id}"]`);
    const tools = sel("data-held-tools");
    const search = sel("data-held-search") as HTMLInputElement | null;
    const wrap = sel("data-held-wrap");
    const count = sel("data-held-count");
    const stepBtn = sel("data-held-step");
    const step = typeof shared.step === "number" && shared.step > 0 ? shared.step : 25;
    const total = typeof shared.total === "number" ? shared.total : data.offset + data.rows.length;
    let query = "";
    let limit = 0;

    /** the island positions the current search keeps, in order */
    function current(): number[] {
      const all = data.rows.map((_, i) => i);
      if (query === "" || !entry.text) return all;
      const q = query.toLowerCase();
      return all.filter((i) => entry.text!(data.rows[i]).toLowerCase().includes(q));
    }

    function draw(): void {
      const list = current();
      const rendered = Math.min(limit, list.length);
      tbody!.innerHTML = heldRowsHtml(id, list.slice(0, rendered)) ?? "";
      if (wrap) wrap.hidden = rendered === 0;
      const text = heldCountText({ shown: data.offset, total, held: data.rows.length, rendered, matches: query === "" ? null : list.length, query, of: typeof shared.of === "number" ? shared.of : null });
      if (count) {
        count.textContent = text;
        count.hidden = text === "";
      }
      if (stepBtn) {
        const label = heldStepLabel(list.length - rendered, step);
        stepBtn.textContent = label;
        stepBtn.hidden = label === "";
      }
      document.dispatchEvent?.(new CustomEvent("populus:rerender", { detail: { root: id } }));
    }

    if (tools) tools.hidden = false;
    // Opening the disclosure draws the first step; closing keeps the state.
    more.addEventListener("toggle", () => {
      if (isOpen() && limit === 0) {
        limit = step;
        draw();
      }
    });
    stepBtn?.addEventListener("click", () => {
      limit += step;
      draw();
    });
    search?.addEventListener("input", () => {
      query = search.value.trim();
      limit = step;
      draw();
    });
    /* a deep link to a held row: clear the search, open, draw through it */
    heldListReveal.set(id, (at: number) => {
      query = "";
      if (search) search.value = "";
      limit = Math.max(limit, Math.ceil((at + 1) / step) * step);
      setOpen(true);
      draw();
    });
    /* Paper gets every holder: draw all of them and open the disclosure, then
       put the reader's state back. */
    let saved: { query: string; limit: number; open: boolean } | null = null;
    const win = typeof window === "undefined" ? null : window;
    win?.addEventListener("beforeprint", () => {
      saved = { query, limit, open: isOpen() };
      query = "";
      limit = data.rows.length;
      setOpen(true);
      draw();
    });
    win?.addEventListener("afterprint", () => {
      if (!saved) return;
      ({ query, limit } = saved);
      setOpen(saved.open);
      saved = null;
      draw();
    });
    if (isOpen()) {
      limit = step;
      draw();
    }
  }
}
