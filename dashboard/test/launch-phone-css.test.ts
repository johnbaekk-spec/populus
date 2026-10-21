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

/* --------------------------------------- R13 / LD10: the device's edges */

const BASE_SRC = readFileSync(path.resolve(import.meta.dirname, "..", "src", "layouts", "Base.astro"), "utf-8");

test("R13: the viewport meta carries viewport-fit=cover", () => {
  assert.match(BASE_SRC, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
});

/** Side paddings of `.shell` and the full-bleed bands that are not the safe
    tokens, at `vp` (the effective declaration). */
function rawSidePadding(css: string, vp: { width: number; coarse?: boolean }): string[] {
  const rules = parseRules(css);
  const out: string[] = [];
  const targets: { name: string; chain: El[] }[] = [
    { name: ".shell", chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["shell", "page"] }] },
    { name: ".design-band > *", chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["shell", "page", "design-page"] }, { tag: "section", classes: ["design-band"] }, { tag: "div", classes: ["panel"] }] },
    { name: ".design-rankings > *", chain: [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["shell", "page", "design-page"] }, { tag: "div", classes: ["design-rankings"] }, { tag: "section" }] },
  ];
  for (const t of targets) {
    for (const [side, token] of [["padding-left", "--gutter-l"], ["padding-right", "--gutter-r"]] as const) {
      const w = winning(rules, t.chain, side, vp, { padding: (v: string) => sideOf(v, side) });
      if (!w || !w.value.includes(`var(${token})`)) out.push(`${t.name} ${side}: ${w?.value ?? "(none)"} from "${w?.selector ?? "-"}"`);
    }
  }
  return out;
}
function sideOf(v: string, side: "padding-left" | "padding-right"): string {
  const parts = v.trim().split(/\s+(?![^(]*\))/);
  const [t, r = t, , l = r] = parts;
  return side === "padding-left" ? l! : r!;
}

test("R13 (LD10): .shell and the full-bleed bands pad their sides with the safe tokens at every width", () => {
  for (const vp of [{ width: 360 }, { width: 390 }, { width: 430 }, { width: 900, coarse: true }, DESKTOP]) {
    assert.deepEqual(rawSidePadding(CSS, vp), [], `at ${vp.width}px`);
  }
  const rules = parseRules(CSS);
  assert.equal(rootToken(rules, "--gutter-l", PHONE), "max(var(--gutter), env(safe-area-inset-left))");
  assert.equal(rootToken(rules, "--gutter-r", DESKTOP), "max(var(--gutter), env(safe-area-inset-right))");
  // control: a raw 16px shell padding re-planted at the fold is caught
  const planted = `${CSS}\n@media (max-width: 720px) { .shell { padding-left: 16px; } }`;
  assert.ok(rawSidePadding(planted, PHONE).some((p) => p.startsWith(".shell padding-left: 16px")));
});

test("R13 (LD10): the sticky header, the drawer, the search panel, the note sheet and the footer clear the top or bottom inset", () => {
  const rules = parseRules(CSS);
  const at = (chain: El[], prop: string, sh: Record<string, (v: string) => string | null> = {}): string => winning(rules, chain, prop, PHONE, sh)?.value ?? "";
  const root: El[] = [{ tag: "html" }, { tag: "body" }];
  assert.match(at([...root, { tag: "header", classes: ["masthead"] }], "padding-top"), /env\(safe-area-inset-top\)/);
  assert.match(at([...root, { tag: "header", classes: ["masthead"] }, { tag: "div", classes: ["shell", "masthead-inner"] }, { tag: "div" }, { tag: "nav", classes: ["site-nav", "open"], id: "site-nav" }], "padding", {}), /env\(safe-area-inset-bottom\)/);
  assert.match(at([...root, { tag: "div", classes: ["search-panel"], id: "search-panel" }], "padding-bottom"), /env\(safe-area-inset-bottom\)/);
  assert.match(at([...root, { tag: "footer", classes: ["site-footer"] }], "padding-bottom"), /env\(safe-area-inset-bottom\)/);
  assert.ok(rules.some((r) => r.selectors === ".note-pop:popover-open" && /env\(safe-area-inset-bottom\)/.test(r.decls)), "the note sheet");
});

/* ------------------------------------------ R8 / LD8: the slim sticky header */

test("R8 (LD8): at ≤720px the masthead sticks at top 0, a 54px bar; --masthead-h is the whole header; tab bars sit below it; anchors land below it", () => {
  const rules = parseRules(CSS);
  const mh: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "header", classes: ["masthead"] }];
  assert.equal(winning(rules, mh, "position", PHONE)?.value, "sticky");
  assert.equal(winning(rules, mh, "top", PHONE)?.value, "0");
  assert.notEqual(winning(rules, mh, "position", DESKTOP)?.value, "sticky", "above the fold the masthead does not stick");
  /* launch review m1 (the property kept, the value corrected): the token was
     the bar's 54px, but the header is the bar, its 1px rule and the top inset
     its padding clears — so what sticks below it and every anchor sat 1px plus
     the inset under it. The token is now the header's whole height. */
  const bar = winning(rules, [...mh, { tag: "div", classes: ["shell", "masthead-inner"] }], "height", PHONE)?.value;
  assert.equal(bar, "54px", "the bar itself stays 54px");
  const rule = /^(\d+)px\b/.exec(winning(rules, mh, "border-bottom", PHONE)?.value ?? "")?.[1];
  assert.equal(rule, "1", "the header's one-pixel rule");
  assert.match(winning(rules, mh, "padding-top", PHONE)?.value ?? "", /env\(safe-area-inset-top\)/, "the header clears the top inset");
  assert.equal(rootToken(rules, "--masthead-h", PHONE), `calc(${54 + Number(rule)}px + env(safe-area-inset-top))`, "--masthead-h = bar + rule + inset");
  assert.equal(rootToken(rules, "--masthead-h", DESKTOP), "0px");
  for (const cls of ["sig-tabs-scroll", "tk-tabs"]) {
    assert.equal(winning(rules, [{ tag: "html" }, { tag: "body" }, { tag: "div", classes: [cls] }], "top", PHONE)?.value, "var(--masthead-h)", `.${cls} sticks below the header`);
  }
  assert.equal(winning(rules, [{ tag: "html" }], "scroll-padding-top", PHONE)?.value, "var(--masthead-h)");
});

test("R8 (LD8, D2): the drawer is #site-nav with each section's count as a sibling span, computed from the build; no account control", () => {
  const nav = BASE_SRC.slice(BASE_SRC.indexOf('<nav class="site-nav"'), BASE_SRC.indexOf("</nav>", BASE_SRC.indexOf('<nav class="site-nav"')));
  assert.equal((nav.match(/<a\b/g) ?? []).length, 3, "the nav stays exactly three links");
  assert.equal((nav.match(/class="nav-count"/g) ?? []).length, 3, "one count per section, outside its link");
  assert.match(BASE_SRC, /congress: `\$\{fmtInt\(build\.txnCount\)\} trades`/, "Congress counts the build's transactions");
  assert.match(BASE_SRC, /const instFilers = build\.inst\.present \? build\.inst\.filers\.length : 0;/, "Institutional counts the 13F filers on record");
  assert.match(BASE_SRC, /\$\{fmtInt\(instFilers\)\} 13F filers/);
  assert.match(BASE_SRC, /signalArtifact\.signals\.filter\(\(s\) => s\.status === "active"\)\.length/, "Signals counts the active hits");
  assert.match(BASE_SRC, /\$\{signalArtifact\.coverageFrom\} → \$\{signalArtifact\.coverageTo\}/, "…and states their window");
  assert.doesNotMatch(BASE_SRC, /sign[ -]?in|sign[ -]?up|log[ -]?in/i, "no account control (D2)");
  // the counts and the sheet hint show only in the phone drawer and sheet
  const rules = parseRules(CSS);
  const count: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "nav", classes: ["site-nav"], id: "site-nav" }, { tag: "span", classes: ["nav-count"] }];
  assert.equal(winning(rules, count, "display", DESKTOP)?.value, "none");
  const open: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "nav", classes: ["site-nav", "open"], id: "site-nav" }, { tag: "span", classes: ["nav-count"] }];
  assert.equal(winning(rules, open, "display", PHONE)?.value, "block");
});

test("R9: at ≤720px filter groups wrap (no sideways strip) and a search box takes its own row", () => {
  const rules = parseRules(CSS);
  const fc: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "div", classes: ["filterbar"] }, { tag: "div", classes: ["filter-controls"] }];
  assert.equal(winning(rules, fc, "flex-wrap", PHONE)?.value, "wrap");
  assert.notEqual(winning(rules, fc, "overflow-x", PHONE, OVERFLOW_X)?.value, "auto");
  const q: El[] = [...fc, { tag: "input", classes: ["filter-select", "filter-text"], attrs: { type: "search" } }];
  assert.match(winning(rules, q, "flex", PHONE)?.value ?? "", /100%/);
});

test("R7 (LD7): links take the hit square under the hit query; a card's main link stretches beneath the row's other targets", () => {
  const rules = parseRules(CSS);
  const linkRules = rules.filter((r) => r.media.some((m) => /any-pointer: coarse/.test(m)) && /a\[href\]/.test(r.selectors) && /::before/.test(r.selectors));
  assert.ok(linkRules.some((r) => /var\(--hit-min\)/.test(r.decls) && /--hit-x-l/.test(r.decls)), "the link square, clipped at the midpoint");
  /* launch review M2 (mechanism replaced, property kept): the main link is the
     one its renderer marks `data-row-link` — never guessed by position, since
     `a:first-of-type` also matched the receipt inside a position cell — and a
     receipt is never stretched (the :not() backstop). The browser suite
     (launch-phone-surfaces.test.ts) taps the cards. */
  const main = rules.find((r) => /tr a\[data-row-link\]:not\(:is\(\.cell-src, \.c-src\) a\)::after/.test(r.selectors));
  assert.ok(main && /inset:\s*0/.test(main.decls) && /z-index:\s*1/.test(main.decls), "the main link's stretched ::after");
  const others = rules.find((r) => /tr :is\(a, button, summary, \[tabindex\]\):not\(a\[data-row-link\]/.test(r.selectors));
  assert.ok(others && /z-index:\s*2/.test(others.decls), "the row's other targets sit above it");
  assert.deepEqual(
    rules.filter((r) => /::after/.test(r.selectors) && /inset:\s*0/.test(r.decls) && /tr\b[^{]*a:first-of-type/.test(r.selectors)).map((r) => r.selectors),
    [],
    "no row stretches a link chosen by position",
  );
  const hit = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "hit-areas.ts"), "utf-8");
  assert.match(hit, /const LINKS = "a\[href\]:not\(:is\(p, li, dd, \.note-pop, \.footer-notice\) a\)";/);
});

/** What positions the signal card's open link and the 13F receipt, at `vp`. */
function linkPositions(css: string, vp: { width: number; coarse?: boolean }): { open: string; receipt: string } {
  const rules = parseRules(css);
  const at = (chain: El[]): string => winning(rules, chain, "position", vp)?.value ?? "";
  const root: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "main", classes: ["page", "design-page"] }];
  return {
    open: at([...root, { tag: "article", classes: ["si-card"] }, { tag: "a", classes: ["si-card-open"], attrs: { href: "#si-row-x" } }]),
    receipt: at([...root, { tag: "article", classes: ["mv-item"] }, { tag: "a", classes: ["mv-src"], attrs: { href: "https://www.sec.gov/x" } }]),
  };
}

test("M1 (launch review): the link hit rule weighs nothing, so the signal card's open link stays static (its ::after spans the card) and the 13F receipt stays absolute — on phones and on every touch screen; the old weight fails", () => {
  const rules = parseRules(CSS);
  const linkRule = rules.find((r) => r.media.some((m) => /any-pointer: coarse/.test(m)) && /a\[href\]/.test(r.selectors) && /position:\s*relative/.test(r.decls));
  assert.ok(linkRule, "the hit rule positions links");
  assert.deepEqual(selectorSpec(linkRule!.selectors), [0, 0, 0], "it weighs nothing (:where)");
  for (const vp of [PHONE, { width: 360 }, { width: 1440, coarse: true }]) {
    assert.deepEqual(linkPositions(CSS, vp), { open: "static", receipt: "absolute" }, `at ${vp.width}px${"coarse" in vp ? " coarse" : ""}`);
  }
  const planted = `${CSS}\n@media (any-pointer: coarse), (max-width: 720px) { a[href]:not(:is(p, li, dd, .note-pop, .footer-notice) a) { position: relative; } }`;
  assert.deepEqual(linkPositions(planted, PHONE), { open: "relative", receipt: "relative" }, "control: the rule at its old (0,2,2) weight takes both");
});

test("M5 (launch review): at ≤720px the search results are the open sheet's last row, in flow under its field — never fixed over it; a re-planted fixed panel fails", () => {
  const panelAt = (css: string): { position: string; basis: string } => {
    const rules = parseRules(css);
    const chain: El[] = [
      { tag: "html" }, { tag: "body" }, { tag: "header", classes: ["masthead"] }, { tag: "div", classes: ["shell", "masthead-inner"] },
      { tag: "div", classes: ["masthead-right"] }, { tag: "div", classes: ["site-search", "open"], id: "site-search-box" },
      { tag: "div", classes: ["search-panel"], id: "search-panel" },
    ];
    return { position: winning(rules, chain, "position", PHONE)?.value ?? "", basis: winning(rules, chain, "flex-basis", PHONE)?.value ?? "" };
  };
  assert.deepEqual(panelAt(CSS), { position: "static", basis: "100%" });
  const planted = `${CSS}\n@media (max-width: 720px) { .search-panel { position: fixed; top: var(--masthead-h); left: 0; right: 0; } }`;
  assert.equal(panelAt(planted).position, "fixed", "control: the old panel, fixed at the header's edge over the field, is read");
});

/* ----------------------------- R10 (launch integration): scroll regions, global */

import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";

test("R10 (launch integration): the scroll-region runtime runs on every page from the layout; every named scroller is role-less in the server HTML, so the runtime can name it", async () => {
  const SRCDIR = path.resolve(import.meta.dirname, "..", "src");
  const base = readFileSync(path.join(SRCDIR, "layouts", "Base.astro"), "utf-8");
  assert.match(base, /import \{ initScrollRegions \} from "\.\.\/scripts\/scroll-regions";/, "the layout loads the runtime");
  assert.match(base, /\n\s*initScrollRegions\(\);/, "and runs it on every page (the home's strips included)");
  const sig = readFileSync(path.join(SRCDIR, "scripts", "signals-client.ts"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(sig, /function syncScrollRegion|function initScrollRegions|from "\.\/scroll-regions/, "one runtime: /signals/ no longer runs its own, nor a second copy of the layout's");
  // every [data-scroll-region] start tag the renderers emit: a name, and no role or name of its own
  const all = await renderParitySurfaces();
  const tags = new Map<string, string>();
  for (const html of Object.values(all)) for (const m of html.matchAll(/<[a-z]+\b[^>]*\bdata-scroll-region="([^"]*)"[^>]*>/g)) tags.set(m[0], m[1]!);
  const problems = (tag: string, name: string): string[] =>
    [...(name.trim() === "" ? ["empty name"] : []), ...(/\s(?:role|aria-label|aria-labelledby)=/.test(tag) ? ["own role or name"] : [])];
  for (const [tag, name] of tags) assert.deepEqual(problems(tag, name), [], tag);
  // the strips the plan names: Signals' lead cards and change chips, the home's cards and Try chips
  const has = (cls: string): boolean => [...tags.keys()].some((t) => new RegExp(`class="${cls}"`).test(t));
  for (const cls of ["si-cards", "mv-chips", "home-try-strip"]) assert.ok(has(cls), `.${cls} carries a data-scroll-region name`);
  assert.ok([...tags].some(([t, n]) => /class="si-cards"/.test(t) && /What stands out/.test(n)), "the home's card strip (it reuses .si-cards) is named apart from Signals'");
  // control: the same reading catches a scroller that brings its own role
  assert.deepEqual(problems('<div class="x" role="group" data-scroll-region="X">', "X"), ["own role or name"]);
  assert.deepEqual(problems('<div class="x" data-scroll-region="">', ""), ["empty name"]);
});
