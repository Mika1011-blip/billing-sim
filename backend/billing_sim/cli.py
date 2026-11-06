"""Command line: `python -m billing_sim.cli load | day N | summary [--day N] | snapshot PATH`. Every command prints JSON."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from billing_sim.billing.policy import load_contract
from billing_sim.engine.clock import get_day, last_day, set_day, state
from billing_sim.expander.expand import expand
from billing_sim.scenario.fixture import load_fixture
from billing_sim.store.db import NotFound, connect
from billing_sim.store.dev_queries import diff_plan_vs_real, full_plan, full_timeline
from billing_sim.store.load import load_scenario
from billing_sim.store.queries import summary, today

DEFAULT_DB = "./sim.sqlite"
DEFAULT_START = "2026-03-02"
FIXTURE_REQUEST = "Scénario de démonstration : tableau de bord de factures (fixture)."


def snapshot_data() -> dict:
    """What the dev page loads from the real backend, for the fallback scenario (seed 42) with the clock on its last
    day. The frontend tests render from this, so a change to a dev route's keys cannot go unnoticed there."""
    plan, contract = load_fixture(), load_contract()
    start = date.fromisoformat(DEFAULT_START)
    timeline = expand(plan, contract, seed=42, start_date=start)
    conn = connect(":memory:")
    try:
        load_scenario(
            conn, plan=plan, contract=contract, timeline=timeline, request_text=FIXTURE_REQUEST,
            seed=42, start_date=start,
        )  # fmt: skip
        set_day(conn, last_day(conn))
        return {
            "plan": full_plan(conn),
            "timeline": full_timeline(conn),
            "diff": diff_plan_vs_real(conn),
            "clock": state(conn),
        }
    finally:
        conn.close()


def write_snapshot(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(snapshot_data(), ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="billing_sim.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def command(name: str, help_text: str) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--db", default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
        return p

    load = command("load", "wipe the store and load the fallback fixture")
    load.add_argument("--seed", type=int, default=42)
    load.add_argument("--start-date", type=date.fromisoformat, default=date.fromisoformat(DEFAULT_START),
                      help="calendar date of day 0, a Monday (default %(default)s)")  # fmt: skip

    day = command("day", "set the clock (clamped to the run)")
    day.add_argument("n", type=int)

    snap = sub.add_parser("snapshot", help="write the dev-page snapshot the frontend tests render from")
    snap.add_argument("path", type=Path)

    show = command("summary", "print the as-of summary")
    show.add_argument("--day", type=int, default=None, help="default: the clock's day")
    return parser


def _run(args: argparse.Namespace) -> dict:
    if args.command == "snapshot":
        write_snapshot(args.path)
        return {"snapshot": str(args.path)}
    conn = connect(args.db)
    try:
        if args.command == "load":
            plan, contract = load_fixture(), load_contract()
            timeline = expand(plan, contract, seed=args.seed, start_date=args.start_date)
            load_scenario(
                conn, plan=plan, contract=contract, timeline=timeline, request_text=FIXTURE_REQUEST,
                seed=args.seed, start_date=args.start_date,
            )  # fmt: skip
            return {
                "seed": args.seed,
                "start_date": args.start_date.isoformat(),
                "tickets": len(timeline.tickets),
                "invoices": len(timeline.invoices),
                "last_day": last_day(conn),
                "warnings": timeline.warnings,
            }
        if args.command == "day":
            return today(conn, set_day(conn, args.n))
        return summary(conn, get_day(conn) if args.day is None else args.day)
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        result = _run(args)
    except (NotFound, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
