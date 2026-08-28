/* T6.1 (REPOSITORY-PROFESSIONALIZATION Slice 6): export-parity for the ui entry.

   The reconciled public surface is exactly 61 exports: 51 runtime values
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
  "changesTableHtml",
  "congressRankingSection",
  "congressTickerBody",
  "emptyWindowHtml",
  "entityTableCountText",
  "entityTxnRowsHtml",
  "entityTxnTable",
  "filerBody",
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
  "signalRowHtml",
  "signalsBody",
  "specimenCard",
  "tickerInstSectionHtml",
  "tickerUnifiedBody",
] as const;

const TYPE_EXPORTS = [
  "AddsSectionOpts",
  "AddsSortKey",
  "BuildStamps",
  "EntityTableOpts",
  "MemberV2Deps",
  "ModuleCardStats",
  "RankingAlternatives",
  "RankingSectionOpts",
  "S4ErrorKind",
  "TickerHeaderInfo",
] as const;

test("ui entry exports exactly the 51 reconciled runtime symbols", async () => {
  const ui = await loadUi();
  const actual = Object.keys(ui)
    .filter((k) => k !== "default" && k !== "module.exports")
    .sort();
  assert.deepEqual(actual, [...VALUE_EXPORTS]);
});

test("ui entry exports the 10 reconciled type-only symbols (61 total)", () => {
  const lib = path.resolve(import.meta.dirname, "..", "src", "lib");
  const entry = existsSync(path.join(lib, "ui", "index.ts"))
    ? path.join(lib, "ui", "index.ts")
    : path.join(lib, "ui.ts");
  const src = readFileSync(entry, "utf-8");
  for (const t of TYPE_EXPORTS) {
    const declared = new RegExp(
      `export (interface ${t}\\b|type ${t}\\b)|export type \\{[^}]*\\b${t}\\b`,
    );
    assert.ok(declared.test(src), `type export ${t} missing from ${path.basename(entry)}`);
  }
  assert.equal(VALUE_EXPORTS.length + TYPE_EXPORTS.length, 61, "the reconciled surface is 61");
});
