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

import { type InstIndexRow, type InstSortKey } from "../lib/inst-index.ts";
import { COMPACT_ROWS, compactBoundCount, esc, fmtInt, syncCompactDisclosure } from "../lib/format.ts";
import { initSortableTable } from "./table-sort.ts";
import {
  addsNoteHtml,
  addsPayloadHref,
  sortAddsRows,
  type AddsMode,
  type AddsPayload,
  type AddsRow,
  type AddsSortKey,
} from "../lib/inst-adds.ts";
import { addsRowsHtml } from "../lib/inst-adds-render.ts";
import {
  classifyNotableMovesShard,
  notableMoveRowHtml,
  notableMovesHref,
  NOTABLE_MOVES_SSR_ROWS,
  NOTABLE_MOVES_STEP,
  type MoveKind,
  type NotableMove,
  type NotableMovesShard,
} from "../lib/notable-moves.ts";
import { filerHref } from "../lib/holdings.ts";
import { loadWatchStore } from "./entity-client.ts";

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

export function initInstIndex(): void {
  const dataEl = document.getElementById("inst-index-data");
  const bodyEl = document.getElementById("inst-managers-tbody");
  const searchEl = document.getElementById("inst-index-q") as HTMLInputElement | null;
  const countEl = document.getElementById("inst-index-count");
  const statusEl = document.getElementById("inst-index-status");
  if (!dataEl || !bodyEl) return;

  let rows: InstIndexRow[];
  try {
    rows = JSON.parse(dataEl.textContent ?? "[]") as InstIndexRow[];
  } catch {
    return; // SSR table stays — the island is a convenience, never load-bearing
  }

  /* ONE state machine for the directory.

     Search, sort, the type chips and the notable chip all feed the same pure
     pipeline and the same single render. They used to be two owners of one
     `<tbody>` — the sort/search island rebuilt it, and a separate chip island
     hid rows in it afterwards — so any sort silently un-hid every manager the
     chips had filtered out while the chip stayed pressed. */
  let q = "";
  let lastNote = "";
  /* R14: the server pressed *Hedge funds* by default; the island starts from
     the pressed chips so its first render equals the server's. A visitor with
     a watchlist on this device gets the unfiltered directory instead. */
  const types = new Set<string>(
    Array.from(document.querySelectorAll<HTMLElement>('#mgr-chips [data-mgr-type][aria-pressed="true"]'))
      .map((b) => b.dataset.mgrType ?? "")
      .filter((t) => t !== ""),
  );
  let notableOnly = false;
  let expanded = false;
  let hasWatchlist = false;
  try {
    const store = loadWatchStore(localStorage);
    hasWatchlist = store.members.size > 0 || store.tickers.size > 0;
  } catch {
    hasWatchlist = false;
  }
  if (hasWatchlist && types.size > 0) {
    types.clear();
    document.querySelectorAll<HTMLElement>("#mgr-chips [data-mgr-type]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }

  const disclosure = document.querySelector<HTMLElement>(
    '.compact-disclosure[data-compact-for="inst-managers-tbody"]',
  );
  const disclosureBtn = disclosure?.querySelector("button") ?? null;
  const noun = disclosure?.dataset.compactNoun ?? "managers";

  const rerender = initSortableTable({
    root: bodyEl,
    headers: Array.from(document.querySelectorAll<HTMLElement>("[data-inst-sort]")),
    keyOf: (th) => (th as HTMLElement).dataset.instSort,
    initial: { key: "value", dir: "desc" },
    defaultDir: instDefaultDir,
    render: (state) => {
      const out = instIndexBodyHtml(
        rows,
        q,
        state.key as InstSortKey,
        state.dir,
        { types, notableOnly },
        expanded ? undefined : COMPACT_ROWS,
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

  if (hasWatchlist) queueMicrotask(() => rerender());

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
      count: { text: compactBoundCount(hidden, noun) },
    });
  }

  disclosureBtn?.addEventListener("click", () => {
    expanded = !expanded;
    rerender();
  });

  searchEl?.addEventListener("input", () => {
    q = searchEl.value;
    rerender();
  });

  document.querySelectorAll<HTMLElement>("#mgr-chips [data-mgr-type],#mgr-chips [data-mgr-notable]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.mgrType;
        if (t) {
          if (types.has(t)) types.delete(t);
          else types.add(t);
        } else {
          notableOnly = !notableOnly;
        }
        btn.setAttribute("aria-pressed", String(t ? types.has(t) : notableOnly));
        rerender();
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
  // The rows currently on the page. SSR seeds this via the embedded payload so
  // sorting and expanding work before any fetch happens.
  let rows: AddsRow[] = [];
  let sort: { key: AddsSortKey; dir: "asc" | "desc" } = { key: "value", dir: "desc" };
  let expanded = false;

  const dataEl = document.getElementById("inst-adds-data");
  try {
    rows = JSON.parse(dataEl?.textContent ?? "[]") as AddsRow[];
  } catch {
    rows = [];
  }

  const disclosure = section.querySelector<HTMLElement>(
    '.compact-disclosure[data-compact-for="inst-adds-tbody"]',
  );
  const disclosureBtn = disclosure?.querySelector("button") ?? null;
  const statusEl = document.getElementById("inst-adds-status");

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  /* The SHARED plumbing owns header wiring, direction toggling,
     `aria-sort` and the announcement — the same helper every other sortable
     table on the site uses. Only the ORDERING stays here, in `sortAddsRows`,
     because only this module knows a null value means "undisclosed" rather
     than zero.

     This was a hand-rolled second sort state machine, and it had already
     drifted: two text columns displayed descending while announcing ascending.
     One owner of `aria-sort` is the fix. */
  const repaint = initSortableTable({
    root: tbody,
    headers: [...section.querySelectorAll<HTMLElement>("[data-adds-sort]")],
    keyOf: (th) => (th as unknown as HTMLElement).dataset.addsSort,
    initial: { key: "value", dir: "desc" },
    defaultDir: (key) =>
      ((section!.querySelector<HTMLElement>(`[data-adds-sort="${key}"]`)?.dataset
        .addsDir as "asc" | "desc") ?? "desc"),
    render: (st) => {
      sort = { key: st.key as AddsSortKey, dir: st.dir };
      // The disclosure describes THIS render, so it updates in the same pass.
      queueMicrotask(syncDisclosure);
      return addsRowsHtml(
        sortAddsRows(rows, sort.key, sort.dir),
        expanded ? undefined : COMPACT_ROWS,
      );
    },
    announce: (st) =>
      `Sorted by ${st.key}, ${st.dir === "desc" ? "descending" : "ascending"}.`,
    statusEl: document.getElementById("inst-adds-status"),
  });

  function paint(): void {
    repaint();
  }

  function syncDisclosure(): void {
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
      count: { text: compactBoundCount(hidden, "issuers") },
      extra: {
        html:
          `Every issuer in this quarter's bounded payload remains in ` +
          `<a href="${esc(addsPayloadHref(period, mode))}">the published JSON</a>.`,
      },
    });
  }

  disclosureBtn?.addEventListener("click", () => {
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

  async function select(nextPeriod: string, nextMode: AddsMode): Promise<void> {
    const mine = ++token;
    setStatus(`Loading the quarter ended ${nextPeriod}…`);
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
      if (mine !== token) return; // superseded — say nothing about a stale request
      console.error("populus: adds payload failed", err);
      // A VISIBLE failure. The rows on screen are untouched and still correctly
      // labelled, because nothing was relabelled.
      setStatus(
        `Couldn't load the quarter ended ${nextPeriod}. The quarter shown below is unchanged.`,
      );
      return;
    }
    if (mine !== token) return; // a newer selection already committed

    // --- commit: rows, controls, caption, window and note, together ---------
    rows = payload.rows;
    expanded = false;
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
      `Showing the quarter ended ${payload.period}, ${
        mode === "new" ? "new positions only" : "new and added positions"
      }.`,
    );
  }

  section.querySelectorAll<HTMLElement>("[data-adds-period]").forEach((btn) => {
    btn.addEventListener("click", () => void select(btn.dataset.addsPeriod!, mode));
  });
  section.querySelectorAll<HTMLElement>("[data-adds-mode]").forEach((btn) => {
    btn.addEventListener("click", () => void select(period, btn.dataset.addsMode as AddsMode));
  });

  syncDisclosure();
}

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
  /* R15: a period switch replaces the filer section's markup, including its
     disclosure; bind again for the new nodes (an already-bound wrapper is
     marked and skipped, so this is idempotent). */
  if (typeof document.addEventListener === "function") {
    document.addEventListener("populus:rerender", () => bindDomDisclosures());
  }
}

function bindDomDisclosures(): void {
  document
    .querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]")
    .forEach((wrap) => {
      if (wrap.getAttribute("data-compact-bound") === "1") return;
      wrap.setAttribute("data-compact-bound", "1");
      const rootId = wrap.dataset.compactFor ?? "";
      const root = document.getElementById(rootId);
      const btn = wrap.querySelector("button");
      if (!root || !btn) return;
      const total = Number(wrap.dataset.compactTotal ?? 0);
      const shown = Number(wrap.dataset.compactShown ?? 0);
      const noun = wrap.dataset.compactNoun ?? "rows";
      const hidden = total - shown;
      if (hidden <= 0) return; // the omission rule — nothing to disclose
      // The SERVER already rendered this collapsed, so this is normally a
      // no-op. It stays because an island that assumes the server did its half
      // acquires a second precondition, and this one is idempotent.
      root.setAttribute("data-collapsed", "true");
      let expanded = false;
      /* This REVEALS THE BUTTON — it does not reveal the statement,
         which the server already published visible. The count clause is what
         moves with the state: expanding puts the rows on screen, so the claim
         that they are held back is retracted, while the publication bound
         beside it stays. The server's own wording is left in place (no `count`
         here) because this table's rows never change. */
      const sync = (): void =>
        syncCompactDisclosure(wrap, { total, hidden, expanded, noun });
      sync();
      btn.addEventListener("click", () => {
        expanded = !expanded;
        root.setAttribute("data-collapsed", String(!expanded));
        sync();
      });
    });
}

/* ---------- R14: the notable-manager moves band ---------- */

/** Period, kind and type chips plus "Show 50 more", all over the per-period
    shard. The server rendered the first fifteen rows of the newest closed
    quarter; the shard is fetched on the FIRST interaction and never before.
    Every visible claim commits together, after the shard arrives — the same
    rule the adds selector follows. */
export function initNotableMoves(): void {
  const section = document.getElementById("inst-notable-moves");
  const tbody = document.getElementById("inst-notable-moves-tbody");
  const countEl = document.getElementById("inst-notable-moves-count");
  const statusEl = document.getElementById("inst-notable-moves-status");
  const windowEl = document.getElementById("inst-notable-moves-window");
  if (!section || !tbody) return;

  let period = section.dataset.movesPeriod ?? "";
  const kinds = new Set<MoveKind>();
  const mgrTypes = new Set<string>();
  let limit = NOTABLE_MOVES_SSR_ROWS;
  let token = 0;
  const shards = new Map<string, Promise<NotableMovesShard>>();

  function loadShard(p: string): Promise<NotableMovesShard> {
    let pr = shards.get(p);
    if (!pr) {
      pr = fetch(notableMovesHref(p))
        .then((r) => {
          if (!r.ok) throw new Error(`notable moves ${r.status}`);
          return r.json();
        })
        .then((body) => {
          const shard = classifyNotableMovesShard(body);
          if (!shard) throw new Error("notable moves: unrecognised shard");
          return shard;
        });
      pr.catch(() => shards.delete(p));
      shards.set(p, pr);
    }
    return pr;
  }

  function matches(m: NotableMove): boolean {
    if (kinds.size > 0 && !kinds.has(m.kind)) return false;
    if (mgrTypes.size > 0 && !mgrTypes.has(m.type)) return false;
    return true;
  }

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  async function paint(): Promise<void> {
    const mine = ++token;
    let shard: NotableMovesShard;
    try {
      shard = await loadShard(period);
    } catch (err) {
      if (mine !== token) return;
      console.error("populus: notable moves failed", err);
      setStatus(`Couldn't load the moves for the quarter ended ${period}. The rows shown are unchanged.`);
      return;
    }
    if (mine !== token) return;
    const rows = shard.rows.filter(matches);
    const shown = rows.slice(0, limit);
    tbody!.innerHTML =
      shown.length === 0
        ? `<tr><td colspan="8" class="design-unavailable-message">No moves match — a computed answer over every notable manager's changes this quarter.</td></tr>`
        : shown.map((m) => notableMoveRowHtml(m, { filerHref: (cik) => filerHref(cik, "top") })).join("\n");
    if (windowEl) windowEl.textContent = `quarter ended ${shard.period} · by shares · largest $ change first within New › Exit › Add › Trim`;
    if (countEl) {
      const more = rows.length > shown.length;
      countEl.innerHTML =
        `Showing ${fmtInt(shown.length)} of ${fmtInt(rows.length)} moves` +
        (shard.truncated ? ` (the ${fmtInt(shard.rows.length)} largest of ${fmtInt(shard.total)} are in the published file)` : "") +
        (more ? ` · <button type="button" class="linklike" id="inst-notable-moves-more">Show ${fmtInt(NOTABLE_MOVES_STEP)} more</button>` : "") +
        ` · <a href="${esc(notableMovesHref(shard.period))}">every row for this quarter (JSON)</a>`;
    }
    setStatus(`Showing ${fmtInt(shown.length)} of ${fmtInt(rows.length)} moves for the quarter ended ${shard.period}.`);
  }

  section.addEventListener("click", (ev) => {
    const t = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-moves-period],[data-moves-kind],[data-moves-type],#inst-notable-moves-more") ?? null;
    if (!t) return;
    if (t.id === "inst-notable-moves-more") {
      limit += NOTABLE_MOVES_STEP;
    } else if (t.dataset.movesPeriod) {
      period = t.dataset.movesPeriod;
      limit = NOTABLE_MOVES_SSR_ROWS;
      section.querySelectorAll<HTMLElement>("[data-moves-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.movesPeriod === period)));
      section.dataset.movesPeriod = period;
    } else if (t.dataset.movesKind) {
      const k = t.dataset.movesKind as MoveKind;
      if (kinds.has(k)) kinds.delete(k); else kinds.add(k);
      t.setAttribute("aria-pressed", String(kinds.has(k)));
      limit = NOTABLE_MOVES_SSR_ROWS;
    } else if (t.dataset.movesType) {
      const ty = t.dataset.movesType;
      if (mgrTypes.has(ty)) mgrTypes.delete(ty); else mgrTypes.add(ty);
      t.setAttribute("aria-pressed", String(mgrTypes.has(ty)));
      limit = NOTABLE_MOVES_SSR_ROWS;
    }
    void paint();
  });
}
