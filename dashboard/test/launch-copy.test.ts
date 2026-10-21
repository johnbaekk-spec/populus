/* launch M2 (R29, R37, LD32): the copy ledger — every one of the copy audit's
   120 items carries its page, its owning milestone (LD3), a disposition from
   the closed set and, for anything not applied as proposed, a reason code
   from the closed set. An honesty-pin reason names a test file that exists;
   an owner-decision reason names one of D1–D7. The home's entries are final
   (M2) and checked against the rendered home: each shipped pattern is in the
   home's text (tips included) and each replaced text is gone.

   The audit itself (docs/design/launch-redesign-mock/data/copy_audit.json)
   is an untracked spec record, so the ledger is self-contained and the id
   set is pinned here by prefix and count. Later milestones finalize their own
   entries; M8 removes the pending allowance (no pending entry after M8). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BANNED_PATTERNS } from "./lib/banned-scan.ts";
import {
  congressTileHtml,
  homeFigures,
  homeHeroCopyHtml,
  homeLeadHtml,
  homeLedgerHtml,
  homeSectionsHtml,
  homeTrustHtml,
  homeTryChips,
  movesTileHtml,
} from "../src/lib/ui/home.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.resolve(import.meta.dirname, "fixtures", "launch-copy-ledger.json");

interface Rest {
  milestone: string;
  disposition: string;
  reason?: string;
  what: string;
}
interface Entry {
  id: string;
  page: string;
  path: string;
  milestone: string;
  disposition: string;
  shipped: string | null;
  replaced: string | null;
  reason: string | null;
  note: string | null;
  rest?: Rest;
}
interface Ledger {
  v: number;
  dispositions: string[];
  reasonCodes: string[];
  items: Entry[];
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf-8")) as Ledger;

/** The audit's id set: prefix → item count (120 in all). */
const ID_COUNTS: Readonly<Record<string, number>> = {
  home: 10, global: 3, congress: 27, member: 21, signals: 18, ticker: 13,
  inst: 9, filer: 11, holders: 2, stub: 2, meth: 4,
};
const DISPOSITIONS = ["applied", "applied-by-163", "adapted", "not-applied", "pending"] as const;
const MILESTONES = ["M2", "M3a", "M3b", "M4b", "M5", "M6", "M7a", "M7b"] as const;
/** M8 flips this to false: the ledger closes with no pending entry. */
const PENDING_ALLOWED = true;

/** LD3: the milestone that owns an item's copy. */
function owner(id: string): string {
  const [kind, num] = [id.slice(0, id.lastIndexOf("-")), Number(id.slice(id.lastIndexOf("-") + 1))];
  if (kind === "home") return "M2";
  if (kind === "congress") return num >= 23 && num <= 27 ? "M3a" : "M3b";
  if (kind === "stub") return "M3b";
  if (kind === "member") return "M4b";
  if (kind === "signals") return num === 16 ? "M5" : num === 14 ? "M7b" : "M7a";
  if (kind === "inst" || kind === "holders" || kind === "meth") return "M7b";
  if (kind === "ticker") return num <= 8 ? "M6" : "M7b";
  if (kind === "filer" || kind === "global") return "M6";
  throw new Error(`no owner for ${id}`);
}

/** A reason code from LD32's closed set, checked against the tree: the
    reason's argument must name something that exists. */
function reasonProblem(reason: string): string | null {
  const m = /^([a-z-]+):(.+)$/.exec(reason);
  if (!m) return `"${reason}" is not code:argument`;
  const [, code, arg] = m as unknown as [string, string, string];
  switch (code) {
    case "honesty-pin":
      return /^dashboard\/test\/.+\.test\.ts$/.test(arg) && existsSync(path.join(REPO, arg)) ? null : `honesty-pin names no existing test file: ${arg}`;
    case "wording-ban":
      return BANNED_PATTERNS.some((p) => p.name === arg) ? null : `wording-ban names no banned pattern: ${arg}`;
    case "owner-decision":
      return /^D[1-7]$/.test(arg) ? null : `owner-decision names no D1–D7: ${arg}`;
    case "data-output": {
      const file = arg.split(":")[0]!;
      return existsSync(path.join(REPO, file)) ? null : `data-output names no existing file: ${arg}`;
    }
    case "superseded-by-layout":
      return (MILESTONES as readonly string[]).includes(arg) ? null : `superseded-by-layout names no milestone: ${arg}`;
    case "not-present":
      return /^[0-9a-f]{7,40}$/.test(arg) ? null : `not-present names no commit: ${arg}`;
    default:
      return `unknown reason code ${code}`;
  }
}

test("launch-copy: the ledger lists exactly the audit's 120 ids, once each, with page and path", () => {
  const ids = ledger.items.map((e) => e.id);
  assert.equal(ids.length, 120);
  assert.equal(new Set(ids).size, 120, "no id twice");
  const expected = Object.entries(ID_COUNTS).flatMap(([k, n]) => Array.from({ length: n }, (_, i) => `${k}-${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual([...ids].sort(), [...expected].sort());
  for (const e of ledger.items) {
    assert.ok(e.page.length > 0 && e.path.length > 0, `${e.id}: page and path`);
  }
  assert.deepEqual(ledger.dispositions, [...DISPOSITIONS]);
});

test("launch-copy: every entry's milestone is its LD3 owner; dispositions and reasons come from the closed sets", () => {
  for (const e of ledger.items) {
    assert.equal(e.milestone, owner(e.id), `${e.id}: owned by ${owner(e.id)} (LD3)`);
    assert.ok((DISPOSITIONS as readonly string[]).includes(e.disposition), `${e.id}: disposition ${e.disposition}`);
    if (e.disposition === "adapted" || e.disposition === "not-applied") {
      assert.ok(e.reason, `${e.id}: ${e.disposition} needs a reason code`);
      assert.equal(reasonProblem(e.reason!), null, `${e.id}: ${reasonProblem(e.reason!)}`);
    } else {
      assert.equal(e.reason, null, `${e.id}: only adapted and not-applied carry a reason`);
    }
    if (e.disposition === "pending") {
      assert.ok(PENDING_ALLOWED, `${e.id}: no pending entry after M8`);
      assert.notEqual(e.milestone, "M2", `${e.id}: M2's own entries are final`);
    } else {
      assert.ok(e.note && e.note.length > 0, `${e.id}: a final entry says what shipped`);
    }
    if (e.rest) {
      assert.equal(e.disposition, "applied-by-163", `${e.id}: only a #163 entry carries a remainder`);
      assert.ok((MILESTONES as readonly string[]).includes(e.rest.milestone), `${e.id}: the remainder's milestone`);
      assert.ok(["pending", "not-applied", "applied", "adapted"].includes(e.rest.disposition), `${e.id}: the remainder's disposition`);
      if (e.rest.disposition === "not-applied" || e.rest.disposition === "adapted") assert.equal(reasonProblem(e.rest.reason ?? ""), null, `${e.id}: the remainder's reason`);
      assert.ok(e.rest.what.length > 0);
    }
  }
});

test("launch-copy: the #163 items and the owner-decided items carry their recorded dispositions (LD32)", () => {
  const by = new Map(ledger.items.map((e) => [e.id, e]));
  for (const id of ["signals-17", "meth-04", "meth-02", "member-02", "ticker-03", "inst-03", "holders-02"]) {
    assert.equal(by.get(id)!.disposition, "applied-by-163", id);
  }
  assert.equal(by.get("holders-02")!.rest?.reason, "owner-decision:D7", "the footer half of holders-02 stays (D7)");
  assert.equal(by.get("global-03")!.disposition, "not-applied");
  assert.equal(by.get("global-03")!.reason, "owner-decision:D7");
  // every home item is final in M2
  for (let i = 1; i <= 10; i++) assert.notEqual(by.get(`home-${String(i).padStart(2, "0")}`)!.disposition, "pending");
});

test("launch-copy: the reason checker refuses what LD32's closed set refuses (controls)", () => {
  assert.equal(reasonProblem("honesty-pin:dashboard/test/activity.test.ts"), null);
  assert.match(reasonProblem("honesty-pin:dashboard/test/no-such.test.ts")!, /no existing test file/);
  assert.equal(reasonProblem("wording-ban:sold"), null);
  assert.match(reasonProblem("wording-ban:selling")!, /no banned pattern/);
  assert.equal(reasonProblem("owner-decision:D7"), null);
  assert.match(reasonProblem("owner-decision:D8")!, /D1–D7/);
  assert.equal(reasonProblem("superseded-by-layout:M2"), null);
  assert.match(reasonProblem("superseded-by-layout:M9")!, /no milestone/);
  assert.equal(reasonProblem("data-output:src/populus/stats.py:DATA_NOTE"), null);
  assert.equal(reasonProblem("not-present:69dafdc"), null);
  assert.match(reasonProblem("because")!, /code:argument/);
  assert.match(reasonProblem("vibes:yes")!, /unknown reason code/);
});

/* ---------- the home's entries against the rendered home ---------- */

function homeText(): string {
  const f = loadTriageFixture();
  const triage = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const txns = f.rows as TxnRow[];
  const html =
    homeHeroCopyHtml(homeTryChips({ v: 1, tickers: [["NVDA", "", 9]], members: [["A000001", "Member A", "D–CA", 9]], filers: [] }, null, {})) +
    homeLedgerHtml(
      homeFigures({
        txns, paper: [], members: [{}], filedFrom: "2014", stats: {},
        coverage: { housePct: "93.9", senatePct: "100", needsOcr: 2 },
        inst: { present: true, filers: 9, closedQuarter: "2026-03-31", filingsThrough: "2026-07-31" },
        signals: { active: f.artifact.signals.length, retentionDays: f.artifact.retentionDays, coverageFrom: f.artifact.coverageFrom, coverageTo: f.artifact.coverageTo },
        triage: { stands: triage.counts.stands, ranked: triage.rows.length }, generatedAtDate: "2026-10-19",
      }),
    ) +
    homeSectionsHtml({
      lead: homeLeadHtml(triage, {}, f.artifact.retentionDays),
      congress: congressTileHtml(txns, {}),
      moves: movesTileHtml(fixtureMoves(20), "2026-03-31", (cik) => `/f/${cik}/`, { filingsThrough: "2026-07-31" }),
      trust: homeTrustHtml({}),
    });
  /* the reader's text: tags out, entities decoded, whitespace collapsed */
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("launch-copy: every final home entry ships its pattern and drops its replaced text", () => {
  const text = homeText();
  const home = ledger.items.filter((e) => e.milestone === "M2");
  assert.equal(home.length, 10);
  for (const e of home) {
    if (e.shipped) assert.match(text, new RegExp(e.shipped), `${e.id}: shipped pattern /${e.shipped}/ is on the home`);
    if (e.replaced) assert.doesNotMatch(text, new RegExp(e.replaced), `${e.id}: replaced text /${e.replaced}/ is gone`);
    if (e.disposition === "applied" || e.disposition === "adapted") assert.ok(e.shipped || e.replaced, `${e.id}: an applied entry names what changed`);
  }
  // control: the checker sees a replaced text that came back
  assert.match(text + " Amounts are ranges as filed", new RegExp(home.find((e) => e.id === "home-03")!.replaced!));
});
