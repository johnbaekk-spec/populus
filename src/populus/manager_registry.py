"""The curated manager registry: loader and join validation.

WHY THIS EXISTS. 13F filings carry a filed manager name and nothing else: no
display name, no classification. Nothing in the pipeline derives either, and
name-based inference would produce confident wrong labels on exactly the
entities that matter most. So the names and types are CURATED DATA, checked in,
each row carrying the primary SEC source that confirms it and the date it was
confirmed.

WHAT THIS MODULE REFUSES TO DO. It does not guess. A row missing any required
field is rejected by the loader rather than defaulted, because a silently
defaulted `manager_type` is an unsourced claim wearing a schema's authority.

THE JOIN IS VALIDATED, NOT TRUSTED. The registry decays: managers reorganize,
merge, and stop filing. `status` carries each row's disposition, and an
`active` row that stops matching the filer registry FAILS THE BUILD naming its
CIK. A percentage floor cannot do that job — a floor that tolerates a fifth of
the registry hides individual reorganizations, which are precisely the events
worth knowing about — so the floor is retained only as a catastrophic
join-defect backstop beneath the named-row rule.

NO PERSISTED STATE. The seed itself carries the disposition, so there is no
cross-build ledger to drift out of step with the data.
"""

from __future__ import annotations

import importlib.resources
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

#: Every field a row must carry. A row missing any one is REJECTED — never
#: defaulted, because a defaulted value is an unsourced claim.
REQUIRED_FIELDS: tuple[str, ...] = (
    "cik",
    "display_name",
    "sec_name",
    "manager_type",
    "notable",
    "status",
    "verified_channel",
    "verified_date",
)

#: The curated taxonomy. A row outside it is a typo or an unreviewed category,
#: and either way it must not reach a filter chip.
MANAGER_TYPES: frozenset[str] = frozenset(
    {
        "hedge_fund",
        "asset_manager",
        "pension_swf",
        "bank",
        "alt_manager",
        "insurer",
        "family_office",
        "foundation",
    }
)

VALID_STATUS: frozenset[str] = frozenset({"active", "retired"})

#: Catastrophic backstop ONLY. The named-row `active` rule below is the real
#: maintenance mechanism; this catches a join that has broken wholesale — a
#: changed CIK format, an empty registry, a swapped relation — rather than the
#: ordinary decay of one manager reorganizing.
CATASTROPHIC_MATCH_FLOOR = 0.80

#: How long a verification stays good. `verified_date` is the expiry clock, and
#: 13F deadlines are quarterly, so a row unre-verified for more than two
#: quarters plus a filing lag is stale.
VERIFICATION_MAX_AGE_DAYS = 225


class ManagerRegistryError(RuntimeError):
    """A registry defect that must stop the build rather than degrade a view."""


@dataclass(frozen=True)
class ManagerRow:
    cik: int
    display_name: str
    sec_name: str
    manager_type: str
    notable: bool
    status: str
    verified_channel: str
    verified_date: str
    person: str | None

    @property
    def cik_padded(self) -> str:
        """The zero-padded ten-character form `agg_filer_registry.cik` stores."""
        return f"{self.cik:010d}"


@dataclass(frozen=True)
class ManagerRegistry:
    version: int
    rows: tuple[ManagerRow, ...]
    excluded: tuple[dict, ...]
    #: declared filer-population scale (see the seed's own comment)
    population_floor: int

    @property
    def active(self) -> tuple[ManagerRow, ...]:
        return tuple(r for r in self.rows if r.status == "active")

    @property
    def retired(self) -> tuple[ManagerRow, ...]:
        return tuple(r for r in self.rows if r.status == "retired")

    def by_cik(self) -> dict[int, ManagerRow]:
        return {r.cik: r for r in self.rows}


def load_manager_registry(path: Path | str | None = None) -> ManagerRegistry:
    """Load and validate the packaged seed.

    Reads the packaged resource by default, exactly as the other seed files in
    this package do (`aliases.yaml`, `securities.yaml`, `sic_taxonomy.yaml`), so
    an installed wheel carries its own data rather than depending on a checkout.
    """
    if path is None:
        text = (
            importlib.resources.files("populus")
            .joinpath("manager_registry.yaml")
            .read_text(encoding="utf-8")
        )
    else:
        text = Path(path).read_text(encoding="utf-8")
    data = yaml.safe_load(text)

    version = data.get("version")
    if not isinstance(version, int) or version < 1:
        raise ManagerRegistryError("manager registry: version must be a positive integer")

    raw_rows = data.get("managers")
    if not isinstance(raw_rows, list) or not raw_rows:
        raise ManagerRegistryError("manager registry: `managers` must be a non-empty list")

    rows: list[ManagerRow] = []
    seen: dict[int, str] = {}
    for pos, raw in enumerate(raw_rows):
        if not isinstance(raw, dict):
            raise ManagerRegistryError(f"manager registry: row {pos} is not a mapping")
        entry = dict(raw)
        # NO document-level fallback for `verified_date`. It is the expiry
        # clock for THIS row's verification, so inheriting it from a document
        # default would let a row claim a verification date on which nobody
        # verified it. Every row carries its own, and the seed already does.
        missing = [f for f in REQUIRED_FIELDS if entry.get(f) is None]
        if missing:
            raise ManagerRegistryError(
                f"manager registry: row {pos} ({entry.get('display_name') or entry.get('cik')!r})"
                f" is missing required field(s): {', '.join(missing)}"
            )

        cik = entry["cik"]
        if not isinstance(cik, int) or cik <= 0:
            raise ManagerRegistryError(
                f"manager registry: row {pos} has a non-integer CIK {cik!r};"
                " the seed stores CIKs as integers so the join has one normalization"
            )
        if cik in seen:
            raise ManagerRegistryError(
                f"manager registry: CIK {cik} appears twice"
                f" ({seen[cik]} and {entry['display_name']}) — one row per filer"
            )
        seen[cik] = str(entry["display_name"])

        manager_type = str(entry["manager_type"])
        if manager_type not in MANAGER_TYPES:
            raise ManagerRegistryError(
                f"manager registry: CIK {cik} has manager_type {manager_type!r},"
                f" which is not in the reviewed taxonomy {sorted(MANAGER_TYPES)}"
            )
        status = str(entry["status"])
        if status not in VALID_STATUS:
            raise ManagerRegistryError(
                f"manager registry: CIK {cik} has status {status!r}; expected one of"
                f" {sorted(VALID_STATUS)}"
            )
        if not isinstance(entry["notable"], bool):
            raise ManagerRegistryError(
                f"manager registry: CIK {cik} has a non-boolean `notable`."
                " It is an EDITORIAL flag, orthogonal to manager_type — a notable"
                " hedge fund is both, and must appear under both filters."
            )

        rows.append(
            ManagerRow(
                cik=cik,
                display_name=str(entry["display_name"]),
                sec_name=str(entry["sec_name"]),
                manager_type=manager_type,
                notable=bool(entry["notable"]),
                status=status,
                verified_channel=str(entry["verified_channel"]),
                verified_date=str(entry["verified_date"]),
                person=str(entry["person"]) if entry.get("person") else None,
            )
        )

    excluded = tuple(data.get("excluded") or ())
    floor = data.get("population_floor")
    if not isinstance(floor, int) or floor <= 0:
        raise ManagerRegistryError(
            "manager registry: population_floor must be a positive integer —"
            " it is the DECLARED scale at which the curation gate stops abstaining,"
            " and a build must not have to guess it"
        )
    return ManagerRegistry(
        version=version, rows=tuple(rows), excluded=excluded, population_floor=floor
    )


@dataclass(frozen=True)
class RegistryJoinReport:
    """What the join found, in identifiers rather than percentages."""

    #: every seeded CIK present in the filer registry, whatever its status —
    #: this is a statement about the JOIN, not about eligibility for typing
    matched: tuple[int, ...]
    #: the ACTIVE subset of `matched`. Typed views derive from this and only
    #: this: a row marked retired is excluded whether or not its CIK still
    #: joins, because "retired" is a curation decision about the label, not an
    #: observation about the filer's presence.
    matched_active: tuple[int, ...]
    #: `active` rows that did not join — a BUILD FAILURE, named individually
    unmatched_active: tuple[ManagerRow, ...]
    #: `retired` rows that did not join — expected, excluded, not a failure
    unmatched_retired: tuple[ManagerRow, ...]
    registry_size: int

    @property
    def match_rate(self) -> float:
        return len(self.matched) / self.registry_size if self.registry_size else 0.0

    @property
    def typed_ciks(self) -> frozenset[int]:
        """The CIKs typed views may use: matched AND active.

        An unmatched row is excluded because the filer is not there. A RETIRED
        row is excluded even when it IS there — the owner has said its curated
        name and type should no longer be shown, and a still-present CIK does
        not override that.
        """
        return frozenset(self.matched_active)


def join_manager_registry(
    conn: sqlite3.Connection, registry: ManagerRegistry | None = None
) -> RegistryJoinReport:
    """Join the seed against `agg_filer_registry` and report by identifier.

    `agg_filer_registry` is the join target because it is the relation the
    manager directory itself renders from. `inst_filers` is deliberately NOT
    used: it is the raw filer table, not the directory's source, so a row that
    joined there could still be absent from the surface this typing feeds.

    CIK normalization is the INTEGER VALUE on both sides — the seed stores
    integers and `agg_filer_registry.cik` stores zero-padded ten-character
    text, so comparing the text forms would silently match nothing.
    """
    registry = registry or load_manager_registry()
    present: set[int] = set()
    for (raw_cik,) in conn.execute("SELECT cik FROM agg_filer_registry"):
        try:
            present.add(int(str(raw_cik)))
        except (TypeError, ValueError):
            continue

    matched: list[int] = []
    matched_active: list[int] = []
    unmatched_active: list[ManagerRow] = []
    unmatched_retired: list[ManagerRow] = []
    for row in registry.rows:
        if row.cik in present:
            matched.append(row.cik)
            if row.status == "active":
                matched_active.append(row.cik)
        elif row.status == "active":
            unmatched_active.append(row)
        else:
            unmatched_retired.append(row)

    return RegistryJoinReport(
        matched=tuple(sorted(matched)),
        matched_active=tuple(sorted(matched_active)),
        unmatched_active=tuple(unmatched_active),
        unmatched_retired=tuple(unmatched_retired),
        registry_size=len(registry.rows),
    )


def enforce_manager_registry_join(report: RegistryJoinReport) -> None:
    """Fail the build on an undispositioned mismatch.

    IMMEDIATE and EXACT-MATCH, with no persisted state: the seed's own `status`
    field carries the disposition, so the rule needs no ledger from a previous
    build and cannot drift out of step with one.
    """
    if report.unmatched_active:
        named = ", ".join(
            f"{r.cik} ({r.display_name})" for r in sorted(report.unmatched_active, key=lambda r: r.cik)
        )
        raise ManagerRegistryError(
            f"manager registry: {len(report.unmatched_active)} `active` row(s) do not join"
            f" agg_filer_registry: {named}."
            " Either the manager stopped filing — set status: retired, with the date —"
            " or the CIK is wrong. Both are decisions for a human with a primary source,"
            " so the build stops rather than quietly dropping the row from typed views."
        )
    # The floor is a CATASTROPHIC backstop, not the maintenance mechanism.
    #
    # Reaching it means every `active` row already matched — the named-row rule
    # above raises first otherwise — so the only way the rate can be low is that
    # RETIRED rows dominate the seed. That is a real and distinct signal from a
    # single manager reorganizing: a seed that is mostly retired has stopped
    # describing the filer population it exists to type, and no per-row rule can
    # notice that, because every individual row is correctly dispositioned.
    if report.registry_size and report.match_rate < CATASTROPHIC_MATCH_FLOOR:
        raise ManagerRegistryError(
            f"manager registry: only {len(report.matched)} of {report.registry_size} rows join"
            f" agg_filer_registry ({report.match_rate:.0%} < {CATASTROPHIC_MATCH_FLOOR:.0%}),"
            f" with {len(report.unmatched_retired)} row(s) marked retired."
            " Every active row matched, so no single row is wrong — the seed as a WHOLE has"
            " decayed past the point of describing the filer population, and needs curation"
            " rather than another retirement."
        )


def stale_rows(registry: ManagerRegistry, today: date) -> tuple[ManagerRow, ...]:
    """Rows whose verification has aged past the re-verification cadence.

    Reported by the re-verification command, never a build failure: a stale
    verification means "a human should look again", not "this row is wrong".
    """
    out = []
    for row in registry.rows:
        try:
            verified = date.fromisoformat(row.verified_date)
        except ValueError as exc:
            raise ManagerRegistryError(
                f"manager registry: CIK {row.cik} has an unparseable verified_date"
                f" {row.verified_date!r}"
            ) from exc
        if (today - verified).days > VERIFICATION_MAX_AGE_DAYS:
            out.append(row)
    return tuple(out)
