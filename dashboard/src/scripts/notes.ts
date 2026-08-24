/* SL-R2 / SL-R3 / SL-R28: the note binder.

   PROGRESSIVE ENHANCEMENT, NOT THE MECHANISM. `note()` emits a button carrying
   `popovertarget`, so show/hide already works with no JavaScript at all. This
   module adds what the declarative path cannot do — placement outside the
   `.table-scroll` clip, hover-open, Escape, outside-click, re-placement on
   scroll. Its absence degrades a note to click-to-open; never to unreachable.

   DELEGATED, NOT PER-ELEMENT (SL-R2). Five roots replace their contents with
   innerHTML after page setup — table-sort's paint(), and entity-client's txn
   rows, filer period section, holders table and tail render. A per-element
   binder would leave every note created by those inert, and a rebind hook has
   to be called from all five and will be missed from the sixth. One listener
   set on `document` makes the lifecycle question disappear instead of answering
   it repeatedly.

   The sort collision is NOT handled here (SL-R25): a delegated handler runs
   AFTER the <th>'s own listener in the bubble phase — too late to stop a sort —
   and moving it to the capture phase would stop the event before the button
   receives it, breaking popovertarget. The guard lives in table-sort.ts. */

const PINNED = "data-note-pinned";

function popOf(btn: Element): HTMLElement | null {
  const id = btn.getAttribute("popovertarget");
  return id ? (document.getElementById(id) as HTMLElement | null) : null;
}

function supported(pop: HTMLElement): boolean {
  return typeof (pop as unknown as { showPopover?: unknown }).showPopover === "function";
}

/** Place the panel under its anchor, flipped up when it would leave the
    viewport and clamped horizontally. The panel is in the top layer, so these
    are viewport coordinates and the `.table-scroll` clip does not apply. */
function place(btn: HTMLElement, pop: HTMLElement): void {
  const a = btn.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const gap = 6;
  let top = a.bottom + gap;
  if (top + p.height > window.innerHeight && a.top - gap - p.height >= 0) {
    top = a.top - gap - p.height;
  }
  let left = a.left + a.width / 2 - p.width / 2;
  left = Math.max(gap, Math.min(left, window.innerWidth - p.width - gap));
  /* Clear the centring translate from the SL-R2b default rule before applying
     real coordinates, or an anchored panel would be shifted by half its own
     size. Inline styles beat the stylesheet, so this is the only interaction
     between the two positioning paths. */
  pop.style.translate = "none";
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

function show(btn: HTMLElement, pop: HTMLElement): void {
  if (!supported(pop)) return; // the @supports CSS fallback owns this engine
  if (!pop.matches(":popover-open")) (pop as unknown as { showPopover(): void }).showPopover();
  place(btn, pop);
}

function hide(pop: HTMLElement): void {
  if (!supported(pop)) return;
  if (pop.matches(":popover-open")) (pop as unknown as { hidePopover(): void }).hidePopover();
  pop.removeAttribute(PINNED);
}

function closeAll(except?: Element | null): void {
  document.querySelectorAll<HTMLElement>(".note-pop").forEach((pop) => {
    if (pop !== except) hide(pop);
  });
}

let bound = false;

/** Idempotent: a second call on a page binds nothing further. */
export function initNotes(): void {
  if (bound) return;
  bound = true;

  /* Click PINS — the touch and keyboard channel. popovertarget has already
     toggled the panel by the time this runs; we only record the pin and place
     it, so behaviour with and without this module agrees. */
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) {
      closeAll();
      return;
    }
    const pop = popOf(btn);
    if (!pop) return;
    closeAll(pop);
    if (pop.matches(":popover-open")) {
      pop.setAttribute(PINNED, "true");
      place(btn, pop);
    }
  });

  document.addEventListener("pointerover", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    const pop = popOf(btn);
    if (pop) show(btn, pop);
  });

  document.addEventListener("pointerout", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    const pop = popOf(btn);
    if (pop && !pop.hasAttribute(PINNED)) hide(pop);
  });

  /* Focus is a first-class channel, not a mouse fallback. */
  document.addEventListener("focusin", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    const pop = popOf(btn);
    if (pop) show(btn, pop);
  });

  document.addEventListener("focusout", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    const pop = popOf(btn);
    if (pop && !pop.hasAttribute(PINNED)) hide(pop);
  });

  document.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Escape") closeAll();
  });

  /* An open panel is in the top layer and does not scroll with its anchor, so
     it must be re-placed or it detaches from the thing it explains. */
  const replace = (): void => {
    document.querySelectorAll<HTMLElement>(".note-pop").forEach((pop) => {
      if (!pop.matches(":popover-open")) return;
      const btn = document.querySelector<HTMLElement>(`.note-btn[popovertarget="${pop.id}"]`);
      if (btn) place(btn, pop);
    });
  };
  window.addEventListener("scroll", replace, { passive: true, capture: true });
  window.addEventListener("resize", replace, { passive: true });
}
