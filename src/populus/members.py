"""Member identity: legislators load, aliases, and the §9.7 join.

Loads the congress-legislators seed (CC0 — ``cc0-legislators``) into
``members``, maintains the version-controlled ``member_aliases`` table from
``aliases.yaml`` (full-replace, so every fuzzy-match decision is a reviewed
commit), and runs the post-hoc member-join pass over ``filings`` +
``transactions``.

Join rule (§9.7): the filer name is normalized (case, punctuation,
honorifics, suffixes, ``Last, First`` reordering) and matched against
member name variants — first/last, first/middle/last, nickname, official
full, and dated ``other_names`` — constrained by chamber, term overlap
with ``filed_date`` (per-term ``type``, never the denormalized
``members.chamber``), and state/district where hints exist. Every
``other_names`` variant applies only inside its own source-declared
``start``/``end`` validity window (missing bound = unbounded; both bounds
inclusive — G14, no identity time travel). Exactly one candidate ⇒ join;
zero or many ⇒ ``bioguide_id = NULL``, counted, never dropped.
Alias rows take precedence over automatic matching.

Library code never reads the wall clock; the CLI supplies ``now``/``run_id``.
"""

from __future__ import annotations

import importlib.resources
import json
import re
import sqlite3
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

from populus.parse.xml import parse_untrusted_xml

# Tokens dropped during filer-name normalization. Honorifics and professional
# / generational suffixes appear in index names ("Dunn, Neal Patrick MD,
# Facs", "Begich, Nicholas III") but never distinguish members.
_DROPPED_TOKENS = frozenset(
    {
        "hon",
        "dr",
        "mr",
        "mrs",
        "ms",
        "jr",
        "sr",
        "ii",
        "iii",
        "iv",
        "v",
        "md",
        "facs",
        "dds",
        "esq",
        "phd",
    }
)
_PUNCT = re.compile(r"[^\w\s]")


def normalize_filer_name(raw: str) -> str:
    """Casefold + diacritic fold → ``Last, First`` reorder → punctuation and
    honorific strip.

    ``"Beyer, Donald Sternoff Jr"`` → ``"donald sternoff beyer"``. Diacritics
    are folded (NFD, combining marks dropped) because the sources disagree
    with the legislators seed about them ("Sanchez" vs "Sánchez"). The same
    function normalizes filer names, member variants, and alias strings, so
    the three vocabularies cannot fork.
    """
    decomposed = unicodedata.normalize("NFD", raw).casefold()
    text = "".join(c for c in decomposed if not unicodedata.combining(c))
    if "," in text:
        last_part, _, first_part = text.partition(",")
        text = f"{first_part} {last_part}"
    text = _PUNCT.sub(" ", text)
    tokens = [t for t in text.split() if t not in _DROPPED_TOKENS]
    return " ".join(tokens)


def _jsonable(value):
    """YAML parses ISO dates into ``date`` objects; JSON needs strings."""
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _load_legislators_yaml(path: Path) -> list[dict]:
    entries = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return [_jsonable(entry) for entry in entries]


# --- members load --------------------------------------------------------


@dataclass(frozen=True)
class MembersReport:
    current: int
    historical: int
    upserted: int
    skipped: tuple[str, ...]  # entries with no bioguide or no terms (counted, G3)


def _member_row(entry: Mapping) -> tuple | None:
    bioguide = (entry.get("id") or {}).get("bioguide")
    terms = entry.get("terms") or []
    if not bioguide or not terms:
        return None
    latest = max(terms, key=lambda t: t.get("start") or "")
    chamber = "house" if latest.get("type") == "rep" else "senate"
    name = entry.get("name") or {}
    full_name = (name.get("official_full") or "").strip()
    if not full_name:
        full_name = " ".join(
            p for p in (name.get("first"), name.get("last")) if p
        ).strip()
    district = latest.get("district")
    return (
        bioguide,
        full_name,
        chamber,
        latest.get("party"),
        latest.get("state"),
        str(district) if district is not None else None,
        json.dumps(terms, ensure_ascii=False),
        json.dumps(entry, ensure_ascii=False),
    )


def load_members(conn: sqlite3.Connection, legislators_dir: Path | str) -> MembersReport:
    """Idempotent upsert of both legislators files into ``members``.

    Historical first, current last, so a bioguide present in both files ends
    on its current entry. FK-referenced rows are never deleted — this is an
    upsert, not a replace. Entries lacking a bioguide or any term cannot
    satisfy the schema (PK / NOT NULL chamber) and are counted, not dropped
    silently.
    """
    legislators_dir = Path(legislators_dir)
    historical = _load_legislators_yaml(legislators_dir / "legislators-historical.yaml")
    current = _load_legislators_yaml(legislators_dir / "legislators-current.yaml")

    rows: list[tuple] = []
    skipped: list[str] = []
    for entry in [*historical, *current]:
        row = _member_row(entry)
        if row is None:
            skipped.append(json.dumps((entry.get("id") or {}), ensure_ascii=False))
            continue
        rows.append(row)

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.executemany(
            """
            INSERT INTO members (
              bioguide_id, full_name, chamber, party, state, district, terms, raw
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (bioguide_id) DO UPDATE SET
              full_name = excluded.full_name,
              chamber = excluded.chamber,
              party = excluded.party,
              state = excluded.state,
              district = excluded.district,
              terms = excluded.terms,
              raw = excluded.raw
            """,
            rows,
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return MembersReport(
        current=len(current),
        historical=len(historical),
        upserted=len(rows),
        skipped=tuple(skipped),
    )


# --- aliases -------------------------------------------------------------


def default_aliases_text() -> str:
    """The packaged, version-controlled alias seed file."""
    return (
        importlib.resources.files("populus")
        .joinpath("aliases.yaml")
        .read_text(encoding="utf-8")
    )


def load_aliases(conn: sqlite3.Connection, aliases_path: Path | str | None = None) -> int:
    """Full-replace ``member_aliases`` from the alias YAML file.

    Every row requires ``alias``/``chamber``/``valid_from``/``bioguide_id``/
    ``note`` (the note is the reviewed justification — schema §9.4). The
    alias string is normalized through :func:`normalize_filer_name` so the
    stored form is always the resolution key.
    """
    if aliases_path is None:
        text = default_aliases_text()
    else:
        text = Path(aliases_path).read_text(encoding="utf-8")
    data = _jsonable(yaml.safe_load(text)) or {}
    entries = data.get("aliases") or []

    rows: list[tuple] = []
    for position, entry in enumerate(entries):
        missing = [
            key
            for key in ("alias", "chamber", "valid_from", "bioguide_id", "note")
            if not entry.get(key)
        ]
        if missing:
            raise ValueError(f"alias entry {position} is missing {missing}")
        if entry["chamber"] not in ("house", "senate"):
            raise ValueError(f"alias entry {position}: bad chamber {entry['chamber']!r}")
        district = entry.get("district")
        rows.append(
            (
                normalize_filer_name(entry["alias"]),
                entry["chamber"],
                entry.get("state"),
                str(district) if district is not None else None,
                entry["valid_from"],
                entry.get("valid_to"),
                entry["bioguide_id"],
                entry["note"],
            )
        )

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM member_aliases")
        conn.executemany(
            "INSERT INTO member_aliases (alias, chamber, state, district,"
            " valid_from, valid_to, bioguide_id, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return len(rows)


def alias_overlap_errors(conn: sqlite3.Connection) -> list[str]:
    """The §9.4 invariant: overlapping applicable alias rows are a defect.

    Two rows conflict when they share (alias, chamber), their disambiguators
    are compatible (equal or either NULL — NULL matches any filing), and
    their ``[valid_from, valid_to)`` windows intersect, because one
    (alias, date) could then resolve through both rows.
    """
    rows = conn.execute(
        "SELECT alias_id, alias, chamber, state, district, valid_from, valid_to"
        " FROM member_aliases ORDER BY alias_id"
    ).fetchall()
    errors: list[str] = []
    for i, a in enumerate(rows):
        for b in rows[i + 1 :]:
            if (a[1], a[2]) != (b[1], b[2]):
                continue
            if a[3] is not None and b[3] is not None and a[3] != b[3]:
                continue
            if a[4] is not None and b[4] is not None and a[4] != b[4]:
                continue
            a_from, a_to = a[5], a[6]
            b_from, b_to = b[5], b[6]
            if (a_to is None or b_from < a_to) and (b_to is None or a_from < b_to):
                errors.append(
                    f"alias rows {a[0]} and {b[0]} overlap for"
                    f" ({a[1]!r}, {a[2]}) on [{max(a_from, b_from)}, …)"
                )
    return errors


# --- resolver ---------------------------------------------------------


@dataclass(frozen=True)
class Resolution:
    bioguide_id: str | None
    outcome: str  # 'alias' | 'matched' | 'unmatched' | 'ambiguous' | 'alias_conflict'


@dataclass(frozen=True)
class _Variant:
    bioguide_id: str
    valid_from: str | None  # inclusive; None = unbounded past
    valid_to: str | None  # inclusive; None = unbounded future


@dataclass(frozen=True)
class _AliasRow:
    bioguide_id: str
    chamber: str
    state: str | None
    district: str | None
    valid_from: str
    valid_to: str | None


def _variant_windows_ok(variant: _Variant, filed_date: str) -> bool:
    if variant.valid_from is not None and filed_date < variant.valid_from:
        return False
    if variant.valid_to is not None and filed_date > variant.valid_to:
        return False
    return True


class MemberResolver:
    """Alias-first, window-aware, constraint-filtered name resolution."""

    def __init__(
        self,
        *,
        full_index: Mapping[str, list[_Variant]],
        key_index: Mapping[tuple[str, str], list[_Variant]],
        terms: Mapping[str, list[Mapping]],
        aliases: Mapping[str, list[_AliasRow]],
    ) -> None:
        self._full_index = full_index
        self._key_index = key_index
        self._terms = terms
        self._aliases = aliases

    def _member_has_term(
        self,
        bioguide_id: str,
        chamber: str,
        filed_date: str,
        state: str | None = None,
        district: str | None = None,
    ) -> bool:
        want_type = "rep" if chamber == "house" else "sen"
        for term in self._terms.get(bioguide_id, ()):
            if term.get("type") != want_type:
                continue
            start, end = term.get("start"), term.get("end")
            if start is not None and filed_date < start:
                continue
            if end is not None and filed_date > end:
                continue
            if state is not None and term.get("state") != state:
                continue
            if district is not None and chamber == "house":
                term_district = term.get("district")
                if term_district is None or str(term_district) != district:
                    continue
            return True
        return False

    def _candidates(
        self,
        variants: Iterable[_Variant],
        chamber: str,
        filed_date: str,
        state: str | None,
        district: str | None,
    ) -> set[str]:
        found: set[str] = set()
        for variant in variants:
            if not _variant_windows_ok(variant, filed_date):
                continue
            if self._member_has_term(
                variant.bioguide_id, chamber, filed_date, state, district
            ):
                found.add(variant.bioguide_id)
        return found

    def resolve(
        self,
        name_raw: str,
        chamber: str,
        filed_date: str,
        *,
        state: str | None = None,
        district: str | None = None,
    ) -> Resolution:
        normalized = normalize_filer_name(name_raw)

        # Alias precedence: an applicable alias row is a reviewed decision.
        # Aliases DO NOT bypass the hard state/district constraints (F2/R2/
        # R4): whenever the filing supplies a state or district hint, an
        # applicable alias must carry a MATCHING value. A wildcard (NULL)
        # disambiguator therefore only applies when the corresponding hint
        # is itself absent (e.g. a Senate filing supplies no district). A
        # verified stale source value is corrected by an alias scoped to the
        # exact stale (source_district, date) — never by a district-blind
        # wildcard — so alias precedence can never attribute a filing to a
        # member inconsistent with the supplied district.
        applicable = [
            row
            for row in self._aliases.get(normalized, ())
            if row.chamber == chamber
            and row.valid_from <= filed_date
            and (row.valid_to is None or filed_date < row.valid_to)
            and (state is None or row.state == state)
            and (district is None or row.district == district)
            and self._member_has_term(row.bioguide_id, chamber, filed_date)
        ]
        if applicable:
            targets = {row.bioguide_id for row in applicable}
            if len(targets) == 1:
                return Resolution(applicable[0].bioguide_id, "alias")
            # Overlapping applicable rows disagreeing on the member: the R3
            # defect. Fail closed — CI catches the file via
            # alias_overlap_errors; resolution never guesses.
            return Resolution(None, "alias_conflict")

        # District is a HARD constraint whenever a district hint is supplied
        #: it is never discarded to recover a match. A supplied
        # district that eliminates every candidate yields NULL, not a
        # district-blind guess — conservative identity resolution (a stale or
        # wrong district can never attribute a filing to a non-matching
        # member). Verified-stale source hints are corrected at the
        # hint-construction boundary (see kadoa_hints_from_trades) or through
        # a reviewed alias, never here.
        candidates = self._auto_candidates(normalized, chamber, filed_date, state, district)

        if len(candidates) == 1:
            return Resolution(next(iter(candidates)), "matched")
        if not candidates:
            return Resolution(None, "unmatched")
        return Resolution(None, "ambiguous")

    def _auto_candidates(
        self,
        normalized: str,
        chamber: str,
        filed_date: str,
        state: str | None,
        district: str | None,
    ) -> set[str]:
        candidates = self._candidates(
            self._full_index.get(normalized, ()), chamber, filed_date, state, district
        )
        if candidates:
            return candidates
        tokens = normalized.split()
        keys: list[tuple[str, str]] = []
        if len(tokens) >= 2:
            keys.append((tokens[0], tokens[-1]))
        # A single-letter leading initial ("A. Mitchell McConnell") cannot
        # match a spelled-out first name; try the next token.
        if len(tokens) >= 3 and len(tokens[0]) == 1:
            keys.append((tokens[1], tokens[-1]))
        variants: list[_Variant] = []
        for key in keys:
            variants.extend(self._key_index.get(key, ()))
        return self._candidates(variants, chamber, filed_date, state, district)


def _compose(*parts: str | None) -> str | None:
    text = " ".join(p for p in parts if p)
    if not text.strip():
        return None
    return normalize_filer_name(text)


def _member_variants(raw: Mapping) -> list[tuple[str, str | None, str | None]]:
    """``(normalized_variant, valid_from, valid_to)`` for one member entry."""
    name = raw.get("name") or {}
    first = name.get("first")
    middle = name.get("middle")
    last = name.get("last")
    nickname = name.get("nickname")
    official = name.get("official_full")

    unbounded: set[str] = set()
    for candidate in (
        _compose(first, last),
        _compose(first, middle, last),
        _compose(nickname, last),
        _compose(official),
    ):
        if candidate:
            unbounded.add(candidate)

    variants = [(v, None, None) for v in sorted(unbounded)]
    # Alternate names carry their own source-declared validity bounds:
    # missing start = unbounded past, missing end = unbounded future, both
    # inclusive. Name parts absent from the alternate entry inherit the base.
    for other in raw.get("other_names") or []:
        o_first = other.get("first") or first
        o_middle = other.get("middle")
        o_last = other.get("last") or last
        window_from = other.get("start")
        window_to = other.get("end")
        for candidate in (_compose(o_first, o_last), _compose(o_first, o_middle, o_last)):
            if candidate:
                variants.append((candidate, window_from, window_to))
    return variants


def _variant_keys(normalized: str) -> list[tuple[str, str]]:
    tokens = normalized.split()
    if len(tokens) < 2:
        return []
    keys = [(tokens[0], tokens[-1])]
    if len(tokens) >= 3:
        # Middle-token key: lets "A. Mitchell McConnell" reach Addison
        # Mitchell McConnell. Extra keys only ever ADD candidates; the
        # exactly-one rule keeps this conservative.
        keys.append((tokens[1], tokens[-1]))
    return keys


def build_resolver(conn: sqlite3.Connection) -> MemberResolver:
    """Index every member's name variants, terms, and the alias table."""
    full_index: dict[str, list[_Variant]] = {}
    key_index: dict[tuple[str, str], list[_Variant]] = {}
    terms: dict[str, list[Mapping]] = {}
    for bioguide_id, terms_json, raw_json in conn.execute(
        "SELECT bioguide_id, terms, raw FROM members"
    ):
        terms[bioguide_id] = json.loads(terms_json)
        raw = json.loads(raw_json)
        for normalized, window_from, window_to in _member_variants(raw):
            variant = _Variant(bioguide_id, window_from, window_to)
            full_index.setdefault(normalized, []).append(variant)
            for key in _variant_keys(normalized):
                key_index.setdefault(key, []).append(variant)

    aliases: dict[str, list[_AliasRow]] = {}
    for alias, chamber, state, district, valid_from, valid_to, bioguide_id in conn.execute(
        "SELECT alias, chamber, state, district, valid_from, valid_to, bioguide_id"
        " FROM member_aliases"
    ):
        aliases.setdefault(alias, []).append(
            _AliasRow(bioguide_id, chamber, state, district, valid_from, valid_to)
        )
    return MemberResolver(
        full_index=full_index, key_index=key_index, terms=terms, aliases=aliases
    )


# --- join hints ----------------------------------------------------------

_STATE_DST = re.compile(r"^([A-Z]{2})(\d{2})$")
_OFFICE_DISTRICT = re.compile(r"([A-Z]{2})-(\d+)\s*$")


def house_hints_from_index(
    xml_paths: Iterable[Path | str],
) -> dict[str, tuple[str | None, str | None]]:
    """``filing_id → (state, district)`` from cached House index XML.

    ``StateDst`` prints ``MO04``/``AK00``; the district hint is the
    zero-stripped form matching the legislators district (at-large = "0").
    """
    hints: dict[str, tuple[str | None, str | None]] = {}
    for path in xml_paths:
        # Cached bytes of a REMOTE index: parse through the shared hardened
        # helper. UnsafeXmlError/XMLSyntaxError propagate as named
        # failures — a refused index must never yield silent empty hints.
        root = parse_untrusted_xml(Path(path).read_bytes())
        for member in root.iter("Member"):
            if (member.findtext("FilingType") or "").strip() != "P":
                continue
            doc_id = (member.findtext("DocID") or "").strip()
            if not doc_id:
                continue
            match = _STATE_DST.match((member.findtext("StateDst") or "").strip())
            if match is None:
                continue
            hints[f"house:{doc_id}"] = (match.group(1), str(int(match.group(2))))
    return hints


def kadoa_hints_from_trades(
    path: Path | str,
) -> dict[str, tuple[str | None, str | None]]:
    """``filing_id → (state, district)`` from the kadoa seed's own fields.

    The record's ``state`` is the state hint; a House district is parsed from
    the ``office`` suffix ("U.S. Representative · CT-04"); the ``state`` field
    is backfilled from that same suffix when absent. Senate rows carry no
    district.

    District is a HARD resolver constraint: the parsed district
    stands as given. Some kadoa ``office`` districts are the member's former
    (pre-redistricting) district rather than the filed report's — a
    known-stale source value. Those are corrected **only** by an explicit,
    reviewed alias scoped to the exact stale (source_district, date) in
    ``aliases.yaml`` (a versioned correction mapping); an uncorrected stale
    district resolves to NULL and is listed in stats, never silently dropped and never attributed to a non-matching member.
    """
    records = json.loads(Path(path).read_text(encoding="utf-8"))
    hints: dict[str, tuple[str | None, str | None]] = {}
    for record in records:
        if not isinstance(record, dict) or record.get("branch") != "congress":
            continue
        record_id = record.get("id")
        if not record_id:
            continue
        state = record.get("state") or None
        district = None
        if record.get("chamber") == "house":
            match = _OFFICE_DISTRICT.search(record.get("office") or "")
            if match is not None:
                if state is None:
                    state = match.group(1)
                district = str(int(match.group(2)))
        hints[f"kadoa:{record_id}"] = (state, district)
    return hints


# --- join pass -----------------------------------------------------------


@dataclass
class SourceJoin:
    filings: int = 0
    joined: int = 0


@dataclass
class JoinReport:
    by_source: dict[str, SourceJoin] = field(default_factory=dict)
    outcomes: dict[str, int] = field(default_factory=dict)
    changed: int = 0
    unresolved: tuple[tuple[str, str, str, int], ...] = ()
    # (filer_name_raw, chamber, source, filing_count), sorted

    @property
    def filings(self) -> int:
        return sum(s.filings for s in self.by_source.values())

    @property
    def joined(self) -> int:
        return sum(s.joined for s in self.by_source.values())


def apply_member_join(
    conn: sqlite3.Connection,
    *,
    house_hints: Mapping[str, tuple[str | None, str | None]] | None = None,
    kadoa_hints: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> JoinReport:
    """Re-runnable post-hoc join: resolve every filing, then update
    ``filings.bioguide_id`` and the denormalized ``transactions.bioguide_id``
    together in one transaction (the §9.4 CI invariant can never be observed
    broken). Unjoined filings get an explicit NULL — never dropped."""
    resolver = build_resolver(conn)
    hints: dict[str, tuple[str | None, str | None]] = {}
    hints.update(house_hints or {})
    hints.update(kadoa_hints or {})

    report = JoinReport()
    unresolved: dict[tuple[str, str, str], int] = {}
    updates: list[tuple[str | None, str]] = []
    for filing_id, chamber, name_raw, filed_date, source, prior in conn.execute(
        "SELECT filing_id, chamber, filer_name_raw, filed_date, source, bioguide_id"
        " FROM filings ORDER BY filing_id"
    ):
        state, district = hints.get(filing_id, (None, None))
        resolution = resolver.resolve(
            name_raw, chamber, filed_date, state=state, district=district
        )
        updates.append((resolution.bioguide_id, filing_id))
        source_join = report.by_source.setdefault(source, SourceJoin())
        source_join.filings += 1
        report.outcomes[resolution.outcome] = (
            report.outcomes.get(resolution.outcome, 0) + 1
        )
        if resolution.bioguide_id is not None:
            source_join.joined += 1
        else:
            key = (name_raw, chamber, source)
            unresolved[key] = unresolved.get(key, 0) + 1
        if resolution.bioguide_id != prior:
            report.changed += 1

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.executemany(
            "UPDATE filings SET bioguide_id = ? WHERE filing_id = ?", updates
        )
        conn.execute(
            "UPDATE transactions SET bioguide_id ="
            " (SELECT f.bioguide_id FROM filings f"
            "  WHERE f.filing_id = transactions.filing_id)"
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    report.unresolved = tuple(
        (name, chamber, source, count)
        for (name, chamber, source), count in sorted(unresolved.items())
    )
    return report


@dataclass(frozen=True)
class MembersRunReport:
    run_id: str
    members: MembersReport
    aliases: int
    join: JoinReport


def run_members_ingest(
    conn: sqlite3.Connection,
    *,
    legislators_dir: Path | str,
    aliases_path: Path | str | None = None,
    house_hints: Mapping[str, tuple[str | None, str | None]] | None = None,
    kadoa_hints: Mapping[str, tuple[str | None, str | None]] | None = None,
    run_id: str,
    now,
    host: str,
) -> MembersRunReport:
    """Load members + aliases and run the join pass under one complete
    ``ingest_runs`` row. Unjoined filings are counted, not failures."""
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'members', ?, 'running', ?)",
        (run_id, now(), host),
    )
    try:
        members_report = load_members(conn, legislators_dir)
        alias_count = load_aliases(conn, aliases_path)
        join_report = apply_member_join(
            conn, house_hints=house_hints, kadoa_hints=kadoa_hints
        )
    except BaseException:
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'failed'"
            " WHERE run_id = ?",
            (now(), run_id),
        )
        raise
    conn.execute(
        "UPDATE ingest_runs SET finished_at = ?, status = 'ok', new_filings = 0,"
        " rows_loaded = ?, parse_failures = 0 WHERE run_id = ?",
        (now(), members_report.upserted, run_id),
    )
    return MembersRunReport(
        run_id=run_id,
        members=members_report,
        aliases=alias_count,
        join=join_report,
    )


def format_join_summary(report: JoinReport) -> str:
    lines = []
    for source in sorted(report.by_source):
        source_join = report.by_source[source]
        rate = (
            100.0 * source_join.joined / source_join.filings
            if source_join.filings
            else 0.0
        )
        lines.append(
            f"join {source}: {source_join.joined}/{source_join.filings}"
            f" filings joined ({rate:.1f}%)"
        )
    outcomes = ", ".join(f"{k} {v}" for k, v in sorted(report.outcomes.items()))
    lines.append(f"join outcomes: {outcomes} | changed {report.changed}")
    if report.unresolved:
        lines.append(f"unresolved filers ({len(report.unresolved)}):")
        for name, chamber, source, count in report.unresolved[:20]:
            lines.append(f"  {name!r} ({chamber}, {source}) x{count}")
    return "\n".join(lines)
