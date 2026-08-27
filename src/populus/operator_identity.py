"""One operator contact, two source-specific User-Agent formats (D9).

Every automated request Populus makes identifies its operator through a single
setting — ``POPULUS_CONTACT`` — resolved from the environment at **call time**,
never frozen at module import. The fallback address is a documented maintainer
fallback for compatibility, not hidden configuration: sources ask for a
monitored address so they can reach an operator instead of blocking silently.

Two formats exist because the sources verifiably require different ones:

- **House/Senate filings** accept the parenthesized bot form
  ``PopulusBot/<version> (+<project url>; contact: <address>)``.
- **SEC** requires the bare ``<app name> <contact>`` form. Verified 2026-07-24
  (M2-CONTRACT §1): the parenthesized form receives 403 "Request Rate
  Threshold Exceeded" from SEC's WAF; the bare form receives 200. The
  parenthesized form is never sent to any ``*.sec.gov`` host.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

#: The application half of the SEC-accepted User-Agent. No version segment:
#: the verified 200 was against the bare "<name> <email>" form.
SEC_APP_NAME = "Populus"

#: The bot half of the House/Senate parenthesized User-Agent.
BOT_NAME = "PopulusBot"

#: The project URL carried in the parenthesized filings User-Agent.
PROJECT_URL = "https://github.com/johnbaekk-spec/populus"

#: The maintainer fallback used when POPULUS_CONTACT is unset (documented,
#: not hidden: operators should set their own monitored address).
DEFAULT_CONTACT = "johnbaekk@gmail.com"

#: Environment variable holding the operator's contact address.
CONTACT_ENV = "POPULUS_CONTACT"


def operator_contact(
    environ: Mapping[str, str] | None = None,
    *,
    warn: Callable[[str], None] | None = None,
) -> tuple[str, str | None]:
    """``(contact, warning)`` — pure; the caller decides how to emit the warning.

    Resolves ``POPULUS_CONTACT`` from *environ* (the live ``os.environ`` when
    None) at call time, so an operator can set it after import and every later
    request picks it up. When unset, returns the maintainer fallback together
    with the warning explaining why a monitored address matters; *warn*
    optionally routes that warning so a startup path can emit it without
    reaching for a logger of its own.
    """
    if environ is None:
        import os

        environ = os.environ
    configured = (environ.get(CONTACT_ENV) or "").strip()
    if configured:
        return (configured, None)
    warning = (
        f"{CONTACT_ENV} is not set: every source Populus talks to asks an"
        f" automated client to identify itself with a MONITORED contact"
        f" address, so it can reach an operator instead of blocking the"
        f" traffic. Falling back to {DEFAULT_CONTACT!r}; set {CONTACT_ENV} to"
        f" your own address."
    )
    if warn is not None:
        warn(warning)
    return (DEFAULT_CONTACT, warning)


def filings_user_agent(contact: str, version: str) -> str:
    """The parenthesized bot User-Agent the House Clerk and Senate accept."""
    return f"{BOT_NAME}/{version} (+{PROJECT_URL}; contact: {contact})"


def sec_user_agent(contact: str) -> str:
    """The exact SEC-accepted User-Agent byte string.

    ``"Populus johnbaekk@gmail.com"`` with the fallback contact — no version
    segment, no parentheses, no URL (M2-CONTRACT §1).
    """
    return f"{SEC_APP_NAME} {contact}"
