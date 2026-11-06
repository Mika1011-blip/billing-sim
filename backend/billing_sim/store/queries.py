"""State of the engagement as of a day D: the only reads the client side (UI and agent) may use.

Every function takes the connection and the day, returns JSON-serialisable dicts with French keys and
French statuses, and never returns a row, an event or a payment dated after D. Nothing is stored for
these values: status, actual days, delivery, paid and overdue are all derived from rows with `day <= D`.
The caller supplies the day (the HTTP routes and MCP tools read it from the clock).

A lot's tickets are the ones priced with it (`charged_separately` is false); a ticket attached to a lot
but charged separately appears under `list_tickets(lot_key=...)` yet counts for neither the lot's price,
progress nor delivery, exactly as in the lot's invoice.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date

from billing_sim.expander.calendar import date_for_day
from billing_sim.store.db import NotFound, contract_data, start_date

TODO, DOING, BLOCKED, REVIEW, DONE = "À faire", "En cours", "Bloqué", "En revue", "Terminé"

_WEEKDAYS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
_MONTHS = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)  # fmt: skip
_PROFILES = {"dev": "Développeur", "senior": "Développeur senior", "architect": "Architecte"}
_EVENT_LABELS = {
    "transition": "Changement de statut",
    "worklog": "Temps passé",
    "comment": "Commentaire",
    "blocked": "Blocage",
    "unblocked": "Déblocage",
    "review_requested": "Revue demandée",
    "review_changes": "Modifications demandées",
    "review_approved": "Revue validée",
}


def _eur(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " €"


def _hours(hours: float) -> str:
    return f"{hours:.1f}".replace(".", ",") + " h"


def _flatten(event_type: str, payload: dict) -> str:
    if event_type == "transition":
        return f"{payload['from']} → {payload['to']}"
    if event_type == "worklog":
        return f"{_hours(payload['hours'])} : {payload['note']}"
    if event_type == "blocked":
        return payload["reason"]
    if event_type == "unblocked":
        return "Le blocage est levé."
    return payload["text"]


class _Ctx:
    """What every as-of query needs: the day, the calendar, the contract and each ticket's derived state."""

    def __init__(self, conn: sqlite3.Connection, day: int):
        self.conn = conn
        self.day = day
        self.start = start_date(conn)
        self.contract = contract_data(conn)
        self.hours_per_day = self.contract["hours_per_day"]
        self.state = self._ticket_states()

    def iso(self, day: int | None) -> str | None:
        return None if day is None else date_for_day(self.start, day).isoformat()

    def _ticket_states(self) -> dict[int, dict]:
        state: dict[int, dict] = defaultdict(lambda: {"statut": TODO, "debut": None, "fin": None, "heures": 0.0})
        rows = self.conn.execute(
            "SELECT ticket_id, day, type, payload FROM ticket_event"
            " WHERE day <= ? AND type IN ('transition', 'worklog') ORDER BY day, seq",
            (self.day,),
        )
        for row in rows:
            payload = json.loads(row["payload"])
            s = state[row["ticket_id"]]
            if row["type"] == "worklog":
                s["heures"] += payload["hours"]
                continue
            s["statut"] = payload["to"]
            if payload["to"] == DOING and s["debut"] is None:
                s["debut"] = row["day"]
            if payload["to"] == DONE and s["fin"] is None:
                s["fin"] = row["day"]
        return state

    def tickets(self, where: str = "", params: tuple = ()) -> list[dict]:
        rows = self.conn.execute(
            "SELECT t.*, l.key AS lot_key, m.name AS assignee FROM ticket t"
            " LEFT JOIN lot l ON l.id = t.lot_id JOIN team_member m ON m.id = t.assignee_id "
            + where
            + " ORDER BY t.position",
            params,
        )
        out = []
        for r in rows:
            s = self.state[r["id"]]
            out.append(
                {
                    "cle": r["key"],
                    "titre": r["title"],
                    "description": r["description"],
                    "lot": r["lot_key"],
                    "facture_separement": bool(r["charged_separately"]),
                    "taille": r["size"],
                    "jours_factures": r["days_charged"],
                    "tjm": self.contract["tjm"][r["profile"]],
                    "montant": r["fee"],
                    "statut": s["statut"],
                    "assigne": r["assignee"],
                    "debut_reel": self.iso(s["debut"]),
                    "fin_reel": self.iso(s["fin"]),
                    "jours_reels": round(s["heures"] / self.hours_per_day, 2),
                    "_id": r["id"],
                    "_fin": s["fin"],
                }
            )
        return out

    def invoices(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT i.*, l.key AS lot_key,"
            " COALESCE((SELECT SUM(p.amount) FROM payment p WHERE p.invoice_id = i.id AND p.day <= ?), 0) AS paid"
            " FROM invoice i LEFT JOIN lot l ON l.id = i.lot_id WHERE i.issued_day <= ? ORDER BY i.number",
            (self.day, self.day),
        )
        out = []
        for r in rows:
            paid, rest = r["paid"], r["amount_ttc"] - r["paid"]
            overdue = rest > 0 and self.day > r["due_day"]
            if overdue:
                status = "En retard"
            elif rest == 0:
                status = "Payée"
            elif paid > 0:
                status = "Payée partiellement"
            else:
                status = "Émise"
            out.append(
                {
                    "numero": r["number"],
                    "lot": r["lot_key"],
                    "couvre": json.loads(r["covers"]),
                    "emise_le": self.iso(r["issued_day"]),
                    "echeance": self.iso(r["due_day"]),
                    "montant_ht": r["amount_ht"],
                    "tva": r["vat"],
                    "montant_ttc": r["amount_ttc"],
                    "paye": paid,
                    "reste": rest,
                    "statut": status,
                    "en_retard": overdue,
                }
            )
        return out

    def lots(self) -> list[dict]:
        invoices = {i["lot"]: i for i in self.invoices() if i["lot"] is not None}
        approved = {
            r["key"]: r["day"]
            for r in self.conn.execute(
                "SELECT l.key, MIN(a.day) AS day FROM approval a JOIN lot l ON l.id = a.lot_id"
                " WHERE a.day <= ? GROUP BY l.key",
                (self.day,),
            )
        }
        tickets = self.tickets("WHERE t.charged_separately = 0 AND t.lot_id IS NOT NULL")
        out = []
        for lot in self.conn.execute("SELECT * FROM lot ORDER BY id"):
            own = [t for t in tickets if t["lot"] == lot["key"]]
            done = [t for t in own if t["_fin"] is not None]
            delivered = max(t["_fin"] for t in done) if own and len(done) == len(own) else None
            invoice = invoices.get(lot["key"])
            out.append(
                {
                    "cle": lot["key"],
                    "nom": lot["name"],
                    "description": lot["description"],
                    "prix": lot["price"],
                    "livraison_prevue": self.iso(lot["planned_delivery_day"]),
                    "livre_le": self.iso(delivered),
                    "tickets_termines": len(done),
                    "tickets_total": len(own),
                    "jours_factures": sum(t["jours_factures"] for t in own),
                    "jours_reels": round(sum(self.state[t["_id"]]["heures"] for t in own) / self.hours_per_day, 2),
                    "approuve_le": self.iso(approved.get(lot["key"])),
                    "statut_facture": invoice["statut"] if invoice else "À venir",
                    "facture": invoice["numero"] if invoice else None,
                }
            )
        return out


def _public(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]


def today(conn: sqlite3.Connection, day: int) -> dict:
    d: date = date_for_day(start_date(conn), day)
    return {
        "jour": day,
        "date": d.isoformat(),
        "date_longue": f"{_WEEKDAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]} {d.year}",
    }


def get_contract(conn: sqlite3.Connection) -> dict:
    contract = contract_data(conn)
    contract["explication"] = {
        profile: f"{_PROFILES.get(profile, profile.capitalize())} : {_eur(rate)} par jour"
        for profile, rate in contract["tjm"].items()
    }
    return contract


def summary(conn: sqlite3.Connection, day: int) -> dict:
    ctx = _Ctx(conn, day)
    invoices = ctx.invoices()
    invoiced = sum(i["montant_ttc"] for i in invoices)
    paid = sum(i["paye"] for i in invoices)
    return {
        "contracte": conn.execute("SELECT COALESCE(SUM(fee), 0) FROM ticket").fetchone()[0],  # HT
        "facture": invoiced,  # TTC, like payments and balances
        "paye": paid,
        "reste_a_payer": invoiced - paid,
        "en_retard": sum(i["reste"] for i in invoices if i["en_retard"]),
        "lots": ctx.lots(),
    }


def list_lots(conn: sqlite3.Connection, day: int) -> list[dict]:
    return _Ctx(conn, day).lots()


def get_lot(conn: sqlite3.Connection, day: int, key: str) -> dict:
    for lot in _Ctx(conn, day).lots():
        if lot["cle"] == key:
            return lot
    raise NotFound(f"lot introuvable : {key}")


def list_tickets(conn: sqlite3.Connection, day: int, lot_key: str | None = None, status: str | None = None) -> list[dict]:
    tickets = _Ctx(conn, day).tickets()
    if lot_key is not None:
        tickets = [t for t in tickets if t["lot"] == lot_key]
    if status is not None:
        tickets = [t for t in tickets if t["statut"] == status]
    return _public(tickets)


def get_ticket(conn: sqlite3.Connection, day: int, key: str) -> dict:
    found = _Ctx(conn, day).tickets("WHERE t.key = ?", (key,))
    if not found:
        raise NotFound(f"ticket introuvable : {key}")
    return _public(found)[0]


def ticket_history(conn: sqlite3.Connection, day: int, key: str) -> list[dict]:
    start = start_date(conn)
    if conn.execute("SELECT 1 FROM ticket WHERE key = ?", (key,)).fetchone() is None:
        raise NotFound(f"ticket introuvable : {key}")
    rows = conn.execute(
        "SELECT e.day, e.type, e.payload, m.name AS actor FROM ticket_event e"
        " JOIN ticket t ON t.id = e.ticket_id JOIN team_member m ON m.id = e.actor_id"
        " WHERE t.key = ? AND e.day <= ? ORDER BY e.day, e.seq",
        (key, day),
    )
    return [
        {
            "date": date_for_day(start, r["day"]).isoformat(),
            "type": _EVENT_LABELS[r["type"]],
            "acteur": r["actor"],
            "contenu": _flatten(r["type"], json.loads(r["payload"])),
        }
        for r in rows
    ]


def list_invoices(conn: sqlite3.Connection, day: int) -> list[dict]:
    return _Ctx(conn, day).invoices()


def get_invoice(conn: sqlite3.Connection, day: int, number: str) -> dict:
    for invoice in _Ctx(conn, day).invoices():
        if invoice["numero"] == number:
            return invoice
    raise NotFound(f"facture introuvable : {number}")


def list_payments(conn: sqlite3.Connection, day: int, invoice_number: str | None = None) -> list[dict]:
    start = start_date(conn)
    sql = (
        "SELECT p.day, p.amount, p.reference, i.number FROM payment p JOIN invoice i ON i.id = p.invoice_id"
        " WHERE p.day <= ?"
    )
    params: list = [day]
    if invoice_number is not None:
        sql += " AND i.number = ?"
        params.append(invoice_number)
    rows = conn.execute(sql + " ORDER BY p.day, p.id", params)
    return [
        {
            "date": date_for_day(start, r["day"]).isoformat(),
            "montant": r["amount"],
            "reference": r["reference"],
            "facture": r["number"],
        }
        for r in rows
    ]


def pending_approvals(conn: sqlite3.Connection, day: int) -> list[dict]:
    """Lots delivered (every ticket Terminé) as of `day` with no approval dated on or before it."""
    return [
        {"cle": lot["cle"], "nom": lot["nom"], "prix": lot["prix"], "livre_le": lot["livre_le"]}
        for lot in _Ctx(conn, day).lots()
        if lot["livre_le"] is not None and lot["approuve_le"] is None
    ]


def explain_price(conn: sqlite3.Connection, day: int, key: str) -> dict:
    """Size -> days x TJM = amount for a ticket; one line per ticket and the total for a lot."""
    ctx = _Ctx(conn, day)
    invoices = ctx.invoices()

    def invoice_for(ticket_keys: list[str]) -> str | None:
        return next((i["numero"] for i in invoices if set(ticket_keys) <= set(i["couvre"])), None)

    def line(t: dict) -> dict:
        return {
            "cle": t["cle"],
            "titre": t["titre"],
            "taille": t["taille"],
            "jours": t["jours_factures"],
            "tjm": t["tjm"],
            "montant": t["montant"],
            "calcul": f"taille {t['taille']} = {t['jours_factures']} j × {_eur(t['tjm'])} = {_eur(t['montant'])}",
        }

    lot = conn.execute("SELECT id, key, name FROM lot WHERE key = ?", (key,)).fetchone()
    if lot is not None:
        lines = [
            line(t)
            for t in ctx.tickets("WHERE t.lot_id = ? AND t.charged_separately = 0", (lot["id"],))
        ]
        total = sum(entry["montant"] for entry in lines)
        invoice = next((i["numero"] for i in invoices if i["lot"] == key), None)
        return {"type": "lot", "cle": key, "nom": lot["name"], "lignes": lines, "total": total, "facture": invoice}

    found = ctx.tickets("WHERE t.key = ?", (key,))
    if not found:
        raise NotFound(f"ticket ou lot introuvable : {key}")
    t = found[0]
    return {
        "type": "ticket",
        **line(t),
        "lot": t["lot"],
        "facture_separement": t["facture_separement"],
        "facture": invoice_for([key]),
    }
