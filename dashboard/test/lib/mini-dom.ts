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
   of those on one compound, descendant combinators between compounds, and a
   comma-separated list of such selectors. */

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
  private listeners = new Map<string, ((ev?: unknown) => void)[]>();
  /** listeners added with `{ capture: true }` (or `true`): an event that does
      not bubble (`toggle`) still reaches them on its way down to its target */
  private captureListeners = new Map<string, ((ev?: unknown) => void)[]>();

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

  /** the parent element (null at the document's root element's parent) */
  get parentElement(): MiniElement | null {
    return this.parent;
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

  get classList(): { contains(name: string): boolean; toggle(name: string, force?: boolean): boolean } {
    const classes = new Set((this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
    return {
      contains: (n: string) => classes.has(n),
      /* signals-v3 M2: the signals island marks its "Show 10 more" button
         unavailable this way; it writes the class ATTRIBUTE, so the bytes a
         test reads are the bytes a browser would hold. */
      toggle: (n: string, force?: boolean) => {
        const on = force ?? !classes.has(n);
        if (on) classes.add(n);
        else classes.delete(n);
        this.setAttribute("class", [...classes].join(" "));
        return on;
      },
    };
  }

  /* ---------- tree ---------- */

  get previousElementSibling(): MiniElement | null {
    if (!this.parent) return null;
    const i = this.parent.children.indexOf(this);
    return i > 0 ? this.parent.children[i - 1]! : null;
  }

  /** Selector lists and descendant combinators are honoured (a delegated
      handler asks `closest("[data-period-chips] [data-period]")`). */
  closest(sel: string): MiniElement | null {
    let node: MiniElement | null = this;
    while (node) {
      if (matchesSelector(node, sel)) return node;
      node = node.parent;
    }
    return null;
  }

  querySelector(sel: string): MiniElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel: string): MiniElement[] {
    /* A selector LIST ("a, b") is the union of its selectors, in document
       order — the directory island binds its chips through one. */
    const list = sel.split(/,(?![^[]*\])/).map((s) => s.trim()).filter(Boolean);
    if (list.length > 1) {
      const hits = new Set(list.flatMap((one) => this.querySelectorAll(one)));
      return [...descendants(this)].filter((d) => hits.has(d));
    }
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

  /** Replaces this element in its parent with the parsed markup (the adds
      island swaps its note container this way). */
  set outerHTML(html: string) {
    const parent = this.parent;
    if (!parent) throw new Error("mini-dom: outerHTML set on a detached element");
    const holder = new MiniElement("template");
    parseInto(holder, html);
    const ni = parent.nodes.indexOf(this);
    parent.nodes.splice(ni, 1, ...holder.nodes);
    for (const n of holder.nodes) if (typeof n !== "string") n.parent = parent;
    parent.children = parent.nodes.filter((n): n is MiniElement => typeof n !== "string");
    this.parent = null;
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

  addEventListener(type: string, fn: (ev?: any) => void, opts?: boolean | { capture?: boolean }): void {
    const capture = opts === true || (typeof opts === "object" && opts?.capture === true);
    const map = capture ? this.captureListeners : this.listeners;
    const list = map.get(type) ?? [];
    list.push(fn);
    map.set(type, list);
  }
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn();
  }
  /** A click that BUBBLES from this element through its ancestors, each
      listener receiving `{ type, target }` — what a DELEGATED handler needs
      (`ev.target.closest(...)` on a root that is re-rendered under it).
      `click()` stays the non-bubbling form the older tests are written to. */
  bubbleClick(): void {
    const ev = { type: "click", target: this };
    for (let n: MiniElement | null = this; n; n = n.parent) for (const fn of [...(n.listeners.get("click") ?? [])]) fn(ev);
  }
  /** Call every `type` listener with `ev`, non-bubbling like `click()` — the
      event a listener reads (a keydown's `key`, a click's `preventDefault`).
      signals-v3 M3: the ticker tab binder is driven this way. */
  dispatch(type: string, ev: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }
  /** Focus is not modelled; an island that moves focus after a repaint must not throw. */
  focus(): void {}
  /** How many listeners of `type` are attached. A binder that re-attaches on
      every re-render can look correct to a click test (an odd number of
      toggles nets one), so "attached exactly once" is asserted by count. */
  listenerCount(type: string): number {
    return (this.listeners.get(type)?.length ?? 0) + (this.captureListeners.get(type)?.length ?? 0);
  }

  /** A reader's click on this `<summary>`, as a browser runs it: the click
      bubbles (`bubbleClick`), then its default action toggles the parent
      `<details>` (`toggleDetails`), which fires `toggle` — so an island that
      listens for the opening is exercised through the event, never by a test
      calling the island's handler itself (codex M2 round 2, F3). */
  activate(): void {
    this.bubbleClick();
    if (this.tagName === "summary" && this.parent?.tagName === "details") toggleDetails(this.parent);
  }

  /** internal: deliver `ev` to this element's listeners of `type` — the
      capture-phase ones only (`capture`), or every one (at the target) */
  deliver(type: string, ev: unknown, phase: "capture" | "target"): void {
    for (const fn of [...(this.captureListeners.get(type) ?? [])]) fn(ev);
    if (phase === "target") for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  /** Move existing elements to the end of this one, in order — a browser's
      `ParentNode.append` of nodes already in the tree (signals-v4 M3: the
      Overlap tab re-orders its rows this way when the variant changes). */
  append(...els: MiniElement[]): void {
    for (const n of els) {
      if (n.parent) {
        n.parent.children = n.parent.children.filter((c) => c !== n);
        n.parent.nodes = n.parent.nodes.filter((c) => c !== n);
      }
      this.appendNode(n);
    }
  }

  /** `Element.insertAdjacentHTML`, the one position the held-rows binder uses
      (launch M4a, rule 8): "beforeend" parses the markup and appends it after
      the element's last child. Any other position throws — a double that
      guessed would start lying. */
  insertAdjacentHTML(position: string, html: string): void {
    if (position !== "beforeend") throw new Error(`mini-dom: insertAdjacentHTML("${position}") is not modelled`);
    const holder = new MiniElement("template");
    parseInto(holder, html);
    for (const n of holder.nodes) this.appendNode(n);
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

/** A `<details>` opened or closed the way a browser does it on a summary
    click: the `open` attribute flips; opening one of a `name` group closes
    the group's other open member (the exclusive accordion); each change fires
    a NON-bubbling `toggle` ({ type, target, oldState, newState }) — capture
    listeners on the ancestors, top down, then the target's own. */
export function toggleDetails(details: MiniElement): void {
  const opening = !details.hasAttribute("open");
  const changes: [MiniElement, boolean][] = [];
  const group = details.getAttribute("name");
  if (opening && group) {
    let root: MiniElement = details;
    while (root.parent) root = root.parent;
    for (const other of root.querySelectorAll(`details[name="${group}"]`)) if (other !== details && other.hasAttribute("open")) changes.push([other, false]);
  }
  changes.push([details, opening]);
  /* the attributes change first; the `toggle` events are queued and run
     after, in order — so a listener reads the group's final state */
  for (const [d, open] of changes) {
    if (open) d.setAttribute("open", "");
    else d.removeAttribute("open");
  }
  for (const [d, open] of changes) {
    const ev = { type: "toggle", target: d, oldState: open ? "closed" : "open", newState: open ? "open" : "closed" };
    const path: MiniElement[] = [];
    for (let n = d.parent; n; n = n.parent) path.unshift(n);
    for (const n of path) n.deliver("toggle", ev, "capture");
    d.deliver("toggle", ev, "target");
  }
}

function* descendants(root: MiniElement): Generator<MiniElement> {
  for (const c of root.children) {
    yield c;
    yield* descendants(c);
  }
}

/** A selector list of descendant-combinator selectors, matched against `el`
    itself: the last compound on `el`, each earlier one on some ancestor, in order. */
function matchesSelector(el: MiniElement, sel: string): boolean {
  return sel.split(/,(?![^[]*\])/).map((x) => x.trim()).filter(Boolean).some((one) => {
    const compounds = one.split(/\s+(?![^[]*\])/);
    if (!matchesCompound(el, compounds[compounds.length - 1]!)) return false;
    let node = el.parent;
    for (let i = compounds.length - 2; i >= 0; i--) {
      while (node && !matchesCompound(node, compounds[i]!)) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  });
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
  /** Document-level events, synchronous and non-bubbling — enough for the
      `populus:rerender` contract, where islands listen on `document` and
      every client re-render dispatches there. */
  addEventListener(type: string, fn: (ev: Event) => void): void;
  dispatchEvent(ev: Event): boolean;
}

/** Parse a document fragment and install it as `globalThis.document`.

    `globalThis.HTMLElement` is set to `MiniElement` so an `instanceof
    HTMLElement` guard in production code narrows correctly here instead of
    throwing `HTMLElement is not defined`. Returns a restore function. */
export function installDom(html: string): { doc: MiniDocument; restore(): void } {
  const documentElement = new MiniElement("body");
  documentElement.innerHTML = html;
  const docListeners = new Map<string, ((ev: Event) => void)[]>();
  const doc: MiniDocument = {
    documentElement,
    getElementById: (id) =>
      id ? documentElement.querySelectorAll(`#${id}`)[0] ?? null : null,
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    addEventListener(type, fn) {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
    dispatchEvent(ev) {
      for (const fn of [...(docListeners.get(ev.type) ?? [])]) fn(ev);
      return true;
    },
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
