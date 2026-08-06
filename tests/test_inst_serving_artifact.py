"""RUN M2-8 T8 (plan R9) — the second inst Release artifact, threaded end to end.

External review r3 F9: `publish/build.py` resolved a SINGLE `module_db_artifact`
per module at three sites (upload/verify, resume/reconcile, and local
verification). A second inst database is therefore NOT an ordinary extra manifest
entry — without threading, it would be silently skipped at every one of those
boundaries and the build would still report success.

These tests pin the threading itself, so removing any one of the three loops
fails here rather than in production.
"""

from __future__ import annotations

from populus.publish.digests import (
    ARTIFACT_PROJECTIONS,
    LOGICAL_PROJECTIONS,
    projection_for,
)
from populus.publish.manifest import (
    INST_DB_ARTIFACT,
    INST_MODULE,
    INST_SERVING_ARTIFACT,
    MODULE,
    module_db_artifact,
    module_db_artifacts,
)


def test_inst_module_declares_both_databases():
    """Mutation guard: dropping `inst_serving.db` from the policy flips this."""
    names = module_db_artifacts(INST_MODULE)
    assert INST_DB_ARTIFACT in names
    assert INST_SERVING_ARTIFACT in names
    assert len(names) == 2


def test_congress_still_declares_exactly_one():
    """The change must not widen a module that did not gain an artifact."""
    assert module_db_artifacts(MODULE) == (module_db_artifact(MODULE),)


def test_the_primary_resolver_still_returns_a_scalar():
    """`module_db_artifact` is retained for callers that genuinely want one name;
    it must keep returning the AGGREGATE, not the new serving projection."""
    assert module_db_artifact(INST_MODULE) == INST_DB_ARTIFACT
    assert module_db_artifact(INST_MODULE) != INST_SERVING_ARTIFACT


def test_every_declared_database_is_digest_bearing():
    """`_DB_ARTIFACTS` drives the rule that a database artifact MUST carry a
    `logical_digest`. A name missing from it would publish undigested."""
    from populus.publish.manifest import _DB_ARTIFACTS

    for name in module_db_artifacts(INST_MODULE):
        assert name in _DB_ARTIFACTS, f"{name} would publish without a logical digest"


# --- per-artifact projections ------------------------------------------------


def test_the_serving_db_has_its_own_projection_not_the_aggregates():
    """The two inst databases have DIFFERENT schemas. Digesting the serving
    projection under the aggregate's projection would look for tables it does not
    have — the digest would be computed over nothing and still 'succeed'.

    Mutation guard: deleting the `ARTIFACT_PROJECTIONS` override makes
    `projection_for` fall back to the aggregate tables and flips this.
    """
    agg = projection_for(INST_DB_ARTIFACT, INST_MODULE)
    serving = projection_for(INST_SERVING_ARTIFACT, INST_MODULE)
    assert agg == LOGICAL_PROJECTIONS[INST_MODULE]
    assert serving != agg
    assert set(serving) & set(agg) == set(), (
        "the two projections must not share tables — that would mean one schema"
    )


def test_projection_for_falls_back_to_the_module_for_everything_else():
    """Every pre-M2-8 caller must be unchanged."""
    assert projection_for("congress.db", MODULE) == LOGICAL_PROJECTIONS[MODULE]
    assert projection_for(INST_DB_ARTIFACT, INST_MODULE) == LOGICAL_PROJECTIONS[INST_MODULE]


def test_only_artifacts_whose_schema_differs_declare_an_override():
    """An override for an artifact that does NOT differ would silently shadow the
    module projection and drift from it."""
    assert set(ARTIFACT_PROJECTIONS) == {INST_SERVING_ARTIFACT}


# --- the threaded boundaries, exercised against a REAL build ------------------
#
# The previous version of this section asserted the SHAPE of the call sites by
# reading `build.py` as text. That was justified in kind — the r3 F9 defect is
# invisible without a two-artifact manifest — but unsound in three ways: it read
# a RELATIVE path (silently dependent on pytest's CWD), it asserted an exact
# call-site COUNT that a legitimate third boundary would break, and above all it
# could not detect that nothing produced the artifact, because a loop iterating
# an empty list satisfies every one of those assertions. The plan required
# negative tests that "mutate or delete the asset at each boundary and assert a
# fail-closed result"; these are those tests, and they run over a real
# `run_build` so the producer is inside the assertion rather than assumed.

import pytest  # noqa: E402

from test_publish import (  # noqa: E402 - established cross-fixture reuse
    LocalDirBackend,
    PublishError,
    _repoint_to_edited_manifest,
    _staged_asset,
    make_repo,
    pin,
    publish_build,
    read_manifest,
    run_publish,
    run_verify,
    seed_db,
    seed_inst,
)


def _published_inst_build(tmp_path):
    """A real published two-module build carrying both inst databases."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    return repo, report


def test_a_real_build_produces_and_enumerates_the_serving_artifact(tmp_path):
    """The producer half of T8. Without a call site, every boundary below is a
    no-op that reports success, `inst_health` publishes
    `per_filer_detail.published = false`, and every per-filer request falls
    through to live EDGAR — while `ARCHITECTURE.md` documents the asset as
    shipped.

    Mutation guard: deleting the `write_serving_db` call in `run_build` fails
    here, and fails EVERY test below it.
    """
    repo, report = _published_inst_build(tmp_path)
    manifest = read_manifest(repo, report.build_id)
    names = {e["name"] for e in manifest["modules"]["inst"]["artifacts"]}
    assert names == {INST_DB_ARTIFACT, INST_SERVING_ARTIFACT}
    entry = next(
        e for e in manifest["modules"]["inst"]["artifacts"]
        if e["name"] == INST_SERVING_ARTIFACT
    )
    assert entry["logical_digest"], "published without a logical digest"
    assert entry["bytes"] > 0


def test_verify_recomputes_the_serving_artifacts_own_logical_digest(tmp_path):
    """Boundary: verification. The artifact must be digest-checked under ITS OWN
    projection, not the aggregate's — and a manifest digest that the database
    cannot reproduce must fail, with no `--db` supplied.

    Bytes are untouched here, so the outer sha256 passes and the failure can
    only come from recomputation.
    """
    repo, report = _published_inst_build(tmp_path)
    manifest = read_manifest(repo, report.build_id)
    entry = next(
        e for e in manifest["modules"]["inst"]["artifacts"]
        if e["name"] == INST_SERVING_ARTIFACT
    )
    assert entry["logical_digest"] != "cd" * 32
    entry["logical_digest"] = "cd" * 32       # valid hex the DB cannot reproduce
    _repoint_to_edited_manifest(repo, report.build_id, manifest)

    verify = run_verify(repo, now=pin())
    assert not verify.ok
    assert any(
        INST_SERVING_ARTIFACT in error and "logical_digest" in error
        for error in verify.errors
    ), verify.errors


def test_verify_detects_byte_tampering_of_the_serving_artifact(tmp_path):
    """Boundary: verification, outer hash."""
    repo, report = _published_inst_build(tmp_path)
    asset = repo / "releases" / f"data-{report.build_id}" / INST_SERVING_ARTIFACT
    assert asset.is_file(), "the serving artifact was never released"
    asset.write_bytes(asset.read_bytes() + b"tamper")
    verify = run_verify(repo, now=pin())
    assert not verify.ok
    assert any(INST_SERVING_ARTIFACT in error for error in verify.errors)


def test_verify_detects_a_deleted_serving_artifact(tmp_path):
    """Boundary: verification, presence. A published build whose asset vanished
    must not verify — silence here is how a consumer gets pointed at a build it
    cannot fully dereference."""
    repo, report = _published_inst_build(tmp_path)
    asset = repo / "releases" / f"data-{report.build_id}" / INST_SERVING_ARTIFACT
    asset.unlink()
    verify = run_verify(repo, now=pin())
    assert not verify.ok
    assert any(INST_SERVING_ARTIFACT in error for error in verify.errors)


def test_publish_refuses_when_the_staged_serving_artifact_is_corrupt(tmp_path):
    """Boundary: preflight/upload. A staged asset whose bytes disagree with the
    manifest must be refused BEFORE any backend mutation — the second artifact
    has to be checked as strictly as the first."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    from populus.publish.build import run_build

    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    staged = _staged_asset(repo, report.build_id, INST_SERVING_ARTIFACT)
    assert staged.is_file(), "run_build did not stage the serving artifact"
    staged.write_bytes(b"not the artifact that was hashed")

    with pytest.raises(PublishError, match=INST_SERVING_ARTIFACT):
        run_publish(repo, now=pin(), backend=LocalDirBackend(repo))


def test_publish_refuses_when_the_staged_serving_artifact_is_missing(tmp_path):
    """Boundary: preflight. The congress-scoped recovery journal cannot
    regenerate a module asset, so its absence must be a loud refusal rather than
    a build that publishes without it."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    from populus.publish.build import run_build

    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    _staged_asset(repo, report.build_id, INST_SERVING_ARTIFACT).unlink()

    with pytest.raises(PublishError, match=INST_SERVING_ARTIFACT):
        run_publish(repo, now=pin(), backend=LocalDirBackend(repo))


def test_rollback_refuses_a_target_whose_serving_artifact_is_corrupt(tmp_path):
    """Boundary: rollback. Consumers are never repointed at a build whose
    enumerated assets do not verify — for EITHER inst database."""
    from datetime import timedelta

    from test_publish import NOW, mutate_db

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))

    asset = repo / "releases" / f"data-{first.build_id}" / INST_SERVING_ARTIFACT
    asset.write_bytes(b"corrupt")
    before = read_manifest(repo, first.build_id)
    assert before  # the target manifest is intact; only its asset is not

    with pytest.raises(PublishError):
        run_publish(
            repo,
            now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo),
            rollback_to=first.build_id,
        )


def test_a_post_m2_8_build_cannot_publish_the_aggregate_without_the_projection():
    """The R10 compensating control (QA M2-8 M12), driven in BOTH directions.

    `REQUIRED_INST_ARTIFACTS` intentionally omits `inst_serving.db` so manifests
    written before RUN M2-8 keep validating — a rollback target must not become
    invalid because a later release added an artifact. That is the right call for
    the VALIDATOR, but it left "optional" and "absent because nobody wrote the
    producer" indistinguishable, which is the state the increment shipped in. So
    the requirement is enforced at the PRODUCER.

    Asserted against the control ITSELF rather than through a patched build: a
    build with no serving artifact also fails its digest computation, so an
    end-to-end fixture would raise for a different reason and the guard could be
    deleted with every test still green (measured — that mutation survived).

    Mutation guard: deleting the `raise` fails the second case here.
    """
    from populus.publish.build import require_complete_inst_module
    from populus.publish.manifest import REQUIRED_INST_ARTIFACTS

    # The validator stays permissive — that IS the deviation, and it is
    # deliberate. Asserting it here keeps both halves visible together.
    assert INST_SERVING_ARTIFACT not in REQUIRED_INST_ARTIFACTS

    # inst withheld entirely: neither digest, no refusal (a congress-only build).
    require_complete_inst_module(None, None)
    # both present: the normal post-M2-8 build.
    require_complete_inst_module("ab" * 32, "cd" * 32)
    # aggregate without projection: the state that must be impossible.
    with pytest.raises(PublishError) as exc:
        require_complete_inst_module("ab" * 32, None)
    assert INST_SERVING_ARTIFACT in str(exc.value)


def test_the_real_build_routes_through_the_completeness_control():
    """The control is only worth anything if the real build path calls it — the
    previous increment is a standing demonstration that a correct function with
    no call site is indistinguishable from no function.

    P3-3 split the build into `run_build` -> `stage_build` -> `_seal_build`
    (+ `finalize_build` -> `_seal_build`), which moved the call site out of
    `run_build`. Grepping one function's source therefore stopped reaching it.
    Rather than relax the assertion to whichever function happens to hold the
    call today, this walks the ACTUAL call graph from `run_build` and requires
    the control to be reachable — so a future refactor may move it again but
    may not drop it.
    """
    import ast
    import inspect

    from populus.publish import build as build_mod

    module = ast.parse(inspect.getsource(build_mod))
    calls: dict[str, set[str]] = {}
    for node in ast.walk(module):
        if isinstance(node, ast.FunctionDef):
            calls[node.name] = {
                c.func.id if isinstance(c.func, ast.Name) else c.func.attr
                for c in ast.walk(node)
                if isinstance(c, ast.Call)
                and isinstance(c.func, (ast.Name, ast.Attribute))
            }

    seen, frontier = set(), ["run_build"]
    while frontier:
        fn = frontier.pop()
        if fn in seen:
            continue
        seen.add(fn)
        frontier.extend(calls.get(fn, set()) - seen)

    assert "require_complete_inst_module" in seen, (
        "the completeness control is no longer reachable from run_build; it has"
        f" been orphaned by a refactor. Reached: {sorted(seen & set(calls))}"
    )
    # Non-vacuity: the walk must actually traverse the P3-3 seam, or a graph that
    # silently collapsed to {run_build} would satisfy the assertion above.
    assert {"stage_build", "_seal_build"} <= seen


def test_the_module_digest_version_covers_every_artifact_projection_it_publishes():
    """The manifest carries ONE `digest_projection_version` per module, so a
    module publishing two artifacts under two projections has one version
    covering both. Changing either map without bumping it leaves consumers with
    no signal that the byte envelope moved.

    This pins the CURRENT envelope by content, so an edit to either projection
    map fails here and forces the author to decide whether to bump.
    """
    from populus.publish.digests import (
        LOGICAL_PROJECTION_VERSIONS,
        LOGICAL_PROJECTIONS,
    )

    assert LOGICAL_PROJECTION_VERSIONS[INST_MODULE] == "1"
    assert set(LOGICAL_PROJECTIONS[INST_MODULE]) == {
        "agg_filer_registry",
        "agg_qoq_deltas",
        "agg_issuer_top_holders",
        "agg_filer_concentration",
    }
    assert set(ARTIFACT_PROJECTIONS[INST_SERVING_ARTIFACT]) == {
        "serving_filings",
        "serving_filer_rows",
        "serving_issuer_holder_rows",
        "serving_activity",
    }
    # Every serving table is projected WHOLE — the artifact is derived and
    # carries no ingest timestamp, so there is nothing volatile to exclude.
    assert all(
        excluded == frozenset()
        for excluded in ARTIFACT_PROJECTIONS[INST_SERVING_ARTIFACT].values()
    )
