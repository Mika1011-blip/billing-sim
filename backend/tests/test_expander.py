import itertools
import random
from dataclasses import replace
from datetime import date

import pytest

from billing_sim.expander.calendar import date_for_day, day_for_date
from billing_sim.expander.expand import expand
from billing_sim.expander.schedule import plan_schedule, real_schedule, topo_order
from billing_sim.scenario.schema import Beat, ClientBehaviour

START = date(2026, 3, 2)  # a Monday


def _by_key(items, attr="key"):
    return {getattr(i, attr): i for i in items}


def _lot_invoice(timeline, lot_key):
    return next(i for i in timeline.invoices if i.lot_key == lot_key)


def _payments_of(timeline, invoice):
    return sorted((p for p in timeline.payments if p.invoice_number == invoice.number), key=lambda p: p.day)


# --- calendar -----------------------------------------------------------------


def test_calendar_skips_weekends():
    assert date_for_day(date(2026, 3, 2), 5) == date(2026, 3, 9)


def test_calendar_requires_monday():
    with pytest.raises(ValueError):
        date_for_day(date(2026, 3, 3), 0)


def test_calendar_round_trip_and_weekday_only():
    for day in range(40):
        d = date_for_day(START, day)
        assert d.weekday() < 5
        assert day_for_date(START, d) == day


def test_day_for_date_rejects_weekend_and_past():
    with pytest.raises(ValueError):
        day_for_date(START, date(2026, 3, 7))
    with pytest.raises(ValueError):
        day_for_date(START, date(2026, 2, 27))


# --- determinism ---------------------------------------------------------------


def test_deterministic(plan, contract):
    assert expand(plan, contract, 42, START) == expand(plan, contract, 42, START)


def test_seed_changes_timeline(plan, contract):
    assert expand(plan, contract, 42, START).events != expand(plan, contract, 43, START).events


def test_invalid_plan_raises(plan, contract):
    plan.tickets[0].depends_on = ["BANK-2"]  # BANK-2 depends on BANK-1: cycle
    with pytest.raises(ValueError):
        expand(plan, contract, 42, START)


# --- schedule ------------------------------------------------------------------


def test_topo_order_respects_dependencies_and_ties(plan):
    order = [t.key for t in topo_order(plan)]
    assert sorted(order) == sorted(t.key for t in plan.tickets)
    position = {key: i for i, key in enumerate(order)}
    for ticket in plan.tickets:
        for dep in ticket.depends_on:
            assert position[dep] < position[ticket.key]
    # ready tickets come lot by lot, then by key: L1's BANK-1 first, free-floating BANK-12 early only
    # because nothing blocks it (no lot sorts last among the ready ones).
    assert order[0] == "BANK-1"
    assert position["BANK-2"] < position["BANK-3"]


def test_dependencies_respected(timeline, plan):
    tickets = _by_key(timeline.tickets)
    for ticket in plan.tickets:
        scheduled = tickets[ticket.key]
        for dep in ticket.depends_on:
            assert scheduled.real_start > tickets[dep].real_end
            assert scheduled.planned_start > tickets[dep].planned_end


def test_one_assignee_is_never_double_booked(timeline):
    by_assignee: dict[str, list] = {}
    for t in timeline.tickets:
        by_assignee.setdefault(t.assignee, []).append(t)
    for tickets in by_assignee.values():
        tickets.sort(key=lambda t: t.real_start)
        for a, b in itertools.pairwise(tickets):
            assert b.real_start > a.real_end


def test_planned_schedule_uses_days_charged(timeline):
    for t in timeline.tickets:
        assert t.planned_end - t.planned_start + 1 == t.days_charged
        assert t.sprint_number == t.planned_start // 10 + 1


def test_sprints_cover_every_planned_and_real_end(timeline):
    last = max(max(t.planned_end, t.real_end) for t in timeline.tickets)
    assert timeline.sprints[0].start_day == 0
    for n, sprint in enumerate(timeline.sprints, start=1):
        assert (sprint.number, sprint.start_day, sprint.end_day) == (n, (n - 1) * 10, n * 10 - 1)
    assert timeline.sprints[-1].end_day >= last > timeline.sprints[-1].start_day - 1


def test_missing_profile_warns(plan, contract):
    plan.team = [m for m in plan.team if m.profile != "architect"]
    timeline = expand(plan, contract, 42, START)
    assert timeline.warnings
    assert any(w.startswith("BANK-4: no architect available, assigned to ") for w in timeline.warnings)
    names = {m.name for m in plan.team}
    assert {t.key for t in timeline.tickets} == {t.key for t in plan.tickets}
    assert all(t.assignee in names for t in timeline.tickets)


def test_no_warning_when_every_profile_present(timeline):
    assert timeline.warnings == []


def test_plan_schedule_assigns_by_earliest_free(plan, contract):
    order = topo_order(plan)
    sched = plan_schedule(plan, contract, order)
    assert sched["BANK-1"][0] == "Camille Roux"  # first dev, both free at day 0
    assert sched["BANK-2"][0] == "Yanis Benali"  # Camille is busy until BANK-1 ends; Yanis is free


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_real_assignee_equals_planned(plan, contract, seed):
    order = topo_order(plan)
    planned = plan_schedule(plan, contract, order)
    real = real_schedule(plan, contract, order, random.Random(seed), planned)
    assert {k: v[0] for k, v in real.items()} == {k: v[0] for k, v in planned.items()}
    timeline = expand(plan, contract, seed, START)
    assert {t.key: t.assignee for t in timeline.tickets} == {k: v[0] for k, v in planned.items()}


# --- events --------------------------------------------------------------------


def _transitions(timeline, key):
    return [e for e in timeline.events if e.ticket_key == key and e.type == "transition"]


def test_each_ticket_has_one_start_and_one_done(timeline, plan):
    for ticket in plan.tickets:
        transitions = _transitions(timeline, ticket.key)
        starts = [e for e in transitions if e.payload == {"from": "À faire", "to": "En cours"}]
        dones = [e for e in transitions if e.payload["to"] == "Terminé"]
        assert len(starts) == 1
        assert len(dones) == 1
        scheduled = _by_key(timeline.tickets)[ticket.key]
        assert starts[0].day == scheduled.real_start
        assert dones[0].day == scheduled.real_end
        assert transitions[-1] is dones[0]


def test_transitions_chain_consistently(timeline, plan):
    for ticket in plan.tickets:
        state = "À faire"
        for e in _transitions(timeline, ticket.key):
            assert e.payload["from"] == state
            state = e.payload["to"]
        assert state == "Terminé"


def test_events_ordered_with_increasing_seq_per_day(timeline):
    keys = [(e.day, e.seq) for e in timeline.events]
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)


def test_blocked_span_has_no_worklogs(timeline):
    blocked_tickets = set()
    open_spans: set[str] = set()
    for e in sorted(timeline.events, key=lambda e: (e.day, e.seq)):
        if e.type == "blocked":
            blocked_tickets.add(e.ticket_key)
            open_spans.add(e.ticket_key)
        elif e.type == "unblocked":
            open_spans.discard(e.ticket_key)
        elif e.type == "worklog":
            assert e.ticket_key not in open_spans
    assert blocked_tickets == {"BANK-5"}
    assert not open_spans


def test_blocked_span_lasts_at_least_duration_days(timeline):
    events = [e for e in timeline.events if e.ticket_key == "BANK-5"]
    blocked = next(e for e in events if e.type == "blocked")
    unblocked = next(e for e in events if e.type == "unblocked")
    assert unblocked.day - blocked.day >= 2 or unblocked.day == _by_key(timeline.tickets)["BANK-5"].real_end


def test_review_beats_emit_the_review_cycle(timeline):
    scheduled = _by_key(timeline.tickets)["BANK-2"]
    events = [e for e in timeline.events if e.ticket_key == "BANK-2"]
    by_type = {e.type: e for e in events if e.type.startswith("review")}
    assert by_type["review_requested"].day == scheduled.real_end - 2
    assert by_type["review_changes"].day == scheduled.real_end - 1
    assert by_type["review_approved"].day == scheduled.real_end
    assert by_type["review_approved"].payload == {"text": "OK pour moi"}
    assert by_type["review_requested"].actor == scheduled.assignee
    assert by_type["review_changes"].actor != scheduled.assignee  # a senior/architect reviews
    assert [e.payload["to"] for e in events if e.type == "transition"] == [
        "En cours",
        "En revue",
        "En cours",
        "Terminé",
    ]


def test_worklogs_are_within_the_work_window_and_hours_bounded(timeline, contract):
    tickets = _by_key(timeline.tickets)
    for e in timeline.events:
        if e.type == "worklog":
            t = tickets[e.ticket_key]
            assert t.real_start <= e.day <= t.real_end
            assert e.actor == t.assignee
            assert 0.5 * contract.hours_per_day - 0.05 <= e.payload["hours"] <= contract.hours_per_day
            assert e.payload["note"]


def test_comments_are_written_by_the_assignee(timeline):
    tickets = _by_key(timeline.tickets)
    comments = [e for e in timeline.events if e.type == "comment"]
    assert comments
    assert all(e.actor == tickets[e.ticket_key].assignee for e in comments)


def test_review_changes_adds_two_days(plan, contract, monkeypatch):
    monkeypatch.setattr(random.Random, "lognormvariate", lambda self, mu, sigma: 1.0)
    plan.tickets[0].beats = [Beat(kind="review_changes", text="Renommer les champs.")]
    assert plan.tickets[0].key == "BANK-1"
    bank1 = _by_key(expand(plan, contract, 42, START).tickets)["BANK-1"]
    assert bank1.real_end - bank1.real_start + 1 == bank1.days_charged + 2


# --- invoicing -----------------------------------------------------------------


def test_invoice_after_last_ticket(timeline, plan):
    tickets = _by_key(timeline.tickets)
    for invoice in timeline.invoices:
        if invoice.lot_key is not None:
            assert invoice.covers
            assert invoice.issued_day > max(tickets[k].real_end for k in invoice.covers)
            assert invoice.ticket_key is None
        else:
            assert invoice.ticket_key is not None
            assert invoice.issued_day == tickets[invoice.ticket_key].real_end
            assert invoice.covers == [invoice.ticket_key]


def test_lot_invoice_amounts(timeline, contract):
    l1 = _lot_invoice(timeline, "L1")
    assert (l1.amount_ht, l1.vat, l1.amount_ttc) == (3000, 600, 3600)
    assert sorted(l1.covers) == ["BANK-1", "BANK-2", "BANK-3"]
    assert l1.due_day == l1.issued_day + contract.payment_terms_days


def test_no_lot_ticket_is_invoiced_on_its_own(timeline):
    own = [i for i in timeline.invoices if i.lot_key is None]
    assert [i.ticket_key for i in own] == ["BANK-12"]
    assert own[0].amount_ht == 750  # S x senior
    assert "BANK-12" not in {k for i in timeline.invoices if i.lot_key for k in i.covers}


def test_lot_none_without_charged_separately_is_still_invoiced_alone(plan, contract):
    bank12 = next(t for t in plan.tickets if t.key == "BANK-12")
    bank12.charged_separately = False
    timeline = expand(plan, contract, 42, START)
    own = [i for i in timeline.invoices if i.lot_key is None]
    assert [i.ticket_key for i in own] == ["BANK-12"]


def test_invoice_numbers_follow_issued_day(timeline):
    numbers = [i.number for i in sorted(timeline.invoices, key=lambda i: i.number)]
    assert numbers == [f"F-2026-{n:03d}" for n in range(1, len(timeline.invoices) + 1)]
    ordered = sorted(timeline.invoices, key=lambda i: i.number)
    assert [i.issued_day for i in ordered] == sorted(i.issued_day for i in ordered)


def test_sprint_end_timing_issues_on_a_sprint_boundary(plan, contract):
    contract = replace(contract, invoice_timing="sprint_end")
    timeline = expand(plan, contract, 42, START)
    tickets = _by_key(timeline.tickets)
    sprint_ends = {s.end_day for s in timeline.sprints}
    for invoice in timeline.invoices:
        if invoice.lot_key is None:
            continue
        earliest = max(tickets[k].real_end for k in invoice.covers) + 1
        assert invoice.issued_day in sprint_ends
        assert invoice.issued_day >= earliest
        assert invoice.issued_day - earliest < 10


def test_approvals_one_per_lot_on_issue_day(timeline, plan):
    assert sorted(a.lot_key for a in timeline.approvals) == sorted(lot.key for lot in plan.lots)
    for approval in timeline.approvals:
        assert approval.day == _lot_invoice(timeline, approval.lot_key).issued_day
        assert approval.approved_by == "Direction des achats"


def test_sum_fees_equals_sum_invoices_ht(timeline, plan, contract):
    assert sum(t.fee for t in timeline.tickets) == sum(i.amount_ht for i in timeline.invoices)
    for i in timeline.invoices:
        assert i.amount_ttc == i.amount_ht + i.vat


# --- payments ------------------------------------------------------------------


def test_payments_follow_behaviour(timeline):
    l1 = _lot_invoice(timeline, "L1")
    first, second = _payments_of(timeline, l1)
    assert (first.amount, first.day, first.reference) == (1200, l1.due_day, f"VIR-{l1.number}-1")
    assert (second.amount, second.day, second.reference) == (2400, l1.due_day + 15, f"VIR-{l1.number}-2")

    l2 = _lot_invoice(timeline, "L2")
    (only,) = _payments_of(timeline, l2)
    assert (only.amount, only.day) == (l2.amount_ttc, l2.due_day + 12)

    l3 = _lot_invoice(timeline, "L3")
    first, second = _payments_of(timeline, l3)
    assert first.amount == round(0.5 * l3.amount_ttc)
    assert first.day == l3.due_day + 20
    assert first.amount + second.amount == l3.amount_ttc
    assert second.day == first.day + 15


def test_every_invoice_is_paid_in_full(timeline):
    for invoice in timeline.invoices:
        assert sum(p.amount for p in _payments_of(timeline, invoice)) == invoice.amount_ttc


def test_separate_invoice_is_paid_in_full_on_due_day(timeline):
    invoice = next(i for i in timeline.invoices if i.lot_key is None)
    (payment,) = _payments_of(timeline, invoice)
    assert (payment.amount, payment.day) == (invoice.amount_ttc, invoice.due_day)
    assert payment.reference == f"VIR-{invoice.number}-1"


def test_full_fraction_single_payment(plan, contract):
    plan.client_behaviour = [
        ClientBehaviour(invoice_index=i, pays_fraction=1.0, days_late=0) for i in (1, 2, 3)
    ]
    timeline = expand(plan, contract, 42, START)
    for invoice in timeline.invoices:
        assert len(_payments_of(timeline, invoice)) == 1
    assert all(p.amount > 0 for p in timeline.payments)


def test_zero_fraction_emits_only_the_remainder_as_first_reference(plan, contract):
    plan.client_behaviour = [
        ClientBehaviour(invoice_index=1, pays_fraction=0, days_late=5),
        ClientBehaviour(invoice_index=2, pays_fraction=1.0, days_late=0),
        ClientBehaviour(invoice_index=3, pays_fraction=1.0, days_late=0),
    ]
    timeline = expand(plan, contract, 42, START)
    l1 = _lot_invoice(timeline, "L1")
    (only,) = _payments_of(timeline, l1)
    assert (only.amount, only.reference, only.day) == (l1.amount_ttc, f"VIR-{l1.number}-1", l1.due_day + 5 + 15)
    assert all(p.amount > 0 for p in timeline.payments)


def test_last_day_after_everything(timeline):
    assert timeline.last_day >= max(p.day for p in timeline.payments) + 15
    assert timeline.last_day >= max(e.day for e in timeline.events) + 15
    assert timeline.last_day >= max(i.due_day for i in timeline.invoices) + 15
