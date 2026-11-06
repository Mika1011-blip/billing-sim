"""Jira-like event stream for one ticket, derived from its real schedule and its beats.

Draw order from the shared rng (changing it reshuffles every seeded timeline):
  1. blocked beats, in beat order: the first draws `randint(1, max(1, base - 1))` (its offset from
     `real_start`); every further one draws `randint(0, spare)` (working days between it and the
     previous block, `spare` being what is left of the base window, one day kept for the end);
  2. one `choice([2, 3])` for the first comment interval;
  3. then for each non-blocked working day from `real_start` to `real_end`: one
     `uniform(0.5, 1.0)` (hours), followed by one `choice([2, 3])` each time a comment is emitted.

Blocks: the ticket is `Bloqué` from the `blocked` day to the `unblocked` day inclusive (the last
blocked day, so a block spans exactly `duration_days` days); worklogs resume the next working day.
Blocks never overlap and lie within `[real_start + 1, real_end - review_len]`, which is exactly
`base - 1` working days wider than the blocks themselves, so the draws above always fit.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from billing_sim.billing.policy import Contract
from billing_sim.expander.models import Event, ScheduledTicket
from billing_sim.expander.schedule import blocked_days, review_days
from billing_sim.scenario.schema import TeamMember, TicketPlan

TODO, DOING, BLOCKED, IN_REVIEW, DONE = "À faire", "En cours", "Bloqué", "En revue", "Terminé"

# Order of events inside one day (ties keep creation order).
_R_START, _R_STATE, _R_WORKLOG, _R_COMMENT, _R_REVIEW, _R_DONE = range(6)

_COMMENTS = (
    "Point d'avancement sur « {title} » : ça avance comme prévu.",
    "Je fais un premier retour sur « {title} », pas de difficulté particulière.",
    "Mise à jour sur « {title} » : les cas limites sont en cours de traitement.",
    "« {title} » : j'ai échangé avec l'équipe, on garde cette approche.",
)


@dataclass
class _Pending:
    day: int
    rank: int
    type: str
    actor: str
    payload: dict


def _notes(ticket: TicketPlan) -> list[str]:
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", ticket.description.strip()) if s]
    scope_notes = [b.text for b in ticket.beats if b.kind == "scope_note"]
    return sentences + scope_notes or [ticket.title]


def _reviewer(team: list[TeamMember], assignee: str) -> str:
    for member in team:
        if member.profile in ("senior", "architect") and member.name != assignee:
            return member.name
    return assignee


def ticket_events(
    ticket: TicketPlan,
    sched: ScheduledTicket,
    contract: Contract,
    team: list[TeamMember],
    rng: random.Random,
) -> list[Event]:
    assignee = sched.assignee
    start, end = sched.real_start, sched.real_end
    blocked_beats = [b for b in ticket.beats if b.kind == "blocked"]
    review_beat = next((b for b in ticket.beats if b.kind == "review_changes"), None)
    reviewer = _reviewer(team, assignee)
    review_len = review_days(ticket)
    base = (end - start + 1) - blocked_days(ticket) - review_len

    pending: list[_Pending] = []

    def add(day: int, rank: int, type_: str, actor: str, payload: dict) -> None:
        pending.append(_Pending(day, rank, type_, actor, payload))

    def move(day: int, rank: int, actor: str, to: str) -> None:
        add(day, rank, "transition", actor, {"to": to})  # "from" is filled in once events are sorted

    move(start, _R_START, assignee, DOING)

    blocked_set: set[int] = set()
    next_free = start + 1  # first day a block may start
    spare = 0
    for i, beat in enumerate(blocked_beats):
        length = beat.duration_days or 0
        if i == 0:
            blocked_on = start + rng.randint(1, max(1, base - 1))
            spare = max(0, (base - 1) - (blocked_on - start - 1) - 1)  # keep one working day at the end
        else:
            gap = rng.randint(0, spare)
            spare -= gap
            blocked_on = next_free + gap
        unblocked_on = blocked_on + length - 1
        blocked_set.update(range(blocked_on, unblocked_on + 1))
        add(blocked_on, _R_STATE, "blocked", assignee, {"reason": beat.text})
        move(blocked_on, _R_STATE, assignee, BLOCKED)
        add(unblocked_on, _R_STATE, "unblocked", assignee, {})
        move(unblocked_on, _R_STATE, assignee, DOING)
        next_free = unblocked_on + 1

    if review_beat is not None:
        add(end - 2, _R_REVIEW, "review_requested", assignee, {"text": review_beat.text})
        move(end - 2, _R_REVIEW, assignee, IN_REVIEW)
        add(end - 1, _R_STATE, "review_changes", reviewer, {"text": review_beat.text})
        move(end - 1, _R_STATE, reviewer, DOING)
        add(end, _R_REVIEW, "review_approved", reviewer, {"text": "OK pour moi"})

    notes = _notes(ticket)
    comment_every = rng.choice([2, 3])
    worked = since_comment = comments = 0
    for day in range(start, end + 1):
        if day in blocked_set:
            continue
        hours = round(contract.hours_per_day * rng.uniform(0.5, 1.0), 1)
        add(day, _R_WORKLOG, "worklog", assignee, {"hours": hours, "note": notes[worked % len(notes)]})
        worked += 1
        since_comment += 1
        if since_comment == comment_every:
            text = _COMMENTS[comments % len(_COMMENTS)].format(title=ticket.title)
            add(day, _R_COMMENT, "comment", assignee, {"text": text})
            comments += 1
            comment_every = rng.choice([2, 3])
            since_comment = 0

    move(end, _R_DONE, reviewer if review_beat else assignee, DONE)

    pending.sort(key=lambda p: (p.day, p.rank))  # stable: creation order breaks ties
    state = TODO
    events: list[Event] = []
    seq_in_day: dict[int, int] = {}
    for p in pending:
        payload = p.payload
        if p.type == "transition":
            payload = {"from": state, "to": p.payload["to"]}
            state = payload["to"]
        seq = seq_in_day.get(p.day, 0)
        seq_in_day[p.day] = seq + 1
        events.append(Event(ticket.key, p.day, seq, p.type, p.actor, payload))
    return events
