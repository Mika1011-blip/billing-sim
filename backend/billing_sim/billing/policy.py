"""Billing policy: the only place prices, day counts, VAT and due dates are computed."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Iterable, Literal

Profile = Literal["dev", "senior", "architect"]
Size = Literal["S", "M", "L", "XL"]

REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Contract:
    tjm: dict[str, int]
    rate_card: dict[str, int]
    hours_per_day: int
    payment_terms_days: int
    overrun_rule: str
    vat_rate: float
    currency: str
    invoice_timing: str  # "on_delivery" | "sprint_end"

    def to_dict(self) -> dict:
        return asdict(self)


def load_contract(path: Path | None = None) -> Contract:
    if path is None:
        env_path = os.environ.get("CONTRACT_TEMPLATE_PATH")
        path = Path(env_path) if env_path else REPO_ROOT / "contract_template.json"
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return Contract(**data)


def days_for_size(contract: Contract, size: str) -> int:
    try:
        return contract.rate_card[size]
    except KeyError:
        raise ValueError(f"unknown size: {size!r}") from None


def ticket_fee(contract: Contract, size: str, profile: str) -> int:
    days = days_for_size(contract, size)
    try:
        tjm = contract.tjm[profile]
    except KeyError:
        raise ValueError(f"unknown profile: {profile!r}") from None
    return days * tjm


def lot_price(contract: Contract, tickets: Iterable[tuple[str, str, bool]]) -> int:
    """Sum of ticket fees; tickets charged separately are excluded from the lot."""
    return sum(
        ticket_fee(contract, size, profile)
        for size, profile, charged_separately in tickets
        if not charged_separately
    )


def vat_amount(contract: Contract, amount_ht: int) -> int:
    vat = Decimal(amount_ht) * Decimal(str(contract.vat_rate))
    return int(vat.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def invoice_total(contract: Contract, amount_ht: int) -> tuple[int, int]:
    vat = vat_amount(contract, amount_ht)
    return vat, amount_ht + vat


def due_day(contract: Contract, issued_day: int) -> int:
    return issued_day + contract.payment_terms_days
