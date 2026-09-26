/* R48 plumbing contract. These tests exist to pin the ONE property external
   review (round 2, F2) demanded: the shared helper carries no ordering
   semantics. It never sees a row, never compares, never buckets — it wires
   headers, toggles direction, maintains aria-sort, announces, and swaps in
   whatever HTML the caller hands back. If a future change moves a comparator
   in here, the "never inspects rows" test fails. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStylesheet } from "./lib/styles.ts";

import { initSortableTable, type SortState } from "../src/scripts/table-sort.ts";

function header(key: string) {
  const attrs = new Map<string, string>();
  const listeners: (() => void)[] = [];
  return {
    key,
    attrs,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    addEventListener: (_t: "click", l: () => void) => void listeners.push(l),
    click: () => listeners.forEach((l) => l()),
  };
}

function harness(initial: SortState = { key: "value", dir: "desc" }) {
  const heads = [header("filer"), header("value"), header("securities")];
  const root = { innerHTML: "SSR-BODY" };
  const status = { textContent: null as string | null };
  const seen: SortState[] = [];
  const rerender = initSortableTable({
    root,
    headers: heads,
    keyOf: (th) => (th as unknown as { key: string }).key,
    initial,
    defaultDir: (k) => (k === "filer" ? "asc" : "desc"),
    render: (s) => {
      seen.push({ ...s });
      return `rows:${s.key}:${s.dir}`;
    },
    announce: (s) => `sorted by ${s.key} ${s.dir}`,
    statusEl: status,
  });
  return { heads, root, status, seen, rerender };
}

test("init reflects the server state in aria-sort WITHOUT repainting", () => {
  const h = harness();
  // The SSR body is already correct; repainting would risk a flash and would
  // mask a server/client ordering disagreement instead of exposing it.
  assert.equal(h.root.innerHTML, "SSR-BODY");
  assert.equal(h.seen.length, 0);
  assert.equal(h.heads[1].getAttribute("aria-sort"), "descending");
  assert.equal(h.heads[0].getAttribute("aria-sort"), "none");
  assert.equal(h.heads[2].getAttribute("aria-sort"), "none");
});

test("clicking the active column toggles direction, and only it is marked", () => {
  const h = harness();
  h.heads[1].click();
  assert.deepEqual(h.seen.at(-1), { key: "value", dir: "asc" });
  assert.equal(h.heads[1].getAttribute("aria-sort"), "ascending");
  assert.equal(h.root.innerHTML, "rows:value:asc");
  h.heads[1].click();
  assert.deepEqual(h.seen.at(-1), { key: "value", dir: "desc" });
  const marked = h.heads.filter((x) => x.getAttribute("aria-sort") !== "none");
  assert.equal(marked.length, 1);
});

test("switching column uses the caller's default direction, not the previous one", () => {
  const h = harness();
  h.heads[1].click(); // value -> asc
  h.heads[0].click(); // filer: caller says text ascends
  assert.deepEqual(h.seen.at(-1), { key: "filer", dir: "asc" });
  h.heads[2].click(); // securities: caller says numbers descend
  assert.deepEqual(h.seen.at(-1), { key: "securities", dir: "desc" });
});

test("the announcement is written to the status element on every paint", () => {
  const h = harness();
  assert.equal(h.status.textContent, null); // no paint on init
  h.heads[0].click();
  assert.equal(h.status.textContent, "sorted by filer asc");
});

test("the returned rerender repaints at the CURRENT state", () => {
  const h = harness();
  h.heads[0].click();
  h.root.innerHTML = "clobbered";
  h.rerender();
  assert.equal(h.root.innerHTML, "rows:filer:asc");
});

test("the helper never inspects rows — it is given none and still works", () => {
  // Passing no row data at all proves ordering cannot live here. If a future
  // change adds a comparator to this module, it will need rows and this fails.
  const h = harness();
  h.heads[2].click();
  assert.equal(h.root.innerHTML, "rows:securities:desc");
});

test("headers without a key are skipped, not crashed on", () => {
  const heads = [header("value"), header("")];
  const root = { innerHTML: "" };
  initSortableTable({
    root,
    headers: heads,
    keyOf: (th) => {
      const k = (th as unknown as { key: string }).key;
      return k === "" ? undefined : k;
    },
    initial: { key: "value", dir: "desc" },
    defaultDir: () => "desc",
    render: () => "x",
  });
  assert.equal(heads[0].getAttribute("aria-sort"), "descending");
  assert.equal(heads[1].getAttribute("aria-sort"), null);
});

/* ── The 44 px affordance, asserted rather than assumed ───────────────────────
   Code review (cycle 3) fixed a real defect here — the rule was scoped to
   `[data-sort]` only, leaving the `[data-inst-sort]` adopter below target — and
   then correctly pointed out that nothing pinned the sizing at all, so the same
   defect could return silently. This reads the stylesheet, because the property
   lives in CSS and a renderer test cannot see it. */

import { readFileSync } from "node:fs";

/* L9 (DESIGN-POLISH M1; record in design-principles §7). The 44px target
   becomes a --hit-min square (44px coarse / at the fold, 24px otherwise)
   reached through a layout-neutral ::before, so a sort button never makes its
   header row taller than the ledger's. Still evaluated PER ADOPTER, in source
   order, as the cascade would (code review, cycle 4 F3): each adopter must end
   with the pseudo-element's content, absolute position and --hit-min insets,
   and no rule may give the button itself a min-width or min-height. */
const ADOPTERS = ["data-sort", "data-inst-sort", "data-congress-sort", "data-feed-sort", "data-adds-sort"];

function hitAreaFor(source: string, adopter: string): { content: string | null; position: string | null; left: string | null; minSize: string[] } {
  const rules = [...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), decls: m[2]! }));
  const applies = (part: string, pseudo: boolean): boolean => {
    const p = part.trim();
    const target = pseudo ? /\.th-sort\)?::before$/.test(p) : /\.th-sort$/.test(p);
    if (!target) return false;
    const qual = /th\[(data-[\w-]+)\]/.exec(p);
    return !qual || qual[1] === adopter;
  };
  const effective = (prop: string): string | null => {
    let value: string | null = null;
    let important = false;
    for (const r of rules) {
      if (!r.sel.split(",").some((part) => applies(part, true))) continue;
      for (const d of r.decls.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))) {
        const raw = d[1]!.trim();
        const imp = /!\s*important/i.test(raw);
        if (important && !imp) continue;
        value = raw.replace(/!\s*important/i, "").trim();
        important = imp;
      }
    }
    return value;
  };
  const minSize = rules
    .filter((r) => r.sel.split(",").some((part) => applies(part, false)) && /min-(width|height)\s*:/.test(r.decls))
    .map((r) => r.sel);
  return { content: effective("content"), position: effective("position"), left: effective("left"), minSize };
}

test("L9: every sortable-header adopter reaches --hit-min through the button's ::before, with no min size on the button", () => {
  const css = baseStylesheet();
  for (const adopter of ADOPTERS) {
    const h = hitAreaFor(css, adopter);
    assert.equal(h.content, '""', `${adopter}: the pseudo-element exists`);
    assert.equal(h.position, "absolute", `${adopter}: it is layout-neutral`);
    assert.match(h.left ?? "", /var\(--hit-min\)/, `${adopter}: it is sized by --hit-min`);
    assert.deepEqual(h.minSize, [], `${adopter}: no min-width/min-height on the button itself`);
  }
  // controls: an adopter whose pseudo is switched off, and a button given a min size, each fail
  const off = hitAreaFor(css + "\nth[data-inst-sort] .th-sort::before { content: none; }", "data-inst-sort");
  assert.notEqual(off.content, '""');
  assert.deepEqual(hitAreaFor(css + "\nth[data-sort] .th-sort { min-height: 44px; }", "data-sort").minSize, ["th[data-sort] .th-sort"]);
});

test("the base .th-sort reset does not silently re-zero the target", () => {
  const css = baseStylesheet();
  const sized = css.indexOf("th[data-sort] .th-sort,");
  const reset = css.indexOf(".th-sort {");
  assert.ok(sized > reset, "the 44px rule must come AFTER the padding:0 reset, or it loses the cascade");
});
