"""Plan generation with Haiku: one structured call, one corrective retry on an invalid plan."""

from __future__ import annotations

import anthropic
from pydantic import ValidationError

from billing_sim.billing.policy import Contract
from billing_sim.scenario.prompts import system_prompt_fr
from billing_sim.scenario.schema import GenerationResult
from billing_sim.scenario.validate import validate_plan

MAX_TOKENS = 16000
_UNPARSEABLE = "(réponse non conforme au schéma)"


class GenerationUnavailable(Exception):
    """Generation cannot run at all (no API key); the caller should offer the fallback fixture."""


class GenerationFailed(Exception):
    """The model answered but not with a usable plan; `raw` is what it said."""

    def __init__(self, raw: str, message: str = "Haiku returned an invalid plan twice"):
        super().__init__(message)
        self.raw = raw


def build_user_message(request_text: str) -> str:
    return f"Demande du client :\n{request_text.strip()}"


def correction_message(errors: list[str]) -> str:
    return f"Le plan précédent est invalide : {'; '.join(errors)}. Renvoie un plan corrigé."


def generate_plan(
    request_text: str,
    contract: Contract,
    *,
    client: anthropic.Anthropic | None = None,
    model: str = "claude-haiku-5-5",
    api_key: str | None = None,
) -> GenerationResult:
    """The key comes from `Settings` (never read from the environment here)."""
    if client is None:
        if not api_key:
            raise GenerationUnavailable("no API key configured")
        client = anthropic.Anthropic(api_key=api_key)

    system = system_prompt_fr(contract)
    messages: list[dict] = [{"role": "user", "content": build_user_message(request_text)}]

    result, raw, errors = _attempt(client, model, system, messages)
    if not errors:
        return result  # type: ignore[return-value]

    retry = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": correction_message(errors)}]
    result, raw, errors = _attempt(client, model, system, retry)
    if errors:
        raise GenerationFailed(raw=raw)
    return result  # type: ignore[return-value]


def _attempt(
    client: anthropic.Anthropic, model: str, system: str, messages: list[dict]
) -> tuple[GenerationResult | None, str, list[str]]:
    """One call: (result, raw text, problems). A rejection has no problems and is final."""
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=messages,
            output_format=GenerationResult,
        )
    except ValidationError as error:
        problems = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors()[:5]]
        return None, _UNPARSEABLE, ["réponse non conforme au schéma (" + "; ".join(problems) + ")"]
    except anthropic.APIError as error:  # auth, rate limit, status and connection errors
        raise GenerationFailed(raw=str(error), message="Appel au modèle impossible") from error

    raw = next((block.text for block in response.content if block.type == "text"), "") or _UNPARSEABLE
    result: GenerationResult | None = response.parsed_output
    if result is None:
        return None, raw, ["la réponse n'a pas pu être interprétée"]
    if result.kind == "rejection":
        return result, raw, []
    if result.plan is None:
        return None, raw, ['kind = "plan" sans plan']
    return result, raw, validate_plan(result.plan)
