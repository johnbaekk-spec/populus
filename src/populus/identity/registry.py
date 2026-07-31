"""Registry DDL, the identity authority, as-of resolution, and migration.

The three things this module owns, in dependency order:

1. **The tables** (``registry.sql``, applied by :func:`ensure_registry`) and
   the temporal invariant a UNIQUE index cannot express
   (:func:`registry_overlap_errors`) — mirroring ``member_aliases`` /
   ``members.alias_overlap_errors`` (§9.4/§9.7).
2. **The identity authority** — ``securities.yaml``. Each class declares a
   literal, permanent ``security_id`` plus the identifier values it owns over
   half-open *ownership windows*. A split is two classes owning one value over
   complementary windows, so the incumbent keeps its id, its other
   identifiers and its metadata; a CUSIP change is one class owning two
   values. Values named by no class resolve to a deterministic
   ``sec:prov:<hex>`` provisional id that carries no durability claim.
   Observations NEVER assign or change an id.
3. **As-of resolution and registry-revision migration.** Every resolver is
   interval-bounded, unique-row and fail-closed (G14/G3).
   :func:`reconcile_identity_registry` applies a revised authority to a
   populated database: it cuts every persisted validity interval that crosses
   a declared ownership boundary, assigns each piece to its owner, renames
   promoted/merged ids, fans out splits, and records an append-only
   one-to-many supersession ledger — all inside a transaction the CALLER
   owns, because SQLite transactions do not nest and the whole bootstrap must
   be all-or-nothing.

Library code never reads the wall clock: snapshot dates and as-of dates are
supplied by the caller.
"""

from __future__ import annotations

import hashlib
import importlib.resources
import json
import re
import sqlite3
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import yaml

from populus.canonical import canonical_json, nfc

# --- policy constants (in code, never config — G6) ----------------------------

#: Identifier kinds the schema admits today. The CHECK constraint in
#: registry.sql is the extension point; adding one here without adding it
#: there is a defect the loader test catches.
ID_TYPES = ("cusip",)

#: Reserved prefix for DERIVED ids. `securities.yaml` may never use it.
PROVISIONAL_ID_PREFIX = "sec:prov:"

#: Reuse-review horizon. An identifier whose observed dates contain a gap of
#: at least this many days, with no declared ownership boundary inside the gap
#: and no declared continuity clearing it, is flagged `disputed` and stops
#: resolving anywhere until a reviewed declaration exists.
#:
#: STATED ASSUMPTION, not a verified CGS rule: CUSIP issue numbers are not
#: reassigned within a short window, so a decade-scale threshold is chosen to
#: make benign fails-reporting gaps essentially never trip the flag.
#: `continuities` in the authority file is the reviewed escape hatch.
REUSE_REVIEW_HORIZON_DAYS = 3650

#: Every table holding a foreign key to `securities`. Enforced by
#: `tests/test_identity_migration.py::test_every_fk_to_securities_is_repointed`,
#: which reads PRAGMA foreign_key_list for every registry table and fails if a
#: referencing table is missing here.
SECURITY_ID_REFERENCING_TABLES = (
    "security_identifiers",
    "security_supersessions",
    "inst_holdings",
    "security_list_intervals",
)

#: Repointed by interval CUTTING rather than a plain UPDATE, because their rows
#: carry validity intervals that may cross an ownership boundary and therefore
#: belong to more than one owner after a revision. The definitional 13(f)-list
#: table joins this set for RUN M2-5 (a later securities.yaml revision must recut
#: its quarter intervals exactly as it recuts the FTD identifiers).
_CUT_TABLES = frozenset({"security_identifiers", "security_list_intervals"})

#: Source precedence for IDENTITY resolution (which security a CUSIP maps to
#: as-of a date), highest first: the declared authority, then the definitional
#: 13(f) list, then FTD observations. `resolve_cusip` consults the FTD layer
#: ONLY when no definitional interval covers the date (fail-closed — a disputed
#: or ambiguous definitional binding resolves to None, never to FTD). There is
#: deliberately NO name-precedence constant: canonical names come from the
#: definitional list alone (the sole persisted name source).
IDENTITY_SOURCE_PRECEDENCE = ("securities.yaml", "sec-13f-list", "sec-ftd")

_SECURITY_ID_RE = re.compile(r"^sec:[a-z0-9][a-z0-9._-]{0,62}$")
_CUSIP_RE = re.compile(r"^[0-9A-Z]{9}$")
_TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,15}$")
_WHITESPACE_RE = re.compile(r"\s+")


# --- DDL ----------------------------------------------------------------------


def ensure_registry(conn: sqlite3.Connection) -> None:
    """Apply the packaged registry DDL (all ``IF NOT EXISTS`` — idempotent).

    Called by ``db.init_db`` for fresh databases and by every identity CLI
    path, so a pre-existing M1 database gains the registry on first use
    without touching any M1 table.
    """
    ddl = (
        importlib.resources.files("populus")
        .joinpath("registry.sql")
        .read_text(encoding="utf-8")
    )
    conn.executescript(ddl)


def registry_overlap_errors(conn: sqlite3.Connection) -> list[str]:
    """The invariant the UNIQUE indexes cannot express: intersecting windows.

    ``(ticker, valid_from)`` and ``(id_type, value, valid_from)`` are unique,
    which stops two rows STARTING on the same day — but not one row's window
    containing another's. Two rows conflict when they share the lookup key and
    their ``[valid_from, valid_to)`` windows intersect, because one (key, date)
    could then resolve through both. Read-only; safe to run before anything.

    Linear, not quadratic: each query orders by (key, valid_from), and for
    start-ordered intervals it is enough to compare ADJACENT pairs. If rows
    *i* and *j* (i < j) intersect then ``start[i+1] <= start[j] < end[i]``, so
    *i* and *i+1* intersect too — a containment three rows apart is still
    caught, and the real registry's tens of thousands of identifier rows stay
    checkable.
    """
    errors: list[str] = []
    checks = (
        (
            "entity_names",
            "SELECT entity_id, valid_from, valid_to FROM entity_names"
            " ORDER BY entity_id, valid_from",
        ),
        (
            "entity_tickers",
            "SELECT ticker, valid_from, valid_to FROM entity_tickers"
            " ORDER BY ticker, valid_from",
        ),
        (
            "security_identifiers",
            "SELECT id_type || ':' || value, valid_from, valid_to"
            " FROM security_identifiers ORDER BY id_type, value, valid_from",
        ),
        (
            "security_list_intervals",
            "SELECT id_type || ':' || value, valid_from, valid_to"
            " FROM security_list_intervals ORDER BY id_type, value, valid_from",
        ),
    )
    for table, query in checks:
        rows = conn.execute(query).fetchall()
        for first, second in zip(rows, rows[1:]):
            if first[0] != second[0]:
                continue
            if _intervals_intersect(first[1], first[2], second[1], second[2]):
                errors.append(
                    f"{table}: rows for {first[0]!r} overlap at"
                    f" [{max(first[1], second[1])}, …)"
                )
    return errors


def _intervals_intersect(
    a_from: str, a_to: str | None, b_from: str, b_to: str | None
) -> bool:
    return (a_to is None or b_from < a_to) and (b_to is None or a_from < b_to)


# --- normalizers (reject, never coerce) ---------------------------------------


def normalize_cik(raw: object) -> str | None:
    """A CIK as the permanent 10-digit zero-padded key, or ``None``.

    The canonical result is EXACTLY ten ASCII digits. Overpadded input (more
    leading zeros than needed) is canonicalized down to ten, and input with more
    than ten significant digits — or any non-ASCII/non-decimal text — is
    rejected, so one numeric CIK never appears under two keys (R1).
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if text.lower().startswith("cik"):
        text = text[3:].lstrip(":").lstrip()
    if not text or not text.isascii() or not text.isdigit():
        return None
    significant = text.lstrip("0")
    if len(significant) > 10:
        return None
    return significant.zfill(10)


def entity_id_for(cik: str) -> str:
    """``cik:<10-digit>`` — the entity surrogate. A CIK never changes."""
    normalized = normalize_cik(cik)
    if normalized is None:
        raise ValueError(f"not a CIK: {cik!r}")
    return f"cik:{normalized}"


def normalize_ticker(raw: object) -> str | None:
    """Upper-cased trading symbol, or ``None`` when unusable."""
    if raw is None:
        return None
    text = nfc(str(raw)).strip().upper()
    if not text or not _TICKER_RE.match(text):
        return None
    return text


def normalize_cusip(raw: object) -> str | None:
    """A 9-character ``[0-9A-Z]`` CUSIP, or ``None``.

    Rejects rather than coerces: a short, long or punctuated value is a
    malformed source row, counted as such, never padded into a valid-looking
    identifier.
    """
    if raw is None:
        return None
    text = nfc(str(raw)).strip().upper()
    if not _CUSIP_RE.match(text):
        return None
    return text


def normalize_entity_name(raw: object) -> str | None:
    """NFC + collapsed whitespace, case preserved (it is a display name)."""
    if raw is None:
        return None
    text = _WHITESPACE_RE.sub(" ", nfc(str(raw))).strip()
    return text or None


def _upsert_entity(
    conn: sqlite3.Connection, entity_id: str, cik: str, raw: Mapping | None
) -> bool:
    """Insert the entity when absent; ``True`` when a row was created."""
    cursor = conn.execute(
        "INSERT INTO entities (entity_id, cik, raw) VALUES (?, ?, ?)"
        " ON CONFLICT (entity_id) DO NOTHING",
        (entity_id, cik, json.dumps(raw, ensure_ascii=False, sort_keys=True)
         if raw is not None else None),
    )
    return cursor.rowcount > 0


# --- the identity authority (securities.yaml) ---------------------------------


class IdentityRegistryError(ValueError):
    """The authority file is malformed; the message names the offender."""


@dataclass(frozen=True)
class IdentifierWindow:
    """One class's ownership of one identifier value over ``[from, to)``."""

    id_type: str
    value: str
    valid_from: str | None  # None = from the beginning of time
    valid_to: str | None  # None = to the end of time


@dataclass(frozen=True)
class IdentityClass:
    security_id: str
    class_: str | None
    identifiers: tuple[IdentifierWindow, ...]
    note: str
    review_state: str


@dataclass(frozen=True)
class Continuity:
    """A reviewed clearance of one flagged reuse gap."""

    id_type: str
    value: str
    gap_from: str
    gap_to: str
    note: str
    review_state: str


@dataclass(frozen=True)
class IdentityRegistry:
    classes: tuple[IdentityClass, ...]
    continuities: tuple[Continuity, ...]

    def class_for(self, security_id: str) -> IdentityClass | None:
        for entry in self.classes:
            if entry.security_id == security_id:
                return entry
        return None


@dataclass(frozen=True)
class OwnerWindow:
    """Who owns one identifier value over ``[valid_from, valid_to)``."""

    valid_from: str | None
    valid_to: str | None
    security_id: str
    id_state: str
    class_: str | None


def default_securities_text() -> str:
    """The packaged, version-controlled identity authority."""
    return (
        importlib.resources.files("populus")
        .joinpath("securities.yaml")
        .read_text(encoding="utf-8")
    )


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _iso(value: object, label: str) -> str:
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    # Require the canonical YYYY-MM-DD shape: `date.fromisoformat` also accepts
    # compact (`20200101`) and week-date (`2020-W01-1`) forms, which would be
    # retained noncanonical and then compared LEXICOGRAPHICALLY against canonical
    # dates — assigning the wrong owner at a boundary. Reject anything else.
    if not _ISO_DATE_RE.match(text):
        raise IdentityRegistryError(
            f"{label}: {value!r} is not a canonical ISO date (YYYY-MM-DD)"
        )
    try:
        date.fromisoformat(text)
    except ValueError:
        raise IdentityRegistryError(
            f"{label}: {value!r} is not a valid date (YYYY-MM-DD)"
        ) from None
    return text


def _optional_iso(value: object, label: str) -> str | None:
    if value is None:
        return None
    return _iso(value, label)


def load_identity_registry(source: str | Path | None = None) -> IdentityRegistry:
    """Parse and fully validate the authority file.

    *source* is a path to an override file (the CLI's ``--securities PATH``,
    mirroring ``--aliases``), or ``None`` for the packaged ``securities.yaml``.
    Every defect raises :class:`IdentityRegistryError` naming the offending
    entry or identifier value — a malformed authority is never partially
    applied.
    """
    if source is None:
        text = default_securities_text()
    else:
        text = Path(source).read_text(encoding="utf-8")
    return parse_identity_registry(text)


def parse_identity_registry(text: str) -> IdentityRegistry:
    """The validating parser behind :func:`load_identity_registry`.

    Split out so the loader's contract stays unambiguous — ``load`` always
    takes a path — while callers holding the YAML text (tests, future
    review tooling) can validate it without writing a file first.
    """
    data = yaml.safe_load(text)
    if data is None:
        data = {}
    if not isinstance(data, Mapping):
        raise IdentityRegistryError("securities file must be a mapping")

    classes = _load_classes(data.get("classes") or [])
    _validate_ownership_windows(classes)
    continuities = _load_continuities(data.get("continuities") or [], classes)
    return IdentityRegistry(classes=classes, continuities=continuities)


def _load_classes(entries: object) -> tuple[IdentityClass, ...]:
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        raise IdentityRegistryError("'classes' must be a list")
    loaded: list[IdentityClass] = []
    seen_ids: set[str] = set()
    for position, entry in enumerate(entries):
        label = f"class entry {position}"
        if not isinstance(entry, Mapping):
            raise IdentityRegistryError(f"{label}: must be a mapping")
        security_id = str(entry.get("security_id") or "").strip()
        label = f"class {security_id!r}" if security_id else label
        if not security_id:
            raise IdentityRegistryError(f"{label}: 'security_id' is required")
        if security_id.startswith(PROVISIONAL_ID_PREFIX):
            raise IdentityRegistryError(
                f"{label}: the {PROVISIONAL_ID_PREFIX!r} prefix is reserved for"
                " derived provisional ids and may not be declared"
            )
        if not _SECURITY_ID_RE.match(security_id):
            raise IdentityRegistryError(
                f"{label}: security_id must match {_SECURITY_ID_RE.pattern}"
            )
        if security_id in seen_ids:
            raise IdentityRegistryError(f"{label}: duplicate security_id")
        seen_ids.add(security_id)
        note = str(entry.get("note") or "").strip()
        if not note:
            raise IdentityRegistryError(
                f"{label}: a non-empty 'note' is required — every declaration is"
                " a reviewed commit and must say why it exists"
            )
        review_state = str(entry.get("review_state") or "reviewed").strip()
        if review_state not in ("auto", "reviewed", "disputed"):
            raise IdentityRegistryError(
                f"{label}: review_state must be auto|reviewed|disputed,"
                f" got {review_state!r}"
            )
        identifiers = _load_identifiers(entry.get("identifiers"), label)
        loaded.append(
            IdentityClass(
                security_id=security_id,
                class_=(str(entry["class"]).strip() if entry.get("class") else None),
                identifiers=identifiers,
                note=note,
                review_state=review_state,
            )
        )
    return tuple(loaded)


def _load_identifiers(raw: object, label: str) -> tuple[IdentifierWindow, ...]:
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or not raw:
        raise IdentityRegistryError(
            f"{label}: 'identifiers' must be a non-empty list"
        )
    windows: list[IdentifierWindow] = []
    seen: set[tuple[str, str, str | None, str | None]] = set()
    for position, item in enumerate(raw):
        item_label = f"{label} identifier {position}"
        if not isinstance(item, Mapping):
            raise IdentityRegistryError(f"{item_label}: must be a mapping")
        id_type = str(item.get("id_type") or "").strip()
        if id_type not in ID_TYPES:
            raise IdentityRegistryError(
                f"{item_label}: id_type must be one of {ID_TYPES}, got {id_type!r}"
            )
        value = normalize_cusip(item.get("value"))
        if value is None:
            raise IdentityRegistryError(
                f"{item_label}: {item.get('value')!r} is not a 9-character CUSIP"
            )
        window_from = _optional_iso(item.get("from"), f"{item_label} 'from'")
        window_to = _optional_iso(item.get("to"), f"{item_label} 'to'")
        bounded = window_from is not None and window_to is not None
        if bounded and window_from >= window_to:
            raise IdentityRegistryError(
                f"{item_label}: ownership window for {value} is empty"
                f" ({window_from} >= {window_to})"
            )
        key = (id_type, value, window_from, window_to)
        if key in seen:
            raise IdentityRegistryError(
                f"{item_label}: duplicate identifier entry for {value}"
            )
        seen.add(key)
        windows.append(IdentifierWindow(id_type, value, window_from, window_to))
    return tuple(windows)


def _window_sort_key(window: IdentifierWindow | OwnerWindow) -> tuple[int, str]:
    return (0, "") if window.valid_from is None else (1, window.valid_from)


def _validate_ownership_windows(classes: tuple[IdentityClass, ...]) -> None:
    """Every named value is owned for ALL time by exactly one class at a time.

    Disjoint, contiguous, covering. That totality is what makes
    :func:`target_for` a total function, keeps a provisional id one-per-value
    rather than one-per-window, and guarantees every cut piece has exactly one
    destination.
    """
    by_value: dict[tuple[str, str], list[tuple[IdentifierWindow, str]]] = {}
    for entry in classes:
        for window in entry.identifiers:
            by_value.setdefault((window.id_type, window.value), []).append(
                (window, entry.security_id)
            )
    for (id_type, value), items in sorted(by_value.items()):
        ordered = sorted(items, key=lambda item: _window_sort_key(item[0]))
        first_window, first_owner = ordered[0]
        if first_window.valid_from is not None:
            raise IdentityRegistryError(
                f"{id_type} {value}: no owner before {first_window.valid_from}"
                f" (class {first_owner!r} is the earliest) — the first ownership"
                " window for a value must be unbounded below"
            )
        for (previous, previous_owner), (current, current_owner) in zip(
            ordered, ordered[1:]
        ):
            if current.valid_from is None:
                raise IdentityRegistryError(
                    f"{id_type} {value}: classes {previous_owner!r} and"
                    f" {current_owner!r} are both unbounded below — only the"
                    " earliest ownership window for a value may be unbounded below"
                )
            if previous.valid_to is None:
                raise IdentityRegistryError(
                    f"{id_type} {value}: classes {previous_owner!r} and"
                    f" {current_owner!r} overlap — {previous_owner!r} owns it to"
                    " the end of time"
                )
            if previous.valid_to > current.valid_from:
                raise IdentityRegistryError(
                    f"{id_type} {value}: classes {previous_owner!r} and"
                    f" {current_owner!r} overlap on"
                    f" [{current.valid_from}, {previous.valid_to})"
                )
            if previous.valid_to < current.valid_from:
                raise IdentityRegistryError(
                    f"{id_type} {value}: no owner on"
                    f" [{previous.valid_to}, {current.valid_from}) — ownership"
                    " windows must be contiguous"
                )
        last_window, last_owner = ordered[-1]
        if last_window.valid_to is not None:
            raise IdentityRegistryError(
                f"{id_type} {value}: no owner from {last_window.valid_to} onward"
                f" (class {last_owner!r} is the latest) — the last ownership"
                " window for a value must be unbounded above"
            )


def _load_continuities(
    entries: object, classes: tuple[IdentityClass, ...]
) -> tuple[Continuity, ...]:
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        raise IdentityRegistryError("'continuities' must be a list")
    owners: dict[tuple[str, str], set[str]] = {}
    for entry in classes:
        for window in entry.identifiers:
            owners.setdefault((window.id_type, window.value), set()).add(
                entry.security_id
            )
    loaded: list[Continuity] = []
    for position, entry in enumerate(entries):
        label = f"continuity entry {position}"
        if not isinstance(entry, Mapping):
            raise IdentityRegistryError(f"{label}: must be a mapping")
        raw_anchor = entry.get("anchor")
        if not isinstance(raw_anchor, Mapping):
            raise IdentityRegistryError(
                f"{label}: 'anchor' must be a mapping with id_type and value"
            )
        id_type = str(raw_anchor.get("id_type") or "").strip()
        if id_type not in ID_TYPES:
            raise IdentityRegistryError(
                f"{label}: anchor id_type must be one of {ID_TYPES},"
                f" got {id_type!r}"
            )
        value = normalize_cusip(raw_anchor.get("value"))
        if value is None:
            raise IdentityRegistryError(
                f"{label}: anchor {raw_anchor.get('value')!r} is not a"
                " 9-character CUSIP"
            )
        note = str(entry.get("note") or "").strip()
        if not note:
            raise IdentityRegistryError(
                f"{label}: a non-empty 'note' is required — the evidence that"
                f" the {value} gap is a reporting gap, not a reassignment"
            )
        review_state = str(entry.get("review_state") or "reviewed").strip()
        if review_state not in ("auto", "reviewed", "disputed"):
            raise IdentityRegistryError(
                f"{label}: review_state must be auto|reviewed|disputed,"
                f" got {review_state!r}"
            )
        gap_from = _iso(entry.get("gap_from"), f"{label} 'gap_from'")
        gap_to = _iso(entry.get("gap_to"), f"{label} 'gap_to'")
        if gap_from >= gap_to:
            raise IdentityRegistryError(
                f"{label}: gap_from must precede gap_to for {value}"
                f" ({gap_from} >= {gap_to})"
            )
        holders = owners.get((id_type, value), set())
        if len(holders) > 1:
            raise IdentityRegistryError(
                f"{label}: {value} is owned by {len(holders)} classes"
                f" ({', '.join(sorted(holders))}) — a declared ownership"
                " boundary already resolves that gap, so a continuity is"
                " ambiguous"
            )
        loaded.append(
            Continuity(id_type, value, gap_from, gap_to, note, review_state)
        )
    return tuple(loaded)


# --- ids, ownership windows, interval cutting ---------------------------------


def anchor(id_type: str, value: str) -> dict[str, str]:
    """The identifier anchor a provisional id is derived from."""
    return {"id_type": id_type, "value": value}


def provisional_security_id(anchor_object: Mapping[str, str]) -> str:
    """``sec:prov:<32 hex>`` — deterministic, explicitly NOT durable.

    Derived from the RFC 8785 canonical serialization of the anchor, so two
    clean rebuilds of the same corpus mint byte-identical ids while carrying
    no claim that the id survives a reviewed declaration: it is superseded
    exactly once, by a recorded promotion (see ``security_supersessions``).
    """
    digest = hashlib.sha256(canonical_json(anchor_object)).hexdigest()
    return f"{PROVISIONAL_ID_PREFIX}{digest[:32]}"


def owner_windows(
    registry: IdentityRegistry, id_type: str, value: str
) -> tuple[OwnerWindow, ...]:
    """Who owns ``(id_type, value)``, when — sorted, total over all time.

    A value named by no class yields exactly one unbounded provisional window.
    Adjacent windows owned by the same class are coalesced, so cutting can
    never split one row into two same-owner pieces (which would diverge from
    a clean build's single merged interval).
    """
    windows: list[OwnerWindow] = []
    for entry in registry.classes:
        for window in entry.identifiers:
            if (window.id_type, window.value) != (id_type, value):
                continue
            windows.append(
                OwnerWindow(
                    valid_from=window.valid_from,
                    valid_to=window.valid_to,
                    security_id=entry.security_id,
                    id_state="declared",
                    class_=entry.class_,
                )
            )
    if not windows:
        return (
            OwnerWindow(
                valid_from=None,
                valid_to=None,
                security_id=provisional_security_id(anchor(id_type, value)),
                id_state="provisional",
                class_=None,
            ),
        )
    windows.sort(key=_window_sort_key)
    coalesced: list[OwnerWindow] = [windows[0]]
    for window in windows[1:]:
        previous = coalesced[-1]
        if (
            previous.security_id == window.security_id
            and previous.valid_to == window.valid_from
        ):
            coalesced[-1] = OwnerWindow(
                valid_from=previous.valid_from,
                valid_to=window.valid_to,
                security_id=previous.security_id,
                id_state=previous.id_state,
                class_=previous.class_,
            )
        else:
            coalesced.append(window)
    return tuple(coalesced)


def target_for(
    registry: IdentityRegistry, id_type: str, value: str, as_of_date: str
) -> tuple[str, str, str | None]:
    """``(security_id, id_state, class)`` owning *value* on *as_of_date*.

    Total by construction: the loader proves declared windows are disjoint,
    contiguous and covering, and an undeclared value has one unbounded
    provisional window.
    """
    for window in owner_windows(registry, id_type, value):
        if window.valid_from is not None and as_of_date < window.valid_from:
            continue
        if window.valid_to is not None and as_of_date >= window.valid_to:
            continue
        return (window.security_id, window.id_state, window.class_)
    raise AssertionError(  # pragma: no cover — the covering rule forbids it
        f"no owner for {id_type} {value} on {as_of_date}"
    )


def _later(first: str | None, second: str | None) -> str | None:
    """``max`` treating ``None`` as the beginning of time."""
    if first is None:
        return second
    if second is None:
        return first
    return max(first, second)


def _earlier(first: str | None, second: str | None) -> str | None:
    """``min`` treating ``None`` as the end of time."""
    if first is None:
        return second
    if second is None:
        return first
    return min(first, second)


def _nonempty(start: str | None, end: str | None) -> bool:
    return start is None or end is None or start < end


def cut_interval(
    interval: tuple[str | None, str | None], windows: Sequence[OwnerWindow]
) -> tuple[tuple[str, str | None, str | None], ...]:
    """Partition ``[valid_from, valid_to)`` at every ownership boundary it crosses.

    Returns ``(security_id, from, to)`` pieces in chronological order. A row
    wholly inside one window yields exactly one piece with that window's
    owner; a row crossing a boundary yields one piece per window it touches.
    The pieces always reconstruct the input exactly — no lost or duplicated
    days — which the caller asserts before writing anything.
    """
    valid_from, valid_to = interval
    pieces: list[tuple[str, str | None, str | None]] = []
    for window in windows:
        start = _later(valid_from, window.valid_from)
        end = _earlier(valid_to, window.valid_to)
        if not _nonempty(start, end):
            continue
        pieces.append((window.security_id, start, end))
    return tuple(pieces)


def _assert_reconstructs(
    interval: tuple[str | None, str | None],
    pieces: Sequence[tuple[str, str | None, str | None]],
) -> None:
    """The totality guard: the pieces cover the input exactly once."""
    if not pieces:
        raise AssertionError(f"interval {interval} has no owner")
    if pieces[0][1] != interval[0] or pieces[-1][2] != interval[1]:
        raise AssertionError(
            f"interval {interval} was not reconstructed by {pieces}"
        )
    for previous, current in zip(pieces, pieces[1:]):
        if previous[2] != current[1]:
            raise AssertionError(
                f"interval {interval} pieces are not contiguous: {pieces}"
            )


def _next_day(iso: str) -> str:
    return (date.fromisoformat(iso) + timedelta(days=1)).isoformat()


def _days_between(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def union_intervals(
    existing: Iterable[tuple[str, str | None]], observed_dates: Iterable[str]
) -> tuple[tuple[str, str | None], ...]:
    """Adjacency-only union of validity intervals (DC2/R9).

    Each observed date contributes the unit interval ``[d, d+1)``. Two
    intervals merge only when they overlap or MEET exactly — a gap of even one
    day is never bridged, because a fails-to-deliver row is a point-in-time
    settlement-date observation and continuity across a gap would be fabricated
    (G14).

    Union with adjacency merging is commutative, associative and idempotent,
    so any partition, order or incremental arrival of the same observation set
    yields the identical canonical partition.
    """
    intervals: list[list[str | None]] = [[start, end] for start, end in existing]
    for observed in observed_dates:
        intervals.append([observed, _next_day(observed)])
    if not intervals:
        return ()
    intervals.sort(key=lambda item: (item[0], item[1] is None, item[1] or ""))
    merged: list[list[str | None]] = [intervals[0]]
    for start, end in intervals[1:]:
        current = merged[-1]
        if current[1] is None:
            # An open-ended interval absorbs everything at or after its start.
            continue
        if start <= current[1]:
            current[1] = None if end is None else max(current[1], end)
        else:
            merged.append([start, end])
    return tuple((str(start), end) for start, end in merged)


# --- as-of resolution (fail-closed — G14/G3) ----------------------------------


def applicable_value(
    rows: Iterable[tuple[str, str | None, object, str]], as_of_date: str
):
    """The single applicable, undisputed payload for *as_of_date*, or ``None``.

    THE resolution rule, written once: rows are
    ``(valid_from, valid_to, payload, review_state)``; a row applies only
    inside its half-open ``[valid_from, valid_to)`` window (``valid_to`` NULL =
    open); more than one applicable row is an ambiguity, not a preference
    order; and a ``disputed`` row never resolves (R18).

    Every resolver and the bootstrap's batched in-memory index go through this
    function, so the SQL path and the bulk path can never drift apart.
    """
    hits = [
        row
        for row in rows
        if row[0] <= as_of_date and (row[1] is None or as_of_date < row[1])
    ]
    if len(hits) != 1 or hits[0][3] == "disputed":
        return None
    return hits[0][2]


@dataclass(frozen=True)
class EntityRef:
    """A resolved entity. ``name`` is non-null by construction (DC1).

    There is exactly one applicable name per entity per date, or the resolver
    returns ``None`` — an ``EntityRef`` never carries an ambiguous or missing
    name.
    """

    entity_id: str
    cik: str
    name: str


def resolve_entity_by_cik(
    conn: sqlite3.Connection, cik: str, as_of_date: str
) -> EntityRef | None:
    """The entity and its single applicable name on *as_of_date*, or ``None``."""
    normalized = normalize_cik(cik)
    if normalized is None:
        return None
    row = conn.execute(
        "SELECT entity_id FROM entities WHERE cik = ?", (normalized,)
    ).fetchone()
    if row is None:
        return None
    entity_id = row[0]
    name = applicable_value(
        [
            (valid_from, valid_to, value, "auto")
            for value, valid_from, valid_to in conn.execute(
                "SELECT name, valid_from, valid_to FROM entity_names"
                " WHERE entity_id = ?",
                (entity_id,),
            )
        ],
        as_of_date,
    )
    if name is None:
        # No applicable name, or more than one: fail closed rather than pick.
        return None
    return EntityRef(entity_id=entity_id, cik=normalized, name=name)


def resolve_cusip(
    conn: sqlite3.Connection, cusip: str, as_of_date: str
) -> str | None:
    """The security a CUSIP identified on *as_of_date*, or ``None``.

    Precedence-aware and fail-closed (:data:`IDENTITY_SOURCE_PRECEDENCE`): the
    DEFINITIONAL 13(f)-list layer decides whenever it covers the date, and the
    FTD ``security_identifiers`` layer is consulted ONLY when no definitional
    interval covers it. A definitional layer that covers the date but resolves
    ambiguously (more than one row) or is ``disputed`` returns ``None`` and NEVER
    falls through to FTD — otherwise a disputed higher-precedence binding would
    silently resolve through a lower one (F12/R18).

    Still ``None`` when the value is malformed, when no interval of any source
    covers the date, when more than one row applies, or when the applicable row
    is ``disputed`` (R18: an unreviewed reuse candidate resolves nowhere).
    """
    value = normalize_cusip(cusip)
    if value is None:
        return None
    list_rows = conn.execute(
        "SELECT valid_from, valid_to, security_id, review_state"
        " FROM security_list_intervals WHERE id_type = 'cusip' AND value = ?",
        (value,),
    ).fetchall()
    if any(
        row[0] <= as_of_date and (row[1] is None or as_of_date < row[1])
        for row in list_rows
    ):
        # The definitional layer covers this date and OWNS the decision.
        # `applicable_value` returns None for ambiguity/dispute; we deliberately
        # do NOT fall through to FTD in that case (fail-closed precedence).
        return applicable_value(list_rows, as_of_date)
    return applicable_value(
        conn.execute(
            "SELECT valid_from, valid_to, security_id, review_state"
            " FROM security_identifiers WHERE id_type = 'cusip' AND value = ?",
            (value,),
        ).fetchall(),
        as_of_date,
    )


def resolve_security_name(
    conn: sqlite3.Connection, security_id: str, as_of_date: str
) -> str | None:
    """The canonical issuer name for *security_id* on *as_of_date*, or ``None``.

    The definitional 13(f) list is the SOLE persisted name source (amended R7):
    this returns the covering quarter's SEC canonical name, or ``None`` when no
    quarter covers the date, more than one does, or the covering row is
    ``disputed`` — never a fabricated fallback. `securities.yaml` carries no name
    field today; FTD issuer names are observed but not persisted.
    """
    return applicable_value(
        conn.execute(
            "SELECT valid_from, valid_to, issuer_name, review_state"
            " FROM security_list_intervals WHERE security_id = ?",
            (security_id,),
        ).fetchall(),
        as_of_date,
    )


def resolve_ticker_as_of(
    conn: sqlite3.Connection, ticker: str, as_of_date: str
) -> str | None:
    """The entity a ticker belonged to on *as_of_date*, or ``None``."""
    symbol = normalize_ticker(ticker)
    if symbol is None:
        return None
    return applicable_value(
        conn.execute(
            "SELECT valid_from, valid_to, entity_id, review_state"
            " FROM entity_tickers WHERE ticker = ?",
            (symbol,),
        ).fetchall(),
        as_of_date,
    )


def resolve_superseded(
    conn: sqlite3.Connection, old_security_id: str
) -> tuple[str, ...]:
    """Every successor of *old_security_id*, sorted (one-to-many)."""
    return tuple(
        sorted(
            successor
            for (successor,) in conn.execute(
                "SELECT security_id FROM security_supersessions"
                " WHERE old_security_id = ?",
                (old_security_id,),
            )
        )
    )


def resolve_security_successor(
    conn: sqlite3.Connection, old_security_id: str
) -> str | None:
    """The single successor, or ``None`` — fail-closed on a split fan-out."""
    successors = resolve_superseded(conn, old_security_id)
    return successors[0] if len(successors) == 1 else None


# --- reuse review -------------------------------------------------------------


@dataclass(frozen=True)
class ReuseDecision:
    """The review verdict for one identifier's observed-date gaps."""

    id_type: str
    value: str
    gaps: tuple[tuple[str, str], ...]  # (first unobserved day, next observed day)
    disputed: bool
    cleared: bool

    @property
    def flagged(self) -> bool:
        """A horizon-scale gap exists at all (a reuse CANDIDATE)."""
        return bool(self.gaps)


def reuse_review_decisions(
    conn: sqlite3.Connection,
    anchor_object: Mapping[str, str],
    registry: IdentityRegistry,
    horizon_days: int = REUSE_REVIEW_HORIZON_DAYS,
) -> ReuseDecision:
    """Decide whether one identifier's gaps are reuse candidates (R18).

    The horizon is a REVIEW trigger, never a validity or identity rule: it
    reads the persisted intervals and touches nothing, so flagging can never
    widen a validity interval or bridge a gap. A gap is explained — and so not
    disputed — when a declared ownership boundary falls inside it, or when a
    reviewed ``continuity`` covers it.
    """
    id_type = anchor_object["id_type"]
    value = anchor_object["value"]
    intervals = conn.execute(
        "SELECT valid_from, valid_to FROM security_identifiers"
        " WHERE id_type = ? AND value = ? ORDER BY valid_from",
        (id_type, value),
    ).fetchall()
    boundaries = {
        window.valid_from
        for window in owner_windows(registry, id_type, value)
        if window.valid_from is not None
    }
    continuities = [
        continuity
        for continuity in registry.continuities
        if (continuity.id_type, continuity.value) == (id_type, value)
        # Only a REVIEWED continuity clears reuse (R16/R18). An `auto` or
        # `disputed` continuity must NOT make both eras resolvable — that would
        # silently conflate potentially distinct securities (QA-F1). Fail closed.
        and continuity.review_state == "reviewed"
    ]

    gaps: list[tuple[str, str]] = []
    disputed = False
    cleared = False
    for previous, current in zip(intervals, intervals[1:]):
        gap_start, gap_end = previous[1], current[0]
        if gap_start is None or gap_start >= gap_end:
            continue
        if _days_between(gap_start, gap_end) < horizon_days:
            continue
        gaps.append((gap_start, gap_end))
        if any(gap_start <= boundary <= gap_end for boundary in boundaries):
            continue
        if any(
            continuity.gap_from <= gap_start and gap_end <= continuity.gap_to
            for continuity in continuities
        ):
            cleared = True
            continue
        disputed = True
    return ReuseDecision(
        id_type=id_type,
        value=value,
        gaps=tuple(gaps),
        disputed=disputed,
        cleared=cleared and not disputed,
    )


# --- write helpers shared by the seeders and the migration --------------------


def authority_state(
    registry: IdentityRegistry, security_id: str
) -> tuple[str, str | None, str]:
    """``(id_state, class, review_state)`` the authority declares for an id."""
    declared = registry.class_for(security_id)
    if declared is not None:
        return ("declared", declared.class_, declared.review_state)
    return ("provisional", None, "auto")


def confidence_for(review_state: str) -> str:
    """A disputed binding is explicitly low-confidence, never silently high."""
    return "low" if review_state == "disputed" else "high"


def ensure_security(
    conn: sqlite3.Connection,
    security_id: str,
    registry: IdentityRegistry,
) -> bool:
    """Create the security when absent; ``True`` when a row was created."""
    id_state, class_, review_state = authority_state(registry, security_id)
    cursor = conn.execute(
        "INSERT INTO securities (security_id, id_state, class, review_state)"
        " VALUES (?, ?, ?, ?) ON CONFLICT (security_id) DO NOTHING",
        (security_id, id_state, class_, review_state),
    )
    return cursor.rowcount > 0


def _identifier_raw(
    provenance: str, id_type: str, value: str, valid_from, valid_to
) -> str:
    """Deterministic RFC-8785 raw provenance for one security_identifiers row (R1).

    Never NULL: every persisted identifier interval carries a canonical record of
    its source and the coverage it represents. Deterministic in
    (source, id_type, value, interval), so a populated build and a clean build
    write byte-identical raw and a replay rewrites nothing.
    """
    return canonical_json(
        {
            "source": provenance,
            "id_type": id_type,
            "value": value,
            "valid_from": valid_from,
            "valid_to": valid_to,
        }
    ).decode("utf-8")


#: Columns of security_list_intervals, in the order the seeder and the migration
#: both bind them. Named once so the two write paths cannot drift.
_LIST_INTERVAL_COLUMNS = (
    "security_id",
    "id_type",
    "value",
    "valid_from",
    "valid_to",
    "quarter",
    "issuer_name",
    "security_class",
    "is_option",
    "status_flag",
    "provenance",
    "confidence",
    "review_state",
    "license_id",
    "source_url",
    "list_sha256",
    "retrieved_at",
    "raw_path",
    "row_ordinal",
    "parser_version",
    "normalization_version",
    "source_row",
    "raw",
)

#: Positional indices into a `_LIST_INTERVAL_COLUMNS`-ordered row tuple, derived
#: from the tuple itself so adding a column can never silently desync the
#: migration's rewrite (which previously hard-coded 0/3/4/11/12/21).
_LI = {name: index for index, name in enumerate(_LIST_INTERVAL_COLUMNS)}


def list_interval_raw(
    *,
    provenance: str,
    id_type: str,
    value: str,
    valid_from: str,
    valid_to: str | None,
    quarter: str,
    list_sha256: str,
    row_ordinal: int | None,
    source_row: str | None,
) -> str:
    """Deterministic RFC-8785 raw provenance for one list-interval row (§5.1).

    A function of (source, identity, interval, quarter, retrieval sha, source
    line) only — never of what existed before — so a clean build, a populated
    reseed and a post-migration recut write byte-identical raw and a same-SHA
    replay rewrites nothing.

    ``source_row`` is the VERBATIM source line the identity was read from (the
    80-char fixed-width text row, or the reconstructed PDF data row). Round-1 F9:
    without it the stored ``raw`` was synthesized identity/interval metadata only,
    so a published fact could not be audited against its exact source line once
    the gitignored cache was gone. It is a pure function of the source row, so a
    recut piece reproduces it byte-for-byte.
    """
    return canonical_json(
        {
            "source": provenance,
            "id_type": id_type,
            "value": value,
            "valid_from": valid_from,
            "valid_to": valid_to,
            "quarter": quarter,
            "list_sha256": list_sha256,
            "row_ordinal": row_ordinal,
            "source_row": source_row,
        }
    ).decode("utf-8")


#: The one INSERT statement both the single-row and the batched write paths use,
#: built from `_LIST_INTERVAL_COLUMNS` so the column list, the placeholder count
#: and the bind order can never drift apart.
_LIST_INTERVAL_INSERT = (
    "INSERT INTO security_list_intervals ("
    + ", ".join(_LIST_INTERVAL_COLUMNS)
    + ") VALUES ("
    + ", ".join("?" for _ in _LIST_INTERVAL_COLUMNS)
    + ") ON CONFLICT (value, valid_from) DO NOTHING"
)


def list_interval_row(
    *,
    security_id: str,
    value: str,
    valid_from: str,
    valid_to: str | None,
    quarter: str,
    issuer_name: str | None,
    security_class: str | None,
    is_option: bool,
    status_flag: str,
    provenance: str,
    license_id: str,
    review_state: str,
    source_url: str,
    list_sha256: str,
    retrieved_at: str | None,
    raw_path: str | None,
    row_ordinal: int | None,
    parser_version: str,
    normalization_version: str,
    source_row: str | None,
    id_type: str = "cusip",
) -> tuple:
    """One `_LIST_INTERVAL_COLUMNS`-ordered bind tuple, incl. the derived ``raw``.

    Pure — no database access — so the seeder can build a whole quarter's rows in
    memory and hand them to :func:`insert_list_intervals` as ONE batch (round-1
    F10) instead of issuing per-row SQL.
    """
    return (
        security_id,
        id_type,
        value,
        valid_from,
        valid_to,
        quarter,
        issuer_name,
        security_class,
        1 if is_option else 0,
        status_flag,
        provenance,
        confidence_for(review_state),
        review_state,
        license_id,
        source_url,
        list_sha256,
        retrieved_at,
        raw_path,
        row_ordinal,
        parser_version,
        normalization_version,
        source_row,
        list_interval_raw(
            provenance=provenance,
            id_type=id_type,
            value=value,
            valid_from=valid_from,
            valid_to=valid_to,
            quarter=quarter,
            list_sha256=list_sha256,
            row_ordinal=row_ordinal,
            source_row=source_row,
        ),
    )


def insert_list_intervals(
    conn: sqlite3.Connection, rows: Sequence[tuple], *, mutations
) -> int:
    """Insert many definitional list intervals in ONE ``executemany`` (F10).

    Set-based by construction: a ~22,000-row quarter costs one prepared statement
    and one batch, not O(rows) round trips. ``ON CONFLICT (value, valid_from) DO
    NOTHING`` keeps a same-list reseed replay-zero, exactly as the single-row path
    did. Mutation accounting is taken from ``total_changes`` (rather than
    ``rowcount``, which is not defined per-statement across an ``executemany``
    with a DO NOTHING conflict clause), so a skipped duplicate is NOT counted and
    an identical replay still reports zero writes.
    """
    if not rows:
        return 0
    before = conn.total_changes
    conn.executemany(_LIST_INTERVAL_INSERT, rows)
    inserted = conn.total_changes - before
    mutations.list_intervals_inserted += inserted
    return inserted


def upsert_list_interval(
    conn: sqlite3.Connection,
    *,
    mutations,
    **fields,
) -> None:
    """Insert ONE definitional list interval, idempotent and replay-zero.

    A thin wrapper over the batched path so both share one statement, one bind
    order and one accounting rule. ``ON CONFLICT (value, valid_from) DO NOTHING``
    makes a same-list reseed a no-op (the seeder guarantees, before calling this,
    that any pre-existing quarter rows carry the SAME ``list_sha256`` — a changed
    hash is a hard error or an explicit transactional replacement, never a silent
    overwrite). Every actual insert is counted (R12: no uncounted write).
    """
    insert_list_intervals(
        conn, [list_interval_row(**fields)], mutations=mutations
    )


def rewrite_identifier_intervals(
    conn: sqlite3.Connection,
    *,
    security_id: str,
    id_type: str,
    value: str,
    observed_dates: Sequence[str],
    provenance: str,
    license_id: str,
    review_state: str,
    mutations,
) -> None:
    """Union *observed_dates* into one owner's persisted validity intervals.

    Owner-scoped by contract: the caller has already grouped observations by
    ownership window, so this never merges across a declared boundary. A run
    that observes nothing new is a no-op and records no mutation.
    """
    before = tuple(
        (row[0], row[1])
        for row in conn.execute(
            "SELECT valid_from, valid_to FROM security_identifiers"
            " WHERE security_id = ? AND id_type = ? AND value = ?"
            " ORDER BY valid_from",
            (security_id, id_type, value),
        )
    )
    after = union_intervals(before, observed_dates)
    if after == before:
        return
    before_by_start = dict(before)
    after_by_start = dict(after)
    for start, end in after:
        if start not in before_by_start:
            mutations.intervals_inserted += 1
        elif before_by_start[start] != end:
            mutations.intervals_extended += 1
    for start, _end in before:
        if start not in after_by_start:
            mutations.intervals_removed += 1
    conn.execute(
        "DELETE FROM security_identifiers"
        " WHERE security_id = ? AND id_type = ? AND value = ?",
        (security_id, id_type, value),
    )
    conn.executemany(
        "INSERT INTO security_identifiers (security_id, id_type, value,"
        " valid_from, valid_to, provenance, confidence, review_state, license_id,"
        " raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                security_id,
                id_type,
                value,
                start,
                end,
                provenance,
                confidence_for(review_state),
                review_state,
                license_id,
                _identifier_raw(provenance, id_type, value, start, end),
            )
            for start, end in after
        ],
    )


def apply_entity_candidates(
    conn: sqlite3.Connection, security_id: str, candidates: Iterable[str]
) -> str:
    """Accumulate resolved entity candidates and re-derive the link state (DC4).

    The candidate set is a monotone union, so the outcome is independent of
    observation order and of how the corpus was partitioned: zero candidates
    stay ``unresolved``, exactly one stamps ``entity_id`` and becomes
    ``resolved``, and two or more become ``conflict`` with a NULL
    ``entity_id`` — sticky, because the set only ever grows.

    Returns ``'stamped'``, ``'conflicted'``, ``'cleared'`` or ``'unchanged'``.
    """
    row = conn.execute(
        "SELECT entity_id, entity_candidates, entity_link_state FROM securities"
        " WHERE security_id = ?",
        (security_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"unknown security {security_id!r}")
    previous_entity, previous_json, previous_state = row
    merged = sorted(set(json.loads(previous_json)) | {c for c in candidates if c})
    if len(merged) == 0:
        entity_id, link_state = None, "unresolved"
    elif len(merged) == 1:
        entity_id, link_state = merged[0], "resolved"
    else:
        entity_id, link_state = None, "conflict"
    merged_json = json.dumps(merged, ensure_ascii=False)
    if (entity_id, merged_json, link_state) == (
        previous_entity,
        previous_json,
        previous_state,
    ):
        return "unchanged"
    conn.execute(
        "UPDATE securities SET entity_id = ?, entity_candidates = ?,"
        " entity_link_state = ? WHERE security_id = ?",
        (entity_id, merged_json, link_state, security_id),
    )
    if link_state == "resolved":
        return "stamped"
    if link_state == "conflict":
        return "conflicted"
    return "cleared"


# --- registry-revision migration (R17) ----------------------------------------


def reconcile_identity_registry(conn: sqlite3.Connection, registry: IdentityRegistry):
    """Apply the current authority to an already-populated database.

    Requires an OPEN transaction and never issues ``BEGIN``/``COMMIT``/
    ``ROLLBACK`` itself: SQLite transactions do not nest, and the whole
    bootstrap — this migration plus both seeding passes — must commit or roll
    back as one unit, so exactly one caller owns the bracket.

    Returns the ``Mutations`` it performed. Every ``Mutations`` field is zero
    when the authority has not changed.
    """
    # Imported here, not at module top: bootstrap.py imports this module at
    # import time (the `canonical`/`load` precedent).
    from populus.identity.bootstrap import Mutations

    if not conn.in_transaction:
        raise sqlite3.ProgrammingError(
            "reconcile_identity_registry requires an open transaction: the"
            " migration and the seeding passes must commit or roll back"
            " together (use reconcile_only for a standalone reconcile)"
        )
    mutations = Mutations()

    securities = {
        row[0]: row
        for row in conn.execute(
            "SELECT security_id, id_state, class, entity_id, entity_candidates,"
            " entity_link_state, review_state FROM securities ORDER BY security_id"
        )
    }
    rows = conn.execute(
        "SELECT security_id, id_type, value, valid_from, valid_to, provenance,"
        " confidence, review_state, license_id FROM security_identifiers"
        " ORDER BY id_type, value, valid_from, security_id"
    ).fetchall()
    # The definitional 13(f)-list intervals are a second FK-to-securities table
    # that carries validity intervals, so a boundary revision must recut them
    # exactly as it recuts the FTD identifiers (RUN M2-5). Read every column in
    # `_LIST_INTERVAL_COLUMNS` order so a cut piece can be re-inserted verbatim
    # save its owner, interval and authority-derived review verdict.
    list_rows = conn.execute(
        "SELECT " + ", ".join(_LIST_INTERVAL_COLUMNS)
        + " FROM security_list_intervals"
        " ORDER BY id_type, value, valid_from, security_id"
    ).fetchall()

    window_cache: dict[tuple[str, str], tuple[OwnerWindow, ...]] = {}

    def windows_for(id_type: str, value: str) -> tuple[OwnerWindow, ...]:
        key = (id_type, value)
        if key not in window_cache:
            window_cache[key] = owner_windows(registry, id_type, value)
        return window_cache[key]

    # A security's destination set is the union of its rows' piece owners: it
    # stays put when that set is exactly itself, is RENAMED when every piece
    # lands on one other id, and is SPLIT when the pieces land on several —
    # including the retained-owner case where it is one of its own destinations.
    row_plans: list[tuple[tuple, tuple[tuple[str, str | None, str | None], ...]]] = []
    targets: dict[str, set[str]] = {}
    for row in rows:
        old_id, id_type, value, valid_from, valid_to = (
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
        )
        pieces = cut_interval((valid_from, valid_to), windows_for(id_type, value))
        _assert_reconstructs((valid_from, valid_to), pieces)
        row_plans.append((row, pieces))
        targets.setdefault(old_id, set()).update(piece[0] for piece in pieces)
    # The list intervals feed the SAME destination sets: a security owning a
    # value only through the definitional list must still rename/split when a
    # revision moves that value, and a security owning it through BOTH tables
    # takes the union of both tables' piece owners (their intervals differ, so
    # one table alone can miss a boundary the other crosses).
    list_row_plans: list[
        tuple[tuple, tuple[tuple[str, str | None, str | None], ...]]
    ] = []
    for row in list_rows:
        old_id, id_type, value, valid_from, valid_to = (
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
        )
        pieces = cut_interval((valid_from, valid_to), windows_for(id_type, value))
        _assert_reconstructs((valid_from, valid_to), pieces)
        list_row_plans.append((row, pieces))
        targets.setdefault(old_id, set()).update(piece[0] for piece in pieces)
    for security_id in securities:
        targets.setdefault(security_id, {security_id})

    renames: dict[str, str] = {}
    splits: dict[str, set[str]] = {}
    for old_id, destinations in sorted(targets.items()):
        if destinations == {old_id}:
            continue
        if len(destinations) == 1:
            renames[old_id] = next(iter(destinations))
        else:
            splits[old_id] = destinations

    if not renames and not splits:
        # Every piece stayed with its current owner, so nothing moved and no
        # interval crossed a boundary (owner_windows coalesces adjacent
        # same-owner windows, so a same-owner row is never split).
        _align_authority_metadata(conn, registry, securities, mutations)
        _reconcile_review_state(conn, registry, mutations)
        _reconcile_list_review_state(conn, registry, mutations)
        return mutations

    # 1 — every destination exists before anything points at it.
    #
    # `all_destinations` is also what keeps a CHAINED revision safe: a declared
    # class can simultaneously lose its current binding to a new class and
    # receive a binding that used to be provisional. It is then both a rename
    # source and a rename destination, so it must survive — deleting it would
    # orphan the rows about to land on it.
    all_destinations: set[str] = set(renames.values())
    for destinations in splits.values():
        all_destinations |= destinations
    for security_id in sorted(all_destinations - set(securities)):
        if ensure_security(conn, security_id, registry):
            mutations.securities_created += 1

    # 2 — cut and move the identifier rows (the FK table that carries intervals).
    deletes: list[tuple[str, str, str, str]] = []
    inserts: list[tuple] = []
    for row, pieces in row_plans:
        old_id, id_type, value = row[0], row[1], row[2]
        valid_from, valid_to = row[3], row[4]
        if len(pieces) == 1 and pieces[0] == (old_id, valid_from, valid_to):
            continue
        deletes.append((old_id, id_type, value, valid_from))
        if len(pieces) > 1:
            mutations.intervals_cut += 1
        else:
            mutations.intervals_moved += 1
        for destination, piece_from, piece_to in pieces:
            _state, _class, review_state = authority_state(registry, destination)
            inserts.append(
                (
                    destination,
                    id_type,
                    value,
                    piece_from,
                    piece_to,
                    row[5],
                    confidence_for(review_state),
                    review_state,
                    row[8],
                    _identifier_raw(row[5], id_type, value, piece_from, piece_to),
                )
            )
    if deletes:
        conn.executemany(
            "DELETE FROM security_identifiers WHERE security_id = ?"
            " AND id_type = ? AND value = ? AND valid_from = ?",
            deletes,
        )
    if inserts:
        conn.executemany(
            "INSERT INTO security_identifiers (security_id, id_type, value,"
            " valid_from, valid_to, provenance, confidence, review_state,"
            " license_id, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            inserts,
        )

    # 2b — cut and move the definitional list intervals the same way. A piece
    # keeps every source/provenance column of its origin row (quarter, issuer
    # name, class, retrieval provenance, row ordinal AND the verbatim source_row);
    # only its owner, interval, authority-derived review verdict and deterministic
    # raw change. Carrying source_row through unchanged is what keeps a recut fact
    # auditable against its origin line (F9) while `raw` — a pure function of that
    # line plus the new interval — stays byte-deterministic. This is what makes
    # seed-then-revise converge bit-for-bit with revise-then-seed.
    list_deletes: list[tuple[str, str]] = []
    list_inserts: list[tuple] = []
    for row, pieces in list_row_plans:
        old_id, id_type, value = row[_LI["security_id"]], row[_LI["id_type"]], row[_LI["value"]]
        valid_from, valid_to = row[_LI["valid_from"]], row[_LI["valid_to"]]
        if len(pieces) == 1 and pieces[0] == (old_id, valid_from, valid_to):
            continue
        list_deletes.append((value, valid_from))
        if len(pieces) > 1:
            mutations.list_intervals_cut += 1
        else:
            mutations.list_intervals_moved += 1
        for destination, piece_from, piece_to in pieces:
            _state, _class, review_state = authority_state(registry, destination)
            piece_row = list(row)
            piece_row[_LI["security_id"]] = destination
            piece_row[_LI["valid_from"]] = piece_from
            piece_row[_LI["valid_to"]] = piece_to
            piece_row[_LI["confidence"]] = confidence_for(review_state)
            piece_row[_LI["review_state"]] = review_state
            piece_row[_LI["raw"]] = list_interval_raw(
                provenance=row[_LI["provenance"]],
                id_type=id_type,
                value=value,
                valid_from=piece_from,
                valid_to=piece_to,
                quarter=row[_LI["quarter"]],
                list_sha256=row[_LI["list_sha256"]],
                row_ordinal=row[_LI["row_ordinal"]],
                source_row=row[_LI["source_row"]],
            )
            list_inserts.append(tuple(piece_row))
    if list_deletes:
        conn.executemany(
            "DELETE FROM security_list_intervals WHERE value = ? AND valid_from = ?",
            list_deletes,
        )
    if list_inserts:
        conn.executemany(
            "INSERT INTO security_list_intervals ("
            + ", ".join(_LIST_INTERVAL_COLUMNS)
            + ") VALUES ("
            + ", ".join("?" for _ in _LIST_INTERVAL_COLUMNS)
            + ")",
            list_inserts,
        )

    # Securities whose per-observation entity candidates must be reset and
    # re-derived by the observation pass (split successors, and rename SOURCES
    # that survive — see below).
    reset_targets: set[str] = set()

    # 3 — renames: repoint every OTHER referencing table, collapse the chain,
    #     union the merged candidate sets, drop the predecessor, record it.
    for old_id in sorted(renames):
        new_id = renames[old_id]
        for table in SECURITY_ID_REFERENCING_TABLES:
            if table in _CUT_TABLES:
                continue
            # nosec B608 — the table name comes from the module constant
            # SECURITY_ID_REFERENCING_TABLES, never from input; both values are
            # bound. OR REPLACE collapses a chain whose newest link already
            # exists, so an older predecessor resolves to the newest successor.
            cursor = conn.execute(
                f"UPDATE OR REPLACE {table} SET security_id = ?"  # nosec B608
                " WHERE security_id = ?",
                (new_id, old_id),
            )
            # Count ledger rows the chain collapse actually rewrote (R12: no
            # uncounted write). Zero on replay: renames is empty once migrated.
            if table == "security_supersessions":
                mutations.supersessions_collapsed += max(cursor.rowcount, 0)
        collapse = conn.execute(
            "DELETE FROM security_supersessions WHERE old_security_id = security_id"
        )
        mutations.supersessions_collapsed += max(collapse.rowcount, 0)
        # Move candidates ONLY for a fully-transferred (retired) identity. If
        # old_id survives because it is also a live destination, unioning its
        # stale candidates into new_id — while it keeps its own — can falsely
        # conflict the survivor and break clean-build convergence (QA-F1). Reset
        # the survivor instead; the observation pass re-derives its candidates.
        if old_id not in all_destinations:
            previous_candidates = json.loads(securities[old_id][4])
            if previous_candidates:
                apply_entity_candidates(conn, new_id, previous_candidates)
        else:
            reset_targets.add(old_id)
        # A supersession is recorded ONLY when old_id is actually retired. If it
        # remains a live destination (e.g. it lost this binding but simultaneously
        # gained another), recording old_id→new_id would redirect a still-live
        # durable id via resolve_security_successor — the retained-owner defect on
        # the rename path (QA-F3, round 3). A survivor is deleted from nothing and
        # superseded by nothing.
        if old_id not in all_destinations:
            conn.execute("DELETE FROM securities WHERE security_id = ?", (old_id,))
            reason = (
                "promotion"
                if securities[old_id][1] == "provisional"
                and registry.class_for(new_id) is not None
                else "merge"
            )
            cursor = conn.execute(
                "INSERT INTO security_supersessions (old_security_id, security_id,"
                " reason, source) VALUES (?, ?, ?, 'securities.yaml')"
                " ON CONFLICT (old_security_id, security_id) DO NOTHING",
                (old_id, new_id, reason),
            )
            mutations.supersessions_recorded += max(cursor.rowcount, 0)
            if reason == "promotion":
                mutations.securities_promoted += 1
            else:
                mutations.securities_merged += 1

    # 4 — splits. The predecessor SURVIVES when it is itself one of the
    #     destinations: a declared class handing one identifier value to
    #     another class at a boundary keeps its id, its other bindings and its
    #     metadata. Otherwise it fans out completely and is retired.
    #     (reset_targets was declared before the renames loop; splits accumulate.)
    for old_id in sorted(splits):
        destinations = splits[old_id]
        retained = old_id in destinations
        successors = sorted(destinations - {old_id})
        # G14 (F3): a split hands different PERIODS of one CUSIP to different
        # owners, so a persisted holding cannot be blanket-moved like a rename — it
        # must be repointed as-of ITS OWN filing period. The identifier and list
        # intervals were already recut above (steps 2/2b), so `resolve_cusip`
        # against the current tables returns the successor that owns each holding's
        # (cusip, period_of_report). A period that no longer resolves uniquely
        # (ambiguous or uncovered) becomes NULL — never a stale predecessor id that
        # a later `resolve_cusip(..., period)` would contradict. The retained-owner
        # case is handled uniformly: a holding whose period stayed with old_id
        # resolves back to old_id and is left untouched.
        for holding_id, cusip, period in conn.execute(
            "SELECT holding_id, cusip, period_of_report FROM inst_holdings"
            " WHERE security_id = ?",
            (old_id,),
        ).fetchall():
            new_sid = resolve_cusip(conn, cusip, period) if cusip is not None else None
            if new_sid != old_id:
                conn.execute(
                    "UPDATE inst_holdings SET security_id = ? WHERE holding_id = ?",
                    (new_sid, holding_id),
                )
                mutations.holdings_repointed_on_split += 1
        if not retained:
            predecessors = [
                predecessor
                for (predecessor,) in conn.execute(
                    "SELECT old_security_id FROM security_supersessions"
                    " WHERE security_id = ?",
                    (old_id,),
                )
            ]
            conn.execute(
                "DELETE FROM security_supersessions WHERE security_id = ?",
                (old_id,),
            )
            # One-to-many is preserved: an id superseded INTO the predecessor
            # now resolves to every successor, so nothing silently collapses.
            for predecessor in sorted(predecessors):
                for successor in successors:
                    if predecessor == successor:
                        continue
                    cursor = conn.execute(
                        "INSERT INTO security_supersessions (old_security_id,"
                        " security_id, reason, source)"
                        " VALUES (?, ?, 'split', 'securities.yaml')"
                        " ON CONFLICT (old_security_id, security_id) DO NOTHING",
                        (predecessor, successor),
                    )
                    # Chain-repoint inserts are ledger rows too — count them so a
                    # promotion→full-split revision reports its supersession writes
                    # honestly (not just the direct old_id→successor rows). (R12)
                    mutations.supersessions_recorded += max(cursor.rowcount, 0)
        if not retained:
            # A retained declared owner is NOT superseded: it keeps its id and its
            # unaffected bindings, and only hands one identifier to a successor.
            # Recording old_id→successor here would make resolve_security_successor
            # redirect a still-live durable id away from itself (QA-F4). Only a
            # fully-retired predecessor is superseded by its successors.
            for successor in successors:
                cursor = conn.execute(
                    "INSERT INTO security_supersessions (old_security_id, security_id,"
                    " reason, source) VALUES (?, ?, 'split', 'securities.yaml')"
                    " ON CONFLICT (old_security_id, security_id) DO NOTHING",
                    (old_id, successor),
                )
                mutations.supersessions_recorded += max(cursor.rowcount, 0)
        if not retained and old_id not in all_destinations:
            conn.execute("DELETE FROM securities WHERE security_id = ?", (old_id,))
        mutations.securities_split += 1
        reset_targets |= destinations if retained else set(successors)

    # Per-observation candidates cannot be redistributed across a split, so the
    # affected securities are reset and the observation pass in the SAME
    # transaction re-derives them. A reconcile-only run therefore leaves them
    # `unresolved` — stated, counted here, and asserted by test.
    for security_id in sorted(reset_targets):
        cursor = conn.execute(
            "UPDATE securities SET entity_id = NULL, entity_candidates = '[]',"
            " entity_link_state = 'unresolved' WHERE security_id = ?"
            " AND (entity_candidates != '[]' OR entity_link_state != 'unresolved')",
            (security_id,),
        )
        if cursor.rowcount > 0:
            mutations.links_reset_on_split += 1

    _align_authority_metadata(conn, registry, None, mutations)
    _reconcile_review_state(conn, registry, mutations)
    _reconcile_list_review_state(conn, registry, mutations)
    return mutations


def _reconcile_list_review_state(conn, registry, mutations) -> None:
    """Bring each definitional list interval's review_state to the authority.

    A metadata-only authority revision (a changed ``review_state`` with no
    boundary move) leaves the intervals uncut, so their verdict must be
    reconciled here or a populated database diverges from a clean build. Unlike
    the FTD identifiers, list intervals are NOT subject to the reuse-horizon
    dispute: the definitional list is quarter-dense and higher-precedence, so
    its verdict is exactly the authority's declared ``review_state``. Idempotent
    via the ``review_state != target`` guard, so a replay changes nothing.
    """
    for (security_id,) in conn.execute(
        "SELECT DISTINCT security_id FROM security_list_intervals"
        " ORDER BY security_id"
    ).fetchall():
        _state, _class, target = authority_state(registry, security_id)
        cursor = conn.execute(
            "UPDATE security_list_intervals SET review_state = ?, confidence = ?"
            " WHERE security_id = ? AND review_state != ?",
            (target, confidence_for(target), security_id, target),
        )
        mutations.list_intervals_metadata_updated += max(cursor.rowcount, 0)


def _align_authority_metadata(
    conn: sqlite3.Connection,
    registry: IdentityRegistry,
    known: Mapping[str, tuple] | None,
    mutations=None,
) -> None:
    """Keep ``id_state``/``class`` in step with the authority.

    ``review_state`` is deliberately NOT rewritten here: it is the effective
    reuse verdict, owned by :func:`_reconcile_review_state`. Setting it to the
    authority value here would toggle a reuse-disputed/cleared security back and
    forth against ``_stamp_review`` and break the R12 replay-zero contract (QA-F1).

    Every actual ``securities`` rewrite is counted in
    ``mutations.securities_metadata_updated`` (R12: no uncounted write). The
    ``WHERE``-differs guard means a replay updates nothing and counts zero.
    ``known`` is unused (kept for call-site compatibility) — the table is small
    enough to re-read, and re-reading avoids an index mismatch on its tuples.
    """
    for security_id, id_state, class_ in conn.execute(
        "SELECT security_id, id_state, class FROM securities ORDER BY security_id"
    ).fetchall():
        expected_state, expected_class, _review = authority_state(registry, security_id)
        if (id_state, class_) != (expected_state, expected_class):
            cursor = conn.execute(
                "UPDATE securities SET id_state = ?, class = ? WHERE security_id = ?",
                (expected_state, expected_class, security_id),
            )
            if mutations is not None:
                mutations.securities_metadata_updated += max(cursor.rowcount, 0)


def _reconcile_review_state(conn, registry, mutations) -> None:
    """Reconcile every persisted identifier's ``review_state`` to the authority.

    A reconcile-only run has no observation pass, so on a populated database the
    persisted ``review_state`` must be brought into line with the (possibly
    revised) authority here, or ``resolve_cusip`` diverges from a clean build.
    This is BIDIRECTIONAL (QA-F1/F2), computing each value's FINAL target so a
    replay is a no-op:

    * a reuse-disputed value → ``disputed`` for all its rows (fail closed);
    * otherwise each owner's rows → that owner's declared authority
      ``review_state`` — which also CLEARS a stale ``disputed`` once a reviewed
      continuity resolves the reuse.

    Runs after migration, over post-cut intervals. Idempotent: every ``UPDATE``
    has a ``review_state != target`` guard, so the observation pass's later
    re-stamp and any replay change nothing, and an empty build is a no-op.
    """
    from populus.identity.bootstrap import _stamp_review  # lazy: avoid import cycle

    reuse_touched: set[str] = set()
    for id_type, value in conn.execute(
        "SELECT DISTINCT id_type, value FROM security_identifiers"
        " ORDER BY id_type, value"
    ).fetchall():
        owners = {
            sid
            for (sid,) in conn.execute(
                "SELECT DISTINCT security_id FROM security_identifiers"
                " WHERE id_type = ? AND value = ?",
                (id_type, value),
            )
        }
        decision = reuse_review_decisions(conn, anchor(id_type, value), registry)
        if decision.disputed:
            # Whole-value dispute — stamps BOTH identifier and security rows,
            # exactly as the observation pass does (last write wins per security
            # for a multi-value security).
            mutations.securities_flagged_disputed += _stamp_review(
                conn, id_type, value, "disputed"
            )
            reuse_touched |= owners
            continue
        if decision.cleared:
            # A reviewed continuity resolves the reuse gap → `reviewed`, matching
            # the observation pass so reconcile-only clearance converges (QA-F2).
            mutations.securities_cleared_by_continuity += _stamp_review(
                conn, id_type, value, "reviewed"
            )
            reuse_touched |= owners
            continue
        # Not reuse-affected: each owner's IDENTIFIER rows carry that owner's
        # declared authority verdict (also clearing a stale value).
        for security_id in sorted(owners):
            _s, _c, target = authority_state(registry, security_id)
            cursor = conn.execute(
                "UPDATE security_identifiers SET review_state = ?, confidence = ?"
                " WHERE id_type = ? AND value = ? AND security_id = ?"
                " AND review_state != ?",
                (target, confidence_for(target), id_type, value, security_id, target),
            )
            mutations.identifiers_metadata_updated += max(cursor.rowcount, 0)

    # SECURITY-level review_state, applied ONCE per security to its final effective
    # value: a reuse-touched security keeps the verdict `_stamp_review` just wrote;
    # every other security tracks its declared authority value (so an authority
    # review-state revision converges with a clean build). Skipping reuse-touched
    # securities here is what prevents the authority↔reuse toggle that broke the
    # R12 replay-zero contract (QA-F1).
    for (security_id,) in conn.execute(
        "SELECT security_id FROM securities ORDER BY security_id"
    ).fetchall():
        if security_id in reuse_touched:
            continue
        _s, _c, target = authority_state(registry, security_id)
        cursor = conn.execute(
            "UPDATE securities SET review_state = ? WHERE security_id = ?"
            " AND review_state != ?",
            (target, security_id, target),
        )
        mutations.securities_metadata_updated += max(cursor.rowcount, 0)


def reconcile_only(conn: sqlite3.Connection, registry: IdentityRegistry):
    """Bracket :func:`reconcile_identity_registry` for a standalone reconcile.

    The bootstrap path does NOT use this — it runs the migration inside its own
    single transaction alongside both seeders, so a seeder failure rolls the
    migration back too.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        mutations = reconcile_identity_registry(conn, registry)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return mutations
