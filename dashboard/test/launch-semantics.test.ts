/* launch M1a (R40, LD37, T1.3): card tables keep their table semantics.

   At ≤720px every table folds into row cards (D4); WebKit can drop native
   table semantics once `display` changes, so every table carries explicit
   roles at every width, from one function (`withTableRoles`) run where table
   markup enters a page: the layout's render of the page body (Base.astro) and
   every client sink that paints table markup (`rolesFor`). These tests pin:

   - the function: each element's role, the head/body distinction for th, the
     stated role kept, `data-card` inferred or kept, `data-label` copied from
     the column head by position (colspans counted), nested tables scoped,
     comments and raw-text elements untouched, idempotence, and that it ONLY
     ADDS attributes (no visual change, M1a's contract);
   - every parity surface, run through the layout's function, has every table
     carded and every card row, head and cell role'd — and a planted role-less
     row is caught (the negative control);
   - the client sinks: every sink that paints table markup goes through
     `rolesFor`, and a fragment painted into a live table takes the head's
     labels; a planted unwrapped sink is caught;
   - the wiring: Base.astro renders its body through `withTableRoles`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CARD_KINDS, cardKindOf, feedItemHtml, thHtml, withTableRoles, type TxnRow } from "../src/lib/format.ts";
import { entityTxnRowsHtml, entityTxnTable } from "../src/lib/ui/congress.ts";
import { headLabels, rolesFor } from "../src/scripts/table-roles.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { cardTableCounts, stripTableRoles, tableRoleViolations } from "./lib/table-roles.ts";
import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";
import { fixtureTxns } from "./lib/inst-signals-fixture.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const src = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");

function parse(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
function* walk(el: MiniElement): Generator<MiniElement> {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}

const ADDED = new Set(["role", "data-card", "data-label"]);

/** `out` equals `input` but for attributes the transform may ADD: the same
    element tree, the same text, every input attribute kept with its value,
    and any new attribute one of role / data-card / data-label. Returns the
    first difference, or null. */
function onlyAdds(input: string, out: string): string | null {
  const a = parse(input);
  const b = parse(out);
  const cmp = (x: MiniElement, y: MiniElement, at: string): string | null => {
    if (x.tagName !== y.tagName) return `${at}: <${x.tagName}> became <${y.tagName}>`;
    for (const [k, v] of x.attributes) {
      if (y.getAttribute(k) !== v) return `${at} <${x.tagName}>: ${k}="${v}" became ${JSON.stringify(y.getAttribute(k))}`;
    }
    for (const k of y.attributes.keys()) {
      if (!x.attributes.has(k) && !ADDED.has(k)) return `${at} <${x.tagName}>: added ${k}`;
      if (!x.attributes.has(k) && k === "role" && !["table", "rowgroup", "row", "columnheader", "rowheader", "cell"].includes(y.getAttribute(k)!)) {
        return `${at} <${x.tagName}>: added role=${y.getAttribute(k)}`;
      }
    }
    if (x.nodes.length !== y.nodes.length) return `${at} <${x.tagName}>: ${x.nodes.length} nodes became ${y.nodes.length}`;
    for (let i = 0; i < x.nodes.length; i++) {
      const p = x.nodes[i]!;
      const q = y.nodes[i]!;
      if (typeof p === "string" || typeof q === "string") {
        if (p !== q) return `${at} <${x.tagName}>: text ${JSON.stringify(p).slice(0, 60)} became ${JSON.stringify(q).slice(0, 60)}`;
      } else {
        const d = cmp(p, q, `${at}/${p.tagName}[${i}]`);
        if (d) return d;
      }
    }
    return null;
  };
  return cmp(a, b, "body");
}

/* ------------------------------------------------------------ the function */

const SIMPLE =
  `<div class="table-scroll"><table class="etable"><caption class="visually-hidden">c</caption>` +
  `<thead><tr><th scope="col" data-label="Member">Member</th><th scope="col" class="c-num" data-label="Trades">Trades</th><th scope="col">Src</th></tr></thead>` +
  `<tbody><tr><td class="c-member">A</td><td class="c-num">3</td><td class="c-src"><a href="/x">x</a></td></tr>` +
  `<tr><th scope="row">B</th><td class="c-num">4</td><td>—</td></tr></tbody>` +
  `<tfoot><tr><td colspan="3">foot</td></tr></tfoot></table></div>`;

test("R40: every table element gets its role; th reads columnheader in the head and rowheader in a body row", () => {
  const out = withTableRoles(SIMPLE);
  const root = parse(out);
  const roles = [...walk(root)].filter((e) => /^(table|thead|tbody|tfoot|tr|th|td)$/.test(e.tagName)).map((e) => `${e.tagName}:${e.getAttribute("role")}`);
  assert.deepEqual(roles, [
    "table:table",
    "thead:rowgroup",
    "tr:row",
    "th:columnheader",
    "th:columnheader",
    "th:columnheader",
    "tbody:rowgroup",
    "tr:row",
    "td:cell",
    "td:cell",
    "td:cell",
    "tr:row",
    "th:rowheader",
    "td:cell",
    "td:cell",
    "tfoot:rowgroup",
    "tr:row",
    "td:cell",
  ]);
  assert.deepEqual(tableRoleViolations(out), []);
  assert.equal(onlyAdds(SIMPLE, out), null, "the transform only adds attributes");
});

test("R40: a th without scope is a column head in the head, a row head in the body; scope wins", () => {
  const out = withTableRoles(`<table><thead><tr><th>H</th></tr></thead><tbody><tr><th>R</th><th scope="col">C</th></tr></tbody></table>`);
  const ths = [...walk(parse(out))].filter((e) => e.tagName === "th").map((e) => e.getAttribute("role"));
  assert.deepEqual(ths, ["columnheader", "rowheader", "columnheader"]);
});

test("R40: a role the markup already states is kept, and so is a stated data-card", () => {
  const out = withTableRoles(`<table data-card="ranking" role="table"><tbody role="rowgroup"><tr role="row"><td role="cell">1</td></tr></tbody></table>`);
  assert.equal(out, `<table data-card="ranking" role="table"><tbody role="rowgroup"><tr role="row"><td role="cell">1</td></tr></tbody></table>`);
  // idempotent over a real table too
  const once = withTableRoles(SIMPLE);
  assert.equal(withTableRoles(once), once, "running twice equals running once");
});

test("R40 / LD6: data-card names the card layout — the feed, entity transactions, holders, else generic", () => {
  assert.equal(cardKindOf(` class="feed-table reference-feed"`), "feed");
  assert.equal(cardKindOf(` class="etable" data-entity-table data-kind="member"`), "member-trades");
  assert.equal(cardKindOf(` class="etable" data-sticky-first data-holders-table`), "holders");
  assert.equal(cardKindOf(` class="etable etable-compact"`), "generic");
  assert.equal(cardKindOf(` class="etable" data-card="moves"`), "moves");
  assert.equal(cardKindOf(` class="etable" data-card="nonsense"`), "generic", "an unknown stated kind falls back");
  assert.deepEqual([...CARD_KINDS], ["feed", "ranking", "member-trades", "holders", "moves", "generic"]);
  assert.match(withTableRoles(`<table class="feed-table reference-feed"><tbody></tbody></table>`), /<table class="feed-table reference-feed" role="table" data-card="feed">/);
});

test("LD6: a body cell takes its column head's data-label by position; colspans count; a head without one gives none", () => {
  const out = withTableRoles(
    `<table><thead><tr><th colspan="2" data-label="Wide">W</th><th data-label="Third">T</th><th>None</th></tr></thead>` +
      `<tbody><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr><tr><td colspan="2">ab</td><td>c</td><td data-label="Own">d</td></tr></tbody></table>`,
  );
  const cells = [...walk(parse(out))].filter((e) => e.tagName === "td").map((e) => e.getAttribute("data-label"));
  assert.deepEqual(cells, ["Wide", null, "Third", null, null, "Third", "Own"]);
});

test("R40: a nested table is scoped on its own; comments, scripts and styles pass through untouched", () => {
  const html =
    `<!-- <table><tr><td>not markup</td></tr></table> -->` +
    `<script type="application/json">{"x":"<tr><td>not markup</td></tr>"}</script>` +
    `<style>td{color:red}</style>` +
    `<table><thead><tr><th data-label="Outer">O</th></tr></thead><tbody><tr><td>` +
    `<table><thead><tr><th data-label="Inner">I</th></tr></thead><tbody><tr><td>i</td></tr></tbody></table>` +
    `</td></tr></tbody></table>`;
  const out = withTableRoles(html);
  assert.ok(out.startsWith(`<!-- <table><tr><td>not markup</td></tr></table> --><script type="application/json">{"x":"<tr><td>not markup</td></tr>"}</script><style>td{color:red}</style>`));
  // the tables only (the test DOM would read the comment and the script as markup)
  const tds = [...walk(parse(out.slice(out.indexOf("</style>") + "</style>".length)))].filter((e) => e.tagName === "td").map((e) => e.getAttribute("data-label"));
  assert.deepEqual(tds, ["Outer", "Inner"]);
  assert.equal(withTableRoles(`<p>no table here</p>`), `<p>no table here</p>`);
});

test("R40: a fragment of rows is a body; labels come from the table it is painted into", () => {
  assert.equal(withTableRoles(`<tr><td>1</td><th>2</th></tr>`), `<tr role="row"><td role="cell">1</td><th role="rowheader">2</th></tr>`);
  assert.equal(
    withTableRoles(`<tr><td>1</td><td>2</td></tr>`, { labels: ["A &amp; B", null] }),
    `<tr role="row"><td role="cell" data-label="A &amp; B">1</td><td role="cell">2</td></tr>`,
  );
});

test("LD6: thHtml carries the column's mark-free label as data-label", () => {
  assert.match(thHtml({ label: "Trades †", cls: "c-num" }), /data-label="Trades"/);
  assert.match(thHtml({ label: "Δ $", cls: "c-num", sort: { attr: "data-x", key: "dv", state: "none" } }), /data-label="Δ \$"/);
});

/* ------------------------------------------------------ every parity surface */

let SURFACES: Record<string, string> | null = null;
async function surfaces(): Promise<Record<string, string>> {
  SURFACES ??= await renderParitySurfaces();
  return SURFACES;
}

test("R40: every parity surface, through the layout's function, cards every table and roles every card row, head and cell", async () => {
  const all = await surfaces();
  let tables = 0;
  for (const [name, html] of Object.entries(all)) {
    const out = withTableRoles(html);
    const counts = cardTableCounts(out);
    tables += counts.tables;
    assert.equal(counts.cards, counts.tables, `${name}: every table selects a card layout`);
    assert.deepEqual(tableRoleViolations(out), [], `${name}: every card row, head and cell carries its role`);
    assert.equal(onlyAdds(html, out), null, `${name}: the roles change nothing else (no visual change)`);
    assert.equal(stripTableRoles(out), stripTableRoles(html), `${name}: stripping the roles restores the markup`);
  }
  assert.ok(tables >= 30, `the surfaces carry tables to check (${tables})`);
});

test("R40 control: a planted role-less row, head or cell in a card table is caught", async () => {
  const all = await surfaces();
  const name = Object.keys(all).find((k) => withTableRoles(all[k]!).includes('<tbody role="rowgroup">'))!;
  assert.ok(name, "a surface with a table body exists");
  const out = withTableRoles(all[name]!);
  const plantedRow = out.replace('<tbody role="rowgroup">', '<tbody role="rowgroup"><tr><td class="c-num">1</td></tr>');
  assert.ok(tableRoleViolations(plantedRow).length >= 2, "a role-less row and its cell are both caught");
  const plantedCell = out.replace('<td ', '<td data-planted ').replace(/<td data-planted ([^>]*?) role="cell"/, "<td data-planted $1");
  assert.ok(tableRoleViolations(plantedCell).length >= 1, "a role-less cell is caught");
  const plantedHead = out.replace(' role="columnheader"', "");
  assert.ok(tableRoleViolations(plantedHead).length >= 1, "a role-less column head is caught");
  assert.deepEqual(tableRoleViolations(`<table><tr><td>not a card table</td></tr></table>`), [], "a table outside the card system is not checked");
});

/* -------------------------------------------------------- the client sinks */

/** Every client sink that paints table markup, and the renderer it paints. */
const SINKS: readonly { file: string; write: string }[] = [
  { file: "scripts/feed-client.ts", write: "bodyEl!.innerHTML = rolesFor(bodyEl, items.map((it) => feedItemHtml(it, ctx))" },
  { file: "scripts/feed-client.ts", write: 'bodyEl!.innerHTML = rolesFor(bodyEl, parts.join("\\n"))' },
  { file: "scripts/entity-client.ts", write: "rowsEl!.innerHTML = rolesFor(rowsEl, entityTxnRowsHtml(" },
  { file: "scripts/entity-client.ts", write: "root.innerHTML = rolesFor(root, filerPeriodSectionHtml(" },
  { file: "scripts/entity-client.ts", write: "root.innerHTML = rolesFor(root, holdersTableHtml(" },
  { file: "scripts/entity-client.ts", write: "root.innerHTML = rolesFor(root, html)" },
  { file: "scripts/signals-client.ts", write: "body!.innerHTML = rolesFor(\n      body," },
  { file: "scripts/table-sort.ts", write: "root.innerHTML = rolesFor(root, render(state))" },
  { file: "components/HoldingsTable.astro", write: "body.innerHTML = rolesFor(body, surfaceHtml(" },
];

/** Assignments of table markup that bypass `rolesFor`: an `innerHTML =` whose
    right-hand side names a table renderer (or a `<tr`/`<td` literal) without
    going through `rolesFor(`. */
function unwrappedSinks(source: string): string[] {
  const out: string[] = [];
  const RENDERERS = /(feedItemHtml|entityTxnRowsHtml|filerPeriodSectionHtml|holdersTableHtml|surfaceHtml|hitsBodyHtml|render\(state\)|v\.body|<tr\b|<td\b)/;
  for (const m of source.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
    const rhs = m[1]!;
    if (RENDERERS.test(rhs) && !/^\s*rolesFor\(/.test(rhs)) out.push(rhs.trim().slice(0, 80));
  }
  return out;
}

test("R40: every client sink that paints table markup goes through rolesFor", () => {
  for (const s of SINKS) assert.ok(src(s.file).includes(s.write), `${s.file}: ${s.write}`);
  for (const file of new Set(SINKS.map((s) => s.file))) {
    assert.deepEqual(unwrappedSinks(src(file)), [], `${file}: no table markup lands without its roles`);
  }
  // control: the same reading catches an unwrapped sink
  assert.equal(unwrappedSinks("rowsEl!.innerHTML = entityTxnRowsHtml(items, k, ctx);").length, 1);
  assert.equal(unwrappedSinks("body.innerHTML = `<tr><td>x</td></tr>`;").length, 1);
  assert.equal(unwrappedSinks("rowsEl!.innerHTML = rolesFor(rowsEl, entityTxnRowsHtml(items));").length, 0);
});

function txns(): TxnRow[] {
  return fixtureTxns();
}

test("R40: a client repaint carries the roles the server page carries, labels read off the live head", () => {
  /* The member table renders its rows on the client (the server body is
     empty). Mounted as the page carries it (through the layout's function),
     its body is repainted through the sink; the repaint must equal what the
     layout's function makes of the same rows rendered inside the table. */
  const rows = txns();
  const table = entityTxnTable(rows, { kind: "member", caption: "Transactions", page: 1, ctx: {} });
  assert.ok(table.includes("<tbody data-entity-rows></tbody>"), "the server body is the pager's empty mount");
  const host = parse(withTableRoles(table));
  const tbody = [...walk(host)].find((e) => e.tagName === "tbody" && e.hasAttribute("data-entity-rows"))!;
  const labels = headLabels(tbody);
  assert.ok(labels && labels.filter(Boolean).length >= 6, "the live head names its columns");
  const rowsHtml = entityTxnRowsHtml(rows, "member", {});
  const repaint = rolesFor(tbody, rowsHtml);
  const asServer = withTableRoles(table.replace("<tbody data-entity-rows></tbody>", `<tbody data-entity-rows>${rowsHtml}</tbody>`));
  const serverBody = /<tbody data-entity-rows role="rowgroup">([\s\S]*?)<\/tbody>/.exec(asServer)![1]!;
  assert.equal(repaint, serverBody, "the repaint equals the layout's markup for the same rows, roles and labels included");
  assert.match(repaint, /<td class="c-amount c-num" role="cell" data-label="Range">/);
  assert.match(repaint, /<td class="c-ticker" role="cell">/, "a self-describing cell carries no label");
  // a feed fragment painted with no live table still gets its row and cell roles
  const feed = rolesFor(null, rows.map((r) => feedItemHtml(r, {})).join("\n"));
  assert.deepEqual(tableRoleViolations(`<table data-card="feed" role="table"><tbody role="rowgroup">${feed}</tbody></table>`), []);
  assert.equal(headLabels({}), undefined, "a target with no closest has no head to read");
});

/* --------------------------------------------------------------- the wiring */

test("R40: Base.astro renders the page body through withTableRoles, once, and no bare slot remains", () => {
  const base = src("layouts/Base.astro");
  assert.match(base, /import \{ [^}]*\bwithTableRoles\b[^}]* \} from "\.\.\/lib\/format";/);
  assert.match(base, /const pageBody = withTableRoles\(await Astro\.slots\.render\("default"\)\);/);
  assert.match(base, /<Fragment set:html=\{pageBody\} \/>/);
  assert.doesNotMatch(base, /<slot\s*\/>/, "a bare slot would let a page body skip the roles");
});
