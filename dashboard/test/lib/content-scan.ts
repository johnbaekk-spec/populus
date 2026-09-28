/* DESIGN-POLISH M3 (T3.1–T3.7): the content-hygiene predicates the post-build
   dist scan runs over every built page, kept here so the contributor tier can
   prove each one DETECTS its defect on a planted fixture (a scan that never
   fires proves nothing — the gate's own control).

   Each predicate reads the page's reader text (`readerText`) or a narrow,
   named markup shape, and returns what it found. */

/** The page's reader text for these checks: scripts, styles, templates and
    comments removed, tags replaced by a space, entities decoded. Filed names
    are NOT redacted here (unlike the wording gate): redacting one between two
    separators would itself manufacture a "· ·". */
function readerText(html: string): string {
  const t = html
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return t
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

export interface ContentHit {
  check: string;
  excerpt: string;
}

/** Every `<td>` body's leading text (a nested table's cells are separate
    matches; only the START of each cell is read, which a nested cell cannot
    change). */
function cellStarts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<td\b[^>]*>([\s\S]{0,400})/g)) {
    let text = m[1]!;
    for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(/<[^>]*>/g, ""); }
    const lead = text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trimStart();
    out.push(lead);
  }
  return out;
}

/** The content defects of ONE page. `rel` is the page's path under dist
    ("institutional/index.html"), for the checks scoped to one surface. */
export function contentHits(html: string, rel = ""): ContentHit[] {
  const hits: ContentHit[] = [];
  const text = readerText(html);
  const at = (re: RegExp): string | null => {
    const m = re.exec(text);
    return m ? text.slice(Math.max(0, m.index - 40), m.index + 40) : null;
  };
  // R17: one qualifier join — never a doubled separator
  const doubled = at(/·\s*·/);
  if (doubled) hits.push({ check: "doubled separator", excerpt: doubled });
  // R17: no cell opens with a separator
  const opener = cellStarts(html).find((c) => /^·/.test(c));
  if (opener !== undefined) hits.push({ check: "cell begins with a separator", excerpt: opener.slice(0, 60) });
  // R20: a CIK a reader sees has no leading zeros
  const cik = at(/\bCIK 0\d/);
  if (cik) hits.push({ check: "zero-padded CIK", excerpt: cik });
  if (rel === "institutional/index.html") {
    const cell = /<td class="c-num c-muted">(0\d{3,})<\/td>/.exec(html);
    if (cell) hits.push({ check: "directory CIK cell with a leading zero", excerpt: cell[1]! });
  }
  // R23: the receipt prints its regime once
  const receipt = at(/\b(PTR PTR|eFD eFD)\b/);
  if (receipt) hits.push({ check: "doubled receipt", excerpt: receipt });
  // R18: the trade vocabulary is BUY / SELL / EXCHANGE in every cell
  const side = /<td\b[^>]*>(?:\s*<[^>]+>)*\s*(Purchase|Sale|Exchange)\s*</.exec(html);
  if (side) hits.push({ check: "a cell reads the retired side word", excerpt: side[1]! });
  // R19: no lowercase kind pill
  const pill = /<span class="qoq-chip [^"]*">(new|add|trim|exit|no change|no prior)<\/span>/.exec(html);
  if (pill) hits.push({ check: "a lowercase kind pill", excerpt: pill[0] });
  // R19 (W-2, M3 review): no kind cell prints the raw producer kind — the
  // overlap timeline's 13F rows did ("add", "trim") on /tickers/* and holders
  const rawKind = /<td class="c-kind\b[^"]*">\s*(new|add|trim|exit|held|no_prior|no change|no prior)\s*</.exec(html);
  if (rawKind) hits.push({ check: "a kind cell reads the raw producer kind", excerpt: rawKind[0] });
  return hits;
}
