/* The CSS half of the mobile honesty enforcement (R12b) and the token pins
   (R13). Markup assertions cannot see CSS — a future display:none inside the
   ≤720px fold would pass every DOM test — so this DETERMINISTIC parser walks
   every narrow-viewport media block in global.css and fails if any honesty
   selector receives display:none / visibility:hidden / content-visibility:
   hidden. Plus the F2 dead-CSS sweep over this run's new classes and the R13
   corrected-token assertions. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  s1ModuleAbsent,
  s2OutOfExtract,
  s4Skeleton,
  s4Error,
  s7Banner,
  tickerInstSectionHtml,
  specimenCard,
  moduleCard,
  holdersTableHtml,
  changesTableHtml,
  flowRibbon,
  entityTxnTable,
  memberBody,
  tickerUnifiedBody,
  congressTickerBody,
  holdersBody,
  filerBody,
  breadcrumb,
} from "../src/lib/ui.ts";
import { renderResults, renderPreQuery } from "../src/scripts/search-client.ts";
import { loadWatchStore } from "../src/scripts/entity-client.ts";
import {
  terminusRow,
  footnoteBlock,
  statTiles,
  watchStarHtml,
  flagTags,
  type TxnRow,
  type RenderCtx,
} from "../src/lib/format.ts";
import { quarterlyFlow, buildSearchIndex } from "../src/lib/derive.ts";
import type { MemberEntity } from "../src/lib/derive.ts";
import {
  activitySectionHtml,
  institutionalDataNoteHtml,
  paginateActivity,
  scanBannedWording,
  type ActivityFeed,
  type ActivityRecord,
  type FilingDictionary,
} from "../src/lib/activity.ts";
// T11/T12's surfaces render through HoldingsTable, which composes
// `surfaceHtml()`. Building the fold fixture from `pageSource + *Body` alone
// cannot see that component, so the §5 clauses it carries looked missing.
import { surfaceHtml } from "../src/lib/holdings.ts";
import {
  filerPayload as foldFilerPayload,
  holdersPayload as foldHoldersPayload,
  issuerRow as foldIssuerRow,
} from "./fixtures/institutional.ts";

const CSS_PATH = path.resolve(import.meta.dirname, "..", "src", "styles", "global.css");
const css = readFileSync(CSS_PATH, "utf-8");

/* ---------- a tiny deterministic CSS walker ---------- */

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface AtRuleBlock {
  name: string; // "media", "keyframes", …
  condition: string;
  body: string;
}

/** Every at-rule block, brace-matched, plus everything left outside them. The
    remainder is what applies unconditionally at EVERY viewport — desktop
    included — so the breakpoint sweep below can ask about desktop at all. */
function splitAtRules(source: string): { blocks: AtRuleBlock[]; topLevel: string } {
  const text = stripComments(source);
  const blocks: AtRuleBlock[] = [];
  let topLevel = "";
  const re = /@([a-zA-Z-]+)([^{]*)\{/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index < cursor) continue;
    topLevel += text.slice(cursor, m.index);
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    blocks.push({
      name: m[1]!.toLowerCase(),
      condition: m[2]!.trim(),
      body: text.slice(re.lastIndex, i - 1),
    });
    cursor = i;
    re.lastIndex = i;
  }
  topLevel += text.slice(cursor);
  return { blocks, topLevel };
}

/** Every `@media` block whose condition includes a max-width ≤ 720px. */
function narrowMediaBlocks(source: string): { condition: string; body: string }[] {
  return splitAtRules(source)
    .blocks.filter((b) => {
      if (b.name !== "media") return false;
      const widthMatch = b.condition.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
      return widthMatch != null && Number(widthMatch[1]) <= 720;
    })
    .map((b) => ({ condition: b.condition, body: b.body }));
}

function rulesOf(body: string): { selector: string; decls: string }[] {
  const rules: { selector: string; decls: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    rules.push({ selector: m[1]!.trim(), decls: m[2]!.trim() });
  }
  return rules;
}

/** The honesty-selector allowlist: any ≤720px rule matching one of these must
    never remove the element from the accessibility tree. */
const HONESTY_SELECTORS = [
  ".cell-filed",
  ".cell-traded",
  ".traded-date",
  ".mobile-dates",
  ".lag",
  ".lag-late",
  ".lag-anomaly",
  ".owner-note",
  ".flag",
  ".cell-src",
  ".src-missing",
  ".src-derived",
  ".feed-footnote",
  ".footnotes-stacked",
  ".footnote-line",
  ".dagger",
  ".fn-ref",
  ".terminus",
  ".caveat-line",
  ".caveat-inline",
  ".table-stamp",
  ".inst-stamp",
  ".rb-caption",
  ".c-traded",
  ".c-src",
  ".c-flags",
  ".c-amount",
  ".spec-dates",
  ".si-asof",
  ".filter-count",
  ".paper-note",
  ".chip-ocr",
  ".nc-chip",
  ".qoq-chip",
  ".s7-banner",
  ".period-note",
  ".mtile-sub",
  ".view-note",
];

const PROHIBITED = [/display\s*:\s*none/, /visibility\s*:\s*hidden/, /content-visibility\s*:\s*hidden/];

test("no honesty selector is display:none'd inside any ≤720px media block", () => {
  const blocks = narrowMediaBlocks(css);
  assert.ok(blocks.length >= 2, "the fold blocks exist and were parsed");
  for (const block of blocks) {
    for (const rule of rulesOf(block.body)) {
      const touchesHonesty = HONESTY_SELECTORS.some((sel) => rule.selector.includes(sel));
      if (!touchesHonesty) continue;
      for (const bad of PROHIBITED) {
        assert.ok(
          !bad.test(rule.decls),
          `≤720px rule "${rule.selector}" removes honesty content: ${rule.decls}`,
        );
      }
    }
  }
});

test("the fold uses clip-pattern visually-hidden, never display:none, for the dual dates", () => {
  const blocks = narrowMediaBlocks(css);
  const foldBody = blocks.map((b) => b.body).join("\n");
  const filedRule = rulesOf(foldBody).find((r) => r.selector.includes(".cell-filed"));
  assert.ok(filedRule, "the filed-date fold rule exists");
  assert.ok(filedRule!.decls.includes("clip"), "filed date folds via the sr-only clip pattern");
});

/* ---------- R13: corrected tokens verbatim ---------- */

test("corrected --ink3 and --hatch values are present; the handoff's failing values are not", () => {
  assert.ok(css.includes("--ink3: #6b6659"), "corrected light ink3");
  assert.ok(css.includes("--ink3: #948e7e"), "corrected dark ink3");
  assert.ok(css.includes("#948d7c 3px 4px"), "corrected light hatch stripe");
  assert.ok(css.includes("#787264 3px 4px"), "corrected dark hatch stripe");
  assert.ok(!css.includes("--ink3: #8d8779"), "handoff light ink3 (3.39:1) must not ship");
  assert.ok(!css.includes("--ink3: #7d7869"), "handoff dark ink3 (3.68:1) must not ship");
  assert.ok(!css.includes("#cec8b9 3px 4px"), "handoff light hatch (1.58:1) must not ship");
  assert.ok(!css.includes("#4a463c 3px 4px"), "handoff dark hatch must not ship");
});

/* ---------- F2 dead-CSS: every new class is styled AND emitted ---------- */

function renderCorpus(): string {
  const CTX: RenderCtx = { watched: new Set() };
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const t: TxnRow = {
    kind: "txn",
    filed: "2026-07-21",
    traded: "2026-06-24",
    name: "N",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "sale_partial",
    owner: "joint",
    low: null,
    high: null,
    lag: 51,
    late: 1,
    flags: ["unknown_future_flag"],
    doc: "https://efdsearch.senate.gov/x/",
  };
  const m: MemberEntity = {
    bioguide: "T000001",
    name: "N",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    servingSince: "1999",
    filingCount: 1,
    txns: [t],
    paper: [
      {
        kind: "paper",
        filed: "2026-06-01",
        name: "N",
        bioguide: "T000001",
        party: "R",
        state: "OK",
        district: null,
        chamber: "senate",
        doc: "https://efdsearch.senate.gov/p/",
      },
    ],
  };
  const holders = [
    {
      issuer_key: "entity:cik:0000320193",
      period_of_report: "2026-03-31",
      rank: 1,
      cik: "0001067983",
      filer_name: "F",
      issuer_name: "I",
      issuer_key_source: "entity" as const,
      value_usd: 1,
      security_count: 1,
      flags: [],
    },
  ];
  const conc = {
    cik: "0001067983",
    period_of_report: "2026-03-31",
    position_count: 1,
    total_value_usd: 0,
    null_value_positions: 1,
    topn_value_usd: 0,
    topn_share_bps: null,
    hhi: null,
    flags: ["concentration_unavailable"],
  };
  const deltas = [
    {
      cik: "0001067983",
      position_key: "sid:x",
      put_call: "PUT" as const,
      curr_period: "2026-03-31",
      prev_period: "2025-12-31",
      change_kind: "unclassified" as const,
      prev_value_usd: null,
      curr_value_usd: null,
      delta_value_usd: null,
      prev_shares: null,
      curr_shares: null,
      delta_shares: null,
      ssh_prnamt_type: "PRN" as const,
      flags: ["change_kind_undeterminable", "value_undisclosed_one_side", "identity_reconciled_by_cusip"],
    },
  ];
  const index = buildSearchIndex(
    [{ bioguide: "T000001", name: "N", aff: "R–OK", rows: 1 }],
    [{ ticker: "WMB", name: "", rows: 1 }],
    [],
  );
  const store = loadWatchStore({ getItem: () => null, setItem: () => {} });
  const window = { open: true, quarterEnd: "2026-06-30", deadline: "2026-08-14" };
  return [
    memberBody(m, stamps, CTX),
    congressTickerBody({ ticker: "WMB", txns: [t] }, stamps, CTX),
    tickerUnifiedBody(
      { ticker: "WMB", txns: [t] },
      {
        state: "data",
        name: "X",
        cik: "0000320193",
        period: "2026-03-31",
        latestFiled: null,
        topn: 25,
        holders: [
          { rank: 1, cik: "0001067983", name: "F", value: 1, securities: 1, keySource: "entity", flags: [] },
        ],
      },
      stamps,
      CTX,
      { fullTable: false },
    ),
    holdersBody("AAPL", "Apple Inc.", holders, ["2026-03-31"], "2026-03-31", null, 25, window),
    filerBody(
      { cik: "0001067983", name: "F", latestPeriod: "2026-03-31" },
      ["2026-03-31"],
      "2026-03-31",
      conc,
      deltas,
      null,
      25,
      window,
    ),
    changesTableHtml(deltas, "2026-03-31", null),
    holdersTableHtml(holders, "2026-03-31", null, 25),
    s1ModuleAbsent("module-absent"),
    s2OutOfExtract("f", "0001999999"),
    tickerInstSectionHtml({ state: "module-absent" }, "WMB"),
    s4Skeleton("/x.json", "k"),
    s4Error("timeout", "/x.json", "d", true),
    s7Banner(window),
    specimenCard({ ...t, low: 1001, high: 15000 }, CTX),
    moduleCard("M", "/m/", "d", { live: true, statLines: ["x"] }),
    moduleCard("P", null, "d", { live: false, statLines: ["x"] }),
    flowRibbon(quarterlyFlow([t], "2026-07-24", 4), { twoSided: true, sourceLine: "s" }),
    entityTxnTable([t], { kind: "member", caption: "c", page: 0, ctx: CTX }),
    entityTxnTable([{ ...t, bioguide: null, party: "" }], {
      kind: "ticker",
      caption: "c",
      page: 0,
      ctx: CTX,
    }),
    flowRibbon(
      quarterlyFlow(
        [{ ...t, side: "purchase", low: 1001, high: 15000, traded: "2026-06-01" }],
        "2026-07-24",
        4,
      ),
      { twoSided: false, sourceLine: "s" },
    ),
    renderResults(
      [{ kind: "ticker", key: "WMB", label: "WMB", sub: "s", href: "/tickers/WMB/" }],
      0,
    ),
    renderResults([], -1),
    renderPreQuery(store, index),
    terminusRow({ author: "populus", html: "x" }),
    footnoteBlock([{ mark: "§", html: "x" }], { id: "f" }),
    statTiles([{ value: "1", label: "l", title: "t" }], { compact: true }),
    watchStarHtml("ticker", "WMB", "WMB", false),
    flagTags(["mystery_flag"]),
    breadcrumb([{ text: "/x", href: "/x/" }]),
  ].join("\n");
}

/** This run's new classes: each must be (a) styled in global.css and (b)
    actually emitted by a renderer or page template — no dead selectors, no
    unstyled markup. Astro-template-only classes are checked against sources. */
const NEW_RENDERER_CLASSES = [
  "crumb", "entity-head", "entity-title", "entity-subline", "entity-lede",
  "mono-id", "mono-ticker", "mono-note", "tiles-entity", "entity-grid",
  "panel", "panel-head", "panel-note", "section-h", "section-h2",
  "section-index", "si-n", "si-soon", "si-asof", "page-section",
  "table-scroll", "etable", "etable-compact", "table-foot",
  "ribbon", "ribbon-two", "rb-track", "rb-col", "rb-up", "rb-down", "rb-bar",
  "rb-buy", "rb-sell", "rb-hatch", "rb-axis", "rb-labels", "rb-label", "rb-caption",
  "qoq-chip", "qoq-nc", "nc-chip", "inst-stamp", "caveat-line", "src-derived",
  "period-row", "chips", "chip", "chip-active", "explainer", "edgar-block",
  "terminus", "terminus-author", "watch-btn", "watch-glyph", "watch-note",
  "absent-block", "absent-h", "s1-block", "s1-mark", "s1-h", "s1-detail",
  "s2-block", "s4-shell", "s4-error", "s4-actions", "s7-banner", "s7-chip", "s7-copy",
  "cta", "plain-link", "specimen", "spec-head", "spec-dates", "spec-scale",
  "mod-card", "badge-live", "badge-planned",
  "search-group-h", "search-opt", "opt-label", "opt-sub", "search-empty",
  "quick-links", "quick-link", "s6-block", "s6-h", "s6-body",
  "footnotes-stacked", "footnote-line", "fn-ref", "flag-raw", "planned-card",
  "paper-block", "unjoined-name", "reconciled",
];

const ASTRO_ONLY_CLASSES = [
  "hero", "hero-title", "hero-lede", "hero-ctas", "mod-grid", "modules-head", "commitments",
  "metho-title", "metho-lede", "toc", "metho-section", "standing-caveat",
  "metho-tiles", "mtile", "mtile-sub", "metho-grid", "source-list", "source-row",
  "gaps-block", "pub-grid", "pub-card", "verify-line", "module-shell",
  "shell-title", "shell-lede", "caveat-box", "caveat-box-head", "caveat-box-body",
  "search-panel", "search-panel-foot", "search-kbd", "masthead-search-first",
  "nav-shell", "entity-page",
];

test("dead-CSS sweep: every new class is styled AND emitted", () => {
  const corpus = renderCorpus();
  const srcRoot = path.resolve(import.meta.dirname, "..", "src");
  const astroSources = [
    "layouts/Base.astro",
    "pages/index.astro",
    "pages/methodology/index.astro",
    "pages/financials/index.astro",
    "pages/macro/index.astro",
    "pages/e/index.astro",
    "pages/404.astro",
    "pages/institutional/index.astro",
    "pages/congress/members/[bioguide].astro",
    "pages/tickers/[ticker].astro",
  ]
    .map((p) => readFileSync(path.join(srcRoot, p), "utf-8"))
    .join("\n");
  for (const cls of NEW_RENDERER_CLASSES) {
    assert.ok(css.includes(`.${cls}`), `class .${cls} has no CSS`);
    assert.ok(corpus.includes(cls), `class .${cls} is styled but never emitted by a renderer`);
  }
  for (const cls of ASTRO_ONLY_CLASSES) {
    assert.ok(css.includes(`.${cls}`) || css.includes(`[data-`) , `class .${cls} has no CSS`);
    assert.ok(
      astroSources.includes(cls) || corpus.includes(cls),
      `class .${cls} is styled but never used in a template`,
    );
  }
});

test("sticky identity column + edge fade exist for wide 13F tables at the fold", () => {
  const blocks = narrowMediaBlocks(css);
  const foldBody = blocks.map((b) => b.body).join("\n");
  assert.ok(foldBody.includes("data-sticky-first"), "sticky first column rule");
  assert.ok(foldBody.includes("position: sticky") || foldBody.includes("position:sticky"));
  assert.ok(foldBody.includes("mask-image"), "edge fade signals in-container scroll");
  const corpus = renderCorpus();
  assert.ok(corpus.includes("data-sticky-first"), "13F tables carry the sticky marker");
});

test("print keeps the honesty layer: footnotes/terminus forced visible, chrome dropped", () => {
  const printIdx = css.indexOf("@media print");
  assert.ok(printIdx > 0, "a print block exists");
  const printBlock = css.slice(printIdx);
  assert.ok(printBlock.includes(".terminus"));
  assert.ok(printBlock.includes(".footnotes-stacked"));
  assert.ok(printBlock.includes(".feed-footnote"));
  for (const sel of [".feed-footnote", ".footnotes-stacked", ".terminus", ".caveat-line"]) {
    const rule = rulesOf(stripComments(printBlock)).find((r) => r.selector.includes(sel));
    assert.ok(rule && rule.decls.includes("display: block"), `${sel} prints`);
  }
});

/* ===================================================================
   RUN M2-8 T14 (plan R16) — the institutional honesty sweep.

   This repository has shipped the same fold defect TWICE: a layout that
   "looks cleaner" at a narrow viewport because a caveat disappeared. Markup
   tests cannot see CSS, which is exactly why this file exists — and why the
   sweep below does not ask "is there a display:none somewhere", but
   ENUMERATES, per breakpoint, which classes each institutional surface
   actually loses, and then judges that list.

   Three institutional surfaces, three breakpoints, one rule: nothing
   honesty-bearing may leave the accessibility tree. `display:none` removes an
   element from that tree; the clip-pattern `.visually-hidden` does not, and is
   the acceptable way to fold a duplicate date into a narrow layout.
   =================================================================== */

const BREAKPOINTS = [
  { name: "375", width: 375 },
  { name: "720", width: 720 },
  { name: "desktop", width: 1280 },
] as const;

/** Does this at-rule apply to a viewport `width` px wide? `print` is a
    different medium and is judged by its own test, not this one. */
function appliesAtWidth(block: AtRuleBlock, width: number): boolean {
  if (block.name !== "media") return false;
  if (/\bprint\b/.test(block.condition)) return false;
  const maxes = [...block.condition.matchAll(/max-width:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
  const mins = [...block.condition.matchAll(/min-width:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
  return maxes.every((n) => width <= n) && mins.every((n) => width >= n);
}

interface PositionedRule {
  selector: string;
  decls: string;
  where: string;
  at: number; // position in the stylesheet — the cascade's tie-break
}

/** Every rule in the sheet, in DOCUMENT ORDER, tagged with the at-rule that
    encloses it. One pass, because the cascade is positional: a later rule of
    equal specificity wins, which is exactly how `.mobile-dates` is hidden at
    desktop and shown at the fold. A sweep that ignored order would call that a
    drop at every width and be wrong at two of the three. */
function allRulesInOrder(): PositionedRule[] {
  const text = stripComments(css);
  const ranges: { start: number; end: number; label: string; block: AtRuleBlock }[] = [];
  const head = /@([a-zA-Z-]+)([^{]*)\{/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(text)) !== null) {
    if (m.index < cursor) continue;
    let depth = 1;
    let i = head.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const block: AtRuleBlock = {
      name: m[1]!.toLowerCase(),
      condition: m[2]!.trim(),
      body: text.slice(head.lastIndex, i - 1),
    };
    ranges.push({ start: head.lastIndex, end: i - 1, label: `@${block.name} ${block.condition}`, block });
    cursor = i;
    head.lastIndex = i;
  }

  const rules: PositionedRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(text)) !== null) {
    const at = r.index;
    const enclosing = ranges.find((range) => at >= range.start && at < range.end);
    rules.push({
      selector: r[1]!.trim(),
      decls: r[2]!.trim(),
      where: enclosing ? enclosing.label : "unconditional",
      at,
    });
  }
  return rules.map((rule) => ({
    ...rule,
    block: ranges.find((range) => rule.at >= range.start && rule.at < range.end)?.block,
  })) as PositionedRule[];
}

const ALL_RULES = allRulesInOrder() as (PositionedRule & { block?: AtRuleBlock })[];

/** Rules in force at `width`: the unconditional sheet PLUS every media block
    that applies there, in document order. Desktop is not "no rules" — it is the
    top-level sheet, so a `display:none` written outside any media query is a
    desktop drop. */
function rulesInForceAt(width: number): PositionedRule[] {
  return ALL_RULES.filter((rule) => !rule.block || appliesAtWidth(rule.block, width));
}

const VISIBILITY_DECL = /(?:^|;)\s*(display|visibility|content-visibility)\s*:\s*([^;]+)/gi;
const STATE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|target|checked|disabled)/;

/** The rightmost compound of one selector — the part that decides WHICH element
    the rule styles. Ancestors are not modelled (the sweep has class attributes,
    not a DOM), so an ancestor condition is treated as satisfied: the sweep may
    over-report a drop, never miss one. */
function rightmostCompound(selectorPart: string): string {
  const parts = selectorPart.trim().split(/[\s>+~]+/);
  return parts[parts.length - 1] ?? "";
}

function compoundClasses(compound: string): string[] {
  return [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
}

/** Does this rule style an element carrying exactly these classes? `.site-nav`
    and `.site-nav.open` are NOT the same target: the second needs the open
    state, and treating them as one is how a "resolved" sweep talks itself out
    of a real drop. */
function ruleAppliesTo(rule: PositionedRule, classes: Set<string>): boolean {
  for (const part of rule.selector.split(",")) {
    const compound = rightmostCompound(part);
    if (STATE_PSEUDO.test(compound)) continue;
    const needed = compoundClasses(compound);
    if (needed.length === 0) continue; // not a class-targeted rule
    if (needed.every((c) => classes.has(c))) return true;
  }
  return false;
}

/** The winning visibility declaration for an element at `width`, resolved by the
    cascade (`!important` first, then last-one-wins). */
function visibilityOf(
  classes: Set<string>,
  width: number,
): { removed: boolean; rule: PositionedRule } | null {
  let normal: { value: string; rule: PositionedRule } | null = null;
  let important: { value: string; rule: PositionedRule } | null = null;
  for (const rule of rulesInForceAt(width)) {
    if (!ruleAppliesTo(rule, classes)) continue;
    VISIBILITY_DECL.lastIndex = 0;
    let d: RegExpExecArray | null;
    while ((d = VISIBILITY_DECL.exec(rule.decls)) !== null) {
      const value = `${d[1]}: ${d[2]!.trim()}`;
      if (/!important/i.test(d[2]!)) important = { value, rule };
      else normal = { value, rule };
    }
  }
  const winner = important ?? normal;
  if (!winner) return null;
  return { removed: PROHIBITED.some((bad) => bad.test(winner.value)), rule: winner.rule };
}

/** Rules that REMOVE their target from the accessibility tree, before cascade
    resolution — used only by the control test. */
function removalRulesAt(width: number): PositionedRule[] {
  return rulesInForceAt(width).filter((r) => PROHIBITED.some((bad) => bad.test(r.decls)));
}

/** One entry per element that carries a class attribute — the sweep judges
    ELEMENTS, because that is what a browser removes. */
function elementsOf(html: string): Set<string>[] {
  const seen = new Map<string, Set<string>>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    const tokens = m[1]!.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const key = [...tokens].sort().join(" ");
    if (!seen.has(key)) seen.set(key, new Set(tokens));
  }
  return [...seen.values()];
}

/** THE ENUMERATION: every class on every element this surface emits whose
    RESOLVED visibility at `width` removes it from the accessibility tree.
    Resolved, not "matched by some rule": the sweep must survive both the
    dual-channel pattern and state-conditioned selectors, or it would report
    drops the cascade undoes and miss the ones it does not. */
function droppedAt(html: string, width: number): { cls: string; selector: string; where: string }[] {
  const drops: { cls: string; selector: string; where: string }[] = [];
  for (const classes of elementsOf(html)) {
    const state = visibilityOf(classes, width);
    if (!state?.removed) continue;
    for (const cls of [...classes].sort()) {
      drops.push({ cls, selector: state.rule.selector, where: state.rule.where });
    }
  }
  return drops.sort((a, b) => (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0));
}

/** `.mobile-dates` is the ONE documented exemption: it is a duplicate channel
    marked `aria-hidden="true"`, whose sibling `.traded-date` carries the same
    fact in the accessibility tree at every width. Hiding it at desktop removes
    a repetition, not a disclosure. Nothing else may be exempted without the
    same two-channel proof. */
const DUAL_CHANNEL_EXEMPT = new Set<string>(["mobile-dates"]);

/** Honesty-bearing classes: the existing fold allowlist plus everything the
    institutional surfaces use to carry a caveat, a date, a lag, a flag, a
    stated absence, or spoken-only text. `.visually-hidden` is in the list
    deliberately — it is the channel the fold is ALLOWED to use, so turning it
    into display:none would silently delete every spoken qualifier. */
const INSTITUTIONAL_HONESTY_CLASSES = [
  "caveat-box", "caveat-box-head", "caveat-box-body", "caveat-line", "caveat-inline",
  "explainer", "explainer-h", "absent-block", "absent-h", "section-note",
  "panel-note", "table-stamp", "inst-stamp", "period-note", "period-label",
  "terminus", "terminus-author", "feed-footnote", "footnotes-stacked", "footnote-line",
  "fn-ref", "dagger", "lag", "lag-late", "lag-anomaly", "qoq-chip", "qoq-nc", "nc-chip",
  "flag", "flag-raw", "c-flags", "c-src", "src-derived", "src-missing", "mono-note",
  "mono-id", "none", "visually-hidden", "s7-banner", "s7-chip", "s7-copy", "edgar-block",
];

const HONESTY_CLASSES = new Set<string>(
  [...HONESTY_SELECTORS.map((s) => s.replace(/^\./, "")), ...INSTITUTIONAL_HONESTY_CLASSES].filter(
    (c) => !DUAL_CHANNEL_EXEMPT.has(c),
  ),
);

/** Chrome that a narrow viewport MAY drop — interactive affordances only,
    nothing that carries a fact. Anything dropped and not listed here fails the
    sweep: a new disappearance must be declared, not discovered later. */
const DECLARED_DROPPABLE_CHROME = new Set<string>([
  "site-nav", "masthead-meta", "site-search", "search-panel", "filter-label",
  "filter-controls", "feed-head", "pager", "s4-actions", "watch-btn", "star-btn",
]);

/* ---------- the three institutional surfaces ---------- */

const SURFACE_FILINGS: FilingDictionary = {
  "1": {
    accession: "0000000000-26-000001",
    submission_type: "13F-HR",
    period_of_report: "2026-03-31",
    filed_date: "2026-05-10",
    doc_url: "https://www.sec.gov/Archives/1",
    source: "sec-edgar",
  },
};

function activityRecord(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    cik: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    issuer_key: "entity:cik:0000320193",
    issuer_name: "APPLE INC",
    position_key: "sid:aapl",
    put_call: "LONG",
    ssh_prnamt_type: "SH",
    change_kind: "add",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    prev_value_usd: 1_000,
    curr_value_usd: 3_000,
    delta_value_usd: 2_000,
    prev_shares: 10,
    curr_shares: 30,
    delta_shares: 20,
    filing_keys: [1],
    prior_filing_keys: [],
    current_filing_keys: [],
    flags: ["value_undisclosed_one_side"],
    ...over,
  };
}

function activityFeedFixture(): ActivityFeed {
  const records = [
    activityRecord(),
    activityRecord({ change_kind: "exit", cik: "0000000002", delta_value_usd: null, filing_keys: [], current_filing_keys: [1], prior_filing_keys: [1] }),
  ];
  return {
    present: true,
    reason: null,
    filings: SURFACE_FILINGS,
    pagination: paginateActivity(records, SURFACE_FILINGS),
  };
}

/** An .astro template's user-facing text: comments removed, because a caveat
    that exists only in a source comment is not on the page, and a banned verb
    in a comment is not spoken to anyone. */
function pageSource(rel: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", "src", "pages", rel), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

const HOLDERS_ROWS = [
  {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity" as const,
    value_usd: 2_000,
    security_count: 1,
    flags: [],
  },
];

const CONC = {
  cik: "0001067983",
  period_of_report: "2026-03-31",
  position_count: 1,
  total_value_usd: 0,
  null_value_positions: 1,
  topn_value_usd: 0,
  topn_share_bps: null,
  hhi: null,
  flags: ["concentration_unavailable"],
};

const DELTAS = [
  {
    cik: "0001067983",
    position_key: "sid:x",
    put_call: "PUT" as const,
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "unclassified" as const,
    prev_value_usd: null,
    curr_value_usd: null,
    delta_value_usd: null,
    prev_shares: null,
    curr_shares: null,
    delta_shares: null,
    ssh_prnamt_type: "PRN" as const,
    flags: ["value_undisclosed_one_side"],
  },
];

/** Each surface = what its renderer emits PLUS what its .astro template writes
    directly. A caveat that lives only in the template is still on the page. */
function institutionalSurfaces(): { name: string; owner: string; html: string }[] {
  const window = { open: true, quarterEnd: "2026-06-30", deadline: "2026-08-14" };
  return [
    {
      name: "/institutional",
      owner: "T13",
      html: pageSource("institutional/index.astro") + activitySectionHtml(activityFeedFixture()),
    },
    {
      name: "/institutional/filers/[cik]",
      owner: "T11",
      html:
        pageSource("institutional/filers/[cik].astro") +
        filerBody(
          { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" },
          ["2025-12-31", "2026-03-31"],
          "2026-03-31",
          CONC,
          DELTAS,
          "2026-05-15",
          25,
          window,
        ) +
        // the component the page actually mounts
        surfaceHtml(foldFilerPayload(), { view: "current", page: 0, period: "2026-03-31" }) +
        // NOTE (QA M2-8 M4): the note is appended BY THIS TEST because
        // `surfaceHtml` does not emit it — the real page gets it from
        // HoldingsTable.astro. So this sweep proves the note's own markup is
        // never folded away; it CANNOT prove the note is rendered at all.
        // That presence assertion lives in test/post/fixture-preview.test.ts,
        // over the bytes a reader actually receives.
        institutionalDataNoteHtml(),
    },
    {
      name: "/institutional/tickers/[t]/holders",
      owner: "T12",
      html:
        pageSource("institutional/tickers/[t]/holders.astro") +
        holdersBody("AAPL", "APPLE INC", HOLDERS_ROWS, ["2026-03-31"], "2026-03-31", "2026-05-15", 25, window) +
        surfaceHtml(foldHoldersPayload([foldIssuerRow()]), { view: "current", page: 0, period: "2026-03-31" }) +
        institutionalDataNoteHtml(),
    },
  ];
}

test("T14/R16: the drop enumeration itself works — known-dropped classes ARE reported", () => {
  // Guard against a silently broken sweep (measure the mechanism): if the
  // machinery cannot see the fold's own display:none, every "nothing is
  // dropped" result below would be meaningless rather than reassuring.
  const control = `<nav class="site-nav"><a class="lag">x</a></nav>`;
  assert.deepEqual(
    droppedAt(control, 375).map((d) => d.cls),
    ["site-nav"],
    "the sweep sees the fold's display:none — and does not over-report .lag",
  );
  assert.deepEqual(droppedAt(control, 1280), [], "and does not see it at desktop");
  assert.ok(removalRulesAt(375).length > removalRulesAt(1280).length, "375 drops more than desktop");

  // POSITIVE CONTROL for the honesty check itself: `.mobile-dates` really is
  // display:none at desktop. A surface emitting it would be reported as an
  // honesty drop were it not the documented dual-channel exemption — which is
  // what proves the honesty branch fires at all.
  const dup = `<span class="mobile-dates">2026-06-24 → 05-10</span>`;
  assert.deepEqual(
    droppedAt(dup, 1280).map((d) => d.cls),
    ["mobile-dates"],
    "an unconditional display:none is a DESKTOP drop, not only a fold drop",
  );
  assert.ok(
    HONESTY_SELECTORS.includes(".mobile-dates") && DUAL_CHANNEL_EXEMPT.has("mobile-dates"),
    "the one exemption is declared, not silent",
  );
  // and the cascade is resolved rather than "any matching rule wins": the same
  // class is NOT dropped at the fold, where a later rule shows it again
  assert.deepEqual(droppedAt(dup, 375), [], "cascade order is honoured");
});

test("T14/R16: 375 / 720 / desktop drop NOTHING honesty-bearing on the three institutional surfaces", () => {
  // Every surface × breakpoint is enumerated before anything is asserted: a
  // sweep that stops at the first bad surface hides the other two, and a
  // concurrent run then fixes one defect at a time.
  const honestyFindings: string[] = [];
  const undeclaredFindings: string[] = [];
  for (const surface of institutionalSurfaces()) {
    // Non-vacuity: a renderer that returned "" would sail through every
    // assertion below. Prove the sweep actually looked at a page first.
    const inspected = elementsOf(surface.html).length;
    assert.ok(
      inspected >= 15,
      `${surface.name} exposed only ${inspected} class-carrying elements — the sweep did not` +
        " actually see this surface",
    );
    for (const bp of BREAKPOINTS) {
      const drops = droppedAt(surface.html, bp.width);
      for (const d of drops.filter((x) => HONESTY_CLASSES.has(x.cls))) {
        honestyFindings.push(
          `${surface.name} @${bp.name}px loses .${d.cls} via "${d.selector}" (${d.where})`,
        );
      }
      for (const cls of [...new Set(drops.map((d) => d.cls))]) {
        if (!DECLARED_DROPPABLE_CHROME.has(cls)) {
          undeclaredFindings.push(`${surface.name} @${bp.name}px drops .${cls}`);
        }
      }
    }
  }
  assert.deepEqual(
    honestyFindings,
    [],
    "honesty content leaves the accessibility tree at a breakpoint — fold it with the" +
      " .visually-hidden clip pattern instead of display:none",
  );
  assert.deepEqual(
    undeclaredFindings,
    [],
    "an institutional surface drops a class that is not declared droppable chrome — declare it" +
      " in DECLARED_DROPPABLE_CHROME with a reason, or stop dropping it",
  );
});

test("T14/R16: the §5 data_note renders on every institutional surface", () => {
  // Clause by clause, so a failure names the missing caveat rather than a blob.
  const CLAUSES: { id: string; probe: RegExp }[] = [
    { id: "long positions only, no shorts / cash / non-13(f)", probe: /no short/i },
    { id: "13(f) securities named", probe: /13\(f\)/i },
    { id: "quarter-end snapshot filed up to 45 days late", probe: /45 days/i },
    { id: "era-dependent value units", probe: /era-dependent/i },
    { id: "affiliated managers may report the same position", probe: /affiliated managers/i },
    { id: "confidential positions may be omitted", probe: /confidential/i },
  ];
  const findings: string[] = [];
  for (const surface of institutionalSurfaces()) {
    for (const clause of CLAUSES) {
      if (!clause.probe.test(surface.html)) {
        findings.push(`${surface.name} (owner ${surface.owner}) is missing: ${clause.id}`);
      }
    }
  }
  assert.deepEqual(
    findings,
    [],
    "the §5 data_note is non-removable (R16, M2-CONTRACT §5) and must ship WITH the data on" +
      " every institutional surface — render institutionalDataNoteHtml() from src/lib/activity.ts",
  );
});

test("T14/R16: the data_note's own classes are never dropped at any breakpoint", () => {
  const note = institutionalDataNoteHtml();
  for (const bp of BREAKPOINTS) {
    assert.deepEqual(
      droppedAt(note, bp.width),
      [],
      `the §5 data_note loses content at ${bp.name}px — it may never fold`,
    );
  }
  // and it prints: .caveat-line is forced visible in the print block
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.ok(printBlock.includes(".caveat-line"), "the note's lines print");
});

test("T14/R16: no banned trading verb on any institutional surface", () => {
  const findings: string[] = [];
  for (const surface of institutionalSurfaces()) {
    for (const hit of scanBannedWording(surface.html)) {
      findings.push(`${surface.name} (owner ${surface.owner}) uses "${hit}"`);
    }
  }
  assert.deepEqual(
    findings,
    [],
    "M2-8-outsized-position-spec.md §1.1: a 13F is a quarter-end snapshot filed up to 45 days" +
      " late, so at render time the position may not exist — no trading verb may claim otherwise",
  );
});
