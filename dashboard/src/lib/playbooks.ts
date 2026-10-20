/* signals-v4 M3 (R19, R20, LD15, LD16): the seven playbooks — published
   research on the patterns Signals rows show — and the three that trigger on
   Congress rows.

   A playbook names a study and quotes what it found, on both sides; its
   numbers are the papers' own, from their own samples and years. Populus
   reads no price and computes no return, so it never says whether a pattern
   holds now, and nothing here is a recommendation (ARCHITECTURE §2.4).

   The texts are `docs/design/signals-v4-mock/playbooks.py`'s (citations
   checked against their publishers 2026-10-17), verbatim except the edits
   the plan marks † and two the build needs (recorded in
   docs/frontend/signals-v4.md): the best-ideas pattern without the banned
   "highest-conviction"; the section the best-ideas trigger and verdict name,
   written through the reference-label token below; the insider playbook's
   name ("…purchases", not "…buying"); the leadership trigger's roster
   sentence, which named a draft roster and the pipeline's identifier word;
   and the Overlap trigger, which called the tab's rule a draft.

   `playbookTriggers` computes the three Congress triggers over the build's
   triage rows (LD16), in build memory like the triage itself — never
   serialized (R23). Pure. */

import { isListedStock, normalizeTicker13f, type TxnRow } from "./format.ts";
import { excludeDateAnomalies } from "./derive.ts";
import { s3MemberKey } from "./signals.ts";
import { BROAD_ACCOUNT_NAMES } from "./congress-quarter.ts";
import { COMMITTEE_DIRECT_VERSION } from "./committee-direct.ts";
import type { TriageResult, TriageRow } from "./signal-triage.ts";
import { ROSTER, ROSTER_CHECKED, ROSTER_FROM, ROSTER_VERSION, leadershipOn, type RosterTenure } from "./leadership-roster.ts";

/** The CMP routine test's look-back, in calendar years (LD16). */
export const CMP_YEARS = 3;
/** The opportunistic-buy breadth window, in days before the trade (LD16). */
export const OPP_BREADTH_DAYS = 90;
/** The most "Triggers now" rows a playbook lists (LD16). */
export const PLAYBOOK_TRIGGER_ROWS = 5;

/** The owner's reference label for the new-position leaders, as a token: the
    renderer writes it through the markup-bound label (LD20), so the word
    never travels as free text. */
export const LEADERS_LABEL_TOKEN = "{{leaders-label}}";

export type PlaybookId = "opp-buy" | "leader" | "cmte" | "best-ideas" | "consensus" | "overlap" | "insider-opp";
/** The playbooks that trigger on a Congress row (LD16). */
export type CongressPlaybookId = "opp-buy" | "leader" | "cmte";
export const CONGRESS_PLAYBOOKS: readonly CongressPlaybookId[] = ["opp-buy", "leader", "cmte"];

export type PlaybookSource = "Congress" | "Institutional" | "Overlap" | "Form 4";
export type PlaybookStatus = "live" | "descriptive" | "needs-data";
export type EvidenceDir = "supports" | "against" | "indirect";

export interface Evidence {
  dir: EvidenceDir;
  cite: string;
  venue: string;
  sample: string;
  /** the paper's own finding, quoted as the paper's */
  finding: string;
  url: string;
}

export interface Playbook {
  id: PlaybookId;
  /** the dashed chip's word */
  short: string;
  name: string;
  source: PlaybookSource;
  status: PlaybookStatus;
  /** the strength of the evidence, in one or two words */
  grade: string;
  pattern: string;
  /** the rule (a tip) */
  trigger: string;
  /** the horizon the research studied (a tip) */
  horizon: string;
  verdict: string;
  evidence: readonly Evidence[];
  /** what it needs before it can trigger (needs-data only) */
  needs?: readonly string[];
}

const CMP_2012: Omit<Evidence, "sample"> = {
  dir: "supports",
  cite: "Cohen, Malloy & Pomorski (2012)",
  venue: "Journal of Finance 67(3)",
  finding: "Opportunistic insiders’ trades earned abnormal returns of 82 bp a month value-weighted (180 bp equal-weighted). Routine insiders’ earned about zero.",
  url: "https://www.nber.org/papers/w16454",
};

/** LD15: the seven playbooks, in the tab's order. */
export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "opp-buy", short: "OPP. BUY", name: "Opportunistic member buy", source: "Congress", status: "live", grade: "split",
    pattern:
      "Strip out routine traders — people who trade in the same calendar month year after year, for pay or liquidity — and what is left carries the information. Proven for corporate insiders; adapted here to members of Congress.",
    trigger:
      `A listed-stock purchase in Filings to read by a member who traded in each of the ${CMP_YEARS} prior years but never in one fixed month each year (the CMP routine test). ` +
      `Members with under ${CMP_YEARS} years of history are unclassified. Broad accounts (more than ${BROAD_ACCOUNT_NAMES} names in the ${OPP_BREADTH_DAYS} days before the trade) are left out.`,
    horizon: "CMP: portfolios formed monthly on the filing. The Congress studies: one month to a year.",
    verdict:
      "Split. The routine filter is proven for corporate insiders and untested on Congress; studies after the STOCK Act find no average edge for member purchases.",
    evidence: [
      { ...CMP_2012, sample: "Corporate insiders, 1986–2007 — not Congress" },
      {
        dir: "supports", cite: "Ziobrowski, Cheng, Boyd & Ziobrowski (2004)", venue: "JFQA 39(4)", sample: "Senate, 1993–1998",
        finding: "A portfolio copying senators’ purchases beat the market by 85 bp a month.",
        url: "https://ideas.repec.org/a/cup/jfinqa/v39y2004i04p661-676_00.html",
      },
      {
        dir: "supports", cite: "Ziobrowski, Boyd, Cheng & Ziobrowski (2011)", venue: "Business and Politics 13(1)", sample: "House members",
        finding: "A portfolio copying House members’ purchases beat the market by 55 bp a month.",
        url: "https://www.cambridge.org/core/journals/business-and-politics/article/abnormal-returns-from-the-common-stock-investments-of-members-of-the-us-house-of-representatives/BC6C6A524BBE96738BB94D37EF0FD1A5",
      },
      {
        dir: "against", cite: "Eggers & Hainmueller (2013)", venue: "Journal of Politics 75(2)", sample: "Congress, 2004–2008",
        finding: "No information advantage in either period studied; the average member would have earned more in a passive index fund.",
        url: "https://eprints.lse.ac.uk/46513",
      },
      {
        dir: "against", cite: "Belmont, Sacerdote, Sehgal & Van Hoek (2022)", venue: "Journal of Public Economics 207", sample: "Congress, 2012–2020 (after the STOCK Act)",
        finding: "No outperformance in aggregate. Over six months, stocks House members bought underperformed by 26 bp.",
        url: "https://www.nber.org/papers/w26975",
      },
    ],
  },
  {
    id: "leader", short: "LEADER", name: "Leadership trade", source: "Congress", status: "live", grade: "one study",
    pattern: "Members who rise into party leadership trade like their peers before, and better after.",
    trigger:
      "Any trade by a member holding one of the 12 leadership posts the study uses: the Speaker, and the floor leaders, whips and conference or caucus chairs in both chambers. " +
      /* † the draft-roster sentence: the roster is now dated and sourced (LD17) */
      `Matched by congressional identifier against a dated roster from ${ROSTER_FROM} (roster v${ROSTER_VERSION}, every tenure checked against house.gov, history.house.gov or senate.gov on ${ROSTER_CHECKED}); a trade before ${ROSTER_FROM} is never classified.`,
    horizon: "Annual portfolio returns, before and after taking the post.",
    verdict: "One study: a working paper on 20 leaders. Strong effect, small sample, not yet peer-reviewed.",
    evidence: [
      {
        dir: "supports", cite: "Wei & Zhou (2025)", venue: "NBER Working Paper 34524", sample: "1995–2021; 20 leaders who traded before and after",
        finding: "Similar to matched peers before taking the post, then ahead of them by 47 percentage points a year after. The authors point to political influence and corporate access.",
        url: "https://www.nber.org/papers/w34524",
      },
    ],
  },
  {
    id: "cmte", short: "CMTE", name: "Committee-linked trade", source: "Congress", status: "live", grade: "thin",
    pattern: "A member trading a company inside the jurisdiction of a committee they sit on.",
    trigger: `Cmte reads medium: a direct match in the committee table (v${COMMITTEE_DIRECT_VERSION}). Context, never an allegation.`,
    horizon: "Varies by study.",
    verdict: "Thin. No study we found tests a jurisdiction match like this one; the committee result we found is about committee power, not jurisdiction.",
    evidence: [
      {
        dir: "indirect", cite: "Hall, Karadas & Schlosky (2017)", venue: "Journal of Financial Economic Policy 9(4)", sample: "New members of Congress",
        finding: "Members serving on powerful committees outperform the market in their second term — a committee-power effect, not a jurisdiction test.",
        url: "https://ideas.repec.org/a/eme/jfeppp/jfep-12-2016-0095.html",
      },
      {
        dir: "against", cite: "Belmont, Sacerdote, Sehgal & Van Hoek (2022)", venue: "Journal of Public Economics 207", sample: "Congress, 2012–2020",
        finding: "No outperformance in aggregate, nor for the senators accused of informed trading.",
        url: "https://www.nber.org/papers/w26975",
      },
    ],
  },
  {
    id: "best-ideas", short: "BEST IDEA", name: "Best ideas", source: "Institutional", status: "live", grade: "supportive",
    /* † "highest-conviction" is banned wording (LD15) */
    pattern: "A manager’s best idea — the position tilted furthest from its market weight — beat the rest of the book in the research below.",
    trigger: `A notable manager’s largest new position at 2% or more of its 13F long book (${LEADERS_LABEL_TOKEN}).`,
    horizon: "Monthly returns after the quarter’s holdings are known.",
    verdict: `Supportive, but measured on mutual funds with tilt against market weight; ${LEADERS_LABEL_TOKEN} ranks by raw share of book.`,
    evidence: [
      {
        dir: "supports", cite: "Cohen, Polk & Silli (2010); later Antón, Cohen & Polk", venue: "“Best Ideas”, LSE working paper", sample: "US mutual funds, 1991–2005",
        finding: "Best ideas beat the market and the rest of the portfolio by about 39–127 bp a month, depending on the benchmark. The later version reports 2.8–4.5% a year.",
        url: "https://personal.lse.ac.uk/polk/research/BestIdeas.pdf",
      },
    ],
  },
  {
    id: "consensus", short: "CONSENSUS", name: "Notable-manager consensus", source: "Institutional", status: "live", grade: "weak",
    pattern: "A name several notable managers opened or added in the same quarter.",
    trigger: "Three or more notable managers moved the same name in the closed quarter (Consensus).",
    horizon: "Quarterly holdings.",
    verdict: "Weak. No study we found shows that names several hedge funds bought go on to outperform.",
    evidence: [
      {
        dir: "indirect", cite: "Cohen, Coval & Pástor (2005)", venue: "Journal of Finance 60(3)", sample: "US equity funds",
        finding: "Funds whose holdings resemble those of managers with strong records earn higher future returns — a fund-level result, not a stock-level one.",
        url: "https://www.nber.org/papers/w9359",
      },
      {
        dir: "against", cite: "Griffin & Xu (2009)", venue: "Review of Financial Studies 22(7)", sample: "13F holdings, 1986–2004",
        finding: "Hedge funds out-picked mutual funds by only 1.32% a year value-weighted, not significant equal-weighted, with weak evidence of differences in skill.",
        url: "https://ideas.repec.org/a/oup/rfinst/v22y2009i7p2331-2370.html",
      },
    ],
  },
  {
    id: "overlap", short: "OVERLAP", name: "Congress and managers on one name", source: "Overlap", status: "descriptive", grade: "no studies",
    pattern: "Members of Congress and notable managers moving the same name, the same way, in the same quarter.",
    /* the tab's rule is no longer a draft (LD14) */
    trigger: "The Overlap tab’s rule.",
    horizon: "—",
    verdict: "No published evidence found. It stays descriptive: Public Filings uses no prices, so it cannot test the pairing itself.",
    evidence: [],
  },
  {
    /* † "…buying" is banned wording (LD15) */
    id: "insider-opp", short: "INSIDER", name: "Opportunistic insider purchases", source: "Form 4", status: "needs-data", grade: "needs data",
    pattern:
      "Over half of corporate insider trades are routine — made in the same calendar month for years, for pay or liquidity — and carry no information. Strip them out and what is left is informed money.",
    trigger:
      "Proposed: open-market purchases (Form 4 code P) by insiders not tagged routine; routine = traded in the same calendar month in each of the 3 prior years. Extra weight when 2 or more insiders of one issuer buy within 30 days — a proposed refinement, not tested in the paper.",
    horizon: "Portfolios formed monthly on the filing.",
    verdict: "The strongest evidence of the set, and Public Filings cannot trigger it: there is no Form 4 data here yet.",
    needs: [
      "A Form 4 ingest from EDGAR ownership XML; filings are due within 2 business days of the trade.",
      "An insider-level history of at least 3 years, for the routine test.",
      "An issuer-to-ticker bridge, so a row can name a ticker.",
    ],
    evidence: [{ ...CMP_2012, sample: "Corporate insiders, 1986–2007" }],
  },
];

export function playbookById(id: PlaybookId): Playbook {
  return PLAYBOOKS.find((p) => p.id === id)!;
}

/* ---------------------------------------------------------------- the CMP test (LD16) */

/** The CMP routine test, adapted (LD16): `unclassified` unless the member
    traded in each of the `CMP_YEARS` calendar years before the lead's;
    `routine` when one calendar month has a trade in all of them; otherwise
    `opportunistic`. History is the member's rows traded before the lead's
    year and FILED by the cutoff, so a filing reads as it read on its date. */
export interface CmpResult {
  cls: "routine" | "opportunistic" | "unclassified";
  /** the look-back years, newest first (Y−1 … Y−CMP_YEARS) */
  years: number[];
  /** the calendar months ("01"…"12") that recur in every look-back year */
  common: string[];
  /** distinct tickers the member traded in the `OPP_BREADTH_DAYS` before the lead (filed by the cutoff) */
  breadth: number;
}

function minusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export function cmpTest(memberRows: readonly TxnRow[], lead: Pick<TxnRow, "traded">, cutoff: string): CmpResult {
  const traded = lead.traded!;
  const y = Number(traded.slice(0, 4));
  const years = Array.from({ length: CMP_YEARS }, (_, k) => y - 1 - k);
  const months = new Map<number, Set<string>>(years.map((yy) => [yy, new Set()]));
  for (const r of memberRows) {
    if (!r.traded || r.traded >= `${y}-01-01` || r.filed > cutoff) continue;
    months.get(Number(r.traded.slice(0, 4)))?.add(r.traded.slice(5, 7));
  }
  const lo = minusDays(traded, OPP_BREADTH_DAYS);
  const tickers = new Set<string>();
  for (const r of memberRows) {
    if (!r.ticker || !r.traded || r.traded < lo || r.traded >= traded || r.filed > cutoff) continue;
    tickers.add(normalizeTicker13f(r.ticker));
  }
  const breadth = tickers.size;
  if (years.some((yy) => months.get(yy)!.size === 0)) return { cls: "unclassified", years, common: [], breadth };
  const common = [...months.get(years[0]!)!].filter((m) => years.every((yy) => months.get(yy)!.has(m))).sort();
  return { cls: common.length > 0 ? "routine" : "opportunistic", years, common, breadth };
}

/* ---------------------------------------------------------------- the triggers (LD16) */

export interface PlaybookHit {
  id: CongressPlaybookId;
  /** why the row triggered it, from the row's own facts */
  why: string;
}

export interface PlaybookTriggers {
  /** triage row key → the playbooks it triggers, in `CONGRESS_PLAYBOOKS` order */
  byRow: Map<string, PlaybookHit[]>;
  /** triggered rows per playbook */
  counts: Record<CongressPlaybookId, number>;
  /** false when the committee meter could not be computed in this build: the
      committee playbook then has zero rows and says it is unavailable */
  cmteAvailable: boolean;
  /** the CMP result of every row the opportunistic test applied to (LD16), for
      the measured counts and the tests */
  cmp: Map<string, CmpResult>;
}

/** Whether the opportunistic test applies to a row (LD16): not a cluster, and
    its lead line a listed-stock purchase with a ticker and a trade date. */
export function oppBuyApplies(row: Pick<TriageRow, "grouping" | "lead">): boolean {
  const t = row.lead.txn;
  return row.grouping !== "cluster" && t.side === "purchase" && isListedStock(t.assetType) && !!t.ticker && !!t.traded;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** LD16: the three Congress triggers over the build's triage rows. */
export function playbookTriggers(triage: TriageResult, txns: readonly TxnRow[], roster: readonly RosterTenure[] = ROSTER): PlaybookTriggers {
  const byMember = new Map<string, TxnRow[]>();
  for (const r of excludeDateAnomalies(txns).rows) {
    const k = s3MemberKey(r);
    let l = byMember.get(k);
    if (!l) byMember.set(k, (l = []));
    l.push(r);
  }
  const byRow = new Map<string, PlaybookHit[]>();
  const counts: Record<CongressPlaybookId, number> = { "opp-buy": 0, leader: 0, cmte: 0 };
  const cmp = new Map<string, CmpResult>();
  for (const row of triage.rows) {
    const hits: PlaybookHit[] = [];
    if (oppBuyApplies(row)) {
      const t = row.lead.txn;
      const res = cmpTest(byMember.get(s3MemberKey(t)) ?? [], t, row.lead.cutoff);
      cmp.set(row.key, res);
      if (res.cls === "opportunistic" && res.breadth <= BROAD_ACCOUNT_NAMES) {
        hits.push({
          id: "opp-buy",
          why:
            `Not routine by the CMP test: traded in each of ${res.years.at(-1)}–${res.years[0]}, but no calendar month recurs in all ${CMP_YEARS === 3 ? "three" : CMP_YEARS}. ` +
            `${plural(res.breadth, "name", "names")} traded in the ${OPP_BREADTH_DAYS} days before, so not a broad account.`,
        });
      }
    }
    /* any ranked line by a member who held a post on its trade date */
    const leaders = new Map<string, string>();
    for (const l of row.lines) {
      const tenure = leadershipOn(l.txn.bioguide, l.txn.traded, roster);
      if (tenure && !leaders.has(`${tenure.bioguide}|${tenure.post}`)) leaders.set(`${tenure.bioguide}|${tenure.post}`, `${l.txn.name} ${tenure.phrase}`);
    }
    if (leaders.size > 0) {
      hits.push({ id: "leader", why: `${[...leaders.values()].join("; ")} on the trade date (roster v${ROSTER_VERSION}, checked ${ROSTER_CHECKED}).` });
    }
    if (row.meters.cmte >= 2) {
      hits.push({
        id: "cmte",
        why: "Cmte reads medium: the issuer’s SIC sits inside a direct range of a committee the member sat on at the trade date.",
      });
    }
    for (const h of hits) counts[h.id]++;
    if (hits.length > 0) byRow.set(row.key, hits);
  }
  return { byRow, counts, cmteAvailable: triage.cmteAvailable, cmp };
}
