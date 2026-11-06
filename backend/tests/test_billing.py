from datetime import date

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


START = date(2026, 3, 2)  # a Monday


def test_due_day_is_30_calendar_days_rolled_to_monday(contract):
    # Day 0 = Mon 2026-03-02; +30 calendar days = Wed 2026-04-01 = day 22 (4 weeks * 5 + 2).
    assert due_day(contract, 0, START) == 22
    # Day 4 = Fri 2026-03-06; +30 = Sun 2026-04-05, rolled to Mon 2026-04-06 = day 25 (5 weeks * 5 + 0).
    assert due_day(contract, 4, START) == 25


def test_unknown_size_raises(contract):
    with pytest.raises(ValueError):
        days_for_size(contract, "XXL")
