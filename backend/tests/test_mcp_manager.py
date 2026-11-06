import json

import pytest

from billing_sim.api.deps import get_settings
from billing_sim.mcp_manager.server import mcp

TOOLS = {
    "generate",
    "reset",
    "get_clock",
    "set_day",
    "step",
    "pay_invoice",
    "get_plan",
    "get_timeline",
    "get_ticket_full",
    "diff_plan_vs_real",
    "get_agent_tools",
}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SIM_DB_PATH", str(tmp_path / "sim.sqlite"))
    assert get_settings().db_path == tmp_path / "sim.sqlite"


def unwrap(result):
    """FastMCP returns (content, structured) or content; normalise to the tool's python value."""
    if isinstance(result, tuple):
        content, structured = result
        if structured is not None:
            return structured.get("result", structured)
        result = content
    return json.loads(result[0].text)


async def test_tool_names():
    assert {t.name for t in await mcp.list_tools()} == TOOLS


async def test_generate_then_clock():
    out = unwrap(await mcp.call_tool("generate", {"request_text": "x", "fallback": True}))
    assert out["kind"] == "plan"
    assert out["tickets"] >= 12
    assert unwrap(await mcp.call_tool("set_day", {"d": 5})) == 5
    assert unwrap(await mcp.call_tool("get_clock", {}))["day"] == 5
    assert unwrap(await mcp.call_tool("step", {"n": 2})) == 7


async def test_inspection_tools():
    await mcp.call_tool("generate", {"request_text": "x", "fallback": True})
    plan = unwrap(await mcp.call_tool("get_plan", {}))
    key = plan["tickets"][0]["key"]
    assert unwrap(await mcp.call_tool("get_ticket_full", {"key": key}))
    assert "tickets" in unwrap(await mcp.call_tool("diff_plan_vs_real", {}))
    assert unwrap(await mcp.call_tool("get_timeline", {"from_day": 0, "to_day": 3}))
    assert len(unwrap(await mcp.call_tool("get_agent_tools", {}))) == 13  # see test_wiring for the names


async def test_reset_wipes():
    await mcp.call_tool("generate", {"request_text": "x", "fallback": True})
    await mcp.call_tool("reset", {})
    with pytest.raises(Exception):
        await mcp.call_tool("get_plan", {})


async def test_pay_invoice_tool():
    await mcp.call_tool("generate", {"request_text": "x", "fallback": True})
    await mcp.call_tool("set_day", {"d": 20})
    out = unwrap(await mcp.call_tool("pay_invoice", {"number": "F-2026-001"}))
    assert out["facture"] == "F-2026-001"
    assert out["reference"] == "VIR-F-2026-001-1"
    assert out["montant"] == 3600
    with pytest.raises(Exception, match="déjà payée"):
        await mcp.call_tool("pay_invoice", {"number": "F-2026-001"})
    with pytest.raises(Exception, match="Enregistrement introuvable : F-9999-999"):
        await mcp.call_tool("pay_invoice", {"number": "F-9999-999"})
