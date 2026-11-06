"""Working-day index <-> calendar date. Day 0 is `start_date` (a Monday); Sat/Sun are skipped."""

from __future__ import annotations

from datetime import date, timedelta


def _check_monday(start_date: date) -> None:
    if start_date.weekday() != 0:
        raise ValueError(f"start_date must be a Monday, got {start_date.isoformat()}")


def date_for_day(start_date: date, day: int) -> date:
    _check_monday(start_date)
    if day < 0:
        raise ValueError(f"day must be >= 0, got {day}")
    weeks, weekday = divmod(day, 5)
    return start_date + timedelta(days=7 * weeks + weekday)


def day_for_date(start_date: date, d: date) -> int:
    """Inverse of `date_for_day`; weekends and dates before `start_date` have no working day."""
    _check_monday(start_date)
    if d < start_date:
        raise ValueError(f"{d.isoformat()} is before start_date {start_date.isoformat()}")
    if d.weekday() >= 5:
        raise ValueError(f"{d.isoformat()} is a weekend, not a working day")
    return ((d - start_date).days // 7) * 5 + d.weekday()


def first_working_day_on_or_after(start_date: date, d: date) -> int:
    """Working-day index of `d`, or of the Monday after it when `d` falls on a weekend."""
    return day_for_date(start_date, d + timedelta(days=(7 - d.weekday()) % 7 if d.weekday() >= 5 else 0))
