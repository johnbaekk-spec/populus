"""The shared operator identity (D9): one contact setting, two UA formats.

`populus.operator_identity` is the single owner of contact resolution.
House/Senate keep the parenthesized bot format; SEC keeps the verified bare
application-plus-contact format; the environment is resolved at CALL time, so
setting POPULUS_CONTACT after import changes every later request.
"""

from __future__ import annotations

import populus
from populus.ingest import user_agent as filings_ua
from populus.operator_identity import (
    CONTACT_ENV,
    DEFAULT_CONTACT,
    filings_user_agent,
    operator_contact,
    sec_user_agent,
)


def test_the_two_exact_user_agent_shapes():
    assert (
        filings_user_agent("ops@example.org", "1.2.3")
        == "PopulusBot/1.2.3 (+https://github.com/johnbaekk-spec/populus;"
        " contact: ops@example.org)"
    )
    assert sec_user_agent("ops@example.org") == "Populus ops@example.org"
    # The SEC form is verifiably bare: no parentheses, no version, no URL
    # (the parenthesized form receives 403 from SEC's WAF — M2-CONTRACT §1).
    assert "(" not in sec_user_agent(DEFAULT_CONTACT)
    assert "/" not in sec_user_agent(DEFAULT_CONTACT)


def test_operator_contact_prefers_the_environment():
    contact, warning = operator_contact({CONTACT_ENV: " ops@example.org "})
    assert contact == "ops@example.org"
    assert warning is None


def test_operator_contact_falls_back_with_a_routed_warning():
    warned: list[str] = []
    contact, warning = operator_contact({}, warn=warned.append)
    assert contact == DEFAULT_CONTACT
    assert warning is not None and CONTACT_ENV in warning
    assert warned == [warning]
    # A blank value is unset, not a contact.
    assert operator_contact({CONTACT_ENV: "   "})[0] == DEFAULT_CONTACT


def test_env_change_after_import_affects_later_requests(monkeypatch):
    """Resolution happens at call time, never frozen at module import."""
    monkeypatch.delenv(CONTACT_ENV, raising=False)
    assert DEFAULT_CONTACT in filings_ua()
    monkeypatch.setenv(CONTACT_ENV, "late@example.org")
    assert filings_ua() == filings_user_agent(
        "late@example.org", populus.__version__
    )
    assert "late@example.org" in sec_user_agent(operator_contact()[0])
