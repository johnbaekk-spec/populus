"""House Clerk PTR parser (ARCHITECTURE.md §9.3; RUN 2).

Pure functions over PDF bytes, positioned words, or extracted text — no I/O,
no DB. Two parsing legs share one closed-denominator segmentation contract
(R7): every table-region line is a proven repeated column header or
contributes to exactly one emitted row candidate; incomplete or orphaned
candidates are emitted flagged, never dropped (G3).

- **Positioned path** (primary): pdfplumber word coordinates, columns
  assigned from the header row's x-anchors, wrap-vs-row decided by the
  observable pitch predicate (LD20).
- **Text path** (fallback, R22): pypdf layout-mode text — and only pypdf; the
  classifier's :func:`extract_pages` is never the parser's source (R23) —
  cells split on runs of >= 2 spaces and typed by :data:`COLUMN_SIGNATURES`.
  Every candidate is tagged ``text_fallback``.

Fragment routing (R24/R25, both paths): a fragment carrying another column's
signature is offered only that column's completion test — an amount fragment
joins the open candidate's amount cell iff the unjoined cell does not parse
to an Appendix C bucket and the joined string does (the completion oracle is
:func:`populus.normalize.normalize_amount`). A fragment that completes
nothing opens a new ``row_incomplete``+``row_orphan`` candidate carrying the
fragment verbatim in its *own* cell; only untyped fragments may continue the
asset cell. Corpus evidence for the split cells this handles: pdfplumber and
pypdf-layout both print ``$50,001 - $100,000``-class amount cells across two
physical lines (fixtures 2020_20017555, 2026_20034168, 2020_20013901).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from statistics import median

from populus.canonical import nfc
from populus.normalize import normalize_amount


def _clean(text: str) -> str:
    """NFC plus removal of NUL extraction artifacts.

    2026-era House PDFs map their small-caps glyphs to U+0000 (verified on
    2026_20034800: "FILING" extracts as ``F\\x00\\x00\\x00\\x00\\x00``). NULs
    are unmapped-glyph placeholders, not printed characters, so stripping
    them is extraction cleanup, not normalization — ``raw_row`` fidelity
    ("exactly as printed, NFC only") is preserved.
    """
    return nfc(text.replace("\x00", ""))

PARSER_VERSION = "house-ptr-1.3.0"
WRAP_PITCH_TOLERANCE = 1.5

# Words closer than this vertically belong to one printed line (pdfplumber's
# own extract_text default; the cap-gains glyph sits ~1pt below its row).
_LINE_GROUP_TOLERANCE = 3.0

# Column x-anchors may print a point or two left of the header word.
_COLUMN_X_SLACK = 3.0

_PAPER_YIELD_THRESHOLD = 200


class UnreadablePdfError(Exception):
    """Neither extraction engine could open/extract the document (LD12)."""


class EmptyParseError(Exception):
    """A readable e-file document produced zero row candidates (R20)."""


# --- column signatures (one table, both consumers — R25) ---------------------

# The same recognizers assign cells on structural lines and type fragments,
# so "amount-shaped" cannot drift between the two decisions. Shapes are
# calibrated to the observed corpus (T3a): non-zero-padded dates, "S
# (partial)" sides, ticker-free amounts including wrapped fragments such as
# "$50,001 -", and the Wingdings checkbox glyph runs.
# "amount" deliberately also matches malformed dollar-led cells ("$100,00X"):
# a garbled amount fragment must still route to the amount-completion test —
# never to the asset branch (R25) — where its failed join opens a flagged
# orphan carrying it in ``amount_label``.
COLUMN_SIGNATURES: dict[str, re.Pattern[str]] = {
    "id": re.compile(r"^\d{1,4}$"),
    "owner": re.compile(r"^(?:SP|DC|JT|SELF)$", re.IGNORECASE),
    "side": re.compile(r"^(?:P|S|E|S\s*\(partial\))$", re.IGNORECASE),
    "date": re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$"),
    "amount": re.compile(
        r"^(?:(?:Spouse/DC\s+)?(?:Over\s+)?\$\d[\w,.]*(?:\s*-\s*(?:\$?[\w,.]*)?)?"
        r"|Spouse/DC\s+Over)$",
        re.IGNORECASE,
    ),
    "capgains": re.compile(r"^(?:gfedc|gfedcb)$", re.IGNORECASE),
}

# Columns whose presence on a line makes it structural (opens a candidate).
# Amount is deliberately absent: no amount-bearing line automatically opens a
# row (R24) — wrapped amount cells are fragments, on both paths.
_STRUCTURAL_COLUMNS = ("id", "owner", "side", "date", "notification")

# On the positioned path a cell counts as a structural signal only when its
# text VALIDATES against its column's signature — long filer comments wrap
# into full-width paragraph lines whose words land in structural columns by
# x-position alone (corpus DocIDs 20034044, 20034201), and mistaking those
# for rows fabricates garbage candidates.
_STRUCTURAL_VALIDATORS = {
    "id": COLUMN_SIGNATURES["id"],
    "owner": COLUMN_SIGNATURES["owner"],
    "side": COLUMN_SIGNATURES["side"],
    "date": COLUMN_SIGNATURES["date"],
    "notification": COLUMN_SIGNATURES["date"],
}


def _has_typed_cell(cells: dict[str, str]) -> bool:
    """Whether any cell matches its OWN column's signature (M1-C).

    The row-shaped test for sub-line continuation. Unlike
    :func:`_is_structural_cells` it also counts ``amount`` and ``capgains``:
    opening a row on an amount alone is forbidden (R24), but a line bearing a
    real amount is still transaction-shaped and must never be folded into a
    comment.
    """
    return any(
        column in cells and signature.match(cells[column])
        for column, signature in COLUMN_SIGNATURES.items()
    )


def _is_structural_cells(cells: dict[str, str]) -> bool:
    return any(
        column in cells and validator.match(cells[column])
        for column, validator in _STRUCTURAL_VALIDATORS.items()
    )

_COLUMN_ORDER = (
    "id",
    "owner",
    "asset",
    "side",
    "date",
    "notification",
    "amount",
    "capgains",
)

# --- line-text recognizers ---------------------------------------------------

# 2026-era PDFs extract small-caps glyphs as blanks, degrading "FILING
# STATUS:" to "F S:" — recognizers therefore match on the de-spaced,
# uppercased line text (T3a).
_SUBLINE_PREFIXES = (
    ("FILINGSTATUS:", "filing_status"),
    ("FS:", "filing_status"),
    ("SUBHOLDINGOF:", "subholding_of"),
    ("SO:", "subholding_of"),
    ("LOCATION:", "location"),
    ("L:", "location"),
    ("DESCRIPTION:", "comment"),
    ("D:", "comment"),
    ("COMMENTS:", "comment"),
    ("C:", "comment"),
)

# M1-E: every sub-line kind now has a home on the candidate, so each one's
# wrapped tail continues its own field. Before this the non-comment kinds
# carried ``None`` and their tails could only become flagged orphan rows.
_SUBLINE_PARTS = {
    "comment": "comment_parts",
    "filing_status": "filing_status_parts",
    "subholding_of": "subholding_of_parts",
    "location": "location_parts",
}

_REGION_END_PREFIXES = (
    "*FORTHECOMPLETELIST",
    "INVESTMENTVEHICLEDETAILS",
    "ASSETCLASSDETAILS",
    "INITIALPUBLICOFFERINGS",
    "CERTIFICATION",
    "ASSETTYPE",
)
# Full-line degraded (first-letters-only) 2026 markers, matched exactly.
_REGION_END_EXACT = frozenset({"IVD", "ACD", "IPO", "CS", "COMMENTS"})

_HEADER_CONTINUATIONS = frozenset({"TYPEDATE", "TYPEDATEGAINS>", "$200?"})

_TICKER_PAREN = re.compile(r"\(([A-Za-z0-9.$:\-]{1,15})\)")


def _despaced(text: str) -> str:
    return "".join(text.split()).upper()


def _is_column_header(text: str) -> bool:
    d = _despaced(text)
    return "OWNER" in d and "ASSET" in d and "AMOUNT" in d


def _is_header_continuation(text: str) -> bool:
    return _despaced(text) in _HEADER_CONTINUATIONS


def _is_region_end(text: str) -> bool:
    d = _despaced(text)
    if d in _REGION_END_EXACT:
        return True
    return any(d.startswith(prefix) for prefix in _REGION_END_PREFIXES)


def _subline_kind(text: str) -> tuple[bool, str | None, str | None]:
    """``(is_subline, comment_or_none, value)`` for a table-region line."""
    d = _despaced(text)
    for prefix, kind in _SUBLINE_PREFIXES:
        if d.startswith(prefix):
            _, _, value = text.partition(":")
            return True, kind, value.strip() or None
    return False, None, None


def _ticker_from_asset(asset: str | None) -> str | None:
    """LD6: the last parenthesized symbol-shaped token, exactly as printed."""
    if asset is None:
        return None
    matches = _TICKER_PAREN.findall(asset)
    return matches[-1] if matches else None


# --- data types --------------------------------------------------------------


@dataclass(frozen=True)
class Word:
    text: str
    x0: float


@dataclass(frozen=True)
class Line:
    """One printed line of positioned words (page-relative ``top``)."""

    top: float
    words: tuple[Word, ...]
    page: int = 0

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


@dataclass(frozen=True)
class Classification:
    kind: str  # 'efile' | 'paper'
    conflict: bool
    text_chars: int


@dataclass
class RowCandidate:
    """A row being assembled; cells only ever hold their own column's text."""

    opened_by_structural: bool
    text_fallback: bool = False
    id_cell: str | None = None
    owner_cell: str | None = None
    asset_parts: list[str] = field(default_factory=list)
    side_cell: str | None = None
    date_cell: str | None = None
    notification_cell: str | None = None
    amount_parts: list[str] = field(default_factory=list)
    capgains_cell: str | None = None
    comment_parts: list[str] = field(default_factory=list)
    # M1-E: the non-comment sub-lines printed under the row. Captured so a
    # wrapped tail has somewhere to go other than a fabricated orphan row.
    filing_status_parts: list[str] = field(default_factory=list)
    subholding_of_parts: list[str] = field(default_factory=list)
    location_parts: list[str] = field(default_factory=list)
    block_open: bool = True

    @property
    def asset_text(self) -> str | None:
        return " ".join(self.asset_parts) if self.asset_parts else None

    @property
    def amount_label(self) -> str | None:
        return " ".join(self.amount_parts) if self.amount_parts else None

    @property
    def comment_text(self) -> str | None:
        return " ".join(self.comment_parts) if self.comment_parts else None

    @property
    def filing_status_text(self) -> str | None:
        return " ".join(self.filing_status_parts) or None

    @property
    def subholding_of_text(self) -> str | None:
        return " ".join(self.subholding_of_parts) or None

    @property
    def location_text(self) -> str | None:
        return " ".join(self.location_parts) or None

    def structural_flags(self) -> set[str]:
        flags: set[str] = set()
        if self.side_cell is None or self.date_cell is None or self.amount_label is None:
            flags.add("row_incomplete")
        if not self.opened_by_structural:
            flags.update(("row_incomplete", "row_orphan"))
        if self.text_fallback:
            flags.add("text_fallback")
        return flags


@dataclass(frozen=True)
class PtrHeader:
    name: str | None
    status: str | None
    state_district: str | None


@dataclass(frozen=True)
class PtrRow:
    raw_row: dict[str, str | None]
    cap_gains_cell: str | None
    source_row_no: int | None
    row_ordinal: int
    structural_flags: frozenset[str]
    # M1-E sub-lines: outside raw_row so identity is untouched.
    filing_status: str | None = None
    subholding_of: str | None = None
    location: str | None = None


@dataclass(frozen=True)
class PtrParse:
    header: PtrHeader
    rows: tuple[PtrRow, ...]
    path: str  # 'positioned' | 'text_fallback'
    cap_gains_column: bool


# --- extraction: classification text (never the parser's source) -------------


def extract_pages(pdf_bytes: bytes) -> list[str]:
    """Per-page plain text for the yield classifier — classification ONLY.

    pdfplumber first; if it errors or yields no text, plain pypdf. Empty text
    from a healthy extraction is a real answer (a scan); only both engines
    *erroring* raises :class:`UnreadablePdfError`.
    """
    pages, plumber_error = _extract_pages_pdfplumber(pdf_bytes)
    if pages is not None and any(page.strip() for page in pages):
        return pages
    fallback = _extract_pages_pypdf_plain(pdf_bytes)
    if fallback is not None:
        return fallback
    if pages is not None:
        return pages
    raise UnreadablePdfError(f"both extraction engines failed: {plumber_error}")


def _extract_pages_pdfplumber(
    pdf_bytes: bytes,
) -> tuple[list[str] | None, Exception | None]:
    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return [_clean(page.extract_text() or "") for page in pdf.pages], None
    except Exception as exc:  # noqa: BLE001 — any engine error means "try pypdf"
        return None, exc


def _extract_pages_pypdf_plain(pdf_bytes: bytes) -> list[str] | None:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return [_clean(page.extract_text() or "") for page in reader.pages]
    except Exception:  # noqa: BLE001
        return None


def extract_pages_pypdf_layout(pdf_bytes: bytes) -> list[str]:
    """The fallback parser's text source — pypdf layout mode, and only that.

    Layout mode is mandatory (R23): plain-mode extraction returns this
    corpus's transaction table as a single concatenated line (verified on
    2020_20013901) and cannot be segmented into rows. No pdfplumber import
    path reaches this function, so pypdf provenance is structural. Raises
    :class:`UnreadablePdfError` when pypdf errors or every page is blank.
    """
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [
            _clean(
                page.extract_text(
                    extraction_mode="layout", layout_mode_space_vertically=False
                )
                or ""
            )
            for page in reader.pages
        ]
    except Exception as exc:  # noqa: BLE001
        raise UnreadablePdfError(f"pypdf layout extraction failed: {exc}") from exc
    if not any(line.strip() for page in pages for line in page.splitlines()):
        raise UnreadablePdfError("pypdf layout extraction yielded no text")
    return pages


# --- classifier (OQ-3) -------------------------------------------------------

_PAPER_DOCID = re.compile(r"^[89]\d{6}$")
_EFILE_DOCID = re.compile(r"^20\d{6}$")


def classify(pdf_bytes: bytes, doc_id: str) -> Classification:
    """Extraction-yield primary signal cross-checked against DocID shape.

    <200 chars across the first 3 pages ⇒ paper. Disagreement with the DocID
    shape ⇒ ``conflict`` and paper (conservative — a wrongly-OCR'd filing is
    recoverable; wrongly-parsed garbage is not).
    """
    pages = extract_pages(pdf_bytes)
    text_chars = sum(len(page.strip()) for page in pages[:3])
    yield_kind = "paper" if text_chars < _PAPER_YIELD_THRESHOLD else "efile"
    if _PAPER_DOCID.match(doc_id):
        shape_kind: str | None = "paper"
    elif _EFILE_DOCID.match(doc_id):
        shape_kind = "efile"
    else:
        shape_kind = None
    if shape_kind is not None and shape_kind != yield_kind:
        return Classification(kind="paper", conflict=True, text_chars=text_chars)
    return Classification(kind=yield_kind, conflict=False, text_chars=text_chars)


# --- positioned extraction ---------------------------------------------------


def extract_positioned(pdf_bytes: bytes) -> list[list[Line]]:
    """pdfplumber words grouped into printed lines, one list per page."""
    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages: list[list[Line]] = []
            for page_no, page in enumerate(pdf.pages):
                words = sorted(
                    page.extract_words(), key=lambda w: (w["top"], w["x0"])
                )
                lines: list[list[dict]] = []
                for word in words:
                    if (
                        lines
                        and word["top"] - lines[-1][0]["top"] <= _LINE_GROUP_TOLERANCE
                    ):
                        lines[-1].append(word)
                    else:
                        lines.append([word])
                page_lines = []
                for group in lines:
                    cleaned = tuple(
                        Word(text=text, x0=w["x0"])
                        for w in sorted(group, key=lambda w: w["x0"])
                        if (text := _clean(w["text"]).strip())
                    )
                    if cleaned:
                        page_lines.append(
                            Line(top=group[0]["top"], words=cleaned, page=page_no)
                        )
                pages.append(page_lines)
            return pages
    except Exception as exc:  # noqa: BLE001
        raise UnreadablePdfError(f"pdfplumber positioned extraction failed: {exc}") from exc


def _header_anchors(line: Line) -> list[tuple[float, str]]:
    """Column x-anchors from a header line's recognizable words."""
    names = {
        "id": "id",
        "owner": "owner",
        "asset": "asset",
        "transaction": "side",
        "date": "date",
        "notification": "notification",
        "amount": "amount",
        "cap.": "capgains",
        "cap": "capgains",
    }
    anchors: list[tuple[float, str]] = []
    seen: set[str] = set()
    for word in line.words:
        key = word.text.strip().lower()
        column = names.get(key)
        # The header prints "Date" twice ("Date", "Notification Date"); the
        # second Date word belongs to the continuation row and never reaches
        # here (it sits on the "Type Date" line).
        if column and column not in seen:
            anchors.append((word.x0, column))
            seen.add(column)
    anchors.sort()
    return anchors


def table_region(
    lines: list[Line] | list[str], *, in_table: bool = False
) -> tuple[list, bool, bool, list[tuple[float, str]] | None]:
    """Filter one page's lines to the transaction-table region.

    Returns ``(region_lines, in_table, ended, anchors)``. ``in_table`` is the
    carried cross-page state; ``anchors`` is non-None when this page carried
    a recognizable positioned header row. Works over :class:`Line` items or
    plain strings (the text path). Shared by both paths so the region
    contract cannot fork.
    """
    region: list = []
    anchors: list[tuple[float, str]] | None = None
    ended = False
    for line in lines:
        text = line.text if isinstance(line, Line) else line
        if not text.strip():
            continue
        if _is_column_header(text):
            in_table = True
            if isinstance(line, Line):
                found = _header_anchors(line)
                if found:
                    anchors = found
            continue
        if not in_table:
            continue
        if _is_header_continuation(text):
            continue
        if _is_region_end(text):
            ended = True
            break
        region.append(line)
    return region, in_table, ended, anchors


# --- segmentation core (shared router — R25) ---------------------------------


class _Segmenter:
    """Closed-denominator row segmentation shared by both paths.

    Both paths reduce every region line to per-column cells before this class
    sees it; the routing rules are therefore identical and the asset branch
    is never a catch-all (LD28).
    """

    def __init__(self, *, text_fallback: bool) -> None:
        self.text_fallback = text_fallback
        self.candidates: list[RowCandidate] = []
        self.open_candidate: RowCandidate | None = None
        # M1-C/M1-E: the ``*_parts`` attribute of the sub-line whose printed
        # value is still eligible to wrap onto following lines, or None.
        # Cleared by a structural line — a row is never a sub-line's tail.
        #
        # M1-C could only do this for comments, because the other sub-line
        # values were stored nowhere and folding their tails in would have
        # DELETED text. M1-E gave each kind a column, so every kind's tail now
        # continues its own field.
        self.open_subline: str | None = None

    # -- candidate lifecycle

    def open_from_structural(self, cells: dict[str, str]) -> None:
        candidate = RowCandidate(
            opened_by_structural=True, text_fallback=self.text_fallback
        )
        self._fill(candidate, cells)
        self.candidates.append(candidate)
        self.open_candidate = candidate
        self.open_subline = None

    def _open_orphan(self) -> RowCandidate:
        candidate = RowCandidate(
            opened_by_structural=False, text_fallback=self.text_fallback
        )
        self.candidates.append(candidate)
        self.open_candidate = candidate
        # A new candidate ends the previous sub-line's wrap window (M1-E):
        # text after this point continues the ORPHAN, and must never be
        # appended to the previous row's sub-line field.
        self.open_subline = None
        return candidate

    @staticmethod
    def _fill(candidate: RowCandidate, cells: dict[str, str]) -> None:
        for column, value in cells.items():
            if column == "asset":
                candidate.asset_parts.append(value)
            elif column == "amount":
                candidate.amount_parts.append(value)
            else:
                setattr(candidate, f"{column}_cell", value)

    # -- sub-lines

    def feed_subline(self, comment_kind: str | None, value: str | None) -> None:
        candidate = self.open_candidate
        if candidate is None:
            candidate = self._open_orphan()
        parts_attr = _SUBLINE_PARTS.get(comment_kind or "")
        if parts_attr is not None and value:
            getattr(candidate, parts_attr).append(value)
        candidate.block_open = False
        self.open_subline = parts_attr

    def feed_subline_continuation(self, cells: dict[str, str]) -> None:
        """Append a wrapped sub-line's tail to the sub-line it continues.

        A long sub-line wraps like any other printed line, but its tail
        arrives after the sub-line has already closed the row block, so the
        asset-continuation branch cannot take it (M1-C). Routing it here keeps
        the printed text with the sub-line that printed it; the alternative
        the parser used before was to open a flagged orphan, which fabricated
        a transaction row the document never disclosed.

        M1-E extends this from comments to EVERY sub-line kind. M1-C had to
        restrict it to comments because a ``FILING STATUS:``/``SUBHOLDING
        OF:``/``LOCATION:`` value was stored nowhere, so folding a tail in
        would have deleted text. Those values are now columns of their own, so
        each kind's tail continues its own field and nothing is dropped.
        """
        if self.open_candidate is None or self.open_subline is None:
            return
        # Rejoin the wrapped line in printed order. The cells are only an
        # artefact of where words fell relative to the column anchors; the
        # printed line read left to right is what the filer wrote.
        text = " ".join(
            cells[column] for column in _COLUMN_ORDER if column in cells
        )
        if text:
            getattr(self.open_candidate, self.open_subline).append(text)

    # -- fragments (typed routing, R24/R25)

    def feed_fragment(self, cells: dict[str, str], *, wrap_ok: bool) -> None:
        """Route one fragment line's cells; open at most one orphan.

        Cells are processed in column order. Each typed cell is offered only
        its own column's completion test on the open candidate; untyped
        (asset) cells are offered continuation only while the row block is
        open AND the geometry allows it (*wrap_ok*; always the block state on
        the text path). Any cell that completes nothing lands verbatim in its
        own cell of a single new flagged orphan candidate — never in another
        column of the open candidate (R25).
        """
        # M1-C/M1-E: prose tail of a still-wrapping sub-line. Gated on three
        # conditions together, so this can never swallow row-shaped data: a
        # sub-line must be open (a structural line clears it), the geometry
        # must allow a wrap, and NO cell may match its own column's signature.
        #
        # That last test is the existing R25 recognizer table, reused rather
        # than re-invented, so "row-shaped" cannot drift between this decision
        # and the structural one. Column position alone is NOT sufficient:
        # wrapped prose spans the full printed width, so its words land in the
        # side/date/amount buckets while matching none of those shapes.
        if (
            self.open_subline is not None
            and wrap_ok
            and cells
            and not _has_typed_cell(cells)
        ):
            self.feed_subline_continuation(cells)
            return
        # M1-D: an open structural row stays the continuation context even if
        # this line opens an orphan. Opening an orphan reassigns
        # ``open_candidate``, which severed a row from its own later wrap
        # lines: a continued page REPRINTS the cap-gains glyph, that duplicate
        # cannot complete an already-filled cell, and the orphan it opened
        # then captured the row's real wrap line (asset tail + the second half
        # of a split amount). The orphan is still appended and still flagged —
        # R25/F4 visibility is untouched — it just no longer steals context
        # from a row whose block nothing has closed.
        resume = (
            self.open_candidate
            if self.open_candidate is not None
            and self.open_candidate.opened_by_structural
            and self.open_candidate.block_open
            else None
        )
        orphan: RowCandidate | None = None
        target = self.open_candidate
        for column in _COLUMN_ORDER:
            if column not in cells:
                continue
            value = cells[column]
            if orphan is None and target is not None:
                if column == "asset":
                    if target.block_open and wrap_ok:
                        target.asset_parts.append(value)
                        continue
                elif self._complete_cell(target, column, value):
                    continue
            if orphan is None:
                orphan = self._open_orphan()
                target = orphan
            self._fill(orphan, {column: value})
        if orphan is not None and resume is not None:
            self.open_candidate = resume

    @staticmethod
    def _complete_cell(candidate: RowCandidate, column: str, value: str) -> bool:
        """Try to complete *candidate*'s own *column* with *value* (R24)."""
        if not candidate.block_open:
            return False
        if column == "amount":
            current = candidate.amount_label
            if current is not None and _amount_parses(current):
                return False
            joined = f"{current} {value}" if current is not None else value
            if not _amount_parses(joined):
                return False
            candidate.amount_parts.append(value)
            return True
        attr = f"{column}_cell"
        if getattr(candidate, attr) is not None:
            return False
        setattr(candidate, attr, value)
        return True


def _amount_parses(label: str) -> bool:
    """Whether *label* is a complete Appendix C form (the R24 oracle)."""
    low, _high, flags = normalize_amount(label)
    return low is not None and "amount_unparsed" not in flags


# --- positioned segmentation -------------------------------------------------


def _column_of(x0: float, anchors: list[tuple[float, str]]) -> str:
    column = anchors[0][1]
    for anchor_x, name in anchors:
        if anchor_x <= x0 + _COLUMN_X_SLACK:
            column = name
        else:
            break
    return column


def _positioned_cells(
    line: Line, anchors: list[tuple[float, str]]
) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for word in line.words:
        grouped.setdefault(_column_of(word.x0, anchors), []).append(word.text)
    return {column: " ".join(words) for column, words in grouped.items()}


def segment_rows(
    region_lines: list[Line], columns: list[tuple[float, str]]
) -> list[RowCandidate]:
    """Positioned-path segmentation (LD20 + fragment routing).

    Dispositions, in order: recognized sub-line (attaches to the open
    candidate and closes its row block); structural line — any word in the
    ID/Owner/Type/Date/Notification columns — opens a candidate; anything
    else is a fragment line routed cell-by-cell (asset continuation gated on
    the open block and the pitch predicate; typed cells on their own
    column's completion test).
    """
    segmenter = _Segmenter(text_fallback=False)
    pitch = _line_pitch(region_lines)
    previous: Line | None = None
    for line in region_lines:
        is_subline, comment_kind, value = _subline_kind(line.text)
        if is_subline:
            segmenter.feed_subline(comment_kind, value)
        else:
            cells = _positioned_cells(line, columns)
            wrap_ok = _wrap_within_pitch(line, previous, pitch)
            if _is_structural_cells(cells):
                segmenter.open_from_structural(cells)
            else:
                segmenter.feed_fragment(cells, wrap_ok=wrap_ok)
        previous = line
    return segmenter.candidates


def _line_pitch(region_lines: list[Line]) -> float | None:
    """Median consecutive-line ``top`` delta (same-page pairs only)."""
    deltas = [
        line.top - prev.top
        for prev, line in zip(region_lines, region_lines[1:])
        if line.page == prev.page
    ]
    return median(deltas) if deltas else None


def _wrap_within_pitch(
    line: Line, previous: Line | None, pitch: float | None
) -> bool:
    if previous is None or pitch is None:
        return True
    if line.page != previous.page:
        # Page-relative tops reset across page breaks; a wrap that opens a
        # continued page (after the repeated header) has no measurable delta.
        return True
    return (line.top - previous.top) <= pitch * WRAP_PITCH_TOLERANCE


# --- text segmentation (fallback path) ---------------------------------------

_CELL_SPLIT = re.compile(r"\s{2,}")


def _signature_of(cell: str) -> str | None:
    for column in ("side", "date", "owner", "id", "amount", "capgains"):
        if COLUMN_SIGNATURES[column].match(cell):
            return column
    return None


def _text_cells(line: str) -> dict[str, str]:
    """Assign a text line's cells to columns via :data:`COLUMN_SIGNATURES`.

    Cells are the runs between >= 2 consecutive spaces (pypdf layout output
    preserves column gaps as space runs). The first date-shaped cell is the
    transaction date, the second the notification date; unmatched cells are
    asset prose, joined in printed order.
    """
    grouped: dict[str, list[str]] = {}
    for cell in (c.strip() for c in _CELL_SPLIT.split(line.strip()) if c.strip()):
        signature = _signature_of(cell)
        if signature == "date" and "date" in grouped and "notification" not in grouped:
            signature = "notification"
        if signature is None:
            signature = "asset"
        # A repeat of an already-seen type stays in that type's cell (joined
        # in printed order) — it must never leak into the asset cell (R25).
        grouped.setdefault(signature, []).append(cell)
    return {column: " ".join(parts) for column, parts in grouped.items()}


def segment_text_rows(region_lines: list[str]) -> list[RowCandidate]:
    """Text-path segmentation: same contract, geometry replaced by typing.

    A structural line carries a side token, date, printed ID, or owner token
    as a whole cell; everything else non-sub-line is a fragment line whose
    cells route through the typed completion tests (an amount-bearing line
    never automatically opens a row — R24). Every candidate is tagged
    ``text_fallback``.
    """
    segmenter = _Segmenter(text_fallback=True)
    for line in region_lines:
        stripped = line.strip()
        if not stripped:
            continue
        is_subline, comment_kind, value = _subline_kind(stripped)
        if is_subline:
            segmenter.feed_subline(comment_kind, value)
            continue
        cells = _text_cells(stripped)
        if any(column in cells for column in _STRUCTURAL_COLUMNS):
            segmenter.open_from_structural(cells)
        else:
            segmenter.feed_fragment(cells, wrap_ok=True)
    return segmenter.candidates


# --- header block ------------------------------------------------------------

_HEADER_FIELDS = (
    ("name:", "name"),
    ("status:", "status"),
    ("state/district:", "state_district"),
)


def _header_from_texts(texts: list[str]) -> PtrHeader:
    values: dict[str, str | None] = {"name": None, "status": None, "state_district": None}
    for text in texts:
        stripped = text.strip()
        lowered = stripped.lower()
        for prefix, key in _HEADER_FIELDS:
            if lowered.startswith(prefix) and values[key] is None:
                values[key] = stripped[len(prefix) :].strip() or None
    return PtrHeader(**values)


# --- parse dispatch ----------------------------------------------------------


def parse_ptr(pdf_bytes: bytes, *, doc_id: str) -> PtrParse:
    """Parse one e-filed PTR: positioned primary, pypdf-layout text fallback.

    Falls back only when positioned extraction raises or yields no words
    (R22). A readable document from which the chosen path emits zero
    candidates raises :class:`EmptyParseError` (R20) — zero rows is a typed
    failure, never an empty success.
    """
    try:
        pages = extract_positioned(pdf_bytes)
    except UnreadablePdfError:
        pages = None
    if pages is not None and any(page for page in pages):
        return _parse_positioned(pages)
    return _parse_text_fallback(pdf_bytes)


def _parse_positioned(pages: list[list[Line]]) -> PtrParse:
    header = _header_from_texts(
        [line.text for page in pages for line in page]
    )
    region_lines: list[Line] = []
    anchors: list[tuple[float, str]] | None = None
    in_table = False
    for page in pages:
        page_region, in_table, ended, page_anchors = table_region(
            page, in_table=in_table
        )
        if page_anchors and anchors is None:
            anchors = page_anchors
        region_lines.extend(page_region)
        if ended:
            break
    if anchors is None:
        raise EmptyParseError("no transaction-table header found")
    candidates = segment_rows(region_lines, anchors)
    if not candidates:
        raise EmptyParseError("segmentation produced zero row candidates")
    cap_gains_column = any(name == "capgains" for _x, name in anchors)
    return PtrParse(
        header=header,
        rows=tuple(_emit(candidates)),
        path="positioned",
        cap_gains_column=cap_gains_column,
    )


def _parse_text_fallback(pdf_bytes: bytes) -> PtrParse:
    pages = extract_pages_pypdf_layout(pdf_bytes)
    header = _header_from_texts(
        [line for page in pages for line in page.splitlines()]
    )
    region_lines: list[str] = []
    cap_gains_column = False
    in_table = False
    for page in pages:
        page_lines = page.splitlines()
        for line in page_lines:
            if _is_column_header(line) and "CAP" in _despaced(line):
                cap_gains_column = True
        page_region, in_table, ended, _anchors = table_region(
            page_lines, in_table=in_table
        )
        region_lines.extend(page_region)
        if ended:
            break
    candidates = segment_text_rows(region_lines)
    if not candidates:
        raise EmptyParseError("text fallback produced zero row candidates")
    return PtrParse(
        header=header,
        rows=tuple(_emit(candidates)),
        path="text_fallback",
        cap_gains_column=cap_gains_column,
    )


def _emit(candidates: list[RowCandidate]) -> list[PtrRow]:
    rows: list[PtrRow] = []
    for ordinal, candidate in enumerate(candidates, start=1):
        asset = candidate.asset_text
        source_row_no = (
            int(candidate.id_cell)
            if candidate.id_cell is not None and candidate.id_cell.isdigit()
            else None
        )
        raw_row: dict[str, str | None] = {
            "owner": candidate.owner_cell,
            "asset_name": asset,
            "ticker": _ticker_from_asset(asset),
            "side": candidate.side_cell,
            "transaction_date": candidate.date_cell,
            "amount_label": candidate.amount_label,
            "comment": candidate.comment_text,
        }
        rows.append(
            PtrRow(
                raw_row=raw_row,
                cap_gains_cell=candidate.capgains_cell,
                source_row_no=source_row_no,
                row_ordinal=ordinal,
                structural_flags=frozenset(candidate.structural_flags()),
                filing_status=candidate.filing_status_text,
                subholding_of=candidate.subholding_of_text,
                location=candidate.location_text,
            )
        )
    return rows
