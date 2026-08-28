"""The §15 conditions register: load, validate, render (RUN 4).

``licenses.json`` is the machine-readable register (§15.1): each entry
carries the license id, source, legal instrument, permitted uses,
restrictions, required notices (verbatim where the source specifies them),
attribution, determination basis, determination date, and review-by date
(§14's quarterly cadence). ``DATA-LICENSE.md`` (human-readable) and
``NOTICE`` (required attributions) are GENERATED from it by
``scripts/maintenance/render_licenses.py`` and drift-guarded in CI. No source is
ingested before its entry exists (G11); a non-``ingestible`` entry is a
recorded marker (reference-only, or a placeholder completed at a later
phase gate).
"""

from __future__ import annotations

import importlib.resources
import json
from collections.abc import Mapping
from datetime import date

REQUIRED_FIELDS = (
    "license_id",
    "source",
    "instrument",
    "permitted_uses",
    "restrictions",
    "required_notices",
    "attribution",
    "determination_basis",
    "determination_date",
    "review_by",
    "ingestible",
    "status",
)
_STATUSES = ("determined", "placeholder")


def load_register() -> dict:
    """The packaged register, parsed."""
    text = (
        importlib.resources.files("populus")
        .joinpath("licenses.json")
        .read_text(encoding="utf-8")
    )
    return json.loads(text)


def validate_register(register: Mapping) -> list[str]:
    """Structural validation; returns every defect (empty = valid)."""
    errors: list[str] = []
    entries = register.get("entries")
    if not isinstance(entries, list) or not entries:
        return ["register has no entries list"]
    seen: set[str] = set()
    for position, entry in enumerate(entries):
        label = entry.get("license_id", f"entry {position}")
        for field in REQUIRED_FIELDS:
            if field not in entry:
                errors.append(f"{label}: missing field {field!r}")
        license_id = entry.get("license_id")
        if license_id in seen:
            errors.append(f"{label}: duplicate license_id")
        if license_id:
            seen.add(license_id)
        for field in ("permitted_uses", "restrictions", "required_notices"):
            if field in entry and not isinstance(entry[field], list):
                errors.append(f"{label}: {field} must be a list")
        # counsel_flags is OPTIONAL (existing entries need no migration): when
        # present it must be a list of non-empty strings — each names a P2-entry
        # counsel gate the entry raises (e.g. "cusip-redistribution").
        if "counsel_flags" in entry:
            flags = entry["counsel_flags"]
            if not isinstance(flags, list) or not all(
                isinstance(flag, str) and flag.strip() for flag in flags
            ):
                errors.append(
                    f"{label}: counsel_flags must be a list of non-empty strings"
                )
        if "ingestible" in entry and not isinstance(entry["ingestible"], bool):
            errors.append(f"{label}: ingestible must be a boolean")
        if entry.get("status") not in _STATUSES:
            errors.append(f"{label}: status must be one of {_STATUSES}")
        try:
            determined = date.fromisoformat(entry.get("determination_date", ""))
            review_by = date.fromisoformat(entry.get("review_by", ""))
        except ValueError:
            errors.append(f"{label}: determination/review dates must be ISO dates")
        else:
            if review_by <= determined:
                errors.append(f"{label}: review_by must follow determination_date")
    return errors


def register_ids(register: Mapping) -> set[str]:
    return {entry["license_id"] for entry in register["entries"]}


def ingestible_ids(register: Mapping) -> set[str]:
    return {
        entry["license_id"] for entry in register["entries"] if entry["ingestible"]
    }


def required_notices(register: Mapping) -> list[tuple[str, str]]:
    """``(license_id, verbatim notice)`` for every required notice."""
    notices: list[tuple[str, str]] = []
    for entry in register["entries"]:
        for notice in entry["required_notices"]:
            notices.append((entry["license_id"], notice))
    return notices


def counsel_flags(register: Mapping, license_id: str) -> list[str]:
    """The counsel-gate flags an entry raises (empty when it names none).

    The structured surface behind the P2-entry counsel gate: `sec-13f-list`
    carries ``["cusip-redistribution"]`` so the flag is queryable rather than
    buried in restriction prose (R1).
    """
    for entry in register["entries"]:
        if entry.get("license_id") == license_id:
            return list(entry.get("counsel_flags", []))
    return []


_GENERATED_HEADER = (
    "<!-- GENERATED FILE — do not edit by hand. Source of truth:"
    " src/populus/licenses.json; regenerate with"
    " `python scripts/maintenance/render_licenses.py`. -->"
)


def render_data_license(register: Mapping) -> str:
    """The human-readable mirror of the register (§15.1)."""
    lines = [
        _GENERATED_HEADER,
        "",
        "# Public Filings data conditions register (DATA-LICENSE)",
        "",
        "Public Filings **code** is MIT-licensed (see [LICENSE](LICENSE)). Public Filings"
        " **data** is not one license: every source enters through this"
        " conditions register (ARCHITECTURE.md §15), which records what each"
        " source permits, what it restricts, and which notices must travel"
        " with the data. \"Public record\" is never treated as synonymous"
        " with \"public domain\". No source is ingested before its entry"
        " exists (G11).",
        "",
        f"Register version: `{register['register_version']}`.",
        "",
    ]
    for entry in register["entries"]:
        marker = ""
        if not entry["ingestible"]:
            marker = (
                " *(reference only — never ingested)*"
                if entry["status"] == "determined"
                else " *(placeholder — no ingestion before the entry completes)*"
            )
        lines.append(f"## `{entry['license_id']}` — {entry['source']}{marker}")
        lines.append("")
        lines.append(f"- **Instrument:** {entry['instrument']}")
        lines.append(
            f"- **Status:** {entry['status']} ·"
            f" **Ingestible:** {'yes' if entry['ingestible'] else 'no'}"
        )
        if entry["permitted_uses"]:
            lines.append("- **Permitted uses:**")
            lines.extend(f"  - {use}" for use in entry["permitted_uses"])
        if entry["restrictions"]:
            lines.append("- **Restrictions:**")
            lines.extend(f"  - {restriction}" for restriction in entry["restrictions"])
        if entry["required_notices"]:
            lines.append("- **Required notices (verbatim):**")
            lines.extend(f"  > {notice}" for notice in entry["required_notices"])
        if entry.get("counsel_flags"):
            lines.append(
                "- **Counsel-gate flags:** "
                + ", ".join(f"`{flag}`" for flag in entry["counsel_flags"])
            )
        if entry["attribution"]:
            lines.append(f"- **Attribution:** {entry['attribution']}")
        lines.append(f"- **Determination basis:** {entry['determination_basis']}")
        lines.append(
            f"- **Determined:** {entry['determination_date']} ·"
            f" **Review by:** {entry['review_by']}"
        )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_notice(register: Mapping) -> str:
    """The NOTICE file: required attributions and verbatim notices."""
    lines = [
        "Public Filings NOTICE — required attributions and notices",
        "GENERATED FILE — do not edit by hand. Source of truth:",
        "src/populus/licenses.json; regenerate with",
        "`python scripts/maintenance/render_licenses.py`.",
        "",
    ]
    for entry in register["entries"]:
        counsel = entry.get("counsel_flags") or []
        if not entry["attribution"] and not entry["required_notices"] and not counsel:
            continue
        lines.append(f"[{entry['license_id']}]")
        if entry["attribution"]:
            lines.append(f"  {entry['attribution']}")
        for notice in entry["required_notices"]:
            lines.append(f"  NOTICE: {notice}")
        for flag in counsel:
            lines.append(f"  COUNSEL-GATE: {flag}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
