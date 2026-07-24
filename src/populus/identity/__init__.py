"""Temporal identity registries (ARCHITECTURE.md §5.4 — RUN M2-1).

Shared substrate for every module that has to say "which company is this"
and "which instrument is this" *as of a date*. M2 (13F) and M3 (company
financials) both resolve through it; M1 never touches it.

Two rules shape everything here:

- **G14, no identity time travel.** Every mapping carries a half-open
  ``[valid_from, valid_to)`` interval and every resolver takes a required
  as-of date. There is no "current" mapping usable at an arbitrary date, and
  no identifier -> entity path that skips the date, so CUSIP -> current
  ticker -> CIK cannot be expressed.
- **Fail closed (G3).** A lookup without a unique, undisputed, applicable
  row returns ``None``; the caller surfaces the record by name with a flag.
  Nothing is guessed, and nothing is silently dropped.

Durable identity is *declared*, not derived: ``securities.yaml`` is the
authority for stable ``security_id``s, observations only add dated bindings,
and an identifier named by no class gets an explicitly provisional id.
"""

from __future__ import annotations

from populus.identity.registry import (
    REUSE_REVIEW_HORIZON_DAYS,
    SECURITY_ID_REFERENCING_TABLES,
    EntityRef,
    IdentityRegistry,
    IdentityRegistryError,
    anchor,
    cut_interval,
    default_securities_text,
    ensure_registry,
    entity_id_for,
    load_identity_registry,
    normalize_cik,
    normalize_cusip,
    normalize_entity_name,
    normalize_ticker,
    owner_windows,
    provisional_security_id,
    reconcile_identity_registry,
    reconcile_only,
    registry_overlap_errors,
    resolve_cusip,
    resolve_entity_by_cik,
    resolve_security_successor,
    resolve_superseded,
    resolve_ticker_as_of,
    target_for,
    union_intervals,
)

__all__ = [
    "REUSE_REVIEW_HORIZON_DAYS",
    "SECURITY_ID_REFERENCING_TABLES",
    "EntityRef",
    "IdentityRegistry",
    "IdentityRegistryError",
    "anchor",
    "cut_interval",
    "default_securities_text",
    "ensure_registry",
    "entity_id_for",
    "load_identity_registry",
    "normalize_cik",
    "normalize_cusip",
    "normalize_entity_name",
    "normalize_ticker",
    "owner_windows",
    "provisional_security_id",
    "reconcile_identity_registry",
    "reconcile_only",
    "registry_overlap_errors",
    "resolve_cusip",
    "resolve_entity_by_cik",
    "resolve_security_successor",
    "resolve_superseded",
    "resolve_ticker_as_of",
    "target_for",
    "union_intervals",
]
