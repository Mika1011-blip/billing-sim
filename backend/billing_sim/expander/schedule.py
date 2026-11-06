"""Ticket ordering, assignment and the planned / real schedules (all in working-day indexes)."""

from __future__ import annotations

import heapq
import random

from billing_sim.billing.policy import Contract, days_for_size
from billing_sim.scenario.schema import ScenarioPlan, TeamMember, TicketPlan

# Where to look when the team has nobody of the wanted profile: nearest profile first.
# (dev -> senior -> architect -> senior -> dev, read outwards from the wanted profile.)
_FALLBACK_PROFILES = {
    "dev": ("senior", "architect"),
    "senior": ("dev", "architect"),
    "architect": ("senior", "dev"),
}

Schedule = dict[str, tuple[str, int, int]]  # ticket key -> (assignee, start day, end day)


def topo_order(plan: ScenarioPlan) -> list[TicketPlan]:
    """Dependencies first; among ready tickets, lot order (no lot last), then key."""
    lot_rank = {lot.key: i for i, lot in enumerate(plan.lots)}
    by_key = {t.key: t for t in plan.tickets}

    def rank(t: TicketPlan) -> tuple[int, str]:
        return (lot_rank.get(t.lot_key, len(lot_rank)), t.key)

    remaining = {t.key: len(set(t.depends_on)) for t in plan.tickets}
    dependents: dict[str, list[str]] = {t.key: [] for t in plan.tickets}
    for t in plan.tickets:
        for dep in set(t.depends_on):
            dependents[dep].append(t.key)

    ready = [(rank(t), t.key) for t in plan.tickets if remaining[t.key] == 0]
    heapq.heapify(ready)
    order: list[TicketPlan] = []
    while ready:
        _, key = heapq.heappop(ready)
        order.append(by_key[key])
        for child in dependents[key]:
            remaining[child] -= 1
            if remaining[child] == 0:
                heapq.heappush(ready, (rank(by_key[child]), child))
    if len(order) != len(plan.tickets):
        raise ValueError("dependency cycle: plan must be validated before scheduling")
    return order


def pick_assignee(team: list[TeamMember], profile: str, free: dict[str, int]) -> TeamMember:
    """Member of `profile` with the earliest free day (ties: team order), else the nearest profile."""
    for wanted in (profile, *_FALLBACK_PROFILES[profile]):
        candidates = [m for m in team if m.profile == wanted]
        if candidates:
            return min(candidates, key=lambda m: free[m.name])  # min() keeps the first on ties
    raise ValueError("team is empty")


def plan_schedule(plan: ScenarioPlan, contract: Contract, order: list[TicketPlan]) -> Schedule:
    """What the client was promised: each ticket lasts exactly its charged days."""
    free = {m.name: 0 for m in plan.team}
    result: Schedule = {}
    for ticket in order:
        member = pick_assignee(plan.team, ticket.profile, free)
        start = max([free[member.name], *(result[d][2] + 1 for d in ticket.depends_on)])
        end = start + days_for_size(contract, ticket.size) - 1
        free[member.name] = end + 1
        result[ticket.key] = (member.name, start, end)
    return result


def _base_days(ticket: TicketPlan, contract: Contract, rng: random.Random) -> int:
    """Working days after the lognormal factor (one draw); blocked and review days come on top."""
    factor = min(1.8, max(0.6, rng.lognormvariate(0, 0.25)))
    return max(1, round(days_for_size(contract, ticket.size) * factor))


def blocked_days(ticket: TicketPlan) -> int:
    return sum(b.duration_days or 0 for b in ticket.beats if b.kind == "blocked")


def review_days(ticket: TicketPlan) -> int:
    return 2 if any(b.kind == "review_changes" for b in ticket.beats) else 0


def real_schedule(
    plan: ScenarioPlan, contract: Contract, order: list[TicketPlan], rng: random.Random
) -> Schedule:
    """What actually happened: lognormal overrun plus blocked and review days. One rng draw per ticket."""
    free = {m.name: 0 for m in plan.team}
    result: Schedule = {}
    for ticket in order:
        base = _base_days(ticket, contract, rng)
        duration = base + blocked_days(ticket) + review_days(ticket)
        member = pick_assignee(plan.team, ticket.profile, free)
        start = max([free[member.name], *(result[d][2] + 1 for d in ticket.depends_on)])
        end = start + duration - 1
        free[member.name] = end + 1
        result[ticket.key] = (member.name, start, end)
    return result
