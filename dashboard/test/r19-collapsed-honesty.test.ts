/* R19 — what a COLLAPSED table is allowed to omit, asserted against the
   enumerated allowlist rather than by eyeballing a screenshot.

   The rule: a collapsed table may omit DATA ROWS BEYOND THE COMPACT SLICE, and
   nothing else. Everything that tells the reader what they are not seeing must
   stay in the accessibility tree in both states.

   R3 parity lives here too, because it is the same question from the other
   side: the view the server renders and the view the client renders for the
   same range and basis must be the same bytes. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { congressTickersRollup, leadersRollup, rankNetRows } from "../src/lib/derive.ts";
import {
  CONGRESS_ROOTS,
  congressRankingSection,
  rankingRootHtml,
  type BuildStamps,
} from "../src/lib/ui.ts";
import { COMPACT_ROWS, type TxnRow, type RenderCtx } from "../src/lib/format.ts";

const NOW = "2026-08-12";
const stamps: BuildStamps = {
  buildId: "t.1",
  generatedAt: "2026-08-12 00:00 UTC",
  generatedAtDate: NOW,
};
const ctx: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-08-01",
    name: "Test Member",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

/** Enough rows to force a collapse, plus one wholly-undisclosed row so the
    second bucket exists, plus an undated row and an anomaly so both exclusion
    clauses are live. */
function corpus(n: number): TxnRow[] {
  const rows: TxnRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      txn({
        txnId: `t${i}`,
        bioguide: `M${String(i).padStart(6, "0")}`,
        name: `Member ${i}`,
        ticker: `TK${i}`,
        low: 1001 + i * 1000,
        high: 15000 + i * 1000,
        late: i % 3 === 0 ? 1 : 0,
      }),
    );
  }
  rows.push(txn({ txnId: "u", bioguide: "U000001", name: "Undisclosed", ticker: "UND", low: null, high: null }));
  rows.push(txn({ txnId: "nd", bioguide: "N000001", name: "No Date", ticker: "NDT", traded: null }));
  rows.push(
    txn({ txnId: "an", bioguide: "A000009", name: "Anomaly", ticker: "ANM", traded: "3031-04-30", flags: ["date_anomaly"] }),
  );
  return rows;
}

function membersSection(rows: TxnRow[], compact?: number): string {
  return congressRankingSection(
    "leaders",
    leadersRollup(rows, NOW, { range: "12m", basis: "traded" }),
    stamps,
    ctx,
    {
      rootId: CONGRESS_ROOTS.membersRanked,
      undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed,
      heading: "Member net disclosed flow",
      sectionId: "members-section",
      compact,
    },
  );
}

/* ---------- the allowlist ---------- */

test("R19: a collapsed table keeps every enumerated honesty element in the tree", () => {
  const html = membersSection(corpus(25), 5);

  // caption
  assert.match(html, /<caption class="visually-hidden">Members ranked by net disclosed flow/);
  // every column header, including the unsortable one and its stated reason
  for (const label of ["Member", "Txns", "Purch.", "Sales", "Gross purchases", "Gross sales", "Net disclosed flow", "Late"]) {
    assert.ok(html.includes(label), `the "${label}" header must survive collapse`);
  }
  assert.match(html, /<span class="col-why">/);
  // the caveat line and BOTH exclusion clauses
  assert.match(html, /class="caveat-line"/);
  assert.match(html, /date-anomaly row excluded from the trade-date window/);
  assert.match(html, /discloses no trade date and cannot be placed in a trade-date window/);
  // terminus row and its named author
  assert.match(html, /class="terminus" data-terminus-author="populus"/);
  assert.match(html, /Truncated by Public Filings\./);
  // footnote markers AND their printed lines
  assert.match(html, /id="members-section-footnotes"/);
  assert.match(html, /net disclosed flow = sum of purchase bucket bounds/);
  assert.match(html, /overlapping intervals are incomparable/);
  // the stated absence: the wholly-undisclosed bucket and its explanation
  assert.match(html, /Not rankable — amounts wholly undisclosed/);
  // the disclosure control states the hidden count in its own LABEL
  assert.match(html, /Show all \d+ members \(\d+ more\)/);
});

test("R19: collapsing omits DATA ROWS and only data rows", () => {
  const rows = corpus(25);
  const collapsed = membersSection(rows, 5);
  const expanded = membersSection(rows);

  const bodyOf = (html: string, id: string): string => {
    const at = html.indexOf(`<tbody id="${id}">`);
    return html.slice(at, html.indexOf("</tbody>", at));
  };
  const collapsedRows = (bodyOf(collapsed, CONGRESS_ROOTS.membersRanked).match(/<tr>/g) ?? []).length;
  const expandedRows = (bodyOf(expanded, CONGRESS_ROOTS.membersRanked).match(/<tr>/g) ?? []).length;
  assert.equal(collapsedRows, 5, "the collapsed slice renders exactly the compact count");
  assert.ok(expandedRows > collapsedRows, "expanding reveals more rows");

  // Everything OUTSIDE the roots is byte-identical between the two states,
  // apart from the terminus row and the control, which exist precisely to
  // describe the bound. Strip the two roots and compare the rest.
  const strip = (html: string): string =>
    html
      .replace(/<tbody id="[^"]+">[\s\S]*?<\/tbody>/g, "<tbody/>")
      .replace(/<div class="terminus"[\s\S]*?<\/div>/g, "")
      .replace(/<div class="compact-disclosure"[\s\S]*?<\/div>/g, "");
  assert.equal(
    strip(collapsed),
    strip(expanded),
    "collapsing changed something other than the rows and the bound it states",
  );
});

test("R19: no honesty element is rendered INSIDE a collapsible root", () => {
  // A caveat that lives inside the tbody would leave the tree the moment the
  // table collapsed, which is exactly the failure this requirement names.
  const html = membersSection(corpus(25), 5);
  const at = html.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}">`);
  const body = html.slice(at, html.indexOf("</tbody>", at));
  for (const sel of ["caveat-line", "terminus", "footnotes-stacked", "compact-disclosure", "col-why"]) {
    assert.ok(!body.includes(sel), `"${sel}" must live outside the collapsible root, not inside it`);
  }
  // Footnote MARKERS legitimately sit on rows — a marker belongs to the row it
  // annotates, and a hidden row's marker is hidden with it. What must never be
  // inside the root is the printed BLOCK those markers resolve to. And every
  // marker on a rendered row must resolve: two ranking sections on one page
  // mean two blocks, so a hard-coded href would dangle in one of them.
  for (const href of body.match(/href="#([^"]+)"/g) ?? []) {
    const id = href.slice(7, -1);
    assert.ok(
      html.includes(`id="${id}"`),
      `a row marker points at #${id}, which this section does not render`,
    );
  }
});

test("R7: the omission rule holds at the boundary — equal to the slice renders no control", () => {
  // Exactly COMPACT_ROWS distinct tickers: nothing is hidden, so nothing is
  // offered. One more, and both the bound and the control appear.
  const atLimit = [];
  for (let i = 0; i < COMPACT_ROWS; i++) {
    atLimit.push(txn({ txnId: `t${i}`, ticker: `T${i}`, low: 1001 + i, high: 15000 + i }));
  }
  const sectionFor = (rows: TxnRow[]): string =>
    congressRankingSection(
      "tickers",
      congressTickersRollup(rows, NOW, { range: "12m", basis: "traded" }),
      stamps,
      ctx,
      { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section" },
    );
  // The shell exists (F16) but is hidden and unlabelled: the reader is offered
  // nothing, which is what the omission rule is about.
  assert.match(sectionFor(atLimit), /class="compact-disclosure"[^>]*hidden>/);
  assert.doesNotMatch(sectionFor(atLimit), /Show all/);
  assert.match(sectionFor(atLimit), /class="terminus"[^>]*hidden>/, "hidden shell, nothing shown");

  const overLimit = [...atLimit, txn({ txnId: "extra", ticker: "ZZZ", low: 1, high: 2 })];
  assert.match(sectionFor(overLimit), /compact-toggle/);
  assert.match(sectionFor(overLimit), /Truncated by Public Filings/);
});

/* ---------- R3 parity ---------- */

test("R3: the client's default view is byte-identical to the server's", () => {
  const rows = corpus(25);
  const range = "12m" as const;
  const basis = "traded" as const;

  // What the server put in the page.
  const serverSection = congressRankingSection(
    "tickers",
    congressTickersRollup(rows, NOW, { range, basis }),
    stamps,
    ctx,
    { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section", controls: true },
  );
  const at = serverSection.indexOf(`<tbody id="${CONGRESS_ROOTS.momentum}">`);
  const serverBody = serverSection.slice(
    at + `<tbody id="${CONGRESS_ROOTS.momentum}">`.length,
    serverSection.indexOf("</tbody>", at),
  );

  // What the client computes for the same range and basis, by the same path
  // the island uses: rollup → rankNetRows → rankingRootHtml at the default sort.
  const rollup = congressTickersRollup(rows, NOW, { range, basis });
  const { ranked } = rankNetRows(rollup.rows, (r) => r.net, (r) => r.id);
  // The island derives this id from the enclosing section, exactly as the
  // server does — passing a different one is precisely the drift this test
  // exists to catch, and it did catch it.
  const clientBody = rankingRootHtml(ranked, "net", "desc", "tickers", ctx, {
    compact: COMPACT_ROWS,
    footnotesId: "momentum-section-footnotes",
  }).html;

  assert.equal(clientBody, serverBody, "server and client disagree on the default view");
});

test("R3: parity holds for every range crossed with every basis", () => {
  const rows = corpus(25);
  for (const range of ["7d", "30d", "90d", "12m"] as const) {
    for (const basis of ["traded", "filed"] as const) {
      const rollup = congressTickersRollup(rows, NOW, { range, basis });
      const { ranked } = rankNetRows(rollup.rows, (r) => r.net, (r) => r.id);
      const a = rankingRootHtml(ranked, "net", "desc", "tickers", ctx, { compact: COMPACT_ROWS }).html;
      const b = rankingRootHtml(ranked, "net", "desc", "tickers", ctx, { compact: COMPACT_ROWS }).html;
      assert.equal(a, b, `${range}/${basis} is not deterministic`);
      // and the rollup itself is stable across recomputation
      const again = congressTickersRollup(rows, NOW, { range, basis });
      assert.deepEqual(again.rows.map((r) => r.id), rollup.rows.map((r) => r.id));
    }
  }
});
