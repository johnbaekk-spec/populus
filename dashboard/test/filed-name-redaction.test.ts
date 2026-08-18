/* The §0 banned-wording exemption for filed names (owner decision 2026-08-18).

   The ban stops the SITE adopting a market-narrative voice. It was never meant
   to police what a security is lawfully called, and the restored corpus made
   that collision real: 175 hits across 164 files on build 20260817.1, every one
   in `institutional/`, every one a filed name — "Bullish" is a listed company,
   Invesco publishes BULLISH FD / BEARISH FD share classes, and there is a
   sports-betting ETF.

   The danger in any exemption is that it quietly stops enforcing the rule. So
   the POSITIVE CONTROLS matter more than the exemption itself: editorial copy
   must still be caught, including on the very pages that carry filed names. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { redactFiledNames, BANNED_PATTERNS } from "./lib/banned-scan.ts";

const hits = (text: string): string[] =>
  BANNED_PATTERNS.filter((p) => p.re.test(redactFiledNames(text))).map((p) => p.name);

test("a filed issuer name no longer trips the ban", () => {
  const json = `{"cusip":"G16910120","issuer_name":"BULLISH","title_of_class":"ORD SHS"}`;
  assert.deepEqual(hits(json), []);
});

test("a filed share-class name no longer trips the ban", () => {
  const json = `{"issuer_name":"INVESCO DB US DLR INDEX TR","title_of_class":"BEARISH FD"}`;
  assert.deepEqual(hits(json), []);
});

test("a filed name rendered into HTML is exempt only where it is MARKED", () => {
  const marked = `<td class="c-pos"><span class="filed-name">BULLISH</span><span class="mono-note"> · COM</span></td>`;
  assert.deepEqual(hits(marked), []);
  /* the marker is the whole contract — an unmarked name is still scanned, so a
     render site that forgets it fails loudly rather than silently exempting */
  const unmarked = `<td class="c-pos"><span>BULLISH</span></td>`;
  assert.deepEqual(hits(unmarked), ["bullish"]);
});

/* ---------------- positive controls: the rule still bites ---------------- */

test("POSITIVE CONTROL: editorial copy is still caught", () => {
  assert.deepEqual(hits(`<p>This filer is bullish on semiconductors.</p>`), ["bullish"]);
  assert.deepEqual(hits(`<p>A big bet on rates.</p>`), ["bet"]);
  assert.deepEqual(hits(`<p>The senator sold everything.</p>`), ["sold"]);
});

test("POSITIVE CONTROL: editorial copy beside a filed name is still caught", () => {
  /* the exemption must be surgical — redacting the field must not deafen the
     scanner to the sentence next to it, which is exactly how an exemption
     turns into a silently disabled gate */
  const page =
    `{"issuer_name":"BULLISH","title_of_class":"ORD SHS"}` +
    `<p>Our read: the filer is bearish here.</p>`;
  assert.deepEqual(hits(page), ["bearish"]);
});

test("POSITIVE CONTROL: redaction changes nothing else in the bytes", () => {
  const clean = `<p>Quarter-end long positions only. Values as filed.</p>`;
  assert.equal(redactFiledNames(clean), clean, "text with no filed names must be untouched");
});

test("a filed name containing NO banned word is still redacted, not special-cased", () => {
  /* the exemption is structural — "this string came off a filing" — not a list
     of embarrassing words. A name-by-name allowlist breaks the first time a new
     fund appears, which is a matter of time. */
  const json = `{"issuer_name":"APPLE INC","title_of_class":"COM"}`;
  assert.match(redactFiledNames(json), /"issuer_name":"<filed>"/);
});
