"""Bulk 13F corpus: filer-universe discovery, ranking, resumable ingest.

RUN M2-6 (ARCHITECTURE.md §10.2). Gives the merged M2 pipeline its first real
institutional corpus for one explicitly budgeted quarter, as CODE only — the
operational overnight ingest runs post-merge, never in Dev/QA.

Three pieces sit here; a fourth (the ingest seam) is a default-inert extension
of :mod:`populus.ingest.inst13f`:

  * **Discovery** — the EDGAR quarterly ``form.idx`` fetched through the one
    sanctioned :class:`~populus.net.sec_client.SecClient` (no second HTTP
    client, no new dependency), parsed to 13F-HR/…A filing references bounded to
    a filing quarter.
  * **Ranking** — a per-filer effective cover value that **provably matches**
    the authoritative ``v_default_inst_filings`` restatement-survivor set
    (views.sql:55): a RESTATEMENT supersedes anything it out-orders by
    ``filed_date`` → ``amendment_no`` → ``accession``; a NEW_HOLDINGS amendment
    and the base both survive (their union is the merge). The value is the sum of
    ``table_value_total`` over survivors, USD-converted. Top-N filers each carry
    their **complete period lineage** (base + every amendment) as ingest targets,
    because ``link_inst_amendments`` orphans a restatement whose base is absent.
  * **Coordinator** — :func:`run_bulk_ingest` drives the extended M2-2 seam over
    one shared client, builds a **total per-accession outcome map** for every
    target, defers the global post-passes to a single finalize, and records
    measured transport + timing metrics. Resumable across crash and breaker via
    two versioned journals bound to the source-truth available when each is
    written (``refs_sha256`` / ``universe_sha256``).

Library code reads no wall clock or randomness: ``now`` / ``run_id`` / ``host``
/ ``monotonic`` are injected by the CLI, scripts, or tests.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from populus.identity.registry import normalize_cik
from populus.ingest import TransportResponse
from populus.ingest.inst13f import (
    _archive_base,
    finalize_inst_ingest,
    run_inst13f_ingest,
)
from populus.net.sec_client import SecCircuitOpenError, SecClient
from populus.normalize_inst import UNIT_MULTIPLIER, unit_basis_for
from populus.parse.inst13f import CoverParseError, parse_cover
from populus.publish import atomic_write_bytes

#: Only the two 13F holdings-report forms are ranked and ingested; a notice
#: (13F-NT) reports no holdings and no summary totals, so it never contributes a
#: coverage denominator and is out of scope for this run.
_FORM_13F_HR = frozenset({"13F-HR", "13F-HR/A"})
#: The accession + CIK inside a full-index filename, e.g.
#: ``edgar/data/1067983/0001067983-26-000123.txt``. Applied with ``fullmatch``
#: ONLY: an unanchored search would accept a corrupt path that merely CONTAINS a
#: valid-looking substring (``Xedgar/data/…/….txt.bak``) and admit it to the
#: universe with an invalid source path.
_INDEX_FILENAME_RE = re.compile(r"edgar/data/(\d+)/(\d{10}-\d{2}-\d{6})\.txt")
_FILING_QUARTER_RE = re.compile(r"(\d{4})q([1-4])")
_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

#: The only status whose body is a document. ``SecClient`` collapses an
#: in-memory cache hit and a 304 revalidation back to the cached 200 response,
#: so 200 is the COMPLETE acceptable set; every other status that reaches a
#: caller — a 403 below the breaker threshold, a 404, or a 5xx that exhausted
#: the backoff schedule — is a RETRYABLE TRANSPORT FAILURE, never content.
_ACCEPTABLE_STATUS = 200


class SecStatusError(RuntimeError):
    """A SEC response that is not a document (F1).

    Raised BEFORE any decode or parse, so a transport failure can never be
    mistaken for source truth: a failed index fetch must not become an empty
    universe, and a failed cover fetch must not become a terminal journaled
    ``cover_failed``. It propagates to the caller, which retries the whole
    fetch on a later run — exactly like ``SecCircuitOpenError``, which stops the
    sweep rather than freezing a transient refusal into durable state.
    """

    def __init__(self, url: str, status_code: int) -> None:
        super().__init__(
            f"SEC returned HTTP {status_code} for {url}: a retryable transport"
            " failure, not a document — nothing is parsed or journaled from it."
        )
        self.url = url
        self.status_code = status_code


def _require_document(response, url: str) -> None:
    """Assert an acceptable status BEFORE decoding or parsing a response (F1)."""
    if response.status_code != _ACCEPTABLE_STATUS:
        raise SecStatusError(url, response.status_code)


def _is_iso_date(value: str) -> bool:
    if not _ISO_DATE_RE.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


# --- discovery (R1/R2/R12) ---------------------------------------------------


@dataclass(frozen=True)
class FormIndexRef:
    """One 13F filing reference from the quarterly full index."""

    cik: str                 # 10-digit, zero-padded
    accession: str           # dashed
    accession_nodash: str
    form: str                # 13F-HR / 13F-HR/A
    filed_date: str          # ISO, from the index "Date Filed" column


@dataclass(frozen=True)
class DiscoveryResult:
    filing_quarter: str
    url: str
    refs: tuple[FormIndexRef, ...]
    #: Data lines whose form was 13F-HR/…A but whose filename or date would not
    #: parse — counted, never silently dropped (G3). Non-13F lines are simply
    #: out of scope and are not rejects.
    rejected: tuple[str, ...]


def _form_index_url(filing_quarter: str) -> str:
    """The quarterly ``form.idx`` URL for a ``YYYYqN`` filing quarter (LD-1).

    ``master.idx`` is the documented fallback (same directory, CIK-sorted); this
    run reads ``form.idx`` because it is grouped by form type.
    """
    match = _FILING_QUARTER_RE.fullmatch(filing_quarter)
    if match is None:
        raise ValueError(f"filing_quarter {filing_quarter!r} is not YYYYqN")
    year, quarter = match.group(1), match.group(2)
    return (
        f"https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{quarter}/form.idx"
    )


def parse_form_index(text: str) -> tuple[list[FormIndexRef], list[str]]:
    """Parse an EDGAR ``form.idx`` into 13F-HR/…A references (R2/TD-M2-6-3).

    The header is skipped to the dashed rule; each data line is tokenized on
    whitespace with a fixed invariant (``form = tokens[0]``, ``filename =
    tokens[-1]``, ``filed = tokens[-2]``) — robust because a form type, an ISO
    date, and an ``edgar/data/...`` path never contain spaces, while the company
    name (the only free-text column, in the middle) may. The ``(cik, accession)``
    pair is derived by strict regex; a malformed 13F line is a counted reject.

    The FORM IS IDENTIFIED FIRST, before any structural check: a 13F row too
    short to carry its date and filename columns is a CORRUPT 13F record and
    must be counted in ``rejected``, not silently skipped — a silent skip would
    delete it from the rejection metrics the run reconciles against (F2). A
    non-13F row is out of scope and is dropped without being a reject.
    """
    refs: list[FormIndexRef] = []
    rejected: list[str] = []
    started = False
    for line in text.splitlines():
        if not started:
            stripped = line.strip()
            if stripped and set(stripped) == {"-"}:
                started = True
            continue
        if not line.strip():
            continue
        tokens = line.split()
        form = tokens[0]
        if form not in _FORM_13F_HR:
            continue
        if len(tokens) < 4:
            # A 13F row missing columns — counted, never silently skipped.
            rejected.append(line.strip())
            continue
        filed = tokens[-2]
        filename = tokens[-1]
        # fullmatch, never search: a prefixed or suffixed path is corrupt, and an
        # unanchored search would admit it with an invalid source path.
        match = _INDEX_FILENAME_RE.fullmatch(filename)
        if match is None or not _is_iso_date(filed):
            rejected.append(line.strip())
            continue
        cik10 = normalize_cik(match.group(1))
        if cik10 is None:
            rejected.append(line.strip())
            continue
        accession = match.group(2)
        refs.append(
            FormIndexRef(
                cik=cik10,
                accession=accession,
                accession_nodash=accession.replace("-", ""),
                form=form,
                filed_date=filed,
            )
        )
    return refs, rejected


def discover_universe(client: SecClient, filing_quarter: str) -> DiscoveryResult:
    """Fetch and parse the quarterly form index through the SecClient (R1).

    A non-200 index response propagates as :class:`SecStatusError` BEFORE the
    body is decoded (F1): a 403/404/5xx body is not an index, and decoding it
    would turn a transient SEC failure into an EMPTY universe — silently
    removing every filer from the run.
    """
    url = _form_index_url(filing_quarter)
    response = client.get(url)
    _require_document(response, url)
    text = response.content.decode("utf-8", errors="replace")
    refs, rejected = parse_form_index(text)
    return DiscoveryResult(
        filing_quarter=filing_quarter,
        url=url,
        refs=tuple(refs),
        rejected=tuple(rejected),
    )


# --- ranking (R3/R2/R4) — matches v_default_inst_filings stage 1 -------------


@dataclass(frozen=True)
class _CoverFacts:
    period_of_report: str | None
    table_value_total: int | None
    value_usd: int | None
    amendment_type: str | None
    amendment_no: int | None
    cover_failed: bool

    def as_dict(self) -> dict:
        return {
            "period_of_report": self.period_of_report,
            "table_value_total": self.table_value_total,
            "value_usd": self.value_usd,
            "amendment_type": self.amendment_type,
            "amendment_no": self.amendment_no,
            "cover_failed": self.cover_failed,
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> _CoverFacts:
        return cls(
            period_of_report=d.get("period_of_report"),
            table_value_total=d.get("table_value_total"),
            value_usd=d.get("value_usd"),
            amendment_type=d.get("amendment_type"),
            amendment_no=d.get("amendment_no"),
            cover_failed=bool(d.get("cover_failed")),
        )


@dataclass(frozen=True)
class RankedFiler:
    rank: int
    cik: str
    effective_value_usd: int
    period_of_report: str
    lineage: tuple[str, ...]     # complete period lineage = ingest target set


@dataclass(frozen=True)
class RankResult:
    ranked: tuple[RankedFiler, ...]      # every eligible filer, value ↓
    rank_failed: tuple[str, ...]         # CIKs excluded for an unparseable cover
    refs_sha256: str


def _out_orders(restatement: Mapping, other: Mapping) -> bool:
    """Whether a RESTATEMENT out-orders (supersedes) another filing — the exact
    ordering of ``v_default_inst_filings`` (views.sql:65-70)."""
    if restatement["filed_date"] > other["filed_date"]:
        return True
    if restatement["filed_date"] == other["filed_date"]:
        r_no = restatement["amendment_no"] or 0
        o_no = other["amendment_no"] or 0
        if r_no > o_no:
            return True
        if r_no == o_no and restatement["accession"] > other["accession"]:
            return True
    return False


def _restatement_survivors(filings: Sequence[Mapping]) -> list[Mapping]:
    """The stage-1 survivor set of ``v_default_inst_filings`` (views.sql:56-71):
    a filing survives unless some RESTATEMENT for the same (cik, period)
    out-orders it. With no restatement the base + every NEW_HOLDINGS amendment
    survive (their union is the merge)."""
    restatements = [f for f in filings if f["amendment_type"] == "RESTATEMENT"]
    survivors: list[Mapping] = []
    for f in filings:
        superseded = any(
            r["accession"] != f["accession"] and _out_orders(r, f)
            for r in restatements
        )
        if not superseded:
            survivors.append(f)
    return survivors


def refs_sha256(refs: Sequence[FormIndexRef], report_period: str) -> str:
    """Canonical digest binding the rank journal: the discovered references plus
    the ranking params, all available at sweep time (R17)."""
    canonical = {
        "report_period": report_period,
        "refs": sorted(
            [r.cik, r.accession, r.form, r.filed_date] for r in refs
        ),
    }
    return _digest(canonical)


def _digest(obj) -> str:
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _cover_url(ref: FormIndexRef) -> str:
    return f"{_archive_base(ref.cik, ref.accession_nodash)}/primary_doc.xml"


def _fetch_cover_facts(client: SecClient, ref: FormIndexRef) -> _CoverFacts:
    """Fetch and parse one filing's cover for ranking. A cover that will not
    parse (or a holdings report missing its total) yields ``cover_failed`` — the
    filer is excluded from ranking, and the sweep never aborts (F-sweep). A
    breaker trip propagates (the sweep must stop, not push harder).

    ``cover_failed`` is a statement about the DOCUMENT, so an acceptable status
    is required before the body is parsed (F1). A 403/404/5xx is a retryable
    transport failure: it raises :class:`SecStatusError`, which propagates out of
    the sweep instead of being journaled — otherwise a transient refusal would
    freeze into a terminal ``cover_failed`` that a resumed run never refetches.
    """
    url = _cover_url(ref)
    response = client.get(url)
    _require_document(response, url)
    try:
        cover = parse_cover(response.content)
    except CoverParseError:
        return _CoverFacts(None, None, None, None, None, cover_failed=True)
    value_usd: int | None = None
    if cover.table_value_total is not None:
        value_usd = cover.table_value_total * UNIT_MULTIPLIER[
            unit_basis_for(ref.filed_date)
        ]
    return _CoverFacts(
        period_of_report=cover.period_of_report,
        table_value_total=cover.table_value_total,
        value_usd=value_usd,
        amendment_type=cover.amendment_type,
        amendment_no=cover.amendment_no,
        cover_failed=False,
    )


def rank_universe(
    client: SecClient,
    refs: Sequence[FormIndexRef],
    report_period: str,
    *,
    journal_path: Path | None = None,
    flush_every: int = 25,
) -> RankResult:
    """Rank filers by effective survivor value (R3), resumable via the rank
    journal (bound to ``refs_sha256``).

    Each candidate cover is fetched once; covers whose ``period_of_report`` is
    not the locked report period are dropped. Filings are grouped by CIK and the
    stage-1 restatement-survivor set is computed with the identical ordering to
    the view, then summed to a USD effective value. A CIK with ANY unparseable
    cover is excluded (``rank_failed``) rather than misranked on a partial value.

    A TRANSPORT failure is not a ranking outcome: a non-200 cover response raises
    :class:`SecStatusError` (and a latched breaker :class:`SecCircuitOpenError`)
    out of this sweep with nothing journaled for that accession, so the resumed
    sweep refetches it instead of ranking on a frozen ``cover_failed`` (F1).
    """
    digest = refs_sha256(refs, report_period)
    facts: dict[str, _CoverFacts] = {}
    if journal_path is not None:
        doc = load_journal(
            journal_path,
            expected_kind="rank",
            binding_field="refs_sha256",
            binding_value=digest,
        )
        facts = {k: _CoverFacts.from_dict(v) for k, v in doc.entries.items()}

    pending = 0
    for ref in refs:
        if ref.accession in facts:
            continue
        try:
            fact = _fetch_cover_facts(client, ref)
        except BaseException:
            # A transport failure (non-200, or the breaker latching) is NOT a
            # result for this accession — nothing is recorded for it, so a
            # resumed sweep refetches it. Flush the covers that DID parse first,
            # so the resume keeps that work, then propagate (F1).
            if journal_path is not None and pending:
                _write_rank_journal(journal_path, digest, facts)
            raise
        facts[ref.accession] = fact
        pending += 1
        if journal_path is not None and pending >= flush_every:
            _write_rank_journal(journal_path, digest, facts)
            pending = 0
    if journal_path is not None and pending:
        _write_rank_journal(journal_path, digest, facts)

    by_cik: dict[str, list[tuple[FormIndexRef, _CoverFacts]]] = defaultdict(list)
    cover_failed_ciks: set[str] = set()
    for ref in refs:
        fact = facts[ref.accession]
        if fact.cover_failed:
            cover_failed_ciks.add(ref.cik)
        by_cik[ref.cik].append((ref, fact))

    eligible: list[RankedFiler] = []
    for cik, items in by_cik.items():
        if cik in cover_failed_ciks:
            continue
        period_items = [
            (ref, fact) for ref, fact in items
            if fact.period_of_report == report_period
        ]
        if not period_items:
            continue
        filings = [
            {
                "accession": ref.accession,
                "filed_date": ref.filed_date,
                "amendment_no": fact.amendment_no,
                "amendment_type": fact.amendment_type,
                "value_usd": fact.value_usd or 0,
            }
            for ref, fact in period_items
        ]
        survivors = _restatement_survivors(filings)
        effective = sum(f["value_usd"] for f in survivors)
        lineage = tuple(sorted(ref.accession for ref, _ in period_items))
        eligible.append(
            RankedFiler(
                rank=0,
                cik=cik,
                effective_value_usd=effective,
                period_of_report=report_period,
                lineage=lineage,
            )
        )
    eligible.sort(key=lambda r: (-r.effective_value_usd, r.cik))
    ranked = tuple(
        RankedFiler(
            rank=i + 1,
            cik=r.cik,
            effective_value_usd=r.effective_value_usd,
            period_of_report=r.period_of_report,
            lineage=r.lineage,
        )
        for i, r in enumerate(eligible)
    )
    return RankResult(
        ranked=ranked,
        rank_failed=tuple(sorted(cover_failed_ciks)),
        refs_sha256=digest,
    )


def _write_rank_journal(
    path: Path, digest: str, facts: Mapping[str, _CoverFacts]
) -> None:
    write_journal(
        path,
        kind="rank",
        binding_field="refs_sha256",
        binding_value=digest,
        entries={acc: fact.as_dict() for acc, fact in facts.items()},
    )


# --- universe (R2/R17) -------------------------------------------------------


@dataclass(frozen=True)
class Universe:
    filing_quarter: str
    report_period: str
    top_n: int
    entries: tuple[RankedFiler, ...]
    universe_sha256: str

    @property
    def ciks(self) -> tuple[str, ...]:
        return tuple(e.cik for e in self.entries)


def _universe_body(
    filing_quarter: str,
    report_period: str,
    top_n: int,
    entries: Sequence[RankedFiler],
) -> dict:
    return {
        "filing_quarter": filing_quarter,
        "report_period": report_period,
        "top_n": top_n,
        "entries": [
            {
                "rank": e.rank,
                "cik": e.cik,
                "effective_value_usd": e.effective_value_usd,
                "period_of_report": e.period_of_report,
                "lineage": list(e.lineage),
            }
            for e in entries
        ],
    }


def select_top_n(
    rank_result: RankResult,
    filing_quarter: str,
    report_period: str,
    top_n: int,
) -> Universe:
    """Take the top-N ranked filers and bind the universe to its digest (R4)."""
    chosen = rank_result.ranked[:top_n]
    entries = tuple(
        RankedFiler(
            rank=i + 1,
            cik=r.cik,
            effective_value_usd=r.effective_value_usd,
            period_of_report=r.period_of_report,
            lineage=r.lineage,
        )
        for i, r in enumerate(chosen)
    )
    body = _universe_body(filing_quarter, report_period, top_n, entries)
    return Universe(
        filing_quarter=filing_quarter,
        report_period=report_period,
        top_n=top_n,
        entries=entries,
        universe_sha256=_digest(body),
    )


def write_universe(path: Path, universe: Universe) -> None:
    """Durably persist the universe with its self-describing digest (R17)."""
    body = _universe_body(
        universe.filing_quarter,
        universe.report_period,
        universe.top_n,
        universe.entries,
    )
    payload = {**body, "universe_sha256": universe.universe_sha256}
    atomic_write_bytes(
        Path(path), (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    )


class UniverseError(ValueError):
    """A universe file is corrupt or its stored digest does not match its body."""


def load_universe(path: Path) -> Universe:
    """Read and verify a universe file (digest recomputed and checked)."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise UniverseError(f"universe {path} is unreadable: {exc}") from exc
    try:
        entries = tuple(
            RankedFiler(
                rank=e["rank"],
                cik=e["cik"],
                effective_value_usd=e["effective_value_usd"],
                period_of_report=e["period_of_report"],
                lineage=tuple(e["lineage"]),
            )
            for e in payload["entries"]
        )
        body = _universe_body(
            payload["filing_quarter"],
            payload["report_period"],
            payload["top_n"],
            entries,
        )
        stored = payload["universe_sha256"]
    except (KeyError, TypeError) as exc:
        raise UniverseError(f"universe {path} is malformed: {exc}") from exc
    recomputed = _digest(body)
    if recomputed != stored:
        raise UniverseError(
            f"universe {path} digest mismatch: stored {stored},"
            f" recomputed {recomputed}"
        )
    return Universe(
        filing_quarter=payload["filing_quarter"],
        report_period=payload["report_period"],
        top_n=payload["top_n"],
        entries=entries,
        universe_sha256=stored,
    )


# --- versioned journals (R17) ------------------------------------------------

JOURNAL_VERSION = 1


class JournalError(ValueError):
    """A journal is corrupt, an unknown version, duplicated, or mis-bound."""


@dataclass(frozen=True)
class JournalDoc:
    entries: dict
    meta: dict


def write_journal(
    path: Path,
    *,
    kind: str,
    binding_field: str,
    binding_value: str,
    entries: Mapping,
    meta: Mapping | None = None,
) -> None:
    """Durably (re)write a versioned journal via ``atomic_write_bytes`` (R17).

    The whole envelope is rewritten each time — there is no bespoke append
    primitive. Entries are stored as an explicit key/value list so a duplicate
    key is DETECTABLE on load (a plain object would silently dedup).
    """
    payload = {
        "version": JOURNAL_VERSION,
        "kind": kind,
        "binding": {binding_field: binding_value},
        "meta": dict(meta or {}),
        "entries": [{"key": k, "value": v} for k, v in entries.items()],
    }
    atomic_write_bytes(
        Path(path), (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    )


def load_journal(
    path: Path,
    *,
    expected_kind: str,
    binding_field: str,
    binding_value: str,
) -> JournalDoc:
    """Load a journal, rejecting corrupt / unknown-version / duplicate /
    mis-bound envelopes. A missing file is an empty journal (fresh start)."""
    path = Path(path)
    if not path.exists():
        return JournalDoc(entries={}, meta={})
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise JournalError(f"journal {path} is corrupt: {exc}") from exc
    if not isinstance(doc, dict):
        raise JournalError(f"journal {path} is corrupt: not an object")
    if doc.get("version") != JOURNAL_VERSION:
        raise JournalError(
            f"journal {path} has unknown version {doc.get('version')!r}"
            f" (this build writes {JOURNAL_VERSION})"
        )
    if doc.get("kind") != expected_kind:
        raise JournalError(
            f"journal {path} is a {doc.get('kind')!r} journal, expected"
            f" {expected_kind!r}"
        )
    binding = doc.get("binding") or {}
    if binding.get(binding_field) != binding_value:
        raise JournalError(
            f"journal {path} is bound to {binding_field}"
            f"={binding.get(binding_field)!r}, not the expected"
            f" {binding_value!r} — the source truth changed underneath it"
        )
    entries: dict = {}
    for item in doc.get("entries", []):
        key = item["key"]
        if key in entries:
            raise JournalError(f"journal {path} has a duplicate entry {key!r}")
        entries[key] = item["value"]
    meta = doc.get("meta") or {}
    return JournalDoc(entries=entries, meta=meta)


# --- measured transport (R14) ------------------------------------------------


class CountingTransport:
    """Wraps the sanctioned transport to count real transport (R14/F5).

    ``attempts`` is every request that left this process (retries included);
    ``retries`` are the ones SEC answered 429/5xx (each triggering a backoff);
    ``not_modified`` are 304s. In-memory dedup is separate — it is
    ``SecClient.cache_hits`` — and durable per-document resume shows up as fewer
    attempts, not as a cache hit. No HTTP library is imported here.
    """

    def __init__(self, inner) -> None:
        self._inner = inner
        self.attempts = 0
        self.status_counts: Counter = Counter()

    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse:
        self.attempts += 1
        response = self._inner.get(url, headers=headers)
        self.status_counts[response.status_code] += 1
        return response

    @property
    def retries(self) -> int:
        return sum(
            count
            for status, count in self.status_counts.items()
            if status == 429 or 500 <= status <= 599
        )

    @property
    def not_modified(self) -> int:
        return self.status_counts.get(304, 0)


def _metrics_snapshot(
    transport: CountingTransport,
    client: SecClient,
    *,
    elapsed: float,
    breaker_events: int,
) -> dict:
    return {
        "attempts": transport.attempts,
        "retries": transport.retries,
        "not_modified": transport.not_modified,
        "cache_hits": client.cache_hits,
        "elapsed": elapsed,
        "breaker_events": breaker_events,
        "sessions": 1,
    }


def _accumulate_metrics(cumulative: Mapping, session: Mapping) -> dict:
    keys = ("attempts", "retries", "not_modified", "cache_hits", "elapsed",
            "breaker_events", "sessions")
    return {k: (cumulative.get(k, 0) + session.get(k, 0)) for k in keys}


# --- coordinator (R5/R6/R14/R16/R17) -----------------------------------------

#: Dispositions considered terminal for a filer — a resume run skips them
#: (``already-done``). ``circuit_open`` / ``pending`` / ``ingest_error`` are
#: retryable, so a resumed run re-attempts them.
_TERMINAL_PREFIXES = ("loaded", "failed:")


@dataclass(frozen=True)
class FilerResult:
    rank: int
    cik: str
    disposition: str                    # loaded | failed:<kind> | already-done |
    #                                     circuit_open | pending | ingest_error:*
    per_accession: dict                 # accession -> parsed|partial|failed:*|
    #                                     absent|period_mismatch
    holdings_loaded: int = 0
    prior_disposition: str | None = None  # set for an already-done skip

    @property
    def parsed_count(self) -> int:
        return sum(
            1 for s in self.per_accession.values() if s in ("parsed", "partial")
        )


@dataclass
class BulkReport:
    run_id: str
    filing_quarter: str
    report_period: str
    universe_size: int
    results: list[FilerResult] = field(default_factory=list)
    session_metrics: dict = field(default_factory=dict)
    cumulative_metrics: dict = field(default_factory=dict)
    finalized: bool = False
    circuit_open_url: str | None = None
    coverage: object = None
    invariant_errors: tuple[str, ...] = ()

    @property
    def disposition_counts(self) -> Counter:
        counts: Counter = Counter()
        for result in self.results:
            counts[_disposition_bucket(result.disposition)] += 1
        return counts

    @property
    def reconciled(self) -> bool:
        return len(self.results) == self.universe_size

    @property
    def loaded_filers(self) -> int:
        return sum(1 for r in self.results if r.disposition == "loaded")

    @property
    def holdings_loaded(self) -> int:
        return sum(r.holdings_loaded for r in self.results)

    @property
    def ok(self) -> bool:
        """A clean bulk run: every universe CIK accounted for, the breaker never
        latched, the single finalize ran, and no unexpected ingest error. A
        ``failed:partial_lineage`` filer is an ACCOUNTED per-filer outcome (like
        a cover-failed filing at M2-2), surfaced in the summary, not a run
        failure."""
        if not self.reconciled or not self.finalized:
            return False
        if self.circuit_open_url is not None:
            return False
        return not any(
            r.disposition.startswith("ingest_error:") for r in self.results
        )


def _disposition_bucket(disposition: str) -> str:
    if disposition.startswith("failed:"):
        return "failed"
    if disposition.startswith("ingest_error:"):
        return "ingest_error"
    return disposition


def _classify_disposition(per_accession: Mapping[str, str]) -> str:
    """The locked completeness rule (R6): ``loaded`` iff every target accession
    parsed/partial; else ``failed:<kind>`` where a mixed/incomplete lineage is
    ``partial_lineage`` and an all-failed lineage carries its dominant kind."""
    total = len(per_accession)
    ok = sum(1 for s in per_accession.values() if s in ("parsed", "partial"))
    if total and ok == total:
        return "loaded"
    if ok > 0:
        # Some of the lineage landed and some did not — the base or an amendment
        # is missing, so the merged period is incomplete.
        return "failed:partial_lineage"
    labels = [_failure_label(s) for s in per_accession.values()]
    dominant = Counter(labels).most_common(1)[0][0] if labels else "partial_lineage"
    return f"failed:{dominant}"


def _failure_label(status: str) -> str:
    if status.startswith("failed:"):
        return status.split(":", 1)[1]
    return status  # absent | period_mismatch


def run_bulk_ingest(
    conn,
    universe: Universe,
    *,
    client: SecClient,
    transport: CountingTransport,
    raw_root: Path | str,
    run_id: str,
    now: Callable[[], str],
    host: str,
    ingested_at: str,
    monotonic: Callable[[], float],
    journal_path: Path | None = None,
) -> BulkReport:
    """Drive the extended M2-2 seam over the ranked universe, resumably (R5/R6).

    One shared ``SecClient`` (client-wide floor + breaker) over one
    ``CountingTransport``; each filer's complete lineage is loaded through
    ``run_inst13f_ingest(run_passes=False, resume=True)``; a total per-accession
    outcome map is built for every target; the global post-passes are deferred
    to a single :func:`finalize_inst_ingest`. The per-CIK outcome map and the
    measured metrics are journaled (bound to ``universe_sha256``) after every
    filer, so a crash or breaker trip resumes without re-fetching durable bytes.
    """
    raw_root = Path(raw_root)
    prior = (
        load_journal(
            journal_path,
            expected_kind="ingest",
            binding_field="universe_sha256",
            binding_value=universe.universe_sha256,
        )
        if journal_path is not None
        else JournalDoc(entries={}, meta={})
    )
    done: dict = dict(prior.entries)
    cumulative_before = prior.meta.get("metrics", {})

    report = BulkReport(
        run_id=run_id,
        filing_quarter=universe.filing_quarter,
        report_period=universe.report_period,
        universe_size=len(universe.entries),
    )
    session_start = monotonic()
    circuit_stopped = False

    for filer in universe.entries:
        recorded = done.get(filer.cik)
        if (
            recorded is not None
            and str(recorded.get("disposition", "")).startswith(_TERMINAL_PREFIXES)
        ):
            report.results.append(
                FilerResult(
                    rank=filer.rank,
                    cik=filer.cik,
                    disposition="already-done",
                    per_accession=dict(recorded.get("per_accession", {})),
                    holdings_loaded=int(recorded.get("holdings_loaded", 0)),
                    prior_disposition=recorded.get("disposition"),
                )
            )
            continue
        if circuit_stopped:
            report.results.append(
                FilerResult(
                    rank=filer.rank, cik=filer.cik, disposition="pending",
                    per_accession={acc: "pending" for acc in filer.lineage},
                )
            )
            continue

        targets = frozenset(filer.lineage)
        try:
            filer_rep = run_inst13f_ingest(
                conn,
                run_id=f"{run_id}:{filer.cik}",
                now=now,
                host=host,
                ingested_at=ingested_at,
                ciks=[filer.cik],
                accessions=targets,
                report_period=universe.report_period,
                run_passes=False,
                resume=True,
                client=client,
                raw_root=raw_root,
            )
        except SecCircuitOpenError as exc:
            circuit_stopped = True
            report.circuit_open_url = exc.url
            result = FilerResult(
                rank=filer.rank, cik=filer.cik, disposition="circuit_open",
                per_accession={acc: "pending" for acc in filer.lineage},
            )
            report.results.append(result)
            done[filer.cik] = _result_record(result)
            continue
        except Exception as exc:  # noqa: BLE001 — one filer's error must not abort
            result = FilerResult(
                rank=filer.rank, cik=filer.cik,
                disposition=f"ingest_error:{type(exc).__name__}",
                per_accession={acc: "error" for acc in filer.lineage},
            )
            report.results.append(result)
            done[filer.cik] = _result_record(result)
            if journal_path is not None:
                _persist_ingest_journal(
                    journal_path, universe, done, cumulative_before,
                    transport, client, monotonic, session_start,
                    breaker_events=0,
                )
            continue

        if filer_rep.circuit_open_url is not None:
            # The breaker latched mid-filer: whatever loaded is real, the rest is
            # unreached. STOP the run; this filer is circuit_open (retryable).
            circuit_stopped = True
            report.circuit_open_url = filer_rep.circuit_open_url
            per = _per_accession_map(targets, filer_rep)
            result = FilerResult(
                rank=filer.rank, cik=filer.cik, disposition="circuit_open",
                per_accession=per, holdings_loaded=filer_rep.rows_loaded,
            )
            report.results.append(result)
            done[filer.cik] = _result_record(result)
            continue

        per = _per_accession_map(targets, filer_rep)
        result = FilerResult(
            rank=filer.rank,
            cik=filer.cik,
            disposition=_classify_disposition(per),
            per_accession=per,
            holdings_loaded=filer_rep.rows_loaded,
        )
        report.results.append(result)
        done[filer.cik] = _result_record(result)
        if journal_path is not None:
            _persist_ingest_journal(
                journal_path, universe, done, cumulative_before,
                transport, client, monotonic, session_start,
                breaker_events=0,
            )

    breaker_events = 1 if report.circuit_open_url is not None else 0
    if not circuit_stopped:
        finalize = finalize_inst_ingest(conn)
        report.finalized = True
        report.coverage = finalize.coverage
        report.invariant_errors = finalize.invariant_errors

    report.session_metrics = _metrics_snapshot(
        transport, client,
        elapsed=monotonic() - session_start,
        breaker_events=breaker_events,
    )
    report.cumulative_metrics = _accumulate_metrics(
        cumulative_before, report.session_metrics
    )
    if journal_path is not None:
        _persist_ingest_journal(
            journal_path, universe, done, cumulative_before,
            transport, client, monotonic, session_start,
            breaker_events=breaker_events,
        )
    return report


def _per_accession_map(targets: frozenset[str], report) -> dict:
    """A TOTAL outcome for every target accession (R6): each is ``parsed`` /
    ``partial`` / ``failed:<kind>`` / ``period_mismatch`` / ``absent`` — the last
    for a target that never appeared in the filer's submissions history."""
    observed: dict[str, str] = {}
    for row in report.filings:
        status = row["status"]
        if status == "failed" and row.get("failure_kind"):
            status = f"failed:{row['failure_kind']}"
        observed[row["accession"]] = status
    mismatched = set(report.period_mismatched)
    per: dict[str, str] = {}
    for accession in sorted(targets):
        if accession in observed:
            per[accession] = observed[accession]
        elif accession in mismatched:
            per[accession] = "period_mismatch"
        else:
            per[accession] = "absent"
    return per


def _result_record(result: FilerResult) -> dict:
    return {
        "rank": result.rank,
        "disposition": result.disposition,
        "per_accession": result.per_accession,
        "holdings_loaded": result.holdings_loaded,
    }


def _persist_ingest_journal(
    journal_path: Path,
    universe: Universe,
    done: Mapping,
    cumulative_before: Mapping,
    transport: CountingTransport,
    client: SecClient,
    monotonic: Callable[[], float],
    session_start: float,
    *,
    breaker_events: int,
) -> None:
    session = _metrics_snapshot(
        transport, client,
        elapsed=monotonic() - session_start,
        breaker_events=breaker_events,
    )
    meta = {"metrics": _accumulate_metrics(cumulative_before, session)}
    write_journal(
        journal_path,
        kind="ingest",
        binding_field="universe_sha256",
        binding_value=universe.universe_sha256,
        entries=done,
        meta=meta,
    )


# --- summary -----------------------------------------------------------------


def format_bulk_summary(report: BulkReport) -> str:
    """One-screen reconciliation + measured metrics the CLI prints (R14)."""
    counts = report.disposition_counts
    lines = [
        "inst-bulk"
        f" | quarter {report.filing_quarter}"
        f" | period {report.report_period}"
        f" | universe {report.universe_size}"
        f" | loaded {counts.get('loaded', 0)}"
        f" | failed {counts.get('failed', 0)}"
        f" | already-done {counts.get('already-done', 0)}"
        f" | pending {counts.get('pending', 0)}"
        f" | circuit_open {counts.get('circuit_open', 0)}"
        f" | ingest_error {counts.get('ingest_error', 0)}"
        f" | holdings {report.holdings_loaded}",
        "reconciled:"
        f" {len(report.results)} dispositions vs {report.universe_size} universe"
        f" -> {'ok' if report.reconciled else 'MISMATCH'}",
    ]
    session = report.session_metrics
    cumulative = report.cumulative_metrics
    if session:
        lines.append(
            "metrics(session):"
            f" attempts {session['attempts']}"
            f" | retries {session['retries']}"
            f" | 304s {session['not_modified']}"
            f" | cache_hits {session['cache_hits']}"
            f" | elapsed {session['elapsed']:.3f}"
            f" | breaker_events {session['breaker_events']}"
        )
    if cumulative:
        lines.append(
            "metrics(cumulative):"
            f" attempts {cumulative['attempts']}"
            f" | retries {cumulative['retries']}"
            f" | 304s {cumulative['not_modified']}"
            f" | cache_hits {cumulative['cache_hits']}"
            f" | sessions {cumulative['sessions']}"
        )
    coverage = report.coverage
    if coverage is not None:
        pct = (
            f"{coverage.coverage * 100:.2f}%"
            if coverage.coverage is not None
            else "N/A"
        )
        lines.append(
            "value-coverage:"
            f" {coverage.numerator} / {coverage.denominator} = {pct}"
            f" | meets gate {'yes' if coverage.meets_threshold else 'no'}"
        )
    if report.circuit_open_url is not None:
        lines.append(
            f"  CIRCUIT OPEN: last at {report.circuit_open_url} — run stopped,"
            " resume after diagnosing the request shape (G6)"
        )
    for result in report.results:
        if result.disposition != "loaded":
            lines.append(
                f"  rank {result.rank} | CIK{result.cik} | {result.disposition}"
                f" | {result.parsed_count}/{len(result.per_accession)} lineage"
            )
    return "\n".join(lines)
