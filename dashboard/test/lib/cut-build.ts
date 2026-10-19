/* The forced-cut build that `test/post/entity-orchestration.test.ts` runs in
   its `before` hook: its timeout, and how a failure is reported. Kept apart
   from that file so a unit test can pin the report without registering the
   build hook.

   The build renders the full institutional corpus. Measured on data build
   20261019.2, unloaded, on the owner machine: 12m 18s (signals-v4 M2) and
   12m 5s (M3). Publish's full builds on the self-hosted runner, which shares
   that machine, took 12m 51s to 22m 12s (runs 39122715131, 39196495996 and
   39216202838). The old 900 s cap left about 20% headroom over an unloaded
   build, and on run 39216202838 all 28 tests behind the hook failed. Keep the
   timeout bounded, but above the slowest observed full build. */
export const CUT_BUILD_TIMEOUT_MS = 1_800_000;

/** What `execFileSync` throws. */
export interface CutBuildError {
  code?: string;
  signal?: string | null;
  status?: number | null;
  stderr?: Buffer | string;
}

/** Why the forced-cut build failed: a timeout or a build error, told apart
    (both used to read as a bare "Command failed"), with stderr's tail. */
export function cutBuildFailure(e: CutBuildError, elapsedMs: number): string {
  const secs = Math.round(elapsedMs / 1000);
  const tail = String(e.stderr ?? "").trim().split("\n").slice(-20).join("\n");
  const why =
    e.code === "ETIMEDOUT"
      ? `timed out after ${secs} s (the cap is ${CUT_BUILD_TIMEOUT_MS / 1000} s)`
      : `failed after ${secs} s (exit ${e.status ?? "?"}${e.signal ? `, signal ${e.signal}` : ""})`;
  return `forced-cut build ${why}${tail ? `; stderr tail:\n${tail}` : ""}`;
}
