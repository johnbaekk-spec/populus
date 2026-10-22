/* launch M2 (Home A, D1) — post-build checks over the REAL dist (owner tier).

   R15: every home ledger figure equals an independent recompute from the
        artifacts the same build published — the trades from stats.json, the
        members and 13F filers from the shipped search index, the hits from
        signals.v1.json (its own window in the label), "stand out of N rows
        ranked" from /signals/'s own figure, and Updated from stats.json.
   R16: every lead card's /signals/#… row exists in the built /signals/.
   R17: the hero makes no cadence claim; every "Try" chip links to a built page.
   R14 / R40: no Modules class survives; both home tables carry their roles.

   (This file sits beside M1a's post/launch-dist.test.ts; the integrator may
   fold the two.) */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist");
const read = (...p: string[]): string => readFileSync(path.join(DIST, ...p), "utf-8");

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The figures of the FIRST `dl.design-ledger` in `html`: each group's dt
    label (a label trigger's note panel is not part of it), value and sub. */
function firstLedger(html: string): { label: string; value: string; sub: string | null; note: string }[] {
  const dl = /<dl class="design-ledger"[^>]*>[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "";
  return dl
    .split('<div class="ledger-fig"')
    .slice(1)
    .map((g) => {
      const group = g.slice(0, g.indexOf("</div>"));
      const dt = /<dt\b[^>]*>([\s\S]*?)<\/dt>/.exec(group)?.[1] ?? "";
      const sub = /<dd class="ledger-sub">([\s\S]*?)<\/dd>/.exec(group);
      return {
        label: text(dt.split('<span class="note-pop"')[0]!),
        value: text(/<dd class="ledger-value">([\s\S]*?)<\/dd>/.exec(group)?.[1] ?? ""),
        sub: sub ? text(sub[1]!) : null,
        note: text(/<span class="note-pop"[^>]*>([\s\S]*?)<\/span>/.exec(dt)?.[1] ?? ""),
      };
    });
}

const fmt = (n: number): string => n.toLocaleString("en-US");

test("launch M2 R15: the home ledger's figures equal recomputes from the same build's published artifacts", () => {
  const home = read("index.html");
  const stats = JSON.parse(read("stats.json"));
  const index = JSON.parse(read("search", "index.v1.json")) as { members: unknown[]; filers: unknown[] };
  const art = JSON.parse(read("signals", "data", "signals.v1.json")) as { retentionDays: number; signals: { status: string }[] };
  const figs = firstLedger(home.slice(home.indexOf('<div class="home-ledger">')));
  assert.deepEqual(figs.map((f) => f.label), ["Congress trades", "13F filers on record", `Signals · ${art.retentionDays} days`, "Updated"]);
  const [trades, filers, signals, updated] = figs as [typeof figs[0], typeof figs[0], typeof figs[0], typeof figs[0]];
  assert.equal(trades.value, fmt(stats.default.row_count), "trades = the default view's transactions");
  assert.match(trades.sub!, new RegExp(`· ${fmt(index.members.length)} members?$`), "members = the joined members the search index ships");
  if (index.filers.length > 0) {
    assert.equal(filers.value, fmt(index.filers.length), "13F filers on record = every filer in the build");
    assert.match(filers.sub!, /^newest closed quarter Q[1-4] \d{4} · filings through \d{4}-\d{2}-\d{2}$|^no quarter closed for filing yet$/);
  } else {
    assert.deepEqual([filers.value, filers.sub], ["—", "not in this build"]);
  }
  assert.equal(signals.value, fmt(art.signals.filter((s) => s.status === "active").length), "hits = active signals in the window");
  // the triage's own unit, as /signals/ states it
  const sig = read("signals", "index.html");
  const standOut = firstLedger(sig).find((f) => f.label === "Stand out");
  assert.ok(standOut, "/signals/ carries its Stand out figure");
  const ranked = /^of ([\d,]+) rows? ranked$/.exec(standOut!.sub ?? "")?.[1];
  assert.ok(ranked, `/signals/'s Stand out sub reads "of N rows ranked": ${standOut!.sub}`);
  assert.match(signals.sub!, new RegExp(`^${standOut!.value} stands? out of ${ranked} rows? ranked$`));
  assert.equal(updated.value, String(stats.generated_at).slice(0, 10), "Updated = the build date");
  assert.equal(updated.sub, `House to ${stats.freshness?.house_db_max_filed_date ?? "—"} · Senate to ${stats.freshness?.senate_db_max_filed_date ?? "—"}`);
  assert.doesNotMatch(home, /Today|live-dot/, "DV5");
});

test("launch M2 R16: every lead card opens a row that exists on the built /signals/", () => {
  const home = read("index.html");
  const sig = read("signals", "index.html");
  const lead = home.slice(home.indexOf('id="home-lead"'), home.indexOf('class="home-pair"'));
  assert.equal((lead.match(/<article class="si-card home-card"/g) ?? []).length, 3, "three cards");
  const hrefs = [...lead.matchAll(/<a class="si-card-open" href="\/signals\/#([^"]+)"/g)].map((m) => m[1]!);
  for (const id of hrefs) assert.ok(sig.includes(`id="${id}"`), `/signals/ has the row #${id}`);
  assert.match(lead, /The overlap is context, never an allegation/, "the committee caveat");
});

test("launch M2 R17 / R14 / R40: no cadence claim, chips reach built pages, no Modules class, table roles", () => {
  const home = read("index.html");
  const main = home.slice(home.indexOf("<main"), home.indexOf("</main>"));
  assert.doesNotMatch(text(main), /daily|every day|Nothing secondhand|Rebuilt every/i);
  const chips = [...main.matchAll(/<a class="home-chip" data-kind="[a-z]+" href="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(chips.length >= 1, "the Try chips render");
  for (const href of chips) {
    const file = href.startsWith("/e/") ? path.join(DIST, "e", "index.html") : path.join(DIST, decodeURIComponent(href), "index.html");
    assert.ok(existsSync(file), `${href} is a built page`);
  }
  assert.doesNotMatch(home, /class="[^"]*\b(?:mod-grid|mod-card|modules-head|home-tiles|badge-live)\b/);
  const tables = main.match(/<table\b[^>]*>/g) ?? [];
  assert.ok(tables.length >= 1 && tables.length <= 2, "Latest from Congress, and Notable managers wherever the quarter has new stakes");
  for (const t of tables) assert.match(t, /role="table"/);
  assert.doesNotMatch(main, /<tr(?![^>]*role="row")[^>]*>/, "every row carries role=row");
});
