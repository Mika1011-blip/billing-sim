"""Full-truth inspection for the manager side and the dev panel: plan, whole timeline (future included), diff."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from billing_sim.api.deps import Settings, get_conn, get_settings
from billing_sim.mcp_client.server import agent_tools_for
from billing_sim.store import dev_queries

router = APIRouter(prefix="/dev", tags=["dev"])


@router.get("/plan")
async def get_plan(conn: sqlite3.Connection = Depends(get_conn)):
    return dev_queries.full_plan(conn)


@router.get("/timeline")
async def get_timeline(
    from_day: int | None = None, to_day: int | None = None, conn: sqlite3.Connection = Depends(get_conn)
):
    return dev_queries.full_timeline(conn, from_day, to_day)


@router.get("/ticket/{key}")
async def get_ticket(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return dev_queries.ticket_full(conn, key)


@router.get("/diff")
async def get_diff(conn: sqlite3.Connection = Depends(get_conn)):
    return dev_queries.diff_plan_vs_real(conn)


@router.get("/agent-tools")
async def get_agent_tools(settings: Settings = Depends(get_settings)) -> list[dict]:
    return await agent_tools_for(settings.db_path)
