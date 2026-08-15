"""Fetch the CC0 congress-legislators cache the `members` ingest reads.

Why this lives in ``scripts/`` and not in ``src/populus``: library code
deliberately performs no network access, and ``populus ingest members`` is
offline-only by design — it requires ``--from-cache DIR`` holding
``legislators-current.yaml`` and ``legislators-historical.yaml``. Nothing in the
repository produced that cache, so it existed only on the owner's machine under
the gitignored ``data-cache/legislators/``. Every CI build therefore ran
house/senate ingest with an EMPTY ``members`` table, and
``members.apply_member_join`` — the only writer of ``transactions.bioguide_id``
— never ran at all. From build 20260807.1 onward the published site shipped zero
member pages: every ``/congress/members/<bioguide>`` route 404s in production.
This script closes that gap, so the join can run on a runner.

Source: ``unitedstates/congress-legislators``, registered in the §15 conditions
register as ``cc0-legislators`` (CC0 1.0, unrestricted, ingestible, determined
2026-07-23). Attribution travels with the data through that register; no notice
is required by the instrument, and none is invented here.

Refusals are loud and the cache is written atomically: a truncated body, an HTML
error page, or a YAML document that is not a populated legislator list must
never land in the cache directory, because the downstream ingest would then
"succeed" against a smaller roster and silently unjoin real filings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml

#: Only this host is ever contacted. An allowlist checked before a request is
#: built means a mis-constructed ref or path cannot redirect the fetch — and
#: cannot send our identifying User-Agent — somewhere else. Mirrors the
#: `SEC_HOSTS` posture in `populus.net`.
ALLOWED_HOST = "raw.githubusercontent.com"
REPO_PATH = "unitedstates/congress-legislators"

#: The application half of the User-Agent, matching `populus.net.SEC_APP_NAME`.
#: Identifying the client truthfully is standard etiquette for an unauthenticated
#: public endpoint, not a requirement CC0 imposes.
APP_NAME = "Populus"
CONTACT_ENV = "POPULUS_CONTACT"
DEFAULT_CONTACT = "johnbaekk@gmail.com"

#: Floors that a truncated or wrong-document response cannot clear, set well
#: below the real rosters (~540 current, ~12,500 historical) so ordinary
#: membership churn never trips them. They exist to catch a broken FETCH, not to
#: police the source's contents.
FILES: dict[str, int] = {
    "legislators-current.yaml": 400,
    "legislators-historical.yaml": 10_000,
}

#: Courtesy delay between the two requests.
REQUEST_SPACING_SECONDS = 1.0
TIMEOUT_SECONDS = 120.0


class FetchError(RuntimeError):
    """A fetch or validation invariant refused the cache write."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def user_agent(contact: str) -> str:
    """The identifying User-Agent, refusing a contact that is not one.

    An UNSET repository variable arrives as the EMPTY STRING, not as an absent
    key — the same trap `publish.yml` documents for `vars.` read through
    `secrets.`. `os.environ.get(key, default)` returns the default only when the
    key is MISSING, so `POPULUS_CONTACT: ${{ vars.POPULUS_CONTACT }}` with no
    variable set produced `"Populus "` and httpx refused it as an illegal header
    value — after the run had already spent two hours on the ingests. Fail here,
    with a sentence naming the fix, rather than building a header that cannot be
    sent.
    """
    contact = contact.strip()
    if not contact:
        raise FetchError(
            f"no contact address: set ${CONTACT_ENV} (or pass --contact). An"
            " unset repository variable arrives as the empty string, which is"
            " why the default did not apply."
        )
    return f"{APP_NAME} {contact}"


def validate_yaml(name: str, body: bytes, minimum: int) -> int:
    """Parse and shape-check one legislators document; return its entry count.

    The ingest's own loader skips entries lacking a bioguide id rather than
    failing, so a document that parsed but carried none would ingest as an empty
    roster and re-create exactly the outage this script exists to end. The
    bioguide count, not the entry count, is therefore what must clear the floor.
    """
    try:
        parsed = yaml.safe_load(body.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as exc:
        raise FetchError(f"{name}: body is not valid UTF-8 YAML ({exc})") from exc
    if not isinstance(parsed, list):
        raise FetchError(
            f"{name}: expected a YAML list of legislators, got {type(parsed).__name__}"
        )
    with_bioguide = sum(
        1
        for entry in parsed
        if isinstance(entry, dict)
        and isinstance(entry.get("id"), dict)
        and str(entry["id"].get("bioguide") or "").strip()
    )
    if with_bioguide < minimum:
        raise FetchError(
            f"{name}: only {with_bioguide} entries carry a bioguide id, below the"
            f" {minimum} floor — refusing to write a truncated roster"
        )
    return with_bioguide


def fetch(dest: Path, ref: str, contact: str) -> dict:
    if not ref or "/" in ref or ref.startswith("."):
        raise FetchError(f"unsafe ref {ref!r}")
    dest.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": user_agent(contact), "Accept-Encoding": "gzip, deflate"}
    records: list[dict] = []

    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        for index, (name, minimum) in enumerate(sorted(FILES.items())):
            if index:
                time.sleep(REQUEST_SPACING_SECONDS)
            url = f"https://{ALLOWED_HOST}/{REPO_PATH}/{ref}/{name}"
            response = client.get(url, headers=headers)
            if response.status_code != 200:
                raise FetchError(
                    f"{name}: {url} returned HTTP {response.status_code}"
                )
            body = response.content
            count = validate_yaml(name, body, minimum)

            # Atomic replace in the destination directory: a partial write must
            # never be visible to a concurrent ingest, and a failed validation
            # above must leave any existing good cache untouched.
            handle, raw_tmp = tempfile.mkstemp(dir=dest, prefix=f".{name}.")
            tmp = Path(raw_tmp)
            try:
                with os.fdopen(handle, "wb") as fh:
                    fh.write(body)
                os.replace(tmp, dest / name)
            except BaseException:
                tmp.unlink(missing_ok=True)
                raise

            records.append(
                {
                    "name": name,
                    "url": url,
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "entries_with_bioguide": count,
                }
            )

    provenance = {
        "schema_version": "legislators-cache-source/v1",
        "license_id": "cc0-legislators",
        "attribution": "Source: the unitedstates project, congress-legislators (CC0).",
        "source_repo": REPO_PATH,
        "ref": ref,
        "fetched_at": _now_iso(),
        "files": records,
    }
    (dest / "legislators-source.json").write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return provenance


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dest",
        default="data-cache/legislators",
        help="cache DIR to write (default: data-cache/legislators)",
    )
    parser.add_argument(
        "--ref", default="main", help="git ref of the source repo (default: main)"
    )
    parser.add_argument(
        "--contact",
        # `or`, not a get() default: an unset repo variable is present-and-empty,
        # and an empty contact must fall back rather than build "Populus ".
        default=os.environ.get(CONTACT_ENV, "").strip() or DEFAULT_CONTACT,
        help=f"contact address for the User-Agent (default: ${CONTACT_ENV})",
    )
    args = parser.parse_args(argv)

    try:
        provenance = fetch(Path(args.dest), args.ref, args.contact)
    except (FetchError, httpx.HTTPError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for record in provenance["files"]:
        print(
            f"{record['name']}: {record['bytes']} B,"
            f" {record['entries_with_bioguide']} legislators"
        )
    print(f"cache written to {args.dest} (ref {provenance['ref']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
