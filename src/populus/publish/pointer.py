"""``latest.json`` — schema, rendering, the four-way state machine (§5.5).

The pointer is the sole mutable path any consumer ever reads. Every verifier
persists the last accepted two-field ``(pointer_version, pointer_sha256)``
tuple; universal preconditions (schema, expiry, future-issuance, attestation)
run on every fetched pointer BEFORE any version comparison, so an
unchanged-but-expired pointer is rejected, never idempotently accepted.

Timestamps are strict RFC 3339 ``Z`` form (``YYYY-MM-DDTHH:MM:SSZ``) — no
offsets, no fractional seconds — validated before any datetime parsing.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from populus.publish import atomic_write_bytes
from populus.publish.attestation import AttestationProvider

POINTER_EXPIRY_DAYS = 7
ISSUANCE_SKEW_SECONDS = 300

POINTER_FIELDS = (
    "build_id",
    "expires_at",
    "issued_at",
    "manifest_path",
    "manifest_sha256",
    "pointer_version",
)

_RFC3339Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_BUILD_ID = re.compile(r"^\d{8}\.\d+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def rfc3339z(moment: datetime) -> str:
    """Render an aware UTC datetime in the strict ``Z`` form."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_rfc3339z(value: str) -> datetime:
    """Parse the strict ``Z`` form only; anything else raises ``ValueError``."""
    if not isinstance(value, str) or _RFC3339Z.match(value) is None:
        raise ValueError(f"not a strict RFC3339-Z timestamp: {value!r}")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )


def build_pointer(
    *,
    pointer_version: int,
    issued_at: datetime,
    build_id: str,
    manifest_sha256: str,
) -> dict:
    """A pointer document; ``expires_at`` = issued + 7 days (§5.5)."""
    return {
        "pointer_version": pointer_version,
        "issued_at": rfc3339z(issued_at),
        "expires_at": rfc3339z(issued_at + timedelta(days=POINTER_EXPIRY_DAYS)),
        "build_id": build_id,
        "manifest_path": f"builds/{build_id}/manifest.json",
        "manifest_sha256": manifest_sha256,
    }


def render_pointer(pointer: dict) -> str:
    """Byte-stable rendering: sorted keys, two-space indent, one newline."""
    return json.dumps(pointer, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def validate_pointer(pointer: object) -> list[str]:
    """Schema validation; returns every defect (empty = valid)."""
    errors: list[str] = []
    if not isinstance(pointer, dict):
        return ["pointer is not a JSON object"]
    present = set(pointer)
    expected = set(POINTER_FIELDS)
    for missing in sorted(expected - present):
        errors.append(f"missing field {missing!r}")
    for extra in sorted(present - expected):
        errors.append(f"unexpected field {extra!r}")
    if errors:
        return errors
    version = pointer["pointer_version"]
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append("pointer_version must be a positive integer")
    for name in ("issued_at", "expires_at"):
        try:
            parse_rfc3339z(pointer[name])
        except ValueError:
            errors.append(f"{name} must be a strict RFC3339-Z timestamp")
    build_id = pointer["build_id"]
    if not isinstance(build_id, str) or _BUILD_ID.match(build_id) is None:
        errors.append("build_id must match YYYYMMDD.N")
    elif pointer["manifest_path"] != f"builds/{build_id}/manifest.json":
        errors.append("manifest_path must be builds/<build_id>/manifest.json")
    sha = pointer["manifest_sha256"]
    if not isinstance(sha, str) or _SHA256.match(sha) is None:
        errors.append("manifest_sha256 must be 64 lowercase hex characters")
    if not errors:
        issued = parse_rfc3339z(pointer["issued_at"])
        expires = parse_rfc3339z(pointer["expires_at"])
        # expires_at is exactly issued_at + 7 days — the staleness bound is
        # a fixed window, not merely "later than issuance".
        if expires != issued + timedelta(days=POINTER_EXPIRY_DAYS):
            errors.append(
                f"expires_at must equal issued_at + {POINTER_EXPIRY_DAYS} days"
            )
    return errors


# --- the persisted trust tuple (exactly two fields) --------------------------


class TrustTupleError(ValueError):
    """The persisted trust tuple exists but is unreadable or malformed."""


def load_tuple(path: Path | str) -> tuple[int, str] | None:
    """The persisted ``(pointer_version, pointer_sha256)`` tuple.

    ``None`` when no tuple was ever persisted (bootstrap); a present-but-
    corrupt tuple raises :class:`TrustTupleError` — the monitor fails closed
    on it, the client treats it as state loss (TD-7).
    """
    path = Path(path)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TrustTupleError(f"corrupt trust tuple at {path}: {exc}") from exc
    if (
        not isinstance(raw, dict)
        or set(raw) != {"pointer_version", "pointer_sha256"}
        or not isinstance(raw.get("pointer_version"), int)
        or isinstance(raw.get("pointer_version"), bool)
        # A valid pointer_version is a positive int (§5.5); a zero or
        # negative value is corrupt state, not a low trusted floor — the
        # monitor must fail closed on it, never silently bootstrap.
        or raw["pointer_version"] < 1
        or not isinstance(raw.get("pointer_sha256"), str)
        or _SHA256.match(raw["pointer_sha256"]) is None
    ):
        raise TrustTupleError(f"corrupt trust tuple at {path}: bad shape")
    return (raw["pointer_version"], raw["pointer_sha256"])


def persist_tuple(path: Path | str, pointer_version: int, pointer_sha256: str) -> None:
    """Atomically persist the two-field tuple (temp + fsync + ``os.replace``).

    Exactly two fields — install metadata beyond the tuple is advisory and
    lives elsewhere (§5.5; the replay/equivocation anchor never widens).
    The rendered document ends with a single trailing newline.
    """
    document = {
        "pointer_version": pointer_version,
        "pointer_sha256": pointer_sha256,
    }
    data = (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("utf-8")
    atomic_write_bytes(Path(path), data, mode=0o600)


# --- the state machine -------------------------------------------------------


@dataclass(frozen=True)
class PointerDecision:
    """Outcome of evaluating one fetched pointer.

    ``status`` ∈ ``install`` (higher version — verify → install → persist),
    ``bootstrap`` (no tuple held; accepts one universally valid pointer —
    TD-7, clients only), ``idempotent`` (equal version, identical bytes),
    ``replay`` (lower version), ``equivocation`` (equal version, different
    bytes), ``invalid`` (schema), ``stale`` (expired), ``future_issued``,
    ``attestation_rejected``.
    """

    status: str
    pointer: dict | None
    pointer_sha256: str
    errors: tuple[str, ...] = field(default=())

    @property
    def accepted(self) -> bool:
        return self.status in ("install", "bootstrap", "idempotent")


def evaluate_pointer(
    pointer_bytes: bytes,
    *,
    now: datetime,
    trust: tuple[int, str] | None,
    attestation: AttestationProvider,
) -> PointerDecision:
    """§5.5 pointer state machine: universal preconditions, then versions.

    Universal checks run on every fetched pointer BEFORE any version
    comparison and are evaluated against the injected current clock on every
    refresh — no cached result can satisfy them.
    """
    sha = hashlib.sha256(pointer_bytes).hexdigest()
    try:
        pointer = json.loads(pointer_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return PointerDecision("invalid", None, sha, (f"unparseable pointer: {exc}",))
    schema_errors = validate_pointer(pointer)
    if schema_errors:
        return PointerDecision("invalid", None, sha, tuple(schema_errors))
    expires = parse_rfc3339z(pointer["expires_at"])
    if expires <= now:
        return PointerDecision(
            "stale", pointer, sha, (f"pointer expired at {pointer['expires_at']}",)
        )
    issued = parse_rfc3339z(pointer["issued_at"])
    if issued > now + timedelta(seconds=ISSUANCE_SKEW_SECONDS):
        return PointerDecision(
            "future_issued",
            pointer,
            sha,
            (f"pointer issued in the future: {pointer['issued_at']}",),
        )
    verdict = attestation.verify("latest.json", pointer_bytes)
    if not verdict.ok:
        return PointerDecision(
            "attestation_rejected", pointer, sha, (verdict.detail,)
        )
    if trust is None:
        return PointerDecision("bootstrap", pointer, sha)
    held_version, held_sha = trust
    version = pointer["pointer_version"]
    if version < held_version:
        return PointerDecision(
            "replay",
            pointer,
            sha,
            (f"pointer_version {version} below persisted {held_version}",),
        )
    if version == held_version:
        if sha == held_sha:
            return PointerDecision("idempotent", pointer, sha)
        return PointerDecision(
            "equivocation",
            pointer,
            sha,
            (
                f"two distinct pointers at version {version}:"
                f" held {held_sha}, fetched {sha}",
            ),
        )
    return PointerDecision("install", pointer, sha)
