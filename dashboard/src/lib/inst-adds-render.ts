/* The leaderboard row renderer, extracted so the SSR page and the
   client island produce IDENTICAL bytes. It lives apart from `ui.ts` because
   the island imports it dynamically and `ui.ts` pulls in the whole rendering
   surface. */

import { esc, fmtInt, fmtUsd, identityChipHtml, note } from "./format.ts";
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
  /* Three tooltip-only explanations become notes.
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
    /* The raw issuer key (`cusip6:464287`) stops being visible text.
       The chip says what the key IS; the key itself lives in the note and in
       `data-identity-key`, so nothing is lost and it stays copyable. An
       `entity:` key renders no chip at all — a resolved entity is the ordinary
       case, and marking it would flag the absence of a problem. */
    `<td class="c-issuer">${name}${identityChipHtml(r.issuer_key, ctx, `${rowKey}-identity`)}</td>` +
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
