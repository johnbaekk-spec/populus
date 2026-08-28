"""Hardened-XML helper tests (RUN PUBLIC-SECURITY-HARDENING, R10/LD11).

Attack inputs against :func:`populus.parse.xml.parse_untrusted_xml`, the
per-caller failure mapping, and — per Task 9 step 3 — flag-mutation cases
that build a deliberately WEAKENED parser and prove the attack succeeds
against it while the real helper blocks it. Every test runs under the autouse
no-socket guard.
"""

from __future__ import annotations

from io import BytesIO

import pytest
from lxml import etree

from populus.ingest import house
from populus.members import house_hints_from_index
from populus.parse.inst13f import CoverParseError, InfoTableParseError, parse_cover, parse_info_table
from populus.parse.xml import UnsafeXmlError, parse_untrusted_xml

VALID = b'<?xml version="1.0"?><root><child a="1">text</child></root>'


def _file_entity_doc(path: str) -> bytes:
    return (
        '<?xml version="1.0"?><!DOCTYPE root ['
        f'<!ENTITY leak SYSTEM "file://{path}">'
        "]><root>&leak;</root>"
    ).encode()


HTTP_ENTITY_DOC = (
    b'<?xml version="1.0"?><!DOCTYPE root ['
    b'<!ENTITY net SYSTEM "http://127.0.0.1:9/entity.txt">'
    b"]><root>&net;</root>"
)

INTERNAL_ENTITY_DOC = (
    b'<?xml version="1.0"?><!DOCTYPE root ['
    b'<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;">'
    b"]><root>&b;</root>"
)


def _weakened_parse(xml_bytes: bytes, **overrides) -> etree._ElementTree:
    """The helper's parser with named flags flipped and NO doctype gate."""
    kwargs = dict(
        resolve_entities=False,
        load_dtd=False,
        no_network=True,
        dtd_validation=False,
        huge_tree=False,
        recover=False,
    )
    kwargs.update(overrides)
    return etree.parse(BytesIO(xml_bytes), etree.XMLParser(**kwargs))


# --- the real helper ----------------------------------------------------------


def test_valid_xml_root_is_returned_exactly(tmp_path):
    root = parse_untrusted_xml(VALID)
    assert etree.tostring(root) == b'<root><child a="1">text</child></root>'
    assert root.find("child").get("a") == "1"


def test_external_file_entity_is_refused_and_leaks_nothing(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-CONTENT")
    with pytest.raises(UnsafeXmlError) as excinfo:
        parse_untrusted_xml(_file_entity_doc(str(secret)))
    assert "TOP-SECRET-CONTENT" not in str(excinfo.value)


def test_external_http_entity_is_refused_with_zero_sockets():
    # The autouse no-socket guard fails the test if any Python socket opens;
    # the doctype gate refuses the document before resolution is possible.
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(HTTP_ENTITY_DOC)


def test_internal_dtd_entity_expansion_is_refused():
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(INTERNAL_ENTITY_DOC)


def test_malformed_xml_is_a_named_parse_failure():
    with pytest.raises(etree.XMLSyntaxError):
        parse_untrusted_xml(b"<root><unclosed></root>")


def test_deep_tree_is_bounded():
    depth = 2048
    deep = b"<a>" * depth + b"x" + b"</a>" * depth
    with pytest.raises(etree.XMLSyntaxError):
        parse_untrusted_xml(deep)


def test_huge_text_node_is_bounded():
    # libxml2's non-huge_tree text-node ceiling is 10,000,000 bytes.
    huge = b"<root>" + b"x" * 11_000_000 + b"</root>"
    with pytest.raises(etree.XMLSyntaxError):
        parse_untrusted_xml(huge)


# --- caller failure mapping ---------------------------------------------------


def test_cover_parse_maps_refusal_to_cover_malformed():
    with pytest.raises(CoverParseError) as excinfo:
        parse_cover(INTERNAL_ENTITY_DOC)
    assert excinfo.value.kind == "cover_malformed"


def test_info_table_parse_maps_refusal_to_its_named_error():
    with pytest.raises(InfoTableParseError):
        parse_info_table(INTERNAL_ENTITY_DOC)


def test_house_index_refusal_is_a_named_discovery_failure():
    result = house._index_entries(INTERNAL_ENTITY_DOC, 2026)
    assert result.failed is True
    assert "refused" in (result.note or "")


def test_house_index_malformed_is_a_named_discovery_failure():
    result = house._index_entries(b"<FinancialDisclosure><oops>", 2026)
    assert result.failed is True
    assert "would not parse" in (result.note or "")


def test_member_hints_refuse_a_doctype_bearing_index(tmp_path):
    path = tmp_path / "2026FD.xml"
    path.write_bytes(INTERNAL_ENTITY_DOC)
    with pytest.raises(UnsafeXmlError):
        house_hints_from_index([path])


def test_member_hints_still_parse_a_clean_index(tmp_path):
    path = tmp_path / "2026FD.xml"
    path.write_bytes(
        b"<FinancialDisclosure><Member><FilingType>P</FilingType>"
        b"<DocID>20034916</DocID><StateDst>MO04</StateDst></Member>"
        b"</FinancialDisclosure>"
    )
    assert house_hints_from_index([path]) == {"house:20034916": ("MO", "4")}


# --- Task 9 step 3: flag mutations — the attack must succeed when weakened ----


def test_mutation_resolve_entities_would_leak_file_content(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-CONTENT")
    doc = _file_entity_doc(str(secret))
    # Weakened (entities resolved, DTD loaded, doctype gate absent): the local
    # file's content lands in the tree — the attack works.
    weakened = _weakened_parse(doc, resolve_entities=True, load_dtd=True)
    assert "TOP-SECRET-CONTENT" in (weakened.getroot().text or "")
    # The real helper refuses the same document outright.
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(doc)


def test_mutation_internal_entity_expansion_works_when_weakened():
    weakened = _weakened_parse(INTERNAL_ENTITY_DOC, resolve_entities=True)
    assert weakened.getroot().text == "AAAA" * 4
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(INTERNAL_ENTITY_DOC)


def test_mutation_no_network_is_what_blocks_a_network_entity_load():
    # Everything ELSE weakened, no_network still True: libxml2 refuses the
    # fetch by policy ("Attempt to load network entity"), not by connectivity.
    with pytest.raises(etree.XMLSyntaxError) as excinfo:
        _weakened_parse(HTTP_ENTITY_DOC, resolve_entities=True, load_dtd=True)
    assert "network entity" in str(excinfo.value).lower()
    # The real helper never reaches entity resolution at all.
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(HTTP_ENTITY_DOC)


def test_mutation_recover_would_accept_malformed_xml():
    broken = b"<root><unclosed></root>"
    weakened = _weakened_parse(broken, recover=True)
    assert weakened.getroot() is not None  # best-effort tree — the failure mode
    with pytest.raises(etree.XMLSyntaxError):
        parse_untrusted_xml(broken)


def test_mutation_huge_tree_would_accept_the_deep_tree():
    depth = 2048
    deep = b"<a>" * depth + b"x" + b"</a>" * depth
    weakened = _weakened_parse(deep, huge_tree=True)
    assert weakened.getroot() is not None
    with pytest.raises(etree.XMLSyntaxError):
        parse_untrusted_xml(deep)


def test_mutation_removing_the_doctype_gate_would_admit_dtd_documents():
    # dtd_validation is subsumed by this gate: ANY DTD-bearing document is
    # refused before validation semantics could apply. A helper missing the
    # gate parses the document; the real one refuses it.
    weakened = _weakened_parse(INTERNAL_ENTITY_DOC)  # hardened flags, no gate
    assert weakened.getroot() is not None
    with pytest.raises(UnsafeXmlError):
        parse_untrusted_xml(INTERNAL_ENTITY_DOC)
