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

const CSS_PATH = path.resolve(import.meta.dirname, "..", "src", "styles", "global.css");
const css = readFileSync(CSS_PATH, "utf-8");

/* ---------- a tiny deterministic CSS walker ---------- */

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `@media` block whose condition includes a max-width ≤ 720px. */
function narrowMediaBlocks(source: string): { condition: string; body: string }[] {
  const text = stripComments(source);
  const blocks: { condition: string; body: string }[] = [];
  const re = /@media([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const condition = m[1]!;
    const widthMatch = condition.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
    if (!widthMatch || Number(widthMatch[1]) > 720) continue;
    // brace-match the block body
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    blocks.push({ condition: condition.trim(), body: text.slice(re.lastIndex, i - 1) });
  }
  return blocks;
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
