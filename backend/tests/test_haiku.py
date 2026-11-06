import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from pydantic import ValidationError

from billing_sim.scenario import haiku
from billing_sim.scenario.fixture import load_fixture
from billing_sim.scenario.haiku import GenerationFailed, GenerationUnavailable, generate_plan
from billing_sim.scenario.prompts import system_prompt_fr
from billing_sim.scenario.schema import GenerationResult
from billing_sim.scenario.validate import validate_plan


class FakeClient:
    """Stands in for `anthropic.Anthropic`: replays `outcomes` (results or exceptions) from `messages.parse`."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(parse=self._parse)

    def _parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def reply(result: GenerationResult, raw: str | None = None):
    text = raw if raw is not None else result.model_dump_json()
    return SimpleNamespace(parsed_output=result, content=[SimpleNamespace(type="text", text=text)])


def valid_result() -> GenerationResult:
    return GenerationResult(kind="plan", plan=load_fixture())


def cyclic_result() -> GenerationResult:
    plan = load_fixture().model_copy(deep=True)
    first, second = plan.tickets[0], plan.tickets[1]
    first.depends_on = [second.key]
    second.depends_on = [first.key]
    assert validate_plan(plan)
    return GenerationResult(kind="plan", plan=plan)


def test_plan_returned(contract):
    client = FakeClient(reply(valid_result()))
    result = generate_plan("Un portail de suivi des factures", contract, client=client)
    assert result.kind == "plan" and result.plan is not None
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_format"] is GenerationResult
    assert call["max_tokens"] == 16000
    assert "tool_choice" not in call
    assert "Un portail de suivi des factures" in call["messages"][0]["content"]
    assert call["messages"][0]["role"] == "user"


def test_system_prompt_embeds_contract(contract):
    client = FakeClient(reply(valid_result()))
    generate_plan("x", contract, client=client, model="m")
    system = client.calls[0]["system"]
    assert client.calls[0]["model"] == "m"
    assert system == system_prompt_fr(contract)
    assert json.dumps(contract.to_dict(), sort_keys=True, ensure_ascii=False) in system
    for needle in ("BANK-", "L1", "rejection", "blocked", "review_changes", "steps", "delivery_summary"):
        assert needle in system
    assert "client_behaviour" not in system


def test_rejection_returned(contract):
    rejection = GenerationResult(kind="rejection", reason="Aucun projet logiciel identifiable.")
    client = FakeClient(reply(rejection))
    result = generate_plan("bonjour", contract, client=client)
    assert result.kind == "rejection"
    assert result.reason == "Aucun projet logiciel identifiable."
    assert len(client.calls) == 1


def test_retry_on_invalid_then_success(contract):
    bad_raw = '{"kind": "plan", "cyclic": true}'
    client = FakeClient(reply(cyclic_result(), raw=bad_raw), reply(valid_result()))
    result = generate_plan("Un portail", contract, client=client)
    assert result.kind == "plan"
    assert len(client.calls) == 2
    assert len(client.calls[0]["messages"]) == 1
    second = client.calls[1]["messages"]
    assert len(second) == 3
    assert second[1] == {"role": "assistant", "content": bad_raw}
    assert second[2]["role"] == "user"
    assert second[2]["content"].startswith("Le plan précédent est invalide : ")
    assert second[2]["content"].endswith("Renvoie un plan corrigé.")
    assert "cycle" in second[2]["content"]


def test_retry_when_parse_raises_validation_error(contract):
    with pytest.raises(ValidationError) as excinfo:
        GenerationResult.model_validate({"kind": "nope"})
    client = FakeClient(excinfo.value, reply(valid_result()))
    result = generate_plan("Un portail", contract, client=client)
    assert result.kind == "plan"
    assert len(client.calls) == 2
    assert client.calls[1]["messages"][-1]["content"].startswith("Le plan précédent est invalide : ")


def test_failed_after_two(contract):
    client = FakeClient(reply(cyclic_result(), raw="first"), reply(cyclic_result(), raw="second raw"))
    with pytest.raises(GenerationFailed) as excinfo:
        generate_plan("Un portail", contract, client=client)
    assert excinfo.value.raw == "second raw"
    assert len(client.calls) == 2


def test_failed_when_second_parse_raises(contract):
    with pytest.raises(ValidationError) as excinfo:
        GenerationResult.model_validate({"kind": "nope"})
    client = FakeClient(reply(cyclic_result()), excinfo.value)
    with pytest.raises(GenerationFailed) as failure:
        generate_plan("Un portail", contract, client=client)
    assert failure.value.raw


def test_plan_kind_without_plan_is_invalid(contract):
    empty = GenerationResult(kind="plan", plan=None)
    client = FakeClient(reply(empty), reply(valid_result()))
    assert generate_plan("x", contract, client=client).kind == "plan"
    assert len(client.calls) == 2


def test_no_key_unavailable(contract):
    with pytest.raises(GenerationUnavailable):
        generate_plan("x", contract)


def test_api_key_builds_client(contract, monkeypatch):
    seen = {}
    fake = FakeClient(reply(valid_result()))

    def factory(**kwargs):
        seen.update(kwargs)
        return fake

    monkeypatch.setattr(haiku.anthropic, "Anthropic", factory)
    assert generate_plan("x", contract, api_key="sk-test").kind == "plan"
    assert seen == {"api_key": "sk-test"}


def _sdk_errors():
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(429, request=request)
    return [
        anthropic.RateLimitError("slow down", response=response, body=None),
        anthropic.APIConnectionError(request=request),
    ]


@pytest.mark.parametrize("error", _sdk_errors(), ids=lambda e: type(e).__name__)
def test_sdk_error_becomes_generation_failed(contract, error):
    client = FakeClient(error)
    with pytest.raises(GenerationFailed) as excinfo:
        generate_plan("x", contract, client=client)
    assert str(excinfo.value) == "Appel au modèle impossible"
    assert excinfo.value.raw == str(error)
    assert len(client.calls) == 1
