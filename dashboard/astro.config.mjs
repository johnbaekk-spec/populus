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
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
