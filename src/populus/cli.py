"""Populus pipeline CLI (ARCHITECTURE.md §5.3).

``db init`` and the ``congress-house`` ingest/reparse jobs work today (RUN
2). Every other command is a seam: it parses and validates the settled §5.3
argument surface, then raises ``NotImplementedError`` naming the RUN that
owns its implementation. Job dispatch runs before per-job option validation
so the not-yet-implemented jobs keep their bare-invocation stubs.

This layer owns every current-time/identity value the library needs
(``now``/``run_id``/``host``/``sleep``/``monotonic``) — library code never
reads the wall clock.
"""

from __future__ import annotations

import platform
import sqlite3
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import click

from populus.db import connect, init_db

INGEST_JOB_OWNERS = {
    "congress-house": 2,
    "congress-senate": 3,
    "congress-backfill": 4,
}
REPARSE_JOB_OWNERS = {
    "congress-house": 2,
    "congress-senate": 3,
}


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
    help="Ingest offline from a cache DIR laid out like data-cache/house/.",
)
@click.option("--year", type=int, help="Ingest exactly this year (default: settled window).")
@click.option(
    "--raw-root",
    "raw_root",
    type=click.Path(file_okay=False),
    help="Raw-archive root for live fetches.",
)
@click.pass_context
def ingest(
    ctx: click.Context,
    job: str,
    db_path: str | None,
    from_cache: str | None,
    year: int | None,
    raw_root: str | None,
) -> None:
    """Run an ingest JOB: discover → fetch → parse → normalize → load."""
    if job != "congress-house":
        raise NotImplementedError(
            f"populus ingest {job} is implemented in RUN {INGEST_JOB_OWNERS[job]}"
        )
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
    finally:
        conn.close()
    click.echo(house.format_summary(report))
    if not report.ok:
        ctx.exit(1)


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
    if job != "congress-house":
        raise NotImplementedError(
            f"populus reparse {job} is implemented in RUN {REPARSE_JOB_OWNERS[job]}"
        )
    from populus.ingest import house

    if db_path is None:
        raise click.UsageError("--db is required for reparse congress-house")
    if raw_root is None:
        raise click.UsageError("--raw-root is required for reparse congress-house")
    conn = connect(db_path)
    try:
        report = house.reparse_house(
            conn,
            raw_root=raw_root,
            selector=house.ReparseSelector(
                filing=filing, since=since, parser_version=parser_version
            ),
        )
    finally:
        conn.close()
    click.echo(house.format_reparse_summary(report))
    if not report.ok:
        ctx.exit(1)


@main.command()
def build() -> None:
    """Assemble artifacts + manifest for all modules with changes."""
    raise NotImplementedError("populus build is implemented in RUN 5")


@main.command()
@click.option("--dry-run", is_flag=True, help="Report what would publish; write nothing.")
def publish(dry_run: bool) -> None:
    """Publish per the §5.5 protocol; refuses partial builds."""
    raise NotImplementedError("populus publish is implemented in RUN 5")


@main.command()
def verify() -> None:
    """Recompute artifact hashes vs manifest; DB integrity checks."""
    raise NotImplementedError("populus verify is implemented in RUN 5")


@main.command()
def stats() -> None:
    """Print/refresh stats.json."""
    raise NotImplementedError("populus stats is implemented in RUN 4")
