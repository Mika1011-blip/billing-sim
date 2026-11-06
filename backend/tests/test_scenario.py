import json

import pytest
from pydantic import ValidationError

from billing_sim.billing.policy import lot_price
from billing_sim.scenario.fixture import FIXTURES_DIR, load_fixture
from billing_sim.scenario.prompts import SYSTEM_PROMPT_FR
from billing_sim.scenario.schema import GenerationResult, ScenarioPlan, TicketPlan
from billing_sim.scenario.validate import validate_plan


def _ticket(plan: ScenarioPlan, key: str) -> TicketPlan:
    return next(t for t in plan.tickets if t.key == key)


def fixture_dict() -> dict:
    return json.loads((FIXTURES_DIR / "invoice_dashboard.json").read_text(encoding="utf-8"))


def test_fixture_loads_and_is_valid():
    plan = load_fixture()
    assert validate_plan(plan) == []


def test_fixture_lot1_prices_to_3000(contract):
    plan = load_fixture()
    l1 = [
        (t.size, t.profile, t.charged_separately)
        for t in plan.tickets
        if t.lot_key == "L1"
    ]
    assert lot_price(contract, l1) == 3000


def test_fixture_has_exactly_one_separately_charged_ticket():
    plan = load_fixture()
    separate = [t for t in plan.tickets if t.lot_key is None]
    assert [t.key for t in separate] == ["BANK-12"]
    assert separate[0].charged_separately is True


def test_duplicate_ticket_key_reported():
    plan = load_fixture().model_copy(deep=True)
    plan.tickets[1].key = "BANK-1"
    errors = validate_plan(plan)
    assert any("BANK-1" in e and "duplicate" in e.lower() for e in errors)


def test_duplicate_lot_key_reported():
    plan = load_fixture().model_copy(deep=True)
    plan.lots[1].key = plan.lots[0].key
    errors = validate_plan(plan)
    assert any("duplicate lot key" in e and plan.lots[0].key in e for e in errors)


def test_duplicate_team_name_reported():
    plan = load_fixture().model_copy(deep=True)
    plan.team[1].name = plan.team[0].name
    errors = validate_plan(plan)
    assert any("duplicate team member" in e and plan.team[0].name in e for e in errors)


def test_unknown_lot_key_reported():
    plan = load_fixture().model_copy(deep=True)
    _ticket(plan, "BANK-3").lot_key = "L9"
    errors = validate_plan(plan)
    assert any("BANK-3" in e and "L9" in e for e in errors)


def test_unknown_dependency_reported():
    plan = load_fixture().model_copy(deep=True)
    _ticket(plan, "BANK-3").depends_on = ["BANK-99"]
    errors = validate_plan(plan)
    assert any("BANK-3" in e and "BANK-99" in e for e in errors)


def test_self_dependency_reported():
    plan = load_fixture().model_copy(deep=True)
    _ticket(plan, "BANK-3").depends_on = ["BANK-3"]
    errors = validate_plan(plan)
    assert any("BANK-3" in e and "itself" in e for e in errors)


def test_cycle_reported():
    plan = load_fixture().model_copy(deep=True)
    _ticket(plan, "BANK-1").depends_on = ["BANK-2"]  # BANK-2 already depends on BANK-1
    errors = validate_plan(plan)
    cycle_errors = [e for e in errors if "cycle" in e.lower()]
    assert cycle_errors
    assert "BANK-1" in cycle_errors[0] and "BANK-2" in cycle_errors[0]


def test_fixture_has_steps_and_summaries():
    plan = load_fixture()
    assert all(2 <= len(t.steps) <= 8 for t in plan.tickets)
    assert all(lot.delivery_summary.strip() for lot in plan.lots)
    assert not hasattr(plan, "client_behaviour")


def test_fixture_texts_carry_no_day_counts_or_prices():
    plan = load_fixture()
    texts = [step for t in plan.tickets for step in t.steps] + [lot.delivery_summary for lot in plan.lots]
    assert all(not any(ch.isdigit() for ch in text) and "€" not in text for text in texts)
    assert all(1 <= len(step.strip()) <= 160 for t in plan.tickets for step in t.steps)


def test_ticket_without_steps_is_rejected():
    data = fixture_dict()
    data["tickets"][0].pop("steps")
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


@pytest.mark.parametrize("steps", [["Une seule étape."], [f"Étape {i}." for i in range(9)]])
def test_step_count_outside_two_to_eight_is_rejected(steps):
    data = fixture_dict()
    data["tickets"][0]["steps"] = steps
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


def test_lot_without_delivery_summary_is_rejected():
    data = fixture_dict()
    data["lots"][0].pop("delivery_summary")
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


def test_client_behaviour_is_no_longer_accepted():
    data = fixture_dict()
    data["client_behaviour"] = [{"invoice_index": 1, "pays_fraction": 1.0, "days_late": 0}]
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


def test_blank_step_and_blank_summary_messages():
    data = fixture_dict()
    data["tickets"][0]["steps"][0] = "  "
    data["lots"][0]["delivery_summary"] = " "
    errors = validate_plan(ScenarioPlan.model_validate(data))  # model-level: strip happens in the validator
    assert "ticket BANK-1 : étape vide" in errors and "lot L1 : résumé de livraison vide" in errors


def test_overlong_step_reported_after_strip():
    data = fixture_dict()
    data["tickets"][0]["steps"][0] = "x" * 161
    data["tickets"][0]["steps"][1] = "  " + "x" * 160 + "  "  # 160 once stripped: fine
    errors = validate_plan(ScenarioPlan.model_validate(data))
    assert [e for e in errors if "BANK-1" in e] == ["ticket BANK-1 : étape trop longue (160 caractères au plus)"]


def test_overlong_delivery_summary_is_rejected():
    data = fixture_dict()
    data["lots"][0]["delivery_summary"] = "x" * 601
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


def test_prompt_mentions_steps_and_summary_not_behaviour():
    text = SYSTEM_PROMPT_FR
    assert "steps" in text and "delivery_summary" in text and "client_behaviour" not in text
    assert "pays_fraction" not in text and "days_late" not in text


def test_blocked_beat_requires_duration():
    plan = load_fixture().model_copy(deep=True)
    beat = _ticket(plan, "BANK-5").beats[0]
    assert beat.kind == "blocked"
    beat.duration_days = None
    errors = validate_plan(plan)
    assert any("BANK-5" in e and "duration_days" in e for e in errors)


def test_generation_result_rejection():
    result = GenerationResult(kind="rejection", reason="x")
    assert result.plan is None and result.reason == "x"


def test_schema_forbids_extra_fields():
    data = load_fixture().model_dump()
    data["tickets"][0]["price"] = 1800
    with pytest.raises(ValidationError):
        ScenarioPlan.model_validate(data)


def test_cycle_message_excludes_tickets_merely_downstream_of_it():
    plan = load_fixture().model_copy(deep=True)
    _ticket(plan, "BANK-1").depends_on = ["BANK-2"]  # cycle BANK-1 <-> BANK-2; BANK-3 depends on BANK-1
    cycle_error = next(e for e in validate_plan(plan) if "cycle" in e.lower())
    assert "BANK-3" not in cycle_error
