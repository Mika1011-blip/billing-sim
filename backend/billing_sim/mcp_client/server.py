"""Past-only MCP server for the client agent.

Every tool reads the simulation clock itself and answers "as of today" from `store.queries`; none takes a
day, so the agent cannot look at the future. Results are the store's French-keyed dicts, serialised as a
single JSON text block (a bare list would otherwise be split into one block per element).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

from billing_sim.engine.clock import get_day
from billing_sim.store import queries
from billing_sim.store.db import NotFound, connect


def _run(conn_factory: Callable[[], sqlite3.Connection], query: Callable[..., Any], *args: Any, key: str = "") -> str:
    conn = conn_factory()
    try:
        return json.dumps(query(conn, get_day(conn), *args), ensure_ascii=False)
    except NotFound as exc:
        raise ToolError(f"Enregistrement introuvable : {key or exc}") from exc
    finally:
        conn.close()


def build_server(conn_factory: Callable[[], sqlite3.Connection]) -> FastMCP:
    server = FastMCP("billing-sim-client")

    def tool(description: str):
        return server.tool(description=description, structured_output=False)

    @tool("Get today's date in the engagement, as of today.")
    def get_today() -> str:
        return _run(conn_factory, queries.today)

    @tool("Get the signed contract terms (daily rates, payment terms, VAT), as of today.")
    def get_contract() -> str:
        conn = conn_factory()
        try:
            return json.dumps(queries.get_contract(conn), ensure_ascii=False)
        finally:
            conn.close()

    @tool("Get the money summary (contracted, invoiced, paid, remaining, overdue) and the lots, as of today.")
    def get_summary() -> str:
        return _run(conn_factory, queries.summary)

    @tool("List every lot with its progress, price and delivery state, as of today.")
    def list_lots() -> str:
        return _run(conn_factory, queries.list_lots)

    @tool("Get one lot by its key with its tickets and price, as of today.")
    def get_lot(key: str) -> str:
        return _run(conn_factory, queries.get_lot, key, key=key)

    @tool("List tickets, optionally filtered by lot key and by status, as of today.")
    def list_tickets(lot: str | None = None, status: str | None = None) -> str:
        return _run(conn_factory, lambda conn, day: queries.list_tickets(conn, day, lot_key=lot, status=status))

    @tool("Get one ticket by its key with its status, time spent and fee, as of today.")
    def get_ticket(key: str) -> str:
        return _run(conn_factory, queries.get_ticket, key, key=key)

    @tool("Get the chronological history (transitions, worklogs, comments) of one ticket, as of today.")
    def get_ticket_history(key: str) -> str:
        return _run(conn_factory, queries.ticket_history, key, key=key)

    @tool(
        "List the invoices issued with their amounts, status (À payer, En retard, Très en retard, Payée), days late "
        "or remaining, payment and delivery summary, as of today."
    )
    def list_invoices() -> str:
        return _run(conn_factory, queries.list_invoices)

    @tool(
        "Get one invoice by its number with its amounts, status (À payer, En retard, Très en retard, Payée), days "
        "late or remaining, payment, delivery summary, delivered tickets and price calculation, as of today."
    )
    def get_invoice(number: str) -> str:
        return _run(conn_factory, queries.get_invoice, number, key=number)

    @tool("List the payments received, optionally for one invoice number, as of today.")
    def list_payments(invoice: str | None = None) -> str:
        return _run(conn_factory, lambda conn, day: queries.list_payments(conn, day, invoice_number=invoice))

    @tool("List the approvals the client still has to give, as of today.")
    def list_pending_approvals() -> str:
        return _run(conn_factory, queries.pending_approvals)

    @tool("Explain how the price of a ticket or lot is computed, as of today.")
    def explain_price(key: str) -> str:
        return _run(conn_factory, queries.explain_price, key, key=key)

    return server


async def agent_tool_list(server: FastMCP) -> list[dict]:
    """The tools as the agent sees them: name, description and JSON input schema."""
    return [
        {"name": t.name, "description": t.description, "input_schema": t.inputSchema}
        for t in await server.list_tools()
    ]


async def agent_tools_for(db_path: Path) -> list[dict]:
    """The client agent's tool list for the store at `db_path` (listing tools never touches the database)."""
    return await agent_tool_list(build_server(lambda: connect(db_path)))
