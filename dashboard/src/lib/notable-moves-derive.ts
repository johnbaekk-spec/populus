/* R14 — the SERVER-side derivation of the notable-manager moves: reads the
   serving activity grain and the class-grain ticker tables, so it imports the
   Node-backed modules and is never bundled for the browser. Everything
   renderable lives in `notable-moves.ts`. */

import {
  type ActivityFeed,
  type ActivityFeedRecord,
  FEED_MOVE_KINDS,
  resolveActivityRecord,
} from "./activity.ts";
import { type InstData, type TickerRef, tickerFor } from "./inst.ts";
import type { ManagerTyping } from "./manager-directory.ts";
import { SHARD_RESPONSE_CEILING_BYTES } from "./shards.ts";
import { MOVE_KIND_PRIORITY, type MoveKind, type NotableMove, type NotableMovesShard } from "./notable-moves.ts";

function cmpMoves(a: NotableMove, b: NotableMove): number {
  const ka = MOVE_KIND_PRIORITY[a.kind];
  const kb = MOVE_KIND_PRIORITY[b.kind];
  if (ka !== kb) return ka - kb;
  const av = a.delta_value == null ? null : Math.abs(a.delta_value);
  const bv = b.delta_value == null ? null : Math.abs(b.delta_value);
  if (av !== bv) {
    if (av == null) return 1; // undisclosed last
    if (bv == null) return -1;
    return bv - av;
  }
  if (a.cik !== b.cik) return a.cik < b.cik ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export interface NotableMovesInputs {
  feed: ActivityFeed;
  inst: InstData;
  period: string;
}

/** The band's population for one closed period, in display order. */
export function notableMoves({ feed, inst, period }: NotableMovesInputs): NotableMove[] {
  if (!feed.present || !inst.present) return [];
  const notable = new Map<string, ManagerTyping>();
  for (const t of inst.typingByCik.values()) if (t.notable) notable.set(t.cik, t);
  if (notable.size === 0) return [];
  // The class of each position (for the R3 ticker) comes from the enriched
  // QoQ rows, keyed on the same (cik, period, position_key) grain.
  const classOf = new Map<string, string | null>();
  for (const cik of notable.keys()) {
    for (const d of inst.deltasByCik.get(cik) ?? []) {
      if (d.curr_period === period && d.title_of_class !== undefined) {
        classOf.set(`${cik}|${d.position_key}`, d.title_of_class ?? null);
      }
    }
  }
  const out: NotableMove[] = [];
  for (const r of feed.records) {
    if (r.curr_period !== period) continue;
    const typing = notable.get(r.cik);
    if (!typing) continue;
    if (!FEED_MOVE_KINDS.has(r.change_kind) || r.flags.includes("book_discontinuity")) continue;
    const resolved: ActivityFeedRecord = resolveActivityRecord(r, feed.filings);
    // The receipt is the filing that dated the row (the max-filed-date rule).
    let doc: string | null = null;
    if (resolved.filed_accession) {
      for (const k of [...r.filing_keys, ...r.current_filing_keys, ...r.prior_filing_keys]) {
        const f = feed.filings[String(k)];
        if (f && f.accession === resolved.filed_accession) { doc = f.doc_url; break; }
      }
    }
    const issuer = r.issuer_name?.trim() || "";
    const ref: TickerRef | null = issuer ? tickerFor(inst, issuer, classOf.get(`${r.cik}|${r.position_key}`) ?? null) : null;
    out.push({
      cik: r.cik,
      manager: typing.display_name,
      principal: typing.person,
      type: typing.manager_type,
      issuer: issuer || r.position_key,
      ticker: ref?.ticker ?? null,
      ticker_verified: ref?.verified_date || null,
      kind: r.change_kind as MoveKind,
      delta_shares: r.delta_shares,
      curr_value: r.curr_value_usd,
      delta_value: r.delta_value_usd,
      filed: resolved.filed_date,
      doc,
      key: r.position_key,
      ikey: r.issuer_key,
    });
  }
  out.sort(cmpMoves);
  return out;
}

/** The shard: the ordered population cut at the 1 MiB client-response ceiling,
    with the truncation STATED. Bytes are measured on the emitted body. */
export function notableMovesShard(period: string, rows: readonly NotableMove[], ceilingBytes = SHARD_RESPONSE_CEILING_BYTES): { body: string; shard: NotableMovesShard } {
  const head = (truncated: boolean, n: number): string =>
    `{"v":1,"period":${JSON.stringify(period)},"total":${rows.length},"truncated":${truncated},"rows_emitted":${n},"rows":[`;
  const tail = "]}";
  const overhead = Buffer.byteLength(head(true, rows.length)) + Buffer.byteLength(tail);
  const kept: string[] = [];
  let bytes = overhead;
  for (const r of rows) {
    const json = JSON.stringify(r);
    const cost = Buffer.byteLength(json) + (kept.length > 0 ? 1 : 0);
    if (bytes + cost > ceilingBytes) break;
    kept.push(json);
    bytes += cost;
  }
  const truncated = kept.length < rows.length;
  const body = head(truncated, kept.length) + kept.join(",") + tail;
  return { body, shard: { v: 1, period, total: rows.length, truncated, rows: rows.slice(0, kept.length) } };
}

/** R14 / R4: the quarters the band offers, newest first — only those with at
    least one move, because a chip that opens an empty table is a dead control
    (the activity window is the newest two published periods, LD3, so older
    closed quarters carry none). With no moves anywhere the newest closed
    quarter stays, so the band states that absence rather than claiming no
    quarter is closed. */
export function offeredMovePeriods(closed: readonly string[], movesIn: (period: string) => number): string[] {
  const withMoves = closed.filter((p) => movesIn(p) > 0);
  return withMoves.length > 0 ? withMoves : closed.slice(0, 1);
}
