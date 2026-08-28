/* Slice 6 (REPOSITORY-PROFESSIONALIZATION) rendered-output parity surfaces.

   One deterministic fixture set, rendered through the public ui entry point.
   The captures in test/fixtures/ui-split-parity.json were taken on the
   UNSPLIT tree (ui.ts, pre-T6.2); ui-split-parity.test.ts asserts the split
   modules produce byte-identical output. `loadUi()` resolves the entry
   dynamically so the same harness runs against ui.ts before the split and
   ui/index.ts after it, with no edit in between. */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function loadUi(): Promise<any> {
  try {
    return await import("../../src/lib/ui/index.ts");
  } catch {
    return await import("../../src/lib/ui.ts");
  }
}

function txn(over: Record<string, unknown> = {}): any {
  return {
    kind: "txn",
    txnId: "t-parity",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-06-24",
    name: "Fixture Member",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "joint",
    low: 1001,
    high: 15000,
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
    ...over,
  };
}

const STAMPS = {
  buildId: "20260724.3",
  generatedAt: "2026-07-24 06:56 UTC",
  generatedAtDate: "2026-07-24",
};

const CTX: any = { watched: new Set() };

const TXNS = [
  txn(),
  txn({
    txnId: "t-parity-2",
    side: "sale_partial",
    filed: "2026-07-01",
    traded: "2026-05-11",
    late: 1,
    lag: 51,
    ticker: "NVDA",
    low: 15001,
    high: 50000,
  }),
  txn({
    txnId: "t-parity-3",
    side: "purchase",
    filed: "2026-06-20",
    traded: null,
    lag: null,
    ticker: null,
    asset: "US Treasury Note",
    assetType: "bond",
    low: null,
    high: null,
    flags: ["amount_unparsed"],
  }),
];

const MEMBER: any = {
  bioguide: "T000001",
  name: "Fixture Member",
  party: "R",
  state: "OK",
  district: null,
  chamber: "senate",
  servingSince: "1999",
  filingCount: 3,
  txns: TXNS,
  paper: [
    {
      kind: "paper",
      filed: "2026-06-01",
      name: "Fixture Member",
      bioguide: "T000001",
      party: "R",
      state: "OK",
      district: null,
      chamber: "senate",
      doc: "https://efdsearch.senate.gov/search/view/paper/def/",
    },
  ],
};

const TICKER_ENTITY: any = { ticker: "WMB", txns: TXNS.filter((t) => t.ticker === "WMB") };

const HOLDERS: any[] = [
  {
    issuer_key: "entity:42",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0000102909",
    filer_name: "Fixture Advisors LLC",
    issuer_name: "Williams Cos Inc",
    issuer_key_source: "entity",
    value_usd: 1234567890,
    security_count: 2,
    flags: [],
    tier: "top",
  },
  {
    issuer_key: "entity:42",
    period_of_report: "2026-03-31",
    rank: 2,
    cik: "0000200217",
    filer_name: "Parity Capital Mgmt",
    issuer_name: "Williams Cos Inc",
    issuer_key_source: "entity",
    value_usd: 98765432,
    security_count: 1,
    flags: ["security_not_in_mapping"],
    tier: "tail",
  },
];

const CONC: any = {
  cik: "0000102909",
  period_of_report: "2026-03-31",
  position_count: 120,
  total_value_usd: 4567890123,
  null_value_positions: 3,
  topn_value_usd: 2345678901,
  topn_share_bps: 5135,
  hhi: 412,
  flags: [],
};

const DELTAS: any[] = [
  {
    cik: "0000102909",
    position_key: "cusip:969457100",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 1000000,
    curr_value_usd: 1500000,
    delta_value_usd: 500000,
    prev_shares: 10000,
    curr_shares: 14000,
    delta_shares: 4000,
    ssh_prnamt_type: "SH",
    flags: [],
  },
  {
    cik: "0000102909",
    position_key: "sid:77",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "exit",
    prev_value_usd: 250000,
    curr_value_usd: null,
    delta_value_usd: null,
    prev_shares: 500,
    curr_shares: null,
    delta_shares: null,
    ssh_prnamt_type: "SH",
    flags: ["value_undisclosed_one_side"],
  },
];

const WINDOW: any = { open: true, quarterEnd: "2026-06-30", deadline: "2026-08-14" };

const ADDS_PAYLOAD: any = {
  period: "2026-03-31",
  generated_at: "2026-07-24 06:56 UTC",
  rows: [
    {
      issuer_key: "entity:42",
      issuer_key_source: "entity",
      issuer_name: "Williams Cos Inc",
      manager_count: 12,
      new_position_count: 4,
      delta_value_usd: 34567890,
      delta_value_is_partial: false,
      top_adder_cik: 102909,
      top_adder_name: "Fixture Advisors LLC",
    },
    {
      issuer_key: "name:parity corp",
      issuer_key_source: "name",
      issuer_name: null,
      manager_count: 3,
      new_position_count: 3,
      delta_value_usd: null,
      delta_value_is_partial: true,
      top_adder_cik: null,
      top_adder_name: null,
    },
  ],
  truncated: false,
  truncation_boundary: null,
  ambiguous_identity_exclusion_count: 0,
};

const SIGNAL_ARTIFACT: any = {
  v: 1,
  buildId: "20260724.3",
  computedAt: "2026-07-24 06:56 UTC",
  thresholdVersion: "1",
  retentionDays: 90,
  coverageFrom: "2026-04-25",
  coverageTo: "2026-07-24",
  lifecycleNote: "fixture",
  compaction: "fixture",
  dateAnomaliesExcluded: 1,
  signals: [
    {
      id: "sig-parity-1",
      kind: "s1-large",
      rule: "disclosed lower bound at or above $1,000,000",
      entities: { bioguide: "T000001", memberName: "Fixture Member", ticker: "WMB" },
      magnitude: { low: 1000001, high: 5000000 },
      receipts: ["https://efdsearch.senate.gov/search/view/ptr/abc/"],
      occurrence: { tradeDate: "2026-06-24", filedDate: "2026-07-21" },
      sourceAvailableAt: "2026-07-21",
      computedAt: "2026-07-24 06:56 UTC",
      firstSeenBuild: "20260724.3",
      lastSeenBuild: "20260724.3",
      status: "active",
      cohort: "senate",
    },
    {
      id: "sig-parity-2",
      kind: "s1-large",
      rule: "disclosed lower bound at or above $1,000,000",
      entities: { bioguide: "T000002", memberName: "Other Member", ticker: null },
      magnitude: { low: null, high: null },
      receipts: ["https://efdsearch.senate.gov/search/view/ptr/ghi/"],
      occurrence: { tradeDate: null, filedDate: "2026-06-01" },
      sourceAvailableAt: "2026-06-01",
      computedAt: "2026-07-24 06:56 UTC",
      firstSeenBuild: "20260701.1",
      lastSeenBuild: "20260724.3",
      status: "superseded",
      supersededInBuild: "20260724.3",
      cohort: "house",
    },
  ],
  withheld: [
    {
      kind: "s3-cooccurrence",
      reason: "uncalibrated",
      detail: "no calibration block for this kind in the build inputs.",
    },
  ],
  lagCaveat: "PTRs may be filed up to 45 days after the trade.",
};

/** Every rendered surface, keyed. Deterministic: fixed fixtures, fixed stamps. */
export async function renderParitySurfaces(): Promise<Record<string, string>> {
  const ui = await loadUi();
  const out: Record<string, string> = {};

  out["breadcrumb"] = ui.breadcrumb([{ text: "/congress", href: "/congress/" }, { text: "x" }]);
  out["instStamp"] = ui.instStamp("2026-03-31", "2026-05-01");
  out["flowCellHtml.undisclosed"] = ui.flowCellHtml({ kind: "undisclosed" });

  out["memberBody"] = ui.memberBody(MEMBER, STAMPS, CTX, 0);
  out["memberPaperBlock"] = ui.memberPaperBlock(MEMBER);
  out["memberV2Sections.absent-deps"] = ui.memberV2Sections(MEMBER, STAMPS, CTX, {
    resolveSector: null,
    sectorMeta: null,
    committees: null,
  });
  out["congressTickerBody"] = ui.congressTickerBody(TICKER_ENTITY, STAMPS, CTX);

  out["tickerUnifiedBody.module-absent"] = ui.tickerUnifiedBody(
    TICKER_ENTITY,
    { state: "module-absent" },
    STAMPS,
    CTX,
    { fullTable: false },
  );
  out["tickerUnifiedBody.data"] = ui.tickerUnifiedBody(
    TICKER_ENTITY,
    {
      state: "data",
      name: "Williams Cos Inc",
      cik: "0000107263",
      period: "2026-03-31",
      latestFiled: "2026-05-01",
      topn: 25,
      holders: HOLDERS.map((h) => ({
        rank: h.rank,
        cik: h.cik,
        name: h.filer_name,
        value: h.value_usd,
        securities: h.security_count,
        flags: h.flags,
        tier: h.tier,
      })),
    },
    STAMPS,
    CTX,
    { fullTable: true, page: 0 },
  );

  out["holdersBody"] = ui.holdersBody(
    "WMB",
    "Williams Cos Inc",
    HOLDERS,
    ["2026-03-31", "2025-12-31"],
    "2026-03-31",
    "2026-05-01",
    25,
    WINDOW,
  );
  out["holdersTableHtml"] = ui.holdersTableHtml(HOLDERS, "2026-03-31", "2026-05-01", 25);
  out["filerBody"] = ui.filerBody(
    { cik: "0000102909", name: "Fixture Advisors LLC", latestPeriod: "2026-03-31" },
    ["2026-03-31", "2025-12-31"],
    "2026-03-31",
    CONC,
    DELTAS,
    "2026-05-01",
    25,
    WINDOW,
    { total: 5, page: 0 },
  );
  out["changesTableHtml"] = ui.changesTableHtml(DELTAS, "2026-03-31", "2026-05-01", { total: 5 });
  out["filerEdgarBlock"] = ui.filerEdgarBlock("0000102909", "Fixture Advisors LLC");

  out["s1ModuleAbsent"] = ui.s1ModuleAbsent("module-absent");
  out["s2OutOfExtract"] = ui.s2OutOfExtract("m", "T000001");
  out["s4Skeleton"] = ui.s4Skeleton("/e/m/T000001.json", "/e/ · m:T000001");
  out["s4Error"] = ui.s4Error("server_error", "/e/m/T000001.json", "HTTP 500.", true);
  out["s7Banner"] = ui.s7Banner(WINDOW);

  const spec = ui.pickSpecimen(TXNS);
  out["specimenCard"] = spec ? ui.specimenCard(spec, CTX) : "<none>";
  out["moduleCard"] = ui.moduleCard("Congress", "/congress/", "PTR disclosures.", {
    live: true,
    statLines: ["3 filings", "3 rows"],
  });

  // rankings — rollup derived by the same functions /congress uses
  const { leadersRollup, congressTickersRollup } = await import("../../src/lib/derive.ts");
  const leaders = leadersRollup(TXNS, STAMPS.generatedAtDate, { range: "12m", basis: "traded" });
  out["congressRankingSection.leaders"] = ui.congressRankingSection(
    "leaders",
    leaders,
    STAMPS,
    CTX,
    {
      rootId: ui.CONGRESS_ROOTS.membersRanked,
      undisclosedRootId: ui.CONGRESS_ROOTS.membersUndisclosed,
      heading: "Members by net disclosed flow",
      sectionId: "members",
    },
  );
  const tickers = congressTickersRollup(TXNS, STAMPS.generatedAtDate, {
    range: "12m",
    basis: "traded",
  });
  out["congressRankingSection.tickers"] = ui.congressRankingSection(
    "tickers",
    tickers,
    STAMPS,
    CTX,
    {
      rootId: ui.CONGRESS_ROOTS.momentum,
      heading: "Ticker momentum",
      sectionId: "momentum",
      controls: true,
      alternatives: ui.rankingAlternatives(TXNS, STAMPS.generatedAtDate, "tickers", "12m", "traded"),
    },
  );
  out["emptyWindowHtml"] = ui.emptyWindowHtml(
    "7d",
    "traded",
    { otherBasis: 2, wider: { range: "30d", n: 3 } },
    "tickers",
  );

  out["addsSectionHtml"] = ui.addsSectionHtml(ADDS_PAYLOAD, {
    period: "2026-03-31",
    mode: "all",
    periods: ["2026-03-31", "2025-12-31"],
    buildId: STAMPS.buildId,
  });

  const { notableRecent } = await import("../../src/lib/derive.ts");
  out["notableRailHtml"] = ui.notableRailHtml(
    notableRecent(TXNS, STAMPS.generatedAtDate, 90, 5),
    CTX,
  );

  out["signalsBody"] = ui.signalsBody(SIGNAL_ARTIFACT, CTX);
  out["memberSignalsPanel"] = ui.memberSignalsPanel(SIGNAL_ARTIFACT, "T000001", CTX);
  out["memberSignalsPanel.empty"] = ui.memberSignalsPanel(SIGNAL_ARTIFACT, "Z999999", CTX);

  return out;
}
