/* F-28 (ALPHA-UX): the NUL-safe banned-wording scanner behind the §0 gate.

   Why this exists as its own module: `dashboard/src/lib/derive.ts` contains a
   deliberate NUL byte (a composite-key delimiter), which makes `file(1)`
   classify the source as `data` — so PLAIN `grep` silently reports no matches
   and exits 1, and a grep-based gate would skip exactly the file it exists to
   police while reporting green. This scanner:

   * reads raw bytes and decodes as UTF-8 — it never binary-sniffs;
   * ENUMERATES every file it covered, so the caller can assert coverage
     (a pass is a checked-empty match set over a named file list, never an
     inference from silence);
   * THROWS on an unreadable file — a file it cannot read is a gate failure,
     not a skip. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/* The M2-8 spec §1.1 banned list, as word-boundary patterns. Present-tense
   trading verbs are banned because a filing is a delayed snapshot — at render
   time the position may not exist. "move" is banned as a verb; the \b form
   deliberately leaves "moves" (the noun in "QoQ moves") alone. */
export const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "bet", re: /\bbet\b/i },
  { name: "conviction", re: /\bconviction\b/i },
  { name: "high-conviction", re: /\bhigh-conviction\b/i },
  { name: "bullish", re: /\bbullish\b/i },
  { name: "bearish", re: /\bbearish\b/i },
  { name: "loading up", re: /\bloading up\b/i },
  { name: "piling in", re: /\bpiling in\b/i },
  { name: "doubling down", re: /\bdoubling down\b/i },
  { name: "backs", re: /\bbacks\b/i },
  { name: "favors", re: /\bfavors\b/i },
  { name: "likes", re: /\blikes\b/i },
  { name: "buying", re: /\bbuying\b/i },
  { name: "is buying", re: /\bis buying\b/i },
  { name: "just bought", re: /\bjust bought\b/i },
  { name: "sold", re: /\bsold\b/i },
  { name: "move (verb)", re: /\bmove\b/i },
];

/** Field values that arrive VERBATIM from a filing, and the marker the render
    sites put around the same strings in HTML.

    The ban exists to stop the SITE adopting a market-narrative voice — "X is
    bullish on Y". It was never meant to police what a security is lawfully
    called, and several real ones trip it: "Bullish" is a listed company,
    Invesco publishes a "BULLISH FD" / "BEARISH FD" share class, and there is a
    sports-betting ETF. Measured 2026-08-18 on build 20260817.1: 175 hits across
    164 files, every one of them in `institutional/`, and every one a filed
    name. Renaming filed data to satisfy a style rule would falsify the record.

    So these values are redacted BEFORE matching — and nothing else is. The rest
    of every institutional page is still scanned, so editorial copy that sits
    beside a filed name is caught exactly as before. */
export const FILED_NAME_JSON_FIELDS = ["issuer_name", "title_of_class"] as const;
export const FILED_NAME_MARKER = "filed-name";

/** Blank out filed names, leaving everything else byte-identical. */
export function redactFiledNames(text: string): string {
  let out = text;
  for (const field of FILED_NAME_JSON_FIELDS) {
    out = out.replace(
      new RegExp(`("${field}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "g"),
      `$1"<filed>"`,
    );
  }
  out = out.replace(
    new RegExp(`<span class="${FILED_NAME_MARKER}">[\\s\\S]*?</span>`, "g"),
    `<span class="${FILED_NAME_MARKER}"><filed></span>`,
  );
  return out;
}

export interface ScanHit {
  file: string;
  pattern: string;
  excerpt: string;
}

export interface ScanResult {
  /** every file the scanner READ — the coverage evidence the gate asserts on */
  covered: string[];
  hits: ScanHit[];
}

/** Scan every file under `root` whose name passes `include`. Unreadable files
    throw — never a silent skip. */
export function scanTree(root: string, include: (name: string) => boolean): ScanResult {
  const covered: string[] = [];
  const hits: ScanHit[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const st = statSync(full); // throws on unreadable — deliberate
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!include(entry)) continue;
      // Raw bytes → UTF-8. A NUL byte is just a character here; nothing is
      // classified as "binary" and skipped.
      const text = redactFiledNames(readFileSync(full).toString("utf-8"));
      covered.push(path.relative(root, full));
      for (const { name, re } of BANNED_PATTERNS) {
        const m = re.exec(text);
        if (m) {
          const at = m.index;
          hits.push({
            file: path.relative(root, full),
            pattern: name,
            excerpt: text.slice(Math.max(0, at - 60), at + 60).replaceAll("\n", "⏎"),
          });
        }
      }
    }
  };
  walk(root);
  return { covered, hits };
}
