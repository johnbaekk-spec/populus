/* launch M1b (LD5, T1.5): a small cascade resolver for the static phone tests.

   A test that reads ONE rule proves nothing about what applies: the fold's
   `.table-scroll { overflow-x: visible }` is worthless if a more specific rule
   elsewhere puts `auto` back. So these tests ask what WINS for a described
   element at a given viewport — every rule of the whole-tree stylesheet whose
   media query holds and whose selector matches the element's chain, sorted by
   specificity, then source order — the property the browser computes.

   The selector subset: type, universal, class, id and attribute selectors;
   :is() / :where() / :not() (with their specificity rules); descendant and
   child combinators. A state pseudo-class (:hover, :focus-within, …) does not
   hold on an element at rest; a rule for a pseudo-element is not a rule for the
   element. Structural pseudo-classes (:first-child, :last-child, …) and sibling
   combinators are taken to HOLD, which errs toward reporting a rule as
   applying (a test can only get stricter). Media features: width ranges are
   evaluated; `print` never holds; a feature the resolver does not model holds,
   for the same reason. */

export interface El {
  tag: string;
  id?: string;
  classes?: readonly string[];
  attrs?: Readonly<Record<string, string>>;
}

export interface Viewport {
  width: number;
  /** does `(any-pointer: coarse)` hold (default: width ≤ 720) */
  coarse?: boolean;
}

interface Rule {
  selectors: string;
  decls: string;
  media: string[];
  order: number;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every style rule in source order, with the media conditions around it. */
export function parseRules(css: string): Rule[] {
  const text = stripComments(css);
  const out: Rule[] = [];
  let order = 0;
  const walk = (src: string, media: string[]): void => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) return;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < src.length && depth > 0; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, [...media, head.slice(6).trim()]);
      else if (head.startsWith("@")) {
        /* @font-face, @keyframes, @supports …: not element rules here */
      } else if (head) out.push({ selectors: head, decls: body, media, order: order++ });
      i = j;
    }
  };
  walk(text, []);
  return out;
}

/** Does a media query list hold at this viewport? */
export function mediaHolds(condition: string, vp: Viewport): boolean {
  const coarse = vp.coarse ?? vp.width <= 720;
  return condition.split(",").some((arm) => {
    const a = arm.trim().toLowerCase();
    if (/\bprint\b/.test(a) && !/\bnot\s+print\b/.test(a)) return false;
    for (const m of a.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+)\)/g)) {
      const feat = m[1]!;
      const val = m[2]!.trim();
      if (feat === "max-width" && !(vp.width <= parseFloat(val))) return false;
      if (feat === "min-width" && !(vp.width >= parseFloat(val))) return false;
      if ((feat === "any-pointer" || feat === "pointer") && val === "coarse" && !coarse) return false;
      if ((feat === "any-pointer" || feat === "pointer") && val === "fine" && coarse) return false;
    }
    return true;
  });
}

/* ---------------------------------------------------------- selectors */

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

type Spec = [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp = (a: Spec, b: Spec): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const STATE = /^(hover|focus|focus-within|focus-visible|active|visited|target|checked|open|popover-open|disabled|placeholder-shown|empty|has)$/;

interface Compound {
  text: string;
  combinator: " " | ">" | "+" | "~" | null; // the combinator to its LEFT
}

/** Split a complex selector into compounds with their left combinators. */
function compounds(sel: string): Compound[] | null {
  const out: Compound[] = [];
  let cur = "";
  let depth = 0;
  let pending: Compound["combinator"] = null;
  const flush = (): void => {
    if (cur.trim()) out.push({ text: cur.trim(), combinator: out.length === 0 ? null : (pending ?? " ") });
    cur = "";
    pending = null;
  };
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i]!;
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      flush();
      pending = ch as ">" | "+" | "~";
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (cur.trim()) {
        flush();
        pending = pending ?? " ";
      }
      continue;
    }
    cur += ch;
  }
  flush();
  return out.length ? out : null;
}

interface Simple {
  kind: "type" | "universal" | "class" | "id" | "attr" | "pseudo" | "pseudo-element";
  name: string;
  arg?: string;
  op?: string;
  value?: string;
}

function simples(compound: string): Simple[] {
  const out: Simple[] = [];
  let i = 0;
  const ident = (): string => {
    const m = /^-?[A-Za-z_ -￿][\w\- -￿]*/.exec(compound.slice(i));
    if (!m) return "";
    i += m[0].length;
    return m[0];
  };
  while (i < compound.length) {
    const ch = compound[i]!;
    if (ch === "*") {
      out.push({ kind: "universal", name: "*" });
      i++;
    } else if (ch === ".") {
      i++;
      out.push({ kind: "class", name: ident() });
    } else if (ch === "#") {
      i++;
      out.push({ kind: "id", name: ident() });
    } else if (ch === "[") {
      const end = compound.indexOf("]", i);
      const body = compound.slice(i + 1, end);
      i = end + 1;
      const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*$/.exec(body);
      if (m) out.push({ kind: "attr", name: m[1]!, op: m[2], value: m[3] ?? m[4] ?? m[5] });
    } else if (ch === ":") {
      const isEl = compound[i + 1] === ":";
      i += isEl ? 2 : 1;
      const name = ident().toLowerCase();
      let arg: string | undefined;
      if (compound[i] === "(") {
        let depth = 1;
        let j = i + 1;
        for (; j < compound.length && depth > 0; j++) {
          if (compound[j] === "(") depth++;
          else if (compound[j] === ")") depth--;
        }
        arg = compound.slice(i + 1, j - 1);
        i = j;
      }
      const legacyEl = /^(before|after|first-line|first-letter)$/.test(name);
      out.push({ kind: isEl || legacyEl ? "pseudo-element" : "pseudo", name, arg });
    } else {
      const name = ident();
      if (!name) {
        i++;
        continue;
      }
      out.push({ kind: "type", name: name.toLowerCase() });
    }
  }
  return out;
}

function listSpec(arg: string): Spec {
  let best: Spec = [0, 0, 0];
  for (const s of splitTop(arg, ",")) {
    const sp = selectorSpec(s);
    if (cmp(sp, best) > 0) best = sp;
  }
  return best;
}

/** Specificity of one complex selector. */
export function selectorSpec(sel: string): Spec {
  let spec: Spec = [0, 0, 0];
  for (const c of compounds(sel) ?? []) {
    for (const s of simples(c.text)) {
      if (s.kind === "id") spec = add(spec, [1, 0, 0]);
      else if (s.kind === "class" || s.kind === "attr") spec = add(spec, [0, 1, 0]);
      else if (s.kind === "type" || s.kind === "pseudo-element") spec = add(spec, [0, 0, 1]);
      else if (s.kind === "pseudo") {
        if (s.name === "where") continue;
        if ((s.name === "is" || s.name === "not" || s.name === "has" || s.name === "matches") && s.arg !== undefined) spec = add(spec, listSpec(s.arg));
        else spec = add(spec, [0, 1, 0]);
      }
    }
  }
  return spec;
}

function matchSimple(s: Simple, el: El): boolean {
  switch (s.kind) {
    case "universal":
      return true;
    case "type":
      return el.tag.toLowerCase() === s.name;
    case "class":
      return (el.classes ?? []).includes(s.name);
    case "id":
      return el.id === s.name;
    case "attr": {
      const v = el.attrs?.[s.name] ?? (s.name === "class" ? (el.classes ?? []).join(" ") : s.name === "id" ? el.id : undefined);
      if (v === undefined) return false;
      if (!s.op) return true;
      const want = s.value ?? "";
      if (s.op === "=") return v === want;
      if (s.op === "~=") return v.split(/\s+/).includes(want);
      if (s.op === "^=") return v.startsWith(want);
      if (s.op === "$=") return v.endsWith(want);
      if (s.op === "*=") return v.includes(want);
      if (s.op === "|=") return v === want || v.startsWith(want + "-");
      return false;
    }
    case "pseudo": {
      if (s.name === "is" || s.name === "where" || s.name === "matches") return splitTop(s.arg ?? "", ",").some((x) => matchComplex(x, [el]));
      if (s.name === "not") return !splitTop(s.arg ?? "", ",").some((x) => matchComplex(x, [el]));
      if (s.name === "root") return el.tag === "html";
      if (STATE.test(s.name)) return false;
      return true; // structural: assumed to hold
    }
    case "pseudo-element":
      return false; // a rule for the pseudo-element, not for the element
  }
}

function matchCompound(text: string, el: El): boolean {
  return simples(text).every((s) => matchSimple(s, el));
}

/** Does a complex selector match the LAST element of `chain` (root first)? */
export function matchComplex(sel: string, chain: readonly El[]): boolean {
  const cs = compounds(sel);
  if (!cs || chain.length === 0) return false;
  const go = (ci: number, ei: number): boolean => {
    if (!matchCompound(cs[ci]!.text, chain[ei]!)) return false;
    if (ci === 0) return true;
    const comb = cs[ci]!.combinator;
    if (comb === ">") return ei > 0 && go(ci - 1, ei - 1);
    if (comb === "+" || comb === "~") return go(ci - 1, ei); // a sibling: assumed present (errs toward applying)
    for (let k = ei - 1; k >= 0; k--) if (go(ci - 1, k)) return true;
    return false;
  };
  return go(cs.length - 1, chain.length - 1);
}

export interface Winner {
  value: string;
  selector: string;
  media: string[];
  order: number;
}

/** The declared value of `prop` that WINS on the last element of `chain` at
    `vp`, or null. `prop` may be read from a shorthand through `fromShorthand`
    (e.g. overflow-x from `overflow`, font-size from `font`). */
export function winning(
  css: string | readonly Rule[],
  chain: readonly El[],
  prop: string,
  vp: Viewport,
  fromShorthand: Readonly<Record<string, (v: string) => string | null>> = {},
): Winner | null {
  const rules = typeof css === "string" ? parseRules(css) : css;
  let best: { spec: Spec; order: number; important: boolean; w: Winner } | null = null;
  for (const r of rules) {
    if (!r.media.every((m) => mediaHolds(m, vp))) continue;
    let spec: Spec | null = null;
    for (const sel of splitTop(r.selectors, ",")) {
      if (!matchComplex(sel, chain)) continue;
      const sp = selectorSpec(sel);
      if (!spec || cmp(sp, spec) > 0) spec = sp;
    }
    if (!spec) continue;
    for (const d of r.decls.split(";")) {
      const k = d.indexOf(":");
      if (k < 0) continue;
      const name = d.slice(0, k).trim().toLowerCase();
      let value = d.slice(k + 1).trim();
      const important = /!important\s*$/.test(value);
      value = value.replace(/\s*!important\s*$/, "");
      let v: string | null = null;
      if (name === prop) v = value;
      else if (fromShorthand[name]) v = fromShorthand[name]!(value);
      if (v === null) continue;
      const cand = { spec, order: r.order, important, w: { value: v, selector: r.selectors, media: r.media, order: r.order } };
      if (
        !best ||
        (cand.important && !best.important) ||
        (cand.important === best.important && (cmp(cand.spec, best.spec) > 0 || (cmp(cand.spec, best.spec) === 0 && cand.order >= best.order)))
      ) {
        best = cand;
      }
    }
  }
  return best ? best.w : null;
}

/** overflow-x from the `overflow` shorthand (`overflow: a b` → a). */
export const OVERFLOW_X = { overflow: (v: string): string => v.split(/\s+/)[0]! };
/** font-size from the `font` shorthand (the token before the optional /line-height and family). */
export const FONT_SIZE = {
  font: (v: string): string | null => {
    const m = /(var\(--fs-[\w-]+\)|[\d.]+(?:px|rem|em|%))(?:\s*\/\s*[^\s]+)?\s+[^\s]/.exec(v);
    return m ? m[1]! : null;
  },
};

/** The value of a custom property on :root at `vp` (the last applicable
    declaration in `:root`-matching rules). */
export function rootToken(css: string | readonly Rule[], name: string, vp: Viewport): string | null {
  const w = winning(css, [{ tag: "html", attrs: { "data-theme": "dark" } }], name, vp);
  return w ? w.value : null;
}
