/* ui/signals-playbooks.ts — the Playbooks tab of /signals/ and every place a
   playbook surfaces (signals-v4 M3: R19, R21, R22, R25, LD9, LD15, LD16,
   LD20). One of the ui/ domain modules: consumers import from ./index.ts.

   - The tab: "Published research on the patterns these rows show. Not
     advice." visible first; a list of the seven playbooks (anchors to
     `#pb-{id}`, so without script every article shows and the list jumps to
     it; the client shows one at a time — never a tablist); each article its
     source and status, pattern, verdict, rule and horizon (tips), what
     triggers it now — a table of the Congress rows with their own dates
     column (traded → filed, the lag, late in amber) and receipt column, built
     from the one Congress line's fields (`congressLineFields`), a panel's
     qualifying count, or what it needs — and its evidence for and against,
     each with its link, its venue and sample a study tip (launch M5, R28).
     The numbers are the papers' own.
   - A Congress row that triggers one carries a dashed chip on its first line
     (`data-pb` tokens on the row) and, opened, the playbook's name, verdict,
     why it triggered and a link to it; a Playbooks filter above Filings to
     read shows only the rows that trigger one, with its count.
   - Strips on Consensus, the new-position leaders and Overlap link their
     playbook.

   The best-ideas texts name the owner's reference label through its token
   (`LEADERS_LABEL_TOKEN`), written here through `CONVICTION_LABEL_HTML`
   (LD20). Pure. */

import { type RenderCtx, esc, fmtInt, note, noteFromHtml, rowLink } from "../format.ts";
import {
  CMP_YEARS,
  CONGRESS_PLAYBOOKS,
  LEADERS_LABEL_TOKEN,
  OPP_BREADTH_DAYS,
  PLAYBOOKS,
  PLAYBOOK_TRIGGER_ROWS,
  playbookById,
  type CongressPlaybookId,
  type Playbook,
  type PlaybookHit,
  type PlaybookId,
  type PlaybookTriggers,
} from "../playbooks.ts";
import { LEADERSHIP_POSTS, ROSTER, ROSTER_CHECKED, ROSTER_FROM, ROSTER_PRECISION_TEXT, ROSTER_STUDY, ROSTER_VERSION } from "../leadership-roster.ts";
import { BROAD_ACCOUNT_NAMES } from "../congress-quarter.ts";
import type { TriageResult, TriageRow } from "../signal-triage.ts";
import { disclosureLedger, type LedgerItem } from "./shared.ts";
import { COMMITTEE_CAVEAT, congressLineFields, triageRowId } from "./signals.ts";
import { CONVICTION_LABEL_HTML } from "./signals-institutional.ts";

/** What the tab and the playbook surfaces read: the triggers over the
    build's triage, the triage rows they name, and the two panels'
    qualifying counts (null where the panel is not in this view). */
export interface PlaybooksModel {
  triggers: PlaybookTriggers;
  triage: TriageResult;
  /** the new-position leaders' qualifying filers */
  bestIdeas: number | null;
  /** the Consensus board's qualifying issuers */
  consensus: number | null;
  /** why the committee meter is unknown, when it is */
  cmteUnavailableReason: string | null;
}

/** A playbook text with the reference-label token written as its markup. */
export function playbookTextHtml(text: string): string {
  return esc(text).replaceAll(LEADERS_LABEL_TOKEN, CONVICTION_LABEL_HTML);
}

const STATUS_WORD: Readonly<Record<Playbook["status"], string>> = { live: "Live", descriptive: "Descriptive", "needs-data": "Needs Form 4" };
const DIR_WORD: Readonly<Record<string, string>> = { supports: "Supports", against: "Against", indirect: "Indirect" };

function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** Rows a Congress playbook triggers on, in the triage's order. */
function triggeredRows(model: PlaybooksModel, id: CongressPlaybookId) {
  return model.triage.rows.filter((r) => model.triggers.byRow.get(r.key)?.some((h) => h.id === id));
}

/** A playbook's status line: "Live · 3 rows", "Live · 4 managers qualify",
    "Live · unavailable this build", "Descriptive", "Needs Form 4". */
export function playbookStatusText(p: Playbook, model: PlaybooksModel | null): string {
  if (p.status !== "live") return STATUS_WORD[p.status];
  if (model === null) return "Live · not computed in this view";
  if (p.id === "cmte" && !model.triggers.cmteAvailable) return "Live · unavailable this build";
  if (p.id === "best-ideas") return model.bestIdeas === null ? "Live · not computed in this view" : `Live · ${plural(model.bestIdeas, "manager qualifies", "managers qualify")}`;
  if (p.id === "consensus") return model.consensus === null ? "Live · not computed in this view" : `Live · ${plural(model.consensus, "name qualifies", "names qualify")}`;
  return `Live · ${plural(model.triggers.counts[p.id as CongressPlaybookId], "row", "rows")}`;
}

/** An article's status line (R28): the status word, and for a live playbook
    that cannot trigger this build, why — the count itself is the list's and
    the article's "Triggers now". */
export function articleStatusText(p: Playbook, model: PlaybooksModel | null): string {
  /* "Form 4 · Needs data": the source already names the form */
  if (p.status === "needs-data") return "Needs data";
  if (p.status !== "live") return STATUS_WORD[p.status];
  if (model === null) return "Live · not computed in this view";
  if (p.id === "cmte" && !model.triggers.cmteAvailable) return "Live · unavailable this build";
  return "Live";
}

/* ---------------------------------------------------------------- strips, chips, the row's section */

/** A strip on a panel (Consensus, the new-position leaders, Overlap): the
    playbook's chip and grade, a link to it (LD16). */
export function playbookStripHtml(id: PlaybookId): string {
  const p = playbookById(id);
  return (
    `<a class="pb-strip" href="#pb-${p.id}"><span class="pb-chip">${esc(p.short)}</span> ${esc(p.grade)}` +
    `<span class="visually-hidden"> — the ${esc(p.name)} playbook</span></a>`
  );
}

/** The dashed chips of a triggered row, leading line 2's reason (R21; `triageRowHtml`). */
export function playbookChipsHtml(hits: readonly PlaybookHit[] | undefined): string {
  if (!hits || hits.length === 0) return "";
  return hits.map((h) => ` <span class="pb-chip"><span aria-hidden="true">${esc(playbookById(h.id).short)}</span><span class="visually-hidden">, triggers the ${esc(playbookById(h.id).name)} playbook</span></span>`).join("");
}

/** The playbook section of an opened row (R21): name, verdict, why it
    triggered, the link. */
export function playbookRowSectionHtml(hits: readonly PlaybookHit[] | undefined): string {
  if (!hits || hits.length === 0) return "";
  return (
    `<div class="si-row-pb">` +
    hits
      .map((h) => {
        const p = playbookById(h.id);
        return (
          `<div class="si-row-pb-one"><p class="si-row-pb-h"><span class="pb-chip">${esc(p.short)}</span> <strong>${esc(p.name)}</strong> ` +
          `<a href="#pb-${p.id}">Playbook →</a></p>` +
          `<p class="si-row-pb-v">${playbookTextHtml(p.verdict)}</p>` +
          `<p class="si-mw-def">${esc(h.why)}</p></div>`
        );
      })
      .join("") +
    `</div>`
  );
}

/** The Playbooks filter above Filings to read (R21): one chip per Congress
    playbook with its count, single-select; the committee one states that it
    is unavailable when the committee inputs are not in this build. */
export function playbookFilterHtml(model: PlaybooksModel): string {
  const tip = note(
    "A playbook names published research on a pattern a row shows. A dashed chip on a row means it triggers one. Choose a playbook to show only those rows; choose it again to show every row. Not advice.",
    { scope: "signals-pb-filter" },
    "about",
    { trigger: "mark", name: "About playbooks" },
  );
  const chips = CONGRESS_PLAYBOOKS.map((id) => {
    const p = playbookById(id);
    const off = id === "cmte" && !model.triggers.cmteAvailable;
    return (
      `<button type="button" class="si-pb-pick" data-pb-filter="${id}" aria-pressed="false"${off ? ' aria-disabled="true"' : ""}>` +
      `${esc(p.name)} <span class="tk-tab-n">${off ? "unavailable this build" : fmtInt(model.triggers.counts[id])}</span></button>`
    );
  }).join("");
  return (
    `<div class="si-pb-filter">` +
    `<span class="si-pb-l">Playbooks</span>` +
    `<div class="si-pb-chips" data-scroll-region="Playbook filters · scroll sideways"><div class="chips" role="group" aria-label="Show the rows that trigger a playbook">${chips}</div></div>` +
    tip +
    `</div>` +
    `<p class="section-note si-pb-status" id="si-pb-status" hidden></p>`
  );
}

/* ---------------------------------------------------------------- the ledger group (LD9) */

/** LD9: Playbooks · Triggered · Needs data. */
export function playbooksLedgerItems(model: PlaybooksModel | null): LedgerItem[] {
  const live = PLAYBOOKS.filter((p) => p.status === "live").length;
  const needs = PLAYBOOKS.filter((p) => p.status === "needs-data").length;
  return [
    { label: "Playbooks", value: fmtInt(PLAYBOOKS.length), detail: `${fmtInt(live)} live`, subKind: "count", tone: "blue" },
    model === null
      ? { label: "Triggered", value: "—", detail: "not computed in this view", subKind: "absence", tone: "gold" }
      : { label: "Triggered", value: fmtInt(model.triggers.byRow.size), detail: "Congress rows", subKind: "count", tone: "gold" },
    { label: "Needs data", value: fmtInt(needs), detail: "Form 4", subKind: "count" },
  ];
}

export function playbooksLedgerHtml(model: PlaybooksModel | null): string {
  return disclosureLedger(playbooksLedgerItems(model), { scope: "signals-pb-ledger" });
}

/* ---------------------------------------------------------------- the tab */

/** What the assembled page carries for the Playbooks tab to link (R9 / LD8:
    an in-page link only to a target on the page). `signalsBody` states both;
    a caller rendering the tab alone (the tests, the parity capture) defaults
    to the full page's. */
export interface PlaybooksTargets {
  /** the Institutional tab renders Consensus (`#consensus`) and the
      new-position leaders (`#new-position-leaders`): the module is in the
      build and a quarter has closed. Otherwise the panel lines link the
      Institutional tab, which states the absence. */
  institutionalPanels: boolean;
  /** Filings to read renders the model's triage rows (`#si-row-…`) and the
      filter (`#triage`); otherwise a "Triggers now" line carries no link */
  triageRows: boolean;
}
const FULL_PAGE: PlaybooksTargets = { institutionalPanels: true, triageRows: true };

function triggersNowHtml(p: Playbook, model: PlaybooksModel | null, ctx: RenderCtx, to: PlaybooksTargets = FULL_PAGE): string {
  const sec = (k: string, body: string): string => `<div class="pb-sec"><p class="pb-k">${esc(k)}</p>${body}</div>`;
  if (p.status === "needs-data") {
    return sec("What it needs", `<ul class="pb-needs">${(p.needs ?? []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }
  if (p.id === "overlap") return sec("Where it shows", `<p class="pb-line"><a href="#overlap">Overlap →</a></p>`);
  if (model === null) return sec("Triggers now", `<p class="section-note">Not computed in this view: the triggers are computed on the server from the build's rows.</p>`);
  /* the panel's own anchor where the Institutional tab renders it; else the
     tab, whose panel states why it is absent (never a link to nothing) */
  const panelLink = (anchor: string, labelHtml: string): string =>
    to.institutionalPanels ? `<a href="#${anchor}">${labelHtml} →</a>` : `<a href="#institutional">The Institutional tab says why →</a>`;
  if (p.id === "best-ideas") {
    return sec("Triggers now", `<p class="pb-line">${esc(model.bestIdeas === null ? "Not computed in this view." : `${plural(model.bestIdeas, "manager qualifies", "managers qualify")} this quarter.`)} ${panelLink("new-position-leaders", CONVICTION_LABEL_HTML)}</p>`);
  }
  if (p.id === "consensus") {
    return sec("Triggers now", `<p class="pb-line">${esc(model.consensus === null ? "Not computed in this view." : `${plural(model.consensus, "name qualifies", "names qualify")} this quarter.`)} ${panelLink("consensus", "Consensus")}</p>`);
  }
  const id = p.id as CongressPlaybookId;
  if (id === "cmte" && !model.triggers.cmteAvailable) {
    return sec(
      "Triggers now",
      `<p class="section-note">Committee data is not in this build (${esc(model.cmteUnavailableReason ?? "inputs-not-in-build")}), so no row reads Cmte medium.</p>`,
    );
  }
  const rows = triggeredRows(model, id);
  /* copy item signals-12: the empty state is one short computed line */
  if (rows.length === 0) return sec("Triggers now", `<p class="section-note">No ranked row triggers it.</p>`);
  const shown = rows.slice(0, PLAYBOOK_TRIGGER_ROWS);
  return sec(
    "Triggers now",
    triggerTableHtml(p, shown, ctx, to) +
      (rows.length > shown.length
        ? to.triageRows
          ? `<p class="pb-line"><a class="pb-all" href="#triage" data-pb-filter="${id}">All ${fmtInt(rows.length)} rows<span class="visually-hidden"> in Filings to read</span> →</a></p>`
          : `<p class="pb-line">${fmtInt(rows.length)} rows trigger it.</p>`
        : ""),
  );
}

/** The column heads of "Triggers now" (R28). They name each column for
    assistive technology and fold through the clip pattern at every width:
    each cell reads on its own (the mock's rows carry no head), and the tab's
    served words are the gate (SC5). */
export const TRIGGER_COLUMNS = ["Ticker", "Member · owner", "Side", "Range", "Traded → filed", "Receipt"] as const;

/** "Triggers now" as a table (R28): one row per triggered row's lead line,
    its cells the one Congress line's fields — the ticker (a link to the row
    in Filings to read where the page renders it), the member with party,
    state and owner, the side, the range, its own dates column (traded →
    filed, the lag, late in amber, "late" in words for assistive technology)
    and its own receipt column. Explicit table roles at every width (R40) and
    the ledger role classes, so the phone card (M1) keys on them. */
export function triggerTableHtml(p: Playbook, rows: readonly TriageRow[], ctx: RenderCtx, to: PlaybooksTargets = FULL_PAGE): string {
  const head = TRIGGER_COLUMNS.map((c, i) => `<th scope="col" role="columnheader" class="${TRIGGER_CELL_CLASSES[i]}" data-label="${esc(c)}"><span class="visually-hidden">${esc(c)}</span></th>`).join("");
  const body = rows
    .map((r) => {
      const f = congressLineFields(r.lead.txn, ctx);
      /* the row's main link (launch review M2): the member, else the ticker */
      const memberLinked = /<a[\s>]/.test(f.who);
      const tk = to.triageRows
        ? `<a class="pb-row-open mono-ticker cl-tk"${memberLinked ? "" : " data-row-link"} href="#${esc(triageRowId(r))}">${f.ticker}<span class="visually-hidden">, show the row in Filings to read</span></a>`
        : `<span class="mono-ticker cl-tk">${f.ticker}</span>`;
      const cells = [tk, `<span class="cl-who">${rowLink(f.who)}</span>`, f.side, f.amt, f.dates + (f.late ? `<span class="visually-hidden">, late</span>` : ""), f.src];
      return `<tr class="pb-row" role="row">${cells.map((c, i) => `<td class="${TRIGGER_CELL_CLASSES[i]}" role="cell">${c}</td>`).join("")}</tr>`;
    })
    .join("");
  return (
    `<table class="pb-tg" data-card="generic" role="table">` +
    `<caption class="visually-hidden">Rows that trigger the ${esc(p.name)} playbook</caption>` +
    `<thead role="rowgroup"><tr role="row">${head}</tr></thead>` +
    `<tbody role="rowgroup">${body}</tbody></table>`
  );
}
/** Each column's ledger role class (LD6) and the honesty class its cell carries. */
const TRIGGER_CELL_CLASSES = ["c-ticker", "c-flex c-member", "c-kind", "c-num cl-amt", "c-filed cl-dates", "c-src si-row-src"] as const;

function playbookArticleHtml(p: Playbook, model: PlaybooksModel | null, ctx: RenderCtx, to: PlaybooksTargets): string {
  const rule = noteFromHtml(
    `<span class="si-tip-p">${playbookTextHtml(p.trigger)}</span>` +
      (p.id === "leader" ? `<span class="si-tip-p">Roster v${ROSTER_VERSION}, from ${ROSTER_FROM}, checked ${ROSTER_CHECKED}. ${esc(ROSTER_PRECISION_TEXT)} <a href="/methodology/#signals-playbooks">The roster and its sources ↗</a></span>` : "") +
      (p.id === "opp-buy" ? `<span class="si-tip-p">The routine test is the site's adaptation of Cohen, Malloy & Pomorski's, whose sample is corporate insiders. <a href="/methodology/#signals-playbooks">The rule ↗</a></span>` : ""),
    { scope: "signals-pb" },
    `${p.id}-rule`,
    { trigger: "mark", name: "The trigger rule" },
  );
  const horizon = note(p.horizon, { scope: "signals-pb" }, `${p.id}-horizon`, { trigger: "mark", name: "The horizon studied" });
  /* R28: each study's venue and sample open as a tip on its citation; the
     finding and the link stay on the line */
  const evidence =
    p.evidence.length === 0
      ? `<p class="section-note">No published study found.</p>`
      : `<ul class="pb-ev">` +
        p.evidence
          .map(
            (e, i) =>
              `<li class="ev"><span class="ev-d ev-${e.dir}">${esc(DIR_WORD[e.dir] ?? e.dir)}</span>` +
              `<span class="ev-c">${esc(e.cite)}` +
              noteFromHtml(`<span class="ev-v">${esc(e.venue)} · ${esc(e.sample)}</span>`, { scope: "signals-pb" }, `${p.id}-study-${i + 1}`, { trigger: "mark", name: "Study details" }) +
              `</span>` +
              `<a class="ev-src" href="${esc(e.url)}" rel="noopener" target="_blank">source ↗</a>` +
              `<span class="ev-f">${esc(e.finding)}</span></li>`,
          )
          .join("") +
        `</ul>`;
  return (
    `<article class="pb-main" id="pb-${p.id}" aria-labelledby="pb-${p.id}-h">` +
    /* the article states its status word; the counts are the list's and the
       article's own "Triggers now" (R28: one statement, not two) */
    `<p class="pbi-s"><span class="pbi-src">${esc(p.source)}</span> <span class="pb-st pb-st-${p.status}">${esc(articleStatusText(p, model))}</span></p>` +
    `<div class="pb-h"><h3 class="pb-name" id="pb-${p.id}-h">${esc(p.name)}</h3><span class="pb-chip">${esc(p.short)}</span>` +
    `<span class="pb-meta">Rule ${rule}</span><span class="pb-meta">Horizon ${horizon}</span></div>` +
    `<p class="pb-p">${playbookTextHtml(p.pattern)}</p>` +
    `<p class="pb-verdict">${playbookTextHtml(p.verdict)}</p>` +
    triggersNowHtml(p, model, ctx, to) +
    `<div class="pb-sec"><p class="pb-k">Evidence</p>${evidence}</div>` +
    `</article>`
  );
}

/** The Playbooks tabpanel's content (the panel element is `signalsBody`'s).
    `null` is the artifact-only view: the tab states that it is computed on
    the server (LD2), keeping its "Not advice" line. `targets` is what the
    assembled page carries for the tab's in-page links (`signalsBody`). */
export function signalsPlaybooksHtml(model: PlaybooksModel | null, ctx: RenderCtx, targets: PlaybooksTargets = FULL_PAGE): string {
  if (model === null) {
    return (
      `<section class="panel sig-pb" id="pb-section" aria-labelledby="playbooks-h" data-empty-state>` +
      `<div class="panel-head"><h2 class="section-h" id="playbooks-h">Playbooks</h2></div>` +
      `<p class="pb-disc">Published research on the patterns these rows show. Not advice.</p>` +
      `<p class="section-note">The Playbooks tab is computed on the server from the build's triage; this view carries the Congress artifact only. The seven playbooks and their sources are on <a href="/methodology/#signals-playbooks">Methodology</a>.</p>` +
      `</section>`
    );
  }
  const tip = note(
    "A playbook names published research on a pattern a row shows, with what the research found on both sides. Its numbers are the paper's own, from its own sample and years — not computed here. " +
      "Public Filings uses no prices and computes no returns, so it cannot say whether a pattern still holds. Nothing here is a recommendation.",
    { scope: "signals-pb" },
    "about",
    { trigger: "mark", name: "How to read a playbook" },
  );
  const live = PLAYBOOKS.filter((p) => p.status === "live").length;
  /* anchors: without script each jumps to its article (all of them show);
     the client shows one and marks its link `aria-current` */
  const list = PLAYBOOKS.map(
    (p) =>
      `<a class="pbi" href="#pb-${p.id}" data-pb-pick="${p.id}">` +
      `<span class="pbi-n">${esc(p.name)}</span>` +
      `<span class="pbi-s"><span class="pbi-src">${esc(p.source)}</span> <span class="pb-st pb-st-${p.status}">${esc(playbookStatusText(p, model))}</span></span></a>`,
  ).join("");
  return (
    `<section class="panel sig-pb" id="pb-section" aria-labelledby="playbooks-h">` +
    `<div class="panel-head"><h2 class="section-h" id="playbooks-h">Playbooks</h2></div>` +
    `<p class="pb-disc">Published research on the patterns these rows show. Not advice.${tip}</p>` +
    /* copy item signals-16: the list below shows each status */
    `<p class="section-note pb-count">${plural(PLAYBOOKS.length, "playbook", "playbooks")} · ${fmtInt(live)} live` +
    (model === null ? "" : ` · ${plural(model.triggers.byRow.size, "Congress row triggers", "Congress rows trigger")} one`) +
    `</p>` +
    `<div class="pbg">` +
    `<nav class="pb-nav" aria-label="Playbooks"><div class="pb-list" data-scroll-region="Playbooks · swipe for more">${list}</div></nav>` +
    `<div class="pb-arts">${PLAYBOOKS.map((p) => playbookArticleHtml(p, model, ctx, targets)).join("")}</div>` +
    `</div>` +
    `<p class="si-foot"><a href="/methodology/#signals-playbooks">Rules, citations and the leadership roster ↗</a></p>` +
    `</section>`
  );
}

/** Methodology `#signals-playbooks` (signals-v4 R27, LD15–LD17): the seven
    rules, the three Congress triggers, the citations and the leadership
    roster with its sources — every constant read from code. */
export function signalsPlaybooksMethodHtml(): string {
  const li = (s: string): string => `<li>${s}</li>`;
  const posts = new Map(LEADERSHIP_POSTS.map((p) => [p.id, p.name]));
  const roster = ROSTER.map(
    (r) =>
      `<tr><td class="c-secondary">${esc(posts.get(r.post) ?? r.post)}</td><td class="c-secondary c-flex">${esc(r.name)} <span class="mono-id">${esc(r.bioguide)}</span></td>` +
      `<td class="c-num">${esc(r.from)}${r.since ? ` (held since ${esc(r.since)})` : ""}</td><td class="c-num">${esc(r.to ?? "current")}</td>` +
      `<td class="c-secondary">${esc(r.precision === "day" ? "day" : r.precision === "congress" ? "Congress" : "year")}: ${esc(r.sourceSays)}</td>` +
      `<td class="c-secondary"><a href="${esc(r.source)}" rel="noopener" target="_blank">${esc(r.source.replace(/^https:\/\//, ""))} ↗</a> · checked ${esc(r.checked)}</td></tr>`,
  ).join("");
  const rules = PLAYBOOKS.map(
    (p) =>
      li(
        `<strong>${esc(p.name)}</strong> (${esc(p.source)} · ${esc(STATUS_WORD[p.status])} · evidence ${esc(p.grade)}). ${playbookTextHtml(p.trigger)} Horizon studied: ${esc(p.horizon)} ` +
          (p.evidence.length === 0
            ? "No published study found."
            : `Sources: ${p.evidence.map((e) => `${esc(DIR_WORD[e.dir] ?? e.dir)} — ${esc(e.cite)}, ${esc(e.venue)} (${esc(e.sample)}), <a href="${esc(e.url)}" rel="noopener" target="_blank">${esc(e.url.replace(/^https:\/\//, ""))} ↗</a>`).join("; ")}.`),
      ),
  ).join("");
  return (
    `<section class="si-method" id="signals-playbooks" aria-labelledby="signals-playbooks-h">` +
    `<h3 class="section-h" id="signals-playbooks-h">Playbooks: published research on the patterns the rows show</h3>` +
    `<p class="metho-body">The Playbooks tab on <a href="/signals/#playbooks">/signals</a> names published research on a pattern a row shows and quotes what it found, with evidence on both sides. ` +
    `The numbers are the papers' own, from their samples and years. Public Filings reads no price and computes no return, so it cannot say whether a pattern still holds; nothing here is advice.</p>` +
    `<ul class="si-method-list">` +
    li(
      `<strong>Opportunistic member buy — the rule, adapted.</strong> Cohen, Malloy &amp; Pomorski's routine test is for corporate insiders; the site adapts it to members of Congress. ` +
        `It applies to a row that is not a cluster and whose lead line is a listed-stock purchase with a ticker and a trade date. Of the member's rows without a date anomaly (any asset, any side) traded before the lead's year and filed by the row's cutoff, ` +
        `the member is unclassified without a trade in each of the ${fmtInt(CMP_YEARS)} prior calendar years, routine when one calendar month has a trade in all ${fmtInt(CMP_YEARS)}, and opportunistic otherwise. ` +
        `It triggers on an opportunistic member who traded at most ${fmtInt(BROAD_ACCOUNT_NAMES)} distinct tickers in the ${fmtInt(OPP_BREADTH_DAYS)} days before the trade (filed by the cutoff).`,
    ) +
    li(
      `<strong>Leadership trade.</strong> It triggers when any ranked line of a row is by a member who held one of the ${fmtInt(LEADERSHIP_POSTS.length)} posts of ${esc(ROSTER_STUDY)} on the line's trade date (the roster below: from its start date, inclusive, to its end, exclusive). ` +
        `The roster (v${ROSTER_VERSION}) starts ${ROSTER_FROM}: a trade before it is never classified. ${esc(ROSTER_PRECISION_TEXT)}`,
    ) +
    li(`<strong>Committee-linked trade.</strong> It triggers when a row's Cmte meter reads medium — a direct match in the committee table (<a href="#committee-direct">above</a>). When the committee inputs are not in a build it has no rows, and the tab says it is unavailable. ${esc(COMMITTEE_CAVEAT)}`) +
    li(`<strong>Best ideas and Consensus</strong> trigger on panels, not rows: the new-position leaders and Consensus on the Institutional tab state how many managers and names qualify. Opportunistic insider purchases need Form 4 data Public Filings does not hold.`) +
    `</ul>` +
    `<p class="metho-body">The seven playbooks, their rules and their sources:</p>` +
    `<ul class="si-method-list">${rules}</ul>` +
    `<p class="metho-body">The leadership roster (v${ROSTER_VERSION}, from ${ROSTER_FROM}, every row checked ${ROSTER_CHECKED} against its primary source):</p>` +
    `<div class="table-scroll"><table class="etable etable-compact">` +
    `<caption class="visually-hidden">Leadership roster, version ${ROSTER_VERSION}</caption>` +
    `<thead><tr><th scope="col" class="c-secondary" data-label="Post">Post</th><th scope="col" class="c-secondary c-flex" data-label="Member">Member</th><th scope="col" class="c-num" data-label="From">From</th><th scope="col" class="c-num" data-label="To">To</th><th scope="col" class="c-secondary" data-label="Dated by">Dated by</th><th scope="col" class="c-secondary" data-label="Source">Source</th></tr></thead>` +
    `<tbody>${roster}</tbody></table></div>` +
    `</section>`
  );
}
