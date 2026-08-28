/* The note binder.

   PROGRESSIVE ENHANCEMENT, NOT THE MECHANISM. `note()` emits a button carrying
   `popovertarget`, so show/hide already works with no JavaScript at all. This
   module adds what the declarative path cannot do — placement outside the
   `.table-scroll` clip, hover-open, Escape, outside-click, re-placement on
   scroll. Its absence degrades a note to click-to-open; never to unreachable.

   DELEGATED, NOT PER-ELEMENT. Five roots replace their contents with
   innerHTML after page setup — table-sort's paint(), and entity-client's txn
   rows, filer period section, holders table and tail render. A per-element
   binder would leave every note created by those inert, and a rebind hook has
   to be called from all five and will be missed from the sixth. One listener
   set on `document` makes the lifecycle question disappear instead of answering
   it repeatedly.

   The sort collision is NOT handled here: a delegated handler runs
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
  /* Clear the centring translate from the default resting-place rule before applying
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

/* True between pointerdown and the click that follows it.

   `popovertarget`'s activation behaviour runs LAST and TOGGLES, so it must be
   handed a closed panel or a click closes the note. Retracting on pointerdown
   is not enough on its own: mousedown also raises `focusin`, and the focus
   channel re-opened the panel before the toggle ran. Measured transitions were
   closed->open, open->closed, closed->open, open->closed — four flips for one
   click, ending shut.

   While this is set, the hover and focus channels stand down and the native
   toggle owns the transition. Touch and keyboard never enter this path. */
let pointerActive = false;

/** Idempotent: a second call on a page binds nothing further. */
export function initNotes(): void {
  if (bound) return;
  bound = true;

  /* Click PINS — the touch and keyboard channel.

     Two ordering facts drive this, both
     learned from a real browser and invisible to markup tests:

     1. A `popovertarget` button's ACTIVATION BEHAVIOUR runs AFTER the click
        listeners, so anything this handler does to the open state is toggled
        again a moment later. The first fix opened the panel here and the native
        toggle closed it; the note ended shut and marked pinned.
     2. `pointerover` has usually already opened the panel by the time a mouse
        user presses, so the native toggle CLOSES it — hover-then-click
        dismissed the explanation instead of pinning it.

     So: do not fight the toggle, cooperate with it. On pointerdown, retract a
     hover-opened panel so the toggle has a closed panel to open. After the
     click, read the state the toggle actually settled on and record the pin
     from that. Touch and keyboard never fire the hover path, so they simply
     open and pin. */
  /* Retract a HOVER-opened panel on pointerdown.

     Measured sequence without this, from a real browser:
       pointerover -> beforetoggle closed->open   (this module opened it)
       pointerdown, mousedown, mouseup, click
       beforetoggle open->closed                  (popovertarget's toggle)
     The native toggle runs last and sees an already-open panel, so a mouse
     click CLOSED the note instead of pinning it. Retracting here gives the
     toggle a closed panel, so its transition is closed->open and click means
     open on every input. Touch and keyboard never fire pointerover, so they
     were always correct and are unaffected. */
  document.addEventListener("pointerdown", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    pointerActive = true;
    const pop = popOf(btn);
    if (pop && !pop.hasAttribute(PINNED) && pop.matches(":popover-open")) hide(pop);
  });

  /* Release the latch on EVERY terminal pointer path,
     not only on a completed note click.

     The first version cleared it in the click microtask alone, so a press that
     never became a click — drag away, scroll, a cancelled touch, a context menu
     — left it set for the lifetime of the page and silently disabled hover AND
     keyboard focus on every note. A latch that only opens on the happy path is
     a latch that stays shut. Bound on `window` in the capture phase so it fires
     even when the gesture ends outside the document. */
  const releasePointer = (): void => {
    pointerActive = false;
  };
  window.addEventListener("pointerup", releasePointer, { capture: true });
  window.addEventListener("pointercancel", releasePointer, { capture: true });
  window.addEventListener("blur", releasePointer);

  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) {
      closeAll();
      return;
    }
    const pop = popOf(btn);
    if (!pop) return;
    closeAll(pop);
    /* Deferred so the activation behaviour has settled. Reading the state
       synchronously here reads the state BEFORE the toggle, which is what
       produced a pinned-but-hidden panel. */
    queueMicrotask(() => {
      pointerActive = false;
      if (pop.matches(":popover-open")) {
        pop.setAttribute(PINNED, "true");
        place(btn, pop);
      } else {
        pop.removeAttribute(PINNED);
      }
    });
  });

  document.addEventListener("pointerover", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    const pop = popOf(btn);
    if (!pop || pop.hasAttribute(PINNED) || pointerActive) return;
    /* Hover opens only when the pointer is NOT pressed. A
       hover-opened panel plus `popovertarget`'s toggle raced every mouse click:
       whichever ran last decided, and the note ended shut. Letting the native
       toggle own the click transition entirely is the only version that agrees
       across pointer, touch and keyboard. */
    show(btn, pop);
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
    /* Keyboard focus is a first-class channel; focus raised BY a mouse press is
       not — it would re-open the panel the pointerdown retraction just closed,
       and the native toggle would then shut it. */
    if (pointerActive) return;
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
