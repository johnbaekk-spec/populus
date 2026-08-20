/* R48 plumbing contract. These tests exist to pin the ONE property external
   review (round 2, F2) demanded: the shared helper carries no ordering
   semantics. It never sees a row, never compares, never buckets — it wires
   headers, toggles direction, maintains aria-sort, announces, and swaps in
   whatever HTML the caller hands back. If a future change moves a comparator
   in here, the "never inspects rows" test fails. */

import { test } from "node:test";
import assert from "node:assert/strict";

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

test("both sortable-header surfaces meet the 44 px touch target", () => {
  const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

  // Evaluate PER SELECTOR. Joining every .th-sort rule and taking the globally
  // last declaration would let one adopter sit at zero while a later rule for
  // the OTHER adopter restored 44px (code review, cycle 4 F3). Each adopter is
  // resolved independently, in source order, exactly as the cascade would.
  const rules = css
    .split("}")
    .map((chunk) => chunk + "}")
    .filter((chunk) => /\.th-sort/.test(chunk) && /min-(height|width)\s*:/.test(chunk));

  // Source order alone is NOT the cascade: an `!important` declaration beats any
  // later non-important one (code review, cycle 4 F3). Track both, and let an
  // important value stand unless a later important value replaces it.
  const effective = (adopter: string, prop: string): string | null => {
    let value: string | null = null;
    let valueIsImportant = false;
    for (const rule of rules) {
      const selectorPart = rule.slice(0, rule.indexOf("{"));
      if (!new RegExp(`th\\[${adopter}\\]\\s*\\.th-sort`).test(selectorPart)) continue;
      for (const decl of rule.matchAll(new RegExp(`${prop}\\s*:\\s*([^;\}]+)`, "g"))) {
        const raw = decl[1].trim();
        const important = /!\s*important/i.test(raw);
        if (valueIsImportant && !important) continue; // a later normal decl cannot win
        value = raw.replace(/!\s*important/i, "").trim();
        valueIsImportant = important;
      }
    }
    return value;
  };

  for (const adopter of ["data-sort", "data-inst-sort"]) {
    assert.equal(effective(adopter, "min-height"), "44px", `${adopter}: effective min-height`);
    assert.equal(effective(adopter, "min-width"), "44px", `${adopter}: effective min-width`);
  }
});

test("the base .th-sort reset does not silently re-zero the target", () => {
  const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
  const sized = css.indexOf("th[data-sort] .th-sort,");
  const reset = css.indexOf(".th-sort {");
  assert.ok(sized > reset, "the 44px rule must come AFTER the padding:0 reset, or it loses the cascade");
});
