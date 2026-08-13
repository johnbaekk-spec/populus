/* Review r3-F1: lifecycle continuity must survive an ordinary publish.

   Two halves, both pinned here:
   (a) the BUILD boundary — under CI, a missing/unreadable/invalid prior
       artifact is fatal unless an explicit one-time bootstrap is declared;
   (b) the WORKFLOW wiring — the prior artifact is resolved from the DURABLE
       data-repo checkout (never a live-site fetch), and each build publishes
       its own artifact so the next one can chain. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WORKFLOW = readFileSync(
  path.join(process.cwd(), "..", ".github", "workflows", "publish.yml"),
  "utf-8",
);

test("r3-F1: the workflow resolves the prior artifact from populus-data, not the network", () => {
  assert.match(WORKFLOW, /populus-data\/builds\/\$\{prev\}\/signals\.v1\.json/);
  assert.match(WORKFLOW, /POPULUS_PRIOR_SIGNALS: \$\{\{ steps\.prior\.outputs\.path \}\}/);
  assert.match(WORKFLOW, /POPULUS_SIGNALS_BOOTSTRAP: \$\{\{ steps\.prior\.outputs\.bootstrap \}\}/);
  // The live-site fetch is GONE — a CDN blip must not reset lifecycle history.
  assert.doesNotMatch(
    WORKFLOW,
    /curl[^\n]*signals\.v1\.json/,
    "resolving the prior artifact over the network re-introduces r3-F1",
  );
});

test("r3-F1: a pointer whose build lacks the artifact FAILS without a declared bootstrap", () => {
  // The resolve step's control flow, asserted structurally: the else branch of
  // the artifact test must exit non-zero, not fall through to a cold start.
  const step = WORKFLOW.slice(WORKFLOW.indexOf("Resolve prior signal artifact"));
  assert.match(step, /BOOTSTRAP_INPUT:-\}" = "true"/);
  assert.match(step, /no bootstrap was declared/);
  assert.match(step.slice(0, step.indexOf("- name: Build site")), /exit 1/);
});

test("r3-F1: each build publishes its own artifact so the chain continues", () => {
  assert.match(WORKFLOW, /cp "\$src" "\$\{\{ steps\.stage\.outputs\.build_dir \}\}\/signals\.v1\.json"/);
  // …and it must be copied BEFORE finalize-build, whose walk hashes it.
  assert.ok(
    WORKFLOW.indexOf("Publish the signal artifact into the build") < WORKFLOW.indexOf("- name: Finalize build"),
    "the artifact must land in the build dir before the final manifest walk",
  );
});

test("r3-F1: the bootstrap input exists and is absent from the schedule trigger", () => {
  assert.match(WORKFLOW, /signals_bootstrap:/);
  const onBlock = WORKFLOW.slice(WORKFLOW.indexOf("on:"), WORKFLOW.indexOf("permissions:"));
  const scheduleBlock = onBlock.slice(onBlock.indexOf("schedule:"), onBlock.indexOf("workflow_dispatch:"));
  assert.doesNotMatch(scheduleBlock, /signals_bootstrap/, "a nightly can never cold-start the chain");
});

/* --- the build boundary (data.ts), exercised through the module --- */

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("r3-F1/F2: the prior-artifact contract at the build boundary", async () => {
  const { resolvePriorSignalArtifact } = await import("../src/lib/data.ts");
  const dir = mkdtempSync(path.join(tmpdir(), "prior-"));
  const missing = path.join(dir, "nope.json");
  const invalid = path.join(dir, "bad.json");
  writeFileSync(invalid, JSON.stringify({ v: 1, signals: [] }));

  // CI + no prior + no bootstrap → fatal (the r3-F1 case)
  await withEnv({ CI: "true", POPULUS_PRIOR_SIGNALS: undefined, POPULUS_SIGNALS_BOOTSTRAP: undefined }, async () => {
    assert.throws(() => resolvePriorSignalArtifact(), /must chain lifecycle state/);
  });
  // CI + explicit one-time bootstrap → allowed, and it is a DECLARED state
  await withEnv({ CI: "true", POPULUS_PRIOR_SIGNALS: undefined, POPULUS_SIGNALS_BOOTSTRAP: "1" }, async () => {
    assert.equal(resolvePriorSignalArtifact(), null);
  });
  // a set-but-missing path is fatal even under bootstrap — breakage never
  // impersonates a declared cold start
  await withEnv({ CI: "true", POPULUS_PRIOR_SIGNALS: missing, POPULUS_SIGNALS_BOOTSTRAP: "1" }, async () => {
    assert.throws(() => resolvePriorSignalArtifact(), /does not exist/);
  });
  // a structurally invalid prior is fatal (r3-F2)
  await withEnv({ CI: "true", POPULUS_PRIOR_SIGNALS: invalid, POPULUS_SIGNALS_BOOTSTRAP: undefined }, async () => {
    assert.throws(() => resolvePriorSignalArtifact(), /not a valid v1 signal artifact/);
  });
  // local dev (no CI): absent prior is a declared cold start, as with the
  // build-directory fallback in resolveSources
  await withEnv({ CI: undefined, POPULUS_PRIOR_SIGNALS: undefined, POPULUS_SIGNALS_BOOTSTRAP: undefined }, async () => {
    assert.equal(resolvePriorSignalArtifact(), null);
  });
});
