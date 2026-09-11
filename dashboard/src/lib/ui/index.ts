/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/index.ts — the single consumer entry point for the ui/ domain modules.
   It re-exports the original domain renderers and shared design bands.
   Consumers import ONLY from here, never
   from a domain module. The exact export set is pinned by
   dashboard/test/ui-exports.test.ts, so adding or dropping a symbol here is a
   deliberate, tested change to the module's public API. */

export { type BuildStamps, breadcrumb } from "./shared.ts";
export {
  type EntityTableOpts,
  type MemberV2Deps,
  flowRibbon,
  flowCellHtml,
  entityTxnRowsHtml,
  entityTableCountText,
  entityTxnTable,
  memberStatTiles,
  memberPaperBlock,
  memberBody,
  congressTickerBody,
  NON_ALLEGATION_CAVEAT,
  memberV2Sections,
} from "./congress.ts";
export {
  type RankingSectionOpts,
  type RankingAlternatives,
  CONGRESS_ROOTS,
  rankingRowsHtml,
  rankingRootHtml,
  rankingExclusions,
  rankingExcludedRows,
  rankingWindowHtml,
  CONGRESS_RANGES,
  rankingAlternatives,
  defaultRankingSortKey,
  emptyWindowHtml,
  congressRankingSection,
} from "./rankings.ts";
export {
  type SignalsPageDeps,
  signalRowHtml,
  signalsBody,
  memberSignalsPanel,
  hitRowHtml,
  hitsRangeText,
  sortHits,
  signalKindShort,
  SIGNAL_HITS_PAGE_SIZE,
} from "./signals.ts";
export { type TickerHeaderInfo, type TickerPageDeps, tickerInstSectionHtml, tickerUnifiedBody } from "./ticker.ts";
export {
  type AddsSortKey,
  type AddsSectionOpts,
  instStamp,
  INST_STAMP_CAVEAT,
  holdersBody,
  holdersTableHtml,
  filerTiles,
  QOQ_FOOTNOTES,
  qoqChipHtml,
  changesTableHtml,
  changesKindChipsHtml,
  type ChangesKindFilter,
  filerPeriodSectionHtml,
  filerEdgarBlock,
  filerBody,
  clusterBoardHtml,
  newPositionLeadersHtml,
  ADDS_FOOTNOTES,
  addsColumns,
  addsSectionHtml,
  notableRailHtml,
  tickerHoldersBody,
} from "./institutional.ts";
export {
  type S4ErrorKind,
  s1ModuleAbsent,
  s2OutOfExtract,
  s4Skeleton,
  s4Error,
  s7Banner,
} from "./states.ts";
export { pickSpecimen, specimenCard, type ModuleCardStats, moduleCard, congressTileHtml, movesTileHtml, signalsTileHtml, HOME_CLAIM, HOME_TILE_ROWS } from "./home.ts";

/* `RANKING_FOOTNOTES` moved to `congress-columns.ts`, which is where
   the columns that now carry its text are declared, and is re-exported here so
   no consumer's import path changed. `RANKING_FOOTNOTES_ID` is retired with the
   block it named — the section no longer renders a footnote container. */
export { RANKING_FOOTNOTES } from "../congress-columns.ts";

export { briefingCards, disclosureLedger, unavailableDesignPanel } from "./shared.ts";
