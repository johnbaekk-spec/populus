"""Withhold CUSIPs of reviewed-ticker securities from the published inst artifacts.

Refinement 20260910 C1 (owner decision 2026-09-11: HIDE CUSIP where a verified
ticker exists). The concern is a CUSIP->ticker pairing becoming DERIVABLE from
what Public Filings publishes, so hiding one cell is not enough: every published
key that is the CUSIP, or is computed from it, is withheld for those securities.

What counts as CUSIP-derived here:

* ``cusip`` itself and ``cusip:<cusip>`` position keys;
* ``cusip6:<block>`` issuer keys — the block is the CUSIP's first six characters;
* ``sid:sec:prov:<hex>`` — a provisional security id is
  ``sha256({"id_type": "cusip", "value": <cusip>})[:32]``
  (``identity.registry.provisional_security_id``), unsalted and therefore
  recomputable by anyone holding a CUSIP list. Every ``security_id`` of a
  withheld CUSIP is withheld too, provisional or not.

The withheld set is closed, not per-row: a reviewed (issuer name, class) row
that passes the SEC-list gate seeds the set; it then grows to every CUSIP in the
same CUSIP-6
block (a sibling's full CUSIP carries the block, and the block is joinable to the
ticker through the shared issuer key or the issuer name) and every CUSIP that
shares a ``security_id`` with a member (a CUSIP change inside one registry
class), until it stops growing.

A seed the SEC list assigns to a different issuer is withheld itself without
starting that walk. Its block's institutional issuer key is also made opaque
(owner decision 2026-10-04), so the misfiled name cannot expose the block through
that key. This issuer-key replacement does not withhold any other CUSIP or
security id in the block, and does not change the Congress registry's block
rule. Seeds absent from the list do not seed either replacement. Existing
walked-block ``iss:<n>`` ordinals stay unchanged; rejected blocks are appended
in sorted order through the same map shared by both institutional files.

The pipeline keeps using CUSIPs internally; only the two published databases are
rewritten, AFTER both are built (the serving projection joins the aggregate on
the original keys) and BEFORE their logical digests are taken. Every withheld
key is replaced by an opaque ordinal (``pos:<n>`` / ``iss:<n>``) through one
map shared by both files, so every join between them (``position_key``,
``issuer_key``) still holds. The ordinal carries nothing computable from the
CUSIP. Both files are rewritten with ``secure_delete`` and VACUUMed so no freed
page still holds a withheld value.
"""

from __future__ import annotations

import json
import re
import sqlite3
import tempfile
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from populus.identity.registry import anchor, provisional_security_id

from populus.ticker_mapping_13f import (
    TickerMapping,
    load_ticker_mapping,
    mapping_key,
    normalize_issuer_name,
)

__all__ = [
    "WITHHELD_ISSUER_PREFIX",
    "WITHHELD_POSITION_PREFIX",
    "RedactionPlan",
    "WithheldClosure",
    "DISCLOSURE_WITHHELD_TEXT",
    "apply_cusip_redaction",
    "close_withheld_cusips",
    "load_list_issuers",
    "plan_cusip_redaction",
    "scrub_disclosure_text",
]

WITHHELD_POSITION_PREFIX = "pos:"
WITHHELD_ISSUER_PREFIX = "iss:"

#: What replaces a withheld CUSIP that a FILER typed into a text field. Measured,
#: not hypothetical: one manager files its issuer names as CUSIPs
#: ("438516106", class "Stock"), and those rows share a position key with the
#: properly-named rows that carry the ticker — so the pair was still joinable
#: after the key columns were withheld. The marker keeps the row and says why
#: the cell is empty, rather than deleting a filer's reported row.
WITHHELD_TEXT = "(CUSIP withheld)"

#: What replaces a withheld CUSIP that a MEMBER OF CONGRESS typed into the text
#: of a periodic transaction report. Square brackets, not the parentheses of
#: :data:`WITHHELD_TEXT`: `transactions.comment` and `transactions.raw_row` are
#: a VERBATIM quotation of the filer's own document, and square brackets are the
#: editorial convention for an alteration the publisher made. The requirement
#: the marker exists to satisfy (owner decision 2026-09-13) is that the edit be
#: VISIBLE — a silent deletion would leave a fluent sentence that still reads as
#: the member's own words, and a reader could not tell the published text
#: differs from the filing. The receipt link on the row is untouched, so the
#: unaltered source document stays one click away.
DISCLOSURE_WITHHELD_TEXT = "[CUSIP withheld]"

#: Congressional disclosure columns swept for an embedded withheld CUSIP.
#: `comment` is the member's sentence; `raw_row` is the verbatim JSON the row
#: fingerprint was computed over, which carries that same sentence a second
#: time. Both are published in `congress.db`, so both are swept — a marker in
#: one and the CUSIP still in the other would withhold nothing.
_DISCLOSURE_TEXT_COLUMNS = (("transactions", "comment"), ("transactions", "raw_row"))

#: A CUSIP sitting inside a longer filer-written string. Managers describe
#: corporate actions in the issuer-name field — "EXXON MOBIL CORP COM EXCHANGED
#: FOR CUSIP 30233Q108", "HONEYWELL INTL INC R/S EFF 06/29/26 1 NEW CU 438516205
#: …" — and those rows share an opaque position key with the properly-named rows
#: that carry the ticker, so an embedded CUSIP is as joinable as the column was.
#: Token-bounded, matching the probe. CASE-INSENSITIVE (P-2, M3 review): filers
#: also write CUSIPs in lower case ("…USD 50 - 06738c778", "Palisade Bio In
#: Contra Spin From(81689b103)"), and since D4 (a) names are shown verbatim, so
#: a token is matched in any case and its UPPER-CASED form is what is checked
#: against the withheld set (CUSIPs are stored upper case).
_CUSIP_IN_TEXT_RE = re.compile(r"(?<![0-9A-Za-z])[0-9A-Za-z]{9}(?![0-9A-Za-z])")
#: An ISIN carries the CUSIP as its middle nine characters ("ISIN#BMG2004J1036").
_ISIN_RE = re.compile(r"(?<![0-9A-Za-z])([A-Za-z]{2})([0-9A-Za-z]{9})([0-9])(?![0-9A-Za-z])")

#: Column names rewritten wherever they appear in a published table.
_POSITION_COLUMN = "position_key"
_ISSUER_COLUMN = "issuer_key"
_CUSIP_COLUMN = "cusip"
_SECURITY_COLUMN = "security_id"

#: Handled by their own rules above; every OTHER column is checked for a
#: withheld CUSIP sitting in it as plain text.
_KEY_COLUMNS = frozenset({"cusip", "security_id", "position_key", "issuer_key"})

# These are identities/locators, not prose. A matched value requires an owner
# decision, even when SQLite would accept replacing it with a marker.
_PROTECTED_TEXT = frozenset({
    "ticker", "cik", "accession", "row_fingerprint", "filename", "url", "path",
    "route", "route_key", "source_hash", "list_sha256", "snapshot_sha256",
})
_REGISTRY_TABLES = frozenset({
    "entities", "entity_names", "securities", "security_identifiers",
    "security_list_intervals", "security_supersessions", "security_list_seed_ledger",
    "entity_tickers",
})
_LOCATOR_IN_TEXT_RE = re.compile(
    r"(?:[A-Za-z][A-Za-z0-9+.-]*://|www\.|(?:[A-Za-z]:)?[/\\]|\.\.?[/\\])[^\s<>\"']+"
    r"|[^\s/\\<>\"']+\.[A-Za-z]{1,10}(?=[\s<>\"')]|$)"
)
_PROVISIONAL_IN_TEXT_RE = re.compile(
    r"(?<![0-9a-f])(?:(?:sid:)?sec:prov:)?([0-9a-f]{32})(?![0-9a-f])"
)
# Keep the probe's separate case-specific boundaries: adjacent SQLite bytes
# can be uppercase beside a lowercase digest (or the reverse).
_PROVISIONAL_UPPER_IN_TEXT_RE = re.compile(
    r"(?<![0-9A-F])(?:(?:sid:)?sec:prov:)?([0-9A-F]{32})(?![0-9A-F])"
)
_BLOCK_IN_TEXT_RE = re.compile(r"cusip6:([0-9A-Za-z]{6})")


def _quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _protected_text(name: str) -> bool:
    return name in _PROTECTED_TEXT or name.endswith((
        "_id", "_key", "_url", "_path", "_filename", "_fingerprint", "_sha256",
    ))


def _replace_text(value: str, cusips: frozenset[str], marker: str, *,
                  hashes: frozenset[str] = frozenset(), blocks: frozenset[str] = frozenset()) -> str:
    def scrub(text: str) -> str:
        text = _CUSIP_IN_TEXT_RE.sub(
            lambda m: marker if m.group(0).upper() in cusips else m.group(0), text
        )
        text = _ISIN_RE.sub(
            lambda m: marker if m.group(2).upper() in cusips else m.group(0), text
        )
        for pattern in (_PROVISIONAL_IN_TEXT_RE, _PROVISIONAL_UPPER_IN_TEXT_RE):
            text = pattern.sub(
                lambda m: marker if m.group(1).lower() in hashes else m.group(0), text
            )
        return _BLOCK_IN_TEXT_RE.sub(
            lambda m: marker if m.group(1).upper() in blocks else m.group(0), text
        )
    for locator in _LOCATOR_IN_TEXT_RE.finditer(value):
        if scrub(locator.group()) != locator.group():
            raise ValueError("withholding would change a protected locator")
    return scrub(value)


def _semantic_json_identity(table: str, column: str, path: tuple[str, ...]) -> bool:
    # These source fields form cross-build resolver keys (members.py), while
    # extra note fields in the same objects remain source/prose text.
    if table != "members":
        return False
    names = {"first", "middle", "last", "nickname", "official_full"}
    terms = {"type", "start", "end", "state", "district", "party"}
    if column == "raw":
        return (
            len(path) == 2 and path[0] == "name" and path[1] in names
            or len(path) == 3 and path[:2] == ("other_names", "*")
            and path[2] in {"first", "middle", "last", "start", "end"}
            or len(path) == 3 and path[:2] == ("terms", "*") and path[2] in terms
        )
    return column == "terms" and len(path) == 2 and path[0] == "*" and path[1] in terms


def _replace_json(
    value: object, cusips: frozenset[str], marker: str, *, field: str = "",
    table: str = "", column: str = "", path: tuple[str, ...] = (), protected: bool = False,
    hashes: frozenset[str] = frozenset(), blocks: frozenset[str] = frozenset(),
) -> object:
    if isinstance(value, str):
        result = _replace_text(value, cusips, marker, hashes=hashes, blocks=blocks)
        if result != value and (protected or _protected_text(field) or _semantic_json_identity(table, column, path)):
            raise ValueError(f"withholding would change protected JSON field {field}")
        return result
    if isinstance(value, list):
        return [_replace_json(v, cusips, marker, field=field, table=table, column=column,
                              path=path + ("*",), protected=protected, hashes=hashes, blocks=blocks) for v in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            new_key = _replace_text(key, cusips, marker, hashes=hashes, blocks=blocks)
            if new_key != key and protected:
                raise ValueError("withholding would change protected JSON identity keys")
            if new_key in result:
                raise ValueError("withholding would collide JSON object keys")
            result[new_key] = _replace_json(
                item, cusips, marker, field=key, table=table, column=column,
                path=path + (key,), protected=protected or _protected_text(key)
                or _semantic_json_identity(table, column, path + (key,)),
                hashes=hashes, blocks=blocks,
            )
        return result
    return value


def _replace_cell(value: str, cusips: frozenset[str], marker: str, *,
                  table: str = "", column: str = "", json_contract: bool = False,
                  hashes: frozenset[str] = frozenset(), blocks: frozenset[str] = frozenset()) -> str:
    # JSON is decoded before matching: a string's Unicode escapes must not
    # evade the same matcher, and values/keys must remain valid JSON.
    duplicate_items = []

    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result = {}
        for key, item in pairs:
            if key in result:
                duplicate_items.extend((key, result[key], item))
            result[key] = item
        return result

    try:
        parsed = json.loads(value, object_pairs_hook=object_pairs)
    except (json.JSONDecodeError, TypeError):
        return _replace_text(value, cusips, marker, hashes=hashes, blocks=blocks)
    # An ordinary TEXT cell holding nine digits is prose, even though it can
    # also parse as a JSON number. Explicit JSON scalars retain their types.
    if not json_contract and not isinstance(parsed, (dict, list, str)):
        return _replace_text(value, cusips, marker, hashes=hashes, blocks=blocks)
    replaced = _replace_json(parsed, cusips, marker, table=table, column=column, hashes=hashes, blocks=blocks)
    if duplicate_items and (
        replaced != parsed or _replace_json(duplicate_items, cusips, marker, hashes=hashes, blocks=blocks) != duplicate_items
    ):
        raise ValueError("withholding cannot preserve duplicate JSON object keys")
    return value if replaced == parsed else json.dumps(replaced, ensure_ascii=False)


def _column_inventory(conn: sqlite3.Connection) -> list[dict[str, object]]:
    """Every real column, including generated and dynamically typed values."""
    result = []
    for table, ddl in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table'"
        " AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall():
        unique = []
        for index in conn.execute(f"PRAGMA index_list({_quoted(table)})").fetchall():  # nosec B608
            if index[2]:
                unique.append({
                    "name": index[1],
                    "columns": [r[2] for r in conn.execute(
                        f"PRAGMA index_info({_quoted(index[1])})"  # nosec B608
                    )],
                })
        fks = conn.execute(f"PRAGMA foreign_key_list({_quoted(table)})").fetchall()  # nosec B608
        references = []
        for fk in fks:
            parent_column = fk[4]
            if parent_column is None:
                parent_keys = sorted(
                    (r[5], r[1]) for r in conn.execute(
                        f"PRAGMA table_xinfo({_quoted(fk[2])})"  # nosec B608
                    ) if r[5]
                )
                if fk[1] < len(parent_keys):
                    parent_column = parent_keys[fk[1]][1]
            references.append((fk[3], {"table": fk[2], "column": parent_column}))
        infos = conn.execute(f"PRAGMA table_xinfo({_quoted(table)})").fetchall()  # nosec B608
        expressions = ", ".join(
            f"COALESCE(SUM(typeof({_quoted(r[1])})='text'),0)" for r in infos
        )
        stored_counts = conn.execute(
            f"SELECT {expressions} FROM {_quoted(table)}"  # nosec B608
        ).fetchone()
        for row, stored in zip(infos, stored_counts):
            column = row[1]
            result.append({
                "kind": "column", "visited": False,
                "table": table, "column": column, "declared_type": row[2],
                "not_null": bool(row[3]), "primary_key_position": row[5],
                "generated": bool(row[6]), "stored_text_rows": stored,
                "unique_indexes": [u for u in unique if column in u["columns"]],
                "foreign_keys": [
                    parent for child, parent in references if child == column
                ],
                "constraints_sql": ddl, "affected_rows": 0,
                "operation": "text sweep",
            })
    return result


def _apply_text_plan(
    conn: sqlite3.Connection,
    cusips: frozenset[str],
    key_maps: dict[tuple[str, str], dict[str, str | None]],
    *,
    institutional: bool = False,
    inventory: list[dict[str, object]] | None = None,
    blocks: frozenset[str] = frozenset(),
) -> dict[str, int]:
    """Plan first; prove constraints on a scratch copy before artifact writes."""
    columns = _column_inventory(conn)
    hashes = frozenset(provisional_security_id(anchor("cusip", c)).removeprefix("sec:prov:") for c in cusips)
    for item in columns:
        table, column = str(item["table"]), str(item["column"])
        if ("*", column) in key_maps:
            key_maps[table, column] = key_maps["*", column]
    # A declared FK follows the same authorized canonical map even if the
    # referencing column has another name. No independent ordinal is invented.
    while True:
        changed = False
        for item in columns:
            key = (str(item["table"]), str(item["column"]))
            for fk in item["foreign_keys"]:
                parent = (fk["table"], fk["column"])
                if parent in key_maps and key not in key_maps:
                    key_maps[key] = key_maps[parent]
                    changed = True
        if not changed:
            break
    for name, ddl in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL"
    ).fetchall():
        if _replace_text(ddl, cusips, WITHHELD_TEXT, hashes=hashes, blocks=blocks) != ddl:
            raise ValueError(f"withholding requires a schema/DDL change: {name}")

    schema_inventory = [
        {"kind": "schema", "object_type": kind, "object_name": name,
         "table": table, "column": None, "constraints_sql": ddl,
         "visited": True, "affected_rows": 0, "operation": "DDL constant scan"}
        for kind, name, table, ddl in conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name"
        )
    ]
    updates = []
    counts: dict[str, int] = {}
    for item in columns:
        table, column = str(item["table"]), str(item["column"])
        q_table, q_column = _quoted(table), _quoted(column)
        marker = WITHHELD_TEXT if table in _REGISTRY_TABLES or table.startswith(
            ("inst_", "agg_", "_agg_", "serving_")
        ) else DISCLOSURE_WITHHELD_TEXT
        item["marker"] = marker
        mapping = key_maps.get((table, column), {})
        if mapping:
            item["operation"] = "identifier-value map" if column == "value" else "canonical key map"
        constrained = bool(item["primary_key_position"] or item["unique_indexes"] or item["foreign_keys"])
        semantic = table == "entity_names" and column == "name"
        item["protected_contract"] = (
            "cross-build entity name interval identity" if semantic else
            "member resolver name/other_names/term identity fields; extra notes remain prose"
            if table == "members" and column in {"raw", "terms"} else
            "member alias resolution/cross-build identity" if table == "member_aliases" and column == "alias" else
            "PK/UNIQUE/FK or structured identity/locator" if constrained or _protected_text(column) else ""
        )
        for value, rows in conn.execute(
            f"SELECT {q_column}, COUNT(*) FROM {q_table}"  # nosec B608
            f" WHERE typeof({q_column})='text' GROUP BY {q_column} COLLATE BINARY"
        ).fetchall():
            if value in mapping:
                replaced = mapping[value]
            else:
                replaced = _replace_cell(value, cusips, marker, table=table, column=column,
                                         json_contract=str(item["declared_type"]).upper() == "JSON",
                                         hashes=hashes, blocks=blocks)
                if replaced != value and (_protected_text(column) or constrained or semantic):
                    raise ValueError(f"withholding would change protected identifier {table}.{column}")
            if replaced != value:
                if item["generated"]:
                    raise ValueError(f"withholding requires generated-column change: {table}.{column}")
                updates.append((table, column, value, replaced, rows))
                item["affected_rows"] += rows
                if institutional and value.upper() in cusips and value not in mapping:
                    exact = f"{table}.{column}.cusip_text"
                    counts[exact] = counts.get(exact, 0) + rows
        counts[f"{table}.{column}"] = item["affected_rows"]
        item["visited"] = True

    def apply(target: sqlite3.Connection) -> None:
        target.execute("PRAGMA foreign_keys = ON")
        target.execute("BEGIN")
        target.execute("PRAGMA defer_foreign_keys = ON")
        try:
            # One table scan per column, not one scan per distinct old value.
            # The registry and serving artifacts can contain millions of rows.
            grouped: dict[tuple[str, str], list[tuple[str, str | None, int]]] = defaultdict(list)
            for table, column, old, new, expected in updates:
                grouped[table, column].append((old, new, expected))
            target.execute("CREATE TEMP TABLE _w_updates (old TEXT PRIMARY KEY, new)")
            for (table, column), changes in grouped.items():
                target.executemany("INSERT INTO _w_updates VALUES (?,?)", ((old, new) for old, new, _n in changes))
                actual = target.execute(
                    f"UPDATE {_quoted(table)} AS _w_target SET {_quoted(column)} ="  # nosec B608
                    f" (SELECT new FROM _w_updates WHERE old = _w_target.{_quoted(column)} COLLATE BINARY)"
                    f" WHERE typeof({_quoted(column)})='text'"
                    f" AND {_quoted(column)} COLLATE BINARY IN (SELECT old FROM _w_updates)"
                ).rowcount
                if actual != sum(n for _old, _new, n in changes):
                    raise ValueError(f"withholding source changed during planning: {table}.{column}")
                target.execute("DELETE FROM temp._w_updates")
            target.execute("DROP TABLE temp._w_updates")
            integrity = target.execute("PRAGMA integrity_check").fetchall()
            foreign = target.execute("PRAGMA foreign_key_check").fetchall()
            if integrity != [("ok",)] or foreign:
                raise ValueError(f"withholding constraint preflight failed: integrity={integrity}, foreign_keys={foreign}")
            target.execute("COMMIT")
        except BaseException:
            target.execute("ROLLBACK")
            raise

    with tempfile.TemporaryDirectory(prefix="populus-redaction-preflight-") as scratch:
        trial = sqlite3.connect(str(Path(scratch) / "preflight.db"), isolation_level=None)
        try:
            conn.backup(trial)
            try:
                apply(trial)
            except sqlite3.Error as exc:
                raise ValueError(f"withholding constraint preflight failed: {exc}") from exc
        finally:
            trial.close()
    conn.execute("PRAGMA secure_delete = ON")
    apply(conn)
    if updates:
        conn.execute("VACUUM")
    if inventory is not None:
        inventory.extend(columns)
        inventory.extend(schema_inventory)
    return counts


@dataclass(frozen=True)
class RedactionPlan:
    """The withheld set and the opaque replacement keys (shared by both files)."""

    mapped_cusips: frozenset[str]
    cusips: frozenset[str]
    security_ids: frozenset[str]
    blocks: frozenset[str]
    position_keys: dict[str, str]
    issuer_keys: dict[str, str]
    #: Seeds the SEC-list issuer check refused to propagate. They ARE withheld
    #: (they are in ``cusips``); they must never seed CUSIP or security-id expansion.
    unverified: frozenset[str] = frozenset()
    #: ``(cusip, filed issuer name, class)`` for each of the above, so the build
    #: record can name the mis-filed row instead of dropping it silently.
    rejected_seeds: tuple[tuple[str, str, str | None], ...] = ()
    #: Seeds the SEC 13(f) list does not carry at all. Unlike the above these
    #: are NOT in ``cusips`` (unless the walk reached them anyway): a CUSIP that
    #: is not a 13(f) security cannot be the matched issuer's.
    absent_seeds: tuple[tuple[str, str, str | None], ...] = ()

    def summary(self) -> dict[str, int]:
        return {
            "mapped_cusips": len(self.mapped_cusips),
            "withheld_cusips": len(self.cusips),
            "withheld_security_ids": len(self.security_ids),
            "withheld_cusip6_blocks": len(self.blocks),
            "opaque_position_keys": len(self.position_keys),
            "opaque_issuer_keys": len(self.issuer_keys),
            "unverified_seeds": len(self.unverified),
            "list_absent_seeds": len(self.absent_seeds),
        }


@dataclass(frozen=True)
class WithheldClosure:
    """The closed withheld set, plus the ticker each member is joinable to.

    ONE implementation of the closure, because there were two and they did not
    agree. `scripts/cusip_join_probe.py` re-derived "what to look for" with a
    single hop — a mapped CUSIP and its CUSIP-6 siblings — while the producer
    closes over the shared-``security_id`` edge as well. A CUSIP reachable only
    through a security-id edge (and the further block that CUSIP then carries)
    was therefore outside the probe's truth set: the producer withheld it, but
    had it LEAKED the probe would have reported zero pairs and the release's
    "0 published pairs" measurement would have been vacuous for that population.
    A verifier that cannot see part of what it verifies is not a verifier, so
    both callers now close over the same edges here.

    ``tickers`` labels every member with the ticker(s) it is joinable to, found
    by walking the same edges out from the mapped rows; a member reached only
    through a security-id edge inherits the label of the row that reached it.

    ``unverified`` are the seeds the SEC-list issuer check refused to propagate
    because the list names a DIFFERENT issuer; they are still members of
    ``cusips``. ``rejected_seeds`` records each one as ``(cusip, filed issuer
    name, class)`` so a caller can name the filing rather than filter it
    silently.

    ``absent_seeds`` are the seeds the list does not carry AT ALL, recorded the
    same way. They are NOT members of ``cusips`` unless the walk independently
    reached them — see :func:`close_withheld_cusips`.
    """

    mapped: frozenset[str]
    cusips: frozenset[str]
    security_ids: frozenset[str]
    blocks: frozenset[str]
    tickers: dict[str, frozenset[str]]
    unverified: frozenset[str] = frozenset()
    rejected_seeds: tuple[tuple[str, str, str | None], ...] = ()
    absent_seeds: tuple[tuple[str, str, str | None], ...] = ()


#: An issuer-name token short enough to be noise ("CO", "SA", "NV", a stray
#: initial) is not evidence either way, so agreement is decided on tokens of at
#: least this length.
_ISSUER_TOKEN_MIN = 3
#: A token may also agree as a PREFIX of the other ("ELEC"/"ELECTRIC",
#: "BUS"/"BUSINESS"), which is how the SEC list abbreviates. Four characters,
#: so "CORP"/"CORPORATION" agrees while a two-letter coincidence cannot.
_ISSUER_PREFIX_MIN = 4


def _issuer_tokens(name: str) -> list[str]:
    return [t for t in normalize_issuer_name(name).split() if len(t) >= _ISSUER_TOKEN_MIN]


def _issuer_names_agree(filed: str, listed: str) -> bool:
    """Do a FILED issuer name and the SEC list's own name describe one issuer?

    NOT string equality, and measuring is why. On the 20260817.1 corpus, exact
    equality after :func:`normalize_issuer_name` separated 493 seed CUSIPs from
    their list rows, and the overwhelming majority were the same issuer spelled
    differently — "Abbott Laboratories - US" against "ABBOTT LABORATORIES",
    "AMERICAN ELECTRIC POWER" against "AMERICAN ELEC PWR". Treating those as
    disagreements would have stopped withholding hundreds of securities that
    genuinely resolve to a reviewed ticker, which is the property inverted.

    So agreement is ONE shared significant token, exact or as a prefix. That is
    deliberately generous: a false AGREEMENT only preserves today's behaviour,
    while a false disagreement costs withholding. It still separates the case
    this exists for — "NORTHERN OIL & GAS INC" against "UNITED STATES TREAS
    NTS" shares nothing — and on the same corpus it cut the 493 to 156, of
    which every one inspected was a filer writing another issuer's CUSIP.
    """
    filed_tokens, listed_tokens = _issuer_tokens(filed), _issuer_tokens(listed)
    if not filed_tokens or not listed_tokens:
        # No significant token on one side is an absence of evidence, not
        # evidence of conflict; fail toward withholding.
        return True
    return any(
        a == b
        or (len(a) >= _ISSUER_PREFIX_MIN and b.startswith(a))
        or (len(b) >= _ISSUER_PREFIX_MIN and a.startswith(b))
        for a in filed_tokens
        for b in listed_tokens
    )


def close_withheld_cusips(
    rows: Iterable[tuple[str | None, str | None, str, str | None]],
    mapping: TickerMapping | None = None,
    list_issuers: Mapping[str, Collection[str]] | None = None,
) -> WithheldClosure:
    """Close the withheld set over ``(issuer_name, class, cusip, security_id)`` rows.

    Two edges, applied to a fixpoint: a CUSIP-6 block (a sibling's full CUSIP
    carries the block, and the block joins to the ticker through the shared
    issuer key or the issuer name) and a shared ``security_id`` (a CUSIP change
    inside one registry class). The seed for both is a row whose (issuer name,
    class) is in the reviewed mapping.

    A SEED MUST AGREE WITH THE SEC LIST BEFORE IT MAY SPREAD. ``list_issuers``
    maps a CUSIP to the issuer name(s) the SEC Official 13F List gives it
    (:func:`load_list_issuers`). Filers mistype CUSIPs, and a mistyped one that
    happens to match a reviewed (issuer name, class) used to seed the closure
    like any other — so a single row reporting a Treasury CUSIP under a company
    name pulled that Treasury's ENTIRE CUSIP-6 block into the withheld set, and
    labelled 637 government bonds with an equity ticker they have nothing to do
    with. Two measured rows did exactly that: ``NORTHERN OIL & GAS INC``
    (91282CGE5) and ``KIMBERLY CLARK CORP`` (91282CHH7).

    TWO REFUSALS, WITH DIFFERENT REACH, because the evidence differs.

    (1) THE LIST NAMES A DIFFERENT ISSUER. Propagation only is gated, not
    membership, and the distinction is the whole point. A seed whose CUSIP the
    list assigns to a plainly different issuer is still withheld ITSELF — it costs one opaque ordinal and cannot
    weaken anything — but it contributes no block and no security-id edge, so
    it cannot drag in securities that are not its own. Gating membership
    instead would un-withhold real securities whenever the list and the filer
    disagree for an innocent reason: on the 20260817.1 corpus two of the
    refused seeds are the TransForce/TFI International rename, filed 286 times,
    whose CUSIP genuinely does resolve to a reviewed ticker.

    The institutional planner also gives each rejected seed's block an opaque
    issuer key, without adding its other CUSIPs or security ids to the set.
    ``blocks`` remains the walk's blocks: the Congress registry's block rule
    and the refusal to propagate a rejected seed stay unchanged.

    (2) THE LIST DOES NOT CARRY THE CUSIP AT ALL. Here membership is narrowed
    too. The SEC Official 13(f) List names every 13(f) security, so a CUSIP with
    no row on it cannot BE the matched issuer's 13(f) security — the match is
    the filer's error, with no innocent reading available. Such a seed
    propagates nothing and is not withheld itself.

    Measured on the published ``data-20260914.1``: no CUSIP in the ``91282C``
    Treasury block has a list row (Treasuries are not 13(f) securities), yet one
    row filing 91282CHH7 under ``KIMBERLY CLARK CORP`` put the whole block in
    the withheld set, where `scripts/cusip_join_probe.py` then counted 18 of
    them as ``KMB`` pairs recovered from congressional disclosures naming
    Treasury bonds. The pairs are false — a Treasury has no ticker, and the
    ``KMB`` association exists only inside this bookkeeping. The real cost is
    the mirror image: a Treasury CUSIP written into a disclosure ``comment``
    would be replaced with ``[CUSIP withheld]``, degrading a verbatim public
    record to protect nothing.

    The rule is ABSENCE FROM THE LIST, not Treasuries and not the ``91282C``
    prefix; nothing here knows what a Treasury is. It cannot cost a real
    withholding, because a security that genuinely resolves to a reviewed
    ticker is a 13(f) security and so is on the list by construction.

    ``list_issuers`` is optional only because a caller may have no list to read.
    Passing ``None`` — or an EMPTY mapping, which is what
    :func:`load_list_issuers` returns for a database with no
    ``security_list_intervals`` table — restores the un-gated seeding this
    exists to fix, so every in-tree caller passes a real one.
    """
    by_key = (mapping or load_ticker_mapping()).by_key()
    cusip_sids: dict[str, set[str]] = defaultdict(set)
    sid_cusips: dict[str, set[str]] = defaultdict(set)
    block_cusips: dict[str, set[str]] = defaultdict(set)
    mapped: set[str] = set()
    verified: set[str] = set()
    rejected: dict[str, tuple[str, str | None]] = {}
    absent: dict[str, tuple[str, str | None]] = {}
    labels: dict[str, set[str]] = defaultdict(set)
    # AN EMPTY MAPPING IS "NO LIST TO CONSULT", NEVER "EVERY CUSIP IS ABSENT".
    # `load_list_issuers` returns {} for a database with no
    # `security_list_intervals` table — an ordinary state of a fixture or a
    # partially seeded corpus — and reading that as universal absence would
    # refuse EVERY seed and withhold nothing at all: the property inverted
    # wholesale, and silently, because an empty withheld set looks like a clean
    # run. Both no-list forms therefore fall back to the un-gated seeding.
    consultable = bool(list_issuers)
    for name, klass, cusip, security_id in rows:
        if cusip is None:
            continue
        block_cusips[cusip[:6]].add(cusip)
        if security_id is not None:
            cusip_sids[cusip].add(security_id)
            sid_cusips[security_id].add(cusip)
        if name is not None and mapping_key(name, klass) in by_key:
            mapped.add(cusip)
            labels[cusip].add(by_key[mapping_key(name, klass)].ticker)
            listed = list_issuers.get(cusip) if consultable else None
            if consultable and not listed:
                # NO ROW ON THE SEC OFFICIAL 13(F) LIST. The list names every
                # 13(f) security, so this CUSIP is not the matched issuer's —
                # it propagates nothing AND is not withheld on its own account.
                absent[cusip] = (name, klass)
            elif listed and not any(_issuer_names_agree(name, l) for l in listed):
                # On the list, under a plainly different issuer. Refused
                # propagation, still withheld itself.
                rejected[cusip] = (name, klass)
            else:
                verified.add(cusip)

    # Only the VERIFIED seeds start the walk.
    withheld: set[str] = set()
    frontier = set(verified)
    while frontier:
        withheld |= frontier
        grown: set[str] = set()
        for cusip in frontier:
            reached = set(block_cusips.get(cusip[:6], ()))
            for sid in cusip_sids.get(cusip, ()):
                reached |= sid_cusips.get(sid, set())
            # The label travels the edge it was reached by, so a member with no
            # mapping row of its own still names the ticker it is joinable to.
            for other in reached:
                labels[other] |= labels[cusip]
            grown |= reached
        frontier = grown - withheld
    # The BLOCKS are the walk's, taken before the refused seeds join the set.
    # Rejected seeds must not expand the CUSIP/security-id closure or the
    # Congress registry's blocks. The institutional planner separately makes
    # their issuer keys opaque without adding that block's other securities.
    walked = frozenset(withheld)
    # A DISAGREEING seed is withheld, but only AFTER the walk, so it never acts
    # as a starting point. Adding it before would also have kept anything the
    # walk legitimately reached from re-entering the frontier.
    #
    # An ABSENT seed is not added at all — the one place membership, and not
    # just propagation, is narrowed. It is still withheld if the walk genuinely
    # REACHED it, which is the honest case: a verified sibling in its own block
    # puts it there on the block's evidence rather than on a typo's.
    withheld |= mapped - absent.keys()

    return WithheldClosure(
        mapped=frozenset(mapped),
        cusips=frozenset(withheld),
        security_ids=frozenset(sid for c in withheld for sid in cusip_sids.get(c, ())),
        blocks=frozenset(c[:6] for c in walked),
        tickers={c: frozenset(labels.get(c, ())) for c in withheld},
        unverified=frozenset(rejected),
        rejected_seeds=tuple(
            (cusip, name, klass) for cusip, (name, klass) in sorted(rejected.items())
        ),
        absent_seeds=tuple(
            (cusip, name, klass) for cusip, (name, klass) in sorted(absent.items())
        ),
    )



def load_list_issuers(conn: sqlite3.Connection) -> dict[str, frozenset[str]]:
    """``cusip -> the SEC Official 13F List's own issuer name(s)`` for that CUSIP.

    Read from ``security_list_intervals``, which the same database already
    carries — this adds no new source. A CUSIP can hold several rows (one per
    quarter interval) and the printed name drifts, so every distinct spelling is
    kept and :func:`close_withheld_cusips` accepts a seed that agrees with ANY
    of them.

    Rows ALREADY withheld by a previous release are skipped: their ``value`` is
    ``withheld:<n>`` rather than a CUSIP, so they answer for no CUSIP at all,
    and their first six characters ("withhe") are not an issuer block. Returns
    an empty mapping when the table is absent, which is an ordinary state of a
    fixture or a partially seeded corpus.
    """
    try:
        rows = conn.execute(
            "SELECT value, issuer_name FROM security_list_intervals"
            " WHERE id_type = 'cusip' AND issuer_name IS NOT NULL"
        ).fetchall()
    except sqlite3.Error:
        return {}
    names: dict[str, set[str]] = defaultdict(set)
    for value, issuer_name in rows:
        if isinstance(value, str) and not value.startswith(WITHHELD_LIST_VALUE_PREFIX):
            names[value].add(issuer_name)
    return {cusip: frozenset(v) for cusip, v in names.items()}


def plan_cusip_redaction(
    source: sqlite3.Connection, mapping: TickerMapping | None = None
) -> RedactionPlan:
    """Compute the closed withheld set from the SOURCE holdings.

    Reads ``main.inst_holdings`` (every period — the aggregate's deltas reach
    further back than the serving projection). One grouped pass; the mapping is
    applied in Python because its key normalization lives there.
    """
    closure = close_withheld_cusips(
        source.execute(
            "SELECT issuer_name_raw, title_of_class, cusip, security_id"
            " FROM main.inst_holdings WHERE cusip IS NOT NULL"
            " GROUP BY issuer_name_raw, title_of_class, cusip, security_id"
        ).fetchall(),
        mapping,
        # The SEC list lives in this same database, so the seeding gate reads it
        # inside the caller's single read transaction like every other source
        # read. `.fetchall()` above because the cursor cannot stay open across
        # the second query on the same connection.
        load_list_issuers(source),
    )
    mapped, withheld = closure.mapped, closure.cusips
    sids, blocks = closure.security_ids, closure.blocks
    # Deterministic ordinals over the ORIGINAL key text. The ordinal reveals no
    # CUSIP: recovering one would need the withheld keys, which are not published.
    originals = sorted({f"sid:{s}" for s in sids} | {f"cusip:{c}" for c in withheld})
    position_keys = {
        key: f"{WITHHELD_POSITION_PREFIX}{n}" for n, key in enumerate(originals, start=1)
    }
    issuer_keys = {
        f"cusip6:{b}": f"{WITHHELD_ISSUER_PREFIX}{n}"
        for n, b in enumerate(sorted(blocks), start=1)
    }
    # Append rejected blocks so already published walked-block ordinals hold.
    rejected_blocks = {c[:6] for c in closure.unverified} - blocks
    issuer_keys.update({
        f"cusip6:{block}": f"{WITHHELD_ISSUER_PREFIX}{ordinal}"
        for ordinal, block in enumerate(sorted(rejected_blocks), start=len(issuer_keys) + 1)
    })
    return RedactionPlan(
        mapped_cusips=frozenset(mapped),
        cusips=frozenset(withheld),
        security_ids=frozenset(sids),
        blocks=frozenset(blocks),
        position_keys=position_keys,
        issuer_keys=issuer_keys,
        unverified=closure.unverified,
        rejected_seeds=closure.rejected_seeds,
        absent_seeds=closure.absent_seeds,
    )


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f'PRAGMA main.table_info("{table}")')}  # nosec B608


def _scrub_embedded(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    cusips: frozenset[str],
    marker: str = WITHHELD_TEXT,
) -> int:
    """Replace withheld CUSIPs that sit INSIDE a longer value, keeping the rest
    of the filer's text. Returns the number of rows changed.

    Keyed on the VALUE, over DISTINCT values, not on rowid: `_agg_qoq_deltas` is
    WITHOUT ROWID (there is no rowid to select), and one issuer name repeats
    across millions of rows, so the distinct set is a few thousand strings. The
    same old value always maps to the same replacement, so this is idempotent.
    """
    values = [
        row[0]
        for row in conn.execute(
            f'SELECT DISTINCT "{column}" FROM "{table}"'  # nosec B608
            f' WHERE "{column}" IS NOT NULL AND length("{column}") >= 9'
        )
        if isinstance(row[0], str)
    ]
    updates: list[tuple[str, str]] = []
    for value in values:
        replaced = _CUSIP_IN_TEXT_RE.sub(
            lambda m: marker if m.group(0).upper() in cusips else m.group(0), value
        )
        replaced = _ISIN_RE.sub(
            lambda m: marker if m.group(2).upper() in cusips else m.group(0), replaced
        )
        if replaced != value:
            updates.append((replaced, value))
    changed = 0
    for replaced, value in updates:
        changed += conn.execute(
            f'UPDATE "{table}" SET "{column}" = ? WHERE "{column}" = ?',  # nosec B608
            (replaced, value),
        ).rowcount
    return changed


def apply_cusip_redaction(
    plan: RedactionPlan, db_path: Path | str, *,
    inventory: list[dict[str, object]] | None = None,
) -> dict[str, int]:
    """Apply the shared canonical plan and every real stored-text column."""
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        keys: dict[tuple[str, str], dict[str, str | None]] = {
            ("*", "cusip"): dict.fromkeys(plan.cusips),
            ("*", "security_id"): dict.fromkeys(plan.security_ids),
            ("*", "position_key"): plan.position_keys,
            ("*", "issuer_key"): plan.issuer_keys,
        }
        return _apply_text_plan(
            conn, plan.cusips, keys, institutional=True, inventory=inventory, blocks=plan.blocks,
        )
    finally:
        conn.close()


# --- the published congress.db's SEC 13F list --------------------------------
#
# C1 addendum (coordinator instruction 2026-09-11). `security_list_intervals` is
# the SEC Official 13F List as published inside `congress.db` (DB_ARTIFACT). The
# list gives CUSIP + issuer name + class; Public Filings separately publishes a
# reviewed (issuer name, class) -> ticker mapping, so the PAIRING is derivable
# even though publishing CUSIPs alone is pre-existing and accepted.
#
# Measured on the 20260817.1 artifact: the pairing needs OUR mapping —
# `securities.entity_id` is NULL for all 22,521 rows, so the congress.db-alone
# join through `entity_tickers` yields zero pairs.
#
# Option (a) — "publish the list only in the path that seeds the next build" —
# is NOT available: the release artifact IS that path. `populus seed-corpus`
# restores the next run's corpus from the previous release's `congress.db`
# (publish/seed.py, and .github/workflows/publish.yml "Seed the corpus from the
# previous release (R42)"), so a table withheld from the artifact is a table the
# next build starts without. Option (b) is therefore what runs here: the rows
# stay, with the CUSIP and every CUSIP-derived value withheld.
#
# `value` is NOT NULL and half of PRIMARY KEY (value, valid_from) (registry.sql),
# so a withheld CUSIP cannot be nulled — it is replaced by ONE opaque token per
# distinct CUSIP, which keeps the key unique. `raw` and `source_row` are
# nullable and echo the CUSIP verbatim, so their text/JSON is visibly scrubbed.
# `security_id` is
# the unsalted `sec:prov:` hash of the CUSIP, so it is replaced everywhere it
# appears, `securities` included, keeping the FK intact.

WITHHELD_LIST_VALUE_PREFIX = "withheld:"
WITHHELD_SECURITY_ID_PREFIX = "sec:withheld:"

#: Tables whose `security_id` must follow the replacement, so the published
#: copy stays referentially consistent.
_SECURITY_ID_TABLES = (
    "securities",
    "security_list_intervals",
    "security_identifiers",
    "security_supersessions",
)


def scrub_disclosure_text(
    conn: sqlite3.Connection, cusips: Collection[str]
) -> dict[str, int]:
    """Replace withheld CUSIPs that a FILER wrote into congressional disclosure
    text, keeping every other word. Returns rows changed per ``table.column``.

    Owner decision 2026-09-13, closing the one residual the C1 join probe named
    at release: three CUSIPs in five rows of `transactions.comment` and its
    verbatim `raw_row` copy, where the member wrote BOTH identifiers in one
    sentence — "…cusip 26875P101, ticker EOG, at a price of $125.6342/share."
    That pairing is the filer's own, not a key Public Filings derived, which is
    why it survived the key-column pass: nothing about it is a CUSIP column.

    Three properties this deliberately has:

    * It runs at PUBLISH time, on the staged copy, in the same pass as the SEC
      13F list withholding. The build's own store — and therefore the internal
      corpus and every re-derivation from it — keeps the member's original
      words. Doing this in ingest would destroy the filing's text permanently.
    * The edit is VISIBLE. The marker is
      :data:`DISCLOSURE_WITHHELD_TEXT`, not a deletion, so the published
      sentence cannot be mistaken for the member's unaltered wording.
    * Matching is by exact membership in `cusips`, never by CUSIP-6 prefix.
      The caller decides the population (`apply_registry_redaction` passes the
      block-closed set, which is what the SEC list pass withholds); this
      function replaces a token only when the whole nine characters are in that
      set, which is precisely what `scripts/cusip_join_probe.py` looks for.
      Matching on a six-character prefix here would also hit nine-character
      words in free prose, and disclosure text is prose.

    The row's `row_fingerprint`/`txn_id` still describe the ORIGINAL `raw_row`,
    so the published `raw_row` no longer recomputes to them. That is intended
    and is the visible edit's cost: identity stays stable across publishes
    (recomputing it would renumber every affected transaction), and the
    unaltered document remains reachable through the row's receipt link.
    """
    withheld = frozenset(cusips)
    counts: dict[str, int] = {}
    if not withheld:
        return counts
    existing = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    for table, column in _DISCLOSURE_TEXT_COLUMNS:
        if table not in existing or column not in _columns(conn, table):
            continue
        counts[f"{table}.{column}"] = _scrub_embedded(
            conn, table, column, withheld, marker=DISCLOSURE_WITHHELD_TEXT
        )
    return counts


def _next_withheld_ordinal(
    prior: Collection[tuple[str, str | None, str | None, str | None]],
) -> int:
    """One past the highest ordinal already withheld in this table.

    An unparseable suffix contributes nothing rather than raising: the ordinal
    only has to be FREE, and a value this function did not write is not an
    ordinal it must respect. Returns 1 when nothing was withheld before, so a
    first-ever pass numbers from 1 exactly as it always did.
    """
    highest = 0
    for value, *_rest in prior:
        suffix = value[len(WITHHELD_LIST_VALUE_PREFIX) :]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return highest + 1


def _registry_next_ordinal(
    conn: sqlite3.Connection,
    prior: Collection[tuple[str, str | None, str | None, str | None]],
) -> int:
    occupied = list(prior)
    for item in _column_inventory(conn):
        table, column = str(item["table"]), str(item["column"])
        if column in {"security_id", "old_security_id"}:
            prefix = WITHHELD_SECURITY_ID_PREFIX
        elif table in {"security_identifiers", "security_list_intervals"} and column == "value":
            prefix = WITHHELD_LIST_VALUE_PREFIX
        else:
            continue
        for (value,) in conn.execute(f"SELECT {_quoted(column)} FROM {_quoted(table)}"):  # nosec B608
            if isinstance(value, str) and value.startswith(prefix):
                occupied.append((WITHHELD_LIST_VALUE_PREFIX + value[len(prefix):], None, None, None))
    return _next_withheld_ordinal(occupied)


def plan_registry_redaction(
    conn: sqlite3.Connection,
    mapping: TickerMapping | None = None,
    *,
    filed_cusips: Collection[str] = (),
    unverified_cusips: Collection[str] = (),
) -> tuple[dict[str, str], dict[str, str]]:
    """``(cusip -> opaque value, security_id -> opaque id)`` for the published
    list. Same closure as the inst plan: a reviewed issuer contributes its
    CUSIP, and the whole CUSIP-6 block follows it, because a sibling row's full
    CUSIP carries the block.

    `filed_cusips` is the authoritative set, from the FILINGS. The list's own
    naming is not sufficient on its own and measuring said so: the reviewed
    mapping is keyed on the name a manager FILED, while this table carries the
    SEC list's own spelling, so 69 issuer blocks — "BANK OF AMER CORP" here
    against the filed "BANK OF AMERICA CORP" — matched nothing and 506 CUSIPs
    stayed published. The list rule is kept as well: the two are unioned, so
    neither spelling alone decides what is withheld."""
    by_key = (mapping or load_ticker_mapping()).by_key()
    rows = conn.execute(
        "SELECT value, security_id, issuer_name, security_class, valid_from"
        " FROM security_list_intervals WHERE id_type = 'cusip'"
    ).fetchall()
    # IDEMPOTENCE IS A CORRECTNESS REQUIREMENT, not a nicety. The published
    # `congress.db` is what seeds the NEXT build (`populus seed-corpus`,
    # publish/seed.py, and publish.yml "Seed the corpus from the previous
    # release (R42)"), so on every run after the first this table already
    # carries rows this function withheld last time: `value` is
    # `withheld:<n>`, `id_type` is still 'cusip', and `issuer_name` still
    # matches the reviewed mapping.
    #
    # Left in the population, such a row is corrupting twice over. Its first
    # six characters are "withhe", which is not an issuer block but WOULD be
    # admitted as one, dragging every previously withheld row back into the
    # renumbered set. And the renumbering collides: `sorted()` is
    # lexicographic, so `withheld:10` precedes `withheld:2` and is handed
    # ordinal 2 — a value the table already holds — so the in-place UPDATE
    # violates PRIMARY KEY (value, valid_from) in registry.sql. Eleven
    # withheld values is enough to reach it; the measured artifact has 9,690.
    #
    # So an already-withheld row is EXCLUDED from the plan: its identity is
    # preserved untouched, and a newly withheld CUSIP is allocated above the
    # highest ordinal already in use rather than from 1. Ordinals are stable
    # across releases as a result, which is also what makes them joinable.
    prior = [r[:4] for r in rows if r[0].startswith(WITHHELD_LIST_VALUE_PREFIX)]
    fresh = [r for r in rows if not r[0].startswith(WITHHELD_LIST_VALUE_PREFIX)]
    blocks = {
        value[:6]
        for value, _sid, name, klass, _start in fresh
        if name is not None and mapping_key(name, klass) in by_key
    }
    # A filed CUSIP carries its BLOCK into the withheld set — unless the seeding
    # gate refused it (`close_withheld_cusips`). A filer who writes another
    # issuer's CUSIP under a reviewed name must not withhold that issuer's whole
    # block here either: the measured case dragged 637 Treasuries in behind two
    # rows. The refused CUSIPs are still withheld, just as themselves.
    unverified = frozenset(unverified_cusips)
    blocks |= {c[:6] for c in filed_cusips if c not in unverified}
    withheld = sorted(
        {
            value
            for value, _s, _n, _c, _start in fresh
            if value[:6] in blocks or value in unverified
        }
    )
    # Values and security IDs share an allocation namespace. A seeded SID can
    # occupy an ordinal absent from the list, including an extra split owner.
    occupied = list(prior)
    for table in _SECURITY_ID_TABLES:
        columns = _columns(conn, table)
        for column in ("security_id", "old_security_id"):
            if column not in columns:
                continue
            for (sid,) in conn.execute(
                f'SELECT DISTINCT "{column}" FROM "{table}"'  # nosec B608 — module constants
            ):
                if isinstance(sid, str) and sid.startswith(WITHHELD_SECURITY_ID_PREFIX):
                    occupied.append((
                        WITHHELD_LIST_VALUE_PREFIX + sid[len(WITHHELD_SECURITY_ID_PREFIX):],
                        None, None, None,
                    ))
    start = _next_withheld_ordinal(occupied)
    values = {
        value: f"{WITHHELD_LIST_VALUE_PREFIX}{n}"
        for n, value in enumerate(withheld, start=start)
    }
    owners: dict[str, dict[str, str]] = defaultdict(dict)
    for value, sid, _name, _class, valid_from in fresh:
        if value in values and sid is not None:
            owners[value][sid] = min(valid_from, owners[value].get(sid, valid_from))
    ordered_owners = {
        value: sorted(owners[value], key=lambda sid: (owners[value][sid], sid))
        for value in withheld
    }
    sids: dict[str, str] = {}
    # Reserve every first-owner binding before allocating additional owners.
    # A shared SID gets one binding even when it is another CUSIP's later owner.
    for value, owner_sids in ordered_owners.items():
        if not owner_sids:
            continue
        first = owner_sids[0]
        if first.startswith(WITHHELD_SECURITY_ID_PREFIX) or first in sids:
            continue
        target = WITHHELD_SECURITY_ID_PREFIX + values[value][len(WITHHELD_LIST_VALUE_PREFIX):]
        sids[first] = target
    next_sid = start + len(values)
    for owner_sids in ordered_owners.values():
        for sid in owner_sids:
            if sid.startswith(WITHHELD_SECURITY_ID_PREFIX) or sid in sids:
                continue
            target = f"{WITHHELD_SECURITY_ID_PREFIX}{next_sid}"
            sids[sid] = target
            next_sid += 1
    return values, sids


#: Sources whose transaction identity is bound to an external audit record, so
#: :func:`rebind_scrubbed_identities` leaves it alone (A1-05, owner decision
#: pending). The kadoa backfill's sealed draw authenticates its population by
#: a digest over kadoa ``txn_id`` values (``populus.backfill.ids_digest``);
#: rebinding one would void that record. Their fingerprints remain the A1-05
#: residual until the owner decides.
IDENTITY_FROZEN_SOURCES = frozenset({"kadoa"})


def rebind_scrubbed_identities(
    conn: sqlite3.Connection,
    *,
    frozen_sources: Collection[str] = IDENTITY_FROZEN_SOURCES,
) -> dict[str, int]:
    """A1-05: give every scrubbed transaction an identity computed from its
    PUBLISHED text. Returns ``{"transactions.identity_rebound": n,
    "transactions.identity_frozen": m}``.

    :func:`scrub_disclosure_text` replaces a withheld CUSIP inside ``raw_row``
    but used to leave ``row_fingerprint`` (``sha256(JCS(raw_row))`` over the
    ORIGINAL text) and the ``txn_id`` built from it untouched. Every other byte
    of the original row is still published, so hashing each candidate CUSIP in
    place of the marker recovered the withheld value: measured on the published
    ``data-20261007.1``, 48 scrubbed rows, at least 3 recoverable from the
    public SEC 13(f) list. A hash of an identifier IS the identifier.

    Runs on the STAGED copy only, after the scrub. For each row whose
    ``raw_row`` carries :data:`DISCLOSURE_WITHHELD_TEXT` and no longer hashes to
    its ``row_fingerprint``: the new fingerprint is the hash of the published
    ``raw_row`` (so the published text recomputes to its published identity,
    the property the scrub had given up), ``dup_seq`` is the first sequence
    number free for ``(filing_id, new fingerprint)`` in source order, and
    ``txn_id`` is rebuilt with :func:`populus.canonical.txn_id`. Deterministic,
    secret-free, and stable across publishes: a seeded row already rebound
    hashes to its fingerprint and is skipped. Unaffected rows are untouched.
    Refuses rather than overwrite on any identity collision. Nothing references
    ``transactions.txn_id`` by foreign key in ``congress.db``.
    """
    from populus.canonical import row_fingerprint, txn_id as make_txn_id

    frozen_set = frozenset(frozen_sources)
    candidates = conn.execute(
        "SELECT txn_id, filing_id, raw_row, row_fingerprint, row_ordinal,"
        " source_row_no, source FROM transactions WHERE instr(raw_row, ?) > 0",
        (DISCLOSURE_WITHHELD_TEXT,),
    ).fetchall()
    by_filing: dict[str, list[tuple]] = defaultdict(list)
    frozen = 0
    for txn, filing, raw, fingerprint, ordinal, source_row_no, source in candidates:
        published = row_fingerprint(json.loads(raw))
        if published == fingerprint:
            continue  # already bound to its published text (a rebound seed row)
        if source in frozen_set:
            frozen += 1
            continue
        by_filing[filing].append(
            (source_row_no if source_row_no is not None else ordinal, ordinal, txn, published)
        )
    rebound = 0
    for filing, rows in sorted(by_filing.items()):
        for _order, _ordinal, old_txn, published in sorted(rows):
            taken = {
                r[0]
                for r in conn.execute(
                    "SELECT dup_seq FROM transactions"
                    " WHERE filing_id = ? AND row_fingerprint = ?",
                    (filing, published),
                )
            }
            seq = 1
            while seq in taken:
                seq += 1
            new_txn = make_txn_id(filing, published, seq)
            if conn.execute(
                "SELECT 1 FROM transactions WHERE txn_id = ?", (new_txn,)
            ).fetchone():
                raise ValueError(
                    f"rebinding {old_txn} would collide with existing {new_txn};"
                    " refusing rather than overwrite a transaction identity"
                )
            conn.execute(
                "UPDATE transactions SET row_fingerprint = ?, dup_seq = ?, txn_id = ?"
                " WHERE txn_id = ?",
                (published, seq, new_txn, old_txn),
            )
            rebound += 1
    return {
        "transactions.identity_rebound": rebound,
        "transactions.identity_frozen": frozen,
    }


def apply_registry_redaction(
    db_path: Path | str,
    *,
    filed_cusips: Collection[str] = (),
    unverified_cusips: Collection[str] = (),
    inst_source: Path | str | None = None,
    inventory: list[dict[str, object]] | None = None,
) -> dict[str, int]:
    """Withhold reviewed-ticker CUSIPs from ONE published congress.db copy.

    Operates on the staged artifact only: the build's own store keeps every
    CUSIP, so internal joins and the identity registry are untouched.

    `filed_cusips` is the withheld set computed from the FILED names by
    :func:`plan_cusip_redaction` during the inst derive. It is PASSED IN rather
    than recomputed here: the derive reads the accepted snapshot inside ONE
    explicit read transaction, and re-opening that snapshot afterwards would put
    a read outside it — the identity contract
    `test_inst_external_store.test_c_exactly_one_read_transaction_spans_the_derivation`
    exists precisely to catch that, and did.

    `inst_source` is the standalone equivalent for ad-hoc use (a probe, a
    one-off re-cut of a published artifact), where no derive is in flight.
    """
    counts: dict[str, int] = {}
    filed: frozenset[str] = frozenset(filed_cusips)
    unverified: frozenset[str] = frozenset(unverified_cusips)
    if inst_source is not None:
        inst_conn = sqlite3.connect(
            f"file:{inst_source}?mode=ro&immutable=1", uri=True
        )
        try:
            standalone = plan_cusip_redaction(inst_conn)
            filed |= standalone.cusips
            unverified |= standalone.unverified
        finally:
            inst_conn.close()
    counts["filed_withheld_cusips"] = len(filed)
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        has_list = bool(
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table'"
                " AND name='security_list_intervals'"
            ).fetchone()
        )
        # FAIL CLOSED ON A REPLAY WITH NO CUSIP-BEARING SOURCE. A previous pass
        # replaced the CUSIPs of the reviewed blocks with opaque ordinals, so
        # the artifact can no longer say WHICH blocks were withheld — that is
        # the point of withholding them. The block set therefore has to come
        # from a source that still holds real CUSIPs: `filed_cusips` (what the
        # inst derive computed from the FILINGS, which is what publish passes)
        # or `inst_source`. Without one, this pass would withhold only the rows
        # the list's OWN naming still matches, and a newly listed sibling class
        # in an already-withheld block would be published with its CUSIP while
        # its issuer name still pairs it to the reviewed ticker. Refusing is the
        # only safe answer: a silent under-withholding looks exactly like a
        # clean run.
        replayed = has_list and conn.execute(
            "SELECT 1 FROM security_list_intervals"
            " WHERE id_type = 'cusip' AND value LIKE ? || '%' LIMIT 1",
            (WITHHELD_LIST_VALUE_PREFIX,),
        ).fetchone()
        if replayed and not filed:
            raise ValueError(
                "this congress.db already carries withheld list values, so it is a"
                " seeded artifact: pass filed_cusips (or inst_source) so the"
                " withheld CUSIP-6 blocks can be recomputed from a source that"
                " still holds the CUSIPs. Re-running without one would publish a"
                " newly listed class in an already-withheld block."
            )
        values: dict[str, str] = {}
        sids: dict[str, str] = {}
        if has_list:
            values, sids = plan_registry_redaction(
                conn, filed_cusips=filed, unverified_cusips=unverified
            )
            counts["withheld_cusips"] = len(values)
            counts["withheld_security_ids"] = len(sids)
        else:
            counts["security_list_intervals.absent"] = 0

        # FTD identifiers participate in the same value map, including a filed
        # withheld identifier that has no surviving definitional list row.
        population = filed | frozenset(values)
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "security_identifiers" in tables:
            identifiers = conn.execute(
                "SELECT value,security_id,MIN(valid_from) FROM security_identifiers"
                " WHERE id_type='cusip' GROUP BY value,security_id ORDER BY value,MIN(valid_from),security_id"
            ).fetchall()
            ordinal = max(_registry_next_ordinal(conn, ()), _next_withheld_ordinal(
                [(v, None, None, None) for v in values.values()]
                + [(WITHHELD_LIST_VALUE_PREFIX + sid[len(WITHHELD_SECURITY_ID_PREFIX):], None, None, None)
                   for sid in sids.values()]
            ))
            for value, _sid, _start in identifiers:
                if value not in population:
                    continue
                if value not in values:
                    values[value] = f"{WITHHELD_LIST_VALUE_PREFIX}{ordinal}"
                    ordinal += 1
            used_sids = set(sids.values())
            ordinal = max(ordinal, _next_withheld_ordinal(
                [(v, None, None, None) for v in values.values()]
            ))
            for value, sid, _start in identifiers:
                if value not in population or sid is None or sid in sids or sid.startswith(WITHHELD_SECURITY_ID_PREFIX):
                    continue
                target = WITHHELD_SECURITY_ID_PREFIX + values[value][len(WITHHELD_LIST_VALUE_PREFIX):]
                if target in used_sids:
                    target = f"{WITHHELD_SECURITY_ID_PREFIX}{ordinal}"
                    ordinal += 1
                sids[sid] = target
                used_sids.add(target)

        # A known provisional ID can survive without its original list/FTD
        # row. It is still recomputable from the withheld source CUSIP, so all
        # exact canonical SID occurrences share an injective opaque binding.
        # Custom IDs and other cross-build keys receive no new exemption.
        known = {provisional_security_id(anchor("cusip", c)): c for c in population}
        present = set()
        for item in _column_inventory(conn):
            table, column = str(item["table"]), str(item["column"])
            if column not in {"security_id", "old_security_id"}:
                continue
            present.update(
                row[0] for row in conn.execute(
                    f"SELECT DISTINCT {_quoted(column)} FROM {_quoted(table)}"  # nosec B608
                    f" WHERE typeof({_quoted(column)})='text'"
                ) if row[0] in known
            )
        ordinal = max(_registry_next_ordinal(conn, ()), _next_withheld_ordinal(
            [(v, None, None, None) for v in values.values()]
            + [(WITHHELD_LIST_VALUE_PREFIX + sid[len(WITHHELD_SECURITY_ID_PREFIX):], None, None, None)
               for sid in sids.values()]
        ))
        used_sids = set(sids.values())
        for sid in sorted(present):
            if sid in sids:
                continue
            value = known[sid]
            if value not in values:
                values[value] = f"{WITHHELD_LIST_VALUE_PREFIX}{ordinal}"
                ordinal += 1
            target = WITHHELD_SECURITY_ID_PREFIX + values[value][len(WITHHELD_LIST_VALUE_PREFIX):]
            if target in used_sids:
                target = f"{WITHHELD_SECURITY_ID_PREFIX}{ordinal}"
                ordinal += 1
            sids[sid] = target
            used_sids.add(target)
        keys: dict[tuple[str, str], dict[str, str | None]] = {
            ("*", "security_id"): sids,
            ("*", "old_security_id"): sids,
            ("security_list_intervals", "value"): values,
            ("security_identifiers", "value"): values,
        }
        counts.update(_apply_text_plan(
            conn, population, keys, inventory=inventory,
            blocks=frozenset(c[:6] for c in population if c not in unverified),
        ))
        if has_list:
            counts["withheld_cusips"] = len(values)
            counts["withheld_security_ids"] = len(sids)
    finally:
        conn.close()
    return counts
