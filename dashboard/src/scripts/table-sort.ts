/* Shared sortable-table PLUMBING. Deliberately owns no ordering semantics.

   External plan review (round 2, F2) rejected an earlier design that shared a
   comparator across surfaces: the institutional index orders scalars and names,
   the congress feed orders statutory amount ranges, and `compareNet` orders
   six-state intervals. Those are genuinely different orderings, and a helper
   that unified them would have to change at least one shipping surface.

   So this module owns ONLY what is identical everywhere: header wiring,
   direction toggling, `aria-sort` maintenance, the live-region announcement,
   and swapping the rendered rows in. Comparison, the rankable/unrankable split,
   and tie-breaks stay with the caller, which is the only place that knows what
   a null means for a given column. `render` returns finished HTML; this module
   never inspects a row.

   No dependencies, no framework — the dashboard ships zero framework code. */

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** The narrow DOM surface this module touches, so it can be exercised without a
    browser. Real elements satisfy it structurally. */
export interface SortHeaderEl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  /* SL-R25: the listener now receives the event so it can ignore clicks that
     originated inside a `.note-btn`. Typed as an optional structural argument
     rather than the DOM `Event`, so the fake-DOM tests that satisfy this
     interface keep working and can dispatch a bare `{ target }`. */
  addEventListener(type: "click", listener: (ev?: { target?: unknown }) => void): void;
}

export interface SortRootEl {
  innerHTML: string;
}

export interface StatusEl {
  textContent: string | null;
}

export interface SortableTableOptions {
  /** Element whose innerHTML is replaced on each render (usually a tbody). */
  root: SortRootEl;
  /** The sortable header cells, in any order. */
  headers: readonly SortHeaderEl[];
  /** Reads a header's column key. Returning undefined skips that header. */
  keyOf: (th: SortHeaderEl) => string | undefined;
  /** Sort shown on first paint. Must match what the server rendered. */
  initial: SortState;
  /** Direction applied when switching TO a column. Caller-owned, because the
      sensible default differs by column kind (names ascend, values descend). */
  defaultDir: (key: string) => "asc" | "desc";
  /** Caller owns ALL ordering — comparison, bucketing, tie-breaks — and returns
      finished row HTML. This module never sees a row. */
  render: (state: SortState) => string;
  /** Optional screen-reader/status text for the current state. */
  announce?: (state: SortState) => string;
  statusEl?: StatusEl | null;
}

/** Wire a table for click-to-sort. Returns a function that re-renders at the
    current state, for callers that replace the table body for other reasons
    (a period swap, a filter change) and need to reapply the active sort. */
export function initSortableTable(options: SortableTableOptions): () => void {
  const { root, headers, keyOf, defaultDir, render, announce, statusEl } = options;
  const state: SortState = { key: options.initial.key, dir: options.initial.dir };

  function syncHeaders(): void {
    for (const th of headers) {
      const key = keyOf(th);
      if (key === undefined) continue;
      th.setAttribute(
        "aria-sort",
        key === state.key ? (state.dir === "desc" ? "descending" : "ascending") : "none",
      );
    }
  }

  function paint(): void {
    root.innerHTML = render(state);
    syncHeaders();
    if (statusEl && announce) statusEl.textContent = announce(state);
  }

  for (const th of headers) {
    const key = keyOf(th);
    if (key === undefined) continue;
    th.addEventListener("click", (ev?: { target?: unknown }) => {
      /* SL-R25: a note button lives inside this <th>, and this listener is on
         the <th> itself with no target check — so activating a note would sort
         the table. The guard belongs HERE and not in the note's own handler:
         delegated on document it runs AFTER this listener in the bubble phase
         (too late), and in the capture phase it would stop the event before the
         button received it, breaking popovertarget and with it the
         no-JavaScript open path. This placement is correct in both phases. */
      /* The event is OPTIONAL: the fake-DOM doubles in this repo's tests call
         the listener bare, and a real browser always supplies it. Absent event
         or absent target means "not a note click", which is the safe default —
         the sort proceeds exactly as it did before SL-R25. */
      const t = ev?.target as { closest?: (sel: string) => unknown } | undefined;
      if (t && typeof t.closest === "function" && t.closest(".note-btn")) return;
      if (key === state.key) {
        state.dir = state.dir === "desc" ? "asc" : "desc";
      } else {
        state.key = key;
        state.dir = defaultDir(key);
      }
      paint();
    });
  }

  // Reflect the server-rendered state without repainting: the SSR body is
  // already correct, and repainting on load would risk a visible flash and
  // would mask a server/client ordering disagreement instead of exposing it.
  syncHeaders();

  return paint;
}
