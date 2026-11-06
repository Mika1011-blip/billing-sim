import itertools
import random
from dataclasses import replace
from datetime import date, timedelta

import pytest

from billing_sim.expander.calendar import date_for_day, day_for_date
from billing_sim.expander.expand import expand
from billing_sim.expander.schedule import plan_schedule, real_schedule, topo_order
from billing_sim.scenario.schema import Beat

START = date(2026, 3, 2)  # a Monday


def _by_key(items, attr="key"):
    return {getattr(i, attr): i for i in items}


def _lot_invoice(timeline, lot_key):
    return next(i for i in timeline.invoices if i.lot_key == lot_key)


LEGAL_TRANSITIONS = {
    ("À faire", "En cours"),
    ("En cours", "Bloqué"),
    ("Bloqué", "En cours"),
    ("En cours", "En revue"),
    ("En revue", "En cours"),
    ("En cours", "Terminé"),
}


def _assert_legal_story(timeline, plan):
    """Status changes are legal and chained, blocks last their duration_days, nobody works while blocked."""
    ordered = sorted(timeline.events, key=lambda e: (e.day, e.seq))
    for ticket in plan.tickets:
        events = [e for e in ordered if e.ticket_key == ticket.key]
        state = "À faire"
        for e in events:
            if e.type == "transition":
                assert e.payload["from"] == state, (ticket.key, e)
                assert (e.payload["from"], e.payload["to"]) in LEGAL_TRANSITIONS, (ticket.key, e)
                state = e.payload["to"]
        assert state == "Terminé"

        durations = [b.duration_days for b in ticket.beats if b.kind == "blocked"]
        blocked = [e for e in events if e.type == "blocked"]
        unblocked = [e for e in events if e.type == "unblocked"]
        assert len(blocked) == len(unblocked) == len(durations)
        for b, u, duration in zip(blocked, unblocked, durations, strict=True):
            assert u.day - b.day + 1 == duration, (ticket.key, b, u)
            assert not any(
                e.type == "worklog" and b.day <= e.day <= u.day for e in events
            ), (ticket.key, b, u)
        spans = sorted((b.day, u.day) for b, u in zip(blocked, unblocked, strict=True))
        assert all(a[1] < b[0] for a, b in itertools.pairwise(spans)), "blocks overlap"


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


@pytest.mark.parametrize("seed", [0, 1, 6, 42])
def test_story_is_legal(plan, contract, seed):
    _assert_legal_story(expand(plan, contract, seed, START), plan)


def _ticket(plan, key):
    return next(t for t in plan.tickets if t.key == key)


def test_two_long_blocks_and_a_review_on_an_l_ticket(plan, contract):
    bank8 = _ticket(plan, "BANK-8")
    assert bank8.size == "L"
    bank8.beats = [
        Beat(kind="blocked", text="Attente des accès.", duration_days=2),
        Beat(kind="blocked", text="Attente de la recette.", duration_days=2),
        Beat(kind="review_changes", text="Ajouter des tests."),
    ]
    for seed in [0, *range(1, 10)]:
        timeline = expand(plan, contract, seed, START)
        _assert_legal_story(timeline, plan)
        scheduled = _by_key(timeline.tickets)["BANK-8"]
        events = [e for e in timeline.events if e.ticket_key == "BANK-8"]
        blocks = [e for e in events if e.type == "blocked"]
        unblocks = [e for e in events if e.type == "unblocked"]
        assert len(blocks) == len(unblocks) == 2
        requested = next(e for e in events if e.type == "review_requested")
        assert all(b.day > scheduled.real_start for b in blocks)
        assert max(u.day for u in unblocks) <= requested.day == scheduled.real_end - 2


def test_short_ticket_with_a_block_and_a_review(plan, contract):
    bank3 = _ticket(plan, "BANK-3")
    assert bank3.size == "S"
    bank3.beats = [
        Beat(kind="blocked", text="Attente des accès.", duration_days=2),
        Beat(kind="review_changes", text="Ajouter des tests."),
    ]
    for seed in range(10):
        _assert_legal_story(expand(plan, contract, seed, START), plan)


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


def test_blocked_span_lasts_exactly_duration_days(timeline, plan):
    (beat,) = [b for b in _ticket(plan, "BANK-5").beats if b.kind == "blocked"]
    events = [e for e in timeline.events if e.ticket_key == "BANK-5"]
    blocked = next(e for e in events if e.type == "blocked")
    unblocked = next(e for e in events if e.type == "unblocked")
    assert unblocked.day - blocked.day + 1 == beat.duration_days


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


@pytest.mark.parametrize("seed", range(10))
def test_sprint_end_invoices_land_on_a_sprint_end(plan, contract, seed):
    timeline = expand(plan, replace(contract, invoice_timing="sprint_end"), seed, START)
    sprint_ends = {s.end_day for s in timeline.sprints}
    tickets = _by_key(timeline.tickets)
    for invoice in (i for i in timeline.invoices if i.lot_key is not None):
        assert invoice.issued_day % 10 == 9
        assert invoice.issued_day in sprint_ends
        assert invoice.issued_day > max(tickets[k].real_end for k in invoice.covers)


def test_sprint_end_invoice_on_day_ten_boundary_goes_to_next_sprint_end(plan, contract):
    # Force a lot whose last ticket ends on day 9 (a sprint end): the invoice must wait for day 19.
    from billing_sim.expander.invoicing import build_invoices
    from billing_sim.expander.models import Sprint

    contract = replace(contract, invoice_timing="sprint_end")
    timeline = expand(plan, contract, 42, START)
    tickets = [replace(t, real_end=9) if t.key in ("BANK-1", "BANK-2", "BANK-3") else t for t in timeline.tickets]
    invoices, _, _ = build_invoices(plan, contract, tickets, [Sprint(1, 0, 9)], START)
    assert next(i for i in invoices if i.lot_key == "L1").issued_day == 19


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


def test_nobody_pays_by_script(timeline):
    """Payments are a participant action at runtime; the expander emits none."""
    assert timeline.payments == []


def test_build_invoices_returns_no_payments(plan, contract):
    from billing_sim.expander.invoicing import build_invoices

    timeline = expand(plan, contract, 42, START)
    invoices, approvals, payments = build_invoices(plan, contract, timeline.tickets, timeline.sprints, START)
    assert payments == []
    assert invoices == timeline.invoices and approvals == timeline.approvals


@pytest.mark.parametrize("seed", range(10))
def test_last_day_leaves_35_calendar_days_after_last_due_date(plan, contract, seed):
    """The run lasts long enough for the latest invoice to become "Très en retard" (> 30 calendar days late)."""
    timeline = expand(plan, contract, seed, START)
    last_due = max(i.due_day for i in timeline.invoices)
    gap = date_for_day(START, timeline.last_day) - date_for_day(START, last_due)
    assert gap >= timedelta(days=35)
    # The first such working day: one working day earlier is short of 35 calendar days (unless another bound wins).
    earlier = date_for_day(START, timeline.last_day - 1) - date_for_day(START, last_due)
    assert earlier < timedelta(days=35) or timeline.last_day == max(e.day for e in timeline.events) + 15
    # A working-day index on the sprint grid, never before the last sprint ends.
    assert day_for_date(START, date_for_day(START, timeline.last_day)) == timeline.last_day
    assert timeline.sprints[0].start_day == 0 and timeline.last_day >= timeline.sprints[-1].end_day


def test_last_day_tail_lands_on_a_working_day_when_due_plus_35_is_a_weekend(plan, contract):
    from billing_sim.expander.expand import first_working_day_on_or_after

    assert first_working_day_on_or_after(START, date(2026, 3, 7)) == 5  # Saturday -> Monday 9 March (day 5)
    assert first_working_day_on_or_after(START, date(2026, 3, 8)) == 5  # Sunday -> Monday
    assert first_working_day_on_or_after(START, date(2026, 3, 10)) == 6  # a weekday maps to itself


def test_last_day_after_everything(timeline):
    assert timeline.last_day >= max(e.day for e in timeline.events) + 15
    assert timeline.last_day >= max(i.due_day for i in timeline.invoices) + 15
