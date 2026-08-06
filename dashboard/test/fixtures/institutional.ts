/* Shared institutional surface fixtures.

   QA M2-8 minor: `css-fold.test.ts` imported these from `holdings.test.ts`,
   which REGISTERS that file's 49 tests a second time in the css-fold process —
   the same assertions run twice, reported twice, and a failure there is
   attributed to the wrong suite. A fixture module has no `test()` calls, so
   importing it costs nothing. */

import {
  derivePutCallBucket,
  deriveUnitKey,
  holderCoverage,
} from "../../src/lib/holdings.ts";
import type {
  FilerHoldingRow,
  FilerSurfacePayload,
  FilingDict,
  HoldersSurfacePayload,
  IssuerHolderRow,
} from "../../src/lib/holdings.ts";

export const FILINGS: FilingDict = {
  "1": {
    accession: "0000000000-26-000001",
    submission_type: "13F-HR",
    period_of_report: "2026-03-31",
    filed_date: "2026-05-15",
    doc_url: "https://www.sec.gov/Archives/edgar/data/1067983/f1.xml",
    source: "sec-edgar",
  },
  "2": {
    accession: "0000000000-26-000002",
    submission_type: "13F-HR/A",
    period_of_report: "2026-03-31",
    filed_date: "2026-06-01",
    doc_url: "https://www.sec.gov/Archives/edgar/data/1067983/f2.xml",
    source: "sec-edgar",
  },
  "3": {
    accession: "0000000000-25-000003",
    submission_type: "13F-HR",
    period_of_report: "2025-12-31",
    filed_date: "2026-02-10",
    doc_url: "https://www.sec.gov/Archives/edgar/data/1067983/f3.xml",
    source: "sec-edgar",
  },
};

export function filerRow(over: Partial<FilerHoldingRow> = {}): FilerHoldingRow {
  // `put_call_bucket` / `unit_key` are DERIVED from `put_call` / `ssh_type` the
  // way the producer derives them, so an override of the raw field carries into
  // the grain token. A fixture whose tokens contradict its raw fields is one the
  // producer cannot emit, and it would quietly mask exactly the grain bugs these
  // tests exist to catch (measured: it merged a SH position with a PRN one).
  const base = {
    cik: "0001067983",
    period: "2026-03-31",
    filing_key: "1",
    security_id: "sec:aapl",
    cusip: "037833100",
    issuer_name: "FIXTURE ISSUER ONE",
    title_of_class: "COM",
    value_usd: 1_000_000,
    shares: 5_000,
    ssh_type: "SH",
    put_call: "LONG",
    position_key: "sid:sec:aapl",
    put_call_bucket: null,
    unit_key: null,
    flags: [],
    ...over,
  };
  return {
    ...base,
    put_call_bucket:
      over.put_call_bucket ?? derivePutCallBucket(base.put_call as string | null),
    unit_key: over.unit_key ?? deriveUnitKey(base.ssh_type as string | null),
  };
}

export function issuerRow(over: Partial<IssuerHolderRow> = {}): IssuerHolderRow {
  return {
    issuer_key: "entity:cik:0000320193",
    issuer_key_source: "entity",
    issuer_name: "FIXTURE ISSUER ONE",
    period: "2026-03-31",
    filer_key: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    affiliate_group_key: "0001067983",
    value_usd: 2_000_000,
    value_undisclosed_component: false,
    security_count: 1,
    filing_keys: ["1"],
    issuer_dedup_total_usd: 9_000_000,
    ...over,
  };
}

export function nRows(n: number, period = "2026-03-31"): FilerHoldingRow[] {
  return Array.from({ length: n }, (_, i) =>
    filerRow({
      period,
      position_key: `sid:sec:${String(i).padStart(5, "0")}`,
      issuer_name: `FIXTURE ISSUER ${String(i).padStart(5, "0")}`,
      value_usd: 1_000_000 - i,
    }),
  );
}

export function filerPayload(over: Partial<FilerSurfacePayload> = {}): FilerSurfacePayload {
  const current = nRows(3, "2026-03-31");
  const prior = nRows(2, "2025-12-31").map((r) => ({ ...r, filing_key: "3" }));
  return {
    kind: "filer",
    cik: "0001067983",
    filerName: "FIXTURE HOLDINGS LLC",
    periods: ["2025-12-31", "2026-03-31"],
    current: "2026-03-31",
    prior: "2025-12-31",
    filings: FILINGS,
    rowsByPeriod: { "2026-03-31": current, "2025-12-31": prior },
    totalsByPeriod: { "2026-03-31": current.length, "2025-12-31": prior.length },
    ...over,
  };
}

export function holdersPayload(rows: IssuerHolderRow[], all: IssuerHolderRow[] = rows): HoldersSurfacePayload {
  const period = "2026-03-31";
  return {
    kind: "holders",
    ticker: "FIXT",
    issuerName: "FIXTURE ISSUER ONE",
    periods: [period],
    current: period,
    filings: FILINGS,
    rowsByPeriod: { [period]: rows },
    totalsByPeriod: { [period]: rows.length },
    coverageByPeriod: { [period]: holderCoverage(all, period) },
    dedupByPeriod: { [period]: 9_000_000 },
  };
}

