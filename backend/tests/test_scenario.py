import pytest
from pydantic import ValidationError

from billing_sim.billing.policy import lot_price
from billing_sim.scenario.fixture import load_fixture
from billing_sim.scenario.schema import GenerationResult, ScenarioPlan, TicketPlan
from billing_sim.scenario.validate import validate_plan


def _ticket(plan: ScenarioPlan, key: str) -> TicketPlan:
    return next(t for t in plan.tickets if t.key == key)


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


def test_behaviour_must_cover_each_lot():
    plan = load_fixture().model_copy(deep=True)
    plan.client_behaviour = [b for b in plan.client_behaviour if b.invoice_index != 3]
    errors = validate_plan(plan)
    assert any("3" in e and "client_behaviour" in e for e in errors)


def test_behaviour_duplicate_index_reported():
    plan = load_fixture().model_copy(deep=True)
    plan.client_behaviour[2].invoice_index = 1
    assert validate_plan(plan) != []


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
