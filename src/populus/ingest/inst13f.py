"""Institutional 13F ingest orchestration (ARCHITECTURE.md §10.2 — RUN M2-2).

The only inst module that touches the network, and it does so exclusively
through the RUN-M2-1 ``SecClient`` (politeness in code, G6). Cache mode reads
the same on-disk layout offline; **no test reaches the network** (the transport
is injected and the autouse no-network guard blocks any escape).

Flow, per CIK: discover 13F accessions from ``submissions.json`` (+ the per-CIK
``submissions-meta.json`` retrieval sidecar) → obtain each accession's
``index.json`` / ``primary_doc.xml`` / the info table discovered from the index
→ ``evaluate_filing`` (the single status-decision point, incl. the persisted
failed-cover outcome, R18) → atomic per-filing load. After every filing loads:
amendment lineage, affiliated-coverage stamping (both over the restatement-
survivor candidate set), reconciliation, and the never-inflated coverage inputs
the M2 ≥95% gate consumes at M2-3 publish time (R16).

Library code never reads the wall clock: ``now``/``run_id``/``host`` and the
per-run ``ingested_at`` are injected by the CLI, and ``retrieved_at`` comes from
committed sidecars (a missing sidecar → NULL + a flag, never the clock; R15/R19).
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from populus.identity.registry import normalize_cik, resolve_cusip
from populus.ingest import UnsafeArchivePathError, archive_path
from populus.load import (
    InstFilingRow,
    InstParsedRow,
    upsert_inst_filer,
    upsert_inst_filing,
)
from populus.net.sec_client import SecCircuitOpenError, SecClient
from populus.normalize_inst import (
    INST_DATA_NOTE,
    NORMALIZATION_VERSION,
    filing_reconciliation,
    inst_has_parse_defect,
    normalize_holding,
    unit_basis_for,
)
from populus.parse.inst13f import (
    PARSER_VERSION,
    CoverParseError,
    InfoTableAmbiguousError,
    InfoTableMissingError,
    InfoTableParseError,
    discover_info_table_name,
    normalize_file_number,
    parse_cover,
    parse_info_table,
)

_SUBMISSION_TYPES = ("13F-HR", "13F-HR/A", "13F-NT", "13F-NT/A")
_NOTICE_TYPES = ("13F-NT", "13F-NT/A")
_CIK_DIR = re.compile(r"CIK(\d{10})")
#: The canonical dashed SEC accession number, e.g. `0001193125-26-226661`. Remote
#: values are validated against this BEFORE being interpolated into any cache
#: path or SEC URL (QA-F3).
_ACCESSION_RE = re.compile(r"\d{10}-\d{2}-\d{6}")
#: Canonical ISO calendar date, as the index must supply it (QA-F5).
_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _is_iso_date(value: object) -> bool:
    """True only for a real canonical ``YYYY-MM-DD`` calendar date."""
    if not isinstance(value, str) or not _ISO_DATE_RE.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _submissions_url(cik10: str) -> str:
    return f"https://data.sec.gov/submissions/CIK{cik10}.json"


def _shard_url(name: str) -> str:
    """An older submissions shard. *name* is validated against ``_SHARD_RE``
    before it ever reaches here, so no remote value shapes the path."""
    return f"https://data.sec.gov/submissions/{name}"


def _archive_base(cik10: str, accession_nodash: str) -> str:
    # The Archives path uses the CIK with leading zeros stripped (verified
    # 2026-07-24: .../edgar/data/1067983/..., not .../0001067983/...).
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik10)}/{accession_nodash}"
    )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- obtained document + the two sources (cache / live) ----------------------


@dataclass(frozen=True)
class _Doc:
    content: bytes
    url: str
    raw_path: str            # relative to the archive/cache root (deterministic)
    response_hash: str
    retrieved_at: str | None
    meta_missing: bool = False


class _CacheSource:
    """Reads the committed offline layout; provenance timestamps from sidecars."""

    def __init__(self, cache_dir: Path) -> None:
        self._root = cache_dir
        self._fetch_meta: dict[str, dict] = {}

    def _read(self, relpath: str) -> bytes:
        return archive_path(self._root, relpath).read_bytes()

    def _fetch_meta_for(self, cik10: str, accession_nodash: str) -> tuple[str | None, bool]:
        key = f"CIK{cik10}/{accession_nodash}"
        if key not in self._fetch_meta:
            path = self._root / f"CIK{cik10}" / accession_nodash / "fetch-meta.json"
            self._fetch_meta[key] = (
                json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            )
        meta = self._fetch_meta[key]
        return meta.get("retrieved_at"), not meta

    def submissions_shard(self, cik10: str, name: str) -> _Doc:
        """An older ``filings.files[]`` shard, from the same local cache.

        Mirrors :meth:`submissions` exactly — same sidecar provenance, same
        ``raw_path`` discipline. (The first draft passed a non-existent
        ``from_cache`` field and omitted the required ``raw_path``, so every
        call raised ``TypeError``; it was never exercised because the tests
        drove only the federated source — QA-r4-F2.)
        """
        relpath = f"CIK{cik10}/{name}"
        content = self._read(relpath)
        meta_path = self._root / f"CIK{cik10}" / "submissions-meta.json"
        retrieved_at: str | None = None
        meta_missing = True
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            retrieved_at = meta.get("retrieved_at")
            meta_missing = False
        return _Doc(
            content=content,
            url=_shard_url(name),
            raw_path=relpath,
            response_hash=_sha256(content),
            retrieved_at=retrieved_at,
            meta_missing=meta_missing,
        )

    def submissions(self, cik10: str) -> _Doc:
        content = self._read(f"CIK{cik10}/submissions.json")
        meta_path = self._root / f"CIK{cik10}" / "submissions-meta.json"
        retrieved_at: str | None = None
        meta_missing = True
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            retrieved_at = meta.get("retrieved_at")
            meta_missing = False
        return _Doc(
            content=content,
            url=_submissions_url(cik10),
            raw_path=f"CIK{cik10}/submissions.json",
            response_hash=_sha256(content),
            retrieved_at=retrieved_at,
            meta_missing=meta_missing,
        )

    def _accession_doc(self, cik10: str, accession_nodash: str, filename: str) -> _Doc:
        relpath = f"CIK{cik10}/{accession_nodash}/{filename}"
        content = self._read(relpath)
        retrieved_at, meta_missing = self._fetch_meta_for(cik10, accession_nodash)
        return _Doc(
            content=content,
            url=f"{_archive_base(cik10, accession_nodash)}/{filename}",
            raw_path=relpath,
            response_hash=_sha256(content),
            retrieved_at=retrieved_at,
            meta_missing=meta_missing,
        )

    def index(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._accession_doc(cik10, accession_nodash, "index.json")

    def cover(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._accession_doc(cik10, accession_nodash, "primary_doc.xml")

    def table(self, cik10: str, accession_nodash: str, filename: str) -> _Doc:
        return self._accession_doc(cik10, accession_nodash, filename)

    def ciks(self) -> list[str]:
        found: list[str] = []
        for child in sorted(self._root.iterdir()):
            match = _CIK_DIR.fullmatch(child.name)
            if child.is_dir() and match is not None:
                found.append(match.group(1))
        return found

    def write_fetch_meta(self, *args, **kwargs) -> None:  # cache never writes
        return None


class _LiveSource:
    """Fetches through the SecClient, archives raw bytes, writes the sidecars."""

    def __init__(self, client: SecClient, raw_root: Path, now: Callable[[], str]) -> None:
        self._client = client
        self._root = raw_root
        self._now = now

    def _obtain(self, url: str, relpath: str) -> _Doc:
        response = self._client.get(url)
        content = response.content
        target = archive_path(self._root, relpath)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return _Doc(
            content=content,
            url=url,
            raw_path=relpath,
            response_hash=_sha256(content),
            retrieved_at=self._now(),
        )

    def submissions_shard(self, cik10: str, name: str) -> _Doc:
        return self._obtain(_shard_url(name), f"CIK{cik10}/{name}")

    def submissions(self, cik10: str) -> _Doc:
        doc = self._obtain(_submissions_url(cik10), f"CIK{cik10}/submissions.json")
        meta = {
            "retrieved_at": doc.retrieved_at,
            "source_url": doc.url,
            "response_hash": doc.response_hash,
        }
        (self._root / f"CIK{cik10}" / "submissions-meta.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )
        return doc

    def index(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/index.json",
            f"CIK{cik10}/{accession_nodash}/index.json",
        )

    def cover(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/primary_doc.xml",
            f"CIK{cik10}/{accession_nodash}/primary_doc.xml",
        )

    def table(self, cik10: str, accession_nodash: str, filename: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/{filename}",
            f"CIK{cik10}/{accession_nodash}/{filename}",
        )

    def ciks(self) -> list[str]:
        return []

    def write_fetch_meta(
        self, cik10: str, accession_nodash: str, docs: Sequence[_Doc]
    ) -> None:
        meta = {
            "retrieved_at": max(d.retrieved_at for d in docs if d.retrieved_at),
            "documents": {
                d.raw_path.rsplit("/", 1)[-1]: {
                    "source_url": d.url,
                    "response_hash": d.response_hash,
                }
                for d in docs
            },
        }
        (self._root / f"CIK{cik10}" / accession_nodash / "fetch-meta.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )


# --- discovery ----------------------------------------------------------------


@dataclass(frozen=True)
class InstIndexEntry:
    cik: str
    accession: str            # dashed
    accession_nodash: str
    form: str                 # submission_type
    report_date: str          # ISO
    filing_date: str          # ISO
    file_number: str | None
    filer_name: str


@dataclass(frozen=True)
class _Discovery:
    filer_name: str
    submissions: _Doc
    entries: tuple[InstIndexEntry, ...]
    rejected: tuple[str, ...]        # accessions rejected for missing index dates
    uncached: tuple[str, ...]        # 13F accessions not present in the cache (LD-6)
    older_shards: int                # files[] shards present
    #: Shards that were requested but could NOT be read (malformed name, or a
    #: fetch/parse failure). Non-empty means the discovered history is
    #: INCOMPLETE and callers must say so rather than imply exhaustiveness (G3).
    unread_shards: tuple[str, ...] = ()


#: A submissions shard filename, e.g. ``CIK0001067983-submissions-001.json``.
#: Remote input interpolated into a URL and a cache path, so it is validated to
#: this exact shape before use — same discipline as ``_ACCESSION_RE`` (QA-F3).
_SHARD_RE = re.compile(r"CIK\d{10}-submissions-\d{3}\.json")


def discover(
    source, cik10: str, *, cache_bounded: bool, include_history: bool = False
) -> _Discovery:
    """Discover a CIK's 13F accessions from ``submissions.json`` (R1/R18/R19).

    ``include_history`` additionally READS the older ``filings.files[]`` shards
    (TD-M2-2-3, closed for this path by QA-r3-F4). SEC keeps only a recent
    window inline; a filer with a long history keeps older filings in shards, so
    without this an explicitly-requested historical period returned a FALSE
    "no 13F-HR at that period". The M2-2 ingest path leaves it off, so its cost
    and behaviour are unchanged.
    """
    submissions = source.submissions(cik10)
    document = json.loads(submissions.content.decode("utf-8"))
    filer_name = document.get("name") or ""
    recent = document.get("filings", {}).get("recent", {})
    shards = document.get("filings", {}).get("files", []) or []

    entries: list[InstIndexEntry] = []
    rejected: list[str] = []
    uncached: list[str] = []
    unread_shards: list[str] = []

    def _harvest(recent: dict) -> None:
        accessions = recent.get("accessionNumber", [])
        forms = recent.get("form", [])
        report_dates = recent.get("reportDate", [])
        filing_dates = recent.get("filingDate", [])
        file_numbers = recent.get("fileNumber", [])
        _harvest_records(
            accessions, forms, report_dates, filing_dates, file_numbers
        )

    seen_accessions: set[str] = set()

    def _harvest_records(
        accessions, forms, report_dates, filing_dates, file_numbers
    ) -> None:
        for i, accession in enumerate(accessions):
            form = forms[i] if i < len(forms) else ""
            if form not in _SUBMISSION_TYPES:
                continue
            # The accession is REMOTE input and is interpolated into cache paths and
            # live SEC URLs, so require the canonical dashed SEC form
            # (##########-##-######) BEFORE deriving the no-dash variant or touching
            # the filesystem. A malformed or path-bearing value (separators,
            # traversal, wrong length, non-string) is a counted discovery reject —
            # never a filesystem escape, an unintended request, or an aborted run.
            # (QA-F3)
            if not isinstance(accession, str) or not _ACCESSION_RE.fullmatch(accession):
                rejected.append(str(accession))
                continue
            report_date = report_dates[i] if i < len(report_dates) else ""
            filing_date = filing_dates[i] if i < len(filing_dates) else ""
            # Both dates must be REAL canonical ISO dates, not merely non-empty: the
            # failed-cover record persists them as temporal keys and `unit_basis_for`
            # parses `filed_date`, so a malformed remote value would either abort the
            # run downstream or persist an invalid key. Validate here and count it as
            # a discovery reject instead (QA-F5, R18/G3).
            if not (_is_iso_date(report_date) and _is_iso_date(filing_date)):
                rejected.append(accession)
                continue
            nodash = accession.replace("-", "")
            if cache_bounded and not (
                source._root / f"CIK{cik10}" / nodash / "index.json"
            ).exists():
                uncached.append(accession)
                continue
            if accession in seen_accessions:
                # `recent` and `files[]` are documented as disjoint, but a
                # repeated accession would be composed TWICE — and a NEW HOLDINGS
                # amendment applied twice inflates the position list while still
                # reporting completeness (QA-VERIFY4-N2). Merge semantics are
                # multiplicity-sensitive, so dedup at the source.
                continue
            seen_accessions.add(accession)
            entries.append(
                InstIndexEntry(
                    cik=cik10,
                    accession=accession,
                    accession_nodash=nodash,
                    form=form,
                    report_date=report_date,
                    filing_date=filing_date,
                    file_number=(file_numbers[i] if i < len(file_numbers) else None) or None,
                    filer_name=filer_name,
                )
            )

    _harvest(recent)
    if include_history:
        for shard in shards:
            name = shard.get("name") if isinstance(shard, dict) else None
            if not isinstance(name, str) or not _SHARD_RE.fullmatch(name):
                unread_shards.append(str(name))
                continue
            try:
                shard_doc = source.submissions_shard(cik10, name)
                _harvest(json.loads(shard_doc.content.decode("utf-8")))
            except Exception:  # noqa: BLE001 — one bad shard must not lose the rest
                # Degrade honestly: the shard is recorded as unread so the
                # caller can say the history is incomplete (G3), never silently
                # present a partial history as complete.
                unread_shards.append(name)
    return _Discovery(
        filer_name=filer_name,
        submissions=submissions,
        entries=tuple(entries),
        rejected=tuple(rejected),
        uncached=tuple(uncached),
        older_shards=len(shards),
        unread_shards=tuple(unread_shards),
    )


# --- the single status-decision point (R14/G3/R18) ---------------------------


@dataclass(frozen=True)
class FilingOutcome:
    filing: InstFilingRow
    holdings: tuple[InstParsedRow, ...]
    status: str
    failure_kind: str | None


def _to_int_flag(value: bool | None) -> int | None:
    return None if value is None else int(value)


def evaluate_filing(
    entry: InstIndexEntry,
    source,
    *,
    resolve_security: Callable[[str, str], str | None],
    ingested_at: str,
) -> FilingOutcome:
    """Decide one accession's outcome and build its loadable filing + holdings.

    Every discovered accession ends in exactly one accounted status (G3),
    including a cover-parse failure — which is persisted from the validated
    submissions-index metadata rather than aborting the run or dropping the
    accession (R18/LD-12).
    """
    index_doc = source.index(entry.cik, entry.accession_nodash)
    cover_doc = source.cover(entry.cik, entry.accession_nodash)
    unit_basis = unit_basis_for(entry.filing_date)

    try:
        cover = parse_cover(cover_doc.content)
    except CoverParseError as exc:
        return _failed_cover_outcome(
            entry, index_doc, cover_doc, unit_basis=unit_basis,
            failure_kind=exc.kind, ingested_at=ingested_at,
        )

    is_notice = entry.form in _NOTICE_TYPES
    table_doc: _Doc | None = None
    table_name: str | None = None
    holdings: list[InstParsedRow] = []
    status = "parsed"
    failure_kind: str | None = None
    extra_flags: set[str] = set()

    if is_notice:
        extra_flags.add("notice_no_table")
        reconciliation = filing_reconciliation(
            table_entry_total=cover.table_entry_total,
            table_value_total=cover.table_value_total,
            unit_basis=unit_basis,
            holdings=[],
        )
    else:
        try:
            table_name = discover_info_table_name(index_doc.content)
            table_doc = source.table(entry.cik, entry.accession_nodash, table_name)
            rows = parse_info_table(table_doc.content)
        except (
            InfoTableMissingError,
            InfoTableAmbiguousError,
            InfoTableParseError,
            FileNotFoundError,
        ) as exc:
            failure_kind = {
                InfoTableMissingError: "infotable_missing",
                InfoTableAmbiguousError: "infotable_ambiguous",
                InfoTableParseError: "infotable_malformed",
                FileNotFoundError: "infotable_missing",
            }[type(exc)]
            status = "failed"
            table_doc = None
            # Cover parsed, so the reported total is KNOWN and still counts for
            # coverage (F3): a failed zero-row filing drags coverage down.
            reconciliation = filing_reconciliation(
                table_entry_total=cover.table_entry_total,
                table_value_total=cover.table_value_total,
                unit_basis=unit_basis,
                holdings=[],
            )
        else:
            normalized = [
                normalize_holding(
                    row,
                    unit_basis=unit_basis,
                    period_of_report=cover.period_of_report,
                    resolve_security=resolve_security,
                )
                for row in rows
            ]
            holdings = [_to_parsed_row(h) for h in normalized]
            reconciliation = filing_reconciliation(
                table_entry_total=cover.table_entry_total,
                table_value_total=cover.table_value_total,
                unit_basis=unit_basis,
                holdings=normalized,
            )
            if any(inst_has_parse_defect(h.flags) for h in normalized) or (
                reconciliation.entry_total_mismatch
            ):
                status = "partial"

    # The EDGAR submission type is authoritative for amendment-ness; the cover's
    # <isAmendment> is self-declared and may be absent or wrong. Trusting the
    # cover alone let a `13F-HR/A` whose cover omits the element be composed as a
    # BASE — which REPLACES the base's positions, so a 4-row NEW HOLDINGS
    # amendment was returned as a complete 110-row portfolio with
    # `composition_complete: True`. That is QA-F2 through a second door, and
    # absence of the element is the NORMAL case (real base covers omit it).
    # Decided once, here, so the pipeline and the federated plane agree.
    form_says_amendment = entry.form.endswith("/A")
    is_amendment = bool(cover.is_amendment) or form_says_amendment
    if bool(cover.is_amendment) != form_says_amendment:
        # Flagged in BOTH directions (QA-VERIFY4-N5): a plain `13F-HR` whose
        # cover carries a stray <isAmendment>true</isAmendment> is the safe
        # direction, but it is still a contradiction between the authoritative
        # submission type and the self-declared cover, and it silently turned an
        # ordinary base filing into "an amendment of unstated type".
        extra_flags = set(extra_flags) | {"cover_amendment_flag_contradicts_form"}
    flags = _filing_flags(cover, reconciliation, extra_flags, cover_doc, table_doc, index_doc)
    filing = InstFilingRow(
        filing_id=f"inst:{entry.accession}",
        cik=entry.cik,
        accession=entry.accession,
        submission_type=entry.form,
        period_of_report=cover.period_of_report,
        filed_date=entry.filing_date,
        form_version=cover.schema_version,
        unit_basis=unit_basis,
        is_amendment=int(is_amendment),
        amendment_type=cover.amendment_type,
        amendment_no=cover.amendment_no,
        amends=None,
        is_confidential_omitted=_to_int_flag(cover.is_confidential_omitted),
        conf_denied_expired=_to_int_flag(cover.conf_denied_expired),
        filing_manager_raw=cover.filing_manager,
        form13f_file_number=cover.form13f_file_number,
        file_number_norm=cover.file_number_norm,
        report_type=cover.report_type,
        other_managers=[m.as_dict() for m in cover.other_managers],
        table_entry_total=reconciliation.table_entry_total,
        table_value_total=reconciliation.table_value_total,
        table_value_total_usd=reconciliation.table_value_total_usd,
        row_count=reconciliation.row_count,
        sum_value_usd=reconciliation.sum_value_usd,
        value_total_delta=reconciliation.value_total_delta,
        resolved_rows=reconciliation.resolved_rows,
        resolved_value_usd=reconciliation.resolved_value_usd,
        parse_status=status,
        failure_kind=failure_kind,
        flags=sorted(flags),
        doc_url=cover_doc.url,
        table_url=table_doc.url if table_doc else None,
        table_filename=table_name,
        table_raw_path=table_doc.raw_path if table_doc else None,
        source_url=cover_doc.url,
        retrieved_at=_max_retrieved_at(index_doc, cover_doc, table_doc),
        raw_path=f"CIK{entry.cik}/{entry.accession_nodash}",
        index_response_hash=index_doc.response_hash,
        response_hash=cover_doc.response_hash,
        table_response_hash=table_doc.response_hash if table_doc else None,
        parser_version=PARSER_VERSION,
        normalization_version=NORMALIZATION_VERSION,
        ingested_at=ingested_at,
    )
    return FilingOutcome(
        filing=filing, holdings=tuple(holdings), status=status, failure_kind=failure_kind
    )


def _failed_cover_outcome(
    entry: InstIndexEntry,
    index_doc: _Doc,
    cover_doc: _Doc,
    *,
    unit_basis: str,
    failure_kind: str,
    ingested_at: str,
) -> FilingOutcome:
    """R18: persist a failed cover from validated submissions-index metadata,
    with a NULL ``table_value_total_usd`` (value unknown), and continue."""
    flags = {"cover_failed"}
    retrieved_at = _max_retrieved_at(index_doc, cover_doc, None)
    if retrieved_at is None:
        flags.add("retrieved_at_unknown")
    filing = InstFilingRow(
        filing_id=f"inst:{entry.accession}",
        cik=entry.cik,
        accession=entry.accession,
        submission_type=entry.form,
        period_of_report=entry.report_date,
        filed_date=entry.filing_date,
        form_version=None,
        unit_basis=unit_basis,
        is_amendment=int(entry.form.endswith("/A")),
        amendment_type=None,
        amendment_no=None,
        amends=None,
        is_confidential_omitted=None,
        conf_denied_expired=None,
        filing_manager_raw=entry.filer_name,
        form13f_file_number=None,
        file_number_norm=None,
        report_type=None,
        other_managers=[],
        table_entry_total=None,
        table_value_total=None,
        table_value_total_usd=None,   # value unknown — never inflate the denominator (R16/F7)
        row_count=0,
        sum_value_usd=None,
        value_total_delta=None,
        resolved_rows=0,
        resolved_value_usd=None,
        parse_status="failed",
        failure_kind=failure_kind,
        flags=sorted(flags),
        doc_url=cover_doc.url,
        table_url=None,
        table_filename=None,
        table_raw_path=None,
        source_url=cover_doc.url,
        retrieved_at=retrieved_at,
        raw_path=f"CIK{entry.cik}/{entry.accession_nodash}",
        index_response_hash=index_doc.response_hash,
        response_hash=cover_doc.response_hash,
        table_response_hash=None,
        parser_version=PARSER_VERSION,
        normalization_version=NORMALIZATION_VERSION,
        ingested_at=ingested_at,
    )
    return FilingOutcome(
        filing=filing, holdings=(), status="failed", failure_kind=failure_kind
    )


def _filing_flags(cover, reconciliation, extra_flags, cover_doc, table_doc, index_doc) -> set[str]:
    flags = set(extra_flags)
    if cover.is_confidential_omitted:
        flags.add("confidential_omitted")
    if cover.conf_denied_expired:
        flags.add("conf_denied_expired")
    if cover.is_amendment and cover.amendment_type is None:
        flags.add("amendment_type_unknown")
    if "cover_amendment_flag_contradicts_form" in flags and cover.amendment_type is None:
        # A form-declared amendment whose cover states neither flag nor type:
        # its merge semantics are unknown and must not be guessed.
        flags.add("amendment_type_unknown")
    if reconciliation.entry_total_mismatch:
        flags.add("entry_total_mismatch")
    if _max_retrieved_at(index_doc, cover_doc, table_doc) is None:
        flags.add("retrieved_at_unknown")
    return flags


def _max_retrieved_at(*docs: _Doc | None) -> str | None:
    values = [d.retrieved_at for d in docs if d is not None and d.retrieved_at]
    return max(values) if values else None


def _to_parsed_row(holding) -> InstParsedRow:
    return InstParsedRow(
        raw_row=holding.raw_row,
        row_ordinal=holding.row_ordinal,
        issuer_name_raw=holding.issuer_name_raw,
        title_of_class=holding.title_of_class,
        cusip_raw=holding.cusip_raw,
        cusip=holding.cusip,
        value_raw=holding.value_raw,
        unit_basis=holding.unit_basis,
        value_usd=holding.value_usd,
        ssh_prnamt=holding.ssh_prnamt,
        ssh_prnamt_type=holding.ssh_prnamt_type,
        put_call=holding.put_call,
        investment_discretion=holding.investment_discretion,
        other_manager=holding.other_manager,
        other_manager_seqs=holding.other_manager_seqs,
        voting_sole=holding.voting_sole,
        voting_shared=holding.voting_shared,
        voting_none=holding.voting_none,
        security_id=holding.security_id,
        flags=holding.flags,
    )


# --- amendment lineage + affiliated coverage (post-load passes) --------------

# The restatement-survivor candidate set: of the active filings for a
# (cik, period), the one no active RESTATEMENT for that period supersedes (the
# view's first stage). mark_affiliated_coverage and v_default_inst_filings both
# read it, so a stale superseded original can neither suppress an affiliate nor
# be suppressed (F6).
_RESTATEMENT_SURVIVORS = """
SELECT f.filing_id, f.cik, f.period_of_report, f.file_number_norm, f.other_managers
FROM inst_filings f
WHERE f.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM inst_filings r
    WHERE r.lifecycle = 'active' AND r.amendment_type = 'RESTATEMENT'
      AND r.cik = f.cik AND r.period_of_report = f.period_of_report
      AND r.filing_id <> f.filing_id
      AND ( r.filed_date > f.filed_date
         OR (r.filed_date = f.filed_date
             AND COALESCE(r.amendment_no,0) > COALESCE(f.amendment_no,0))
         OR (r.filed_date = f.filed_date
             AND COALESCE(r.amendment_no,0) = COALESCE(f.amendment_no,0)
             AND r.accession > f.accession) )
  )
"""


#: Flags DERIVED from the current restatement-survivor set. They are recomputed
#: from scratch on every reconciliation, so they must be cleared first — a filing
#: that no longer has a surviving coverer would otherwise keep a stale
#: `affiliated_*` flag and diverge from a clean rebuild (QA-F5, R7).
_AFFILIATION_DERIVED_FLAGS = ("affiliated_covered", "affiliated_mutual_coverage")


def _drop_flag(
    conn: sqlite3.Connection, filing_id: str | None, flag: str
) -> None:
    """Remove *flag* from one filing (or every filing when *filing_id* is None).

    The inverse of :func:`_add_flag`, for DERIVED flags that must be recomputed
    rather than accumulated — otherwise an incremental run keeps a flag whose
    cause has gone and diverges from a clean rebuild (QA-F4/QA-F5).
    """
    sql = """
        UPDATE inst_filings
        SET flags = (
            SELECT json_group_array(json_each.value)
            FROM json_each(inst_filings.flags)
            WHERE json_each.value <> ?
        )
        WHERE EXISTS (
            SELECT 1 FROM json_each(inst_filings.flags) WHERE json_each.value = ?
        )
    """
    params: tuple = (flag, flag)
    if filing_id is not None:
        sql += " AND filing_id = ?"
        params = (flag, flag, filing_id)
    conn.execute(sql, params)


def _clear_affiliation_flags(conn: sqlite3.Connection) -> None:
    """Drop every affiliation-derived flag before recomputing them (QA-F5)."""
    for flag in _AFFILIATION_DERIVED_FLAGS:
        _drop_flag(conn, None, flag)


def _add_flag(conn: sqlite3.Connection, filing_id: str, flag: str) -> None:
    """Append *flag* to a filing's flags array unless already present (idempotent)."""
    conn.execute(
        """
        UPDATE inst_filings
        SET flags = json_insert(flags, '$[#]', ?)
        WHERE filing_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM json_each(inst_filings.flags) WHERE json_each.value = ?
          )
        """,
        (flag, filing_id, flag),
    )


def link_inst_amendments(conn: sqlite3.Connection) -> tuple[int, int]:
    """Set ``amends`` on each amendment to its unique base and flag the rest.

    The base is the unique NON-amendment (``13F-HR``/``13F-NT``) filing for the
    same ``(cik, period_of_report)`` that predates the amendment, resolved
    independently of lifecycle (F2/F13), so successive restatements and a later
    new-holdings addition all link to the same base and none is falsely flagged
    ``amendment_unlinked``. Zero or many candidates ⇒ NULL + flag (R5/F25).
    Returns ``(amendments_total, amendments_linked)``.
    """
    amendments = conn.execute(
        "SELECT filing_id, cik, period_of_report, filed_date FROM inst_filings"
        " WHERE is_amendment = 1"
    ).fetchall()
    linked = 0
    for filing_id, cik, period, filed_date in amendments:
        bases = [
            row[0]
            for row in conn.execute(
                "SELECT filing_id FROM inst_filings"
                " WHERE cik = ? AND period_of_report = ? AND is_amendment = 0"
                "   AND filing_id <> ? AND filed_date <= ?",
                (cik, period, filing_id, filed_date),
            )
        ]
        if len(bases) == 1:
            conn.execute(
                "UPDATE inst_filings SET amends = ? WHERE filing_id = ?",
                (bases[0], filing_id),
            )
            # `amendment_unlinked` is DERIVED from lineage, so it must be dropped
            # when a base later appears (amendment ingested first, base second).
            # Leaving it would keep a false flag and diverge from a clean
            # rebuild. (QA-F4)
            _drop_flag(conn, filing_id, "amendment_unlinked")
            linked += 1
        else:
            conn.execute(
                "UPDATE inst_filings SET amends = NULL WHERE filing_id = ?",
                (filing_id,),
            )
            _add_flag(conn, filing_id, "amendment_unlinked")
    return len(amendments), linked


def mark_affiliated_coverage(conn: sqlite3.Connection) -> tuple[int, int]:
    """Stamp ``affiliated_covered`` / ``affiliated_mutual_coverage`` over the
    restatement-survivor candidate set (R7/F6). Returns ``(covered, mutual)``.

    Derived state is recomputed from scratch: both flags are CLEARED first, so a
    filing whose coverer stopped surviving (e.g. a later restatement dropped an
    other manager) does not keep a stale flag, and an incremental selective-CIK
    run converges with a clean rebuild (QA-F5).

    The clear+recompute is a post-processing pass on the connection as given: the
    per-filing loads are each atomic (``upsert_inst_filing`` owns its own
    transaction), while this pass runs in the connection's autocommit mode — it is
    idempotent and derives entirely from persisted state, so a re-run reproduces
    the same flags (QA-F8: the docstring previously claimed an enclosing
    transaction that does not exist).
    """
    _clear_affiliation_flags(conn)
    survivors = [
        {
            "filing_id": filing_id,
            "period": period,
            "fnn": fnn,
            "others": {
                m.get("file_number_norm")
                for m in json.loads(other_managers)
                if m.get("file_number_norm")
            },
        }
        for filing_id, cik, period, fnn, other_managers in conn.execute(
            _RESTATEMENT_SURVIVORS
        )
    ]
    covered = 0
    mutual = 0
    for s in survivors:
        if s["fnn"] is None:
            continue
        coverers = [
            c
            for c in survivors
            if c["filing_id"] != s["filing_id"]
            and c["period"] == s["period"]
            and s["fnn"] in c["others"]
        ]
        if not coverers:
            continue
        is_mutual = any(c["fnn"] is not None and c["fnn"] in s["others"] for c in coverers)
        if is_mutual:
            _add_flag(conn, s["filing_id"], "affiliated_mutual_coverage")
            mutual += 1
        else:
            _add_flag(conn, s["filing_id"], "affiliated_covered")
        covered += 1
    return covered, mutual


def inst_pair_invariant_errors(conn: sqlite3.Connection) -> list[str]:
    """Structural invariants over every ``amends`` link (mirror of
    ``amendments.pair_invariant_errors`` for inst lineage; LD-4)."""
    errors: list[str] = []
    for amendment_id, amends, a_cik, a_period, a_filed, o_cik, o_period, o_filed, o_is_amend in conn.execute(
        """
        SELECT a.filing_id, a.amends, a.cik, a.period_of_report, a.filed_date,
               o.cik, o.period_of_report, o.filed_date, o.is_amendment
        FROM inst_filings a
        LEFT JOIN inst_filings o ON o.filing_id = a.amends
        WHERE a.amends IS NOT NULL
        ORDER BY a.filing_id
        """
    ):
        if amendment_id == amends:
            errors.append(f"{amendment_id}: amends itself")
            continue
        if o_cik is None:
            errors.append(f"{amendment_id}: amends missing filing {amends}")
            continue
        if o_cik != a_cik or o_period != a_period:
            errors.append(f"{amendment_id}: base {amends} is a different (cik, period)")
        if o_is_amend:
            errors.append(f"{amendment_id}: base {amends} is itself an amendment")
        if o_filed is not None and a_filed < o_filed:
            errors.append(f"{amendment_id}: filed {a_filed} before its base ({o_filed})")
    return errors


# --- reconciliation + coverage inputs (R16) ----------------------------------


#: The M2 publication gate's threshold (M2-CONTRACT §8 / LD-8). Reported here;
#: ENFORCED by M2-3 at publish time. `certifiable` is measurability only.
COVERAGE_THRESHOLD = 0.95


@dataclass(frozen=True)
class InstCoverage:
    denominator: int
    numerator: int
    cover_failed_count: int
    coverage: float | None
    #: Measurable: nonzero denominator and no unknown (NULL) cover totals.
    certifiable: bool
    #: Measurable AND at/above :data:`COVERAGE_THRESHOLD` — the gate readiness
    #: signal M2-3 consumes. Distinct from `certifiable` (QA-F6).
    meets_threshold: bool = False


def compute_coverage(conn: sqlite3.Connection) -> InstCoverage:
    """The never-inflated coverage inputs the M2 ≥95% gate consumes (R16/LD-8).

    Denominator = Σ ``table_value_total_usd`` over ``v_default_inst_filings``
    (incl. info-table-failed filings with a known total). Numerator = Σ
    ``value_usd`` over ``v_default_holdings`` with a non-null ``security_id``.
    Any in-scope default filing with a NULL total (a cover-failed filing of
    unknown value) makes coverage non-certifiable rather than shrinking the
    denominator (F7).
    """
    denominator = conn.execute(
        "SELECT COALESCE(SUM(table_value_total_usd), 0) FROM v_default_inst_filings"
    ).fetchone()[0]
    numerator = conn.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM v_default_holdings"
        " WHERE security_id IS NOT NULL"
    ).fetchone()[0]
    # Count ONLY filings whose cover actually failed (value UNKNOWN). A valid
    # `13F-NT` notice legitimately reports no holdings and no totals: its NULL
    # total is a genuine ZERO contribution, not an unknown one, so it must not
    # make coverage non-certifiable and must not block M2-3's publish. (QA-F3)
    cover_failed = conn.execute(
        "SELECT COUNT(*) FROM v_default_inst_filings"
        " WHERE table_value_total_usd IS NULL"
        "   AND EXISTS (SELECT 1 FROM json_each(v_default_inst_filings.flags)"
        "               WHERE json_each.value = 'cover_failed')"
    ).fetchone()[0]
    coverage = numerator / denominator if denominator > 0 else None
    # CERTIFIABLE means MEASURABLE, not "passes the gate" (LD-8): a nonzero
    # denominator and no unknown cover totals. The ≥0.95 threshold is M2-3's
    # publication decision, reported separately — folding it in here would
    # mislabel a fully-measurable 94% as non-certifiable. (QA-F6)
    certifiable = cover_failed == 0 and denominator > 0 and coverage is not None
    return InstCoverage(
        denominator=denominator,
        numerator=numerator,
        cover_failed_count=cover_failed,
        coverage=coverage,
        certifiable=certifiable,
        meets_threshold=bool(certifiable and coverage >= COVERAGE_THRESHOLD),
    )


# --- ingest run ---------------------------------------------------------------


@dataclass
class InstIngestReport:
    run_id: str
    ciks: tuple[str, ...] = ()
    index_rows: int = 0
    new_filings: int = 0
    rows_loaded: int = 0
    status_counts: Counter = field(default_factory=Counter)
    failure_kinds: Counter = field(default_factory=Counter)
    amendments_total: int = 0
    amendments_linked: int = 0
    affiliated_covered: int = 0
    affiliated_mutual: int = 0
    uncached_index_rows: int = 0
    rejected_rows: tuple[str, ...] = ()
    unaccounted: tuple[str, ...] = ()
    filings: list[dict] = field(default_factory=list)
    coverage: InstCoverage | None = None
    circuit_open_url: str | None = None
    invariant_errors: tuple[str, ...] = ()

    @property
    def parse_failures(self) -> int:
        return self.status_counts.get("failed", 0)

    @property
    def ok(self) -> bool:
        """Success = the breaker never tripped, no invariant error, and every
        discovered in-scope accession reconciled into a filing row. A cover- or
        info-table-failed filing is an ACCOUNTED outcome (R18/G3), not a run
        failure, so it does not flip ``ok`` — only a genuinely broken run does."""
        if self.circuit_open_url is not None:
            return False
        if self.invariant_errors:
            return False
        return not self.unaccounted


def run_inst13f_ingest(
    conn: sqlite3.Connection,
    *,
    run_id: str,
    now: Callable[[], str],
    host: str,
    ingested_at: str,
    ciks: Sequence[str] | None = None,
    cache_dir: Path | str | None = None,
    raw_root: Path | str | None = None,
    client: SecClient | None = None,
) -> InstIngestReport:
    """One inst ingest invocation under exactly one ``ingest_runs`` row.

    Cache mode (``cache_dir``) reads offline; live mode (``client`` + a
    ``raw_root``) fetches through the SecClient. The audit row is finalized on
    every exit path (LD6 parity with the Senate run).
    """
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'inst-13f', ?, 'running', ?)",
        (run_id, now(), host),
    )
    report = InstIngestReport(run_id=run_id)
    try:
        _run(
            conn,
            report=report,
            ingested_at=ingested_at,
            ciks=ciks,
            cache_dir=Path(cache_dir) if cache_dir is not None else None,
            raw_root=Path(raw_root) if raw_root is not None else None,
            client=client,
            now=now,
        )
    except SecCircuitOpenError as exc:
        report.circuit_open_url = exc.url
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'circuit_open',"
            " new_filings = ?, rows_loaded = ?, parse_failures = ? WHERE run_id = ?",
            (now(), report.new_filings, report.rows_loaded, report.parse_failures, run_id),
        )
        return report
    except BaseException:
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'failed',"
            " new_filings = ?, rows_loaded = ?, parse_failures = ? WHERE run_id = ?",
            (now(), report.new_filings, report.rows_loaded, report.parse_failures, run_id),
        )
        raise
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


def _run(
    conn: sqlite3.Connection,
    *,
    report: InstIngestReport,
    ingested_at: str,
    ciks: Sequence[str] | None,
    cache_dir: Path | None,
    raw_root: Path | None,
    client: SecClient | None,
    now: Callable[[], str],
) -> None:
    if cache_dir is not None:
        source = _CacheSource(cache_dir)
        cache_bounded = True
    else:
        if client is None or raw_root is None:
            raise ValueError("live inst ingest requires a SecClient and a raw_root")
        source = _LiveSource(client, raw_root, now)
        cache_bounded = False

    if ciks:
        selected = [normalize_cik(c) for c in ciks]
        if any(c is None for c in selected):
            raise ValueError(f"unparseable --cik in {list(ciks)!r}")
    elif cache_dir is not None:
        selected = source.ciks()
    else:
        raise ValueError("live inst ingest requires at least one --cik")

    def resolver(cusip: str, as_of: str) -> str | None:
        return resolve_cusip(conn, cusip, as_of)

    all_accessions: list[str] = []
    for cik10 in selected:
        discovery = discover(source, cik10, cache_bounded=cache_bounded)
        report.uncached_index_rows += len(discovery.uncached)
        report.rejected_rows += discovery.rejected

        # The filer row must exist before its filings (FK); its file number is
        # taken from a 13F submissions entry.
        file_number = next(
            (e.file_number for e in discovery.entries if e.file_number), None
        )
        filer_flags = ["submissions_meta_missing"] if discovery.submissions.meta_missing else []
        upsert_inst_filer(
            conn,
            cik=cik10,
            name_raw=discovery.filer_name,
            form13f_file_number=file_number,
            file_number_norm=normalize_file_number(file_number),
            entity_id=_entity_id_for_cik(conn, cik10),
            raw=None,
            flags=filer_flags,
            source_url=discovery.submissions.url,
            retrieved_at=discovery.submissions.retrieved_at,
            response_hash=discovery.submissions.response_hash,
            raw_path=discovery.submissions.raw_path,
            parser_version=PARSER_VERSION,
            normalization_version=NORMALIZATION_VERSION,
            ingested_at=ingested_at,
        )

        for entry in discovery.entries:
            report.index_rows += 1
            all_accessions.append(entry.accession)
            outcome = evaluate_filing(
                entry, source, resolve_security=resolver, ingested_at=ingested_at
            )
            if isinstance(source, _LiveSource):
                _write_live_fetch_meta(source, entry, outcome)
            result = upsert_inst_filing(
                conn, filing=outcome.filing, holdings=list(outcome.holdings)
            )
            report.new_filings += 1
            report.rows_loaded += result.row_count
            report.status_counts[outcome.status] += 1
            if outcome.failure_kind is not None:
                report.failure_kinds[outcome.failure_kind] += 1
            report.filings.append(_filing_summary_row(outcome))

    report.ciks = tuple(selected)
    report.amendments_total, report.amendments_linked = link_inst_amendments(conn)
    report.affiliated_covered, report.affiliated_mutual = mark_affiliated_coverage(conn)
    report.invariant_errors = tuple(inst_pair_invariant_errors(conn))
    report.coverage = compute_coverage(conn)
    report.unaccounted = _unaccounted(conn, all_accessions)


def _write_live_fetch_meta(source: _LiveSource, entry: InstIndexEntry, outcome: FilingOutcome) -> None:
    # Re-derive the obtained docs' provenance for the sidecar. The live source
    # already archived the bytes; here we only record the sidecar.
    docs = []
    for filename, url, response_hash in (
        ("index.json", None, outcome.filing.index_response_hash),
        ("primary_doc.xml", outcome.filing.doc_url, outcome.filing.response_hash),
        (outcome.filing.table_filename, outcome.filing.table_url, outcome.filing.table_response_hash),
    ):
        if filename is None:
            continue
        docs.append(
            _Doc(
                content=b"",
                url=url or "",
                raw_path=f"CIK{entry.cik}/{entry.accession_nodash}/{filename}",
                response_hash=response_hash or "",
                retrieved_at=outcome.filing.retrieved_at,
            )
        )
    source.write_fetch_meta(entry.cik, entry.accession_nodash, docs)


def _entity_id_for_cik(conn: sqlite3.Connection, cik10: str) -> str | None:
    """The entity surrogate only when the CIK already exists in ``entities``
    (TD-M2-2-5: no entity is seeded from 13F filer metadata here)."""
    row = conn.execute(
        "SELECT entity_id FROM entities WHERE cik = ?", (cik10,)
    ).fetchone()
    return row[0] if row is not None else None


def _filing_summary_row(outcome: FilingOutcome) -> dict:
    f = outcome.filing
    return {
        "accession": f.accession,
        "form": f.submission_type,
        "period": f.period_of_report,
        "filed": f.filed_date,
        "unit_basis": f.unit_basis,
        "status": outcome.status,
        "failure_kind": outcome.failure_kind,
        "row_count": f.row_count,
        "table_entry_total": f.table_entry_total,
        "sum_value_usd": f.sum_value_usd,
        "table_value_total_usd": f.table_value_total_usd,
        "value_total_delta": f.value_total_delta,
        "is_amendment": f.is_amendment,
        "amendment_type": f.amendment_type,
    }


def _unaccounted(conn: sqlite3.Connection, accessions: Sequence[str]) -> tuple[str, ...]:
    present = {
        row[0]
        for row in conn.execute(
            "SELECT accession FROM inst_filings"
        )
    }
    return tuple(a for a in accessions if a not in present)


# --- summary ------------------------------------------------------------------


def format_summary(report: InstIngestReport) -> str:
    """The one-screen reconciliation summary the CLI prints (R12/R16)."""
    counts = report.status_counts
    failure_detail = ", ".join(
        f"{kind} {count}" for kind, count in sorted(report.failure_kinds.items())
    )
    lines = [
        "inst-13f"
        f" | ciks {len(report.ciks)}"
        f" | index rows {report.index_rows}"
        f" | parsed {counts.get('parsed', 0)}"
        f" | partial {counts.get('partial', 0)}"
        f" | failed {counts.get('failed', 0)}"
        + (f" ({failure_detail})" if failure_detail else "")
        + f" | amendments {report.amendments_total}"
        f" (linked {report.amendments_linked},"
        f" unlinked {report.amendments_total - report.amendments_linked})"
        f" | affiliated_covered {report.affiliated_covered}"
        f" (mutual {report.affiliated_mutual})"
        f" | uncached {report.uncached_index_rows}"
    ]
    if report.rejected_rows:
        lines.append(
            f"  REJECTED INDEX ROWS ({len(report.rejected_rows)}):"
            f" {', '.join(report.rejected_rows[:5])}"
        )
    for f in report.filings:
        delta = f["value_total_delta"]
        lines.append(
            f"  {f['accession']} | {f['form']} | period {f['period']}"
            f" | filed {f['filed']} | unit_basis {f['unit_basis']}"
            f" | rows {f['row_count']} vs entry_total {f['table_entry_total']}"
            f" | Σvalue_usd {f['sum_value_usd']} vs total {f['table_value_total_usd']}"
            f" (delta {delta})"
            f" | {f['status']}"
            + (f"/{f['failure_kind']}" if f["failure_kind"] else "")
            + (
                f" | amendment {f['amendment_type']}"
                if f["is_amendment"]
                else ""
            )
        )
    coverage = report.coverage
    if coverage is not None:
        pct = f"{coverage.coverage * 100:.2f}%" if coverage.coverage is not None else "N/A"
        lines.append(
            "value-coverage:"
            f" {coverage.numerator} / {coverage.denominator} = {pct}"
            f" | cover_failed_count {coverage.cover_failed_count}"
            f" | certifiable(measurable) {'yes' if coverage.certifiable else 'no'}"
            f" | meets {COVERAGE_THRESHOLD:.0%} gate"
            f" {'yes' if coverage.meets_threshold else 'no'}"
        )
    if report.invariant_errors:
        lines.append(f"  INVARIANT ERRORS ({len(report.invariant_errors)}):")
        lines.extend(f"    {e}" for e in report.invariant_errors[:5])
    if report.unaccounted:
        lines.append(
            f"  UNACCOUNTED ({len(report.unaccounted)}):"
            f" {', '.join(report.unaccounted[:10])}"
        )
    if report.circuit_open_url is not None:
        lines.append(
            f"  CIRCUIT OPEN: last at {report.circuit_open_url} — job stopped,"
            " never retry harder (G6)"
        )
    lines.append(f"note: {INST_DATA_NOTE}")
    lines.append(
        f"run {report.run_id}: new_filings {report.new_filings}"
        f" | rows_loaded {report.rows_loaded}"
        f" | parse_failures {report.parse_failures}"
    )
    return "\n".join(lines)
