"""The one hardened parser for untrusted XML (RUN PUBLIC-SECURITY-HARDENING, R10/LD11).

Every byte of XML that originated outside this repository — 13F covers and
information tables, the House Clerk index, member join hints read from cached
index files — parses through :func:`parse_untrusted_xml` and nothing else.
The settings are the F5 hardening that previously lived privately in
``parse/inst13f.py``, plus ``recover=False`` and an explicit DOCTYPE
rejection: a document that carries any DTD (internal or external) is refused
outright, so entity definition, expansion, and external references are
structurally unreachable rather than merely disabled.

Parser objects are never reused: a fresh ``XMLParser`` per call keeps no
libxml2 state across documents.
"""

from __future__ import annotations

from io import BytesIO

from lxml import etree


class UnsafeXmlError(ValueError):
    """The document declares a DOCTYPE/DTD — refused before any use (LD11)."""


def parse_untrusted_xml(xml_bytes: bytes) -> etree._Element:
    """Parse untrusted *xml_bytes* and return the root element (LD11).

    Raises :class:`UnsafeXmlError` for any document carrying a DOCTYPE, and
    ``lxml.etree.XMLSyntaxError`` for malformed input (``recover=False`` —
    a broken document is a named failure, never a best-effort tree).
    """
    parser = etree.XMLParser(
        resolve_entities=False,
        load_dtd=False,
        no_network=True,
        dtd_validation=False,
        huge_tree=False,
        recover=False,
    )
    tree = etree.parse(BytesIO(xml_bytes), parser)
    if tree.docinfo.doctype:
        raise UnsafeXmlError(
            "refusing XML that declares a DOCTYPE: DTDs and entities are not"
            " accepted from untrusted sources"
        )
    return tree.getroot()
