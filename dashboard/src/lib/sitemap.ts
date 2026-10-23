/* sitemap.xml (pre-marketing): every reader page the build emitted, so search
   engines find the long tail (members, tickers, filers, holders) without
   crawling for it. Written after the build from the pages Astro actually
   rendered — never from a second list of routes that could drift. Left out:
   data files and endpoints (anything with an extension), the 404 page, the
   `/e/` client route, and the legacy-URL redirect stubs, which say so with a
   meta refresh in their head. */

/** The page paths Astro reports (`congress/members/A000001/`, `""` for home). */
export function sitemapPaths(pathnames: readonly string[], isRedirect: (pathname: string) => boolean): string[] {
  const keep = pathnames
    .map((p) => p.replace(/^\/+/, ""))
    .filter((p) => !/\.[a-z0-9]+$/i.test(p.replace(/\/$/, "")))
    .filter((p) => p !== "404/" && p !== "404" && p !== "e/" && !p.startsWith("e/"))
    .filter((p) => !isRedirect(p));
  return [...new Set(keep)].sort();
}

const escXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sitemapXml(site: string, paths: readonly string[]): string {
  const base = site.replace(/\/+$/, "");
  const urls = paths.map((p) => `<url><loc>${escXml(`${base}/${p}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** A built page is a redirect stub when its head carries a meta refresh. */
export function isRedirectStub(html: string): boolean {
  const end = html.indexOf("</head>");
  const head = end < 0 ? html : html.slice(0, end);
  return /<meta[^>]+http-equiv=["']?refresh/i.test(head);
}
