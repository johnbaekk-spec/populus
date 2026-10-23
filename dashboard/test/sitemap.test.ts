/* pre-marketing: sitemap.xml lists reader pages only — no data files, no 404,
   no /e/ client route, no redirect stubs — once each, sorted. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isRedirectStub, sitemapPaths, sitemapXml } from "../src/lib/sitemap.ts";

const PAGES = [
  "", "congress/", "congress/members/A000001/", "tickers/AAPL/", "institutional/filers/1067983/",
  "stats.json", "congress/data/feed/0.v1.json", "legal/NOTICE.txt", "404/", "e/", "congress/tickers/", "signals/", "signals/",
];

test("reader pages only, once each, sorted; data files, 404, /e/ and redirect stubs left out", () => {
  const paths = sitemapPaths(PAGES, (p) => p === "congress/tickers/");
  assert.deepEqual(paths, ["", "congress/", "congress/members/A000001/", "institutional/filers/1067983/", "signals/", "tickers/AAPL/"]);
});

test("the XML names each page by its absolute URL under the site", () => {
  const xml = sitemapXml("https://publicfilings.org/", ["", "tickers/BRK&B/"]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<url><loc>https:\/\/publicfilings\.org\/<\/loc><\/url>/);
  assert.match(xml, /<loc>https:\/\/publicfilings\.org\/tickers\/BRK&amp;B\/<\/loc>/);
});

test("a redirect stub is read from its head's meta refresh, as the legacy-URL pages emit it", () => {
  assert.ok(isRedirectStub(`<html><head><link rel="canonical" href="/congress/" /><meta http-equiv="refresh" content="0; url=/congress/" /></head><body></body></html>`));
  assert.ok(!isRedirectStub(`<html><head><title>x</title></head><body><p>meta http-equiv="refresh"</p></body></html>`));
  const stub = readFileSync(path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "tickers", "index.astro"), "utf-8");
  assert.match(stub, /http-equiv="refresh"/, "the stub this reads is still a meta-refresh page");
});

test("robots.txt allows crawling and names the sitemap", () => {
  const robots = readFileSync(path.resolve(import.meta.dirname, "..", "public", "robots.txt"), "utf-8");
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/m);
  assert.match(robots, /^Sitemap: https:\/\/publicfilings\.org\/sitemap\.xml$/m);
});
