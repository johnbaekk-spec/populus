"""Canonicalization (R6) and row identity (R7): JCS bytes, fingerprints,
txn_id composition, dup_seq assignment."""

from __future__ import annotations

import unicodedata
from types import MappingProxyType

from populus.canonical import (
    assign_identity,
    canonical_json,
    nfc,
    row_fingerprint,
    txn_id,
)

# Pinned byte-level JCS vector: guards against an rfc8785 behavior change or an
# accidental swap to json.dumps (which would escape 'é' and add spaces).
PINNED_RAW = {"b": None, "a": "é"}
PINNED_BYTES = '{"a":"é","b":null}'.encode("utf-8")
PINNED_SHA256 = "07c8168101f1caf815af25649f708af61c29f4bd5bafcd422a3b17678d647a85"


def test_pinned_canonical_vector():
    assert canonical_json(PINNED_RAW) == PINNED_BYTES
    assert row_fingerprint(PINNED_RAW) == PINNED_SHA256


def test_non_dict_mapping_canonicalizes_identically():
    # The seam accepts any Mapping (R6), not only dict; a MappingProxyType must
    # produce the same JCS bytes and fingerprint as the equivalent dict.
    plain = {"b": None, "a": "é"}
    proxy = MappingProxyType(plain)
    assert canonical_json(proxy) == canonical_json(plain) == PINNED_BYTES
    assert row_fingerprint(proxy) == PINNED_SHA256


def test_fingerprint_is_full_hex_sha256():
    fingerprint = row_fingerprint({"asset_name": "Apple Inc"})
    assert len(fingerprint) == 64
    assert set(fingerprint) <= set("0123456789abcdef")


def test_key_order_invariance():
    assert row_fingerprint({"a": 1, "b": 2}) == row_fingerprint({"b": 2, "a": 1})


def test_null_differs_from_empty_string():
    assert row_fingerprint({"comment": None}) != row_fingerprint({"comment": ""})


def test_nfc_maps_decomposed_to_composed():
    composed = "Résumé"
    decomposed = unicodedata.normalize("NFD", composed)
    assert decomposed != composed
    assert nfc(decomposed) == composed
    assert row_fingerprint({"asset_name": nfc(decomposed)}) == row_fingerprint(
        {"asset_name": composed}
    )


def test_fingerprint_depends_only_on_raw_row(make_row):
    raw = {"owner": None, "asset_name": "Apple Inc", "side": "P"}
    a = make_row(raw_row=raw, asset_name="Apple Inc", side="purchase", row_ordinal=1)
    b = make_row(raw_row=raw, asset_name="APPLE (normalized differently)", side="other", row_ordinal=2)
    ids = assign_identity("house:1", [a, b])
    assert ids[0].row_fingerprint == ids[1].row_fingerprint == row_fingerprint(raw)


def test_txn_id_suffix_only_above_one():
    fingerprint = row_fingerprint({"asset_name": "Apple Inc"})
    base = txn_id("house:1", fingerprint, 1)
    assert base == f"house:1:{fingerprint[:32]}"
    assert "#" not in base
    assert txn_id("house:1", fingerprint, 2) == f"{base}#2"


def test_unique_rows_all_get_dup_seq_one(make_row):
    rows = [
        make_row(asset_name="Apple Inc", row_ordinal=1),
        make_row(asset_name="Microsoft Corp", row_ordinal=2),
        make_row(asset_name="Nvidia Corp", row_ordinal=3),
    ]
    ids = assign_identity("house:1", rows)
    assert [identity.dup_seq for identity in ids] == [1, 1, 1]
    assert all("#" not in identity.txn_id for identity in ids)


def test_dup_seq_orders_by_source_row_no(make_row):
    raw = {"asset_name": "Dup Asset"}
    # Input order deliberately disagrees with source coordinates.
    first_in_input = make_row(raw_row=raw, row_ordinal=1, source_row_no=5)
    second_in_input = make_row(raw_row=raw, row_ordinal=2, source_row_no=2)
    ids = assign_identity("house:1", [first_in_input, second_in_input])
    assert ids[0].dup_seq == 2  # source row 5 numbers after source row 2
    assert ids[1].dup_seq == 1
    assert ids[1].txn_id.endswith(ids[1].row_fingerprint[:32])
    assert ids[0].txn_id.endswith("#2")


def test_dup_seq_falls_back_to_row_ordinal(make_row):
    raw = {"asset_name": "Dup Asset"}
    later = make_row(raw_row=raw, row_ordinal=3)
    earlier = make_row(raw_row=raw, row_ordinal=1)
    ids = assign_identity("house:1", [later, earlier])
    assert ids[0].dup_seq == 2
    assert ids[1].dup_seq == 1


def test_dup_seq_undisturbed_by_interleaved_distinct_rows(make_row):
    raw = {"asset_name": "Dup Asset"}
    rows = [
        make_row(raw_row=raw, row_ordinal=1),
        make_row(asset_name="Distinct Corp", row_ordinal=2),
        make_row(raw_row=raw, row_ordinal=3),
    ]
    ids = assign_identity("house:1", rows)
    assert [identity.dup_seq for identity in ids] == [1, 1, 2]
    assert ids[1].txn_id == txn_id("house:1", ids[1].row_fingerprint, 1)


def test_identities_returned_in_input_order(make_row):
    rows = [
        make_row(asset_name="B Corp", row_ordinal=2),
        make_row(asset_name="A Corp", row_ordinal=1),
    ]
    ids = assign_identity("house:1", rows)
    assert ids[0].row_fingerprint == row_fingerprint(rows[0].raw_row)
    assert ids[1].row_fingerprint == row_fingerprint(rows[1].raw_row)
