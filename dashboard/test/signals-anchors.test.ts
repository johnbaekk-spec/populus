/* codex M3 round 1, F2 (R9 / LD8, R24): every in-page link on the assembled
   Signals page reaches a target the page carries, in every data state the
   build can be in — the full page, the institutional module absent, no
   closed quarter, the committee data absent, and the artifact-only view —
   plus an Overlap bounded to one name a view (so the "See {TICKER} in
   Overlap →" links meet names the page does not carry).

   The page is assembled as `signals/index.astro` assembles it: the same
   deps, the Playbooks model built from the same Institutional model (its
   panel counts null where the module or the quarter is absent). Every
   `href="#…"` is collected and its id looked up; a planted dangling link
   proves the check reads the page. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { signalsBody, type SignalsPageDeps } from "../src/lib/ui/index.ts";
import { buildSignalsInstitutional, type SignalsInstitutional } from "../src/lib/ui/signals-institutional.ts";
import { buildOverlap, type Overlap } from "../src/lib/ui/signals-overlap.ts";
import type { PlaybooksModel } from "../src/lib/ui/signals-playbooks.ts";
import { playbookTriggers } from "../src/lib/playbooks.ts";
import { buildTriage, type TriageResult } from "../src/lib/signal-triage.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional, fixtureMoves } from "./lib/inst-signals-fixture.ts";

const CTX = {};

/** The in-page hrefs whose id the page does not carry, by href. */
export function danglingAnchors(html: string): string[] {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  const out = new Set<string>();
  for (const m of html.matchAll(/\shref="#([^"]*)"/g)) {
    const id = decodeURIComponent(m[1]!);
    if (id === "" || !ids.has(id)) out.add(`#${m[1]}`);
  }
  return [...out].sort();
}

function absentInst(over: { present: boolean; period: string | null }): SignalsInstitutional {
  return buildSignalsInstitutional({
    present: over.present,
    absentReason: over.present ? null : "module-absent",
    period: over.period,
    latestFiled: over.present ? "2026-07-31" : null,
    freshness: "13F data in this build runs through filings received 2026-07-31.",
    notableManagers: over.present ? 40 : 0,
    moves: [],
    leaders: null,
    txns: loadTriageFixture().rows,
    filerHref: (cik) => `/institutional/filers/${Number(cik)}/`,
    filerTier: () => "top",
  });
}

/** The page's deps, built as `signals/index.astro` builds them. */
function deps(tr: TriageResult, rows: ReturnType<typeof loadTriageFixture>["rows"], inst: SignalsInstitutional, overlap: Overlap): SignalsPageDeps {
  const playbooks: PlaybooksModel = {
    triggers: playbookTriggers(tr, rows),
    triage: tr,
    bestIdeas: inst.leaders?.qualifying ?? null,
    consensus: inst.board?.qualifying ?? null,
    cmteUnavailableReason: tr.cmteUnavailableReason,
  };
  return { rowsEvaluated: 2051, triage: tr, institutional: inst, overlap, playbooks };
}

function states(): { name: string; html: string; check?: (html: string) => void }[] {
  const f = loadTriageFixture();
  const tr = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const noCmte = buildTriage(f.artifact, f.rows, { committee: null, identityOf: f.identityOf });
  const inst = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const overlap = buildOverlap(inst.quarter, inst.moves);
  const absent = absentInst({ present: false, period: null });
  const noQuarter = absentInst({ present: true, period: null });
  const absentOverlap = (why: string): Overlap => buildOverlap(null, [], { absent: why });
  return [
    { name: "full fixture", html: signalsBody(f.artifact, CTX, deps(tr, f.rows, inst, overlap)) },
    { name: "Overlap bounded to one name a view", html: signalsBody(f.artifact, CTX, deps(tr, f.rows, inst, buildOverlap(inst.quarter, inst.moves, { sliceRows: 1 }))) },
    {
      name: "institutional module absent",
      html: signalsBody(f.artifact, CTX, deps(tr, f.rows, absent, absentOverlap("the institutional 13F module is not in this build"))),
      check: (html) => {
        assert.doesNotMatch(html, /id="consensus"|id="new-position-leaders"/, "precondition: the panels are absent");
        assert.match(html, /Not computed in this view\. <a href="#institutional">The Institutional tab says why →<\/a>/);
      },
    },
    {
      name: "no closed quarter",
      html: signalsBody(f.artifact, CTX, deps(tr, f.rows, noQuarter, absentOverlap("no 13F quarter in this build has passed its 45-day filing deadline yet"))),
      check: (html) => assert.doesNotMatch(html, /id="consensus"|id="new-position-leaders"/, "precondition: the panels are absent"),
    },
    {
      name: "committee data absent",
      html: signalsBody(f.artifact, CTX, deps(noCmte, f.rows, inst, overlap)),
      check: (html) => assert.match(html, /Live · unavailable this build<\/span><\/p>[\s\S]*?Committee data is not in this build/, "precondition: the committee playbook states it"),
    },
    {
      name: "artifact-only view",
      html: signalsBody(f.artifact, CTX, { rowsEvaluated: 0, triage: null, institutional: null, overlap: null, playbooks: null }),
    },
    {
      /* a Playbooks model over a triage this page does not render: its rows
         are never linked */
      name: "Playbooks model without the page's triage",
      html: signalsBody(f.artifact, CTX, { ...deps(tr, f.rows, inst, overlap), triage: null }),
      check: (html) => assert.doesNotMatch(html, /class="pb-row-open[ "]|class="pb-all"/),
    },
  ];
}

test("codex M3 r1 F2 (R9 / LD8, R24): in every data state, every in-page href on the assembled Signals page reaches an id the page carries", () => {
  for (const s of states()) {
    s.check?.(s.html);
    assert.ok([...s.html.matchAll(/\shref="#/g)].length >= 4, `${s.name}: precondition: the page links in-page (the four tabs at least)`);
    assert.deepEqual(danglingAnchors(s.html), [], s.name);
  }
});

test("codex M3 r1 F2 coverage: the states exercise every kind of in-page link the page emits — tabs, playbook list, strips, row chips, Triggers now, All N, See in Overlap, cards", () => {
  const all = states().map((s) => s.html).join("\n");
  for (const [what, re] of [
    ["tabs", /class="tk-tab sig-tab"[^>]*href="#overlap"/],
    ["the playbook list", /class="pbi" href="#pb-opp-buy"/],
    ["a strip", /class="pb-strip" href="#pb-consensus"/],
    ["a row chip's Playbook →", /<a href="#pb-[a-z-]+">Playbook →<\/a>/],
    /* launch M5 (R28): the ticker cell of the "Triggers now" table */
    ["Triggers now", /class="pb-row-open mono-ticker cl-tk" href="#si-row-/],
    ["the panels' lines", /<a href="#new-position-leaders">/],
    ["the absent panels' line", /<a href="#institutional">The Institutional tab says why →<\/a>/],
    ["See in Overlap", /class="mv-ov-link"><a href="#ov-/],
    ["a card", /class="si-card-open" href="#named-moves"/],
    ["Overlap's own link", /<a href="#overlap">Overlap →<\/a>/],
  ] as const) assert.match(all, re, what);
});

test("codex M3 r1 F2 control: a planted dangling link, and the round-1 Playbooks links on an absent module, are caught", () => {
  const s = states().find((x) => x.name === "institutional module absent")!;
  assert.deepEqual(danglingAnchors(s.html.replace("</main>", "") + `<a href="#nowhere">x</a>`), ["#nowhere"]);
  /* the round-1 markup on this page: links to the two panels the module's absence leaves out */
  const r1 = s.html.replace('<a href="#institutional">The Institutional tab says why →</a>', '<a href="#new-position-leaders">x →</a>');
  assert.deepEqual(danglingAnchors(r1), ["#new-position-leaders"]);
});
