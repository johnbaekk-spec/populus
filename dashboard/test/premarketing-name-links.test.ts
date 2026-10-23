/* Premarketing B (owner: "if i see a fund i should be able to click it same
   with congress"): every fund/manager name and every member name Signals
   shows outside a row's <summary> links that entity's page — a manager
   through the server's tier-aware `filerHref`, a member through
   `memberHrefFor` (a budget-cut member rides `/e/`). A name with no route
   (a filer no member record joins) stays plain text. The summaries keep no
   control (the rows' tested rule); their names link from the opened card. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { overlapItemHtml, type HeldOverlap } from "../src/lib/ui/signals-overlap.ts";
import { signalsOverlapHtml, triageRowHtml } from "../src/lib/ui/index.ts";
import { broadAccountsHtml, broadAccountsOf, signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
import { ctxOfCut } from "../src/lib/ui/signals.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import type { MemberLines } from "../src/lib/congress-quarter.ts";
import { BROAD_ONLY_KEY, fixtureInstitutional, fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { MiniElement } from "./lib/mini-dom.ts";

const CTX = {};
const FILER = (cik: string): string => `/institutional/filers/${Number(cik)}/`;
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

test("premarketing B: broad accounts name each member as a link to its member page, a cut member through /e/, an unjoined filer as plain text", () => {
  const m = (name: string, bioguide: string | null, breadth: number): MemberLines =>
    ({ key: bioguide ?? name, name, bioguide, party: "R", state: "TX", district: null, chamber: "house", breadth, rows: [] }) as MemberLines;
  const html = broadAccountsHtml(broadAccountsOf([m("Ann Member", "A000001", 40), m("Cut Member", "C000001", 30), m("Filed Name", null, 26)], { cutMembers: new Set(["C000001"]) }));
  const root = domOf(html);
  assert.deepEqual(root.querySelectorAll("a").map((a) => [text(a), a.getAttribute("href")]), [
    ["Ann Member", "/congress/members/A000001/"],
    ["Cut Member", "/e/?k=m:C000001"],
  ]);
  assert.equal(text(root), "Ann Member (40 names), Cut Member (30 names), Filed Name (26 names)", "the words are broadAccountsText's");
});

test("premarketing B: the Overlap tab links every listed manager to its filer page — in the page and in the held island alike — and keeps no control in a summary", () => {
  const html = signalsOverlapHtml(fixtureOverlap(), CTX, { filerHref: FILER });
  const m = /<script type="application\/json" data-held-for="ov-list" data-held-render="overlap-names">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "precondition: the fixture holds names in the island");
  const held = JSON.parse(m![1]!) as HeldOverlap;
  assert.ok(held.shared.fp && Object.keys(held.shared.fp).length > 0, "the island carries the server's filer hrefs");
  const fp = held.shared.fp!;
  const island = held.rows.map((it) => overlapItemHtml(it.core, it.all, it.ord, held.shared.q, ctxOfCut(held.shared.cut), false, (cik) => fp[cik] ?? null)).join("");
  for (const [where, h] of [["page", html], ["island", island]] as const) {
    const root = domOf(h);
    const names = root.querySelectorAll(".ov-mline .ov-m");
    assert.ok(names.length > 0, `${where}: precondition`);
    for (const n of names) {
      const a = n.querySelector("a");
      assert.ok(a, `${where}: ${text(n)} links`);
      assert.match(a!.getAttribute("href")!, /^\/institutional\/filers\/\d+\/$/, `${where}: to its filer page`);
    }
    for (const s of root.querySelectorAll("summary")) assert.doesNotMatch(s.innerHTML, /<a\s|<button\s/, `${where}: no control in a summary`);
  }
  // control: without a filer href (the artifact-only view) a manager stays plain text
  assert.equal(domOf(signalsOverlapHtml(fixtureOverlap(), CTX)).querySelectorAll(".ov-m a").length, 0);
});

test("premarketing B: the Institutional tab links the Consensus top mover to its filer page and names broad accounts as member links on the row body, the name detail and the Consensus card", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const root = domOf(signalsInstitutionalHtml(model, CTX));
  const tops = root.querySelectorAll("#consensus-list .cs-top");
  assert.ok(tops.length > 0);
  for (const t of tops) {
    if (text(t) === "—") continue;
    const a = t.querySelector("a");
    assert.ok(a, `${text(t)}: the top mover links`);
    assert.match(a!.getAttribute("href")!, /^\/institutional\/filers\/\d+\/$/);
    assert.equal(a!.closest("button"), null, "never inside the row's filter button");
  }
  const broadLink = (el: MiniElement | null): string | null =>
    el?.querySelectorAll("a").map((a) => a.getAttribute("href") ?? "").find((h) => h.startsWith("/congress/members/")) ?? null;
  const detail = root.querySelector(`[data-mv-detail-for="${BROAD_ONLY_KEY}"]`);
  assert.ok(broadLink(detail), "the name detail's broad account links");
  assert.ok(broadLink(root.querySelector('[data-card="consensus"] .si-card-dates')), "the Consensus card's broad account links");
  const mv = root.querySelector(`#mv-list article.mv-item[data-ikey="${BROAD_ONLY_KEY}"]`);
  assert.ok(broadLink(mv?.querySelector(".mv-det .mv-cong") ?? null), "a move row's opened body links it");
  for (const s of root.querySelectorAll("summary.mv-sum")) assert.doesNotMatch(s.innerHTML, /<a\s/, "no link in a row's summary");
});

test("premarketing B: a cluster row's opened Members fact links each member to its member page", () => {
  const f = loadTriageFixture();
  const t = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const cluster = t.rows.find((r) => r.grouping === "cluster" && r.cluster !== null);
  assert.ok(cluster, "precondition: the golden triage holds a cluster");
  const root = domOf(triageRowHtml(cluster!, CTX));
  const dd = root.querySelector(".si-row-facts")!.children.find((d) => text(d.querySelector("dt")) === "Members")!.querySelector("dd")!;
  const links = dd.querySelectorAll("a");
  const joined = new Set(cluster!.filings.map((x) => x.rows[0]!.bioguide).filter(Boolean));
  assert.ok(joined.size > 0, "precondition: a joined member");
  assert.equal(links.length, joined.size, "every joined member links");
  for (const a of links) assert.match(a.getAttribute("href")!, /^\/congress\/members\/[^/]+\/$|^\/e\/\?k=m:/);
  assert.doesNotMatch(root.querySelector("summary")!.innerHTML, /<a\s/, "the summary keeps no link");
});
