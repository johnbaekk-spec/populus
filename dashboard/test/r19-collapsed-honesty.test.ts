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
  /* RETARGETED by RUN SURFACES-LEGIBILITY (SL-R5/SL-R2b), same commit as the
     change that invalidated it. The property is UNCHANGED — an unsortable
     column must still state why it cannot be sorted — but the channel moved
     from a `.col-why` span to a note panel, which is reachable by touch,
     keyboard and print as the span was not. Asserting the TEXT, not the
     wrapper, is what keeps this a guard rather than a spelling check. */
  assert.match(html, /class="note-pop"/);
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R11 / LD4 (LD6). The visible
     `.caveat-line` and its `#<sectionId>-caveat` root are deleted; the two
     exclusion clauses are the body of a note on the window statement, and the
     SUMMED EXCLUDED-ROW TOTAL — never a count of categories — is that note's
     visible anchor, on the page at every width. Both clause assertions below
     are UNCHANGED: they still prove the text is in this collapsed body. The
     line the wrapper assertion becomes proves the new visible channel, so the
     honesty content asserted here went up rather than down. */
  assert.match(html, /rows excluded<span class="note">/, "the summed magnitude is visible, and anchors the note");
  assert.match(html, /date-anomaly row excluded from the trade-date window/);
  assert.match(html, /discloses no trade date and cannot be placed in a trade-date window/);
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R10 (LD6). The enumerated honesty
     element is the STATED BOUND and its named author, and both are unchanged;
     what moved is that they are no longer a separate `terminusRow` above the
     control repeating the control's own count. They are the control's first
     child now, and — the property that made the deletion honest — they are
     emitted VISIBLE, while the button beside them waits for a script. The
     assertions follow the text, and pin the visibility the row used to supply. */
  assert.match(html, /<span class="compact-bound-count">\d+ further ranked members are not rendered above/);
  assert.match(html, /a Public Filings render bound, not a data bound/);
  assert.match(html, /published dataset<\/a>/, "and the route to the rows it holds back");
  // footnote markers AND their printed lines
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R6/R7 (LD6). The section's
     footnote block is deleted; its three clauses are notes on the columns they
     qualify. The honesty property — the text is present in this body — is
     asserted by the two lines below, which are unchanged. This line now pins
     the note that carries them, so the channel is asserted too. */
  assert.match(html, /id="n-rank-members-section-net"/);
  assert.match(html, /net disclosed flow = sum of purchase bucket bounds/);
  assert.match(html, /overlapping intervals are incomparable/);
  // the stated absence: the wholly-undisclosed bucket and its explanation
  assert.match(html, /Not rankable — amounts wholly undisclosed/);
  /* The control offers to lift the bound, and states the TOTAL rather than
     re-stating the held-back count the sentence above it already carries
     (SL-R10). It ships `hidden`: a button that cannot work without JavaScript
     must not be presented as though it can — which is precisely why the
     sentence beside it may not ship hidden. */
  assert.match(html, /class="linklike compact-toggle"[^>]*hidden>Show all \d+ members</);
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
      // SL-R10: the terminus row's content is inside the control now, so the
      // strip has to reach the whole wrapper — `[\s\S]*?</div>` stops at the
      // first close tag, and the wrapper's children are elements too.
      .replace(/<div class="compact-disclosure"[\s\S]*?<\/button><\/div>/g, "");
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
  /* SL-R5: `col-why` -> `note-pop`; the enumerated honesty element is the
     explanation itself, and it is still in the tree — now in a channel a touch
     user can actually open. */
  for (const sel of ["caveat-line", "terminus", "footnotes-stacked", "compact-disclosure", "note-pop"]) {
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
  /* The shell exists (F16) but is hidden and unlabelled: the reader is offered
     nothing, which is what the omission rule is about. SL-R10: the shell is now
     the button plus an empty, hidden count clause — and NO count is claimed,
     which is the honesty the rule is protecting. */
  assert.doesNotMatch(sectionFor(atLimit), /Show all/);
  assert.match(sectionFor(atLimit), /class="linklike compact-toggle"[^>]*hidden><\/button>/);
  assert.match(sectionFor(atLimit), /<span class="compact-bound-count" hidden><\/span>/,
    "no rows are held back, so no count is stated");

  const overLimit = [...atLimit, txn({ txnId: "extra", ticker: "ZZZ", low: 1, high: 2 })];
  assert.match(sectionFor(overLimit), /compact-toggle/);
  assert.match(sectionFor(overLimit), /1 further ranked tickers are not rendered above/);
  assert.match(sectionFor(overLimit), /a Public Filings render bound, not a data bound/);
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
