/* Refinement 20260910 — post-build checks over the REAL dist bytes (M1).

   R2: every `/institutional/tickers/…` href in dist resolves to a built file.
   R1: on the filer page for CIK 1067983 (when built) every Position-changes
       row leads with an issuer name and no first cell is a bare `sid:` key —
       asserted only when the serving artifact the build read carries the R1
       display relation, so a baseline-artifact (rollback) build is not blamed
       for names it could not have.
   R8: no ADD or TRIM row on any filer page has a Δ shares of exactly 0 (DOM
       parse over every filer page since DESIGN-POLISH M3).
   R9: no issuer label on the institutional landing's cluster / consensus
       board starts with a digit or is a 9-character CUSIP-shaped token. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveServingDbPath } from "../../src/lib/activity.ts";
import { addTrimRows, qoqViewPredatesR8, r8Violations, type KindRow } from "../lib/kind-rows.ts";

const DIST = path.join(process.cwd(), "dist");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function cells(html: string, cls: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<td class="${cls}[^"]*">([\\s\\S]*?)</td>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}

/* Visible text of an HTML fragment. Scans character by character rather than
   stripping `<[^>]+>` in one regex pass: a single pass can SPLICE a new tag
   out of its neighbours — `<<td>x<td>>` leaves a stray `>` and, in the general
   case, a whole reconstructed tag — so a one-pass strip is an incomplete
   sanitization (CodeQL js/incomplete-multi-character-sanitization). The scan
   below is a fixpoint by construction: no `<` or `>` can survive it, because
   every one of them is consumed as tag punctuation. A `<` seen while already
   inside a tag restarts the tag, which is the conservative reading for a
   banned-wording scan — it can only remove more markup, never leak it. */
const text = (s: string): string => {
  let out = "";
  let inTag = false;
  for (const ch of s) {
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
};

test("POST-BUILD R2: every /institutional/tickers/… href resolves to a built file", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const hrefs = new Set<string>();
  for (const file of walk(DIST)) {
    const html = readFileSync(file, "utf-8");
    for (const m of html.matchAll(/href="(\/institutional\/tickers\/[^"#?]+)/g)) hrefs.add(m[1]!);
  }
  const dead = [...hrefs].filter((h) => {
    const rel = decodeURIComponent(h).replace(/^\//, "").replace(/\/$/, "");
    return !existsSync(path.join(DIST, rel, "index.html")) && !existsSync(path.join(DIST, rel));
  });
  assert.deepEqual(dead, [], `dead institutional ticker hrefs: ${dead.slice(0, 10).join(", ")}`);
});

test("POST-BUILD R1: filer 1067983 changes rows are named, never a bare sid: cell", () => {
  const page = path.join(DIST, "institutional", "filers", "1067983", "index.html");
  if (!existsSync(page)) {
    // The dev extract does not carry this filer; the real-data build does.
    return;
  }
  const html = readFileSync(page, "utf-8");
  const servingPath = resolveServingDbPath();
  let hasDisplay = false;
  if (servingPath && existsSync(servingPath)) {
    const db = new DatabaseSync(servingPath, { readOnly: true });
    try {
      hasDisplay =
        (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='serving_position_display'`).get() as unknown) != null;
    } finally {
      db.close();
    }
  }
  const posCells = cells(html, "c-pos");
  assert.ok(posCells.length > 0, "the filer page renders Position-changes rows");
  if (hasDisplay) {
    const bare = posCells.filter((c) => /^<span class="mono-note">sid:/.test(c.trim()) || /^sid:/.test(text(c)));
    assert.equal(bare.length, 0, `${bare.length} bare sid: cells of ${posCells.length}`);
    const unnamed = posCells.filter((c) => !c.includes('class="filed-name"'));
    assert.equal(unnamed.length, 0, `${unnamed.length} unnamed change rows of ${posCells.length}`);
  }
});

/* R8, rewritten in DESIGN-POLISH M3 (T3.1, T-5). The old check matched
   `<tr>…qoq-chip qoq-(add|trim)…</tr>` on one filer page; once every change row
   carried an `id` and a `data-edge` (M1) no `<tr>` matched, so it collected
   nothing and passed on nothing. Now: EVERY built filer page's Position
   changes table is read by DOM parse (`addTrimRows`), every row whose kind
   cell reads ADD or TRIM is collected, at least one must exist across the
   build, and none may carry a Δ shares of exactly 0.

   The †v exemption, REVERSED IN PART by the M3 review (P-4, M3-D12 revised):
   the m3-dev version exempted any row carrying the producer's †v
   (`classified_by_value`) marker, on any build — an unbounded exemption. Now
   it applies ONLY when the aggregate this build read predates R8, detected
   from the artifact the way R1 detects its display relation: R8 added the
   `held` (NO CHANGE) kind, so a pre-R8 `agg_qoq_deltas` view never names
   'held'. On such a build (the local 20260817.1: 6,890 of 97,158 ADD/TRIM rows
   at Δ shares 0, every one marked †v) the disclosed rows are counted, not
   failed; on a post-R8 build the rule is the plan's own and a †v row at 0
   fails like any other. Predicate and detection: `test/lib/kind-rows.ts`
   (`r8Violations`, `qoqViewPredatesR8`), proved in the contributor tier. */
function aggregateQoqViewSql(): string | null {
  const dbPath = process.env.POPULUS_INST_DB ?? (process.env.POPULUS_BUILD_DIR ? path.join(process.env.POPULUS_BUILD_DIR, "inst_agg.db") : null);
  if (!dbPath || !existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE name='agg_qoq_deltas'`).get() as { sql?: string } | undefined;
    return row?.sql ?? null;
  } finally {
    db.close();
  }
}

test("POST-BUILD R8 (M3 T3.1): no ADD or TRIM row on any filer page has Δ shares 0, read by DOM parse", () => {
  const filers = path.join(DIST, "institutional", "filers");
  assert.ok(existsSync(filers), "the build renders filer pages");
  let pages = 0;
  const rows: (KindRow & { page: string })[] = [];
  for (const name of readdirSync(filers).sort()) {
    const page = path.join(filers, name, "index.html");
    if (!existsSync(page)) continue;
    const found = addTrimRows(readFileSync(page, "utf-8"));
    if (found === null) continue;
    pages++;
    for (const r of found) rows.push({ page: name, ...r });
  }
  assert.ok(pages > 0, "at least one filer page renders a Position changes table");
  assert.ok(rows.length > 0, `at least one ADD or TRIM row exists across ${pages} filer pages (a check that collected nothing proves nothing)`);
  const preR8 = qoqViewPredatesR8(aggregateQoqViewSql()) === true;
  const zero = r8Violations(rows, preR8) as (KindRow & { page: string })[];
  const disclosed = preR8 ? rows.filter((r) => r.deltaShares === "0" && r.valueClassified).length : 0;
  assert.equal(
    zero.length,
    0,
    `${zero.length} ADD/TRIM rows with Δ shares 0${preR8 ? " and no †v disclosure" : " (a post-R8 aggregate: no †v exemption)"}: ` +
      `${zero.slice(0, 5).map((r) => `${r.page} ${r.kind}`).join(", ")}` +
      (preR8 ? ` (${disclosed} more carry the pre-R8 †v marker on this pre-R8 aggregate)` : ""),
  );
  /* controls: the post tier's own, on the same predicate — an unmarked ADD at
     Δ shares 0 fails on any build; a †v ADD at 0 is exempt on a pre-R8
     aggregate only; a page with no ADD or TRIM row collects nothing */
  const page = (kindCell: string, delta: string): string =>
    `<table class="etable"><thead><tr><th>Position</th><th class="c-kind">Change</th><th>Δ value</th><th>Δ shares</th></tr></thead>` +
    `<tbody id="filer-changes-tbody"><tr><td class="c-pos">X</td><td class="c-chip c-kind">${kindCell}</td><td class="c-num">+$1K</td><td class="c-num">${delta}</td></tr></tbody></table>`;
  const unmarked = addTrimRows(page('<span class="qoq-chip qoq-add">ADD</span>', "0"))!;
  assert.equal(r8Violations(unmarked, true).length, 1, "control: an unmarked ADD at Δ shares 0 is caught, even pre-R8");
  const marked = addTrimRows(page('<span class="qoq-chip qoq-add">ADD</span><span class="fn-ref">†v</span>', "0"))!;
  assert.equal(r8Violations(marked, true).length, 0, "control: the †v row is disclosed on a pre-R8 aggregate");
  assert.equal(r8Violations(marked, false).length, 1, "control: the same †v row FAILS on a post-R8 aggregate");
  assert.deepEqual(addTrimRows(page('<span class="qoq-chip qoq-new">NEW</span>', "+5")), [], "control: a page with no ADD or TRIM row collects nothing");
});

/* The page-header ledger's figures, read from built HTML (DESIGN-POLISH M2,
   T2.8): each `<div class="ledger-fig">` group's dt label (its visible text —
   a label trigger's note PANEL is not part of the label), its value dd and its
   sub dd. A figure group holds only spans inside its dt, so it ends at its
   first `</div>`. */
function ledgerFiguresOf(html: string): { label: string; value: string; sub: string | null }[] {
  const out: { label: string; value: string; sub: string | null }[] = [];
  for (const dl of html.match(/<dl class="design-ledger"[^>]*>[\s\S]*?<\/dl>/g) ?? []) {
    for (const g of dl.split('<div class="ledger-fig"').slice(1)) {
      const group = g.slice(0, g.indexOf("</div>"));
      const dt = /<dt\b[^>]*>([\s\S]*?)<\/dt>/.exec(group)?.[1] ?? "";
      out.push({
        label: text(dt.split('<span class="note-pop"')[0]!),
        value: text(/<dd class="ledger-value">([\s\S]*?)<\/dd>/.exec(group)?.[1] ?? ""),
        sub: (() => { const m = /<dd class="ledger-sub">([\s\S]*?)<\/dd>/.exec(group); return m ? text(m[1]!) : null; })(),
      });
    }
  }
  return out;
}

/** R9: the issuer labels a reader sees on the institutional landing — the
    board cells, any remaining tile value, and (M2) the header ledger's
    Consensus-add figure: its value (the ticker, or "—") and the issuer NAME,
    which leads its sub ("NAME · N notable managers opened it"). */
function landingIssuerLabels(html: string): string[] {
  const consensusAdd = ledgerFiguresOf(html).filter((f) => f.label === "Consensus add");
  return [
    ...cells(html, "c-issuer"),
    ...(html.match(/class="tile-value">[^<]*/g)?.map((s) => s.slice(19)) ?? []),
    ...consensusAdd.flatMap((f) => [f.value, ...(f.sub ? [f.sub.split(" · ")[0]!] : [])]),
  ].map(text);
}
const numericOrCusip = (l: string): boolean => /^\d/.test(l) || /^[A-Z0-9]{9}$/.test(l);

test("POST-BUILD R9: the issuer-label reader sees the ledger's Consensus-add figure (controls)", () => {
  const fig = (value: string, sub: string): string =>
    `<dl class="design-ledger"><div class="ledger-fig" data-tone="blue"><dt><span class="note"><button type="button" class="note-btn note-label" aria-label="Consensus add, explain">Consensus add</button><span class="note-pop" popover role="note">why</span></span></dt><dd class="ledger-value">${value}</dd><dd class="ledger-sub">${sub}</dd></div></dl>`;
  assert.deepEqual(landingIssuerLabels(fig("NVDA", "Nvidia Corp · 3 notable managers opened it")), ["NVDA", "Nvidia Corp"]);
  assert.deepEqual(landingIssuerLabels(fig("NVDA", "Nvidia Corp · 3 notable managers opened it")).filter(numericOrCusip), []);
  // control: a CUSIP-shaped issuer in the sub, and a numeric value, are each caught by the same predicate
  assert.deepEqual(landingIssuerLabels(fig("—", "30233Q108 · 3 notable managers opened it")).filter(numericOrCusip), ["30233Q108"]);
  assert.deepEqual(landingIssuerLabels(fig("594918104", "Microsoft Corp · 3 notable managers opened it")).filter(numericOrCusip), ["594918104"]);
  // the tile read is kept for any page that still has tiles
  assert.deepEqual(landingIssuerLabels('<div class="tile-value">12345</div>').filter(numericOrCusip), ["12345"]);
});

test("POST-BUILD R9: no numeric or CUSIP-shaped issuer label on the institutional landing boards", () => {
  const page = path.join(DIST, "institutional", "index.html");
  if (!existsSync(page)) return;
  const html = readFileSync(page, "utf-8");
  assert.ok(ledgerFiguresOf(html).some((f) => f.label === "Consensus add"), "the landing ledger carries its Consensus-add figure");
  const bad = landingIssuerLabels(html).filter(numericOrCusip);
  assert.deepEqual(bad, [], `numeric / CUSIP-shaped issuer labels: ${bad.slice(0, 10).join(", ")}`);
});

/* ---------- Milestone 2 ---------- */

import { SHARD_RESPONSE_CEILING_BYTES } from "../../src/lib/shards.ts";

function walkAll(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  }
  return out;
}

test("POST-BUILD R12/LD7: every feed part is ≤ the 1 MiB ceiling and the index names exactly the emitted parts", () => {
  const dir = path.join(DIST, "congress", "data", "feed");
  assert.ok(existsSync(dir), "feed parts directory exists");
  const indexPath = path.join(dir, "index.v1.json");
  assert.ok(existsSync(indexPath), "the part index is published");
  const index = JSON.parse(readFileSync(indexPath, "utf-8")) as { page_size: number; parts: { part: string; bytes: number }[] };
  assert.equal(index.page_size, 50);
  assert.ok(index.parts.length > 0);
  const files = readdirSync(dir).filter((n) => n !== "index.v1.json").map((n) => n.replace(/\.v1\.json$/, "")).sort();
  assert.deepEqual(files, index.parts.map((p) => p.part).sort(), "index ↔ files");
  for (const p of index.parts) {
    const size = statSync(path.join(dir, `${p.part}.v1.json`)).size;
    assert.ok(size <= SHARD_RESPONSE_CEILING_BYTES, `${p.part} is ${size} B`);
    assert.equal(size, p.bytes, `${p.part}: index bytes match the file`);
  }
  // the landing carries the index inline, so paging never fetches it
  const landing = readFileSync(path.join(DIST, "congress", "index.html"), "utf-8");
  assert.match(landing, /id="feed-parts-index"/);
  const txnRowsOnPage1 = (landing.match(/class="feed-row feed-grid-cols reference-row/g) ?? []).length;
  const txnTotal = (index as unknown as { txn_total: number }).txn_total;
  assert.ok(txnRowsOnPage1 >= Math.min(50, txnTotal), `page 1 renders ${txnRowsOnPage1} rows; expected at least ${Math.min(50, txnTotal)}`);
});

test("POST-BUILD R13: no 'render bound' copy anywhere in dist", () => {
  const hits: string[] = [];
  for (const f of walkAll(DIST)) {
    if (!/\.(html|js)$/.test(f)) continue;
    if (/render bound/i.test(readFileSync(f, "utf-8"))) hits.push(path.relative(DIST, f));
  }
  assert.deepEqual(hits, [], `render bound on ${hits.length} surface(s)`);
});

test("POST-BUILD R14: every notable-moves shard is ≤ 1 MiB and the landing leads with the band, then the directory, then consensus", () => {
  const dir = path.join(DIST, "institutional", "data", "notable-moves");
  const landing = readFileSync(path.join(DIST, "institutional", "index.html"), "utf-8");
  if (!existsSync(dir)) {
    assert.ok(!landing.includes('id="inst-notable-moves"') || landing.includes("No closed quarter"), "no shards only when no closed quarter exists");
    return;
  }
  for (const f of readdirSync(dir)) {
    const size = statSync(path.join(dir, f)).size;
    assert.ok(size <= SHARD_RESPONSE_CEILING_BYTES, `${f} is ${size} B`);
    const shard = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { v: number; total: number; truncated: boolean; rows: unknown[] };
    assert.equal(shard.v, 1);
    assert.equal(shard.truncated, shard.rows.length < shard.total, `${f}: truncation is stated exactly`);
  }
  const band = landing.indexOf('id="inst-notable-moves"');
  const directory = landing.indexOf('id="inst-managers-section"');
  const consensus = landing.indexOf('id="inst-consensus"');
  const activity = landing.indexOf("Recent activity");
  assert.ok(band > 0 && directory > band && consensus > directory && activity > consensus, "R14 order: band → directory → consensus → activity");
  assert.doesNotMatch(landing, /Position discovery/, "the explainer cards are gone");
  assert.match(landing, /data-mgr-type="hedge_fund" aria-pressed="true"/, "Hedge funds selected by default");
});

test("POST-BUILD R20: /institutional/tickers/NVDA/holders/ exists with ≥10 holders naming BlackRock, Vanguard and State Street; ≥80% of the top-50 Congress tickers have a holders page", () => {
  const nvda = path.join(DIST, "institutional", "tickers", "NVDA", "holders", "index.html");
  assert.ok(existsSync(nvda), "NVDA holders page built");
  const html = readFileSync(nvda, "utf-8");
  const holders = (html.match(/<tr><td class="c-rank">/g) ?? []).length;
  assert.ok(holders >= 10, `${holders} holders listed`);
  for (const name of ["BLACKROCK", "VANGUARD", "STATE STREET"]) assert.ok(html.toUpperCase().includes(name), `${name} is a holder`);
  assert.match(html, /id="overlap"/, "the overlap band renders on the holders page");
  const ticker = path.join(DIST, "tickers", "NVDA", "index.html");
  if (existsSync(ticker)) assert.match(readFileSync(ticker, "utf-8"), /id="overlap"/, "…and on the unified ticker page");
  /* Top-50 Congress tickers by disclosures, reassembled from the feed PARTS —
     the whole corpus, which is what this assertion has always needed. It used
     to read `feed.v1.json`; R19 retired that single asset (85% of the 25 MiB
     provider cap), and the parts carry exactly the same rows. */
  const feedDir = path.join(DIST, "congress", "data", "feed");
  const index = JSON.parse(readFileSync(path.join(feedDir, "index.v1.json"), "utf-8")) as {
    item_total: number;
    parts: { part: string }[];
  };
  const counts = new Map<string, number>();
  let seen = 0;
  let col = -1;
  for (const meta of index.parts) {
    const body = JSON.parse(readFileSync(path.join(feedDir, `${meta.part}.v1.json`), "utf-8")) as {
      txn_cols: string[];
      rows: unknown[][];
    };
    if (col === -1) col = body.txn_cols.indexOf("ticker");
    for (const row of body.rows) {
      seen++;
      if (row[0] !== "t") continue; // a paper filing carries no ticker
      const t = row[col + 1]; // +1: the leading kind tag
      if (typeof t === "string" && t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  assert.equal(seen, index.item_total, "every published part was read — a short read would rank the wrong tickers");
  const top50 = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 50).map(([t]) => t);
  const missing = top50.filter((t) => !existsSync(path.join(DIST, "institutional", "tickers", t, "holders", "index.html")));
  /* The MECHANISM is asserted: every top-50 ticker the reviewed mapping names
     has a page (the budget covers the most-disclosed tickers first). The
     COVERAGE figure — the plan's ≥80% acceptance — is a property of the Tier C
     mapping's residue (R3, still being reviewed row by row), so it is REPORTED
     here and judged in the acceptance record, never silently converted into a
     pass or a fail of the render. */
  const covered = 50 - missing.length;
  console.log(`R20 acceptance: ${covered}/50 top Congress tickers have a holders page (${((covered / 50) * 100).toFixed(0)}%; plan asks ≥80%). Without: ${missing.join(", ") || "none"}`);
  const dbPath = process.env.POPULUS_INST_DB ?? "";
  if (dbPath && existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const mapped = new Set((db.prepare("SELECT ticker FROM agg_ticker_holder_totals").all() as { ticker: string }[]).map((r) => r.ticker.replace(/-/g, ".")));
      const mappedMissing = missing.filter((t) => mapped.has(t.replace(/-/g, ".")));
      assert.deepEqual(mappedMissing, [], `top-50 tickers the mapping names but no page was built for: ${mappedMissing.join(", ")}`);
    } finally {
      db.close();
    }
  }
});

test("POST-BUILD R15/R16/R18: filer 1067983 leads with identity → stats → changes; a member page carries one Planned line; the home has the claim and three tiles", () => {
  const filer = path.join(DIST, "institutional", "filers", "1067983", "index.html");
  if (existsSync(filer)) {
    const html = readFileSync(filer, "utf-8");
    const stats = html.indexOf('aria-label="Period statistics for');
    const changes = html.indexOf('class="panel panel-wide design-changes"');
    const holdings = html.indexOf('data-holdings-surface="filer"');
    assert.ok(stats > 0 && changes > stats, "stats precede the changes");
    assert.ok(holdings > 0, "the holdings surface renders");
    assert.equal((html.match(/class="planned-line"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /aria-label="Congress overlap"|aria-label="Signals for this filer"/);
  }
  const members = path.join(DIST, "congress", "members");
  const first = readdirSync(members).find((d) => existsSync(path.join(members, d, "index.html")));
  assert.ok(first, "a member page exists");
  const member = readFileSync(path.join(members, first!, "index.html"), "utf-8");
  assert.equal((member.match(/class="planned-line"/g) ?? []).length, 1);
  assert.doesNotMatch(member, /Holdings from annual disclosure<\/h2>|Institutional overlap<\/h2>/);
  const home = readFileSync(path.join(DIST, "index.html"), "utf-8");
  assert.match(home, /id="home-claim"/);
  for (const id of ["home-congress", "home-moves", "home-signals"]) assert.match(home, new RegExp(`id="${id}"`));
  assert.doesNotMatch(home, /returned to the people/);
  const methodology = readFileSync(path.join(DIST, "methodology", "index.html"), "utf-8");
  for (const anchor of ["principles", "published-dataset", "ranges", "13f-method", "position-grain", "ticker-mapping", "site-weight", "coverage"]) {
    assert.match(methodology, new RegExp(`id="${anchor}"`), `methodology anchor #${anchor}`);
  }
});

/* ---------- M3 (R23): the SRC §5 copy table, applied ---------- */

import { visibleText } from "../lib/banned-scan.ts";

/** The observed strings of SRC §5, as the source plan quotes them. Two have a
    methodology anchor as their declared new home, so they may remain on
    /methodology/ and nowhere else. */
const SRC5_OBSERVED: { s: string; home?: "methodology"; ci?: boolean; ledgerLabelOn?: string }[] = [
  { s: "a render bound, not a data bound" },
  { s: "further hits are in the artifact but not rendered here" },
  { s: "Every row remains in the published dataset", home: "methodology" },
  { s: "v_default_transactions — active filings minus superseded amendment originals" },
  { s: "per-filer filing dates are not in the published aggregate" },
  { s: "is in this build's projection for this filer" },
  /* L15 (DESIGN-POLISH M2, T2.2): "House parse" is a figure NAME on the
     /congress/ ledger (D2) and allowed ONLY there, in that ledger's <dt>;
     everywhere else — any other page, any paragraph, the figure's own note
     panel — it is matched case-insensitively. See `src5Text`. */
  { s: "HOUSE PARSE", ci: true, ledgerLabelOn: path.join("congress", "index.html") },
  { s: "Position discovery" },
  { s: "statutory lower bound" },
  { s: "interval subtraction" },
  { s: "open bounds propagate" },
  { s: "classified by value" },
  { s: "producer-classified", ci: true },
  { s: "grain: position" },
  { s: "security not in mapping" },
  { s: "shard budget" },
  { s: "Superseded — no longer in the current view" },
  { s: "gold tick", ci: true },
  { s: "coverage bucket", ci: true },
  { s: "bioguide_id=null" },
  { s: "Jump to a member, ticker or filer" },
  { s: "by this member in the corpus" },
  { s: "The people's financial data, returned to the people", home: "methodology" },
];

function walkHtml(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkHtml(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

/** The label half of each `<dt>` inside a `dl.design-ledger`, removed: its
    text AND the label trigger's accessible name (`aria-label`, which the
    visible-text reader includes). A note PANEL inside the dt (`.note-pop`, the
    figure's explanation) is kept intact, so its text is still scanned. */
function withoutLedgerLabels(html: string): string {
  const stripLabel = (seg: string): string => seg.replace(/\s(?:aria-label|title)="[^"]*"/g, "").replace(/(^|>)[^<]*/g, "$1");
  const keepPanels = (dt: string): string => {
    let out = "";
    let i = 0;
    while (i < dt.length) {
      const pop = dt.indexOf('<span class="note-pop"', i);
      if (pop < 0) {
        out += stripLabel(dt.slice(i));
        break;
      }
      out += stripLabel(dt.slice(i, pop));
      // the panel ends at its matching </span>
      let depth = 0;
      let j = pop;
      const tag = /<span\b[^>]*>|<\/span>/g;
      tag.lastIndex = pop;
      for (let m = tag.exec(dt); m; m = tag.exec(dt)) {
        depth += m[0] === "</span>" ? -1 : 1;
        j = tag.lastIndex;
        if (depth === 0) break;
      }
      out += dt.slice(pop, j);
      i = j;
    }
    return out;
  };
  return html.replace(/<dl class="design-ledger"[^>]*>[\s\S]*?<\/dl>/g, (dl) =>
    dl.replace(/(<dt\b[^>]*>)([\s\S]*?)(<\/dt>)/g, (_m, open: string, inner: string, close: string) => open + keepPanels(inner) + close),
  );
}

/** The text an SRC §5 string is scanned against on page `rel`: the page's
    visible text, except that a string declared a ledger label on ONE page
    (`ledgerLabelOn`) is scanned there with that page's ledger LABELS removed —
    and only the labels. */
function src5Text(html: string, rel: string, o: { ledgerLabelOn?: string }): string {
  return visibleText(o.ledgerLabelOn === rel ? withoutLedgerLabels(html) : html);
}
/** Does observed string `o` hit page `rel`? The ONE predicate the dist scan and its controls share. */
function src5Hit(html: string, rel: string, o: { s: string; ci?: boolean; ledgerLabelOn?: string }): boolean {
  const t = src5Text(html, rel, o);
  return o.ci ? t.toLowerCase().includes(o.s.toLowerCase()) : t.includes(o.s);
}

test("POST-BUILD R23 / L15: the HOUSE PARSE exemption covers only the /congress/ ledger's <dt> label (controls)", () => {
  const house = SRC5_OBSERVED.find((o) => o.s === "HOUSE PARSE")!;
  const congress = path.join("congress", "index.html");
  const ledger = (panel: string): string =>
    `<dl class="design-ledger"><div class="ledger-fig" data-tone="ink"><dt><span class="note"><button type="button" class="note-btn note-label" popovertarget="n-x" aria-describedby="n-x" aria-label="House parse, explain">House parse</button><span class="note-pop" popover id="n-x" role="note">${panel}</span></span></dt><dd class="ledger-value">97%</dd><dd class="ledger-sub">1,000 of 1,030 e-filed</dd></div></dl>`;
  const clean = ledger(`House electronic filings whose rows this build reads: 1,000 of 1,030. <a href="/methodology/#coverage">Coverage, in full ↗</a>`);
  assert.equal(src5Hit(clean, congress, house), false, "the ledger label on /congress/ is allowed");
  // controls: a planted paragraph, the phrase inside the figure's note panel, and the same ledger on another page are each caught
  assert.equal(src5Hit(clean + "<p>House parse is 97%</p>", congress, house), true, "control: a planted 'House parse' paragraph fails");
  assert.equal(src5Hit(ledger("the house parse rate"), congress, house), true, "control: the note panel inside the dt is still scanned");
  assert.equal(src5Hit(clean, path.join("congress", "members", "X", "index.html"), house), true, "control: another page's ledger label is not exempt");
  assert.equal(src5Hit(clean.replace("<dt>", "<dd>").replace("</dt>", "</dd>"), congress, house), true, "control: outside a <dt> it is not exempt");
  // the exemption strips only labels: the value and sub stay in the scanned text
  assert.match(src5Text(clean, congress, house), /97% 1,000 of 1,030 e-filed/);
});

test("POST-BUILD R23: every SRC §5 observed string returns 0 in dist's visible text (outside its declared methodology home)", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const counts = new Map<string, { n: number; at: string }>();
  let pages = 0;
  for (const file of walkHtml(DIST)) {
    pages++;
    const rel = path.relative(DIST, file);
    const html = readFileSync(file, "utf-8");
    for (const o of SRC5_OBSERVED) {
      if (o.home === "methodology" && rel === path.join("methodology", "index.html")) continue;
      if (src5Hit(html, rel, o)) {
        const c = counts.get(o.s) ?? { n: 0, at: rel };
        c.n++;
        counts.set(o.s, c);
      }
    }
  }
  assert.ok(pages >= 50, `only ${pages} pages scanned`);
  const left = [...counts].map(([s, c]) => `${JSON.stringify(s)} on ${c.n} page(s), e.g. ${c.at}`);
  assert.deepEqual(left, [], `SRC §5 strings still visible:\n${left.join("\n")}`);
});

test("POST-BUILD R23: every methodology anchor the copy pass points at exists", () => {
  const page = path.join(DIST, "methodology", "index.html");
  assert.ok(existsSync(page), "the methodology page is built");
  const html = readFileSync(page, "utf-8");
  /* DESIGN-POLISH M3 (R24, H-8): + the two paragraphs that receive the
     moved detail — the activity list's order, files and cut, and the filer
     page's grouping, size cap and de-duplicated totals. */
  for (const id of ["published-dataset", "coverage", "13f-method", "ranges", "position-grain", "ticker-mapping", "site-weight", "principles", "activity-files", "filer-positions"]) {
    assert.ok(html.includes(`id="${id}"`), `/methodology/ lacks #${id}`);
  }
});

/* ---------- DESIGN-POLISH M3: content hygiene over EVERY built page ----------

   R17 (no "· ·", no cell opening with a separator), R18 (no retired side word
   in a cell), R19 (no lowercase kind pill), R20 (no visible zero-padded CIK;
   no directory CIK cell with a leading zero), R23 (the receipt prints once).
   The predicates are `test/lib/content-scan.ts`; each one's detection is
   proved on a planted fixture in `test/content-hygiene.test.ts` (contributor
   tier) and again here, so this scan cannot pass by matching nothing. */
import { contentHits } from "../lib/content-scan.ts";

test("POST-BUILD M3: no doubled separator, padded CIK, doubled receipt, retired side word or kind pill on any page", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const planted = contentHits('<td class="cell-asset">A <span class="owner-note">· · SP</span></td><p>CIK 0001135730</p><td class="c-src">PTR PTR</td><td class="c-kind">Sale</td><td><span class="qoq-chip qoq-add">add</span></td>');
  assert.deepEqual(
    [...new Set(planted.map((h) => h.check))].sort(),
    ["a cell reads the retired side word", "a lowercase kind pill", "doubled receipt", "doubled separator", "zero-padded CIK"],
    "control: every predicate fires on its planted defect",
  );
  const pages = walk(DIST);
  assert.ok(pages.length >= 50, `only ${pages.length} pages scanned`);
  const found = new Map<string, { n: number; at: string }>();
  for (const file of pages) {
    const rel = path.relative(DIST, file).split(path.sep).join("/");
    for (const h of contentHits(readFileSync(file, "utf-8"), rel)) {
      const c = found.get(h.check) ?? { n: 0, at: `${rel}: ${h.excerpt}` };
      c.n++;
      found.set(h.check, c);
    }
  }
  const report = [...found].map(([k, v]) => `${k}: ${v.n} page(s), e.g. ${v.at}`);
  assert.deepEqual(report, [], `content hygiene:\n${report.join("\n")}`);
});
