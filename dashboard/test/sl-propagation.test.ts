/* RUN SURFACES-LEGIBILITY — T13, the propagation audit.

   T13 is deliberately NOT a landing phase. Per LD6 every assertion this run
   invalidated was edited in the SAME commit as the change that invalidated it,
   so this task should change nothing. Written as a test rather than performed
   once, because "we checked" decays and a test does not: it re-runs on every
   commit and it fails when the tree drifts out of its own manifest.

   It asserts three properties.

   1. TRACEABILITY. Every test file the assertion-consumer sweep hits is one
      this run edited, one the plan's manifest names, or one on a declared
      carve-out list — never an unaccounted hit. A hit outside all three is a
      scope error, and the correct response is to STOP and escalate, not to add
      the file to the list.

   2. RETARGETED, NEVER WIDENED. Every test file this run edited carries a
      comment naming this run, so an edit cannot be an anonymous loosening.

   3. NOTHING RETIRED WITHOUT A STRONGER REPLACEMENT — specifically LD8's
      substitution for `css-fold.test.ts`'s never-fold assertion. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const TEST_DIR = path.resolve(import.meta.dirname);
const PLAN = readFileSync(
  path.resolve(TEST_DIR, "..", "..", "docs", "build", "RUN-SURFACES-LEGIBILITY-plan.md"),
  "utf8",
);

/** Every `*.test.ts` / `*.spec.ts` under `dashboard/test`, recursively. */
function allTestFiles(dir = TEST_DIR, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...allTestFiles(path.join(dir, e.name), rel));
    else if (/\.(test|spec)\.ts$/.test(e.name) || rel.startsWith("lib/")) out.push(rel);
  }
  return out.sort();
}

/* The sweep's two token sets, kept separate because round 2 found the first one
   insufficient on its own: it greps MARKUP this run changes but not the
   FUNCTION NAMES whose signatures change, so a consumer that calls a changed
   renderer without asserting any of its markup was invisible to it. */
const MARKUP_TOKENS =
  /col-why|title=|terminusRow|syncTerminusFor|caveat-line|section-note|rankingCaveatHtml|panel-note|explainer|mgr-chips|position_key|inst-data-note|note-clause/;
const SIGNATURE_TOKENS =
  /statTiles|flowRibbon|entityTxnTable|compactDisclosure|colWhyHtml|feedHeadHtml|rankingHeadHtml|addsHeadHtml|footnoteBlock|memberSignalsPanel|filerTiles|memberStatTiles|initFeed|rankingWindowHtml|institutionalDataNoteHtml/;

/** Files this run edited or created, read from the plan's own manifest plus the
    two lists below. Kept as data so a drift shows up as a diff, not a guess. */
const MANIFEST = new Set(
  [...PLAN.matchAll(/^- `(dashboard\/test\/[^`]+)`$/gm)].map((m) => m[1]!.replace(/^dashboard\/test\//, "")),
);

/* Files this run edited that the plan's manifest did not name. Each is here
   with the reason it was touched — an entry with no reason is exactly the
   untraceable edit T13 exists to catch. */
const ADDED_AT_IMPLEMENTATION: Record<string, string> = {
  "sl-notes.test.ts": "new, named in Planned Files",
  "sl-surfaces.test.ts": "new, named in Planned Files",
  "sl-member.test.ts": "new (T10) — the plan named no test file for the member page",
  "sl-filer.test.ts": "new (T11) — the plan named no test file for the filer page",
  "sl-propagation.test.ts": "new (T13) — this file",
  "holders-browser/holders.spec.ts":
    "code-review F4: the holders period-swap note test. The geometry lane builds no holders route, so this is the only served build where it exists.",
  "lib/fake-dom.ts":
    "code-review F3: `hasAttribute` and an optional selector map, so a test can drive the real listeners an island binds through `document.querySelectorAll`.",
};

/* Consumers of `position_key` ONLY. `position_key` is R21's field, and R21 left
   this run — so these assert a DATA shape this run does not touch, not markup
   it changes. The plan's carve-out note named two of them; measured, there are
   nine. Recorded rather than rounded off: this plan's inventories have been
   wrong eight times, and a carve-out list is an inventory. */
const R21_CARVE_OUT = new Set([
  "derive.test.ts",
  "filer-payload.test.ts",
  "fixtures/institutional.ts",
  "inst-changes-bound.test.ts",
  "inst-loader-coercion.test.ts",
  "inst.test.ts",
  "post/entity-orchestration.test.ts",
  "r10-renderer-regression.test.ts",
  "r20-r22-institutional.test.ts",
]);

/* Sweep hits this run deliberately left alone, each with the reason it needed
   no edit. "Verified unchanged" is a claim, so it is written down and checked. */
const VERIFIED_UNCHANGED: Record<string, string> = {
  "signals.test.ts":
    "calls `memberSignalsPanel`, whose rule moved from an inline block into a note (T10). It asserts the RULE TEXT, not the wrapper — LD6's rule, already satisfied — so it needed no edit and still guards the property.",
  "r17-single-fetch.test.ts":
    "greps `congress-sections.ts` for forbidden fetch/decode calls (Constraint 6). R29 added a callback to `initFeed`, not a fetch owner.",
  "client-wiring.test.ts": "drives `initFeed` over the fake DOM; R29's added callback is optional and unset there.",
  "activity.test.ts": "asserts activity row markup that R7/R8e changed — retargeted when T3 landed, unchanged since.",
  "inst-index-client.test.ts": "asserts island wiring R9 changed — retargeted when T5 landed.",
  "a5-table-css.test.ts": "asserts table CSS this run did not alter.",
  "geometry/layout.spec.ts": "the pre-existing geometry sweep; its R6 scroll-cue failures are identical on the pristine baseline.",
  "post/fixture-preview.test.ts": "built-output assertions; run in the `test:post` lane, unchanged by this run.",
  "lib/mini-dom.ts": "a DOM double; mentions `initFeed` only in its header comment.",
};

test("T13: every sweep hit is accounted for — manifest, this run's edits, or a declared carve-out", () => {
  /* The manifest is parsed out of the plan document, so a plan that stops
     listing its consumers must not silently turn this test into a formality
     that passes on an empty set. Round 3 caught the same shape of defect in a
     doc-drift check that matched an unrelated line. */
  assert.ok(MANIFEST.size >= 15, `the plan's test manifest parsed to ${MANIFEST.size} entries — it names ~19`);
  const unaccounted: string[] = [];
  for (const rel of allTestFiles()) {
    const src = readFileSync(path.join(TEST_DIR, rel), "utf8");
    if (!MARKUP_TOKENS.test(src) && !SIGNATURE_TOKENS.test(src)) continue;
    if (MANIFEST.has(rel)) continue;
    if (rel in ADDED_AT_IMPLEMENTATION) continue;
    if (R21_CARVE_OUT.has(rel)) continue;
    if (rel in VERIFIED_UNCHANGED) continue;
    unaccounted.push(rel);
  }
  assert.deepEqual(
    unaccounted,
    [],
    "a sweep hit outside every list is a SCOPE ERROR: stop and escalate, do not add it to a list to make this pass",
  );
});

test("T13: the R21 carve-out really is `position_key` only — no markup token hides in it", () => {
  /* The carve-out's whole justification is that these files assert a DATA shape
     R21 deferred, not markup this run changed. If one of them ever also matches
     a markup token, the justification has silently stopped applying — which is
     how a carve-out turns into a blind spot. */
  for (const rel of R21_CARVE_OUT) {
    const src = readFileSync(path.join(TEST_DIR, rel), "utf8");
    const markup = [...src.matchAll(new RegExp(MARKUP_TOKENS.source, "g"))].map((m) => m[0]);
    const nonKey = [...new Set(markup)].filter((t) => t !== "position_key");
    assert.deepEqual(nonKey, [], `${rel} is carved out for \`position_key\`, but also asserts: ${nonKey.join(", ")}`);
  }
});

test("T13: every file this run edited names this run — an edit is never anonymous", () => {
  /* LD6: retargeted, never widened. A widened regex looks exactly like a
     retargeted one in a diff a year later; a comment naming the plan and the
     requirement is what distinguishes them. Every file this run touched carries
     one, so a future reader can tell which assertions moved and why. */
  for (const rel of Object.keys(ADDED_AT_IMPLEMENTATION)) {
    const src = readFileSync(path.join(TEST_DIR, rel), "utf8");
    assert.ok(
      /RUN SURFACES-LEGIBILITY|SL-R\d|CODE-REVIEW F\d/.test(src),
      `${rel} was edited by this run but names neither the run nor a requirement`,
    );
  }
  for (const rel of ["c4-rankings.test.ts", "r-codex-regressions.test.ts", "r12-congress-behaviour.test.ts",
                     "r19-collapsed-honesty.test.ts", "css-fold.test.ts", "format.test.ts",
                     "pages-render.test.ts", "ui.test.ts", "holdings.test.ts", "c3-member-v2.test.ts"]) {
    const src = readFileSync(path.join(TEST_DIR, rel), "utf8");
    assert.ok(
      /RUN SURFACES-LEGIBILITY|SL-R\d|CODE-REVIEW F\d/.test(src),
      `${rel} carries a retargeted assertion that does not name the requirement that moved it`,
    );
  }
});

test("T13/LD8: the retired never-fold assertion has a strictly STRONGER replacement, not merely a different one", () => {
  const fold = readFileSync(path.join(TEST_DIR, "css-fold.test.ts"), "utf8");
  /* The old assertion could not have caught the change it guarded: `droppedAt`
     reads project CSS rules, and a collapsed `<details>` is hidden by the user
     agent's own default — so it would have stayed green while all six clauses
     were hidden at every width. Its replacement tests REACHABILITY, which the
     old one never did. */
  assert.match(
    fold,
    /RETIRED AND REPLACED — RUN SURFACES-LEGIBILITY, SL-R15 \/ LD8/,
    "the retirement is recorded at the site, naming the decision that made it",
  );
  /* The old wording survives ONLY inside that record — quoted, so a reader can
     see what was retired. It must not survive as a live assertion: an
     assertion and a quotation of one look identical to a grep, which is why
     this checks the CODE with comments stripped rather than the file. */
  const code = fold.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/the §5 data_note loses content/.test(code),
    "the retired assertion is a quotation in the record, never a live guard",
  );
  // the four properties LD8 point 3 requires of the replacement
  assert.match(fold, /caveat-box-summary/, "the summary is swept for folding");
  assert.match(fold, /data-note-clause|INSTITUTIONAL_DATA_NOTE_CLAUSES/, "all six clauses are asserted present");
  assert.match(fold, /open/, "print forces the box open");
});
