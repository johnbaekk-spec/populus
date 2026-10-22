/* The unqualified-"all" ban (R12), a TEST-SIDE scanner: moved here from
   `src/lib/holdings.ts` in the launch final pass, because only tests ever
   called it — the product never ran it. What it protects is unchanged: every
   holdings surface (holders, filer, diff, the 13F data note, the absent
   state; holdings.test.ts) and the built holders page (post/fixture-preview)
   make no unqualified "all" claim. */

/** Identity coverage is high and NOT 100%, so "all holders" is a false claim on
    every surface built from it. This is the mechanism, not a style note: the
    word may appear only inside an explicitly qualified phrase.

    Returns each offending occurrence with context so a failure names the copy
    that broke the rule. Tags are stripped first — a class name containing "all"
    is not a claim to a reader. */
const ALL_QUALIFIERS = ["as-of-resolved", "resolved", "disclosed", "reported"];

export function unqualifiedAllClaims(html: string): string[] {
  // Attribute channels are read too — `title` / `aria-label` / `alt` are spoken
  // to a screen reader and shown on hover, so an unqualified "all" inside one is
  // exactly as much of a claim as one in the body. The sibling scanner in
  // `activity.ts` already did this; stripping tags first (as this did) deleted
  // those channels along with the markup. Zero live hits today — the asymmetry
  // was the defect, not a current violation.
  const attrs = [...html.matchAll(/(?:title|aria-label|alt)="([^"]*)"/g)]
    .map((m) => m[1]!)
    .join(" ");
  const text = (html + " " + attrs)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
  const out: string[] = [];
  const re = /\ball\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rest = text.slice(m.index + m[0].length);
    // "all-in", "all-time": a hyphenated compound is a different word, not a
    // claim about coverage.
    if (rest.startsWith("-")) continue;
    const after = rest.slice(0, 40).trimStart().toLowerCase();
    if (ALL_QUALIFIERS.some((q) => after.startsWith(q))) continue;
    out.push(text.slice(Math.max(0, m.index - 30), m.index + 50).trim());
  }
  return out;
}
