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
} from "../src/lib/ui/index.ts";
import {
  parseTickerMap,
  resolveTicker,
  type MemberEntity,
  type TickerEntity,
} from "../src/lib/derive.ts";
import { tickerInstSection, type BuildData, type TickerInstSection } from "../src/lib/data.ts";
import { readTickerMapJson, type TopHolderRow } from "../src/lib/inst.ts";
import { type TxnRow, type RenderCtx } from "../src/lib/format.ts";
import { domOf, ledgerFigures, visibleText } from "./lib/ledger-dom.ts";

const CTX: RenderCtx = {};
const STAMPS: BuildStamps = {
  buildId: "20260724.3",
  generatedAt: "2026-07-24 06:56 UTC",
  generatedAtDate: "2026-07-24",
};

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
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

test("memberBody: honesty invariants — dual dates, no watch control, § resolves, S5 block, caption", () => {
  const html = memberBody(MEMBER, STAMPS, CTX);
  assert.ok(html.includes("member ID T000001"));
  assert.ok(html.includes("serving since 1999"));
  assert.ok(html.includes("spouse (SP), dependent children (DC), and joint accounts (JT)"));
  /* signals-v3 M1 (R1): the header's watch star is gone — the title is the
     member's name alone, and nothing on the page offers to save to the device */
  assert.equal(visibleText(domOf(html).querySelector("h1.entity-title")!).trim(), "Fixture Member");
  assert.doesNotMatch(html, /data-watch|watch-btn|star-btn|saved in this browser|★|☆/, "no watch control or its copy");
  // § marker on the flow column resolves to a printed line in the same body
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R7 (LD6). `#member-footnotes`
     held ONE clause and it is now a note on the Flow range column and on the
     quarterly-flow panel's "derived ·§" marker. The § marker still renders;
     the clause is still in the same body. Both are asserted, so nothing about
     the honesty property is weaker than before — only the wrapper moved. */
  /* DESIGN-POLISH M1 (R2, R6): the mark HANGS in the column's slot (`.hang`)
     and the header label is the note's trigger. The § still renders on the
     Flow range header and its clause is still in the same body. */
  assert.match(html, /aria-label="Flow range, explain">Flow range<\/button><span class="note-pop" popover id="n-member-top-flow-range"[^>]*>[^<]*<\/span><\/span><span class="hang">·§<\/span><\/th>/);
  assert.ok(html.includes('id="n-member-top-flow-range"'));
  assert.ok(html.includes("flow range = sum of statutory bucket bounds"));
  assert.ok(html.includes("an interval, not an estimate of value"));
  assert.ok(html.includes("<caption"), "real table semantics");
  assert.ok(html.includes("retained and counted"), "S5 paper block present");
  assert.ok(html.includes("LATE·51d"));
  // R12a: fold-mode honesty content present in markup — both dates + combined string
  assert.ok(html.includes('class="design-dates"'));
  assert.ok(html.includes("visually-hidden"));
  /* DESIGN-POLISH M3 (R17, T3.10): the owner qualifier is present, UNPREFIXED
     — the Owner cell reads "partial · JT", never "· partial · JT", so no cell
     opens with a separator (read by DOM parse, the cell a reader sees). */
  const owners = domOf(html).querySelectorAll("td.c-owner").map((td) => visibleText(td).replace(/\s*\(.*\)$/, "").trim());
  assert.ok(owners.includes("partial · JT"), `owner qualifier present, unprefixed (${owners.join(" | ")})`);
  assert.ok(owners.every((o) => !o.startsWith("·")), "no Owner cell begins with a separator");
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
    holdersPage: true,
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
  assert.ok(html.includes("Quarter ended 2026-03-31"));
  assert.ok(html.includes("Newest filing in this build: 2026-05-15"), "the newest-filing date stays on the page (SRC §5 ⓘ)");
  assert.ok(!html.includes(">Shares<"), "unpublished columns stay out");
  assert.ok(html.includes('data-terminus-author="populus"'));
  assert.ok(html.includes("derived&nbsp;·§"));
  assert.ok(html.includes("full holders view ↗"));
  assert.ok(!html.toLowerCase().includes("current holdings"));
});

test("R2: the unified ticker's holders link renders only when that page is built", () => {
  const html = unified({
    state: "data",
    holdersPage: false,
    name: "Fixture Corp",
    cik: "0000320193",
    period: "2026-03-31",
    latestFiled: "2026-05-15",
    topn: 25,
    holders: [],
  });
  assert.ok(html.includes("Institutional holders"), "the section still renders");
  assert.ok(!html.includes("/holders/"), "no link to an unbuilt holders page");
});

/* signals-v3 M3 (R16, R17, LD8, LD9): the section index, the planned
   Financials / Macro placeholders, the lede and the story cards are gone. The
   page is two real tabs over two panels, both in the HTML, and the "each
   section keeps its own clock" sentence moved into the provenance line. */
test("R16/R17: two real tabs over two panels, both visible in the HTML; no Financials, Macro or PLANNED; no lede or story cards; the own-clock sentence in the provenance line", () => {
  const html = unified({ state: "module-absent" });
  const dom = domOf(html);
  const lists = dom.querySelectorAll('[role="tablist"]');
  assert.equal(lists.length, 1, "one tab list");
  assert.ok(lists[0]!.classList.contains("tk-tabs"));
  const tabs = lists[0]!.querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map((t) => [t.tagName, t.getAttribute("href"), t.getAttribute("aria-controls")]), [["a", "#congress", "congress"], ["a", "#institutional", "institutional"]]);
  assert.deepEqual(tabs.map((t) => visibleText(t).trim().split(/\s+/)[0]), ["Congress", "Institutional"]);
  const panels = dom.querySelectorAll('[role="tabpanel"]');
  assert.deepEqual(panels.map((p) => [p.tagName, p.getAttribute("id"), p.getAttribute("aria-labelledby")]), [["section", "congress", "tab-congress"], ["section", "institutional", "tab-institutional"]]);
  assert.deepEqual(tabs.map((t) => t.getAttribute("id")), ["tab-congress", "tab-institutional"], "each panel is labelled by its tab");
  // without JavaScript both panels show: the server never hides one, nor marks a tab selected
  assert.ok(panels.every((p) => !p.hasAttribute("hidden")), "no panel is hidden in the server HTML");
  assert.ok(tabs.every((t) => !t.hasAttribute("aria-selected") && !t.hasAttribute("tabindex")), "selection is the binder's, never the server's");
  assert.ok(html.indexOf('role="tablist"') < html.indexOf('id="congress"'), "the bar precedes the panels");
  // the Congress panel holds the Congress rows; the Institutional panel the holders
  assert.ok(dom.querySelector('#congress [aria-label="Congressional disclosures"]'), "the disclosures sit in the Congress panel");
  assert.ok(dom.querySelector("#institutional #ticker-holders"), "the holders sit in the Institutional panel");
  for (const gone of ["Financials", "Macro", "PLANNED", "SOON", "section-index", "si-soon", "entity-lede", "design-briefing", "design-story", "planned-card"]) {
    assert.ok(!html.includes(gone), `no ${gone}`);
  }
  // the clock sentence moved, it did not vanish (LD9)
  const prov = dom.querySelector(".design-provenance")!;
  assert.match(visibleText(prov.querySelector(".tk-clock")!), /^Each section keeps its own clock — congressional trades on the 45-day PTR clock, 13F holdings as quarter-end snapshots\.$/);
  assert.equal(html.split("keeps its own clock").length - 1, 1, "stated once, in the provenance line");
  assert.ok(html.includes("full congressional view ↗"));
});

/* ---------- TD-7: the ticker surface CI actually deploys ---------- */

/* Every unified-ticker case above hands the renderer a hand-written state
   literal, and every OTHER suite runs with POPULUS_TICKER_MAP unset — which
   loads the committed fixture. So the gates have only ever exercised the MAPPED
   path, while the deployed site takes the other one: the CI refusal rejects a
   tests/fixtures map, no real company_tickers.json exists on a runner, so
   POPULUS_TICKER_MAP points at an explicitly absent path (TD-7). This drives
   that deployed chain through the real functions end to end — env →
   readTickerMapJson → null → tickerInstSection → renderer — rather than
   asserting a state literal somebody typed. */
test("TD-7 no-map: an absent ticker map renders the honest state through the real chain", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const prev = process.env.POPULUS_TICKER_MAP;
  process.env.POPULUS_TICKER_MAP = path.join(repoRoot, "no-such-company_tickers.json");
  try {
    const mapJson = readTickerMapJson(repoRoot);
    assert.equal(mapJson, null, "an absent path is an explicit null, never a silent fallback");
    const tickerMap = mapJson === null ? null : parseTickerMap(mapJson);
    assert.equal(tickerMap, null);
    assert.equal(resolveTicker(tickerMap, TICKER.ticker).state, "no-map");

    // The real data-layer function the ticker page calls. Only `inst` and
    // `tickerMap` are read on this branch — and the module must be PRESENT, or
    // the page answers module-absent and this copy never renders at all.
    const build = { inst: { present: true }, tickerMap } as unknown as BuildData;
    const section = tickerInstSection(build, TICKER.ticker);
    assert.deepEqual(section, { state: "no-map" });

    const html = unified(section);
    assert.ok(
      html.includes("This build carries no ticker→issuer mapping input"),
      "no-map states its OWN reason, not the unmapped 'not in the SEC file' one",
    );
    assert.ok(html.includes("Not resolved to an issuer — deliberately."));
    assert.ok(!html.includes("Ranked holders"), "no holders table is fabricated with no map");
    assert.ok(html.includes("sec.gov"), "the primary-source escape hatch survives the no-map state");
  } finally {
    if (prev === undefined) delete process.env.POPULUS_TICKER_MAP;
    else process.env.POPULUS_TICKER_MAP = prev;
  }
});

/* ---------- deep congress ticker ---------- */

test("congressTickerBody: two-sided ribbon, exclusions footnote, netting caveat", () => {
  const html = congressTickerBody(TICKER, STAMPS, CTX);
  assert.ok(html.includes("ribbon-two"));
  assert.ok(html.includes("purchases above axis, sales below"));
  assert.ok(html.includes("Amended filings show the latest version"));
  assert.ok(html.includes("ranges cannot be netted"));
  /* DESIGN-POLISH M2 (T2.8): the header's figures render through the ONE
     ledger; the property — the page states how many distinct members EVER
     disclosed this ticker — is read from its <dl>, with the value checked. */
  const figs = ledgerFigures(html);
  assert.deepEqual(figs.map((f) => f.label), ["Members · ever", "Transactions", "Disclosed flow · 12m", "Latest filing"]);
  assert.equal(figs[0]!.value, "2", "two distinct members disclosed WMB");
  assert.equal(figs[1]!.value, String(TICKER.txns.length));
  // R2: the holders link renders ONLY when the holders page was built for
  // this ticker (ctx.holdersPage) — never an unconditional, dressed 404.
  assert.ok(!html.includes("13F institutional holders"));
  assert.ok(!html.includes("/institutional/tickers/"));
  const gated = congressTickerBody(TICKER, STAMPS, { ...CTX, holdersPage: true });
  assert.ok(gated.includes(`/institutional/tickers/${encodeURIComponent(TICKER.ticker)}/holders/`));
});

/* ---------- holders + filer bodies ---------- */

test("holdersBody: period chips, top-N as a Public Filings build parameter, mapping footnote", () => {
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
  /* DESIGN-POLISH M3 (Architecture H, G-11): the same absent fields, named in
     plain words — "this build's published top-holders list", never the table
     name or the design mockup. */
  assert.ok(html.includes("filed dates, lags, share counts and document links are not in that list and are not shown"));
  assert.ok(html.includes("this build's published top-holders list"));
  assert.ok(!/agg_issuer_top_holders|mockup/.test(html), "no table name, no mockup");
});

test("filerBody: explainer, period-correct tiles, EDGAR block with the decision date", () => {
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
  // QA M2-8 M6: the header explainer must NOT restate the §5 data_note. It used
  // to open "What a 13F is — and is not." — one character from the canonical
  // caveat box's heading — and both rendered on this page with different
  // wording, so a reader met two same-titled blocks and no way to tell which was
  // authoritative. The header now carries the one claim it must (G2: the page is
  // not current holdings) and POINTS at the canonical box.
  assert.ok(
    !html.includes("What a 13F is — and is not."),
    "the header must not carry a second phrasing of the §5 data_note",
  );
  assert.ok(html.includes('href="#inst-data-note"'), "the header links INTO the canonical box");
  assert.ok(html.includes("not current holdings"));
  assert.ok(html.includes("$2.3K"), "period tile from agg_filer_concentration");
  assert.ok(html.includes("100.0%"), "topn share from bps");
  /* DESIGN-POLISH M3 (Architecture H, V1 NEW-1, round 3 NEW-1; T3.10): the
     EDGAR block states the DECISION and its date — 2026-08-01, the owner's
     decision and the §3 amendment (holdings-publication.md:3, :83) — never
     "has served … since", and never 2026-08-02 (only when parameters were
     locked). The contract's name leaves the reader copy. */
  assert.ok(html.includes("Public Filings decided on 2026-08-01 to serve this list from its published build"), "the EDGAR link-out names the decision and its date");
  assert.ok(html.includes("filings newer than this build are on EDGAR"));
  assert.ok(html.includes("where the page cannot embed every reported row, the list says how many it leaves out"));
  assert.ok(!/has served|has published [^.]* since|2026-08-02|M2-CONTRACT §3/.test(html), "control: no served-since claim, no parameter-lock date");
  // M2-CONTRACT §3 was amended 2026-08-01: holdings will be SERVED, not federated.
  // Until RUN M2-8 publishes the projection the page must say so honestly, and it
  // must never re-assert the retired "never served" claim.
  // T11 landed: the holdings table renders, so the EDGAR block is now
  // PROVENANCE rather than a stand-in. Asserting the retired copy would pin the
  // page to a claim it no longer makes.
  assert.ok(html.includes("provenance, not a substitute"));
  assert.ok(!html.includes("not rendered here yet"));
  assert.ok(!html.includes("never served"));
  /* R20 (DESIGN-POLISH M3, T3.4): the CIK a reader sees has no leading zeros —
     breadcrumb and subline alike — and the padded form stays machine-only
     (the EDGAR href keeps CIK=0001067983). */
  assert.ok(html.includes("CIK 1067983"));
  assert.ok(!/CIK 0\d/.test(html.replace(/<[^>]*>/g, " ")), "no visible zero-padded CIK");
  assert.ok(html.includes("CIK=0001067983"), "the machine field keeps its padding");
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R7 (LD6). `#filer-footnotes` is
     deleted and its six clauses are notes on the position-changes columns whose
     cells emit their marks. That is a real behaviour change worth pinning: with
     NO changes to show — this fixture's case — the registry no longer prints at
     all, which is correct, because no marker prints either. The positive case
     is asserted immediately below on a body that HAS a change row, so the
     clauses are proved present where the marks are rather than merely absent
     where they are not. */
  assert.ok(!html.includes('id="filer-footnotes"'));
  const withChanges = filerBody(
    { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" },
    ["2025-12-31", "2026-03-31"],
    "2026-03-31",
    null,
    [
      {
        cik: "0001067983",
        position_key: "cusip:037833100",
        put_call: "LONG",
        curr_period: "2026-03-31",
        prev_period: "2025-12-31",
        change_kind: "trim",
        prev_value_usd: 1_000_000,
        curr_value_usd: 400_000,
        delta_value_usd: -600_000,
        prev_shares: 1_000,
        curr_shares: 400,
        delta_shares: -600,
        ssh_prnamt_type: "SH",
        flags: [],
      },
    ],
    "2026-05-15",
    25,
    null,
  );
  assert.ok(withChanges.includes('id="n-filer-changes-change"'));
  // R23 (2026-09-13): the †v note no longer states a classification R8 removed
  // as current behaviour. W-7 (M3 review, 2026-09-26) sharpens it: the marker
  // only ever sits beside an ADD or TRIM word that the producer derived from
  // value, so "reads as held" was false next to it. The property kept: the
  // FACT (share count unchanged), the value inference attributed to this
  // build's data, and what builds from R8 (2026-09-10) on do instead.
  assert.ok(
    withChanges.includes(
      "the reported share count is unchanged across the pair; this build's data classified the change from its reported value; builds from 2026-09-10 on read it as NO CHANGE",
    ),
  );
  assert.ok(!withChanges.includes("so the position reads as held"), "control: false beside the ADD/TRIM word the marker sits next to");
  assert.ok(
    !withChanges.includes("direction classified from reported value, not shares"),
    "the retired classification must not be stated as current behaviour",
  );
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

test("unified ticker: ledger totals count the full 12-month population, not a display slice; timeliness has an unknown state (R17: five figures, Filed late)", async () => {
  const { tickerUnifiedBody } = await import("../src/lib/ui/index.ts");
  const base = { kind: "txn", txnId: "x", name: "M", party: "R", state: "TX", district: null, chamber: "house", ticker: "T", asset: "T", assetType: null, side: "purchase", owner: null, low: 1001, high: 15000, traded: "2026-07-01", filed: "2026-07-20", lag: 19, late: 0, flags: [], doc: "d" } as any;
  const txns = Array.from({ length: 6 }, (_, i) => ({ ...base, txnId: `t${i}`, bioguide: `A00000${i}`, name: `Member ${i}` }));
  const stamps = { buildId: "b", generatedAt: "2026-08-02 07:27 UTC", generatedAtDate: "2026-08-02" };
  const html = tickerUnifiedBody({ ticker: "T", txns }, { state: "no-map" }, stamps, {}, { fullTable: false });
  // DESIGN-POLISH M2 (T2.8): the figure is read from the ONE ledger's <dl> (DOM parse).
  const figs = ledgerFigures(html);
  // signals-v3 M3 (R17): exactly five figures, in order
  assert.deepEqual(figs.map((f) => f.label), ["Congress txns", "Members · 12m", "Latest PTR", "Filed late", "13F holders"]);
  assert.equal(figs.find((f) => f.label === "Members · 12m")?.value, "6", "six members, not a display slice");
  assert.match(html, /6 buys · 0 sells/);
  /* LD9: the timeliness card's three states moved into the Filed late figure —
     its value, its tone, and its sub-line */
  const late = (h: string) => ledgerFigures(h).find((f) => f.label === "Filed late")!;
  assert.deepEqual([late(html).value, late(html).tone, late(html).sub], ["0", "ink", "every row filed inside 45 days"]);
  const unknown = tickerUnifiedBody({ ticker: "T", txns: [...txns, { ...base, txnId: "u", bioguide: "A000009", traded: null, lag: null, late: 0 }] }, { state: "no-map" }, stamps, {}, { fullTable: false });
  assert.equal(late(unknown).sub, "1 of 7 undated: timeliness unknown", "an undated row's timeliness is unknown, never on time");
  assert.doesNotMatch(unknown, /every row filed inside/i, "no claim that every row was on time");
  assert.match(unknown, /1 row discloses no trade date: the lag is unknown there, not zero/, "the figure's note says why");
  const lateRows = tickerUnifiedBody({ ticker: "T", txns: [...txns.slice(1), { ...base, txnId: "l", bioguide: "A000010", late: 1, lag: 60, traded: "2026-05-21" }] }, { state: "no-map" }, stamps, {}, { fullTable: false });
  assert.deepEqual([late(lateRows).value, late(lateRows).tone, late(lateRows).sub], ["1", "sell", "filed past the 45-day window"], "a late row: the SELL tone");
  const both = tickerUnifiedBody({ ticker: "T", txns: [...txns.slice(2), { ...base, txnId: "l", bioguide: "A000010", late: 1, lag: 60, traded: "2026-05-21" }, { ...base, txnId: "u", bioguide: "A000009", traded: null, lag: null, late: 0 }] }, { state: "no-map" }, stamps, {}, { fullTable: false });
  assert.deepEqual([late(both).value, late(both).tone, late(both).sub], ["1", "sell", "1 of 6 undated: timeliness unknown"], "late AND undated: the sub carries the undated count");
  const empty = tickerUnifiedBody({ ticker: "T", txns: [] }, { state: "no-map" }, stamps, {}, { fullTable: false });
  assert.deepEqual([late(empty).value, late(empty).sub], ["0", "no rows on record"]);
});

test("unified ticker: a ticker with no active hit gets no signals block and no zero-hit claim, so a withheld rule is never covered by one; registry names are escaped (Codex F2, F3; signals-v3 M3 R18)", async () => {
  /* The per-kind table that stated "zero hits … a computed answer over every
     rule" (and listed withheld kinds beside it) is retired; R18 replaces it
     with the On Signals block, which renders NOTHING for a ticker with no
     active hit. So no zero-hit claim exists to cover a withheld rule: the
     withholding is stated where the rules are (/signals/ and Methodology). */
  const { tickerUnifiedBody } = await import("../src/lib/ui/index.ts");
  const { buildTriage } = await import("../src/lib/signal-triage.ts");
  const stamps = { buildId: "b", generatedAt: "2026-08-02 07:27 UTC", generatedAtDate: "2026-08-02" };
  const ctx = {};
  const t = { ticker: "T", txns: [] } as any;
  const art = (withheld: unknown[]) => ({ v: 1, buildId: "b", computedAt: "c", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-05-04", coverageTo: "2026-08-02", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "l", withheld, signals: [] }) as never;
  for (const w of [[{ kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee data absent" }], []]) {
    const html = tickerUnifiedBody(t, { state: "no-map" }, stamps, ctx, { fullTable: false }, { triage: buildTriage(art(w), [], { committee: null }), crowding: null, committees: null });
    assert.doesNotMatch(html, /id="on-signals"/, "no block without an active hit");
    assert.doesNotMatch(html, /[Zz]ero hits|a computed answer over every rule/, "no zero-hit claim, withheld or not");
  }
  const hostile = tickerUnifiedBody(t, { state: "resolved-no-data", name: "Example <b>Issuer</b>", cik: "0000000001" }, stamps, ctx, { fullTable: false }, { crowding: null, committees: null });
  assert.doesNotMatch(hostile, /<b>Issuer<\/b>/);
  assert.match(hostile, /Example &lt;b&gt;Issuer&lt;\/b&gt;/);
});

/* ======================================================================
   signals-v3 M2 (T2.8, R14, R5): Methodology's signal sections
   ====================================================================== */

import { committeeDirectHtml, lagBandHtml, ruleBookHtml, signalsRankingHtml, signalsBody } from "../src/lib/ui/index.ts";
import * as TRIAGE from "../src/lib/signal-triage.ts";
import { COMMITTEE_DIRECT_VERSION, DIRECT_COMMITTEE_NAMES, DIRECT_SIC, directRangesText } from "../src/lib/committee-direct.ts";

const METHODOLOGY = path.resolve(import.meta.dirname, "..", "src", "pages", "methodology", "index.astro");

test("T2.8: Methodology renders #signal-rules, #signal-lag, #signals-ranking and #committee-direct, each through the one function that owns it", () => {
  const page = readFileSync(METHODOLOGY, "utf-8");
  for (const fn of ["ruleBookHtml(", "lagBandHtml(", "signalsRankingHtml(", "committeeDirectHtml("]) assert.ok(page.includes(fn), `methodology calls ${fn}`);
  assert.match(page, /<Fragment set:html=\{signalSections\} \/>/);
  assert.match(page, /<a href="#signals-method">/, "the TOC links the section");
  const art = {
    v: 1, buildId: "b", computedAt: "c", thresholdVersion: "1.0.0", retentionDays: 90, coverageFrom: "2026-05-04", coverageTo: "2026-08-02",
    lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "l", withheld: [{ kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee data absent" }], signals: [],
  } as never;
  const html = ruleBookHtml(art) + lagBandHtml({ latestBatch: [], latestBatchFiled: null }) + signalsRankingHtml() + committeeDirectHtml();
  for (const id of ["signal-rules", "signal-lag", "signals-ranking", "committee-direct"]) assert.match(html, new RegExp(`id="${id}"`), id);
  // the rule book moved whole: seven rows, the withheld kind by its reason, the BY DESIGN refusal
  const book = domOf(ruleBookHtml(art));
  assert.equal(book.querySelectorAll("#signal-rules tbody tr").length, 7);
  assert.ok(book.querySelector("table[data-multiline]"), "still the declared prose table");
  assert.match(visibleText(book), /BY DESIGN/);
  assert.ok(book.querySelector("td.si-status-withheld .note-btn.note-label"), "WITHHELD opens its reason");
  // /signals/ links to each of the four
  const sig = signalsBody(art, {});
  for (const id of ["signal-rules", "signal-lag", "signals-ranking", "committee-direct"]) assert.match(sig, new RegExp(`<a href="/methodology/#${id}">`), `/signals/ links #${id}`);
});

test("T2.8: #signals-ranking states every LD3/LD4/LD6 constant READ FROM signal-triage.ts — the prose cannot drift", () => {
  const text = visibleText(domOf(signalsRankingHtml())).replace(/\s+/g, " ");
  const money = (n: number): string => `$${n.toLocaleString("en-US")}`;
  const want = [
    `triage v${TRIAGE.TRIAGE_VERSION}`,
    `${TRIAGE.LATE_BATCH_MIN_CLUSTERS} or more co-occurrence clusters`,
    `${money(TRIAGE.SIZE_LARGE_LOW)} or more`,
    `at least ${money(TRIAGE.SIZE_LEVEL1_LOW)} and above ${Math.round(TRIAGE.SIZE_LEVEL1_SHARE * 100)}%`,
    `fewer than ${TRIAGE.SIZE_MIN_HISTORY} prior disclosures`,
    `${TRIAGE.PATTERN_GAP_DAYS[3]} days or more since the previous trade`,
    `Medium: ${TRIAGE.PATTERN_GAP_DAYS[2]} days or more`,
    `Low: ${TRIAGE.PATTERN_GAP_DAYS[1]} days or more`,
    `${TRIAGE.OTHERS_MEMBERS[3]} or more distinct members`,
    `medium: ${TRIAGE.OTHERS_MEMBERS[2]}`,
    `a sum of ${TRIAGE.LOOK_MIN_SUM} or more`,
    `at most ${TRIAGE.SENTENCE_MAX} characters`,
    `at least ${TRIAGE.RECORD_MIN_PRIOR} prior disclosures spanning ${TRIAGE.RECORD_MIN_SPAN_DAYS} days or more`,
    `lines of at least ${money(TRIAGE.RECORD_MIN_LOW)}`,
    TRIAGE.BRACKET_LOWER_BOUNDS.map(money).join(", "),
    `A row led by an exchange is ${TRIAGE.TIER_LABELS.routine}`,
    TRIAGE.TIER_LABELS.stands,
    TRIAGE.TIER_LABELS.look,
    "A signal is a fact about a filing, not a forecast: no returns are computed",
    `table v${COMMITTEE_DIRECT_VERSION}`,
  ];
  for (const w of want) assert.ok(text.includes(w), `#signals-ranking states: ${w}`);
});

test("T2.8 / R5: #committee-direct is the DIRECT_SIC table — every committee, name and range — with its version, source and the non-allegation caveat", () => {
  const root = domOf(committeeDirectHtml());
  const rows = root.querySelectorAll("#committee-direct tbody tr").map((tr) => tr.children.map((td) => visibleText(td).trim()));
  assert.deepEqual(rows, Object.entries(DIRECT_SIC).map(([id, ranges]) => [id, DIRECT_COMMITTEE_NAMES[id]!, directRangesText(ranges)]));
  const text = visibleText(root);
  assert.match(text, new RegExp(`Committee direct matches \\(table v${COMMITTEE_DIRECT_VERSION}\\)`));
  assert.match(text, /House Rule X and Senate Rule XXV/);
  assert.match(text, /The overlap is context, never an allegation/);
  assert.match(text, /a direct grade only refines an existing hit/);
});

/* signals-v4 M2 (R27, LD10; T2.7): Methodology #signals-congress-column —
   the join, the quarter and the broad-account rule, every constant read from
   congress-quarter.ts, and linked from the Institutional tab */
import { signalsCongressColumnHtml } from "../src/lib/ui/index.ts";
import * as CQ from "../src/lib/congress-quarter.ts";
import { signalsInstitutionalHtml } from "../src/lib/ui/index.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";

test("T2.7 (R27): Methodology renders #signals-congress-column through its one function; the text states the quarter rule, BROAD_ACCOUNT_NAMES and CONGRESS_DETAIL_LINES, read from code", () => {
  const page = readFileSync(METHODOLOGY, "utf-8");
  assert.ok(page.includes("signalsCongressColumnHtml()"), "methodology calls it");
  const root = domOf(signalsCongressColumnHtml());
  assert.ok(root.querySelector("section#signals-congress-column"));
  const text = visibleText(root).replace(/\s+/g, " ");
  for (const w of [
    `calendar quarter end (${CQ.QUARTER_ENDS_TEXT})`,
    "the first day of its first month through the quarter end",
    "Filed dates are not bounded",
    "the House Clerk's ST or the Senate's Stock",
    "a partial sale counts as a sale",
    "BRK.B meets BRK-B, while GOOG and GOOGL stay distinct",
    `more than ${CQ.BROAD_ACCOUNT_NAMES} distinct tickers in the quarter`,
    `at most ${CQ.CONGRESS_DETAIL_LINES} lines per side`,
    "never coordination, never intent",
  ]) assert.ok(text.includes(w), `#signals-congress-column states: ${w}`);
  // the Institutional tab links it
  assert.match(signalsInstitutionalHtml(fixtureInstitutional(), {}), /<a href="\/methodology\/#signals-congress-column">/);
});

/* ======================================================================
   signals-v3 M3 (R17–R21, LD8, LD9): the ticker page
   ====================================================================== */

import { tickerOnSignalsHtml } from "../src/lib/ui/index.ts";
import { onSignalsLines, COMMITTEE_CAVEAT } from "../src/lib/ui/signals.ts";
import { TICKER_HOLDERS_VISIBLE, TICKER_PREVIEW_ROWS, TIMELINE_GRIDLINES } from "../src/lib/ui/ticker.ts";
import { amountText, sideLabel, universalFlags, effectiveFlagKeys } from "../src/lib/format.ts";
import { affTextOf, excludeDateAnomalies, legacyTrailingMonthsBounds, windowMembership } from "../src/lib/derive.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import type { MiniElement } from "./lib/mini-dom.ts";

const M3_STAMPS = { buildId: "b", generatedAt: "2026-10-13 06:00 UTC", generatedAtDate: "2026-10-13" };
let goldenM3: TRIAGE.TriageResult | null = null;
/** The golden public-row fixture's triage (signals-v3 M2), built once. */
function golden(): TRIAGE.TriageResult {
  const f = loadTriageFixture();
  return (goldenM3 ??= TRIAGE.buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf }));
}
/** A ticker's rows from the fixture, newest filed first (the build's order). */
function goldenTicker(ticker: string, rows: readonly TxnRow[] = loadTriageFixture().rows): TickerEntity {
  return { ticker, txns: rows.filter((r) => r.ticker === ticker).sort((a, b) => (a.filed !== b.filed ? (a.filed < b.filed ? 1 : -1) : a.txnId < b.txnId ? -1 : 1)) };
}
function goldenPage(ticker: string, triage: TRIAGE.TriageResult | null = golden(), entity = goldenTicker(ticker)): string {
  return tickerUnifiedBody(entity, { state: "no-map" }, M3_STAMPS, CTX, { fullTable: false }, triage ? { triage, crowding: null, committees: null } : null);
}
/** The strongest Stands-out / Worth-a-look row a ticker leads. */
function strongRow(ticker: string): TRIAGE.TriageRow {
  const row = golden().byTicker.get(ticker)?.find((r) => r.tier !== "routine");
  assert.ok(row, `${ticker} leads a Stands-out or Worth-a-look row in the golden fixture`);
  return row!;
}
const lagOfLine = (r: TxnRow): number | null => r.lag ?? (r.traded ? TRIAGE.daysBetween(r.traded, r.filed) : null);

/** Every R18 field of the FULL block, checked against the row it shows. One
    line's own facts: the lead line's filed date, trade date, lag and receipt. */
function fullBlockProblems(html: string, row: TRIAGE.TriageRow): string[] {
  const out: string[] = [];
  const block = domOf(html).querySelector("#on-signals");
  if (!block) return ["no #on-signals"];
  const L = row.lead.txn;
  const text = (sel: string): string | null => {
    const el = block.querySelector(sel);
    return el ? visibleText(el).replace(/\s+/g, " ").trim() : null;
  };
  if (block.getAttribute("data-block") !== "full") out.push("not the full block");
  if (text(".tk-onsig-tier") !== TRIAGE.TIER_LABELS[row.tier]) out.push(`tier label ${text(".tk-onsig-tier")}`);
  // the heading names the lead line's member ("· 2 filings" follows on a grouped row)
  if (row.grouping !== "cluster" && !(text(".si-row-member") ?? "").startsWith(L.name)) out.push(`member ${text(".si-row-member")}`);
  /* signals-v4 LD4: the row is a <details>, opened here; line 1 holds the
     filer with party and state, line 2 the side chip */
  if (text(".si-row-sum .si-row-who .aff") !== affTextOf(L)) out.push(`party and state ${text(".si-row-sum .si-row-who .aff")}`);
  if (text(".si-row-sum .si-chip") !== sideLabel(L.side, L.flags).text) out.push(`side chip ${text(".si-row-sum .si-chip")}`);
  if (!block.querySelector(".si-row-sum .owner-note")) out.push("the owner");
  if (text(".si-row-amt") !== amountText(L)) out.push(`amount range ${text(".si-row-amt")}`);
  const filed = block.querySelector(".si-row-filed time");
  if (filed?.getAttribute("datetime") !== L.filed) out.push(`filed date ${filed?.getAttribute("datetime")} is not the lead line's ${L.filed}`);
  const traded = block.querySelector(".si-row-traded time");
  if (traded?.getAttribute("datetime") !== L.traded) out.push(`trade date ${traded?.getAttribute("datetime")} is not the lead line's ${L.traded}`);
  const lag = lagOfLine(L);
  if (!(text(".si-row-traded") ?? "").includes(`${lag}d`)) out.push(`lag: "${text(".si-row-traded")}" lacks the lead line's ${lag}d`);
  if (text(".si-row-why") !== row.sentence) out.push("reason sentence");
  const meters = block.querySelectorAll('.si-row-sum [role="img"]').map((m) => m.getAttribute("aria-label") ?? "");
  const want = TRIAGE.METER_KEYS.map((k) => `${TRIAGE.METER_LABELS[k]}: ${TRIAGE.LEVEL_WORDS[row.meters[k]]}`);
  if (meters.length !== 4 || !meters.every((m) => /^(Size|Pattern|Others|Cmte): /.test(m)) || meters.join("|") !== want.join("|")) out.push(`meters ${meters.join(", ")}`);
  const receipt = block.querySelector(".si-row-src a");
  if (receipt?.getAttribute("href") !== L.doc) out.push(`receipt ${receipt?.getAttribute("href")} is not the lead filing ${L.doc}`);
  const back = block.querySelector("a.tk-onsig-back");
  if (back?.getAttribute("href") !== "/signals/" || visibleText(back).trim() !== "← Back to Signals") out.push("back to Signals");
  /* the block's own caveat paragraph (the opened row's Cmte line says
     "context, never an allegation" on every row) */
  const caveat = block.querySelector("p.si-cmte-context");
  if (row.meters.cmte >= 1 && (caveat ? visibleText(caveat).trim() : "") !== COMMITTEE_CAVEAT) out.push("the committee caveat is missing");
  if (row.meters.cmte < 1 && caveat) out.push("a committee caveat with no committee context");
  return out;
}

test("T3.2 (R17): the title keeps today's name source — ticker — mapped name exactly as supplied with its † link and footnote; no mapped name, the ticker alone", () => {
  const name = "Williams Cos Inc. (Mixed Case)";
  const mapped = domOf(unified({ state: "resolved-no-data", name, cik: "0000107263" }));
  const h1 = mapped.querySelector("h1.entity-title")!;
  const own = (el: MiniElement): string => el.nodes.map((n) => (typeof n === "string" ? n : n.classList.contains("fn-ref") ? "" : own(n))).join("");
  assert.equal(own(h1), `${TICKER.ticker} — ${name}`, "ticker + ' — ' + the mapped name, never re-cased");
  const dagger = h1.querySelector('a.fn-ref[href="#ticker-footnotes"]');
  assert.equal(dagger && visibleText(dagger), "†");
  const foot = mapped.querySelector("#ticker-footnotes")!;
  assert.match(visibleText(foot), /present-day mapping, not the name as of each filing/);
  for (const inst of [{ state: "no-map" }, { state: "ambiguous" }, { state: "module-absent" }] as TickerInstSection[]) {
    const html = unified(inst);
    const plain = domOf(html).querySelector("h1.entity-title")!;
    assert.equal(visibleText(plain), TICKER.ticker, `${inst.state}: the ticker alone`);
    assert.ok(!visibleText(plain).includes("—") && !plain.querySelector(".fn-ref"), `${inst.state}: no dash, no † link`);
    assert.ok(!html.includes("†") && !html.includes("present-day mapping"), `${inst.state}: no † footnote`);
  }
});

test("T3.3 (R18): a Stands-out ticker renders the FULL block once, before the tabs — every field pinned, the caveat with Cmte ≥ 1", () => {
  const row = strongRow("BAC");
  assert.equal(row.tier, "stands");
  assert.ok(row.meters.cmte >= 1, "the fixture row carries committee context (BAC ↔ House Financial Services, direct)");
  const html = goldenPage("BAC");
  assert.equal((html.match(/id="on-signals"/g) ?? []).length, 1, "exactly one block");
  assert.ok(html.indexOf('id="on-signals"') < html.indexOf('role="tablist"'), "before the tabs");
  assert.deepEqual(fullBlockProblems(html, row), []);
  // the same function the triage row uses: rendered OPEN, with no link to the page it is on (signals-v4 LD4)
  const block = domOf(html).querySelector("#on-signals")!;
  assert.ok(block.querySelector("details.si-row-d")!.hasAttribute("open"), "the block's row is open");
  assert.ok(!block.querySelectorAll(".si-row-links a").some((a) => (a.getAttribute("href") ?? "").startsWith("/tickers/")), "no link to the ticker page it is on");
  assert.ok(block.querySelectorAll(".si-row-links a").some((a) => a.getAttribute("href") === row.lead.doc), "the opened row links the receipt");
  assert.equal(block.querySelector(".si-row-head .note-btn"), null, "the column head carries no tip here: the opened row states every meter in words");
  // Removal tests: each R18 field the honesty rules protect fails the reading when deleted
  const cut = (re: RegExp, why: string): string[] => {
    const mutated = html.replace(re, "");
    assert.notEqual(mutated, html, `control: ${why} was found to remove`);
    return fullBlockProblems(mutated, row);
  };
  assert.ok(cut(/<p class="section-note si-cmte-context">[^<]*<\/p>/, "the caveat").some((p) => /committee caveat is missing/.test(p)), "removing the caveat fails");
  assert.ok(cut(/<span class="si-row-filed">.*?<\/span>/, "the filed date").some((p) => /filed date/.test(p)), "removing the filed date fails");
  assert.ok(cut(/<time datetime="[^"]+">[^<]+<\/time>(?= · <span class="si-lag|<\/span><span class="si-row-src)/, "the trade date").some((p) => /trade date/.test(p)), "removing the trade date fails");
  assert.ok(cut(/<span class="si-row-src">.*?<\/span>(?=<\/article>)/, "the receipt").some((p) => /receipt/.test(p)), "removing the receipt fails");
  assert.ok(cut(/<span class="owner-note">[^<]*<\/span>/, "the owner").some((p) => /owner/.test(p)), "removing the owner fails");
});

test("T3.3 (R18, D21): the full block's dates and lag are ONE line's — the lead line's own — never a group's latest filed date", () => {
  const row = strongRow("CB");
  assert.equal(row.grouping, "member-ticker");
  assert.notEqual(row.filed, row.lead.txn.filed, "precondition: the group's latest filing is not the lead line's");
  const html = goldenPage("CB");
  assert.deepEqual(fullBlockProblems(html, row), []);
  const block = domOf(html).querySelector("#on-signals")!;
  assert.equal(block.querySelector(".si-row-filed time")!.getAttribute("datetime"), row.lead.txn.filed, "the lead line's filed date");
  // the group's latest filing is named apart, labelled as such
  assert.match(visibleText(block.querySelector(".si-row-src")!), new RegExp(`latest of ${row.filings.length} filings: ${row.filed}`));
  assert.equal(row.tier, "look");
  assert.equal(visibleText(block.querySelector(".tk-onsig-tier")!), "Worth a look");
});

test("T3.3 (R18): a full block with no committee context carries no committee caveat", () => {
  const row = strongRow("MLM");
  assert.ok(row.meters.cmte < 1, `precondition: Cmte ${row.meters.cmte}`);
  const html = goldenPage("MLM");
  assert.deepEqual(fullBlockProblems(html, row), []);
  assert.ok(!html.includes(COMMITTEE_CAVEAT), "no caveat without committee context");
});

/** Every R18 field of the COMPACT block, per hit row. */
function compactBlockProblems(html: string, hits: readonly import("../src/lib/signals.ts").Signal[]): string[] {
  const out: string[] = [];
  const block = domOf(html).querySelector("#on-signals");
  if (!block) return ["no #on-signals"];
  if (block.getAttribute("data-block") !== "compact") out.push("not the compact block");
  const rows = block.querySelectorAll("tbody tr");
  if (rows.length === 0 || rows.length > 5) out.push(`${rows.length} hit rows (1 to 5)`);
  const byId = new Map(hits.map((h) => [h.id, h]));
  let committee = false;
  for (const tr of rows) {
    const s = byId.get(tr.getAttribute("data-signal-id") ?? "");
    if (!s) { out.push("a row names no hit of this ticker"); continue; }
    if (s.kind === "s5-jurisdiction") committee = true;
    const kind = tr.querySelector("td.si-kind");
    if (!kind?.querySelector(".note-label") || visibleText(kind.querySelector(".note-pop")!).trim() === "" || !(kind.querySelector(".note-pop")!.textContent ?? "").includes(s.rule)) out.push(`${s.id}: the kind and its rule note`);
    if (visibleText(tr.querySelector("td.si-subject")!).trim() === "") out.push(`${s.id}: the member`);
    const times = tr.querySelectorAll("td.si-when time").map((t) => t.getAttribute("datetime"));
    if (s.occurrence.tradeDate && times[0] !== s.occurrence.tradeDate) out.push(`${s.id}: the trade date`);
    if (times[times.length - 1] !== s.occurrence.filedDate || times.length !== (s.occurrence.tradeDate ? 2 : 1)) out.push(`${s.id}: the filed date`);
    if (visibleText(tr.querySelector("td.si-mag")!).trim() === "") out.push(`${s.id}: the size`);
    if (tr.querySelector("td.c-src a")?.getAttribute("href") !== s.receipts[0]) out.push(`${s.id}: the receipt`);
  }
  const caveat = block.querySelector(".si-cmte-context");
  if (committee && !(caveat && visibleText(caveat).includes(COMMITTEE_CAVEAT))) out.push("the committee caveat is missing beside a COMMITTEE hit");
  if (!committee && caveat) out.push("a committee caveat with no COMMITTEE hit");
  return out;
}

test("T3.3 (R18): a ticker with hits and no Stands-out or Worth-a-look row renders the COMPACT block — at most 5 hits, each with its kind and rule, member, both dates, size and receipt; the caveat beside a COMMITTEE hit", () => {
  const t = golden();
  assert.ok(!(t.byTicker.get("AAPL") ?? []).some((r) => r.tier !== "routine"), "precondition: AAPL leads no Stands-out or Worth-a-look row");
  const hits = t.hitsByTicker.get("AAPL")!;
  assert.ok(hits.length > 5 && hits.some((h) => h.kind === "s5-jurisdiction"), "precondition: more than five hits, a COMMITTEE hit among them");
  const html = goldenPage("AAPL");
  assert.equal((html.match(/id="on-signals"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="on-signals"') < html.indexOf('role="tablist"'), "before the tabs");
  assert.deepEqual(compactBlockProblems(html, hits), []);
  const block = domOf(html).querySelector("#on-signals")!;
  assert.equal(block.querySelectorAll("tbody tr").length, 5, "capped at five");
  assert.match(visibleText(block), /1–5 of \d+ lines · \d+ hits/, "the cap is stated");
  assert.equal(block.querySelector("a.tk-onsig-back")?.getAttribute("href"), "/signals/");
  // Removal tests
  const cut = (re: RegExp, why: string): string[] => {
    const mutated = html.replace(re, "");
    assert.notEqual(mutated, html, `control: ${why} was found to remove`);
    return compactBlockProblems(mutated, hits);
  };
  assert.ok(cut(/<p class="section-note si-cmte-context">[^<]*<\/p>/, "the caveat").some((p) => /caveat is missing/.test(p)), "removing the caveat fails");
  assert.ok(cut(/<span class="visually-hidden">Traded <\/span><time[^>]*>[^<]*<\/time> → /, "a trade date").some((p) => /trade date|filed date/.test(p)), "removing a trade date fails");
  assert.ok(cut(/ → <span class="visually-hidden">Filed <\/span><time[^>]*>[^<]*<\/time>/, "a filed date").some((p) => /filed date/.test(p)), "removing a filed date fails");
  assert.ok(cut(/<div class="cell cell-src">.*?<\/div>/, "a receipt").some((p) => /receipt/.test(p)), "removing a receipt fails");
  // a ticker that leads only a Routine row: still the compact block, never a full block for a Routine row
  const be = t.byTicker.get("BE") ?? [];
  assert.ok(be.length > 0 && be.every((r) => r.tier === "routine"), "precondition: BE leads Routine rows only");
  assert.deepEqual(compactBlockProblems(goldenPage("BE"), t.hitsByTicker.get("BE")!), []);
  // a ticker whose hits hold no COMMITTEE hit: the compact block, and no caveat
  const snow = t.hitsByTicker.get("SNOW")!;
  assert.ok(snow.every((h) => h.kind !== "s5-jurisdiction") && !(t.byTicker.get("SNOW") ?? []).some((r) => r.tier !== "routine"));
  assert.deepEqual(compactBlockProblems(goldenPage("SNOW"), snow), []);
  assert.ok(!goldenPage("SNOW").includes(COMMITTEE_CAVEAT));
});

test("T3.3 (R18): no active hit, no block; /e/ (no deps) never renders one, and the parity capture holds none", () => {
  const t = golden();
  assert.ok(!t.hitsByTicker.has("TJX"));
  assert.ok(!goldenPage("TJX").includes('id="on-signals"'), "a ticker with no active hit");
  assert.equal(tickerOnSignalsHtml([], [], CTX), "", "the renderer says nothing with nothing to say");
  assert.ok(!goldenPage("BAC", null).includes('id="on-signals"'), "deps null (/e/): no block for a Stands-out ticker");
  assert.ok(!goldenPage("BAC", null).includes('class="on-signals"'), "and no pinned row");
  const capture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures", "ui-split-parity.json"), "utf-8")) as Record<string, string>;
  for (const key of ["tickerUnifiedBody.module-absent", "tickerUnifiedBody.data"]) {
    assert.ok(capture[key]!.includes('role="tablist"'), `${key} is the re-captured tabbed body`);
    assert.ok(!capture[key]!.includes('id="on-signals"'), `${key} carries no block`);
  }
});

/** The preview table's rows. */
function previewRows(html: string): MiniElement[] {
  const panel = domOf(html).querySelector('[aria-label="Congressional disclosures"]')!;
  return panel.querySelectorAll("tbody tr");
}

test("T3.4 (R19, R20): the block's triggering lines on THIS ticker are pinned first, deduplicated, at most 5, each with data-txn and the On Signals marker; then the newest rows, 10 in all, and 'all N rows ↗'", () => {
  const t = golden();
  for (const ticker of ["AAPL", "BAC", "CB", "SPCX", "SNOW"]) {
    const entity = goldenTicker(ticker);
    const rows = previewRows(goldenPage(ticker));
    const ids = rows.map((r) => r.getAttribute("data-txn"));
    assert.ok(ids.every((id) => id !== null && entity.txns.some((x) => x.txnId === id)), `${ticker}: every preview row carries data-txn`);
    assert.equal(new Set(ids).size, ids.length, `${ticker}: no row twice`);
    assert.equal(rows.length, Math.min(TICKER_PREVIEW_ROWS, entity.txns.length), `${ticker}: ten rows in total`);
    const pinned = rows.filter((r) => r.classList.contains("on-signals"));
    assert.ok(pinned.length >= 1 && pinned.length <= 5, `${ticker}: 1 to 5 pinned (${pinned.length})`);
    assert.deepEqual(rows.slice(0, pinned.length), pinned, `${ticker}: pinned rows come first`);
    assert.ok(pinned.every((r) => visibleText(r.querySelector("td.c-member .on-signals-mark")!) === "On Signals"), `${ticker}: each says On Signals`);
    assert.ok(rows.slice(pinned.length).every((r) => !r.querySelector(".on-signals-mark")), `${ticker}: the marker lands only on a pinned row`);
    // the pinned rows are the block's own lines, as onSignalsLines picks them
    const want = onSignalsLines(t.byTicker.get(ticker) ?? [], t.hitsByTicker.get(ticker) ?? [], t.hitLines, entity.txns).map((r) => r.txnId);
    assert.deepEqual(pinned.map((r) => r.getAttribute("data-txn")), want, `${ticker}: the triggering lines`);
    // after them, the newest rows not already shown, in filed order
    const rest = entity.txns.filter((r) => !want.includes(r.txnId)).slice(0, TICKER_PREVIEW_ROWS - want.length).map((r) => r.txnId);
    assert.deepEqual(rows.slice(pinned.length).map((r) => r.getAttribute("data-txn")), rest, `${ticker}: then the newest`);
    // each pinned row keeps its dates, owner column and receipt
    for (const r of pinned) {
      assert.ok(r.querySelector("td.c-filed") && r.querySelector("td.c-traded") && r.querySelector("td.c-src a"), `${ticker}: a pinned row keeps both dates and its receipt`);
    }
    assert.match(goldenPage(ticker), new RegExp(`<a href="/congress/tickers/${ticker}/">all ${entity.txns.length.toLocaleString("en-US")} rows ↗</a>`), `${ticker}: the full Congress view`);
  }
  // the full block's lines: lead first, LD4 line order, only this ticker's (BAC's row holds three lines, one on BAC)
  const bac = strongRow("BAC");
  assert.ok(bac.lines.some((l) => l.txn.ticker !== "BAC"), "precondition: the row holds lines on other tickers");
  assert.deepEqual(previewRows(goldenPage("BAC")).filter((r) => r.classList.contains("on-signals")).map((r) => r.getAttribute("data-txn")), [bac.lead.txn.txnId], "only the BAC line, the lead");
  // the compact block's lines: the shown hits' own lines (`hitLines`), never a guess
  const aapl = t.hitsByTicker.get("AAPL")!;
  const aaplPinned = previewRows(goldenPage("AAPL")).filter((r) => r.classList.contains("on-signals")).map((r) => r.getAttribute("data-txn")!);
  assert.equal(aaplPinned.length, 5, "five of AAPL's hit lines");
  const shownIds = new Set(domOf(goldenPage("AAPL")).querySelectorAll("#on-signals tbody tr").map((r) => r.getAttribute("data-signal-id")));
  const lines = new Set([...shownIds].flatMap((id) => t.hitLines.get(id!) ?? []));
  assert.ok(aaplPinned.every((id) => lines.has(id)) && aapl.length > 0, "every pinned AAPL row is a line of a hit the block shows");
  // no block, no pinned row: the preview is the newest ten, Filed sorted ↓
  const plain = previewRows(goldenPage("TJX"));
  assert.ok(plain.every((r) => !r.classList.contains("on-signals")));
  assert.match(goldenPage("TJX"), /aria-sort="descending"/, "unpinned, the Filed column claims its sort");
  assert.match(goldenPage("BAC"), /ON SIGNALS ROWS FIRST, THEN FILED ↓/, "pinned, the panel states the order");
});

test("T3.4 (R19): universalFlags covers the pinned rows — a flag the newest rows share but a pinned row lacks is never hoisted", () => {
  const t = golden();
  const entity = goldenTicker("AAPL");
  const pinned = new Set(onSignalsLines(t.byTicker.get("AAPL") ?? [], t.hitsByTicker.get("AAPL")!, t.hitLines, entity.txns).map((r) => r.txnId));
  assert.ok(pinned.size > 0);
  const flagged = (all: boolean): TickerEntity => ({ ticker: "AAPL", txns: entity.txns.map((r) => (all || !pinned.has(r.txnId) ? { ...r, flags: [...r.flags, "x_test_flag"] } : r)) });
  const stated = (html: string): string[] => (domOf(html).querySelector('[aria-label="Congressional disclosures"] table')!.getAttribute("data-stated-flags") ?? "").split(",").filter(Boolean);
  assert.ok(!stated(goldenPage("AAPL", golden(), flagged(false))).includes("x_test_flag"), "a pinned row without it: not universal");
  assert.ok(stated(goldenPage("AAPL", golden(), flagged(true))).includes("x_test_flag"), "every shown row, pinned ones included: hoisted once");
  // control: the hoist over the NON-pinned rows alone would have claimed it
  const nonPinned = flagged(false).txns.filter((r) => !pinned.has(r.txnId)).slice(0, TICKER_PREVIEW_ROWS - pinned.size);
  assert.ok(universalFlags(nonPinned.map(effectiveFlagKeys)).includes("x_test_flag"), "control: the wrong population would hoist it");
});

test("T3.4 (R19, R20): the timeline draws the $15K, $250K and $5M gridlines and rings exactly the pinned rows inside its 24-month window", () => {
  for (const ticker of ["AAPL", "BAC", "CB"]) {
    const html = goldenPage(ticker);
    const plot = domOf(html).querySelector(".tl-plot")!;
    assert.deepEqual(plot.querySelectorAll(".tl-grid-label").map((l) => visibleText(l)), ["$15K", "$250K", "$5M"]);
    assert.deepEqual(TIMELINE_GRIDLINES.map(([, l]) => l), ["$15K", "$250K", "$5M"]);
    const pinned = previewRows(html).filter((r) => r.classList.contains("on-signals")).map((r) => r.getAttribute("data-txn"));
    const bounds = legacyTrailingMonthsBounds(M3_STAMPS.generatedAtDate, 24);
    const placed = excludeDateAnomalies(goldenTicker(ticker).txns).rows.filter((r) => r.traded && windowMembership(r, bounds, "traded") === "in");
    const want = placed.filter((r) => pinned.includes(r.txnId)).length;
    assert.equal(plot.querySelectorAll(".tl-ring").length, want, `${ticker}: ${want} ringed`);
    assert.ok(want > 0, `${ticker}: the fixture places a pinned row in the window`);
  }
  // control: with no triage nothing is pinned, so nothing is ringed
  assert.equal(domOf(goldenPage("AAPL", null)).querySelectorAll(".tl-ring").length, 0);
});

test("T3.5 (R21): holders 1–10 show; 11..N sit in 'Show all N holders'; the hoist and the terminus are computed over all N; the full holders link only with holdersPage", () => {
  const holder = (i: number, flags: string[] = []) => ({ rank: i, cik: String(i).padStart(10, "0"), name: `HOLDER ${i}`, value: 100_000 - i, securities: 1, keySource: "entity", flags });
  const data = (n: number, over: Partial<TickerInstSection> = {}, flags: (i: number) => string[] = () => []): string =>
    unified({ state: "data", name: "Fixture Corp", cik: "0000320193", period: "2026-03-31", latestFiled: "2026-05-15", topn: 25, holders: Array.from({ length: n }, (_, i) => holder(i + 1, flags(i + 1))), ...over } as TickerInstSection);
  const html = data(25);
  const sec = domOf(html).querySelector("#ticker-holders")!;
  const tables = sec.querySelectorAll("table");
  assert.equal(tables.length, 2);
  const ranks = (el: MiniElement): string[] => el.querySelectorAll("tbody tr").map((tr) => visibleText(tr.querySelectorAll("td")[0]!).trim());
  assert.deepEqual(ranks(tables[0]!), Array.from({ length: TICKER_HOLDERS_VISIBLE }, (_, i) => String(i + 1)), "holders 1–10 visible");
  const more = sec.querySelector("details.tk-holders-more")!;
  assert.ok(more && !more.hasAttribute("open"), "closed by default");
  assert.equal(visibleText(more.querySelector("summary")!), "Show all 25 holders");
  assert.deepEqual(ranks(more), Array.from({ length: 15 }, (_, i) => String(i + 11)), "holders 11..N inside, none lost");
  assert.ok(tables.every((t) => t.getAttribute("data-paged") === "1"), "each part says it shows part of the collection");
  assert.match(visibleText(sec), /ranks the top 25 holders per issuer/, "the terminus");
  // ten or fewer: one table, no disclosure, nothing marked partial
  const ten = domOf(data(10)).querySelector("#ticker-holders")!;
  assert.equal(ten.querySelectorAll("table").length, 1);
  assert.ok(!ten.querySelector("details.tk-holders-more") && !ten.querySelector("table[data-paged]"));
  // the terminus counts ALL N on the mapped path
  const mapped = data(25, { mapped: { issuer: "FIXTURE CORP", titleOfClass: "COM", holderCount: 700 } } as never);
  assert.match(mapped, /The 25 largest of the 700 13F filers reporting this share class for the quarter are listed/);
  // the hoist reads ALL N: a flag on every holder is stated once; one on the first ten only stays on their rows
  const flag = "security_not_in_mapping";
  const every = data(25, {}, () => [flag]);
  assert.equal((every.match(/class="caveat-line table-caveat"/g) ?? []).length, 1, "every holder carries it: stated once");
  assert.ok(domOf(every).querySelectorAll("#ticker-holders td.c-flags").every((td) => visibleText(td).trim() === ""), "and on no row");
  const topOnly = data(25, {}, (i) => (i <= TICKER_HOLDERS_VISIBLE ? [flag] : []));
  assert.ok(!topOnly.includes("table-caveat"), "the first ten carry it, holders 11..25 do not: never hoisted from the visible ten");
  const cells = domOf(topOnly).querySelectorAll("#ticker-holders td.c-flags").map((td) => visibleText(td).trim() !== "");
  assert.deepEqual(cells, Array.from({ length: 25 }, (_, i) => i < TICKER_HOLDERS_VISIBLE), "it stays on the ten rows that carry it");
  // the full holders view: only when that page is built
  assert.ok(data(25, { holdersPage: true }).includes("full holders view ↗"));
  assert.ok(!data(25, { holdersPage: false }).includes("/holders/"));
});
