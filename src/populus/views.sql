-- Default and uncertainty views (ARCHITECTURE.md §9.5 — RUN 4).
--
-- Applied by populus.amendments.ensure_views (idempotent), NOT part of
-- schema.sql, which must stay byte-identical to the §9.4 DDL block.
--
-- v_default_transactions: rows of active filings, excluding the original
-- side of every unresolved amendment pair (an active filing pointing at it
-- through `supersedes`) — the pair never contributes twice to any number.
CREATE VIEW IF NOT EXISTS v_default_transactions AS
SELECT t.*
FROM transactions t
JOIN filings f ON f.filing_id = t.filing_id
WHERE f.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM filings a
    WHERE a.supersedes = f.filing_id AND a.lifecycle = 'active'
  );

-- v_amendment_pairs: both sides of every supersedes link, for inspection.
CREATE VIEW IF NOT EXISTS v_amendment_pairs AS
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
-- built filing-level in two stages so a parse-failed zero-row filing that still
-- reported a cover total counts for coverage, and affiliation can never be
-- poisoned by a stale superseded original.
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
CREATE VIEW IF NOT EXISTS v_default_inst_filings AS
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

-- v_default_holdings: holdings of the default filing set. The coverage
-- numerator sums value_usd over this view WHERE security_id IS NOT NULL; no
-- default number counts a position twice.
CREATE VIEW IF NOT EXISTS v_default_holdings AS
SELECT h.*
FROM inst_holdings h
JOIN v_default_inst_filings f ON f.filing_id = h.filing_id;
