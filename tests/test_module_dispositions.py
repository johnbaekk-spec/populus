"""F-26 (ALPHA-UX): the module-presence gate.

The plan's four required scenarios, each ASSERTING its pass/fail outcome —
first build, consecutive-missing, accidental removal, deliberate withdrawal —
plus the exit rules a type is nothing without: free-text withholding reasons
fail, `unexpected-error` is always fatal, no-disposition is fatal, and a
product removal requires an explicitly shrunk expected set.

The gate is a DECLARED EXPECTATION, never a previous-build comparison — the
first-build and consecutive-missing scenarios are precisely where a
comparison-based gate fails and this one does not.
"""

import pytest

from populus.publish.manifest import (
    DEFAULT_EXPECTED_MODULES,
    WITHHOLDING_REASONS,
    check_module_dispositions,
)

SERVED = {"state": "served", "reason": None}


def test_scenario_first_build_passes_with_both_served():
    # A first build has no previous build to compare to — a comparison gate
    # cannot even run. The declared expectation needs no history: both
    # expected modules served → publish.
    errors = check_module_dispositions(
        {"congress": SERVED, "inst": SERVED},
        expected_modules=DEFAULT_EXPECTED_MODULES,
    )
    assert errors == []


def test_scenario_consecutive_missing_fails_every_time():
    # A previous-build comparison passes the SECOND broken build (the previous
    # one was also missing). The declared expectation fails it every time.
    dispositions = {"congress": SERVED}  # inst simply absent, build after build
    first = check_module_dispositions(dispositions, expected_modules=DEFAULT_EXPECTED_MODULES)
    second = check_module_dispositions(dispositions, expected_modules=DEFAULT_EXPECTED_MODULES)
    assert first and second, "missing module must fail on EVERY build, not only the first"
    assert any("NO disposition" in e for e in second)


def test_scenario_accidental_removal_is_publication_fatal():
    # The real outage: an unrelated deploy shipped a build without the inst
    # module. No disposition on an expected module → fatal, loudly.
    errors = check_module_dispositions(
        {"congress": SERVED},
        expected_modules=frozenset({"congress", "inst"}),
    )
    assert len(errors) == 1
    assert "inst" in errors[0] and "silent-outage" in errors[0]


def test_scenario_deliberate_withdrawal_publishes_with_closed_list_reason():
    # A legitimate source-quality withholding (the inst coverage gate's own
    # typed reasons) publishes — a fail-safe WITH an alarm trail.
    for reason in sorted(WITHHOLDING_REASONS):
        errors = check_module_dispositions(
            {"congress": SERVED, "inst": {"state": "withheld", "reason": reason}},
            expected_modules=DEFAULT_EXPECTED_MODULES,
        )
        assert errors == [], reason


def test_free_text_withholding_reason_does_not_satisfy_the_exit_rule():
    errors = check_module_dispositions(
        {"congress": SERVED, "inst": {"state": "withheld", "reason": "we felt like it"}},
        expected_modules=DEFAULT_EXPECTED_MODULES,
    )
    assert any("free text does not satisfy" in e for e in errors)


def test_unexpected_error_is_always_fatal():
    errors = check_module_dispositions(
        {"congress": SERVED, "inst": {"state": "unexpected-error", "reason": None}},
        expected_modules=DEFAULT_EXPECTED_MODULES,
    )
    assert any("publication-fatal, always" in e for e in errors)


def test_product_removal_requires_explicit_shrunk_expected_set():
    # Shrinking the declared set IS the authorization — and it must be
    # explicit: the same dispositions fail under the default expectation.
    dispositions = {"congress": SERVED}
    assert check_module_dispositions(dispositions, expected_modules=frozenset({"congress"})) == []
    assert check_module_dispositions(dispositions, expected_modules=DEFAULT_EXPECTED_MODULES)


def test_unknown_module_and_malformed_state_are_defects():
    errors = check_module_dispositions(
        {"congress": SERVED, "mystery": SERVED, "inst": {"state": "shrug"}},
        expected_modules=frozenset({"congress", "inst"}),
    )
    assert any("unknown module" in e for e in errors)
    assert any("disposition state must be one of" in e for e in errors)


@pytest.mark.parametrize("reason", sorted(WITHHOLDING_REASONS))
def test_closed_list_matches_the_inst_gates_typed_reasons(reason):
    # The closed list IS the coverage gate's vocabulary — a new reason there
    # must be added here deliberately, not invented at publish time.
    assert reason in {"below_threshold", "cover_failed", "not_measurable"}


# --- Integration: the gate is WIRED, not merely defined (review F12) ----------
# These run the real stage_build over the shared publish fixtures; deleting the
# _seal_build wiring or the CLI default makes them fail.

from pathlib import Path

from populus.publish.build import LocalDirBackend, PublishError, stage_build

from test_publish import make_repo, pin, seed_db


def test_stage_build_fails_when_expected_inst_module_silently_missing(tmp_path):
    # The exact outage F-26 exists to catch: a release DECLARING inst, staged
    # without inst data and without a source-owned withholding, must refuse to
    # stage — at the provisional seal, before any deploy leg.
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    with pytest.raises(PublishError, match="module disposition gate"):
        stage_build(
            db,
            repo,
            now=pin(),
            backend=LocalDirBackend(repo),
            expected_modules=frozenset({"congress", "inst"}),
        )


def test_stage_build_congress_only_passes_with_explicitly_shrunk_expected_set(tmp_path):
    # Shrinking the declared set IS the product-removal authorization; with it,
    # the identical congress-only build stages cleanly.
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(
        db,
        repo,
        now=pin(),
        backend=LocalDirBackend(repo),
        expected_modules=frozenset({"congress"}),
    )
    assert staged.fresh and staged.deployable


def test_stage_build_refuses_an_empty_expectation(tmp_path):
    # Review F8: there is NO bypass on fresh staging — an empty declared set is
    # the silent-outage shape and is refused before any work starts.
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    with pytest.raises(PublishError, match="at least one module"):
        stage_build(
            db, repo, now=pin(), backend=LocalDirBackend(repo), expected_modules=frozenset()
        )


def test_stage_build_cli_declares_congress_and_inst_by_default():
    # The production entry point's declared expectation is what would have
    # caught the logo-deploy outage. Assert the WIRED default, not a doc claim.
    from populus.cli import main as cli_main

    cmd = cli_main.commands["stage-build"]
    param = next(p for p in cmd.params if p.name == "expect_modules")
    assert tuple(param.default) == ("congress", "inst")


def test_final_seal_pass_enforces_the_gate_too(tmp_path):
    # Review F9: the FINAL reseal (finalize_build) must run the gate, not only
    # the provisional pass — mutate the staged expectation between the two and
    # prove the final pass refuses.
    from populus.publish.build import finalize_build

    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(
        db,
        repo,
        now=pin(),
        backend=LocalDirBackend(repo),
        expected_modules=frozenset({"congress"}),
    )
    assert staged.fresh
    staged._state["expected_modules"] = ["congress", "inst"]
    with pytest.raises(PublishError, match="module disposition gate"):
        finalize_build(staged, site_file_count=1)


def test_cli_forwards_expectation_flags_to_stage_build(tmp_path, monkeypatch):
    # Review F9: the CLI option must actually FORWARD to stage_build — a wired
    # default asserted at the seam the outage would exploit, via CliRunner.
    from click.testing import CliRunner

    from populus import cli as cli_module

    captured: dict = {}

    class _Boom(Exception):
        pass

    def fake_stage_build(*args, **kwargs):
        captured.update(kwargs)
        raise _Boom  # stop before any real staging work

    monkeypatch.setattr("populus.publish.build.stage_build", fake_stage_build)
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)

    runner = CliRunner()
    result = runner.invoke(
        cli_module.main,
        ["stage-build", "--db", str(db), "--data-repo", str(repo), "--backend", "local-dir", "--attestation", "staging-noop"],
        catch_exceptions=True,
    )
    assert isinstance(result.exception, _Boom) or result.exit_code != 0
    assert captured.get("expected_modules") == frozenset({"congress", "inst"})

    captured.clear()
    runner.invoke(
        cli_module.main,
        [
            "stage-build", "--db", str(db), "--data-repo", str(repo),
            "--backend", "local-dir", "--attestation", "staging-noop",
            "--expect-module", "congress",
        ],
        catch_exceptions=True,
    )
    assert captured.get("expected_modules") == frozenset({"congress"})


def test_final_seal_rejects_an_emptied_expected_module_set(tmp_path):
    # Review c2r2-F1: a MISSING field is a legacy sidecar (the documented
    # bypass); a PRESENT but empty one is corruption and must never skip the
    # gate — truthiness alone would have published straight through it.
    from populus.publish.build import finalize_build

    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(
        db,
        repo,
        now=pin(),
        backend=LocalDirBackend(repo),
        expected_modules=frozenset({"congress"}),
    )
    staged._state["expected_modules"] = []
    with pytest.raises(PublishError, match="present but unusable"):
        finalize_build(staged, site_file_count=1)


@pytest.mark.parametrize("bad", [[], "congress", ["congress", ""], [1], {}])
def test_stage_state_load_rejects_a_corrupt_expected_module_set(tmp_path, bad):
    # …and the same corruption is refused at LOAD time, before sealing.
    from populus.publish.build import _validated_expected_modules

    with pytest.raises(PublishError, match="unusable expected-module set"):
        _validated_expected_modules({"expected_modules": bad})


def test_stage_state_load_allows_a_genuinely_legacy_sidecar():
    from populus.publish.build import _validated_expected_modules

    assert _validated_expected_modules({}) is None
    assert _validated_expected_modules({"expected_modules": ["congress", "inst"]}) == [
        "congress",
        "inst",
    ]


def test_final_seal_rejects_a_present_none_expected_module_set(tmp_path):
    # Review c2r3-F1: only the ABSENCE of the key is the legacy bypass. A
    # present None is a mutated/corrupted state and must not skip the gate.
    from populus.publish.build import finalize_build

    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(
        db, repo, now=pin(), backend=LocalDirBackend(repo),
        expected_modules=frozenset({"congress"}),
    )
    staged._state["expected_modules"] = None
    with pytest.raises(PublishError, match="present but unusable"):
        finalize_build(staged, site_file_count=1)


def test_legacy_sidecar_omits_the_key_entirely(tmp_path):
    # …and the legacy path is expressed as an ABSENT key, so the two cases can
    # never be confused downstream.
    import json

    from populus.publish.build import LocalDirBackend as _B, read_stage_state, write_stage_state

    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(
        db, repo, now=pin(), backend=LocalDirBackend(repo),
        expected_modules=frozenset({"congress"}),
    )
    path = write_stage_state(staged)
    payload = json.loads(path.read_text(encoding="utf-8"))
    del payload["expected_modules"]  # a sidecar written before the gate existed
    path.write_text(json.dumps(payload), encoding="utf-8")
    restored = read_stage_state(staged.staging_dir, data_repo=repo, backend=_B(repo))
    assert "expected_modules" not in restored._state
