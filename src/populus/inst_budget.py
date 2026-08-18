"""RUN M2-8 T15 (plan R19) — the static-file budget contract for inst shards.

This is the mechanical guarantee behind the DR-8 reversal. The original Pattern-F
decision protected "Populus infra cost stays ~$0" by refusing to publish per-filer
detail at all. The reversal keeps that property a different way: the deployed tree
is bounded by a file count that CI enforces. If the measured tree exceeds its
maximum, the build fails — it does not quietly grow.

**These are HARD MAXIMA, not defaults** (external review r5 F6, r6 F6). Changing
any of them is a plan change with a re-proved formula, not a configuration tweak.

Provider limits (recorded verified in ARCHITECTURE.md §12.1): Cloudflare Pages free
tier allows 20,000 files and 25 MiB per file. Populus caps itself at 18,000 (90%
since the 2026-08-05 owner raise; 15,000/75% before it), counting pages **and**
deployed data shards.

--------------------------------------------------------------------------------
QA M2-8 C5 — WHAT WAS WRONG, AND WHY IT IS STRUCTURED THIS WAY NOW
--------------------------------------------------------------------------------

The first version of this module asserted a 13,224-file worst case with 1,776
files of headroom. Three independent defects made that number wrong **in the
unsafe direction**, and nothing anywhere evaluated it against a real build:

  (a) It omitted a whole file class. `M1_PAGES = 8_500` was a *reservation*, not
      a measurement. The real M1 footprint is `congress/` 8,558 **plus** a
      top-level `tickers/` tree of 3,884 that appeared in no term at all —
      12,442 files against a budgeted 8,500.

  (b) It charged 1,096 files to a geometry that no longer exists. `FILER_BUCKETS`
      and `ISSUER_BUCKETS` (512 each) budgeted `data/filers/[bucket].v1.json` and
      `data/issuers/[bucket].v1.json` endpoint families; the transport changed
      and those routes were never built. `SPILL_SHARDS_MAX` and `METADATA_FILES`
      were phantom for the same reason — there is no spill implementation.

  (c) Nothing measured anything. `check_geometry` had no build call site, and its
      only caller passed the maxima back in (`check_geometry(MeasuredGeometry(512,
      512, 64, 64, 8, 25 * 1024 * 1024))`), so every comparison was `value >
      maximum` against its own maximum — a gate that could not fail.
      [[measure-the-mechanism]]

So the module now separates two things the old one conflated:

  * :func:`check_measured_tree` — the ENFORCING gate. It counts the real files in
    a real `dist/` and measures the real largest file. This is what runs in CI
    (`dashboard/test/post/file-budget.test.ts`, after `astro build`), and it is
    the only thing here that can fail a build. Nothing is estimated.

  * :func:`worst_case_file_count` — a forward PROJECTION over committed
    reservations for modules that are not built yet. It takes the measured
    footprint as a required argument specifically so it cannot silently re-acquire
    a stale literal. It is reported, never asserted: a projection asserted as a
    gate is how (c) happened. [[mockups-are-not-measurements]]

**Owner decision taken 2026-08-05 — RESOLVED BY RAISING THE CAP.** With the
corrected terms the forward projection is: the measured tree (12,442 M1 pages +
103 site chrome = 12,545) + M2's 1,500 pre-rendered filer pages + M2-8's 64
activity shards + M3's committed 2,064 = **16,173**. Against the old 15,000 cap
that was a 1,173-file breach; the owner raised the cap to 18,000, so it now fits
with **1,827 of headroom**. What did NOT change is the arithmetic — the overrun
is still inherited (M1-B/M1-E grew `dist/` with nothing counting it) and the
projection was not re-tuned by a single file to reach this outcome. What changed
is the budget it is measured against, which was the owner's to move and is
recorded as such at `GLOBAL_FILE_CAP`. The remaining margin to Cloudflare's hard
20,000 is 2,000 files; the next module that does not fit is a Pages-tier
decision, not another raise.

**QA M2-8 R2 N1 — the same defect, once more, inside its own fix.** The first
version of this rewrite MEASURED the 103-file chrome class, gave it the constant
below, and then referenced it from nowhere: `worst_case_file_count` summed the
other four terms and reported 16,070, understating the breach by exactly the
class the module itself had named — again in the unsafe direction, and again by
omitting a whole file class (defect (a) above). An owner sizing a remedy against
"1,070 over" would have shrunk a reservation by 1,070 and left the tree still
over its cap. The term is a PARAMETER of the projection now, the projection's
measured base is checked for COVERAGE and SUFFICIENCY against the module's own
measured tree (`test_every_built_file_class_is_named_by_some_budget_term`,
`test_the_projection_never_forecasts_fewer_files_than_exist`), and the
post-build gate reads BOTH constants out of this file and drifts them against a
real `dist/` — so a term that stops being summed fails a test rather than
quietly shrinking a number.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "ACTIVITY_SHARDS_MAX",
    "FILER_FRAGMENT_PARTS_MAX",
    "FILER_FRAGMENT_SIZING_SENTINEL",
    "FILER_FRAGMENT_TARGET_BYTES",
    "FILER_ROUTING_INDEX_FILES",
    "FILER_SHARD_BYTE_CEILING",
    "FILER_TAIL_SHARDS_RESERVED",
    "FILER_V1_TRANSITION_FILES",
    "GLOBAL_FILE_CAP",
    "M1_MEASURED_PAGES",
    "M2_FILER_PAGES",
    "M3_RESERVED",
    "MAX_SHARD_BYTES",
    "PAGE_BYTE_LIMIT",
    "PAGE_RECORD_LIMIT",
    "PROVIDER_FILE_LIMIT",
    "SITE_CHROME_FILES",
    "MEASURED_M1_CLASSES",
    "SITE_CHROME_CLASSES",
    "RESERVED_CLASSES",
    "ROOT_FILE_CLASS",
    "accounted_classes",
    "reserved_file_total",
    "unaccounted_classes",
    "BudgetBreach",
    "MeasuredGeometry",
    "MeasuredTree",
    "check_geometry",
    "check_measured_tree",
    "measure_tree",
    "worst_case_file_count",
]

# --- provider + project caps -------------------------------------------------
PROVIDER_FILE_LIMIT = 20_000          # Cloudflare Pages free tier, verified
GLOBAL_FILE_CAP = 18_000              # Populus self-cap at 90%, hard CI failure
#: OWNER DECISION 2026-08-05: raised 15,000 -> 18,000 to admit the 16,173-file
#: forward projection rather than shrink a module's reservation. The cost is
#: explicit: the buffer against Cloudflare's hard 20,000 drops from 5,000 files
#: to 2,000, so the self-cap is now 90% of the provider limit, not 75%. A future
#: module needing more than 1,827 files has no room left under this cap and the
#: next such request is a Pages-tier decision, not another raise.
MAX_SHARD_BYTES = 25 * 1024 * 1024    # Cloudflare 25 MiB per file

# --- committed module budgets (other modules' reservations) ------------------
#: The M1 footprint as MEASURED on 2026-08-17 against the RESTORED corpus, in
#: the PRODUCTION configuration (no ticker map — `publish.yml` deliberately
#: points `POPULUS_TICKER_MAP` at a nonexistent path). Restoring per-stock pages
#: (TD-7) would add the ticker-tree delta back on top of this.
#:
#: 12,901 = `congress/` 9,049 + the top-level `tickers/` tree 3,852, which is
#: this constant's documented meaning, measured.
#:
#: This constant means `congress/` + `tickers/` and NOTHING else, which is why
#: it is 12,901 and not the 17,283 the whole 2026-08-17 tree holds. The
#: difference is `institutional/` (4,275), which is BUILT and is accounted for
#: by the M2/M2-8/M2-11 reservations rather than by a measured term — see
#: `RESERVED_CLASSES`. An earlier reading of that difference as an
#: "unaccounted class" produced two assertions that could not both hold; R45
#: resolved it by asserting COVERAGE and SUFFICIENCY instead of a balancing
#: sum. Do not "fix" the difference by folding the institutional tree into this
#: constant: that double-counts it against its own reservation.
#:
#: Re-measured for R45 only AFTER the B25 corpus restoration published
#: (build 20260817.1) — measuring the shrunken tree would have encoded the
#: outage as the baseline, which is the error BACKLOG B18 names. The prior
#: value was 12,442, measured 2026-08-05 when House history was missing.
#:
#: This constant exists for the PROJECTION only — the enforcing gate counts the
#: tree instead of trusting it, so it going stale can no longer make a breach
#: invisible.
M1_MEASURED_PAGES = 12_901
#: Everything else a real build emits and no term accounted for: `_astro/`
#: bundles (93), the four fixed top-level files, and the ten single-page
#: top-level routes (`e/`, `financials/`, `legal/` 2, `macro/`, `methodology/`,
#: `search/`, `signals/` 2, `watchlist/`) — measured 2026-08-17 with
#: M1_MEASURED_PAGES, same build.
#:
#: `M1_MEASURED_PAGES + SITE_CHROME_FILES` = 13,008 is the MEASURED base — the
#: classes counted rather than reserved. It is deliberately not the whole tree
#: (17,283): the remaining 4,275 are `institutional/`, drawn against
#: reservations. The 2026-08-05
#: tree was 12,545 and had no `institutional/` at all.
SITE_CHROME_FILES = 107
M2_FILER_PAGES = 1_500                # M2 contract: pre-rendered top filers
M3_RESERVED = 2_064                   # M3's committed 2,000 pages + ~64 shards

# --- M2-8 shard geometry — HARD MAXIMA ---------------------------------------
#: The ONLY inst data route in the tree:
#: `dashboard/src/pages/institutional/data/activity/[page].v1.json.ts`.
#: The per-bucket filer/issuer endpoint families and the spill path the earlier
#: formula charged 1,096 files for do not exist — the transport changed and they
#: were never built. They are deleted rather than zeroed: a zero constant reads
#: as "measured zero", which is a different claim from "this does not exist".
ACTIVITY_SHARDS_MAX = 64

# --- M2-11 filer tail family — RESERVATIONS pending T0 measurement -----------
#: RUN M2-11 (plan R22/R27, LD-9/LD-10). The long-tail filer delivery adds three
#: NEW file classes (active shards, active index, transition tombstone), and the
#: C5/N1 defect class this module documents is exactly "a file class the
#: projection does not sum" — so all three are REAL
#: PARAMETERS of ``worst_case_file_count`` from the day the routes exist, not
#: constants referenced by nothing.
#:
#: The shard COUNT is a committed reservation, not a measurement: T0-v11 derives
#: the real count from record-boundary fragments under the 1 MiB client-response
#: ceiling. The dashboard walk FAILS past this budget and never truncates. The
#: reviewed full-corpus planning probe produced 2,714 shards; 4,096 leaves
#: explicit family reserve while the complete global projection remains below
#: 18,000. Mirrored by ``filer-payload.ts::FILER_TAIL_SHARDS_MAX``.
FILER_TAIL_SHARDS_RESERVED = 4_096
#: Record-boundary fragment target, actual fan-out maximum, and the deliberately
#: conservative decimal sentinel used while sizing before the actual part total
#: is known. Both T0 and TypeScript use all three exactly; the sentinel is not an
#: allowed fan-out value.
FILER_FRAGMENT_TARGET_BYTES = 768 * 1024
FILER_FRAGMENT_PARTS_MAX = 64
FILER_FRAGMENT_SIZING_SENTINEL = 99_999
#: The routing index (LD-9): one versioned file mapping every published tail
#: CIK to its shard. Counted because "1" omitted is still an omitted class.
FILER_ROUTING_INDEX_FILES = 1
#: Payload-free index tombstones, one per superseded transport version: v1 (from
#: the M2-11 transition) and v2 (from M2-12, which made `deltaTotalsByPeriod` a
#: REQUIRED key and so could not keep serving the old route). A cached client of
#: either version receives a higher version discriminator and enters its shipped
#: version-mismatch path, instead of misreporting a rollout 404 as honest
#: out-of-extract OR retrying forever against a payload it cannot parse.
#:
#: This grows by one per breaking transport change. It is not a reservation: the
#: post-build gate counts the tombstones actually emitted.
FILER_V1_TRANSITION_FILES = 2
#: LD-10 (owner-approved 2026-08-08): the per-shard CLIENT-RESPONSE ceiling —
#: the reader's bound, distinct from the provider's 25 MiB hard limit above.
#: Mirrored by ``dashboard/src/lib/shards.ts::SHARD_RESPONSE_CEILING_BYTES``
#: and enforced on the measured post-build tree by
#: ``dashboard/test/post/file-budget.test.ts``.
FILER_SHARD_BYTE_CEILING = 1024 * 1024

# Pagination (plan R13): ONE byte-aware rule. A page closes at whichever binds
# first. There is no second selection rule — `{500, 1000, 2000}` was a
# contradictory alternative and is deleted.
PAGE_RECORD_LIMIT = 2_000
PAGE_BYTE_LIMIT = 2 * 1024 * 1024     # 2 MiB of SERIALIZED bytes, measured


# --- file-class accounting (R45) ---------------------------------------------
#: Every top-level class a real `dist/` emits, mapped to the budget term that
#: accounts for it.
#:
#: R45 replaced an EQUALITY assertion here, and the reason matters.
#: `M1_MEASURED_PAGES + SITE_CHROME_FILES == the whole tree` held only while
#: `institutional/` was not built. Once it was (4,275 files, measured
#: 2026-08-17 on the restored corpus), that equality and
#: `M1_MEASURED_PAGES == congress + tickers` could no longer both be true, and
#: one of the two assertions had to fail whichever value was chosen. That is a
#: contradiction in the ASSERTIONS, not a wrong measurement.
#:
#: `institutional/` was never missing from the budget. It is carried by the
#: M2/M2-8/M2-11 RESERVATIONS below — accounting of a different kind from a
#: measurement, not an absence of one. Giving it its own measured term without
#: cutting those reservations would double-count it.
#:
#: The invariant both assertions were reaching for is therefore not a sum that
#: balances. It is two things:
#:   (1) COVERAGE — no top-level class goes unnamed. That is defect C5(a),
#:       "it omits a whole file class", made mechanical.
#:   (2) SUFFICIENCY — the projection never forecasts FEWER files than really
#:       exist. That is defect QA M2-8 R2 N1, an undercount in the unsafe
#:       direction, made mechanical.
#: Both survive `institutional/` being built; the equality did not.
MEASURED_M1_CLASSES: frozenset[str] = frozenset({"congress", "tickers"})
#: `_astro/` bundles plus the ten single-page top-level routes. Together with
#: the root files below these are `SITE_CHROME_FILES`.
SITE_CHROME_CLASSES: frozenset[str] = frozenset(
    {
        "_astro",
        "e",
        "financials",
        "legal",
        "macro",
        "methodology",
        "search",
        "signals",
        "watchlist",
    }
)
#: Regular files sitting at the dist ROOT collapse to one class: a root file's
#: top-level path segment is its own filename, so enumerating them by name
#: would make this inventory fail every time a favicon is added. Counted under
#: `SITE_CHROME_FILES` with the routes above.
ROOT_FILE_CLASS = "<root>"
#: BUILT, and accounted for by reservations rather than by a measured constant:
#: `M2_FILER_PAGES` + `ACTIVITY_SHARDS_MAX` + `FILER_TAIL_SHARDS_RESERVED` +
#: `FILER_ROUTING_INDEX_FILES` + `FILER_V1_TRANSITION_FILES`. The reservation
#: is the forward commitment; what is on disk today is a draw against it.
RESERVED_CLASSES: frozenset[str] = frozenset({"institutional"})


def accounted_classes() -> frozenset[str]:
    """Every top-level class some budget term names."""
    return (
        MEASURED_M1_CLASSES
        | SITE_CHROME_CLASSES
        | RESERVED_CLASSES
        | frozenset({ROOT_FILE_CLASS})
    )


def unaccounted_classes(observed: Iterable[str]) -> list[str]:
    """Observed top-level classes that NO budget term names, sorted.

    A non-empty result is defect C5(a) — a whole file class the projection does
    not know about — and it is the caller's job to fail on it. Returning the
    names rather than a bool is deliberate: "the tree grew a class" is only
    actionable if the class is named.
    """
    known = accounted_classes()
    return sorted({c for c in observed if c not in known})


def reserved_file_total() -> int:
    """The reservation terms, summed — what `RESERVED_CLASSES` draws against.

    Kept as a function over the constants rather than a literal so that cutting
    a reservation moves this too; a literal here would be exactly the stale
    second copy this module exists to prevent.
    """
    return (
        M2_FILER_PAGES
        + ACTIVITY_SHARDS_MAX
        + FILER_TAIL_SHARDS_RESERVED
        + FILER_ROUTING_INDEX_FILES
        + FILER_V1_TRANSITION_FILES
    )


class BudgetBreach(Exception):
    """Raised when a MEASURED tree exceeds a hard maximum. Fails the build."""


@dataclass(frozen=True)
class MeasuredTree:
    """What a real `dist/` actually contains. Every field is counted, never
    derived from another module's reservation."""

    file_count: int
    max_file_bytes: int
    largest_file: str


@dataclass(frozen=True)
class MeasuredGeometry:
    """The M2-8 shard geometry a build actually emitted.

    Retained (narrowed to the classes that exist) so the per-class maxima stay
    checkable independently of the whole-tree count: a runaway activity shard
    count is worth naming as such, not just as "the tree got bigger".
    """

    activity_shards: int
    max_shard_bytes: int


def measure_tree(root: Path | str) -> MeasuredTree:
    """Count the regular files under *root* and find the largest.

    Symlinks are not followed and are not counted — `digests.dist_digest` refuses
    a tree containing any, so counting one here would disagree with the artifact
    contract about what the tree is.
    """
    root = Path(root)
    if not root.is_dir():
        raise BudgetBreach(f"no built tree to measure at {root}")
    count = 0
    largest = 0
    largest_name = ""
    for dirpath, _dirs, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(dirpath) / name
            if path.is_symlink() or not path.is_file():
                continue
            count += 1
            size = path.stat().st_size
            if size > largest:
                largest = size
                largest_name = path.relative_to(root).as_posix()
    return MeasuredTree(
        file_count=count, max_file_bytes=largest, largest_file=largest_name
    )


def check_measured_tree(
    tree: MeasuredTree,
    *,
    file_cap: int = GLOBAL_FILE_CAP,
    max_file_bytes: int = MAX_SHARD_BYTES,
) -> None:
    """The ENFORCING gate: a real tree against the real caps. Raises `BudgetBreach`.

    This is the call site R19 was missing. It is deliberately dumb — two
    comparisons against two provider-derived limits — because the previous
    version's sophistication was what let it compare constants to themselves.

    Both parameters are injectable so the gate can be tested in BOTH directions.
    A gate only ever exercised on a passing input is indistinguishable from one
    that cannot fail.
    """
    breaches: list[str] = []
    if tree.file_count > file_cap:
        breaches.append(
            f"deployed files: {tree.file_count:,} exceeds the self-cap"
            f" {file_cap:,} (provider limit {PROVIDER_FILE_LIMIT:,})"
        )
    if tree.max_file_bytes > max_file_bytes:
        breaches.append(
            f"largest file {tree.largest_file!r}: {tree.max_file_bytes:,} B"
            f" exceeds the per-file limit {max_file_bytes:,} B"
        )
    if breaches:
        raise BudgetBreach(
            "the built tree breaches its hard maxima — the build must fail rather "
            "than re-tune (plan R19):\n  " + "\n  ".join(breaches)
        )


def check_geometry(
    measured: MeasuredGeometry,
    *,
    activity_shards_max: int = ACTIVITY_SHARDS_MAX,
    max_shard_bytes: int = MAX_SHARD_BYTES,
) -> None:
    """Verify the M2-8 shard geometry a build emitted. Raises `BudgetBreach`.

    The maxima are PARAMETERS so the gate can be driven past them in a test. With
    them baked in, the only available caller passed the maxima themselves back as
    the measurement and every comparison was `value > value` — the gate could not
    fail in either direction, which is exactly what the surviving mutation
    exposed.
    """
    breaches: list[str] = []
    for name, value, maximum in (
        ("activity shards", measured.activity_shards, activity_shards_max),
        ("max shard bytes", measured.max_shard_bytes, max_shard_bytes),
    ):
        if value > maximum:
            breaches.append(f"{name}: {value:,} exceeds the maximum {maximum:,}")
    if breaches:
        raise BudgetBreach(
            "shard geometry breaches its hard maxima — the build must fail rather "
            "than re-tune (plan R19):\n  " + "\n  ".join(breaches)
        )


def worst_case_file_count(
    *,
    measured_files: int,
    site_chrome_files: int = SITE_CHROME_FILES,
    m2_filer_pages: int = M2_FILER_PAGES,
    m3_reserved: int = M3_RESERVED,
    activity_shards: int = ACTIVITY_SHARDS_MAX,
    filer_tail_shards: int = FILER_TAIL_SHARDS_RESERVED,
    routing_index_files: int = FILER_ROUTING_INDEX_FILES,
    filer_v1_transition_files: int = FILER_V1_TRANSITION_FILES,
) -> int:
    """Projected total once every committed reservation lands, in file counts.

    `measured_files` is REQUIRED and has no default: it is the M1 page footprint
    (`congress/` + the top-level `tickers/` tree) a real `dist/` contains today,
    and the whole C5 defect was a formula whose largest term was a stale
    reservation nobody measured. A caller that has not measured cannot call this.

    `site_chrome_files` is the REST of what a real build emits — `_astro/`
    bundles and the fixed top-level pages — so `measured_files +
    site_chrome_files` equals the whole measured tree and no file class is
    omitted. It is a separate term rather than folded into `measured_files`
    because the post-build drift gate measures the two classes independently.
    Omitting it is QA M2-8 R2 N1: a projection 103 files short, in the unsafe
    direction, of a tree the module had already measured.

    M3's reservation is included deliberately (review r2 F15): omitting another
    module's committed budget produces a number that looks safe and is not,
    because the 18,000 cap is global, not per-module.

    RUN M2-11 (R27): `filer_tail_shards`, `routing_index_files`, and
    `filer_v1_transition_files` are the three file classes the bounded long-tail
    delivery adds. They are parameters — with every prior term retained,
    including M3's committed 2,064 — because both historical defects in this
    module (C5(a), R2 N1) were a real file class that a constant named and the
    sum omitted.

    NOT a gate. This is a forecast over modules that are not built; asserting a
    forecast is how the previous version shipped a proof that measured nothing.
    Compare it to `GLOBAL_FILE_CAP` and REPORT the result.
    """
    return (
        measured_files
        + site_chrome_files
        + m2_filer_pages
        + activity_shards
        + m3_reserved
        + filer_tail_shards
        + routing_index_files
        + filer_v1_transition_files
    )
