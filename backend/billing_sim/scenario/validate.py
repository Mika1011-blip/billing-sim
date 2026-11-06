"""Semantic checks a ScenarioPlan must pass beyond what the schema enforces."""

from __future__ import annotations

from collections import Counter, deque

from billing_sim.scenario.schema import ScenarioPlan


def validate_plan(plan: ScenarioPlan) -> list[str]:
    """Return a list of human-readable problems; an empty list means the plan is valid."""
    errors: list[str] = []
    lot_keys = {lot.key for lot in plan.lots}
    ticket_keys = {t.key for t in plan.tickets}

    for key, count in Counter(t.key for t in plan.tickets).items():
        if count > 1:
            errors.append(f"duplicate ticket key {key} ({count} tickets)")

    edges: dict[str, set[str]] = {key: set() for key in ticket_keys}  # ticket -> its dependencies
    for ticket in plan.tickets:
        if ticket.lot_key is not None and ticket.lot_key not in lot_keys:
            errors.append(f"ticket {ticket.key}: unknown lot_key {ticket.lot_key}")
        for dep in ticket.depends_on:
            if dep == ticket.key:
                errors.append(f"ticket {ticket.key} depends on itself")
            elif dep not in ticket_keys:
                errors.append(f"ticket {ticket.key}: unknown dependency {dep}")
            else:
                edges[ticket.key].add(dep)
        for beat in ticket.beats:
            if beat.kind == "blocked" and (beat.duration_days is None or beat.duration_days < 1):
                errors.append(f"ticket {ticket.key}: blocked beat needs duration_days >= 1")

    cycle = _cycle_members(edges)
    if cycle:
        errors.append(f"dependency cycle between tickets: {', '.join(sorted(cycle))}")

    expected = set(range(1, len(plan.lots) + 1))
    seen = Counter(b.invoice_index for b in plan.client_behaviour)
    for index in sorted(expected - set(seen)):
        errors.append(f"client_behaviour missing entry for invoice_index {index}")
    for index, count in sorted(seen.items()):
        if index not in expected:
            errors.append(f"client_behaviour has invoice_index {index} outside 1..{len(plan.lots)}")
        elif count > 1:
            errors.append(f"client_behaviour has {count} entries for invoice_index {index}")

    return errors


def _cycle_members(edges: dict[str, set[str]]) -> set[str]:
    """Tickets on a dependency cycle (or between cycles), found by Kahn's algorithm.

    Peeling tickets with no dependencies leaves the cycles plus everything that depends
    on them; peeling tickets nobody depends on then removes that downstream tail.
    """
    remaining = _kahn_leftover(edges)
    reverse: dict[str, set[str]] = {key: set() for key in remaining}
    for key in remaining:
        for dep in edges[key] & remaining:
            reverse[dep].add(key)
    return _kahn_leftover(reverse)


def _kahn_leftover(edges: dict[str, set[str]]) -> set[str]:
    indegree = {key: len(deps & edges.keys()) for key, deps in edges.items()}
    dependents: dict[str, list[str]] = {key: [] for key in edges}
    for key, deps in edges.items():
        for dep in deps & edges.keys():
            dependents[dep].append(key)
    queue = deque(key for key, n in indegree.items() if n == 0)
    while queue:
        key = queue.popleft()
        indegree.pop(key)
        for dependent in dependents[key]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)
    return set(indegree)
