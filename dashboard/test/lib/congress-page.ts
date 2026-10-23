/* Launch F2 (R35, SC5): the WHOLE /congress/ page as it is served, built on a
   fixture without a build — the Base layout (`layouts/Base.astro`, its Mark),
   the page template (`pages/congress/index.astro`) and every renderer the page
   calls, with the page's own frontmatter steps repeated over fixture rows. The
   templates are read from the real files and served by `astro-template.ts`,
   which throws on any expression this module does not supply, so a page that
   gains one fails the budget tests loudly rather than being measured short.

   The fixture is production-shaped where the counts depend on it: both boards
   hold far more than ten ranked rows plus a next step of fifty; the feed's
   first page is twenty rows with owner codes, late flags and an unjoined
   filer; Monthly flow spans its 36 months with a mature lag sample. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { signalMenuHtml } from "../../src/lib/signal-sections.ts";

import { congressTickersRollup, leadersRollup } from "../../src/lib/derive.ts";
import { pct } from "../../src/lib/data.ts";
import {
  COMPACT_ROWS,
  DESIGN_FEED_PAGE_SIZE,
  feedCountText,
  feedHeadHtml,
  feedItemHtml,
  footnoteBlock,
  fmtInt,
  mergeFeed,
  note,
  pageSlice,
  withTableRoles,
  type PaperRow,
  type RenderCtx,
  type TxnRow,
} from "../../src/lib/format.ts";
import { feedItemHasTicker, planFeedParts, planTickerOffsets, TICKER_VIEW_NOUN } from "../../src/lib/feed-parts.ts";
import { serializeInlineJson } from "../../src/lib/inline-json.ts";
import {
  CONGRESS_ROOTS,
  congressRankingSection,
  disclosureLedger,
  markPairPrimary,
  monthlyFlowPanel,
  rankingAlternatives,
  type BuildStamps,
} from "../../src/lib/ui/index.ts";
import { congressLedgerFigures, congressLedgerItems } from "../../src/lib/ui/rankings.ts";
import { serveAstroTemplate } from "./astro-template.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");

export const BUILD_DATE = "2026-10-19";

/** Rows across three years and both chambers: 420 members (one filer
    unjoined), 900 tickers (every ninth row has none), purchases and sales,
    owner codes, late rows, and a mature lag sample for Monthly flow. */
export function congressFixtureRows(): { txns: TxnRow[]; papers: PaperRow[] } {
  const txns: TxnRow[] = [];
  for (let i = 0; i < 24_000; i++) {
    const m = i % 420;
    const t = i % 900;
    const traded = new Date(Date.UTC(2023, 0, 1) + ((i * 37) % 1380) * 86_400_000).toISOString().slice(0, 10);
    const lag = 3 + (i % 50);
    const filed = new Date(Date.parse(`${traded}T00:00:00Z`) + lag * 86_400_000).toISOString().slice(0, 10);
    txns.push({
      kind: "txn", txnId: `t${i}`, asset: `Fixture Asset ${t} Inc`, assetType: i % 7 ? "ST" : null,
      filed: filed > BUILD_DATE ? BUILD_DATE : filed, traded,
      name: m === 7 ? "Unjoined, Filer" : `Member Name ${m}`, bioguide: m === 7 ? null : `M${String(m).padStart(6, "0")}`,
      party: ["D", "R", "I"][m % 3]!, state: "CA", district: m % 2 ? "12" : null, chamber: m % 2 ? "house" : "senate",
      ticker: i % 9 === 0 ? null : `T${t}`, side: i % 3 ? "purchase" : i % 6 === 0 ? "sale_partial" : "sale",
      owner: (["self", "spouse", "joint", "child"] as const)[i % 4]!, low: 1001 + (i % 6) * 14_000, high: 15_000 + (i % 6) * 35_000,
      lag, late: lag > 45 ? 1 : 0, flags: lag > 45 ? ["late"] : [], doc: `https://disclosures-clerk.house.gov/ptr/${i}.pdf`,
    } as TxnRow);
  }
  /* the stated absences production carries: rows with no trade date (both
     boards and Monthly flow exclude them) and three members whose every
     amount is undisclosed (the Members board's not-rankable table) */
  for (let i = 0; i < 30; i++) txns.push({ ...txns[i * 7]!, txnId: `u${i}`, traded: null, lag: null, late: null, flags: [] } as TxnRow);
  for (let i = 0; i < 3; i++)
    txns.push({ ...txns[i]!, txnId: `nd${i}`, traded: "2026-08-03", filed: "2026-08-24", lag: 21, name: `Undisclosed Member ${i}`, bioguide: `U${String(i).padStart(6, "0")}`, low: null, high: null } as TxnRow);
  txns.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const papers: PaperRow[] = Array.from({ length: 40 }, (_, i) => ({
    kind: "paper", filed: `2026-0${1 + (i % 9)}-1${i % 10}`, name: `Paper Member ${i}`, bioguide: `P${String(i).padStart(6, "0")}`,
    party: "D", state: "NY", district: "3", chamber: "house", doc: `https://disclosures-clerk.house.gov/paper/${i}.pdf`,
  } as PaperRow));
  return { txns, papers };
}

/** The page's own frontmatter steps (pages/congress/index.astro), over the
    fixture: the same functions, the same arguments. */
function congressPageValues(txns: TxnRow[], papers: PaperRow[]): Record<string, string | boolean> {
  const merged = mergeFeed(txns, papers);
  const stamps: BuildStamps = { buildId: "fixture.1", generatedAt: `${BUILD_DATE} 12:00 UTC`, generatedAtDate: BUILD_DATE };
  const coverage = { housePct: "98.1", houseParsed: 5_210, houseEfile: 5_311, senatePct: "99.2", senateParsed: 2_100, senateEfile: 2_117, needsOcr: 1_204 };
  const partsIndex = planFeedParts(merged, { build_id: stamps.buildId, generated_at: null }).index;
  const tickerOffsets = planTickerOffsets(merged, partsIndex);
  const ledgerHtml = disclosureLedger(
    congressLedgerItems(
      congressLedgerFigures(txns, { buildDate: BUILD_DATE, filedFrom: "2014" }),
      { ...coverage, efilePct: pct(coverage.houseParsed + coverage.senateParsed, coverage.houseEfile + coverage.senateEfile) },
      pct,
    ),
    { scope: "congress-ledger" },
  );
  const page = read("pages/congress/index.astro");
  const tipText = /const readTip = note\(\s*"([^"]+)"/.exec(page)?.[1];
  if (!tipText) throw new Error("congress-page: the page's read tip is not where this fixture reads it");
  const readTip = note(tipText, { scope: "congress-head" }, "read", { trigger: "mark", textHtml: "ⓘ", name: "How to read this page" });
  const cut: RenderCtx = { cutMembers: new Set(["M000011"]), cutTickers: new Set(["T12"]) };
  const sectionCtx: RenderCtx = { referenceRankings: true, ...cut };
  const tickerView = merged.filter(feedItemHasTicker);
  const pageOne = pageSlice(tickerView, 0, DESIGN_FEED_PAGE_SIZE);
  const momentumHtml = congressRankingSection(
    "tickers",
    congressTickersRollup(txns, BUILD_DATE, { range: "12m", basis: "traded" }),
    stamps,
    sectionCtx,
    {
      rootId: CONGRESS_ROOTS.momentum, heading: "Tickers", sectionId: "momentum-section", controls: true, compact: COMPACT_ROWS,
      alternatives: rankingAlternatives(txns, BUILD_DATE, "tickers", "12m", "traded"),
    },
  );
  const membersHtml = congressRankingSection("leaders", leadersRollup(txns, BUILD_DATE, { range: "12m", basis: "traded" }), stamps, sectionCtx, {
    rootId: CONGRESS_ROOTS.membersRanked, undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed, heading: "Members", sectionId: "members-section",
    compact: COMPACT_ROWS,
  });
  const footHtml = footnoteBlock([{ mark: "‡", html: `Senate spouse amounts above $1M print only as "Over $1,000,000"` }], { id: "feed-footnote", layout: "inline" });
  const rangeText = feedCountText({
    page: 0, pageSize: DESIGN_FEED_PAGE_SIZE, txnMatched: tickerOffsets.ticker_total, paperMatched: 0,
    txnOnPage: pageOne.filter((i) => i.kind === "txn").length, paperOnPage: 0, txnTotal: tickerOffsets.ticker_total, indeterminate: 0,
    view: { noun: TICKER_VIEW_NOUN, hiddenNoTicker: tickerOffsets.no_ticker_total, hiddenPaper: tickerOffsets.paper_total },
  });
  return {
    readTip,
    ledgerHtml,
    "build.generatedAt": stamps.generatedAt,
    "markPairPrimary(membersHtml)": markPairPrimary(membersHtml),
    momentumHtml,
    rangeText,
    'feedHeadHtml({ activeKey: "filed", activeDir: "desc", notes: { scope: "congress-feed" } })': feedHeadHtml({ activeKey: "filed", activeDir: "desc", notes: { scope: "congress-feed" } }),
    rowsHtml: pageOne.map((item) => feedItemHtml(item, { cutMembers: cut.cutMembers, cutTickers: cut.cutTickers })).join("\n"),
    footnoteHtml: footHtml,
    monthlyFlowHtml: monthlyFlowPanel(txns, BUILD_DATE),
    partsIndexJson: serializeInlineJson(partsIndex),
    tickerOffsetsJson: serializeInlineJson(tickerOffsets),
    /* Senate DEGRADED mode: a current build (the measured page) has no
       statement; senate-degraded.test.ts measures the degraded page. */
    senateStaleHtml: false as string | boolean,
  };
}

/** The served /congress/ document on the fixture: the page body through
    `withTableRoles` (as Base.astro renders it), inside the Base layout. */
export function congressPageFixture(opts: { senateStaleHtml?: string } = {}): { html: string; body: string } {
  const { txns, papers } = congressFixtureRows();
  const values = congressPageValues(txns, papers);
  if (opts.senateStaleHtml) values.senateStaleHtml = opts.senateStaleHtml;
  const body = withTableRoles(serveAstroTemplate(read("pages/congress/index.astro"), values));
  const members = new Set(txns.map((r) => r.bioguide).filter(Boolean)).size;
  const tickers = new Set(txns.map((r) => r.ticker).filter(Boolean)).size;
  const base = serveAstroTemplate(
    read("layouts/Base.astro"),
    {
      title: "Congressional trading — Public Filings",
      head: "",
      pageBody: body,
      "navCounts.congress": `${fmtInt(txns.length)} trades`,
      "navCounts.institutional": "9,451 13F filers",
      "navCounts.signals": "152 hits · 2025-07-21 → 2026-10-19",
      signalMenu: signalMenuHtml(),
      canonical: "https://publicfilings.org/congress/",
      searchHint: `${fmtInt(members)} members · ${fmtInt(tickers)} tickers · 9,451 13F filers`,
      "FOOTER_NOTICE[footer]":
        "Not financial advice. Use of congressional disclosure reports for commercial purposes, credit decisions or solicitation is restricted by 5 U.S.C. §13107(c).",
    },
    { Mark: serveAstroTemplate(read("components/Mark.astro"), {}) },
  );
  /* Astro injects the bundled stylesheets into <head>: two <link> elements on
     the served T0 congress page (M0 evidence, live 20261020.2). */
  const html = base.replace("</head>", '<link rel="stylesheet" href="/_astro/a.css"><link rel="stylesheet" href="/_astro/b.css"></head>');
  return { html, body };
}
