"""Participant payments: the only writes a run makes to the timeline. Always in full, at the clock's day."""

from __future__ import annotations

import sqlite3

from billing_sim.engine.clock import get_day
from billing_sim.expander.calendar import date_for_day
from billing_sim.store.db import NotFound, start_date


class AlreadyPaid(Exception):
    """The invoice already has a payment as of today; `str()` is the message the API returns."""


def pay_invoice(conn: sqlite3.Connection, number: str) -> dict:
    """Pay invoice `number` in full today; returns `{facture, date, reference, montant}`."""
    today = get_day(conn)
    start = start_date(conn)
    with conn:
        invoice = conn.execute(
            "SELECT id, amount_ttc FROM invoice WHERE number = ? AND issued_day <= ?", (number, today)
        ).fetchone()
        if invoice is None:
            raise NotFound(f"Enregistrement introuvable : {number}")
        earlier = conn.execute(
            "SELECT MIN(day) FROM payment WHERE invoice_id = ? AND day <= ?", (invoice["id"], today)
        ).fetchone()[0]
        if earlier is not None:
            raise AlreadyPaid(f"Facture déjà payée le {date_for_day(start, earlier).isoformat()}")
        # The participant moved the clock back and is rewriting their own future action.
        conn.execute("DELETE FROM payment WHERE invoice_id = ? AND day > ?", (invoice["id"], today))
        reference = f"VIR-{number}-1"
        conn.execute(
            "INSERT INTO payment (invoice_id, day, amount, reference) VALUES (?, ?, ?, ?)",
            (invoice["id"], today, invoice["amount_ttc"], reference),
        )
    return {
        "facture": number,
        "date": date_for_day(start, today).isoformat(),
        "reference": reference,
        "montant": invoice["amount_ttc"],
    }
