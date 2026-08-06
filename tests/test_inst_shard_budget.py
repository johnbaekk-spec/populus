"""RUN M2-8 T15 (plan R19) — the file budget, MEASURED and enforced.

This is the mechanical form of "Populus infra cost stays ~$0" after the DR-8
reversal. The original decision protected that property by refusing to publish;
these tests protect it by proving the published tree is bounded.

The previous version of this file asserted a literal (`total == 13_224`) over a
formula whose largest term was a stale reservation and whose "gate" was handed
its own maxima as its measurement. Every test passed and the real tree was
already 3,942 files over the term it was budgeted against. So the tests here
divide the same way the module does:

  * the ENFORCING gate is exercised in BOTH directions over a real filesystem
    tree — a gate only ever run on passing input is indistinguishable from one
    that cannot fail; and
  * the forward PROJECTION is asserted to be a projection: it requires a measured
    input, and the breach it currently reports is asserted as a breach rather
    than tuned away.
"""

from __future__ import annotations

import pytest

from populus.inst_budget import (
    ACTIVITY_SHARDS_MAX,
    GLOBAL_FILE_CAP,
    M1_MEASURED_PAGES,
    M2_FILER_PAGES,
    M3_RESERVED,
    MAX_SHARD_BYTES,
    PROVIDER_FILE_LIMIT,
    SITE_CHROME_FILES,
    BudgetBreach,
    MeasuredGeometry,
    MeasuredTree,
    check_geometry,
    check_measured_tree,
    measure_tree,
    worst_case_file_count,
)


def _tree(tmp_path, files: int, *, big_bytes: int = 10):
    """A real directory of `files` regular files, one of them `big_bytes` long."""
    root = tmp_path / "dist"
    (root / "nested").mkdir(parents=True)
    for i in range(files):
        target = root / "nested" / f"f{i}.json" if i % 2 else root / f"f{i}.json"
        target.write_bytes(b"x" * (big_bytes if i == 0 else 1))
    return root


# --- the ENFORCING gate: a real tree, in both directions ---------------------


def test_measure_tree_counts_every_regular_file_including_nested(tmp_path):
    """The gate is only as good as the count. The defect it exists to catch was a
    whole top-level directory (`tickers/`, 3,884 files) that no term counted."""
    root = _tree(tmp_path, 10, big_bytes=4_096)
    measured = measure_tree(root)
    assert measured.file_count == 10
    assert measured.max_file_bytes == 4_096
    assert measured.largest_file == "f0.json"


def test_measure_tree_does_not_follow_or_count_symlinks(tmp_path):
    """`digests.dist_digest` refuses a tree containing a symlink, so counting one
    here would disagree with the artifact contract about what the tree IS."""
    root = _tree(tmp_path, 3)
    (root / "link.json").symlink_to(root / "f0.json")
    assert measure_tree(root).file_count == 3


def test_measure_tree_refuses_a_tree_that_was_never_built(tmp_path):
    """An absent `dist/` must be a loud failure. Returning 0 would read as
    "measured zero files", i.e. as the safest possible result, from the one
    situation in which nothing was measured at all."""
    with pytest.raises(BudgetBreach):
        measure_tree(tmp_path / "never-built")


def test_a_tree_under_both_caps_passes(tmp_path):
    check_measured_tree(measure_tree(_tree(tmp_path, 5)))


def test_a_tree_over_the_file_cap_fails_and_names_the_cap(tmp_path):
    """The direction that matters, exercised for real. Mutation guard: deleting
    the file-count comparison in `check_measured_tree` fails here."""
    measured = measure_tree(_tree(tmp_path, 12))
    with pytest.raises(BudgetBreach) as exc:
        check_measured_tree(measured, file_cap=11)
    assert "deployed files" in str(exc.value)
    assert "12" in str(exc.value)


def test_a_single_file_over_the_provider_limit_fails_and_names_the_file(tmp_path):
    """Cloudflare rejects the file outright, so this must fail at build time
    rather than at deploy time — and it must say WHICH file, or the operator has
    12,545 candidates to search.

    Mutation guard: deleting the byte comparison fails here.
    """
    measured = measure_tree(_tree(tmp_path, 4, big_bytes=2_048))
    with pytest.raises(BudgetBreach) as exc:
        check_measured_tree(measured, max_file_bytes=1_024)
    assert "f0.json" in str(exc.value)


def test_the_cap_boundary_is_inclusive(tmp_path):
    """`==` the cap passes, `+1` fails — the boundary is asserted, not assumed."""
    measured = measure_tree(_tree(tmp_path, 6))
    check_measured_tree(measured, file_cap=6)
    with pytest.raises(BudgetBreach):
        check_measured_tree(measured, file_cap=5)


def test_the_project_cap_stays_below_the_provider_limit():
    assert GLOBAL_FILE_CAP < PROVIDER_FILE_LIMIT
    # 90% since the 2026-08-05 owner raise (was 75%). The ratio is asserted so
    # a further raise cannot creep toward the provider limit unremarked.
    assert GLOBAL_FILE_CAP == int(PROVIDER_FILE_LIMIT * 0.90)
    assert PROVIDER_FILE_LIMIT - GLOBAL_FILE_CAP == 2_000


# --- the M2-8 shard geometry -------------------------------------------------


def test_geometry_exactly_at_the_maxima_passes():
    check_geometry(MeasuredGeometry(ACTIVITY_SHARDS_MAX, MAX_SHARD_BYTES))


@pytest.mark.parametrize(
    "field,maximum",
    [("activity_shards", ACTIVITY_SHARDS_MAX), ("max_shard_bytes", MAX_SHARD_BYTES)],
)
def test_one_over_any_maximum_fails_the_build(field, maximum):
    """Each maximum is independently load-bearing. Mutation guard: removing any
    single check leaves its parameter case failing."""
    fits = MeasuredGeometry(ACTIVITY_SHARDS_MAX, MAX_SHARD_BYTES)
    breached = MeasuredGeometry(**{**fits.__dict__, field: maximum + 1})
    with pytest.raises(BudgetBreach) as exc:
        check_geometry(breached)
    assert field.replace("_", " ") in str(exc.value), (
        "the failure must NAME the constraint it breached, not just a number"
    )


def test_breach_message_names_every_violated_constraint_not_just_the_first():
    """A build that breaches two maxima must report two, or the operator fixes
    one, re-runs, and discovers the next."""
    with pytest.raises(BudgetBreach) as exc:
        check_geometry(
            MeasuredGeometry(ACTIVITY_SHARDS_MAX + 1, MAX_SHARD_BYTES + 1)
        )
    message = str(exc.value)
    assert "activity shards" in message and "max shard bytes" in message


def test_check_geometry_cannot_be_satisfied_by_feeding_it_its_own_maxima():
    """[[measure-the-mechanism]]. The shipped acceptance script called
    `check_geometry(MeasuredGeometry(512, 512, 64, 64, 8, 25 * 1024 * 1024))` —
    the maxima passed back in as the measurement — so every comparison was
    `value > value` and the gate could not fail in either direction.

    The maxima are parameters now precisely so a test can drive the gate past
    them. This asserts that capability exists, which is the only thing that
    distinguishes a real gate from that tautology.
    """
    at_max = MeasuredGeometry(ACTIVITY_SHARDS_MAX, MAX_SHARD_BYTES)
    check_geometry(at_max)                                    # passes at the max
    with pytest.raises(BudgetBreach):                         # ...and can fail
        check_geometry(at_max, activity_shards_max=ACTIVITY_SHARDS_MAX - 1)


# --- the forward projection: reported, never asserted as a pass --------------


def test_the_projection_requires_a_measured_input(tmp_path):
    """`measured_files` has no default ON PURPOSE. The C5 defect was a formula
    whose largest term (`M1_PAGES = 8_500`) was a reservation nobody measured,
    against a real footprint of 12,442. A caller that has not measured must not
    be able to call this at all.

    Mutation guard: giving `measured_files` a default flips this to a TypeError
    that never fires.
    """
    with pytest.raises(TypeError):
        worst_case_file_count()          # type: ignore[call-arg]


def test_the_projections_measured_base_accounts_for_the_whole_tree():
    """QA M2-8 R2 N1, pinned as arithmetic.

    The projection's non-reservation base — everything a build emits TODAY — must
    equal the tree this module measured (12,545 files on 2026-08-05, the same
    number `test_todays_real_tree_still_fits_under_the_cap` and the post-build
    gate count). The remediation for C5 measured the 103-file `_astro/` + fixed
    top-level page class, named it `SITE_CHROME_FILES`, and then summed four
    terms instead of five: the reported breach came out 103 files SMALL, in the
    unsafe direction, by omitting a whole file class — which is defect (a) of
    C5 reproduced inside the fix for C5.

    Mutation guard: dropping `site_chrome_files` from `worst_case_file_count`
    leaves this at 12,442 against a tree of 12,545 and FAILS.
    """
    base = worst_case_file_count(
        measured_files=M1_MEASURED_PAGES,
        m2_filer_pages=0,
        activity_shards=0,
        m3_reserved=0,
    )
    assert base == M1_MEASURED_PAGES + SITE_CHROME_FILES == 12_545, (
        f"the projection's base is {base:,} against a measured tree of 12,545 —"
        " a file class the module itself measured is missing from the formula"
    )


def test_the_site_chrome_term_is_load_bearing_not_decoration():
    """Each term must move the total by its own size, or it is not summed.

    `SITE_CHROME_FILES` existed as a documented constant with ZERO references for
    a whole remediation pass. A constant that names a real measurement and is
    read by nothing is worse than no constant: it reads as accounted-for.
    """
    with_chrome = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without = worst_case_file_count(
        measured_files=M1_MEASURED_PAGES, site_chrome_files=0
    )
    assert with_chrome - without == SITE_CHROME_FILES == 103


def test_the_projection_includes_M3s_committed_reservation():
    """Review r2 F15: omitting another module's committed budget produces a number
    that looks safe and is not — the 18,000 cap is GLOBAL, not per-module."""
    with_m3 = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without_m3 = worst_case_file_count(measured_files=M1_MEASURED_PAGES, m3_reserved=0)
    assert with_m3 - without_m3 == M3_RESERVED == 2_064


def test_the_corrected_projection_FITS_the_raised_cap_with_recorded_headroom():
    """The owner decision, asserted as a decision.

    With the phantom bucket/spill/metadata terms deleted and M1 counted as the
    12,442 files it actually is, the forward projection is 16,173. That BREACHED
    the original 15,000 self-cap by 1,173; the owner raised the cap to 18,000 on
    2026-08-05 rather than shrink a reservation, so it now fits with 1,827 of
    headroom. The projection itself was not touched — only the budget it is
    measured against. The previous formula published "1,776 files of headroom"
    against a tree that already had none.

    This test exists so the breach cannot be quietly tuned away: closing it
    requires an OWNER DECISION (raise the self-cap toward the 20,000 provider
    limit, shrink a module's reservation, or move a data class off Pages) and
    that decision must edit this test with a reason attached.

    The SIZE of the breach is asserted too, not just its existence: the owner
    acts on that number, and the first version of this formula reported 1,070
    when the honest figure was 1,173 (QA M2-8 R2 N1).
    """
    projected = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    assert projected <= GLOBAL_FILE_CAP, (
        f"the projection ({projected:,}) has BREACHED the raised {GLOBAL_FILE_CAP:,}"
        " self-cap. The 2026-08-05 raise consumed the last easy headroom; the"
        " remedy now is a reservation cut or a Pages-tier change, NOT another raise"
    )
    assert projected < PROVIDER_FILE_LIMIT, (
        "the projection has passed the PROVIDER limit — this is no longer a"
        " self-cap decision, the deploy would be rejected outright"
    )
    # The terms, so the breach is legible rather than a bare number.
    assert projected == (
        M1_MEASURED_PAGES + SITE_CHROME_FILES + M2_FILER_PAGES
        + ACTIVITY_SHARDS_MAX + M3_RESERVED
    )
    assert (projected, GLOBAL_FILE_CAP - projected) == (16_173, 1_827), (
        f"headroom is {GLOBAL_FILE_CAP - projected:,}, not the 1,827 recorded in"
        " DEV-NOTES.md and accept_m2_8.py. Restate all three together or they"
        " will disagree again"
    )


def test_todays_real_tree_still_fits_under_the_cap():
    """The measured tree is what is ENFORCED, and it passes with real headroom —
    the breach above is a forecast about modules that are not built yet.
    Conflating the two is what produced a green gate over a red tree.
    """
    today = MeasuredTree(file_count=12_545, max_file_bytes=11_962_205,
                         largest_file="congress/data/feed.v1.json")
    check_measured_tree(today)          # measured 2026-08-05, must not raise
    assert today.file_count < GLOBAL_FILE_CAP
