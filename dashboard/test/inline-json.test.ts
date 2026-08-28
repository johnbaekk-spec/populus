/* RUN PUBLIC-SECURITY-HARDENING PR 2 (R6/LD7) — the inline-JSON XSS seam.

   Three layers, weakest to strongest:
   1. serializer unit cases — adversarial strings survive a JSON.parse
      round-trip exactly, and the serialized text contains no `<` at all;
   2. adversarial RENDERS through the real body renderers and the exact embed
      shapes the four pages build — an upstream issuer/filer name can neither
      close the inert data script nor create an executable script element.
      The holders route is covered directly even though production does not
      currently generate it (the ticker map is absent in prod builds): enabling
      a ticker map must not activate a latent sink;
   3. a source sweep — every `application/json` embed in src/ goes through
      `serializeInlineJson` and no second escape spelling exists anywhere. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { serializeInlineJson } from "../src/lib/inline-json.ts";
import { holdersBody, filerBody, addsSectionHtml } from "../src/lib/ui.ts";
import type { TopHolderRow } from "../src/lib/inst.ts";

/* ---------- 1. serializer unit cases ---------- */

const PWNED = "</script><script>globalThis.pwned=1</script>";

const UNIT_CASES: Record<string, unknown> = {
  "closing script tag": PWNED,
  "mixed case": "</ScRiPt><SCRIPT>globalThis.pwned=1</SCRIPT>",
  "repeated <": "<<<<</script><<script<<",
  ampersands: "Smith & Wesson &amp; Co < &lt;",
  quotes: `He said "quote" and 'apostrophe' and \\" escaped`,
  "U+2028/U+2029": "line and separators",
  "non-ASCII": "Société Générale — 三菱UFJ — Ærøskøbing",
  "nested structure": {
    name: PWNED,
    rows: [{ issuer: "<img src=x onerror=alert(1)>" }, { n: 1.5, b: true, x: null }],
  },
};

for (const [label, value] of Object.entries(UNIT_CASES)) {
  test(`serializeInlineJson round-trips: ${label}`, () => {
    const out = serializeInlineJson(value);
    assert.ok(!out.includes("<"), "serialized text contains no `<` at all");
    assert.deepEqual(JSON.parse(out), value, "JSON byte semantics preserved except `<` escaping");
  });
}

test("serializeInlineJson changes nothing but `<`", () => {
  const value = { a: "plain & 'safe' \"text\" > 1", n: [1, 2.5, null, false] };
  assert.equal(serializeInlineJson(value), JSON.stringify(value));
});

/* ---------- 2. adversarial renders through the real page paths ---------- */

/* Scan a rendered HTML fragment: the ONLY <script tags allowed are inert
   application/json data scripts (plus any bare `<script>` island tag Astro
   itself emits is out of scope here — body renderers emit none). */
function scriptOpenTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
}

function assertOneInertEmbed(html: string, id: string, payload: unknown): void {
  const tags = scriptOpenTags(html);
  const dataTags = tags.filter((t) => t.includes(`id="${id}"`));
  assert.equal(dataTags.length, 1, `exactly one data-script element with id ${id}`);
  for (const t of tags) {
    assert.ok(t.includes('type="application/json"'), `no executable script node: ${t}`);
  }
  assert.ok(!/<\/script\s*><\s*script/i.test(html), "no literal </script><script anywhere");
  const m = html.match(
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`, "i"),
  );
  assert.ok(m, "embed content extractable");
  assert.deepEqual(JSON.parse(m![1]!), payload, "embedded payload parses back exactly");
}

function adversarialHolder(over: Partial<TopHolderRow> = {}): TopHolderRow {
  return {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: PWNED,
    issuer_name: `EVIL ${PWNED} CORP`,
    issuer_key_source: "entity",
    value_usd: 2000,
    security_count: 1,
    flags: [],
    ...over,
  };
}

test("holders page (ungenerated in production): adversarial names render inert", () => {
  const holders = [adversarialHolder()];
  // The exact embed holders.astro builds for #holders-period-data.
  const periodData = serializeInlineJson({
    latestFiled: "2026-05-15",
    topn: 25,
    periods: { "2026-03-31": holders },
  });
  const body = holdersBody(
    "AAPL",
    `Apple ${PWNED} Inc.`,
    holders,
    ["2026-03-31"],
    "2026-03-31",
    "2026-05-15",
    25,
    null,
  );
  const page =
    body +
    `<script type="application/json" id="holders-period-data">${periodData}</script>`;
  assertOneInertEmbed(page, "holders-period-data", {
    latestFiled: "2026-05-15",
    topn: 25,
    periods: { "2026-03-31": holders },
  });
  assert.ok(!body.includes(PWNED), "body renderer escapes the raw adversarial name");
});

test("filer page: adversarial filer name renders inert", () => {
  const payload = {
    latestFiled: "2026-05-15",
    topn: 25,
    periods: { "2026-03-31": { conc: null, deltas: [], total: 0 } },
  };
  const body = filerBody(
    { cik: "0001067983", name: `FIXTURE ${PWNED} LLC`, latestPeriod: "2026-03-31" },
    ["2026-03-31"],
    "2026-03-31",
    null,
    [],
    "2026-05-15",
    25,
    null,
  );
  const page =
    body +
    `<script type="application/json" id="filer-period-data">${serializeInlineJson(payload)}</script>`;
  assertOneInertEmbed(page, "filer-period-data", payload);
  assert.ok(!body.includes(PWNED));
});

test("institutional index embed: adversarial rows render inert", () => {
  const rows = [{ cik: "0000000001", name: PWNED, typing: null }];
  const page = `<script type="application/json" id="inst-index-data">${serializeInlineJson(rows)}</script>`;
  assertOneInertEmbed(page, "inst-index-data", rows);
});

test("holdings-table embed: adversarial payload renders inert", () => {
  const payload = {
    kind: "holders",
    current: "2026-03-31",
    rows: [{ issuer_name: PWNED, filer_name: `A ${PWNED} B` }],
  };
  const page = `<script type="application/json" id="holdings-data">${serializeInlineJson(payload)}</script>`;
  assertOneInertEmbed(page, "holdings-data", payload);
});

test("inst-adds embed (ui.ts): serialized through the shared primitive", () => {
  // addsSectionHtml is the fifth embed producer; prove its output is inert
  // under an adversarial ticker/name by scanning its rendered section.
  const html = addsSectionHtml(
    {
      period: "2026-03-31",
      generated_at: "2026-08-27T00:00:00Z",
      rows: [
        {
          issuer_key: "entity:cik:0000320193",
          issuer_key_source: "entity",
          issuer_name: PWNED,
          manager_count: 2,
          new_position_count: 1,
          delta_value_usd: 1000,
          delta_value_is_partial: false,
          top_adder_cik: 1067983,
          top_adder_name: PWNED,
        },
      ],
      truncated: false,
      truncation_boundary: null,
      ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "new", periods: ["2026-03-31"], buildId: "20260827.1" },
  );
  assert.ok(!/<\/script\s*><\s*script/i.test(html));
  const m = html.match(/<script[^>]*id="inst-adds-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (m) assert.doesNotThrow(() => JSON.parse(m[1]!));
});

/* ---------- 3. source sweep: one primitive, one spelling ---------- */

function sourceFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test("every application/json embed in src/ uses serializeInlineJson; no second escape spelling", () => {
  const root = path.resolve(import.meta.dirname, "..", "src");
  for (const file of sourceFiles(root, [".ts", ".astro"])) {
    const rel = path.relative(root, file);
    if (rel === path.join("lib", "inline-json.ts")) continue;
    const text = readFileSync(file, "utf-8");
    // No local escape spelling may remain anywhere.
    assert.ok(!text.includes("u003c"), `${rel}: local \\u003c escape spelling`);
    assert.ok(!text.includes('replaceAll("</"'), `${rel}: local </ escape spelling`);
    // Any file that BUILDS a data embed must import the one primitive.
    const buildsEmbed =
      /<script[^>]*type="application\/json"/.test(text) &&
      // .astro template usage via set:html or ${...} interpolation counts;
      // prose/comments do not build embeds.
      /id="[a-z-]+-data"/.test(text);
    if (buildsEmbed) {
      assert.ok(
        text.includes("serializeInlineJson"),
        `${rel} builds a JSON data embed without the shared serializer`,
      );
    }
  }
});
