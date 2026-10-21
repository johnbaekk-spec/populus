/* launch M1b (D4, LD5, LD6, LD12; R4, R5, R6) and M1c (LD10; R13): the phone
   system's static CSS pins, read over the WHOLE cascade (test/lib/styles.ts, the
   nine sheets in Base.astro's import order) through a resolver that asks what
   WINS for a described element at a given viewport (test/lib/cascade.ts) —
   never what one rule says. Each property carries a re-planted control that
   must fail. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseStylesheet } from "./lib/styles.ts";
import { HONESTY_SELECTORS } from "./lib/honesty-selectors.ts";
import { FONT_SIZE, OVERFLOW_X, matchComplex, mediaHolds, parseRules, rootToken, selectorSpec, winning, type El } from "./lib/cascade.ts";

const CSS = baseStylesheet();
const PHONE = { width: 390 };
const DESKTOP = { width: 1440, coarse: false };

/* ------------------------------------------------- the resolver itself */

test("the resolver: specificity, :is/:where/:not, combinators, media", () => {
  assert.deepEqual(selectorSpec(".a .b"), [0, 2, 0]);
  assert.deepEqual(selectorSpec(":is(.a, #b) td"), [1, 0, 1]);
  assert.deepEqual(selectorSpec(":where(.a) td"), [0, 0, 1]);
  assert.deepEqual(selectorSpec('table[data-card]:not([data-card="feed"]) > tr'), [0, 2, 2]);
  const chain: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "div", classes: ["design-page"] }, { tag: "div", classes: ["table-scroll"] }];
  assert.ok(matchComplex(":is(.design-page, .entity-page) .table-scroll", chain));
  assert.ok(!matchComplex(".entity-page > .table-scroll", chain));
  assert.ok(!matchComplex(".table-scroll:hover", chain), "a state pseudo-class does not hold at rest");
  assert.ok(!matchComplex(".table-scroll::after", chain), "a pseudo-element rule is not the element's");
  assert.ok(mediaHolds("(max-width: 720px)", PHONE) && !mediaHolds("(max-width: 720px)", DESKTOP));
  assert.ok(mediaHolds("(any-pointer: coarse), (max-width: 720px)", { width: 1080, coarse: true }));
  assert.ok(!mediaHolds("print", PHONE));
  const w = winning(".x{overflow-x:auto} @media (max-width:720px){.x{overflow:visible hidden}}", [{ tag: "div", classes: ["x"] }], "overflow-x", PHONE, OVERFLOW_X);
  assert.equal(w?.value, "visible", "a later shorthand at the fold wins");
});

/* ----------------------------------------- R4: no table scrolls sideways */

const WRAPPER_CONTEXTS: { name: string; chain: El[] }[] = [
  { name: "a bare .table-scroll", chain: [{ tag: "html" }, { tag: "body" }, { tag: "div", classes: ["table-scroll"] }] },
  {
    name: "a design band's .table-scroll",
    chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["page", "design-page"] }, { tag: "section", classes: ["design-band"] }, { tag: "div", classes: ["table-scroll"] }],
  },
  {
    name: "an entity page's .table-scroll",
    chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["page", "entity-page"] }, { tag: "div", classes: ["entity-grid"] }, { tag: "div", classes: ["table-scroll"] }],
  },
  {
    name: "the hits .table-scroll.si-hits-scroll",
    chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["page", "design-page"] }, { tag: "div", classes: ["table-scroll", "si-hits-scroll"], attrs: { "data-scroll-region": "Hits", role: "region" } }],
  },
  {
    name: "the feed's .reference-feed-scroll",
    chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["page", "design-page"] }, { tag: "section", id: "feed-section" }, { tag: "div", classes: ["reference-feed-scroll"] }],
  },
  { name: "the feed box #congress-feed", chain: [{ tag: "html" }, { tag: "body" }, { tag: "section", id: "feed-section" }, { tag: "div", id: "congress-feed" }] },
];

function sidewaysWrappers(css: string, vp: { width: number; coarse?: boolean }): string[] {
  const rules = parseRules(css);
  const out: string[] = [];
  for (const ctx of WRAPPER_CONTEXTS) {
    const w = winning(rules, ctx.chain, "overflow-x", vp, OVERFLOW_X);
    if (w && (w.value === "auto" || w.value === "scroll")) out.push(`${ctx.name}: overflow-x ${w.value} from "${w.selector}"`);
  }
  return out;
}

test("R4 (D4): at 390 the EFFECTIVE overflow-x of every table wrapper is neither auto nor scroll", () => {
  assert.deepEqual(sidewaysWrappers(CSS, PHONE), []);
  assert.deepEqual(sidewaysWrappers(CSS, { width: 360 }), []);
  assert.deepEqual(sidewaysWrappers(CSS, { width: 430 }), []);
});

test("R4 controls: above the fold the wrapper still scrolls (the resolver reads the base rule); a re-planted scroll at the fold fails", () => {
  assert.ok(sidewaysWrappers(CSS, DESKTOP).some((p) => p.startsWith("a bare .table-scroll: overflow-x auto")), "at 1440 a wide table still scrolls in its container");
  const planted = `${CSS}\n@media (max-width: 720px) { :is(.design-page, .entity-page) .table-scroll { overflow-x: auto; } }`;
  assert.ok(sidewaysWrappers(planted, PHONE).some((p) => p.startsWith("a design band's")), "a re-planted in-container scroll at the fold is caught");
});

test("R4 / LD6: at the fold every card table's rows are flex cards keyed on role classes, never :nth-child", () => {
  const rules = parseRules(CSS);
  const tr: El[] = [
    { tag: "html" },
    { tag: "body" },
    { tag: "div", classes: ["table-scroll"] },
    { tag: "table", classes: ["etable"], attrs: { "data-card": "generic", role: "table" } },
    { tag: "tbody", attrs: { role: "rowgroup" } },
    { tag: "tr", attrs: { role: "row" } },
  ];
  assert.equal(winning(rules, tr, "display", PHONE)?.value, "flex");
  assert.notEqual(winning(rules, tr, "display", DESKTOP)?.value, "flex", "above the fold the row is a table row");
  const foldRules = rules.filter((r) => r.media.some((m) => mediaHolds(m, PHONE)) && /data-card/.test(r.selectors));
  assert.ok(foldRules.length > 5, "the card rules exist");
  assert.deepEqual(foldRules.filter((r) => /:nth-(child|of-type)/.test(r.selectors)).map((r) => r.selectors), [], "no card rule keys on position");
  // the head folds through the clip pattern, and unfolds on focus
  const thead: El[] = [...tr.slice(0, 4), { tag: "thead", attrs: { role: "rowgroup" } }];
  assert.equal(winning(rules, thead, "position", PHONE)?.value, "absolute");
  assert.equal(winning(rules, thead, "clip-path", PHONE)?.value, "inset(50%)");
  assert.ok(rules.some((r) => /thead:focus-within/.test(r.selectors) && /position:\s*static/.test(r.decls)), "the head unfolds while it holds focus");
});

/* ------------------------- R5: nothing honest is clamped or ellipsised */

const CARD_CELL_HONESTY = ["c-secondary", "c-flags", "c-traded", "c-src", "c-amount", "c-issuer", "c-kind"];

function cellChain(cls: string): El[] {
  return [
    { tag: "html" },
    { tag: "body" },
    { tag: "main", classes: ["page", "entity-page"] },
    { tag: "div", classes: ["table-scroll"] },
    { tag: "table", classes: ["etable"], attrs: { "data-card": "member-trades", role: "table", "data-entity-table": "" } },
    { tag: "tbody", attrs: { role: "rowgroup" } },
    { tag: "tr", attrs: { role: "row", "data-edge": "buy" } },
    { tag: "td", classes: [cls, "c-flex"], attrs: { role: "cell" } },
  ];
}

/** Honesty cells whose effective style at `vp` cuts them: a line clamp, or an
    ellipsis on a box that does not let its content overflow. */
function cutHonestyCells(css: string, vp: { width: number }): string[] {
  const rules = parseRules(css);
  const out: string[] = [];
  for (const cls of CARD_CELL_HONESTY) {
    const chain = cellChain(cls);
    const clamp = winning(rules, chain, "-webkit-line-clamp", vp) ?? winning(rules, chain, "line-clamp", vp);
    if (clamp && clamp.value !== "none") out.push(`.${cls}: line-clamp ${clamp.value} from "${clamp.selector}"`);
    const tox = winning(rules, chain, "text-overflow", vp);
    const ox = winning(rules, chain, "overflow-x", vp, OVERFLOW_X);
    if (tox?.value === "ellipsis" && ox && ox.value !== "visible") out.push(`.${cls}: ellipsis with overflow ${ox.value} from "${tox.selector}"`);
  }
  return out;
}

/** The ≤720px sweep, css-fold's form: a fold rule touching an honesty selector
    may not clamp it or ellipsise it. */
function clampSweep(css: string): string[] {
  const out: string[] = [];
  for (const r of parseRules(css)) {
    if (!r.media.length || !r.media.every((m) => mediaHolds(m, PHONE))) continue;
    if (!HONESTY_SELECTORS.some((sel) => r.selectors.includes(sel))) continue;
    const clamp = /(?:-webkit-)?line-clamp\s*:\s*(?!none)[^;]+/.test(r.decls);
    const ellipsis = /text-overflow\s*:\s*ellipsis/.test(r.decls) && /overflow(?:-x)?\s*:\s*(hidden|clip)/.test(r.decls);
    if (clamp || ellipsis) out.push(r.selectors);
  }
  return out;
}

test("R5: at 390 no honesty cell on a card is line-clamped or cut by an ellipsis (the effective style)", () => {
  assert.deepEqual(cutHonestyCells(CSS, PHONE), []);
  assert.deepEqual(clampSweep(CSS), []);
});

test("R5 controls: the desktop ledger's ellipsis is seen above the fold; a planted clamp on .owner-note fails", () => {
  assert.ok(cutHonestyCells(CSS, DESKTOP).some((p) => p.startsWith(".c-secondary: ellipsis")), "at 1440 a long asset still ellipsises (the resolver reads the base rule)");
  const planted = `${CSS}\n@media (max-width: 720px) { .etable .owner-note { display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden; } }`;
  assert.deepEqual(clampSweep(planted), [".etable .owner-note"]);
  const plantedCell = `${CSS}\n@media (max-width: 720px) { .table-scroll > table[data-card][data-card] > tbody > tr > td.c-flags { -webkit-line-clamp: 1; } }`;
  assert.ok(cutHonestyCells(plantedCell, PHONE).some((p) => p.startsWith(".c-flags: line-clamp")));
});

/* ------------------------------------------- R6 / LD12: the type ramp */

/** Each token's value at 390 at T0 (foundation.css before launch M1b): the
    phone ramp may only raise them, so no text renders smaller than at T0. */
const T0_AT_390: Readonly<Record<string, number>> = {
  "--fs-label": 9.5, "--fs-meta": 10, "--fs-control": 10.5, "--fs-note": 11, "--fs-cell": 11.5, "--fs-small": 12, "--fs-name": 12.5,
  "--fs-body": 13, "--fs-title": 13.5, "--fs-brand": 14, "--fs-lede": 15, "--fs-heading": 20, "--fs-display": 22, "--fs-hero": 28,
};
/** …and at 1440, where nothing changes. */
const T0_AT_1440: Readonly<Record<string, number>> = { ...T0_AT_390, "--fs-display": 26, "--fs-hero": 40 };
const px = (v: string | null): number => (v && /^[\d.]+px$/.test(v) ? parseFloat(v) : NaN);

test("R6 (LD12): at ≤720px every type token is at least 11px, none is below its T0 value, and nothing changes at 1440", () => {
  const rules = parseRules(CSS);
  for (const [t, t0] of Object.entries(T0_AT_390)) {
    const phone = px(rootToken(rules, t, PHONE));
    assert.ok(phone >= 11, `${t} is ${phone}px at 390 (floor 11)`);
    assert.ok(phone >= t0, `${t}: ${phone}px at 390 is below its T0 ${t0}px — text would shrink`);
    assert.equal(px(rootToken(rules, t, DESKTOP)), T0_AT_1440[t], `${t} is unchanged at 1440`);
  }
  assert.equal(rootToken(rules, "--fs-label", PHONE), "11px");
  assert.equal(rootToken(rules, "--fs-cell", PHONE), "12.5px");
  assert.equal(rootToken(rules, "--fs-body", PHONE), "14px");
  // control: a planted sub-floor value at the fold is caught by the same reading
  const planted = parseRules(`${CSS}\n@media (max-width: 720px) { :root { --fs-meta: 10px; } }`);
  assert.equal(px(rootToken(planted, "--fs-meta", PHONE)), 10);
});

test("R6 (LD12): --fs-input is 16px wherever the hit square is 44px, the name size elsewhere, and only fields read it", () => {
  const rules = parseRules(CSS);
  assert.equal(rootToken(rules, "--fs-input", PHONE), "16px", "a phone");
  assert.equal(rootToken(rules, "--fs-input", { width: 1080, coarse: true }), "16px", "a touch tablet or a landscape phone at 1080px");
  assert.equal(rootToken(rules, "--fs-input", DESKTOP), "var(--fs-name)", "a fine pointer above the fold");
  assert.equal(rootToken(rules, "--hit-min", { width: 1080, coarse: true }), "44px", "keyed like --hit-min");
  // every field reads it
  const fields: { name: string; chain: El[] }[] = [
    { name: "a feed select", chain: [{ tag: "html" }, { tag: "body" }, { tag: "select", classes: ["filter-select"] }] },
    { name: "a filter text box", chain: [{ tag: "html" }, { tag: "body" }, { tag: "input", classes: ["filter-select", "filter-text"], attrs: { type: "search" } }] },
    { name: "the masthead search", chain: [{ tag: "html" }, { tag: "body" }, { tag: "div", classes: ["site-search"], id: "site-search-box" }, { tag: "input", id: "site-search", attrs: { type: "search" } }] },
  ];
  for (const f of fields) {
    for (const vp of [PHONE, { width: 1080, coarse: true }, DESKTOP]) {
      assert.equal(winning(rules, f.chain, "font-size", vp, FONT_SIZE)?.value, "var(--fs-input)", `${f.name} at ${vp.width}px reads --fs-input`);
    }
  }
  // nothing else does
  const readers = rules.filter((r) => /var\(--fs-input\)/.test(r.decls)).map((r) => r.selectors);
  assert.ok(readers.length >= 2);
  for (const s of readers) assert.match(s, /input|select|textarea|filter-select|site-search/, `${s} reads --fs-input but is not a field`);
});
