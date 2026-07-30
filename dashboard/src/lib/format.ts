/* Pure, environment-agnostic helpers shared by the build-time page render
   and the client island. No Node APIs, no DOM APIs — string in, string out,
   so the SSR page and the client render rows through the same code path. */

export interface TxnRow {
  kind: "txn";
  filed: string; // YYYY-MM-DD
  traded: string | null;
  name: string; // member full_name, or filer_name_raw when unjoined
  bioguide: string | null;
  party: string; // "D" | "R" | "I" | "" (unknown / not applicable)
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
  ticker: string | null;
  side: "purchase" | "sale" | "sale_partial" | "exchange" | "other";
  owner: "self" | "spouse" | "child" | "joint" | null;
  low: number | null;
  high: number | null;
  lag: number | null; // days_to_file
  late: 0 | 1 | null;
  flags: string[];
  doc: string; // government source document URL
}

export interface PaperRow {
  kind: "paper";
  filed: string;
  name: string;
  bioguide: string | null;
  party: string;
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
  doc: string;
}

export type FeedItem = TxnRow | PaperRow;

/* ---------- columnar wire format (client dataset) ---------- */

export const DATASET_VERSION = 1;

export const TXN_COLS = [
  "filed", "traded", "name", "bioguide", "party", "state", "district",
  "chamber", "ticker", "side", "owner", "low", "high", "lag", "late",
  "flags", "doc",
] as const;

export const PAPER_COLS = [
  "filed", "name", "bioguide", "party", "state", "district", "chamber", "doc",
] as const;

export function txnToArray(r: TxnRow): unknown[] {
  return TXN_COLS.map((c) => r[c]);
}
export function txnFromArray(a: unknown[]): TxnRow {
  const r = Object.fromEntries(TXN_COLS.map((c, i) => [c, a[i]])) as unknown as TxnRow;
  r.kind = "txn";
  return r;
}
export function paperToArray(r: PaperRow): unknown[] {
  return PAPER_COLS.map((c) => r[c]);
}
export function paperFromArray(a: unknown[]): PaperRow {
  const r = Object.fromEntries(PAPER_COLS.map((c, i) => [c, a[i]])) as unknown as PaperRow;
  r.kind = "paper";
  return r;
}

/* ---------- text helpers ---------- */

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** $1K / $15K / $1M / $25M — compact statutory-boundary money. */
export function fmtMoney(n: number): string {
  const unit = n >= 1_000_000 ? [1_000_000, "M"] as const : [1_000, "K"] as const;
  const v = n / unit[0];
  const s = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  return `$${s}${unit[1]}`;
}

/** Statutory bucket floors are $X+1 ($1,001, $15,001, …) — display the $X boundary. */
function floorBoundary(low: number): number {
  return low % 1000 === 1 ? low - 1 : low;
}

/** Compact honest range label: "$1K–$15K", "Over $1M", "—" when unparsed. */
export function amountText(r: Pick<TxnRow, "low" | "high" | "flags">): string {
  if (r.low == null && r.high == null) return "—";
  if (r.low != null && r.high == null) return `Over ${fmtMoney(floorBoundary(r.low))}`;
  if (r.low == null) return `Under ${fmtMoney(r.high as number)}`;
  return `${fmtMoney(floorBoundary(r.low))}–${fmtMoney(r.high as number)}`;
}

/* ---------- range band geometry ----------
   The design's band positions are a log10 scale from $1,000 to $50,000,000
   (verified: every bucket position in the mockups matches this formula to
   within 0.1%). Open-ended and unparsed amounts render as hatch, never as a
   fake solid bar. */

const BAND_MIN = 1_000;
const BAND_MAX = 50_000_000;

function bandPos(v: number): number {
  const p = Math.log10(v / BAND_MIN) / Math.log10(BAND_MAX / BAND_MIN);
  return Math.min(1, Math.max(0, p));
}

export interface BandGeom {
  left: number; // percent 0..100
  width: number; // percent 0..100
  open: boolean; // true → hatched (open-ended or unparsed), never solid
}

export function bandGeometry(r: Pick<TxnRow, "low" | "high">): BandGeom {
  if (r.low == null && r.high == null) return { left: 0, width: 100, open: true };
  if (r.low != null && r.high == null) {
    const left = bandPos(floorBoundary(r.low)) * 100;
    return { left, width: 100 - left, open: true };
  }
  const left = r.low == null ? 0 : bandPos(floorBoundary(r.low)) * 100;
  const right = bandPos(r.high as number) * 100;
  return { left, width: Math.max(right - left, 1.5), open: false };
}

/* ---------- row field presentation ---------- */

/** Party tint class. An unmappable party is NOT painted as Independent — it
    gets its own neutral class, because "we could not read the party" and
    "this member is an Independent" are different claims. */
export function partyClass(party: string): string {
  return party === "D" ? "dem" : party === "R" ? "rep" : party === "I" ? "ind" : "unknown";
}

/** "D–CA-11" (house), "R–AL" (senate), "—" when unjoined/unknown.
    Only a positive integer district is printed; "0" is at-large, and any
    other sentinel (e.g. "-1") is omitted rather than printed as "-1". */
export function affText(r: {
  party: string;
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
}): string {
  if (!r.party && !r.state) return "—";
  const p = r.party || "?";
  if (!r.state) return p;
  if (r.chamber === "house" && r.district != null && r.district !== "") {
    const d = r.district === "0" ? "AL" : /^[1-9][0-9]*$/.test(r.district) ? r.district : null;
    if (d !== null) return `${p}–${r.state}-${d}`;
  }
  return `${p}–${r.state}`;
}

/** An unparsed side is shown as unknown, never as the named category "Other" —
    `side='other'` in this corpus always means the field did not parse. */
export function sideLabel(
  side: TxnRow["side"],
  flags: readonly string[] = [],
): { text: string; cls: string } {
  if (flags.includes("side_unparsed")) return { text: "—", cls: "unknown" };
  switch (side) {
    case "purchase": return { text: "Purchase", cls: "buy" };
    case "sale": return { text: "Sale", cls: "sell" };
    case "sale_partial": return { text: "Sale", cls: "sell" };
    case "exchange": return { text: "Exchange", cls: "neutral" };
    default: return { text: "Other", cls: "neutral" };
  }
}

/** "· partial · SP" — grammar order per the design: partial first, then owner. */
export function ownerNote(r: Pick<TxnRow, "side" | "owner">): string {
  const parts: string[] = [];
  if (r.side === "sale_partial") parts.push("partial");
  if (r.owner === "spouse") parts.push("SP");
  else if (r.owner === "child") parts.push("DC");
  else if (r.owner === "joint") parts.push("JT");
  return parts.length ? "· " + parts.join(" · ") : "";
}

/** The same qualifiers spelled out, for assistive technology and tooltips —
    "partial" and "JT" are load-bearing honesty, not decoration. */
export function ownerNoteLong(r: Pick<TxnRow, "side" | "owner">): string {
  const parts: string[] = [];
  if (r.side === "sale_partial") parts.push("partial sale");
  if (r.owner === "spouse") parts.push("spouse-owned");
  else if (r.owner === "child") parts.push("dependent-child-owned");
  else if (r.owner === "joint") parts.push("jointly owned");
  else if (r.owner === "self") parts.push("member-owned");
  return parts.join(", ");
}

export function srcLabel(doc: string): string {
  if (doc.includes("disclosures-clerk.house.gov")) return "PTR";
  if (doc.includes("efdsearch.senate.gov")) return "eFD";
  return "src";
}

/** Traded shows MM-DD when the year matches filed (design), full date otherwise. */
export function tradedText(r: Pick<TxnRow, "traded" | "filed">): string {
  if (!r.traded) return "—";
  return r.traded.slice(0, 4) === r.filed.slice(0, 4) ? r.traded.slice(5) : r.traded;
}

/* Flag chips. Styles follow the design: amber = policy-pending, solid =
   known structural condition, dashed = unparsed/unknown value. */
const FLAG_PRESENTATION: Record<string, { label: string; cls: "amber" | "solid" | "dashed" }> = {
  amendment_unresolved: { label: "amendment pending", cls: "amber" },
  missing_ticker: { label: "no ticker", cls: "solid" },
  amount_spouse_cap: { label: "spouse cap", cls: "solid" },
  amount_unparsed: { label: "amount unparsed", cls: "dashed" },
  date_missing: { label: "date missing", cls: "dashed" },
  date_anomaly: { label: "date anomaly", cls: "dashed" },
  side_unparsed: { label: "side unparsed", cls: "dashed" },
  asset_unparsed: { label: "asset unparsed", cls: "dashed" },
  capgains_unparsed: { label: "cap-gains unparsed", cls: "dashed" },
  row_incomplete: { label: "row incomplete", cls: "dashed" },
  row_orphan: { label: "row orphan", cls: "dashed" },
};

export function flagChips(
  flags: string[],
  r?: Pick<TxnRow, "low" | "high">,
): { label: string; cls: string }[] {
  // missing_ticker already renders as "—" in the ticker column; the chip
  // restates it per the design row "no ticker".
  const chips = flags
    .filter((f) => FLAG_PRESENTATION[f])
    .map((f) => FLAG_PRESENTATION[f]!);
  // An amount with no bounds must always SAY it is unknown, even when the
  // upstream flag set explains the row some other way (row_incomplete etc.) —
  // presentation is derived from the value, not from the flag vocabulary.
  if (r && r.low == null && r.high == null && !flags.includes("amount_unparsed")) {
    chips.push({ label: "amount unparsed", cls: "dashed" });
  }
  return chips;
}

/* ---------- amount filtering ----------
   A statutory range can be *indeterminate* against a threshold: an open-ended
   "Over $1,000,000" (Senate spouse cap) may be any amount above $1M, and an
   unparsed amount has no bounds at all. Neither can be ruled in OR out of
   "≥ $25M". They are classified separately so the UI can say so instead of
   asserting a confident zero. */

export type AmountVerdict = "in" | "out" | "indeterminate";

export function amountVerdict(
  r: Pick<TxnRow, "low" | "high">,
  min: number,
): AmountVerdict {
  if (min <= 0) return "in";
  if (r.low == null && r.high == null) return "indeterminate";
  if (r.low != null && r.low > min) return "in";
  // open-ended above a floor at or below the threshold: unknowable
  if (r.high == null && r.low != null) return "indeterminate";
  return "out";
}

/* ---------- merge + pagination (shared so SSR page 1 === client page 1) ---- */

export const PAGE_SIZE = 50;

/** Merge transactions with paper filings by filed date (desc); transactions
    first within a date. Both inputs must already be sorted filed-desc. */
export function mergeFeed(txns: TxnRow[], paper: PaperRow[]): FeedItem[] {
  const out: FeedItem[] = [];
  let i = 0;
  let j = 0;
  while (i < txns.length || j < paper.length) {
    const t = txns[i];
    const p = paper[j];
    if (t === undefined) { out.push(p as PaperRow); j++; continue; }
    if (p === undefined) { out.push(t); i++; continue; }
    // txns win ties so a paper row sits below same-day transactions (design).
    if (t.filed >= p.filed) { out.push(t); i++; }
    else { out.push(p); j++; }
  }
  return out;
}

/** Page index each merged item belongs to. Transactions paginate PAGE_SIZE per
    page; a paper (needs-OCR) filing belongs to the page of the transactions it
    sits among — i.e. the page of however many transactions precede it. Every
    item therefore has exactly one page, including a paper row that no
    transaction precedes (a paper-only result set, or a build whose newest
    filing arrived unparsed). Dropping those was a real defect: the rows are
    "retained and counted" per §5.2 and must be reachable. */
function itemPage(txnSeenBefore: number): number {
  return Math.floor(txnSeenBefore / PAGE_SIZE);
}

/** Slice a merged feed into page `page` (0-based). */
export function pageSlice(merged: FeedItem[], page: number): FeedItem[] {
  const out: FeedItem[] = [];
  let txnSeen = 0;
  for (const item of merged) {
    const p = itemPage(txnSeen);
    if (p > page) break;
    if (p === page) out.push(item);
    if (item.kind === "txn") txnSeen++;
  }
  return out;
}

/** Total pages for a merged feed. Paper-only result sets still have one page. */
export function pageCount(txnCount: number, paperCount = 0): number {
  const pages = Math.ceil(txnCount / PAGE_SIZE);
  return Math.max(pages, txnCount + paperCount > 0 ? 1 : 0);
}

/* ---------- row renderers (single source for SSR + client) ---------- */

export interface RenderCtx {
  /** bioguide ids watched in this browser; SSR passes an empty set. */
  watched: ReadonlySet<string>;
}

function memberHref(bioguide: string): string {
  return `/congress/members/${esc(encodeURIComponent(bioguide))}/`;
}
function tickerHref(ticker: string): string {
  return `/congress/tickers/${esc(encodeURIComponent(ticker))}/`;
}

/** Source-document anchor. Scheme-allowlisted: the URL ultimately traces to a
    scraped government page, so anything but https is stated as unlinkable
    rather than rendered as a live href. */
function srcCellHtml(doc: string, extraClass = ""): string {
  const src = srcLabel(doc);
  const cls = `cell cell-src${extraClass ? " " + extraClass : ""}`;
  if (!doc.startsWith("https://")) {
    return `<div class="${cls}"><span class="src-missing" title="source URL not usable">${src}</span></div>`;
  }
  return (
    `<div class="${cls}"><a href="${esc(doc)}" rel="noopener" target="_blank"` +
    ` aria-label="source document (${src}) — opens in a new tab">${src}&nbsp;↗</a></div>`
  );
}

function starHtml(bioguide: string | null, name: string, ctx: RenderCtx): string {
  if (!bioguide) {
    return `<button class="star-btn" disabled aria-hidden="true" tabindex="-1">☆</button>`;
  }
  const on = ctx.watched.has(bioguide);
  return (
    `<button class="star-btn" data-watch="${esc(bioguide)}" aria-pressed="${on}"` +
    ` aria-label="Watch ${esc(name)} — saved in this browser only">${on ? "★" : "☆"}</button>`
  );
}

function memberCellHtml(r: {
  name: string; bioguide: string | null; party: string;
  state: string | null; district: string | null; chamber: "house" | "senate";
}): string {
  const aff = affText(r);
  const affCls = partyClass(r.party);
  if (r.bioguide) {
    return (
      `<a href="${memberHref(r.bioguide)}">${esc(r.name)}</a>` +
      ` <span class="aff ${affCls}">${esc(aff)}</span>`
    );
  }
  // unjoined filer: name as printed on the filing, dotted underline + dagger
  return (
    `<a href="#feed-footnote" class="unjoined" title="filer not yet joined to a member record — name as printed on the filing">${esc(r.name)}</a>` +
    `<sup>†</sup> <span class="aff ${affCls}">${esc(aff)}</span>`
  );
}

/** Days-to-file affordance. A negative lag means the filing predates the
    stated trade date — an anomaly, named as one, never printed as "+-320d". */
export function lagHtml(r: Pick<TxnRow, "lag" | "late">): string {
  if (r.lag != null && r.lag < 0) {
    return `<span class="lag lag-anomaly" title="filed before the stated trade date">filed −${Math.abs(r.lag)}d before trade</span>`;
  }
  if (r.late === 1) {
    return r.lag == null
      ? `<span class="lag-late">LATE</span>`
      : `<span class="lag-late">LATE·${r.lag}d</span>`;
  }
  if (r.lag != null) return `<span class="lag">+${r.lag}d</span>`;
  return `<span class="lag" title="days to file unknown">—</span>`;
}

export function txnRowHtml(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amount = amountText(r);
  const amountUnknown = r.low == null && r.high == null;
  const band = bandGeometry(r);
  const chips = flagChips(r.flags, r);
  const traded = tradedText(r);
  const spouseCapDagger = r.flags.includes("amount_spouse_cap")
    ? `<sup class="dagger" title="disclosed only as an open-ended cap">‡</sup>`
    : "";
  const tickerHtml = r.ticker
    ? `<a href="${tickerHref(r.ticker)}">${esc(r.ticker)}</a>`
    : `<span class="none">—<span class="visually-hidden"> no ticker disclosed</span></span>`;
  const amountSpoken = amountUnknown ? "not disclosed in a parseable range" : amount;

  return `<div class="feed-row feed-grid-cols" role="listitem">
<div class="cell cell-star">${starHtml(r.bioguide, r.name, ctx)}</div>
<div class="cell cell-filed"><span class="visually-hidden">Filed </span>${esc(r.filed)}</div>
<div class="row-line1">
<div class="cell cell-member"><span class="visually-hidden">Member </span>${memberCellHtml(r)}</div>
<div class="cell cell-ticker"><span class="visually-hidden">Ticker </span>${tickerHtml}</div>
<div class="cell cell-side ${side.cls}"><span class="visually-hidden">Side </span>${esc(side.text)}${
    owner
      ? ` <span class="owner-note" title="${esc(ownerLong)}">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
      : ""
  }</div>
</div>
<div class="row-line2">
<div class="cell cell-traded"><span class="visually-hidden">Traded </span><span class="traded-date">${esc(traded)}</span><span class="mobile-dates" aria-hidden="true">${esc(traded)} → ${esc(r.filed.slice(5))}</span> ${lagHtml(r)}</div>
<div class="cell cell-amount${amountUnknown ? " unknown" : ""}"><span class="visually-hidden">Amount </span><span aria-hidden="true">${esc(amount)}</span><span class="visually-hidden">${esc(amountSpoken)}</span>${spouseCapDagger}</div>
<div class="cell cell-range"><div class="band" aria-hidden="true"><div class="band-fill${band.open ? " open" : ""}" style="left:${band.left.toFixed(1)}%;width:${band.width.toFixed(1)}%"></div></div>${chips
    .map((c) => `<span class="flag ${c.cls}">${esc(c.label)}</span>`)
    .join("")}</div>
${srcCellHtml(r.doc)}
</div>
</div>`;
}

export function paperRowHtml(r: PaperRow, ctx: RenderCtx): string {
  return `<div class="feed-row paper feed-grid-cols" role="listitem">
<div class="cell cell-star">${starHtml(r.bioguide, r.name, ctx)}</div>
<div class="cell cell-filed"><span class="visually-hidden">Filed </span>${esc(r.filed)}</div>
<div class="cell paper-main">${
    r.bioguide
      ? `<a class="who" href="${memberHref(r.bioguide)}">${esc(r.name)}</a>`
      : `<span class="who">${esc(r.name)}</span>`
  } <span class="aff ${partyClass(r.party)}">${esc(affText(r))}</span><span class="chip-ocr">paper filing — needs OCR</span><span class="paper-note">transactions filed on paper; retained and counted, not yet machine-readable</span></div>
${srcCellHtml(r.doc)}
</div>`;
}

export function feedItemHtml(item: FeedItem, ctx: RenderCtx): string {
  return item.kind === "txn" ? txnRowHtml(item, ctx) : paperRowHtml(item, ctx);
}
