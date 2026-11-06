"""`/client/*`: the same past-only reads as the client MCP server. No route takes a day; all read the clock."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from billing_sim.api.deps import get_conn
from billing_sim.engine.clock import get_day
from billing_sim.engine.payments import AlreadyPaid, pay_invoice
from billing_sim.store import queries
from billing_sim.store.db import NotFound

router = APIRouter(prefix="/client", tags=["client"])


def _lookup(conn: sqlite3.Connection, query, key: str, *args):
    try:
        return query(conn, get_day(conn), key, *args)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=f"Enregistrement introuvable : {key}") from exc


@router.get("/today")
async def today(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.today(conn, get_day(conn))


@router.get("/contract")
async def contract(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.get_contract(conn)


@router.get("/summary")
async def summary(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.summary(conn, get_day(conn))


@router.get("/lots")
async def lots(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_lots(conn, get_day(conn))


@router.get("/lots/{key}")
async def lot(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_lot, key)


@router.get("/tickets")
async def tickets(lot: str | None = None, status: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_tickets(conn, get_day(conn), lot_key=lot, status=status)


@router.get("/tickets/{key}")
async def ticket(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_ticket, key)


@router.get("/tickets/{key}/history")
async def ticket_history(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.ticket_history, key)


@router.get("/invoices")
async def invoices(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_invoices(conn, get_day(conn))


@router.get("/invoices/{number}")
async def invoice(number: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_invoice, number)


@router.post("/invoices/{number}/payer")
async def pay(number: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return pay_invoice(conn, number)
    except AlreadyPaid as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/payments")
async def payments(invoice: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_payments(conn, get_day(conn), invoice_number=invoice)


@router.get("/approvals/pending")
async def pending_approvals(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.pending_approvals(conn, get_day(conn))


@router.get("/explain/{key}")
async def explain_price(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.explain_price, key)
