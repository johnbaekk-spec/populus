"""Populus MCP server (``populus-mcp``) — RUN 6.

A read-only, stdio FastMCP server over the published congressional-trading
snapshot (§9.9, §11). Six analyst-question tools plus ``populus_health``, each
returning the honest response envelope (§11.3): both ``transaction_date`` and
``filed_date`` on every record (G4), ``doc_url`` provenance, amounts as
statutory ranges never point values (G5), the 45-day-lag ``data_note`` (§9.8),
and the register-required ``license_notices`` (§15). Default views exclude
superseded/unresolved-amendment rows via ``v_default_transactions`` (§9.5).
"""

from populus.mcp_server.server import build_server, main

__all__ = ["build_server", "main"]
