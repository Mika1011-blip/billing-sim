import pytest

from billing_sim.billing.policy import (
    days_for_size,
    due_day,
    invoice_total,
    lot_price,
    ticket_fee,
    vat_amount,
)


def test_ticket_fee_medium_dev(contract):
    assert ticket_fee(contract, "M", "dev") == 1800


def test_ticket_fee_small_dev(contract):
    assert ticket_fee(contract, "S", "dev") == 600


def test_guideline_lot_is_3000(contract):
    assert lot_price(contract, [("M", "dev", False), ("S", "dev", False), ("S", "dev", False)]) == 3000


def test_separate_charge_excluded(contract):
    assert lot_price(contract, [("M", "dev", False), ("L", "senior", True)]) == 1800


def test_invoice_total(contract):
    assert invoice_total(contract, 3000) == (600, 3600)


def test_vat_rounds_half_up(contract):
    assert vat_amount(contract, 1) == 0 and vat_amount(contract, 3) == 1


def test_due_day(contract):
    assert due_day(contract, 10) == 40


def test_unknown_size_raises(contract):
    with pytest.raises(ValueError):
        days_for_size(contract, "XXL")
