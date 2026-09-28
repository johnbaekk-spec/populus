/* T6.1 (REPOSITORY-PROFESSIONALIZATION Slice 6): export-parity for the ui entry.

   The reconciled public surface is exactly 64 exports: 54 runtime values
   (RANKING_FOOTNOTES among them — a re-export from congress-columns.ts, the
   61st symbol the plan calls out by name) and 10 type-only exports, which do
   not exist at runtime and are asserted against the entry file's source text.
   Any symbol added to or dropped from the entry must be reconciled here AND in
   the plan's ownership table — never silently. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadUi } from "./lib/ui-parity-surfaces.ts";

const VALUE_EXPORTS = [
  "ADDS_FOOTNOTES",
  "CONGRESS_RANGES",
  "CONGRESS_ROOTS",
  "INST_STAMP_CAVEAT",
  "NON_ALLEGATION_CAVEAT",
  "QOQ_FOOTNOTES",
  "RANKING_FOOTNOTES",
  "addsColumns",
  "addsSectionHtml",
  "breadcrumb",
  "briefingCards",
  "disclosureLedger",
  "markPairPrimary",
  "unavailableDesignPanel",
  "changesTableHtml",
  // refinement 20260910 fix, D5: the Position changes kind chips
  "changesKindChipsHtml",
  "congressRankingSection",
  "congressTickerBody",
  // refinement 20260910 fix, D4: one default-sort source for server and client
  "defaultRankingSortKey",
  "emptyWindowHtml",
  "entityTableCountText",
  "entityTxnRowsHtml",
  // DESIGN-POLISH M1: the signal family of a kind, so the watch band's client
  // rows carry the same row edge (tr[data-edge]) as the server's hit rows
  "familyOf",
  "entityTxnTable",
  "filerBody",
  "clusterBoardHtml",
  "newPositionLeadersHtml",
  "filerEdgarBlock",
  "filerPeriodSectionHtml",
  "filerTiles",
  "flowCellHtml",
  "flowRibbon",
  "holdersBody",
  "holdersTableHtml",
  "instStamp",
  "memberBody",
  "memberPaperBlock",
  "memberSignalsPanel",
  "memberStatTiles",
  "memberV2Sections",
  "moduleCard",
  "notableRailHtml",
  "pickSpecimen",
  "qoqChipHtml",
  "rankingAlternatives",
  "rankingExcludedRows",
  "rankingExclusions",
  "rankingRootHtml",
  "rankingRowsHtml",
  "rankingWindowHtml",
  "s1ModuleAbsent",
  "s2OutOfExtract",
  "s4Error",
  "s4Skeleton",
  "s7Banner",
  "HOME_CLAIM",
  "HOME_TILE_ROWS",
  "congressTileHtml",
  "movesTileHtml",
  "signalsTileHtml",
  "SIGNAL_HITS_PAGE_SIZE",
  "hitRowHtml",
  "hitsRangeText",
  "signalKindShort",
  "signalRowHtml",
  "signalsBody",
  "sortHits",
  "specimenCard",
  "tickerHoldersBody",
  "tickerInstSectionHtml",
  "tickerUnifiedBody",
  /* DESIGN-POLISH M2 (T2.4–T2.6): the filer PARTS the pre-rendered page, the
     /e/ driver and the period switch compose in DOM order (F, A-9); band I1's
     empty-state collapse; the one hits body renderer the server and the pager
     share, and its FIXED compact N (coordinator decision CD-1), and the hits
     table's column set.
     Twelve runtime symbols, no types. */
  "filerHeadHtml",
  "filerLedgerHtml",
  "filerChangesHtml",
  "filerBookShapeHtml",
  "filerHistoryHtml",
  "filerBandHtml",
  "filerFootHtml",
  "consensusConvictionBandHtml",
  "hitsBodyHtml",
  "SIGNAL_HITS_COMPACT_ROWS",
  // R12: the hits table's column set, shared by the server and the pager
  "signalHitColumns",
] as const;

const TYPE_EXPORTS = [
  "AddsSectionOpts",
  "AddsSortKey",
  "BuildStamps",
  "EntityTableOpts",
  "MemberV2Deps",
  "ModuleCardStats",
  "RankingAlternatives",
  // refinement 20260910 fix, D5
  "ChangesKindFilter",
  "RankingSectionOpts",
  "S4ErrorKind",
  "TickerHeaderInfo",
  "SignalsPageDeps",
  "TickerPageDeps",
] as const;

test("ui entry exports exactly the 82 reconciled runtime symbols", async () => {
  const ui = await loadUi();
  const actual = Object.keys(ui)
    .filter((k) => k !== "default" && k !== "module.exports")
    .sort();
  assert.deepEqual(actual, [...VALUE_EXPORTS].sort());
  assert.equal(VALUE_EXPORTS.length, 82, "70 through M1, plus the twelve M2 exports");
});

test("ui entry exports the 13 reconciled type-only symbols (95 total)", () => {
  const lib = path.resolve(import.meta.dirname, "..", "src", "lib");
  const entry = existsSync(path.join(lib, "ui", "index.ts"))
    ? path.join(lib, "ui", "index.ts")
    : path.join(lib, "ui.ts");
  const src = readFileSync(entry, "utf-8");
  for (const t of TYPE_EXPORTS) {
    // matches a direct declaration (`export interface X` / `export type X`)
    // or a `type X` entry inside an export/re-export block
    const declared = new RegExp(`export interface ${t}\\b|\\btype ${t}\\b`);
    assert.ok(declared.test(src), `type export ${t} missing from ${path.basename(entry)}`);
  }
  assert.equal(VALUE_EXPORTS.length + TYPE_EXPORTS.length, 95, "the reconciled surface is 95 (83 through M1 + 12 M2 runtime exports)");
});
