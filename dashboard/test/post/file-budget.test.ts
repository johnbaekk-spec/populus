/* Post-build suite, part 4 — RUN M2-8 T15 (plan R19): the file budget, MEASURED.

   This is the call site R19 was missing. `inst_budget.check_geometry` had NO
   build caller at all; its only invocation passed the maxima back in as the
   measurement (`check_geometry(MeasuredGeometry(512, 512, 64, 64, 8, 25 MiB))`),
   so every comparison was `value > value` and the gate could not fail in either
   direction — while the real `dist/` already stood 3,942 files above the term
   the formula budgeted for it. [[measure-the-mechanism]]

   It lives here, in `test:post`, because that is the only place a REAL tree
   exists: `npm run gates` is `check && test && build && test:post`, so this runs
   strictly after `astro build` and counts what would actually be deployed.

   The caps are read out of `src/populus/inst_budget.py` rather than restated, so
   there is one source of truth and a Python-side edit cannot silently diverge
   from the gate that enforces it. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import path from "node:path";

const DASH = path.resolve(import.meta.dirname, "..", "..");
const REPO_ROOT = path.resolve(DASH, "..");
const DIST = path.join(DASH, "dist");

/** Evaluate the trivial integer expressions inst_budget.py uses (`18_000`,
    `25 * 1024 * 1024`). Not a Python evaluator — a two-operator arithmetic
    reader that refuses anything else rather than guessing. */
function pyInt(source: string, name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, "m").exec(source);
  assert.ok(m, `${name} is defined in inst_budget.py`);
  const rhs = m![1]!.replace(/[_\s]/g, "");
  assert.match(rhs, /^[0-9*+]+$/, `${name} is a plain integer expression`);
  return rhs
    .split("+")
    .map((term) => term.split("*").reduce((a, b) => a * Number(b), 1))
    .reduce((a, b) => a + b, 0);
}

const BUDGET = readFileSync(
  path.join(REPO_ROOT, "src", "populus", "inst_budget.py"),
  "utf-8",
);
const GLOBAL_FILE_CAP = pyInt(BUDGET, "GLOBAL_FILE_CAP");
const PROVIDER_FILE_LIMIT = pyInt(BUDGET, "PROVIDER_FILE_LIMIT");
const MAX_SHARD_BYTES = pyInt(BUDGET, "MAX_SHARD_BYTES");

interface Measured {
  count: number;
  maxBytes: number;
  largest: string;
  byTopLevel: Map<string, number>;
}

/** Count every regular file, skipping symlinks — `digests.dist_digest` REFUSES a
    tree containing one, so counting it would disagree with the artifact contract
    about what the tree is. */
function measure(root: string): Measured {
  const out: Measured = { count: 0, maxBytes: 0, largest: "", byTopLevel: new Map() };
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (lstatSync(p).isSymbolicLink()) continue;
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!st.isFile()) continue;
      out.count++;
      const rel = path.relative(root, p);
      const top = rel.split(path.sep)[0]!;
      out.byTopLevel.set(top, (out.byTopLevel.get(top) ?? 0) + 1);
      if (st.size > out.maxBytes) {
        out.maxBytes = st.size;
        out.largest = rel;
      }
    }
  };
  walk(root);
  return out;
}

test("the budget gate reads its caps from inst_budget.py, not from a second copy", () => {
  assert.equal(GLOBAL_FILE_CAP, 18_000); // owner raise 2026-08-05, was 15_000
  assert.equal(PROVIDER_FILE_LIMIT, 20_000);
  assert.equal(MAX_SHARD_BYTES, 25 * 1024 * 1024);
  assert.ok(
    GLOBAL_FILE_CAP < PROVIDER_FILE_LIMIT,
    "the self-cap must sit below the provider limit",
  );
});

test("the measurement is not vacuous: the whole built tree is counted", () => {
  assert.ok(
    existsSync(path.join(DIST, "index.html")),
    "dist/ must exist — test:post runs after `astro build` (gates ordering)",
  );
  const measured = measure(DIST);
  // A control on the mechanism itself: a walker that silently returned early
  // would report a tiny, comfortably-passing count. The known-large trees must
  // be visible in the breakdown, including the top-level `tickers/` tree that
  // the original formula omitted entirely.
  assert.ok(measured.count > 10_000, `only ${measured.count} files counted`);
  assert.ok(
    (measured.byTopLevel.get("congress") ?? 0) > 5_000,
    `congress/ under-counted: ${measured.byTopLevel.get("congress")}`,
  );
  assert.ok(
    (measured.byTopLevel.get("tickers") ?? 0) > 1_000,
    "the top-level tickers/ tree is not being counted — this is the exact file " +
      "class the R19 formula omitted (3,884 files budgeted nowhere)",
  );
  assert.ok(measured.maxBytes > 0 && measured.largest.length > 0);
});

test("R19 GATE: the built tree fits under the 15,000-file self-cap", () => {
  const measured = measure(DIST);
  const breakdown = [...measured.byTopLevel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  assert.ok(
    measured.count <= GLOBAL_FILE_CAP,
    `dist/ holds ${measured.count} files, over the ${GLOBAL_FILE_CAP} self-cap ` +
      `(provider limit ${PROVIDER_FILE_LIMIT}). Breakdown: ${breakdown}. ` +
      `The build must fail rather than re-tune the cap (plan R19).`,
  );
});

test("R19 GATE: no single deployed file exceeds the 25 MiB provider limit", () => {
  const measured = measure(DIST);
  assert.ok(
    measured.maxBytes <= MAX_SHARD_BYTES,
    `${measured.largest} is ${measured.maxBytes} B, over the ${MAX_SHARD_BYTES} B ` +
      `per-file limit — Cloudflare rejects the file outright, so this must fail ` +
      `at build time rather than at deploy time`,
  );
});

test("the measured M1 footprint agrees with the constant the projection uses", () => {
  /* `M1_MEASURED_PAGES` is a MEASUREMENT recorded as a constant, and a
     measurement that drifts from what it measured is how the original 8,500
     ended up 3,942 files below reality. The tolerance is generous (the corpus
     grows between builds) but bounded: a whole file class appearing or
     disappearing moves it far more than this. */
  const declared = pyInt(BUDGET, "M1_MEASURED_PAGES");
  const measured = measure(DIST);
  const m1 =
    (measured.byTopLevel.get("congress") ?? 0) + (measured.byTopLevel.get("tickers") ?? 0);
  const drift = Math.abs(m1 - declared);
  assert.ok(
    drift <= 1_000,
    `inst_budget.M1_MEASURED_PAGES says ${declared} but the built tree holds ` +
      `${m1} M1 files (drift ${drift}). Re-measure and update the constant — a ` +
      `projection built on a stale measurement is the C5 defect.`,
  );
});

test("the projection's measured base covers the WHOLE tree, not just M1", () => {
  /* QA M2-8 R2 N1. `M1_MEASURED_PAGES` counts `congress/ + tickers/` only. The
     rest of a real build — `_astro/` bundles and the fixed top-level pages — is
     `SITE_CHROME_FILES`, and the forward projection summed the first and not the
     second, so the breach it reported was 103 files too small in the UNSAFE
     direction. That is the C5(a) defect ("it omits a whole file class")
     reproduced inside the fix for C5(a).

     `pyInt` asserts the constant is DEFINED, so deleting it fails here rather
     than silently reverting the projection to the four-term formula. The drift
     bound is the same generous-but-bounded 1,000 the M1 term uses: a whole file
     class appearing or disappearing moves it far more than that. */
  const base =
    pyInt(BUDGET, "M1_MEASURED_PAGES") + pyInt(BUDGET, "SITE_CHROME_FILES");
  const measured = measure(DIST);
  const drift = Math.abs(measured.count - base);
  const breakdown = [...measured.byTopLevel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  assert.ok(
    drift <= 1_000,
    `the projection's base (M1_MEASURED_PAGES + SITE_CHROME_FILES = ${base}) ` +
      `does not account for the built tree's ${measured.count} files ` +
      `(drift ${drift}). Breakdown: ${breakdown}. A file class the projection ` +
      `does not count is the C5 defect — re-measure both constants together.`,
  );
});
