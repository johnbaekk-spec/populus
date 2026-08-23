/* A small DOM built by PARSING REAL RENDERED HTML.

   WHY THIS EXISTS, AND WHY `fake-dom.ts` COULD NOT DO IT.

   `makeDom(ids)` in `fake-dom.ts` hands back an element for ANY id it is asked
   for. That is fine for proving a load path is wired at all, and it is exactly
   what hid the worst defect of this run: `initFeed` required `#feed`, the real
   page had dropped that id, and the whole congress island was dead on the built
   page while every test passed. A double that answers every question with "yes"
   cannot fail the way the page failed.

   So this one answers from BYTES. You give it markup — in the tests, markup
   produced by the same `congressRankingSection` the page renders — and it can
   only find what is actually in there. An element the renderer stopped emitting
   is an element this DOM does not have, and the island's behaviour changes the
   way it changes in a browser.

   It is deliberately small. It parses the well-formed markup this repository's
   renderers emit; it is not a general HTML parser and does not try to be. What
   it does support is exactly the surface `initCongressSections` touches, and
   anything outside that throws rather than guessing — a silent "not supported"
   is how a double starts lying again.

   Selectors: tag, `#id`, `.class`, `[attr]`, `[attr="value"]`, any combination
   of those on one compound, and descendant combinators between compounds. */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ",
};

function decode(text: string): string {
  return text.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);
}

export class MiniElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: MiniElement[] = [];
  parent: MiniElement | null = null;
  /** text nodes are kept as siblings-in-order so textContent is faithful */
  nodes: (MiniElement | string)[] = [];
  private listeners = new Map<string, (() => void)[]>();

  constructor(tagName: string, attrs: Map<string, string> = new Map()) {
    this.tagName = tagName.toLowerCase();
    this.attributes = attrs;
  }

  /* ---------- attributes ---------- */

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  /** `hidden` is a REFLECTED property: the SSR bytes carry it as an attribute
      and the islands set it as a property. Treating them as two different
      things is how a server-rendered `hidden` shell would look visible to a
      test that only ever set the property. */
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }
  set hidden(on: boolean) {
    if (on) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  get dataset(): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of this.attributes) {
      if (!k.startsWith("data-")) continue;
      out[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
    }
    return out;
  }

  get classList(): { contains(name: string): boolean } {
    const classes = new Set((this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
    return { contains: (n: string) => classes.has(n) };
  }

  /* ---------- tree ---------- */

  get previousElementSibling(): MiniElement | null {
    if (!this.parent) return null;
    const i = this.parent.children.indexOf(this);
    return i > 0 ? this.parent.children[i - 1]! : null;
  }

  closest(sel: string): MiniElement | null {
    let node: MiniElement | null = this;
    while (node) {
      if (matchesCompound(node, sel)) return node;
      node = node.parent;
    }
    return null;
  }

  querySelector(sel: string): MiniElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel: string): MiniElement[] {
    const compounds = sel.trim().split(/\s+(?![^[]*\])/);
    let scope: MiniElement[] = [this];
    for (const compound of compounds) {
      const next: MiniElement[] = [];
      for (const root of scope) {
        for (const d of descendants(root)) {
          if (matchesCompound(d, compound) && !next.includes(d)) next.push(d);
        }
      }
      scope = next;
    }
    return scope;
  }

  /* ---------- content ---------- */

  get innerHTML(): string {
    return this.nodes.map((n) => (typeof n === "string" ? n : n.outerHTML)).join("");
  }
  set innerHTML(html: string) {
    this.nodes = [];
    this.children = [];
    parseInto(this, html);
  }

  get outerHTML(): string {
    const attrs = [...this.attributes]
      .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${v}"`))
      .join("");
    if (VOID.has(this.tagName)) return `<${this.tagName}${attrs} />`;
    return `<${this.tagName}${attrs}>${this.innerHTML}</${this.tagName}>`;
  }

  get textContent(): string {
    return this.nodes
      .map((n) => (typeof n === "string" ? decode(n) : n.textContent))
      .join("");
  }
  set textContent(text: string) {
    this.nodes = [text];
    this.children = [];
  }

  /* ---------- events ---------- */

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn();
  }

  /** internal: used by the parser */
  appendNode(n: MiniElement | string): void {
    this.nodes.push(n);
    if (typeof n !== "string") {
      n.parent = this;
      this.children.push(n);
    }
  }
}

function* descendants(root: MiniElement): Generator<MiniElement> {
  for (const c of root.children) {
    yield c;
    yield* descendants(c);
  }
}

/** One compound selector — no combinators. Throws on anything unsupported so a
    selector this DOM cannot honour fails loudly instead of matching nothing. */
function matchesCompound(el: MiniElement, compound: string): boolean {
  const parts = compound.match(/^[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[[^\]]+\]/g);
  if (!parts || parts.join("") !== compound) {
    throw new Error(`mini-dom: unsupported selector "${compound}"`);
  }
  for (const p of parts) {
    if (p.startsWith("#")) {
      if (el.id !== p.slice(1)) return false;
    } else if (p.startsWith(".")) {
      if (!el.classList.contains(p.slice(1))) return false;
    } else if (p.startsWith("[")) {
      const m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p);
      if (!m) throw new Error(`mini-dom: unsupported attribute selector "${p}"`);
      const [, name, value] = m;
      if (!el.hasAttribute(name!)) return false;
      if (value !== undefined && el.getAttribute(name!) !== value) return false;
    } else if (el.tagName !== p.toLowerCase()) {
      return false;
    }
  }
  return true;
}

const TAG = /<(\/)?([a-zA-Z][\w-]*)((?:\s+[^\s/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/)?>/g;

function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    if (!m[1]) continue;
    out.set(m[1], m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Parse `html` and append the result to `owner`, in document order. */
function parseInto(owner: MiniElement, html: string): void {
  const stack: MiniElement[] = [owner];
  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    const top = stack[stack.length - 1]!;
    if (m.index > last) top.appendNode(html.slice(last, m.index));
    last = TAG.lastIndex;
    const [, closing, tag, attrs, selfClose] = m;
    const name = tag!.toLowerCase();
    if (closing) {
      // Tolerate a stray close tag rather than corrupting the stack: our own
      // renderers do not emit one, and if they ever did, the test that noticed
      // should be the one about the markup, not a crash in here.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tagName === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el = new MiniElement(name, parseAttrs(attrs ?? ""));
    top.appendNode(el);
    if (!selfClose && !VOID.has(name)) stack.push(el);
  }
  if (last < html.length) stack[stack.length - 1]!.appendNode(html.slice(last));
}

export interface MiniDocument {
  documentElement: MiniElement;
  getElementById(id: string): MiniElement | null;
  querySelector(sel: string): MiniElement | null;
  querySelectorAll(sel: string): MiniElement[];
}

/** Parse a document fragment and install it as `globalThis.document`.

    `globalThis.HTMLElement` is set to `MiniElement` so an `instanceof
    HTMLElement` guard in production code narrows correctly here instead of
    throwing `HTMLElement is not defined`. Returns a restore function. */
export function installDom(html: string): { doc: MiniDocument; restore(): void } {
  const documentElement = new MiniElement("body");
  documentElement.innerHTML = html;
  const doc: MiniDocument = {
    documentElement,
    getElementById: (id) =>
      id ? documentElement.querySelectorAll(`#${id}`)[0] ?? null : null,
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const prevDoc = g.document;
  const prevEl = g.HTMLElement;
  g.document = doc;
  g.HTMLElement = MiniElement;
  return {
    doc,
    restore() {
      g.document = prevDoc;
      g.HTMLElement = prevEl;
    },
  };
}
