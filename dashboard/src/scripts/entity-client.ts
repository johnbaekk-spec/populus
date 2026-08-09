/* Entity client: the watchlist v2 store (Locked #16), the generic-route
   driver (Locked #3 / qoq-presentation.md §3), and the small enhancements the
   prerendered entity pages mount (pager, watch stars, period selectors).

   The driver is a PURE orchestration over injected seams (fetch, render,
   timers, storage) — the browser entry at the bottom wires the real DOM, and
   the post-build harness executes the same function over real dist bytes with
   fakes. No logic lives only in the browser path. */

import {
  txnFromArray,
  paperFromArray,
  mergeFeed,
  pageCountFor,
  pageSlice,
  type TxnRow,
  type RenderCtx,
} from "../lib/format.ts";
import {
  parseEntityKey,
  classifyResponse,
  memberDataPath,
  tickerDataPath,
  type MemberEntity,
  type TickerEntity,
} from "../lib/derive.ts";
import {
  memberBody,
  tickerUnifiedBody,
  filerBody,
  entityTxnRowsHtml,
  entityTableCountText,
  s2OutOfExtract,
  s4Skeleton,
  s4Error,
  filerPeriodSectionHtml,
  holdersTableHtml,
  type BuildStamps,
} from "../lib/ui.ts";
import {
  holdingsFootnotesHtml,
  institutionalDataNoteHtml,
  projectionAbsentHtml,
  surfaceHtml,
  type FilerSurfacePayload,
  type SurfaceState,
} from "../lib/holdings.ts";
import {
  FILER_INDEX_PATH,
  FilerPayloadError,
  filerShardPath,
  parseFilerPayload,
  type FilerPayloadV1,
} from "../lib/filer-payload.ts";
import { edgarFilerUrl } from "../lib/derive.ts";
import type { TickerInstSection } from "../lib/data.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow } from "../lib/inst.ts";

/* ---------- watchlist v2 store (Locked #16) ---------- */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WATCH_V2_KEY = "populus:watch:v2";
export const WATCH_LEGACY_KEY = "populus:watch:members";
export const WATCH_QUARANTINE_KEY = "populus:watch:v2.corrupt";

const BIOGUIDE_RE = /^[A-Z]\d{6}$/;

export interface WatchStore {
  members: Set<string>;
  tickers: Set<string>;
  has(kind: "member" | "ticker", key: string): boolean;
  toggle(kind: "member" | "ticker", key: string): boolean;
}

function validStringArray(v: unknown, validate?: (s: string) => boolean): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    if (validate && !validate(item)) continue; // invalid entries dropped, not fatal
    out.push(item);
  }
  return out;
}

/** Load-or-migrate. Corrupt v2 storage is QUARANTINED (moved aside verbatim)
    before starting fresh — never silently overwritten; the legacy bare-array
    key keeps receiving member writes until the P3-1 reconciliation merge. */
export function loadWatchStore(storage: StorageLike): WatchStore {
  let members: string[] = [];
  let tickers: string[] = [];
  let migrated = false;

  const rawV2 = safeGet(storage, WATCH_V2_KEY);
  if (rawV2 != null) {
    let ok = false;
    try {
      const parsed = JSON.parse(rawV2) as { v?: unknown; members?: unknown; tickers?: unknown };
      if (parsed != null && typeof parsed === "object" && parsed.v === 2) {
        const m = validStringArray(parsed.members, (s) => BIOGUIDE_RE.test(s));
        const t = validStringArray(parsed.tickers);
        if (m !== null && t !== null) {
          members = m;
          tickers = t;
          ok = true;
        }
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      safeSet(storage, WATCH_QUARANTINE_KEY, rawV2);
      migrated = true; // fall through to the legacy path below
    }
  }
  if (rawV2 == null || migrated) {
    const rawLegacy = safeGet(storage, WATCH_LEGACY_KEY);
    if (rawLegacy != null) {
      try {
        const legacy = validStringArray(JSON.parse(rawLegacy), (s) => BIOGUIDE_RE.test(s));
        if (legacy !== null) members = legacy;
      } catch {
        // corrupt legacy: nothing to migrate
      }
    }
    persist();
  }

  function persist(): void {
    safeSet(storage, WATCH_V2_KEY, JSON.stringify({ v: 2, members, tickers }));
    // Legacy write-through until the P3-1 reconciliation merge: the feed's
    // in-flight QA branch still reads the bare member-id array.
    safeSet(storage, WATCH_LEGACY_KEY, JSON.stringify(members));
  }

  const store: WatchStore = {
    members: new Set(members),
    tickers: new Set(tickers),
    has(kind, key) {
      return (kind === "member" ? store.members : store.tickers).has(key);
    },
    toggle(kind, key) {
      const set = kind === "member" ? store.members : store.tickers;
      const on = !set.has(key);
      if (on) set.add(key);
      else set.delete(key);
      members = [...store.members];
      tickers = [...store.tickers];
      persist();
      return on;
    },
  };
  return store;
}

function safeGet(s: StorageLike, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(s: StorageLike, k: string, v: string): void {
  try {
    s.setItem(k, v);
  } catch {
    // storage full / denied: the watchlist is a convenience, never load-bearing
  }
}

/* ---------- the generic-route driver (spec §3) ---------- */

export type FetchResult =
  | { kind: "http"; status: number; body: unknown }
  | { kind: "network" };

export interface DriverDeps {
  /** the page's location.search (e.g. "?k=t:OUST") */
  search: string;
  fetchJson: (url: string) => Promise<FetchResult>;
  render: (html: string) => void;
  setTitle: (title: string) => void;
  watch: WatchStore;
  /** schedule the watchdog; returns a cancel function */
  schedule: (fn: () => void, ms: number) => () => void;
  /** test seam: override a body renderer (e.g. with a throwing one) */
  renderBody?: (payloadKind: "m" | "t", html: () => string) => string;
  watchdogMs?: number;
}

export type DriverStateKind =
  | "key_error"
  | "s2"
  | "loading"
  | "body"
  | "server_error"
  | "network_error"
  | "bad_payload"
  | "version_mismatch"
  | "render_error"
  | "timeout";

export interface DriverHandle {
  state: () => DriverStateKind;
  /** re-run after a retryable failure (wired to the error block's button) */
  retry: () => Promise<void>;
  /** entity-table pagination over the loaded payload */
  older: () => void;
  newer: () => void;
  toggleWatch: (kind: "member" | "ticker", key: string) => void;
  /** R22 filer surface controls — no-ops unless an in-extract filer is loaded */
  holdingsPage: (dir: "prev" | "next") => void;
  holdingsView: (view: "current" | "prior" | "diff") => void;
  holdingsPeriod: (period: string) => void;
  done: Promise<void>;
}

interface LoadedEntity {
  kind: "m" | "t";
  member?: MemberEntity;
  ticker?: TickerEntity;
  inst?: TickerInstSection;
  stamps: BuildStamps;
}

/* RUN M2-11 (plan R22): the in-extract filer path. A tail filer resolves
   through the routing index to its shard, is STRICT-validated by
   parseFilerPayload, and renders through the SAME body path the pre-rendered
   pages use (ui.filerBody + holdings.surfaceHtml) — parity by construction.
   The driver's existing error taxonomy is preserved exactly: a malformed
   index/shard/payload is bad_payload, a wrong version is version_mismatch,
   HTTP 404 on the index or a CIK absent from it is the out-of-extract S2, and
   5xx/network/timeout keep their states. */

export const DRIVER_WATCHDOG_MS = 15_000;

export function runEntityDriver(deps: DriverDeps): DriverHandle {
  let state: DriverStateKind = "loading";
  let page = 0;
  let loaded: LoadedEntity | null = null;
  const watchdogMs = deps.watchdogMs ?? DRIVER_WATCHDOG_MS;

  const params = new URLSearchParams(deps.search);
  const parsed = parseEntityKey(params.get("k"));

  const ctx = (): RenderCtx => ({
    watched: deps.watch.members,
    watchedTickers: deps.watch.tickers,
  });

  function bodyHtml(): string {
    const e = loaded!;
    if (e.kind === "m") return memberBody(e.member!, e.stamps, ctx(), page);
    return tickerUnifiedBody(e.ticker!, e.inst!, e.stamps, ctx(), { fullTable: true, page });
  }

  function renderLoaded(): void {
    const produce = () => bodyHtml();
    try {
      const html = deps.renderBody ? deps.renderBody(loaded!.kind, produce) : produce();
      deps.render(html);
      state = "body";
    } catch {
      state = "render_error";
      deps.render(
        s4Error(
          "render_error",
          endpointFor()!,
          "The published record downloaded, but the page template threw while drawing it.",
          false,
        ),
      );
    }
  }

  function endpointFor(): string | null {
    if (!parsed.ok) return null;
    if (parsed.kind === "m") return memberDataPath(parsed.key);
    if (parsed.kind === "t") return tickerDataPath(parsed.key);
    return null;
  }

  async function load(): Promise<void> {
    if (!parsed.ok) {
      state = "key_error";
      deps.render(
        s4Error(
          "key_error",
          "",
          parsed.reason === "missing"
            ? "The address names no entity key (?k=…)."
            : "The entity key in this address is not a shape this site serves.",
          false,
        ),
      );
      return;
    }
    if (parsed.kind === "f") {
      // R22: top filers are pre-rendered; tail filers resolve index -> shard.
      // A CIK the index does not carry is genuinely out-of-extract (S2).
      await loadFiler(parsed.key);
      return;
    }
    const endpoint = endpointFor()!;
    const label = `/e/ · ${parsed.kind}:${parsed.key}`;
    state = "loading";
    deps.render(s4Skeleton(endpoint, label));

    let settled = false;
    const cancelWatchdog = deps.schedule(() => {
      if (settled) return;
      settled = true;
      state = "timeout";
      deps.render(
        s4Error(
          "timeout",
          endpoint,
          "The extract endpoint has not answered within the watchdog window.",
          true,
        ),
      );
    }, watchdogMs);

    const result = await deps.fetchJson(endpoint);
    if (settled) return; // the watchdog already spoke
    settled = true;
    cancelWatchdog();

    if (result.kind === "network") {
      state = "network_error";
      deps.render(
        s4Error("network_error", endpoint, "The request did not complete — no response arrived.", true),
      );
      return;
    }
    const classified = classifyResponse(result.status, result.body);
    switch (classified.outcome) {
      case "not_found": {
        state = "s2";
        deps.render(s2OutOfExtract(parsed.kind, parsed.key));
        return;
      }
      case "server_error": {
        state = "server_error";
        deps.render(
          s4Error(
            "server_error",
            endpoint,
            `The endpoint answered HTTP ${classified.status}.`,
            true,
          ),
        );
        return;
      }
      case "bad_payload": {
        state = "bad_payload";
        deps.render(s4Error("bad_payload", endpoint, `Defect: ${classified.detail}.`, true));
        return;
      }
      case "version_mismatch": {
        state = "version_mismatch";
        deps.render(
          s4Error(
            "version_mismatch",
            endpoint,
            `The payload is version ${String(classified.got)}; this page's code speaks a different version. Reloading may pick up matching code.`,
            false,
          ),
        );
        return;
      }
      case "ok": {
        const payload = classified.payload;
        const meta = payload.meta as Record<string, any>;
        const stamps: BuildStamps = {
          buildId: String(meta.buildId ?? ""),
          generatedAt: String(meta.generatedAt ?? ""),
          generatedAtDate: String(meta.generatedAtDate ?? ""),
        };
        if (payload.kind === "m") {
          loaded = {
            kind: "m",
            stamps,
            member: {
              bioguide: String(meta.bioguide ?? parsed.key),
              name: String(meta.name ?? parsed.key),
              party: String(meta.party ?? ""),
              state: meta.state == null ? null : String(meta.state),
              district: meta.district == null ? null : String(meta.district),
              chamber: meta.chamber === "senate" ? "senate" : "house",
              servingSince: meta.servingSince == null ? null : String(meta.servingSince),
              filingCount: Number(meta.filingCount ?? 0),
              txns: payload.t.map(txnFromArray),
              paper: payload.p.map(paperFromArray),
            },
          };
          deps.setTitle(`${loaded.member!.name} — congressional disclosures — Populus`);
        } else {
          loaded = {
            kind: "t",
            stamps,
            ticker: { ticker: String(meta.ticker ?? parsed.key), txns: payload.t.map(txnFromArray) },
            inst: (meta.inst ?? { state: "module-absent" }) as TickerInstSection,
          };
          deps.setTitle(`${loaded.ticker!.ticker} — disclosures — Populus`);
        }
        page = 0;
        renderLoaded();
        return;
      }
    }
  }

  let loadedFiler: FilerPayloadV1 | null = null;
  let filerState: SurfaceState = { view: "current", page: 0, period: "" };
  /** The aggregate period the chips select — drives filerBody's tiles/changes. */
  let filerAggPeriod = "";

  function filerSurfaceOf(p: FilerPayloadV1): FilerSurfacePayload {
    return {
      kind: "filer",
      cik: p.cik,
      filerName: p.filerName,
      periods: p.periods,
      current: p.current,
      prior: p.prior,
      filings: p.filings,
      rowsByPeriod: p.rowsByPeriod,
      totalsByPeriod: p.totalsByPeriod,
    };
  }

  function filerHtml(p: FilerPayloadV1): string {
    const aggPeriods = Object.keys(p.concByPeriod).sort();
    const aggPeriod = aggPeriods.includes(filerAggPeriod)
      ? filerAggPeriod
      : (aggPeriods[aggPeriods.length - 1] ?? p.latestPeriod);
    const surface =
      p.periods.length > 0
        ? surfaceHtml(filerSurfaceOf(p), filerState)
        : projectionAbsentHtml("filer", edgarFilerUrl(p.cik));
    return (
      filerBody(
        { cik: p.cik, name: p.filerName, latestPeriod: p.latestPeriod },
        aggPeriods,
        aggPeriod,
        p.concByPeriod[aggPeriod] ?? null,
        p.deltasByPeriod[aggPeriod] ?? [],
        p.latestFiled,
        p.topn,
        p.window,
      ) +
      `<section class="panel panel-wide" aria-label="Reported holdings" data-holdings-surface="filer">` +
      `<div data-holdings-body>` +
      surface +
      `</div></section>` +
      institutionalDataNoteHtml() +
      holdingsFootnotesHtml()
    );
  }

  function renderFiler(): void {
    const p = loadedFiler!;
    try {
      deps.render(filerHtml(p));
      state = "body";
    } catch {
      state = "render_error";
      deps.render(
        s4Error(
          "render_error",
          FILER_INDEX_PATH,
          "The published record downloaded, but the page template threw while drawing it.",
          false,
        ),
      );
    }
  }

  async function loadFiler(cik10: string): Promise<void> {
    const label = `/e/ · f:${cik10}`;
    state = "loading";
    deps.render(s4Skeleton(FILER_INDEX_PATH, label));

    let settled = false;
    const cancelWatchdog = deps.schedule(() => {
      if (settled) return;
      settled = true;
      state = "timeout";
      deps.render(
        s4Error(
          "timeout",
          FILER_INDEX_PATH,
          "The extract endpoint has not answered within the watchdog window.",
          true,
        ),
      );
    }, watchdogMs);

    const fail = (
      kind: "network_error" | "server_error" | "bad_payload" | "version_mismatch",
      endpoint: string,
      detail: string,
      retryable: boolean,
    ): void => {
      state = kind;
      deps.render(s4Error(kind, endpoint, detail, retryable));
    };

    const idx = await deps.fetchJson(FILER_INDEX_PATH);
    if (settled) return;
    if (idx.kind === "network") {
      settled = true;
      cancelWatchdog();
      fail("network_error", FILER_INDEX_PATH, "The request did not complete — no response arrived.", true);
      return;
    }
    if (idx.status === 404) {
      // No index in this deploy: nothing is in-extract through this path.
      settled = true;
      cancelWatchdog();
      state = "s2";
      deps.render(s2OutOfExtract("f", cik10));
      return;
    }
    if (idx.status < 200 || idx.status >= 300) {
      settled = true;
      cancelWatchdog();
      fail("server_error", FILER_INDEX_PATH, `The endpoint answered HTTP ${idx.status}.`, true);
      return;
    }
    const idxBody = idx.body as Record<string, unknown> | null;
    if (typeof idxBody !== "object" || idxBody === null) {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index is not a JSON object.", true);
      return;
    }
    if (typeof idxBody.v !== "number") {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index has no version field.", true);
      return;
    }
    if (idxBody.v !== 1) {
      settled = true;
      cancelWatchdog();
      fail(
        "version_mismatch",
        FILER_INDEX_PATH,
        `The routing index is version ${String(idxBody.v)}; this page's code speaks a different version. Reloading may pick up matching code.`,
        false,
      );
      return;
    }
    // STRICT (R22): the index envelope carries exactly {v, kind, absent,
    // shards} — an unknown key means this is not the contract the code speaks,
    // and stripping it silently would mask producer drift.
    for (const key of Object.keys(idxBody)) {
      if (key !== "v" && key !== "kind" && key !== "absent" && key !== "shards") {
        settled = true;
        cancelWatchdog();
        fail(
          "bad_payload",
          FILER_INDEX_PATH,
          `Defect: the routing index carries the undeclared key ${JSON.stringify(key)}.`,
          true,
        );
        return;
      }
    }
    // Codex F5: required discriminators must be PRESENT and typed — an
    // envelope missing `kind` or `absent` is not this contract, and accepting
    // it would let a producer drift ship as a "valid" index.
    if (idxBody.kind === undefined) {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index is missing its kind discriminator.", true);
      return;
    }
    if (idxBody.kind !== "filer-index") {
      settled = true;
      cancelWatchdog();
      fail(
        "bad_payload",
        FILER_INDEX_PATH,
        `Defect: the routing index kind is ${JSON.stringify(idxBody.kind)}, not "filer-index".`,
        true,
      );
      return;
    }
    if (!("absent" in idxBody)) {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index is missing its absent field.", true);
      return;
    }
    if (idxBody.absent !== null && typeof idxBody.absent !== "string") {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index absent field is neither a string nor null.", true);
      return;
    }
    const shardsMap = idxBody.shards;
    if (shardsMap === undefined) {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index is missing its shards map.", true);
      return;
    }
    if (typeof shardsMap !== "object" || shardsMap === null || Array.isArray(shardsMap)) {
      settled = true;
      cancelWatchdog();
      fail("bad_payload", FILER_INDEX_PATH, "Defect: the routing index carries no shard map.", true);
      return;
    }
    // Codex F5: every shards-map VALUE must be a string shard name. A non-string
    // value is a defective index, not an absence — absence is a MISSING key.
    for (const [mapCik, mapValue] of Object.entries(shardsMap as Record<string, unknown>)) {
      if (typeof mapValue !== "string") {
        settled = true;
        cancelWatchdog();
        fail(
          "bad_payload",
          FILER_INDEX_PATH,
          `Defect: the routing index maps CIK ${mapCik} to a non-string shard name.`,
          true,
        );
        return;
      }
    }
    const shardName = (shardsMap as Record<string, unknown>)[cik10];
    if (typeof shardName !== "string") {
      // Not published in the tail family (module absent, or genuinely outside
      // the extract): today's S2, with its primary-source CTA.
      settled = true;
      cancelWatchdog();
      state = "s2";
      deps.render(s2OutOfExtract("f", cik10));
      return;
    }

    const shardEndpoint = filerShardPath(shardName);
    const shard = await deps.fetchJson(shardEndpoint);
    if (settled) return;
    settled = true;
    cancelWatchdog();
    if (shard.kind === "network") {
      fail("network_error", shardEndpoint, "The request did not complete — no response arrived.", true);
      return;
    }
    if (shard.status < 200 || shard.status >= 300) {
      // The index PROMISED this shard, so even a 404 here is a defect of the
      // published family, not an out-of-extract state.
      fail("server_error", shardEndpoint, `The endpoint answered HTTP ${shard.status}.`, true);
      return;
    }
    const shardBody = shard.body as Record<string, unknown> | null;
    if (typeof shardBody !== "object" || shardBody === null) {
      fail("bad_payload", shardEndpoint, "Defect: the shard is not a JSON object.", true);
      return;
    }
    if (typeof shardBody.v !== "number") {
      fail("bad_payload", shardEndpoint, "Defect: the shard has no version field.", true);
      return;
    }
    if (shardBody.v !== 1) {
      fail(
        "version_mismatch",
        shardEndpoint,
        `The shard is version ${String(shardBody.v)}; this page's code speaks a different version. Reloading may pick up matching code.`,
        false,
      );
      return;
    }
    // STRICT (R22): the shard envelope carries exactly {v, kind, shard,
    // shard_count, entries}; each entry is then strict-validated by
    // parseFilerPayload, so the whole delivery path rejects unknown keys.
    for (const key of Object.keys(shardBody)) {
      if (!["v", "kind", "shard", "shard_count", "entries"].includes(key)) {
        fail(
          "bad_payload",
          shardEndpoint,
          `Defect: the shard carries the undeclared key ${JSON.stringify(key)}.`,
          true,
        );
        return;
      }
    }
    // Codex F5: the shard envelope's discriminator and geometry fields must be
    // PRESENT and typed, not merely "no unknown keys".
    if (shardBody.kind === undefined) {
      fail("bad_payload", shardEndpoint, "Defect: the shard is missing its kind discriminator.", true);
      return;
    }
    if (shardBody.kind !== "filer-shard") {
      fail(
        "bad_payload",
        shardEndpoint,
        `Defect: the shard kind is ${JSON.stringify(shardBody.kind)}, not "filer-shard".`,
        true,
      );
      return;
    }
    if (shardBody.shard === undefined) {
      fail("bad_payload", shardEndpoint, "Defect: the shard is missing its shard number.", true);
      return;
    }
    if (typeof shardBody.shard !== "number" || !Number.isFinite(shardBody.shard)) {
      fail("bad_payload", shardEndpoint, "Defect: the shard number is not a finite number.", true);
      return;
    }
    if (shardBody.shard_count === undefined) {
      fail("bad_payload", shardEndpoint, "Defect: the shard is missing its shard_count.", true);
      return;
    }
    if (typeof shardBody.shard_count !== "number" || !Number.isFinite(shardBody.shard_count)) {
      fail("bad_payload", shardEndpoint, "Defect: the shard_count is not a finite number.", true);
      return;
    }
    const entries = shardBody.entries;
    if (entries === undefined) {
      fail("bad_payload", shardEndpoint, "Defect: the shard is missing its entries object.", true);
      return;
    }
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      fail("bad_payload", shardEndpoint, "Defect: the shard carries no entries object.", true);
      return;
    }
    const entry = (entries as Record<string, unknown>)[cik10];
    if (entry === undefined) {
      fail(
        "bad_payload",
        shardEndpoint,
        `Defect: the routing index names this shard for CIK ${cik10}, but the shard does not carry it.`,
        true,
      );
      return;
    }
    let payload: FilerPayloadV1;
    try {
      payload = parseFilerPayload(entry);
      // F3: the entry was routed under cik10; a payload declaring another CIK
      // would render a DIFFERENT manager's portfolio at this URL. Fail closed.
      if (payload.cik !== cik10) {
        throw new FilerPayloadError(
          "bad_payload",
          `shard entry cik mismatch: routed as ${cik10}, payload declares ${payload.cik}`,
        );
      }
    } catch (err) {
      if (err instanceof FilerPayloadError && err.code === "version") {
        fail(
          "version_mismatch",
          shardEndpoint,
          `The payload is version ${String(err.got)}; this page's code speaks a different version. Reloading may pick up matching code.`,
          false,
        );
      } else {
        fail("bad_payload", shardEndpoint, `Defect: ${(err as Error).message}.`, true);
      }
      return;
    }
    loadedFiler = payload;
    filerState = { view: "current", page: 0, period: payload.current };
    filerAggPeriod = "";
    deps.setTitle(`${payload.filerName} — 13F filer — Populus`);
    renderFiler();
  }

  function maxPage(): number {
    if (!loaded) return 0;
    const txns = loaded.kind === "m" ? loaded.member!.txns : loaded.ticker!.txns;
    return Math.max(0, pageCountFor(mergeFeed(txns, [])) - 1);
  }

  const done = load();
  return {
    state: () => state,
    retry: () => load(),
    older: () => {
      if (!loaded || page >= maxPage()) return;
      page++;
      renderLoaded();
    },
    newer: () => {
      if (!loaded || page === 0) return;
      page--;
      renderLoaded();
    },
    toggleWatch: (kind, key) => {
      deps.watch.toggle(kind, key);
      if (loaded) renderLoaded();
    },
    holdingsPage: (dir) => {
      if (!loadedFiler) return;
      filerState.page = Math.max(0, filerState.page + (dir === "next" ? 1 : -1));
      renderFiler();
    },
    holdingsView: (view) => {
      if (!loadedFiler) return;
      filerState.view = view;
      filerState.page = 0; // a page index from another view means nothing here
      filerState.period =
        view === "prior" && loadedFiler.prior ? loadedFiler.prior : loadedFiler.current;
      renderFiler();
    },
    holdingsPeriod: (period) => {
      if (!loadedFiler) return;
      filerAggPeriod = period;
      filerState.period = period;
      filerState.page = 0;
      filerState.view = "current";
      renderFiler();
    },
    done,
  };
}

/* ---------- browser entries ---------- */

function browserWatch(): WatchStore {
  return loadWatchStore(window.localStorage);
}

/** Paint + wire every [data-watch-kind] star on the page (delegated). */
export function initWatchStars(watch: WatchStore = browserWatch()): void {
  function paint(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-watch-kind]").forEach((btn) => {
      const kind = btn.dataset.watchKind as "member" | "ticker";
      const key = btn.dataset.watchKey!;
      const on = watch.has(kind, key);
      btn.setAttribute("aria-pressed", String(on));
      const glyph = btn.querySelector(".watch-glyph");
      if (glyph) glyph.textContent = on ? "★" : "☆";
      const note = btn.querySelector(".watch-note");
      if (note) note.textContent = on ? "watching · saved on this device" : "watch";
    });
  }
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-watch-kind]");
    if (!btn) return;
    watch.toggle(btn.dataset.watchKind as "member" | "ticker", btn.dataset.watchKey!);
    paint();
  });
  paint();
}

/** Prerendered entity pages: watch stars + endpoint-backed table pagination. */
export function initEntityPage(): void {
  const watch = browserWatch();
  initWatchStars(watch);

  const main = document.querySelector<HTMLElement>("main[data-entity-kind]");
  const table = document.querySelector<HTMLElement>("[data-entity-table]");
  const rowsEl = document.querySelector<HTMLElement>("[data-entity-rows]");
  const countEl = document.querySelector<HTMLElement>("[data-entity-count]");
  const statusEl = document.querySelector<HTMLElement>("[data-entity-status]");
  const olderBtn = document.querySelector<HTMLButtonElement>("[data-entity-older]");
  const newerBtn = document.querySelector<HTMLButtonElement>("[data-entity-newer]");
  if (!main || !table || !rowsEl || !countEl || !olderBtn || !newerBtn) return;

  const kind = main.dataset.entityKind as "m" | "t";
  const key = main.dataset.entityKey!;
  const tableKind = table.dataset.kind as "member" | "ticker";
  const endpoint = kind === "m" ? memberDataPath(key) : tickerDataPath(key);

  let txns: TxnRow[] | null = null;
  let page = 0;
  let loading: Promise<void> | null = null;

  function loadRows(): Promise<void> {
    loading ??= fetch(endpoint)
      .then((r) => {
        if (!r.ok) throw new Error(`entity dataset fetch failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        const classified = classifyResponse(200, d);
        if (classified.outcome !== "ok") throw new Error(classified.outcome);
        txns = classified.payload.t.map(txnFromArray);
      })
      .catch(() => {
        loading = null;
        if (statusEl) statusEl.textContent = "older pages need the entity dataset, which failed to download — try again";
      });
    return loading;
  }

  function apply(): void {
    if (!txns) return;
    const merged = mergeFeed(txns, []);
    const max = Math.max(0, pageCountFor(merged) - 1);
    if (page > max) page = max;
    const items = pageSlice(merged, page).filter((i): i is TxnRow => i.kind === "txn");
    const ctx: RenderCtx = { watched: watch.members, watchedTickers: watch.tickers };
    rowsEl!.innerHTML = entityTxnRowsHtml(items, tableKind, ctx);
    const count = entityTableCountText(page, items.length, txns.length);
    countEl!.textContent = count;
    if (statusEl) statusEl.textContent = count;
    setPager(newerBtn!, page === 0);
    setPager(olderBtn!, page >= max);
  }

  function setPager(btn: HTMLButtonElement, unavailable: boolean): void {
    btn.setAttribute("aria-disabled", String(unavailable));
    btn.classList.toggle("is-unavailable", unavailable);
  }

  olderBtn.addEventListener("click", async () => {
    if (olderBtn.getAttribute("aria-disabled") === "true") return;
    await loadRows();
    if (!txns) return;
    page++;
    apply();
  });
  newerBtn.addEventListener("click", async () => {
    if (newerBtn.getAttribute("aria-disabled") === "true" || page === 0) return;
    await loadRows();
    if (!txns) return;
    page--;
    apply();
  });
}

/** Filer page period selector: re-render the period section through the SAME
    pure renderer the SSR used, from the embedded per-period data. */
export function initFilerPeriods(): void {
  const dataEl = document.getElementById("filer-period-data");
  const root = document.querySelector<HTMLElement>("[data-filer-root]");
  const chips = document.querySelector<HTMLElement>("[data-period-chips]");
  if (!dataEl || !root || !chips) return;
  let data: {
    latestFiled: string | null;
    topn: number;
    periods: Record<string, { conc: ConcentrationRow | null; deltas: QoqDeltaRow[] }>;
  };
  try {
    data = JSON.parse(dataEl.textContent ?? "");
  } catch {
    return; // malformed embed: the SSR period stays — no partial re-render
  }
  chips.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-period]");
    if (!btn) return;
    const period = btn.dataset.period!;
    const slice = data.periods[period];
    if (!slice) return;
    root.innerHTML = filerPeriodSectionHtml(slice.conc, slice.deltas, period, data.latestFiled, data.topn);
    chips.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((c) => {
      const active = c === btn;
      c.classList.toggle("chip-active", active);
      c.setAttribute("aria-pressed", String(active));
    });
  });
}

/** Holders page period selector — same pattern, holders table renderer. */
export function initHoldersPeriods(): void {
  const dataEl = document.getElementById("holders-period-data");
  const root = document.querySelector<HTMLElement>("[data-holders-root]");
  const chips = document.querySelector<HTMLElement>("[data-period-chips]");
  if (!dataEl || !root || !chips) return;
  let data: { latestFiled: string | null; topn: number; periods: Record<string, TopHolderRow[]> };
  try {
    data = JSON.parse(dataEl.textContent ?? "");
  } catch {
    return;
  }
  chips.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-period]");
    if (!btn) return;
    const period = btn.dataset.period!;
    const rows = data.periods[period];
    if (!rows) return;
    root.innerHTML = holdersTableHtml(rows, period, data.latestFiled, data.topn);
    chips.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((c) => {
      const active = c === btn;
      c.classList.toggle("chip-active", active);
      c.setAttribute("aria-pressed", String(active));
    });
  });
}

/** /e/ browser entry: the real DOM/fetch/timer seams around the pure driver. */
export function runGenericRoute(): void {
  const root = document.getElementById("entity-root");
  if (!root) return;
  const watch = browserWatch();
  const handle = runEntityDriver({
    search: window.location.search,
    fetchJson: async (url) => {
      try {
        const r = await fetch(url);
        let body: unknown = null;
        try {
          body = await r.json();
        } catch {
          body = null; // classifyResponse names this bad_payload on a 2xx
        }
        return { kind: "http", status: r.status, body };
      } catch {
        return { kind: "network" };
      }
    },
    render: (html) => {
      root.innerHTML = html;
    },
    setTitle: (t) => {
      document.title = t;
    },
    watch,
    schedule: (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
  });
  root.addEventListener("click", (ev) => {
    const el = ev.target as Element;
    if (el.closest("[data-retry]")) {
      void handle.retry();
      return;
    }
    // R22 filer surface controls (no-ops unless a filer payload is loaded).
    const pageBtn = el.closest<HTMLButtonElement>("[data-holdings-page]");
    if (pageBtn) {
      if (pageBtn.getAttribute("aria-disabled") !== "true") {
        handle.holdingsPage(pageBtn.dataset.holdingsPage === "next" ? "next" : "prev");
      }
      return;
    }
    const viewBtn = el.closest<HTMLButtonElement>("[data-holdings-view]");
    if (viewBtn) {
      handle.holdingsView(viewBtn.dataset.holdingsView as "current" | "prior" | "diff");
      return;
    }
    const periodChip = el.closest<HTMLElement>("[data-period-chips] [data-period]");
    if (periodChip && periodChip.dataset.period) {
      handle.holdingsPeriod(periodChip.dataset.period);
      return;
    }
    const older = el.closest("[data-entity-older]");
    if (older && older.getAttribute("aria-disabled") !== "true") {
      handle.older();
      return;
    }
    const newer = el.closest("[data-entity-newer]");
    if (newer && newer.getAttribute("aria-disabled") !== "true") {
      handle.newer();
      return;
    }
    const star = el.closest<HTMLButtonElement>("[data-watch-kind]");
    if (star) {
      handle.toggleWatch(star.dataset.watchKind as "member" | "ticker", star.dataset.watchKey!);
    }
  });
}
