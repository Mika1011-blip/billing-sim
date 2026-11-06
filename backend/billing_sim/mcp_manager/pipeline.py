"""Request text -> stored scenario. Shared by the HTTP route and the manager MCP tool."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal

from billing_sim.api.deps import Settings
from billing_sim.billing.policy import load_contract
from billing_sim.expander.expand import expand
from billing_sim.scenario import haiku
from billing_sim.scenario.fixture import load_fixture
from billing_sim.scenario.schema import ScenarioPlan
from billing_sim.scenario.validate import validate_plan
from billing_sim.store.db import connect
from billing_sim.store.load import load_scenario


@dataclass
class GenerateOutcome:
    kind: Literal["plan", "rejection"]
    plan: ScenarioPlan | None
    reason: str | None
    seed: int
    warnings: list[str]


def generate(request_text: str, *, seed: int | None, fallback: bool, settings: Settings) -> GenerateOutcome:
    """Generate (or load the fixture), validate, expand and replace the stored scenario.

    Raises ValueError for a blank request or an invalid plan (the message is the reason), and lets
    `GenerationUnavailable` / `GenerationFailed` through. A rejection leaves the store untouched."""
    if not request_text or not request_text.strip():
        raise ValueError("request_text is empty")
    seed = random.getrandbits(32) if seed is None else seed
    contract = load_contract(settings.contract_path)
    if fallback:
        plan = load_fixture()
    else:
        result = haiku.generate_plan(request_text, contract, model=settings.model)
        if result.kind == "rejection" or result.plan is None:
            return GenerateOutcome("rejection", None, result.reason or "request rejected", seed, [])
        plan = result.plan
    errors = validate_plan(plan)
    if errors:
        raise ValueError("; ".join(errors))
    timeline = expand(plan, contract, seed=seed, start_date=settings.start_date)
    conn = connect(settings.db_path)
    try:
        load_scenario(
            conn, plan=plan, contract=contract, timeline=timeline, request_text=request_text,
            seed=seed, start_date=settings.start_date,
        )  # fmt: skip
    finally:
        conn.close()
    return GenerateOutcome("plan", plan, None, seed, timeline.warnings)
