/* RUN M2-12 — the "Position changes" bound.

   The defect this pins: `filer-period-data` embedded EVERY period's full delta
   list, so the page grew with the filer's position count. Measured on build
   20260812.1, CIK 0001423053 was 29,115,421 B against a 25 MiB provider limit —
   and the only tree that ever fitted was hand-edited after the build, with the
   quarter selector deleted from exactly those pages.

   Every test here fails if its bound is removed; that is the point of them.
   [[mutation-tests-pin-properties]] */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HOLDINGS_EMBED_BYTE_CAP,
  HOLDINGS_PAGE_SIZE,
  boundQoqDeltas,
  compareQoqDeltas,
  sortQoqDeltas,
  utf8ByteLength,
} from "../src/lib/holdings.ts";
import { changesTableHtml, filerPeriodSectionHtml } from "../src/lib/ui.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";

/** A delta row shaped like the producer's, sized so a few thousand exceed the
    embed byte cap the way the real 15,885-row filer does. */
function delta(i: number, currValue: number | null): QoqDeltaRow {
  return {
    cik: "0001423053",
    position_key: `POS${String(i).padStart(8, "0")}`,
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    curr_value_usd: currValue,
    prev_value_usd: 1_000,
    curr_shares: 10,
    prev_shares: 5,
    change_kind: "increase",
    put_call_bucket: "none",
    unit_key: "shares",
    flags: [],
    issuer_name: `ISSUER ${i} ${"x".repeat(80)}`,
    title_of_class: "COM",
  } as unknown as QoqDeltaRow;
}

test("M2-12: the embed is bounded by bytes, not by the filer's position count", () => {
  // 20,000 rows is under HOLDINGS_EMBED_ROW_CAP, so only the BYTE cap can bind —
  // which is the bound the unbounded embed was missing.
  const raw = Array.from({ length: 20_000 }, (_, i) => delta(i, 1_000_000 - i));
  const bound = boundQoqDeltas(raw);
  assert.equal(bound.total, 20_000, "the true total is preserved, uncapped");
  assert.ok(bound.rows.length < raw.length, "the byte cap actually bound this list");
  assert.ok(
    JSON.stringify(bound.rows).length <= HOLDINGS_EMBED_BYTE_CAP,
    `embed is ${JSON.stringify(bound.rows).length} B, over the ${HOLDINGS_EMBED_BYTE_CAP} B cap`,
  );
});

test("M2-12: the cap keeps the LARGEST changes — ordering happens before the cut", () => {
  /* Capping an unordered list would silently drop the positions a reader most
     needs. The smallest row is created FIRST so an unordered cap would keep it
     and drop the largest. */
  const raw = [delta(0, 1), ...Array.from({ length: 20_000 }, (_, i) => delta(i + 1, 10_000 + i))];
  const bound = boundQoqDeltas(raw);
  const keys = new Set(bound.rows.map((r) => r.position_key));
  assert.ok(bound.rows.length < raw.length, "the cap bound this list");
  assert.ok(!keys.has("POS00000000"), "the smallest change must not survive a cap");
  assert.equal(
    bound.rows[0]!.position_key,
    sortQoqDeltas(raw)[0]!.position_key,
    "the kept rows lead with the largest change",
  );
});

test("M2-12: a capped period names the withholding, its author, and the TRUE total", () => {
  const rows = [delta(1, 900), delta(2, 800)];
  const html = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 15_885 });
  assert.ok(html.includes('data-terminus-author="populus"'), "the cut is attributed");
  assert.ok(html.includes("15,885"), "the TRUE total appears, not the embedded count");
  assert.ok(html.includes("15,883"), "the withheld count appears");
  assert.ok(/agg_qoq_deltas/.test(html), "the terminus points at where the rest live");
});

test("M2-12: an UNCAPPED period claims no withholding that never happened", () => {
  const rows = [delta(1, 900), delta(2, 800)];
  const html = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: rows.length });
  assert.ok(
    !html.includes("are not embedded in this page"),
    "a complete list must not carry a truncation terminus — that is the same lie inverted",
  );
});

test("M2-12: the stat tile reports the true total while the table shows a page", () => {
  const rows = Array.from({ length: 250 }, (_, i) => delta(i, 5_000 - i));
  const html = filerPeriodSectionHtml(null, rows, "2026-03-31", "2026-05-15", 25, {
    total: 15_885,
  });
  assert.ok(
    html.includes("15,885"),
    "the QoQ-moves tile must state the filer's real activity, never the capped length",
  );
});

test("M2-12: the changes table paginates at the shared page size", () => {
  const rows = Array.from({ length: 250 }, (_, i) => delta(i, 5_000 - i));
  const page0 = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 250, page: 0 });
  const rowCount = (html: string): number => (html.match(/<tr><td class="c-pos"/g) ?? []).length;
  assert.equal(rowCount(page0), HOLDINGS_PAGE_SIZE, "page 0 holds exactly one page of rows");
  assert.ok(page0.includes("data-changes-pager"), "a multi-page table renders its pager");

  const page1 = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 250, page: 1 });
  assert.equal(rowCount(page1), HOLDINGS_PAGE_SIZE);
  assert.notEqual(page0, page1, "page 1 is a different slice, not the same page re-rendered");

  // Last page is partial, and the range line must not invert or overrun.
  const page2 = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 250, page: 2 });
  assert.equal(rowCount(page2), 50);
  assert.ok(page2.includes("201–250 of 250 changes"), "the range line describes the page it renders");
});

test("M2-12: a single page of changes renders no pager at all", () => {
  const rows = Array.from({ length: 12 }, (_, i) => delta(i, 500 - i));
  const html = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 12 });
  assert.ok(!html.includes("data-changes-pager"), "one page needs no pager chrome");
});

test("M2-12: an empty period stays the honest first-period state, not an empty table", () => {
  const html = filerPeriodSectionHtml(null, [], "2025-03-31", "2026-05-15", 25, { total: 0 });
  assert.ok(html.includes("No quarter-over-quarter rows land in"), "absence states its reason");
  assert.ok(!html.includes("data-changes-pager"));
  // The section's standing methodology terminus is expected here; what must NOT
  // appear is a TRUNCATION claim over a period that withheld nothing.
  assert.ok(!html.includes("are not embedded in this page"));
});

/* ---- Codex round-3 blockers, pinned so they cannot silently return ---- */

test("M2-12/F1: the changes pager works on FIRST LOAD, before any chip is clicked", () => {
  /* The shipped bug: `initFilerPeriods` seeded its period as "" and the pager
     handler bailed on a falsy period, so every click was swallowed until a chip
     was clicked — and the browser check that "verified" the pager had clicked a
     chip first, so it never saw this. The regression guard is the SOURCE
     invariant: the period must be seeded from the active chip, never from "". */
  const src = readFileSync(
    path.join(import.meta.dirname, "..", "src", "scripts", "entity-client.ts"),
    "utf-8",
  );
  const seeded = /let period =\s*\n?\s*chips\.querySelector<HTMLElement>\("\[data-period\]\.chip-active"\)/.test(
    src,
  );
  assert.ok(seeded, "the pre-rendered period must be seeded from the SSR-active chip");
  assert.ok(
    !/let period = "";\s*\n\s*let page = 0;/.test(src),
    "seeding period to the empty string is exactly the defect this pins",
  );
});

test("M2-12/F1: the tail-filer route delegates changes-pager clicks", () => {
  const src = readFileSync(
    path.join(import.meta.dirname, "..", "src", "scripts", "entity-client.ts"),
    "utf-8",
  );
  assert.match(src, /changesPage: \(dir: "prev" \| "next"\) => void;/, "handle exposes changesPage");
  assert.match(src, /data-changes-page/, "the generic route delegates the pager control");
  assert.match(
    src,
    /filerChangesPage = 0;/,
    "a period switch resets the changes page — an index from another quarter addresses nothing",
  );
});

test("M2-12/F4: the comparator is a TOTAL ORDER — reflexive and antisymmetric", () => {
  /* Codex F3: the first version of this test only checked that a sorted list
     came out in the expected order, and Codex proved it passed against the
     non-reflexive comparator it claimed to pin. Assert the PROPERTY on the
     comparator itself. [[mutation-tests-pin-properties]] */
  const a = { position_key: "POS1", curr_value_usd: 5, prev_value_usd: null };
  const same = { position_key: "POS1", curr_value_usd: 5, prev_value_usd: null };
  const other = { position_key: "POS2", curr_value_usd: 5, prev_value_usd: null };

  // Reflexive: an element against itself, and against an equal element.
  assert.equal(compareQoqDeltas(a, a), 0, "cmp(x, x) must be 0");
  assert.equal(compareQoqDeltas(a, same), 0, "equal value AND equal key must compare 0");

  // Antisymmetric: swapping the arguments must flip the sign, never repeat it.
  assert.equal(
    Math.sign(compareQoqDeltas(a, other)),
    -Math.sign(compareQoqDeltas(other, a)),
    "cmp(x,y) and cmp(y,x) must have opposite signs",
  );

  // The NULL fallbacks participate in the same order.
  const exited = { position_key: "POS3", curr_value_usd: null, prev_value_usd: 9 };
  const nothing = { position_key: "POS4", curr_value_usd: null, prev_value_usd: null };
  assert.ok(compareQoqDeltas(exited, nothing) < 0, "a disclosed prev value outranks none");
  assert.equal(compareQoqDeltas(nothing, nothing), 0);
});

test("M2-12/F5: the embed cap counts UTF-8 BYTES, not UTF-16 code units", () => {
  /* The shipped cap measured `JSON.stringify(row).length`. Every non-ASCII
     character in an issuer name costs 2-3 UTF-8 bytes but ONE code unit, so the
     embed could sit at ~2x its declared budget while reporting itself satisfied.
     Regenerating the cross-runtime fixture after this fix moved its
     cap-boundary case from 4,090,715 B to 2,045,683 B against a 2,097,152 B
     cap — the defect, measured. */
  assert.equal(utf8ByteLength("abc"), 3, "ASCII: bytes == code units");
  assert.equal(utf8ByteLength("é"), 2, "Latin-1 supplement is 2 bytes, 1 code unit");
  assert.equal(utf8ByteLength("日"), 3, "CJK is 3 bytes, 1 code unit");
  assert.equal(utf8ByteLength("😀"), 4, "astral is 4 bytes, 2 code units");

  // A row set whose serialization is ASCII-cheap but byte-expensive must be
  // bound by BYTES: measured against the declared cap, not a proxy for it.
  const wide = Array.from({ length: 4_000 }, (_, i) => ({
    ...delta(i, 1_000_000 - i),
    issuer_name: "日".repeat(300),
  })) as unknown as QoqDeltaRow[];
  const bound = boundQoqDeltas(wide);
  const bytes = utf8ByteLength(JSON.stringify(bound.rows));
  assert.ok(
    bytes <= HOLDINGS_EMBED_BYTE_CAP,
    `embed is ${bytes} UTF-8 B, over the declared ${HOLDINGS_EMBED_BYTE_CAP} B cap`,
  );
  assert.ok(bound.rows.length < wide.length, "the byte cap bound this list");
  assert.equal(bound.total, wide.length, "the true total survives the cap");
});
