"""House Clerk PTR ingest pipeline (ARCHITECTURE.md §9.2; RUN 2).

One of the two Populus modules that talk to the network — this one and its
Senate sibling ``populus.ingest.senate`` are the only modules allowed to
import ``httpx``. Owns discovery (conditional-GET index ZIP), polite
sequential fetching (floors in code, never config — G6), raw archiving,
classification/parse/normalize orchestration, the single filing-status
decision point, atomic loads, the per-run ``ingest_runs`` audit lifecycle
(R15), completeness reconciliation (R12/G3), and archive-safe reparse (R19).

Library code never reads the wall clock: ``now``/``run_id``/``host`` and the
live-path ``sleep``/``monotonic`` are supplied by the CLI layer.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import sqlite3
import zipfile
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Protocol

from lxml import etree

from populus.amendments import flag_unresolved_pair_rows
from populus.ingest import (
    USER_AGENT,
    FetchMetrics,
    TransportResponse,
    UnsafeArchivePathError,
    archive_path as _archive_path,
)
from populus.ingest.checkpoint import (
    archive_verified,
    commit_checkpoint,
    read_checkpoint,
    read_provenance,
    sha256_hex,
)
from populus.load import ParsedRow, load_filing, upsert_filing
from populus.normalize import (
    NORMALIZATION_VERSION,
    has_parse_defect,
    normalize_row,
)
from populus.parse.house_ptr import (
    PARSER_VERSION,
    EmptyParseError,
    UnreadablePdfError,
    classify,
    parse_ptr,
)
from populus.parse_gate import ParseGateReport, format_gate_report
from populus.publish import atomic_write_bytes

MIN_SPACING_S = 0.25
BACKOFF_SCHEDULE = (1.0, 2.0, 4.0)

INDEX_URL_TEMPLATE = (
    "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"
)
DOC_URL_TEMPLATE = (
    "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"
)


def default_years(today: date) -> list[int]:
    """Current year, plus the previous year through January (R18/LD1)."""
    if today.month == 1:
        return [today.year, today.year - 1]
    return [today.year]


# --- transport ---------------------------------------------------------------


class Transport(Protocol):
    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse: ...


class HttpxTransport:
    """The real HTTP client; constructed only by the CLI's live path."""

    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse:
        import httpx

        response = httpx.get(url, headers=dict(headers), timeout=60.0)
        return TransportResponse(
            status_code=response.status_code,
            headers=dict(response.headers),
            content=response.content,
        )


class _PoliteFetcher:
    """Sequential fetch with the G6 politeness floors baked into code.

    >= ``MIN_SPACING_S`` between consecutive fetches; exponential backoff
    per ``BACKOFF_SCHEDULE`` on 429 AND 5xx; 404 (and any other status) is
    permanent. Exhausted retries return the final failing response — the
    caller records the failure, never papers over it.

    Counts its own work (RUN M1-B, R20/LD13), in the shape
    :class:`populus.inst_bulk.CountingTransport` established: ``attempts`` is
    every request that left this process (retries included), ``status_counts``
    the answered status mix, ``retries`` the derived count of 429/5xx answers
    that actually triggered a backoff, and ``backoff_sleep_s`` the seconds
    slept in those backoffs. The counters live HERE rather than in a transport
    wrapper because this loop is the only place that can tell a backoff retry
    apart from a fresh request — which is exactly the figure Phase B sizing
    needs. Spacing sleeps are politeness, not backoff, and are not counted.
    """

    def __init__(
        self,
        transport: Transport,
        *,
        sleep: Callable[[float], None],
        monotonic: Callable[[], float],
    ) -> None:
        self._transport = transport
        self._sleep = sleep
        self._monotonic = monotonic
        self._last_request: float | None = None
        self.attempts = 0
        self.status_counts: Counter[int] = Counter()
        self.retries = 0
        self.backoff_sleep_s = 0.0

    def fetch(
        self, url: str, *, headers: Mapping[str, str] | None = None
    ) -> TransportResponse:
        merged = {"User-Agent": USER_AGENT, **(headers or {})}
        delays = iter(BACKOFF_SCHEDULE)
        while True:
            self._space()
            self.attempts += 1
            response = self._transport.get(url, headers=merged)
            self.status_counts[response.status_code] += 1
            self._last_request = self._monotonic()
            if response.status_code == 429 or 500 <= response.status_code <= 599:
                delay = next(delays, None)
                if delay is not None:
                    # A retry is an answer that triggered a backoff — a 429
                    # answered after the schedule is exhausted is a failure the
                    # caller records, never a retry that happened.
                    self.retries += 1
                    self.backoff_sleep_s += delay
                    self._sleep(delay)
                    continue
            return response

    def metrics(self) -> FetchMetrics:
        return FetchMetrics(
            attempts=self.attempts,
            retries=self.retries,
            backoff_sleep_s=self.backoff_sleep_s,
            status_counts=dict(self.status_counts),
        )

    def _space(self) -> None:
        if self._last_request is None:
            return
        elapsed = self._monotonic() - self._last_request
        if elapsed < MIN_SPACING_S:
            self._sleep(MIN_SPACING_S - elapsed)


# --- discovery ---------------------------------------------------------------


@dataclass(frozen=True)
class IndexEntry:
    doc_id: str
    year: int
    filer_name_raw: str
    filed_date: str  # ISO
    state_dst: str | None


@dataclass(frozen=True)
class DiscoverResult:
    docids: tuple[str, ...]
    entries: Mapping[str, IndexEntry]
    dup_docids: int
    note: str | None = None
    failed: bool = False
    rejected_docids: tuple[str, ...] = ()


_MDY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

# The index is remote input: a DocID reaches both a URL and an archive path,
# so it is validated at the parse boundary before either is constructed. Every
# DocID in the cached 2015/2020/2026 indexes is purely numeric (4, 7, or 8
# digits, 6,650 entries measured), so this accepts the real corpus while
# making path traversal, separators, and absolute paths structurally
# impossible. A rejected DocID is counted and surfaced (G3 — never silently
# dropped), and makes the run not-ok.
_DOCID_RE = re.compile(r"^\d{1,10}$")


def _validate_doc_id(doc_id: str) -> bool:
    return bool(_DOCID_RE.match(doc_id))


def _filing_date_iso(raw: str) -> str:
    match = _MDY.match(raw.strip())
    if match is None:
        raise ValueError(f"unrecognized index FilingDate: {raw!r}")
    month, day, year = (int(g) for g in match.groups())
    return date(year, month, day).isoformat()


def _index_entries(xml_bytes: bytes, year: int) -> DiscoverResult:
    """``FilingType=P`` entries from one index XML, deduped in index order."""
    root = etree.fromstring(xml_bytes)
    docids: list[str] = []
    entries: dict[str, IndexEntry] = {}
    rejected: list[str] = []
    dup = 0
    for member in root.iter("Member"):
        if (member.findtext("FilingType") or "").strip() != "P":
            continue
        doc_id = (member.findtext("DocID") or "").strip()
        if not doc_id:
            continue
        if not _validate_doc_id(doc_id):
            rejected.append(doc_id)
            continue
        if doc_id in entries:
            dup += 1
            continue
        last = (member.findtext("Last") or "").strip()
        first = (member.findtext("First") or "").strip()
        suffix = (member.findtext("Suffix") or "").strip()
        name = f"{last}, {first}" + (f" {suffix}" if suffix else "")
        entries[doc_id] = IndexEntry(
            doc_id=doc_id,
            year=year,
            filer_name_raw=name,
            filed_date=_filing_date_iso(member.findtext("FilingDate") or ""),
            state_dst=(member.findtext("StateDst") or "").strip() or None,
        )
        docids.append(doc_id)
    return DiscoverResult(
        docids=tuple(docids),
        entries=entries,
        dup_docids=dup,
        rejected_docids=tuple(rejected),
    )


def _discovery_failure(reason: str) -> DiscoverResult:
    return DiscoverResult(
        docids=(), entries={}, dup_docids=0, note=f"FAILED: {reason}", failed=True
    )


def discover(
    *,
    year: int,
    raw_root: Path | None = None,
    fetcher: _PoliteFetcher | None = None,
    cache_dir: Path | None = None,
) -> DiscoverResult:
    """Obtain the year's PTR index: live conditional-GET or cache read (R1/R3).

    Live mode archives the ZIP, extracts ``<YEAR>FD.xml`` beside it, and
    persists the response validators in ``<YEAR>FD.zip.meta.json``; a 304
    reuses the previously archived XML. From-cache mode reads
    ``<DIR>/<YEAR>FD.xml`` directly and skips (with a note) when absent.

    The two no-index outcomes are distinct and must not be conflated: a
    from-cache year with no cached index is an approved **skip** (LD1),
    whereas every live-discovery miss — non-200, retry exhaustion, 304 with
    no archived XML, an unreadable ZIP, or a ZIP carrying no XML member — is
    a **failure** (``failed=True``). A failed discovery yields no
    reconciliation, so the run must never report success on it (R1/R15).
    """
    if cache_dir is not None:
        xml_path = Path(cache_dir) / f"{year}FD.xml"
        if not xml_path.exists():
            return DiscoverResult(
                docids=(),
                entries={},
                dup_docids=0,
                note=f"skipped: no cached index {xml_path.name}",
            )
        return _index_entries(xml_path.read_bytes(), year)

    if fetcher is None or raw_root is None:
        raise ValueError("live discovery requires a fetcher and a raw_root")
    raw_root = Path(raw_root)
    raw_root.mkdir(parents=True, exist_ok=True)
    zip_path = raw_root / f"{year}FD.zip"
    xml_path = raw_root / f"{year}FD.xml"
    meta_path = raw_root / f"{year}FD.zip.meta.json"

    headers: dict[str, str] = {}
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]

    response = fetcher.fetch(INDEX_URL_TEMPLATE.format(year=year), headers=headers)
    if response.status_code == 304:
        if xml_path.exists():
            return _index_entries(xml_path.read_bytes(), year)
        return _discovery_failure(
            f"index unchanged (HTTP 304) but no archived {xml_path.name}"
        )
    if response.status_code != 200:
        return _discovery_failure(f"index fetch failed (HTTP {response.status_code})")

    zip_path.write_bytes(response.content)
    try:
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            xml_members = [n for n in archive.namelist() if n.lower().endswith(".xml")]
            if not xml_members:
                return _discovery_failure("index ZIP contains no XML member")
            xml_bytes = archive.read(xml_members[0])
    except zipfile.BadZipFile as exc:
        return _discovery_failure(f"index ZIP is unreadable ({exc})")
    xml_path.write_bytes(xml_bytes)
    response_headers = {k.lower(): v for k, v in response.headers.items()}
    meta_path.write_text(
        json.dumps(
            {
                "etag": response_headers.get("etag"),
                "last_modified": response_headers.get("last-modified"),
                # §5.1 provenance parity with the per-document sidecars
                # (RUN M1-B, R2): the archived ZIP's own hash, additive beside
                # the conditional-GET validators. `stats.read_house_meta` reads
                # only `last_modified`, so nothing downstream shifts.
                "response_hash": sha256_hex(response.content),
            }
        ),
        encoding="utf-8",
    )
    return _index_entries(xml_bytes, year)


# --- document evaluation (the single status decision point — R21) ------------


@dataclass(frozen=True)
class EvaluatedDocument:
    status: str  # 'parsed' | 'partial' | 'needs_ocr' | 'failed'
    failure_kind: str | None  # 'empty_parse' | 'unreadable' | None
    rows: tuple[ParsedRow, ...]
    parse_path: str | None
    conflict: bool
    clean_rows: int
    total_rows: int
    text_fallback_rows: int
    efile: bool


def evaluate_document(
    pdf_bytes: bytes, *, doc_id: str, filed_date: str
) -> EvaluatedDocument:
    """Classify + parse + normalize one archived document; shared by ingest
    and reparse so the status decision cannot fork.

    ``parsed`` vs ``partial`` is decided ONLY by
    :func:`populus.normalize.has_parse_defect` over the emitted rows (R21).
    """
    empty = EvaluatedDocument(
        status="failed",
        failure_kind="unreadable",
        rows=(),
        parse_path=None,
        conflict=False,
        clean_rows=0,
        total_rows=0,
        text_fallback_rows=0,
        efile=False,
    )
    try:
        classification = classify(pdf_bytes, doc_id)
    except UnreadablePdfError:
        return empty
    if classification.kind == "paper":
        return EvaluatedDocument(
            status="needs_ocr",
            failure_kind=None,
            rows=(),
            parse_path=None,
            conflict=classification.conflict,
            clean_rows=0,
            total_rows=0,
            text_fallback_rows=0,
            efile=False,
        )
    try:
        parsed = parse_ptr(pdf_bytes, doc_id=doc_id)
    except EmptyParseError:
        return EvaluatedDocument(
            status="failed",
            failure_kind="empty_parse",
            rows=(),
            parse_path=None,
            conflict=False,
            clean_rows=0,
            total_rows=0,
            text_fallback_rows=0,
            efile=True,
        )
    except UnreadablePdfError:
        return EvaluatedDocument(
            status="failed",
            failure_kind="unreadable",
            rows=(),
            parse_path=None,
            conflict=False,
            clean_rows=0,
            total_rows=0,
            text_fallback_rows=0,
            efile=True,
        )
    rows = tuple(
        normalize_row(
            ptr_row.raw_row,
            filed_date=filed_date,
            cap_gains_cell=ptr_row.cap_gains_cell,
            cap_gains_column_present=parsed.cap_gains_column,
            row_ordinal=ptr_row.row_ordinal,
            source_row_no=ptr_row.source_row_no,
            structural_flags=ptr_row.structural_flags,
            filing_status=ptr_row.filing_status,
            subholding_of=ptr_row.subholding_of,
            location=ptr_row.location,
        )
        for ptr_row in parsed.rows
    )
    defective = [has_parse_defect(row.flags) for row in rows]
    return EvaluatedDocument(
        status="partial" if any(defective) else "parsed",
        failure_kind=None,
        rows=rows,
        parse_path=parsed.path,
        conflict=False,
        clean_rows=sum(1 for d in defective if not d),
        total_rows=len(rows),
        text_fallback_rows=sum(1 for row in rows if "text_fallback" in row.flags),
        efile=True,
    )


# --- reconciliation (R12/R17/R20) --------------------------------------------


@dataclass(frozen=True)
class Reconciliation:
    year: int
    index_ptr_count: int
    status_counts: Mapping[str, int]
    failed_fetch: int  # failed with raw_path NULL (re-fetch-eligible, R17)
    failed_archived: int  # failed with an archived document (reparse-eligible)
    unaccounted: tuple[str, ...]

    @property
    def total(self) -> int:
        return sum(self.status_counts.values())


def reconcile(
    conn: sqlite3.Connection, index_docids: tuple[str, ...] | list[str], year: int
) -> Reconciliation:
    """Prove every index PTR DocID holds exactly one schema ``parse_status``."""
    status_counts: Counter[str] = Counter()
    failed_fetch = 0
    failed_archived = 0
    found: set[str] = set()
    docids = list(index_docids)
    for start in range(0, len(docids), 500):
        chunk = docids[start : start + 500]
        # nosec B608 — the only interpolated text is a generated run of '?'
        # placeholders (one per chunk element); every value is bound as a
        # query parameter below, so no caller-controlled string reaches SQL.
        placeholders = ", ".join("?" for _ in chunk)
        for filing_id, parse_status, raw_path in conn.execute(
            f"SELECT filing_id, parse_status, raw_path FROM filings"  # nosec B608
            f" WHERE filing_id IN ({placeholders})",
            [f"house:{doc_id}" for doc_id in chunk],
        ):
            found.add(filing_id.split(":", 1)[1])
            status_counts[parse_status] += 1
            if parse_status == "failed":
                if raw_path is None:
                    failed_fetch += 1
                else:
                    failed_archived += 1
    unaccounted = tuple(d for d in docids if d not in found)
    return Reconciliation(
        year=year,
        index_ptr_count=len(docids),
        status_counts=dict(status_counts),
        failed_fetch=failed_fetch,
        failed_archived=failed_archived,
        unaccounted=unaccounted,
    )


# --- ingest run --------------------------------------------------------------


@dataclass
class YearReport:
    year: int
    note: str | None = None
    discovery_failed: bool = False
    index_ptr_count: int = 0
    dup_docids: int = 0
    rejected_docids: tuple[str, ...] = ()
    new_filings: int = 0
    rows_loaded: int = 0
    conflicts: int = 0
    clean_efile_rows: int = 0
    total_efile_rows: int = 0
    text_fallback_rows: int = 0
    # R3: archived documents whose bytes verified against filings.response_hash
    # (skipped, zero transport) vs those that did not and were re-obtained.
    settled_verified: int = 0
    settled_reobtained: int = 0
    failure_kinds: Counter = field(default_factory=Counter)
    reconciliation: Reconciliation | None = None


@dataclass
class IngestReport:
    run_id: str
    years: list[YearReport] = field(default_factory=list)
    # R20: what the polite fetcher actually did, and the monotonic wall-clock
    # of the run. `elapsed_s` is None in cache mode, where no clock is injected.
    fetch: FetchMetrics = field(default_factory=FetchMetrics)
    elapsed_s: float | None = None

    @property
    def settled_verified(self) -> int:
        return sum(y.settled_verified for y in self.years)

    @property
    def settled_reobtained(self) -> int:
        return sum(y.settled_reobtained for y in self.years)

    @property
    def failed_docids(self) -> int:
        return sum(
            (y.reconciliation.status_counts.get("failed", 0) if y.reconciliation else 0)
            for y in self.years
        )

    @property
    def unaccounted(self) -> int:
        return sum(
            (len(y.reconciliation.unaccounted) if y.reconciliation else 0)
            for y in self.years
        )

    @property
    def discovery_failures(self) -> int:
        return sum(1 for y in self.years if y.discovery_failed)

    @property
    def rejected_docids(self) -> int:
        return sum(len(y.rejected_docids) for y in self.years)

    @property
    def ok(self) -> bool:
        """LD24 + R1: success means every year discovered, every index DocID
        accepted and reconciled, and none failed.

        A year whose discovery failed produces no reconciliation at all, so
        counting only failed/unaccounted DocIDs would report success for a
        run that ingested nothing — the false-success mode this guards.
        """
        return (
            self.failed_docids == 0
            and self.unaccounted == 0
            and self.discovery_failures == 0
            and self.rejected_docids == 0
        )

    @property
    def new_filings(self) -> int:
        return sum(y.new_filings for y in self.years)

    @property
    def rows_loaded(self) -> int:
        return sum(y.rows_loaded for y in self.years)

    @property
    def parse_failures(self) -> int:
        return sum(sum(y.failure_kinds.values()) for y in self.years)


def _archive_relpath(year: int, doc_id: str) -> str:
    """LD2: raw-archive layout mirrors ``data-cache/house/``.

    Refuses to build a path from an unvalidated DocID — the index is remote
    input and this string reaches the filesystem.
    """
    if not _validate_doc_id(doc_id):
        raise UnsafeArchivePathError(f"refusing to build an archive path for {doc_id!r}")
    return f"pdfs/{year}/{doc_id}.pdf"


def run_house_ingest(
    conn: sqlite3.Connection,
    *,
    years: list[int],
    raw_root: Path | str,
    run_id: str,
    now: Callable[[], str],
    host: str,
    transport: Transport | None = None,
    cache_dir: Path | str | None = None,
    sleep: Callable[[float], None] | None = None,
    monotonic: Callable[[], float] | None = None,
) -> IngestReport:
    """One ingest invocation: discover → fetch → classify → parse → load →
    reconcile, per year, under exactly one complete ``ingest_runs`` row (R15).
    """
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'congress-house', ?, 'running', ?)",
        (run_id, now(), host),
    )
    report = IngestReport(run_id=run_id)
    fetcher: _PoliteFetcher | None = None
    # R20: monotonic only — never the wall clock — and only where the CLI
    # injected one, so cache-mode runs report `elapsed_s = None` rather than
    # a fabricated zero.
    started = monotonic() if monotonic is not None else None

    def _finalize() -> None:
        if fetcher is not None:
            report.fetch = fetcher.metrics()
        if started is not None and monotonic is not None:
            report.elapsed_s = monotonic() - started

    try:
        if cache_dir is None:
            if transport is None or sleep is None or monotonic is None:
                raise ValueError(
                    "live ingest requires transport, sleep, and monotonic"
                )
            fetcher = _PoliteFetcher(transport, sleep=sleep, monotonic=monotonic)
        for year in years:
            # Attached BEFORE processing so a fatal error mid-year still
            # finalizes the audit with the counters for the documents that
            # actually committed (R15) — the year report is mutated in place.
            year_report = YearReport(year=year)
            report.years.append(year_report)
            _ingest_year(
                conn,
                year_report=year_report,
                raw_root=Path(raw_root),
                fetcher=fetcher,
                cache_dir=Path(cache_dir) if cache_dir is not None else None,
                now=now,
            )
    except BaseException:
        # The instrumentation is finalized on EVERY exit path, exactly like the
        # audit row: a run that died mid-year still made real fetches, and those
        # are the figures the operational record needs (R20).
        _finalize()
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'failed',"
            " new_filings = ?, rows_loaded = ?, parse_failures = ?"
            " WHERE run_id = ?",
            (now(), report.new_filings, report.rows_loaded, report.parse_failures, run_id),
        )
        raise
    _finalize()
    conn.execute(
        "UPDATE ingest_runs SET finished_at = ?, status = ?, new_filings = ?,"
        " rows_loaded = ?, parse_failures = ? WHERE run_id = ?",
        (
            now(),
            "ok" if report.ok else "partial",
            report.new_filings,
            report.rows_loaded,
            report.parse_failures,
            run_id,
        ),
    )
    return report


def _ingest_year(
    conn: sqlite3.Connection,
    *,
    year_report: YearReport,
    raw_root: Path,
    fetcher: _PoliteFetcher | None,
    cache_dir: Path | None,
    now: Callable[[], str],
) -> None:
    """Discover + process one year, mutating *year_report* as work commits."""
    year = year_report.year
    discovered = discover(
        year=year, raw_root=raw_root, fetcher=fetcher, cache_dir=cache_dir
    )
    year_report.note = discovered.note
    year_report.discovery_failed = discovered.failed
    year_report.index_ptr_count = len(discovered.docids)
    year_report.dup_docids = discovered.dup_docids
    year_report.rejected_docids = discovered.rejected_docids
    if discovered.note is not None:
        return

    # Settled = archived AND VERIFIED (RUN M1-B, R3/LD9). A row alone is not
    # evidence: `raw_path IS NOT NULL` used to skip a filing forever even when
    # its archived document had gone missing or been corrupted at rest, because
    # the decision was made before anything could inspect the bytes. Eligibility
    # now requires raw_path AND response_hash AND an archived file that
    # re-hashes to that stored hash AND — in live mode — a readable provenance
    # sidecar agreeing with it; anything else falls through to the
    # checkpoint-first obtain path and is refetched exactly once. A fetch-failed
    # filing still has raw_path NULL and stays re-fetch-eligible.
    #
    # One pre-pass query as before; the added cost is a bounded local read and
    # hash per candidate, which is the price of never silently skipping a
    # corrupt document (a size or mtime check would miss same-length
    # corruption, the exact case this guards).
    archive_root = cache_dir if cache_dir is not None else raw_root
    archived = {
        filing_id: (raw_path, response_hash)
        for filing_id, raw_path, response_hash in conn.execute(
            "SELECT filing_id, raw_path, response_hash FROM filings"
            " WHERE raw_path IS NOT NULL"
        )
    }
    for doc_id in discovered.docids:
        stored = archived.get(f"house:{doc_id}")
        if stored is not None:
            raw_path, response_hash = stored
            try:
                verified = archive_verified(
                    _archive_path(archive_root, raw_path), response_hash
                )
                if verified and cache_dir is None:
                    # Boundary 1 of the provenance-boundary spec. LIVE MODE
                    # ONLY: the §5.1 sidecar is part of what "settled" MEANS,
                    # not a by-product of it (R2/LD3).
                    #
                    # The bytes agreeing with the DATABASE hash is a second,
                    # independent consistency check — emphatically not the rule
                    # (round 2 mistook it for the rule and skipped documents
                    # whose sidecar had been deleted, destroying `source_url`
                    # and `retrieved_at` permanently). The rule itself is the
                    # shared predicate, evaluated here exactly as boundary 2
                    # evaluates it — one rule, one implementation (spec I1).
                    #
                    # Cache mode is deliberately exempt: it writes no sidecar by
                    # contract and has no transport with which to make one, so
                    # applying the rule there would make every cached corpus
                    # permanently unsettleable (spec I6).
                    meta_path = _archive_path(
                        raw_root, _sidecar_relpath(raw_path)
                    )
                    if not _checkpoint_is_complete(
                        meta_path,
                        expected_hash=response_hash,
                        url=DOC_URL_TEMPLATE.format(year=year, doc_id=doc_id),
                    ):
                        verified = False
            except UnsafeArchivePathError:
                verified = False
            if verified:
                year_report.settled_verified += 1
                continue
            year_report.settled_reobtained += 1
        entry = discovered.entries[doc_id]
        pdf_bytes = _obtain_document(
            doc_id=doc_id,
            year=year,
            raw_root=raw_root,
            fetcher=fetcher,
            cache_dir=cache_dir,
            now=now,
        )
        outcome = _process_docid(
            conn, entry=entry, pdf_bytes=pdf_bytes, now=now
        )
        year_report.new_filings += 1
        year_report.rows_loaded += outcome.total_rows
        if outcome.conflict:
            year_report.conflicts += 1
        if outcome.efile:
            year_report.clean_efile_rows += outcome.clean_rows
            year_report.total_efile_rows += outcome.total_rows
            year_report.text_fallback_rows += outcome.text_fallback_rows
        if outcome.status == "failed":
            year_report.failure_kinds[outcome.failure_kind or "unknown"] += 1

    year_report.reconciliation = reconcile(conn, discovered.docids, year)


def _sidecar_relpath(relpath: str) -> str:
    """The per-document provenance sidecar beside an archived PDF (LD3)."""
    return f"{relpath}.fetch-meta.json"


def _checkpoint_is_complete(
    meta_path: Path, *, expected_hash: str | None, url: str
) -> bool:
    """THE durability predicate for a checkpoint (M1-B provenance-boundary spec).

    ``docs/build/M1-B-provenance-boundary-spec.md`` states the rule once:

        a document is durable iff its checkpoint carries the COMPLETE §5.1
        provenance set — ``response_hash``, ``retrieved_at``, ``source_url`` —
        with ``source_url`` equal to the canonical URL, AND its bytes re-hash to
        that ``response_hash``; anything less is fetch-required.

    This function owns the checkpoint half of that sentence. Both resume
    boundaries call it and neither re-derives "complete" from field reads of its
    own (spec I1) — three review rounds each found a different call site quietly
    answering this question with a weaker rule of its own making, which is the
    defect this single predicate exists to end.

    Every field is load-bearing (spec I2): a hash proves the bytes, a timestamp
    proves *when* the source said so, and a URL proves *which* source.
    ``source_url`` is compared against the caller's canonical URL rather than
    merely being present (spec I3) — a sidecar naming a different document is
    confident and wrong, and would survive any presence-only check. And
    ``retrieved_at`` must be non-empty, not merely present (spec I4): ``null``
    and ``""`` are absence wearing a key, and are exactly the residue the
    removed round-1 self-heal branch left in real archives.
    """
    entry = read_provenance(meta_path, None)
    if entry is None:
        return False
    response_hash = entry.get("response_hash")
    if not isinstance(response_hash, str) or not response_hash:
        return False
    if expected_hash is not None and response_hash != expected_hash:
        return False
    retrieved_at = entry.get("retrieved_at")
    if not isinstance(retrieved_at, str) or not retrieved_at.strip():
        return False
    return entry.get("source_url") == url


def _obtain_document(
    *,
    doc_id: str,
    year: int,
    raw_root: Path,
    fetcher: _PoliteFetcher | None,
    cache_dir: Path | None,
    now: Callable[[], str],
) -> bytes | None:
    """Cached read or checkpoint-first polite fetch; ``None`` means fetch failure.

    Both the URL and the archive path are built only from a DocID that
    already passed :func:`_validate_doc_id` at the index boundary, and the
    resolved path is proven to stay inside its root before any write.

    The live path is cache-first and checkpoint-before-bytes (RUN M1-B, R2),
    on the shared :mod:`populus.ingest.checkpoint` primitives:

    * archived bytes that re-hash to their committed checkpoint are returned
      from disk with ZERO transport — this is what makes a re-run over a
      verified archive free, on a fresh database as much as on the same one;
    * verify-or-refetch is the whole rule: bytes whose checkpoint is absent or
      unreadable are NOT verifiable, so they are re-fetched rather than
      trusted. There is no self-heal path that mints a sidecar out of
      unverified bytes;
    * a non-200 is never checkpointed and never archived (mirroring the inst
      guard), so a transient 404 can never freeze into a durable empty file
      that is then never re-fetched — ``raw_path`` stays NULL and the filing
      stays re-fetch-eligible;
    * on 200 the checkpoint lands atomically FIRST and the bytes second, so a
      crash between them leaves an absent-bytes state that resumes with
      exactly one fetch.

    Cache mode is untouched: it reads committed bytes and writes no sidecar.
    """
    relpath = _archive_relpath(year, doc_id)
    if cache_dir is not None:
        pdf_path = _archive_path(cache_dir, relpath)
        if not pdf_path.exists():
            return None
        return pdf_path.read_bytes()
    assert fetcher is not None
    url = DOC_URL_TEMPLATE.format(year=year, doc_id=doc_id)
    target = _archive_path(raw_root, relpath)
    meta_path = _archive_path(raw_root, _sidecar_relpath(relpath))

    # Boundary 2 of the provenance-boundary spec, and the ONLY boundary a
    # fresh-database resume passes through: the settled pre-pass has no rows to
    # skip there, so an incomplete sidecar reaching zero transport would never
    # be repaired by anything. Round 2 hardened the pre-pass and left this
    # accepting a hash-only checkpoint — round 3's finding exactly.
    if _checkpoint_is_complete(meta_path, expected_hash=None, url=url) and (
        target.exists()
    ):
        on_disk = target.read_bytes()
        expected, _retrieved_at = read_checkpoint(meta_path, None)
        if sha256_hex(on_disk) == expected:
            return on_disk
        # Mismatch: corrupt at rest, or a superseded in-flight replacement —
        # never durable bytes. Fall through and refetch exactly once.
    # Anything less than the complete provenance set ⇒ FETCH-REQUIRED. Absent,
    # unparseable, hash-less, timestamp-less, or naming another document's URL:
    # all of it is a document that cannot prove where it came from, and bytes
    # alone can never supply the proof. Fetch-required is a REPAIR, not a
    # failure — one fetch rewrites the checkpoint complete, and the document is
    # durable at zero transport from the next run onward (spec I5).

    response = fetcher.fetch(url)
    if response.status_code != 200:
        return None
    content = response.content
    commit_checkpoint(
        meta_path,
        None,
        url=url,
        response_hash=sha256_hex(content),
        retrieved_at=now(),
    )
    atomic_write_bytes(target, content)
    return content


@dataclass(frozen=True)
class _Outcome:
    doc_id: str
    status: str
    failure_kind: str | None
    conflict: bool
    efile: bool
    clean_rows: int
    total_rows: int
    text_fallback_rows: int


def _process_docid(
    conn: sqlite3.Connection,
    *,
    entry: IndexEntry,
    pdf_bytes: bytes | None,
    now: Callable[[], str],
) -> _Outcome:
    """Evaluate and atomically persist one DocID (upsert — R16/R17/R20).

    ``lifecycle`` is read back and replayed, never defaulted: ingest records
    only what parsing achieved, while lifecycle records the filing's
    standing (§9.4). Without this, a fetch-failed retry would reset a
    non-active filing to ``active`` through ``upsert_filing``'s ON CONFLICT
    update. No RUN-2 path sets a non-active House lifecycle today, so this
    is behavior-identical for the current corpus and closes the seam ahead
    of the kadoa lineage work (§9.6, RUN 4).
    """
    filing_id = f"house:{entry.doc_id}"
    stored = conn.execute(
        "SELECT lifecycle FROM filings WHERE filing_id = ?", (filing_id,)
    ).fetchone()
    lifecycle = stored[0] if stored is not None else "active"
    if pdf_bytes is None:
        evaluated = EvaluatedDocument(
            status="failed",
            failure_kind="fetch_failed",
            rows=(),
            parse_path=None,
            conflict=False,
            clean_rows=0,
            total_rows=0,
            text_fallback_rows=0,
            efile=False,
        )
        raw_path = None
        response_hash = None
    else:
        evaluated = evaluate_document(
            pdf_bytes, doc_id=entry.doc_id, filed_date=entry.filed_date
        )
        raw_path = _archive_relpath(entry.year, entry.doc_id)
        response_hash = hashlib.sha256(pdf_bytes).hexdigest()
    upsert_filing(
        conn,
        filing_id=filing_id,
        chamber="house",
        filer_name_raw=entry.filer_name_raw,
        filing_kind="ptr",
        filed_date=entry.filed_date,
        doc_url=DOC_URL_TEMPLATE.format(year=entry.year, doc_id=entry.doc_id),
        source="house-clerk",
        ingested_at=now(),
        rows=evaluated.rows,
        parse_status=evaluated.status,
        parser_version=PARSER_VERSION,
        normalization_version=NORMALIZATION_VERSION,
        raw_path=raw_path,
        response_hash=response_hash,
        lifecycle=lifecycle,
    )
    return _Outcome(
        doc_id=entry.doc_id,
        status=evaluated.status,
        failure_kind=evaluated.failure_kind,
        conflict=evaluated.conflict,
        efile=evaluated.efile,
        clean_rows=evaluated.clean_rows,
        total_rows=evaluated.total_rows,
        text_fallback_rows=evaluated.text_fallback_rows,
    )


# --- reparse (R14/R19) -------------------------------------------------------


@dataclass(frozen=True)
class ReparseSelector:
    filing: str | None = None
    since: str | None = None
    parser_version: str | None = None


@dataclass(frozen=True)
class ReparseSelection:
    targets: tuple[tuple[str, str], ...]  # (filing_id, raw_path)
    excluded_no_archive: int
    skipped_no_archive: tuple[str, ...]
    not_found: tuple[str, ...]


def select_reparse_targets(
    conn: sqlite3.Connection, selector: ReparseSelector, *, chamber: str = "house"
) -> ReparseSelection:
    """Build every selection branch with the archive filter applied centrally.

    Reparse operates only on filings with an archived document (R19): the one
    ``raw_path is not None`` split below serves default, ``--since``,
    ``--parser-version``, and ``--filing`` alike, so no branch can forget it.
    An explicit ``--filing`` naming a NULL-archive filing is reported as
    ``skipped_no_archive``, never read, never a crash. The selection
    semantics are chamber-neutral; the Senate reparse (RUN 3) passes
    ``chamber='senate'``.
    """
    condition = ""
    params: list[str] = [chamber]
    if selector.filing is not None:
        condition = " AND filing_id = ?"
        params.append(selector.filing)
    elif selector.since is not None:
        condition = " AND filed_date >= ?"
        params.append(selector.since)
    elif selector.parser_version is not None:
        condition = " AND parser_version = ?"
        params.append(selector.parser_version)
    rows = conn.execute(
        "SELECT filing_id, raw_path FROM filings"
        f" WHERE chamber = ?{condition} ORDER BY filing_id",
        params,
    ).fetchall()

    targets = tuple((f, p) for f, p in rows if p is not None)
    no_archive = tuple(f for f, p in rows if p is None)
    if selector.filing is not None:
        not_found = (selector.filing,) if not rows else ()
        return ReparseSelection(
            targets=targets,
            excluded_no_archive=0,
            skipped_no_archive=no_archive,
            not_found=not_found,
        )
    return ReparseSelection(
        targets=targets,
        excluded_no_archive=len(no_archive),
        skipped_no_archive=(),
        not_found=(),
    )


@dataclass(frozen=True)
class ReparseReport:
    selection: ReparseSelection
    statuses: Mapping[str, str]  # filing_id → new parse_status

    @property
    def ok(self) -> bool:
        return not self.selection.skipped_no_archive and not self.selection.not_found


def reparse_house(
    conn: sqlite3.Connection,
    *,
    raw_root: Path | str,
    selector: ReparseSelector,
    read_archive: Callable[[Path], bytes] = Path.read_bytes,
) -> ReparseReport:
    """Reparse archived filings atomically from the raw archive — never
    re-fetching (ARCHITECTURE.md §9.3). Identity stability and the atomic
    replace come from :func:`populus.load.load_filing` (RUN 1).
    """
    selection = select_reparse_targets(conn, selector)
    statuses: dict[str, str] = {}
    for filing_id, raw_path in selection.targets:
        filed_date = conn.execute(
            "SELECT filed_date FROM filings WHERE filing_id = ?", (filing_id,)
        ).fetchone()[0]
        doc_id = filing_id.split(":", 1)[1]
        pdf_bytes = read_archive(Path(raw_root) / raw_path)
        evaluated = evaluate_document(
            pdf_bytes, doc_id=doc_id, filed_date=filed_date
        )
        load_filing(
            conn,
            filing_id,
            list(evaluated.rows),
            parse_status=evaluated.status,
            parser_version=PARSER_VERSION,
            normalization_version=NORMALIZATION_VERSION,
        )
        statuses[filing_id] = evaluated.status
    # load_filing deleted and re-inserted each target's rows; restore the
    # amendment_unresolved flag on both sides of every pair (§9.5/RUN 4).
    flag_unresolved_pair_rows(conn)
    return ReparseReport(selection=selection, statuses=statuses)


# --- summaries ---------------------------------------------------------------


def format_summary(
    report: IngestReport, *, gate: ParseGateReport | None = None
) -> str:
    """The per-year reconciliation summary the CLI prints (R13).

    With a *gate* (the CLI computes one from the same connection before it
    closes), the summary also carries the per-era e-file gate lines, the per-era
    member-join lines, and — whenever any era is ``miss`` or ``unmeasurable`` —
    the OWNER DECISION REQUIRED block (RUN M1-B, R5). The gate is passed in
    rather than computed here so this stays a pure formatter over the report.
    """
    lines: list[str] = []
    clean_total = 0
    efile_total = 0
    for year_report in report.years:
        if year_report.note is not None:
            lines.append(f"house {year_report.year} | {year_report.note}")
            continue
        if year_report.rejected_docids:
            lines.append(
                f"  REJECTED DOCIDS ({len(year_report.rejected_docids)}):"
                f" {', '.join(repr(d) for d in year_report.rejected_docids[:10])}"
            )
        reconciliation = year_report.reconciliation
        counts = reconciliation.status_counts if reconciliation else {}
        failed = counts.get("failed", 0)
        kinds = year_report.failure_kinds
        fetch_failed = reconciliation.failed_fetch if reconciliation else 0
        empty_parse = kinds.get("empty_parse", 0)
        unreadable = kinds.get("unreadable", 0)
        prior_archived = (
            (reconciliation.failed_archived if reconciliation else 0)
            - empty_parse
            - unreadable
        )
        failed_detail = (
            f"fetch_failed {fetch_failed}, empty_parse {empty_parse},"
            f" unreadable {unreadable}"
        )
        if prior_archived > 0:
            failed_detail += f", archived_prior {prior_archived}"
        lines.append(
            f"house {year_report.year}"
            f" | index PTRs {year_report.index_ptr_count}"
            f" | parsed {counts.get('parsed', 0)}"
            f" | partial {counts.get('partial', 0)}"
            f" | needs_ocr {counts.get('needs_ocr', 0)}"
            f" | failed {failed} ({failed_detail})"
            f" | text_fallback {year_report.text_fallback_rows}"
            f" | conflicts {year_report.conflicts}"
            f" | dup docids {year_report.dup_docids}"
            f" | settled_verified {year_report.settled_verified}"
            f" | settled_reobtained {year_report.settled_reobtained}"
        )
        if reconciliation and reconciliation.unaccounted:
            lines.append(
                f"  UNACCOUNTED ({len(reconciliation.unaccounted)}):"
                f" {', '.join(reconciliation.unaccounted[:10])}"
            )
        clean_total += year_report.clean_efile_rows
        efile_total += year_report.total_efile_rows
    if efile_total:
        rate = 100.0 * clean_total / efile_total
        lines.append(
            f"efile rows: {clean_total} clean / {efile_total} total = {rate:.1f}%"
        )
    else:
        lines.append("efile rows: 0 clean / 0 total")
    lines.append(report.fetch.format_line("house", elapsed_s=report.elapsed_s))
    lines.append(
        f"run {report.run_id}: new_filings {report.new_filings}"
        f" | rows_loaded {report.rows_loaded}"
        f" | parse_failures {report.parse_failures}"
    )
    if gate is not None:
        lines.append(format_gate_report(gate))
    return "\n".join(lines)


def format_reparse_summary(report: ReparseReport) -> str:
    counts = Counter(report.statuses.values())
    lines = [
        "reparse congress-house"
        f" | reparsed {len(report.statuses)}"
        f" | parsed {counts.get('parsed', 0)}"
        f" | partial {counts.get('partial', 0)}"
        f" | needs_ocr {counts.get('needs_ocr', 0)}"
        f" | failed {counts.get('failed', 0)}"
        f" | excluded_no_archive {report.selection.excluded_no_archive}"
    ]
    for filing_id in report.selection.skipped_no_archive:
        lines.append(f"  skipped_no_archive: {filing_id} (no archived document)")
    for filing_id in report.selection.not_found:
        lines.append(f"  not_found: {filing_id}")
    return "\n".join(lines)
