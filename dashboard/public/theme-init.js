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
