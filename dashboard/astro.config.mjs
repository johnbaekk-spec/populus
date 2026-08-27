// @ts-check
import { defineConfig } from "astro/config";

// Static output on Cloudflare Pages, deployed publisher-side (ARCHITECTURE §12.1).
// `site` resolves OQ-1: publicfilings.org. Data fetches remain same-origin
// relative; `site` exists for canonical/OG URL generation only.
export default defineConfig({
  site: "https://publicfilings.org",
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
