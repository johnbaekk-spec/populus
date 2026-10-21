/* The launch redesign's word ruler (SC5, R28, R29): the copy audit's own
   counting rule over SERVED HTML — equivalently JavaScript off. A faithful
   port of the audit's executed pipeline (`tools/outline.py`,
   `tools/wordcount.py`, `tools/split_tabs.py`, run by M0's `words-ruler.mjs`),
   which reproduced the audit's `words_visible_before` exactly on all 16 page
   states (evidence: docs/design/launch-redesign-run/M0/
   t04-controls-live-20261020.2/, main checkout). The port was checked against
   the Python tools on that evidence's served Signals page: 946 on the
   Playbooks tab, 230 / 210 / 113 on the other three (DEV-NOTES, launch M5).

   Counted: text at page load in the default state. Not counted: tip text
   (`.note-pop`), screen-reader-only text, `hidden` subtrees, a closed
   `<details>` body, table-body data cells, the audit's data-row classes, and
   script, style, template, svg and noscript content. Words are whitespace
   tokens with a letter or digit; · ↗ ⓘ and the other marks do not count.
   Like the audit's tools, adjacent inline elements with no whitespace between
   them read as one token: the ruler measures the markup as served. */

const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "wbr", "source", "col", "area", "base", "embed", "param", "track"]);
const BLOCK = new Set([
  "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "header", "footer", "table", "dt", "dd",
  "summary", "details", "figcaption", "caption", "ul", "ol", "dl", "nav", "main", "article", "aside", "figure",
  "thead", "tbody", "label", "form", "fieldset", "legend", "blockquote", "pre",
]);
const SKIP = new Set(["script", "style", "template", "svg", "noscript"]);
const RAW_TEXT = new Set(["script", "style"]);
const DATA_CLASSES = [
  "si-row-sum", "mv-sum", "cs-row", "cv-row", "cl-line", "ov-sum", "ov-mline", "rb-label", "tl-plot", "tl-axis",
  "ledger-value", "si-card-h", "si-card-who", "si-card-dates", "si-family-list", "si-row-reason", "si-row-links",
  "tile-value", "rb-col", "agree-row", "cell-src", "band-fill", "mf-bcol", "pager-range",
];
const MARKS = /[⏎↗↓→←▲▼◂▸ⓘ§†‡·|/⌕☰]/g;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

function attrsOf(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) out.set(m[1]!.toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? ""));
  return out;
}

type Flag = "SKIP" | "TIP" | "SR" | "HID" | "DETBODY" | "SUMMARY" | "TBODY" | "TD" | "TH" | "CAP";

/** `outline.py`: one `[tag] text` line per block, with tip, screen-reader,
    hidden, collapsed-details and data-cell text marked ⟦KIND:…⟧. */
export function outline(html: string): string[] {
  const stack: { tag: string; flags: Set<Flag> }[] = [];
  const lines: string[] = [];
  let cur: string[] = [];
  let curtag = "";
  const flags = (): Set<Flag> => {
    const f = new Set<Flag>();
    for (const s of stack) for (const x of s.flags) f.add(x);
    return f;
  };
  const flush = (): void => {
    const txt = cur.join("").replace(/\s+/g, " ").trim();
    if (txt) lines.push(`[${curtag}] ${txt}`);
    cur = [];
  };
  const data = (d: string): void => {
    const f = flags();
    if (f.has("SKIP")) return;
    if (!d.trim()) {
      cur.push(d);
      return;
    }
    let mark = "";
    if (f.has("TIP")) mark = "TIP";
    else if (f.has("SR")) mark = "SR";
    else if (f.has("HID")) mark = "HID";
    else if (f.has("DETBODY") && !f.has("SUMMARY")) mark = "DET";
    if (f.has("TD") && f.has("TBODY")) mark = (mark ? `${mark}|` : "") + "DATA";
    cur.push(mark ? `⟦${mark}:${d}⟧` : d);
  };
  const start = (t: string, a: Map<string, string>): void => {
    const cls = (a.get("class") ?? "").split(/\s+/).filter(Boolean);
    const fl = new Set<Flag>();
    if (SKIP.has(t)) fl.add("SKIP");
    if (cls.includes("note-pop")) fl.add("TIP");
    if (cls.includes("visually-hidden") || cls.includes("sr-only")) fl.add("SR");
    if (a.has("hidden") && t !== "input") fl.add("HID");
    if (t === "details" && !a.has("open")) fl.add("DETBODY");
    if (t === "summary") fl.add("SUMMARY");
    if (t === "tbody") fl.add("TBODY");
    if (t === "td") fl.add("TD");
    if (t === "th") fl.add("TH");
    if (t === "caption") fl.add("CAP");
    if (BLOCK.has(t) || t === "td" || t === "th") {
      flush();
      let tag = t + (cls.length ? `.${cls.slice(0, 3).join(".")}` : "");
      if (a.get("id")) tag += `#${a.get("id")}`;
      curtag = tag;
    }
    if (!VOID.has(t)) stack.push({ tag: t, flags: fl });
    const f = flags();
    for (const x of fl) f.add(x);
    if (f.has("SKIP")) return;
    for (const k of ["aria-label", "title", "placeholder", "data-tip", "alt"]) {
      const v = a.get(k);
      if (v) cur.push(` ⟦@${k}:${v}⟧ `);
    }
    if (t === "input" && a.get("value") && (a.get("type") === "submit" || a.get("type") === "button")) cur.push(a.get("value")!);
    if (t === "br") cur.push(" ⏎ ");
  };
  const end = (t: string): void => {
    if (VOID.has(t)) return;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.tag === t) {
        if (BLOCK.has(t) || t === "td" || t === "th") flush();
        stack.length = i;
        break;
      }
    }
  };
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let at = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > at) data(decode(html.slice(at, m.index)));
    at = re.lastIndex;
    if (m[1] !== undefined) end(m[1].toLowerCase());
    else if (m[2] !== undefined) {
      const t = m[2].toLowerCase();
      start(t, attrsOf(m[3] ?? ""));
      if (/\/\s*$/.test(m[3] ?? "") && !VOID.has(t)) end(t);
      else if (RAW_TEXT.has(t)) {
        const close = html.toLowerCase().indexOf(`</${t}`, at);
        const stop = close < 0 ? html.length : close;
        if (stop > at) data(html.slice(at, stop));
        at = stop;
        re.lastIndex = stop;
      }
    }
  }
  if (at < html.length) data(decode(html.slice(at)));
  flush();
  return lines;
}

/** `wordcount.py`: the visible copy words of an outline. */
export function wordsOfOutline(lines: readonly string[]): { total: number; rows: { n: number; tag: string; text: string }[] } {
  let total = 0;
  const rows: { n: number; tag: string; text: string }[] = [];
  for (const line of lines) {
    const m = /^\[([^\]]*)\] ?([\s\S]*)$/.exec(line);
    if (!m) continue;
    const [, tag, txt] = m;
    if (tag === "") continue;
    if (DATA_CLASSES.some((c) => tag!.includes(c))) continue;
    const vis = txt!.replace(/⟦[A-Z|]+:[^⟧]*⟧/g, "").replace(/⟦@[^⟧]*⟧/g, "").replace(MARKS, " ");
    const words = vis.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    if (words.length) {
      total += words.length;
      rows.push({ n: words.length, tag: tag!, text: words.join(" ") });
    }
  }
  return { total, rows };
}

/** The served-HTML word count of a document or fragment. */
export function servedWords(html: string): number {
  return wordsOfOutline(outline(html)).total;
}

/** `split_tabs.py`: the document with every tabpanel but `id` removed. */
export function splitTab(html: string, id: string): string {
  const spans: { id: string; s: number; e: number }[] = [];
  const open = /<section[^>]*role="tabpanel"[^>]*id="([^"]+)"[^>]*>/g;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const s = m.index;
    let depth = 0;
    let e = html.length;
    const tag = /<(\/?)section\b/g;
    tag.lastIndex = s;
    for (let t = tag.exec(html); t; t = tag.exec(html)) {
      depth += t[1] === "" ? 1 : -1;
      if (depth === 0) {
        e = html.indexOf(">", t.index + t[0].length) + 1;
        break;
      }
    }
    spans.push({ id: m[1]!, s, e });
  }
  let out = html;
  for (const sp of [...spans].sort((a, b) => b.s - a.s)) if (sp.id !== id) out = out.slice(0, sp.s) + out.slice(sp.e);
  return out;
}

/** Each `<article class="pb-main" id="pb-…">` of a fragment, as served
    (R28: an article is counted inside its own element). */
export function playbookArticles(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<article class="pb-main" id="(pb-[^"]+)"[^>]*>[\s\S]*?<\/article>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.set(m[1]!, m[0]);
  return out;
}
