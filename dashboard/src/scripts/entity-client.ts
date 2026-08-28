import { initSortableTable } from "./table-sort.ts";
import { holderDefaultDir, holderSortNote, orderRankedHolders, type HolderSortKey } from "../lib/holders-sort.ts";
/* Entity client: the watchlist v2 store, the generic-route
   driver (qoq-presentation.md §3), and the small enhancements the
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
} from "../lib/ui/index.ts";
import {
  institutionalDataNoteHtml,
  projectionAbsentHtml,
  surfaceHtml,
  type FilerSurfacePayload,
  type SurfaceState,
} from "../lib/holdings.ts";
import {
  FILER_FRAGMENT_PARTS_MAX,
  FILER_INDEX_PATH,
  FILER_TAIL_SHARDS_MAX,
  FilerPayloadError,
  filerShardPath,
  parseFilerFragmentV2,
  reassembleFilerFragments,
  type FilerPayloadV1,
  type FilerRouteV2,
} from "../lib/filer-payload.ts";
import { edgarFilerUrl } from "../lib/derive.ts";
import type { TickerInstSection } from "../lib/data.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow } from "../lib/inst.ts";

/* ---------- watchlist v2 store ---------- */

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
  /** filer surface controls — no-ops unless an in-extract filer is loaded */
  holdingsPage: (dir: "prev" | "next") => void;
  /** changes-table pagination (the tail route previously had none). */
  changesPage: (dir: "prev" | "next") => void;
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

/* The in-extract filer path. A tail filer resolves
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
      // Top filers are pre-rendered; tail filers resolve index -> shard.
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
          deps.setTitle(`${loaded.member!.name} — congressional disclosures — Public Filings`);
        } else {
          loaded = {
            kind: "t",
            stamps,
            ticker: { ticker: String(meta.ticker ?? parsed.key), txns: payload.t.map(txnFromArray) },
            inst: (meta.inst ?? { state: "module-absent" }) as TickerInstSection,
          };
          deps.setTitle(`${loaded.ticker!.ticker} — disclosures — Public Filings`);
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
  /** Changes-table page index, reset whenever the selected period changes: a page
      index from another quarter addresses nothing in this one. */
  let filerChangesPage = 0;

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
        /* Pre-bound total, so a tail filer states its cap exactly as the
           pre-rendered page does. NO length fallback — the validator
           requires this key, and defaulting to the embedded length would make a
           capped period silently claim completeness. */
        {
          total: p.deltaTotalsByPeriod[aggPeriod]!,
          page: filerChangesPage,
        },
      ) +
      `<section class="panel panel-wide" aria-label="Reported holdings" data-holdings-surface="filer">` +
      `<div data-holdings-body>` +
      surface +
      `</div></section>` +
      institutionalDataNoteHtml()
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

    const reject = (detail: string): never => {
      throw new FilerPayloadError("bad_payload", detail);
    };
    let selectedRoute: FilerRouteV2 | undefined;
    try {
      const body = idx.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        reject("routing index is not a JSON object");
      }
      const index = body as Record<string, unknown>;
      if (typeof index.v !== "number") reject("routing index has no version field");
      if (index.v !== 2) {
        throw new FilerPayloadError("version", `routing index is version ${String(index.v)}`, index.v);
      }
      for (const key of Object.keys(index)) {
        if (!["v", "kind", "absent", "routes"].includes(key)) {
          reject(`routing index carries undeclared key ${JSON.stringify(key)}`);
        }
      }
      if (index.kind !== "filer-index") reject("routing index kind is not \"filer-index\"");
      if (index.absent !== null && index.absent !== "module-absent") {
        reject("routing index absent field is not null or \"module-absent\"");
      }
      if (typeof index.routes !== "object" || index.routes === null || Array.isArray(index.routes)) {
        reject("routing index carries no routes object");
      }
      const routes = index.routes as Record<string, unknown>;
      if (index.absent === "module-absent" && Object.keys(routes).length !== 0) {
        reject("absent routing index carries routes");
      }
      for (const [mapCik, rawRoute] of Object.entries(routes)) {
        if (!/^\d{10}$/.test(mapCik)) reject(`routing index key ${JSON.stringify(mapCik)} is not a CIK`);
        if (!Array.isArray(rawRoute) || rawRoute.length !== 3
            || rawRoute.some((value) => !Number.isInteger(value))) {
          reject(`routing index route for ${mapCik} is not three integers`);
        }
        const [first, last, parts] = rawRoute as number[];
        if (first! < 0 || last! < first! || last! >= FILER_TAIL_SHARDS_MAX
            || parts! < 1 || parts! > FILER_FRAGMENT_PARTS_MAX
            || last! - first! + 1 > parts!) {
          reject(`routing index route for ${mapCik} is outside its bounds`);
        }
      }
      selectedRoute = routes[cik10] as FilerRouteV2 | undefined;
    } catch (err) {
      settled = true;
      cancelWatchdog();
      if (err instanceof FilerPayloadError && err.code === "version") {
        fail("version_mismatch", FILER_INDEX_PATH,
          `The routing index is version ${String(err.got)}; this page's code speaks a different version. Reloading may pick up matching code.`, false);
      } else {
        fail("bad_payload", FILER_INDEX_PATH, `Defect: ${(err as Error).message}.`, true);
      }
      return;
    }
    if (selectedRoute === undefined) {
      settled = true;
      cancelWatchdog();
      state = "s2";
      deps.render(s2OutOfExtract("f", cik10));
      return;
    }

    const [firstShard, lastShard, routeParts] = selectedRoute;
    const shardNumbers = Array.from(
      { length: lastShard - firstShard + 1 },
      (_, index) => firstShard + index,
    );
    let fetched: { shard: number; endpoint: string; result: FetchResult }[];
    try {
      fetched = await Promise.all(shardNumbers.map(async (shard) => ({
        shard,
        endpoint: filerShardPath(shard),
        result: await deps.fetchJson(filerShardPath(shard)),
      })));
    } catch (err) {
      if (settled) return;
      settled = true;
      cancelWatchdog();
      fail("network_error", FILER_INDEX_PATH, `A shard request threw: ${(err as Error).message}.`, true);
      return;
    }
    if (settled) return;

    const selectedFragments: unknown[] = [];
    let declaredShardCount: number | null = null;
    let defectEndpoint = FILER_INDEX_PATH;
    try {
      for (const { shard, endpoint, result } of fetched) {
        defectEndpoint = endpoint;
        if (result.kind === "network") {
          settled = true;
          cancelWatchdog();
          fail("network_error", endpoint, "The request did not complete — no response arrived.", true);
          return;
        }
        if (result.status < 200 || result.status >= 300) {
          settled = true;
          cancelWatchdog();
          fail("server_error", endpoint, `The endpoint answered HTTP ${result.status}.`, true);
          return;
        }
        if (typeof result.body !== "object" || result.body === null || Array.isArray(result.body)) {
          reject("fragment shard is not a JSON object");
        }
        const body = result.body as Record<string, unknown>;
        if (typeof body.v !== "number") reject("fragment shard has no version field");
        if (body.v !== 2) {
          throw new FilerPayloadError("version", `fragment shard is version ${String(body.v)}`, body.v);
        }
        for (const key of Object.keys(body)) {
          if (!["v", "kind", "shard", "shard_count", "entries"].includes(key)) {
            reject(`fragment shard carries undeclared key ${JSON.stringify(key)}`);
          }
        }
        if (body.kind !== "filer-fragment-shard") reject("fragment shard kind is invalid");
        if (!Number.isInteger(body.shard) || body.shard !== shard) {
          reject(`fragment shard number does not equal requested shard ${shard}`);
        }
        if (!Number.isInteger(body.shard_count)
            || (body.shard_count as number) < 1
            || (body.shard_count as number) > FILER_TAIL_SHARDS_MAX
            || lastShard >= (body.shard_count as number)) {
          reject("fragment shard_count is outside its bounds");
        }
        if (declaredShardCount === null) declaredShardCount = body.shard_count as number;
        else if (declaredShardCount !== body.shard_count) reject("fragment shards disagree on shard_count");
        if (typeof body.entries !== "object" || body.entries === null || Array.isArray(body.entries)
            || Object.keys(body.entries as object).length === 0) {
          reject("fragment shard carries no entries");
        }
        for (const [key, rawFragment] of Object.entries(body.entries as Record<string, unknown>)) {
          const match = /^(\d{10}):(\d+)$/.exec(key);
          if (!match) reject(`fragment entry key ${JSON.stringify(key)} is invalid`);
          const fragment = parseFilerFragmentV2(rawFragment);
          if (fragment.cik !== match![1] || fragment.part !== Number(match![2])) {
            reject(`fragment entry key ${key} contradicts its envelope`);
          }
          if (fragment.cik === cik10) selectedFragments.push(fragment);
        }
      }
      if (selectedFragments.length !== routeParts) {
        reject(`route declares ${routeParts} parts but fetched ${selectedFragments.length}`);
      }
      const payload = reassembleFilerFragments(selectedFragments, cik10);
      settled = true;
      cancelWatchdog();
      loadedFiler = payload;
    } catch (err) {
      settled = true;
      cancelWatchdog();
      if (err instanceof FilerPayloadError && err.code === "version") {
        fail("version_mismatch", defectEndpoint,
          `A fragment response is version ${String(err.got)}; this page's code speaks a different version. Reloading may pick up matching code.`, false);
      } else {
        fail("bad_payload", defectEndpoint, `Defect: ${(err as Error).message}.`, true);
      }
      return;
    }
    const payload = loadedFiler!;
    loadedFiler = payload;
    filerState = { view: "current", page: 0, period: payload.current };
    filerAggPeriod = "";
    deps.setTitle(`${payload.filerName} — 13F filer — Public Filings`);
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
    changesPage: (dir) => {
      if (!loadedFiler) return;
      filerChangesPage = Math.max(0, filerChangesPage + (dir === "next" ? 1 : -1));
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
      filerChangesPage = 0;
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
    /* The SSR table hoisted any flag carried by every row to a
       table-level note and suppressed it per row. The client must suppress the
       identical set or paging would re-introduce badges the note above the
       table says were stated once. The set is computed server-side over ALL
       rows and travels in `data-stated-flags`, so it cannot drift per page. */
    const statedAttr = table?.getAttribute("data-stated-flags") ?? "";
    const stated = statedAttr === "" ? [] : statedAttr.split(",");
    rowsEl!.innerHTML = entityTxnRowsHtml(items, tableKind, ctx, stated);
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
    periods: Record<
      string,
      { conc: ConcentrationRow | null; deltas: QoqDeltaRow[]; total?: number }
    >;
  };
  try {
    data = JSON.parse(dataEl.textContent ?? "");
  } catch {
    return; // malformed embed: the SSR period stays — no partial re-render
  }
  /* A total that is absent, non-integral, negative, or SMALLER than the
     rows it ships alongside is a contradictory embed. Rendering from it would hide
     real rows behind "no changes" or suppress the truncation terminus, so the whole
     switch stands down and the server-rendered period remains. */
  for (const slice of Object.values(data.periods ?? {})) {
    const n = slice?.total;
    if (
      !Number.isSafeInteger(n) ||
      (n as number) < 0 ||
      (n as number) < (slice?.deltas?.length ?? 0)
    ) {
      return;
    }
  }
  /* The changes table paginates, so the period section carries page
     state. Switching period resets it to 0 — a page index from another quarter
     addresses nothing in this one. */
  /* This started as "" and the pager handler bails on a falsy period,
     so on FIRST LOAD every pager click was swallowed and rows past the first page
     were unreachable until a chip was clicked. Seed from the chip the SSR marked
     active — that is the period the server rendered. */
  let period =
    chips.querySelector<HTMLElement>("[data-period].chip-active")?.dataset.period ??
    chips.querySelector<HTMLElement>("[data-period]")?.dataset.period ??
    "";
  let page = 0;
  const draw = (): void => {
    const slice = data.periods[period];
    if (!slice) return;
    root.innerHTML = filerPeriodSectionHtml(
      slice.conc,
      slice.deltas,
      period,
      data.latestFiled,
      data.topn,
      // `total` is REQUIRED in the embed. A missing or contradictory
      // total is a corrupt embed, handled above by leaving the SSR section alone
      // — never papered over with the embedded length, which would claim a
      // completeness the server never claimed.
      { total: slice.total!, page },
    );
  };
  chips.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-period]");
    if (!btn) return;
    if (!data.periods[btn.dataset.period!]) return;
    period = btn.dataset.period!;
    page = 0;
    draw();
    chips.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((c) => {
      const active = c === btn;
      c.classList.toggle("chip-active", active);
      c.setAttribute("aria-pressed", String(active));
    });
  });
  // Delegated on the root because `draw()` replaces the pager's own subtree.
  root.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-changes-page]");
    if (!btn || btn.getAttribute("aria-disabled") === "true" || !period) return;
    page = Math.max(0, page + (btn.dataset.changesPage === "next" ? 1 : -1));
    draw();
    root.querySelector<HTMLElement>(".pager-range")?.focus();
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
    const parsed: unknown = JSON.parse(dataEl.textContent ?? "");
    // Parsing is not validation. `{}` is valid JSON and
    // would crash on `data.periods`, taking the island down instead of leaving
    // the server-rendered table in place. The embed is build-generated, so a
    // shape mismatch means the build changed shape — degrade, never throw.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { periods?: unknown }).periods !== "object" ||
      (parsed as { periods?: unknown }).periods === null ||
      Array.isArray((parsed as { periods?: unknown }).periods)
    ) {
      return;
    }
    // Validating the container is not enough: a period
    // whose value is not an array passes the check above and then crashes when
    // sorting begins. Every value must be an array before anything is bound.
    const periods = (parsed as { periods: Record<string, unknown> }).periods;
    for (const key of Object.keys(periods)) {
      const list = periods[key];
      if (!Array.isArray(list)) return;
      // And the rows themselves: the
      // renderer reads `filer_name`, `value_usd` and `rank` off every row, so a
      // row that is not an object with those fields crashes at render time.
      // The embed is build-generated; a shape mismatch means the build changed,
      // and the honest response is to leave the SSR table alone.
      for (const row of list) {
        if (typeof row !== "object" || row === null) return;
        const r = row as Record<string, unknown>;
        if (typeof r.filer_name !== "string" || typeof r.cik !== "string") return;
        if (typeof r.value_usd !== "number" || typeof r.rank !== "number") return;
        // Every field the renderer and sorter actually read:
        // `holdersTableHtml` formats `security_count`,
        // prints `issuer_key_source`, and maps `.flags` over EVERY row before
        // any sort happens, so a row passing the four checks above still
        // crashed at interaction time on a missing or mistyped one of these.
        if (typeof r.security_count !== "number") return;
        if (typeof r.issuer_key_source !== "string") return;
        if (!Array.isArray(r.flags) || r.flags.some((f) => typeof f !== "string")) return;
      }
    }
    // The used top-level scalars, same contract: the renderer interpolates
    // `latestFiled` (string | null) and formats `topn` (number). A wrong type
    // here renders garbage or throws inside a formatter, so the island stands
    // down and the SSR table remains.
    const top = parsed as { latestFiled?: unknown; topn?: unknown };
    if (top.latestFiled !== null && typeof top.latestFiled !== "string") return;
    if (typeof top.topn !== "number") return;
    data = parsed as typeof data;
  } catch {
    return;
  }
  // Bind to the SSR-ACTIVE period, never the first key of the payload object:
  // that bug let the first sort serve one quarter's rows under
  // another quarter's label. Refuse to bind rather than guess.
  const activeChip = chips.querySelector<HTMLElement>('[data-period][aria-pressed="true"]')
    ?? chips.querySelector<HTMLElement>("[data-period].chip-active");
  let period = activeChip?.dataset.period ?? "";
  const bindSort = (current: string): void => {
    const rows = data.periods[current];
    if (!rows) return;
    const table = root.querySelector<HTMLElement>("[data-holders-table]");
    const body = table?.querySelector<HTMLElement>("[data-holders-body]");
    if (!table || !body) return;
    const status = root.querySelector<HTMLElement>("[data-holders-status]");
    initSortableTable({
      root: body,
      headers: Array.from(table.querySelectorAll<HTMLElement>("th[data-sort]")),
      keyOf: (th) => (th as HTMLElement).dataset.sort,
      initial: { key: "value", dir: "desc" },
      defaultDir: holderDefaultDir,
      // The caller owns ordering: it re-renders through the SAME renderer the
      // server used and lifts out only the row markup, so a sorted body cannot
      // diverge from a server-rendered one.
      render: (state) => {
        const html = holdersTableHtml(
          rows,
          current,
          data.latestFiled,
          data.topn,
          state as { key: HolderSortKey; dir: "asc" | "desc" },
        );
        const open = html.indexOf("<tbody data-holders-body>");
        const close = html.lastIndexOf("</tbody>");
        return open === -1 || close === -1
          ? body.innerHTML
          : html.slice(open + "<tbody data-holders-body>".length, close);
      },
      announce: (state) => {
        const { unranked } = orderRankedHolders(rows, state.key as HolderSortKey, state.dir);
        return holderSortNote(state.key as HolderSortKey, state.dir, unranked.length);
      },
      statusEl: status,
    });
  };
  if (period && data.periods[period]) bindSort(period);

  chips.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("[data-period]");
    if (!btn) return;
    const next = btn.dataset.period!;
    const rows = data.periods[next];
    if (!rows) return;
    period = next;
    root.innerHTML = holdersTableHtml(rows, next, data.latestFiled, data.topn);
    chips.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((c) => {
      const active = c === btn;
      c.classList.toggle("chip-active", active);
      c.setAttribute("aria-pressed", String(active));
    });
    bindSort(next);
  });
}

/** /e/ browser entry: the real DOM/fetch/timer seams around the pure driver. */
/** The generic route's click delegation, EXTRACTED and exported for testability.

    It was an inline listener body, so the only way to test the controls was to
    call `handle.*` directly — which is exactly what my first tail-route pager
    test did, and it would have stayed green with `[data-changes-page]`
    delegation deleted entirely. Taking an `Element` and a `DriverHandle` makes
    the real path testable with a element stub, no DOM required. */
export function dispatchEntityClick(el: Element, handle: DriverHandle): void {
    if (el.closest("[data-retry]")) {
      void handle.retry();
      return;
    }
    // Filer surface controls (no-ops unless a filer payload is loaded).
    const pageBtn = el.closest<HTMLButtonElement>("[data-holdings-page]");
    if (pageBtn) {
      if (pageBtn.getAttribute("aria-disabled") !== "true") {
        handle.holdingsPage(pageBtn.dataset.holdingsPage === "next" ? "next" : "prev");
      }
      return;
    }
    const changesBtn = el.closest<HTMLButtonElement>("[data-changes-page]");
    if (changesBtn) {
      if (changesBtn.getAttribute("aria-disabled") !== "true") {
        handle.changesPage(changesBtn.dataset.changesPage === "next" ? "next" : "prev");
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
}

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
    dispatchEntityClick(ev.target as Element, handle);
  });
}
