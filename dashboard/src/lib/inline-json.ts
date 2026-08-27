/* RUN PUBLIC-SECURITY-HARDENING PR 2 (R6/LD7) — the ONE inline-JSON primitive.

   Every `<script type="application/json">` data embed serializes through this
   function and nothing else. An upstream issuer/filer name containing
   `</script>` (any casing) would otherwise close the inert data block and let
   the remainder parse as executable markup. Escaping EVERY `<` as the
   six-character sequence backslash-u003c is byte-identical JSON semantics
   after `JSON.parse` — it is just an escaped `<` inside a JSON string — while guaranteeing the serialized text
   can never contain a `<`, so no tag of any kind can open inside the embed.

   Deliberately NO DOM/HTML responsibility and NO empty-payload policy: callers
   keep their own "no payload → no element" behavior. */

export function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
