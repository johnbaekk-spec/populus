"""Tier C 13F ticker mapping — the REVIEWED, name-keyed mapping file (R3).

WHY THIS EXISTS. A 13F holding names an issuer and a class of security; it
does not name a ticker. G14 (ARCHITECTURE.md) forbids inferring one: "Symbols
are never inferred automatically; only reviewed mapping rows supply a 13F
ticker." This module is the ONLY path by which a 13F row acquires a ticker.

THE KEY IS THE NAME PLUS THE CLASS, NEVER A CUSIP. The owner's Tier C decision
(2026-09-10): the file is keyed on the normalized filed issuer name and the
normalized title of class, built like `manager_registry.yaml`, and it carries
no CUSIP column and no CUSIP-derived key. The loader REJECTS a CUSIP-shaped
field anywhere in a row so the rule cannot erode one column at a time.

WHAT A ROW ASSERTS. `(issuer_name_canonical, title_of_class) -> ticker`, with
`verified_date`, `verified_by` and `method` on every shipped row. A row
without all three is not a mapping; it is a guess with a ticker on it, and
the loader refuses it. `method`:

  exact-name      the normalized name matched exactly one issuer (one CIK) in
                  the pinned SEC company list, that issuer lists exactly one
                  ticker, and the class is a common-equity class;
  class-resolved  the issuer lists several tickers and the class text picked
                  one by a recorded rule (the row's `note` says which);
  manual          a human, or the named agent run, resolved it by hand and
                  says how in `note`.

Candidates (`scripts/draft_ticker_mapping_13f.py draft`) never ship: only
rows promoted with the three verification fields are loaded.
"""

from __future__ import annotations

import hashlib
import importlib.resources
import json
import random
import re
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from pathlib import Path

import yaml

__all__ = [
    "METHODS",
    "SAMPLE_SIZE",
    "TICKER_RE",
    "TickerMapping",
    "TickerMappingError",
    "TickerMappingRow",
    "derive_sample",
    "load_ticker_mapping",
    "mapping_key",
    "normalize_class",
    "normalize_issuer_name",
    "normalize_ticker",
]

METHODS: frozenset[str] = frozenset({"exact-name", "class-resolved", "manual"})

#: A 13F ticker as the SEC company list spells it (`BRK-B`, `BF-A`), or as
#: Congress filers spell it (`BRK.B`). Up to six characters.
TICKER_RE = re.compile(r"^[A-Z.\-]{1,6}$")

#: CUSIP structure: six issuer characters (the first three digits), two issue
#: characters, one check digit. Any field VALUE of this shape, or any field
#: NAME mentioning cusip, is refused — the key is the name plus the class.
_CUSIP_VALUE_RE = re.compile(r"^[0-9]{3}[0-9A-Z]{5}[0-9]$")
_CUSIP_NAME_RE = re.compile(r"cusip", re.IGNORECASE)

#: The 50-row owner spot-check sample (LD2), drawn with a recorded seed over
#: the verified rows so it re-derives identically on any machine.
SAMPLE_SIZE = 50

_PUNCT_RE = re.compile(r"[^A-Z0-9 ]+")
_WS_RE = re.compile(r"\s+")
#: Corporate suffix tokens folded off the END of a name (the plan's list, plus
#: the long forms that the SEC list spells out where a filer abbreviates).
_SUFFIX_FOLD = {
    "INCORPORATED": "INC",
    "CORPORATION": "CORP",
    "COMPANY": "CO",
    "LIMITED": "LTD",
}
_SUFFIXES = frozenset({"INC", "CORP", "CO", "LTD", "PLC", "TR", "TRUST"})
#: EDGAR conformed-name tails that neither side means as identity: "/NEW",
#: "/DE/" on an SEC title, "DEL" / "NEW" on a filed 13F name. Measured on the
#: 2026-03-31 draft: "COSTCO WHOLESALE CORP /NEW" vs "COSTCO WHOLESALE CORPORATION",
#: "BERKSHIRE HATHAWAY INC DEL" vs "BERKSHIRE HATHAWAY INC".
_TAIL_TOKENS = frozenset({"NEW", "DEL", "DE"})


class TickerMappingError(RuntimeError):
    """A mapping-file defect that must stop the build rather than ship a guess."""


def normalize_issuer_name(name: str) -> str:
    """Upper-case, punctuation stripped, whitespace collapsed, trailing
    corporate suffixes folded off (INC/CORP/CO/LTD/PLC/TR/TRUST). Applied to
    BOTH the filed name and the SEC title, so equality is the identity test."""
    text = _PUNCT_RE.sub(" ", str(name).upper().replace("&", " AND "))
    tokens = [_SUFFIX_FOLD.get(t, t) for t in _WS_RE.split(text.strip()) if t]
    while len(tokens) > 1 and tokens[-1] in (_SUFFIXES | _TAIL_TOKENS):
        tokens.pop()
    return " ".join(tokens)


def normalize_class(title_of_class: str | None) -> str:
    """Upper-case, punctuation stripped, whitespace collapsed; `""` for NULL."""
    if title_of_class is None:
        return ""
    text = _PUNCT_RE.sub(" ", str(title_of_class).upper())
    return " ".join(t for t in _WS_RE.split(text.strip()) if t)


def normalize_ticker(ticker: str) -> str:
    """The SEC spelling of a class-share ticker uses a hyphen (`BRK-B`); Congress
    filers write a dot (`BRK.B`). ONE comparison form: upper-case, dot → hyphen."""
    return str(ticker).strip().upper().replace(".", "-")


def mapping_key(issuer_name: str, title_of_class: str | None) -> tuple[str, str]:
    return normalize_issuer_name(issuer_name), normalize_class(title_of_class)


@dataclass(frozen=True)
class TickerMappingRow:
    issuer_name_canonical: str
    title_of_class: str
    ticker: str
    verified_date: str
    verified_by: str
    method: str
    note: str | None

    @property
    def key(self) -> tuple[str, str]:
        return mapping_key(self.issuer_name_canonical, self.title_of_class)


@dataclass(frozen=True)
class TickerMapping:
    version: int
    company_tickers_sha256: str | None
    rows: tuple[TickerMappingRow, ...]

    def by_key(self) -> dict[tuple[str, str], TickerMappingRow]:
        return {r.key: r for r in self.rows}

    def tickers(self) -> frozenset[str]:
        return frozenset(normalize_ticker(r.ticker) for r in self.rows)


def _packaged_text(name: str) -> str:
    return importlib.resources.files("populus").joinpath(name).read_text(encoding="utf-8")


def load_ticker_mapping(
    path: Path | str | None = None,
    *,
    known_tickers: Collection[str] | None = None,
) -> TickerMapping:
    """Load and validate the mapping file (the packaged one by default).

    `known_tickers`: the ticker set of the pinned `company_tickers.json`
    snapshot. When given, a row whose ticker is absent from it is REJECTED —
    the verification claim would be unfounded. The drafting script and the
    tests pass it; a build that has no snapshot at hand passes nothing and
    relies on the recorded `company_tickers_sha256` for provenance.
    """
    text = _packaged_text("ticker_mapping_13f.yaml") if path is None else Path(path).read_text(
        encoding="utf-8"
    )
    data = yaml.safe_load(text) or {}
    version = data.get("version")
    if not isinstance(version, int) or version < 1:
        raise TickerMappingError("ticker mapping: version must be a positive integer")
    sha = data.get("company_tickers_sha256")
    if sha is not None and not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
        raise TickerMappingError("ticker mapping: company_tickers_sha256 must be a hex sha256")
    raw_rows = data.get("rows")
    if raw_rows is None:
        raw_rows = []
    if not isinstance(raw_rows, list):
        raise TickerMappingError("ticker mapping: `rows` must be a list")

    known = (
        None if known_tickers is None else frozenset(normalize_ticker(t) for t in known_tickers)
    )
    rows: list[TickerMappingRow] = []
    seen: dict[tuple[str, str], int] = {}
    for pos, raw in enumerate(raw_rows):
        if not isinstance(raw, dict):
            raise TickerMappingError(f"ticker mapping: row {pos} is not a mapping")
        for field_name, value in raw.items():
            if _CUSIP_NAME_RE.search(str(field_name)):
                raise TickerMappingError(
                    f"ticker mapping: row {pos} carries a CUSIP-named field {field_name!r};"
                    " the key is the issuer name plus the class, never a CUSIP"
                )
            if isinstance(value, str) and _CUSIP_VALUE_RE.fullmatch(value.strip().upper()):
                raise TickerMappingError(
                    f"ticker mapping: row {pos} field {field_name!r} holds a CUSIP-shaped"
                    f" value {value!r}; CUSIPs never enter this file"
                )
        missing = [
            f
            for f in ("issuer_name_canonical", "title_of_class", "ticker", "verified_date",
                      "verified_by", "method")
            if raw.get(f) in (None, "")
        ]
        if missing:
            raise TickerMappingError(
                f"ticker mapping: row {pos} ({raw.get('issuer_name_canonical')!r}) is missing"
                f" {', '.join(missing)} — an unverified row ships no ticker"
            )
        ticker = str(raw["ticker"]).strip().upper()
        if not TICKER_RE.fullmatch(ticker):
            raise TickerMappingError(f"ticker mapping: row {pos} has a malformed ticker {ticker!r}")
        if known is not None and normalize_ticker(ticker) not in known:
            raise TickerMappingError(
                f"ticker mapping: row {pos} ticker {ticker!r} is not in the pinned SEC company list"
            )
        method = str(raw["method"])
        if method not in METHODS:
            raise TickerMappingError(
                f"ticker mapping: row {pos} has method {method!r}; expected one of {sorted(METHODS)}"
            )
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(raw["verified_date"])):
            raise TickerMappingError(f"ticker mapping: row {pos} verified_date is not ISO")
        row = TickerMappingRow(
            issuer_name_canonical=str(raw["issuer_name_canonical"]),
            title_of_class=str(raw["title_of_class"]),
            ticker=ticker,
            verified_date=str(raw["verified_date"]),
            verified_by=str(raw["verified_by"]),
            method=method,
            note=str(raw["note"]) if raw.get("note") else None,
        )
        if row.key in seen:
            raise TickerMappingError(
                f"ticker mapping: rows {seen[row.key]} and {pos} share the key {row.key!r}"
            )
        seen[row.key] = pos
        rows.append(row)
    return TickerMapping(
        version=version, company_tickers_sha256=None if sha is None else str(sha), rows=tuple(rows)
    )


def derive_sample(mapping: TickerMapping, *, seed: int, size: int = SAMPLE_SIZE) -> list[dict]:
    """The reproducible owner spot-check sample: `size` rows drawn by
    `random.Random(seed)` over the verified rows in key order."""
    ordered = sorted(mapping.rows, key=lambda r: r.key)
    picked = random.Random(seed).sample(ordered, min(size, len(ordered)))
    return [
        {
            "issuer_name_canonical": r.issuer_name_canonical,
            "title_of_class": r.title_of_class,
            "ticker": r.ticker,
            "method": r.method,
        }
        for r in sorted(picked, key=lambda r: r.key)
    ]


def sha256_of(path: Path | str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_company_tickers(path: Path | str) -> list[dict]:
    """`[{cik, ticker, title}]` from an SEC `company_tickers.json` snapshot."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    entries = data.values() if isinstance(data, dict) else data
    out = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        cik, ticker, title = e.get("cik_str"), e.get("ticker"), e.get("title")
        if cik is None or not ticker or not title:
            continue
        out.append({"cik": f"{int(cik):010d}", "ticker": str(ticker).upper(), "title": str(title)})
    return out


def issuer_index(entries: Iterable[dict]) -> dict[str, dict[str, set[str]]]:
    """`normalized title -> {cik -> {tickers}}` over the SEC list."""
    index: dict[str, dict[str, set[str]]] = {}
    for e in entries:
        index.setdefault(normalize_issuer_name(e["title"]), {}).setdefault(e["cik"], set()).add(
            e["ticker"]
        )
    return index
