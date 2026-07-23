"""Senate eFD PTR e-file page parser (ARCHITECTURE.md §9.1/§9.3; RUN 3).

Pure functions over HTML bytes — no I/O, no DB. One public entry,
:func:`parse_ptr_page`, extracts the verified 9-column transactions table
(``#, Transaction Date, Owner, Ticker, Asset Name, Asset Type, Type,
Amount, Comment``) via lxml.

Extraction contract (LD3 — lossless raw, separate clean derivation):

- ``raw_row`` values are each cell's exact text content, NFC-normalized and
  otherwise untouched — no stripping, no whitespace collapsing, no
  sub-element exclusion. A bond's printed Rate/Coupon and Matures
  annotation is therefore inside ``raw_row.asset_name`` and participates in
  the row fingerprint, so two bonds differing only by coupon or maturity
  cannot conflate. A cell whose text is whitespace-only becomes JSON
  ``null`` (§9.4 seven-key shape).
- ``raw_asset_display`` is derived separately: the Asset Name cell's text
  outside ``div.text-muted``, whitespace-collapsed — it feeds only the
  normalized ``transactions.asset_name`` column.
- ``source_row_no`` comes from the printed ``#`` column (§9.4 dup_seq
  coordinates). A ``#`` cell that is present but not a positive integer
  yields ``source_row_no=None`` plus the ``source_row_no_unparsed`` parse
  defect — the dup_seq fallback to presentation order is visible, never
  silent (LD15).

Header drift fails loudly (:class:`HeaderMismatchError`) rather than
mis-mapping columns; a page with no transactions table under
``section.card`` raises :class:`MissingTableError`. Both map to
``parse_status='failed'`` with distinct failure kinds.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import lxml.etree
import lxml.html

from populus.canonical import nfc

PARSER_VERSION = "senate-ptr-1.0.0"

EXPECTED_HEADER = (
    "#",
    "Transaction Date",
    "Owner",
    "Ticker",
    "Asset Name",
    "Asset Type",
    "Type",
    "Amount",
    "Comment",
)

# Column position → raw_row key for the seven §9.4:540 identity keys. The
# printed Asset Type column (position 5) is a normalized column input, not
# an identity input (LD2), so it is deliberately absent here.
_RAW_KEY_BY_POSITION = {
    1: "transaction_date",
    2: "owner",
    3: "ticker",
    4: "asset_name",
    6: "side",
    7: "amount_label",
    8: "comment",
}

_DECLARED_TOTAL = re.compile(r"\((\d+) transactions? total\)")
_POSITIVE_INT = re.compile(r"[0-9]+")


class MissingTableError(ValueError):
    """The page carries no transactions table under ``section.card``."""


class HeaderMismatchError(ValueError):
    """The transactions table header is not the verified 9-column set."""


@dataclass(frozen=True)
class SenateRow:
    """One extracted table row: lossless raw cells + derived coordinates."""

    raw_row: Mapping[str, Any]
    raw_asset_display: str | None
    asset_type_cell: str | None
    row_ordinal: int
    source_row_no: int | None
    structural_flags: frozenset[str]


@dataclass(frozen=True)
class SenatePtrParse:
    rows: tuple[SenateRow, ...]
    declared_total: int | None
    title: str | None
    filer_display: str | None


def _collapsed(text: str) -> str:
    return " ".join(text.split())


def _raw_cell(cell: lxml.html.HtmlElement) -> str | None:
    """The cell's exact text content, NFC only; whitespace-only → ``None``."""
    text = nfc(cell.text_content())
    if not text.strip():
        return None
    return text


def _is_muted(node: object) -> bool:
    return (
        isinstance(getattr(node, "tag", None), str)
        and node.tag == "div"
        and "text-muted" in (node.get("class") or "")
    )


def _collect_outside_muted(node: lxml.html.HtmlElement, parts: list[str]) -> None:
    parts.append(node.text or "")
    for child in node:
        if isinstance(child.tag, str) and not _is_muted(child):
            _collect_outside_muted(child, parts)
        parts.append(child.tail or "")


def _asset_display(cell: lxml.html.HtmlElement) -> str | None:
    """Clean asset text: nodes outside ``div.text-muted``, collapsed (LD3)."""
    parts: list[str] = []
    _collect_outside_muted(cell, parts)
    display = _collapsed(nfc("".join(parts)))
    return display or None


def _source_row_no(cell_text: str) -> tuple[int | None, frozenset[str]]:
    """The printed ``#`` as a positive integer, or ``None`` + defect (LD15).

    Called only for a PRESENT ``#`` cell (an absent cell is a short row,
    covered by ``row_incomplete``); a present cell that is blank or not a
    positive integer is a visible parse defect — never a silent fallback to
    presentation order.
    """
    token = cell_text.strip()
    if _POSITIVE_INT.fullmatch(token) and int(token) > 0:
        return int(token), frozenset()
    return None, frozenset({"source_row_no_unparsed"})


def _extract_row(
    tr: lxml.html.HtmlElement, row_ordinal: int
) -> SenateRow:
    cells = tr.findall("td")
    structural: set[str] = set()
    if len(cells) < 9:
        structural.add("row_incomplete")

    def cell(position: int) -> lxml.html.HtmlElement | None:
        return cells[position] if position < len(cells) else None

    raw_row: dict[str, Any] = {}
    for position, key in _RAW_KEY_BY_POSITION.items():
        td = cell(position)
        raw_row[key] = _raw_cell(td) if td is not None else None

    number_cell = cell(0)
    if number_cell is None:
        source_row_no = None  # short row — row_incomplete already covers it
    else:
        source_row_no, number_flags = _source_row_no(nfc(number_cell.text_content()))
        structural |= number_flags

    asset_cell = cell(4)
    type_cell = cell(5)
    return SenateRow(
        raw_row=raw_row,
        raw_asset_display=_asset_display(asset_cell) if asset_cell is not None else None,
        asset_type_cell=_raw_cell(type_cell) if type_cell is not None else None,
        row_ordinal=row_ordinal,
        source_row_no=source_row_no,
        structural_flags=frozenset(structural),
    )


def _first_text(doc: lxml.html.HtmlElement, xpath: str) -> str | None:
    nodes = doc.xpath(xpath)
    if not nodes:
        return None
    return _collapsed(nfc(nodes[0].text_content())) or None


def parse_ptr_page(html: bytes, *, uuid: str) -> SenatePtrParse:
    """Parse one archived e-file PTR page into lossless rows (LD3/§9.4)."""
    try:
        doc = lxml.html.document_fromstring(html)
    except (lxml.etree.ParserError, ValueError) as exc:
        raise MissingTableError(f"{uuid}: page is not parseable HTML ({exc})")
    tables = doc.xpath(
        "//section[contains(concat(' ', normalize-space(@class), ' '), ' card ')]"
        "//table"
    )
    if not tables:
        raise MissingTableError(f"{uuid}: no transactions table under section.card")
    table = tables[0]
    header = tuple(
        _collapsed(th.text_content()) for th in table.xpath(".//thead//th")
    )
    if header != EXPECTED_HEADER:
        raise HeaderMismatchError(
            f"{uuid}: header drift — expected {EXPECTED_HEADER}, found {header}"
        )
    rows = tuple(
        _extract_row(tr, ordinal)
        for ordinal, tr in enumerate(table.findall(".//tbody/tr"), start=1)
    )
    declared = _DECLARED_TOTAL.search(doc.text_content())
    return SenatePtrParse(
        rows=rows,
        declared_total=int(declared.group(1)) if declared else None,
        title=_first_text(doc, "//h1"),
        filer_display=_first_text(
            doc,
            "//h2[contains(concat(' ', normalize-space(@class), ' '),"
            " ' filedReport ')]",
        ),
    )
