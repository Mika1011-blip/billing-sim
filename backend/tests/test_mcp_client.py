import json
import sqlite3

import httpx
import pytest
from fastapi import FastAPI
from mcp.shared.memory import create_connected_server_and_client_session

from billing_sim.api.deps import get_conn
from billing_sim.api.routes_client import router
from billing_sim.engine.clock import set_day
from billing_sim.mcp_client.server import agent_tool_list, build_server

TOOLS = [
    "get_today",
    "get_contract",
    "get_summary",
    "list_lots",
    "get_lot",
    "list_tickets",
    "get_ticket",
    "get_ticket_history",
    "list_invoices",
    "get_invoice",
    "list_payments",
    "list_pending_approvals",
    "explain_price",
]


class _KeepOpen:
    """Wraps the shared test connection so the server's per-call `close()` leaves it usable."""

    def __init__(self, conn):
        self._conn = conn

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def shared(conn):
    """Copy of the fixture store usable from any thread (the REST routes run in a thread pool)."""
    copy = sqlite3.connect(":memory:", check_same_thread=False)
    copy.row_factory = sqlite3.Row
    conn.backup(copy)
    yield copy
    copy.close()


@pytest.fixture
def server(shared):
    return build_server(lambda: _KeepOpen(shared))


@pytest.fixture
async def client(shared):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_conn] = lambda: shared
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def call(server, name, **arguments):
    async with create_connected_server_and_client_session(server._mcp_server) as session:
        return await session.call_tool(name, arguments)


def payload(result):
    return json.loads(result.content[0].text)


async def test_tool_names_exact(server):
    names = [t.name for t in await server.list_tools()]
    assert sorted(names) == sorted(TOOLS)
    assert len(names) == 13


async def test_client_agent_cannot_pay(server):
    assert "pay_invoice" not in {t["name"] for t in await agent_tool_list(server)}


async def test_no_tool_accepts_a_day(server):
    for t in await server.list_tools():
        assert not ({"day", "as_of", "date", "jour"} & set(t.inputSchema.get("properties", {})))


async def test_descriptions_are_english_and_say_today(server):
    for t in await server.list_tools():
        assert "as of today" in t.description.lower(), t.name


async def test_parity_with_rest(server, client, shared):
    set_day(shared, 40)
    ticket = payload(await call(server, "list_tickets"))[0]["cle"]
    invoice = payload(await call(server, "list_invoices"))[0]["numero"]
    lot = payload(await call(server, "list_lots"))[0]["cle"]
    pairs = [
        ("get_today", {}, "/client/today"),
        ("get_contract", {}, "/client/contract"),
        ("get_summary", {}, "/client/summary"),
        ("list_lots", {}, "/client/lots"),
        ("get_lot", {"key": lot}, f"/client/lots/{lot}"),
        ("list_tickets", {}, "/client/tickets"),
        ("list_tickets", {"lot": lot, "status": "Terminé"}, f"/client/tickets?lot={lot}&status=Terminé"),
        ("get_ticket", {"key": ticket}, f"/client/tickets/{ticket}"),
        ("get_ticket_history", {"key": ticket}, f"/client/tickets/{ticket}/history"),
        ("list_invoices", {}, "/client/invoices"),
        ("get_invoice", {"number": invoice}, f"/client/invoices/{invoice}"),
        ("list_payments", {}, "/client/payments"),
        ("list_payments", {"invoice": invoice}, f"/client/payments?invoice={invoice}"),
        ("list_pending_approvals", {}, "/client/approvals/pending"),
        ("explain_price", {"key": ticket}, f"/client/explain/{ticket}"),
    ]
    assert {name for name, _, _ in pairs} == set(TOOLS)
    for name, args, route in pairs:
        response = await client.get(route)
        assert response.status_code == 200, route
        assert payload(await call(server, name, **args)) == response.json(), name


async def test_tools_read_the_clock(server, shared):
    set_day(shared, 10)
    first = payload(await call(server, "get_today"))
    set_day(shared, 40)
    second = payload(await call(server, "get_today"))
    assert (first["jour"], second["jour"]) == (10, 40)


async def test_future_invisible(server, shared):
    set_day(shared, 0)
    assert payload(await call(server, "list_invoices")) == []
    set_day(shared, 40)
    assert payload(await call(server, "list_invoices")) != []


async def test_not_found_message(server):
    result = await call(server, "get_ticket", key="BANK-999")
    assert result.isError
    assert "Enregistrement introuvable : BANK-999" in result.content[0].text


async def test_route_not_found_is_404(client):
    response = await client.get("/client/tickets/BANK-999")
    assert response.status_code == 404
    assert "introuvable" in response.json()["detail"]


async def test_routes_ignore_a_day_parameter(client, shared):
    set_day(shared, 0)
    response = await client.get("/client/invoices?day=40&as_of=40")
    assert response.json() == []


async def test_agent_tool_list(server):
    tools = await agent_tool_list(server)
    assert [t["name"] for t in tools] == [t.name for t in await server.list_tools()]
    for t in tools:
        assert set(t) == {"name", "description", "input_schema"}
        assert t["description"]
        assert t["input_schema"]["type"] == "object"
