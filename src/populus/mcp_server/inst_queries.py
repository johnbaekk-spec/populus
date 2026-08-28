"""Read paths for the institutional (13F / M2) MCP tools (§10.2, §5.6, §11.4).

Two cleanly-separated data planes, each honest about which it used:

* **Snapshot plane** — parameterized read-only SQL over the published
  ``inst_agg.db`` (the M2-3 cross-filer aggregate). ``filer_lookup``,
  ``filer_snapshot``, ``filer_qoq``, ``issuer_top_holders``, ``biggest_moves``
  and ``filer_registry_stats`` read this plane; responses are stamped with the
  snapshot ``build_id``.
* **Federated plane** — live SEC EDGAR reads at question time (Pattern F,
  §11.4), through the sanctioned :class:`~populus.net.sec_client.SecClient` and
  the reused M2-2 ``discover`` / ``evaluate_filing`` chain. ``fetch_filer_detail``
  returns a filer's full quarter-end position list; ``resolve_ticker_to_issuer_key``
  turns a ticker into an issuer key via the cached ``company_tickers.json``.
  Nothing here writes to disk (G7) and identity is left unresolved on the
  federated path (no as-of registry at query time — G14/LD5).

The aggregate carries no ticker registry and no per-row ``filed_date`` (verified
against ``inst_agg.sql``), so ticker resolution is federated and filing-level
freshness comes from the manifest watermark, never fabricated here.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Mapping
from typing import Any

from populus.identity.bootstrap import parse_company_tickers
from populus.identity.registry import (
    normalize_cik,
    normalize_ticker,
)
# The sanctioned M2-2 federated chain, reused (not forked): the public
# discovery/evaluation functions plus the internal document shape and URL
# builders they consume. A thin non-persisting source (below) supplies the four
# methods they call; the parse/normalize/reconcile logic is never duplicated.
from populus.ingest.inst13f import (
    _Doc,
    _archive_base,
    _shard_url,
    _submissions_url,
    discover,
    evaluate_filing,
)
from populus.mcp_server.queries import connect  # read-only `mode=ro` connection

#: SEC's ticker→CIK primary source (bootstrap TTL in the SecClient cache).
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

#: The single value label reused across every 13F amount (G5).
_VALUE_LABEL = "manager's stated quarter-end market value (USD)"

__all__ = [
    "connect",
    "InstDetailUnavailable",
    "filer_lookup",
    "filer_snapshot",
    "filer_qoq",
    "issuer_top_holders",
    "biggest_moves",
    "filer_registry_stats",
    "fetch_filer_detail",
    "resolve_ticker_to_issuer_key",
    "COMPANY_TICKERS_URL",
]


class InstDetailUnavailable(RuntimeError):
    """A federated read could not be completed (no matching filing, or an SEC
    non-200) — surfaced to the caller as an honest error, never a crash."""


def _rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


def _flags(row: Mapping[str, Any]) -> list[str]:
    """The canonical sorted JSON-array ``flags`` column, decoded to a list."""
    raw = row.get("flags")
    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
        except ValueError:
            return [raw] if raw else []
        return decoded if isinstance(decoded, list) else [decoded]
    return list(raw) if raw else []


# --- aggregate-row shapers ----------------------------------------------------


def shape_filer(row: Mapping[str, Any]) -> dict[str, Any]:
    """A filer registry row (drops the volatile ``ingested_at``).

    Every count here spans ALL retained periods for the filer, not one quarter
    (see ``agg_filer_registry`` in inst_agg.sql). Presented next to a requested
    `period_of_report` under bare names like `position_count`, they read as that
    quarter's figures — so the keys carry the `all_periods_` prefix and a label
    (G5).
    """
    return {
        "cik": row.get("cik"),
        "filer_name": row.get("filer_name"),
        "latest_period": row.get("latest_period"),
        "all_periods_position_count": row.get("position_count"),
        "all_periods_total_value_usd": row.get("total_value_usd"),
        "all_periods_null_value_positions": row.get("null_value_positions"),
        "all_periods_unkeyed_positions": row.get("unkeyed_positions"),
        # No dangling pointer: `period` exists only on a snapshot profile, and
        # a caveat that references an absent key invites a client to invent one.
        "counts_basis": "every retained period for this filer, NOT a single"
        " quarter. Quarter-specific figures are in the `period` block of"
        " inst_filer_holdings(mode='snapshot').",
    }


def shape_qoq_row(row: Mapping[str, Any]) -> dict[str, Any]:  # noqa: D401
    """One ``agg_qoq_deltas`` row — both periods, unit-guarded Δshares (G5)."""
    shaped = {
        "cik": row.get("cik"),
        "position_key": row.get("position_key"),
        "put_call": row.get("put_call"),
        "curr_period": row.get("curr_period"),
        "prev_period": row.get("prev_period"),
        "change_kind": row.get("change_kind"),
        "prev_value_usd": row.get("prev_value_usd"),
        "curr_value_usd": row.get("curr_value_usd"),
        "delta_value_usd": row.get("delta_value_usd"),
        # NULL when the reported units are incompatible across quarters —
        # never a fabricated 0.
        "prev_shares": row.get("prev_shares"),
        "curr_shares": row.get("curr_shares"),
        "delta_shares": row.get("delta_shares"),
        "ssh_prnamt_type": row.get("ssh_prnamt_type"),
        "value_label": _VALUE_LABEL,
        # A NULL delta means one side's value was never disclosed — NOT a zero
        # change. Kept distinct so a reader cannot mistake "we don't know" for
        # "nothing moved".
        "delta_value_known": row.get("delta_value_usd") is not None,
        "flags": _flags(row),
    }
    if row.get("filer_name") is not None:  # present on the cross-filer join
        shaped["filer_name"] = row.get("filer_name")
    return shaped


def shape_top_holder(row: Mapping[str, Any]) -> dict[str, Any]:
    """One ``agg_issuer_top_holders`` row — a ranked holder of an issuer.

    Carries ``period_of_report`` and the value unit on the RECORD: a
    holder row lifted out of its response must still say which quarter-end it
    describes and in what unit, never leave that to surrounding prose (G4/G5).
    The aggregate has no per-row filed date — it rolls up many filings — so the
    filing-level date is disclosed once per response as ``filed_through`` from
    the build watermark, not fabricated per row.
    """
    return {
        "rank": row.get("rank"),
        "cik": row.get("cik"),
        "filer_name": row.get("filer_name"),
        "issuer_name": row.get("issuer_name"),
        "issuer_key": row.get("issuer_key"),
        "issuer_key_source": row.get("issuer_key_source"),
        "period_of_report": row.get("period_of_report"),
        "value_usd": row.get("value_usd"),
        "value_unit": "USD",
        "security_count": row.get("security_count"),
        "value_label": _VALUE_LABEL,
        "flags": _flags(row),
    }


def shape_concentration(
    row: Mapping[str, Any] | None, topn: int | None = None
) -> dict[str, Any] | None:
    """One ``agg_filer_concentration`` row — NULL share/HHI kept distinct from 0.

    ``topn_value_usd``/``topn_share_bps`` are a TOP-N share whose N was never
    stated anywhere in the response, so a reader could not tell a top-10 share
    from a top-25 one.
    """
    if row is None:
        return None
    count = row.get("position_count")
    # A 2-position filer told "…your largest 25 positions" in the same block
    # that reports position_count: 2 (G-N4).
    effective_n = (
        min(topn, count) if topn is not None and isinstance(count, int)
        else topn
    )
    return {
        "topn": effective_n,
        "published_topn": topn,
        "topn_label": (
            f"'topn_*' fields cover this filer's largest {effective_n} position(s)"
            + (f" (the published cut is {topn})" if topn != effective_n else "")
            if effective_n is not None
            else "'topn_*' fields cover a top-N slice whose N is not recorded"
            " in this aggregate"
        ),
        "period_of_report": row.get("period_of_report"),
        "position_count": row.get("position_count"),
        "total_value_usd": row.get("total_value_usd"),
        "null_value_positions": row.get("null_value_positions"),
        "topn_value_usd": row.get("topn_value_usd"),
        "topn_share_bps": row.get("topn_share_bps"),
        "hhi": row.get("hhi"),
        "hhi_scale": "0–10000 (sum of squared position shares × 10000); 10000 is"
        " a single-position book",
        "flags": _flags(row),
    }


# --- snapshot-plane queries (parameterized, read-only) ------------------------

_REGISTRY_COLS = (
    "cik, filer_name, latest_period, position_count, total_value_usd,"
    " null_value_positions, unkeyed_positions"
)


def filer_lookup_total(conn: sqlite3.Connection, *, query: str) -> int:
    """How many filers the query matches BEFORE the limit is applied.

    `filer_lookup` truncates at `limit` with no disclosure, and it is the
    documented entry point for every other inst tool — against a real ~5,000
    filer registry, "Capital" or "Advisors" matches hundreds and filer #26 was
    indistinguishable from not existing.
    """
    text = query.strip()
    cik = normalize_cik(text)
    if cik is not None:
        row = conn.execute(
            "SELECT COUNT(*) FROM agg_filer_registry WHERE cik = ?", (cik,)
        ).fetchone()
    else:
        # Must mirror `filer_lookup`'s predicate exactly, or the count lies.
        row = conn.execute(
            "SELECT COUNT(*) FROM agg_filer_registry"
            " WHERE filer_name LIKE ? COLLATE NOCASE",
            (f"%{text}%",),
        ).fetchone()
    return int(row[0]) if row else 0


def filer_lookup(
    conn: sqlite3.Connection, *, query: str, limit: int
) -> list[dict[str, Any]]:
    """Resolve a name fragment or CIK to filers from ``agg_filer_registry``.

    A numeric query is treated as a CIK (canonicalized to the 10-digit key) and
    matched exactly; anything else is a case-insensitive name fragment, ranked
    by total disclosed value.
    """
    text = query.strip()
    cik = normalize_cik(text)
    if cik is not None:
        cur = conn.execute(
            f"SELECT {_REGISTRY_COLS} FROM agg_filer_registry WHERE cik = ?", (cik,)
        )
        return [shape_filer(r) for r in _rows(cur)]
    like = f"%{text}%"
    cur = conn.execute(
        f"SELECT {_REGISTRY_COLS} FROM agg_filer_registry"
        " WHERE filer_name LIKE ? COLLATE NOCASE"
        " ORDER BY total_value_usd DESC, filer_name ASC LIMIT ?",
        (like, limit),
    )
    return [shape_filer(r) for r in _rows(cur)]


def filer_snapshot(
    conn: sqlite3.Connection, *, cik: str, period: str | None
) -> dict[str, Any] | None:
    """A filer's aggregate profile: the registry row + the concentration row for
    *period* (or the filer's latest). ``None`` when the CIK is not a filer."""
    reg = conn.execute(
        f"SELECT {_REGISTRY_COLS} FROM agg_filer_registry WHERE cik = ?", (cik,)
    ).fetchone()
    if reg is None:
        return None
    reg = dict(reg)
    target = period or reg["latest_period"]
    conc = conn.execute(
        "SELECT period_of_report, position_count, total_value_usd,"
        " null_value_positions, topn_value_usd, topn_share_bps, hhi, flags"
        " FROM agg_filer_concentration WHERE cik = ? AND period_of_report = ?",
        (cik, target),
    ).fetchone()
    if conc is None:
        # The filer exists but has nothing for this quarter. Returning a
        # successful profile with `concentration: null` let a NONEXISTENT
        # quarter read as a valid empty one.
        available = [
            r[0]
            for r in conn.execute(
                "SELECT period_of_report FROM agg_filer_concentration"
                " WHERE cik = ? ORDER BY period_of_report DESC",
                (cik,),
            ).fetchall()
        ]
        return {
            "filer": shape_filer(reg),
            "period_of_report": target,
            "period": None,
            "concentration": None,
            "hint": f"no institutional data for CIK {cik} at period {target}."
            + (
                f" Available periods: {', '.join(available)}."
                if available
                else " This filer has no per-period aggregate rows."
            ),
        }
    conc = dict(conc)
    return {
        "filer": shape_filer(reg),
        "period_of_report": target,
        # The REQUESTED quarter's own figures, so they need not be inferred from
        # the all-period registry row above.
        "period": {
            "period_of_report": conc["period_of_report"],
            "position_count": conc["position_count"],
            "total_value_usd": conc["total_value_usd"],
            "null_value_positions": conc["null_value_positions"],
            "value_label": _VALUE_LABEL,
        },
        "concentration": shape_concentration(conc, published_topn(conn)),
    }


_QOQ_COLS = (
    "cik, position_key, put_call, curr_period, prev_period, change_kind,"
    " prev_value_usd, curr_value_usd, delta_value_usd, prev_shares, curr_shares,"
    " delta_shares, ssh_prnamt_type, flags"
)
# The same projection with a ``d`` table alias, for the cross-filer join that
# also selects the registry filer_name.
_QOQ_COLS_D = ", ".join(f"d.{col.strip()}" for col in _QOQ_COLS.split(","))


def filer_periods(conn: sqlite3.Connection, *, cik: str) -> list[str]:
    """Every period on record for this filer, newest first."""
    return [
        r[0]
        for r in conn.execute(
            "SELECT period_of_report FROM agg_filer_concentration WHERE cik = ?"
            " ORDER BY period_of_report DESC",
            (cik,),
        ).fetchall()
    ]


def qoq_universe(
    conn: sqlite3.Connection, *, cik: str, period: str
) -> dict[str, Any]:
    """How much of the filer's book the delta set could actually see.

    `agg_qoq_deltas` is built only from holdings with a `position_key`, so
    unkeyable positions (neither `security_id` nor a parseable CUSIP) never
    enter it. Reporting the changes without this denominator let a filer whose
    book was 99.99% unkeyed read as "one change this quarter".
    """
    row = conn.execute(
        "SELECT position_count, null_value_positions FROM agg_filer_concentration"
        " WHERE cik = ? AND period_of_report = ?",
        (cik, period),
    ).fetchone()
    reg = conn.execute(
        "SELECT unkeyed_positions FROM agg_filer_registry WHERE cik = ?", (cik,)
    ).fetchone()
    return {
        "period_position_count": row[0] if row else None,
        "all_periods_unkeyed_positions": reg[0] if reg else None,
    }


def filer_qoq(
    conn: sqlite3.Connection, *, cik: str, period: str | None
) -> dict[str, Any]:
    """A filer's quarter-over-quarter position changes for *period* (or the
    latest ``curr_period`` on record), ranked by absolute dollar change."""
    if period is None:
        row = conn.execute(
            "SELECT MAX(curr_period) FROM agg_qoq_deltas WHERE cik = ?", (cik,)
        ).fetchone()
        period = row[0] if row else None
    if period is None:
        return {"curr_period": None, "prev_period": None, "changes": []}
    cur = conn.execute(
        f"SELECT {_QOQ_COLS} FROM agg_qoq_deltas WHERE cik = ? AND curr_period = ?"
        " ORDER BY (delta_value_usd IS NULL) ASC,"
        " ABS(COALESCE(delta_value_usd, 0)) DESC, position_key ASC",
        (cik, period),
    )
    rows = _rows(cur)
    prev_period = rows[0]["prev_period"] if rows else None
    return {
        "curr_period": period,
        "prev_period": prev_period,
        "changes": [shape_qoq_row(r) for r in rows],
    }


def published_topn(conn: sqlite3.Connection) -> int | None:
    """The top-N cut the publisher applied to ``agg_issuer_top_holders``.

    `build_inst_agg` stores only `ranked[:topn]` per (issuer, period) and records
    the N in `agg_build_meta` "so the cut is legible" — but nothing read it, so
    `inst_ticker_holders` returned a silent top-25 slice while accepting a
    `limit` of up to 200. For a mega-cap, thousands of managers
    file; the flagship "biggest holders" answer was truncated with no disclosure.
    """
    try:
        row = conn.execute(
            "SELECT value FROM agg_build_meta WHERE key = 'topn'"
        ).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def issuer_top_holders(
    conn: sqlite3.Connection, *, issuer_key: str, period: str | None, limit: int
) -> list[dict[str, Any]]:
    """The ranked top holders of an issuer for *period* (or the latest period
    that issuer_key appears in), ordered by the published rank."""
    if period is None:
        row = conn.execute(
            "SELECT MAX(period_of_report) FROM agg_issuer_top_holders"
            " WHERE issuer_key = ?",
            (issuer_key,),
        ).fetchone()
        period = row[0] if row else None
    if period is None:
        return []
    cur = conn.execute(
        "SELECT issuer_key, period_of_report, rank, cik, filer_name, issuer_name,"
        " issuer_key_source, value_usd, security_count, flags"
        " FROM agg_issuer_top_holders WHERE issuer_key = ? AND period_of_report = ?"
        " ORDER BY rank ASC LIMIT ?",
        (issuer_key, period, limit),
    )
    return [shape_top_holder(r) for r in _rows(cur)]


def biggest_moves(
    conn: sqlite3.Connection, *, period: str | None, side: str, limit: int
) -> dict[str, Any]:
    """The largest cross-filer changes of one *side* (``new`` | ``add`` | ``trim``
    | ``exit``) for *period* (or the latest), ranked by absolute dollar change.

    *side* is a validated bind parameter (never interpolated), so the query is
    fully parameterized — no dynamic SQL, no ``# nosec`` needed.
    """
    if period is None:
        row = conn.execute("SELECT MAX(curr_period) FROM agg_qoq_deltas").fetchone()
        period = row[0] if row else None
    if period is None:
        return {"period": None, "side": side, "moves": []}
    cur = conn.execute(
        f"SELECT {_QOQ_COLS_D}, r.filer_name AS filer_name FROM agg_qoq_deltas d"
        " LEFT JOIN agg_filer_registry r ON r.cik = d.cik"
        " WHERE d.curr_period = ? AND d.change_kind = ?"
        " ORDER BY (d.delta_value_usd IS NULL) ASC,"
        " ABS(COALESCE(d.delta_value_usd, 0)) DESC, d.cik ASC, d.position_key ASC"
        " LIMIT ?",
        (period, side, limit),
    )
    return {
        "period": period,
        "side": side,
        "moves": [shape_qoq_row(r) for r in _rows(cur)],
    }


def filer_registry_stats(conn: sqlite3.Connection) -> dict[str, Any]:
    """Published-fact health inputs: filer/position counts, issuer-keying mix,
    and the latest report period on record (never a fabricated coverage %)."""
    counts = dict(
        conn.execute(
            "SELECT COUNT(*) AS filers,"
            " COALESCE(SUM(position_count), 0) AS positions,"
            " COALESCE(SUM(null_value_positions), 0) AS null_value_positions,"
            " COALESCE(SUM(unkeyed_positions), 0) AS unkeyed_positions"
            " FROM agg_filer_registry"
        ).fetchone()
    )
    counts["qoq_rows"] = conn.execute(
        "SELECT COUNT(*) FROM agg_qoq_deltas"
    ).fetchone()[0]
    counts["issuer_rows"] = conn.execute(
        "SELECT COUNT(*) FROM agg_issuer_top_holders"
    ).fetchone()[0]
    counts["concentration_rows"] = conn.execute(
        "SELECT COUNT(*) FROM agg_filer_concentration"
    ).fetchone()[0]
    keying = {
        r["issuer_key_source"]: r["n"]
        for r in conn.execute(
            "SELECT issuer_key_source, COUNT(*) AS n FROM agg_issuer_top_holders"
            " GROUP BY issuer_key_source"
        )
    }
    latest_period = conn.execute(
        "SELECT MAX(latest_period) FROM agg_filer_registry"
    ).fetchone()[0]
    return {
        "counts": counts,
        "issuer_keying": keying,
        "latest_period": latest_period,
    }


# --- federated plane (live SEC, no disk writes — §11.4/G7) --------------------


class _FederatedSource:
    """A non-persisting 13F source over :meth:`SecClient.get` (LD-4).

    Implements exactly the four methods ``discover`` / ``evaluate_filing`` call
    (``submissions`` / ``index`` / ``cover`` / ``table``), returning the same
    ``_Doc`` shape as the ingest sources — but it writes nothing to disk and
    keeps no cache of its own (the SecClient owns response caching). A non-200
    from SEC becomes :class:`InstDetailUnavailable`, so an upstream outage is an
    honest error rather than a parse crash on empty bytes.
    """

    def __init__(self, client: Any) -> None:
        self._client = client

    def _doc(self, url: str, relpath: str) -> _Doc:
        response = self._client.get(url)
        if response.status_code != 200:
            raise InstDetailUnavailable(
                f"SEC returned HTTP {response.status_code} for {url}"
            )
        content = response.content
        return _Doc(
            content=content,
            url=url,
            raw_path=relpath,
            response_hash=hashlib.sha256(content).hexdigest(),
            retrieved_at=None,
        )

    def submissions(self, cik10: str) -> _Doc:
        return self._doc(_submissions_url(cik10), f"CIK{cik10}/submissions.json")

    def submissions_shard(self, cik10: str, name: str) -> _Doc:
        """An older ``filings.files[]`` shard, fetched live."""
        return self._doc(_shard_url(name), f"CIK{cik10}/{name}")

    def index(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._doc(
            f"{_archive_base(cik10, accession_nodash)}/index.json",
            f"CIK{cik10}/{accession_nodash}/index.json",
        )

    def cover(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._doc(
            f"{_archive_base(cik10, accession_nodash)}/primary_doc.xml",
            f"CIK{cik10}/{accession_nodash}/primary_doc.xml",
        )

    def table(self, cik10: str, accession_nodash: str, filename: str) -> _Doc:
        return self._doc(
            f"{_archive_base(cik10, accession_nodash)}/{filename}",
            f"CIK{cik10}/{accession_nodash}/{filename}",
        )


_HR_FORMS = ("13F-HR", "13F-HR/A")


def _holding_to_dict(holding: Any, *, source: Any = None) -> dict[str, Any]:
    """A federated ``InstParsedRow`` reduced to the fields ``shape_holding``
    reads, plus the filing the row came from when the period was composed from
    more than one filing (G4)."""
    provenance = (
        {
            "source_accession": source.accession,
            "source_submission_type": source.submission_type,
            "source_filed_date": source.filed_date,
            "source_doc_url": source.doc_url,
        }
        if source is not None
        else {}
    )
    return {
        **provenance,
        "issuer_name_raw": holding.issuer_name_raw,
        "cusip": holding.cusip,
        "cusip_raw": holding.cusip_raw,
        "title_of_class": holding.title_of_class,
        "value_usd": holding.value_usd,
        "unit_basis": holding.unit_basis,
        "ssh_prnamt": holding.ssh_prnamt,
        "ssh_prnamt_type": holding.ssh_prnamt_type,
        "put_call": holding.put_call,
        "security_id": holding.security_id,
        "flags": list(holding.flags),
    }


def fetch_filer_detail(
    sec_client: Any, cik: str, period: str | None, *, ingested_at: str
) -> dict[str, Any]:
    """Fetch a filer's full quarter-end position list LIVE from SEC EDGAR.

    Discovers the filer's 13F-HR accessions from ``submissions.json`` (reused
    ``discover``), takes EVERY filing for *period* (or the latest report period),
    fetches + parses each through the reused ``evaluate_filing`` with identity
    resolution disabled (no as-of registry at query time — G14/LD5), and COMPOSES
    them in filed order under the pipeline's amendment semantics — a RESTATEMENT
    supersedes, a NEW HOLDINGS amendment adds to its base. Returns the composed
    holdings (each carrying its source filing), the ``composition`` trail and a
    ``live_source`` stamp. Nothing is persisted.

    Raises :class:`InstDetailUnavailable` when the filer has no matching 13F-HR
    or SEC returns a non-200; the circuit-breaker / URL errors from the SecClient
    propagate unchanged for the caller to surface honestly.
    """
    norm = normalize_cik(cik)
    if norm is None:
        raise InstDetailUnavailable(f"not a CIK: {cik!r}")
    source = _FederatedSource(sec_client)
    # Arbitrary historical periods are supported, so the older shards must
    # actually be READ here.
    discovery = discover(source, norm, cache_bounded=False, include_history=True)
    hr = [entry for entry in discovery.entries if entry.form in _HR_FORMS]
    # A filing REJECTED at discovery (malformed accession, non-ISO dates) is
    # just as invisible to this answer as an unread shard — it could be the very
    # amendment that restates the period.
    unread = discovery.unread_shards
    rejected = discovery.rejected
    _parts = []
    if unread:
        _parts.append(
            f"{len(unread)} older submissions shard(s) could not be read"
            f" ({', '.join(unread)})"
        )
    if rejected:
        _parts.append(
            f"{len(rejected)} filing record(s) were rejected at discovery as"
            f" malformed ({', '.join(rejected)})"
        )
    incomplete_note = (
        f" WARNING: {'; '.join(_parts)}, so this filer's history was searched"
        " INCOMPLETELY."
        if _parts
        else ""
    )
    history_gap = bool(unread or rejected)
    if not hr:
        raise InstDetailUnavailable(
            f"no 13F-HR filings found for CIK {norm} in SEC submissions."
            f"{incomplete_note}"
            + (" The filer may still have 13F filings that were not searched."
               if history_gap else "")
        )
    if period is not None:
        matching = [entry for entry in hr if entry.report_date == period]
        if not matching:
            latest = max(entry.report_date for entry in hr)
            # If a history shard could not be read, the search was INCOMPLETE —
            # say so rather than assert the filing does not exist (G3).
            raise InstDetailUnavailable(
                f"no 13F-HR for CIK {norm} at period {period}; the latest"
                f" available report period is {latest}.{incomplete_note}"
                + (" The filing may exist in the unsearched history."
                   if history_gap else "")
            )
        period_entries = matching
    else:
        latest_period = max(entry.report_date for entry in hr)
        period_entries = [e for e in hr if e.report_date == latest_period]

    # COMPOSE the period's filings. This is deliberately
    # TWO PHASES — classify every filing, then apply semantics — rather than a
    # single fold over arrival order. The fold shipped three separate defects,
    # each "in arrival order X the fold does the wrong thing": an amendment whose
    # cover omitted <isAmendment> was folded as a base; a first base that
    # parsed to zero rows skipped the duplicate guard; and a NEW HOLDINGS
    # amendment sorting BEFORE its same-day base had its rows discarded by the
    # base's assignment while the trail still claimed they were added.
    # Order-independent classification removes the whole class.
    #
    #   FULL filings      = non-amendments, plus RESTATEMENT amendments
    #                       (both purport to state the period's whole book)
    #   ADDITIVE filings  = NEW HOLDINGS amendments (a confidential-treatment
    #                       release ADDS to the book; never replaces it)
    #   UNKNOWN filings   = amendments whose type is absent/unrecognized —
    #                       merge semantics unstated, so never inferred
    #
    # The answer is: the authoritative FULL filing's rows, plus every ADDITIVE
    # filing's rows that a strictly-later RESTATEMENT has not superseded.

    # Discovery order is arbitrary; evaluate first, then rank on the filing's
    # OWN metadata using the PIPELINE's key (views.sql `restatement_survivors`):
    # filed_date, then amendment_no, then accession. Ranking on accession alone
    # for amendment-vs-amendment ties made the federated plane pick a different
    # restatement than `v_default_inst_filings` for the same filings —
    # `amendment_no` was available on every row and simply not consulted.
    evaluated = [
        evaluate_filing(
            candidate,
            source,
            resolve_security=lambda _cusip, _as_of: None,  # unresolved (G14/LD5)
            ingested_at=ingested_at,
        )
        for candidate in period_entries
    ]

    def _order_key(ev: Any) -> tuple:
        """The two components that carry REAL ordering signal."""
        # `amendment_no` is OPTIONAL on the cover — an amendment that omits it
        # collapses to 0, the same value a base gets, so this pair can tie
        # between a base and the very restatement that supersedes it.
        return (ev.filing.filed_date, ev.filing.amendment_no or 0)

    def _rank(ev: Any) -> tuple:
        # Accession only ever BREAKS a tie; it is a filing agent's prefix and
        # carries no chronology, so whenever it decides the outcome the order is
        # unresolvable from the filings and must be reported as such.
        return (*_order_key(ev), ev.filing.accession)

    evaluated.sort(key=_rank)

    def _kind(ev: Any) -> str:
        if not ev.filing.is_amendment:
            return "full"
        if ev.filing.amendment_type == "RESTATEMENT":
            return "full"
        if ev.filing.amendment_type == "NEW_HOLDINGS":
            return "additive"
        return "unknown"

    fulls = [ev for ev in evaluated if _kind(ev) == "full"]
    additives = [ev for ev in evaluated if _kind(ev) == "additive"]
    unknowns = [ev for ev in evaluated if _kind(ev) == "unknown"]

    authoritative = fulls[-1] if fulls else None
    # A RESTATEMENT supersedes anything ordering BEFORE it under the pipeline's
    # own key — including a same-day additive, which `filed_date <` missed
    # because filed_date is date-only. `views.sql` supersedes on
    # (filed_date, amendment_no, accession) strictly-greater, so use the same
    # comparison rather than a date-only one.
    latest_restatement = next(
        (ev for ev in reversed(fulls) if ev.filing.is_amendment), None
    )
    restatement_key = _rank(latest_restatement) if latest_restatement else None

    composed: list[tuple[Any, Any]] = []
    if authoritative is not None:
        composed = [(h, authoritative.filing) for h in authoritative.holdings]
    applied_additives = []
    if authoritative is None and unknowns:
        # No FULL filing at all: an unknown-type amendment is all we have. Take
        # the last one as the anchor and say so — never guess a merge. This runs
        # BEFORE additives are applied; reassigning `composed` afterwards
        # discarded rows the loop had already appended while `applied_additives`
        # still reported them as applied.
        composed = [(h, unknowns[-1].filing) for h in unknowns[-1].holdings]
    for ev in additives:
        if restatement_key is not None and _rank(ev) < restatement_key:
            continue                       # superseded by a later restatement
        applied_additives.append(ev)
        composed.extend((h, ev.filing) for h in ev.holdings)

    # Completeness is a conjunction of stated facts, never an inference:
    #   1. an authoritative FULL filing exists and parsed EXACTLY "parsed"
    #      ("partial" means defects or an entry-total mismatch — it may be
    #      missing positions, so it cannot vouch for a whole book);
    #   2. at most ONE non-amendment base — two bases for one period is a
    #      supersession the filings do not state;
    #   3. no unknown-type amendment, whose merge semantic is unstated;
    #   4. the history search was exhaustive (see `history_gap`).
    bases = [ev for ev in fulls if not ev.filing.is_amendment]
    # Completeness is a predicate over EVERY filing that contributes rows, not
    # just the authoritative one. An unreadable NEW HOLDINGS amendment
    # contributes nothing while its confidential-treatment releases — the entire
    # reason that form exists — go missing, and the answer was still stamped
    # complete.
    # Unresolvable exactly when two filings share BOTH orderable signals, so
    # only the accession separates them. Checked across EVERY filing the
    # restatement could supersede — bases and other fulls included, not just
    # additives. Scoping it to additives left the base-vs-restatement pairing
    # unguarded, and a restatement whose cover omitted `amendmentNo` then lost
    # to its own base: 110 positions returned as a complete book when the
    # filer's own restatement said the book was 4.
    same_day_restatement_tie = bool(
        latest_restatement is not None
        and any(
            _order_key(ev) == _order_key(latest_restatement)
            and ev.filing.accession != latest_restatement.filing.accession
            for ev in (*fulls, *additives)
        )
    )
    incomplete_reasons: list[str] = []
    if authoritative is None:
        incomplete_reasons.append(
            "no authoritative full filing (a base 13F-HR, or a RESTATEMENT"
            " amendment) was found for this period"
        )
    elif authoritative.status != "parsed":
        incomplete_reasons.append(
            f"the authoritative filing {authoritative.filing.accession} parsed as"
            f" {authoritative.status!r}, so it may itself be missing positions"
        )
    if len(bases) > 1:
        incomplete_reasons.append(
            f"{len(bases)} non-amendment filings cover this period and which"
            " supersedes which is not stated by the filings"
        )
    if unknowns:
        incomplete_reasons.append(
            f"{len(unknowns)} amendment(s) state no recognized amendment type,"
            " so their merge semantics cannot be determined"
        )
    bad_additives = [ev for ev in applied_additives if ev.status != "parsed"]
    if bad_additives:
        incomplete_reasons.append(
            f"{len(bad_additives)} NEW HOLDINGS amendment(s) could not be read"
            f" ({', '.join(ev.filing.accession for ev in bad_additives)}), so the"
            " positions they disclose are MISSING from this list"
        )
    if same_day_restatement_tie:
        incomplete_reasons.append(
            "two filings for this period share a filed date AND an amendment"
            " number, so only the accession — a filing agent's prefix, not a"
            " clock — separates them; which supersedes which is UNRESOLVABLE"
            " from the filings"
        )
    has_authoritative_full = not incomplete_reasons

    def _action(ev: Any) -> str:
        kind = _kind(ev)
        contested = len(bases) > 1
        if (
            same_day_restatement_tie
            and latest_restatement is not None
            and _order_key(ev) == _order_key(latest_restatement)
        ):
            # Do not assert a supersession the filings do not establish.
            return ("ordering with the same-day restatement is UNRESOLVABLE"
                    " (identical filed date and amendment number); no"
                    " supersession is asserted")
        if ev is authoritative:
            if not ev.filing.is_amendment:
                # With two bases for one period, BOTH carry the ambiguity — the
                # authoritative one is only "later", which the filings do not
                # say means "supersedes".
                return ("base (one of"
                        f" {len(bases)} non-amendment filings for this period;"
                        " supersession is unstated)") if contested else "base"
            return "restatement (replaced everything filed before it)"
        if kind == "full" and not ev.filing.is_amendment:
            if contested:
                return ("earlier of"
                        f" {len(bases)} non-amendment filings for this period;"
                        " supersession is unstated")
            # Superseded by a RESTATEMENT, which STATES that it supersedes —
            # calling that "unstated" was false, and "earlier of 1" was nonsense
            # (F-N6). This is the most common amendment shape there is.
            return "base, superseded by a later restatement"
        if kind == "full":
            return "restatement superseded by a later full filing"
        if kind == "additive":
            return ("new-holdings (added to the base filing)"
                    if ev in applied_additives
                    else "new-holdings superseded by a later restatement")
        return "amendment of unstated type (merge semantics not inferred)"

    contributing = {id(ev) for ev in
                    ([authoritative] if authoritative is not None else [])
                    + applied_additives
                    + ([unknowns[-1]] if authoritative is None and unknowns else [])}
    composition = [
        {
            "accession": ev.filing.accession,
            # Explicit, not inferred from the prose label: one `applied` string
            # was emitted both when a filing's rows were DROPPED and when they
            # WERE the answer (G-N2), and the truth table's guard tried to
            # recover the distinction by string-matching (G-N1).
            "rows_applied": id(ev) in contributing,
            "submission_type": ev.filing.submission_type,
            "filed_date": ev.filing.filed_date,
            "amendment_type": ev.filing.amendment_type,
            "amendment_no": ev.filing.amendment_no,
            "applied": _action(ev),
            "is_amendment_applied": bool(ev.filing.is_amendment),
            # Per-filing parse status: a clean amendment must not mask a failed
            # or partial base whose rows feed the composed answer.
            "parse_status": ev.status,
            "rows": len(ev.holdings),
        }
        for ev in evaluated
    ]
    outcome = authoritative or (evaluated[-1] if evaluated else None)

    # Aggregate status across every APPLIED filing: the composed
    # answer is only "parsed" when all of its constituents parsed, because the
    # rows are pooled. Filings that were superseded do not contribute rows and
    # so do not degrade the answer.
    applied = [ev for ev in (([authoritative] if authoritative else [])
                             + applied_additives
                             + (unknowns[-1:] if authoritative is None else []))]
    statuses = [ev.status for ev in applied]
    if "failed" in statuses:
        composed_status = "failed" if all(s == "failed" for s in statuses) else "partial"
    elif "partial" in statuses:
        composed_status = "partial"
    else:
        composed_status = statuses[0] if statuses else "failed"

    if outcome is None:  # unreachable: hr/matching are non-empty above
        raise InstDetailUnavailable(
            f"no 13F-HR filing could be evaluated for CIK {norm}"
        )
    # The top-level stamp is the LAST filing applied; `composition` carries the
    # full trail and each holding carries its own source filing.
    filing = outcome.filing
    return {
        "cik": norm,
        "filer_name": discovery.filer_name,
        "accession": filing.accession,
        "submission_type": filing.submission_type,
        "period_of_report": filing.period_of_report,
        "filed_date": filing.filed_date,
        "doc_url": filing.doc_url,
        # The status of the COMPOSED answer, not of whichever filing came last.
        "parse_status": composed_status,
        # The LAST filing chronologically — distinct from `outcome`, which is
        # the AUTHORITATIVE filing the top-level stamp describes. With a failed
        # base and a clean later amendment these differ, and conflating them
        # would report the clean status for the filing that actually anchors the
        # answer.
        "last_filing_parse_status": evaluated[-1].status if evaluated else None,
        # The COMPOSED position set for the period (base + amendments applied),
        # with the composition trail so a consumer can audit how it was formed.
        "holdings": [
            _holding_to_dict(h, source=src_filing) for h, src_filing in composed
        ],
        "composition": composition,
        # Complete requires BOTH an authoritative full filing AND an
        # exhaustively-searched history: an unread shard could hold an amendment
        # for this very period, so the composition cannot be called complete
        "composition_complete": has_authoritative_full and not history_gap,
        "history_complete": not history_gap,
        "unread_shards": list(unread),
        "rejected_filings": list(rejected),
        **(
            {}
            if has_authoritative_full and not history_gap
            else {
                # Name the reason(s) that ACTUALLY apply. A single catch-all
                # sentence denied the existence of a base filing the trail
                # itself reported as parsed — a wrong diagnosis contradicted by
                # the adjacent payload.
                "composition_warning": (
                    "this position list may NOT be the filer's complete"
                    " quarter-end book: "
                    + "; ".join(
                        incomplete_reasons
                        + ([
                            "the filer's history was searched INCOMPLETELY"
                            f" ({'; '.join(_parts)}), so an amendment for this"
                            " period may have been missed"
                        ] if history_gap else [])
                    )
                    + "."
                ),
                "incomplete_reasons": incomplete_reasons
                + (["history_search_incomplete"] if history_gap else []),
            }
        ),
        "live_source": {
            "source": "sec-edgar-live",
            "accession": filing.accession,
            "doc_url": filing.doc_url,
            "retrieved_at": ingested_at,
        },
    }


def resolve_ticker_to_issuer_key(
    sec_client: Any, ticker: str
) -> dict[str, Any] | None:
    """Resolve *ticker* → issuer CIK → ``issuer_key`` via SEC's cached
    ``company_tickers.json`` (a PRESENT-DAY mapping — labeled by the caller, G14).

    Returns ``{ticker, cik, entity_id, issuer_key, issuer_name, mapping_basis}``
    or ``None`` when the ticker is unusable or resolves to no issuer. The
    ``issuer_key`` is ``entity:<entity_id>``, matching the aggregate's resolved
    issuer keys (``agg_issuer_top_holders.issuer_key``).

    Raises whatever the SecClient raises (breaker/URL) and
    :class:`InstDetailUnavailable` on a non-200.
    """
    norm = normalize_ticker(ticker)
    if norm is None:
        return None
    response = sec_client.get(COMPANY_TICKERS_URL)
    if response.status_code != 200:
        raise InstDetailUnavailable(
            f"SEC returned HTTP {response.status_code} for company_tickers.json"
        )
    try:
        data = json.loads(response.content.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise InstDetailUnavailable(
            f"company_tickers.json did not parse: {exc}"
        ) from exc
    # The SAME dispositions the identity pipeline applies: malformed
    # rows, (cik,ticker) duplicates and DC1 title conflicts are decided by
    # `parse_company_tickers`, not re-derived here. Resolving a ticker the
    # pipeline REJECTED would mint an issuer_key the aggregate never keys, so
    # the two planes would silently disagree about the same symbol.
    try:
        rows, disposition = parse_company_tickers(data)
    except ValueError as exc:
        raise InstDetailUnavailable(
            f"company_tickers.json has an unusable shape: {exc}"
        ) from exc

    matches = [row for row in rows if row.ticker == norm]
    if not matches:
        if _ticker_appears_raw(data, norm):
            raise InstDetailUnavailable(
                f"{norm} appears in SEC's company_tickers.json but every row for"
                " it was rejected by the identity dispositions (a duplicate, or"
                " a DC1 title conflict: one CIK carrying two different names in"
                " one snapshot). Refusing to key an issuer the published"
                " aggregate does not key the same way."
            )
        return None
    if len({row.cik for row in matches}) > 1:
        # One symbol claimed by two CIKs — genuine ambiguity, never a guess (G3).
        raise InstDetailUnavailable(
            f"{norm} maps to more than one CIK in SEC's company_tickers.json"
            f" ({', '.join(sorted({row.cik for row in matches}))}); refusing to"
            " pick one. Ask by CIK with inst_filer_lookup / inst_filer_holdings."
        )
    row = matches[0]
    return {
        "ticker": norm,
        "cik": row.cik,
        "entity_id": row.entity_id,
        "issuer_key": f"entity:{row.entity_id}",
        "issuer_name": row.name,
        "mapping_basis": "sec-company-tickers (present-day)",
        # What the source file cost to accept — the caller can see that this
        # mapping came out of a snapshot with rejections, not a clean one.
        "source_dispositions": {
            "rows_read": disposition.rows_read,
            "accepted": disposition.accepted,
            "rejected_malformed": disposition.rejected_malformed,
            "rejected_duplicate": disposition.rejected_duplicate,
            "rejected_title_conflict": disposition.rejected_title_conflict,
        },
    }


def _ticker_appears_raw(data: object, norm: str) -> bool:
    """Whether *norm* occurs anywhere in the raw file — a MEMBERSHIP test only,
    used to tell "SEC does not list this symbol" apart from "SEC lists it but
    the identity dispositions rejected it". No disposition logic lives here."""
    entries = (
        list(data.values()) if isinstance(data, Mapping)
        else list(data) if isinstance(data, (list, tuple)) else []
    )
    return any(
        isinstance(e, Mapping) and normalize_ticker(e.get("ticker")) == norm
        for e in entries
    )
