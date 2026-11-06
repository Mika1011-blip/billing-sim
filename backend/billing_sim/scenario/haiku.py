"""Plan generation with Haiku. Stub until Task 10: it only reports whether a key is configured."""

from __future__ import annotations

from billing_sim.billing.policy import Contract
from billing_sim.scenario.schema import GenerationResult


class GenerationUnavailable(Exception):
    """Generation cannot run at all (no API key); the caller should offer the fallback fixture."""


class GenerationFailed(Exception):
    """The model answered but not with a usable plan; `raw` is what it said."""

    def __init__(self, raw: str, message: str = "Haiku returned an invalid plan twice"):
        super().__init__(message)
        self.raw = raw


def generate_plan(
    request_text: str, contract: Contract, *, client=None, model: str, api_key: str | None = None
) -> GenerationResult:
    """The key comes from `Settings` (never read from the environment here)."""
    if client is None and api_key is None:
        raise GenerationUnavailable("no API key configured")
    raise NotImplementedError("Haiku generation arrives in Task 10")
