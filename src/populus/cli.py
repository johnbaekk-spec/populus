"""Populus pipeline CLI (ARCHITECTURE.md §5.3).

``db init`` works today. Every other command is a RUN-1 seam: it parses and
validates the full settled §5.3 argument surface, then raises
``NotImplementedError`` naming the RUN that owns its implementation.
"""

from __future__ import annotations

import sqlite3

import click

from populus.db import init_db

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
def ingest(job: str) -> None:
    """Run an ingest JOB: discover → fetch → parse → normalize → load."""
    raise NotImplementedError(
        f"populus ingest {job} is implemented in RUN {INGEST_JOB_OWNERS[job]}"
    )


@main.command()
@click.argument("job", type=click.Choice(sorted(REPARSE_JOB_OWNERS)))
@click.option("--filing", callback=_one_selector, help="Reparse one filing ID.")
@click.option("--since", callback=_one_selector, help="Reparse filings since DATE.")
@click.option(
    "--parser-version",
    callback=_one_selector,
    help="Reparse filings last parsed with version V.",
)
def reparse(
    job: str,
    filing: str | None,
    since: str | None,
    parser_version: str | None,
) -> None:
    """Reparse JOB from the raw archive, atomic per filing."""
    raise NotImplementedError(
        f"populus reparse {job} is implemented in RUN {REPARSE_JOB_OWNERS[job]}"
    )


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
