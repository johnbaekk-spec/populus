-- Default and uncertainty views (ARCHITECTURE.md §9.5 — RUN 4).
--
-- Applied by populus.amendments.ensure_views (idempotent), NOT part of
-- schema.sql, which must stay byte-identical to the §9.4 DDL block.
--
-- Each statement is a plain CREATE VIEW: this file is THE definition, and
-- ensure_views makes the database match it — replacing any view whose stored
-- SQL differs, and writing NOTHING when none does. The former
-- `CREATE VIEW IF NOT EXISTS` left a database created by an earlier release
-- silently running that release's predicate forever, which is exactly how a
-- corpus would keep serving a filing this file excludes (M2-7 §I4).
--
-- v_default_transactions: rows of active filings, excluding the original
-- side of every unresolved amendment pair (an active filing pointing at it
-- through `supersedes`) — the pair never contributes twice to any number.
CREATE VIEW v_default_transactions AS
SELECT t.*
FROM transactions t
JOIN filings f ON f.filing_id = t.filing_id
WHERE f.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM filings a
    WHERE a.supersedes = f.filing_id AND a.lifecycle = 'active'
  );

-- v_amendment_pairs: both sides of every supersedes link, for inspection.
CREATE VIEW v_amendment_pairs AS
SELECT
  a.filing_id       AS amendment_filing_id,
  a.filer_name_raw  AS amendment_filer_name_raw,
  a.chamber         AS chamber,
  a.filed_date      AS amendment_filed_date,
  a.parse_status    AS amendment_parse_status,
  a.lifecycle       AS amendment_lifecycle,
  o.filing_id       AS original_filing_id,
  o.filer_name_raw  AS original_filer_name_raw,
  o.filed_date      AS original_filed_date,
  o.parse_status    AS original_parse_status,
  o.lifecycle       AS original_lifecycle
FROM filings a
JOIN filings o ON o.filing_id = a.supersedes;

-- Institutional 13F default population (ARCHITECTURE.md §10.2 — RUN M2-2).
-- Depends on the inst_* tables (populus.load.ensure_inst_schema); applied here
-- so a database gains both inst views on the same ensure_views call as the M1
-- views. Harmless (empty) until the inst tables carry rows.
--
-- v_default_inst_filings is the SINGLE authoritative default-filing predicate,
-- built filing-level in three stages so a parse-failed zero-row filing that
-- still reported a cover total counts for coverage, affiliation can never be
-- poisoned by a stale superseded original, and a filing whose two own numbers
-- irreconcilably disagree is never served (M2-7).
--
--  1. restatement_survivors — of the active filings for a (cik, period), keep
--     only the one no active RESTATEMENT for that period supersedes. Ordering:
--     later filed_date, then higher amendment_no, then larger accession. A
--     NEW_HOLDINGS amendment is NOT a supersede, so the original and the
--     amendment both survive — their union IS the merge (§10.2).
--  2. affiliation — over the survivor set on BOTH sides: drop a survivor whose
--     own normalized file number appears as an other-manager of ANOTHER
--     surviving filing for the same period (so a superseded original's stale
--     other_managers can neither suppress an affiliate nor be suppressed).
--     Stages 1+2 are v_inst_reconciled_filings — the population BEFORE the
--     cover reconciliation, which the disposition report reads so an excluded
--     filing can still be named (M2-7 §I5).
--  3. cover reconciliation (M2-7) — drop a filing whose RESOLVED holdings sum S
--     exceeds its DECLARED cover total T by more than tol(T) = max($1,000,
--     0.001*T): the filer's two numbers disagree beyond rounding, so neither is
--     servable. Within tolerance the filing stays (its denominator contribution
--     is max(S,T), applied in compute_coverage — never T, which would overstate
--     coverage). Integer arithmetic ONLY, and DIVISION rather than
--     multiplication: `S - T <= MAX(1000, T / 1000)` is the same predicate
--     `populus.ingest.inst13f.within_cover_tolerance` evaluates. Multiplying the
--     delta by 1000 promotes to REAL past ~9.2e18 on this signed-64-bit column,
--     putting floating point back inside the predicate that exists to keep it
--     out; dividing cannot overflow and is exactly equivalent for integer
--     deltas (§I1, external review F5).
CREATE VIEW v_inst_reconciled_filings AS
WITH restatement_survivors AS (
  SELECT f.*
  FROM inst_filings f
  WHERE f.lifecycle = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM inst_filings r
      WHERE r.lifecycle = 'active' AND r.amendment_type = 'RESTATEMENT'
        AND r.cik = f.cik AND r.period_of_report = f.period_of_report
        AND r.filing_id <> f.filing_id
        AND ( r.filed_date > f.filed_date
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) > COALESCE(f.amendment_no,0))
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) = COALESCE(f.amendment_no,0)
               AND r.accession > f.accession) )
    )
)
SELECT s.*
FROM restatement_survivors s
WHERE NOT EXISTS (                          -- affiliation, over SURVIVORS only
  SELECT 1 FROM restatement_survivors c, json_each(c.other_managers) m
  WHERE c.filing_id <> s.filing_id
    AND c.period_of_report = s.period_of_report
    AND s.file_number_norm IS NOT NULL
    AND json_extract(m.value, '$.file_number_norm') = s.file_number_norm
);

CREATE VIEW v_default_inst_filings AS
SELECT r.*
FROM v_inst_reconciled_filings r
WHERE r.table_value_total_usd IS NULL          -- unknown total: cover_failed owns it
   OR (
        (SELECT COALESCE(SUM(h.value_usd), 0)
         FROM inst_holdings h
         WHERE h.filing_id = r.filing_id AND h.security_id IS NOT NULL)
        - r.table_value_total_usd
      ) <= MAX(1000, r.table_value_total_usd / 1000);

-- v_default_holdings: holdings of the default filing set. The coverage
-- numerator sums value_usd over this view WHERE security_id IS NOT NULL; no
-- default number counts a position twice.
CREATE VIEW v_default_holdings AS
SELECT h.*
FROM inst_holdings h
JOIN v_default_inst_filings f ON f.filing_id = h.filing_id;

-- ---------------------------------------------------------------------------
-- RUN M2-8 (T5, plan R8) — the PER-FILER REPORTED population.
--
-- v_default_* answers cross-entity questions, so it drops a survivor whose file
-- number appears as another survivor's other-manager: an issuer total must count
-- an affiliate relationship ONCE. That is correct there and WRONG for a filer's
-- own page, which promises "every position this filer reported". Building that
-- page on v_default_holdings silently deletes the filer's own rows while the page
-- claims completeness (external review round 2, F13).
--
-- So this chain applies stages 1 and 3 and DELIBERATELY OMITS stage 2:
--   1. restatement survivors   — identical predicate to v_inst_reconciled_filings
--   2. affiliation suppression — OMITTED ON PURPOSE
--   3. cover reconciliation    — identical predicate to v_default_inst_filings
--
-- Stage 1 is restated here rather than refactored out because tests assert the
-- stored SQL text of the existing views and inst_bulk.py cites views.sql line
-- numbers; changing those definitions to share a CTE would churn both for no
-- behavioural gain. The duplication is instead pinned behaviourally by
-- test_filer_reported_views.py, which asserts the exact set relationship:
--   v_filer_reported_filings  ==  v_default_inst_filings  UNION  {affiliate-suppressed survivors that pass cover}
-- so the two survivor predicates cannot drift apart silently.
CREATE VIEW v_filer_reported_filings AS
WITH restatement_survivors AS (
  SELECT f.*
  FROM inst_filings f
  WHERE f.lifecycle = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM inst_filings r
      WHERE r.lifecycle = 'active' AND r.amendment_type = 'RESTATEMENT'
        AND r.cik = f.cik AND r.period_of_report = f.period_of_report
        AND r.filing_id <> f.filing_id
        AND ( r.filed_date > f.filed_date
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) > COALESCE(f.amendment_no,0))
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) = COALESCE(f.amendment_no,0)
               AND r.accession > f.accession) )
    )
)
SELECT s.*
FROM restatement_survivors s
WHERE s.table_value_total_usd IS NULL          -- unknown total: cover_failed owns it
   OR (
        (SELECT COALESCE(SUM(h.value_usd), 0)
         FROM inst_holdings h
         WHERE h.filing_id = s.filing_id AND h.security_id IS NOT NULL)
        - s.table_value_total_usd
      ) <= MAX(1000, s.table_value_total_usd / 1000);

-- v_filer_reported_holdings: what the filer itself reported, after amendment
-- composition, with no cross-filer suppression. The filer page and the
-- per-filer concentration/flag baseline read THIS; issuer totals keep reading
-- v_default_holdings (plan R8, R14; review round 3 F5).
CREATE VIEW v_filer_reported_holdings AS
SELECT h.*
FROM inst_holdings h
JOIN v_filer_reported_filings f ON f.filing_id = h.filing_id;
