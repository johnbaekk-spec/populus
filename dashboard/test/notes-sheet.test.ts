/* signals-v4 M1 (R1, LD3, T1.2): the note's bottom sheet.

   At or below the fold an OPEN note is a bottom sheet laid out by CSS
   (late-additions.css; its rules are pinned in css-fold.test.ts). The
   script's share, run here over a fake DOM:
   - under a matching `(max-width: 720px)` it never anchors the panel — place()
     is not called — and clears the inline coordinates an anchored opening
     left, so the stylesheet's sheet wins; above the fold it anchors as before;
   - it appends ONE Close button, `popovertargetaction="hide"`, from the script
     only (the server markup, and every parity capture, are unchanged);
   - in sheet mode hover and focus do not open a sheet, a tap inside an open
     sheet does not close it, and leaving the trigger does not close it — the
     scrim, Escape, Close and the trigger dismiss it; above the fold hover and
     focus open as before;
   - while a sheet is open it keeps ONE transparent scrim element over the
     page, so the tap that dismisses the sheet lands on the scrim and never on
     what lies beneath it (the `::backdrop` draws the dim but is not
     hit-testable: measured live at 390px, that tap also switched tabs). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureCloseButton, initNotes, positionPanel, SCRIM_CLASS, SCRIM_GRACE_MS, SHEET_QUERY, syncScrim } from "../src/scripts/notes.ts";
import { note } from "../src/lib/format.ts";

interface FakeEl {
  id: string;
  className: string;
  type?: string;
  textContent: string;
  style: { top: string; left: string; translate: string };
  attrs: Map<string, string>;
  children: FakeEl[];
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  hasAttribute(n: string): boolean;
  closest(sel: string): FakeEl | null;
  querySelector(sel: string): FakeEl | null;
  appendChild(c: FakeEl): void;
  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number };
  readonly classList: { contains(c: string): boolean };
  ownerDocument: { createElement(tag: string): FakeEl };
  matches(q: string): boolean;
  showPopover(): void;
  hidePopover(): void;
  rectReads: number;
  open: boolean;
  listeners: Map<string, ((ev: unknown) => void)[]>;
  addEventListener(t: string, fn: (ev: unknown) => void): void;
  dispatch(t: string, ev?: Record<string, unknown>): { prevented: boolean; stopped: boolean };
  remove(): void;
  parent: { children: FakeEl[] } | null;
}

function el(cls: string, id = ""): FakeEl {
  const e: FakeEl = {
    id,
    className: cls,
    textContent: "",
    style: { top: "", left: "", translate: "" },
    attrs: new Map(),
    children: [],
    rectReads: 0,
    open: false,
    listeners: new Map(),
    parent: null,
    addEventListener: (t, fn) => void e.listeners.set(t, [...(e.listeners.get(t) ?? []), fn]),
    dispatch: (t, ev = {}) => {
      const out = { prevented: false, stopped: false };
      const evt = { ...ev, target: e, preventDefault: () => void (out.prevented = true), stopPropagation: () => void (out.stopped = true) };
      for (const fn of e.listeners.get(t) ?? []) fn(evt);
      return out;
    },
    remove: () => {
      if (e.parent) e.parent.children = e.parent.children.filter((c) => c !== e);
      e.parent = null;
    },
    getAttribute: (n) => e.attrs.get(n) ?? null,
    setAttribute: (n, v) => void e.attrs.set(n, v),
    removeAttribute: (n) => void e.attrs.delete(n),
    hasAttribute: (n) => e.attrs.has(n),
    closest: (sel) => (sel === `.${cls.split(" ")[0]}` || cls.split(" ").some((c) => sel === `.${c}`) ? e : null),
    querySelector: (sel) => (sel === ".note-close" ? e.children.find((c) => c.className === "note-close") ?? null : null),
    appendChild: (c) => void e.children.push(c),
    getBoundingClientRect: () => {
      e.rectReads++;
      return { top: 100, bottom: 120, left: 100, right: 120, width: 20, height: 20 };
    },
    get classList() {
      return { contains: (c: string) => e.className.split(" ").includes(c) };
    },
    ownerDocument: { createElement: () => el("") },
    matches: (q) => (q === ":popover-open" ? e.open : false),
    showPopover: () => void (e.open = true),
    hidePopover: () => void (e.open = false),
  };
  return e;
}

/** A note's trigger and panel, and a window whose fold query matches when `narrow` is set. */
function env() {
  const btn = el("note-btn note-mark");
  const pop = el("note-pop", "n-x-about");
  btn.setAttribute("popovertarget", pop.id);
  const state = { narrow: true };
  const handlers = new Map<string, ((ev: unknown) => void)[]>();
  const on = (t: string, fn: (ev: unknown) => void): void => void handlers.set(t, [...(handlers.get(t) ?? []), fn]);
  const body: { children: FakeEl[]; appendChild(c: FakeEl): void } = {
    children: [],
    appendChild: (c) => {
      body.children.push(c);
      c.parent = body;
    },
  };
  const doc = {
    body,
    addEventListener: on,
    createElement: () => el(""),
    getElementById: (id: string) => (id === pop.id ? pop : null),
    querySelectorAll: (sel: string) => (sel === ".note-pop" ? [pop] : []),
    querySelector: (sel: string) =>
      sel === `.note-btn[popovertarget="${pop.id}"]` ? btn : sel === `.${SCRIM_CLASS}` ? (body.children.find((c) => c.className === SCRIM_CLASS) ?? null) : null,
  };
  const scrims = (): FakeEl[] => body.children.filter((c) => c.className === SCRIM_CLASS);
  const winHandlers = new Map<string, ((ev: unknown) => void)[]>();
  const win = {
    innerWidth: 390,
    innerHeight: 844,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void winHandlers.set(t, [...(winHandlers.get(t) ?? []), fn]),
    matchMedia: (q: string) => ({ matches: q === SHEET_QUERY && state.narrow, addEventListener() {} }),
  };
  const fire = (type: string, ev: unknown): void => {
    for (const fn of handlers.get(type) ?? []) fn(ev);
  };
  const fireWin = (type: string): void => {
    for (const fn of winHandlers.get(type) ?? []) fn({});
  };
  return { btn, pop, state, doc, win, fire, fireWin, scrims };
}

test("LD3: under a matching (max-width: 720px) place() is not called and the inline coordinates are cleared; above the fold place() anchors as before", () => {
  const e = env();
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.window;
  g.window = e.win;
  try {
    e.pop.style.top = "300px";
    e.pop.style.left = "40px";
    e.pop.style.translate = "none";
    assert.equal(positionPanel(e.btn as never, e.pop as never), "sheet");
    assert.equal(e.btn.rectReads, 0, "place() never measured the trigger");
    assert.deepEqual(e.pop.style, { top: "", left: "", translate: "" }, "the CSS sheet wins");
    e.state.narrow = false;
    assert.equal(positionPanel(e.btn as never, e.pop as never), "anchored");
    assert.ok(e.btn.rectReads > 0, "place() measured the trigger");
    assert.equal(e.pop.style.translate, "none", "place() clears the default centring");
    assert.match(e.pop.style.top, /^\d+px$/);
  } finally {
    g.window = prev;
  }
});

test("LD3: one Close button is appended, once, by the script — popovertarget its own panel, popovertargetaction hide", () => {
  const pop = el("note-pop", "n-x-why");
  assert.equal(ensureCloseButton(pop as never), true);
  assert.equal(ensureCloseButton(pop as never), false, "never twice");
  assert.equal(pop.children.length, 1);
  const b = pop.children[0]!;
  assert.deepEqual([b.className, b.type, b.textContent, b.getAttribute("popovertarget"), b.getAttribute("popovertargetaction")], ["note-close", "button", "Close", "n-x-why", "hide"]);
  // the server never renders it: the note primitive's markup carries no Close button
  assert.doesNotMatch(note("A definition.", { scope: "t" }, "k", { trigger: "mark", name: "About x" }), /note-close|Close</);
});

test("LD3: in sheet mode hover and focus do not open a sheet, leaving the trigger or a tap inside the sheet does not close it; an opening appends Close; above the fold hover and focus open as before", async () => {
  const e = env();
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, document: g.document, queueMicrotask: g.queueMicrotask };
  g.window = e.win;
  g.document = e.doc;
  try {
    initNotes();
    // sheet mode
    e.fire("pointerover", { target: e.btn });
    assert.equal(e.pop.open, false, "hover does not raise a sheet");
    e.fire("focusin", { target: e.btn });
    assert.equal(e.pop.open, false, "focus alone does not raise a sheet");
    // an activation opens it natively; the toggle hook adds Close and leaves placement to CSS
    e.pop.open = true;
    e.fire("toggle", { target: e.pop, newState: "open" });
    assert.equal(e.pop.children.filter((c) => c.className === "note-close").length, 1, "the opening appended Close");
    assert.equal(e.scrims().length, 1, "the opening put one scrim over the page");
    assert.equal(e.btn.rectReads, 0, "the sheet was not anchored");
    e.fire("pointerout", { target: e.btn });
    assert.equal(e.pop.open, true, "the sheet covers its trigger: leaving the trigger does not close it");
    e.fire("focusout", { target: e.btn });
    assert.equal(e.pop.open, true, "a tap on the sheet's own text moves focus: it stays open");
    const inside = el("note-pop-text");
    inside.closest = (sel: string) => (sel === ".note-pop" ? e.pop : null);
    e.fire("click", { target: inside });
    assert.equal(e.pop.open, true, "a tap inside the sheet is not an outside click");
    e.fire("keydown", { key: "Escape" });
    assert.equal(e.pop.open, false, "Escape closes it");
    e.fire("toggle", { target: e.pop, newState: "closed" });
    assert.equal(e.scrims().length, 0, "the closing took the scrim away");
    // the opening raises the scrim at once, from `beforetoggle` (synchronous,
    // the panel still closed), with no `toggle` event: the opening's queued
    // toggle can be coalesced with a quick tap's close into one "closed"
    // event, and that tap must already land on the scrim
    e.fire("beforetoggle", { target: e.pop, newState: "open" });
    assert.equal(e.pop.open, false, "beforetoggle: the panel is not open yet");
    assert.equal(e.scrims().length, 1, "the scrim rose before any toggle event");
    e.pop.open = true; // the native popovertarget toggle
    e.fire("click", { target: e.btn });
    await Promise.resolve();
    assert.equal(e.scrims().length, 1, "still one scrim");
    // a resize across the fold, through the handler initNotes registered:
    // the open panel stops being a sheet (no scrim), then is one again
    e.state.narrow = false;
    e.fireWin("resize");
    assert.equal(e.scrims().length, 0, "widened past the fold: an anchored panel has no scrim");
    e.state.narrow = true;
    e.fireWin("resize");
    assert.equal(e.scrims().length, 1, "narrowed back: the open panel is a sheet again, with its scrim");
    e.fire("keydown", { key: "Escape" }); // closes and unpins, as a reader would
    e.fire("toggle", { target: e.pop, newState: "closed" });
    assert.equal(e.pop.open, false);
    assert.equal(e.scrims().length, 0);
    // above the fold
    e.state.narrow = false;
    e.fire("pointerover", { target: e.btn });
    assert.equal(e.pop.open, true, "hover opens above the fold");
    assert.ok(e.btn.rectReads > 0, "and anchors the panel");
    e.fire("pointerout", { target: e.btn });
    assert.equal(e.pop.open, false, "and closes it on leaving, as before");
    e.fire("focusin", { target: e.btn });
    assert.equal(e.pop.open, true, "focus opens above the fold");
  } finally {
    g.window = prev.window;
    g.document = prev.document;
  }
});

test("LD3 (phones): an open sheet keeps one scrim over the page; the tap that dismisses the sheet lands on it and goes no further; it never outlives its sheet", () => {
  const e = env();
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, document: g.document, setTimeout: g.setTimeout, MutationObserver: g.MutationObserver };
  g.window = e.win;
  g.document = e.doc;
  // controlled time: the grace period is asserted at its edges, not waited out
  let now = 0;
  const timers: { at: number; fn: () => void; done: boolean }[] = [];
  g.setTimeout = (fn: () => void, ms: number) => timers.push({ at: now + ms, fn, done: false });
  const advance = (ms: number): void => {
    now += ms;
    for (const t of timers) if (!t.done && t.at <= now) { t.done = true; t.fn(); }
  };
  // a DOM watch the test can trigger: a re-render that removes an open panel fires no toggle
  const watches: { cb: () => void; on: boolean }[] = [];
  g.MutationObserver = class {
    w: { cb: () => void; on: boolean };
    constructor(cb: () => void) { this.w = { cb, on: false }; watches.push(this.w); }
    observe() { this.w.on = true; }
    disconnect() { this.w.on = false; }
  };
  const mutate = (): void => { for (const w of watches) if (w.on) w.cb(); };
  try {
    // no sheet open: no scrim
    assert.equal(syncScrim(e.doc as never), null);
    assert.equal(e.scrims().length, 0);
    // a sheet opens: one scrim, hidden from assistive tech, idempotent
    e.pop.open = true;
    const s = syncScrim(e.doc as never) as unknown as FakeEl;
    assert.ok(s);
    assert.equal(syncScrim(e.doc as never), s as never, "never a second scrim");
    assert.equal(e.scrims().length, 1);
    assert.equal(s.getAttribute("aria-hidden"), "true");
    // the tap: its click is stopped and its default prevented, the sheet closes, the scrim goes
    const tap = s.dispatch("click");
    assert.deepEqual(tap, { prevented: true, stopped: true }, "the click goes no further than the scrim");
    assert.equal(e.pop.open, false, "the tap dismissed the sheet");
    assert.equal(e.scrims().length, 0, "and took the scrim with it");
    // Escape or Close (no press): the closing removes the scrim at once
    e.pop.open = true;
    syncScrim(e.doc as never);
    e.pop.open = false;
    assert.equal(syncScrim(e.doc as never), null);
    assert.equal(e.scrims().length, 0);
    // a press that light-dismissed the sheet keeps the scrim for its click…
    e.pop.open = true;
    const s2 = syncScrim(e.doc as never) as unknown as FakeEl;
    s2.dispatch("pointerdown");
    e.pop.open = false; // the light dismiss
    assert.equal(syncScrim(e.doc as never), s2 as never, "a pressed scrim waits for its click");
    assert.equal(e.scrims().length, 1);
    s2.dispatch("click");
    assert.equal(e.scrims().length, 0, "…which removes it");
    // …and a press that never ends in a click on it (dragged off) leaves after the grace period, not before
    assert.equal(SCRIM_GRACE_MS, 400);
    e.pop.open = true;
    const s3 = syncScrim(e.doc as never) as unknown as FakeEl;
    s3.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never);
    assert.equal(e.scrims().length, 1);
    advance(399);
    assert.equal(e.scrims().length, 1, "kept for its click until the grace period ends");
    advance(1);
    assert.equal(e.scrims().length, 0, "never left over the page");
    // a sheet reopened before an old timer fires keeps its scrim
    e.pop.open = true;
    const s5 = syncScrim(e.doc as never) as unknown as FakeEl;
    s5.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never); // the grace timer starts
    e.pop.open = true;
    assert.equal(syncScrim(e.doc as never), s5 as never, "reopened: the same scrim");
    advance(SCRIM_GRACE_MS);
    assert.equal(e.scrims().length, 1, "the old timer does not take the reopened sheet's scrim");
    assert.equal(s5.hasAttribute("data-pressed"), false);
    e.pop.open = false;
    syncScrim(e.doc as never);
    assert.equal(e.scrims().length, 0);
    // codex round 1, F1: an open panel removed by a re-render closes with no toggle; the DOM watch drops the scrim
    e.pop.open = true;
    syncScrim(e.doc as never);
    assert.equal(e.scrims().length, 1);
    assert.equal(watches.filter((w) => w.on).length, 1, "one DOM watch while the scrim exists");
    e.pop.open = false; // removed: hidden, and no toggle event
    mutate();
    assert.equal(e.scrims().length, 0, "the DOM watch dropped the scrim");
    assert.equal(watches.filter((w) => w.on).length, 0, "and stopped watching");
    // codex round 2, F3: an old scrim's late timer never touches its replacement
    e.pop.open = true;
    const a = syncScrim(e.doc as never) as unknown as FakeEl;
    a.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never); // A's grace timer starts
    a.dispatch("click"); // A's click lands: A goes, its timer still pending
    assert.equal(e.scrims().length, 0);
    advance(100);
    e.pop.open = true;
    const b = syncScrim(e.doc as never) as unknown as FakeEl;
    assert.notEqual(b, a, "a new scrim");
    b.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never); // B's grace timer starts
    advance(300); // A's timer fires
    assert.equal(e.scrims().length, 1, "B still waits for its click");
    assert.equal(watches.filter((w) => w.on).length, 1, "B's DOM watch survives A's late timer");
    e.pop.open = true;
    assert.equal(syncScrim(e.doc as never), b as never, "reopened before B's own timer");
    advance(100); // B's timer: its sheet is open, so it stays
    assert.equal(e.scrims().length, 1);
    e.pop.open = false; // a re-render removes the reopened panel: no toggle
    mutate();
    assert.equal(e.scrims().length, 0, "the DOM watch still drops B");
    assert.equal(watches.filter((w) => w.on).length, 0);
    // …and an earlier press's timer never cuts a later press's wait short
    e.pop.open = true;
    const c = syncScrim(e.doc as never) as unknown as FakeEl;
    c.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never); // the first wait
    advance(200);
    e.pop.open = true;
    assert.equal(syncScrim(e.doc as never), c as never);
    c.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never); // the second wait, restarted
    advance(200); // the first timer fires
    assert.equal(e.scrims().length, 1, "the second press still waits for its click");
    assert.equal(c.hasAttribute("data-pressed"), true);
    advance(199);
    assert.equal(e.scrims().length, 1);
    advance(1);
    assert.equal(e.scrims().length, 0, "gone when the second wait ends");
    // …and a second press on a scrim kept after its sheet closed, with no sheet change after it, has its own wait (codex cycle 2, round 1, F1)
    e.pop.open = true;
    const k = syncScrim(e.doc as never) as unknown as FakeEl;
    k.dispatch("pointerdown");
    e.pop.open = false; // removed: no toggle
    mutate(); // the DOM watch starts the first wait
    advance(200);
    k.dispatch("pointerdown"); // pressed again, the sheet still closed; dragged off: no click, no pointercancel
    advance(200); // the first wait's timer fires, superseded
    assert.equal(e.scrims().length, 1, "the second press waits for its click");
    advance(199);
    assert.equal(e.scrims().length, 1, "for the whole grace period after it");
    advance(1);
    assert.equal(e.scrims().length, 0, "and no longer: never left over the page");
    assert.equal(watches.filter((w) => w.on).length, 0);
    // …and DOM changes during a wait never extend it
    e.pop.open = true;
    const d = syncScrim(e.doc as never) as unknown as FakeEl;
    d.dispatch("pointerdown");
    e.pop.open = false;
    syncScrim(e.doc as never);
    for (let i = 0; i < 3; i++) {
      advance(130);
      mutate();
    }
    assert.equal(e.scrims().length, 1, "390ms in, still waiting for its click");
    advance(10);
    assert.equal(e.scrims().length, 0, "the wait ends on time, however busy the page");
    // a cancelled press removes it too
    e.pop.open = true;
    const s4 = syncScrim(e.doc as never) as unknown as FakeEl;
    s4.dispatch("pointerdown");
    e.pop.open = false;
    s4.dispatch("pointercancel");
    assert.equal(e.scrims().length, 0);
    // above the fold an open panel is anchored, not a sheet: no scrim
    e.state.narrow = false;
    e.pop.open = true;
    assert.equal(syncScrim(e.doc as never), null);
    assert.equal(e.scrims().length, 0);
  } finally {
    g.window = prev.window;
    g.document = prev.document;
    g.setTimeout = prev.setTimeout;
    g.MutationObserver = prev.MutationObserver;
  }
});

test("LD3: notes.ts carries the sheet branch and the toggle hook in source (one component: the sheet applies wherever note() renders)", () => {
  const src = readFileSync(new URL("../src/scripts/notes.ts", import.meta.url), "utf8");
  assert.match(src, /export const SHEET_QUERY = "\(max-width: 720px\)";/);
  assert.match(src, /document\.addEventListener\(\s*"toggle",/, "every opening, whatever opened it");
  // no page restyles .note* (LD21; sl-notes.spec.ts): the sheet is in the one stylesheet
  const page = readFileSync(new URL("../src/pages/signals/index.astro", import.meta.url), "utf8");
  assert.doesNotMatch(page, /<style[^>]*>[^]*\.note/);
});
