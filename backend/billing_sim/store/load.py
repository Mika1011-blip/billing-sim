"""Write a scenario (plan + contract + expanded timeline) into the store."""

from __future__ import annotations

import json
import sqlite3
from datetime import date

from billing_sim.billing.policy import Contract, lot_price
from billing_sim.expander.models import Timeline
from billing_sim.scenario.schema import ScenarioPlan
from billing_sim.store.db import clear_rows


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def load_scenario(
    conn: sqlite3.Connection,
    *,
    plan: ScenarioPlan,
    contract: Contract,
    timeline: Timeline,
    request_text: str,
    seed: int,
    start_date: date,
) -> None:
    """Replace whatever is stored with this scenario and put the clock at day 0 (one transaction)."""
    with conn:
        clear_rows(conn)
        conn.execute(
            "INSERT INTO scenario (id, request_text, product_summary, seed, start_date, signed_day, last_day,"
            " warnings, client_behaviour) VALUES (1, ?, ?, ?, ?, 0, ?, ?, ?)",
            (
                request_text,
                plan.product_summary,
                seed,
                start_date.isoformat(),
                timeline.last_day,
                _json(timeline.warnings),
                _json([b.model_dump() for b in plan.client_behaviour]),
            ),
        )
        conn.execute(
            "INSERT INTO contract (id, data, hours_per_day, payment_terms_days, vat_rate, overrun_rule, currency,"
            " invoice_timing) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
            (
                _json(contract.to_dict()),
                contract.hours_per_day,
                contract.payment_terms_days,
                contract.vat_rate,
                contract.overrun_rule,
                contract.currency,
                contract.invoice_timing,
            ),
        )

        member_id = {}
        for member in plan.team:
            member_id[member.name] = conn.execute(
                "INSERT INTO team_member (name, profile) VALUES (?, ?)", (member.name, member.profile)
            ).lastrowid

        sprint_id = {}
        for sprint in timeline.sprints:
            sprint_id[sprint.number] = conn.execute(
                "INSERT INTO sprint (number, start_day, end_day) VALUES (?, ?, ?)",
                (sprint.number, sprint.start_day, sprint.end_day),
            ).lastrowid

        scheduled = {t.key: t for t in timeline.tickets}
        lot_id = {}
        for lot in plan.lots:
            priced = [t for t in plan.tickets if t.lot_key == lot.key]
            price = lot_price(contract, [(t.size, t.profile, t.charged_separately) for t in priced])
            ends = [scheduled[t.key].planned_end for t in priced if not t.charged_separately]
            lot_id[lot.key] = conn.execute(
                "INSERT INTO lot (key, name, description, price, planned_delivery_day) VALUES (?, ?, ?, ?, ?)",
                (lot.key, lot.name, lot.description, price, max(ends) if ends else None),
            ).lastrowid

        ticket_id = {}
        for position, ticket in enumerate(plan.tickets):
            s = scheduled[ticket.key]
            ticket_id[ticket.key] = conn.execute(
                "INSERT INTO ticket (key, title, description, lot_id, charged_separately, size, profile, days_charged,"
                " fee, assignee_id, sprint_id, planned_start_day, planned_end_day, real_start_day, real_end_day,"
                " beats, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ticket.key,
                    ticket.title,
                    ticket.description,
                    lot_id[ticket.lot_key] if ticket.lot_key is not None else None,
                    int(ticket.charged_separately),
                    ticket.size,
                    ticket.profile,
                    s.days_charged,
                    s.fee,
                    member_id[s.assignee],
                    sprint_id[s.sprint_number],
                    s.planned_start,
                    s.planned_end,
                    s.real_start,
                    s.real_end,
                    _json([b.model_dump() for b in ticket.beats]),
                    position,
                ),
            ).lastrowid
        conn.executemany(
            "INSERT INTO ticket_dependency (ticket_id, depends_on_id) VALUES (?, ?)",
            [(ticket_id[t.key], ticket_id[dep]) for t in plan.tickets for dep in t.depends_on],
        )

        conn.executemany(
            "INSERT INTO ticket_event (ticket_id, day, seq, type, actor_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
            [
                (ticket_id[e.ticket_key], e.day, e.seq, e.type, member_id[e.actor], _json(e.payload))
                for e in timeline.events
            ],
        )

        invoice_id = {}
        for inv in timeline.invoices:
            invoice_id[inv.number] = conn.execute(
                "INSERT INTO invoice (number, lot_id, ticket_id, issued_day, due_day, amount_ht, vat, amount_ttc,"
                " covers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    inv.number,
                    lot_id[inv.lot_key] if inv.lot_key is not None else None,
                    ticket_id[inv.ticket_key] if inv.ticket_key is not None else None,
                    inv.issued_day,
                    inv.due_day,
                    inv.amount_ht,
                    inv.vat,
                    inv.amount_ttc,
                    _json(inv.covers),
                ),
            ).lastrowid
        conn.executemany(
            "INSERT INTO payment (invoice_id, day, amount, reference) VALUES (?, ?, ?, ?)",
            [(invoice_id[p.invoice_number], p.day, p.amount, p.reference) for p in timeline.payments],
        )
        conn.executemany(
            "INSERT INTO approval (lot_id, day, approved_by) VALUES (?, ?, ?)",
            [(lot_id[a.lot_key], a.day, a.approved_by) for a in timeline.approvals],
        )
