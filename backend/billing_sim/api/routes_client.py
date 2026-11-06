"""`/client/*`: the same past-only reads as the client MCP server. No route takes a day; all read the clock."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from billing_sim.api.deps import get_conn
from billing_sim.engine.clock import get_day
from billing_sim.store import queries
from billing_sim.store.db import NotFound

router = APIRouter(prefix="/client", tags=["client"])


def _lookup(conn: sqlite3.Connection, query, key: str, *args):
    try:
        return query(conn, get_day(conn), key, *args)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=f"Enregistrement introuvable : {key}") from exc


@router.get("/today")
def today(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.today(conn, get_day(conn))


@router.get("/contract")
def contract(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.get_contract(conn)


@router.get("/summary")
def summary(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.summary(conn, get_day(conn))


@router.get("/lots")
def lots(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_lots(conn, get_day(conn))


@router.get("/lots/{key}")
def lot(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_lot, key)


@router.get("/tickets")
def tickets(lot: str | None = None, status: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_tickets(conn, get_day(conn), lot_key=lot, status=status)


@router.get("/tickets/{key}")
def ticket(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_ticket, key)


@router.get("/tickets/{key}/history")
def ticket_history(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.ticket_history, key)


@router.get("/invoices")
def invoices(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_invoices(conn, get_day(conn))


@router.get("/invoices/{number}")
def invoice(number: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.get_invoice, number)


@router.get("/payments")
def payments(invoice: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    return queries.list_payments(conn, get_day(conn), invoice_number=invoice)


@router.get("/approvals/pending")
def pending_approvals(conn: sqlite3.Connection = Depends(get_conn)):
    return queries.pending_approvals(conn, get_day(conn))


@router.get("/explain/{key}")
def explain_price(key: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _lookup(conn, queries.explain_price, key)
