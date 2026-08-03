/* Fixture-driven full page-body renders: honesty invariants per surface,
   every institutional-section state of the unified ticker page, the grep-
   negative sweep over SOURCE files for mockup sample literals (R14), and the
   markup half of the mobile honesty enforcement (R12a — fold-mode cards must
   CONTAIN the honesty elements; the CSS half is css-fold.test.ts). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  memberBody,
  tickerUnifiedBody,
  congressTickerBody,
  holdersBody,
  filerBody,
  type BuildStamps,
} from "../src/lib/ui.ts";
import type { MemberEntity, TickerEntity } from "../src/lib/derive.ts";
import type { TickerInstSection } from "../src/lib/data.ts";
import type { TopHolderRow } from "../src/lib/inst.ts";
import { type TxnRow, type RenderCtx } from "../src/lib/format.ts";

const CTX: RenderCtx = { watched: new Set() };
const STAMPS: BuildStamps = {
  buildId: "20260724.3",
  generatedAt: "2026-07-24 06:56 UTC",
  generatedAtDate: "2026-07-24",
};

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
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

const MEMBER: MemberEntity = {
  bioguide: "T000001",
  name: "Fixture Member",
  party: "R",
  state: "OK",
  district: null,
  chamber: "senate",
  servingSince: "1999",
  filingCount: 3,
  txns: [txn(), txn({ side: "sale_partial", filed: "2026-07-01", late: 1, lag: 51 })],
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
      doc: "https://efdsearch.senate.gov/search/view/paper/xyz/",
    },
  ],
};

const TICKER: TickerEntity = {
  ticker: "WMB",
  txns: [txn(), txn({ bioguide: "U000002", name: "Other Member", party: "D", state: "CA" })],
};

const HOLDERS: TopHolderRow[] = [
  {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity",
    value_usd: 2000,
    security_count: 1,
    flags: [],
  },
  {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2025-12-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity",
    value_usd: 1000,
    security_count: 1,
    flags: [],
  },
];

/* ---------- member body ---------- */

test("memberBody: honesty invariants — dual dates, star, § resolves, S5 block, caption", () => {
  const html = memberBody(MEMBER, STAMPS, CTX);
  assert.ok(html.includes("bioguide T000001"));
  assert.ok(html.includes("serving since 1999"));
  assert.ok(html.includes("spouse (SP), dependent children (DC), and joint accounts (JT)"));
  assert.ok(html.includes('data-watch-kind="member"'), "watch star wired to the v2 store");
  assert.ok(html.includes("saved in this browser only"));
  // § marker on the flow column resolves to a printed line in the same body
  assert.ok(html.includes('href="#member-footnotes"'));
  assert.ok(html.includes('id="member-footnotes"'));
  assert.ok(html.includes("an interval, not an estimate of value"));
  assert.ok(html.includes("<caption"), "real table semantics");
  assert.ok(html.includes("retained and counted"), "S5 paper block present");
  assert.ok(html.includes("LATE·51d"));
  // R12a: fold-mode honesty content present in markup — both dates + combined string
  assert.ok(html.includes('class="mobile-dates"'));
  assert.ok(html.includes("visually-hidden"));
  assert.ok(html.includes("· partial · JT") || html.includes("· JT"), "owner qualifier present");
  assert.ok(html.includes("cell-src"), "SRC receipt present");
});

test("memberBody: page 2 renders different rows through the same function", () => {
  const many: MemberEntity = {
    ...MEMBER,
    paper: [],
    txns: Array.from({ length: 60 }, (_, i) =>
      txn({ filed: `2026-05-${String((i % 28) + 1).padStart(2, "0")}`, ticker: `T${i}` }),
    ),
  };
  const p0 = memberBody(many, STAMPS, CTX, 0);
  const p1 = memberBody(many, STAMPS, CTX, 1);
  assert.notEqual(p0, p1);
  assert.ok(p1.includes("51–60 of 60"), "count line describes the page it renders");
});

/* ---------- unified ticker body: every institutional state ---------- */

function unified(inst: TickerInstSection): string {
  return tickerUnifiedBody(TICKER, inst, STAMPS, CTX, { fullTable: false });
}

test("unified ticker: module-absent renders honest absence with EDGAR link", () => {
  const html = unified({ state: "module-absent" });
  assert.ok(html.includes("not in this build"));
  assert.ok(html.includes("sec.gov"));
  assert.ok(!html.includes("Ranked holders"), "no fabricated holders section");
});

test("unified ticker: unresolved states refuse the join in words", () => {
  for (const state of ["no-map", "unmapped", "ambiguous"] as const) {
    const html = unified({ state });
    assert.ok(html.includes("Not resolved to an issuer — deliberately."), state);
    assert.ok(html.includes("does not guess identity from names"), state);
  }
  const amb = unified({ state: "ambiguous" });
  assert.ok(amb.includes("refuses to pick one"));
});

test("unified ticker: resolved-no-data names the mapped issuer and stops", () => {
  const html = unified({ state: "resolved-no-data", name: "Fixture Corp", cik: "0000000123" });
  assert.ok(html.includes("Mapped, but not in the published aggregate."));
  assert.ok(html.includes("Fixture Corp"));
});

test("unified ticker: data state — published columns only, stamp, terminus, † mapping label", () => {
  const html = unified({
    state: "data",
    name: "Fixture Corp",
    cik: "0000320193",
    period: "2026-03-31",
    latestFiled: "2026-05-15",
    topn: 25,
    holders: [
      {
        rank: 1,
        cik: "0001067983",
        name: "FIXTURE HOLDINGS LLC",
        value: 2000,
        securities: 1,
        keySource: "entity",
        flags: [],
      },
    ],
  });
  assert.ok(html.includes("Fixture Corp"));
  assert.ok(html.includes("†"), "present-day mapping is G14-labeled");
  assert.ok(html.includes("present-day mapping, not the name as of each filing"));
  assert.ok(html.includes("quarter-end 2026-03-31"));
  assert.ok(html.includes("latest filing in build filed 2026-05-15"));
  assert.ok(!html.includes(">Shares<"), "unpublished columns stay out");
  assert.ok(html.includes('data-terminus-author="populus"'));
  assert.ok(html.includes("derived&nbsp;·§"));
  assert.ok(html.includes("full holders view ↗"));
  assert.ok(!html.toLowerCase().includes("current holdings"));
});

test("unified ticker: section index, planned placeholders, own-clock lede", () => {
  const html = unified({ state: "module-absent" });
  assert.ok(html.includes("section-index"));
  assert.ok(html.includes("Financials"));
  assert.ok(html.includes("PLANNED"));
  assert.ok(html.includes("each section keeps its own clock") || html.includes("Each section keeps its own clock"));
  assert.ok(html.includes("full congressional view ↗"));
});

/* ---------- deep congress ticker ---------- */

test("congressTickerBody: two-sided ribbon, exclusions footnote, netting caveat", () => {
  const html = congressTickerBody(TICKER, STAMPS, CTX);
  assert.ok(html.includes("ribbon-two"));
  assert.ok(html.includes("purchases above axis, sales below"));
  assert.ok(html.includes("v_default_transactions"));
  assert.ok(html.includes("ranges cannot be netted"));
  assert.ok(html.includes("members · ever"));
  assert.ok(html.includes("13F institutional holders"));
});

/* ---------- holders + filer bodies ---------- */

test("holdersBody: period chips, top-N as a Populus build parameter, mapping footnote", () => {
  const html = holdersBody(
    "AAPL",
    "Apple Inc.",
    HOLDERS,
    ["2025-12-31", "2026-03-31"],
    "2026-03-31",
    "2026-05-15",
    25,
    null,
  );
  assert.ok(html.includes("Who holds"));
  assert.ok(html.includes('data-period="2025-12-31"'));
  assert.ok(html.includes('data-period="2026-03-31"'));
  assert.ok(html.includes("quarter-end snapshots — positions may have changed since"));
  assert.ok(html.includes("top-"), "top-N named");
  assert.ok(html.includes("not a census"));
  assert.ok(html.includes("company_tickers.json"), "mapping provenance printed");
  assert.ok(html.includes("filed dates, lags, share counts and document links are not in the published aggregate"));
});

test("filerBody: explainer, period-correct tiles, EDGAR block with the contract citation", () => {
  const html = filerBody(
    { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" },
    ["2025-12-31", "2026-03-31"],
    "2026-03-31",
    {
      cik: "0001067983",
      period_of_report: "2026-03-31",
      position_count: 2,
      total_value_usd: 2300,
      null_value_positions: 0,
      topn_value_usd: 2300,
      topn_share_bps: 10000,
      hhi: 7500,
      flags: [],
    },
    [],
    "2026-05-15",
    25,
    null,
  );
  assert.ok(html.includes("What a 13F is — and is not."));
  assert.ok(html.includes("not current holdings"));
  assert.ok(html.includes("$2.3K"), "period tile from agg_filer_concentration");
  assert.ok(html.includes("100.0%"), "topn share from bps");
  assert.ok(html.includes("M2-CONTRACT §3"), "the EDGAR link-out names its contract");
  // M2-CONTRACT §3 was amended 2026-08-02: holdings will be SERVED, not federated.
  // Until RUN M2-8 publishes the projection the page must say so honestly, and it
  // must never re-assert the retired "never served" claim.
  assert.ok(html.includes("not rendered here yet"));
  assert.ok(!html.includes("never served"));
  assert.ok(html.includes("CIK 0001067983"));
  assert.ok(html.includes('id="filer-footnotes"'), "the marker registry prints on the page");
});

/* ---------- grep-negative: mockup sample literals never ship (R14) ---------- */

const MOCKUP_LITERALS = [
  "54,213",
  "8,412",
  "97.5%",
  "96.8%",
  "$1.42T",
  "$267.2B",
  "Vanguard Group",
  "BlackRock",
  "Nancy Pelosi",
  "Geode Capital",
  "2,144.2M",
  "20260728.1",
  "9f2c…41aa",
  "0000950123-25-001799",
  "61% of expected",
  "93.1%",
];

function sourceFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test("no mockup sample literal appears in any page/renderer source", () => {
  const root = path.resolve(import.meta.dirname, "..", "src");
  for (const file of sourceFiles(root, [".ts", ".astro"])) {
    const text = readFileSync(file, "utf-8");
    for (const literal of MOCKUP_LITERALS) {
      assert.ok(
        !text.includes(literal),
        `${path.relative(root, file)} contains mockup sample literal ${JSON.stringify(literal)}`,
      );
    }
  }
});

test("renders under fixtures carry no mockup literals either", () => {
  const corpus = [
    memberBody(MEMBER, STAMPS, CTX),
    congressTickerBody(TICKER, STAMPS, CTX),
    unified({ state: "module-absent" }),
  ].join("\n");
  for (const literal of MOCKUP_LITERALS) {
    assert.ok(!corpus.includes(literal), `render contains ${JSON.stringify(literal)}`);
  }
});

/* ---------- SSR/client parity over the columnar codec (R19) ---------- */

test("parity: decode(encode(rows)) renders byte-identical bodies", async () => {
  const { txnToArray, txnFromArray, paperToArray, paperFromArray } = await import(
    "../src/lib/format.ts"
  );
  const decoded: MemberEntity = {
    ...MEMBER,
    txns: MEMBER.txns.map((r) => txnFromArray(txnToArray(r))),
    paper: MEMBER.paper.map((p) => paperFromArray(paperToArray(p))),
  };
  assert.equal(
    memberBody(decoded, STAMPS, CTX),
    memberBody(MEMBER, STAMPS, CTX),
    "the client's columnar round-trip and the SSR path render the same bytes",
  );
  const t: TickerEntity = { ...TICKER, txns: TICKER.txns.map((r) => txnFromArray(txnToArray(r))) };
  assert.equal(
    tickerUnifiedBody(t, { state: "module-absent" }, STAMPS, CTX, { fullTable: true }),
    tickerUnifiedBody(TICKER, { state: "module-absent" }, STAMPS, CTX, { fullTable: true }),
  );
});
