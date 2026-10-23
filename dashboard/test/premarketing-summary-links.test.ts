/* premarketing C: the names a row's <summary> shows — a Congress row's filer
   (`.si-row-member`, also the ticker page's "On Signals" row), a named move's
   manager (`.mv-mgr`), an Overlap row's first-named member (`.ov-who`) and
   manager (`.ov-mw`) — open their entity pages in place. The link is a
   SIBLING of the summary, never inside it (no control nests in a disclosure
   button), names itself in text, and is laid over the name by CSS anchor
   positioning above the fold; a name with no page gets no link. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { memberHrefFor } from "../src/lib/format.ts";
import { triageRowHtml } from "../src/lib/ui/signals.ts";
import { moveRowFrom, moveRowData, moveSection } from "../src/lib/ui/signals-institutional.ts";
import { overlapItemHtml } from "../src/lib/ui/signals-overlap.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import type { OverlapRow } from "../src/lib/overlap.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional, fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { parseRules, winning, type El } from "./lib/cascade.ts";

const CTX = {};
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function article(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root.querySelector("article")!;
}
/** The article's direct child links of class `cls` (siblings of the <details>). */
const own = (a: MiniElement, cls: string): MiniElement[] => a.children.filter((c) => c.tagName === "a" && c.classList.contains(cls));
const summaryControlFree = (a: MiniElement): void => {
  for (const s of a.querySelectorAll("summary")) assert.doesNotMatch(s.innerHTML, /<a\s|<button\s/, "no control in the summary");
};

test("premarketing C: a Congress row's member name has a sibling link to the member page; a cluster row and a member with no bioguide have none", () => {
  const f = loadTriageFixture();
  const tr = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const single = tr.rows.find((r) => r.grouping !== "cluster" && r.lead.txn.bioguide)!;
  assert.ok(single, "the fixture has a row with a member page");
  for (const html of [triageRowHtml(single, CTX), triageRowHtml(single, CTX, { link: false })]) {
    const a = article(html);
    const links = own(a, "si-row-ml");
    assert.equal(links.length, 1, "one link, a sibling of the <details>");
    assert.equal(links[0]!.getAttribute("href"), memberHrefFor(single.lead.txn.bioguide!, CTX));
    assert.equal(text(links[0]), `${single.lead.txn.name}, member page`);
    assert.ok(a.querySelector("summary .si-row-member"), "the name stays in the summary for layout");
    assert.equal(a.querySelectorAll("summary a").length, 0);
    summaryControlFree(a);
  }
  const cut = { cutMembers: new Set([single.lead.txn.bioguide!]) };
  assert.equal(own(article(triageRowHtml(single, cut)), "si-row-ml")[0]!.getAttribute("href"), memberHrefFor(single.lead.txn.bioguide!, cut), "a budget-cut member routes through /e/");
  const unjoined = { ...single, lead: { ...single.lead, txn: { ...single.lead.txn, bioguide: null } } };
  assert.equal(own(article(triageRowHtml(unjoined, CTX)), "si-row-ml").length, 0, "no bioguide, no link");
  const cluster = tr.rows.find((r) => r.grouping === "cluster");
  if (cluster) assert.equal(own(article(triageRowHtml(cluster, CTX)), "si-row-ml").length, 0, "a cluster's 'N members' is a count, not a name");
});

test("premarketing C: a named move's manager has a sibling link to its filer page; a row with no filer page has none", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(20) });
  const sec = moveSection(model);
  const r = moveRowData(model.moves[0]!, "mv-x", model);
  const a = article(moveRowFrom(r, sec));
  const links = own(a, "mv-mgr-a");
  assert.equal(links.length, 1);
  assert.equal(links[0]!.getAttribute("href"), r.fp);
  assert.match(r.fp, new RegExp(`^${model.filerHref(model.moves[0]!.cik).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#`));
  assert.equal(text(links[0]), `${r.manager}, filer page`);
  summaryControlFree(a);
  // a held row (the island's renderer) carries it too
  assert.equal(own(article(moveRowFrom(r, sec, true)), "mv-mgr-a").length, 1);
  assert.equal(own(article(moveRowFrom({ ...r, fp: "" }, sec)), "mv-mgr-a").length, 0, "no filer page, no link");
});

test("premarketing C: an Overlap row's first-named member and manager each have a sibling link laid over a span on that name; unjoined names have none", () => {
  const o = fixtureOverlap();
  const row = o.all.find((r) => [...r.buy, ...r.sell][0]?.bioguide && r.mBuy.length + r.mSell.length > 0)!;
  assert.ok(row);
  const fp = (cik: string): string => `/institutional/filers/${cik}/`;
  const a = article(overlapItemHtml(row, row, { core: 0, all: 0 }, o, CTX, true, fp));
  const first = [...row.buy, ...row.sell][0]!;
  const who = own(a, "ov-who-a");
  assert.equal(who.length, 1);
  assert.equal(who[0]!.getAttribute("href"), memberHrefFor(first.bioguide!, CTX));
  assert.equal(text(who[0]), `${first.name}, member page`);
  assert.equal(a.querySelectorAll("summary .ov-who .ov-w1").length, 1, "the anchor span wraps the first name only");
  const mw = own(a, "ov-mw-a");
  assert.equal(mw.length, 1);
  const m1 = text(a.querySelector("summary .ov-mw .ov-m1"));
  const m0 = [...row.mBuy, ...row.mSell].find((m) => m.manager === m1)!;
  assert.ok(m0, "the anchor span names a manager of the row");
  assert.equal(mw[0]!.getAttribute("href"), fp(m0.cik));
  assert.equal(text(mw[0]), `${m0.manager}, filer page`);
  summaryControlFree(a);

  // no filer route: no manager link, no anchor span
  const noFp = article(overlapItemHtml(row, row, { core: 0, all: 0 }, o, CTX, true, () => null));
  assert.equal(own(noFp, "ov-mw-a").length, 0);
  assert.equal(noFp.querySelectorAll(".ov-m1").length, 0);
  const noRoutes = article(overlapItemHtml(row, row, { core: 0, all: 0 }, o, CTX, true, null));
  assert.equal(own(noRoutes, "ov-mw-a").length, 0);
  // no bioguide: no member link, no anchor span
  const strip = (r: OverlapRow): OverlapRow => ({ ...r, buy: r.buy.map((m) => ({ ...m, bioguide: null })), sell: r.sell.map((m) => ({ ...m, bioguide: null })) });
  const noBio = article(overlapItemHtml(strip(row), strip(row), { core: 0, all: 0 }, o, CTX, true, fp));
  assert.equal(own(noBio, "ov-who-a").length, 0);
  assert.equal(noBio.querySelectorAll(".ov-w1").length, 0);

  // the variants name different first members: one link a variant, the broad one hidden as its cells are
  const other = o.all.find((r) => r !== row && [...r.buy, ...r.sell][0]?.bioguide && [...r.buy, ...r.sell][0]!.bioguide !== first.bioguide)!;
  const mixed: OverlapRow = { ...row, buy: [...other.buy, ...other.sell].slice(0, 1), sell: [] };
  const v = article(overlapItemHtml(row, mixed, { core: 0, all: 0 }, o, CTX, true, fp));
  const vs = own(v, "ov-who-a").map((l) => [l.getAttribute("data-v"), l.hasAttribute("hidden"), l.getAttribute("href")]);
  assert.deepEqual(vs, [
    ["core", false, memberHrefFor(first.bioguide!, CTX)],
    ["all", true, memberHrefFor([...other.buy, ...other.sell][0]!.bioguide!, CTX)],
  ]);
  summaryControlFree(v);
});

test("premarketing C: the CSS lays each link over its name with anchor positioning above the fold, and keeps it screen-reader-only at ≤720px", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "..", "src", "styles", "late-additions.css"), "utf-8");
  const begin = css.indexOf("/* premarketing C: summary name links — begin */");
  const end = css.indexOf("/* premarketing C — end */");
  assert.ok(begin > 0 && end > begin, "one bracketed block");
  assert.ok(css.slice(end).trim() === "/* premarketing C — end */", "at the very end of the file");
  const block = css.slice(begin, end);
  for (const [anchor, link] of [["si-row-member", "si-row-ml"], ["mv-mgr", "mv-mgr-a"], ["ov-w1", "ov-who-a"], ["ov-m1", "ov-mw-a"]] as const) {
    const name = new RegExp(`\\.${anchor} \\{ anchor-name: (--[\\w-]+)`).exec(block)?.[1];
    assert.ok(name, `.${anchor} names an anchor`);
    assert.match(block, new RegExp(`\\.${link} \\{ position-anchor: ${name}; \\}`), `.${link} is laid over .${anchor}`);
  }
  assert.match(block, /@supports \(anchor-name: --a\) \{\s*@media \(min-width: 721px\)/, "the overlay is above the fold, where the engine supports it");
  assert.match(block, /anchor-scope:/, "each row scopes its anchors");
  assert.doesNotMatch(block, /font-size:\s*(?!var\(--fs-)/, "font sizes are tokens");
  // the default (the fold, and an engine without anchor positioning): screen-reader-only
  const rules = parseRules(css);
  const chain: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "article", classes: ["si-row"] }, { tag: "a", classes: ["si-row-ml"], attrs: { href: "/x/" } }];
  for (const width of [360, 720]) {
    assert.equal(winning(rules, chain, "position", { width })?.value, "absolute");
    assert.equal(winning(rules, chain, "width", { width })?.value, "1px");
    assert.equal(winning(rules, chain, "clip-path", { width })?.value, "inset(50%)");
  }
});
