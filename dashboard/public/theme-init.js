// Pre-paint theme: an explicit choice wins; otherwise the CSS
// prefers-color-scheme fallback applies. Loaded synchronously from <head>
// (RUN PUBLIC-SECURITY-HARDENING R12/LD13): the body is the former Base.astro
// inline IIFE, moved byte-for-byte so `script-src 'self'` needs no inline
// hash. Synchronous on purpose — deferring it would repaint (FOUC).
(function () {
  try {
    var t = localStorage.getItem("populus:theme");
    if (t === "light" || t === "dark")
      document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
// Legacy-key cleanup (signals-v3 M1, declared debt TD-1: remove this block on
// or after 2027-01-31). The device-local watchlist was removed from the site;
// these are exactly the four localStorage keys it wrote. Removing an absent
// key is a no-op, so the cleanup is one-time in effect, and best-effort: a
// browser that denies storage access leaves nothing to clean.
(function () {
  try {
    localStorage.removeItem("populus:watch:v2");
    localStorage.removeItem("populus:watch:members");
    localStorage.removeItem("populus:watch:v2.corrupt");
    localStorage.removeItem("populus:watch:cursor:v1");
  } catch (e) {}
})();
