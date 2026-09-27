/* DESIGN-POLISH M2 (T2.11, R36): the DOM-backed disclosure binder restates the
   count the table has NOW.

   `initDomDisclosures` is the one binder for `.compact-disclosure[data-compact-dom]`.
   It used to read `data-compact-total` / `data-compact-shown` ONCE, at bind
   time, and to skip every wrapper it had already bound — so a table that a
   client re-render grew from 25 rows to 40 kept stating "of 25" and kept a
   button labelled for 25. These tests RUN the binder over the server's own
   markup (parsed by `mini-dom`, which can only find what the bytes hold),
   re-render the way the islands do, announce it with `populus:rerender`, and
   read what the reader would see.

   Each behavioural claim carries a control that proves the assertion can fail:
   (a) runs a deliberately bind-once copy of the old binder through the SAME
   scenario and the SAME named predicate, which must reject it; (b) drops
   `data-compact-definite` and asserts the words change; (c) counts listeners
   instead of inferring them from a click, because an odd number of stacked
   toggles nets one and would pass a click-only test. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, type MiniDocument, type MiniElement } from "./lib/mini-dom.ts";
import { compactDisclosure, syncCompactDisclosure, type CompactDisclosureNode } from "../src/lib/format.ts";
import { initDomDisclosures } from "../src/scripts/inst-index-client.ts";

const ROOT = "t-tbody";

/** Rows as a DOM-backed table ships them: every row present, the ones beyond
    the compact slice marked so the collapsed tbody hides them. */
function rowsHtml(total: number, shown: number): string {
  return Array.from(
    { length: total },
    (_, i) => `<tr${i >= shown ? " data-compact-extra" : ""}><td>R${i + 1}</td></tr>`,
  ).join("");
}

/** The server's page: the tbody (collapsed when rows are held back) and the
    disclosure the SAME `compactDisclosure` renders on the real surfaces. */
function pageHtml(
  total: number,
  shown: number,
  noun: string,
  extra: { boundNoun?: string; definite?: boolean } = {},
): string {
  return (
    `<table><tbody id="${ROOT}"${total > shown ? ' data-collapsed="true"' : ""}>${rowsHtml(total, shown)}</tbody></table>` +
    compactDisclosure({ rootId: ROOT, total, shown, noun, domBacked: true, ...extra })
  );
}

function rerender(doc: MiniDocument): void {
  doc.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "test" } }));
}

const wrapOf = (doc: MiniDocument): MiniElement => doc.querySelector(".compact-disclosure[data-compact-dom]")!;
const buttonOf = (doc: MiniDocument): MiniElement => wrapOf(doc).querySelector("button")!;

interface Seen {
  count: string;
  countHidden: boolean;
  label: string;
  buttonHidden: boolean;
  wrapHidden: boolean;
  collapsed: string | null;
}

/** What a reader sees: the count clause, the control, and the rows' state. */
function seen(doc: MiniDocument): Seen {
  const wrap = wrapOf(doc);
  const count = wrap.querySelector(".compact-bound-count")!;
  const btn = wrap.querySelector("button")!;
  return {
    count: count.textContent,
    countHidden: count.hidden,
    label: btn.textContent,
    buttonHidden: btn.hidden,
    wrapHidden: wrap.hidden,
    collapsed: doc.getElementById(ROOT)!.getAttribute("data-collapsed"),
  };
}

/* ------------------------------------------ (a) a re-render restates the count */

/** The re-render in (a): the wrapper STAYS IN PLACE and the renderer that owns
    it restates its attributes and rows — 25 rows become 40. */
function growTo40(doc: MiniDocument): void {
  wrapOf(doc).setAttribute("data-compact-total", "40");
  doc.getElementById(ROOT)!.innerHTML = rowsHtml(40, 20);
  rerender(doc);
}

/** The named predicate the real assertion AND the control both use: the
    re-rendered table states its own count and labels its control for it. */
function restatesItsCount(s: Seen): boolean {
  return (
    s.count === "1–20 of 40 tickers" &&
    !s.countHidden &&
    s.label === "Show all 40 tickers" &&
    !s.buttonHidden &&
    s.collapsed === "true"
  );
}

function runGrowth(bind: () => void): { before: Seen; after: Seen; clicked: Seen } {
  const { doc, restore } = installDom(pageHtml(25, 20, "tickers"));
  try {
    bind();
    const before = seen(doc);
    growTo40(doc);
    const after = seen(doc);
    buttonOf(doc).click();
    return { before, after, clicked: seen(doc) };
  } finally {
    restore();
  }
}

/** The CONTROL: a faithful copy of the pre-R36 binder — totals read ONCE at
    bind time, already-bound wrappers skipped on `populus:rerender`, the
    server's count wording never restated. */
function bindOnceCopy(): void {
  const bind = (): void => {
    document.querySelectorAll<HTMLElement>(".compact-disclosure[data-compact-dom]").forEach((wrap) => {
      if (wrap.getAttribute("data-compact-bound") === "1") return;
      wrap.setAttribute("data-compact-bound", "1");
      const root = document.getElementById(wrap.dataset.compactFor ?? "");
      const btn = wrap.querySelector("button");
      if (!root || !btn) return;
      const total = Number(wrap.dataset.compactTotal ?? 0);
      const shown = Number(wrap.dataset.compactShown ?? 0);
      const noun = wrap.dataset.compactNoun ?? "rows";
      const hidden = total - shown;
      if (hidden <= 0) return;
      root.setAttribute("data-collapsed", "true");
      let expanded = false;
      const sync = (): void =>
        syncCompactDisclosure(wrap as unknown as CompactDisclosureNode, { total, hidden, expanded, noun });
      sync();
      btn.addEventListener("click", () => {
        expanded = !expanded;
        root.setAttribute("data-collapsed", String(!expanded));
        sync();
      });
    });
  };
  bind();
  document.addEventListener("populus:rerender", () => bind());
}

test("R36 (a): a table re-rendered from 25 rows to 40 restates 1–20 of 40, and its toggle reveals the rows", () => {
  const real = runGrowth(initDomDisclosures);
  assert.equal(real.before.count, "1–20 of 25 tickers", "the load-time sync states the server's count");
  assert.equal(real.before.label, "Show all 25 tickers");
  assert.equal(real.after.count, "1–20 of 40 tickers", "the NEXT sync reads the re-rendered total");
  assert.equal(real.after.label, "Show all 40 tickers");
  assert.ok(restatesItsCount(real.after), `the re-rendered table states its own count: ${JSON.stringify(real.after)}`);
  // the toggle reveals the held rows and retracts the held-back claim
  assert.equal(real.clicked.collapsed, "false", "one click expands the re-rendered table");
  assert.equal(real.clicked.countHidden, true, "expanded, the rows are on screen, so the count clause goes");
  assert.equal(real.clicked.buttonHidden, false);

  // CONTROL: the bind-once binder fails the SAME predicate on the SAME scenario.
  const once = runGrowth(bindOnceCopy);
  assert.equal(once.before.count, "1–20 of 25 tickers", "the control agrees at load — the scenario is the same");
  assert.equal(
    restatesItsCount(once.after),
    false,
    "a binder that reads totals once must fail this assertion, or the assertion proves nothing",
  );
  assert.equal(once.after.count, "1–20 of 25 tickers", "…because it keeps the count it read at bind time");
  assert.equal(once.after.label, "Show all 25 tickers", "…and the label it computed then");
});

test("R36 (a'): a re-render that REPLACES the wrapper and tbody gets the new ones bound", () => {
  const { doc, restore } = installDom(`<section id="s">${pageHtml(25, 20, "tickers")}</section>`);
  try {
    initDomDisclosures();
    buttonOf(doc).click(); // the old wrapper is expanded when the section is replaced
    doc.getElementById("s")!.innerHTML = pageHtml(40, 20, "tickers");
    rerender(doc);
    const s = seen(doc);
    assert.ok(restatesItsCount(s), `a brand-new tbody the server rendered collapsed starts collapsed: ${JSON.stringify(s)}`);
    assert.equal(buttonOf(doc).listenerCount("click"), 1, "the new wrapper is bound");
    buttonOf(doc).click();
    assert.equal(seen(doc).collapsed, "false", "and its toggle works");
  } finally {
    restore();
  }
});

/* ------------------------------------------- (b) a definite count stays definite */

const DEFINITE = "1–10 of the 50 newest changes by notable managers shown here";

test("R36 (b): a definite wrapper keeps its 'the' after load and after a re-render", () => {
  const { doc, restore } = installDom(
    pageHtml(50, 10, "changes", { boundNoun: "newest changes by notable managers shown here", definite: true }),
  );
  try {
    assert.equal(seen(doc).count, DEFINITE, "the server's words");
    // Overwrite the count so equality below proves the BINDER wrote it.
    wrapOf(doc).querySelector(".compact-bound-count")!.textContent = "SENTINEL";
    initDomDisclosures();
    assert.equal(seen(doc).count, DEFINITE, "after load the client prints exactly the server's text");
    rerender(doc);
    assert.equal(seen(doc).count, DEFINITE, "and after a re-render");

    // CONTROL: the words come from the element, on every sync — drop the
    // definite marker and the restated count changes.
    wrapOf(doc).removeAttribute("data-compact-definite");
    rerender(doc);
    const indefinite = seen(doc).count;
    assert.notEqual(indefinite, DEFINITE, "without data-compact-definite the text differs");
    assert.equal(indefinite, "1–10 of 50 newest changes by notable managers shown here");
  } finally {
    restore();
  }
});

/* ---------------------------------------- (c) one listener, however many syncs */

test("R36 (c): the click listener is attached once — two re-renders, one click, expanded", () => {
  const { doc, restore } = installDom(pageHtml(25, 20, "tickers"));
  try {
    initDomDisclosures();
    rerender(doc);
    rerender(doc);
    assert.equal(buttonOf(doc).listenerCount("click"), 1, "exactly one listener after three syncs");
    buttonOf(doc).click();
    const s = seen(doc);
    assert.equal(s.collapsed, "false", "one click expands (not toggled twice back to collapsed)");
    assert.equal(s.countHidden, true);
    assert.equal(buttonOf(doc).getAttribute("aria-expanded"), "true");
    // An expanded wrapper that is merely re-synced stays expanded, rows and
    // control agreeing.
    rerender(doc);
    assert.equal(seen(doc).collapsed, "false", "a re-sync keeps the expanded state it reads off the element");
    assert.equal(buttonOf(doc).getAttribute("aria-expanded"), "true");
    buttonOf(doc).click();
    assert.equal(seen(doc).collapsed, "true", "and the next click collapses");
    assert.equal(seen(doc).count, "1–20 of 25 tickers");

    // Expanded again, then the TBODY alone is replaced by a fresh one the
    // server rendered collapsed: it starts collapsed, and the control follows
    // the rows rather than the wrapper's stale state.
    buttonOf(doc).click();
    assert.equal(seen(doc).collapsed, "false");
    doc.getElementById(ROOT)!.outerHTML = `<tbody id="${ROOT}" data-collapsed="true">${rowsHtml(25, 20)}</tbody>`;
    rerender(doc);
    const fresh = seen(doc);
    assert.equal(fresh.collapsed, "true", "a brand-new collapsed tbody starts collapsed");
    assert.equal(fresh.countHidden, false, "so the held-back count is stated again");
    assert.equal(buttonOf(doc).getAttribute("aria-expanded"), "false", "and the control agrees with the rows");
    assert.equal(buttonOf(doc).listenerCount("click"), 1);
  } finally {
    restore();
  }
});

/* ------------------------------------------ (d) the omission rule both ways */

test("R36 (d): a wrapper that gains held-back rows gains a working toggle; one that loses them hides it", () => {
  const { doc, restore } = installDom(pageHtml(15, 20, "tickers"));
  try {
    initDomDisclosures();
    let s = seen(doc);
    assert.equal(s.buttonHidden, true, "nothing held back: no control");
    assert.equal(s.wrapHidden, true, "and no statement");

    wrapOf(doc).setAttribute("data-compact-total", "30");
    doc.getElementById(ROOT)!.innerHTML = rowsHtml(30, 20);
    rerender(doc);
    s = seen(doc);
    assert.equal(s.buttonHidden, false, "the grown table gains a control");
    assert.equal(s.label, "Show all 30 tickers");
    assert.equal(s.count, "1–20 of 30 tickers");
    assert.equal(s.collapsed, "true");
    buttonOf(doc).click();
    assert.equal(seen(doc).collapsed, "false", "…and it works");

    wrapOf(doc).setAttribute("data-compact-total", "12");
    doc.getElementById(ROOT)!.innerHTML = rowsHtml(12, 20);
    rerender(doc);
    s = seen(doc);
    assert.equal(s.buttonHidden, true, "the shrunk table loses it");
    assert.equal(s.label, "", "emptied, so a stale label cannot survive into a later reveal");
    assert.equal(s.countHidden, true);
    assert.equal(wrapOf(doc).hasAttribute("data-compact-expanded"), false, "nothing held back, nothing expanded");
    buttonOf(doc).click();
    assert.equal(seen(doc).buttonHidden, true, "an inert control does nothing");

    wrapOf(doc).setAttribute("data-compact-total", "30");
    doc.getElementById(ROOT)!.setAttribute("data-collapsed", "true");
    doc.getElementById(ROOT)!.innerHTML = rowsHtml(30, 20);
    rerender(doc);
    s = seen(doc);
    assert.equal(s.collapsed, "true", "grown again, it starts collapsed");
    assert.equal(s.count, "1–20 of 30 tickers");
    assert.equal(buttonOf(doc).listenerCount("click"), 1, "still one listener through every transition");
  } finally {
    restore();
  }
});

/* ------------------------------ (DESIGN-POLISH M2 review R2-2) held rows close */

/* The property: collapsing a DOM-backed table closes every disclosure opened
   inside a row it now holds back — a held signal hit's evidence must never
   stay open under the visible hits. A disclosure in a row that stays visible
   is left alone. (The stylesheet hides a held hit's evidence row as well; the
   geometry gate measures that in the browser.) */
test("R2-2: collapsing closes a <details> opened in a held row, and only there", () => {
  const html =
    `<table><tbody id="${ROOT}" data-collapsed="true">` +
    `<tr><td><details class="si-expand" open><summary>kept</summary></details></td></tr>` +
    `<tr data-compact-extra><td><details class="si-expand"><summary>held</summary></details></td></tr>` +
    `</tbody></table>` +
    compactDisclosure({ rootId: ROOT, total: 2, shown: 1, noun: "hits", domBacked: true });
  const { doc, restore } = installDom(html);
  try {
    initDomDisclosures();
    const [kept, held] = doc.getElementById(ROOT)!.querySelectorAll("details");
    buttonOf(doc).click(); // expand
    held!.setAttribute("open", ""); // the reader opens the held hit's evidence
    buttonOf(doc).click(); // collapse
    assert.equal(doc.getElementById(ROOT)!.getAttribute("data-collapsed"), "true");
    assert.equal(held!.hasAttribute("open"), false, "the held row's disclosure closes with it");
    assert.equal(kept!.hasAttribute("open"), true, "control: a visible row's disclosure stays as the reader left it");
  } finally {
    restore();
  }
});

/* ------------------------------ (DESIGN-POLISH M2 review R2-7) labels are text */

/* The property: a control label is PLAIN TEXT everywhere a client writes it
   (`textContent`), and escaped exactly once where the server splices it into
   markup. The pre-fix labels escaped their noun themselves, so a client
   restating "Show all 3 R&D filers" printed "R&amp;D". */
test("R2-7: a noun with markup characters reads the same from the server and after a client sync", () => {
  const { doc, restore } = installDom(pageHtml(3, 1, "R&D <filers>"));
  try {
    const serverBtn = buttonOf(doc).innerHTML;
    assert.equal(serverBtn, "Show all 3 R&amp;D &lt;filers&gt;", "the server escapes the label once, in markup");
    initDomDisclosures(); // the client restates the label through textContent
    assert.equal(buttonOf(doc).textContent, "Show all 3 R&D <filers>", "the client writes the plain words");
    // control: a label escaped by the helper itself would print its entities through textContent
    const node = { hidden: false, textContent: "", setAttribute() {}, getAttribute: () => null, querySelector: () => null };
    const btn = { ...node };
    syncCompactDisclosure({ hidden: false, querySelector: (s: string) => (s === "button" ? btn : null) } as unknown as CompactDisclosureNode, {
      total: 3, hidden: 2, expanded: false, noun: "R&D <filers>", shown: 1, all: true,
    });
    assert.equal(btn.textContent, "Show all 3 R&D <filers>");
    assert.notEqual(btn.textContent, "Show all 3 R&amp;D &lt;filers&gt;", "control: the double-escaped form is what the fix removed");
  } finally {
    restore();
  }
});
