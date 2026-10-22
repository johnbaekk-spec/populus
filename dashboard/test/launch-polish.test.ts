/* Launch polish (owner, 2026-10-22, before marketing): the Signals sections are
   named in the header and on the tabs, nothing on the site is "New" or
   "planned", and the "Triggers now" receipt is a cell in its own row. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { baseStylesheet } from "./lib/styles.ts";
import { parseRules, winning, type El } from "./lib/cascade.ts";
import { SIGNAL_SECTIONS, signalMenuHtml } from "../src/lib/signal-sections.ts";
import { PLAYBOOKS } from "../src/lib/playbooks.ts";

const CSS = baseStylesheet();
const PHONE = { width: 390 };
const DESKTOP = { width: 1440, coarse: false };
const SRC = path.resolve(import.meta.dirname, "..", "src");

test("the header's Signals menu links each Signals tab by its panel id, with its hint", () => {
  const html = signalMenuHtml();
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/signals/#congress", "/signals/#institutional", "/signals/#overlap", "/signals/#playbooks"]);
  for (const s of SIGNAL_SECTIONS) assert.ok(html.includes(`${s.name}</span> <span class="nav-drop-hint">${s.hint}</span>`), s.id);
});

test("a shown menu, a drawer count and the sheet hint win over the global [hidden] rule", () => {
  const rules = parseRules(CSS);
  const root: El[] = [{ tag: "html" }, { tag: "body" }];
  const hidden: El = { tag: "span", classes: ["nav-drop"], attrs: { hidden: "" } };
  const nav: El = { tag: "nav", classes: ["site-nav"], id: "site-nav" };
  assert.equal(winning(rules, [...root, nav, { tag: "span", classes: ["nav-has-drop"] }, hidden], "display", DESKTOP)?.value, "none", "closed until hover or focus");
  /* the cascade helper holds no state pseudo-class, so the open rule is read
     as written: hover and keyboard focus, important over [hidden] */
  assert.match(CSS, /\.nav-has-drop:hover > \.nav-drop, \.nav-has-drop:focus-within > \.nav-drop \{ display: block !important; \}/);
  const open: El = { tag: "nav", classes: ["site-nav", "open"], id: "site-nav" };
  assert.equal(winning(rules, [...root, open, { tag: "span", classes: ["nav-has-drop"] }, hidden], "display", PHONE)?.value, "block", "listed in the drawer");
  assert.equal(winning(rules, [...root, open, { tag: "span", classes: ["nav-count"], attrs: { hidden: "" } }], "display", PHONE)?.value, "block", "the drawer's counts show");
});

test("a 'Triggers now' receipt is a cell in its row, not the triage row's absolute corner badge", () => {
  const rules = parseRules(CSS);
  const cell: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "table", classes: ["pb-tg"] }, { tag: "tbody" }, { tag: "tr", classes: ["pb-row"] }, { tag: "td", classes: ["c-src", "si-row-src"] }];
  assert.equal(winning(rules, cell, "position", DESKTOP)?.value, "static");
  assert.equal(winning(rules, cell, "position", PHONE)?.value, "static");
});

test("no planned module or playbook ships: no /financials/ or /macro/ page, no playbook waiting on data", () => {
  assert.ok(!existsSync(path.join(SRC, "pages", "financials")));
  assert.ok(!existsSync(path.join(SRC, "pages", "macro")));
  assert.ok(PLAYBOOKS.every((p) => p.status === "live" || p.status === "descriptive"));
});
