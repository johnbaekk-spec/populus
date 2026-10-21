/* launch M1a (R40, LD37): the test half of the explicit table semantics.

   `tableRoleViolations` is the checker launch-semantics.test.ts (and the
   post-build launch-dist test) runs over markup: every table that selects a
   card layout (`table[data-card]`) must carry role="table", and every head,
   body and foot its rowgroup role, every row its row role, every th a
   columnheader/rowheader role and every td its cell role. It parses with the
   repository's mini DOM, so it reads the element tree, not a regex over text.

   `stripTableRoles` removes exactly the attributes `withTableRoles` adds, for
   the comparisons that pin client output against a server renderer's raw
   (pre-layout) output: the property those tests check — the client repaints
   what the server rendered — is unchanged; the roles themselves are pinned
   here and in launch-semantics.test.ts. */

import { MiniElement } from "./mini-dom.ts";

const ROLE_OF: Readonly<Record<string, readonly string[]>> = {
  table: ["table"],
  thead: ["rowgroup"],
  tbody: ["rowgroup"],
  tfoot: ["rowgroup"],
  tr: ["row"],
  th: ["columnheader", "rowheader"],
  td: ["cell"],
};

function* walk(el: MiniElement): Generator<MiniElement> {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}

/** Every role violation inside a `table[data-card]` of `html`, as readable
    strings (empty = every card table carries its roles). */
export function tableRoleViolations(html: string): string[] {
  const root = new MiniElement("body");
  root.innerHTML = html;
  const out: string[] = [];
  const check = (el: MiniElement, where: string): void => {
    const want = ROLE_OF[el.tagName];
    if (!want) return;
    const role = el.getAttribute("role");
    if (role == null || !want.includes(role)) {
      const cls = el.getAttribute("class");
      out.push(`${where}: <${el.tagName}${cls ? ` class="${cls}"` : ""}> role=${role ?? "(none)"}, want ${want.join("|")}`);
    }
  };
  let n = 0;
  for (const table of walk(root)) {
    if (table.tagName !== "table" || !table.hasAttribute("data-card")) continue;
    n += 1;
    const where = `table #${n} [data-card=${table.getAttribute("data-card")}]`;
    check(table, where);
    /* Only this table's own sections and rows: a nested table is checked on
       its own when the walk reaches it. */
    const own = (el: MiniElement): void => {
      for (const c of el.children) {
        if (c.tagName === "table") continue;
        check(c, where);
        own(c);
      }
    };
    own(table);
  }
  return out;
}

/** Count of `table` elements in `html`, and of those with `data-card`. */
export function cardTableCounts(html: string): { tables: number; cards: number } {
  const root = new MiniElement("body");
  root.innerHTML = html;
  let tables = 0;
  let cards = 0;
  for (const el of walk(root)) {
    if (el.tagName !== "table") continue;
    tables += 1;
    if (el.hasAttribute("data-card")) cards += 1;
  }
  return { tables, cards };
}

const ROLE_VALUES = "table|rowgroup|row|columnheader|rowheader|cell";

/** `html` without the attributes `withTableRoles` adds (the table roles,
    `data-card`, and the cells' and heads' `data-label`). */
export function stripTableRoles(html: string): string {
  return html.replace(/<(table|thead|tbody|tfoot|tr|th|td)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (_whole, tag: string, attrs: string) => {
    const kept = attrs
      .replace(new RegExp(`\\s+role="(?:${ROLE_VALUES})"`, "g"), "")
      .replace(/\s+data-card="[^"]*"/g, "")
      .replace(/\s+data-label="[^"]*"/g, "");
    return `<${tag}${kept}>`;
  });
}
