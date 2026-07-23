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
