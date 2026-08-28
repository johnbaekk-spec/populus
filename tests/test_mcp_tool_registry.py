"""Structural pin on the MCP tool registry (R7).

The complete thirteen-tool name set, every tool description, and every tool
input schema are captured in ``tests/fixtures/mcp_tool_registry.v1.json`` —
generated from the pre-split ``server.py`` and committed as the expected
contract. FastMCP derives the schema from each tool function's signature and
its description from the docstring, so this test fails on ANY drift in a tool
name, parameter, default, type annotation, or docstring — exactly the surface
the Slice 5 domain split (congress_tools.py / institutional_tools.py) must
carry over byte-identically.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from populus.mcp_server.server import build_server

_FIXTURE = Path(__file__).parent / "fixtures" / "mcp_tool_registry.v1.json"


def _current_registry() -> dict:
    srv = build_server(db_path=":memory:", build_id="cap")
    tools = asyncio.run(srv.list_tools())
    return {
        t.name: {"description": t.description, "inputSchema": t.inputSchema}
        for t in tools
    }


def test_tool_registry_matches_committed_contract():
    expected = json.loads(_FIXTURE.read_text())
    actual = _current_registry()
    assert sorted(actual) == sorted(expected), (
        "the registered tool NAME set drifted from the committed contract"
    )
    for name in sorted(expected):
        assert actual[name]["inputSchema"] == expected[name]["inputSchema"], (
            f"input schema drifted for tool {name!r}"
        )
        assert actual[name]["description"] == expected[name]["description"], (
            f"description drifted for tool {name!r}"
        )


def test_contract_pins_all_thirteen_tools():
    # The fixture itself must not silently shrink: 7 congress + 5 inst +
    # populus_health.
    expected = json.loads(_FIXTURE.read_text())
    assert len(expected) == 13
    congress = {n for n in expected if n.startswith("congress_")}
    inst = {n for n in expected if n.startswith("inst_")}
    assert len(congress) == 7 and len(inst) == 5
    assert "populus_health" in expected
