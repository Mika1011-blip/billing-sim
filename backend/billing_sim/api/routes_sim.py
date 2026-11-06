"""The clock: read it, set it, step it; and reset the whole simulation."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from billing_sim.api.deps import get_conn
from billing_sim.engine import clock
from billing_sim.store.db import wipe

router = APIRouter(prefix="/sim", tags=["sim"])


class SetDay(BaseModel):
    day: int


class Step(BaseModel):
    n: int


@router.get("/clock")
async def get_clock(conn: sqlite3.Connection = Depends(get_conn)):
    return clock.state(conn)


@router.put("/clock")
async def put_clock(body: SetDay, conn: sqlite3.Connection = Depends(get_conn)):
    clock.set_day(conn, body.day)
    return clock.state(conn)


@router.post("/step")
async def post_step(body: Step, conn: sqlite3.Connection = Depends(get_conn)):
    clock.step(conn, body.n)
    return clock.state(conn)


@router.post("/reset")
async def post_reset(conn: sqlite3.Connection = Depends(get_conn)):
    wipe(conn)
    return {"status": "reset"}
