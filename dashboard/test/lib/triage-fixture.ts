/* signals-v3 M2 (T2.3): the golden triage fixture, decoded.

   `test/fixtures/signal-triage-cases.json` is cut from PUBLIC rows of live
   build 20261013.1 (its `about` and `provenance` fields say exactly what is in
   it and where every part came from). Its rows are stored with the feed's
   repeated member and receipt fields interned — a lossless encoding this
   loader reverses into the `TxnRow`s the build itself reads.

   The live artifact is JSON, so its signals carry no engine identity symbol;
   the fixture's `identities` map each per-row signal id to its triggering
   txnId, and `identityOf` refuses any pair whose hash does not reproduce the
   id (`kind:fnv1a64(txnId)`, the engine's own derivation) — a mis-cut fixture
   fails loudly instead of scoring the wrong line. */

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Signal, SignalArtifact } from "../../src/lib/signals.ts";
import type { TxnRow } from "../../src/lib/format.ts";
import { fnv1a64, type CommitteeMembership, type SectorResolution } from "../../src/lib/derive.ts";
import { sicCode } from "../../src/lib/committee-direct.ts";
import type { TriageCommitteeInputs } from "../../src/lib/signal-triage.ts";

export const TRIAGE_FIXTURE_PATH = path.resolve(import.meta.dirname, "..", "fixtures", "signal-triage-cases.json");

interface RawFixture {
  about: string;
  provenance: Record<string, { source: string } & Record<string, unknown>>;
  artifact: SignalArtifact;
  identities: Record<string, string>;
  member_cols: string[];
  members: unknown[][];
  docs: string[];
  row_cols: string[];
  rows: unknown[][];
  committees: {
    window: { valid_from: string; valid_to: string; snapshot_date: string };
    committees: { committee_id: string; name: string; chamber: string }[];
    memberships: { committee_id: string; bioguide_id: string; role: string | null; snapshot_date: string; valid_from: string; valid_to: string }[];
    jurisdiction: { committee_id: string; sector: string; mapping_version: number }[];
  };
  issuers: Record<string, { cik: string; sic: string; sector: string }>;
}

export interface TriageFixture {
  raw: RawFixture;
  rows: TxnRow[];
  artifact: SignalArtifact;
  identityOf: (s: Signal) => string | null;
  committee: TriageCommitteeInputs;
}

let cached: TriageFixture | null = null;

export function loadTriageFixture(): TriageFixture {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(TRIAGE_FIXTURE_PATH, "utf-8")) as RawFixture;
  const rows: TxnRow[] = raw.rows.map((a) => {
    const o: Record<string, unknown> = { kind: "txn" };
    raw.row_cols.forEach((c, i) => {
      if (c === "m") raw.member_cols.forEach((mc, j) => (o[mc] = raw.members[a[i] as number]![j]));
      else if (c === "d") o.doc = raw.docs[a[i] as number];
      else o[c] = a[i];
    });
    return o as unknown as TxnRow;
  });
  const identities = new Map(Object.entries(raw.identities));
  const identityOf = (s: Signal): string | null => {
    const t = identities.get(s.id) ?? null;
    if (t === null) return null;
    if (`${s.kind}:${fnv1a64(t)}` !== s.id) throw new Error(`fixture identity ${t} does not reproduce ${s.id}`);
    return t;
  };
  const names = new Map(raw.committees.committees.map((c) => [c.committee_id, c.name]));
  const byMember = new Map<string, CommitteeMembership[]>();
  for (const m of raw.committees.memberships) {
    let l = byMember.get(m.bioguide_id);
    if (!l) byMember.set(m.bioguide_id, (l = []));
    l.push({ committeeId: m.committee_id, name: names.get(m.committee_id) ?? m.committee_id, role: m.role, validFrom: m.valid_from, validTo: m.valid_to });
  }
  const juris = new Map<string, string[]>();
  for (const j of raw.committees.jurisdiction) {
    let l = juris.get(j.committee_id);
    if (!l) juris.set(j.committee_id, (l = []));
    l.push(j.sector);
  }
  const committee: TriageCommitteeInputs = {
    membershipsByMember: byMember,
    windowFrom: raw.committees.window.valid_from,
    windowTo: raw.committees.window.valid_to,
    jurisdictionByCommittee: juris,
    // The fixture holds only resolved issuers, so an absent ticker is the
    // ticker map's own "unresolved" answer.
    resolveSector: (t: string): SectorResolution => {
      const i = raw.issuers[t];
      return i ? { state: "sector", sector: i.sector } : { state: "unresolved-ticker" };
    },
    resolveSic: (t: string) => sicCode(raw.issuers[t]?.sic),
  };
  cached = { raw, rows, artifact: raw.artifact, identityOf, committee };
  return cached;
}
