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
  /** asset name as printed on the filing (producer-parsed); null when absent */
  asset: string | null;
  /** producer asset-type value VERBATIM (source vocabulary, e.g. "Stock",
      "ST", "Municipal Security"); null = the source did not state one. The
      client never classifies asset names — that would be an unsourced
      invention (plan F-6). */
  assetType: string | null;
  /** producer txn_id — the stable row identity signals and sorts key on */
  txnId: string;
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

/** One stat tile (StatBadge, G-grammar shared component). Defined here so the
    markup renderer `statTiles` and the build-time tile derivations share one
    shape; `data.ts` re-exports it for its existing callers. */
export interface StatTile {
  value: string;
  unit?: string;
  label: string;
  title?: string; // full breakdown for the tooltip
  muted?: boolean;
}

/* ---------- columnar wire format (client dataset) ---------- */

/* v2 (B-7): `asset` + `assetType` join the wire format. The producer feed
   already carried both (`build.py` `_FEED_COLUMNS`); this is the CLIENT
   contract catching up — every consumer round-trips through
   txnToArray/txnFromArray, and every payload embeds this version, so a
   stale cached dataset is refused (classifyResponse), never half-read. */
export const DATASET_VERSION = 2;

export const TXN_COLS = [
  "filed", "traded", "name", "bioguide", "party", "state", "district",
  "chamber", "ticker", "side", "owner", "low", "high", "lag", "late",
  "flags", "doc", "asset", "assetType", "txnId",
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

/* ---------- full-feed dataset classifier (B-7, review F3) ----------
   The entity endpoints already refuse a version-mismatched payload
   (classifyResponse); the FULL feed dataset needs the same discipline or a
   cached v1 body is decoded with v2 column offsets — asset fields and txnId
   silently undefined. One classifier, used by every full-dataset consumer
   (feed client, watchlist client). */

export type DatasetClassification =
  | { outcome: "ok"; txns: unknown[][]; paper: unknown[][] }
  | { outcome: "version_mismatch"; got: unknown }
  | { outcome: "bad_payload"; detail: string };

function colsMatch(got: unknown, want: readonly string[]): boolean {
  return (
    Array.isArray(got) && got.length === want.length && got.every((c, i) => c === want[i])
  );
}

export function classifyDataset(body: unknown): DatasetClassification {
  if (typeof body !== "object" || body === null) {
    return { outcome: "bad_payload", detail: "dataset is not a JSON object" };
  }
  const d = body as Record<string, unknown>;
  if (typeof d.dataset_version !== "number") {
    return { outcome: "bad_payload", detail: "dataset has no dataset_version" };
  }
  if (d.dataset_version !== DATASET_VERSION) {
    return { outcome: "version_mismatch", got: d.dataset_version };
  }
  if (!colsMatch(d.txn_cols, TXN_COLS) || !colsMatch(d.paper_cols, PAPER_COLS)) {
    return { outcome: "bad_payload", detail: "dataset column lists do not match this build's contract" };
  }
  if (!Array.isArray(d.txns) || !Array.isArray(d.paper)) {
    return { outcome: "bad_payload", detail: "dataset is missing its row arrays" };
  }
  const badTxn = (d.txns as unknown[]).findIndex(
    (r) => !Array.isArray(r) || r.length !== TXN_COLS.length,
  );
  if (badTxn !== -1) {
    return { outcome: "bad_payload", detail: `txn row ${badTxn} has the wrong width` };
  }
  const badPaper = (d.paper as unknown[]).findIndex(
    (r) => !Array.isArray(r) || r.length !== PAPER_COLS.length,
  );
  if (badPaper !== -1) {
    return { outcome: "bad_payload", detail: `paper row ${badPaper} has the wrong width` };
  }
  return { outcome: "ok", txns: d.txns as unknown[][], paper: d.paper as unknown[][] };
}

/* ---------- text helpers ---------- */

/** Parser-side ticker hygiene (B-7, F-5): NFC + outer-whitespace trim, empty
    → null. The Senate corpus delivered tickers with leading newlines/spaces
    that produced `/tickers/--%0A%20…AMCR/` URLs. Trim-only, deliberately: a
    ticker with INTERIOR whitespace is not repaired into a listed symbol (that
    would invent identity) — it stays as-is and `pathSafeTicker` routes it to
    the /e/ fallback at render time, the defensive half of the same gate. */
export function normalizeTicker(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.normalize("NFC").trim();
  return t === "" ? null : t;
}

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

/** Compact USD for institutional aggregate values ($7.5K, $12.4B, $1.4T).
    Input is the aggregate's integer dollars; sub-$1K prints exact. */
export function fmtUsd(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const scale = (div: number, suffix: string): string => {
    const v = abs / div;
    const s = v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
    return `${sign}$${s}${suffix}`;
  };
  if (abs >= 1_000_000_000_000) return scale(1_000_000_000_000, "T");
  if (abs >= 1_000_000_000) return scale(1_000_000_000, "B");
  if (abs >= 1_000_000) return scale(1_000_000, "M");
  if (abs >= 1_000) return scale(1_000, "K");
  return `${sign}$${fmtInt(abs)}`;
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

/** No-ticker cell (B-7/F-6): the 16.1% of rows without a ticker used to show a
    bare "—" — but the filing names the asset. Render the asset name AS FILED
    (with its verbatim source asset-type value, when stated) instead of
    pretending the row is empty. No classification happens here: the type
    string is the producer's, shown verbatim or not at all. */
export function assetNameCell(r: Pick<TxnRow, "asset" | "assetType">): string {
  if (r.asset == null || r.asset.trim() === "") {
    return `<span class="none">—<span class="visually-hidden"> no ticker disclosed</span></span>`;
  }
  const name = r.asset.trim();
  const short = name.length > 40 ? name.slice(0, 37) + "…" : name;
  const type = r.assetType != null && r.assetType.trim() !== "" ? r.assetType.trim() : null;
  /* R5. The visible string is truncated at 40 characters and then clipped
     again by the cell (`.cell-ticker`/`.c-ticker` are 66px columns; 40
     characters of 12.5px mono is ~300px, which used to paint straight over the
     side cell). The FULL name therefore has to live somewhere that is real
     text, not a tooltip: `title` alone would make the identity of the asset
     tooltip-only, which the plan forbids for anything honesty-bearing, and
     what was traded is exactly that. So the visible span is aria-hidden and
     the accessible name carries the whole string. */
  return (
    `<span class="asset-name" title="${esc(name)}${type ? ` · asset type as filed: ${esc(type)}` : ""}">` +
    `<span aria-hidden="true">${esc(short)}</span>` +
    `<span class="visually-hidden">${esc(name)}${type ? ` — asset type as filed: ${esc(type)}` : ""} — asset as filed, no ticker disclosed</span></span>`
  );
}

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
  // Producer institutional flags (inst_agg.py, Locked #8 / docs/qoq-presentation.md):
  // source facts and parse defects in the same two visual classes as above.
  value_undisclosed_one_side: { label: "value undisclosed one side", cls: "dashed" },
  shares_unit_mismatch: { label: "unit mismatch", cls: "dashed" },
  classified_by_value: { label: "classified by value", cls: "dashed" },
  change_kind_undeterminable: { label: "change n/c", cls: "dashed" },
  identity_reconciled_by_cusip: { label: "cusip-reconciled", cls: "dashed" },
  issuer_from_cusip6: { label: "issuer from CUSIP-6", cls: "dashed" },
  issuer_from_name: { label: "issuer from name", cls: "dashed" },
  concentration_unavailable: { label: "concentration unavailable", cls: "dashed" },
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

/* ---------- R10: flags a reader can read ----------

   Two defects, one renderer.

   #11 "Flag slugs as UI text". An unknown flag used to paint its machine name
   verbatim — `a_flag_from_the_future` — straight into the page. Fail-visible was
   right; spelling the identifier at the reader was not. The warning is now
   plain English and GENERIC, and the raw token moves to the provenance layer:
   real text in the accessibility tree, exactly once, never a tooltip (§8 forbids
   anything honesty-bearing being tooltip-only, and the WARNING is the
   honesty-bearing half — the slug is provenance for whoever files the bug).

   #12 "Universal badge carries no information". A badge on nearly every row is
   noise: measured on the real tree, `no ticker` sits on 50 of 51 rows (98%) on
   six member pages. It is stated ONCE above the table instead, and suppressed
   from the rows it would otherwise decorate. */

/** What an unrecognised upstream flag says to a reader. Generic on purpose: the
    site cannot describe a condition it has never seen, and guessing would be
    worse than admitting the gap. */
export const UNKNOWN_FLAG_LABEL = "unrecognised source condition";

/** A flag on at least this share of the table's rows states itself once, at
    table level, rather than on every row.

    **1.0, not 0.9, and the difference is the whole design.** At exactly 100% the
    hoist is information-preserving: "every row below carries X" is literally
    true and removing the badge deletes nothing. Below 100% it is not — the rows
    that LACK the flag are the informative ones, and suppressing the badge on the
    majority erases the only thing distinguishing them. A note reading "every
    row" over a table where one row differs is simply false.

    Measured on the real tree: 23 member tables carry `no ticker` on 50 of 50
    rows, so this fires on today's corpus rather than being a mechanism waiting
    for data that never arrives. Six more sit in the 90–99% band and keep their
    per-row badges deliberately. */
export const UNIVERSAL_FLAG_SHARE = 1.0;

/** Below this many rows there is no "universal" worth hoisting — a reader can
    see the whole table at a glance, and a caveat line above three rows is more
    chrome than the badges it replaces. */
export const UNIVERSAL_FLAG_MIN_ROWS = 8;

/** Flags carried by ≥ `UNIVERSAL_FLAG_SHARE` of `rows`, in stable order.

    Pass EVERY row the table can page through, not the current page. The table
    re-renders its rows client-side when paging (`entity-client.ts`), so a
    per-page set would let page 2's badges contradict the note left above them
    by page 1. Computed over the whole table, the statement holds on every
    page and the client needs no recomputation to stay honest. */
export function universalFlags(rows: readonly (readonly string[])[]): string[] {
  if (rows.length < UNIVERSAL_FLAG_MIN_ROWS) return [];
  const counts = new Map<string, number>();
  for (const flags of rows) {
    for (const f of new Set(flags)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n / rows.length >= UNIVERSAL_FLAG_SHARE)
    .map(([f]) => f)
    .sort();
}

/** The table-level statement for hoisted flags, or "" when there are none. */
export function universalFlagNote(flags: readonly string[]): string {
  if (flags.length === 0) return "";
  const known = flags.filter((f) => FLAG_PRESENTATION[f]).map((f) => FLAG_PRESENTATION[f]!.label);
  const unknown = flags.filter((f) => !FLAG_PRESENTATION[f]);
  const labels = [...known, ...(unknown.length > 0 ? [UNKNOWN_FLAG_LABEL] : [])];
  const provenance =
    unknown.length > 0
      ? `<span class="visually-hidden flag-raw"> (verbatim: ${esc(unknown.join(", "))})</span>`
      : "";
  return (
    `<p class="caveat-line table-caveat">` +
    `Every row below carries <strong>${esc(labels.join(", "))}</strong>${provenance}` +
    ` — stated once here rather than repeated on every row.</p>`
  );
}

/* ---------- FlagTag (G6): one canonical markup renderer ----------
   Known flags render via the registry; an UNKNOWN flag stays fail-visible — a
   new upstream flag must never silently disappear from the page — but as a
   generic warning, with its machine name in the provenance layer. */
export function flagTags(
  flags: string[],
  r?: Pick<TxnRow, "low" | "high">,
  opts: { stated?: readonly string[] } = {},
): string {
  /* Flags already stated at table level are suppressed HERE rather than
     filtered by the caller, so every render site inherits the behaviour and
     none can forget it. */
  const stated = new Set(opts.stated ?? []);
  const shown = flags.filter((f) => !stated.has(f));
  const known = flagChips(shown, r)
    .map((c) => `<span class="flag ${c.cls}">${esc(c.label)}</span>`)
    .join("");
  const unknown = shown.filter((f) => !FLAG_PRESENTATION[f]);
  const unknownHtml =
    unknown.length === 0
      ? ""
      : `<span class="flag dashed">${esc(UNKNOWN_FLAG_LABEL)}</span>` +
        `<span class="visually-hidden flag-raw"> — reported by the source as` +
        ` ${esc(unknown.join(", "))}</span>`;
  return known + unknownHtml;
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
  // unknown floor with a known ceiling ("Under $15K"): the floor is what the
  // threshold compares against, so this cannot be ruled out either
  if (r.low == null) return "indeterminate";
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

/** Total pages for a merged feed.

    Deliberately a walk over the merged feed, NOT a formula over counts: how
    many pages exist depends on WHERE the paper rows sit, which counts cannot
    express. With 100 transactions, a paper row before them needs 2 pages and a
    paper row after them needs 3 — and padding unconditionally would render a
    blank page that the caller's empty-state guard turns into a false
    "no disclosures match". Anything that drops a row here is a §5.2 violation:
    the count line asserts the filing exists, so a page must reach it. */
export function pageCountFor(merged: readonly FeedItem[]): number {
  if (merged.length === 0) return 0;
  let txnSeen = 0;
  let max = 0;
  for (const item of merged) {
    const p = itemPage(txnSeen);
    if (p > max) max = p;
    if (item.kind === "txn") txnSeen++;
  }
  return max + 1;
}

/* ---------- count line (one string, every sink) ----------
   See docs/pagination-and-counts.md. Invariant I6: one assembled string reaches
   every sink, so a fragment cannot reach some readers and not others (an
   earlier per-sink assembly dropped the indeterminate-amount disclosure at
   ≤720px). Invariant I5: a fragment describing THIS PAGE is computed from the
   page's own contents — never from `page × PAGE_SIZE` arithmetic, which is what
   produced "51–50 of 50 transactions" on a page holding only paper rows. */

export interface CountInputs {
  page: number;
  /** transactions matching the current filters (whole result set) */
  txnMatched: number;
  /** paper filings matching the current filters (whole result set) */
  paperMatched: number;
  /** transactions rendered on THIS page — page-local, per I5 */
  txnOnPage: number;
  /** paper filings rendered on THIS page — page-local, per I5 */
  paperOnPage: number;
  /** transactions in the whole default view */
  txnTotal: number;
  /** rows whose amount can be neither ruled in nor out of the threshold */
  indeterminate: number;
}

export function feedCountText(i: CountInputs): string {
  let txnPart: string;
  if (i.txnMatched === 0) {
    txnPart = `0 of ${fmtInt(i.txnTotal)} transactions`;
  } else if (i.txnOnPage === 0) {
    // A reachable page can hold only trailing paper filings; a numeric range
    // would have to invert to describe it.
    txnPart = `no transactions on this page of ${fmtInt(i.txnMatched)}`;
  } else {
    const lo = i.page * PAGE_SIZE + 1;
    const hi = Math.min(lo + i.txnOnPage - 1, i.txnMatched);
    txnPart = `${fmtInt(lo)}–${fmtInt(hi)} of ${fmtInt(i.txnMatched)} transactions`;
  }
  const paperPart =
    i.paperMatched === 0
      ? ""
      : ` · ${fmtInt(i.paperMatched)} paper ${i.paperMatched === 1 ? "filing" : "filings"}` +
        (i.paperOnPage > 0 ? ` (${fmtInt(i.paperOnPage)} here)` : "");
  const unknownPart =
    i.indeterminate === 0 ? "" : ` · ${fmtInt(i.indeterminate)} amount not comparable`;
  return txnPart + paperPart + unknownPart;
}

/* ---------- row renderers (single source for SSR + client) ---------- */

export interface RenderCtx {
  /** bioguide ids watched in this browser; SSR passes an empty set. */
  watched: ReadonlySet<string>;
  /** tickers watched in this browser (watchlist v2); optional for old callers. */
  watchedTickers?: ReadonlySet<string>;
  /** Entities cut by the page budget (ARCHITECTURE §12.1): links to them go to
      the generic client route /e/?k=… instead of a canonical page that was not
      emitted. Empty/absent in ordinary builds — the dev extract sits far inside
      every budget — so behavior is unchanged unless a cut actually happened. */
  cutMembers?: ReadonlySet<string>;
  cutTickers?: ReadonlySet<string>;
}

export function memberHref(bioguide: string): string {
  return `/congress/members/${esc(encodeURIComponent(bioguide))}/`;
}
/** Canonical ticker links go to the unified /tickers/{t}/ page (Locked #4);
    the deep congressional view links onward from there. */
export function tickerHref(ticker: string): string {
  return `/tickers/${esc(encodeURIComponent(ticker))}/`;
}
export function congressTickerHref(ticker: string): string {
  return `/congress/tickers/${esc(encodeURIComponent(ticker))}/`;
}
/** Whether a ticker can round-trip as a raw Astro static-route param.
 *
 * The first full Senate corpus delivered a "ticker" containing a literal
 * newline; a param with raw whitespace dies at build time with
 * NoMatchingStaticPathFound on the route's own emitted key. Page routes use
 * the raw ticker as their param, so they filter on this; DATA routes never
 * need it — `tickerDataKey` escapes every unsafe byte, so every ticker keeps
 * its endpoint (Locked #13) and the /e/ fallback keeps working.
 */
export function pathSafeTicker(ticker: string): boolean {
  // ':' was allowed here briefly (it IS page-safe for a Linux build and a URL)
  // — but actions/upload-artifact refuses any file whose PATH contains a colon
  // (Windows-invalid chars), and the deploy travels as an artifact. Proven on
  // the runner: "The path for one of the files in artifact is not valid:
  // /site/congress/tickers/CRYPTO:BTC/index.html". Colon tickers ride the /e/
  // fallback like every other path-hostile form; their DATA endpoints are
  // unaffected (tickerDataKey escapes ':' to ~3A).
  return (
    ticker.length > 0 &&
    ticker.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ticker)
  );
}

export function genericEntityHref(kind: "m" | "t", key: string): string {
  return `/e/?k=${kind}:${esc(encodeURIComponent(key))}`;
}
/** Budget-aware link target: canonical page when prerendered, /e/ when cut. */
export function memberHrefFor(bioguide: string, ctx: RenderCtx): string {
  return ctx.cutMembers?.has(bioguide) ? genericEntityHref("m", bioguide) : memberHref(bioguide);
}
export function tickerHrefFor(ticker: string, ctx: RenderCtx): string {
  // Path-unsafe tickers ride the same fallback as budget-cut ones: the /e/
  // client page, whose data endpoint exists for EVERY ticker (Locked #13).
  return ctx.cutTickers?.has(ticker) || !pathSafeTicker(ticker)
    ? genericEntityHref("t", ticker)
    : tickerHref(ticker);
}

/** SrcLink (G7): source-document anchor. Scheme-allowlisted: the URL
    ultimately traces to a scraped government page, so anything but https is
    stated as unlinkable rather than rendered as a live href. */
export function srcLink(doc: string, extraClass = ""): string {
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

/** SrcLink, aggregate form (G7): derived rows carry "derived ·§" resolving to
    the printed derivation footnote, plus the primary-source link the row's
    identity supports (an EDGAR filer page — a real URL, never a fabricated
    per-document link the aggregate does not publish). */
export function srcLinkDerived(footnoteHref: string, edgarUrl: string | null): string {
  const marker = `<a class="src-derived" href="${esc(footnoteHref)}">derived&nbsp;·§</a>`;
  if (!edgarUrl || !edgarUrl.startsWith("https://")) {
    return `<div class="cell cell-src">${marker}</div>`;
  }
  return (
    `<div class="cell cell-src">${marker} <a href="${esc(edgarUrl)}" rel="noopener" target="_blank"` +
    ` aria-label="filer on SEC EDGAR — opens in a new tab">EDGAR&nbsp;↗</a></div>`
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
}, ctx: RenderCtx): string {
  const aff = affText(r);
  const affCls = partyClass(r.party);
  if (r.bioguide) {
    return (
      `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` +
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

/** RangeBand (G1): the fixed log-scale band. Open-ended and unparsed amounts
    render as hatch, never a fake solid bar. */
export function rangeBand(r: Pick<TxnRow, "low" | "high">): string {
  const band = bandGeometry(r);
  return `<div class="band" aria-hidden="true"><div class="band-fill${band.open ? " open" : ""}" style="left:${band.left.toFixed(1)}%;width:${band.width.toFixed(1)}%"></div></div>`;
}

/** DualDate (G2): traded + filed + lag, one cell. Both dates stay in the
    accessibility tree at every viewport; the mobile fold shows the combined
    "traded → filed" string instead of removing either date. */
export function dualDate(r: Pick<TxnRow, "traded" | "filed" | "lag" | "late">): string {
  const traded = tradedText(r);
  return `<div class="cell cell-traded"><span class="visually-hidden">Traded </span><span class="traded-date">${esc(traded)}</span><span class="mobile-dates" aria-hidden="true">${esc(traded)} → ${esc(r.filed.slice(5))}</span> ${lagHtml(r)}</div>`;
}

export function txnRowHtml(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amount = amountText(r);
  const amountUnknown = r.low == null && r.high == null;
  const spouseCapDagger = r.flags.includes("amount_spouse_cap")
    ? `<sup class="dagger" title="disclosed only as an open-ended cap">‡</sup>`
    : "";
  const tickerHtml = r.ticker
    ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
    : assetNameCell(r);
  const amountSpoken = amountUnknown ? "not disclosed in a parseable range" : amount;

  return `<div class="feed-row feed-grid-cols" role="listitem">
<div class="cell cell-star">${starHtml(r.bioguide, r.name, ctx)}</div>
<div class="cell cell-filed"><span class="visually-hidden">Filed </span>${esc(r.filed)}</div>
<div class="row-line1">
<div class="cell cell-member"><span class="visually-hidden">Member </span>${memberCellHtml(r, ctx)}</div>
<div class="cell cell-ticker"><span class="visually-hidden">Ticker </span>${tickerHtml}</div>
<div class="cell cell-side ${side.cls}"><span class="visually-hidden">Side </span>${esc(side.text)}${
    owner
      ? ` <span class="owner-note" title="${esc(ownerLong)}">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
      : ""
  }</div>
</div>
<div class="row-line2">
${dualDate(r)}
<div class="cell cell-amount${amountUnknown ? " unknown" : ""}"><span class="visually-hidden">Amount </span><span aria-hidden="true">${esc(amount)}</span><span class="visually-hidden">${esc(amountSpoken)}</span>${spouseCapDagger}</div>
<div class="cell cell-range">${rangeBand(r)}${flagTags(r.flags, r)}</div>
${srcLink(r.doc)}
</div>
</div>`;
}

export function paperRowHtml(r: PaperRow, ctx: RenderCtx): string {
  return `<div class="feed-row paper feed-grid-cols" role="listitem">
<div class="cell cell-star">${starHtml(r.bioguide, r.name, ctx)}</div>
<div class="cell cell-filed"><span class="visually-hidden">Filed </span>${esc(r.filed)}</div>
<div class="cell paper-main">${
    r.bioguide
      ? `<a class="who" href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>`
      : `<span class="who">${esc(r.name)}</span>`
  } <span class="aff ${partyClass(r.party)}">${esc(affText(r))}</span><span class="chip-ocr">paper filing — needs OCR</span><span class="paper-note">transactions filed on paper; retained and counted, not yet machine-readable</span></div>
${srcLink(r.doc)}
</div>`;
}

export function feedItemHtml(item: FeedItem, ctx: RenderCtx): string {
  return item.kind === "txn" ? txnRowHtml(item, ctx) : paperRowHtml(item, ctx);
}

/* ---------- TerminusRow (G3) ---------- */

/** A truncated list ends in a dashed terminus row that NAMES the truncation's
    author — the source, or Public Filings itself for our own cuts. Never a bare
    "show more" implying completeness. `html` is pre-escaped by the caller. */
export function terminusRow(opts: {
  author: "source" | "populus";
  html: string;
}): string {
  const label = opts.author === "source" ? "Truncated by the source." : "Truncated by Public Filings.";
  return (
    `<div class="terminus" data-terminus-author="${opts.author}">` +
    `<span class="terminus-author">${label}</span> ${opts.html}</div>`
  );
}

/* ---------- FootnoteBlock (G5) ---------- */

export interface FootnoteEntry {
  /** printed marker: †, ‡, §, n/c, or a page-scoped suffixed form (†v, ‡u…) */
  mark: string;
  /** pre-escaped body html for the line */
  html: string;
}

/** Marker registry → printed footnote lines. No tooltip-only channel: every
    marker used on a surface resolves to a line here, and the block prints. */
export function footnoteBlock(
  entries: FootnoteEntry[],
  opts: { id?: string; layout?: "inline" | "stacked"; cls?: string } = {},
): string {
  if (entries.length === 0) return "";
  const layout = opts.layout ?? "stacked";
  const cls = opts.cls ?? "feed-footnote";
  const idAttr = opts.id ? ` id="${esc(opts.id)}"` : "";
  const line = (e: FootnoteEntry): string =>
    `<span class="dagger">${esc(e.mark)}</span> ${e.html}`;
  if (layout === "inline") {
    return `<div class="${cls}"${idAttr}>${entries.map(line).join(" &nbsp;&nbsp;\n")}</div>`;
  }
  return `<div class="${cls} footnotes-stacked"${idAttr}>${entries
    .map((e) => `<div class="footnote-line">${line(e)}</div>`)
    .join("\n")}</div>`;
}

/* ---------- StatBadge / stat tiles ---------- */

/** One tile grammar site-wide: value (+unit) over an uppercase label, full
    breakdown in the title attribute AND available to assistive tech. */
export function statTiles(
  tiles: StatTile[],
  opts: { label?: string; compact?: boolean } = {},
): string {
  const aria = opts.label ?? "Statistics";
  const cls = opts.compact ? "tiles tiles-entity" : "tiles";
  const tile = (t: StatTile): string =>
    `<div class="tile" role="listitem"${t.title ? ` title="${esc(t.title)}"` : ""}>` +
    `<div class="tile-value${t.muted ? " muted" : ""}">${esc(t.value)}${
      t.unit ? `<span class="unit">${esc(t.unit)}</span>` : ""
    }</div>` +
    `<div class="tile-label">${esc(t.label)}</div>` +
    (t.title ? `<span class="visually-hidden">${esc(t.title)}</span>` : "") +
    `</div>`;
  return `<div class="${cls}" role="list" aria-label="${esc(aria)}">${tiles.map(tile).join("\n")}</div>`;
}

/* ---------- watch star (watchlist v2: members + tickers) ---------- */

/** Entity-header watch star. `data-watch-kind`/`data-watch-key` drive the
    shared v2 store; copy states the storage locality per the design. */
export function watchStarHtml(
  kind: "member" | "ticker",
  key: string,
  name: string,
  on: boolean,
): string {
  return (
    `<button class="watch-btn" data-watch-kind="${kind}" data-watch-key="${esc(key)}"` +
    ` aria-pressed="${on}" aria-label="Watch ${esc(name)} — saved in this browser only">` +
    `<span class="watch-glyph" aria-hidden="true">${on ? "★" : "☆"}</span>` +
    `<span class="watch-note">${on ? "watching · saved on this device" : "watch"}</span></button>`
  );
}

/* ================================================================================
   Institutional shared primitives — ONE definition each (QA M2-8 M7).

   Three agents wrote `holdings.ts` and `activity.ts` in parallel into one
   worktree and produced six duplicated helper pairs. Two of them CONTRADICTED
   each other under comments claiming the same rule, and neither divergence was
   visible to any test. The lesson recorded from that seam is to name the shared
   module BEFORE the fan-out, not after — this is that module.
   ============================================================================ */

/** Days since the UTC epoch for a strict `YYYY-MM-DD`, or NULL.

    ONE date parser. The two copies anchored differently — `/^\d{4}-\d{2}-\d{2}/`
    (prefix) versus `/^(\d{4})-(\d{2})-(\d{2})$/` (whole string) — so a value
    like `"2026-03-31T00:00:00Z"` parsed in one module and was NULL in the other,
    and the same row could carry a lag on one surface and "—" on the next.
    Anchored WHOLE here: a timestamp is not a report date, and silently taking
    its prefix is a guess. */
export function utcDayNumber(iso: string | null | undefined): number | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

/** A real, canonical `YYYY-MM-DD` calendar date — not merely the SHAPE of one.
    `utcDayNumber` accepts `2026-02-30` and `0000-00-00` because `Date.UTC`
    silently rolls them over; a date that decides whether a question is
    ANSWERABLE (the committee validity window) must round-trip exactly, or
    corrupt bounds can turn unsupported dates into known-none answers
    (review c2r2-F2). */
export function isCanonicalDate(iso: unknown): iso is string {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

/** Elapsed reporting lag in days: `filed_date − period_of_report`. NULL when
    either date is missing or unparseable — never a zero standing in for
    unknown. */
export function reportingLagDays(
  periodOfReport: string | null,
  filedDate: string | null,
): number | null {
  const p = utcDayNumber(periodOfReport);
  const f = utcDayNumber(filedDate);
  if (p === null || f === null) return null;
  return f - p;
}

/** A finite number, or NULL. NULL stays NULL; an unreadable value is NULL too.

    ONE numeric coercion. The two copies disagreed on unreadable input — one
    finite-checked, one returned `Number(v)` and let `NaN` reach `fmtUsd` as
    `$NaN` and `compareActivity` as a non-deterministic comparator — and BOTH
    turned `""` into a reported `0`. An empty cell is an absent value, not a
    zero, and this file's whole premise is that a fabricated 0 is a false claim.
    So the empty/whitespace string is NULL here, explicitly. */
export function intOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The elements of a JSON array column, or `[]`.

    ONE array reader. The two copies had inverse asymmetries: one accepted a
    bare scalar as a single-element list and refused a non-`[`-prefixed string,
    the other refused scalars entirely. A `filing_keys` column is a canonical
    JSON array by producer contract (`serving_*.filing_keys`), so that is what
    is parsed; anything else yields `[]` rather than a guessed shape. */
export function jsonArrayOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw !== "string" || !raw.startsWith("[")) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** One filing reference, as far as the shared filed-date rule needs it. */
export interface FiledDateCandidate {
  filed_date: string;
  accession: string;
}

/** The LATEST filing of a composition: max `filed_date`, ties broken by
    `accession` ascending — i.e. the LARGEST accession wins the tie.

    ONE tie-break. The two copies ran in OPPOSITE directions under comments
    claiming the identical rule: `holdings.ts` sorted ascending and took the last
    (largest accession) while `activity.ts` kept `ref.accession < best.accession`
    (smallest). Measured on two same-day amendments, the filer page's provenance
    link and the activity feed cited DIFFERENT documents for the same
    composition.

    Largest-wins is the house rule, not a coin flip: `views.sql`'s
    restatement-survivor predicate resolves a same-`filed_date`,
    same-`amendment_no` pair with `r.accession > f.accession`, so the survivor —
    the authoritative filing — is the larger accession. A filed-date resolver
    that picked the smaller would cite a document the composition rules already
    superseded. */
export function latestFiling<T extends FiledDateCandidate>(refs: readonly T[]): T | null {
  let best: T | null = null;
  for (const ref of refs) {
    if (typeof ref.filed_date !== "string" || ref.filed_date === "") continue;
    if (
      best === null ||
      ref.filed_date > best.filed_date ||
      (ref.filed_date === best.filed_date && ref.accession > best.accession)
    ) {
      best = ref;
    }
  }
  return best;
}
