/* A-2 client island for /institutional: name/CIK search + sortable headers
   over the embedded index rows. Sorting and filtering are the SAME pure
   functions the SSR page used, so the re-rendered order can never drift from
   the pre-rendered one. All work happens on this device.

   R48: the header/direction/aria/announcement plumbing now comes from the
   shared `initSortableTable`, which owns NO ordering semantics. Comparison,
   the ranked/unranked split and the tie-break stay here, in the domain — that
   separation is the whole point (external plan review F2), and it is why this
   refactor changes no observable behaviour. `inst-index-client.test.ts` pins
   that: it captures this island's output and asserts it is unchanged. */

import { type InstIndexRow, type InstSortKey } from "../lib/inst-index.ts";
import { COMPACT_ROWS, syncTerminusFor } from "../lib/format.ts";
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

/* F3: `instIndexBodyHtml` and `instDefaultDir` MOVED to `lib/inst-index.ts`.

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

  /* F13: ONE state machine for the directory.

     Search, sort, the type chips and the notable chip all feed the same pure
     pipeline and the same single render. They used to be two owners of one
     `<tbody>` — the sort/search island rebuilt it, and a separate chip island
     hid rows in it afterwards — so any sort silently un-hid every manager the
     chips had filtered out while the chip stayed pressed. */
  let q = "";
  let lastNote = "";
  const types = new Set<string>();
  let notableOnly = false;
  let expanded = false;

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

  function syncDisclosure(total: number, _shown: number): void {
    if (!disclosure || !disclosureBtn) return;
    // F16: the label is derived from the COMPACT LIMIT, not from how many rows
    // are rendered right now. Using the shown count made an expanded control
    // promise to keep every row it was about to collapse away.
    const hidden = Math.max(0, total - COMPACT_ROWS);
    // F6: the sentence and the button commit TOGETHER, in this one pass. A
    // chip that drops the directory below the compact bound must retract both.
    syncTerminusFor(disclosure, expanded ? 0 : hidden, {
      text:
        `${hidden.toLocaleString("en-US")} further ${noun} are not rendered above — ` +
        `a Public Filings render bound, not a data bound.`,
    });
    if (hidden === 0) {
      disclosure.hidden = true;
      expanded = false;
      return;
    }
    disclosure.hidden = false;
    disclosureBtn.setAttribute("aria-expanded", String(expanded));
    disclosureBtn.textContent = expanded
      ? `Show only the first ${COMPACT_ROWS.toLocaleString("en-US")} ${noun}`
      : `Show all ${total.toLocaleString("en-US")} ${noun} (${hidden.toLocaleString("en-US")} more)`;
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

/** R9/R20/R21 — the closed-period selector and the new-only toggle.

    F12: EVERY VISIBLE CLAIM COMMITS TOGETHER, AFTER the payload arrives.
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

  /* F27: the SHARED plumbing owns header wiring, direction toggling,
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
    if (!disclosure || !disclosureBtn) return;
    // F16: derived from the LIMIT, not from the rendered count.
    const hidden = Math.max(0, rows.length - COMPACT_ROWS);
    // F6: the named bound moves with the quarter. Its sentence carries the link
    // to THIS period and mode's published payload, so the no-JS route the SSR
    // view offered is still correct after a selection — which is why this one
    // writes html rather than text.
    syncTerminusFor(disclosure, expanded ? 0 : hidden, {
      html:
        `${hidden.toLocaleString("en-US")} further issuers are not rendered above — ` +
        `a Public Filings render bound, not a data bound. Every issuer in this quarter's ` +
        `bounded payload remains in <a href="${addsPayloadHref(period, mode)}">the published JSON</a>.`,
    });
    if (hidden === 0) {
      disclosure.hidden = true;
      expanded = false;
      return;
    }
    disclosure.hidden = false;
    disclosureBtn.setAttribute("aria-expanded", String(expanded));
    disclosureBtn.textContent = expanded
      ? `Show only the first ${COMPACT_ROWS.toLocaleString("en-US")} issuers`
      : `Show all ${rows.length.toLocaleString("en-US")} issuers (${hidden.toLocaleString("en-US")} more)`;
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
      // F14: through `addsPayloadHref`, the SAME builder the section's no-JS
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
    /* SL-R9: same split, same removal. The plan named only `applyRollup`; this
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

/** R7/F2 — the generic compact-disclosure owner for tables whose FULL body is
    already in the DOM (the institutional activity feed).

    The congress ranking sections and the manager directory re-render their
    rows from data, so they own their own disclosures. This one has no data to
    re-render from: the rows are present and the control simply reveals them.
    Two mechanisms, because the two situations are genuinely different — but
    every named root now has exactly one owner, which is what R18 asks for. */
export function initDomDisclosures(): void {
  document
    .querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]")
    .forEach((wrap) => {
      const rootId = wrap.dataset.compactFor ?? "";
      const root = document.getElementById(rootId);
      const btn = wrap.querySelector("button");
      if (!root || !btn) return;
      const total = Number(wrap.dataset.compactTotal ?? 0);
      const shown = Number(wrap.dataset.compactShown ?? 0);
      const noun = wrap.dataset.compactNoun ?? "rows";
      const hidden = total - shown;
      if (hidden <= 0) return; // R7's omission rule — nothing to disclose
      // F2: the SERVER already rendered this collapsed, so this is normally a
      // no-op. It stays because an island that assumes the server did its half
      // acquires a second precondition, and this one is idempotent.
      root.setAttribute("data-collapsed", "true");
      wrap.removeAttribute("hidden");
      let expanded = false;
      btn.addEventListener("click", () => {
        expanded = !expanded;
        root.setAttribute("data-collapsed", String(!expanded));
        btn.setAttribute("aria-expanded", String(expanded));
        btn.textContent = expanded
          ? `Show only the first ${shown.toLocaleString("en-US")} ${noun}`
          : `Show all ${total.toLocaleString("en-US")} ${noun} (${hidden.toLocaleString("en-US")} more)`;
      });
    });
}
