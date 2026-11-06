from datetime import date

import pytest

from billing_sim.billing.policy import load_contract
from billing_sim.expander.expand import expand
from billing_sim.scenario.fixture import load_fixture
from billing_sim.store.db import connect
from billing_sim.store.load import load_scenario


@pytest.fixture
def contract():
    return load_contract()


START = date(2026, 3, 2)  # a Monday


@pytest.fixture
def plan():
    return load_fixture()


@pytest.fixture
def timeline(plan, contract):
    return expand(plan, contract, seed=42, start_date=START)


@pytest.fixture
def conn(plan, contract, timeline):
    """In-memory store with the fallback fixture loaded (seed 42, start 2026-03-02), clock at day 0."""
    connection = connect(":memory:")
    load_scenario(
        connection,
        plan=plan,
        contract=contract,
        timeline=timeline,
        request_text="Un tableau de bord pour suivre les factures fournisseurs.",
        seed=42,
        start_date=START,
    )
    yield connection
    connection.close()


@pytest.fixture(autouse=True)
def hermetic_env(tmp_path, monkeypatch):
    """No test sees a real `.env` or API key from the machine running it."""
    monkeypatch.setenv("BILLING_SIM_ENV_FILE", str(tmp_path / "no.env"))
    for name in ("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
