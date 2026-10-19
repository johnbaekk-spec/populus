/* signals-v4 M3 (R22, LD17; T3.1): the leadership roster — exactly the twelve
   posts of Wei & Zhou Table A1, every tenure sourced on a primary site with
   its checked date, no two tenures of one post overlapping, and the
   half-open boundary [from, to) that the Leadership-trade playbook reads.
   The dev-time cross-check against the build DB's `leadership_roles` is
   `.codex-review/m3/roster-crosscheck.ts` (17 of 17 agree), recorded in
   docs/frontend/signals-v4.md. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { LEADERSHIP_POSTS, ROSTER, ROSTER_CHECKED, ROSTER_FROM, ROSTER_VERSION, leadershipOn, type RosterTenure } from "../src/lib/leadership-roster.ts";

test("T3.1 (LD17): exactly the twelve Table A1 posts, each held by at least one roster row", () => {
  assert.deepEqual(
    LEADERSHIP_POSTS.map((p) => p.name),
    [
      "Speaker of the House",
      "House Democratic floor leader",
      "House Republican floor leader",
      "House Democratic whip",
      "House Republican whip",
      "House Democratic Caucus chair",
      "House Republican Conference chair",
      "Senate Democratic floor leader and caucus chair",
      "Senate Republican floor leader",
      "Senate Democratic whip",
      "Senate Republican whip",
      "Senate Republican Conference chair",
    ],
  );
  assert.equal(new Set(LEADERSHIP_POSTS.map((p) => p.id)).size, 12);
  for (const p of LEADERSHIP_POSTS) assert.ok(ROSTER.some((r) => r.post === p.id), `${p.id} has a holder`);
  assert.ok(ROSTER.every((r) => LEADERSHIP_POSTS.some((p) => p.id === r.post)), "no row names a post outside the twelve");
  assert.equal(ROSTER.length, 17, "the 17 verified tenures from 2023-01-03");
  assert.equal(ROSTER_VERSION, 1);
  assert.equal(ROSTER_FROM, "2023-01-03");
});

test("T3.1 (LD17): every row has an identifier, a dated tenure inside the roster, an https source on house.gov, history.house.gov or senate.gov, and its checked date", () => {
  for (const r of ROSTER) {
    const at = `${r.post} ${r.name}`;
    assert.match(r.bioguide, /^[A-Z]\d{6}$/, `${at}: identifier`);
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/, `${at}: from`);
    assert.ok(r.from >= ROSTER_FROM, `${at}: a tenure starts no earlier than the roster`);
    if (r.to !== null) {
      assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.to > r.from, `${at}: to > from`);
    }
    assert.match(r.source, /^https:\/\/(?:history\.house\.gov|www\.house\.gov|www\.senate\.gov)\//, `${at}: primary source`);
    assert.equal(r.checked, ROSTER_CHECKED);
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["day", "congress", "year"].includes(r.precision), `${at}: precision`);
    assert.ok(r.sourceSays.length > 0 && r.phrase.length > 0);
    /* a tenure the source dates by Congress or year starts and ends on a Congress's first day, or the roster's */
    if (r.precision !== "day") {
      for (const d of [r.from, r.to]) if (d !== null) assert.ok(["2023-01-03", "2025-01-03"].includes(d), `${at}: ${d} is a Congress start`);
    }
    if (r.since !== null) assert.equal(r.from, ROSTER_FROM, `${at}: a tenure held before the roster starts at it`);
  }
  // the Speakers are dated to the day, from the Speakers list
  const speakers = ROSTER.filter((r) => r.post === "speaker");
  assert.deepEqual(speakers.map((r) => [r.name, r.from, r.to, r.precision]), [
    ["Kevin McCarthy", "2023-01-07", "2023-10-03", "day"],
    ["Mike Johnson", "2023-10-25", null, "day"],
  ]);
});

test("T3.1 (LD17): the tenures of one post never overlap", () => {
  for (const p of LEADERSHIP_POSTS) {
    const rows = ROSTER.filter((r) => r.post === p.id).sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      assert.ok(prev.to !== null && prev.to <= rows[i]!.from, `${p.id}: ${prev.name} ends before ${rows[i]!.name} starts`);
    }
  }
  // control: a planted overlap is caught by the same comparison
  const planted: RosterTenure[] = [ROSTER[0]!, { ...ROSTER[1]!, from: "2023-06-01" }];
  assert.ok(!(planted[0]!.to! <= planted[1]!.from), "control: an overlapping pair fails the check");
});

test("T3.1 (LD17): the boundary — a trade on `from` is in, on `to` is out; before the roster, undated or unidentified it is never classified", () => {
  const mcc = ROSTER.find((r) => r.name === "Kevin McCarthy")!;
  assert.equal(leadershipOn(mcc.bioguide, "2023-01-07")?.post, "speaker", "on from: in");
  assert.equal(leadershipOn(mcc.bioguide, "2023-01-06"), null, "the day before: out");
  assert.equal(leadershipOn(mcc.bioguide, "2023-10-02")?.post, "speaker");
  assert.equal(leadershipOn(mcc.bioguide, "2023-10-03"), null, "on to: out");
  const thune = ROSTER.filter((r) => r.name === "John Thune");
  assert.equal(thune.length, 2);
  assert.equal(leadershipOn("T000250", "2025-01-02")?.post, "senate-rep-whip");
  assert.equal(leadershipOn("T000250", "2025-01-03")?.post, "senate-rep-leader", "the whip's end is the leader's start");
  // before the roster: never, even for a member who held a post then
  assert.equal(leadershipOn("S000148", "2023-01-02"), null, "Schumer before 2023-01-03");
  assert.equal(leadershipOn("S000148", "2023-01-03")?.post, "senate-dem-leader");
  assert.equal(leadershipOn("D000563", "2019-06-01"), null, "Durbin in 2019: not classified");
  assert.equal(leadershipOn("S000148", null), null, "no trade date");
  assert.equal(leadershipOn(null, "2024-01-01"), null, "no identifier");
  assert.equal(leadershipOn("Z999999", "2024-01-01"), null, "not a leader");
  // the roster's start is a rule of its own, not only of the rows: a planted tenure from 2019 still classifies nothing before 2023-01-03
  const planted: RosterTenure[] = [{ ...ROSTER.find((r) => r.name === "Dick Durbin")!, from: "2019-01-03" }];
  assert.equal(leadershipOn("D000563", "2020-06-01", planted), null, "a trade before ROSTER_FROM is never classified, whatever a row says");
  assert.equal(leadershipOn("D000563", "2023-06-01", planted)?.post, "senate-dem-whip");
  // a current tenure runs on
  assert.equal(leadershipOn("J000299", "2026-10-01")?.post, "speaker");
  // control: an inclusive end would wrongly classify McCarthy's last day
  const inclusive = (t: string) => ROSTER.find((r) => r.bioguide === mcc.bioguide && r.from <= t && (r.to === null || t <= r.to)) ?? null;
  assert.notEqual(inclusive("2023-10-03"), null, "control: the mutation an inclusive end makes is visible");
});
