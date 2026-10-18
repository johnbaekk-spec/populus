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
     focus open as before. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureCloseButton, initNotes, positionPanel, SHEET_QUERY } from "../src/scripts/notes.ts";
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
  const doc = {
    addEventListener: on,
    getElementById: (id: string) => (id === pop.id ? pop : null),
    querySelectorAll: (sel: string) => (sel === ".note-pop" ? [pop] : []),
    querySelector: (sel: string) => (sel === `.note-btn[popovertarget="${pop.id}"]` ? btn : null),
  };
  const win = {
    innerWidth: 390,
    innerHeight: 844,
    addEventListener: () => {},
    matchMedia: (q: string) => ({ matches: q === SHEET_QUERY && state.narrow, addEventListener() {} }),
  };
  const fire = (type: string, ev: unknown): void => {
    for (const fn of handlers.get(type) ?? []) fn(ev);
  };
  return { btn, pop, state, doc, win, fire };
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

test("LD3: in sheet mode hover and focus do not open a sheet, leaving the trigger or a tap inside the sheet does not close it; an opening appends Close; above the fold hover and focus open as before", () => {
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

test("LD3: notes.ts carries the sheet branch and the toggle hook in source (one component: the sheet applies wherever note() renders)", () => {
  const src = readFileSync(new URL("../src/scripts/notes.ts", import.meta.url), "utf8");
  assert.match(src, /export const SHEET_QUERY = "\(max-width: 720px\)";/);
  assert.match(src, /document\.addEventListener\(\s*"toggle",/, "every opening, whatever opened it");
  // no page restyles .note* (LD21; sl-notes.spec.ts): the sheet is in the one stylesheet
  const page = readFileSync(new URL("../src/pages/signals/index.astro", import.meta.url), "utf8");
  assert.doesNotMatch(page, /<style[^>]*>[^]*\.note/);
});
