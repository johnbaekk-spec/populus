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


@main.command("sectors")
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--snapshot",
    "snapshot_path",
    required=True,
    type=click.Path(exists=True, dir_okay=False),
    help="Cached EDGAR-derived JSON object mapping CIK -> SIC.",
)
@click.option("--as-of", "as_of", required=True, help="Snapshot date, YYYY-MM-DD.")
@click.option("--source", default="edgar-submissions", show_default=True)
def sectors_cmd(db_path: str, snapshot_path: str, as_of: str, source: str) -> None:
    """B-5: full-replace issuer_sic from a cached EDGAR SIC snapshot."""
    from populus import sectors

    conn = connect(db_path)
    try:
        report = sectors.run_sectors_ingest(
            conn, snapshot_path=snapshot_path, as_of=as_of, source=source
        )
    except ValueError as exc:
        raise click.ClickException(str(exc))
    finally:
        conn.close()
    click.echo(
        f"sectors: {report.loaded} issuer SIC rows loaded of {report.read} read"
        f" ({report.malformed} malformed, counted) | taxonomy v{report.taxonomy_version}"
    )


@main.command("committees")
@click.option("--db", "db_path", required=True, help="Populus database.")
@click.option(
    "--from-cache",
    "from_cache",
    required=True,
    type=click.Path(exists=True, file_okay=False),
    help="cc0-legislators cache DIR (committees-current.yaml + committee-membership-current.yaml).",
)
@click.option("--snapshot-date", required=True, help="When the snapshot was taken, YYYY-MM-DD.")
@click.option(
    "--valid-from",
    required=True,
    help="Membership validity window start (current congress start), YYYY-MM-DD.",
)
def committees_cmd(db_path: str, from_cache: str, snapshot_date: str, valid_from: str) -> None:
    """B-6: full-replace dated committee membership + the jurisdiction mapping."""
    from populus import committees

    conn = connect(db_path)
    try:
        report = committees.run_committees_ingest(
            conn,
            legislators_dir=from_cache,
            snapshot_date=snapshot_date,
            valid_from=valid_from,
        )
    except ValueError as exc:
        raise click.ClickException(str(exc))
    finally:
        conn.close()
    click.echo(
        f"committees: {report.committees} committees, {report.memberships} memberships"
        f" ({report.skipped} skipped/unattached, counted)"
        f" | jurisdiction v{report.mapping_version}: {report.jurisdiction_rows} rows"
    )


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


#: Attestation selection is EXPLICIT at the CLI boundary and has no default.
#: A run that forgets to choose must fail loudly rather than inherit a provider
#: that answers "verified" to everything (RUN P3-3a R14).
def _attestation_option(command):
    return click.option(
        "--attestation",
        "attestation_choice",
        required=True,
        type=click.Choice(("sigstore", "staging-noop")),
        help="Which attestation provider to use. No default: an unsigned "
             "publish must be a deliberate choice, never an omission.",
    )(command)


def _make_attestation(choice: str):
    """Build the selected provider.

    `sigstore` needs a live bundle fetcher and trust configuration; until those
    are wired for the operator's environment this refuses rather than silently
    downgrading — the whole point of the explicit flag.
    """
    from populus.publish.attestation import build_provider

    if choice == "sigstore":
        from populus.client.snapshot import github_bundle_fetcher
        from populus.publish.attestation import github_trust_config

        return build_provider(
            "sigstore",
            fetcher=github_bundle_fetcher(),
            trust_config=github_trust_config(),
        )
    return build_provider(choice)


def _with_backend_options(command):
    for option in reversed(_BACKEND_OPTIONS):
        command = option(command)
    return command


# --- R42/R44: the corpus loop ------------------------------------------------


def _split_filing_ids(values: tuple[str, ...]) -> frozenset[str]:
    """Accept repeated flags AND one delimited string.

    The workflow feeds this from a ``workflow_dispatch`` input, which is a
    single free-text field; a human passes the flag repeatedly. Both reach the
    same set.
    """
    out: set[str] = set()
    for value in values:
        for token in value.replace(",", " ").split():
            token = token.strip()
            if token:
                out.add(token)
    return frozenset(out)


@main.command("seed-corpus")
@_with_backend_options
@click.option("--db", "db_path", required=True, help="The working store to seed.")
@click.option(
    "--counts",
    "counts_path",
    required=True,
    help="Where to write the identity baseline the corpus floor reads back.",
)
@click.option(
    "--seed-db",
    "seed_db",
    default=None,
    envvar="POPULUS_CONGRESS_SEED_DB",
    help=(
        "BOOTSTRAP ONLY: a machine-local congress.db to seed from, for the one"
        " run where no published release carries the full corpus. Requires"
        " --seed-sha256. Mutually exclusive with the pointer path."
    ),
)
@click.option(
    "--seed-sha256",
    "seed_sha256",
    default=None,
    envvar="POPULUS_CONGRESS_SEED_SHA256",
    help="The expected digest of --seed-db, verified byte-exactly before use.",
)
def seed_corpus(
    data_repo: str,
    backend: str,
    repo_slug: str | None,
    db_path: str,
    counts_path: str,
    seed_db: str | None,
    seed_sha256: str | None,
) -> None:
    """Seed the working store from the previous release, then baseline it (R42).

    Refuses rather than falling back to an empty database: building fresh is
    what produced B24 and B25.
    """
    from populus.amendments import ensure_views
    from populus.load import ensure_subline_columns
    from populus.publish import seed as seedmod

    # An unset repository variable arrives as the EMPTY STRING, not an absent
    # key, so click's envvar hand-off yields "" and every truthiness test on it
    # silently takes the wrong branch.
    seed_db = seedmod.blank_as_unset(seed_db)
    seed_sha256 = seedmod.blank_as_unset(seed_sha256)
    run_started_at = _utc_now()

    try:
        if seed_db is not None:
            if seed_sha256 is None:
                raise seedmod.SeedError(
                    "--seed-db requires --seed-sha256: an unverified local file"
                    " is not a seed, it is a guess"
                )
            result = seedmod.verify_and_place(
                db_path, source=seed_db, expected_sha256=seed_sha256
            )
            origin = f"bootstrap override {seed_db}"
        else:
            if seed_sha256 is not None:
                raise seedmod.SeedError(
                    "--seed-sha256 was given without --seed-db; the pointer path"
                    " takes its digest from the validated manifest"
                )
            resolved, payload = seedmod.resolve_seed(
                data_repo, _make_backend(backend, repo_slug)
            )
            placed = seedmod.verify_and_place(
                db_path, payload=payload, expected_sha256=resolved.sha256
            )
            result = seedmod.SeedResult(
                build_id=resolved.build_id,
                sha256=placed.sha256,
                bytes_=placed.bytes_,
                origin="release",
            )
            origin = f"release {resolved.build_id}"

        conn = connect(db_path)
        try:
            ensure_views(conn)
            ensure_subline_columns(conn)
            cleared = seedmod.clear_inline_inst_data(conn)
            document = seedmod.write_seed_counts(
                conn,
                counts_path,
                seed_build_id=result.build_id,
                seed_sha256=result.sha256,
                run_started_at=run_started_at,
            )
        finally:
            conn.close()
    except seedmod.SeedError as exc:
        raise click.ClickException(str(exc)) from exc

    click.echo(
        f"seeded {db_path} from {origin}"
        f" ({result.bytes_} bytes, sha256 {result.sha256[:12]}…)"
    )
    if cleared:
        click.echo(
            "  emptied inline institutional tables on the working copy: "
            + ", ".join(sorted(cleared))
            + " (the accepted external snapshot stays the only inst source)"
        )
    for pair in document["pairs"]:
        click.echo(
            f"  baseline {pair['source']}/{pair['chamber']}:"
            f" {len(pair['filing_ids'])} filings, {len(pair['joined'])} joined"
        )


@main.command("corpus-floor")
@click.option("--db", "db_path", required=True)
@click.option(
    "--counts",
    "counts_path",
    required=True,
    help="The identity baseline `seed-corpus` wrote at the start of this run.",
)
@click.option(
    "--allow-reparse",
    "allow_reparse",
    multiple=True,
    help=(
        "Filing ids whose corrective replacement is EXPECTED this run"
        " (repeatable, or one space/comma-separated string). A reparse"
        " legitimately lowers a filing's raw transaction count; naming it here"
        " makes that a reviewed event rather than a silent one."
    ),
)
def corpus_floor(db_path: str, counts_path: str, allow_reparse: tuple[str, ...]) -> None:
    """Refuse the build if the seed's corpus identities did not survive (R44)."""
    from populus.publish import seed as seedmod

    authorized = _split_filing_ids(allow_reparse)
    conn = connect(db_path)
    try:
        seedmod.assert_corpus_floor(conn, counts_path, allow_reparse=authorized)
    except seedmod.SeedError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        conn.close()
    message = "corpus floor held: every seeded filing, join, and transaction set survived"
    if authorized:
        message += f" (authorized reparse: {', '.join(sorted(authorized))})"
    click.echo(message)


def _echo_inst_gate_outcome(report) -> None:
    """Print the M2 gate outcome. Shared so the honesty surface does not
    depend on which command assembled the build (QA-F5).
    """
    # Surface the M2 gate decision for the inst module (R8): a withheld notice
    # (below the >=95% value-coverage gate) is the honest, owner-accepted
    # outcome, not an error — congress still publishes.
    if report.inst_withheld is not None:
        w = report.inst_withheld
        cov = f"{w['coverage'] * 100:.2f}%" if w["coverage"] is not None else "N/A"
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
        ratio = (
            f"{period['coverage'] * 100:.2f}%"
            if period["coverage"] is not None
            else "N/A"
        )
        flag = "list" if period["covered_by_list"] else "no-list"
        click.echo(
            f"  period {period['period_of_report']}: {period['numerator']}"
            f"/{period['denominator']} = {ratio} [{flag}]"
        )
    # Persist the gate outcome so `publish` can report it truthfully and can
    # DISTINGUISH "withheld by the gate" from "no institutional data ingested"
    # (QA-F5). This lives in .staging/ — operational state, never a published
    # artifact, so it touches no manifest, digest or inventory.


@main.command()
@click.option(
    "--db",
    "db_path",
    default="populus.db",
    show_default=True,
    help="Populus database to snapshot.",
)
@_attestation_option
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
    attestation_choice: str,
) -> None:
    """Assemble a staged build: snapshot, digests, slices, licenses, journal."""
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
            attestation=_make_attestation(attestation_choice),
            # Same declaration as `stage-build` below: a CLI-driven build is a
            # real publication, so a store with no member join is refused rather
            # than silently emitting a site without member pages.
            expect_member_join=True,
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
    _echo_inst_gate_outcome(report)
    _write_inst_gate_record(data_repo, report)


def _refuse_bad_inst_db(inst_db: str) -> None:
    """Cheap CLI-side refusals for `--inst-db` (RUN M2-11, R2).

    A missing path, a directory, or a snapshot file this process could still
    WRITE is refused before any build work starts — the deep enforcement
    (`mode=ro` open, view verification, in-file metadata) lives in
    `stage_build`; these are the mistakes worth naming at the command line,
    each with its remediation.
    """
    import os

    path = Path(inst_db)
    if not path.exists():
        raise click.ClickException(
            f"--inst-db {inst_db} does not exist — cut an accepted snapshot"
            " with scripts/inst_snapshot.py and point --inst-db at the"
            " finalized inst-source-v<N>.db"
        )
    if path.is_dir():
        raise click.ClickException(
            f"--inst-db {inst_db} is a directory — pass the finalized"
            " inst-source-v<N>.db file cut by scripts/inst_snapshot.py"
        )
    if os.access(path, os.W_OK):
        raise click.ClickException(
            f"--inst-db {inst_db} is writable by this process — an accepted"
            " snapshot is immutable (0444). Re-finalize it with"
            " scripts/inst_snapshot.py, or chmod 444 the file it produced."
        )


@main.command("stage-build")
@click.option(
    "--db",
    "db_path",
    default="populus.db",
    show_default=True,
    help="Populus database to snapshot.",
)
@_attestation_option
@_with_backend_options
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(file_okay=False),
    help="Raw-archive root holding the House index meta sidecars (watermarks).",
)
@click.option(
    "--inst-db",
    "inst_db",
    default=None,
    help="Accepted institutional source snapshot (RUN M2-11, R1): the"
    " finalized, read-only inst-source-v<N>.db cut by scripts/inst_snapshot.py."
    " When given, the inst module derives from it; when absent, the build is"
    " byte-identical to a congress-only build.",
)
@click.option(
    "--expect-module",
    "expect_modules",
    multiple=True,
    default=("congress", "inst"),
    show_default=True,
    help="F-26: a module this release is EXPECTED to carry (repeatable)."
    " Every expected module needs a typed disposition — present (served) or a"
    " source-owned quality-gate withholding — or the stage FAILS. Shrinking"
    " this set is the explicit authorization a product removal requires; a"
    " module silently missing is publication-fatal, which is exactly the"
    " outage this gate exists to catch.",
)
def stage_build_cmd(
    db_path: str,
    data_repo: str,
    backend: str,
    repo_slug: str | None,
    raw_root: str | None,
    attestation_choice: str,
    inst_db: str | None,
    expect_modules: tuple[str, ...],
) -> None:
    """Phase 1 of 2: assemble artifacts and a PROVISIONAL manifest.

    The site build runs between this and ``finalize-build``: it reads
    ``manifest.json`` to decide which surfaces exist, and its file count is what
    ``finalize-build`` patches into ``stats.json``. Nothing is journalled here —
    the recovery journal stays last (R35).

    Prints the staging directory so the workflow can pass it onward, and the
    build id. Exits non-zero if the build was preserved or reconciled rather
    than freshly assembled, because there is then nothing to build a site from
    and nothing to deploy.
    """
    from populus.publish.build import (
        BackendError,
        PublishError,
        stage_build,
        write_stage_state,
    )
    from populus.publish.digests import DigestError

    if inst_db is not None:
        _refuse_bad_inst_db(inst_db)

    make_backend = _make_backend(backend, repo_slug)
    try:
        staged = stage_build(
            db_path,
            data_repo,
            now=_utc_now_dt,
            raw_root=raw_root,
            backend=make_backend(data_repo),
            attestation=_make_attestation(attestation_choice),
            inst_db_path=inst_db,
            expected_modules=frozenset(expect_modules),
            # The publishing path DECLARES that member identity must be present
            # (see `stage_build`). This is the call `publish.yml` makes, and the
            # one that shipped 20260807.1 → 20260812.1 with no member pages.
            expect_member_join=True,
        )
        write_stage_state(staged)
    except (PublishError, BackendError, DigestError, OSError) as exc:
        raise click.ClickException(str(exc))

    if not staged.fresh:
        # Not an error in itself — recovery did its job — but the caller must
        # not go on to build and deploy a site for a build that is already
        # published and journal-sealed.
        click.echo(
            f"build {staged.build_id} was preserved/reconciled, not assembled —"
            " no site build and no deploy for this run"
        )
        raise SystemExit(3)
    # Machine-readable `key=value` lines, deliberately in the same shape the
    # workflow appends straight to $GITHUB_OUTPUT. The earlier version emitted
    # `staged <id> at <dir>` and the workflow recovered the id with a `sed`
    # regex over that prose — which exits 0 on no match, so a reworded log line
    # would have silently produced an EMPTY build id, a `site-` artifact name,
    # and a green run. A log line is not a contract; these two are.
    click.echo(f"build_id={staged.build_id}")
    click.echo(f"build_dir={Path(staged.staging_dir) / 'build'}")
    click.echo(f"staging_dir={staged.staging_dir}")
    click.echo(f"staged {staged.build_id} at {staged.staging_dir}")


@main.command("snapshot-site")
@click.option(
    "--source",
    "source",
    required=True,
    type=click.Path(exists=True, file_okay=False),
    help="The site build output to freeze (dashboard/dist).",
)
@click.option(
    "--dest",
    "dest",
    required=True,
    type=click.Path(file_okay=False),
    help="Destination directory; receives site/ and a SIBLING inventory.json.",
)
def snapshot_site_cmd(source: str, dest: str) -> None:
    """Freeze the built site into the §12.1 upload envelope.

    Produces ``<dest>/site/`` plus ``<dest>/inventory.json`` — the inventory is
    a **sibling** of the tree, never inside it, so it never inventories itself
    and is never deployed.

    The freeze is what makes "the bytes we hashed are the bytes we uploaded"
    true (R4): everything downstream reads the sealed copy, so the source can
    keep changing without moving the digest.
    """
    import shutil

    from populus.deploy.snapshot import SnapshotError, freeze_tree
    from populus.publish.digests import DigestError
    from populus.publish.inventory import write_inventory

    dest_path = Path(dest)
    dest_path.mkdir(parents=True, exist_ok=True)
    site_dir = dest_path / "site"
    if site_dir.exists():
        raise click.ClickException(f"{site_dir} already exists — refusing to overwrite")
    try:
        snapshot = freeze_tree(source, parent=dest_path)
        try:
            # Move the sealed tree into place under its published name. The seal
            # is advisory (we own the files), so the modes come back off first.
            for path in sorted(snapshot.path.rglob("*"), reverse=True):
                path.chmod(0o700 if path.is_dir() else 0o600)
            snapshot.path.chmod(0o700)
            snapshot.path.rename(site_dir)
        except BaseException:
            snapshot.cleanup()
            raise
        inventory = write_inventory(site_dir, dest_path / "inventory.json")
    except (SnapshotError, DigestError, OSError) as exc:
        raise click.ClickException(str(exc))
    click.echo(f"dist_digest={inventory['dist_digest']}")
    click.echo(f"file_count={len(inventory['files'])}")
    click.echo(
        f"froze {len(inventory['files'])} files into {site_dir}"
        f" (dist_digest {inventory['dist_digest'][:12]}…)"
    )


@main.command("finalize-build")
@click.option(
    "--staging-dir",
    "staging_dir",
    required=True,
    type=click.Path(file_okay=False),
    help="The .staging/<build_id>/ directory `stage-build` reported.",
)
@click.option(
    "--site-file-count",
    "site_file_count",
    required=True,
    type=int,
    help="Number of files the site build emitted (R3: never defaulted).",
)
@click.option(
    "--dist-dir",
    "dist_dir",
    type=click.Path(file_okay=False),
    help="The site build output. Its stats.json is patched with the same bytes "
         "as the canonical copy and the two are asserted byte-equal (R24, §12.1 "
         "step 2). Omit only when there is no site — the wrapper build path.",
)
@_with_backend_options
def finalize_build_cmd(
    staging_dir: str,
    site_file_count: int,
    dist_dir: str | None,
    data_repo: str,
    backend: str,
    repo_slug: str | None,
) -> None:
    """Phase 2 of 2: patch the served file count, re-seal, write the journal.

    ``--site-file-count`` is required and has no default. ``run_build`` — the
    single-phase wrapper — publishes ``site_file_count: null`` precisely so that
    a workflow which forgets this step produces an obviously-unfinished build
    rather than a plausible wrong number.
    """
    from populus.publish.build import (
        BackendError,
        PublishError,
        finalize_build,
        read_stage_state,
        require_site_file_count,
    )
    from populus.publish.digests import DigestError

    make_backend = _make_backend(backend, repo_slug)
    try:
        staged = read_stage_state(
            staging_dir, data_repo=data_repo, backend=make_backend(data_repo)
        )
        report = finalize_build(
            staged, site_file_count=site_file_count, dist_dir=dist_dir
        )
    except (PublishError, BackendError, DigestError, OSError) as exc:
        raise click.ClickException(str(exc))
    # QA-F5, restored at the new entry point: `populus build` wrote this record
    # and the two-phase path did not, so a WITHHELD M2 module published as "no
    # build-time gate record — rebuild to record the reason" when the truth was
    # "withheld by the >=95% value-coverage gate". The honesty surface must not
    # depend on which command assembled the build.
    _write_inst_gate_record(data_repo, report)
    _echo_inst_gate_outcome(report)
    click.echo(
        f"finalized build {report.build_id} ({report.artifact_count} artifacts,"
        f" site_file_count {site_file_count}) at {report.staging_dir}"
    )
    # R3: the count is asserted here, at the boundary the deploying path crosses,
    # rather than trusted. `require_site_file_count` had no production caller at
    # all until this line -- four green tests over dead code.
    require_site_file_count(report.staging_dir)


@main.command()
@_attestation_option
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
    attestation_choice: str,
) -> None:
    """Publish per the §5.5 protocol; refuses partial builds."""
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
            attestation=_make_attestation(attestation_choice),
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
        from populus.ingest.inst13f import cover_dispositions_from_mapping

        coverage = record.get("coverage")
        cov = f"{coverage * 100:.2f}%" if isinstance(coverage, (int, float)) else "N/A"
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


@_attestation_option
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
def verify(data_repo: str, db_path: str | None, attestation_choice: str) -> None:
    """Recompute artifact hashes vs manifest; DB integrity checks."""
    from populus.publish.build import PublishError, run_verify

    try:
        report = run_verify(
            data_repo, now=_utc_now_dt, db_path=db_path, attestation=_make_attestation(attestation_choice)
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


@main.command("preflight-attestation")
@click.option(
    "--data-repo",
    "data_repo",
    default="../populus-data",
    show_default=True,
    help="The populus-data working tree whose pointer and manifest to check.",
)
def preflight_attestation(data_repo: str) -> None:
    """Prove the attestation chain works BEFORE arming anything.

    A positive gate, not a refusal that fires after the fact: it resolves the
    published pointer and manifest, verifies both against the pinned identity
    and issuer, and exits non-zero **naming the failed check** otherwise.

    Exit codes are deliberately distinguishable: a verification failure and an
    unreachable attestation API are different problems, and reporting a rate
    limit as tampering would be its own honesty defect.
    """
    import json as _json
    from pathlib import Path as _Path

    from populus.client.snapshot import github_bundle_fetcher
    from populus.publish.attestation import (
        UNAVAILABLE,
        SigstoreAttestation,
        github_trust_config,
    )

    repo = _Path(data_repo)
    pointer_path = repo / "latest.json"
    if not pointer_path.exists():
        raise click.ClickException(f"no pointer at {pointer_path}")
    pointer_bytes = pointer_path.read_bytes()
    pointer = _json.loads(pointer_bytes)
    # `manifest_path` comes from an untrusted pointer document. `run_verify`
    # routes it through `resolve_within`; preflight must too, or a crafted
    # `latest.json` turns this into an arbitrary local file read.
    from populus.publish.manifest import resolve_within

    try:
        manifest_path = resolve_within(repo, pointer["manifest_path"])
    except (ValueError, OSError) as exc:
        raise click.ClickException(f"manifest path unsafe: {exc}")
    if not manifest_path.exists():
        raise click.ClickException(f"no manifest at {manifest_path}")

    provider = SigstoreAttestation(
        fetcher=github_bundle_fetcher(), trust_config=github_trust_config()
    )
    failures: list[str] = []
    unavailable = False
    for name, payload in (
        ("latest.json", pointer_bytes),
        ("manifest.json", manifest_path.read_bytes()),
    ):
        result = provider.verify(name, payload)
        if result.ok:
            click.echo(f"  ok   {name}: {result.detail}")
            continue
        if result.outcome == UNAVAILABLE:
            unavailable = True
        failures.append(f"{name}: {result.detail}")
        click.echo(f"  FAIL {name}: {result.detail}")

    if unavailable:
        raise click.ClickException(
            "attestation lookup was UNAVAILABLE — this is not a verification "
            "failure. Retry, or supply GH_TOKEN to lift the 60/hour "
            "unauthenticated rate limit."
        )
    if failures:
        raise click.ClickException(
            "attestation preflight FAILED:\n  " + "\n  ".join(failures)
        )
    click.echo(
        f"attestation preflight OK — pointer and manifest for build "
        f"{pointer['build_id']} verify against the pinned identity."
    )
