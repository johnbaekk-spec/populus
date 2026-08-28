"""Deterministic bulk-13F corpus for RUN M2-6 hermetic tests + acceptance.

One coherent filing quarter (``2026q3``) and one locked report period
(``2026-06-30``), with the amendment topologies the ranking rule must value
against ``v_default_inst_filings``:

  * MEGA CAPITAL    — base only .......................... 900M (rank 1)
  * RESTATE PARTNERS— base + RESTATEMENT (restatement wins) 500M (rank 2)
  * AFTER HOLDINGS  — base + RESTATEMENT + NEW_HOLDINGS-after 350M (rank 3)
  * BEFORE HOLDINGS — base + NEW_HOLDINGS-before + RESTATEMENT 200M (rank 4)
  * PLAIN NEW LLC   — base + NEW_HOLDINGS (union merge) .... 120M (rank 5)
  * SMALL FRY LP    — base only ........................... 10M (beyond top-5)
  * WRONG PERIOD CO — base at 2026-03-31 (dropped at ranking) 999M

Each filing carries a single holding whose value equals its ``tableValueTotal``
and whose CUSIP is seedable, so a fully-seeded corpus resolves to 100% value
coverage. The builder emits no files: it returns the exact URL→bytes map a
``_FakeSecTransport`` serves (submissions + per-accession index/cover/table) plus
the ``form.idx`` text, so ranking and ingest run entirely over committed bytes
with zero sockets. The committed static ``form.idx`` fixture is generated from
this same spec (``scripts/fixtures/institutional_bulk.py``).
"""

from __future__ import annotations

from dataclasses import dataclass

FILING_QUARTER = "2026q3"
REPORT_PERIOD = "2026-06-30"
WRONG_PERIOD = "2026-03-31"


@dataclass(frozen=True)
class FilingSpec:
    seq: int
    form: str
    filed: str            # ISO
    period: str           # ISO
    value: int            # tableValueTotal == holding value (whole dollars)
    cusip: str
    amendment_type: str | None = None   # "NEW HOLDINGS" | "RESTATEMENT"
    amendment_no: int | None = None


@dataclass(frozen=True)
class FilerSpec:
    cik: str
    name: str
    filings: tuple[FilingSpec, ...]


# The spec. Values chosen so effective survivor values are distinct and the
# ranking order is unambiguous; WRONG PERIOD's 999M would rank first if the
# report-period filter were dropped (the mutation guard).
CORPUS: tuple[FilerSpec, ...] = (
    FilerSpec("0009100001", "MEGA CAPITAL", (
        FilingSpec(1, "13F-HR", "2026-07-05", REPORT_PERIOD, 900_000_000, "911000010"),
    )),
    FilerSpec("0009100002", "RESTATE PARTNERS", (
        FilingSpec(1, "13F-HR", "2026-07-10", REPORT_PERIOD, 100_000_000, "911000021"),
        FilingSpec(2, "13F-HR/A", "2026-08-10", REPORT_PERIOD, 500_000_000, "911000022",
                   "RESTATEMENT", 1),
    )),
    FilerSpec("0009100003", "AFTER HOLDINGS", (
        FilingSpec(1, "13F-HR", "2026-07-15", REPORT_PERIOD, 100_000_000, "911000031"),
        FilingSpec(2, "13F-HR/A", "2026-08-15", REPORT_PERIOD, 300_000_000, "911000032",
                   "RESTATEMENT", 1),
        FilingSpec(3, "13F-HR/A", "2026-09-15", REPORT_PERIOD, 50_000_000, "911000033",
                   "NEW HOLDINGS", 2),
    )),
    FilerSpec("0009100004", "BEFORE HOLDINGS", (
        FilingSpec(1, "13F-HR", "2026-07-20", REPORT_PERIOD, 100_000_000, "911000041"),
        FilingSpec(2, "13F-HR/A", "2026-08-01", REPORT_PERIOD, 20_000_000, "911000042",
                   "NEW HOLDINGS", 1),
        FilingSpec(3, "13F-HR/A", "2026-09-01", REPORT_PERIOD, 200_000_000, "911000043",
                   "RESTATEMENT", 2),
    )),
    FilerSpec("0009100005", "PLAIN NEW LLC", (
        FilingSpec(1, "13F-HR", "2026-07-25", REPORT_PERIOD, 80_000_000, "911000051"),
        FilingSpec(2, "13F-HR/A", "2026-08-25", REPORT_PERIOD, 40_000_000, "911000052",
                   "NEW HOLDINGS", 1),
    )),
    FilerSpec("0009100006", "SMALL FRY LP", (
        FilingSpec(1, "13F-HR", "2026-07-30", REPORT_PERIOD, 10_000_000, "911000061"),
    )),
    FilerSpec("0009100007", "WRONG PERIOD CO", (
        FilingSpec(1, "13F-HR", "2026-07-12", WRONG_PERIOD, 999_000_000, "911000071"),
    )),
)

#: The effective survivor value each filer ranks on (the ranking oracle).
EXPECTED_EFFECTIVE = {
    "0009100001": 900_000_000,
    "0009100002": 500_000_000,
    "0009100003": 350_000_000,
    "0009100004": 200_000_000,
    "0009100005": 120_000_000,
    "0009100006": 10_000_000,
    # WRONG PERIOD CO is not eligible (no filing at the report period).
}


def _iso_to_mdy(iso: str) -> str:
    year, month, day = iso.split("-")
    return f"{month}-{day}-{year}"


def _accession(cik: str, seq: int) -> str:
    return f"{cik}-26-{seq:06d}"


def _table_name(cik: str, seq: int) -> str:
    return f"tbl_{cik[-4:]}_{seq}.xml"


def _amendment_block(spec: FilingSpec) -> str:
    if spec.amendment_type is None:
        return ""
    return (
        "      <isAmendment>true</isAmendment>\n"
        f"      <amendmentNo>{spec.amendment_no}</amendmentNo>\n"
        "      <amendmentInfo>\n"
        f"        <amendmentType>{spec.amendment_type}</amendmentType>\n"
        "      </amendmentInfo>\n"
    )


def _cover_xml(filer: FilerSpec, spec: FilingSpec) -> bytes:
    period_mdy = _iso_to_mdy(spec.period)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler"'
        ' xmlns:ns1="http://www.sec.gov/edgar/common"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        "  <schemaVersion>X0202</schemaVersion>\n"
        "  <headerData>\n"
        f"    <submissionType>{spec.form}</submissionType>\n"
        "    <filerInfo>\n"
        "      <liveTestFlag>LIVE</liveTestFlag>\n"
        f"      <periodOfReport>{period_mdy}</periodOfReport>\n"
        "    </filerInfo>\n"
        "  </headerData>\n"
        "  <formData>\n"
        "    <coverPage>\n"
        f"      <reportCalendarOrQuarter>{period_mdy}</reportCalendarOrQuarter>\n"
        f"{_amendment_block(spec)}"
        "      <filingManager>\n"
        f"        <name>{filer.name}</name>\n"
        "        <address><ns1:stateOrCountry>NY</ns1:stateOrCountry></address>\n"
        "      </filingManager>\n"
        "      <reportType>13F HOLDINGS REPORT</reportType>\n"
        f"      <form13FFileNumber>028-{filer.cik[-4:]}</form13FFileNumber>\n"
        "      <provideInfoForInstruction5>N</provideInfoForInstruction5>\n"
        "    </coverPage>\n"
        "    <signatureBlock><name>A Signer</name>"
        "<signatureDate>01-01-2020</signatureDate></signatureBlock>\n"
        "    <summaryPage>\n"
        "      <otherIncludedManagersCount>0</otherIncludedManagersCount>\n"
        "      <tableEntryTotal>1</tableEntryTotal>\n"
        f"      <tableValueTotal>{spec.value}</tableValueTotal>\n"
        "      <isConfidentialOmitted>false</isConfidentialOmitted>\n"
        "    </summaryPage>\n"
        "  </formData>\n"
        "</edgarSubmission>\n"
    )
    return xml.encode("utf-8")


def _table_xml(filer: FilerSpec, spec: FilingSpec) -> bytes:
    shares = max(1, spec.value // 1000)
    xml = (
        '<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/'
        'informationtable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        "  <infoTable>\n"
        f"    <nameOfIssuer>{filer.name} ISSUER</nameOfIssuer>\n"
        "    <titleOfClass>COM</titleOfClass>\n"
        f"    <cusip>{spec.cusip}</cusip>\n"
        f"    <value>{spec.value}</value>\n"
        "    <shrsOrPrnAmt>\n"
        f"      <sshPrnamt>{shares}</sshPrnamt>\n"
        "      <sshPrnamtType>SH</sshPrnamtType>\n"
        "    </shrsOrPrnAmt>\n"
        "    <investmentDiscretion>SOLE</investmentDiscretion>\n"
        "    <votingAuthority>\n"
        f"      <Sole>{shares}</Sole><Shared>0</Shared><None>0</None>\n"
        "    </votingAuthority>\n"
        "  </infoTable>\n"
        "</informationTable>\n"
    )
    return xml.encode("utf-8")


def _index_json(cik: str, spec: FilingSpec) -> bytes:
    nodash = _accession(cik, spec.seq).replace("-", "")
    table = _table_name(cik, spec.seq)
    doc = (
        '{"directory":{"item":['
        '{"last-modified":"2026-01-01 00:00:00","name":"primary_doc.xml",'
        '"type":"text.gif","size":""},'
        f'{{"last-modified":"2026-01-01 00:00:00","name":"{table}",'
        '"type":"text.gif","size":"1000"}],'
        f'"name":"/Archives/edgar/data/X/{nodash}",'
        '"parent-dir":"/Archives/edgar/data/X"}}'
    )
    return doc.encode("utf-8")


def _submissions_json(filer: FilerSpec) -> bytes:
    accessions = [_accession(filer.cik, f.seq) for f in filer.filings]
    forms = [f.form for f in filer.filings]
    filed = [f.filed for f in filer.filings]
    report = [f.period for f in filer.filings]
    file_numbers = [f"028-{filer.cik[-4:]}" for _ in filer.filings]
    primary = ["primary_doc.xml" for _ in filer.filings]

    def _arr(values):
        return "[" + ",".join(f'"{v}"' for v in values) + "]"

    doc = (
        f'{{"cik":"{filer.cik}","name":"{filer.name}","filings":{{"recent":{{'
        f'"accessionNumber":{_arr(accessions)},'
        f'"filingDate":{_arr(filed)},'
        f'"reportDate":{_arr(report)},'
        f'"form":{_arr(forms)},'
        f'"fileNumber":{_arr(file_numbers)},'
        f'"primaryDocument":{_arr(primary)}}},"files":[]}}}}'
    )
    return doc.encode("utf-8")


def _archive_base(cik: str, nodash: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nodash}"


def _submissions_url(cik: str) -> str:
    return f"https://data.sec.gov/submissions/CIK{cik}.json"


def form_index_url() -> str:
    return "https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx"


def build_form_index_text() -> str:
    """The exact ``form.idx`` text (header + dashed rule + one line per filing,
    plus a non-13F noise line)."""
    header = (
        "Description:           Master Index of EDGAR Dissemination Feed by Form Type\n"
        "Last Data Received:    September 30, 2026\n"
        "\n"
        "Form Type   Company Name"
        "                                        CIK         Date Filed  File Name\n"
        + ("-" * 100) + "\n"
    )
    lines: list[str] = []
    for filer in CORPUS:
        for spec in filer.filings:
            accession = _accession(filer.cik, spec.seq)
            filename = f"edgar/data/{int(filer.cik)}/{accession}.txt"
            lines.append(
                f"{spec.form:<11} {filer.name:<52} {int(filer.cik):<11}"
                f" {spec.filed}  {filename}"
            )
    # A non-13F row that discovery must ignore (not a reject).
    lines.append(
        f"10-K        SOME OPERATING CO"
        f"                                    {int('0000000042'):<11}"
        f" 2026-07-01  edgar/data/42/0000000042-26-000001.txt"
    )
    return header + "\n".join(lines) + "\n"


def filer_refs(filer: FilerSpec) -> list:
    """The :class:`FormIndexRef` list for one filer (for direct ranking tests)."""
    from populus.inst_bulk import FormIndexRef

    refs = []
    for spec in filer.filings:
        accession = _accession(filer.cik, spec.seq)
        refs.append(
            FormIndexRef(
                cik=filer.cik,
                accession=accession,
                accession_nodash=accession.replace("-", ""),
                form=spec.form,
                filed_date=spec.filed,
            )
        )
    return refs


def filer_url_map(filer: FilerSpec) -> dict[str, bytes]:
    """The URL→bytes map for one filer's submissions + per-accession documents."""
    url_map: dict[str, bytes] = {_submissions_url(filer.cik): _submissions_json(filer)}
    for spec in filer.filings:
        nodash = _accession(filer.cik, spec.seq).replace("-", "")
        base = _archive_base(filer.cik, nodash)
        table = _table_name(filer.cik, spec.seq)
        url_map[f"{base}/index.json"] = _index_json(filer.cik, spec)
        url_map[f"{base}/primary_doc.xml"] = _cover_xml(filer, spec)
        url_map[f"{base}/{table}"] = _table_xml(filer, spec)
    return url_map


def filer_lineage(filer: FilerSpec) -> tuple[str, ...]:
    """The complete-lineage target accessions for one filer, for the period."""
    return tuple(
        _accession(filer.cik, spec.seq)
        for spec in filer.filings
        if spec.period == REPORT_PERIOD
    )


@dataclass(frozen=True)
class BulkCorpus:
    filing_quarter: str
    report_period: str
    url_map: dict[str, bytes]
    form_index_text: str
    cusips: tuple[str, ...]
    corpus: tuple[FilerSpec, ...]


def build_bulk_corpus() -> BulkCorpus:
    """The URL→bytes map a fake transport serves for the whole corpus, plus the
    form.idx text and the seedable CUSIP list."""
    url_map: dict[str, bytes] = {}
    cusips: list[str] = []
    form_text = build_form_index_text()
    url_map[form_index_url()] = form_text.encode("utf-8")
    for filer in CORPUS:
        url_map[_submissions_url(filer.cik)] = _submissions_json(filer)
        for spec in filer.filings:
            nodash = _accession(filer.cik, spec.seq).replace("-", "")
            base = _archive_base(filer.cik, nodash)
            table = _table_name(filer.cik, spec.seq)
            url_map[f"{base}/index.json"] = _index_json(filer.cik, spec)
            url_map[f"{base}/primary_doc.xml"] = _cover_xml(filer, spec)
            url_map[f"{base}/{table}"] = _table_xml(filer, spec)
            cusips.append(spec.cusip)
    return BulkCorpus(
        filing_quarter=FILING_QUARTER,
        report_period=REPORT_PERIOD,
        url_map=url_map,
        form_index_text=form_text,
        cusips=tuple(cusips),
        corpus=CORPUS,
    )
