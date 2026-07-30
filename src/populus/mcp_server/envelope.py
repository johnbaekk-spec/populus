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
from populus.normalize_inst import INST_DATA_NOTE  # M2 quarter-end caveat (G10)

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


def license_notices_for(license_ids: list[str]) -> list[dict[str, str]]:
    """Module-scoped notices: the register ``attribution`` (and any verbatim
    required notices) for each id in *license_ids* (§15/R9).

    The global :func:`license_notices` emits only the register's non-empty
    ``required_notices``; the ``sec-edgar`` entry has an EMPTY required-notices
    list but a populated ``attribution`` that must still travel with every
    inst response, so this surfaces the attribution as the license notice. A
    federated inst response therefore carries ``sec-edgar`` and NOT the
    congressional statutory notice (G9 separation).
    """
    wanted = set(license_ids)
    register = licenses.load_register()
    notices: list[dict[str, str]] = []
    for entry in register["entries"]:
        if entry["license_id"] not in wanted:
            continue
        attribution = entry.get("attribution")
        if attribution:
            notices.append({"license_id": entry["license_id"], "notice": attribution})
        for notice in entry.get("required_notices", []):
            notices.append({"license_id": entry["license_id"], "notice": notice})
    return notices


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


# A 13F holding surfaced to clients. The grain is filing-level, so BOTH dates
# ride every record (G4); the value is the manager's stated quarter-end market
# value labeled with its era-dependent unit_basis, never a synthesized point
# value (G5); the snapshot is explicitly quarter-end-not-current (G10). Identity
# stays raw on the federated path — raw CUSIP + issuer name, no guessed
# security_id (G3/G14/LD5).
def shape_holding(
    row: dict[str, Any],
    *,
    period_of_report: str,
    filed_date: str,
    doc_url: str | None,
) -> dict[str, Any]:
    """One 13F holding for a tool result — both dates + value-with-unit + doc_url."""
    flags = row.get("flags")
    if isinstance(flags, str):
        try:
            flags = json.loads(flags)
        except ValueError:
            flags = [flags] if flags else []
    return {
        "issuer_name": row.get("issuer_name_raw") or row.get("issuer_name"),
        "cusip": row.get("cusip"),
        "cusip_raw": row.get("cusip_raw"),
        "title_of_class": row.get("title_of_class"),
        # Quarter-end value as a labeled amount + its unit basis (G5), never a
        # synthesized point value; value_usd is NULL when the filing did not
        # print a parseable value.
        "value_usd": row.get("value_usd"),
        "unit_basis": row.get("unit_basis"),
        "value_label": "manager's stated quarter-end market value (USD)",
        "ssh_prnamt": row.get("ssh_prnamt"),
        "ssh_prnamt_type": row.get("ssh_prnamt_type"),
        "put_call": row.get("put_call"),
        # Identity left unresolved on the federated path (G14/LD5); raw only.
        "security_id": row.get("security_id"),
        # Both dates, always (G4) — the grain is the filing/quarter.
        "period_of_report": period_of_report,
        "filed_date": filed_date,
        "flags": flags or [],
        "source": "sec-edgar",
        "doc_url": doc_url,
    }


def envelope(
    *,
    build_id: str | None = None,
    as_of: str,
    results: Any,
    next_cursor: str | None = None,
    extra_note: str | None = None,
    live_source: dict[str, Any] | None = None,
    data_note: str | None = None,
    license_notices_list: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Wrap tool output in the standard envelope (§11.3).

    Defaults preserve the congress contract exactly (``build_id`` stamp, the
    congressional ``DATA_NOTE``, the global ``license_notices``). The M2 module
    passes ``data_note=INST_DATA_NOTE`` and ``license_notices_list`` scoped to
    ``sec-edgar``; a federated fetch passes ``live_source`` INSTEAD of a
    ``build_id`` — the two are mutually exclusive (xor), so a response is always
    unambiguously either snapshot-stamped or live-stamped.
    """
    base_note = DATA_NOTE if data_note is None else data_note
    note = base_note if extra_note is None else f"{base_note} {extra_note}"
    env: dict[str, Any] = {"as_of": as_of}
    # §11.3: EITHER the snapshot build_id OR, for a live federated fetch, the
    # live_source — never both.
    if live_source is not None:
        env["live_source"] = live_source
    else:
        env["build_id"] = build_id
    env["data_note"] = note
    env["license_notices"] = (
        license_notices() if license_notices_list is None else license_notices_list
    )
    env["results"] = results
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
