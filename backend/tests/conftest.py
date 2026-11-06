import pytest

from billing_sim.billing.policy import load_contract


@pytest.fixture
def contract():
    return load_contract()
