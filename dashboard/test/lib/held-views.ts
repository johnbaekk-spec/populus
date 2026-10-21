/* Launch F2 (R35, LD31): the Monthly flow panel as its reader has it once every
   view has been shown. The served panel carries only the default view (Members
   on listed stocks); the three others ride in the one held-rows island and the
   REAL toggle (`initMonthlyFlowToggle`) draws each, once, through the binder
   when it is first shown. This presses Dollars, then All assets, then back to
   Members and Stocks — so every view is drawn and the default view is the one
   showing — and returns the page root to query. */

import { installDom, type MiniElement } from "./mini-dom.ts";
import { initMonthlyFlowToggle } from "../../src/scripts/congress-sections.ts";

export const FLOW_PRESSES = [
  '[data-flow-measure-toggle="dollars"]',
  '[data-flow-toggle="all"]',
  '[data-flow-measure-toggle="members"]',
  '[data-flow-toggle="stocks"]',
] as const;

export function drawnMonthlyFlow(html: string): MiniElement {
  const { doc, restore } = installDom(`<main id="congress-page">${html}</main>`);
  try {
    if (!initMonthlyFlowToggle()) throw new Error("held-views: no Monthly flow panel to draw");
    for (const sel of FLOW_PRESSES) doc.querySelector(sel)!.click();
    return doc.getElementById("congress-page")!;
  } finally {
    restore();
  }
}
