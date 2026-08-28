"""Federated-client package (ARCHITECTURE.md §11.4 — RUN M2-1).

Pattern F: the client fetches from the source at question time from the user's
own machine, so this package holds the identity and access policy the agency
asks for — and nothing else. The transport response shape is the one the M1
ingest package already defines; there is exactly one in the repository.

SEC's fair-access conditions are ACCESS conditions, not redistribution
restrictions, and they are encoded in code, never in configuration (G6) — see
the ``sec-edgar`` entry in the §15 conditions register.

**User-Agent, verified 2026-07-24 (M2-CONTRACT §1).** The parenthesized form
M1 sends to the House Clerk and the Senate receives 403 "Request Rate Threshold
Exceeded" from SEC's WAF; SEC's recommended ``<app name> <contact email>``
form receives 200. Sending the format the agency documents is compliance, not
evasion: the UA is truthful, identifies the application, and carries a
monitored contact address.
"""

from __future__ import annotations

from populus.ingest import TransportResponse
from populus.operator_identity import (
    CONTACT_ENV as SEC_CONTACT_ENV,
    DEFAULT_CONTACT as DEFAULT_SEC_CONTACT,
    SEC_APP_NAME,
)

# The identity halves above live in populus.operator_identity (D9): one
# contact setting, resolved at call time, shared with the M1 filings clients.

#: Hosts this client will talk to. Anything else is refused before a request is
#: built, so a mis-constructed or attacker-influenced URL cannot send SEC's
#: identifying UA — or any request at all — somewhere else.
SEC_HOSTS = ("www.sec.gov", "data.sec.gov")
SEC_HOST_SUFFIX = ".sec.gov"

#: SEC serves compressed responses; asking for them is part of being polite.
ACCEPT_ENCODING = "gzip, deflate"

__all__ = [
    "ACCEPT_ENCODING",
    "DEFAULT_SEC_CONTACT",
    "SEC_APP_NAME",
    "SEC_CONTACT_ENV",
    "SEC_HOSTS",
    "SEC_HOST_SUFFIX",
    "TransportResponse",
]
