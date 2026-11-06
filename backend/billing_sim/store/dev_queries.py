"""Full, unfiltered reads for the dev side (English keys, day indices, the future included).

These are never exposed to the client agent: no `as of` boundary applies. Days are working-day
indices; `start_date` in the plan gives the calendar mapping.
"""

from __future__ import annotations

import json
import sqlite3

from billing_sim.expander.calendar import date_for_day
from billing_sim.store.db import NotFound, contract_data, start_date

_TICKET_SQL = (
    "SELECT t.*, l.key AS lot_key, m.name AS assignee, s.number AS sprint_number FROM ticket t"
    " LEFT JOIN lot l ON l.id = t.lot_id JOIN team_member m ON m.id = t.assignee_id"
    " JOIN sprint s ON s.id = t.sprint_id "
)


def _depends_on(conn: sqlite3.Connection) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    rows = conn.execute(
        "SELECT d.ticket_id, t.key FROM ticket_dependency d JOIN ticket t ON t.id = d.depends_on_id"
        " ORDER BY d.ticket_id, t.position"
    )
    for r in rows:
        out.setdefault(r["ticket_id"], []).append(r["key"])
    return out


def _actual_days(conn: sqlite3.Connection, hours_per_day: int) -> dict[int, float]:
    hours: dict[int, float] = {}
    for r in conn.execute("SELECT ticket_id, payload FROM ticket_event WHERE type = 'worklog'"):
        hours[r["ticket_id"]] = hours.get(r["ticket_id"], 0.0) + json.loads(r["payload"])["hours"]
    return {ticket_id: round(h / hours_per_day, 2) for ticket_id, h in hours.items()}


def _ticket_plan(row: sqlite3.Row, tjm: dict[str, int], depends_on: list[str]) -> dict:
    return {
        "key": row["key"],
        "title": row["title"],
        "description": row["description"],
        "lot": row["lot_key"],
        "charged_separately": bool(row["charged_separately"]),
        "size": row["size"],
        "profile": row["profile"],
        "days_charged": row["days_charged"],
        "tjm": tjm[row["profile"]],
        "fee": row["fee"],
        "assignee": row["assignee"],
        "sprint": row["sprint_number"],
        "planned_start": row["planned_start_day"],
        "planned_end": row["planned_end_day"],
        "depends_on": depends_on,
        "beats": json.loads(row["beats"]),
    }


def full_plan(conn: sqlite3.Connection) -> dict:
    scenario = conn.execute("SELECT * FROM scenario").fetchone()
    if scenario is None:
        raise NotFound("no scenario loaded")
    contract = contract_data(conn)
    deps = _depends_on(conn)
    return {
        "scenario": {
            "request_text": scenario["request_text"],
            "product_summary": scenario["product_summary"],
            "seed": scenario["seed"],
            "start_date": scenario["start_date"],
            "signed_day": scenario["signed_day"],
            "last_day": scenario["last_day"],
            "warnings": json.loads(scenario["warnings"]),
            "client_behaviour": json.loads(scenario["client_behaviour"]),
        },
        "contract": contract,
        "team": [dict(r) for r in conn.execute("SELECT name, profile FROM team_member ORDER BY id")],
        "sprints": [dict(r) for r in conn.execute("SELECT number, start_day, end_day FROM sprint ORDER BY number")],
        "lots": [
            {
                "key": r["key"],
                "name": r["name"],
                "description": r["description"],
                "price": r["price"],
                "planned_delivery_day": r["planned_delivery_day"],
            }
            for r in conn.execute("SELECT * FROM lot ORDER BY id")
        ],
        "tickets": [
            _ticket_plan(r, contract["tjm"], deps.get(r["id"], []))
            for r in conn.execute(_TICKET_SQL + "ORDER BY t.position")
        ],
    }


def _events(conn: sqlite3.Connection, where: str = "", params: tuple = ()) -> list[dict]:
    start = start_date(conn)
    rows = conn.execute(
        "SELECT e.day, e.seq, e.type, e.payload, t.key AS ticket, m.name AS actor FROM ticket_event e"
        " JOIN ticket t ON t.id = e.ticket_id JOIN team_member m ON m.id = e.actor_id "
        + where
        + " ORDER BY e.day, e.seq",
        params,
    )
    return [
        {
            "ticket": r["ticket"],
            "day": r["day"],
            "date": date_for_day(start, r["day"]).isoformat(),
            "seq": r["seq"],
            "type": r["type"],
            "actor": r["actor"],
            "payload": json.loads(r["payload"]),
        }
        for r in rows
    ]


def _between(column: str, from_day: int | None, to_day: int | None) -> tuple[str, tuple]:
    clauses, params = [], []
    if from_day is not None:
        clauses.append(f"{column} >= ?")
        params.append(from_day)
    if to_day is not None:
        clauses.append(f"{column} <= ?")
        params.append(to_day)
    return ("WHERE " + " AND ".join(clauses) if clauses else ""), tuple(params)


def full_timeline(conn: sqlite3.Connection, from_day: int | None = None, to_day: int | None = None) -> dict:
    """Events by day, invoices by issue day, payments and approvals by day; bounds inclusive, both optional."""
    where, params = _between("e.day", from_day, to_day)
    inv_where, inv_params = _between("i.issued_day", from_day, to_day)
    pay_where, pay_params = _between("p.day", from_day, to_day)
    app_where, app_params = _between("a.day", from_day, to_day)
    return {
        "events": _events(conn, where, params),
        "invoices": [
            {
                "number": r["number"],
                "lot": r["lot_key"],
                "ticket": r["ticket_key"],
                "issued_day": r["issued_day"],
                "due_day": r["due_day"],
                "amount_ht": r["amount_ht"],
                "vat": r["vat"],
                "amount_ttc": r["amount_ttc"],
                "covers": json.loads(r["covers"]),
            }
            for r in conn.execute(
                "SELECT i.*, l.key AS lot_key, t.key AS ticket_key FROM invoice i"
                " LEFT JOIN lot l ON l.id = i.lot_id LEFT JOIN ticket t ON t.id = i.ticket_id "
                + inv_where
                + " ORDER BY i.issued_day, i.number",
                inv_params,
            )
        ],
        "payments": [
            {"invoice": r["number"], "day": r["day"], "amount": r["amount"], "reference": r["reference"]}
            for r in conn.execute(
                "SELECT p.*, i.number FROM payment p JOIN invoice i ON i.id = p.invoice_id "
                + pay_where
                + " ORDER BY p.day, p.id",
                pay_params,
            )
        ],
        "approvals": [
            {"lot": r["key"], "day": r["day"], "approved_by": r["approved_by"]}
            for r in conn.execute(
                "SELECT a.*, l.key FROM approval a JOIN lot l ON l.id = a.lot_id " + app_where + " ORDER BY a.day, a.id",
                app_params,
            )
        ],
    }


def ticket_full(conn: sqlite3.Connection, key: str) -> dict:
    """Plan and pricing, beats, planned vs real schedule, every event (future included) and the invoice."""
    row = conn.execute(_TICKET_SQL + "WHERE t.key = ?", (key,)).fetchone()
    if row is None:
        raise NotFound(f"ticket not found: {key}")
    contract = contract_data(conn)
    plan = _ticket_plan(row, contract["tjm"], _depends_on(conn).get(row["id"], []))
    invoice = conn.execute("SELECT number, covers FROM invoice ORDER BY number")
    covering = next((r["number"] for r in invoice if key in json.loads(r["covers"])), None)
    return {
        **plan,
        "real_start": row["real_start_day"],
        "real_end": row["real_end_day"],
        "slip_days": row["real_end_day"] - row["planned_end_day"],
        "actual_days": _actual_days(conn, contract["hours_per_day"]).get(row["id"], 0.0),
        "invoice": covering,
        "events": _events(conn, "WHERE t.key = ?", (key,)),
    }


def diff_plan_vs_real(conn: sqlite3.Connection) -> dict:
    """Planned vs real schedule and days charged vs actual days, per ticket and per lot (priced tickets only)."""
    actual = _actual_days(conn, contract_data(conn)["hours_per_day"])
    tickets = [
        {
            "key": r["key"],
            "lot": r["lot_key"],
            "planned_start": r["planned_start_day"],
            "planned_end": r["planned_end_day"],
            "real_start": r["real_start_day"],
            "real_end": r["real_end_day"],
            "slip_days": r["real_end_day"] - r["planned_end_day"],
            "days_charged": r["days_charged"],
            "actual_days": actual.get(r["id"], 0.0),
            "_priced_with_lot": r["lot_key"] is not None and not r["charged_separately"],
        }
        for r in conn.execute(_TICKET_SQL + "ORDER BY t.position")
    ]
    lots = []
    for lot in conn.execute("SELECT key, planned_delivery_day FROM lot ORDER BY id"):
        own = [t for t in tickets if t["lot"] == lot["key"] and t["_priced_with_lot"]]
        real_delivery = max((t["real_end"] for t in own), default=None)
        lots.append(
            {
                "key": lot["key"],
                "planned_delivery_day": lot["planned_delivery_day"],
                "real_delivery_day": real_delivery,
                "slip_days": None if real_delivery is None else real_delivery - lot["planned_delivery_day"],
                "days_charged": sum(t["days_charged"] for t in own),
                "actual_days": round(sum(t["actual_days"] for t in own), 2),
            }
        )
    for t in tickets:
        del t["_priced_with_lot"]
    return {"tickets": tickets, "lots": lots}
