/* The forced-cut build's failure report (test/lib/cut-build.ts), pinned without
   running the build: a timeout and a build error read apart, with the cap and
   stderr's tail, and the cap stays bounded and above the slowest observed
   full publish build (22m 12s). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUT_BUILD_TIMEOUT_MS, cutBuildFailure } from "./lib/cut-build.ts";

test("cut build: the cap is bounded and above the slowest observed full build", () => {
  assert.ok(CUT_BUILD_TIMEOUT_MS > (22 * 60 + 12) * 1000, "above 22m 12s (run 39196495996's full build)");
  assert.ok(CUT_BUILD_TIMEOUT_MS <= 60 * 60 * 1000, "bounded: at most an hour of the post-build step's 90 minutes");
});

test("cut build: a timeout reads as a timeout, with the cap", () => {
  const msg = cutBuildFailure({ code: "ETIMEDOUT", signal: "SIGTERM", status: null, stderr: "" }, 1_800_400);
  assert.equal(msg, `forced-cut build timed out after 1800 s (the cap is ${CUT_BUILD_TIMEOUT_MS / 1000} s)`);
});

test("cut build: a timeout keeps stderr's last 20 lines too", () => {
  const stderr = Array.from({ length: 25 }, (_, i) => `t${i + 1}`).join("\n");
  const msg = cutBuildFailure({ code: "ETIMEDOUT", signal: "SIGTERM", status: null, stderr }, 1_800_000);
  assert.match(msg, /^forced-cut build timed out after 1800 s \(the cap is 1800 s\); stderr tail:\nt6\n/);
  assert.match(msg, /\nt25$/);
  assert.doesNotMatch(msg, /\nt5\n/);
});

test("cut build: a SIGTERM that is not the timeout reads as a failure with its signal, never as the cap", () => {
  // execFileSync sets code ETIMEDOUT only when its own timeout fired; a build killed by a
  // signal from elsewhere has signal SIGTERM and no such code
  const msg = cutBuildFailure({ signal: "SIGTERM", status: null, stderr: "killed\n" }, 400_000);
  assert.equal(msg, "forced-cut build failed after 400 s (exit ?, signal SIGTERM); stderr tail:\nkilled");
  assert.doesNotMatch(msg, /timed out|the cap/);
});

test("cut build: a build error reads as a failure, with its exit code and stderr's last 20 lines", () => {
  const stderr = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const msg = cutBuildFailure({ status: 1, signal: null, stderr: Buffer.from(stderr) }, 315_000);
  assert.match(msg, /^forced-cut build failed after 315 s \(exit 1\); stderr tail:\nline 6\n/);
  assert.match(msg, /line 25$/);
  assert.doesNotMatch(msg, /line 5\n/);
  assert.doesNotMatch(msg, /timed out/);
});

test("cut build: a signal is named, and an empty stderr adds no tail", () => {
  assert.equal(cutBuildFailure({ status: null, signal: "SIGKILL" }, 2_000), "forced-cut build failed after 2 s (exit ?, signal SIGKILL)");
});
