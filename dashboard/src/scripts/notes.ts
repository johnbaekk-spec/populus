/* The note binder.

   PROGRESSIVE ENHANCEMENT, NOT THE MECHANISM. `note()` emits a button carrying
   `popovertarget`, so show/hide already works with no JavaScript at all. This
   module adds what the declarative path cannot do — placement outside the
   `.table-scroll` clip, hover-open, Escape, outside-click, re-placement on
   scroll. Its absence degrades a note to click-to-open; never to unreachable.
   At or below the fold (signals-v4 R1, LD3) an open note is a CSS bottom
   sheet: this module then stops anchoring it and adds a Close button.

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

/* signals-v4 R1 (LD3): at or below the fold an OPEN note is a bottom sheet,
   laid out entirely by CSS (late-additions.css). The script then stops
   anchoring: it never calls place(), and it clears the inline coordinates an
   anchored opening may have left, so the stylesheet's sheet wins. Above the
   fold, placement is exactly as before. */
export const SHEET_QUERY = "(max-width: 720px)";

function sheetMode(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(SHEET_QUERY).matches;
}

/** Anchor the panel to its button, or — in sheet mode — leave it to the CSS
    sheet. Returns which it did. */
export function positionPanel(btn: HTMLElement, pop: HTMLElement): "sheet" | "anchored" {
  if (sheetMode()) {
    pop.style.top = "";
    pop.style.left = "";
    pop.style.translate = "";
    return "sheet";
  }
  place(btn, pop);
  return "anchored";
}

/** The sheet's Close button: appended ONCE, by the script only, so the server
    markup (and every parity capture) is unchanged. It hides its own panel
    through `popovertargetaction`, which needs no further script. CSS draws it
    only at or below the fold. Returns whether it appended one. */
export function ensureCloseButton(pop: HTMLElement): boolean {
  if (!pop.id || pop.querySelector(".note-close")) return false;
  const b = pop.ownerDocument.createElement("button");
  b.type = "button";
  b.className = "note-close";
  b.setAttribute("popovertarget", pop.id);
  b.setAttribute("popovertargetaction", "hide");
  b.textContent = "Close";
  pop.appendChild(b);
  return true;
}

/* signals-v4 LD3: the sheet's scrim. The stylesheet draws the dim (the
   popover's `::backdrop`), but a popover's backdrop is not hit-testable: the
   tap that light-dismissed a sheet still landed on whatever lay beneath it.
   Measured on the live page at 390px, a tap on the dim over the sticky tab
   strip closed the sheet AND switched tabs. While a sheet is open the script
   keeps ONE transparent full-viewport element under it (the sheet is in the
   top layer, above everything else), so that tap lands on the scrim: the
   light dismiss still closes the sheet, and nothing beneath is activated.
   Script only: the server markup and every parity capture are unchanged.
   Without JavaScript the native light dismiss still closes the sheet. */
export const SCRIM_CLASS = "note-scrim";
/** Set from the scrim's pointerdown until its gesture ends: a sheet the
    pointerdown light-dismissed must keep its scrim until the click that
    follows has landed on it (on touch that click can arrive after the
    `toggle` that reports the close). */
const PRESSED = "data-pressed";
/** How long a pressed scrim outlives its sheet if its gesture never ends in a
    click on it (dragged off, no pointercancel): never left over the page. */
export const SCRIM_GRACE_MS = 400;

function anySheetOpen(doc: Document, opening: Element | null = null): boolean {
  return sheetMode() && (opening !== null || Array.from(doc.querySelectorAll<HTMLElement>(".note-pop")).some((p) => p.matches(":popover-open")));
}

/* While a scrim exists, any DOM change re-checks it: a re-render that removes
   an open panel hides it with NO toggle event (the HTML removing steps), so
   the sheet hooks never hear of it. Without this the invisible scrim would
   stay over the page, eating the next tap (codex round 1, F1: the entity
   pager replaces a note's table body when its data arrives).
   Each scrim owns its watch, and counts its presses: a late grace timer from
   a scrim already gone touches only that scrim, and one from an earlier
   press on the same scrim does nothing. A sync never restarts a wait, so DOM
   changes during it never extend it (codex round 2, F3: a single shared
   watch let an old scrim's timer disconnect its replacement's). */
const owned = new WeakMap<HTMLElement, { watch: MutationObserver | null; press: number }>();

function dropScrim(scrim: HTMLElement): void {
  scrim.remove();
  owned.get(scrim)?.watch?.disconnect();
}

/** Keep the scrim in step with the sheets: present while a sheet is open,
    gone when none is (a pressed scrim waits for its click, at most
    `SCRIM_GRACE_MS`). `opening` is a panel about to open (its `beforetoggle`),
    counted as open. Returns the scrim, or null when there is none. */
export function syncScrim(doc: Document, opening: Element | null = null): HTMLElement | null {
  let scrim = doc.querySelector<HTMLElement>(`.${SCRIM_CLASS}`);
  if (anySheetOpen(doc, opening)) {
    if (!scrim) {
      const s = doc.createElement("div");
      s.className = SCRIM_CLASS;
      s.setAttribute("aria-hidden", "true");
      const own = { watch: null as MutationObserver | null, press: 0 };
      /* Every press begins its own bounded wait: a press on a scrim kept
         after its sheet closed starts one at once, since no sheet change
         will follow it (codex cycle 2, round 1, F1). A press while a sheet
         is open changes nothing here; the closing it causes starts the wait. */
      s.addEventListener("pointerdown", () => {
        own.press += 1;
        s.setAttribute(PRESSED, "");
        syncScrim(doc);
      });
      s.addEventListener("pointercancel", () => {
        s.removeAttribute(PRESSED);
        syncScrim(doc);
      });
      /* The tap's click: it dismisses and goes no further — no default
         action, no other listener (the document's outside-click handler
         included, so the scrim closes the sheets itself). */
      s.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        s.removeAttribute(PRESSED);
        closeAll();
        syncScrim(doc);
      });
      doc.body.appendChild(s);
      if (typeof MutationObserver === "function") {
        own.watch = new MutationObserver(() => {
          if (!anySheetOpen(doc)) syncScrim(doc);
        });
        own.watch.observe(doc.body, { childList: true, subtree: true });
      }
      owned.set(s, own);
      scrim = s;
    }
    return scrim;
  }
  if (!scrim) return null;
  if (!scrim.hasAttribute(PRESSED)) {
    dropScrim(scrim);
    return null;
  }
  const pressed = scrim;
  const own = owned.get(pressed);
  const press = own?.press;
  setTimeout(() => {
    if (own?.press !== press) return; // a later press began a wait of its own
    pressed.removeAttribute(PRESSED);
    if (!anySheetOpen(doc)) dropScrim(pressed);
  }, SCRIM_GRACE_MS);
  return pressed;
}

function show(btn: HTMLElement, pop: HTMLElement): void {
  if (!supported(pop)) return; // the @supports CSS fallback owns this engine
  if (!pop.matches(":popover-open")) (pop as unknown as { showPopover(): void }).showPopover();
  ensureCloseButton(pop);
  positionPanel(btn, pop);
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
      /* signals-v4 LD3: a tap INSIDE an open sheet (its text, while reading)
         is not an outside click; the scrim, Escape and Close dismiss it */
      if (sheetMode() && (ev.target as Element | null)?.closest?.(".note-pop")) return;
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
        ensureCloseButton(pop);
        positionPanel(btn, pop);
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
    /* signals-v4 LD3: at or below the fold a note is a bottom sheet over the
       page, opened by activation only — a hover-opened sheet would cover the
       content under the pointer (and, covering the trigger, close and reopen
       as the pointer leaves and returns). */
    if (sheetMode()) return;
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
    /* a sheet covers its own trigger: leaving the trigger is not leaving it */
    if (sheetMode()) return;
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
    /* …and focus alone does not raise a sheet (signals-v4 LD3): Enter or
       Space on the focused trigger opens it, through the click channel. */
    if (sheetMode()) return;
    const pop = popOf(btn);
    if (pop) show(btn, pop);
  });

  document.addEventListener("focusout", (ev) => {
    const btn = (ev.target as Element | null)?.closest?.(".note-btn") as HTMLElement | null;
    if (!btn) return;
    /* a tap on the sheet's own text moves focus off the trigger */
    if (sheetMode()) return;
    const pop = popOf(btn);
    if (pop && !pop.hasAttribute(PINNED)) hide(pop);
  });

  /* The scrim rises the moment a sheet opens. `beforetoggle` fires
     synchronously as the panel opens; `toggle` is queued, and a tap made
     before it fires is coalesced with the close into ONE "closed" toggle. So
     a scrim raised from `toggle` was never there for a quick tap (measured in
     a browser: reopen, tap at once, and the tab beneath activated). Nor does
     the click listener's microtask work: it runs before `popovertarget`'s
     activation behaviour, while the panel is still closed. */
  document.addEventListener(
    "beforetoggle",
    (ev) => {
      const pop = ev.target as HTMLElement | null;
      if (pop?.classList?.contains("note-pop") && (ev as Event & { newState?: string }).newState === "open") syncScrim(document, pop);
    },
    true,
  );

  /* Every opening, whatever opened it — the native `popovertarget` toggle
     (touch, keyboard, a click), hover or focus: the panel gets its Close
     button and its placement once it IS open. Every opening and closing
     keeps the sheet's scrim in step. `toggle` does not bubble, so it is caught
     in the capture phase. */
  document.addEventListener(
    "toggle",
    (ev) => {
      const pop = ev.target as HTMLElement | null;
      if (!pop?.classList?.contains("note-pop")) return;
      syncScrim(document);
      if ((ev as Event & { newState?: string }).newState !== "open") return;
      ensureCloseButton(pop);
      const btn = document.querySelector<HTMLElement>(`.note-btn[popovertarget="${pop.id}"]`);
      if (btn) positionPanel(btn, pop);
    },
    true,
  );

  document.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Escape") closeAll();
  });

  /* An open panel is in the top layer and does not scroll with its anchor, so
     it must be re-placed or it detaches from the thing it explains. */
  const replace = (): void => {
    document.querySelectorAll<HTMLElement>(".note-pop").forEach((pop) => {
      if (!pop.matches(":popover-open")) return;
      const btn = document.querySelector<HTMLElement>(`.note-btn[popovertarget="${pop.id}"]`);
      if (btn) positionPanel(btn, pop);
    });
  };
  window.addEventListener("scroll", replace, { passive: true, capture: true });
  window.addEventListener(
    "resize",
    () => {
      replace();
      /* a resize across the fold turns a sheet into an anchored panel, or back */
      syncScrim(document);
    },
    { passive: true },
  );
}
