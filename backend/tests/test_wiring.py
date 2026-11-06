"""Integration seams between the API app, the client MCP server and the manager MCP server."""

import inspect
import json

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from billing_sim.api.app import create_app
from billing_sim.api.deps import Settings, get_conn, get_settings
from billing_sim.mcp_client.server import agent_tool_list, build_server
from billing_sim.mcp_manager.server import mcp

SUMMARY_KEYS = {"contracte", "facture", "paye", "reste_a_payer", "en_retard"}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(db_path=tmp_path / "sim.sqlite"))) as test_client:
        yield test_client


@pytest.fixture
def at_day_40(client):
    assert client.post("/setup/generate", json={"request_text": "x", "fallback": True}).status_code == 200
    assert client.put("/sim/clock", json={"day": 40}).status_code == 200
    return client


async def client_tool_names() -> list[str]:
    return [t["name"] for t in await agent_tool_list(build_server(lambda: None))]


def test_client_routes_served_by_app(at_day_40):
    r = at_day_40.get("/client/summary")
    assert r.status_code == 200
    assert SUMMARY_KEYS <= set(r.json())
    r = at_day_40.get("/client/lots/L1")
    assert r.status_code == 200
    assert r.json()["cle"] == "L1"
    assert at_day_40.get("/client/tickets/BANK-999").status_code == 404


def test_client_routes_ignore_day_query(at_day_40):
    baseline = at_day_40.get("/client/invoices")
    assert baseline.status_code == 200
    assert at_day_40.get("/client/invoices?day=0").json() == baseline.json()


async def test_dev_agent_tools_lists_client_tools(at_day_40):
    r = at_day_40.get("/dev/agent-tools")
    assert r.status_code == 200
    tools = r.json()
    names = await client_tool_names()
    assert len(tools) == 13
    assert [t["name"] for t in tools] == names
    assert all(t["description"] and "input_schema" in t for t in tools)


async def test_manager_get_agent_tools(tmp_path, monkeypatch):
    monkeypatch.setenv("SIM_DB_PATH", str(tmp_path / "sim.sqlite"))
    assert get_settings().db_path == tmp_path / "sim.sqlite"
    result = await mcp.call_tool("get_agent_tools", {})
    if isinstance(result, tuple):  # (content, structured) in this mcp version
        content, structured = result
        tools = structured["result"] if structured is not None else [json.loads(b.text) for b in content]
    else:
        tools = [json.loads(b.text) for b in result]
    assert [t["name"] for t in tools] == await client_tool_names()
    assert len(tools) == 13


def _uses_get_conn(dependant) -> bool:
    return any(d.call is get_conn or _uses_get_conn(d) for d in dependant.dependencies)


def _api_routes(routes):
    """Every APIRoute, descending into included routers (newer FastAPI keeps them as lazy wrappers)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _api_routes(route.original_router.routes)


def test_all_conn_routes_are_async(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "sim.sqlite"))
    conn_routes = [r for r in _api_routes(app.routes) if _uses_get_conn(r.dependant)]
    assert len(conn_routes) >= 13
    sync = [r.path for r in conn_routes if not inspect.iscoroutinefunction(r.endpoint)]
    assert not sync, f"sync routes using get_conn (sqlite thread rule): {sync}"
