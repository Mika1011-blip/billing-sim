"""Plan generation with Haiku. Stub until Task 10: it only reports whether a key is configured."""

from __future__ import annotations

import os

from billing_sim.billing.policy import Contract
from billing_sim.scenario.schema import GenerationResult


class GenerationUnavailable(Exception):
    """Generation cannot run at all (no API key); the caller should offer the fallback fixture."""


class GenerationFailed(Exception):
    """The model answered but not with a usable plan; `raw` is what it said."""

    raw: str = ""


def api_key_from_env() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY") or None


def generate_plan(request_text: str, contract: Contract, *, client=None, model: str) -> GenerationResult:
    if client is None and api_key_from_env() is None:
        raise GenerationUnavailable("ANTHROPIC_API_KEY not set")
    raise NotImplementedError("Haiku generation arrives in Task 10")
