/* The /signals composition (Signals.dc.html): rule book, hits, lag, rates,
   watchlist — every number from the artifact and the page's own rows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signalsBody } from "../src/lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../src/lib/signals.ts";
import { scanBannedWording } from "../src/lib/activity.ts";

function sig(over: Partial<Signal> & { kind: Signal["kind"] }): Signal {
  return {
    id: `${over.kind}:${Math.random().toString(16).slice(2)}`,
    rule: "rule text",
    thresholdVersion: "1.0.0",
    entities: { bioguide: "A000001", memberName: "Test <Member>", ticker: "ABC" },
    magnitude: { low: 250001, high: 500000 },
    receipts: ["https://efdsearch.senate.gov/x"],
    occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-01" },
    sourceAvailableAt: "2026-06-01",
    computedAt: "2026-08-02 07:27 UTC",
    firstSeenBuild: "b",
    lastSeenBuild: "b",
    status: "active",
    cohort: "senate",
    ...over,
  };
}
const ART: SignalArtifact = {
  v: 1, buildId: "b", computedAt: "2026-08-02 07:27 UTC", thresholdVersion: "1.0.0", retentionDays: 90,
  coverageFrom: "2026-05-04", coverageTo: "2026-08-02", lifecycleNote: "cold start", compaction: "none",
  dateAnomaliesExcluded: 3, lagCaveat: "PTRs are filed up to 45 days after the trade", withheld: [
    { kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee data absent" },
  ],
  signals: [
    sig({ kind: "s1-large" }),
    sig({ kind: "s6-late-large", occurrence: { tradeDate: "2026-01-01", filedDate: "2026-06-01" } }),
    sig({ kind: "s2-first", magnitude: { low: 1001, high: 15000 } }),
    sig({ kind: "s1-large", status: "superseded", supersededInBuild: "c" }),
  ],
};
const CTX = { watched: new Set<string>() };

test("rule book lists every kind with its exact rule, active hit counts and the withheld kinds by reason", () => {
  const html = signalsBody(ART, CTX);
  for (const k of ["LARGE", "INFREQUENT", "CO-OCCURRENCE", "FIRST FILING", "COMMITTEE", "LATE", "RETURN"]) assert.match(html, new RegExp(`si-kind">${k}<`), k);
  assert.match(html, /<td class="c-num si-hits">1<\/td>/, "S-1 counts ONE active — the tombstone is history");
  assert.match(html, /<td class="c-num si-hits c-muted">0<\/td>/, "a zero is printed, never blank");
  assert.match(html, /si-status-withheld">WITHHELD/);
  assert.match(html, /BY DESIGN/);
  assert.match(html, /Superseded in build/);
});

test("hits carry evidence, source regime, magnitude range, both dates, lag and receipt; the render bound is stated", () => {
  const html = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null, renderCap: 2 });
  assert.match(html, /Test &lt;Member&gt;/);
  assert.match(html, /\$250K–\$500K/);
  assert.match(html, /datetime="2026-01-01"/);
  assert.match(html, /\+151d/);
  assert.match(html, /si-stamp">eFD/);
  assert.match(html, /1 further hits are in the artifact but not rendered here/);
  assert.match(html, /data-family="COMPLIANCE"/);
});

test("hit rate is per 1,000 rows filed in the window and withheld without a denominator", () => {
  const withRate = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  assert.match(withRate, /1\.0 ‰/, "one hit per family over 1,000 rows");
  const noRate = signalsBody(ART, CTX);
  assert.match(noRate, /evaluated-row count is not available, so no rate is stated/);
});

test("lag distribution groups identical (member, lag) rows and marks the 45-day line", () => {
  const row = { name: "Bulk Filer", bioguide: "B1", party: "D", traded: "2026-01-01", filed: "2026-05-01", lag: 120, late: 1 };
  const html = signalsBody(ART, CTX, { rowsEvaluated: 10, latestBatch: [row, row, { ...row, lag: 5, late: 0 }], latestBatchFiled: "2026-05-01" });
  assert.match(html, /×2/);
  assert.match(html, /si-late">\+120d/);
  assert.match(html, /si-bar-tick/);
  assert.match(html, /LATEST BATCH FILED 2026-05-01/);
});

test("the watch band embeds a </script>-safe payload and the whole page passes the wording scan", () => {
  const html = signalsBody({ ...ART, signals: [sig({ kind: "s1-large", entities: { bioguide: null, memberName: "</script><b>x", ticker: null } })] }, CTX);
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.match(html, /id="signal-watch-data"/);
  assert.deepEqual(scanBannedWording(signalsBody(ART, CTX, { rowsEvaluated: 100, latestBatch: [], latestBatchFiled: null })), []);
});

test("a withheld LATE kind renders as unevaluated in the compliance summary, never as a computed zero", () => {
  const withheld: SignalArtifact = { ...ART, signals: ART.signals.filter((s) => s.kind !== "s6-late-large"), withheld: [...ART.withheld, { kind: "s6-late-large", reason: "volume-out-of-bounds", detail: "measured volume outside its declared bounds" }] };
  const html = signalsBody(withheld, CTX);
  assert.match(html, /LATE rule was withheld this build/);
  assert.match(html, /volume-out-of-bounds/);
  assert.doesNotMatch(html, /No late-and-large disclosures in the window/);
  assert.doesNotMatch(html, /Zero hits is the computed answer for the LATE rule/);
  // the non-withheld artifact with zero LATE hits still states the computed zero
  const zero = signalsBody({ ...ART, signals: ART.signals.filter((s) => s.kind !== "s6-late-large") }, CTX);
  assert.match(zero, /No late-and-large disclosures in the window/);
});
