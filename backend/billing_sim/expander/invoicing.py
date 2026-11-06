"""Invoices, purchasing approvals and client payments, all derived from the real schedule."""

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
REMAINDER_DELAY_DAYS = 15


def _invoiced_on_its_own(ticket: TicketPlan) -> bool:
    """Charged separately, or attached to no lot at all (nothing else could carry its fee)."""
    return ticket.charged_separately or ticket.lot_key is None


def _issue_day(contract: Contract, sprints: list[Sprint], earliest: int) -> int:
    if contract.invoice_timing == "sprint_end":
        return next((s.end_day for s in sprints if s.end_day >= earliest), earliest)
    return earliest


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

    lot_position = {lot.key: i for i, lot in enumerate(plan.lots, start=1)}
    behaviour = {b.invoice_index: b for b in plan.client_behaviour}
    approvals = [Approval(i.lot_key, i.issued_day, APPROVER) for i in invoices if i.lot_key is not None]
    payments: list[Payment] = []
    for invoice in invoices:
        if invoice.lot_key is None:
            payments.append(Payment(invoice.number, invoice.due_day, invoice.amount_ttc, f"VIR-{invoice.number}-1"))
        else:
            b = behaviour[lot_position[invoice.lot_key]]
            payments.extend(_lot_payments(invoice, b.pays_fraction, b.days_late))
    return invoices, approvals, payments


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


def _lot_payments(invoice: Invoice, fraction: float, days_late: int) -> list[Payment]:
    """First instalment `fraction` of the total on the late due day, the rest 15 working days later.

    Zero-amount rows are never emitted: a fraction of 0 gives only the remainder (as reference -1)
    and a fraction that rounds to the full amount gives only the first row.
    """
    first_day = invoice.due_day + days_late
    first = round(fraction * invoice.amount_ttc)
    remainder = invoice.amount_ttc - first
    rows: list[Payment] = []
    if first > 0:
        rows.append(Payment(invoice.number, first_day, first, f"VIR-{invoice.number}-1"))
    if remainder > 0:
        day = first_day + REMAINDER_DELAY_DAYS
        rows.append(Payment(invoice.number, day, remainder, f"VIR-{invoice.number}-{len(rows) + 1}"))
    return rows
