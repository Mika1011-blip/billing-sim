"""Invoices and purchasing approvals, derived from the real schedule.

Nobody pays by script: payments are recorded by the participant at runtime.
"""

from __future__ import annotations

from datetime import date

from billing_sim.billing.policy import Contract, due_day, invoice_total, lot_price
from billing_sim.expander.models import (
    Approval,
    Invoice,
    Payment,
    ScheduledTicket,
    Sprint,
)
from billing_sim.scenario.schema import ScenarioPlan, TicketPlan

APPROVER = "Direction des achats"


def _invoiced_on_its_own(ticket: TicketPlan) -> bool:
    """Charged separately, or attached to no lot at all (nothing else could carry its fee)."""
    return ticket.charged_separately or ticket.lot_key is None


def _issue_day(contract: Contract, sprints: list[Sprint], earliest: int) -> int:
    """`on_delivery`: right away. `sprint_end`: the last day of the first sprint ending on/after `earliest`.

    `sprints` may stop short of `earliest`; the sprint grid is then continued arithmetically
    (the caller extends the list to cover the result).
    """
    if contract.invoice_timing != "sprint_end":
        return earliest
    last = sprints[-1]
    if earliest > last.end_day:
        length = last.end_day - last.start_day + 1
        return last.end_day + -(-(earliest - last.end_day) // length) * length
    return next(s.end_day for s in sprints if s.end_day >= earliest)


def build_invoices(
    plan: ScenarioPlan,
    contract: Contract,
    tickets: list[ScheduledTicket],
    sprints: list[Sprint],
    start_date: date,
) -> tuple[list[Invoice], list[Approval], list[Payment]]:
    scheduled = {t.key: t for t in tickets}
    # Sort key fixes numbering: issued day, then lot invoices before ticket invoices,
    # then lot position / ticket key.
    drafts: list[tuple[tuple[int, int, int, str], Invoice]] = []

    for position, lot in enumerate(plan.lots, start=1):
        lot_tickets = [t for t in plan.tickets if t.lot_key == lot.key]
        covered = [t for t in lot_tickets if not _invoiced_on_its_own(t)]
        if not covered:
            continue
        earliest = max(scheduled[t.key].real_end for t in covered) + 1
        issued = _issue_day(contract, sprints, earliest)
        amount_ht = lot_price(contract, [(t.size, t.profile, _invoiced_on_its_own(t)) for t in lot_tickets])
        invoice = _invoice(contract, lot.key, None, issued, amount_ht, [t.key for t in covered])
        drafts.append(((issued, 0, position, ""), invoice))

    for ticket in plan.tickets:
        if _invoiced_on_its_own(ticket):
            done = scheduled[ticket.key]
            invoice = _invoice(contract, None, ticket.key, done.real_end, done.fee, [ticket.key])
            drafts.append(((done.real_end, 1, 0, ticket.key), invoice))

    drafts.sort(key=lambda d: d[0])
    invoices: list[Invoice] = []
    for n, (_, invoice) in enumerate(drafts, start=1):
        invoice.number = f"F-{start_date.year}-{n:03d}"
        invoices.append(invoice)

    approvals = [Approval(i.lot_key, i.issued_day, APPROVER) for i in invoices if i.lot_key is not None]
    return invoices, approvals, []


def _invoice(
    contract: Contract,
    lot_key: str | None,
    ticket_key: str | None,
    issued: int,
    amount_ht: int,
    covers: list[str],
) -> Invoice:
    vat, ttc = invoice_total(contract, amount_ht)
    return Invoice("", lot_key, ticket_key, issued, due_day(contract, issued), amount_ht, vat, ttc, covers)
