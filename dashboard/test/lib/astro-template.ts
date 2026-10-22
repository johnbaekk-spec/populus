/* Launch F2 (R35, SC5): an `.astro` template's markup as Astro serves it, for
   the budget tests that measure a WHOLE page on fixtures — first-load
   elements (the R35 ruler) and served-HTML words (the SC5 ruler) — without a
   build. It models exactly what the measured pages use and throws on
   anything else, so a page that grows a construct this does not know fails
   loudly here instead of being measured wrong:

   - the frontmatter, `<style>` blocks (Astro moves them into the bundle) and
     `{/* … *\/}` comments are dropped;
   - a bundled `<script>` (no `is:inline`) becomes one external
     `<script type="module">` element, as Astro emits it;
   - `<Fragment set:html={x} />` and `<tag … set:html={x} />` take the value
     the caller supplies for `x`;
   - `{"literal"}` prints the literal; `{name}` prints the caller's value;
     `{name && <tag>…</tag>}` prints the markup when the value is truthy;
   - an attribute `a={…}` or `class:list={…}` becomes `a=""` (attribute values
     carry no words and no elements);
   - whitespace-only text between tags is removed, as Astro's compressHTML does
     (the served T0 pages read `<a>Congress</a><a>Institutional</a>`). */

export type TemplateValues = Readonly<Record<string, string | boolean>>;

/** The index of the brace that closes the one at `open`, skipping quoted
    strings and template literals. */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`astro-template: unbalanced brace at ${open}`);
}

/** The caller's value for an expression, keyed by the expression's text
    (whitespace collapsed): `rangeText`, `build.generatedAt`,
    `markPairPrimary(membersHtml)`. */
function value(expr: string, values: TemplateValues): string | boolean {
  const key = expr.replace(/\s+/g, " ").trim();
  if (!(key in values)) throw new Error(`astro-template: no value supplied for {${key}}`);
  return values[key]!;
}

/** The served markup of an `.astro` file's template. `components` maps a
    component tag (`Mark`) to the markup it renders. */
export function serveAstroTemplate(source: string, values: TemplateValues, components: Readonly<Record<string, string>> = {}): string {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(source);
  let src = fm ? source.slice(fm[0].length) : source;
  src = src.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
  src = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  src = src.replace(/<script\b(?![^>]*\bis:inline)[^>]*>[\s\S]*?<\/script>/g, '<script type="module" src="/_astro/bundled.js"></script>');
  src = src.replace(/<script\b([^>]*)\bis:inline\b([^>]*)>/g, "<script$1$2>");
  for (const [tag, html] of Object.entries(components)) src = src.replace(new RegExp(`<${tag}\\b[^>]*/>`, "g"), html);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "<" && src.startsWith("<Fragment", i)) {
      const end = src.indexOf("/>", i);
      const open = src.indexOf("set:html={", i);
      if (open < 0 || open > src.indexOf(">", i)) throw new Error(`astro-template: unmodelled Fragment at ${i}`);
      const e = closeBrace(src, open + "set:html=".length);
      const close = /^\s*\/>/.exec(src.slice(e + 1));
      if (!close) throw new Error(`astro-template: unmodelled Fragment at ${i}`);
      out += String(value(src.slice(open + "set:html={".length, e), values));
      i = e + 1 + close[0].length;
      continue;
    }
    if (c === "<" && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      // a start tag: rewrite its attribute expressions, and a set:html body
      let j = i + 1;
      let tag = "";
      let setHtml: string | null = null;
      while (j < src.length && src[j] !== ">") {
        if (src[j] === "{") {
          const e = closeBrace(src, j);
          const expr = src.slice(j + 1, e);
          const attr = /([\w:-]+)=$/.exec(tag);
          if (!attr) throw new Error(`astro-template: an expression outside an attribute in a tag: ${expr}`);
          if (attr[1] === "set:html") {
            setHtml = String(value(expr, values));
            tag = tag.slice(0, -attr[0].length);
          } else {
            tag = tag.slice(0, -attr[0].length) + (attr[1] === "class:list" ? 'class=""' : `${attr[1]}=""`);
          }
          j = e + 1;
          continue;
        }
        if (src[j] === '"' || src[j] === "'") {
          const q = src[j]!;
          const e = src.indexOf(q, j + 1);
          tag += src.slice(j, e + 1);
          j = e + 1;
          continue;
        }
        tag += src[j];
        j++;
      }
      const selfClosing = /\/\s*$/.test(tag);
      const name = /^([\w-]+)/.exec(tag)![1]!;
      if (setHtml !== null) {
        out += `<${tag.replace(/\s*\/\s*$/, "")}>${setHtml}</${name}>`;
      } else {
        out += `<${tag}>`;
      }
      i = j + 1;
      if (selfClosing && setHtml === null && !/^(?:br|img|input|meta|link|hr|wbr|source|col|area|base|embed|param|track)$/i.test(name)) out += `</${name}>`;
      continue;
    }
    if (c === "{") {
      const e = closeBrace(src, i);
      const expr = src.slice(i + 1, e).trim();
      const lit = /^"([^"]*)"$/.exec(expr);
      const cond = /^([\w.]+)\s*&&\s*([\s\S]+)$/.exec(expr);
      if (lit) out += lit[1];
      else if (cond && /^</.test(cond[2]!.trim())) {
        if (value(cond[1]!, values)) out += serveAstroTemplate(cond[2]!, values, components);
      } else out += String(value(expr, values));
      i = e + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/>\s+</g, "><").trim();
}

/** First-load elements as a browser builds them with scripting ON (the R35
    ruler, `document.getElementsByTagName("*").length`): every start tag,
    except inside a script (an island's JSON is text) or a noscript (inert
    text when scripting is on) or a comment. */
export function firstLoadElements(html: string): number {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "<noscript></noscript>");
  return (s.match(/<[a-zA-Z][\w-]*(?=[\s>/])/g) ?? []).length;
}
