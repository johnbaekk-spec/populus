/* Post-build suite, part 2 (R19 / Locked #13): the generic-route proof.

   POPULUS_TEST_PAGE_BUDGET is build-time static-path input — it cannot
   retroactively cut an already-built dist — so this test FIRST performs an
   isolated forced-cut build into dist-cut/, asserts the cut is real (canonical
   page absent, data endpoint present, listing surfaces link /e/?k=…), and
   THEN executes the actual entity-client driver over dist-cut payload BYTES
   through the injected fetch/DOM/timer seams: the happy path (fetch → decode →
   body render → DOM apply → star wiring → pagination), every failure branch
   of the S4 taxonomy, retry, and the watchdog. The driver under test is the
   same function the browser entry calls — nothing here is a reimplementation. */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { totalmem } from "node:os";
import path from "node:path";

import {
  runEntityDriver,
  loadWatchStore,
  type DriverDeps,
  type FetchResult,
  type StorageLike,
} from "../../src/scripts/entity-client.ts";
import { tickerDataKey } from "../../src/lib/derive.ts";
import {
  FILER_INDEX_PATH,
  filerShardPath,
  fragmentFilerPayload,
  type FilerFragmentV2,
  type FilerPayloadV1,
} from "../../src/lib/filer-payload.ts";

const DASH = path.resolve(import.meta.dirname, "..", "..");
const DIST_CUT = path.join(DASH, "dist-cut");
const BUDGET = "10";
const CUT_TICKER = "AAPL"; // every ticker is cut under budget 10 (members first)

before(() => {
  assert.ok(totalmem() >= 34_359_738_368, "forced-cut build requires at least 32 GiB RAM");
  execFileSync("npx", ["astro", "build", "--outDir", "dist-cut"], {
    cwd: DASH,
    env: {
      ...process.env,
      NODE_OPTIONS: "--max-old-space-size=24576",
      POPULUS_TEST_PAGE_BUDGET: BUDGET,
    },
    stdio: "ignore",
    // The full institutional corpus needs roughly 4.5 minutes on the owner
    // runner. Keep the timeout bounded, but above the observed honest build.
    timeout: 900_000,
  });
});

/* ---------- the cut is real ---------- */

test("forced cut: canonical pages absent, endpoints present, listings link /e/", () => {
  assert.ok(
    !existsSync(path.join(DIST_CUT, "tickers", CUT_TICKER, "index.html")),
    "the cut ticker's unified page must NOT be emitted",
  );
  assert.ok(
    !existsSync(path.join(DIST_CUT, "congress", "tickers", CUT_TICKER, "index.html")),
    "the cut ticker's deep page must NOT be emitted",
  );
  assert.ok(
    existsSync(path.join(DIST_CUT, "congress", "data", "tickers", `${tickerDataKey(CUT_TICKER)}.v1.json`)),
    "the cut ticker KEEPS its data endpoint — the record stays reachable",
  );
  const feed = readFileSync(path.join(DIST_CUT, "congress", "index.html"), "utf-8");
  assert.ok(
    feed.includes("/e/?k=t:"),
    "the feed's SSR rows link cut tickers to the generic route, not a 404",
  );
  // a kept member still gets a canonical page under the same build
  const kept = readFileSync(path.join(DIST_CUT, "congress", "index.html"), "utf-8");
  assert.ok(kept.includes("/congress/members/") || kept.includes("/e/?k=m:"));
});

/* ---------- seams ---------- */

interface Harness {
  deps: DriverDeps;
  renders: string[];
  titles: string[];
  storage: StorageLike & { data: Map<string, string> };
  watchdogs: { fn: () => void; ms: number; cancelled: boolean }[];
}

function fakeStorage(): Harness["storage"] {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function harness(search: string, fetchJson: (url: string) => Promise<FetchResult>): Harness {
  const renders: string[] = [];
  const titles: string[] = [];
  const storage = fakeStorage();
  const watchdogs: Harness["watchdogs"] = [];
  const deps: DriverDeps = {
    search,
    fetchJson,
    render: (html) => void renders.push(html),
    setTitle: (t) => void titles.push(t),
    watch: loadWatchStore(storage),
    schedule: (fn, ms) => {
      const entry = { fn, ms, cancelled: false };
      watchdogs.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  return { deps, renders, titles, storage, watchdogs };
}

function realBytes(ticker: string): unknown {
  const p = path.join(DIST_CUT, "congress", "data", "tickers", `${tickerDataKey(ticker)}.v1.json`);
  return JSON.parse(readFileSync(p, "utf-8"));
}

const okFetch =
  (body: unknown) =>
  async (): Promise<FetchResult> => ({ kind: "http", status: 200, body });

/* ---------- happy path over real dist-cut bytes ---------- */

test("happy path: real payload bytes → decode → body render → DOM apply → title", async () => {
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch(realBytes(CUT_TICKER)));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "body");
  assert.equal(h.renders.length, 2, "skeleton first, body second — shell paints before data");
  assert.ok(h.renders[0]!.includes("feed-loading"), "S4 skeleton");
  assert.ok(h.renders[0]!.includes(`/congress/data/tickers/${CUT_TICKER}.v1.json`), "skeleton names its endpoint");
  const body = h.renders[1]!;
  assert.ok(body.includes(CUT_TICKER));
  assert.ok(body.includes("<caption"), "the client body is the same real-table renderer");
  assert.ok(body.includes("Congressional disclosures"));
  assert.ok(body.includes("cell-src"), "SRC receipts survive the client render");
  assert.equal(h.titles[0], `${CUT_TICKER} — disclosures — Public Filings`);
  assert.ok(h.watchdogs[0]!.cancelled, "the watchdog is cancelled on settle");
});

test("star wiring: toggleWatch re-renders with pressed state and persists to the v2 store", async () => {
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch(realBytes(CUT_TICKER)));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  handle.toggleWatch("ticker", CUT_TICKER);
  const rerender = h.renders.at(-1)!;
  assert.ok(rerender.includes('aria-pressed="true"'), "the star re-renders pressed");
  assert.ok(rerender.includes("watching · saved on this device"));
  const v2 = JSON.parse(h.storage.data.get("populus:watch:v2")!);
  assert.deepEqual(v2.tickers, [CUT_TICKER]);
});

test("pagination: older/newer re-render pages through the same body renderer", async () => {
  // Real bytes when a cut entity has >1 page; the boundary itself is what we
  // pin, so a synthetic 60-row payload keeps the assertion deterministic.
  const real = realBytes(CUT_TICKER) as { t: unknown[][]; [k: string]: unknown };
  const row = real.t[0]!;
  const big = { ...real, t: Array.from({ length: 60 }, () => [...row]) };
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch(big));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  const page0 = h.renders.at(-1)!;
  assert.ok(page0.includes("1–50 of 60"));
  handle.older();
  const page1 = h.renders.at(-1)!;
  assert.ok(page1.includes("51–60 of 60"), "older() renders page 2's own count");
  handle.older();
  assert.equal(h.renders.at(-1), page1, "past the last page is a no-op");
  handle.newer();
  assert.ok(h.renders.at(-1)!.includes("1–50 of 60"));
});

/* ---------- S2 + every S4 failure branch (spec §3) ---------- */

test("404 → S2 out-of-extract with the primary-source CTA", async () => {
  const h = harness("?k=t:ZZZZFAKE", async () => ({ kind: "http", status: 404, body: null }));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "s2");
  const s2 = h.renders.at(-1)!;
  assert.ok(s2.includes("We don't render a page for this ticker."));
  assert.ok(s2.includes("sec.gov"));
});

/* RUN M2-11 R22 replaced the "filer keys go straight to S2" contract: a filer
   key now fetches the routing index to LEARN whether the filer is in the
   published extract. The PROPERTY these two tests pin is unchanged — an
   out-of-extract filer still lands S2 with the 13F primary-source CTA — but the
   mechanism is one index fetch, never zero. The old zero-fetch assertion would
   now pass only if the index fetch were dropped, which is the R22 regression
   these tests exist to catch. */

test("filer key with a 404 routing index → S2 after exactly one fetch", async () => {
  const urls: string[] = [];
  const h = harness("?k=f:1999999", async (url) => {
    urls.push(url);
    return { kind: "http", status: 404, body: null };
  });
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "s2");
  assert.deepEqual(urls, [FILER_INDEX_PATH], "exactly the index, nothing else");
  assert.ok(h.renders.at(-1)!.includes("13F"));
});

test("filer key absent from a real routing index → S2, no shard fetched", async () => {
  const urls: string[] = [];
  const h = harness("?k=f:1999999", async (url) => {
    urls.push(url);
    // a valid index that simply does not carry this CIK
    return { kind: "http", status: 200, body: { v: 2, kind: "filer-index", absent: null, routes: {} } };
  });
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "s2");
  assert.deepEqual(urls, [FILER_INDEX_PATH], "absence decided by the index — no shard fetch");
  assert.ok(h.renders.at(-1)!.includes("13F"));
});

test("STRICT (F6): a routing index with an undeclared key → bad_payload naming it", async () => {
  const h = harness("?k=f:1999999", async () => ({
    kind: "http",
    status: 200,
    body: { v: 2, kind: "filer-index", absent: null, routes: {}, injected: true },
  }));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "bad_payload");
  // esc() renders the quotes as &quot; — assert on the words either side.
  assert.ok(h.renders.at(-1)!.includes("undeclared key"));
  assert.ok(h.renders.at(-1)!.includes("injected"));
});

interface FilerFamilyFixture {
  cik: string;
  payload: FilerPayloadV1;
  fragments: FilerFragmentV2[];
  index: Record<string, unknown>;
  shards: Map<number, Record<string, unknown>>;
}

function parityFilerPayload(): FilerPayloadV1 {
  const parity = JSON.parse(
    readFileSync(path.join(DASH, "..", "tests", "fixtures", "filer_payload_parity.v1.json"), "utf8"),
  ) as { cases: { expected?: string }[] };
  const expected = parity.cases.find((c) => c.expected !== undefined)?.expected;
  assert.ok(expected, "the shared parity fixture carries a literal logical payload");
  return JSON.parse(expected) as FilerPayloadV1;
}

function validFilerFamily(): FilerFamilyFixture {
  const payload = parityFilerPayload();
  const fragments = fragmentFilerPayload(payload);
  assert.ok(fragments.length > 1, "the orchestration fixture must cross shard boundaries");
  const shardCount = fragments.length;
  const shards = new Map<number, Record<string, unknown>>();
  for (const fragment of fragments) {
    shards.set(fragment.part, {
      v: 2,
      kind: "filer-fragment-shard",
      shard: fragment.part,
      shard_count: shardCount,
      entries: { [`${fragment.cik}:${fragment.part}`]: fragment },
    });
  }
  return {
    cik: payload.cik,
    payload,
    fragments,
    index: {
      v: 2,
      kind: "filer-index",
      absent: null,
      routes: { [payload.cik]: [0, shardCount - 1, fragments.length] },
    },
    shards,
  };
}

async function runFilerWith(
  indexBody: unknown,
  shardBodies: Map<number, unknown>,
  cik = validFilerFamily().cik,
): Promise<{ state: string; lastRender: string; urls: string[] }> {
  const urls: string[] = [];
  const h = harness(`?k=f:${Number(cik)}`, async (url) => {
    urls.push(url);
    if (url === FILER_INDEX_PATH) return { kind: "http", status: 200, body: indexBody };
    const match = /\/(\d+)\.v2\.json$/.exec(url);
    const body = match ? shardBodies.get(Number(match[1])) : undefined;
    return body === undefined
      ? { kind: "http", status: 404, body: null }
      : { kind: "http", status: 200, body };
  });
  const handle = runEntityDriver(h.deps);
  await handle.done;
  return { state: handle.state(), lastRender: h.renders.at(-1)!, urls };
}

test("v2 multi-shard happy path fetches the exact contiguous range and renders", async () => {
  const family = validFilerFamily();
  const r = await runFilerWith(family.index, family.shards, family.cik);
  assert.equal(r.state, "body");
  assert.ok(r.lastRender.includes(family.payload.filerName));
  assert.deepEqual(r.urls, [
    FILER_INDEX_PATH,
    ...family.fragments.map((fragment) => filerShardPath(fragment.part)),
  ]);
});

test("STRICT (F6): a shard envelope with an undeclared key → bad_payload naming it", async () => {
  const family = validFilerFamily();
  const shards = new Map(family.shards);
  shards.set(0, { ...shards.get(0)!, smuggled: 1 });
  const r = await runFilerWith(family.index, shards, family.cik);
  assert.equal(r.state, "bad_payload");
  assert.ok(r.lastRender.includes("undeclared key"));
  assert.ok(r.lastRender.includes("smuggled"));
});

/* Envelope validation requires presence + type of every discriminator and
   geometry field; deleting any one must fail closed before rendering. */

test("F5: each required routing-index field, DELETED → bad_payload naming it", async () => {
  const family = validFilerFamily();
  for (const field of ["v", "kind", "absent", "routes"] as const) {
    const body = structuredClone(family.index);
    delete body[field];
    const r = await runFilerWith(body, family.shards, family.cik);
    assert.equal(r.state, "bad_payload", `index without ${field} must be bad_payload`);
    assert.ok(
      r.lastRender.includes(field === "v" ? "version" : field),
      `the defect names ${field}`,
    );
  }
});

test("F5: each required shard-envelope field, DELETED → bad_payload naming it", async () => {
  const family = validFilerFamily();
  for (const field of ["v", "kind", "shard", "shard_count", "entries"] as const) {
    const body = structuredClone(family.shards.get(0)!);
    delete body[field];
    const shards = new Map(family.shards);
    shards.set(0, body);
    const r = await runFilerWith(family.index, shards, family.cik);
    assert.equal(r.state, "bad_payload", `shard without ${field} must be bad_payload`);
    assert.ok(
      r.lastRender.includes(field === "v" ? "version" : field),
      `the defect names ${field}`,
    );
  }
});

test("F5: a malformed route tuple → bad_payload, never a silent S2", async () => {
  const family = validFilerFamily();
  const body = structuredClone(family.index) as { routes: Record<string, unknown> };
  body.routes[family.cik] = 7;
  const r = await runFilerWith(body, family.shards, family.cik);
  assert.equal(r.state, "bad_payload");
  assert.ok(r.lastRender.includes("not three integers"));
  assert.ok(r.lastRender.includes(family.cik));
});

test("F5: wrong kind discriminators → bad_payload naming the kind", async () => {
  const family = validFilerFamily();
  const idx = structuredClone(family.index);
  idx.kind = "filer-fragment-shard";
  const r1 = await runFilerWith(idx, family.shards, family.cik);
  assert.equal(r1.state, "bad_payload");
  assert.ok(r1.lastRender.includes("filer-index"));
  const shards = new Map(family.shards);
  const shard = structuredClone(shards.get(0)!);
  shard.kind = "filer-index";
  shards.set(0, shard);
  const r2 = await runFilerWith(family.index, shards, family.cik);
  assert.equal(r2.state, "bad_payload");
  assert.ok(r2.lastRender.includes("fragment shard kind"));
});

test("route geometry and a missing shard fail closed", async () => {
  const family = validFilerFamily();
  const tooWide = structuredClone(family.index) as { routes: Record<string, unknown> };
  tooWide.routes[family.cik] = [0, 64, 65];
  const range = await runFilerWith(tooWide, family.shards, family.cik);
  assert.equal(range.state, "bad_payload");
  assert.ok(range.lastRender.includes("outside its bounds"));

  const missing = new Map(family.shards);
  missing.delete(family.fragments.at(-1)!.part);
  const shard = await runFilerWith(family.index, missing, family.cik);
  assert.equal(shard.state, "server_error");
  assert.ok(shard.lastRender.includes("HTTP 404"));
});

test("HTTP 5xx → honest server_error with retry; retry succeeds", async () => {
  let attempt = 0;
  const h = harness(`?k=t:${CUT_TICKER}`, async () => {
    attempt++;
    if (attempt === 1) return { kind: "http", status: 503, body: null };
    return { kind: "http", status: 200, body: realBytes(CUT_TICKER) };
  });
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "server_error");
  const err = h.renders.at(-1)!;
  assert.ok(err.includes("HTTP 503"));
  assert.ok(err.includes("data-retry"));
  assert.ok(err.includes(".v1.json"), "raw-endpoint link offered");
  await handle.retry();
  assert.equal(handle.state(), "body", "retry runs the full flow again");
});

test("network rejection → network_error with retry + raw endpoint link", async () => {
  const h = harness(`?k=t:${CUT_TICKER}`, async () => ({ kind: "network" }));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "network_error");
  assert.ok(h.renders.at(-1)!.includes("did not complete"));
});

test("malformed payload → bad_payload naming the defect", async () => {
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch({ nonsense: true }));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "bad_payload");
  assert.ok(h.renders.at(-1)!.includes("no version field"));
});

test("version mismatch → non-retryable, names both sides", async () => {
  const real = realBytes(CUT_TICKER) as Record<string, unknown>;
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch({ ...real, v: 999 }));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "version_mismatch");
  const err = h.renders.at(-1)!;
  assert.ok(err.includes("version 999"));
  assert.ok(!err.includes("data-retry"), "retry is pointless and not offered");
});

test("renderer throw → render_error keeps the raw-endpoint escape hatch", async () => {
  const h = harness(`?k=t:${CUT_TICKER}`, okFetch(realBytes(CUT_TICKER)));
  h.deps.renderBody = () => {
    throw new Error("boom");
  };
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "render_error");
  const err = h.renders.at(-1)!;
  assert.ok(err.includes("failed to draw it"));
  assert.ok(err.includes(".v1.json"), "the reader can still reach the record");
});

test("watchdog: a hung fetch ends the skeleton with the timeout state", async () => {
  const h = harness(
    `?k=t:${CUT_TICKER}`,
    () => new Promise<FetchResult>(() => {}), // never settles
  );
  h.deps.watchdogMs = 5;
  const handle = runEntityDriver(h.deps);
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(h.watchdogs.length, 1);
  h.watchdogs[0]!.fn(); // the timer seam fires
  assert.equal(handle.state(), "timeout");
  const err = h.renders.at(-1)!;
  assert.ok(err.includes("taking too long"));
  assert.ok(err.includes("data-retry"), "the skeleton is never indefinite and retry is offered");
});

test("invalid or missing key → key_error, no fetch attempted", async () => {
  let fetched = 0;
  const h = harness("?k=garbage", async () => {
    fetched++;
    return { kind: "network" };
  });
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "key_error");
  assert.equal(fetched, 0);
  const missing = harness("", async () => ({ kind: "network" }));
  const mh = runEntityDriver(missing.deps);
  await mh.done;
  assert.equal(mh.state(), "key_error");
  assert.ok(missing.renders.at(-1)!.includes("names no entity key"));
});

test("member happy path over real dist-cut bytes (cut member)", async () => {
  // Budget 10 keeps the top-10 members; pick any member whose canonical page
  // was NOT emitted but whose endpoint was — the definition of a cut entity.
  const { readdirSync } = await import("node:fs");
  const endpoints = readdirSync(path.join(DIST_CUT, "congress", "data", "members"));
  const pages = new Set(readdirSync(path.join(DIST_CUT, "congress", "members")));
  const cut = endpoints.map((f) => f.replace(".v1.json", "")).find((b) => !pages.has(b));
  assert.ok(cut, "a cut member exists under the forced budget");
  const body = JSON.parse(
    readFileSync(path.join(DIST_CUT, "congress", "data", "members", `${cut}.v1.json`), "utf-8"),
  );
  const h = harness(`?k=m:${cut}`, okFetch(body));
  const handle = runEntityDriver(h.deps);
  await handle.done;
  assert.equal(handle.state(), "body");
  const html = h.renders.at(-1)!;
  assert.ok(html.includes("bioguide"), "member body renders");
  assert.ok(html.includes("<caption"), "same real-table renderer as SSR");
  assert.equal(pages.size, 10, "exactly the budgeted member pages were emitted");
});


/* F3: routing/payload identity binding over the real parity payload. Mutating
   every transport envelope to the routed CIK leaves the logical metadata at
   the original CIK; reassembly must detect that contradiction before render. */
test("F3: fragment metadata declaring a different cik than its routing is bad_payload", async () => {
  const family = validFilerFamily();
  const routedCik = "0009999990";
  assert.notEqual(family.cik, routedCik, "fixture is vacuous unless the CIKs differ");
  const fragments = family.fragments.map((fragment) => ({ ...fragment, cik: routedCik }));
  const shards = new Map<number, Record<string, unknown>>();
  for (const fragment of fragments) {
    shards.set(fragment.part, {
      v: 2,
      kind: "filer-fragment-shard",
      shard: fragment.part,
      shard_count: fragments.length,
      entries: { [`${routedCik}:${fragment.part}`]: fragment },
    });
  }
  const index = {
    v: 2,
    kind: "filer-index",
    absent: null,
    routes: { [routedCik]: [0, fragments.length - 1, fragments.length] },
  };
  const r = await runFilerWith(index, shards, routedCik);
  assert.equal(r.state, "bad_payload", "a foreign-CIK payload must fail closed");
  assert.ok(/metadata CIK.*contradicts envelope CIK/i.test(r.lastRender), "the defect is named");
});
