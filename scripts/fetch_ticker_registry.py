"""Fetch the SEC ticker registry (``company_tickers.json``) the site build reads.

Why this lives in ``scripts/`` and not in ``src/populus``: library code
performs no network access, and the dashboard's ticker→issuer mapping is an
OFFLINE input (``POPULUS_TICKER_MAP``). Until this script existed the only
copy of the registry was a workstation file, so every CI build ran with the
variable pointed at a deliberately absent path and the deployed site rendered
the honest ``no-map`` state on every ticker surface (roadmap B15 / TD-7).
This script closes that gap the way the legislators cache did for members:
fetch first, fail fast, write atomically, record provenance.

Source: ``https://www.sec.gov/files/company_tickers.json`` — SEC's own
present-day ticker → CIK file, registered in the §15 conditions register as
``sec-edgar`` (public domain; fair-access ACCESS conditions only). The request
carries the SEC-accepted ``<app name> <contact>`` User-Agent from
``populus.operator_identity`` — the one format SEC's WAF accepts — and
contacts ``www.sec.gov`` only. The identity registry bootstrap and the MCP
server read the same file under the same conditions.

Refusals are loud and the cache is written atomically: a truncated body, an
HTML error page, or a JSON document that is not a populated registry must
never land in the cache, because the site build would then "resolve" tickers
against a partial file and quietly render most names as unmapped.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

#: Only this host is ever contacted; the allowlist is checked before a request
#: is built, mirroring `SEC_HOSTS` in `populus.net`.
ALLOWED_HOST = "www.sec.gov"
SOURCE_PATH = "files/company_tickers.json"
SOURCE_URL = f"https://{ALLOWED_HOST}/{SOURCE_PATH}"
FILE_NAME = "company_tickers.json"

#: SEC's bare `<app name> <contact>` User-Agent form (populus.operator_identity).
APP_NAME = "Populus"
CONTACT_ENV = "POPULUS_CONTACT"
DEFAULT_CONTACT = "johnbaekk@gmail.com"

#: A floor a truncated or wrong-document response cannot clear, set well below
#: the real registry (~10,000 issuers) so ordinary churn never trips it. It
#: catches a broken FETCH, not the source's contents.
MIN_ENTRIES = 5_000
TIMEOUT_SECONDS = 120.0


class FetchError(RuntimeError):
    """A fetch or validation invariant refused the cache write."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def user_agent(contact: str) -> str:
    """The SEC-accepted `<app name> <contact>` User-Agent, refusing a blank
    contact rather than building a header httpx cannot send (an UNSET
    repository variable arrives as the empty string)."""
    contact = contact.strip()
    if not contact:
        raise FetchError(
            f"no contact address: set ${CONTACT_ENV} (or pass --contact). An"
            " unset repository variable arrives as the empty string, which is"
            " why the default did not apply."
        )
    return f"{APP_NAME} {contact}"


def validate_registry(body: bytes, minimum: int = MIN_ENTRIES) -> int:
    """Parse and shape-check the registry; return the count of usable entries.

    The dashboard's parser reads entries carrying an integer ``cik_str``, a
    non-empty ``ticker`` and a ``title``; anything else is skipped. So the
    USABLE count, not the key count, is what must clear the floor — a document
    of the right shape whose entries are hollow would resolve nothing.
    """
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FetchError(f"{FILE_NAME}: body is not valid UTF-8 JSON ({exc})") from exc
    if not isinstance(parsed, dict):
        raise FetchError(
            f"{FILE_NAME}: expected a JSON object of registry entries, got {type(parsed).__name__}"
        )
    usable = 0
    for entry in parsed.values():
        if not isinstance(entry, dict):
            continue
        cik = entry.get("cik_str")
        ticker = str(entry.get("ticker") or "").strip()
        title = str(entry.get("title") or "").strip()
        if isinstance(cik, int) and not isinstance(cik, bool) and cik > 0 and ticker and title:
            usable += 1
    if usable < minimum:
        raise FetchError(
            f"{FILE_NAME}: only {usable} usable entries (integer cik_str, ticker, title),"
            f" below the {minimum} floor — refusing to write a truncated registry"
        )
    return usable


def fetch(dest: Path, contact: str) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": user_agent(contact), "Accept-Encoding": "gzip, deflate"}
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        response = client.get(SOURCE_URL, headers=headers)
    if response.status_code != 200:
        raise FetchError(f"{FILE_NAME}: {SOURCE_URL} returned HTTP {response.status_code}")
    body = response.content
    count = validate_registry(body)

    # Atomic replace: a partial write must never be visible to a build, and a
    # failed validation above must leave any existing good cache untouched.
    handle, raw_tmp = tempfile.mkstemp(dir=dest, prefix=f".{FILE_NAME}.")
    tmp = Path(raw_tmp)
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(body)
        os.replace(tmp, dest / FILE_NAME)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    provenance = {
        "schema_version": "ticker-registry-source/v1",
        "license_id": "sec-edgar",
        "attribution": "Source: U.S. Securities and Exchange Commission, company_tickers.json (public domain; fair-access conditions).",
        "url": SOURCE_URL,
        "fetched_at": _now_iso(),
        "file": {
            "name": FILE_NAME,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "usable_entries": count,
        },
    }
    (dest / "registry-source.json").write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return provenance


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dest",
        default="data-cache/registry",
        help="cache DIR to write (default: data-cache/registry)",
    )
    parser.add_argument(
        "--contact",
        # `or`, not a get() default: an unset repo variable is present-and-empty.
        default=os.environ.get(CONTACT_ENV) or DEFAULT_CONTACT,
        help=f"operator contact for the User-Agent (default: ${CONTACT_ENV} or the maintainer fallback)",
    )
    args = parser.parse_args(argv)
    try:
        provenance = fetch(Path(args.dest), args.contact)
    except (FetchError, httpx.HTTPError) as exc:
        print(f"fetch_ticker_registry: refused — {exc}", file=sys.stderr)
        return 1
    print(
        f"fetch_ticker_registry: {provenance['file']['usable_entries']} usable entries,"
        f" {provenance['file']['bytes']} bytes → {args.dest}/{FILE_NAME}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
