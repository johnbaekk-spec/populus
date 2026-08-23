/* Review F5: a minimal DOM double so the CLIENT WIRING (initWatchlist,
   initFeed's load path) runs under node --test — removal of the wiring, not
   just of the pure helpers, must redden the suite. Deliberately tiny: enough
   surface for these islands, nothing more. */

export interface FakeElement {
  id: string;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  className: string;
  href: string;
  value: string;
  checked: boolean;
  dataset: Record<string, string | undefined>;
  attrs: Map<string, string>;
  children: FakeElement[];
  listeners: Map<string, ((ev: unknown) => void)[]>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: FakeElement): void;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  /** R5/R18: the feed island walks up to its enclosing <table> to find the
      sortable headers. The double has no ancestry, so this returns null and the
      island must degrade to "no header sorting" instead of throwing — which is
      exactly the resilience these wiring tests exist to prove. */
  closest(sel: string): FakeElement | null;
  classList: { toggle(name: string, on?: boolean): void; add(n: string): void; remove(n: string): void };
  scrollIntoView(): void;
  focus(): void;
  click(): void;
}

export function makeElement(id = ""): FakeElement {
  const el: FakeElement = {
    id,
    innerHTML: "",
    textContent: "",
    hidden: false,
    disabled: false,
    className: "",
    href: "",
    value: "",
    checked: false,
    dataset: {},
    attrs: new Map(),
    children: [],
    listeners: new Map(),
    addEventListener(type, fn) {
      const list = el.listeners.get(type) ?? [];
      list.push(fn);
      el.listeners.set(type, list);
    },
    setAttribute(name, value) {
      el.attrs.set(name, value);
      if (name === "hidden") el.hidden = true;
    },
    removeAttribute(name) {
      el.attrs.delete(name);
      if (name === "hidden") el.hidden = false;
    },
    getAttribute(name) {
      return el.attrs.get(name) ?? null;
    },
    appendChild(child) {
      el.children.push(child);
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    classList: { toggle() {}, add() {}, remove() {} },
    scrollIntoView() {},
    focus() {},
    click() {
      for (const fn of el.listeners.get("click") ?? []) fn({ target: el });
    },
  };
  return el;
}

export interface FakeDom {
  elements: Map<string, FakeElement>;
  document: {
    getElementById(id: string): FakeElement | null;
    querySelector(sel: string): FakeElement | null;
    querySelectorAll(sel: string): FakeElement[];
    addEventListener(type: string, fn: (ev: unknown) => void): void;
    createElement(tag: string): FakeElement;
  };
  storage: { map: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void };
  /** install globals; returns a restore function */
  install(fetchBody: unknown, opts?: { fetchOk?: boolean }): () => void;
  /** R17: how many times the page fetched anything. A second fetch owner for
      the congress dataset is invisible in review and expensive in the browser,
      so it is COUNTED rather than assumed absent. */
  fetchCalls: string[];
  flush(): Promise<void>;
}

export function makeDom(ids: string[]): FakeDom {
  const elements = new Map(ids.map((id) => [id, makeElement(id)]));
  const docListeners = new Map<string, ((ev: unknown) => void)[]>();
  const storageMap = new Map<string, string>();
  const fetchCalls: string[] = [];
  const dom: FakeDom = {
    elements,
    fetchCalls,
    document: {
      getElementById: (id) => elements.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        const list = docListeners.get(type) ?? [];
        list.push(fn);
        docListeners.set(type, list);
      },
      createElement: () => makeElement(),
    },
    storage: {
      map: storageMap,
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => void storageMap.set(k, v),
    },
    install(fetchBody, opts = {}) {
      const g = globalThis as Record<string, unknown>;
      const prior = { document: g.document, localStorage: g.localStorage, fetch: g.fetch, window: g.window };
      g.document = dom.document;
      g.localStorage = dom.storage;
      g.window = { requestIdleCallback: (fn: () => void) => fn() };
      g.fetch = (url?: unknown) => {
        fetchCalls.push(String(url ?? ""));
        return Promise.resolve({
          ok: opts.fetchOk ?? true,
          status: opts.fetchOk === false ? 500 : 200,
          json: () => Promise.resolve(fetchBody),
        });
      };
      return () => {
        g.document = prior.document;
        g.localStorage = prior.localStorage;
        g.fetch = prior.fetch;
        g.window = prior.window;
      };
    },
    async flush() {
      // settle the fetch → json → render microtask chain
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
  return dom;
}
