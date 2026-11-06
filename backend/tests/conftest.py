from datetime import date

import pytest

from billing_sim.billing.policy import load_contract
from billing_sim.expander.expand import expand
from billing_sim.scenario.fixture import load_fixture


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
