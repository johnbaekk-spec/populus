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

import json
import re
import sqlite3
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from populus.amendments import (
    _INST_COVERAGE_TOTALS_INDEX_NAME,
    _INST_COVERAGE_TOTALS_NAME,
    _INST_RESTATEMENT_SURVIVORS_SQL,
)
from populus.identity.registry import normalize_cik, resolve_cusip
from populus.ingest import UnsafeArchivePathError, archive_path
from populus.ingest.checkpoint import (
    commit_checkpoint,
    read_checkpoint,
    sha256_hex,
)
from populus.load import (
    InstFilingRow,
    InstParsedRow,
    upsert_inst_filer,
    upsert_inst_filing,
)
from populus.net.sec_client import SecCircuitOpenError, SecClient
from populus.publish import atomic_write_bytes
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


# --- per-document resume checkpoints (RUN M2-6, R13) --------------------------
#
# The checkpoint sidecars ARE the existing provenance sidecars: submissions-
# meta.json carries a single ``response_hash`` slot, and a per-accession
# fetch-meta.json carries one slot per document under ``documents[filename]``.
# ``doc_key`` is ``None`` for the single-document submissions sidecar, else the
# document filename.
#
# The three primitives now live in ``populus.ingest.checkpoint`` (RUN M1-B, R1)
# so the House PTR fetch resumes on the same implementation instead of a second
# copy of the ordering rule. These module-private aliases keep every existing
# inst call site (and any offline tooling reading them) unchanged.
_sha256 = sha256_hex
_read_checkpoint = read_checkpoint
_commit_checkpoint = commit_checkpoint


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
    """Fetches through the SecClient, archives raw bytes, writes the sidecars.

    ``resume`` (RUN M2-6, R13) makes every document write **checkpoint-before-
    bytes** and every read cache-first: the expected-hash checkpoint entry is
    committed to the sidecar (``atomic_write_bytes``) BEFORE the document bytes
    are atomically renamed into place, on a first write and on a corruption
    replacement alike. A byte rename is therefore always preceded by its matching
    checkpoint, so a durably archived document can never resume into a mismatch
    and is NEVER refetched. Resume decisions per document:

      * bytes present + hash matches checkpoint → read from disk, zero transport;
      * bytes present + hash mismatch → corrupt-at-rest or a superseded in-flight
        replacement (both non-durable) → refetch;
      * bytes absent → fetch (at most one request, only for a never-durable doc);
      * bytes present + checkpoint entry absent (defensive; unreachable under the
        ordering) → self-heal the entry from the on-disk bytes, zero transport.

    ``resume=False`` (the M2-2 default) fetches every document and writes the
    accession sidecar once at the end — today's behaviour, byte-for-byte.
    """

    def __init__(
        self,
        client: SecClient,
        raw_root: Path,
        now: Callable[[], str],
        *,
        resume: bool = False,
    ) -> None:
        self._client = client
        self._root = raw_root
        self._now = now
        self._resume = resume

    # --- default (non-resume) fetch: always fetch, write bytes directly --------

    def _fetch(self, url: str, relpath: str) -> _Doc:
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

    # --- resume (checkpoint-before-bytes, cache-first) fetch -------------------

    def _obtain_resumable(
        self,
        url: str,
        relpath: str,
        *,
        meta_path: Path,
        doc_key: str | None,
    ) -> _Doc:
        """Cache-first, checkpoint-before-bytes obtain of one document (R13).

        ``doc_key`` selects the checkpoint slot: ``None`` for the single-document
        submissions sidecar, or the filename for a per-accession fetch-meta.
        """
        target = archive_path(self._root, relpath)
        expected, meta_retrieved = _read_checkpoint(meta_path, doc_key)
        if target.exists():
            on_disk = target.read_bytes()
            disk_hash = _sha256(on_disk)
            if expected is not None and disk_hash == expected:
                # Durable: the checkpoint that necessarily preceded these bytes
                # matches them — read from disk, zero transport.
                return _Doc(
                    content=on_disk, url=url, raw_path=relpath,
                    response_hash=disk_hash, retrieved_at=meta_retrieved,
                )
            if expected is None:
                # Defensive (unreachable under the write ordering): bytes with no
                # checkpoint — self-heal the entry from the bytes, zero transport.
                _commit_checkpoint(
                    meta_path, doc_key, url=url, response_hash=disk_hash,
                    retrieved_at=None,
                )
                return _Doc(
                    content=on_disk, url=url, raw_path=relpath,
                    response_hash=disk_hash, retrieved_at=None,
                )
            # Mismatch: corrupt-at-rest or a superseded in-flight replacement
            # (never a durable new document) — fall through and refetch.
        response = self._client.get(url)
        content = response.content
        new_hash = _sha256(content)
        retrieved = self._now()
        if response.status_code != 200:
            # A non-200 (403/404) is NOT a document: never checkpoint or archive
            # it as durable, or a transient failure would freeze into a
            # never-refetched empty file. Return the (empty) body so the caller
            # fails this filing exactly as it does today; a later resume refetches.
            return _Doc(
                content=content, url=url, raw_path=relpath,
                response_hash=new_hash, retrieved_at=retrieved,
            )
        # Checkpoint FIRST (atomic), then rename the bytes: a crash between the
        # two leaves an absent-bytes state that resumes with exactly one fetch,
        # never a duplicate request for durable bytes.
        _commit_checkpoint(
            meta_path, doc_key, url=url, response_hash=new_hash,
            retrieved_at=retrieved,
        )
        atomic_write_bytes(target, content)
        return _Doc(
            content=content, url=url, raw_path=relpath,
            response_hash=new_hash, retrieved_at=retrieved,
        )

    def _obtain(self, url: str, relpath: str, *, meta_path: Path, doc_key: str | None) -> _Doc:
        if self._resume:
            return self._obtain_resumable(url, relpath, meta_path=meta_path, doc_key=doc_key)
        return self._fetch(url, relpath)

    def _accession_meta(self, cik10: str, accession_nodash: str) -> Path:
        return self._root / f"CIK{cik10}" / accession_nodash / "fetch-meta.json"

    def _submissions_meta(self, cik10: str) -> Path:
        return self._root / f"CIK{cik10}" / "submissions-meta.json"

    def submissions_shard(self, cik10: str, name: str) -> _Doc:
        return self._obtain(
            _shard_url(name), f"CIK{cik10}/{name}",
            meta_path=self._root / f"CIK{cik10}" / f"{name}-meta.json", doc_key=None,
        )

    def submissions(self, cik10: str) -> _Doc:
        meta_path = self._submissions_meta(cik10)
        if self._resume:
            # The checkpoint IS submissions-meta.json (its response_hash slot),
            # so the resumable obtain writes the sidecar itself, checkpoint-first.
            return self._obtain_resumable(
                _submissions_url(cik10), f"CIK{cik10}/submissions.json",
                meta_path=meta_path, doc_key=None,
            )
        doc = self._fetch(_submissions_url(cik10), f"CIK{cik10}/submissions.json")
        meta = {
            "retrieved_at": doc.retrieved_at,
            "source_url": doc.url,
            "response_hash": doc.response_hash,
        }
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        return doc

    def index(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/index.json",
            f"CIK{cik10}/{accession_nodash}/index.json",
            meta_path=self._accession_meta(cik10, accession_nodash),
            doc_key="index.json",
        )

    def cover(self, cik10: str, accession_nodash: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/primary_doc.xml",
            f"CIK{cik10}/{accession_nodash}/primary_doc.xml",
            meta_path=self._accession_meta(cik10, accession_nodash),
            doc_key="primary_doc.xml",
        )

    def table(self, cik10: str, accession_nodash: str, filename: str) -> _Doc:
        return self._obtain(
            f"{_archive_base(cik10, accession_nodash)}/{filename}",
            f"CIK{cik10}/{accession_nodash}/{filename}",
            meta_path=self._accession_meta(cik10, accession_nodash),
            doc_key=filename,
        )

    def ciks(self) -> list[str]:
        return []

    def write_fetch_meta(
        self, cik10: str, accession_nodash: str, docs: Sequence[_Doc]
    ) -> None:
        # In resume mode every document already committed its own checkpoint
        # (with per-document retrieved_at) into fetch-meta.json before its bytes
        # landed, so this end-of-accession rewrite would only DROP that provenance
        # — skip it (R13). The non-resume path writes the sidecar once here.
        if self._resume:
            return
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
        for filing_id, period, fnn, other_managers in conn.execute(
            _INST_RESTATEMENT_SURVIVORS_SQL
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


# --- cover reconciliation: tolerance + conflict exclusion (M2-7) -------------
#
# Normative: docs/build/M2-7-cover-tolerance-spec.md. Owner decision 2026-07-31
# ("Tolerance + flag"). A filing declares a cover total T and files an info table
# whose RESOLVED rows sum to S. S > T by a dollar is a printed-rounding artefact;
# S > T by half the portfolio is the filer's own two numbers disagreeing. M2-3
# treated both as fatal, which de-certified the first real 1,000-filer corpus
# over $19 of rounding.


#: tol(T) = max($1,000, 0.001*T). The floor keeps a small filer's cents from
#: being a conflict; the 0.1% term keeps a $10B filer's rounded cover line from
#: being one. Evaluated WITHOUT floating point and WITHOUT any multiplication
#: (spec §I1): `S - T <= max(FLOOR, T / DIVISOR)` with integer division.
#:
#: The earlier form `1000*(S-T) <= max(FLOOR*1000, T)` was algebraically right
#: and arithmetically unsafe: `table_value_total_usd` is a signed 64-bit column,
#: so SQLite PROMOTES `1000 * delta` to REAL once the product passes ~9.2e18 —
#: reintroducing floating point inside the predicate that exists to avoid it
#: (external review F5). Dividing instead of multiplying cannot overflow, and it
#: is EXACTLY equivalent for integer deltas: with M = max(FLOOR, T/DIVISOR) and
#: M' = max(FLOOR, T // DIVISOR) we always have M' <= M < M' + 1, and no integer
#: lies in (M', M]. Proof and the domain are recorded in the spec.
COVER_TOLERANCE_FLOOR_USD = 1_000
COVER_TOLERANCE_DIVISOR = 1_000

#: The three exhaustive, mutually exclusive dispositions (spec §Domain).
COVER_EXACT = "cover_exact"
COVER_ROUNDING = "cover_rounding"
COVER_CONFLICT = "cover_conflict"

def cover_tolerance_usd(declared: int) -> int:
    """tol(T) as a whole number of dollars — max($1,000, floor(T/1,000)).

    Integer division, never `0.001 * T`: the fractional part can never admit or
    exclude an integer delta (see the module note), and float has no business in
    a predicate evaluated at $10^12 scale by two different engines.
    """
    return max(COVER_TOLERANCE_FLOOR_USD, declared // COVER_TOLERANCE_DIVISOR)


def within_cover_tolerance(declared: int, resolved: int) -> bool:
    """Whether ``resolved`` is within tol(``declared``) of it (spec §I1).

    True for every non-inflating filing (S <= T) and for inflation up to and
    INCLUDING the tolerance — the boundary is closed on the tolerant side.
    """
    return resolved - declared <= cover_tolerance_usd(declared)


def classify_cover(declared: int, resolved: int) -> str:
    """Classify one filing's cover reconciliation. ``declared`` must be known —
    a NULL total is UNKNOWN, which is `cover_failed`'s fail-closed business, not
    this rule's (spec §Rule 1)."""
    if resolved <= declared:
        return COVER_EXACT
    return COVER_ROUNDING if within_cover_tolerance(declared, resolved) else COVER_CONFLICT


@dataclass(frozen=True)
class CoverDisposition:
    """One filing whose resolved holdings exceed its declared cover total."""

    filing_id: str
    declared_usd: int
    resolved_usd: int
    disposition: str

    @property
    def delta_usd(self) -> int:
        return self.resolved_usd - self.declared_usd


#: The populations this reconciliation may be asked about. `view` is interpolated
#: into SQL, so it is a closed set, never caller text.
_COVER_SCOPE_VIEWS = ("v_inst_reconciled_filings", "v_default_inst_filings")

_PER_FILING_COVER_SQL = """
SELECT f.filing_id, f.table_value_total_usd AS declared,
       (SELECT COALESCE(SUM(h.value_usd), 0)
        FROM inst_holdings h
        WHERE h.filing_id = f.filing_id AND h.security_id IS NOT NULL) AS resolved
FROM {view} f
WHERE f.table_value_total_usd IS NOT NULL
ORDER BY f.filing_id
"""

_MATERIALIZED_TOTALS_JOIN = (
    f" LEFT JOIN temp.{_INST_COVERAGE_TOTALS_NAME} AS t"
    f" INDEXED BY {_INST_COVERAGE_TOTALS_INDEX_NAME}"
    " ON t.filing_id = f.filing_id"
)

_MATERIALIZED_PER_FILING_COVER_SQL = (
    "SELECT f.filing_id, f.table_value_total_usd AS declared,"
    " COALESCE(t.resolved_usd, 0) AS resolved"
    " FROM {view} f"
    + _MATERIALIZED_TOTALS_JOIN
    + " WHERE f.table_value_total_usd IS NOT NULL ORDER BY f.filing_id"
)


def _has_materialized_coverage_totals(conn: sqlite3.Connection) -> bool:
    """Whether the owned per-filing coverage totals are active on *conn*."""
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_temp_schema"
            " WHERE type = 'table' AND name = ?",
            (_INST_COVERAGE_TOTALS_NAME,),
        ).fetchone()
        is not None
    )


def _per_filing_cover_sql(conn: sqlite3.Connection, *, view: str) -> str:
    if _has_materialized_coverage_totals(conn):
        return _MATERIALIZED_PER_FILING_COVER_SQL.format(view=view)
    return _PER_FILING_COVER_SQL.format(view=view)


def cover_dispositions(
    conn: sqlite3.Connection, *, view: str = "v_inst_reconciled_filings"
) -> tuple[CoverDisposition, ...]:
    """Every filing in *view* whose RESOLVED holdings exceed its DECLARED total,
    classified and sorted by ``filing_id`` (spec §I8).

    Default scope is the RECONCILED population — restatement survivors with
    affiliation applied, BEFORE the cover predicate — so a conflict that
    `v_default_inst_filings` has already excluded can still be named (§I5).
    Pass ``view="v_default_inst_filings"`` for the fail-closed check (§I6).
    """
    if view not in _COVER_SCOPE_VIEWS:
        raise ValueError(f"unknown cover-reconciliation scope: {view!r}")
    rows = conn.execute(_per_filing_cover_sql(conn, view=view)).fetchall()  # nosec B608
    return tuple(
        CoverDisposition(
            filing_id=filing_id,
            declared_usd=declared,
            resolved_usd=resolved,
            disposition=classify_cover(declared, resolved),
        )
        for filing_id, declared, resolved in rows
        if resolved > declared
    )


#: Flags DERIVED from the current cover reconciliation. Like the affiliation
#: flags they are recomputed from scratch, so they are cleared first: a filing
#: whose amendment brought its table back into line must not keep a stale
#: `cover_conflict`.
_COVER_DERIVED_FLAGS = (COVER_ROUNDING, COVER_CONFLICT)


def mark_cover_dispositions(conn: sqlite3.Connection) -> tuple[int, int]:
    """Stamp `cover_rounding` / `cover_conflict` on the filings that carry them;
    return ``(rounding, conflicts)``.

    ANNOTATION ONLY (spec §I7). No decision anywhere reads these flags: the
    exclusion is derived arithmetic in `v_default_inst_filings` and in
    :func:`cover_dispositions`, so a database that has never run this pass — an
    already-ingested corpus, a read-only snapshot — classifies, excludes and
    reports identically. The flag exists so a filing carries, in the database,
    the reason it left the default population.
    """
    for flag in _COVER_DERIVED_FLAGS:
        _drop_flag(conn, None, flag)
    rounding = conflicts = 0
    for disposition in cover_dispositions(conn):
        _add_flag(conn, disposition.filing_id, disposition.disposition)
        if disposition.disposition == COVER_CONFLICT:
            conflicts += 1
        else:
            rounding += 1
    return rounding, conflicts


# --- reconciliation + coverage inputs (R16) ----------------------------------


#: The M2 publication gate's threshold (M2-CONTRACT §8 / LD-8). Reported here;
#: ENFORCED by M2-3 at publish time. `certifiable` is measurability only.
COVERAGE_THRESHOLD = 0.95

#: ONE filing's denominator contribution, as SQL over an alias `f` of
#: ``v_default_inst_filings``: max(declared, resolved), and 0 for an unknown
#: (NULL) total. Shared verbatim by :func:`compute_coverage` and
#: :func:`compute_period_coverage` — the per-period figures previously summed the
#: DECLARED total alone, so a tolerated rounding filing printed a period coverage
#: of 100.1% beside a corpus coverage of 100.0% (external review F1). Anything
#: that reports a coverage ratio uses this term; the two can no longer drift
#: because there is only one of them (spec §I3/Rule 5).
_DENOMINATOR_TERM = """
            CASE WHEN f.table_value_total_usd IS NULL THEN 0
                 ELSE MAX(f.table_value_total_usd,
                          (SELECT COALESCE(SUM(h.value_usd), 0)
                           FROM inst_holdings h
                           WHERE h.filing_id = f.filing_id
                             AND h.security_id IS NOT NULL))
            END"""

_COVERAGE_DENOMINATOR_SQL = (
    f"SELECT COALESCE(SUM({_DENOMINATOR_TERM}), 0) FROM v_default_inst_filings f"
)
_COVERAGE_NUMERATOR_SQL = (
    "SELECT COALESCE(SUM(value_usd), 0) FROM v_default_holdings"
    " WHERE security_id IS NOT NULL"
)
_PERIOD_COVERAGE_DENOMINATOR_SQL = (
    f"SELECT f.period_of_report, COALESCE(SUM({_DENOMINATOR_TERM}), 0)"
    " FROM v_default_inst_filings f GROUP BY f.period_of_report"
)
_PERIOD_COVERAGE_NUMERATOR_SQL = (
    "SELECT period_of_report, COALESCE(SUM(value_usd), 0)"
    " FROM v_default_holdings WHERE security_id IS NOT NULL"
    " GROUP BY period_of_report"
)

_MATERIALIZED_DENOMINATOR_TERM = """
            CASE WHEN f.table_value_total_usd IS NULL THEN 0
                 ELSE MAX(f.table_value_total_usd,
                          COALESCE(t.resolved_usd, 0))
            END"""

_MATERIALIZED_COVERAGE_DENOMINATOR_SQL = (
    f"SELECT COALESCE(SUM({_MATERIALIZED_DENOMINATOR_TERM}), 0)"
    " FROM v_default_inst_filings f"
    + _MATERIALIZED_TOTALS_JOIN
)
_MATERIALIZED_COVERAGE_NUMERATOR_SQL = (
    "SELECT COALESCE(SUM(COALESCE(t.resolved_usd, 0)), 0)"
    " FROM v_default_inst_filings f"
    + _MATERIALIZED_TOTALS_JOIN
)
_MATERIALIZED_PERIOD_COVERAGE_DENOMINATOR_SQL = (
    f"SELECT f.period_of_report, COALESCE(SUM({_MATERIALIZED_DENOMINATOR_TERM}), 0)"
    " FROM v_default_inst_filings f"
    + _MATERIALIZED_TOTALS_JOIN
    + " GROUP BY f.period_of_report"
)
_MATERIALIZED_PERIOD_COVERAGE_NUMERATOR_SQL = (
    "SELECT f.period_of_report,"
    " COALESCE(SUM(COALESCE(t.resolved_usd, 0)), 0)"
    " FROM v_default_inst_filings f"
    + _MATERIALIZED_TOTALS_JOIN
    + " GROUP BY f.period_of_report"
)

_COVER_FAILED_SQL = (
    "SELECT COUNT(*) FROM v_default_inst_filings"
    " WHERE table_value_total_usd IS NULL"
    "   AND EXISTS (SELECT 1 FROM json_each(v_default_inst_filings.flags)"
    "               WHERE json_each.value = 'cover_failed')"
)


def _production_coverage_queries(conn: sqlite3.Connection) -> dict[str, str]:
    """Exact SQL selected by coverage/disposition production on *conn*."""
    materialized = _has_materialized_coverage_totals(conn)
    return {
        "coverage_denominator": (
            _MATERIALIZED_COVERAGE_DENOMINATOR_SQL
            if materialized
            else _COVERAGE_DENOMINATOR_SQL
        ),
        "coverage_numerator": (
            _MATERIALIZED_COVERAGE_NUMERATOR_SQL
            if materialized
            else _COVERAGE_NUMERATOR_SQL
        ),
        "period_coverage_denominator": (
            _MATERIALIZED_PERIOD_COVERAGE_DENOMINATOR_SQL
            if materialized
            else _PERIOD_COVERAGE_DENOMINATOR_SQL
        ),
        "period_coverage_numerator": (
            _MATERIALIZED_PERIOD_COVERAGE_NUMERATOR_SQL
            if materialized
            else _PERIOD_COVERAGE_NUMERATOR_SQL
        ),
        "cover_dispositions_reconciled": _per_filing_cover_sql(
            conn, view="v_inst_reconciled_filings"
        ),
        "cover_dispositions_default": _per_filing_cover_sql(
            conn, view="v_default_inst_filings"
        ),
        "coverage_cover_failed": _COVER_FAILED_SQL,
    }


@dataclass(frozen=True)
class InstCoverage:
    denominator: int
    numerator: int
    cover_failed_count: int
    #: UNRESOLVED cover conflicts: default-view filings whose RESOLVED numerator
    #: exceeds their DECLARED total beyond tol(T) — a per-filing over-count that
    #: would let corpus coverage read above 100% (F8). M2-7 makes this
    #: structurally zero by excluding conflicts from the view (§I4); it is kept as
    #: an independent fail-closed check, so a stale view or a hand-built database
    #: still cannot certify an over-counting filing (§I6).
    inflated_filing_count: int
    coverage: float | None
    #: Measurable: nonzero denominator, no unknown (NULL) cover totals, and no
    #: unresolved cover conflict.
    certifiable: bool
    #: Measurable AND at/above :data:`COVERAGE_THRESHOLD` — the gate readiness
    #: signal M2-3 consumes. Distinct from `certifiable` (QA-F6).
    meets_threshold: bool = False
    #: M2-7 dispositions, REPORTED so no exclusion is silent (§I5). Rounding
    #: filings stay in the corpus (their denominator contribution is max(S,T));
    #: conflict filings are excluded from numerator, denominator and the default
    #: view, and are named here by `filing_id`.
    cover_rounding_count: int = 0
    cover_rounding_max_delta_usd: int = 0
    cover_conflict_filing_ids: tuple[str, ...] = ()

    @property
    def cover_conflict_count(self) -> int:
        return len(self.cover_conflict_filing_ids)

    @property
    def disposition_line(self) -> str:
        return format_cover_dispositions(
            rounding_count=self.cover_rounding_count,
            rounding_max_delta_usd=self.cover_rounding_max_delta_usd,
            conflict_filing_ids=self.cover_conflict_filing_ids,
        )


def format_cover_dispositions(
    *,
    rounding_count: int,
    rounding_max_delta_usd: int,
    conflict_filing_ids: Sequence[str],
) -> str:
    """The ONE rendering of the cover dispositions, for every surface that
    prints a coverage number (spec §I5/Rule 6).

    Ingest summary, bulk summary, both acceptance scripts and the CLI's build and
    publish output all call this, so no surface can quietly omit the exclusions —
    which four of them did until external review F3. Conflicts are named by
    ``filing_id``; a bare count is not an explanation.
    """
    named = f": {', '.join(conflict_filing_ids)}" if conflict_filing_ids else ""
    return (
        f"cover_rounding {rounding_count} (max delta {rounding_max_delta_usd})"
        f" | cover_conflict EXCLUDED {len(conflict_filing_ids)}{named}"
    )


def cover_dispositions_from_mapping(record: Mapping) -> str:
    """:func:`format_cover_dispositions` over a build report / gate record dict,
    tolerating an older record that predates these keys."""
    return format_cover_dispositions(
        rounding_count=record.get("cover_rounding_count", 0),
        rounding_max_delta_usd=record.get("cover_rounding_max_delta_usd", 0),
        conflict_filing_ids=record.get("cover_conflict_filing_ids") or (),
    )


def compute_coverage(conn: sqlite3.Connection) -> InstCoverage:
    """The never-inflated coverage inputs the M2 ≥95% gate consumes (R16/LD-8).

    Denominator = Σ ``max(declared, resolved)`` over ``v_default_inst_filings``
    (incl. info-table-failed filings with a known total). Numerator = Σ
    ``value_usd`` over ``v_default_holdings`` with a non-null ``security_id``.
    Any in-scope default filing with a NULL total (a cover-failed filing of
    unknown value) makes coverage non-certifiable rather than shrinking the
    denominator (F7).

    The denominator banks the LARGER of the filer's two numbers per filing
    (M2-7 §I3): for the overwhelming majority (S <= T) that is the declared total
    and the arithmetic is byte-identical to M2-6, while a within-tolerance
    rounding filing contributes S rather than T, so it can never put more into
    the numerator than into the denominator. Conflicts beyond tolerance are not
    here at all — ``v_default_inst_filings`` has already excluded them (§I4).
    """
    queries = _production_coverage_queries(conn)
    denominator = conn.execute(queries["coverage_denominator"]).fetchone()[0]
    numerator = conn.execute(queries["coverage_numerator"]).fetchone()[0]
    # Count ONLY filings whose cover actually failed (value UNKNOWN). A valid
    # `13F-NT` notice legitimately reports no holdings and no totals: its NULL
    # total is a genuine ZERO contribution, not an unknown one, so it must not
    # make coverage non-certifiable and must not block M2-3's publish. (QA-F3)
    cover_failed = conn.execute(queries["coverage_cover_failed"]).fetchone()[0]
    # The per-filing NON-INFLATION invariant (F8), with M2-7's tolerance: no
    # default filing's resolved numerator (Σ value_usd over its holdings with a
    # security_id) may exceed its own DECLARED total by more than tol(T). Without
    # this, one filing whose holdings sum to far more than its cover total
    # (declared 100, resolved 120) drives corpus coverage above 1.0 — and a >100%
    # ratio would sail past the ≥0.95 gate.
    #
    # Reported over the RECONCILED population, so an excluded conflict is still
    # named (§I5); COUNTED for certifiability over the DEFAULT view, where a
    # conflict is structurally impossible — that count staying in the certifiable
    # test is the fail-closed backstop against a stale view (§I6).
    dispositions = cover_dispositions(conn)
    rounding = [d for d in dispositions if d.disposition == COVER_ROUNDING]
    conflicts = [d for d in dispositions if d.disposition == COVER_CONFLICT]
    unresolved_conflicts = [
        d
        for d in cover_dispositions(conn, view="v_default_inst_filings")
        if d.disposition == COVER_CONFLICT
    ]
    inflated = len(unresolved_conflicts)
    coverage = numerator / denominator if denominator > 0 else None
    # CERTIFIABLE means MEASURABLE, not "passes the gate" (LD-8): a nonzero
    # denominator, no unknown cover totals, and no UNRESOLVED cover conflict. The
    # ≥0.95 threshold is M2-3's publication decision, reported separately —
    # folding it in here would mislabel a fully-measurable 94% as
    # non-certifiable. (QA-F6)
    certifiable = (
        cover_failed == 0
        and inflated == 0
        and denominator > 0
        and coverage is not None
    )
    return InstCoverage(
        denominator=denominator,
        numerator=numerator,
        cover_failed_count=cover_failed,
        inflated_filing_count=inflated,
        coverage=coverage,
        certifiable=certifiable,
        meets_threshold=bool(certifiable and coverage >= COVERAGE_THRESHOLD),
        cover_rounding_count=len(rounding),
        cover_rounding_max_delta_usd=max((d.delta_usd for d in rounding), default=0),
        cover_conflict_filing_ids=tuple(d.filing_id for d in conflicts),
    )


@dataclass(frozen=True)
class PeriodCoverage:
    """Per-``period_of_report`` value coverage (RUN M2-5 reporting; R9/R11).

    Additive to the gate: the corpus-wide :func:`compute_coverage` decision and
    its 0.95 threshold are UNCHANGED. These per-period figures are reported (on
    a passing build) and used to NAME the quarters a withheld build did not cover
    (``covered_by_list`` is False), never to re-key the PASS/FAIL decision.
    """

    period_of_report: str
    denominator: int
    numerator: int
    coverage: float | None
    #: Whether any definitional 13(f)-list interval spans this period.
    covered_by_list: bool


def _has_list_intervals(conn: sqlite3.Connection) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'security_list_intervals'"
        ).fetchone()
        is not None
    )


def compute_period_coverage(
    conn: sqlite3.Connection,
) -> tuple[PeriodCoverage, ...]:
    """Value coverage per ``period_of_report`` (R9), sorted by period.

    Same denominator/numerator definitions as :func:`compute_coverage`, grouped
    by the reporting period — literally the same SQL term (``_DENOMINATOR_TERM``),
    applied PER FILING before the grouping. Summing the declared total here while
    the corpus banked max(T,S) let a tolerated rounding filing report a period
    coverage above 100% (external review F1); a period figure is a coverage
    figure, and §I3 admits no exceptions. ``covered_by_list`` records whether a
    definitional list interval spans the period, so a caller can name the
    quarters that have no list (R11). Read-only; never mutates, never gates.
    """
    queries = _production_coverage_queries(conn)
    denominators = dict(
        conn.execute(queries["period_coverage_denominator"]).fetchall()
    )
    numerators = dict(
        conn.execute(queries["period_coverage_numerator"]).fetchall()
    )
    has_list = _has_list_intervals(conn)
    result: list[PeriodCoverage] = []
    for period in sorted(denominators):
        denominator = denominators[period]
        numerator = numerators.get(period, 0)
        coverage = numerator / denominator if denominator > 0 else None
        covered_by_list = bool(
            has_list
            and conn.execute(
                "SELECT EXISTS(SELECT 1 FROM security_list_intervals"
                " WHERE valid_from <= ? AND (valid_to IS NULL OR ? < valid_to))",
                (period, period),
            ).fetchone()[0]
        )
        result.append(
            PeriodCoverage(
                period_of_report=period,
                denominator=denominator,
                numerator=numerator,
                coverage=coverage,
                covered_by_list=covered_by_list,
            )
        )
    return tuple(result)


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
    #: Allowlisted target accessions whose loaded ``period_of_report`` differed
    #: from the asserted ``report_period`` — recorded, never silently loaded
    #: (RUN M2-6, R2/R6).
    period_mismatched: tuple[str, ...] = ()
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


@dataclass(frozen=True)
class FinalizeReport:
    """Outcome of the global post-load passes, run once per bulk run (R16)."""

    amendments_total: int
    amendments_linked: int
    affiliated_covered: int
    affiliated_mutual: int
    invariant_errors: tuple[str, ...]
    coverage: InstCoverage


def finalize_inst_ingest(conn: sqlite3.Connection) -> FinalizeReport:
    """Run the global post-load passes exactly once (RUN M2-6, R16/LD-4).

    The identical passes the M2-2 tail runs — amendment lineage, affiliated-
    coverage stamping, the pair invariant check, and the never-inflated coverage
    inputs — factored out so a bulk coordinator drives per-CIK loads with
    ``run_passes=False`` and calls this ONCE at the end, making the number of
    global passes independent of the number of filers (F8). Each pass derives
    entirely from persisted state and is idempotent, so calling this once after
    N deferred loads is equivalent to N inline tails collapsing to one.
    """
    amendments_total, amendments_linked = link_inst_amendments(conn)
    affiliated_covered, affiliated_mutual = mark_affiliated_coverage(conn)
    # M2-7 annotation pass: stamps `cover_rounding` / `cover_conflict` so a
    # filing carries the reason it left the default population. Ordered after
    # affiliation because it classifies the reconciled (post-affiliation)
    # population; it feeds NO decision, so compute_coverage is unaffected by it.
    mark_cover_dispositions(conn)
    invariant_errors = tuple(inst_pair_invariant_errors(conn))
    coverage = compute_coverage(conn)
    return FinalizeReport(
        amendments_total=amendments_total,
        amendments_linked=amendments_linked,
        affiliated_covered=affiliated_covered,
        affiliated_mutual=affiliated_mutual,
        invariant_errors=invariant_errors,
        coverage=coverage,
    )


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
    accessions: frozenset[str] | Sequence[str] | None = None,
    report_period: str | None = None,
    run_passes: bool = True,
    resume: bool = False,
) -> InstIngestReport:
    """One inst ingest invocation under exactly one ``ingest_runs`` row.

    Cache mode (``cache_dir``) reads offline; live mode (``client`` + a
    ``raw_root``) fetches through the SecClient. The audit row is finalized on
    every exit path (LD6 parity with the Senate run).

    RUN M2-6 seam extension, all default-inert (``accessions=None``,
    ``report_period=None``, ``run_passes=True``, ``resume=False`` reproduce the
    M2-2 behaviour exactly):

      * ``accessions`` — an allowlist restricting the loaded set to a filer's
        target lineage (base + every amendment for the period).
      * ``report_period`` — assert each loaded filing's ``period_of_report``
        equals it, recording a ``period_mismatch`` for any that differ.
      * ``run_passes`` — when ``False``, defer the global post-passes to a single
        :func:`finalize_inst_ingest` the coordinator runs once for the whole run.
      * ``resume`` — engage the live source's per-document cache-first,
        checkpoint-before-bytes resume (R13).
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
            accessions=frozenset(accessions) if accessions is not None else None,
            report_period=report_period,
            run_passes=run_passes,
            resume=resume,
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
    accessions: frozenset[str] | None = None,
    report_period: str | None = None,
    run_passes: bool = True,
    resume: bool = False,
) -> None:
    if cache_dir is not None:
        source = _CacheSource(cache_dir)
        cache_bounded = True
    else:
        if client is None or raw_root is None:
            raise ValueError("live inst ingest requires a SecClient and a raw_root")
        source = _LiveSource(client, raw_root, now, resume=resume)
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
            # RUN M2-6: an accession allowlist restricts the loaded set to the
            # filer's target lineage; a non-target accession is simply not this
            # run's business (never a reject, never unaccounted).
            if accessions is not None and entry.accession not in accessions:
                continue
            report.index_rows += 1
            outcome = evaluate_filing(
                entry, source, resolve_security=resolver, ingested_at=ingested_at
            )
            # RUN M2-6: assert the loaded period. A target whose authoritative
            # (cover- or index-derived) period_of_report differs from the locked
            # report_period is recorded as a period_mismatch and NOT loaded — so
            # it never silently pollutes the corpus or the reconciliation.
            if (
                report_period is not None
                and outcome.filing.period_of_report != report_period
            ):
                report.period_mismatched += (entry.accession,)
                continue
            all_accessions.append(entry.accession)
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
    # RUN M2-6: the coordinator defers the global post-passes to one finalize
    # over the whole run (run_passes=False); a standalone run keeps running them
    # inline, unchanged.
    if run_passes:
        finalize = finalize_inst_ingest(conn)
        report.amendments_total = finalize.amendments_total
        report.amendments_linked = finalize.amendments_linked
        report.affiliated_covered = finalize.affiliated_covered
        report.affiliated_mutual = finalize.affiliated_mutual
        report.invariant_errors = finalize.invariant_errors
        report.coverage = finalize.coverage
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
        # M2-7 §I5: never state a coverage number without stating what was
        # tolerated and what was excluded to produce it.
        lines.append(f"  {coverage.disposition_line}")
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
