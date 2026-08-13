"""The per-build manifest (§5.5): shape, rendering, validation, path grammar.

One ``manifest.json`` per build at ``builds/<build_id>/manifest.json``. Every
consumed file is an enumerated artifact under a build-scoped path or Release
URL, and every artifact carries ``license_ids``. Locators obey a strict POSIX
grammar (no absolute paths, no ``..``, no backslash, no control characters)
and every local read resolves under its root with symlink-escape containment
(reusing ``populus.ingest.archive_path``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from packaging.specifiers import InvalidSpecifier, SpecifierSet

import populus
from populus.ingest import UnsafeArchivePathError, archive_path
from populus.publish.digests import LOGICAL_PROJECTION_VERSION
from populus.publish.pointer import parse_rfc3339z

MODULE = "congress"
MANIFEST_SCHEMA_VERSION = "1.0"
CLIENT_COMPAT = ">=0.0.1,<1"
DB_ARTIFACT = "congress.db"
FEED_ARTIFACT = "congress/feed.json"
STATS_ARTIFACT = "congress/stats.json"
JOURNAL_ASSET = "journal.json"
LICENSING_ARTIFACTS = ("DATA-LICENSE.md", "NOTICE", "licenses.json")
# The mandatory artifact set every congress build must enumerate (R2/R3/R10):
# the database, the feed, the freshness stats, and the full licensing set. A
# manifest missing any of these is a semantically partial build and is refused
# by validate_manifest before any consumer dereferences it (F6). Per-member /
# per-ticker slices are data-dependent and therefore not in the fixed set.
REQUIRED_CONGRESS_ARTIFACTS = (
    DB_ARTIFACT,
    FEED_ARTIFACT,
    STATS_ARTIFACT,
    *LICENSING_ARTIFACTS,
)
WATERMARK_KEYS = ("house_index_last_modified", "senate_max_filed_date")

# --- the institutional 13F module (§5.5; M2-CONTRACT §5.6 — RUN M2-3) ---------
# The inst module carries TWO database artifacts (RUN M2-8 T8, plan R9):
#   inst_agg.db      — the derived cross-filer aggregate (M2-3)
#   inst_serving.db  — the per-filer SERVING projection (M2-8), which the MCP
#                      snapshot path reads for published per-filer detail
# Until M2-8 the module carried exactly one, and `module_db_artifact()` returned
# a scalar. External review r3 F9 flagged that a second asset is NOT an ordinary
# extra entry: three call sites in publish/build.py resolved that scalar, so a
# second artifact would have been silently skipped at preflight, verification and
# rollback. The policy now carries a TUPLE and those sites iterate.
# Its watermarks are 13F-shaped (report period + filed date), disjoint from
# congress's House/Senate freshness keys.
INST_MODULE = "inst"
INST_DB_ARTIFACT = "inst_agg.db"
INST_SERVING_ARTIFACT = "inst_serving.db"
INST_SCHEMA_VERSION = "1.1"
INST_CLIENT_COMPAT = ">=0.0.1,<1"
# DEVIATION FROM R10, RECORDED (QA M2-8 M12).
#
# R10 says "the manifest policy requires the new artifact". `inst_serving.db` is
# NOT in this tuple, and that is deliberate: `validate_manifest` runs over
# manifests this release did not write — the rollback target, the pointer's
# current build, the client's cached manifest — and every build that predates
# RUN M2-8 legitimately has no serving artifact. A hard entry here would make
# each of those invalid, i.e. it would refuse to roll back to a build that was
# correct when it was published.
#
# What made that unsafe was not the mechanism but the missing half: nothing
# failed when a POST-M2-8 build omitted the artifact, so "optional" and "absent
# because nobody wrote the producer" were indistinguishable — which is exactly
# the state the increment shipped in. The compensating control lives at the
# PRODUCER instead (`publish/build.py`, beside the inst manifest assembly): a
# build that publishes `inst_agg.db` and cannot produce `inst_serving.db` raises
# `PublishError`. Old manifests keep validating; new builds cannot regress.
#
# Schema 1.1 now signals the independently reviewed QoQ table→view contract
# change.  It still does not make the serving artifact validator-mandatory:
# rollback and cached pre-M2-8 manifests remain valid, while the producer guard
# below remains the compatibility-safe boundary for every newly written build.
REQUIRED_INST_ARTIFACTS = (INST_DB_ARTIFACT,)
INST_WATERMARK_KEYS = ("latest_period_of_report", "latest_filed_date")

# --- the inst source-provenance artifact (RUN M2-11, R24) ---------------------
# When a build derives the inst module from an accepted external snapshot
# (`stage-build --inst-db`), it publishes `inst_source.json`: the snapshot's
# whole-file SHA-256 plus the metadata fields read from the snapshot's own
# `inst_source_meta` table — so provenance can never drift from identity.
#
# It is an ORDINARY path-backed artifact, deliberately NOT in the inst module's
# `db_artifacts` tuple: that tuple is DB-only with logical-digest semantics and
# drives Release-asset handling through five consumers; a JSON there would be
# misclassified by every one of them. The generic installer already installs
# path-backed artifacts with zero code change. It is also NOT in any module's
# `required` set: every manifest written before RUN M2-11 legitimately has none,
# and validation must keep accepting those (rollback targets included). The
# compensating control is the PRODUCER guard in publish/build.py: a build given
# --inst-db that fails to emit it raises PublishError.
INST_SOURCE_ARTIFACT = "inst_source.json"
INST_SOURCE_SCHEMA = "inst_source/v1"
_INST_SOURCE_FIELDS = {
    "schema",
    "snapshot_sha256",
    "snapshot_schema_version",
    "snapshot_version",
    "created_at_utc",
    "view_definition_digest",
}


def validate_inst_source(document: object) -> list[str]:
    """Strict ``inst_source/v1`` validation; returns every defect (R24).

    Exact field set, no extras: the artifact is a published contract, so an
    unknown field is a defect today rather than a compatibility hazard later.
    """
    if not isinstance(document, dict):
        return ["inst_source document is not a JSON object"]
    errors: list[str] = []
    present = set(document)
    for missing in sorted(_INST_SOURCE_FIELDS - present):
        errors.append(f"missing field {missing!r}")
    for extra in sorted(present - _INST_SOURCE_FIELDS):
        errors.append(f"unexpected field {extra!r}")
    if errors:
        return errors
    if document["schema"] != INST_SOURCE_SCHEMA:
        errors.append(f"schema must be {INST_SOURCE_SCHEMA!r}")
    for hex_field in ("snapshot_sha256", "view_definition_digest"):
        value = document[hex_field]
        if not isinstance(value, str) or _SHA256.match(value) is None:
            errors.append(f"{hex_field} must be 64 lowercase hex characters")
    if not isinstance(document["snapshot_schema_version"], str) or not document[
        "snapshot_schema_version"
    ]:
        errors.append("snapshot_schema_version must be a non-empty string")
    version = document["snapshot_version"]
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append("snapshot_version must be a positive integer")
    try:
        parse_rfc3339z(document["created_at_utc"])
    except (TypeError, ValueError):
        errors.append("created_at_utc must be a strict RFC3339-Z timestamp")
    return errors

# Per-module structural policy: what each KNOWN module requires. Generic
# validation admits any module named here (well-formed per its policy) and
# rejects any module NOT named here; a separable standard-build parameter then
# additionally requires specific modules be present (default: congress).
_MODULE_POLICY: dict[str, dict] = {
    MODULE: {
        "required": REQUIRED_CONGRESS_ARTIFACTS,
        "watermarks": WATERMARK_KEYS,
        "db_artifact": DB_ARTIFACT,
        "db_artifacts": (DB_ARTIFACT,),
    },
    INST_MODULE: {
        "required": REQUIRED_INST_ARTIFACTS,
        "watermarks": INST_WATERMARK_KEYS,
        "db_artifact": INST_DB_ARTIFACT,
        # Both carry a logical_digest and both must be verified. `inst_serving.db`
        # is OPTIONAL in REQUIRED_INST_ARTIFACTS (a build predating M2-8 has none)
        # but when present it is verified exactly like the aggregate.
        "db_artifacts": (INST_DB_ARTIFACT, INST_SERVING_ARTIFACT),
    },
}
# Every module's database artifact name — the artifacts that MUST carry a
# `logical_digest` (§5.5). Kept as a set so `_validate_artifact` is module-blind.
_DB_ARTIFACTS = frozenset(
    name for policy in _MODULE_POLICY.values() for name in policy["db_artifacts"]
)


# --- F-26 (ALPHA-UX): the module-presence gate -------------------------------
#
# A logo-only deploy once shipped a build with the entire institutional module
# missing; the site failed QUIETLY into a legitimate-looking "withheld" page.
# Fail-safe without an alarm is indistinguishable from working. The gate is a
# DECLARED EXPECTATION, never a previous-build comparison (a first build has
# nothing to compare to; a second consecutive broken build would pass; a
# deliberate withdrawal would be indistinguishable from breakage).

#: The expected module set for a standard release. Shrinking it — publishing
#: without a module it names and without a source-owned withholding — requires
#: the publisher to pass an explicitly smaller expected set: that is the
#: authorization for a product removal, and it is visible in the invocation.
DEFAULT_EXPECTED_MODULES: frozenset[str] = frozenset({MODULE, INST_MODULE})

#: The CLOSED list of source-owned quality-gate withholding reasons — exactly
#: the typed reasons the inst coverage gate emits. Free text does not satisfy
#: the `withheld` exit rule; an unlisted reason is a validation defect.
WITHHOLDING_REASONS: frozenset[str] = frozenset(
    {"below_threshold", "cover_failed", "not_measurable"}
)

#: Typed disposition states. Every expected module must carry exactly one.
_DISPOSITION_STATES = frozenset({"served", "withheld", "unexpected-error"})


def check_module_dispositions(
    dispositions: dict[str, dict],
    *,
    expected_modules: frozenset[str] = DEFAULT_EXPECTED_MODULES,
) -> list[str]:
    """The F-26 gate: every expected module carries a typed disposition, and
    every disposition's exit behavior is explicit. Returns every defect; a
    non-empty return is publication-fatal at the call site.

    Exit rules (a type without an exit rule is not a gate):

    * ``served`` → publish.
    * ``withheld`` → publish ONLY with an enumerated source-owned reason from
      :data:`WITHHOLDING_REASONS`. Free text does not satisfy it.
    * ``unexpected-error`` → publication-fatal, always — this is the case that
      motivated the gate; typing it and letting it through would reproduce the
      exact outage with better labelling.
    * no disposition on an expected module → publication-fatal.
    """
    errors: list[str] = []
    for module in sorted(expected_modules):
        if module not in dispositions:
            errors.append(
                f"expected module {module!r} has NO disposition — an expected module"
                " that simply vanishes is exactly the silent-outage case; declare"
                " `served`, a source-owned withholding, or shrink the expected set"
                " explicitly (a product removal requires that authorization)"
            )
    for module, disposition in sorted(dispositions.items()):
        if module not in _MODULE_POLICY:
            errors.append(f"disposition names unknown module {module!r}")
            continue
        state = disposition.get("state") if isinstance(disposition, dict) else None
        if state not in _DISPOSITION_STATES:
            errors.append(
                f"module {module}: disposition state must be one of"
                f" {sorted(_DISPOSITION_STATES)} (got {state!r})"
            )
            continue
        if state == "served":
            continue
        if state == "unexpected-error":
            errors.append(
                f"module {module}: disposition is `unexpected-error` —"
                " publication-fatal, always"
            )
            continue
        # withheld
        reason = disposition.get("reason")
        if reason not in WITHHOLDING_REASONS:
            errors.append(
                f"module {module}: `withheld` requires an enumerated source-owned"
                f" quality-gate reason from {sorted(WITHHOLDING_REASONS)}"
                f" (got {reason!r}) — free text does not satisfy the exit rule"
            )
    return errors


def module_db_artifact(module: str = MODULE) -> str:
    """The PRIMARY database artifact for *module* (e.g. ``inst`` → ``inst_agg.db``).

    Retained for callers that genuinely want one name. Anything that VERIFIES,
    uploads, resumes or rolls back must use :func:`module_db_artifacts` instead —
    resolving the scalar here is exactly how a second asset gets silently skipped
    (external review r3 F9).
    """
    return _MODULE_POLICY[module]["db_artifact"]


def module_db_artifacts(module: str = MODULE) -> tuple[str, ...]:
    """EVERY database artifact for *module*, in deterministic order.

    Each carries a `logical_digest` and each must be verified independently. A
    module may legitimately publish a subset (a pre-M2-8 build has no
    `inst_serving.db`), so callers skip a name the manifest does not list — but
    they must never skip a name the manifest DOES list.
    """
    return tuple(_MODULE_POLICY[module]["db_artifacts"])

_BUILD_ID = re.compile(r"^\d{8}\.\d+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SCHEMA_VERSION = re.compile(r"^\d+\.\d+$")
# A canonical GitHub Release download URL — host pinned to github.com, path
# pinned to <owner>/<repo>/releases/download/data-<build_id>/<asset>. This
# forbids the "any HTTPS host containing the build tag" class (F5): a crafted
# manifest cannot point a token-bearing fetch at an arbitrary origin.
_RELEASE_URL = re.compile(
    r"^https://github\.com/"
    r"(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/"
    r"(?P<repo>[A-Za-z0-9][A-Za-z0-9._-]*)/releases/download/"
    r"data-(?P<build_id>\d{8}\.\d+)/(?P<asset>[A-Za-z0-9][A-Za-z0-9._-]*)$"
)

_MODULE_FIELDS = {
    "schema_version",
    "client_compat",
    "deprecation",
    "normalization_version",
    "digest_projection_version",
    "watermarks",
    "artifacts",
}
_TOP_FIELDS = {"build_id", "created_at", "previous_build_id", "publisher", "modules"}
_ARTIFACT_FIELDS = {"name", "sha256", "bytes", "path", "url", "license_ids", "logical_digest"}


def parse_release_download_url(url: object) -> dict[str, str] | None:
    """Parse a canonical GitHub Release download URL into its pinned parts.

    Returns ``{owner, repo, build_id, asset}`` for a URL that matches the strict
    ``https://github.com/<owner>/<repo>/releases/download/data-<build_id>/<asset>``
    grammar, else ``None``. The single source of truth for the release-URL
    shape, shared by manifest validation and the authenticated client fetcher
    (so a token is only ever resolved for a URL under the configured repo).
    """
    if not isinstance(url, str):
        return None
    match = _RELEASE_URL.match(url)
    if match is None:
        return None
    return match.groupdict()


def safe_artifact_name(name: object) -> bool:
    """Whether *name* conforms to the artifact-name grammar (R29).

    Slash-separated segments, each starting with an alphanumeric and drawn
    from ``[A-Za-z0-9._-]`` — which structurally excludes absolute paths,
    ``.``/``..`` traversal, backslashes, spaces, and control characters.
    """
    if not isinstance(name, str) or not name or len(name) > 200:
        return False
    return all(_SEGMENT.match(segment) for segment in name.split("/"))


def validate_locator(locator: object) -> list[str]:
    """Strict POSIX-relative locator grammar; returns every defect."""
    if not isinstance(locator, str) or not locator:
        return ["locator must be a non-empty string"]
    errors: list[str] = []
    if locator.startswith("/"):
        errors.append("locator must be relative, not absolute")
    if "\\" in locator:
        errors.append("locator must use '/' separators, never backslash")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in locator):
        errors.append("locator must not contain control characters")
    if not errors and not safe_artifact_name(locator):
        errors.append("locator has an empty, dotted, or malformed path segment")
    return errors


def resolve_within(root: Path | str, locator: str) -> Path:
    """Resolve *locator* under *root*, grammar-checked and escape-contained.

    Delegates the containment proof to ``populus.ingest.archive_path`` (the
    existing tested escape-proof join), after the grammar rejects traversal
    forms the resolver would otherwise normalize away.
    """
    errors = validate_locator(locator)
    if errors:
        raise UnsafeArchivePathError(f"bad locator {locator!r}: {'; '.join(errors)}")
    return archive_path(Path(root), locator)


@dataclass(frozen=True)
class ArtifactEntry:
    """One enumerated artifact: exactly one of ``path`` / ``url`` is set."""

    name: str
    sha256: str
    bytes: int
    license_ids: tuple[str, ...]
    path: str | None = None
    url: str | None = None
    logical_digest: str | None = None

    def to_dict(self) -> dict:
        entry: dict = {
            "name": self.name,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "license_ids": sorted(self.license_ids),
        }
        if self.logical_digest is not None:
            entry["logical_digest"] = self.logical_digest
        if self.path is not None:
            entry["path"] = self.path
        if self.url is not None:
            entry["url"] = self.url
        return entry


def build_manifest(
    *,
    build_id: str,
    created_at: str,
    previous_build_id: str | None,
    watermarks: dict,
    artifacts: Iterable[ArtifactEntry],
    pipeline_version: str | None = None,
    normalization_version: str | None = None,
    deprecation: dict | None = None,
) -> dict:
    """The §5.5 manifest document, field for field."""
    from populus.normalize import NORMALIZATION_VERSION

    return {
        "build_id": build_id,
        "created_at": created_at,
        "previous_build_id": previous_build_id,
        "publisher": {
            "pipeline_version": pipeline_version or populus.__version__,
        },
        "modules": {
            MODULE: {
                "schema_version": MANIFEST_SCHEMA_VERSION,
                "client_compat": CLIENT_COMPAT,
                "deprecation": deprecation,
                "normalization_version": (
                    normalization_version or NORMALIZATION_VERSION
                ),
                "digest_projection_version": LOGICAL_PROJECTION_VERSION,
                "watermarks": watermarks,
                "artifacts": [entry.to_dict() for entry in artifacts],
            }
        },
    }


def render_manifest(manifest: dict) -> str:
    """Byte-stable rendering: sorted keys, two-space indent, one newline."""
    return json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _validate_artifact(
    entry: object,
    *,
    build_id: str,
    register_ids: set[str] | None,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(entry, dict):
        return ["artifact entry is not an object"]
    label = entry.get("name", "<unnamed artifact>")
    for extra in sorted(set(entry) - _ARTIFACT_FIELDS):
        errors.append(f"{label}: unexpected field {extra!r}")
    if not safe_artifact_name(entry.get("name")):
        errors.append(f"{label}: name violates the artifact-name grammar")
    sha = entry.get("sha256")
    if not isinstance(sha, str) or _SHA256.match(sha) is None:
        errors.append(f"{label}: sha256 must be 64 lowercase hex characters")
    size = entry.get("bytes")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        errors.append(f"{label}: bytes must be a non-negative integer")
    licenses = entry.get("license_ids")
    if (
        not isinstance(licenses, list)
        or not licenses
        or not all(isinstance(item, str) for item in licenses)
    ):
        errors.append(f"{label}: license_ids must be a non-empty list of strings")
    elif register_ids is not None:
        for unknown in sorted(set(licenses) - register_ids):
            errors.append(f"{label}: license_id {unknown!r} not in the register")
    path, url = entry.get("path"), entry.get("url")
    if (path is None) == (url is None):
        errors.append(f"{label}: exactly one of path/url is required")
    elif path is not None:
        errors.extend(f"{label}: {err}" for err in validate_locator(path))
        if not (
            isinstance(path, str)
            and (
                path.startswith(f"builds/{build_id}/")
                or path.startswith(f"releases/data-{build_id}/")
            )
        ):
            errors.append(f"{label}: path is not scoped to build {build_id}")
    else:
        release = _RELEASE_URL.match(url) if isinstance(url, str) else None
        if release is None:
            errors.append(
                f"{label}: url must be a canonical https://github.com/…/releases"
                "/download/data-<build_id>/<asset> URL"
            )
        elif release.group("build_id") != build_id:
            errors.append(f"{label}: url is not scoped to build {build_id}")
        elif release.group("asset") != entry.get("name"):
            errors.append(f"{label}: url asset segment must equal the artifact name")
    logical = entry.get("logical_digest")
    if entry.get("name") in _DB_ARTIFACTS:
        if not isinstance(logical, str) or _SHA256.match(logical) is None:
            errors.append(f"{label}: the database artifact requires logical_digest")
    elif logical is not None and (
        not isinstance(logical, str) or _SHA256.match(logical) is None
    ):
        errors.append(f"{label}: logical_digest must be 64 lowercase hex characters")
    # RUN M2-11 (R24): the provenance artifact is ordinary, never a database —
    # a logical_digest on it would signal DB semantics to the five consumers
    # that key on that field, so its presence is a defect, not a nicety.
    if entry.get("name") == INST_SOURCE_ARTIFACT and logical is not None:
        errors.append(
            f"{label}: {INST_SOURCE_ARTIFACT} is an ordinary path-backed"
            " provenance artifact and must not carry a logical_digest"
        )
    return errors


def validate_manifest(
    manifest: object,
    *,
    required_modules: frozenset[str] = frozenset({MODULE}),
    register_ids: set[str] | None = None,
) -> list[str]:
    """Structural validation of the §5.5 manifest; returns every defect.

    Generic contract (always): ``modules`` is non-empty; every present module is
    a KNOWN, well-formed module (an unknown name is rejected); each module is
    validated against its own policy (watermark keys, required artifacts) and its
    database artifact must carry a ``logical_digest``. Standard-build contract
    (separable): every name in *required_modules* must be present — the default
    ``{congress}`` preserves every existing caller's guarantee that the congress
    module (which RUN-5 consumers dereference unconditionally) is present, while
    ``frozenset()`` admits a generic single-module (e.g. inst-only) manifest.
    """
    if not isinstance(manifest, dict):
        return ["manifest is not a JSON object"]
    errors: list[str] = []
    present = set(manifest)
    for missing in sorted(_TOP_FIELDS - present):
        errors.append(f"missing field {missing!r}")
    for extra in sorted(present - _TOP_FIELDS):
        errors.append(f"unexpected field {extra!r}")
    if errors:
        return errors
    build_id = manifest["build_id"]
    if not isinstance(build_id, str) or _BUILD_ID.match(build_id) is None:
        return ["build_id must match YYYYMMDD.N"]
    try:
        parse_rfc3339z(manifest["created_at"])
    except ValueError:
        errors.append("created_at must be a strict RFC3339-Z timestamp")
    previous = manifest["previous_build_id"]
    if previous is not None and (
        not isinstance(previous, str) or _BUILD_ID.match(previous) is None
    ):
        errors.append("previous_build_id must be null or match YYYYMMDD.N")
    publisher = manifest["publisher"]
    if not isinstance(publisher, dict) or not isinstance(
        publisher.get("pipeline_version"), str
    ):
        errors.append("publisher.pipeline_version must be a string")
    modules = manifest["modules"]
    if not isinstance(modules, dict) or not modules:
        return errors + ["modules must be a non-empty object"]
    # Standard-build requirement (separable from the generic contract). RUN-5
    # consumers (monitor, verifier, client, journal, rollback) dereference the
    # `congress` module unconditionally, so its absence must be a validation
    # defect, not a downstream KeyError. The default {congress} keeps that
    # guarantee for every caller; an inst-only generic validation passes
    # frozenset().
    for required_module in sorted(required_modules):
        if required_module not in modules:
            errors.append(f"missing required module {required_module!r}")
    for module_name, module in sorted(modules.items()):
        if not isinstance(module, dict):
            errors.append(f"module {module_name}: not an object")
            continue
        # Only KNOWN modules are admitted: an unknown name has no policy to
        # validate against, so it is a defect outright (F1) — unknown modules
        # never pass as well-formed.
        if module_name not in _MODULE_POLICY:
            errors.append(
                f"module {module_name}: unknown module (not one of"
                f" {sorted(_MODULE_POLICY)})"
            )
            continue
        policy = _MODULE_POLICY[module_name]
        for missing in sorted(_MODULE_FIELDS - set(module)):
            errors.append(f"module {module_name}: missing field {missing!r}")
        for extra in sorted(set(module) - _MODULE_FIELDS):
            errors.append(f"module {module_name}: unexpected field {extra!r}")
        if _MODULE_FIELDS - set(module):
            continue
        if not isinstance(module["schema_version"], str) or _SCHEMA_VERSION.match(
            module["schema_version"]
        ) is None:
            errors.append(f"module {module_name}: schema_version must be MAJOR.MINOR")
        compat = module["client_compat"]
        if not isinstance(compat, str):
            errors.append(f"module {module_name}: client_compat must be a string")
        else:
            try:
                SpecifierSet(compat)
            except InvalidSpecifier:
                errors.append(
                    f"module {module_name}: client_compat is not a valid"
                    f" PEP 440 specifier: {compat!r}"
                )
        if not isinstance(module["normalization_version"], str):
            errors.append(f"module {module_name}: normalization_version must be a string")
        if not isinstance(module["digest_projection_version"], str):
            errors.append(
                f"module {module_name}: digest_projection_version must be a string"
            )
        watermarks = module["watermarks"]
        if not isinstance(watermarks, dict):
            errors.append(f"module {module_name}: watermarks must be an object")
        else:
            # R3/F12: exactly the module's required watermark keys must be
            # present, so a publication carrying no freshness evidence (an empty
            # map) cannot pass as fresh. Values are a timestamp string or null (a
            # null is a legitimate "no evidence yet" value; an absent key is not).
            watermark_keys = policy["watermarks"]
            if set(watermarks) != set(watermark_keys):
                errors.append(
                    f"module {module_name}: watermarks must have exactly the"
                    f" keys {sorted(watermark_keys)}"
                )
            for key, value in watermarks.items():
                if value is not None and not isinstance(value, str):
                    errors.append(
                        f"module {module_name}: watermark {key} must be a"
                        " string timestamp or null"
                    )
        artifacts = module["artifacts"]
        if not isinstance(artifacts, list) or not artifacts:
            errors.append(f"module {module_name}: artifacts must be a non-empty list")
            continue
        seen_names: set[str] = set()
        for entry in artifacts:
            errors.extend(
                _validate_artifact(
                    entry, build_id=build_id, register_ids=register_ids
                )
            )
            name = entry.get("name") if isinstance(entry, dict) else None
            if isinstance(name, str):
                if name in seen_names:
                    errors.append(f"module {module_name}: duplicate artifact {name!r}")
                seen_names.add(name)
        # F6: every KNOWN module must enumerate its full mandatory artifact set
        # — a semantically partial build (congress missing the DB, feed, stats,
        # or any licensing artifact; inst missing inst_agg.db) is refused here,
        # before a consumer persists a higher pointer and makes an incomplete
        # build current (R2/R3/R8/R10).
        for required in policy["required"]:
            if required not in seen_names:
                errors.append(
                    f"module {module_name}: missing required artifact {required!r}"
                )
    return errors


def pointer_manifest_identity_error(manifest: object, pointer_build_id: str) -> str | None:
    """A cross-build binding defect, or ``None`` when the identities agree.

    Centralizes the §5.5 rule that a pointer for build A must authenticate
    build A's manifest — a hash-consistent manifest whose ``build_id`` differs
    would cross-bind identities and defeat cache identity, monitor state, and
    rollback (R10/R17/R24). Applied identically by the client, monitor, and
    verifier.
    """
    if not isinstance(manifest, dict) or "build_id" not in manifest:
        return "manifest has no build_id"
    if manifest["build_id"] != pointer_build_id:
        return (
            f"manifest build_id {manifest['build_id']!r} does not match the"
            f" pointer's build_id {pointer_build_id!r} — refusing a cross-build"
            " binding"
        )
    return None


def module_artifacts(manifest: dict, module: str = MODULE) -> list[dict]:
    """The artifact entries of one module (validated manifests only)."""
    return manifest["modules"][module]["artifacts"]


def find_artifact(manifest: dict, name: str, module: str = MODULE) -> dict | None:
    for entry in module_artifacts(manifest, module):
        if entry.get("name") == name:
            return entry
    return None
