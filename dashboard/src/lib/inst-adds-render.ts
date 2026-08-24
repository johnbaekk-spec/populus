/* R9/R21 — the leaderboard row renderer, extracted so the SSR page and the
   client island produce IDENTICAL bytes. It lives apart from `ui.ts` because
   the island imports it dynamically and `ui.ts` pulls in the whole rendering
   surface. */

import { esc, fmtInt, fmtUsd, note } from "./format.ts";
import type { AddsRow } from "./inst-adds.ts";

/** One leaderboard row. Every metric is that row's OWN mode — the payload is
    per-mode by construction, so nothing here re-derives across modes. */
export function addsRowHtml(r: AddsRow, pos: number): string {
  const name =
    r.issuer_name && r.issuer_name.trim() !== ""
      ? `<span class="filed-name">${esc(r.issuer_name)}</span>`
      : `<span class="none">issuer not named in this build</span>`;
  // The value is the actual sum with its null state. A partial sum carries its
  // marker; an all-null sum renders an em dash, never $0.
  /* SL-R8 Class B / SL-R26: three tooltip-only explanations become notes.
     The key is the row's issuer key JOINED TO ITS RENDERED POSITION, because
     `AddsRow` has no position_key and one issuer may appear under more than
     one `issuer_key_source` — the plan's enumeration was read off
     `inst-adds.ts`'s declared fields, and `pos` is what makes it singular. */
  const ctx = { scope: "inst-adds-row" };
  const rowKey = `${r.issuer_key}-${pos}`;
  const value =
    r.delta_value_usd == null
      ? `<span class="none">—</span>` +
        note("every contributing delta was undisclosed — never zero", ctx, `${rowKey}-nodelta`)
      : `${esc(fmtUsd(r.delta_value_usd))}${
          r.delta_value_is_partial
            ? ` <span class="mono-note">partial ·‡</span>` +
              note(
                "at least one contributing delta was undisclosed and is omitted from this sum",
                ctx,
                `${rowKey}-partial`,
              )
            : ""
        }`;
  const adder =
    r.top_adder_cik == null
      ? `<span class="none">—</span>` +
        note("no contributing manager disclosed a value — never an arbitrary pick", ctx, `${rowKey}-novalue`)
      : esc(r.top_adder_name ?? `CIK ${r.top_adder_cik}`);
  return (
    `<tr><td class="c-num c-muted">${fmtInt(pos)}</td>` +
    `<td class="c-issuer">${name}<span class="mono-note"> ${esc(r.issuer_key)}</span></td>` +
    `<td class="c-num">${fmtInt(r.manager_count)}</td>` +
    `<td class="c-num">${fmtInt(r.new_position_count)}</td>` +
    `<td class="c-num c-strong">${value}</td>` +
    `<td class="c-filer c-secondary">${adder}</td></tr>`
  );
}


/** Every row at its rendered position, optionally bounded by the compact
    slice. ONE renderer for SSR, for a sort, and for a period change. */
export function addsRowsHtml(rows: readonly AddsRow[], compact?: number): string {
  const shown = compact == null ? rows : rows.slice(0, compact);
  return shown.map((r, i) => addsRowHtml(r, i + 1)).join("\n");
}
