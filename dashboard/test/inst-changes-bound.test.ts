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
  type QoqDeltaLike,
} from "../src/lib/holdings.ts";
import { changesTableHtml, filerChangesHtml, filerPeriodSectionHtml } from "../src/lib/ui/index.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import { MiniElement } from "./lib/mini-dom.ts";

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
  /* DOM parse (DESIGN-POLISH M1, T1.9): a changes row is a body row whose
     first cell is the position cell — counted by structure, so a row attribute
     the ledger adds (`data-edge`) cannot make the count read zero. */
  const rowCount = (html: string): number => {
    const root = new MiniElement("body");
    root.innerHTML = html;
    return root.querySelectorAll("tbody tr").filter((tr) => tr.children[0]?.classList.contains("c-pos")).length;
  };
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
     chip first, so it never saw this. The property: the period is seeded from
     the SSR-active chip, never from "".

     DESIGN-POLISH M2 (F.3) moved the period chips onto the Position changes
     band head, INSIDE `[data-filer-root]`, which the switch repaints; so the
     seed now reads the chip inside the root, and chip clicks are delegated on
     the root (a listener bound to the first chip set would go stale on the
     first repaint). Pinned from both sides: the SSR bytes carry exactly one
     active chip for the rendered period inside the root, and the island seeds
     from that chip and handles chip and pager clicks on the root. */
  const src = readFileSync(
    path.join(import.meta.dirname, "..", "src", "scripts", "entity-client.ts"),
    "utf-8",
  );
  const start = src.indexOf("export function initFilerPeriods");
  assert.ok(start >= 0);
  const body = src.slice(start, src.indexOf("\nexport function ", start + 1));
  /** The island's seed + delegation problems, as a predicate its controls run through. */
  const seedProblems = (fn: string): string[] => {
    const out: string[] = [];
    if (!/const root = document\.querySelector<HTMLElement>\("\[data-filer-root\]"\)/.test(fn)) out.push("the root is not [data-filer-root]");
    if (!/let period =\s*\n?\s*(?:offered\()?root\.querySelector<HTMLElement>\("\[data-period-chips\] \[data-period\]\.chip-active"\)\?\.dataset\.period/.test(fn)) out.push("the period is not seeded from the active chip inside the root");
    if (/let period = "";/.test(fn)) out.push("the period is seeded to the empty string");
    const handler = fn.slice(fn.indexOf('root.addEventListener("click"'));
    if (!fn.includes('root.addEventListener("click"')) out.push("clicks are not delegated on the root");
    else {
      if (!/closest<HTMLButtonElement>\("\[data-period-chips\] \[data-period\]"\)/.test(handler)) out.push("chip clicks are not handled by the root's delegate");
      if (!/closest<HTMLButtonElement>\("\[data-changes-page\]"\)/.test(handler)) out.push("pager clicks are not handled by the root's delegate");
    }
    return out;
  };
  assert.deepEqual(seedProblems(body), []);
  // controls: the original defect, and a seed read from outside the root, each fail
  assert.ok(seedProblems(body.replace(/let period =[\s\S]*?;\n/, 'let period = "";\n')).length > 0, "control: an empty seed");
  assert.ok(seedProblems(body.replace('root.addEventListener("click"', 'chips.addEventListener("click"')).length > 0, "control: a non-delegated listener");

  // the SSR half: exactly one active chip, for the rendered period, inside the root
  const ssr = new MiniElement("body");
  ssr.innerHTML = filerChangesHtml(["2025-12-31", "2026-03-31"], "2026-03-31", null, [delta(1, 100)], "2026-05-15", 25, { total: 1 });
  const root = ssr.querySelector("[data-filer-root]")!;
  const active = root.querySelectorAll("[data-period-chips] [data-period].chip-active");
  assert.equal(active.length, 1, "one active chip inside the root");
  assert.equal(active[0]!.getAttribute("data-period"), "2026-03-31", "…naming the rendered period");
  assert.equal(active[0]!.getAttribute("aria-pressed"), "true");
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

/* ---- Cross-runtime parity, from the SHARED fixture (Codex closeout F2/F4) ----

   `tests/fixtures/qoq_parity.v1.json` is read here AND by tests/test_qoq_parity.py.
   Both repairs Codex flagged — the equal-key comparator and the lone-surrogate
   serialization — previously existed in both runtimes with nothing invoking the
   Python side, so reverting either left the suite green while they diverged. */

interface ParityFixture {
  comparator: { name: string; a: QoqDeltaLike; b: QoqDeltaLike; sign: number; why: string }[];
  sort_order: { rows: QoqDeltaLike[]; expected_keys: string[] };
  serialization: { name: string; value: string; json: string; utf8_bytes: number }[];
  lone_surrogates: { name: string; code_points: number[]; json: string; utf8_bytes: number }[];
}

const PARITY: ParityFixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "qoq_parity.v1.json"),
    "utf-8",
  ),
);

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

test("PARITY: every shared comparator case, including reflexivity and antisymmetry", () => {
  for (const c of PARITY.comparator) {
    assert.equal(sign(compareQoqDeltas(c.a, c.b)), c.sign, `${c.name}: ${c.why}`);
    // `-0 !== 0` under assert.strict's Object.is semantics, so normalise the
    // expectation rather than letting a signed zero fail a correct comparator.
    assert.equal(
      sign(compareQoqDeltas(c.b, c.a)),
      c.sign === 0 ? 0 : -c.sign,
      `${c.name}: the comparator must be antisymmetric`,
    );
    assert.equal(compareQoqDeltas(c.a, c.a), 0, `${c.name}: cmp(x,x) must be 0`);
    assert.equal(compareQoqDeltas(c.b, c.b), 0, `${c.name}: cmp(y,y) must be 0`);
  }
});

test("PARITY: the shared sort order matches the sequence Python produces", () => {
  const got = sortQoqDeltas(PARITY.sort_order.rows).map((r) => r.position_key);
  assert.deepEqual(got, PARITY.sort_order.expected_keys);
});

test("PARITY: serialized bytes match the Python reference exactly", () => {
  for (const c of PARITY.serialization) {
    assert.equal(JSON.stringify(c.value), c.json, c.name);
    assert.equal(utf8ByteLength(JSON.stringify(c.value)), c.utf8_bytes, c.name);
  }
});

test("PARITY: lone surrogates serialize identically in both runtimes", () => {
  for (const c of PARITY.lone_surrogates) {
    const value = String.fromCharCode(...c.code_points);
    assert.equal(JSON.stringify(value), c.json, c.name);
    assert.equal(utf8ByteLength(JSON.stringify(value)), c.utf8_bytes, c.name);
  }
});

/* DESIGN-POLISH M1 review R-3. The compact bound under the changes table
   counts ONE PAGE of the filer's changes, while the pager beside it states the
   whole set ("101–200 of 250 changes"). Stated as "1–20 of 100 changes" the
   bound read as a second, contradictory total. The property: the compact count
   names its bound (definite, "changes on this page"), and no count on the
   rendered table ever states the page's row count as the total of changes. */
function changeCounts(html: string): { compact: string | null; pager: string | null } {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return {
    compact: root.querySelector(".compact-bound-count")?.textContent.trim() ?? null,
    pager: root.querySelector("[data-changes-pager] .pager-range")?.textContent.trim() ?? null,
  };
}
/** A range count ("a–b of N changes") whose total is the page's row count and
    which does not name that bound. */
function pageBoundStatedAsTotal(text: string, rowsOnPage: number): boolean {
  const m = /of (the )?([\d,]+) changes(?! on this page)/.exec(text);
  return !!m && Number(m[2]!.replace(/,/g, "")) === rowsOnPage;
}

test("R-3: the compact bound on a page of changes names the page, never states it as the total", () => {
  const rows = Array.from({ length: 250 }, (_, i) => delta(i, 5_000 - i));
  const page1 = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 250, page: 1 });
  const c = changeCounts(page1);
  assert.equal(c.pager, "101–200 of 250 changes", "the pager states the whole set");
  assert.equal(c.compact, `1–20 of the ${HOLDINGS_PAGE_SIZE} changes on this page`, "the bound names this page");
  assert.equal(pageBoundStatedAsTotal(c.compact!, HOLDINGS_PAGE_SIZE), false);
  // control: the pre-fix wording states the page bound as a total
  assert.equal(pageBoundStatedAsTotal(`1–20 of ${HOLDINGS_PAGE_SIZE} changes`, HOLDINGS_PAGE_SIZE), true, "control");
});
