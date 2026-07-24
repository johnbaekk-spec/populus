"""Response envelope and record shaping (§11.3, honesty guardrails).

Every tool response is ``{as_of, build_id, data_note, license_notices,
results, next_cursor?}``; every transaction record carries BOTH dates and a
``doc_url``, and amounts only ever appear as ``amount_low``/``amount_high``/
``amount_label`` — never a synthesized point value (G4, G5, G10).
"""

from __future__ import annotations

import base64
import json
from typing import Any

from populus import licenses

# §9.8 — the standing disclosure-lag note, non-removable from every response.
DATA_NOTE = (
    "Congressional trades are disclosed under the STOCK Act up to 45 days after"
    " they occur, so `filed_date` (when it was disclosed) is not"
    " `transaction_date` (when it happened); both fields are on every record."
    " `transaction_date` is `null` — always carrying a `date_missing` flag —"
    " when the filing omits it or prints it unparseably; `filed_date` is always"
    " present."
    " Amounts are the statutory ranges Congress discloses"
    " (`amount_low`/`amount_high`), never exact values. Portfolio/flow figures"
    " are derived from disclosed transactions, not holdings. Not financial"
    " advice. Use of these reports is restricted by 5 U.S.C. § 13107(c)."
)


def license_notices() -> list[dict[str, str]]:
    """Register-required attributions (§15), verbatim, on every response."""
    register = licenses.load_register()
    return [
        {"license_id": lid, "notice": text}
        for lid, text in licenses.required_notices(register)
    ]


# The transaction fields surfaced to clients, in a stable order. Raw-only and
# internal columns (raw_row, row_fingerprint, dup_seq, license_id, kadoa_id,
# flags-internal) are not exposed; provenance is doc_url + source.
def shape_transaction(row: dict[str, Any]) -> dict[str, Any]:
    """One transaction record for a tool result — dual dates + doc_url + range."""
    flags = row.get("flags")
    if isinstance(flags, str):
        try:
            flags = json.loads(flags)
        except ValueError:
            flags = [flags] if flags else []
    return {
        "txn_id": row["txn_id"],
        "member": {
            "bioguide_id": row.get("bioguide_id"),
            "name": row.get("full_name"),
            "party": row.get("party"),
            "state": row.get("state"),
            "chamber": row["chamber"],
        },
        "ticker": row.get("ticker"),
        "asset_name": row["asset_name"],
        "asset_type": row.get("asset_type"),
        "side": row["side"],
        "owner": row.get("owner"),
        # Both dates, always (G4).
        "transaction_date": row.get("transaction_date"),
        "filed_date": row["filed_date"],
        "days_to_file": row.get("days_to_file"),
        "is_late": bool(row["is_late"]) if row.get("is_late") is not None else None,
        # Range only, never a point value (G5).
        "amount_low": row.get("amount_low"),
        "amount_high": row.get("amount_high"),
        "amount_label": row.get("amount_label"),
        "cap_gains_over_200": (
            bool(row["cap_gains_over_200"])
            if row.get("cap_gains_over_200") is not None
            else None
        ),
        "comment": row.get("comment"),
        "flags": flags or [],
        "source": row["source"],
        "doc_url": row.get("doc_url"),
    }


def envelope(
    *,
    build_id: str | None,
    as_of: str,
    results: Any,
    next_cursor: str | None = None,
    extra_note: str | None = None,
) -> dict[str, Any]:
    """Wrap tool output in the standard envelope (§11.3)."""
    note = DATA_NOTE if extra_note is None else f"{DATA_NOTE} {extra_note}"
    env: dict[str, Any] = {
        "as_of": as_of,
        "build_id": build_id,
        "data_note": note,
        "license_notices": license_notices(),
        "results": results,
    }
    if next_cursor is not None:
        env["next_cursor"] = next_cursor
    return env


# --- opaque cursor pagination (stable across identical snapshots) -----------
def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(json.dumps({"o": offset}).encode()).decode()


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        obj = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        offset = obj["o"]
        if not isinstance(offset, int) or offset < 0:
            raise ValueError
        return offset
    except Exception as exc:  # malformed cursor → corrective hint at call site
        raise ValueError(f"invalid cursor {cursor!r}") from exc
