"""Senate eFD PTR ingest pipeline (ARCHITECTURE.md §9.1/§9.2).

One of the two Populus modules that talk to the network — this one and its
House sibling ``populus.ingest.house`` are the only modules allowed to
import ``httpx``. Owns the verified eFD session handshake (CSRF token →
agreement POST → session cookie), polite sequential fetching with the G6
floors in code (never config), the consecutive-403 circuit breaker, index
discovery and archiving, raw page archiving, parse/normalize orchestration
through the single status-decision point, the §9.5 conservative amendment
linkage, completeness reconciliation, the per-run ``ingest_runs``
audit lifecycle, and archive-safe reparse (§9.3).

Library code never reads the wall clock: ``now``/``run_id``/``host`` and
the live-path ``sleep``/``monotonic``/``jitter`` are supplied by the CLI
layer. All session state (cookies, spacing, the breaker) lives here in
injectable, offline-testable code — the real httpx transport is stateless
and never follows redirects.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import lxml.etree
import lxml.html

from populus.amendments import flag_unresolved_pair_rows
from populus.ingest import (
    user_agent,
    FetchMetrics,
    TransportResponse,
    UnsafeArchivePathError,
    archive_path,
)
from populus.load import ParsedRow, load_filing, upsert_filing
from populus.normalize import (
    NORMALIZATION_VERSION,
    has_parse_defect,
    normalize_row,
)
from populus.parse.senate_ptr import (
    PARSER_VERSION,
    HeaderMismatchError,
    MissingTableError,
    parse_ptr_page,
)
from populus.parse_gate import ParseGateReport, format_gate_report

if TYPE_CHECKING:
    from populus.ingest.house import ReparseReport, ReparseSelector

# Politeness floors (G6/§9.2): hard-coded, never config- or CLI-tunable.
MIN_SPACING_S = 2.0
BACKOFF_SCHEDULE = (2.0, 4.0, 8.0)
CIRCUIT_403_THRESHOLD = 3

PAGE_LENGTH = 100

#: Synthetic status for "the transport itself failed". Inside the 5xx band so
#: the retry ladder treats it as a server-side non-answer, and 599 is not a
#: code eFD can actually return, so a real response can never be mistaken for
#: one of these.
TRANSPORT_FAILURE_STATUS = 599
RESCAN_DAYS = 90
BACKFILL_START = date(2012, 1, 1)

EFD_BASE = "https://efdsearch.senate.gov"
HOME_URL = f"{EFD_BASE}/search/home/"
DATA_URL = f"{EFD_BASE}/search/report/data/"
DOC_URL_TEMPLATE = f"{EFD_BASE}/search/view/{{kind}}/{{uuid}}/"

# The index is remote input: a UUID reaches both a URL and an archive path,
# so hrefs are validated at the parse boundary before either is built. A
# rejected row is counted and surfaced and makes the run not-ok.
_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_UUID_RE = re.compile(_UUID)
_HREF_RE = re.compile(rf"^/search/view/(ptr|paper)/({_UUID})/$")
_AMENDMENT_RE = re.compile(r"\(Amendment \d+\)")
_TITLE_DATE_RE = re.compile(r"for (\d{1,2})/(\d{1,2})/(\d{4})")
_MDY_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def _mdy_iso(raw: str) -> str:
    match = _MDY_RE.match(raw.strip())
    if match is None:
        raise ValueError(f"unrecognized index date: {raw!r}")
    month, day, year = (int(g) for g in match.groups())
    return date(year, month, day).isoformat()


# --- transport, cookie jar, polite session -------------------------


class SenateTransport(Protocol):
    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse: ...

    def post(
        self, url: str, *, data: Mapping[str, str], headers: Mapping[str, str]
    ) -> TransportResponse: ...


def _to_transport_response(response) -> TransportResponse:
    headers = dict(response.headers)
    set_cookies = response.headers.get_list("set-cookie")
    if set_cookies:
        # Header values cannot contain a newline, so newline-joining keeps
        # several cookies from one response distinguishable for the jar.
        headers["set-cookie"] = "\n".join(set_cookies)
    return TransportResponse(
        status_code=response.status_code,
        headers=headers,
        content=response.content,
    )


class HttpxSenateTransport:
    """The real HTTP client; constructed only by the CLI's live path.

    Stateless on purpose: redirects are not followed and no client-side
    cookie store exists — the library's :class:`_CookieJar` owns session
    state so the whole handshake is provable offline.
    """

    def __init__(self, *, transport: object | None = None) -> None:
        # *transport* is a hermetic test seam (httpx.MockTransport);
        # the live path constructs with no arguments.
        self._transport = transport

    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse:
        # The shared bounded helper enforces the 128 MiB decoded-body
        # ceiling and preserves multiple Set-Cookie values (newline-joined) for
        # the library-owned jar. ResponseTooLarge propagates as a named
        # failure; transport-level httpx errors keep their TransportFailure
        # mapping so the session's retry ladder is unchanged.
        import httpx

        from populus.net.bounded_http import bounded_http_request

        try:
            return bounded_http_request(
                "GET", url, headers=headers, transport=self._transport
            )
        except httpx.HTTPError as exc:
            raise TransportFailure(f"GET {url}: {type(exc).__name__}: {exc}") from exc

    def post(
        self, url: str, *, data: Mapping[str, str], headers: Mapping[str, str]
    ) -> TransportResponse:
        import httpx

        from populus.net.bounded_http import bounded_http_request

        try:
            return bounded_http_request(
                "POST", url, headers=headers, data=data, transport=self._transport
            )
        except httpx.HTTPError as exc:
            raise TransportFailure(f"POST {url}: {type(exc).__name__}: {exc}") from exc


class _CookieJar:
    """Minimal library-owned cookie store: name=value pairs, last write wins.

    Single host, no domain/path/expiry semantics (declared debt) —
    eFD sets simple session cookies on one host, and owning the jar here
    keeps session behavior fully testable offline. Multiple ``Set-Cookie``
    values arrive newline-joined from the transport (see
    :func:`_to_transport_response`).
    """

    def __init__(self) -> None:
        self._cookies: dict[str, str] = {}

    def absorb(self, headers: Mapping[str, str]) -> None:
        for name, value in headers.items():
            if name.lower() != "set-cookie":
                continue
            for line in value.split("\n"):
                pair = line.split(";", 1)[0]
                if "=" not in pair:
                    continue
                cookie_name, cookie_value = pair.split("=", 1)
                if cookie_name.strip():
                    self._cookies[cookie_name.strip()] = cookie_value.strip()

    def header(self) -> str | None:
        if not self._cookies:
            return None
        return "; ".join(f"{n}={v}" for n, v in self._cookies.items())


class TransportFailure(RuntimeError):
    """The HTTP transport failed before any status was received.

    A named domain error rather than a leaked ``httpx`` exception, so the
    politeness session (and its tests) never import the transport library and
    an injected transport can raise it directly.
    """


class CircuitOpenError(RuntimeError):
    """The consecutive-403 breaker tripped: stop the job, never retry harder."""

    def __init__(self, url: str) -> None:
        super().__init__(
            f"circuit open: {CIRCUIT_403_THRESHOLD} consecutive 403s; last at {url}"
        )
        self.url = url


class _PoliteSession:
    """Sequential polite fetching with the G6 floors baked into code.

    >= ``MIN_SPACING_S`` plus non-negative injected jitter between
    consecutive fetches (the 2.0 s floor is never reducible); exponential
    backoff per ``BACKOFF_SCHEDULE`` on 429 AND 5xx. A 403 is never retried
    or backed off: the consecutive-403 counter spans every fetch in the run,
    resets on any non-403 response, and at ``CIRCUIT_403_THRESHOLD`` raises
    :class:`CircuitOpenError` naming the failing URL — a CSRF or
    protocol regression is then diagnosable instead of being misread as
    bot-blocking. Attaches the identifying UA and the session cookie on
    every fetch.

    Counts its own work in the same shape as the House
    fetcher and :class:`populus.inst_bulk.CountingTransport`: ``attempts`` is
    every request that left this process (retries included), ``status_counts``
    the answered status mix, ``retries`` the 429/5xx answers that actually
    triggered a backoff, and ``backoff_sleep_s`` the seconds slept in them.
    Politeness spacing is not backoff and is not counted; the Senate's
    per-request cost differs from the House's by an order of magnitude (2.0 s
    floor vs 0.25 s), which is exactly why both are measured separately.
    """

    def __init__(
        self,
        transport: SenateTransport,
        *,
        sleep: Callable[[float], None],
        monotonic: Callable[[], float],
        jitter: Callable[[], float],
    ) -> None:
        self._transport = transport
        self._sleep = sleep
        self._monotonic = monotonic
        self._jitter = jitter
        self._jar = _CookieJar()
        self._last_fetch: float | None = None
        self._consecutive_403 = 0
        self.attempts = 0
        self.status_counts: Counter[int] = Counter()
        self.retries = 0
        self.backoff_sleep_s = 0.0

    def metrics(self) -> FetchMetrics:
        return FetchMetrics(
            attempts=self.attempts,
            retries=self.retries,
            backoff_sleep_s=self.backoff_sleep_s,
            status_counts=dict(self.status_counts),
        )

    def get(
        self, url: str, *, headers: Mapping[str, str] | None = None
    ) -> TransportResponse:
        return self._fetch(url, data=None, headers=headers)

    def post(
        self,
        url: str,
        *,
        data: Mapping[str, str],
        headers: Mapping[str, str] | None = None,
    ) -> TransportResponse:
        return self._fetch(url, data=data, headers=headers)

    def _fetch(
        self,
        url: str,
        *,
        data: Mapping[str, str] | None,
        headers: Mapping[str, str] | None,
    ) -> TransportResponse:
        delays = iter(BACKOFF_SCHEDULE)
        while True:
            merged = {"User-Agent": user_agent(), **(headers or {})}
            cookie = self._jar.header()
            if cookie is not None:
                merged["Cookie"] = cookie
            self._space()
            self.attempts += 1
            # A transport-level failure (read timeout, connection reset) is the
            # same operational event as a 5xx: eFD did not answer this time.
            # Left uncaught it escaped the retry ladder entirely and killed a
            # multi-hour ingest on one slow response -- run 8 died with a bare
            # httpx.ReadTimeout after the full House leg had already succeeded.
            # Mapped onto the synthetic status below so the EXISTING backoff,
            # retry accounting and circuit logic handle it, rather than growing
            # a second parallel policy that could drift from the first.
            try:
                if data is None:
                    response = self._transport.get(url, headers=merged)
                else:
                    response = self._transport.post(url, data=data, headers=merged)
            except TransportFailure as exc:
                response = TransportResponse(
                    status_code=TRANSPORT_FAILURE_STATUS,
                    content=str(exc).encode(),
                    headers={},
                )
            self.status_counts[response.status_code] += 1
            self._last_fetch = self._monotonic()
            self._jar.absorb(response.headers)
            if response.status_code == 403:
                self._consecutive_403 += 1
                if self._consecutive_403 >= CIRCUIT_403_THRESHOLD:
                    raise CircuitOpenError(url)
                return response
            self._consecutive_403 = 0
            if response.status_code == 429 or 500 <= response.status_code <= 599:
                delay = next(delays, None)
                if delay is not None:
                    self.retries += 1
                    self.backoff_sleep_s += delay
                    self._sleep(delay)
                    continue
            return response

    def _space(self) -> None:
        if self._last_fetch is None:
            return
        spacing = MIN_SPACING_S + max(0.0, self._jitter())
        elapsed = self._monotonic() - self._last_fetch
        if elapsed < spacing:
            self._sleep(spacing - elapsed)


# --- discovery --------------------------------------------------


@dataclass(frozen=True)
class SenateIndexEntry:
    uuid: str
    kind: str  # 'ptr' | 'paper' — the detail-URL kind
    amendment: bool
    title: str
    title_date: str | None  # ISO report date from the link title
    filer_name_raw: str
    filed_date: str  # ISO, from the index row

    @property
    def filing_kind(self) -> str:
        return "ptr_amendment" if self.amendment else "ptr"

    @property
    def doc_url(self) -> str:
        return DOC_URL_TEMPLATE.format(kind=self.kind, uuid=self.uuid)


@dataclass(frozen=True)
class SenateDiscoverResult:
    uuids: tuple[str, ...]
    entries: Mapping[str, SenateIndexEntry]
    dup_uuids: int
    rejected_rows: tuple[str, ...]
    note: str | None = None
    failed: bool = False


def _discovery_failure(reason: str) -> SenateDiscoverResult:
    return SenateDiscoverResult(
        uuids=(),
        entries={},
        dup_uuids=0,
        rejected_rows=(),
        note=f"FAILED: {reason}",
        failed=True,
    )


def _clean_name_part(raw: str) -> str:
    """Strip surrounding whitespace and trailing commas (LD4 — 'Moran,  ')."""
    return raw.strip().rstrip(",").strip()


def _parse_index_row(row: object) -> SenateIndexEntry:
    if not isinstance(row, (list, tuple)) or len(row) < 5:
        raise ValueError(f"malformed index row shape: {row!r:.120}")
    first, last, _office, link_html, filed = (row[i] for i in range(5))
    if not all(isinstance(v, str) for v in (first, last, link_html, filed)):
        raise ValueError(f"non-string index row fields: {row!r:.120}")
    anchor = lxml.html.fromstring(f"<div>{link_html}</div>").find(".//a")
    if anchor is None:
        raise ValueError(f"index row link carries no anchor: {link_html!r:.120}")
    href = anchor.get("href") or ""
    match = _HREF_RE.match(href)
    if match is None:
        raise ValueError(f"index row href rejected: {href!r:.120}")
    kind, uuid = match.group(1), match.group(2)
    title = " ".join(anchor.text_content().split())
    title_date = None
    date_match = _TITLE_DATE_RE.search(title)
    if date_match is not None:
        month, day, year = (int(g) for g in date_match.groups())
        title_date = date(year, month, day).isoformat()
    return SenateIndexEntry(
        uuid=uuid,
        kind=kind,
        amendment=bool(_AMENDMENT_RE.search(title)),
        title=title,
        title_date=title_date,
        filer_name_raw=f"{_clean_name_part(last)}, {_clean_name_part(first)}",
        filed_date=_mdy_iso(filed),
    )


def _index_rows(raw_rows: list) -> SenateDiscoverResult:
    """Validated, deduped entries from the DataTables rows, in index order."""
    uuids: list[str] = []
    entries: dict[str, SenateIndexEntry] = {}
    rejected: list[str] = []
    dup = 0
    for position, row in enumerate(raw_rows):
        try:
            entry = _parse_index_row(row)
        except (ValueError, lxml.etree.ParserError) as exc:
            rejected.append(f"row {position}: {exc}")
            continue
        if entry.uuid in entries:
            dup += 1
            continue
        entries[entry.uuid] = entry
        uuids.append(entry.uuid)
    return SenateDiscoverResult(
        uuids=tuple(uuids),
        entries=entries,
        dup_uuids=dup,
        rejected_rows=tuple(rejected),
    )


def _csrf_token(html: bytes) -> str | None:
    try:
        doc = lxml.html.document_fromstring(html)
    except (lxml.etree.ParserError, ValueError):
        return None
    node = doc.find(".//input[@name='csrfmiddlewaretoken']")
    if node is None:
        return None
    return node.get("value") or None


def _efd_datetime(date: str) -> str:
    """``MM/DD/YYYY`` → ``MM/DD/YYYY 00:00:00``; a value with a time passes through.

    eFD's search backend answers **503** — not 400 — to a submitted-date without
    a time component. Established 2026-08-07 by a controlled pair on one session,
    three seconds apart: ``08/01/2026 00:00:00`` → 200, ``08/01/2026`` → 503.
    The date-only form worked historically, so this is a server-side parsing
    change presenting as an outage — it cost two CI runs and a five-hypothesis
    diagnosis (IP blocking, headers, connection reuse, page length, user-agent)
    precisely because 503 reads as "their problem".

    Normalized here, at the single point where dates enter the request body, so
    every caller (CLI-provided windows, watermark-derived defaults, era bounds)
    is covered without any of them knowing eFD's quirk exists.
    """
    return date if " " in date else f"{date} 00:00:00"


def _index_post_body(
    token: str,
    *,
    submitted_start_date: str,
    start: int,
    submitted_end_date: str | None = None,
) -> dict[str, str]:
    """The DataTables search body.

    ``submitted_end_date`` is the historical-window seam and is
    **default-inert**: omitted, the body is byte-identical to the open-ended
    "start → forever" request the incremental job has always sent. eFD exposes
    one continuous submitted-date window, so bounding a historical era means
    supplying both ends — without the end bound a 2015 request would walk
    forward through every subsequent year.
    """
    return {
        "csrfmiddlewaretoken": token,
        "report_types": "[11]",
        "filer_types": "[]",
        "submitted_start_date": _efd_datetime(submitted_start_date),
        "submitted_end_date": _efd_datetime(submitted_end_date) if submitted_end_date else "",
        "candidate_state": "",
        "senator_state": "",
        "office_id": "",
        "first_name": "",
        "last_name": "",
        "start": str(start),
        "length": str(PAGE_LENGTH),
    }


def discover(
    *,
    raw_root: Path | None = None,
    session: _PoliteSession | None = None,
    cache_dir: Path | None = None,
    submitted_start_date: str | None = None,
    submitted_end_date: str | None = None,
) -> SenateDiscoverResult:
    """Obtain the PTR index: live handshake + paginated POSTs, or cache read.

    Live mode performs the verified §9.1 handshake — GET the home page,
    extract the Django ``csrfmiddlewaretoken``, POST the prohibition
    agreement, and require a 302/303 answer (LD13: a 200 means the form
    re-rendered, i.e. the agreement was NOT accepted; scraping on would use
    an anonymous session). The session cookie set across the handshake is
    replayed by the library jar on every subsequent fetch. The merged index
    is archived to ``raw_root/ptr-index.json`` mirroring the cache layout.

    From-cache mode reads ``<cache>/ptr-index.json``; a missing or
    unparseable cache index is a **failure**, not a skip: the Senate
    has exactly one index and nothing can reconcile without it.
    """
    if cache_dir is not None:
        index_path = Path(cache_dir) / "ptr-index.json"
        if not index_path.exists():
            return _discovery_failure(f"no cached index {index_path.name}")
        try:
            payload = json.loads(index_path.read_text(encoding="utf-8"))
        except ValueError as exc:
            return _discovery_failure(f"cached index is unreadable ({exc})")
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return _discovery_failure("cached index carries no data array")
        return _index_rows(rows)

    if session is None or raw_root is None or submitted_start_date is None:
        raise ValueError(
            "live discovery requires a session, a raw_root, and a window start"
        )

    home = session.get(HOME_URL)
    if home.status_code != 200:
        return _discovery_failure(f"home fetch failed (HTTP {home.status_code})")
    token = _csrf_token(home.content)
    if token is None:
        return _discovery_failure("home page carries no csrfmiddlewaretoken")
    agreement = session.post(
        HOME_URL,
        data={"csrfmiddlewaretoken": token, "prohibition_agreement": "1"},
        headers={"Referer": HOME_URL},
    )
    if agreement.status_code not in (302, 303):
        return _discovery_failure(
            f"agreement not accepted (HTTP {agreement.status_code};"
            " a 200 means the form re-rendered — LD13)"
        )

    rows: list = []
    records_total = 0
    start = 0
    while True:
        response = session.post(
            DATA_URL,
            data=_index_post_body(
                token,
                submitted_start_date=submitted_start_date,
                submitted_end_date=submitted_end_date,
                start=start,
            ),
            headers={"Referer": HOME_URL},
        )
        if response.status_code != 200:
            return _discovery_failure(
                f"index fetch failed (HTTP {response.status_code}) at start={start}"
            )
        try:
            payload = json.loads(response.content)
        except ValueError:
            return _discovery_failure(f"index response is not JSON at start={start}")
        records_total = payload.get("recordsTotal") if isinstance(payload, dict) else None
        if not isinstance(records_total, int):
            return _discovery_failure("index response lacks an integer recordsTotal")
        page_rows = payload.get("data")
        if not isinstance(page_rows, list):
            return _discovery_failure("index response lacks a data array")
        rows.extend(page_rows)
        if len(page_rows) < PAGE_LENGTH or len(rows) >= records_total:
            break
        start += PAGE_LENGTH

    raw_root = Path(raw_root)
    raw_root.mkdir(parents=True, exist_ok=True)
    (raw_root / "ptr-index.json").write_text(
        json.dumps({"recordsTotal": records_total, "data": rows}, ensure_ascii=False),
        encoding="utf-8",
    )
    return _index_rows(rows)


def _submitted_start_date(conn: sqlite3.Connection) -> str:
    """The locked LD5 window rule — the single definition.

    No Senate filing in the store ⇒ ``01/01/2012`` exactly (no subtraction);
    otherwise ``MAX(filed_date over chamber='senate') − 90 days`` (§9.2
    re-scan window, catching late amendments and paper-to-e-file
    conversions). Never reads the wall clock.
    """
    (max_filed,) = conn.execute(
        "SELECT MAX(filed_date) FROM filings WHERE chamber = 'senate'"
    ).fetchone()
    if max_filed is None:
        start = BACKFILL_START
    else:
        start = date.fromisoformat(max_filed) - timedelta(days=RESCAN_DAYS)
    return f"{start.month:02d}/{start.day:02d}/{start.year:04d}"


# --- page evaluation (the single status decision point) -----------------------


@dataclass(frozen=True)
class EvaluatedPage:
    status: str  # 'parsed' | 'partial' | 'needs_ocr' | 'failed'
    failure_kind: str | None  # 'missing_table' | 'header_mismatch' | None
    rows: tuple[ParsedRow, ...]
    clean_rows: int
    total_rows: int
    declared_total: int | None
    declared_mismatch: bool
    efile: bool


def evaluate_page(
    html: bytes, *, uuid: str, kind: str, filed_date: str, amendment: bool
) -> EvaluatedPage:
    """Parse + normalize one archived page; shared by ingest and reparse so
    the status decision cannot fork.

    Paper kind ⇒ ``needs_ocr``, zero rows (G3 — retained, visible). E-file
    kind: ``parsed`` vs ``partial`` is decided ONLY by
    :func:`populus.normalize.has_parse_defect` over the emitted rows, plus
    the LD7 integrity check — a declared transaction total that disagrees
    with the emitted row count ⇒ ``partial`` (guards silent truncation of
    the 703-row filing class). Every amendment row carries
    ``amendment_unresolved`` (LD9/§9.5).
    """
    if kind == "paper":
        return EvaluatedPage(
            status="needs_ocr",
            failure_kind=None,
            rows=(),
            clean_rows=0,
            total_rows=0,
            declared_total=None,
            declared_mismatch=False,
            efile=False,
        )
    try:
        parsed = parse_ptr_page(html, uuid=uuid)
    except MissingTableError:
        failure_kind = "missing_table"
    except HeaderMismatchError:
        failure_kind = "header_mismatch"
    else:
        amendment_flags = frozenset({"amendment_unresolved"}) if amendment else frozenset()
        rows = tuple(
            normalize_row(
                page_row.raw_row,
                filed_date=filed_date,
                cap_gains_cell=None,
                cap_gains_column_present=False,
                row_ordinal=page_row.row_ordinal,
                source_row_no=page_row.source_row_no,
                structural_flags=page_row.structural_flags | amendment_flags,
                asset_display_cell=page_row.raw_asset_display,
                asset_type_cell=page_row.asset_type_cell,
            )
            for page_row in parsed.rows
        )
        defective = [has_parse_defect(row.flags) for row in rows]
        declared_mismatch = (
            parsed.declared_total is not None
            and parsed.declared_total != len(rows)
        )
        return EvaluatedPage(
            status="partial" if any(defective) or declared_mismatch else "parsed",
            failure_kind=None,
            rows=rows,
            clean_rows=sum(1 for d in defective if not d),
            total_rows=len(rows),
            declared_total=parsed.declared_total,
            declared_mismatch=declared_mismatch,
            efile=True,
        )
    return EvaluatedPage(
        status="failed",
        failure_kind=failure_kind,
        rows=(),
        clean_rows=0,
        total_rows=0,
        declared_total=None,
        declared_mismatch=False,
        efile=True,
    )


# --- reconciliation --------------------------------------------------


@dataclass(frozen=True)
class Reconciliation:
    index_count: int
    status_counts: Mapping[str, int]
    failed_fetch: int  # failed with raw_path NULL (re-fetch-eligible)
    failed_archived: int  # failed with an archived document (reparse-eligible)
    unaccounted: tuple[str, ...]

    @property
    def total(self) -> int:
        return sum(self.status_counts.values())


def reconcile(
    conn: sqlite3.Connection, index_uuids: tuple[str, ...] | list[str]
) -> Reconciliation:
    """Prove every index UUID holds exactly one schema ``parse_status``."""
    status_counts: Counter[str] = Counter()
    failed_fetch = 0
    failed_archived = 0
    found: set[str] = set()
    uuids = list(index_uuids)
    for chunk_start in range(0, len(uuids), 500):
        chunk = uuids[chunk_start : chunk_start + 500]
        # nosec B608 — the only interpolated text is a generated run of '?'
        # placeholders (one per chunk element); every value is bound as a
        # query parameter below, so no caller-controlled string reaches SQL.
        placeholders = ", ".join("?" for _ in chunk)
        for filing_id, parse_status, raw_path in conn.execute(
            f"SELECT filing_id, parse_status, raw_path FROM filings"  # nosec B608
            f" WHERE filing_id IN ({placeholders})",
            [f"senate:{uuid}" for uuid in chunk],
        ):
            found.add(filing_id.split(":", 1)[1])
            status_counts[parse_status] += 1
            if parse_status == "failed":
                if raw_path is None:
                    failed_fetch += 1
                else:
                    failed_archived += 1
    unaccounted = tuple(u for u in uuids if u not in found)
    return Reconciliation(
        index_count=len(uuids),
        status_counts=dict(status_counts),
        failed_fetch=failed_fetch,
        failed_archived=failed_archived,
        unaccounted=unaccounted,
    )


# --- ingest run -------------------------------------------


@dataclass
class SenateIngestReport:
    run_id: str
    note: str | None = None
    discovery_failed: bool = False
    index_uuids: tuple[str, ...] = ()
    dup_uuids: int = 0
    rejected_rows: tuple[str, ...] = ()
    new_filings: int = 0
    rows_loaded: int = 0
    conversions: int = 0
    declared_mismatches: int = 0
    amendments_total: int = 0
    amendments_paired: int = 0
    clean_efile_rows: int = 0
    total_efile_rows: int = 0
    failure_kinds: Counter = field(default_factory=Counter)
    circuit_open_url: str | None = None
    reconciliation: Reconciliation | None = None
    # What the polite session actually did, and the monotonic wall-clock
    # of the run. `elapsed_s` is None in cache mode, where no clock is injected.
    fetch: FetchMetrics = field(default_factory=FetchMetrics)
    elapsed_s: float | None = None
    # The exact window this run requested (None = the derived watermark
    # start / open end), recorded so the operational artifact can state which
    # era the figures describe.
    window: tuple[str, str | None] | None = None

    @property
    def index_count(self) -> int:
        return len(self.index_uuids)

    @property
    def parse_failures(self) -> int:
        return sum(self.failure_kinds.values())

    @property
    def unaccounted(self) -> int:
        return len(self.reconciliation.unaccounted) if self.reconciliation else 0

    @property
    def ok(self) -> bool:
        """Success means the index was discovered, every row accepted, every
        UUID reconciled into a non-failed status, and the breaker never
        tripped. A failed discovery or a tripped breaker yields no complete
        reconciliation, so counting failed/unaccounted alone would report
        success for a run that ingested nothing — the false-success mode
        this guards.
        """
        if self.discovery_failed or self.circuit_open_url is not None:
            return False
        if self.rejected_rows:
            return False
        if self.reconciliation is None:
            return False
        return (
            self.reconciliation.status_counts.get("failed", 0) == 0
            and not self.reconciliation.unaccounted
        )


def _kind_from_doc_url(doc_url: str) -> str:
    return "paper" if "/search/view/paper/" in doc_url else "ptr"


def _archive_relpath(kind: str, uuid: str) -> str:
    """LD2 pattern: the raw-archive layout mirrors ``data-cache/senate/``.

    Refuses to build a path from an unvalidated kind/UUID — the index is
    remote input and this string reaches the filesystem.
    """
    if kind not in ("ptr", "paper") or not _UUID_RE.fullmatch(uuid):
        raise UnsafeArchivePathError(
            f"refusing to build an archive path for {kind!r}/{uuid!r}"
        )
    return f"pages/{kind}_{uuid}.html"


def run_senate_ingest(
    conn: sqlite3.Connection,
    *,
    raw_root: Path | str,
    run_id: str,
    now: Callable[[], str],
    host: str,
    transport: SenateTransport | None = None,
    cache_dir: Path | str | None = None,
    sleep: Callable[[float], None] | None = None,
    monotonic: Callable[[], float] | None = None,
    jitter: Callable[[], float] | None = None,
    submitted_start_date: str | None = None,
    submitted_end_date: str | None = None,
) -> SenateIngestReport:
    """One ingest invocation: handshake → index → fetch → parse → load →
    link amendments → reconcile, under exactly one ``ingest_runs`` row.

    The audit row is finalized on every exit path: ``ok``/``partial`` on
    completion, ``failed`` on a raised exception, and ``circuit_open`` when
    the consecutive-403 breaker trips (LD6 — persisted filings stand;
    unattempted UUIDs surface as unaccounted; exit 1).

    ``submitted_start_date`` / ``submitted_end_date`` (MM/DD/YYYY) bound the
    requested window. Both default to today's exact behaviour: the start
    derived from the store's watermark by :func:`_submitted_start_date`, and no
    end bound at all. Because that derived start is
    ``MAX(filed_date) − 90 days``, inserting OLDER filings can never regress it
    — a historical window is safe to run against a current corpus.
    """
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'congress-senate', ?, 'running', ?)",
        (run_id, now(), host),
    )
    report = SenateIngestReport(run_id=run_id)
    session_box: list[_PoliteSession] = []
    started = monotonic() if monotonic is not None else None

    def _finalize() -> None:
        if session_box:
            report.fetch = session_box[0].metrics()
        if started is not None and monotonic is not None:
            report.elapsed_s = monotonic() - started

    try:
        _ingest(
            conn,
            report=report,
            raw_root=Path(raw_root),
            transport=transport,
            cache_dir=Path(cache_dir) if cache_dir is not None else None,
            now=now,
            sleep=sleep,
            monotonic=monotonic,
            jitter=jitter,
            submitted_start_date=submitted_start_date,
            submitted_end_date=submitted_end_date,
            session_box=session_box,
        )
    except CircuitOpenError as exc:
        report.circuit_open_url = exc.url
        if report.index_uuids:
            report.reconciliation = reconcile(conn, report.index_uuids)
        _finalize()
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'circuit_open',"
            " new_filings = ?, rows_loaded = ?, parse_failures = ?"
            " WHERE run_id = ?",
            (now(), report.new_filings, report.rows_loaded, report.parse_failures, run_id),
        )
        return report
    except BaseException:
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


def _ingest(
    conn: sqlite3.Connection,
    *,
    report: SenateIngestReport,
    raw_root: Path,
    transport: SenateTransport | None,
    cache_dir: Path | None,
    now: Callable[[], str],
    sleep: Callable[[float], None] | None,
    monotonic: Callable[[], float] | None,
    jitter: Callable[[], float] | None,
    submitted_start_date: str | None = None,
    submitted_end_date: str | None = None,
    session_box: list | None = None,
) -> None:
    """Discover + process the index, mutating *report* as work commits so a
    fatal error still finalizes the audit with the true committed counters.

    *session_box* receives the constructed session so the caller can read its
    transport counters on every exit path, including the tripped-breaker one.
    """
    session: _PoliteSession | None = None
    if cache_dir is None:
        if transport is None or sleep is None or monotonic is None or jitter is None:
            raise ValueError(
                "live ingest requires transport, sleep, monotonic, and jitter"
            )
        session = _PoliteSession(
            transport, sleep=sleep, monotonic=monotonic, jitter=jitter
        )
        if session_box is not None:
            session_box.append(session)
    window_start = (
        submitted_start_date
        if submitted_start_date is not None
        else _submitted_start_date(conn)
    )
    report.window = (window_start, submitted_end_date)
    discovered = discover(
        raw_root=raw_root,
        session=session,
        cache_dir=cache_dir,
        submitted_start_date=window_start,
        submitted_end_date=submitted_end_date,
    )
    report.note = discovered.note
    report.discovery_failed = discovered.failed
    report.index_uuids = discovered.uuids
    report.dup_uuids = discovered.dup_uuids
    report.rejected_rows = discovered.rejected_rows
    if discovered.failed:
        return

    # Settled = archived AND unchanged index kind: §9.2's re-scan
    # window exists to catch paper-to-e-file conversions, so a kind change
    # re-fetches and converts; a fetch-failed filing has raw_path NULL and
    # stays re-fetch-eligible. Same-kind content refresh is out of scope —
    # eFD's own certification says filed reports cannot be edited.
    settled_kinds = {
        filing_id: _kind_from_doc_url(doc_url)
        for filing_id, doc_url in conn.execute(
            "SELECT filing_id, doc_url FROM filings"
            " WHERE chamber = 'senate' AND raw_path IS NOT NULL"
        )
    }
    for uuid in discovered.uuids:
        entry = discovered.entries[uuid]
        stored_kind = settled_kinds.get(f"senate:{uuid}")
        if stored_kind == entry.kind:
            continue
        html = _obtain_page(
            uuid=uuid,
            kind=entry.kind,
            raw_root=raw_root,
            session=session,
            cache_dir=cache_dir,
        )
        outcome = _process_uuid(conn, entry=entry, html=html, now=now)
        report.new_filings += 1
        report.rows_loaded += outcome.total_rows
        if stored_kind is not None:
            report.conversions += 1
        if outcome.declared_mismatch:
            report.declared_mismatches += 1
        if outcome.efile:
            report.clean_efile_rows += outcome.clean_rows
            report.total_efile_rows += outcome.total_rows
        if outcome.status == "failed":
            report.failure_kinds[outcome.failure_kind or "unknown"] += 1

    # The linkage pass runs over ALL amendment index rows, independent of
    # the settled skip, so a crash between upsert and linkage heals on the
    # next run (LD9 — idempotent).
    report.amendments_total, report.amendments_paired = _link_amendments(
        conn, discovered
    )
    # §9.5: both sides of every pair carry amendment_unresolved. The
    # loader delete-and-reinserts rows, so the flag is restored at every
    # job tail that rebuilds rows (here, reparse_senate, reparse_house).
    flag_unresolved_pair_rows(conn)
    report.reconciliation = reconcile(conn, discovered.uuids)


def _obtain_page(
    *,
    uuid: str,
    kind: str,
    raw_root: Path,
    session: _PoliteSession | None,
    cache_dir: Path | None,
) -> bytes | None:
    """Cached read or polite fetch + archive; ``None`` means fetch failure.

    Both the URL and the archive path are built only from an index row that
    already passed the href boundary validation, and the resolved path is
    proven to stay inside its root before any write.
    """
    relpath = _archive_relpath(kind, uuid)
    if cache_dir is not None:
        page_path = archive_path(cache_dir, relpath)
        if not page_path.exists():
            return None
        return page_path.read_bytes()
    assert session is not None
    response = session.get(DOC_URL_TEMPLATE.format(kind=kind, uuid=uuid))
    if response.status_code != 200:
        return None
    target = archive_path(raw_root, relpath)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return response.content


@dataclass(frozen=True)
class _Outcome:
    uuid: str
    status: str
    failure_kind: str | None
    efile: bool
    clean_rows: int
    total_rows: int
    declared_mismatch: bool


def _process_uuid(
    conn: sqlite3.Connection,
    *,
    entry: SenateIndexEntry,
    html: bytes | None,
    now: Callable[[], str],
) -> _Outcome:
    """Evaluate and atomically persist one UUID (upsert).

    A kind conversion rides the same path: the ON CONFLICT update replaces
    ``doc_url``/``raw_path``/``response_hash``/``filing_kind`` and the
    DELETE-then-insert row replace swaps the parsed set; an existing
    ``supersedes`` link survives (the upsert never touches it — the linkage
    pass owns that column).

    ``lifecycle`` is read back and replayed, never defaulted: ingest records
    only what parsing achieved, while lifecycle records the filing's
    standing (§9.4), and lifecycle stays untouched until real lifecycle
    writes land. Without this, a fetch-failed retry or a paper-to-e-file
    conversion would silently reactivate a ``superseded``/``retired``/
    ``withdrawn`` filing through ``upsert_filing``'s ON CONFLICT update.
    """
    filing_id = f"senate:{entry.uuid}"
    stored = conn.execute(
        "SELECT lifecycle FROM filings WHERE filing_id = ?", (filing_id,)
    ).fetchone()
    lifecycle = stored[0] if stored is not None else "active"
    if html is None:
        evaluated = EvaluatedPage(
            status="failed",
            failure_kind="fetch_failed",
            rows=(),
            clean_rows=0,
            total_rows=0,
            declared_total=None,
            declared_mismatch=False,
            efile=False,
        )
        raw_path = None
        response_hash = None
    else:
        evaluated = evaluate_page(
            html,
            uuid=entry.uuid,
            kind=entry.kind,
            filed_date=entry.filed_date,
            amendment=entry.amendment,
        )
        raw_path = _archive_relpath(entry.kind, entry.uuid)
        response_hash = hashlib.sha256(html).hexdigest()
    upsert_filing(
        conn,
        filing_id=filing_id,
        chamber="senate",
        filer_name_raw=entry.filer_name_raw,
        filing_kind=entry.filing_kind,
        filed_date=entry.filed_date,
        doc_url=entry.doc_url,
        source="senate-efd",
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
        uuid=entry.uuid,
        status=evaluated.status,
        failure_kind=evaluated.failure_kind,
        efile=evaluated.efile,
        clean_rows=evaluated.clean_rows,
        total_rows=evaluated.total_rows,
        declared_mismatch=evaluated.declared_mismatch,
    )


def _link_amendments(
    conn: sqlite3.Connection, discovered: SenateDiscoverResult
) -> tuple[int, int]:
    """§9.5 conservative pairing: ``supersedes`` only on an unambiguous
    original; zero or many candidates ⇒ NULL. No supersede automation, no
    lifecycle writes — that seam stays closed until supersede automation lands with real
    amended-filing fixtures (the empirical restate-vs-append study).

    An original is sought among (a) current-index non-amendment rows with the
    same filer and the same title report date, and (b) stored Senate ``ptr``
    filings with the same filer whose ``filed_date`` equals the title date —
    deduped by filing_id. Documented misses (off-by-one filed dates,
    out-of-window originals) leave the pair unresolved: visible via the
    permanent ``amendment_unresolved`` row flag, never double-counted
    (declared debt).
    """
    amendments = 0
    paired = 0
    for uuid in discovered.uuids:
        entry = discovered.entries[uuid]
        if not entry.amendment:
            continue
        amendments += 1
        candidates: set[str] = set()
        if entry.title_date is not None:
            for other_uuid in discovered.uuids:
                other = discovered.entries[other_uuid]
                if (
                    not other.amendment
                    and other.filer_name_raw == entry.filer_name_raw
                    and other.title_date == entry.title_date
                ):
                    candidates.add(f"senate:{other_uuid}")
            for (filing_id,) in conn.execute(
                "SELECT filing_id FROM filings WHERE chamber = 'senate'"
                " AND filing_kind = 'ptr' AND filer_name_raw = ?"
                " AND filed_date = ?",
                (entry.filer_name_raw, entry.title_date),
            ):
                candidates.add(filing_id)
        candidates.discard(f"senate:{uuid}")
        supersedes = candidates.pop() if len(candidates) == 1 else None
        if supersedes is not None:
            paired += 1
        conn.execute(
            "UPDATE filings SET supersedes = ? WHERE filing_id = ?",
            (supersedes, f"senate:{uuid}"),
        )
    return amendments, paired


# --- reparse ------------------------------------------------------------


def reparse_senate(
    conn: sqlite3.Connection,
    *,
    raw_root: Path | str,
    selector: ReparseSelector,
    read_archive: Callable[[Path], bytes] = Path.read_bytes,
) -> ReparseReport:
    """Reparse archived Senate filings atomically from the raw archive —
    never re-fetching (§9.3). The page kind derives from the stored
    ``doc_url`` (paper stays ``needs_ocr``), the amendment flag reproduces
    from the stored ``filing_kind``, and identity stability plus the atomic
    replace come from :func:`populus.load.load_filing`.
    """
    # Imported here, not at module top: the selection machinery lives in the
    # House module and a top-level sibling import would couple the chambers.
    from populus.ingest.house import ReparseReport, select_reparse_targets

    selection = select_reparse_targets(conn, selector, chamber="senate")
    statuses: dict[str, str] = {}
    for filing_id, raw_path in selection.targets:
        filed_date, doc_url, filing_kind = conn.execute(
            "SELECT filed_date, doc_url, filing_kind FROM filings"
            " WHERE filing_id = ?",
            (filing_id,),
        ).fetchone()
        html = read_archive(Path(raw_root) / raw_path)
        evaluated = evaluate_page(
            html,
            uuid=filing_id.split(":", 1)[1],
            kind=_kind_from_doc_url(doc_url),
            filed_date=filed_date,
            amendment=filing_kind == "ptr_amendment",
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
    # amendment_unresolved flag on both sides of every pair (§9.5).
    flag_unresolved_pair_rows(conn)
    return ReparseReport(selection=selection, statuses=statuses)


# --- summaries ----------------------------------------------------------------


def format_summary(
    report: SenateIngestReport, *, gate: ParseGateReport | None = None
) -> str:
    """The one-screen reconciliation summary the CLI prints.

    With a *gate* (the CLI computes one from the same connection before it
    closes), the summary also carries the per-era e-file gate lines, the per-era
    member-join lines, and the OWNER DECISION REQUIRED block whenever any era is
    ``miss`` or ``unmeasurable``.
    """
    lines: list[str] = []
    if report.window is not None:
        start, end = report.window
        lines.append(
            f"senate window: submitted {start} → {end or '(open end)'}"
            + ("" if end else " [derived/incremental]")
        )
    if report.note is not None:
        lines.append(f"senate | {report.note}")
    else:
        reconciliation = report.reconciliation
        counts = reconciliation.status_counts if reconciliation else {}
        kinds = report.failure_kinds
        # The split must always sum to the reconciled `failed` total. The
        # kind counters cover only THIS run's failures, so a filing that
        # failed to parse on an earlier run is archived, settled, and never
        # re-evaluated — its failure would vanish from every subtotal while
        # still being counted as failed. `archived_prior` carries exactly
        # that remainder, so the diagnostics can never be internally
        # inconsistent.
        fetch_failed = (
            reconciliation.failed_fetch
            if reconciliation
            else kinds.get("fetch_failed", 0)
        )
        missing_table = kinds.get("missing_table", 0)
        header_mismatch = kinds.get("header_mismatch", 0)
        archived_prior = (
            reconciliation.failed_archived - missing_table - header_mismatch
            if reconciliation
            else 0
        )
        failed_detail = (
            f"fetch_failed {fetch_failed},"
            f" missing_table {missing_table},"
            f" header_mismatch {header_mismatch},"
            f" archived_prior {max(archived_prior, 0)}"
        )
        lines.append(
            "senate"
            f" | index rows {report.index_count}"
            f" | parsed {counts.get('parsed', 0)}"
            f" | partial {counts.get('partial', 0)}"
            f" | needs_ocr {counts.get('needs_ocr', 0)}"
            f" | failed {counts.get('failed', 0)} ({failed_detail})"
            f" | conversions {report.conversions}"
            f" | amendments {report.amendments_total}"
            f" (paired {report.amendments_paired},"
            f" unpaired {report.amendments_total - report.amendments_paired})"
            f" | declared_mismatch {report.declared_mismatches}"
            f" | dup uuids {report.dup_uuids}"
        )
        if report.rejected_rows:
            lines.append(
                f"  REJECTED INDEX ROWS ({len(report.rejected_rows)}):"
                f" {'; '.join(report.rejected_rows[:5])}"
            )
        if reconciliation and reconciliation.unaccounted:
            lines.append(
                f"  UNACCOUNTED ({len(reconciliation.unaccounted)}):"
                f" {', '.join(reconciliation.unaccounted[:10])}"
            )
    if report.circuit_open_url is not None:
        lines.append(
            f"  CIRCUIT OPEN: {CIRCUIT_403_THRESHOLD} consecutive 403s;"
            f" last at {report.circuit_open_url} — job stopped, never retry"
            " harder (G6); diagnose the handshake before any rerun"
        )
    if report.total_efile_rows:
        rate = 100.0 * report.clean_efile_rows / report.total_efile_rows
        lines.append(
            f"efile rows: {report.clean_efile_rows} clean /"
            f" {report.total_efile_rows} total = {rate:.1f}%"
        )
    else:
        lines.append("efile rows: 0 clean / 0 total")
    lines.append(report.fetch.format_line("senate", elapsed_s=report.elapsed_s))
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
        "reparse congress-senate"
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
