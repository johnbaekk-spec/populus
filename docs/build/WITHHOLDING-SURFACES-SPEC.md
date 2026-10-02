# Withholding surfaces specification

Status: specification only, for a separately reviewed implementation phase. Phase 1
does not implement W1–W4. This document describes the target behavior and its
acceptance tests; it does not claim that the current publisher satisfies them.

## Policy and scope

The contract in `src/populus/inst_redaction.py` is that **no (CUSIP, ticker)
pairing may be derivable from what the project publishes**. A CUSIP alone is
accepted. The withholding population is the existing reviewed mapping and its
closed set, including the existing SEC-list issuer seeding gate, same-CUSIP6
edges and shared-security-ID edges. Reuse `close_withheld_cusips` and
`plan_cusip_redaction`; do not invent a second closure or prohibit all CUSIPs.

W1 covers serialization order (A1-01); W2 covers all published table text
(A1-02/A1-03); W3 covers inline institutional data (A1-06); W4 covers real
publication verification (A4-01). The seed round trip is part of acceptance.
Internal source databases and accepted institutional snapshots retain their
original identifiers. Sanitization operates on publication copies.

A1-04 (federated live MCP), A1-05 (disclosure fingerprint recovery), A1-07
(precise source-coordinate recovery), A1-08 (additional matcher forms), A2-04,
A2-05 and A4-02 remain out of scope. The broad policy remains the requirement;
passing the bounded W1–W4 scanner does not establish that those other pathways
have been resolved. Do not silently describe W1–W4 as full policy compliance.

## W1: serialize Congress slices from the sanitized snapshot

`src/populus/publish/build.py:stage_build` currently writes
`congress/feed.json`, `congress/members/<bioguide>.json` and
`congress/tickers/<ticker>.json` from `snapshot` before
`apply_registry_redaction`. Move that existing serialization block after the
registry/text pass, reading the same staged `assets/congress.db` through a new
connection. Retain feed/slice limits, member-join refusal, safe ticker filenames,
skipped-ticker accounting, ordering and existing JSON contracts.

The required sequence is:

1. Back up the source into the staged Congress copy and perform integrity checks.
2. Derive the institutional aggregate and serving files using original keys.
   On the legacy branch the derive still reads the Congress snapshot. On the
   external branch preserve the accepted snapshot's single read transaction.
   Capture the existing closed withheld and unverified sets from that derive.
3. Close the original snapshot connection, including all derive readers.
4. Enable `secure_delete`, clear inline institutional rows as W3 specifies,
   then apply W2 to the staged Congress copy with the captured closure. Finish
   `VACUUM` with no other handle holding that file. Neither step precedes derive.
5. Open the sanitized copy, install/reuse existing views, run the member-join
   check and serialize feed/member/ticker slices. Close this reader afterward.
6. Construct publication text in stats from sanitized inputs too. In particular,
   source-derived names in `compute_stats` must not survive in an early cached
   `stats_document`. The in-memory state used by finalization and the persisted
   `congress/stats.json` must both use the sanitized document. Preserve freshness
   and licensing inputs and the existing watermark/count semantics.
7. Compute logical and byte digests after all database changes; produce the
   provisional manifest from sanitized artifacts. `finalize_build` patches the
   actual served file count in both stats copies, seals the final manifest and
   writes the recovery journal last. Packaging/deploying uses those final bytes.

This preserves both existing constraints: original-key institutional joins
finish before redaction, and the snapshot handle closes before the redactor's
`VACUUM`. Moving only JSON production is insufficient if a retained stats or
metadata object later reintroduces unsanitized source text.

## W2: sweep every published table and every text surface

Replace the Congress two-column allowlist with a schema-derived inventory.
Enumerate all real tables through `sqlite_master` and their columns through
`PRAGMA table_info` (and generated-column information where applicable). Include
all Congress, registry, metadata and surviving publication tables, even tables
that do not appear in `v_default_transactions`. Views must consequently read
sanitized base values; separately inventory any constant text in view/DDL
definitions. No newly introduced published table may silently escape the sweep.

Sweep every text column, including nullable text, raw source text, JSON strings,
names, notes, asset descriptions, aliases, list raw data and identifier metadata.
SQLite is dynamically typed: cover stored values with `typeof(value)='text'`
even where the declared type is not TEXT, as well as TEXT/CHAR/CLOB/VARCHAR and
untyped columns. Constraint-bound columns whose valid domain cannot contain a
canary need an explicit inventory explanation, not an unrecorded skip. Binary
payloads still undergo the final raw-byte verification.

Use the same current token and ISIN matcher scope as the existing redactor and
probe. Reuse the existing position/issuer/security-ID replacement plans for
canonical derived keys. A1-08 matcher expansion is a separate change. For JSON,
preserve valid JSON and its schema while sanitizing matching string keys and
values; do not delete an entire raw object to make the verifier pass.

### Marker policy

| Published table family | Replacement for embedded source/prose text |
| --- | --- |
| `members`, `member_aliases`, `filings`, `transactions`, `ingest_runs`, and other Congress disclosure/source tables | `[CUSIP withheld]` (`DISCLOSURE_WITHHELD_TEXT`), visibly identifying an editorial alteration |
| `entities`, `entity_names`, `securities`, `security_identifiers`, `security_list_intervals`, `security_supersessions`, `security_list_seed_ledger`, `entity_tickers`, and other registry tables | `(CUSIP withheld)` (`WITHHELD_TEXT`) |
| `inst_*`, `agg_*`, `_agg_*`, `serving_*` text in published institutional artifacts | `(CUSIP withheld)`; inline `inst_*` rows in Congress are cleared under W3 |
| Any new or otherwise unclassified published table | `[CUSIP withheld]` until an explicit table policy is reviewed; it still participates in automatic enumeration |

These markers apply to prose, not to constrained identity keys. Known structured
key columns keep their existing opaque-key semantics. Coverage reporting must
list the actual table/column inventory, marker or key operation, affected-row
count and any schema constraint that changes handling. A zero changed-row count
does not establish that a column was visited.

### NOT NULL, primary keys and references

Preflight constraints and all referencing columns before writes. Never set a
NOT NULL key to NULL, replace distinct keys with one constant marker, or use an
empty string as a substitute for a legal identity. `security_identifiers.value`
is TEXT NOT NULL and participates in the composite primary key
`(security_id, id_type, value, valid_from)`; `security_list_intervals.value`
is also a constrained key. Both must participate in coordinated rewriting.

Reuse the existing `withheld:<n>` identifier-value map and `sec:withheld:<n>`
security-ID map across every occurrence and reference. Preserve distinct rows
and joins, including foreign keys. A constrained text key containing embedded
source text needs a distinct opaque replacement and coordinated references,
rather than a colliding prose marker. Nullable fields may use NULL only where
their existing contract permits that and reference integrity is preserved.
Preflight any required change to a route key or structured enum; refuse a build
whose constraints cannot be preserved within the reviewed sanitization plan.

Plan replacements before applying them in a transaction. Keep PRIMARY KEY,
UNIQUE, NOT NULL, CHECK and foreign-key constraints valid, retain schema/views,
and check integrity and foreign keys afterward. Unexpected constraints stop
publication and roll back the pass. Keep existing source hashes/receipt identity
semantics outside A1-05/A1-07 unchanged; report their policy limitations instead
of inventing a hash-recovery fix in W2.

For a seeded artifact, preserve already opaque bindings and allocate new ordinals
above the highest existing ordinal, without lexical-number collisions. Derive
the true withheld closure from a CUSIP-bearing accepted source; opaque values
cannot reconstruct it. Keep the existing refusal when a replayed withheld
registry is supplied without such a source. After rewriting, erase freed-page
and index remnants with `secure_delete` plus `VACUUM` before byte hashes and
journaling.

## W3: remove inline institutional rows from the publication copy

After legacy derivation finishes and the original snapshot connection closes,
reuse `src/populus/publish/seed.py:clear_inline_inst_data` on the staged
Congress copy. It already discovers the literal `inst_` table prefix and deletes
children before parents from foreign-key dependencies. Clear rows, retain the
DDL/views, and verify every discovered inline table is empty. This prevents raw
holdings, identifiers and names from remaining live in the published file.

Apply the same publication-copy rule to stray inline rows when an external
snapshot is supplied; source selection must not become a withholding bypass.
Do not clear the internal Congress store or accepted institutional snapshot.
The already derived `inst_agg.db` and `inst_serving.db` keep their shared existing
redaction plan and opaque joins. Finish Congress secure deletion/compaction only
after the clearing and text sweep, then compute the final Congress digest.

## W4: exercise the real publication boundary

Add a pytest integration property using the existing real `stage_build`,
`finalize_build`, local Release backend and publication fixtures. It must cover
external institutional input and the supported legacy inline input branch.
Do not substitute a fake redaction function or directly call only the helper
under test. Do not run a full Astro build: use an existing minimal served-tree
fixture with a positive file count and served stats for real finalization.

The fixture must carry a real reviewed issuer/class → ticker association, a
matching SEC-list issuer and its closed withheld population. Plant withheld
canaries in every legally writable text surface of every published table,
including comment, asset name, raw JSON, member/filer names, identifier values
and raw metadata, list data, and legacy inline institutional rows. Inventory
schema-constrained fields that cannot legally hold a canary. Make seed counts,
all-column coverage and expected files nonempty assertions so absence of input
cannot pass the property. Include a same-block sibling and a shared-security-ID
closure edge, ordinary token casing/ISIN/known provisional-ID forms already in
the matcher scope, and an unpaired CUSIP-alone control outside the withheld set
that remains published. Preserve the reviewed ticker association after scrub.

Import the real functions from `scripts/cusip_join_probe.py`: reuse
`truth_pairs` with the internal fixture and its SEC list, `scan_path` for the
whole staging directory, and `scan` for decoded payloads. The scan population
must be the union of the held closure and the original CUSIP keys returned by
the real `plan_registry_redaction` on the unsanitized Congress fixture/seed,
using the captured filed and unverified sets. `truth_pairs` alone reads holdings
and uses the SEC list for its seeding gate; it does not enumerate an unheld,
newly listed sibling that the registry plan also withholds. Label those extra
members through the existing reviewed block association, keeping refused seeds'
non-propagation rule intact. Build the provisional-ID lookup over that union
using the same existing `provisional_security_id` routine as the script.

Assert every planted closed-population canary, the unheld list-only sibling and
the newly seeded sibling are in this scan population and are detected in the
unsanitized inputs before testing publication. Never copy the probe regexes,
invent another closure, or weaken `scan`/`scan_path` for tests. The union extends
the input population with the real producer's plan, not the matcher.

After staging and real finalization:

- Scan **every file beneath `.staging/<build_id>/`**, including `build/`,
  `assets/`, `stage-state.json` when present and raw `journal.json`. Scan file
  bytes, including SQLite freed pages/indexes; selecting visible rows is not
  equivalent. Also verify surviving table text using the coverage inventory.
- Validate/load the journal through existing journal functions. Scan decoded
  `journal['db']['b64']` (via `journal_db_bytes`) and every decoded artifact string
  in `journal['artifacts']`, including manifest and JSON. Raw base64 and escaped
  JSON alone can conceal a canary from a byte scanner.
- Assert zero probe pairs for the planted closed population, nonempty staged
  assets/slices/journal, valid schema/foreign keys, expected retained row counts,
  all inline tables empty and opaque aggregate/serving joins intact. Assert the
  unpaired CUSIP control survives; this is not a blanket zero-CUSIP policy.
- Verify manifest byte/logical digests, journal payload identity and the equality
  of canonical and served finalized stats. Scan the minimal served copy too.
  Publication/recovery must copy these sanitized sealed bytes without re-reading
  the original rows or restoring an earlier unredacted artifact.

Required causal negative controls, keeping this integration test intact:

1. Remove the actual `apply_registry_redaction` call from `stage_build`: the
   property goes RED on staged/payload bytes. Restore it and get GREEN.
2. Move the actual feed/member/ticker serialization back before the scrub:
   the property goes RED on at least the JSON slices and decoded journal
   artifacts. Restore the specified order and get GREEN.

Also exercise removal of inline clearing and regression to the two-column sweep
to prove W3/W2 coverage. Record failing paths/populations for each control and
restore exact source bytes. A helper mock that merely returns bad data is not
the required wiring proof. The probe has a bounded set of representations;
its zero result is evidence for this fixture/scope, not an arbitrary-encoding or
source-coordinate derivability proof.

## Build → published seed → build acceptance

Use the real local publication backend to finalize and publish build A, creating
the existing manifest, Release assets and pointer. Resolve its `congress.db`
with the production seed resolution and digest-verified placement path in
`publish/seed.py`; initialize views and apply the normal seeded working-copy
inline-clear behavior. Build B must call real stage/finalize again using this
seed, with a CUSIP-bearing accepted institutional snapshot when a replayed
withheld registry requires it. Never reconstruct CUSIPs from opaque ordinals.

Parameterize build A as legacy and external, then build B with accepted external
input. Include an ordinary valid Congress-only seed control where its registry
does not require a withheld-source replay. Include at least twelve retained
opaque values and a newly listed sibling after seeding to expose ordinal reuse
and lexical allocation mistakes. Check idempotent existing mappings, fresh
noncolliding ordinals, expected Congress rows/member joins and institutional
presence/disposition, working views, integrity/foreign keys and no unexpected
identity loss. Original corpus/snapshot whole-file hashes must stay unchanged.

Run the W4 raw and decoded-payload scans on both builds. Both must still build
successfully and withhold the same closed population plus the new sibling.
Revalidate all manifest/journal digests and source-alone controls. Include the
existing seeded-artifact/no-CUSIP-source refusal control; a refusal is preferable
to silently publishing a newly added class. This test extends the real seed
path, rather than replacing it with a hand-copied in-memory DB.

## Published surface inventory and sanitizing owner

| Surface, including copies | Sanitizing step / verification owner |
| --- | --- |
| Release `congress.db`, every Congress/registry/metadata table and view output | W2 all-table/text and coordinated-key pass on staged copy; secure deletion/compaction; W4 raw-byte and inventory scan |
| Inline `inst_*` tables in Release `congress.db` on legacy/external paths | W3 clear after derive, retain empty schema/views, then compaction and W4 scan |
| Release `inst_agg.db`, including compact `_agg_*` bases and exposed views | Existing shared `apply_cusip_redaction` after derive; W2 text coverage contract and W4 bytes/join checks |
| Release `inst_serving.db`, all detail/directional tables and text | Same shared plan after serving joins, before digests; W4 bytes/join checks |
| `congress/feed.json` | W1 serialize from sanitized snapshot; W4 raw/decoded journal scan |
| `congress/members/<bioguide>.json` | W1 sanitized snapshot, existing safe identity/routes; W4 scan |
| `congress/tickers/<ticker>.json` | W1 sanitized snapshot, existing safe ticker filenames/skip accounting; W4 scan |
| `congress/stats.json`, served `/stats.json`, source-derived names in stats | W1 sanitized stats construction retained in finalizer state, identical finalized copies; W4 scan |
| `inst_source.json`, module watermarks, coverage/disposition/budget metadata | Construct from sanitized publication metadata or apply the same text pass before seal; fixed counts/dates need no text mutation; W4 scan |
| `licenses.json`, `DATA-LICENSE.md`, `NOTICE` | Existing fixed register rendering; still included in W4 file/payload scan |
| Manifest, `stage-state.json`, artifact filenames/locators, build/Release IDs | Safe fixed/validated locators and sanitized metadata before seal; scan the sidecar even though it is not a public build artifact |
| `journal.json`, embedded Congress DB and all embedded small artifacts | Journal last from sanitized final bytes; W4 raw plus decoded scans; no second serializer from source |
| Data-repo `builds/<id>/`, latest pointer, Release copies and recovery materialization | Existing integrity-checked copy/materialization of sealed sanitized artifacts; scan recovered bytes too |
| Client snapshot caches/installed DB and JSON files | Existing digest-verified installation of sanitized publication bytes; no separate text producer |
| Dashboard columnar feed shards, member/ticker payload JSON, search index | Load only sanitized Congress/inst publication inputs; same-scope text sanitization for any additional source-derived metadata; scan emitted files |
| Dashboard Congress/institutional HTML, accessibility text, inline JSON/scripts, DOM attributes and note bodies | Render sanitized inputs; HTML escaping does not sanitize identifiers; scan emitted served tree and decoded embedded JSON where relevant |
| Signal artifact `signals.v1.json`, signal payloads/UI and replayed prior records | Produce from sanitized Congress inputs or use the same publication text pass before sealing; validate/sanitize source text in replayed records; fingerprint recovery stays A1-05 |
| Packaged site, served inventory, signature/attestation-associated artifact | Copy finalized sanitized served bytes; final stats byte equality and sealed inventory/hash verification; include generated text in scan |
| Congress MCP records/envelopes and institutional snapshot/QoQ/ticker/move/published-detail responses | Read sanitized installed databases through existing queries; trace source-derived response text without inventing an independent conflicting sanitizer |
| Federated live institutional MCP detail and fallback | **A1-04 deferred**: current raw SEC plane needs its own future design; W1–W4 make no compliance claim here |
| MCP operational errors/status/caveats | Fixed reviewed strings or sanitized publication metadata; no new concrete exception leak is claimed; live-source error handling belongs with its plane |
| Receipt/source URLs, list hashes/row ordinals and disclosure transaction fingerprints | Preserve current contracts in this phase; **A1-05/A1-07 deferred** derivability risks, scanned for direct planted text only |
| Published package/code reviewed issuer/class → ticker mapping | Mapping remains available by design; it supplies the association which makes closed-population CUSIP removal necessary; generated publication assets are scanned |

Completion of the future phase requires recorded per-table/column coverage,
both W4 mutation failures, both build/seed/build successes, exact gate output and
an explicit statement of deferred policy pathways. Do not publish an assertion
of complete non-derivability solely from the bounded byte probe.
