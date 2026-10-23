// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";
import { isRedirectStub, sitemapPaths, sitemapXml } from "./src/lib/sitemap.ts";

const SITE = "https://publicfilings.org";

/* pre-marketing: sitemap.xml from the pages this build rendered (src/lib/sitemap.ts) */
const sitemap = {
  name: "populus-sitemap",
  hooks: {
    "astro:build:done": async ({ pages, dir, logger }) => {
      const redirects = new Set();
      for (const { pathname } of pages) {
        if (!pathname.endsWith("/") && pathname !== "") continue;
        try {
          const html = await readFile(new URL(`${pathname}index.html`, dir), "utf-8");
          if (isRedirectStub(html)) redirects.add(pathname.replace(/^\/+/, ""));
        } catch {}
      }
      const paths = sitemapPaths(pages.map((p) => p.pathname), (p) => redirects.has(p));
      await writeFile(new URL("sitemap.xml", dir), sitemapXml(SITE, paths));
      logger.info(`sitemap.xml: ${paths.length} pages`);
    },
  },
};

// Static output on Cloudflare Pages, deployed publisher-side (ARCHITECTURE §12.1).
// `site` resolves OQ-1: publicfilings.org. Data fetches remain same-origin
// relative; `site` exists for canonical/OG URL generation only.
export default defineConfig({
  site: SITE,
  integrations: [sitemap],
  output: "static",
  build: {
    format: "directory",
    // Keep asset names stable-ish and small; hashing stays on for cacheability.
    inlineStylesheets: "auto",
  },
  // RUN PUBLIC-SECURITY-HARDENING R12/LD13: `script-src 'self'` with NO inline
  // hashes. Vite otherwise inlines any bundled script under 4 KiB (the masthead
  // toggle module was one), which would re-grow an inline surface the CSP no
  // longer admits. Zero forces every bundled script external.
  vite: { build: { assetsInlineLimit: 0 } },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
