"""Fetch the EDGAR SIC snapshot the `populus sectors` ingest reads (B-5).

Why this lives in ``scripts/`` and not in ``src/populus``: library code
performs no network access, and ``populus sectors`` is offline-only by design —
it full-replaces ``issuer_sic`` from a cached JSON object mapping CIK → SIC.
Nothing in the repository produced that snapshot, so the sector join (member
sector mix, sector rotation, the S-5 committee-jurisdiction signal) rendered
honest absence on every build. This script closes the gap the way the
legislators and ticker-registry fetches do: bounded, fail-fast, atomic,
provenance recorded.

Scope: the issuers the corpus actually names. Every distinct ticker in the
congressional default view is resolved through the fetched SEC registry
(``company_tickers.json``) to a CIK, and each CIK's ``submissions.json`` —
``https://data.sec.gov/submissions/CIK##########.json``, the same document the
13F ingest reads under the same access conditions — supplies its ``sic``.
Requests are spaced to stay under SEC's fair-access rate (10/s) and carry the
SEC-accepted ``<app name> <contact>`` User-Agent; only ``data.sec.gov`` is
contacted.

Refusals are loud: because the ingest FULL-REPLACES ``issuer_sic``, a fetch
that mostly failed must never produce a near-empty snapshot that would wipe a
good table on ingest. Below the coverage floor the script refuses to write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

#: Only this host is ever contacted; checked before a request is built.
ALLOWED_HOST = "data.sec.gov"
FILE_NAME = "sic-snapshot.json"

#: SEC's bare `<app name> <contact>` User-Agent form (populus.operator_identity).
APP_NAME = "Populus"
CONTACT_ENV = "POPULUS_CONTACT"
DEFAULT_CONTACT = "johnbaekk@gmail.com"

#: Fair-access pacing: SEC's documented ceiling is 10 requests/second.
REQUEST_SPACING_SECONDS = 0.12
TIMEOUT_SECONDS = 60.0
#: Transient statuses retried with backoff before the CIK is counted as failed.
RETRY_STATUSES = (429, 500, 502, 503, 504)
RETRY_BACKOFF_SECONDS = (2.0, 8.0, 30.0)

#: The share of resolved CIKs that must have been fetched successfully for the
#: snapshot to be written at all. A broken fetch (WAF block, outage) fails the
#: run rather than replacing a good `issuer_sic` with a hollow one.
MIN_FETCH_COVERAGE = 0.90

#: The corpus view the tickers come from — the same default view every site
#: surface reads, so the snapshot covers exactly the issuers the site names.
TICKER_SQL = "SELECT DISTINCT ticker FROM v_default_transactions WHERE ticker IS NOT NULL"


class FetchError(RuntimeError):
    """A fetch or validation invariant refused the snapshot write."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def user_agent(contact: str) -> str:
    contact = contact.strip()
    if not contact:
        raise FetchError(
            f"no contact address: set ${CONTACT_ENV} (or pass --contact). An"
            " unset repository variable arrives as the empty string, which is"
            " why the default did not apply."
        )
    return f"{APP_NAME} {contact}"


def load_registry(path: Path) -> dict[str, list[str]]:
    """ticker → list of 10-digit CIKs from the fetched SEC registry. A ticker
    naming more than one CIK is kept as ambiguous so the caller can skip it —
    the dashboard refuses to pick one, and so does this script."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise FetchError(f"{path}: registry must be a JSON object")
    out: dict[str, list[str]] = {}
    for entry in raw.values():
        if not isinstance(entry, dict):
            continue
        cik = entry.get("cik_str")
        ticker = str(entry.get("ticker") or "").strip().upper()
        if not (isinstance(cik, int) and not isinstance(cik, bool) and cik > 0 and ticker):
            continue
        ciks = out.setdefault(ticker, [])
        cik10 = str(cik).zfill(10)
        if cik10 not in ciks:
            ciks.append(cik10)
    return out


def corpus_tickers(db_path: Path) -> list[str]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return sorted({str(r[0]).strip().upper() for r in conn.execute(TICKER_SQL) if str(r[0]).strip()})
    finally:
        conn.close()


def resolve(tickers: list[str], registry: dict[str, list[str]]) -> tuple[list[str], int, int]:
    """(unique CIKs in ticker order, unmapped count, ambiguous count)."""
    ciks: list[str] = []
    seen: set[str] = set()
    unmapped = ambiguous = 0
    for t in tickers:
        found = registry.get(t.strip().upper())
        if not found:
            unmapped += 1
            continue
        if len(found) > 1:
            ambiguous += 1
            continue
        if found[0] not in seen:
            seen.add(found[0])
            ciks.append(found[0])
    return ciks, unmapped, ambiguous


def extract_sic(body: bytes) -> str | None:
    """The `sic` field of a submissions document, digits only, else None
    (funds and many trusts carry an empty SIC — counted, never invented)."""
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FetchError(f"submissions body is not valid UTF-8 JSON ({exc})") from exc
    if not isinstance(parsed, dict):
        raise FetchError("submissions body is not a JSON object")
    sic = str(parsed.get("sic") or "").strip()
    return sic if sic.isdigit() and 2 <= len(sic) <= 4 else None


def submissions_url(cik10: str) -> str:
    if not (cik10.isdigit() and len(cik10) == 10):
        raise FetchError(f"unsafe CIK {cik10!r}")
    return f"https://{ALLOWED_HOST}/submissions/CIK{cik10}.json"


def fetch_sics(
    ciks: list[str],
    contact: str,
    *,
    sleep=time.sleep,
) -> tuple[dict[str, str], dict[str, int]]:
    """Fetch every CIK's SIC. Returns (cik → sic, counters)."""
    headers = {"User-Agent": user_agent(contact), "Accept-Encoding": "gzip, deflate"}
    sics: dict[str, str] = {}
    counters = {"fetched": 0, "no_sic": 0, "http_failed": 0, "malformed": 0}
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        for index, cik in enumerate(ciks):
            if index:
                sleep(REQUEST_SPACING_SECONDS)
            url = submissions_url(cik)
            response = None
            for attempt, backoff in enumerate((*RETRY_BACKOFF_SECONDS, None)):
                try:
                    response = client.get(url, headers=headers)
                except httpx.HTTPError:
                    response = None
                if response is not None and response.status_code not in RETRY_STATUSES:
                    break
                if backoff is None:
                    break
                sleep(backoff)
            if response is None or response.status_code != 200:
                counters["http_failed"] += 1
                continue
            try:
                sic = extract_sic(response.content)
            except FetchError:
                counters["malformed"] += 1
                continue
            counters["fetched"] += 1
            if sic is None:
                counters["no_sic"] += 1
                continue
            sics[cik] = sic
    return sics, counters


def write_snapshot(dest: Path, sics: dict[str, str], provenance: dict) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    body = (json.dumps(dict(sorted(sics.items())), indent=0, sort_keys=True) + "\n").encode("utf-8")
    handle, raw_tmp = tempfile.mkstemp(dir=dest, prefix=f".{FILE_NAME}.")
    tmp = Path(raw_tmp)
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(body)
        os.replace(tmp, dest / FILE_NAME)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    provenance["file"] = {"name": FILE_NAME, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "entries": len(sics)}
    (dest / "sic-source.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run(dest: Path, registry_path: Path, db_path: Path, contact: str, *, limit: int | None = None, sleep=time.sleep) -> dict:
    registry = load_registry(registry_path)
    tickers = corpus_tickers(db_path)
    ciks, unmapped, ambiguous = resolve(tickers, registry)
    if limit is not None:
        ciks = ciks[:limit]
    if not ciks:
        raise FetchError("no corpus ticker resolves through the registry — refusing to write an empty snapshot")
    sics, counters = fetch_sics(ciks, contact, sleep=sleep)
    coverage = counters["fetched"] / len(ciks)
    if coverage < MIN_FETCH_COVERAGE:
        raise FetchError(
            f"only {counters['fetched']} of {len(ciks)} submissions fetched ({coverage:.0%}),"
            f" below the {MIN_FETCH_COVERAGE:.0%} floor — refusing to write a snapshot that"
            " would replace issuer_sic with a hollow one"
        )
    provenance = {
        "schema_version": "sic-snapshot-source/v1",
        "license_id": "sec-edgar",
        "attribution": "Source: U.S. Securities and Exchange Commission, EDGAR submissions API (public domain; fair-access conditions).",
        "source": "edgar-submissions",
        "fetched_at": _now_iso(),
        "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "corpus_tickers": len(tickers),
        "resolved_ciks": len(ciks),
        "unmapped_tickers": unmapped,
        "ambiguous_tickers": ambiguous,
        **counters,
    }
    write_snapshot(dest, sics, provenance)
    return provenance


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", default="data-cache/sic", help="cache DIR to write (default: data-cache/sic)")
    parser.add_argument("--registry", default="data-cache/registry/company_tickers.json", help="the fetched SEC registry")
    parser.add_argument("--db", required=True, help="populus.db — the corpus whose tickers are resolved")
    parser.add_argument("--limit", type=int, default=None, help="fetch at most N CIKs (smoke runs only)")
    parser.add_argument("--contact", default=os.environ.get(CONTACT_ENV) or DEFAULT_CONTACT)
    args = parser.parse_args(argv)
    try:
        prov = run(Path(args.dest), Path(args.registry), Path(args.db), args.contact, limit=args.limit)
    except (FetchError, httpx.HTTPError, OSError, sqlite3.Error) as exc:
        print(f"fetch_sic_snapshot: refused — {exc}", file=sys.stderr)
        return 1
    print(
        f"fetch_sic_snapshot: {prov['file']['entries']} SIC rows from {prov['resolved_ciks']} CIKs"
        f" ({prov['fetched']} fetched, {prov['no_sic']} without SIC, {prov['http_failed']} failed,"
        f" {prov['unmapped_tickers']} tickers unmapped, {prov['ambiguous_tickers']} ambiguous)"
        f" → {args.dest}/{FILE_NAME}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
