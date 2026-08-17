"""Seed-forward corpus restoration and the identity-based corpus floor (R42/R44).

Why this module exists
----------------------
The publish runner used to build ``populus.db`` from nothing on every run. Two
outages came out of that single fact:

* **B24** — the members ingest never ran, so seven consecutive releases shipped
  with zero member pages.
* **B25** — House ``default_years`` (``ingest/house.py``) fetches the current
  year only, so a store that starts empty can never recover 2014-2025. Seven
  releases published with a decade of House history missing, and every nightly
  re-fetched fourteen years of Senate filings because
  ``_submitted_start_date`` backfills from 2012 whenever the store is empty.

Neither was visible to any existing gate: a corpus that silently shrinks looks
exactly like a quiet week. This module makes both loud.

Two commands, one invariant each:

``seed-corpus``
    Start every run from the previous release's ``congress.db``, authenticated
    through the COMPLETE landed trust chain — pointer, manifest bytes against
    the pointer's digest, manifest schema, pointer/manifest build identity —
    and only then the asset, verified byte-exactly. No fetchable release and no
    explicit override is a REFUSAL. The fresh-database path is not offered as a
    fallback, because the fresh-database path is the disease.

``corpus-floor``
    After the ingests and the member join, refuse the build if any identity the
    seed carried has gone missing. Identities, never counts — see
    :func:`assert_corpus_floor` for why three separate legitimate operations
    lower a count without losing anything.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from populus.publish.manifest import (
    DB_ARTIFACT,
    find_artifact,
    pointer_manifest_identity_error,
    validate_manifest,
)
from populus.publish.pointer import validate_pointer

__all__ = [
    "SEED_COUNTS_SCHEMA_VERSION",
    "SeedError",
    "SeedResult",
    "assert_corpus_floor",
    "blank_as_unset",
    "clear_inline_inst_data",
    "resolve_seed",
    "verify_and_place",
    "write_seed_counts",
]

#: Bump when the sidecar's shape changes. The floor refuses a version it does
#: not understand rather than reading it optimistically.
SEED_COUNTS_SCHEMA_VERSION = 1

_HASH_CHUNK = 1024 * 1024


class SeedError(Exception):
    """A refusal. Every path in this module fails closed by raising one."""


@dataclass(frozen=True)
class SeedResult:
    """Where the seed came from, and what it was proven to be."""

    build_id: str | None
    sha256: str
    bytes_: int
    origin: str  # "release" | "override"


def blank_as_unset(value: str | None) -> str | None:
    """An UNSET GitHub repository variable arrives as the EMPTY STRING.

    Not as an absent key — so ``os.environ.get(name, default)`` returns ``""``
    and the default never applies. That cost a 2h11m run (31861037053) once
    already. Every knob this module reads goes through here.
    """
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _require_digest(value: object, what: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise SeedError(f"{what} is not a sha256 digest: {value!r}")
    try:
        int(value, 16)
    except ValueError:
        raise SeedError(f"{what} is not hexadecimal: {value!r}") from None
    return value.lower()


# --- the trust chain ---------------------------------------------------------


def resolve_seed(
    data_repo: Path | str,
    backend_factory: Callable[[Path], object],
) -> tuple[SeedResult, bytes]:
    """Authenticate the previous release and return its ``congress.db`` bytes.

    The chain is the landed one, reused in full and in order — a shortcut here
    would authenticate the seed less strictly than the pipeline authenticates
    everything else:

    1. ``latest.json`` parses and passes :func:`validate_pointer`.
    2. The manifest BYTES hash to the pointer's ``manifest_sha256``.
    3. The parsed manifest passes :func:`validate_manifest`.
    4. :func:`pointer_manifest_identity_error` binds pointer build to manifest
       build, so a hash-consistent manifest for a DIFFERENT build cannot seed.

    Only a manifest that survived all four may name the seed.

    Honest I/O statement: ``read_asset`` returns the complete asset in memory.
    For the ~0.9 GiB bootstrap seed that is a real transient allocation on a
    machine with a 32 GiB floor. Stated rather than dressed up as streaming.
    """
    data_repo = Path(data_repo)
    pointer_path = data_repo / "latest.json"
    if not pointer_path.is_file():
        raise SeedError(
            f"no pointer at {pointer_path}: nothing to seed from. Provide the"
            " bootstrap override (POPULUS_CONGRESS_SEED_DB +"
            " POPULUS_CONGRESS_SEED_SHA256) for the one run that has no"
            " published complete corpus. Building from an empty database is"
            " never the fallback — that is what produced B24 and B25."
        )
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise SeedError(f"latest.json is unreadable or unparseable: {exc}") from exc

    pointer_errors = validate_pointer(pointer)
    if pointer_errors:
        raise SeedError("latest.json is invalid: " + "; ".join(pointer_errors))

    manifest_path = data_repo / pointer["manifest_path"]
    try:
        manifest_bytes = manifest_path.read_bytes()
    except OSError as exc:
        raise SeedError(f"manifest missing at {pointer['manifest_path']}: {exc}") from exc

    if hashlib.sha256(manifest_bytes).hexdigest() != pointer["manifest_sha256"]:
        raise SeedError("manifest bytes do not hash to the pointer's manifest_sha256")

    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SeedError(f"manifest is not valid JSON: {exc}") from exc

    manifest_errors = validate_manifest(manifest)
    if manifest_errors:
        raise SeedError("manifest is invalid: " + "; ".join(manifest_errors))

    identity_error = pointer_manifest_identity_error(manifest, pointer["build_id"])
    if identity_error:
        raise SeedError(f"pointer/manifest identity: {identity_error}")

    entry = find_artifact(manifest, DB_ARTIFACT)
    if entry is None:
        raise SeedError(
            f"the validated manifest for build {pointer['build_id']} has no"
            f" {DB_ARTIFACT} module entry — refusing to guess a seed"
        )
    sha256 = _require_digest(entry.get("sha256"), f"{DB_ARTIFACT} sha256")
    size = entry.get("bytes")
    if not isinstance(size, int) or size <= 0:
        raise SeedError(f"{DB_ARTIFACT} entry has a malformed byte count: {size!r}")

    backend = backend_factory(data_repo)
    payload = backend.read_asset(pointer["build_id"], DB_ARTIFACT)  # type: ignore[attr-defined]
    actual = hashlib.sha256(payload).hexdigest()
    if actual != sha256:
        raise SeedError(
            f"{DB_ARTIFACT} for build {pointer['build_id']} does not match the"
            f" manifest digest: expected {sha256}, got {actual}"
        )
    if len(payload) != size:
        raise SeedError(
            f"{DB_ARTIFACT} is {len(payload)} bytes, the manifest says {size}"
        )
    return (
        SeedResult(
            build_id=pointer["build_id"], sha256=sha256, bytes_=size, origin="release"
        ),
        payload,
    )


def verify_and_place(
    destination: Path | str,
    *,
    payload: bytes | None = None,
    source: Path | str | None = None,
    expected_sha256: str,
) -> SeedResult:
    """Place a digest-verified seed at *destination*, atomically.

    Exactly one of *payload* (a fetched release asset) or *source* (the
    bootstrap override's machine-local path) is supplied. A digest mismatch
    deletes the partial file and refuses — a half-written seed left on disk
    would be picked up as a corpus by the next step.
    """
    if (payload is None) == (source is None):
        raise SeedError("supply exactly one of payload= or source=")
    expected = _require_digest(expected_sha256, "expected sha256")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_name(destination.name + ".seed-partial")

    try:
        if payload is not None:
            staging.write_bytes(payload)
        else:
            src = Path(source)  # type: ignore[arg-type]
            if not src.is_file():
                raise SeedError(f"the seed override path is not a file: {src}")
            shutil.copyfile(src, staging)
        actual = _sha256_file(staging)
        if actual != expected:
            raise SeedError(
                f"seed digest mismatch: expected {expected}, got {actual}."
                " The partial file has been removed."
            )
        size = staging.stat().st_size
        staging.replace(destination)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    return SeedResult(
        build_id=None,
        sha256=expected,
        bytes_=size,
        origin="override" if source is not None else "release",
    )


def clear_inline_inst_data(conn: sqlite3.Connection) -> list[str]:
    """Empty the seeded copy's inline ``inst_*`` tables. Returns what it cleared.

    NOT cosmetic. With ``--inst-db`` unset, ``stage_build`` derives the whole
    institutional module from these inline tables (``build.py``
    ``_inst_data_present``), so a seeded store would republish the seed's
    institutional snapshot as if it were current whenever ``POPULUS_INST_DB``
    arrives blank — and an unset repository variable arrives blank rather than
    absent. Clearing the WORKING COPY destroys no source of truth: the accepted
    external snapshot remains the only institutional source.

    EMPTIED, not DROPPED — a deliberate departure from the plan's wording. The
    plan assumed a published ``congress.db`` carries no inst tables at all; it
    does, and so does every fresh store, because ``init_db`` applies
    ``inst.sql``. The predicate is ``inst_filings EXISTS **and** the reconciled
    view returns a row``, so emptying and dropping both read as absent — but
    only emptying leaves the store in the shape a freshly initialized one has,
    which is the state today's honest congress-only build actually runs in.
    Dropping would additionally leave ``ensure_views``' inst views pointing at
    missing tables, a shape nothing else in the pipeline is written against.
    """
    names = sorted(
        row[0]
        for row in conn.execute(
            # ESCAPE '\\' so the underscore is LITERAL. Written as
            # 'inst[_]%' ESCAPE '[' first, which SQLite reads as the pattern
            # "inst_]%" — it matched nothing at all, and the clear silently
            # became a no-op. Caught by the test asserting _inst_data_present
            # flips; a "the rows are gone" assertion would have missed it too.
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND name LIKE 'inst\\_%' ESCAPE '\\'"
        ).fetchall()
    )
    if not names:
        return []

    # Delete CHILDREN before PARENTS. `PRAGMA defer_foreign_keys` was the first
    # attempt and does not survive Python's lazy transaction handling — the
    # pragma is scoped to a transaction that has not begun yet when it runs, so
    # enforcement was still immediate and the delete tripped a constraint. The
    # order is derived from the schema rather than hard-coded, so a future inst
    # table cannot silently invalidate it.
    pending = set(names)
    referenced_by: dict[str, set[str]] = {name: set() for name in names}
    for name in names:
        for row in conn.execute(
            f'PRAGMA foreign_key_list("{name}")'  # nosec B608
        ):
            parent = row[2]
            if parent in pending and parent != name:
                referenced_by[parent].add(name)

    order: list[str] = []
    while pending:
        ready = sorted(n for n in pending if not (referenced_by[n] & pending))
        if not ready:
            raise SeedError(
                "the inline institutional tables form a foreign-key cycle:"
                f" {sorted(pending)}"
            )
        order.extend(ready)
        pending -= set(ready)

    cleared = []
    with conn:
        for name in order:
            # The identifier is not user input: it comes from sqlite_master,
            # filtered to the literal `inst_` prefix, and is double-quoted. It
            # cannot be parameterized — SQLite binds values, never identifiers
            # — so the repository's `# nosec B608` annotation applies, same as
            # the guarded DROPs in amendments.py.
            (rows,) = conn.execute(
                f'SELECT COUNT(*) FROM "{name}"'  # nosec B608
            ).fetchone()
            if rows:
                cleared.append(name)
            conn.execute(f'DELETE FROM "{name}"')  # nosec B608
    return sorted(cleared)


# --- the identity baseline ---------------------------------------------------


def write_seed_counts(
    conn: sqlite3.Connection,
    path: Path | str,
    *,
    seed_build_id: str | None,
    seed_sha256: str,
    run_started_at: str,
) -> dict:
    """Record per-(source, chamber) IDENTITIES, not counts, from the seeded store.

    At roughly twelve thousand filings this sidecar is a few hundred KB of
    JSON per run. Stated, not hidden.

    Zero pairs at write time is a refusal: an empty corpus is not a baseline,
    and a floor computed from one would pass vacuously forever.
    """
    groups: dict[tuple[str, str], dict] = {}
    for source, chamber, filing_id, bioguide_id in conn.execute(
        "SELECT source, chamber, filing_id, bioguide_id FROM filings"
    ):
        group = groups.setdefault(
            (source, chamber),
            {"source": source, "chamber": chamber, "filing_ids": [], "joined": []},
        )
        group["filing_ids"].append(filing_id)
        if bioguide_id is not None:
            group["joined"].append([filing_id, bioguide_id])

    txn_counts = {
        filing_id: count
        for filing_id, count in conn.execute(
            "SELECT filing_id, COUNT(*) FROM transactions GROUP BY filing_id"
        )
    }
    for group in groups.values():
        group["filing_ids"].sort()
        group["joined"].sort()
        group["transactions_by_filing"] = {
            filing_id: txn_counts.get(filing_id, 0) for filing_id in group["filing_ids"]
        }

    if not groups:
        raise SeedError(
            "the seeded store holds no filings — refusing to write a baseline"
            " that every later check would pass vacuously"
        )

    document = {
        "schema_version": SEED_COUNTS_SCHEMA_VERSION,
        "seed_build_id": seed_build_id,
        "seed_sha256": seed_sha256,
        "run_started_at": run_started_at,
        "pairs": [groups[key] for key in sorted(groups)],
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")
    return document


# --- the floor ---------------------------------------------------------------


def assert_corpus_floor(
    conn: sqlite3.Connection,
    counts_path: Path | str,
    *,
    allow_reparse: frozenset[str] = frozenset(),
) -> list[str]:
    """Refuse the build if the seed's identities did not survive the run.

    IDENTITIES, not counts. Three separate LEGITIMATE operations lower a count
    without losing anything, so a count-based floor is either useless or a
    permanent false alarm:

    a. ``v_default_transactions`` excludes the original of every actively
       superseded filing (``views.sql``), so amendment healing lowers it.
    b. Raw ``transactions`` are NOT append-only: ``load_filing`` atomically
       DELETEs and replaces a filing's whole parsed set (``load.py``), so a
       corrective reparse legitimately lowers a raw count.
    c. Aggregate joined counts can be OFFSET — the join pass rewrites every
       filing (``members.py``), so a truncated-but-nonempty roster can NULL
       historical identities while enough new joins hold the total level. Only
       pair identity catches that one.

    Returns the (empty) list of violations on success; raises
    :class:`SeedError` listing every violation otherwise. Fails closed on a
    missing, unparseable, or empty sidecar — never vacuously.
    """
    counts_path = Path(counts_path)
    if not counts_path.is_file():
        raise SeedError(
            f"no corpus baseline at {counts_path}. The floor cannot prove"
            " anything without one, and a build that cannot prove its corpus"
            " survived is exactly the build B25 shipped."
        )
    try:
        document = json.loads(counts_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise SeedError(f"the corpus baseline is unparseable: {exc}") from exc
    if not isinstance(document, dict):
        raise SeedError("the corpus baseline is not an object")
    if document.get("schema_version") != SEED_COUNTS_SCHEMA_VERSION:
        raise SeedError(
            "the corpus baseline records schema_version"
            f" {document.get('schema_version')!r}, this build understands"
            f" {SEED_COUNTS_SCHEMA_VERSION}"
        )
    pairs = document.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        raise SeedError("the corpus baseline records no (source, chamber) pairs")
    if not any(pair.get("filing_ids") for pair in pairs):
        raise SeedError(
            "the corpus baseline records zero filings — refusing rather than"
            " passing vacuously"
        )

    # Keyed by (source, chamber), never globally. R44's contract is per-pair,
    # and a global set answers the wrong question: a filing REASSIGNED from one
    # (source, chamber) to another is still "present" globally, so a chamber
    # could be emptied into its sibling and every check would pass. Identity
    # here means the pair as well as the id.
    present_filings: dict[tuple[str, str], set[str]] = {}
    present_joined: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for source, chamber, filing_id, bioguide_id in conn.execute(
        "SELECT source, chamber, filing_id, bioguide_id FROM filings"
    ):
        key = (source, chamber)
        present_filings.setdefault(key, set()).add(filing_id)
        if bioguide_id is not None:
            present_joined.setdefault(key, set()).add((filing_id, bioguide_id))
    present_txns: dict[tuple[str, str], dict[str, int]] = {}
    for source, chamber, filing_id, count in conn.execute(
        "SELECT f.source, f.chamber, t.filing_id, COUNT(*) FROM transactions t"
        " JOIN filings f ON f.filing_id = t.filing_id"
        " GROUP BY f.source, f.chamber, t.filing_id"
    ):
        present_txns.setdefault((source, chamber), {})[filing_id] = count

    violations: list[str] = []
    for pair in pairs:
        key = (pair.get("source"), pair.get("chamber"))
        label = f"{key[0]}/{key[1]}"
        pair_filings = present_filings.get(key, set())
        pair_joined = present_joined.get(key, set())
        pair_txns = present_txns.get(key, {})

        # Filings are never deleted — no supported path removes one — so an
        # absent seed filing_id is always a broken pipeline, never a healing.
        # "Absent" includes "still in the store but under a different
        # (source, chamber)": that is an identity swap, not a preservation.
        missing = sorted(set(pair.get("filing_ids", [])) - pair_filings)
        if missing:
            violations.append(
                f"{label}: {len(missing)} seed filing(s) absent from this"
                f" (source, chamber), e.g. {missing[:5]}"
            )

        unjoined = sorted(
            (filing_id, bioguide_id)
            for filing_id, bioguide_id in (
                tuple(entry) for entry in pair.get("joined", [])
            )
            if (filing_id, bioguide_id) not in pair_joined
            and filing_id not in allow_reparse
        )
        if unjoined:
            violations.append(
                f"{label}: {len(unjoined)} seed member join(s) lost after this"
                f" run's join pass, e.g. {unjoined[:5]}"
            )

        shrunk = []
        for filing_id, seed_count in (pair.get("transactions_by_filing") or {}).items():
            if filing_id in allow_reparse:
                continue
            if pair_txns.get(filing_id, 0) < seed_count:
                shrunk.append((filing_id, seed_count, pair_txns.get(filing_id, 0)))
        if shrunk:
            violations.append(
                f"{label}: {len(shrunk)} filing(s) lost transactions without"
                " authorization (name them in corpus_floor_allow_reparse if a"
                f" corrective reparse is expected), e.g. {shrunk[:5]}"
            )

    # THIS run's join must have executed. The landed total-absence guard in
    # stage_build cannot prove it any more: a seeded store arrives with
    # historical joins already nonzero, so that guard is permanently satisfied
    # whether or not the members step ran at all — which is precisely how B24
    # stayed invisible for seven releases.
    run_started_at = document.get("run_started_at")
    if not isinstance(run_started_at, str) or not run_started_at:
        raise SeedError("the corpus baseline records no run_started_at")
    (members_runs,) = conn.execute(
        "SELECT COUNT(*) FROM ingest_runs WHERE job = 'members' AND status = 'ok'"
        " AND started_at >= ?",
        (run_started_at,),
    ).fetchone()
    if not members_runs:
        violations.append(
            "no successful `members` ingest ran in THIS build (nothing in"
            f" ingest_runs at or after {run_started_at}) — the member join did"
            " not execute, so member pages would be stale or absent"
        )

    if violations:
        raise SeedError(
            "corpus floor refused the build:\n  - " + "\n  - ".join(violations)
        )
    return violations
