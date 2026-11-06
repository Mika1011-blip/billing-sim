"""Hand-written fallback scenarios, used when generation fails and in tests."""

from __future__ import annotations

from pathlib import Path

from billing_sim.scenario.schema import ScenarioPlan

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str = "invoice_dashboard") -> ScenarioPlan:
    path = FIXTURES_DIR / f"{name}.json"
    return ScenarioPlan.model_validate_json(path.read_text(encoding="utf-8"))
