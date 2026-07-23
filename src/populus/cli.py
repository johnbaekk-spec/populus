"""Populus pipeline CLI (ARCHITECTURE.md §5.3).

``db init``, all four ingest jobs (``congress-house``/``congress-senate``
RUNs 2–3; ``congress-backfill``/``members`` RUN 4), both reparse jobs,
``stats``, and the ``backfill-audit`` gate commands work today. The
remaining commands (``build``/``publish``/``verify``) are seams: each
parses and validates the settled §5.3 argument surface, then raises
``NotImplementedError`` naming the RUN that owns its implementation.

This layer owns every current-time/identity/randomness value the library
needs (``now``/``run_id``/``host``/``sleep``/``monotonic``/``jitter``/
audit ``seed``) — library code never reads the wall clock.
"""

from __future__ import annotations

import json
import platform
import random
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
    "members": 4,
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
) -> None:
    """Run an ingest JOB: discover → fetch → parse → normalize → load."""
    if job != "members" and (house_index or kadoa_trades or aliases_path):
        raise click.UsageError(
            "--house-index/--kadoa-trades/--aliases apply only to ingest members"
        )
    if job == "congress-house":
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
    elif job == "congress-senate":
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
            )
        finally:
            conn.close()
        click.echo(senate.format_summary(report))
        if not report.ok:
            ctx.exit(1)
    elif job == "congress-backfill":
        from populus import backfill
        from populus.amendments import ensure_views

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
    else:  # members
        from populus import members
        from populus.amendments import ensure_views

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
