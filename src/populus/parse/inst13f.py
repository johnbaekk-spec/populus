"""SEC 13F cover + information-table parser (ARCHITECTURE.md §10.2 — RUN M2-2).

Pure functions, no I/O: bytes in, dataclasses out. The information-table XML
filename is variable and numeric per accession (``53405.xml``, ``50240.xml``,
``43981.xml``) and sometimes named (``form13fInfoTable.xml``), so it is
**discovered from ``index.json`` in every mode** — never hardcoded (R1/F1).

``parse_cover`` stays strict: malformed XML or a missing required field raises
:class:`CoverParseError` carrying a ``kind`` (``cover_malformed`` /
``cover_missing_field``). The *persisted* failed-cover outcome is owned by
ingest (R18/LD-12), which catches the error and records the accession from the
validated submissions-index metadata rather than dropping it (G3).

XXE / entity-expansion defence (F5/R10): every parse runs through the shared
:func:`populus.parse.xml.parse_untrusted_xml` — external-entity resolution,
DTD loading and network access are off, and any document carrying a DOCTYPE is
refused outright (``UnsafeXmlError``), mapped here onto the existing
``cover_malformed`` / info-table parse failures.
"""

from __future__ import annotations

import json
import re
from datetime import date
from collections.abc import Mapping
from dataclasses import dataclass

import lxml.etree

from populus.canonical import nfc
from populus.parse.xml import UnsafeXmlError, parse_untrusted_xml

PARSER_VERSION = "inst-13f-1.0.0"

#: An info-table filename discovered from a remote index must be a bare XML
#: file name — no path separator, no scheme — before it is joined to a path
#: (belt-and-braces with ``archive_path`` containment; F4).
_SAFE_XML_NAME = re.compile(r"[A-Za-z0-9._-]+\.[Xx][Mm][Ll]")

#: form 13F file numbers: strip the state/office padding to a canonical form so
#: differently-formatted encodings of one number match and different numbers
#: never conflate (R7/F14). ``028-04545`` -> ``028-4545``; ``28-554`` and
#: ``028-00554`` -> ``028-554``.
_FILE_NUMBER = re.compile(r"^0*(\d{1,3})-0*(\d+)$")

_AMENDMENT_TYPES = {
    "NEW HOLDINGS": "NEW_HOLDINGS",
    "RESTATEMENT": "RESTATEMENT",
}

_PERIOD = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")


class InstParseError(Exception):
    """Base for every 13F parse failure."""


class CoverParseError(InstParseError):
    """The cover (``primary_doc.xml``) is malformed or missing a required field.

    ``kind`` is ``cover_malformed`` (the XML would not parse) or
    ``cover_missing_field`` (a required field is absent), mapped straight to the
    persisted ``failure_kind`` by ingest (R18).
    """

    def __init__(self, message: str, *, kind: str) -> None:
        super().__init__(message)
        self.kind = kind


class InfoTableParseError(InstParseError):
    """The information table XML would not parse."""


class InfoTableMissingError(InstParseError):
    """``index.json`` names no information-table XML."""


class InfoTableAmbiguousError(InstParseError):
    """``index.json`` names more than one information-table XML (F2)."""


# --- namespace-blind XML helpers ---------------------------------------------


def _parse(xml: bytes) -> lxml.etree._Element:
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    return parse_untrusted_xml(xml)


def _local(tag: object) -> str:
    """Local name of *tag*, namespace stripped (``''`` for comments/PIs)."""
    if isinstance(tag, str):
        return tag.rsplit("}", 1)[-1]
    return ""


def _child(element: lxml.etree._Element | None, name: str) -> lxml.etree._Element | None:
    """First direct child of *element* with local name *name* (structural, so a
    ``name``/``form13FFileNumber`` nested elsewhere is never grabbed)."""
    if element is None:
        return None
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _children(element: lxml.etree._Element | None, name: str) -> list[lxml.etree._Element]:
    if element is None:
        return []
    return [c for c in element if _local(c.tag) == name]


def _descend(element: lxml.etree._Element | None, *names: str) -> lxml.etree._Element | None:
    for name in names:
        element = _child(element, name)
        if element is None:
            return None
    return element


def _text(element: lxml.etree._Element | None) -> str | None:
    """NFC + stripped element text; ``None`` for absent or empty (never ``''``)."""
    if element is None or element.text is None:
        return None
    text = nfc(element.text).strip()
    return text or None


def _raw_text(element: lxml.etree._Element | None) -> str | None:
    """Element text with **NFC only** — never trimmed (R3/R15).

    ``raw_row`` must hold the observation exactly as printed, so archived source
    text and the canonical row fingerprint faithfully represent the filing.
    Trimming here would alter the record and could collapse rows that differ
    only in whitespace (QA-F4). ``None`` means the element (or its text) is
    genuinely absent; whitespace-only text is preserved as printed. Consumers
    that need a typed/trimmed view read the :class:`InfoTableRow` accessors.
    """
    if element is None or element.text is None:
        return None
    return nfc(element.text)


def _trim(value: str | None) -> str | None:
    """The normalization-facing view of a raw field: trimmed, empty ⇒ ``None``."""
    if value is None:
        return None
    text = value.strip()
    return text or None


def _int(raw: str | None) -> int | None:
    if raw is None:
        return None
    text = raw.strip()
    if text and (text.isdigit() or (text[0] == "-" and text[1:].isdigit())):
        return int(text)
    return None


def _bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    text = raw.strip().lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def normalize_file_number(raw: str | None) -> str | None:
    """Canonical 13F file number, or ``None`` when unparseable (R7)."""
    if raw is None:
        return None
    match = _FILE_NUMBER.match(raw.strip())
    if match is None:
        return None
    prefix, suffix = match.groups()
    return f"{int(prefix):03d}-{suffix}"


def _period_to_iso(raw: str | None) -> str | None:
    """``MM-DD-YYYY`` → ``YYYY-MM-DD``, or ``None`` when it is not a REAL date.

    The shape match alone would accept an impossible date (``02-30-2026``), which
    would then be persisted as `period_of_report` and used as the as-of key for
    identity resolution. Validate the constructed date so an impossible one
    becomes a missing required field → failed-cover outcome instead. (QA-F2)
    """
    if raw is None:
        return None
    match = _PERIOD.match(raw.strip())
    if match is None:
        return None
    month, day, year = match.groups()
    iso = f"{year}-{month}-{day}"
    try:
        date.fromisoformat(iso)
    except ValueError:
        return None
    return iso


# --- cover -------------------------------------------------------------------


@dataclass(frozen=True)
class OtherManager:
    seq: int | None
    cik: str | None
    name: str | None
    form13f_file_number: str | None
    file_number_norm: str | None

    def as_dict(self) -> dict:
        return {
            "seq": self.seq,
            "cik": self.cik,
            "name": self.name,
            "form13f_file_number": self.form13f_file_number,
            "file_number_norm": self.file_number_norm,
        }


@dataclass(frozen=True)
class CoverPage:
    submission_type: str
    period_of_report: str  # ISO
    is_amendment: bool
    amendment_type: str | None
    amendment_type_raw: str | None
    amendment_no: int | None
    filing_manager: str
    form13f_file_number: str | None
    file_number_norm: str | None
    report_type: str | None
    table_entry_total: int | None
    table_value_total: int | None
    is_confidential_omitted: bool | None
    conf_denied_expired: bool | None
    other_included_managers_count: int | None
    other_managers: tuple[OtherManager, ...]
    schema_version: str | None


def _other_managers(cover_page, summary_page) -> tuple[OtherManager, ...]:
    """Both source shapes: ``summaryPage/otherManagers2Info/otherManager2`` (the
    real filings) and a seq-less ``coverPage/otherManagerInfo/otherManager``."""
    entries: list[OtherManager] = []
    info = _child(summary_page, "otherManagers2Info")
    for om2 in _children(info, "otherManager2"):
        seq = _int(_text(_child(om2, "sequenceNumber")))
        nested = _child(om2, "otherManager")
        manager = nested if nested is not None else om2
        entries.append(_manager_entry(seq, manager))
    single = _child(cover_page, "otherManagerInfo")
    for manager in _children(single, "otherManager"):
        entries.append(_manager_entry(None, manager))
    return tuple(entries)


def _manager_entry(seq: int | None, manager) -> OtherManager:
    file_number = _text(_child(manager, "form13FFileNumber"))
    return OtherManager(
        seq=seq,
        cik=_text(_child(manager, "cik")),
        name=_text(_child(manager, "name")),
        form13f_file_number=file_number,
        file_number_norm=normalize_file_number(file_number),
    )


def parse_cover(xml: bytes) -> CoverPage:
    """Parse ``primary_doc.xml`` into a :class:`CoverPage`; strict (R2)."""
    try:
        root = _parse(xml)
    except (lxml.etree.XMLSyntaxError, UnsafeXmlError) as exc:
        raise CoverParseError(f"cover XML would not parse: {exc}", kind="cover_malformed")
    if root is None:
        raise CoverParseError("cover XML is empty", kind="cover_malformed")

    header = _child(root, "headerData")
    form_data = _child(root, "formData")
    cover_page = _child(form_data, "coverPage")
    summary_page = _child(form_data, "summaryPage")

    submission_type = _text(_descend(header, "submissionType"))
    period = _period_to_iso(
        _text(_child(cover_page, "reportCalendarOrQuarter"))
        or _text(_descend(header, "filerInfo", "periodOfReport"))
    )
    filing_manager = _text(_descend(cover_page, "filingManager", "name"))

    table_entry_total = _int(_text(_child(summary_page, "tableEntryTotal")))
    table_value_total = _int(_text(_child(summary_page, "tableValueTotal")))

    required: list[tuple[str, object]] = [
        ("submission_type", submission_type),
        ("period_of_report", period),
        ("filing_manager", filing_manager),
    ]
    # A HOLDINGS report (13F-HR / 13F-HR/A) must carry interpretable summary
    # totals: the value total is the coverage DENOMINATOR contribution, and a
    # missing/non-numeric one must become a cover-failed filing with an UNKNOWN
    # (NULL) total — never a silent 0, which would shrink the denominator and
    # inflate identity coverage (QA-F1, R2/R16/R18). A NOTICE report (13F-NT)
    # legitimately reports no holdings and no totals.
    if submission_type is not None and submission_type.upper().startswith("13F-HR"):
        required += [
            ("table_entry_total", table_entry_total),
            ("table_value_total", table_value_total),
        ]

    missing = [label for label, value in required if value is None]
    if missing:
        raise CoverParseError(
            f"cover missing required field(s): {', '.join(missing)}",
            kind="cover_missing_field",
        )

    amendment_info = _child(cover_page, "amendmentInfo")
    amendment_type_raw = _text(_child(amendment_info, "amendmentType"))
    amendment_type = None
    if amendment_type_raw is not None:
        amendment_type = _AMENDMENT_TYPES.get(" ".join(amendment_type_raw.split()).upper())
    file_number = _text(_child(cover_page, "form13FFileNumber"))

    return CoverPage(
        submission_type=submission_type,
        period_of_report=period,
        is_amendment=bool(_bool(_text(_child(cover_page, "isAmendment")))),
        amendment_type=amendment_type,
        amendment_type_raw=amendment_type_raw,
        amendment_no=_int(_text(_child(cover_page, "amendmentNo"))),
        filing_manager=filing_manager,
        form13f_file_number=file_number,
        file_number_norm=normalize_file_number(file_number),
        report_type=_text(_child(cover_page, "reportType")),
        table_entry_total=table_entry_total,
        table_value_total=table_value_total,
        is_confidential_omitted=_bool(_text(_child(summary_page, "isConfidentialOmitted"))),
        conf_denied_expired=_bool(_text(_child(amendment_info, "confDeniedExpired"))),
        other_included_managers_count=_int(
            _text(_child(summary_page, "otherIncludedManagersCount"))
        ),
        other_managers=_other_managers(cover_page, summary_page),
        schema_version=_text(_child(root, "schemaVersion")),
    )


# --- information table -------------------------------------------------------

#: The exact raw fields, one flat scalar object per ``<infoTable>``, values as
#: printed (NFC only), missing field = ``None`` (never ``""``). ``putCall`` is
#: absent on equities and is a fixed key so fingerprints stay stable (R3/R15).
INFO_TABLE_RAW_KEYS = (
    "nameOfIssuer",
    "titleOfClass",
    "cusip",
    "value",
    "sshPrnamt",
    "sshPrnamtType",
    "putCall",
    "investmentDiscretion",
    "otherManager",
    "votingSole",
    "votingShared",
    "votingNone",
)


@dataclass(frozen=True)
class InfoTableRow:
    row_ordinal: int
    raw_row: Mapping[str, str | None]

    @property
    def name_of_issuer(self) -> str | None:
        return _trim(self.raw_row["nameOfIssuer"])

    @property
    def title_of_class(self) -> str | None:
        return _trim(self.raw_row["titleOfClass"])

    @property
    def cusip(self) -> str | None:
        return _trim(self.raw_row["cusip"])

    @property
    def value(self) -> str | None:
        return _trim(self.raw_row["value"])

    @property
    def ssh_prnamt(self) -> str | None:
        return _trim(self.raw_row["sshPrnamt"])

    @property
    def ssh_prnamt_type(self) -> str | None:
        return _trim(self.raw_row["sshPrnamtType"])

    @property
    def put_call(self) -> str | None:
        return _trim(self.raw_row["putCall"])

    @property
    def investment_discretion(self) -> str | None:
        return _trim(self.raw_row["investmentDiscretion"])

    @property
    def other_manager(self) -> str | None:
        return _trim(self.raw_row["otherManager"])

    @property
    def voting_sole(self) -> str | None:
        return _trim(self.raw_row["votingSole"])

    @property
    def voting_shared(self) -> str | None:
        return _trim(self.raw_row["votingShared"])

    @property
    def voting_none(self) -> str | None:
        return _trim(self.raw_row["votingNone"])


def parse_info_table(xml: bytes) -> tuple[InfoTableRow, ...]:
    """One :class:`InfoTableRow` per ``<infoTable>`` — never a silent drop (G3).

    An uninterpretable field stays as its raw string in ``raw_row`` (normalized
    to ``None`` only when the element is genuinely absent); nothing here decides
    ``parsed`` vs ``partial`` — that is normalization's job.
    """
    try:
        root = _parse(xml)
    except (lxml.etree.XMLSyntaxError, UnsafeXmlError) as exc:
        raise InfoTableParseError(f"information table XML would not parse: {exc}")
    rows: list[InfoTableRow] = []
    for ordinal, element in enumerate(_children(root, "infoTable"), start=1):
        shares = _child(element, "shrsOrPrnAmt")
        voting = _child(element, "votingAuthority")
        raw_row = {
            "nameOfIssuer": _raw_text(_child(element, "nameOfIssuer")),
            "titleOfClass": _raw_text(_child(element, "titleOfClass")),
            "cusip": _raw_text(_child(element, "cusip")),
            "value": _raw_text(_child(element, "value")),
            "sshPrnamt": _raw_text(_child(shares, "sshPrnamt")),
            "sshPrnamtType": _raw_text(_child(shares, "sshPrnamtType")),
            "putCall": _raw_text(_child(element, "putCall")),
            "investmentDiscretion": _raw_text(_child(element, "investmentDiscretion")),
            "otherManager": _raw_text(_child(element, "otherManager")),
            "votingSole": _raw_text(_child(voting, "Sole")),
            "votingShared": _raw_text(_child(voting, "Shared")),
            "votingNone": _raw_text(_child(voting, "None")),
        }
        rows.append(InfoTableRow(row_ordinal=ordinal, raw_row=raw_row))
    return tuple(rows)


# --- index-driven info-table discovery (R1) ----------------------------------


def discover_info_table_name(index_json: object) -> str:
    """The single information-table XML file named by ``index.json`` (R1).

    Raises :class:`InfoTableMissingError` when none is named and
    :class:`InfoTableAmbiguousError` when more than one is (F1/F2). The name is
    validated as a bare XML file name before any caller joins it to a path.
    """
    if isinstance(index_json, (bytes, bytearray)):
        document = json.loads(index_json.decode("utf-8"))
    elif isinstance(index_json, str):
        document = json.loads(index_json)
    else:
        document = index_json
    items = document.get("directory", {}).get("item", []) if isinstance(document, dict) else []
    candidates = [
        name
        for item in items
        if isinstance(item, dict)
        and isinstance((name := item.get("name")), str)
        and name.lower().endswith(".xml")
        and name != "primary_doc.xml"
        and _SAFE_XML_NAME.fullmatch(name) is not None
    ]
    if not candidates:
        raise InfoTableMissingError("index.json names no information-table XML")
    if len(candidates) > 1:
        raise InfoTableAmbiguousError(
            f"index.json names {len(candidates)} information-table XMLs: {candidates}"
        )
    return candidates[0]
