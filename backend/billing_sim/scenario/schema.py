"""Pydantic schema Haiku fills at setup.

Haiku never produces a price or a day count: the only sizing inputs are a ticket
`size` and a beat `duration_days`; every amount is computed by `billing.policy`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from billing_sim.billing.policy import Profile, Size


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Beat(_Strict):
    kind: Literal["blocked", "review_changes", "scope_note"]
    text: str
    duration_days: int | None = None


class TeamMember(_Strict):
    name: str
    profile: Profile


class LotPlan(_Strict):
    key: str
    name: str
    description: str


class TicketPlan(_Strict):
    key: str
    title: str
    description: str
    lot_key: str | None
    charged_separately: bool = False
    size: Size
    profile: Profile
    depends_on: list[str] = []
    beats: list[Beat] = []


class ClientBehaviour(_Strict):
    invoice_index: int
    pays_fraction: float = Field(ge=0, le=1)
    days_late: int = Field(ge=0)


class ScenarioPlan(_Strict):
    product_summary: str
    team: list[TeamMember] = Field(min_length=3, max_length=5)
    lots: list[LotPlan] = Field(min_length=2, max_length=4)
    tickets: list[TicketPlan] = Field(min_length=12, max_length=30)
    client_behaviour: list[ClientBehaviour]


class Rejection(_Strict):
    reason: str


class GenerationResult(_Strict):
    kind: Literal["plan", "rejection"]
    plan: ScenarioPlan | None = None
    reason: str | None = None
