"""Populus pipeline CLI (ARCHITECTURE.md §5.3).

Every §5.3 command is implemented: ``db init``, all four ingest jobs
(``congress-house``/``congress-senate`` RUNs 2–3; ``congress-backfill``/
``members`` RUN 4), both reparse jobs, ``stats``, the ``backfill-audit``
gate commands, and the RUN-5 publication pipeline — ``build``/``publish``/
``verify`` over the §5.5 protocol (staging P1 mode).

This layer owns every current-time/identity/randomness value the library
needs (``now``/``run_id``/``host``/``sleep``/``monotonic``/``jitter``/
audit ``seed``) — library code never reads the wall clock. Git commits and
pushes into ``populus-data`` belong to the workflow/orchestrator, never to
the library or this CLI.
"""

from __future__ import annotations

import json
import platform
import random
import re
import sqlite3
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import click

from populus.db import connect, init_db
from populus.parse_gate import compute_parse_gate

# The eFD submitted-date window options are MM/DD/YYYY, the exact shape the
# index POST body carries (RUN M1-B, R14).
_MDY_OPTION = re.compile(r"^\d{2}/\d{2}/\d{4}$")

INGEST_JOB_OWNERS = {
    "congress-house": 2,
    "congress-senate": 3,
    "congress-backfill": 4,
    "members": 4,
    "inst-13f": 5,
}
REPARSE_JOB_OWNERS = {
    "congress-house": 2,
    "congress-senate": 3,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@click.group()
def main() -> None:
    """Populus pipeline CLI."""


@main.group("db")
def db_group() -> None:
    """Database maintenance."""


@db_group.command("init")
@click.argument("path")
def db_init(path: str) -> None:
    """Create a new Populus database (full §9.4 schema) at PATH."""
    try:
        init_db(path)
    except (sqlite3.Error, OSError) as exc:
        raise click.ClickException(str(exc))
    click.echo(f"initialized {path}")


def _one_selector(ctx: click.Context, param: click.Parameter, value: object) -> object:
    """Reject more than one of the mutually exclusive reparse selectors."""
    if value is None:
        return value
    flag = param.opts[0]
    prior = ctx.meta.setdefault("populus.reparse.selector", flag)
    if prior != flag:
        raise click.UsageError(f"{prior} and {flag} are mutually exclusive")
    return value


@main.command()
@click.argument("job", type=click.Choice(sorted(INGEST_JOB_OWNERS)))
@click.option("--db", "db_path", help="Populus database (auto-initialized when absent).")
@click.option(
    "--from-cache",
    "from_cache",
    type=click.Path(exists=True, file_okay=False),
    help=(
        "Ingest offline from a cache DIR laid out like the job's own cache:"
        " data-cache/house/ (<YEAR>FD.xml + pdfs/<YEAR>/) for congress-house,"
        " data-cache/senate/ (ptr-index.json + pages/) for congress-senate,"
        " data-cache/kadoa/ (trades.json) for congress-backfill,"
        " data-cache/legislators/ (both YAML files) for members."
    ),
)
@click.option("--year", type=int, help="Ingest exactly this year (default: settled window).")
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(file_okay=False),
    help="Raw-archive root for live fetches.",
)
@click.option(
    "--house-index",
    "house_index",
    type=click.Path(exists=True, file_okay=False),
    help=(
        "members only: DIR of cached <YEAR>FD.xml index files for House"
        " state/district join hints."
    ),
)
@click.option(
    "--kadoa-trades",
    "kadoa_trades",
    type=click.Path(exists=True, dir_okay=False),
    help="members only: kadoa trades.json for backfill join hints.",
)
@click.option(
    "--aliases",
    "aliases_path",
    type=click.Path(exists=True, dir_okay=False),
    help="members only: alias YAML overriding the packaged aliases.yaml.",
)
@click.option(
    "--cik",
    "ciks",
    multiple=True,
    help="inst-13f only: a filer CIK to ingest (repeatable). Required for live.",
)
@click.option(
    "--submitted-start",
    "submitted_start",
    help=(
        "congress-senate only: MM/DD/YYYY lower bound on the eFD submitted-date"
        " window. Default: derived from the store's watermark (§9.2)."
    ),
)
@click.option(
    "--submitted-end",
    "submitted_end",
    help=(
        "congress-senate only: MM/DD/YYYY upper bound on the eFD submitted-date"
        " window. Default: no upper bound. Required to request a bounded"
        " historical era rather than 'start → forever'."
    ),
)
@click.pass_context
def ingest(
    ctx: click.Context,
    job: str,
    db_path: str | None,
    from_cache: str | None,
    year: int | None,
    raw_root: str | None,
    house_index: str | None,
    kadoa_trades: str | None,
    aliases_path: str | None,
    ciks: tuple[str, ...],
    submitted_start: str | None,
    submitted_end: str | None,
) -> None:
    """Run an ingest JOB: discover → fetch → parse → normalize → load."""
    if job != "members" and (house_index or kadoa_trades or aliases_path):
        raise click.UsageError(
            "--house-index/--kadoa-trades/--aliases apply only to ingest members"
        )
    if job != "inst-13f" and ciks:
        raise click.UsageError("--cik applies only to ingest inst-13f")
    if job != "congress-senate" and (submitted_start or submitted_end):
        raise click.UsageError(
            "--submitted-start/--submitted-end apply only to ingest"
            " congress-senate (the eFD index is one continuous submitted-date"
            " window; the House is addressed by --year)"
        )
    for option, value in (
        ("--submitted-start", submitted_start),
        ("--submitted-end", submitted_end),
    ):
        if value is not None and _MDY_OPTION.match(value) is None:
            raise click.UsageError(f"{option} must be MM/DD/YYYY (got {value!r})")
    if job == "congress-house":
        from populus.amendments import ensure_views
        from populus.load import ensure_subline_columns
        from populus.ingest import house

        if db_path is None:
            raise click.UsageError("--db is required for ingest congress-house")
        if from_cache is None and raw_root is None:
            raise click.UsageError(
                "--raw-root is required for live ingest (or use --from-cache DIR)"
            )
        if not Path(db_path).exists():
            init_db(db_path)
        years = [year] if year is not None else house.default_years(date.today())
        conn = connect(db_path)
        try:
            # The per-era gate report reads v_default_transactions; applying the
            # idempotent view DDL here means a pre-view database gains it on
            # first use rather than failing at summary time.
            ensure_views(conn)
            ensure_subline_columns(conn)
            report = house.run_house_ingest(
                conn,
                years=years,
                raw_root=raw_root if raw_root is not None else from_cache,
                cache_dir=from_cache,
                transport=None if from_cache is not None else house.HttpxTransport(),
                run_id=f"house-{uuid.uuid4()}",
                now=lambda: datetime.now(timezone.utc).isoformat(),
                host=platform.node(),
                sleep=time.sleep,
                monotonic=time.monotonic,
            )
            summary = house.format_summary(report, gate=compute_parse_gate(conn))
        finally:
            conn.close()
        click.echo(summary)
        if not report.ok:
            ctx.exit(1)
    elif job == "congress-senate":
        from populus.amendments import ensure_views
        from populus.load import ensure_subline_columns
        from populus.ingest import senate

        if db_path is None:
            raise click.UsageError("--db is required for ingest congress-senate")
        if year is not None:
            raise click.UsageError(
                "--year applies only to congress-house; the Senate index is one"
                " continuous submitted-date window (§9.2)"
            )
        if from_cache is None and raw_root is None:
            raise click.UsageError(
                "--raw-root is required for live ingest (or use --from-cache DIR)"
            )
        if not Path(db_path).exists():
            init_db(db_path)
        conn = connect(db_path)
        try:
            ensure_views(conn)
            ensure_subline_columns(conn)
            report = senate.run_senate_ingest(
                conn,
                raw_root=raw_root if raw_root is not None else from_cache,
                cache_dir=from_cache,
                transport=(
                    None if from_cache is not None else senate.HttpxSenateTransport()
                ),
                run_id=f"senate-{uuid.uuid4()}",
                now=lambda: datetime.now(timezone.utc).isoformat(),
                host=platform.node(),
                sleep=time.sleep,
                monotonic=time.monotonic,
                jitter=lambda: random.uniform(0.0, 1.0),
                submitted_start_date=submitted_start,
                submitted_end_date=submitted_end,
            )
            summary = senate.format_summary(report, gate=compute_parse_gate(conn))
        finally:
            conn.close()
        click.echo(summary)
        if not report.ok:
            ctx.exit(1)
    elif job == "congress-backfill":
        from populus import backfill
        from populus.amendments import ensure_views
        from populus.load import ensure_subline_columns

        if db_path is None:
            raise click.UsageError("--db is required for ingest congress-backfill")
        if from_cache is None:
            raise click.UsageError(
                "--from-cache DIR (containing trades.json) is required for"
                " ingest congress-backfill — the seed file is the archive;"
                " this job never fetches live"
            )
        if year is not None or raw_root is not None:
            raise click.UsageError(
                "--year/--raw-root do not apply to ingest congress-backfill"
            )
        trades_path = Path(from_cache) / "trades.json"
        if not trades_path.exists():
            raise click.UsageError(f"{trades_path} does not exist")
        if not Path(db_path).exists():
            init_db(db_path)
        conn = connect(db_path)
        try:
            ensure_views(conn)
            ensure_subline_columns(conn)
            report = backfill.run_backfill_ingest(
                conn,
                trades_path=trades_path,
                run_id=f"backfill-{uuid.uuid4()}",
                now=_utc_now,
                host=platform.node(),
            )
        finally:
            conn.close()
        click.echo(backfill.format_backfill_summary(report))
        if not report.ok:
            ctx.exit(1)
    elif job == "inst-13f":
        from populus.amendments import ensure_views
        from populus.load import ensure_subline_columns
        from populus.ingest import inst13f
        from populus.load import ensure_inst_schema
        from populus.net.sec_client import HttpxSecTransport, SecClient, sec_contact

        if db_path is None:
            raise click.UsageError("--db is required for ingest inst-13f")
        if year is not None:
            raise click.UsageError("--year does not apply to ingest inst-13f")
        if from_cache is None:
            if raw_root is None:
                raise click.UsageError(
                    "--raw-root is required for live ingest inst-13f"
                    " (or use --from-cache DIR)"
                )
            if not ciks:
                raise click.UsageError(
                    "live ingest inst-13f requires at least one --cik"
                )
        if not Path(db_path).exists():
            init_db(db_path)
        conn = connect(db_path)
        try:
            # Every M2 entrypoint applies the inst schema before the views, so a
            # pre-existing M1/M2-1 database gains the inst tables AND both inst
            # views on first M2 use (F19/F33).
            ensure_inst_schema(conn)
            ensure_views(conn)
            ensure_subline_columns(conn)
            common = dict(
                run_id=f"inst-{uuid.uuid4()}",
                now=_utc_now,
                host=platform.node(),
                ingested_at=_utc_now(),
                ciks=list(ciks) or None,
            )
            if from_cache is not None:
                report = inst13f.run_inst13f_ingest(
                    conn, cache_dir=from_cache, **common
                )
            else:
                contact, warning = sec_contact()
                if warning is not None:
                    click.echo(warning, err=True)
                client = SecClient(
                    HttpxSecTransport(),
                    contact=contact,
                    sleep=time.sleep,
                    monotonic=time.monotonic,
                )
                report = inst13f.run_inst13f_ingest(
                    conn, raw_root=raw_root, client=client, **common
                )
        finally:
            conn.close()
        click.echo(inst13f.format_summary(report))
        if not report.ok:
            ctx.exit(1)
    else:  # members
        from populus import members
        from populus.amendments import ensure_views
        from populus.load import ensure_subline_columns

        if db_path is None:
            raise click.UsageError("--db is required for ingest members")
        if from_cache is None:
            raise click.UsageError(
                "--from-cache DIR (containing legislators-current.yaml and"
                " legislators-historical.yaml) is required for ingest members"
            )
        if year is not None or raw_root is not None:
            raise click.UsageError("--year/--raw-root do not apply to ingest members")
        if not Path(db_path).exists():
            init_db(db_path)
        house_hints = None
        if house_index is not None:
            house_hints = members.house_hints_from_index(
                sorted(Path(house_index).glob("*FD.xml"))
            )
        kadoa_hints = None
        if kadoa_trades is not None:
            kadoa_hints = members.kadoa_hints_from_trades(kadoa_trades)
        conn = connect(db_path)
        try:
            ensure_views(conn)
            ensure_subline_columns(conn)
            run_report = members.run_members_ingest(
                conn,
                legislators_dir=from_cache,
                aliases_path=aliases_path,
                house_hints=house_hints,
                kadoa_hints=kadoa_hints,
                run_id=f"members-{uuid.uuid4()}",
                now=_utc_now,
                host=platform.node(),
            )
        finally:
            conn.close()
        click.echo(
            f"members: {run_report.members.upserted} upserted"
            f" ({run_report.members.current} current,"
            f" {run_report.members.historical} historical,"
            f" {len(run_report.members.skipped)} skipped)"
            f" | aliases: {run_report.aliases}"
        )
        click.echo(members.format_join_summary(run_report.join))


@main.group("identity")
def identity_group() -> None:
    """§5.4 identity registries: entities, securities, dated identifiers."""


@identity_group.command("bootstrap")
@click.option(
    "--from-cache",
    "from_cache",
    required=True,
    type=click.Path(exists=True, file_okay=False),
    help="DIR containing company_tickers.json (data-cache/inst/registry).",
)
@click.option(
    "--ftd",
    "ftd_paths",
    multiple=True,
    type=click.Path(exists=True, dir_okay=False),
    help="SEC fails-to-deliver archive (.txt or .zip); repeatable.",
)
@click.option(
    "--securities",
    "securities_path",
    type=click.Path(exists=True, dir_okay=False),
    help="Identity-authority YAML overriding the packaged securities.yaml.",
)
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--as-of",
    "as_of",
    help=(
        "Snapshot date the ticker intervals open at (default: today, UTC)."
        " Ticker mappings resolve only from this date onward (G14 — no"
        " identity time travel), so a --ftd archive whose settlement dates"
        " PRECEDE it will link no symbols at all. Pass a date at or before"
        " the archive's earliest settlement date to link it."
    ),
)
@click.option(
    "--list13f-cache",
    "list13f_cache",
    type=click.Path(file_okay=False),
    default="data-cache/13flist",
    show_default=True,
    help=(
        "DIR of cached SEC Official 13(f) Lists to seed as definitional CUSIP"
        " intervals (RUN M2-5). Every available quarter whose interval covers a"
        " loaded period_of_report is seeded; on a fresh database (no periods"
        " yet) pass --list13f-start-quarter. A missing directory seeds nothing."
    ),
)
@click.option(
    "--list13f",
    "list13f_files",
    multiple=True,
    type=click.Path(exists=True, dir_okay=False),
    help=(
        "Explicit 13(f)-list file(s) to seed (repeatable); the quarter is taken"
        " from the filename and its sibling variant in the same directory is used"
        " for the R5 cross-format check. Overrides the --list13f-cache selection."
    ),
)
@click.option(
    "--list13f-start-quarter",
    "list13f_start_quarter",
    help=(
        "Seed every available 13(f) list at or after this YYYYqN quarter — the"
        " fresh-database backfill path, where no periods are loaded to select on."
    ),
)
@click.option(
    "--replace-quarter",
    "replace_quarter",
    is_flag=True,
    help=(
        "Supersede, in one transaction, a quarter already seeded from a list with"
        " a DIFFERENT sha256 (an auditable correction). Without it, a changed list"
        " for an already-seeded quarter is a hard error naming both hashes."
    ),
)
@click.pass_context
def identity_bootstrap(
    ctx: click.Context,
    from_cache: str,
    ftd_paths: tuple[str, ...],
    securities_path: str | None,
    db_path: str,
    as_of: str | None,
    list13f_cache: str,
    list13f_files: tuple[str, ...],
    list13f_start_quarter: str | None,
    replace_quarter: bool,
) -> None:
    """Seed the identity registries from cached SEC sources (no network)."""
    from populus.identity.bootstrap import (
        FtdFormatError,
        format_bootstrap_summary,
        run_identity_bootstrap,
    )
    from populus.amendments import ensure_views
    from populus.identity.registry import (
        IdentityRegistryError,
        ensure_registry,
        load_identity_registry,
    )
    from populus.ingest.list13f import List13fIngestError, _CacheSource
    from populus.identity.list13f_seed import List13fReseedError
    from populus.load import ensure_inst_schema
    from populus.parse.list13f import parse_quarter

    tickers_path = Path(from_cache) / "company_tickers.json"
    if not tickers_path.exists():
        raise click.UsageError(f"{tickers_path} does not exist")
    if as_of is not None:
        # Require canonical YYYY-MM-DD: date.fromisoformat also accepts compact
        # (20200101) and week-date forms, which would persist noncanonical into
        # lexicographically-compared date columns and mis-order intervals (QA-F4).
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
            raise click.UsageError(
                f"--as-of {as_of!r} must be a canonical ISO date (YYYY-MM-DD)"
            )
        try:
            date.fromisoformat(as_of)
        except ValueError:
            raise click.UsageError(f"--as-of {as_of!r} is not a valid date")
    # Default to TODAY IN UTC (not the process-local calendar day): around UTC
    # midnight a local date would open ticker/name intervals on the wrong day and
    # leave otherwise-applicable FTD symbol links unresolved (G14). (QA-F4)
    snapshot_date = (
        as_of
        if as_of is not None
        else datetime.now(timezone.utc).date().isoformat()
    )
    try:
        registry = load_identity_registry(securities_path)
    except (IdentityRegistryError, OSError) as exc:
        raise click.ClickException(str(exc))

    # Resolve the 13(f)-list source (RUN M2-5): explicit --list13f files override
    # the --list13f-cache selection; a missing cache directory seeds nothing.
    list13f_source = None
    list13f_quarters: list[str] | None = None
    if list13f_files:
        parents = {Path(path).parent for path in list13f_files}
        if len(parents) > 1:
            raise click.UsageError(
                "all --list13f files must live in one directory (its siblings are"
                " used for the R5 cross-format check)"
            )
        source_dir = parents.pop()
        derived = [parse_quarter(Path(path).name) for path in list13f_files]
        if None in derived:
            raise click.UsageError(
                "a --list13f filename carries no YYYYqN quarter (expected"
                " 13flist{YYYY}q{N}.pdf or -txt.txt)"
            )
        list13f_quarters = sorted(set(derived))
        list13f_source = _CacheSource(source_dir)
    elif list13f_cache and Path(list13f_cache).is_dir():
        list13f_source = _CacheSource(list13f_cache)

    if not Path(db_path).exists():
        try:
            init_db(db_path)
        except (sqlite3.Error, OSError) as exc:
            raise click.ClickException(str(exc))
    try:
        conn = connect(db_path)
    except sqlite3.Error as exc:
        raise click.ClickException(str(exc))
    try:
        ensure_registry(conn)
        # A pre-inst database must gain the inst tables + views before the
        # registry reconcile touches inst_holdings (LD-3) — F33.
        ensure_inst_schema(conn)
        ensure_views(conn)
        report = run_identity_bootstrap(
            conn,
            tickers_path=tickers_path,
            ftd_paths=[Path(path) for path in ftd_paths],
            registry=registry,
            snapshot_date=snapshot_date,
            run_id=f"identity-{uuid.uuid4()}",
            now=_utc_now,
            host=platform.node(),
            list13f_source=list13f_source,
            list13f_quarters=list13f_quarters,
            list13f_start_quarter=list13f_start_quarter,
            replace_quarter=replace_quarter,
        )
    except (
        FtdFormatError,
        IdentityRegistryError,
        List13fIngestError,
        List13fReseedError,
        sqlite3.Error,
        OSError,
        ValueError,
    ) as exc:
        raise click.ClickException(str(exc))
    finally:
        conn.close()
    # run_identity_bootstrap raises on every failure (caught above as a non-zero
    # ClickException), so a returned report is always ok — just print it. (QA nit)
    click.echo(format_bootstrap_summary(report))


@main.command()
@click.argument("job", type=click.Choice(sorted(REPARSE_JOB_OWNERS)))
@click.option("--filing", callback=_one_selector, help="Reparse one filing ID.")
@click.option("--since", callback=_one_selector, help="Reparse filings since DATE.")
@click.option(
    "--parser-version",
    callback=_one_selector,
    help="Reparse filings last parsed with version V.",
)
@click.option("--db", "db_path", help="Populus database.")
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(exists=True, file_okay=False),
    help="Raw-archive root the documents were archived under.",
)
@click.pass_context
def reparse(
    ctx: click.Context,
    job: str,
    filing: str | None,
    since: str | None,
    parser_version: str | None,
    db_path: str | None,
    raw_root: str | None,
) -> None:
    """Reparse JOB from the raw archive, atomic per filing."""
    if db_path is None:
        raise click.UsageError(f"--db is required for reparse {job}")
    if raw_root is None:
        raise click.UsageError(f"--raw-root is required for reparse {job}")
    from populus.ingest import house

    selector = house.ReparseSelector(
        filing=filing, since=since, parser_version=parser_version
    )
    conn = connect(db_path)
    try:
        if job == "congress-house":
            report = house.reparse_house(conn, raw_root=raw_root, selector=selector)
            summary = house.format_reparse_summary(report)
        else:
            from populus.ingest import senate

            report = senate.reparse_senate(
                conn, raw_root=raw_root, selector=selector
            )
            summary = senate.format_reparse_summary(report)
    finally:
        conn.close()
    click.echo(summary)
    if not report.ok:
        ctx.exit(1)


def _make_backend(backend: str, repo_slug: str | None):
    from populus.publish.build import GhReleaseBackend, LocalDirBackend

    if backend == "gh-release":
        if not repo_slug:
            raise click.UsageError(
                "--repo OWNER/REPO (or GH_REPO) is required for --backend"
                " gh-release"
            )
        return lambda data_repo: GhReleaseBackend(repo_slug)
    return lambda data_repo: LocalDirBackend(data_repo)


def _utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


_BACKEND_OPTIONS = [
    click.option(
        "--data-repo",
        "data_repo",
        default="../populus-data",
        show_default=True,
        help="The populus-data working tree (§5.5 publication target).",
    ),
    click.option(
        "--backend",
        type=click.Choice(["local-dir", "gh-release"]),
        default="local-dir",
        show_default=True,
        help="Release-asset backend (§5.5): local staging dir or gh Releases.",
    ),
    click.option(
        "--repo",
        "repo_slug",
        envvar="GH_REPO",
        help="gh-release backend: the OWNER/REPO slug (env: GH_REPO).",
    ),
]


def _with_backend_options(command):
    for option in reversed(_BACKEND_OPTIONS):
        command = option(command)
    return command


@main.command()
@click.option(
    "--db",
    "db_path",
    default="populus.db",
    show_default=True,
    help="Populus database to snapshot.",
)
@_with_backend_options
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(file_okay=False),
    help="Raw-archive root holding the House index meta sidecars (watermarks).",
)
def build(
    db_path: str,
    data_repo: str,
    backend: str,
    repo_slug: str | None,
    raw_root: str | None,
) -> None:
    """Assemble a staged build: snapshot, digests, slices, licenses, journal."""
    from populus.publish.attestation import StagingNoop
    from populus.publish.build import BackendError, PublishError, run_build
    from populus.publish.digests import DigestError

    make_backend = _make_backend(backend, repo_slug)
    try:
        report = run_build(
            db_path,
            data_repo,
            now=_utc_now_dt,
            raw_root=raw_root,
            backend=make_backend(data_repo),
            attestation=StagingNoop(),
        )
    except (PublishError, BackendError, DigestError, OSError) as exc:
        raise click.ClickException(str(exc))
    for completed in report.reconciled:
        click.echo(f"reconciled in-flight build {completed}")
    click.echo(
        f"staged build {report.build_id} ({report.artifact_count} artifacts,"
        f" logical_digest {report.logical_digest[:12]}…) at {report.staging_dir}"
    )
    if report.skipped_tickers:
        click.echo(
            f"skipped {len(report.skipped_tickers)} non-conforming ticker"
            f" slice(s): {', '.join(report.skipped_tickers)}"
        )
    # Surface the M2 gate decision for the inst module (R8): a withheld notice
    # (below the >=95% value-coverage gate) is the honest, owner-accepted
    # outcome, not an error — congress still publishes.
    from populus.ingest.inst13f import render_coverage_ratio

    if report.inst_withheld is not None:
        w = report.inst_withheld
        cov = render_coverage_ratio(w["coverage"])
        click.echo(
            f"inst module WITHHELD ({w['reason']}): value-coverage"
            f" {w['numerator']}/{w['denominator']} = {cov} | cover_failed_count"
            f" {w['cover_failed_count']} — below the M2 ≥95% gate; congress"
            " publishes normally"
        )
        # R11: name the quarters with no covering 13(f) list.
        uncovered = w.get("uncovered_quarters") or []
        if uncovered:
            click.echo(
                "  uncovered quarters (no definitional 13(f) list seeded): "
                + ", ".join(uncovered)
            )
    elif report.inst_logical_digest is not None:
        click.echo(
            f"inst module included (logical_digest"
            f" {report.inst_logical_digest[:12]}…)"
        )
    # M2-7 §I5: the build's own coverage output states what was tolerated and
    # which filings were EXCLUDED to produce it — on the withheld path and on the
    # published path alike (external review F3). One shared rendering.
    if report.inst_cover_dispositions is not None:
        from populus.ingest.inst13f import cover_dispositions_from_mapping

        click.echo(f"  {cover_dispositions_from_mapping(report.inst_cover_dispositions)}")
    # R9: per-period value-coverage figures whenever inst data was measured.
    for period in report.inst_period_coverage or []:
        ratio = render_coverage_ratio(period["coverage"])
        flag = "list" if period["covered_by_list"] else "no-list"
        click.echo(
            f"  period {period['period_of_report']}: {period['numerator']}"
            f"/{period['denominator']} = {ratio} [{flag}]"
        )
    # Persist the gate outcome so `publish` can report it truthfully and can
    # DISTINGUISH "withheld by the gate" from "no institutional data ingested"
    # (QA-F5). This lives in .staging/ — operational state, never a published
    # artifact, so it touches no manifest, digest or inventory.
    _write_inst_gate_record(data_repo, report)


@main.command()
@_with_backend_options
@click.option("--build", "build_id", help="Publish this staged build (default: newest).")
@click.option(
    "--rollback-to",
    "rollback_to",
    help="§13.5 rollback: mint a higher-version pointer targeting this older build.",
)
@click.option("--dry-run", is_flag=True, help="Report what would publish; write nothing.")
def publish(
    data_repo: str,
    backend: str,
    repo_slug: str | None,
    build_id: str | None,
    rollback_to: str | None,
    dry_run: bool,
) -> None:
    """Publish per the §5.5 protocol; refuses partial builds."""
    from populus.publish.attestation import StagingNoop
    from populus.publish.build import BackendError, PublishError, run_publish

    make_backend = _make_backend(backend, repo_slug)
    # Capture the build-time gate record BEFORE publishing: a successful publish
    # clears .staging/<build_id>, so reading it afterwards would always miss
    # and the withheld reason would be lost at the publish boundary (QA-F5).
    # A ROLLBACK republishes an EXISTING build, so a staged build's gate record
    # would describe a different target entirely — printing "withheld" for a
    # rollback target that was never gated. Capture a record only for a forward
    # publish; rollback gets a neutral notice (QA-F3, round 6).
    _gate_record_before_publish = (
        None if rollback_to else _read_inst_gate_record(data_repo, build_id)
    )
    try:
        report = run_publish(
            data_repo,
            now=_utc_now_dt,
            backend=make_backend(data_repo),
            build_id=build_id,
            attestation=StagingNoop(),
            dry_run=dry_run,
            rollback_to=rollback_to,
        )
    except (PublishError, BackendError, OSError) as exc:
        raise click.ClickException(str(exc))
    if report.dry_run:
        click.echo(f"dry-run: would publish build {report.build_id}; nothing written")
        return
    for completed in report.reconciled:
        click.echo(f"reconciled in-flight build {completed}")
    version = (
        f" (pointer_version {report.pointer_version})"
        if report.pointer_version is not None
        else ""
    )
    click.echo(f"published build {report.build_id}{version}")
    # Note whether the published build carries the inst module (R8): its absence
    # on the FTD-only corpus is the gate withholding it at build time.
    manifest_path = Path(data_repo) / "builds" / report.build_id / "manifest.json"
    if manifest_path.is_file():
        try:
            published = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            published = None
        if isinstance(published, dict) and "inst" in published.get("modules", {}):
            click.echo("inst module: published in this build")
        else:
            # The module is absent — say WHY, from the build-time gate record.
            # Silence here would hide the owner-accepted fail-closed outcome at
            # the publication boundary (QA-F5).
            if rollback_to:
                click.echo(
                    "inst module: not present in this build (rollback target —"
                    " no build-time gate record applies)"
                )
            else:
                click.echo(
                    _inst_absence_notice(
                        data_repo, report.build_id, _gate_record_before_publish
                    )
                )


def _inst_gate_path(data_repo: str, build_id: str) -> Path:
    """Where the build-time M2 gate outcome is recorded (staging, not published)."""
    return Path(data_repo) / ".staging" / build_id / "inst-gate.json"


def _write_inst_gate_record(data_repo: str, report) -> None:
    """Record the inst gate outcome for `publish` to report (QA-F5).

    Three states are distinguishable: `withheld` (measured, below the gate),
    `included`, and `absent` (no institutional data was ingested at all) — so the
    publish boundary never has to guess why the module is missing.
    """
    if getattr(report, "inst_withheld", None) is not None:
        record = {"state": "withheld", **report.inst_withheld}
    elif getattr(report, "inst_logical_digest", None) is not None:
        record = {"state": "included"}
    else:
        record = {"state": "absent"}
    path = _inst_gate_path(data_repo, report.build_id)
    # Re-running `build` for an ALREADY-STAGED build reconstructs no gate
    # metadata, so a naive write would overwrite a real `withheld` verdict with
    # `absent` — and the next publish would falsely claim no institutional data
    # was ingested, concealing the fail-closed decision (QA-F2, round 4). An
    # "absent" verdict never overwrites a recorded one.
    if record["state"] == "absent":
        existing = _read_inst_gate_record(data_repo, report.build_id)
        if isinstance(existing, dict) and existing.get("state") in (
            "withheld",
            "included",
        ):
            return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(record, sort_keys=True, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        pass  # advisory only — never fail a build over the operator note


def _read_inst_gate_record(data_repo: str, build_id: str | None) -> dict | None:
    """The build-time gate outcome, read while .staging still exists (QA-F5)."""
    if build_id is None:
        # Mirror the publisher's build selection: build ids are `YYYYMMDD.N`, so
        # LEXICOGRAPHIC ordering puts `.9` after `.10` and could attach the wrong
        # withholding reason to a publication. Sort numerically and ignore any
        # staging entry that is not a valid build id (QA-F3, round 4).
        # Mirror the PUBLISHER's selection exactly: build ids are `YYYYMMDD.N`
        # (so lexicographic ordering would put `.9` after `.10`), and only a
        # build carrying a valid journal is publishable. Without the journal
        # predicate a newer PARTIAL staging directory could supply the verdict
        # printed for a different publication (QA-F1, round 5).
        staging = Path(data_repo) / ".staging"
        candidates = []
        for entry in staging.glob("*"):
            if not entry.is_dir():
                continue
            date_part, _, seq = entry.name.partition(".")
            if not (len(date_part) == 8 and date_part.isdigit() and seq.isdigit()):
                continue
            if not (entry / "journal.json").is_file():
                continue  # not publishable — never the publisher's target
            candidates.append(((date_part, int(seq)), entry.name))
        if not candidates:
            return None
        build_id = max(candidates)[1]
    path = _inst_gate_path(data_repo, build_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _inst_absence_notice(
    data_repo: str, build_id: str, record: dict | None = None
) -> str:
    """A truthful one-line reason the inst module is not in the published build."""
    if record is None:
        record = _read_inst_gate_record(data_repo, build_id)
    if isinstance(record, dict) and record.get("state") == "withheld":
        from populus.ingest.inst13f import (
            cover_dispositions_from_mapping,
            render_record_coverage,
        )

        # The record came off DISK: a pre-fix `.staging/` gate record can carry
        # an out-of-range or non-numeric value, so the validating renderer —
        # not a format string — decides whether it is printable (R12), and the
        # raw sums ride beside it so a refused record stays diagnosable (R3).
        # It validates the POPULATION, not merely the number: an in-range 0.0 on
        # a `cover_failed` record, or 1.0 on a masked inflation, describes a
        # population that was never measurable (external review F1).
        cov = render_record_coverage(record)
        numerator = record.get("numerator")
        denominator = record.get("denominator")
        if numerator is not None and denominator is not None:
            cov = f"{cov} (raw {numerator}/{denominator})"
        return (
            f"inst module: WITHHELD by the M2 ≥95% value-coverage gate"
            f" ({record.get('reason', 'below_threshold')}; coverage {cov},"
            f" cover_failed_count {record.get('cover_failed_count', '?')})"
            " — congress published normally"
            # M2-7 §I5: the publish boundary reports the same dispositions the
            # build did; a withheld notice that hides the named exclusions is
            # exactly the silence the rule forbids (external review F3).
            f"\n  {cover_dispositions_from_mapping(record)}"
        )
    if isinstance(record, dict) and record.get("state") == "absent":
        return "inst module: not built (no institutional data ingested)"
    # No record: a staging-less reconcile or an explicit re-publish of an
    # already-published build. Say so plainly — and NEVER reference a variable
    # that no longer exists here, which turned a SUCCESSFUL publish into a
    # NameError traceback and a non-zero exit (QA-F1).
    return (
        "inst module: not present in this build (no build-time gate record at"
        f" {_inst_gate_path(data_repo, build_id)} — staging is cleared after a"
        " publish; rebuild to record the reason)"
    )


@main.command()
@click.option(
    "--data-repo",
    "data_repo",
    default="../populus-data",
    show_default=True,
    help="The populus-data working tree to verify.",
)
@click.option(
    "--db",
    "db_path",
    type=click.Path(exists=True, dir_okay=False),
    help="§13.5 reconciliation: logical digest + row counts of this database.",
)
def verify(data_repo: str, db_path: str | None) -> None:
    """Recompute artifact hashes vs manifest; DB integrity checks."""
    from populus.publish.attestation import StagingNoop
    from populus.publish.build import PublishError, run_verify

    try:
        report = run_verify(
            data_repo, now=_utc_now_dt, db_path=db_path, attestation=StagingNoop()
        )
    except (PublishError, OSError) as exc:
        raise click.ClickException(str(exc))
    for note in report.notes:
        click.echo(f"note: {note}")
    if not report.ok:
        for error in report.errors:
            click.echo(f"error: {error}", err=True)
        raise click.ClickException(
            f"verify failed for build {report.build_id or '<none>'}"
            f" ({len(report.errors)} error(s))"
        )
    click.echo(
        f"verify ok: build {report.build_id},"
        f" {report.checked_artifacts} local artifacts recomputed"
    )


@main.command("inst-agg")
@click.option("--db", "db_path", required=True, help="Populus database (source).")
@click.option(
    "--out",
    "out_path",
    required=True,
    type=click.Path(dir_okay=False),
    help="Destination inst_agg.db (overwritten if present).",
)
def inst_agg(db_path: str, out_path: str) -> None:
    """Build the cross-filer 13F aggregate database (inst_agg.db).

    A pure DB→DB step: reads the default 13F population and writes a fresh,
    reproducible aggregate. This is the same builder ``populus build`` runs
    behind the M2 ≥95% coverage gate; run standalone to inspect the aggregate.
    """
    from populus.amendments import ensure_views
    from populus.inst_agg import (
        InstAggError,
        build_inst_agg,
        refuse_if_dest_aliases_source,
    )
    from populus.load import ensure_inst_schema

    if not Path(db_path).exists():
        raise click.ClickException(f"database {db_path} does not exist")
    conn = connect(db_path)
    try:
        # The alias refusal comes FIRST — before the schema and view passes,
        # both of which write. `ensure_views` replaces a stale view definition
        # since M2-7, so preflighting after it would let a REFUSED command still
        # alter the source database's bytes (external review F4).
        refuse_if_dest_aliases_source(conn, out_path)
        # Every M2 entrypoint applies the inst schema before the views, so a
        # pre-existing M1/M2-1 database resolves the default 13F views.
        ensure_inst_schema(conn)
        ensure_views(conn)
        report = build_inst_agg(conn, out_path, ingested_at=_utc_now())
    except InstAggError as exc:
        # e.g. --out aliases the source database: a clean refusal, not a traceback.
        raise click.ClickException(str(exc))
    finally:
        conn.close()
    click.echo(
        f"inst-agg: {report.filers} filers | {report.qoq_rows} QoQ deltas"
        f" | {report.issuer_rows} issuer rows"
        f" | {report.concentration_rows} concentration rows"
        f" (top-{report.topn}) → {out_path}"
    )


@main.command()
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(file_okay=False),
    help="Raw-archive root holding the House index meta sidecars (freshness).",
)
@click.option(
    "--out",
    "out_path",
    type=click.Path(dir_okay=False),
    help="Write stats.json here instead of printing it.",
)
def stats(db_path: str, raw_root: str | None, out_path: str | None) -> None:
    """Print/refresh stats.json."""
    from populus import stats as stats_module
    from populus.amendments import ensure_views

    if not Path(db_path).exists():
        raise click.ClickException(f"database {db_path} does not exist")
    conn = connect(db_path)
    try:
        ensure_views(conn)
        house_meta = (
            stats_module.read_house_meta(raw_root) if raw_root is not None else None
        )
        document = stats_module.compute_stats(
            conn, now=_utc_now, house_meta=house_meta
        )
    finally:
        conn.close()
    rendered = stats_module.render_stats(document)
    if out_path is not None:
        Path(out_path).write_text(rendered, encoding="utf-8")
        click.echo(f"wrote {out_path}")
    else:
        click.echo(rendered, nl=False)


@main.group("backfill-audit")
def backfill_audit_group() -> None:
    """§9.6 kadoa audit gate: draw worksheets, score filled ones."""


@backfill_audit_group.command("draw")
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--out",
    "out_dir",
    required=True,
    type=click.Path(file_okay=False),
    help="Directory for the worksheet (JSON+MD) and the sealed draw record.",
)
@click.option(
    "--mode",
    type=click.Choice(["initial", "redraw", "stratum-followup"]),
    default="initial",
    show_default=True,
    help="Audit instrument; sizes are pinned per mode — there is no size flag.",
)
@click.option("--seed", type=int, default=0, show_default=True)
@click.option(
    "--exclude",
    "exclude_path",
    type=click.Path(exists=True, dir_okay=False),
    help="redraw: the prior FAILED worksheet JSON (its SRS is excluded).",
)
@click.option("--stratum", help="stratum-followup: the stratum key to sample.")
def backfill_audit_draw(
    db_path: str,
    out_dir: str,
    mode: str,
    seed: int,
    exclude_path: str | None,
    stratum: str | None,
) -> None:
    """Draw a §9.6 worksheet; never auto-passes anything."""
    from populus import backfill
    from populus.amendments import ensure_views

    if mode == "redraw" and exclude_path is None:
        raise click.UsageError("--exclude PRIOR_WORKSHEET.json is required for redraw")
    if mode != "redraw" and exclude_path is not None:
        raise click.UsageError("--exclude applies only to redraw")
    if mode == "stratum-followup" and stratum is None:
        raise click.UsageError("--stratum is required for stratum-followup")
    if mode != "stratum-followup" and stratum is not None:
        raise click.UsageError("--stratum applies only to stratum-followup")
    if not Path(db_path).exists():
        raise click.ClickException(f"database {db_path} does not exist")

    exclusion: list[str] = []
    if exclude_path is not None:
        prior = json.loads(Path(exclude_path).read_text(encoding="utf-8"))
        prior_srs = ((prior.get("instruments") or {}).get("srs") or {}).get("rows") or []
        exclusion = [row["txn_id"] for row in prior_srs]
        if not exclusion:
            raise click.UsageError(f"{exclude_path} carries no SRS rows to exclude")

    conn = connect(db_path)
    try:
        ensure_views(conn)
        try:
            result = backfill.run_audit_draw(
                conn,
                out_dir=out_dir,
                mode=mode,
                seed=seed,
                exclude=exclusion,
                stratum=stratum,
                run_id=f"audit-draw-{uuid.uuid4()}",
                now=_utc_now,
                host=platform.node(),
            )
        except ValueError as exc:
            raise click.ClickException(str(exc))
    finally:
        conn.close()
    click.echo(f"worksheet: {result.worksheet_json_path}")
    click.echo(f"worksheet (markdown): {result.worksheet_md_path}")
    click.echo(
        f"sealed draw record: {result.record_path}"
        f" (sha256 {result.record_sha256}, anchored in ingest_runs)"
    )


@backfill_audit_group.command("score")
@click.argument("filled", type=click.Path(exists=True, dir_okay=False))
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--draw-record",
    "record_path",
    type=click.Path(exists=True, dir_okay=False),
    help=(
        "Sealed draw record for this worksheet"
        " (default: draw-record.<run_id>.json beside FILLED)."
    ),
)
@click.option(
    "--prior-failed",
    "prior_path",
    type=click.Path(exists=True, dir_okay=False),
    help="redraw: the prior failed worksheet JSON (exclusion verification).",
)
@click.pass_context
def backfill_audit_score(
    ctx: click.Context,
    filled: str,
    db_path: str,
    record_path: str | None,
    prior_path: str | None,
) -> None:
    """Score a FILLED worksheet; exits non-zero on any non-pass status."""
    from populus import backfill
    from populus.amendments import ensure_views

    worksheet = json.loads(Path(filled).read_text(encoding="utf-8"))
    if worksheet.get("mode") == "redraw" and prior_path is None:
        raise click.UsageError(
            "--prior-failed is required to score a redraw worksheet"
        )
    if record_path is None:
        run_id = worksheet.get("draw_run_id")
        candidate = Path(filled).parent / f"draw-record.{run_id}.json"
        if run_id is None or not candidate.exists():
            raise click.UsageError(
                "--draw-record is required (no draw-record.<run_id>.json"
                " found beside FILLED)"
            )
        record_path = str(candidate)
    prior = (
        json.loads(Path(prior_path).read_text(encoding="utf-8"))
        if prior_path is not None
        else None
    )
    if not Path(db_path).exists():
        raise click.ClickException(f"database {db_path} does not exist")
    conn = connect(db_path)
    try:
        ensure_views(conn)
        disposition = backfill.score_audit(
            worksheet,
            conn,
            draw_record_bytes=Path(record_path).read_bytes(),
            prior_failed_worksheet=prior,
        )
    finally:
        conn.close()
    click.echo(backfill.format_disposition(disposition))
    if disposition.status != "pass":
        ctx.exit(1)


# --- RUN M2-6: bulk 13F corpus (filer universe + resumable ingest) -----------


@main.group("inst-bulk")
def inst_bulk_group() -> None:
    """§10.2 bulk 13F corpus: filer-universe discovery + resumable ingest."""


def _live_bulk_client():
    """A live SecClient over a CountingTransport (measured transport, real
    clock). The floor/breaker are client-wide; no second HTTP client exists."""
    from populus.inst_bulk import CountingTransport
    from populus.net.sec_client import HttpxSecTransport, SecClient, sec_contact

    contact, warning = sec_contact()
    if warning is not None:
        click.echo(warning, err=True)
    transport = CountingTransport(HttpxSecTransport())
    client = SecClient(
        transport, contact=contact, sleep=time.sleep, monotonic=time.monotonic
    )
    return client, transport


@inst_bulk_group.command("discover")
@click.option("--filing-quarter", "filing_quarter", required=True,
              help="Which quarterly full index to read (YYYYqN), e.g. 2026q3.")
@click.option("--report-period", "report_period", required=True,
              help="The locked period_of_report to keep (YYYY-MM-DD).")
@click.option("--out", "out_dir", required=True, type=click.Path(file_okay=False),
              help="Directory for the universe file and the resumable rank journal.")
@click.option("--top-n", "top_n", type=int, default=1000, show_default=True,
              help="How many top-ranked filers to select (N; the Locked Decision).")
def inst_bulk_discover(
    filing_quarter: str, report_period: str, out_dir: str, top_n: int
) -> None:
    """Discover + rank the filer universe for one budgeted quarter (R1-R4)."""
    from populus.inst_bulk import (
        discover_universe,
        rank_universe,
        select_top_n,
        write_universe,
    )

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_period):
        raise click.UsageError("--report-period must be a canonical YYYY-MM-DD date")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    client, _transport = _live_bulk_client()
    discovery = discover_universe(client, filing_quarter)
    rank_journal = out / f"rank-journal-{filing_quarter}.json"
    rank_result = rank_universe(
        client, discovery.refs, report_period, journal_path=rank_journal
    )
    universe = select_top_n(rank_result, filing_quarter, report_period, top_n)
    universe_path = out / f"universe-{report_period}.json"
    write_universe(universe_path, universe)
    click.echo(
        f"inst-bulk discover | quarter {filing_quarter} | period {report_period}"
        f" | refs {len(discovery.refs)} (rejected {len(discovery.rejected)})"
        f" | ranked {len(rank_result.ranked)}"
        f" (rank_failed {len(rank_result.rank_failed)})"
        f" | selected {len(universe.entries)} (top-n {top_n})"
    )
    click.echo(f"wrote {universe_path}")
    click.echo(f"rank journal {rank_journal}")


@inst_bulk_group.command("ingest")
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option("--universe", "universe_path", required=True,
              type=click.Path(exists=True, dir_okay=False),
              help="Universe file written by inst-bulk discover.")
@click.option("--raw-root", "raw_root", required=True, type=click.Path(file_okay=False),
              help="Raw-archive root for the per-document cache-first ingest.")
@click.option("--out", "out_dir", required=True, type=click.Path(file_okay=False),
              help="Directory for the resumable ingest journal.")
@click.pass_context
def inst_bulk_ingest(
    ctx: click.Context, db_path: str, universe_path: str, raw_root: str, out_dir: str
) -> None:
    """Resumably ingest the ranked universe's complete lineage (R5/R6/R14)."""
    from populus.amendments import ensure_views
    from populus.inst_bulk import format_bulk_summary, load_universe, run_bulk_ingest
    from populus.load import ensure_inst_schema

    universe = load_universe(Path(universe_path))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    journal_path = out / f"ingest-journal-{universe.report_period}.json"
    if not Path(db_path).exists():
        init_db(db_path)
    conn = connect(db_path)
    client, transport = _live_bulk_client()
    try:
        ensure_inst_schema(conn)
        ensure_views(conn)
        report = run_bulk_ingest(
            conn,
            universe,
            client=client,
            transport=transport,
            raw_root=raw_root,
            run_id=f"inst-bulk-{uuid.uuid4()}",
            now=_utc_now,
            host=platform.node(),
            ingested_at=_utc_now(),
            monotonic=time.monotonic,
            journal_path=journal_path,
        )
    finally:
        conn.close()
    click.echo(format_bulk_summary(report))
    if not report.ok:
        ctx.exit(1)
