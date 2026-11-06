"""Manager MCP server: the control plane (generate, clock, full inspection). Run with `python -m billing_sim.mcp_manager`."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from mcp.server.fastmcp import FastMCP

from billing_sim.api.deps import get_settings
from billing_sim.engine import clock
from billing_sim.engine.payments import pay_invoice as pay
from billing_sim.mcp_client.server import agent_tools_for
from billing_sim.mcp_manager.pipeline import generate as run_generate
from billing_sim.store import dev_queries
from billing_sim.store.db import connect, wipe

mcp = FastMCP("billing-sim-manager")


@contextmanager
def _db() -> Iterator:
    conn = connect(get_settings().db_path)
    try:
        yield conn
    finally:
        conn.close()


@mcp.tool()
def generate(request_text: str, seed: int | None = None, fallback: bool = False) -> dict:
    """Generate a scenario from a free-text request (or load the fallback fixture) and replace the stored one."""
    outcome = run_generate(request_text, seed=seed, fallback=fallback, settings=get_settings())
    if outcome.kind == "rejection":
        return {"kind": "rejection", "reason": outcome.reason, "seed": outcome.seed}
    with _db() as conn:
        last_day = clock.last_day(conn)
    return {
        "kind": "plan",
        "seed": outcome.seed,
        "warnings": outcome.warnings,
        "lots": len(outcome.plan.lots),
        "tickets": len(outcome.plan.tickets),
        "last_day": last_day,
    }


@mcp.tool()
def reset() -> dict:
    """Delete the stored scenario and put the clock back at 0."""
    with _db() as conn:
        wipe(conn)
    return {"ok": True}


@mcp.tool()
def get_clock() -> dict:
    """Current day, last day of the run and calendar date."""
    with _db() as conn:
        return clock.state(conn)


@mcp.tool()
def set_day(d: int) -> int:
    """Move the clock to day `d` (clamped to the run); returns the day set."""
    with _db() as conn:
        return clock.set_day(conn, d)


@mcp.tool()
def step(n: int) -> int:
    """Move the clock by `n` days (clamped to the run); returns the new day."""
    with _db() as conn:
        return clock.step(conn, n)


@mcp.tool()
def pay_invoice(number: str) -> dict:
    """Pay invoice `number` in full at the current clock day (what the participant does from the client page)."""
    with _db() as conn:
        return pay(conn, number)


@mcp.tool()
def get_plan() -> dict:
    """The full plan: scenario, contract, team, sprints, lots and tickets with planned schedules."""
    with _db() as conn:
        return dev_queries.full_plan(conn)


@mcp.tool()
def get_timeline(from_day: int | None = None, to_day: int | None = None) -> dict:
    """Every event, invoice, payment and approval in [from_day, to_day], future included."""
    with _db() as conn:
        return dev_queries.full_timeline(conn, from_day, to_day)


@mcp.tool()
def get_ticket_full(key: str) -> dict:
    """One ticket with plan, pricing, planned vs real schedule, all events and its invoice."""
    with _db() as conn:
        return dev_queries.ticket_full(conn, key)


@mcp.tool()
def diff_plan_vs_real() -> dict:
    """Planned vs real schedule and days charged vs actual days, per ticket and per lot."""
    with _db() as conn:
        return dev_queries.diff_plan_vs_real(conn)


@mcp.tool()
async def get_agent_tools() -> list[dict]:
    """The tools the client agent can call: name, description and JSON input schema."""
    return await agent_tools_for(get_settings().db_path)
