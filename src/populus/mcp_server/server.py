"""``populus-mcp`` — the stdio FastMCP server (§9.9, §11).

Read-only over a published snapshot. Congress analyst tools plus the M2
institutional (13F) tools, plus ``populus_health``; every response uses the
honesty envelope (§11.3). The congress tools read the published ``congress.db``;
the inst snapshot tools read the published ``inst_agg.db`` (and degrade honestly
when the inst module is absent), while ``inst_ticker_holders`` federates to SEC
EDGAR live at question time (§11.4).

This module is the composition root: it parses the CLI, resolves the published
snapshot(s), opens the database connections, constructs the FastMCP app, and
registers the two tool domains — the seven ``congress_*`` tools from
``congress_tools.py`` and the five ``inst_*`` tools from
``institutional_tools.py`` (which also documents the retained M2-CONTRACT §3.1
federated boundary). Only the cross-domain ``populus_health`` tool is defined
here.
"""

from __future__ import annotations

import argparse

from populus.publish.attestation import PROVIDER_CHOICES
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from populus.mcp_server import envelope as env
from populus.mcp_server import inst_queries as iq
from populus.mcp_server import queries as q
from populus.mcp_server.congress_tools import register_congress_tools
from populus.mcp_server.institutional_tools import (
    _SERVING_DETAIL_SQL,  # noqa: F401 — re-exported: contract tests pin it here
    _SERVING_REQUIRED_TABLES,  # noqa: F401 — re-exported: contract tests pin it here
    inst_health_caveats,
    register_institutional_tools,
)
from populus.net.sec_client import SecClient
from populus.normalize_inst import INST_DATA_NOTE


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_server(
    *,
    db_path: str,
    build_id: str | None,
    now: Callable[[], datetime] = _utc_now,
    inst_db_path: str | None = None,
    inst_build_id: str | None = None,
    inst_watermarks: dict[str, Any] | None = None,
    inst_from_published_manifest: bool = False,
    inst_absent_reason: str | None = None,
    inst_absent_gate_withheld: bool = False,
    inst_stale_withdrawal_pending: bool = False,
    inst_serving_db_path: str | None = None,
    inst_serving_absent_reason: str | None = None,
    sec_client: SecClient | None = None,
) -> FastMCP:
    """Construct the FastMCP app bound to the read-only snapshot(s).

    ``db_path`` is the required congress snapshot. ``inst_db_path`` is the
    optional institutional aggregate (``inst_agg.db``); when it is ``None`` the
    inst module is legitimately absent from the published snapshot and every inst
    snapshot tool degrades honestly (never crashes, never fabricates a
    withholding reason). ``sec_client`` is the injectable federated client used
    by ``inst_filer_holdings(mode='detail')`` and ``inst_ticker_holders``; a test
    injects a fake transport so no live network is ever reached.

    ``inst_from_published_manifest`` records whether the institutional DB was
    resolved through a VERIFIED published manifest. A ``--inst-db`` bypass points
    at an arbitrary local file that never passed the M2-3 publish gate, so no
    coverage guarantee may be asserted for it.

    ``inst_serving_db_path`` is the published per-filer projection
    (``inst_serving.db``) — a SEPARATE artifact from the aggregate, and the
    oracle for the M2-CONTRACT §3.1 federated boundary. It is optional because a
    pre-M2-8 build publishes none; when it is absent ``inst_serving_absent_reason``
    says why, and that reason travels onto every response whose routing it
    changed. The aggregate is NEVER used in its place.
    """
    mcp = FastMCP("populus")
    conn = q.connect(db_path)
    inst_conn = q.connect(inst_db_path) if inst_db_path else None

    def as_of() -> str:
        return now().isoformat()

    _INST_ABSENT = inst_absent_reason or (
        "the institutional (13F) module is not present in the current published"
        " snapshot"
    )

    register_congress_tools(
        mcp, conn=conn, build_id=build_id, now=now, as_of=as_of
    )
    register_institutional_tools(
        mcp,
        as_of=as_of,
        inst_conn=inst_conn,
        inst_db_path=inst_db_path,
        inst_build_id=inst_build_id,
        inst_watermarks=inst_watermarks,
        inst_from_published_manifest=inst_from_published_manifest,
        inst_absent_reason=inst_absent_reason,
        inst_absent_gate_withheld=inst_absent_gate_withheld,
        inst_stale_withdrawal_pending=inst_stale_withdrawal_pending,
        inst_serving_db_path=inst_serving_db_path,
        inst_serving_absent_reason=inst_serving_absent_reason,
        sec_client=sec_client,
    )

    @mcp.tool()
    def populus_health() -> dict[str, Any]:
        """Platform-level health: which data modules are loaded, the snapshot build, and freshness."""
        # `modules` lists only the modules actually present, so the M1 contract
        # (congress-only ⇒ ["congress"]) holds; an additive per-module detail
        # block reports each module's build + freshness without changing the
        # existing keys.
        modules = ["congress"]
        module_detail: dict[str, Any] = {
            "congress": {"present": True, "snapshot_build": build_id}
        }
        if inst_conn is not None:
            modules.append("inst")
            watermarks = inst_watermarks or {}
            # The inst detail carries the SAME caveats + provenance inst_health
            # reports: a caller that only asks the platform-level health
            # question must not receive a freshness claim stripped of the
            # quarter-end/lag caveat, nor a coverage assurance it has not earned.
            # Freshness falls back to the aggregate's own latest period when no
            # manifest watermark exists, so a --inst-db run is not silently null.
            module_detail["inst"] = {
                "present": True,
                "snapshot_build": inst_build_id,
                "latest_period_of_report": watermarks.get("latest_period_of_report")
                or iq.filer_registry_stats(inst_conn)["latest_period"],
                "latest_filed_date": watermarks.get("latest_filed_date"),
                "caveats": inst_health_caveats(
                    inst_from_published_manifest,
                    stale_withdrawal_pending=inst_stale_withdrawal_pending,
                ),
                "provenance": (
                    "published-snapshot"
                    if inst_from_published_manifest
                    else "unverified-local-db"
                ),
                "stale_withdrawal_pending": inst_stale_withdrawal_pending,
                "data_note": INST_DATA_NOTE,
            }
        else:
            module_detail["inst"] = {
                "present": False,
                "reason": _INST_ABSENT,
                # Only the verified-omission state may be described as a gate
                # withholding; every other absence gets a neutral caveat that
                # asserts no gate decision.
                "caveats": inst_health_caveats(
                    False, absent=True, gate_withheld=inst_absent_gate_withheld
                ),
            }
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={"modules": modules, "snapshot_build": build_id,
                     "transport": "stdio", "read_only": True,
                     "module_detail": module_detail},
        )

    return mcp


def _inst_watermarks(manifest: dict | None) -> dict[str, Any] | None:
    """The inst module's manifest watermarks (latest period + filed date), or
    ``None`` when the manifest is absent/shapeless."""
    if not isinstance(manifest, dict):
        return None
    module = manifest.get("modules", {}).get("inst")
    if not isinstance(module, dict):
        return None
    watermarks = module.get("watermarks")
    return watermarks if isinstance(watermarks, dict) else None


def _attestation_provider(args):
    """Build the provider the operator selected. Never guesses.

    `sigstore` needs its fetcher and verifier wired here; without them
    `build_provider` raises, which previously made `--attestation=sigstore`
    unusable at this entry point even though it was offered in `choices`.
    """
    from populus.client.snapshot import github_bundle_fetcher
    from populus.publish.attestation import build_provider, github_trust_config

    if args.attestation == "sigstore":
        return build_provider(
            "sigstore",
            fetcher=github_bundle_fetcher(),
            trust_config=github_trust_config(),
        )
    return build_provider(args.attestation)


def _resolve_snapshot() -> dict[str, Any]:
    """CLI/env → the snapshot inputs for ``build_server``.

    ``--db`` / ``--inst-db`` are the per-module dev bypasses; otherwise the RUN-5
    snapshot client resolves the current published build for congress (required)
    and inst (optional — the inst module may legitimately be absent, in which
    case ``inst_db_path`` is ``None`` and the inst snapshot tools degrade
    honestly).
    """
    p = argparse.ArgumentParser(prog="populus-mcp")
    p.add_argument("--db", help="Read-only path to an ingested populus DB (dev bypass).")
    p.add_argument("--inst-db", help="Read-only path to an inst_agg.db (dev bypass,"
                   " mirrors --db for the institutional module).")
    p.add_argument("--inst-serving-db", help="Read-only path to an inst_serving.db"
                   " (dev bypass for the published per-filer projection). It is a"
                   " SEPARATE artifact from --inst-db; without it no published"
                   " per-filer detail is served and the §3.1 federated boundary"
                   " cannot be evaluated.")
    p.add_argument("--data-repo", default=os.environ.get("POPULUS_DATA_REPO", "../populus-data"),
                   help="Local populus-data working tree to resolve the snapshot from.")
    p.add_argument("--cache", default=os.environ.get("POPULUS_CACHE", str(Path.home() / ".cache" / "populus")))
    # No default: an entry point that forgets to choose must fail loudly rather
    # than inherit a no-op verifier that answers "verified" to everything. The --db dev-bypass path never builds a SnapshotClient,
    # so it is exempt and documented as such.
    p.add_argument(
        "--attestation",
        choices=PROVIDER_CHOICES,
        help="Which attestation provider verifies the snapshot. Required unless "
             "--db is given (that path reads a local DB and verifies nothing).",
    )
    args = p.parse_args()
    if args.db is None and args.attestation is None:
        p.error("--attestation is required when resolving a published snapshot")
    resolved: dict[str, Any] = {
        "inst_db_path": args.inst_db,
        "inst_build_id": None,
        "inst_watermarks": None,
        "inst_from_published_manifest": False,
        # The per-filer serving projection is resolved SEPARATELY from the
        # aggregate: one being present proves nothing about the other, and
        # substituting one for the other is exactly the substitution this boundary forbids.
        "inst_serving_db_path": args.inst_serving_db,
        "inst_serving_absent_reason": None,
        # Why inst is absent, DECIDED HERE where the facts are.
        # `populus_health` may only report what actually happened; it must not
        # assume the coverage gate withheld the module.
        "inst_absent_reason": None,
        "inst_absent_gate_withheld": False,
        "inst_stale_withdrawal_pending": False,
    }
    if args.inst_db is not None:
        resolved["inst_absent_reason"] = None  # present, but unverified
    if args.inst_serving_db is None:
        resolved["inst_serving_absent_reason"] = (
            "no --inst-serving-db was supplied and none has been resolved from"
            " the published snapshot yet"
        )
    if args.db:
        # Dev bypass: use only the explicitly-provided per-module paths; do not
        # touch the published snapshot (so `--db` alone leaves inst degrading
        # honestly while `mode='detail'` still federates).
        resolved["db_path"] = args.db
        resolved["build_id"] = None
        if args.inst_db is None:
            resolved["inst_absent_reason"] = (
                "this server was started with --db (a development bypass of the"
                " published snapshot) and no --inst-db, so no institutional"
                " database was loaded. NO coverage-gate decision was consulted."
            )
        if args.inst_serving_db is None:
            resolved["inst_serving_absent_reason"] = (
                "this server was started with --db (a development bypass of the"
                " published snapshot) and no --inst-serving-db, so no published"
                " per-filer projection was loaded and the M2-CONTRACT §3.1"
                " federated boundary cannot be evaluated."
            )
        return resolved
    # Resolve via the published snapshot (staging: local data-repo).
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    client = SnapshotClient(
        args.cache,
        LocalRepoFetcher(args.data_repo),
        now=_utc_now,
        attestation=_attestation_provider(args),
    )
    congress_outcome = client.refresh()
    db = client.db_path()
    if db is None:
        # Name the REAL cause. A disabled cache (e.g. no flock support) is not a
        # missing snapshot, and the generic advice would send an operator
        # chasing a publish problem they do not have.
        disabled = getattr(client, "_disabled_reason", None)
        if disabled:
            raise SystemExit(f"cannot use the snapshot cache: {disabled}")
        # Carry the client's own message: a corrupt congress anchor otherwise
        # exited with generic publish advice while the actionable remediation
        # was thrown away — the same gap the inst path below closes.
        detail = getattr(congress_outcome, "message", "") or ""
        raise SystemExit(
            "no current snapshot; run `populus build && populus publish` or"
            f" pass --db.{(' ' + detail) if detail else ''}"
        )
    resolved["db_path"] = str(db)
    resolved["build_id"] = client.current_build()
    if args.inst_db is None:
        # A module-level failure must NEVER take down the server (lifecycle
        # spec §7): any unexpected error resolving the OPTIONAL inst module
        # becomes an honest absence, not a traceback that kills congress and the
        # federated tools with it.
        try:
            _resolve_inst_module(args, resolved)
        except Exception as exc:  # noqa: BLE001 — module boundary
            resolved.update(
                inst_db_path=None,
                inst_build_id=None,
                inst_watermarks=None,
                inst_from_published_manifest=False,
                inst_absent_gate_withheld=False,
                inst_absent_reason=(
                    "the institutional module could not be resolved:"
                    f" {type(exc).__name__}: {exc}. This is a resolution"
                    " failure, NOT a statement about the coverage gate — no"
                    " gate decision was observed."
                ),
                # The serving projection lives inside the same module, so the
                # same failure took it out. Say so — leaving the earlier generic
                # reason would report a different cause than actually occurred.
                inst_serving_db_path=None,
                inst_serving_absent_reason=(
                    "the institutional module could not be resolved"
                    f" ({type(exc).__name__}: {exc}), so its per-filer serving"
                    " projection was not resolved either."
                ),
            )
    return resolved


def _resolve_inst_module(args, resolved: dict) -> None:
    """Resolve the optional inst module into *resolved*.

    Raises on failure; the caller turns that into an honest absence.
    """
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    # It may be absent (withheld this build); `refresh` then returns 'withdrawn'
    # with `verified_omission=True` and `db_path()` is None — a legitimate
    # absent-module signal, not an error.
    inst_client = SnapshotClient(
        args.cache,
        LocalRepoFetcher(args.data_repo),
        now=_utc_now,
        module="inst",
        attestation=_attestation_provider(args),
    )
    outcome = inst_client.refresh()
    # `db_path()` alone decides serving — it routes through `serving_build()`,
    # the sole oracle. An earlier version also consulted `verified_omission`
    # here; that was a tombstone-era patch, is redundant now that a committed
    # withdrawal always leaves either a null record or an anchor/record
    # mismatch (both absent), and was itself the second-inference pattern this
    # rewrite deleted (lifecycle spec §4/§6).
    inst_db = inst_client.db_path()
    if inst_db is None:
        # WHY it is absent still comes from the refresh result: only a VERIFIED
        # manifest omission may claim the coverage gate withheld it.
        verified_omission = bool(getattr(outcome, "verified_omission", False))
        observed = verified_omission or bool(
            getattr(outcome, "observed_omission", False)
        )
        resolved["inst_absent_gate_withheld"] = verified_omission
        if verified_omission:
            resolved["inst_absent_reason"] = (
                "the current published snapshot's verified manifest does not"
                " include the institutional module: the M2-3 publish gate"
                " withheld it rather than publish data whose identity coverage"
                " is below 95% by value."
            )
        elif observed:
            # A verified manifest omission WAS read; it just could not be
            # committed. Saying "no gate decision was observed" here would
            # deny a decision we actually saw.
            resolved["inst_absent_reason"] = (
                "the current published snapshot's verified manifest does not"
                " include the institutional module, but the withdrawal could"
                " not be committed to the local cache. Nothing is served for it"
                f" regardless. {getattr(outcome, 'message', '')}"
            ).strip()
        else:
            resolved["inst_absent_reason"] = (
                "the institutional module could not be resolved from the"
                f" published snapshot (refresh outcome:"
                f" {getattr(outcome, 'status', outcome)!r}). This is a"
                " resolution failure, NOT a statement about the coverage gate —"
                " no gate decision was observed."
                # The client's own message carries actionable remediation (e.g.
                # "Clear <module dir> ..."); discarding it left an operator with
                # nothing to act on.
                + (f" {outcome.message}" if getattr(outcome, "message", "") else "")
            )
        # The module is absent, so its serving projection is too — and for the
        # SAME reason. Restating it here keeps the boundary's story identical to
        # the module's instead of falling back to the generic default.
        resolved["inst_serving_db_path"] = None
        resolved["inst_serving_absent_reason"] = (
            "no published per-filer projection (inst_serving.db) is served"
            f" because the institutional module itself is absent:"
            f" {resolved['inst_absent_reason']}"
        )
        return
    resolved["inst_db_path"] = str(inst_db)
    resolved["inst_build_id"] = inst_client.current_build()
    resolved["inst_watermarks"] = _inst_watermarks(inst_client.current_manifest())
    # Resolved through the verified pointer→manifest chain, so the M2-3 publish
    # gate demonstrably held for these bytes.
    resolved["inst_from_published_manifest"] = True
    # The serving projection is a SECOND artifact of the same module, resolved by
    # name through the manifest. A build that predates M2-8 publishes none;
    # that is a legitimate absence, and the aggregate above is NOT a substitute
    # for it — `serving_db_path()` will not hand one back in its place.
    if args.inst_serving_db is None:
        # Scoped exactly like the module-level guard above, one level down: a
        # problem with the SECOND artifact must not delete the FIRST. Without
        # this, an unreadable serving projection would take the aggregate, the
        # qoq tool and inst health down with it.
        try:
            serving_db = inst_client.serving_db_path()
        except Exception as exc:  # noqa: BLE001 — artifact boundary
            serving_db = None
            reason = (
                "the per-filer serving projection could not be resolved"
                f" ({type(exc).__name__}: {exc}); the published aggregate is"
                " unaffected and is NOT used in its place."
            )
        else:
            reason = (
                f"the published build {inst_client.current_build()!r} does not"
                " carry a per-filer serving projection (inst_serving.db) in its"
                " verified manifest, so no published per-filer detail is served"
                " and the M2-CONTRACT §3.1 federated boundary cannot be"
                " evaluated. The cross-filer aggregate is NOT used in its place."
            )
        if serving_db is None:
            resolved["inst_serving_db_path"] = None
            resolved["inst_serving_absent_reason"] = reason
        else:
            resolved["inst_serving_db_path"] = str(serving_db)
            resolved["inst_serving_absent_reason"] = None
    if getattr(outcome, "observed_omission", False):
        # A verified manifest OMITTED the module but the withdrawal could not be
        # committed, so these bytes — though genuinely published once — are no
        # longer what the current build publishes. Serving them conforms to §4
        # (nothing committed, prior state stands), but reporting them as clean
        # published data with no signal would hide it.
        resolved["inst_stale_withdrawal_pending"] = True


def _build_sec_client() -> SecClient:
    """The live federated SEC client (real transport, wall clock)."""
    import time

    from populus.net.sec_client import HttpxSecTransport, sec_contact

    contact, _warning = sec_contact(warn=lambda msg: print(msg, file=sys.stderr))
    return SecClient(
        HttpxSecTransport(),
        contact=contact,
        sleep=time.sleep,
        monotonic=time.monotonic,
    )


def main() -> None:
    resolved = _resolve_snapshot()
    build_server(
        db_path=resolved["db_path"],
        build_id=resolved["build_id"],
        inst_db_path=resolved["inst_db_path"],
        inst_build_id=resolved["inst_build_id"],
        inst_watermarks=resolved["inst_watermarks"],
        # This fix is INERT unless production forwards this; it was
        # dropped here, so every published snapshot was mislabeled
        # `unverified-local-db` while only direct test construction worked
        inst_from_published_manifest=resolved["inst_from_published_manifest"],
        inst_absent_reason=resolved["inst_absent_reason"],
        inst_absent_gate_withheld=resolved["inst_absent_gate_withheld"],
        inst_stale_withdrawal_pending=resolved["inst_stale_withdrawal_pending"],
        # Same lesson as `inst_from_published_manifest` above: a
        # resolver value that main() does not forward is inert in production and
        # only ever works under direct test construction.
        inst_serving_db_path=resolved["inst_serving_db_path"],
        inst_serving_absent_reason=resolved["inst_serving_absent_reason"],
        sec_client=_build_sec_client(),
    ).run()


if __name__ == "__main__":
    main()
