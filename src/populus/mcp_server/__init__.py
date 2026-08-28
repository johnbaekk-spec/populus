"""Populus MCP server (``populus-mcp``).

A read-only, stdio FastMCP server over the published data snapshot (§9.9,
§11): seven congressional tools (``congress_*`` + ``congress_health``), five
institutional 13F tools (``inst_*`` + ``inst_health``), and the cross-domain
``populus_health``. Every tool returns the honest response envelope (§11.3):
dual dates on congressional records (G4), ``doc_url``/accession provenance,
amounts as statutory ranges never point values (G5), the filing-lag
``data_note`` (§9.8), and the register-required ``license_notices`` (§15).
Default congressional views exclude superseded/unresolved-amendment rows via
``v_default_transactions`` (§9.5).
"""

from populus.mcp_server.server import build_server, main

__all__ = ["build_server", "main"]
