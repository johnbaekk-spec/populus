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
    FILER_FRAGMENT_PARTS_MAX,
    FILER_FRAGMENT_SIZING_SENTINEL,
    FILER_FRAGMENT_TARGET_BYTES,
    FILER_ROUTING_INDEX_FILES,
    FILER_SHARD_BYTE_CEILING,
    FILER_TAIL_SHARDS_RESERVED,
    FILER_V1_TRANSITION_FILES,
    GLOBAL_FILE_CAP,
    M1_MEASURED_PAGES,
    M2_FILER_PAGES,
    M3_RESERVED,
    MAX_SHARD_BYTES,
    MEASURED_M1_CLASSES,
    PROVIDER_FILE_LIMIT,
    RESERVED_CLASSES,
    ROOT_FILE_CLASS,
    SITE_CHROME_CLASSES,
    SITE_CHROME_FILES,
    BudgetBreach,
    MeasuredGeometry,
    MeasuredTree,
    check_geometry,
    check_measured_tree,
    measure_tree,
    reserved_file_total,
    unaccounted_classes,
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


#: The whole tree as MEASURED on 2026-08-17 (build `20260817.1`, production
#: configuration, restored corpus), broken down the way the post-build gate
#: breaks it down: by top-level class, with root files collapsed under
#: `ROOT_FILE_CLASS`. 17,283 files.
#:
#: Recorded here so the accounting invariants below are testable without a
#: built `dist/` — `test:post` asserts the same two properties against the real
#: tree, and this fixture is what makes a Python-side edit that breaks them
#: fail in CI, where `test:post` cannot run at all.
TREE_20260817: dict[str, int] = {
    "congress": 9_049,
    "tickers": 3_852,
    "institutional": 4_275,
    "_astro": 93,
    ROOT_FILE_CLASS: 4,
    # the ten single-page top-level routes
    "e": 1,
    "financials": 1,
    "legal": 2,
    "macro": 1,
    "methodology": 1,
    "search": 1,
    "signals": 2,
    "watchlist": 1,
}


def test_the_recorded_tree_is_the_tree_that_was_measured():
    """The fixture is a MEASUREMENT; if it does not sum to what was measured it
    is a story. 17,283 files, build 20260817.1."""
    assert sum(TREE_20260817.values()) == 17_283


def test_every_built_file_class_is_named_by_some_budget_term():
    """Defect C5(a) — "it omits a whole file class" — made mechanical.

    This REPLACED an equality assertion (`M1 + chrome == whole tree`) that was
    true only while `institutional/` was not built. Once it was, that equality
    and `M1_MEASURED_PAGES == congress + tickers` could not both hold, and one
    had to fail whichever value the constant took. Coverage is what the
    equality was actually defending, and it survives a new file class being
    built.

    Mutation guard: dropping "institutional" from `RESERVED_CLASSES` leaves it
    unnamed and FAILS here.
    """
    assert unaccounted_classes(TREE_20260817) == []


def test_an_unaccounted_class_is_reported_by_name():
    """The positive control on the check above.

    A coverage test that cannot fail proves nothing — and a version of this
    module once shipped a gate whose every comparison was `value > value`.
    A class nothing names must come back NAMED, not as a bare False.
    """
    assert unaccounted_classes([*TREE_20260817, "briefings"]) == ["briefings"]


def test_the_measured_base_counts_exactly_the_classes_declared_measured():
    """The two measured constants must equal the classes they claim to measure.

    This is the drift guard the post-build gate also runs, pinned to the
    recorded breakdown: `M1_MEASURED_PAGES` is `congress/` + `tickers/` and
    nothing else, and `SITE_CHROME_FILES` is `_astro/` + the ten single-page
    routes + the root files. If either constant is edited without the tree
    being re-measured, these stop agreeing.
    """
    measured = sum(v for k, v in TREE_20260817.items() if k in MEASURED_M1_CLASSES)
    chrome = sum(
        v
        for k, v in TREE_20260817.items()
        if k in SITE_CHROME_CLASSES or k == ROOT_FILE_CLASS
    )
    assert measured == M1_MEASURED_PAGES == 12_901
    assert chrome == SITE_CHROME_FILES == 107


def test_the_projection_never_forecasts_fewer_files_than_exist():
    """Defect QA M2-8 R2 N1 — an undercount in the UNSAFE direction — made
    mechanical.

    Both historical defects in this module were forecasts that came out SMALL
    against a tree that was already bigger, so an owner sizing a remedy against
    them would have under-corrected. Over-forecasting is safe; under-forecasting
    is the failure this module exists to prevent. The projection must therefore
    dominate the real tree at all times.
    """
    projected = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    real = sum(TREE_20260817.values())
    assert projected >= real, (
        f"the projection forecasts {projected:,} files against a tree that"
        f" already holds {real:,} — an undercount in the unsafe direction, which"
        " is defect QA M2-8 R2 N1 exactly"
    )


def test_the_reserved_class_draws_against_a_real_reservation():
    """`institutional/` is accounted for by reservations, so the reservation has
    to be big enough to carry what is already on disk.

    If the built tree ever exceeds the reservation, the class has outgrown its
    budget and the reservation is the thing to restate — not this test.
    """
    drawn = sum(v for k, v in TREE_20260817.items() if k in RESERVED_CLASSES)
    assert drawn <= reserved_file_total(), (
        f"`institutional/` has drawn {drawn:,} files against a reservation of"
        f" {reserved_file_total():,} — the reservation is now the wrong size"
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
    assert with_chrome - without == SITE_CHROME_FILES == 107


def test_the_projection_includes_M3s_committed_reservation():
    """Review r2 F15: omitting another module's committed budget produces a number
    that looks safe and is not — the 18,000 cap is GLOBAL, not per-module."""
    with_m3 = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without_m3 = worst_case_file_count(measured_files=M1_MEASURED_PAGES, m3_reserved=0)
    assert with_m3 - without_m3 == M3_RESERVED == 2_064


def test_the_m2_11_measured_projection_fits_with_recorded_headroom():
    """The owner-reviewed v11 projection binds the freshly measured 8,106-page
    build input used by the append-only T0 command. Every committed term remains
    explicit; the only changed reservation is the measured tail geometry."""
    measured_files = 8_106
    projected = worst_case_file_count(measured_files=measured_files)
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
        measured_files + SITE_CHROME_FILES + M2_FILER_PAGES
        + ACTIVITY_SHARDS_MAX + M3_RESERVED
        + FILER_TAIL_SHARDS_RESERVED + FILER_ROUTING_INDEX_FILES
        + FILER_V1_TRANSITION_FILES
    )
    # Pre-M2-11 subtotal is restated with all three new file classes zeroed.
    pre_m2_11 = worst_case_file_count(
        measured_files=measured_files,
        filer_tail_shards=0,
        routing_index_files=0,
        filer_v1_transition_files=0,
    )
    assert (pre_m2_11, GLOBAL_FILE_CAP - pre_m2_11) == (11_841, 6_159)
    # M2-12 (Codex F3) added the v2 index tombstone: one more file, so the
    # projection moves 15,935 -> 15,936 and headroom 2,065 -> 2,064. Restated
    # together with FILER_V1_TRANSITION_FILES, exactly as this message demands.
    assert (projected, GLOBAL_FILE_CAP - projected) == (15_940, 2_060), (
        f"headroom is {GLOBAL_FILE_CAP - projected:,}, not the 2,060 this suite"
        " records. Restate the constants and this test together or they will"
        " disagree again"
    )


def test_todays_real_tree_still_fits_under_the_cap():
    """The measured tree is what is ENFORCED, and it passes — the projection's
    breach above is a forecast about reservations that are not fully drawn yet.
    Conflating the two is what produced a green gate over a red tree.

    Re-measured 2026-08-17 for R45 on the RESTORED corpus (build `20260817.1`).
    It previously pinned the 2026-08-05 tree — 12,545 files, largest 11,962,205
    B — which passed while describing a tree that no longer existed: the corpus
    restoration took it to 17,283 files and `congress/data/feed.v1.json` to
    22,289,120 B. A fixture that outlives what it measured reads as green and
    asserts nothing. [[test-fixture-can-encode-the-bug]]
    """
    today = MeasuredTree(file_count=17_283, max_file_bytes=22_289_120,
                         largest_file="congress/data/feed.v1.json")
    check_measured_tree(today)          # measured 2026-08-17, must not raise
    assert today.file_count < GLOBAL_FILE_CAP
    assert today.file_count == sum(TREE_20260817.values())


def test_the_largest_file_is_inside_the_provider_limit_but_not_comfortably():
    """`congress/data/feed.v1.json` is 85% of the 25 MiB per-file provider cap
    and grows with the corpus, which just grew by a decade.

    It passes, and it is recorded here because the margin — not the pass — is
    the finding: this file needs bounding (pagination or a shard) before the
    corpus grows much further, or a future deploy is rejected outright.
    """
    feed_bytes = 22_289_120
    assert feed_bytes < MAX_SHARD_BYTES
    assert feed_bytes / MAX_SHARD_BYTES > 0.80


# --- RUN M2-11 (R27): the filer tail family's terms are REAL parameters ------


def test_the_filer_tail_shard_term_is_a_load_bearing_parameter():
    """Each term must move the total by its own size, or it is not summed —
    the C5(a)/R2-N1 defect class this module exists to prevent.

    Mutation guard: a mutant defaulting `filer_tail_shards` to 0 (or dropping
    it from the sum) fails here by exactly the reservation's size.
    """
    with_term = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without = worst_case_file_count(
        measured_files=M1_MEASURED_PAGES, filer_tail_shards=0
    )
    assert with_term - without == FILER_TAIL_SHARDS_RESERVED == 4_096


def test_the_routing_index_term_is_a_load_bearing_parameter():
    """One file is still a file class (LD-9). Mutation guard: a mutant
    defaulting `routing_index_files` to 0 fails here."""
    with_term = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without = worst_case_file_count(
        measured_files=M1_MEASURED_PAGES, routing_index_files=0
    )
    assert with_term - without == FILER_ROUTING_INDEX_FILES == 1


def test_the_v1_transition_term_is_a_load_bearing_parameter():
    with_term = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    without = worst_case_file_count(
        measured_files=M1_MEASURED_PAGES, filer_v1_transition_files=0
    )
    # M2-12 added the v2 tombstone beside v1 (Codex F3), so the term is 2. The
    # property under test is that the term is LOAD-BEARING — zeroing it must move
    # the projection by exactly its own size — not that it equals any one number.
    assert with_term - without == FILER_V1_TRANSITION_FILES == 2


def test_fragment_geometry_constants_are_exact():
    assert FILER_FRAGMENT_TARGET_BYTES == 768 * 1024
    assert FILER_FRAGMENT_PARTS_MAX == 64
    assert FILER_FRAGMENT_SIZING_SENTINEL == 99_999


def test_every_prior_term_survives_the_new_formula():
    """R27: the new terms RETAIN every existing term — including M3's committed
    2,064, the exact omitted-term defect round 3 caught. Zeroing each term must
    move the total by that term's own size, independently."""
    full = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    for kwarg, size in [
        ("site_chrome_files", SITE_CHROME_FILES),
        ("m2_filer_pages", M2_FILER_PAGES),
        ("activity_shards", ACTIVITY_SHARDS_MAX),
        ("m3_reserved", M3_RESERVED),
        ("filer_tail_shards", FILER_TAIL_SHARDS_RESERVED),
        ("routing_index_files", FILER_ROUTING_INDEX_FILES),
        ("filer_v1_transition_files", FILER_V1_TRANSITION_FILES),
    ]:
        without = worst_case_file_count(
            measured_files=M1_MEASURED_PAGES, **{kwarg: 0}
        )
        assert full - without == size, (
            f"{kwarg} does not move the projection by its own size — a term the"
            " formula names but does not sum is the C5 defect"
        )


def test_the_ld10_ceiling_sits_under_the_provider_limit():
    """The 1 MiB client-response ceiling (LD-10) is the READER's bound; the
    provider's 25 MiB stays only a hard ceiling. Both are constants here so
    the dashboard mirrors cannot drift from a second source."""
    assert FILER_SHARD_BYTE_CEILING == 1024 * 1024
    assert FILER_SHARD_BYTE_CEILING < MAX_SHARD_BYTES
