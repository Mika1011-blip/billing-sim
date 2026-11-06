"""Plain-data timeline records.

Re-exported from `billing_sim.expander.expand` (the public import path). They live here so
`events.py` and `invoicing.py` can build them without importing `expand.py` (circular).
Keep them free of methods: the store loads them into SQLite field by field.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Sprint:
    number: int
    start_day: int
    end_day: int


@dataclass
class ScheduledTicket:
    key: str
    assignee: str
    sprint_number: int
    planned_start: int
    planned_end: int
    real_start: int
    real_end: int
    days_charged: int
    fee: int


@dataclass
class Event:
    ticket_key: str
    day: int
    seq: int
    type: str
    actor: str
    payload: dict


@dataclass
class Invoice:
    number: str
    lot_key: str | None
    ticket_key: str | None
    issued_day: int
    due_day: int
    amount_ht: int
    vat: int
    amount_ttc: int
    covers: list[str]


@dataclass
class Payment:
    invoice_number: str
    day: int
    amount: int
    reference: str


@dataclass
class Approval:
    lot_key: str
    day: int
    approved_by: str


@dataclass
class Timeline:
    sprints: list[Sprint] = field(default_factory=list)
    tickets: list[ScheduledTicket] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    invoices: list[Invoice] = field(default_factory=list)
    payments: list[Payment] = field(default_factory=list)
    approvals: list[Approval] = field(default_factory=list)
    last_day: int = 0
    warnings: list[str] = field(default_factory=list)
