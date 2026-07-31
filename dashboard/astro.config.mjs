// @ts-check
import { defineConfig } from "astro/config";

// Static output on Cloudflare Pages, deployed publisher-side (ARCHITECTURE §12.1).
// `site` is intentionally unset: the domain is undecided (OQ-1); nothing here
// may depend on an absolute origin — all data fetches are same-origin relative.
export default defineConfig({
  output: "static",
  build: {
    format: "directory",
    // Keep asset names stable-ish and small; hashing stays on for cacheability.
    inlineStylesheets: "auto",
  },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
