"""Jira-like event stream for one ticket, derived from its real schedule and its beats.

Draw order from the shared rng (changing it reshuffles every seeded timeline):
  1. one `randint` per `blocked` beat, in beat order (offset of the block from the start);
  2. one `choice([2, 3])` for the first comment interval;
  3. then for each non-blocked working day from `real_start` to `real_end`: one
     `uniform(0.5, 1.0)` (hours), followed by one `choice([2, 3])` each time a comment is emitted.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from billing_sim.billing.policy import Contract
from billing_sim.expander.models import Event, ScheduledTicket
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
    base = max(
        1,
        (end - start + 1) - sum(b.duration_days or 0 for b in blocked_beats) - (2 if review_beat else 0),
    )

    pending: list[_Pending] = []

    def add(day: int, rank: int, type_: str, actor: str, payload: dict) -> None:
        pending.append(_Pending(day, rank, type_, actor, payload))

    def move(day: int, rank: int, actor: str, to: str) -> None:
        add(day, rank, "transition", actor, {"to": to})  # "from" is filled in once events are sorted

    move(start, _R_START, assignee, DOING)

    blocked_days: set[int] = set()
    cursor = start
    for beat in blocked_beats:
        offset = rng.randint(1, max(1, base - 1))
        blocked_on = max(cursor, min(cursor + offset, end - 1))
        unblocked_on = min(blocked_on + (beat.duration_days or 1), end)
        blocked_days.update(range(blocked_on, unblocked_on))
        add(blocked_on, _R_STATE, "blocked", assignee, {"reason": beat.text})
        move(blocked_on, _R_STATE, assignee, BLOCKED)
        add(unblocked_on, _R_STATE, "unblocked", assignee, {})
        move(unblocked_on, _R_STATE, assignee, DOING)
        cursor = unblocked_on

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
        if day in blocked_days:
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
