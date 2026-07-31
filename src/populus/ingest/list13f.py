"""Ingest the SEC Official List of Section 13(f) Securities (RUN M2-5, R2/R8).

The fetch path goes exclusively through the RUN-M2-1 ``SecClient`` (politeness in
code, G6 — no second HTTP client); cache mode reads the same on-disk layout
offline. Each quarterly file is cached under ``data-cache/13flist/`` with a
``.meta.json`` sidecar carrying full §5.1 provenance (source_url, http_status,
bytes, sha256, retrieved_at, user_agent). No test reaches the network: the
transport is injected exactly like ``tests/test_inst_ingest.py`` and the autouse
no-network guard blocks any escape.

The quarter identity comes from the source URL / filename (Locked Decision 1),
cross-checked against the PDF's in-document ``Year: YYYY Qtr:N`` marker; the
legend "current as of" date is parsed but never used to set the interval (it is
stale boilerplate on some quarters). Where a quarter ships BOTH the text and PDF
variants (2026Q2), the two parses are held to full row-for-row identity (R5)
before the text variant is seeded.

Seeding itself is performed by ``identity.list13f_seed.bootstrap_13f_list``
inside ``identity.bootstrap.run_identity_bootstrap``'s single transaction
(Locked Decision 9); this module owns only the fetch/read/parse/select steps,
which run BEFORE that transaction (mirroring ``load_company_tickers`` /
``parse_ftd``).
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from populus.ingest import archive_path
from populus.net.sec_client import SecClient
from populus.parse.list13f import (
    ParsedList13f,
    assert_cross_format_identity,
    parse_list13f_pdf,
    parse_list13f_text,
    parse_quarter,
    quarter_bounds,
)

#: The SEC file endpoints. Verified live 2026-07-25 / cached 2026-07-30.
_PDF_URL = "https://www.sec.gov/files/investment/13flist{quarter}.pdf"
_TXT_URL = "https://www.sec.gov/files/investment/13flist{quarter}-txt.txt"

#: Quarters the SEC publishes in BOTH the PDF and the fixed-width text formats
#: (verified live 2026-07-25 — historical quarters are PDF-only, their text
#: variant 404s). For these the R5 cross-format identity gate is NON-NEGOTIABLE:
#: the text is only seedable after it is validated row-for-row against the PDF, so
#: a text-only cache (or a text-200/PDF-missing fetch) for such a quarter is
#: REFUSED rather than seeded blind (F2). The live fetcher additionally makes any
#: PDF non-200 a hard error (below), so the text-200/PDF-fail race cannot seed an
#: unvalidated text for ANY quarter, present or future.
_CROSS_FORMAT_REQUIRED_QUARTERS = frozenset({"2026q2"})

#: The ≥99.9% parse-coverage floor (R6): a seed variant below it is refused, so a
#: data-empty or badly-misparsed file can never be silently seeded (F4).
PARSE_COVERAGE_FLOOR = 0.999

#: Every §5.1 field a cached list's sidecar MUST carry. In cache mode the sidecar
#: is mandatory and verified against the raw bytes (F10) — never optional, never
#: trusted blind.
_REQUIRED_SIDECAR_FIELDS = (
    "source_url",
    "http_status",
    "bytes",
    "sha256",
    "retrieved_at",
    "user_agent",
)


def pdf_url(quarter: str) -> str:
    return _PDF_URL.format(quarter=quarter)


def txt_url(quarter: str) -> str:
    return _TXT_URL.format(quarter=quarter)


def quarter_from_url(url: str) -> str | None:
    """The ``YYYYqN`` quarter a list URL/filename names, or ``None``.

    The filename is authoritative for the quarter (Locked Decision 1); the PDF's
    in-document ``Year:/Qtr:`` header cross-checks it, and the legend date does
    not set it.
    """
    return parse_quarter(url)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class List13fIngestError(RuntimeError):
    """A quarter's list could not be fetched/read, or failed the R5 gate."""


def _verify_sidecar(
    meta: dict, *, content: bytes, expected_url: str, relpath: str
) -> None:
    """Schema-check a cached list's sidecar and verify it against the raw bytes.

    In cache mode the §5.1 sidecar is MANDATORY and is not trusted blind (F10):
    every required field must be present, the recorded sha256/bytes must match the
    file on disk, the status must be 200, and the URL must be the canonical SEC
    endpoint for this quarter/variant. A stale or wrong sidecar — the exact way a
    corrected source would slip through undetected — is a hard error, not a silent
    default-fill.
    """
    missing = [
        field
        for field in _REQUIRED_SIDECAR_FIELDS
        if field not in meta or meta[field] in (None, "")
    ]
    if missing:
        raise List13fIngestError(
            f"{relpath}: cache sidecar is missing required §5.1 fields {missing}"
            " — a cached list must carry full provenance, verified (R2/F10)"
        )
    actual_sha = _sha256(content)
    if str(meta["sha256"]).lower() != actual_sha:
        raise List13fIngestError(
            f"{relpath}: sidecar sha256 {meta['sha256']} does not match"
            f" sha256(bytes) {actual_sha} — the cache entry does not match its"
            " recorded content, so corrected-source detection cannot be trusted (F10)"
        )
    if int(meta["bytes"]) != len(content):
        raise List13fIngestError(
            f"{relpath}: sidecar bytes {meta['bytes']} != actual {len(content)} (F10)"
        )
    if int(meta["http_status"]) != 200:
        raise List13fIngestError(
            f"{relpath}: sidecar http_status {meta['http_status']} != 200 — only a"
            " 200 response is seedable; a 4xx/5xx is not an optional absent variant (F10)"
        )
    if str(meta["source_url"]) != expected_url:
        raise List13fIngestError(
            f"{relpath}: sidecar source_url {meta['source_url']!r} != the canonical"
            f" endpoint {expected_url!r} for this quarter/variant (F10)"
        )


def _decode_text(data: bytes, relpath: str) -> str:
    """STRICT-decode the fixed-width text variant (F9).

    Invalid bytes are a hard error, never repaired with U+FFFD replacement
    characters that would then be persisted into issuer names (G3).
    """
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise List13fIngestError(
            f"{relpath}: not valid UTF-8 ({exc}) — a corrupt text variant is a hard"
            " error, never silently repaired with replacement characters (F9)"
        ) from exc


def _validate_parse(parsed: ParsedList13f, *, quarter: str, variant: str) -> None:
    """Enforce the R6/F4 parse-coverage gate on a parsed variant before it seeds.

    A parse is seedable only when it actually read a data region: at least one
    data row, ≥99.9% of its data lines structurally recognized, and — for the PDF
    — an in-document ``Year:/Qtr:`` marker plus, when the SEC prints its own
    ``Total Count`` trailer, an exact match against the rows parsed. This is what
    stops a cover-and-legend-only PDF (``rows_read=0``) from seeding a quarter
    empty at ``parse_coverage=1.0`` (F4).
    """
    disposition = parsed.disposition
    if disposition.rows_read == 0:
        raise List13fIngestError(
            f"quarter {quarter} {variant}: zero data rows parsed — a file with a"
            " cover and legend but no data region is not a seedable list (R6/F4)"
        )
    coverage = disposition.parse_coverage
    if coverage < PARSE_COVERAGE_FLOOR:
        raise List13fIngestError(
            f"quarter {quarter} {variant}: parse coverage {coverage:.6f} <"
            f" {PARSE_COVERAGE_FLOOR} — too many unrecognized data lines to seed (R6/F4)"
        )
    if variant == "pdf":
        if parsed.document_quarter is None:
            raise List13fIngestError(
                f"quarter {quarter} pdf: no in-document 'Year:/Qtr:' marker found —"
                " the document does not confirm which quarter it is (R6/F4)"
            )
        if (
            parsed.document_total_count is not None
            and parsed.document_total_count != disposition.rows_read
        ):
            raise List13fIngestError(
                f"quarter {quarter} pdf: the SEC 'Total Count'"
                f" {parsed.document_total_count} != {disposition.rows_read} data rows"
                " parsed — the parse dropped or gained rows (R6/F4)"
            )


@dataclass(frozen=True)
class LoadedQuarter:
    """One quarter's parsed list, ready to seed, with its retrieval provenance.

    ``parsed`` is the variant that will be SEEDED (the text variant where a
    quarter ships one, else the PDF). ``source_meta`` is that variant's sidecar
    plus its cache-relative ``raw_path``. ``cross_format_checked`` records
    whether the R5 identity gate ran (both formats present).
    """

    quarter: str
    parsed: ParsedList13f
    source_meta: dict
    cross_format_checked: bool


def _quarter_from_document(parsed: ParsedList13f, quarter: str) -> None:
    """Cross-check the PDF's in-document quarter marker against the filename."""
    document_quarter = parsed.document_quarter
    if document_quarter is not None and document_quarter != quarter:
        raise List13fIngestError(
            f"quarter mismatch for {quarter}: the PDF's in-document marker says"
            f" {document_quarter!r} — the filename is authoritative, so this is a"
            " corrupt or misnamed file"
        )


# --- cache source (offline; the dev + test + acceptance path) -----------------


class _CacheSource:
    """Reads the committed ``data-cache/13flist/`` layout; no network."""

    def __init__(self, cache_dir: Path | str) -> None:
        self._root = Path(cache_dir)

    def available_quarters(self) -> set[str]:
        found: set[str] = set()
        if not self._root.is_dir():
            return found
        for child in self._root.iterdir():
            name = child.name
            if not child.is_file() or not name.startswith("13flist"):
                continue
            if name.endswith(".meta.json"):
                continue
            quarter = parse_quarter(name)
            if quarter is not None and (
                name.endswith(".pdf") or name.endswith("-txt.txt")
            ):
                found.add(quarter)
        return found

    def _read(self, filename: str, expected_url: str) -> tuple[bytes, dict] | None:
        path = self._root / filename
        if not path.exists():
            # A genuinely absent variant (the documented historical text 404) is
            # the ONLY optional case; a present file with a missing/bad sidecar is
            # a hard error, decided in _verify_sidecar (F10).
            return None
        content = path.read_bytes()
        meta_path = self._root / f"{filename}.meta.json"
        if not meta_path.exists():
            raise List13fIngestError(
                f"{filename}: present in the cache but its .meta.json sidecar is"
                " absent — every cached list must carry full §5.1 provenance (R2/F10)"
            )
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            # A corrupt sidecar is a hard, TYPED error like every other provenance
            # failure — not a raw JSONDecodeError leaking out of the ingest layer,
            # and never a fall-back to an empty metadata object (F5).
            raise List13fIngestError(
                f"{filename}: .meta.json sidecar is not valid JSON ({exc}) — a"
                " cached list's provenance must be readable and verified, never"
                " assumed (R2/§5.1)"
            ) from exc
        if not isinstance(meta, dict):
            raise List13fIngestError(
                f"{filename}: .meta.json sidecar is a {type(meta).__name__}, not a"
                " JSON object carrying the §5.1 provenance fields (R2)"
            )
        _verify_sidecar(
            meta, content=content, expected_url=expected_url, relpath=filename
        )
        return content, meta

    def load(self, quarter: str) -> LoadedQuarter:
        return _load_quarter(
            quarter,
            txt=self._read(f"13flist{quarter}-txt.txt", txt_url(quarter)),
            pdf=self._read(f"13flist{quarter}.pdf", pdf_url(quarter)),
            txt_relpath=f"13flist{quarter}-txt.txt",
            pdf_relpath=f"13flist{quarter}.pdf",
        )


# --- live source (through the SecClient; exercised only via an injected transport) --


class _LiveSource:
    """Fetches through the ``SecClient``, archives raw bytes, writes sidecars."""

    def __init__(
        self, client: SecClient, raw_root: Path | str, now: Callable[[], str]
    ) -> None:
        self._client = client
        self._root = Path(raw_root)
        self._now = now

    def _obtain(
        self, url: str, relpath: str, *, optional_404: bool = False
    ) -> tuple[bytes, dict] | None:
        response = self._client.get(url)
        if response.status_code != 200:
            # ONLY a 404 on the historical text variant is an optional absent
            # format (the caller falls back to the PDF). Every other non-200 —
            # including a PDF 404 or any 403/500 — is a hard error, so a 403/500
            # can never be misreported as an optional absent format, and a live
            # text-200/PDF-fail race aborts the quarter instead of seeding the
            # text unvalidated (F2/F10).
            if optional_404 and response.status_code == 404:
                return None
            raise List13fIngestError(
                f"{url}: HTTP {response.status_code} — only the historical text"
                " variant may 404 (optional); every other non-200 is a hard error"
            )
        content = response.content
        target = archive_path(self._root, relpath)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        meta = {
            "source_url": url,
            "http_status": response.status_code,
            "bytes": len(content),
            "sha256": _sha256(content),
            "retrieved_at": self._now(),
            "user_agent": self._client.user_agent,
        }
        archive_path(self._root, f"{relpath}.meta.json").write_text(
            json.dumps(meta, indent=1) + "\n", encoding="utf-8"
        )
        return content, meta

    def load(self, quarter: str) -> LoadedQuarter:
        txt = self._obtain(
            txt_url(quarter), f"13flist{quarter}-txt.txt", optional_404=True
        )
        pdf = self._obtain(pdf_url(quarter), f"13flist{quarter}.pdf")
        return _load_quarter(
            quarter,
            txt=txt,
            pdf=pdf,
            txt_relpath=f"13flist{quarter}-txt.txt",
            pdf_relpath=f"13flist{quarter}.pdf",
        )


def _meta_with_defaults(
    meta: dict, *, content: bytes, url: str, relpath: str
) -> dict:
    """Fill a sidecar's §5.1 fields, deriving the sha from bytes when absent."""
    enriched = dict(meta)
    enriched.setdefault("source_url", url)
    enriched.setdefault("sha256", _sha256(content))
    enriched["raw_path"] = relpath
    return enriched


def _load_quarter(
    quarter: str,
    *,
    txt: tuple[bytes, dict] | None,
    pdf: tuple[bytes, dict] | None,
    txt_relpath: str,
    pdf_relpath: str,
) -> LoadedQuarter:
    """Parse a quarter's variant(s), run R5 where both are present, pick the seed
    variant (text preferred), and assemble its provenance sidecar."""
    if txt is None and pdf is None:
        raise List13fIngestError(
            f"no cached list for quarter {quarter}"
            f" (looked for {txt_relpath} and {pdf_relpath})"
        )
    # F2: a quarter the SEC ships in BOTH formats must be present in both and pass
    # R5 before its text is seedable. A missing side (a text-only cache, or a
    # PDF-only cache for the dual-format quarter) is refused, never seeded blind.
    if quarter in _CROSS_FORMAT_REQUIRED_QUARTERS and (txt is None or pdf is None):
        present = "text" if txt is not None else "pdf"
        raise List13fIngestError(
            f"quarter {quarter} ships in both formats and its R5 cross-format gate"
            f" is mandatory, but only the {present} variant is available — refusing"
            " to seed a dual-format quarter without the row-for-row identity check (F2)"
        )
    pdf_parsed: ParsedList13f | None = None
    if pdf is not None:
        pdf_parsed = parse_list13f_pdf(pdf[0], quarter=quarter)
        _quarter_from_document(pdf_parsed, quarter)
        _validate_parse(pdf_parsed, quarter=quarter, variant="pdf")

    if txt is not None:
        txt_parsed = parse_list13f_text(
            _decode_text(txt[0], txt_relpath), quarter=quarter
        )
        _validate_parse(txt_parsed, quarter=quarter, variant="text")
        cross_checked = False
        if pdf_parsed is not None:
            assert_cross_format_identity(txt_parsed, pdf_parsed)
            cross_checked = True
        if quarter in _CROSS_FORMAT_REQUIRED_QUARTERS and not cross_checked:
            # Unreachable given the both-present guard above; asserted so a future
            # refactor cannot resurrect an unvalidated seedable dual-format quarter.
            raise List13fIngestError(
                f"quarter {quarter}: the mandatory R5 cross-format check did not run (F2)"
            )
        return LoadedQuarter(
            quarter=quarter,
            parsed=txt_parsed,
            source_meta=_meta_with_defaults(
                txt[1], content=txt[0], url=txt_url(quarter), relpath=txt_relpath
            ),
            cross_format_checked=cross_checked,
        )
    # PDF only (historical quarters).
    assert pdf is not None and pdf_parsed is not None
    return LoadedQuarter(
        quarter=quarter,
        parsed=pdf_parsed,
        source_meta=_meta_with_defaults(
            pdf[1], content=pdf[0], url=pdf_url(quarter), relpath=pdf_relpath
        ),
        cross_format_checked=False,
    )


# --- backfill selection (R8) --------------------------------------------------


def select_backfill_quarters(
    conn: sqlite3.Connection,
    available: Iterable[str],
    *,
    start_quarter: str | None = None,
) -> list[str]:
    """The quarters to seed, from those *available* in the source (R8).

    With ``start_quarter`` the operator seeds every available quarter at or after
    it (the fresh-database path, where no periods are loaded yet). Otherwise the
    default is every available quarter whose interval covers a ``period_of_report``
    already loaded in the institutional corpus — so a populated database seeds
    exactly the lists its holdings need.
    """
    quarters = sorted(set(available))
    if start_quarter is not None:
        canonical = parse_quarter(start_quarter)
        if canonical is None:
            raise List13fIngestError(
                f"--list13f-start-quarter {start_quarter!r} is not a YYYYqN tag"
            )
        return [quarter for quarter in quarters if quarter >= canonical]
    try:
        periods = [
            period
            for (period,) in conn.execute(
                "SELECT DISTINCT period_of_report FROM v_default_inst_filings"
                " WHERE period_of_report IS NOT NULL"
            )
        ]
    except sqlite3.OperationalError:
        # No inst view yet (a registry-only database) — nothing to cover.
        periods = []
    if not periods:
        return []
    covering: list[str] = []
    for quarter in quarters:
        start, next_start = quarter_bounds(quarter)
        if any(start <= period < next_start for period in periods):
            covering.append(quarter)
    return covering


# --- the prepare step (load + parse + R5), run BEFORE the seed transaction -----


def prepare_list13f_quarters(
    source: _CacheSource | _LiveSource,
    quarters: Iterable[str],
) -> list[LoadedQuarter]:
    """Load and parse each requested quarter (no DB writes).

    Kept out of the seed transaction on purpose — parsing (and the R5 gate) can
    fail on a corrupt file, and that must not leave a half-open ``BEGIN``, so it
    runs first exactly like ``load_company_tickers`` / ``parse_ftd``.
    """
    return [source.load(quarter) for quarter in sorted(set(quarters))]
