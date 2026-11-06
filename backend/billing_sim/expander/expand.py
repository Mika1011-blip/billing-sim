"""Expander entry point: ScenarioPlan + seed -> deterministic day-by-day Timeline.

All randomness comes from ONE `random.Random(seed)` created in `expand()` and passed down. Draw
order (changing it silently reshuffles every seeded timeline):
  1. `real_schedule`: one `lognormvariate(0, 0.25)` per ticket, in topological order;
  2. `ticket_events`, per ticket in topological order (see the `events` module docstring).
Planning, invoicing, approvals and payments draw nothing.

A warning is emitted for every ticket whose assignee's profile differs from the ticket's, which
only happens when the team has nobody of the wanted profile.
"""

from __future__ import annotations

import random
from datetime import date

from billing_sim.billing.policy import Contract, days_for_size, ticket_fee
from billing_sim.expander.events import ticket_events
from billing_sim.expander.invoicing import build_invoices
from billing_sim.expander.models import (  # noqa: F401  (public import path for the records)
    Approval,
    Event,
    Invoice,
    Payment,
    ScheduledTicket,
    Sprint,
    Timeline,
)
from billing_sim.expander.schedule import plan_schedule, real_schedule, topo_order
from billing_sim.scenario.schema import ScenarioPlan
from billing_sim.scenario.validate import validate_plan

SPRINT_DAYS = 10
TAIL_DAYS = 15


def expand(plan: ScenarioPlan, contract: Contract, seed: int, start_date: date) -> Timeline:
    errors = validate_plan(plan)
    if errors:
        raise ValueError(errors)

    rng = random.Random(seed)
    order = topo_order(plan)
    planned = plan_schedule(plan, contract, order)
    real = real_schedule(plan, contract, order, rng)
    profile_of = {m.name: m.profile for m in plan.team}

    tickets: list[ScheduledTicket] = []
    warnings: list[str] = []
    for ticket in plan.tickets:
        assignee, real_start, real_end = real[ticket.key]
        _, planned_start, planned_end = planned[ticket.key]
        tickets.append(
            ScheduledTicket(
                key=ticket.key,
                assignee=assignee,
                sprint_number=planned_start // SPRINT_DAYS + 1,
                planned_start=planned_start,
                planned_end=planned_end,
                real_start=real_start,
                real_end=real_end,
                days_charged=days_for_size(contract, ticket.size),
                fee=ticket_fee(contract, ticket.size, ticket.profile),
            )
        )
        if profile_of[assignee] != ticket.profile:
            warnings.append(
                f"{ticket.key}: no {ticket.profile} available, assigned to {assignee} ({profile_of[assignee]})"
            )

    last_work_day = max(max(t.planned_end, t.real_end) for t in tickets)
    sprints = [
        Sprint(n, (n - 1) * SPRINT_DAYS, n * SPRINT_DAYS - 1) for n in range(1, last_work_day // SPRINT_DAYS + 2)
    ]

    scheduled = {t.key: t for t in tickets}
    streams: list[Event] = []
    for ticket in order:
        streams.extend(ticket_events(ticket, scheduled[ticket.key], contract, plan.team, rng))
    events = _merge_streams(streams)

    invoices, approvals, payments = build_invoices(plan, contract, tickets, sprints, start_date)

    last_day = max([e.day for e in events] + [i.due_day for i in invoices] + [p.day for p in payments]) + TAIL_DAYS
    return Timeline(sprints, tickets, events, invoices, payments, approvals, last_day, warnings)


def _merge_streams(events: list[Event]) -> list[Event]:
    """Order by day (stable: topological ticket order, then each ticket's own order); `seq` unique per day."""
    ordered = sorted(events, key=lambda e: e.day)
    next_seq: dict[int, int] = {}
    for event in ordered:
        event.seq = next_seq.get(event.day, 0)
        next_seq[event.day] = event.seq + 1
    return ordered
