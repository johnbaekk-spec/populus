/* The bounded recently-added-issuers endpoint.

   PATH: /institutional/data/adds/<period>.<mode>.v1.json

   `mode` is a PATH DIMENSION, not a client-side filter. The site is static, so
   a combined payload cannot be re-aggregated at request time; filtering
   combined rows down by `new_position_count` would still display add-derived
   value, manager counts and top adder under a "new only" label. Both modes are
   therefore prerendered for every offered period.

   Only CLOSED periods are emitted. An open quarter is materially
   undercounted — it ranks whoever filed early — so it is not published at all
   rather than published with a caveat. */

import type { APIRoute } from "astro";
import { getBuildData } from "../../../../lib/data";
import { addsFor, addsExclusionCount } from "../../../../lib/inst";
import {
  ADDS_BYTE_LIMIT,
  ADDS_MODES,
  boundAdds,
  closedPeriods,
  type AddsMode,
  type AddsPayload,
} from "../../../../lib/inst-adds";

export function getStaticPaths(): { params: { period: string; mode: string } }[] {
  const build = getBuildData();
  if (!build.inst.present) return [];
  const periods = closedPeriods(build.inst.addsPeriods, build.generatedAtDate);
  return periods.flatMap((period) =>
    ADDS_MODES.map((mode) => ({ params: { period, mode } })),
  );
}

export const GET: APIRoute = ({ params }) => {
  const build = getBuildData();
  const period = String(params.period);
  const mode = String(params.mode) as AddsMode;

  // Bound against the REAL envelope. Bounding against a placeholder with
  // blank metadata under-measured the response — substituting the actual period,
  // generated-at, truncation flag and boundary pushed a boundary-sized payload
  // twenty bytes over the declared 2 MiB cap. The cap bounds the RESPONSE, so
  // the response's own metadata has to be inside the measurement.
  const envelope = {
    period,
    generated_at: build.generatedAtDate,
    truncated: true, // the widest case: measure as if the flag and boundary are set
    truncation_boundary: [Number.MIN_SAFE_INTEGER, 0, ""] as [number, number, string],
    ambiguous_identity_exclusion_count: addsExclusionCount(build.inst, period, mode),
  };
  const bounded = boundAdds(addsFor(build.inst, period, mode), { envelope });
  const payload: AddsPayload = {
    period,
    generated_at: build.generatedAtDate,
    rows: bounded.rows,
    truncated: bounded.truncated,
    truncation_boundary: bounded.truncation_boundary,
    // REQUIRED, and it travels in the payload rather than being recomputed:
    // a static site cannot recount after a period or mode toggle, and an
    // omission the reader is never told about is forbidden.
    ambiguous_identity_exclusion_count: envelope.ambiguous_identity_exclusion_count,
  };
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).length > ADDS_BYTE_LIMIT) {
    // Fail loudly at BUILD time rather than serve a response that breaks its own
    // declared bound. Reaching here means the envelope estimate was wrong, which
    // is a defect in the bound, not something to paper over at request time.
    throw new Error(
      `adds payload for ${period}.${mode} serialized to ` +
        `${new TextEncoder().encode(body).length} bytes, over the ${ADDS_BYTE_LIMIT}-byte cap`,
    );
  }
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
