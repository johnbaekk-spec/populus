/* RUN SURFACES-LEGIBILITY — T14, the authoritative-document reconciliation.

   The failure this guards is two authoritative instructions for the same
   renderer. Round 2 found the design rationale still saying "one note on the
   Kind header" after R20 had changed to a per-row note, in a file that is
   itself a planned target — so an implementer following the owner-approved
   source would have built the wrong thing and been right to.

   The check has TWO halves, deliberately. A negative grep alone proves only
   that some wording is absent, which a deletion satisfies as well as a
   correction does. Each retired phrase is therefore paired with a POSITIVE
   assertion at its known anchor, so the gate proves the corrected wording is
   present rather than merely that the old wording is gone.

   Exact phrases, never bare words: round 3 caught an earlier form matching
   `BACKLOG.md`'s unrelated "all seven cached". A check that stops on a correct
   document, or pressures an implementer into editing unrelated prose, is worse
   than no check at all. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const RATIONALE = "docs/design/SURFACES-LEGIBILITY-PLAN.md";
const PREVIEW = "docs/design/handoff/Surfaces Legibility.dc.html";
const BACKLOG = "BACKLOG.md";
const OWNER_APPROVED = [RATIONALE, PREVIEW, BACKLOG];

test("T14: no retired instruction survives in ANY owner-approved document", () => {
  const RETIRED = [
    "one note on the Kind header",
    "3 exclusions",
    "seven standalone terminus",
    "seven with no adjacent",
    "union of the previous and current",
  ];
  const findings: string[] = [];
  for (const rel of OWNER_APPROVED) {
    const src = read(rel);
    for (const phrase of RETIRED) {
      if (src.includes(phrase)) findings.push(`${rel} still says "${phrase}"`);
    }
  }
  assert.deepEqual(findings, [], "an owner-approved document may not carry an instruction this run reversed");
});

test("T14: each reversal is stated POSITIVELY at its own anchor — corrected, not merely deleted", () => {
  const rationale = read(RATIONALE);
  const preview = read(PREVIEW);

  // R20 — the Kind CELL, keyed on Signal.id, and the reason a header cannot serve.
  assert.match(rationale, /a note on \*\*each row's Kind cell\*\*, keyed on \*\*`Signal\.id`\*\*/);
  assert.match(rationale, /never the kind/i, "…and the rationale for it is stated, not just the rule");

  // LD4 — the SUMMED ROW total is the visible anchor.
  assert.match(rationale, /1,696 rows excluded/, "the summed-total suffix is the documented form");
  assert.match(rationale, /sum of the clause counts/i);

  // LD8 — the summary carries the load-bearing CLAIM, and the guard is replaced.
  assert.match(rationale, /the summary carries the CLAIM/i);
  assert.match(rationale, /deleted and replaced in the same commit/i);

  // R22 — the pointer is KEPT and the box is not relocated.
  assert.match(rationale, /keeps its\s*\n?\s*`href="#inst-data-note"` pointer|\*\*kept, not replaced\*\*/);

  /* R10 — RETARGETED in the commit that unblocked it. It was blocked twice and
     then implemented by fixing its root cause: the rationale must now record
     that resolution positively, keep the corrected inventory (13, not 12; the
     eight standalone sites retained), and state that the deletion followed the
     fix rather than preceding it. A document that still said BLOCKED would be
     the drift this test exists to catch. */
  assert.match(rationale, /\*\*IMPLEMENTED 2026-08-24, after the root cause was fixed\*\*/);
  assert.match(rationale, /\*\*13\*\* production call sites, not\n?12/);
  assert.match(rationale, /Those\s*\n?eight are untouched/i, "the eight standalone sites are kept, by name");
  assert.match(
    rationale,
    /the bound stopped depending on a script at all/i,
    "…and the reason the deletion became honest is stated, not just the deletion",
  );
  assert.ok(
    !/All \*\*13\*\* terminus rows stay/.test(rationale),
    "the superseded conclusion may not survive beside its replacement",
  );

  // R13 — an indicator, and no queue, on either settled outcome.
  assert.match(rationale, /an indicator, and NO queue/i);
  assert.match(rationale, /onSettled/, "the failure path is named, not implied");

  // R8 — the three-class partition over a measured 32, not five.
  assert.match(rationale, /THIRTY-TWO places, not five/i);
  for (const cls of [/Class A — 5, deleted/, /Class B — 10, converted/, /Class C — 17, unchanged/]) {
    assert.match(rationale, cls, "each class states its exact count");
  }

  // T0 — fetch, never pull, in the SEQUENCING step an implementer actually follows.
  const seq = rationale.slice(rationale.indexOf("## 13 · Sequencing"));
  assert.match(seq, /\*\*Fetch, never pull\*\*/, "the sequencing step must not instruct `git pull`");
  assert.ok(!/^\s*1\.\s*Pull `origin\/main`/m.test(seq), "the retired `Pull origin/main` step is gone");

  // The preview carries its own correction banner rather than being silently redrawn.
  assert.match(preview, /Reconciled against implementation, 2026-08-24/);
  assert.match(preview, /The five terminus rows were deleted only after the control learned/);
  assert.match(preview, /position-changes issuer names are NOT resolved/);
  assert.match(preview, /There is no pending queue/);
});

test("T14: every reference to the DEFERRED identity work is gone from the rationale's build instructions", () => {
  /* R21 left this run. What must not survive is an *instruction* to build it —
     naming it as deferred, with a pointer to where its record lives, is the
     opposite of drift and is required. */
  const rationale = read(RATIONALE);
  assert.match(rationale, /DEFERRED, NOT FIXED HERE/, "the section states the deferral in its own heading");
  assert.match(rationale, /RUN-FILER-IDENTITY-notes\.md/, "…and points at where the measured record lives");
  assert.ok(
    !/The join must run over/.test(rationale),
    "no build instruction for the deferred join survives",
  );
  assert.ok(
    !/it must carry the\nresolved name too/.test(rationale),
    "nor its payload-parity instruction",
  );
});

test("T14: `BACKLOG.md` needs no edit, and that is CHECKED rather than assumed", () => {
  /* The plan named BACKLOG.md as a reconciliation target. Measured: it carries
     no reference to this run, to R21, or to any decision this review changed —
     so there is nothing to reconcile. Asserted rather than skipped, because
     "nothing to do" and "nobody looked" are indistinguishable in a report. */
  const backlog = read(BACKLOG);
  for (const token of ["SURFACES-LEGIBILITY", "position_key", "terminusRow", "col-why"]) {
    assert.ok(!backlog.includes(token), `BACKLOG.md unexpectedly references ${token} — reconcile it`);
  }
});
