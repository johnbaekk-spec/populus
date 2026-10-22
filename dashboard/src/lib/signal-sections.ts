import { esc } from "./format.ts";

/* The four sections of /signals/, in tab order. The page's tabs and the
   header's Signals menu read the same names and hints, so a first-time reader
   meets the same four words in both places. `id` is the tab's panel id, which
   `tabs.ts` selects from the hash. */
export interface SignalSection {
  readonly id: "congress" | "institutional" | "overlap" | "playbooks";
  readonly name: string;
  readonly hint: string;
}

export const SIGNAL_SECTIONS: readonly [SignalSection, SignalSection, SignalSection, SignalSection] = [
  { id: "congress", name: "Congress", hint: "Member trades that stand out" },
  { id: "institutional", name: "Institutional", hint: "13F manager changes" },
  { id: "overlap", name: "Overlap", hint: "Congress and 13F, same name" },
  { id: "playbooks", name: "Playbooks", hint: "Names that match published studies" },
];

/** The header's Signals menu: one link per section (Base.astro). */
export function signalMenuHtml(): string {
  return SIGNAL_SECTIONS.map(
    (s) =>
      `<a class="nav-drop-item" href="/signals/#${s.id}"><span class="nav-drop-name">${esc(s.name)}</span> <span class="nav-drop-hint">${esc(s.hint)}</span></a>`,
  ).join("");
}
