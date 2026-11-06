# billing-sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, deterministic simulation of a fixed-price agile dev engagement (contract → tickets/lots → Jira-like timeline → invoices → payments) with a French client dashboard, a dev page, two MCP servers and a Claude client agent, all from `docker compose up` plus one API key.

**Architecture:** Haiku is called once at setup to produce a compact `ScenarioPlan`; pure code prices it from `contract_template.json`, expands it into a seeded day-by-day timeline, and loads it into SQLite. Every timeline row carries a `day`; the clock only moves a `WHERE day <= D` boundary. The client MCP server exposes past-only tools (no day parameter exists); the manager MCP server exposes generation, clock and full inspection. FastAPI wraps both for the React pages.

**Tech Stack:** Python 3.12, FastAPI, SQLite (stdlib `sqlite3`), Pydantic v2, `anthropic` SDK (1.x), `mcp` SDK (`mcp.server.fastmcp.FastMCP`), pytest; React 18 + Vite + TypeScript, react-router-dom, vitest + @testing-library/react, Playwright (one e2e); Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-06-billing-sim-design.md`

## Global Constraints

- Model for generation and for the client agent: `claude-haiku-5-5` (configurable via `BILLING_SIM_MODEL` env, default Haiku).
- Haiku never produces a price or a day count: `days_charged` and `fee` are computed by `billing/` only.
- No MCP client tool, no `/client/*` route, and no `store/` as-of query accepts a day from the caller; the day comes from the clock.
- Same `(plan, contract, seed, start_date)` → byte-identical timeline.
- Everything the client sees is French: statuses `À faire`, `En cours`, `Bloqué`, `En revue`, `Terminé`; invoice statuses `Émise`, `Payée partiellement`, `Payée`, `En retard`; lot invoice state `À venir` when no invoice yet. Dev page and code are English.
- Money is integer euros; VAT rounds half-up. `day` is a working-day index from signature (day 0 = Monday `start_date`); sprints are 10 working days.
- Contract template values: TJM dev 600 / senior 750 / architect 900; rate card S 1 / M 3 / L 5 / XL 10; `hours_per_day` 8; `payment_terms_days` 30; `overrun_rule` `"absorbed"`; `vat_rate` 0.20; `currency` `"EUR"`; `invoice_timing` `"on_delivery"`.
- Guideline example must reproduce: lot "Tableau de bord factures" = 3 000 € HT.
- Repo-wide test command: `bash scripts/test.sh` (backend pytest, then frontend vitest when `frontend/` exists). A task is done only when it passes on its branch.

## Review Focus

1. Blank or whitespace-only request text → `/setup/generate` returns 422 without calling Haiku (test in Task 5).
2. A ticket that depends on itself, or a two-ticket cycle → validation error naming the ticket, never an infinite loop in the expander (test in Task 2).
3. `pays_fraction = 1.0` → exactly one payment, no zero-amount remainder row (test in Task 3).
4. Clock at day 0 → summary shows the contracted total and zero invoiced/paid; nothing from day 1+ leaks (test in Task 4).
5. Chat request when no scenario is loaded → a French error event, not a 500 (test in Task 9).

## Execution cadence (project owner's rules)

- Branch per task: `task/NN-<name>` from `develop` (create `develop` from `main` before Task 1). Worktree per task under `.worktrees/<branch>` (gitignored) via `superpowers:using-git-worktrees`; a subagent implements the task in that worktree.
- When the task's steps are done: run `bash scripts/test.sh` in the worktree. Green → merge `task/NN` into `develop` (no fast-forward), run `bash scripts/test.sh` on `develop`. Green → merge `develop` into `main` (no fast-forward), run `bash scripts/test.sh` on `main`, push `main` and `develop`. Red at any stage → fix on the task branch, repeat.
- Every task's last step appends a row to `buildlog.md` (`| date | branch | change | verification |`), and each merge appends a row too (branch = `develop` or `main`, verification = the test command and result). The buildlog row is committed with the task.
- Commits: conventional prefix (`feat:`, `test:`, `chore:`), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

```
billing-sim/
  contract_template.json
  scripts/test.sh
  buildlog.md
  backend/
    pyproject.toml
    billing_sim/
      __init__.py
      billing/policy.py            Contract dataclass, pricing functions
      scenario/schema.py           Pydantic: ScenarioPlan, Rejection, GenerationResult
      scenario/validate.py         validate_plan(plan) -> list[str]
      scenario/fixture.py          load_fixture(name) -> ScenarioPlan
      scenario/fixtures/invoice_dashboard.json
      scenario/prompts.py          SYSTEM_PROMPT_FR (Task 10)
      scenario/haiku.py            generate_plan(...) (stub in Task 5, real in Task 10)
      expander/calendar.py         working-day <-> date
      expander/schedule.py         topo order, planned and real schedules
      expander/events.py           daily ticket events
      expander/invoicing.py        invoices, approvals, payments
      expander/expand.py           expand(...) -> Timeline, dataclasses
      store/schema.sql
      store/db.py                  connect, wipe
      store/load.py                load_scenario
      store/queries.py             as-of queries (client side)
      store/dev_queries.py         full queries (dev side)
      engine/clock.py              get_day, set_day, step, last_day
      mcp_client/server.py         FastMCP, past-only tools
      mcp_manager/pipeline.py      generate(...)
      mcp_manager/server.py        FastMCP, control tools
      agent/prompt.py              SYSTEM_PROMPT_FR
      agent/tools.py               MCP tools -> Anthropic tool defs + dispatch
      agent/loop.py                ClientAgent
      api/app.py                   create_app()
      api/deps.py                  settings, connection per request
      api/routes_setup.py, routes_sim.py, routes_dev.py, routes_client.py, routes_chat.py
      cli.py
    tests/conftest.py              fixtures: contract, plan, timeline, loaded in-memory conn
    tests/test_*.py
  frontend/
    package.json, vite.config.ts, tsconfig.json, index.html
    src/main.tsx, src/App.tsx, src/api.ts, src/types.ts
    src/i18n/fr.ts
    src/pages/DevPage.tsx, src/pages/ClientPage.tsx
    src/components/dev/{SetupPanel,ClockPanel,Gantt,Ledger}.tsx
    src/components/client/{Header,SummaryTiles,LotCard,InvoiceList,PendingApprovals,Assistant}.tsx
    e2e/demo.spec.ts, playwright.config.ts
  backend/Dockerfile, frontend/Dockerfile, docker-compose.yml, .env.example, README.md
```

---

### Task 0: Branch setup (no worktree, on `main`)

- [ ] **Step 1:** `git checkout -b develop && git push -u origin develop && git checkout main`
- [ ] **Step 2:** Append to `buildlog.md`: `| 2026-11-06 | develop | Created integration branch develop from main | n/a |`, commit on `main`, push, merge `main` into `develop`.

---

### Task 1: Scaffold + billing policy

**Files:**
- Create: `backend/pyproject.toml`, `backend/billing_sim/__init__.py`, `backend/billing_sim/billing/__init__.py`, `backend/billing_sim/billing/policy.py`, `contract_template.json`, `scripts/test.sh`, `backend/tests/__init__.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_billing.py`

**Interfaces:**
- Produces, in `billing_sim.billing.policy`:
  ```python
  Profile = Literal["dev", "senior", "architect"]; Size = Literal["S", "M", "L", "XL"]
  @dataclass(frozen=True)
  class Contract:
      tjm: dict[str, int]; rate_card: dict[str, int]; hours_per_day: int
      payment_terms_days: int; overrun_rule: str; vat_rate: float
      currency: str; invoice_timing: str          # "on_delivery" | "sprint_end"
      def to_dict(self) -> dict
  def load_contract(path: Path | None = None) -> Contract   # default: $CONTRACT_TEMPLATE_PATH, else <repo root>/contract_template.json
  def days_for_size(contract: Contract, size: str) -> int   # ValueError on unknown size
  def ticket_fee(contract: Contract, size: str, profile: str) -> int   # days × tjm[profile]; ValueError on unknown profile
  def lot_price(contract: Contract, tickets: Iterable[tuple[str, str, bool]]) -> int   # (size, profile, charged_separately); excludes separately charged
  def vat_amount(contract: Contract, amount_ht: int) -> int   # round half up
  def invoice_total(contract: Contract, amount_ht: int) -> tuple[int, int]   # (vat, ttc)
  def due_day(contract: Contract, issued_day: int) -> int   # issued + payment_terms_days
  ```
- `scripts/test.sh`: runs `cd backend && python -m pytest -q`; then, if `frontend/package.json` exists, `cd frontend && npm test -- --run`. Exits non-zero on any failure.

- [ ] **Step 1: Write `backend/pyproject.toml`** — project `billing-sim`, Python `>=3.12`, deps `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `anthropic>=1`, `mcp>=1.2`, `python-dotenv`; optional `dev`: `pytest`, `pytest-asyncio`, `httpx`, `ruff`. `[tool.pytest.ini_options] testpaths = ["tests"]`, `asyncio_mode = "auto"`. Build backend `hatchling`, packages `["billing_sim"]`.
- [ ] **Step 2: Write `contract_template.json`** with the Global Constraints values, keys exactly as the `Contract` fields.
- [ ] **Step 3: Write the failing tests** in `backend/tests/test_billing.py`:
  ```python
  def test_ticket_fee_medium_dev(contract): assert ticket_fee(contract, "M", "dev") == 1800
  def test_ticket_fee_small_dev(contract): assert ticket_fee(contract, "S", "dev") == 600
  def test_guideline_lot_is_3000(contract):
      assert lot_price(contract, [("M","dev",False), ("S","dev",False), ("S","dev",False)]) == 3000
  def test_separate_charge_excluded(contract):
      assert lot_price(contract, [("M","dev",False), ("L","senior",True)]) == 1800
  def test_invoice_total(contract): assert invoice_total(contract, 3000) == (600, 3600)
  def test_vat_rounds_half_up(contract): assert vat_amount(contract, 1) == 0 and vat_amount(contract, 3) == 1
  def test_due_day(contract): assert due_day(contract, 10) == 40
  def test_unknown_size_raises(contract):
      with pytest.raises(ValueError): days_for_size(contract, "XXL")
  ```
  `conftest.py` provides `contract` = `load_contract()`.
- [ ] **Step 4: Run** `cd backend && python -m venv .venv && .venv/Scripts/pip install -e ".[dev]" && python -m pytest -q` → FAIL (import error).
- [ ] **Step 5: Implement `policy.py`** per the Interfaces block. Repo root = `Path(__file__).resolve().parents[3]`.
- [ ] **Step 6: Run** `python -m pytest -q` → 8 passed.
- [ ] **Step 7: Write `scripts/test.sh`**, run `bash scripts/test.sh` → exit 0.
- [ ] **Step 8: Buildlog row + commit** `feat: billing policy and contract template`.

---

### Task 2: Scenario schema, validation, fixture

**Files:**
- Create: `backend/billing_sim/scenario/__init__.py`, `schema.py`, `validate.py`, `fixture.py`, `fixtures/invoice_dashboard.json`
- Test: `backend/tests/test_scenario.py`

**Interfaces:**
- Consumes: `Contract` (Task 1) only for the test that prices the fixture.
- Produces, in `billing_sim.scenario.schema` (Pydantic v2, `extra="forbid"`):
  ```python
  class Beat(BaseModel): kind: Literal["blocked","review_changes","scope_note"]; text: str; duration_days: int | None = None
  class TeamMember(BaseModel): name: str; profile: Profile
  class LotPlan(BaseModel): key: str; name: str; description: str
  class TicketPlan(BaseModel): key: str; title: str; description: str; lot_key: str | None; charged_separately: bool = False; size: Size; profile: Profile; depends_on: list[str] = []; beats: list[Beat] = []
  class ClientBehaviour(BaseModel): invoice_index: int; pays_fraction: float = Field(ge=0, le=1); days_late: int = Field(ge=0)
  class ScenarioPlan(BaseModel): product_summary: str; team: list[TeamMember] = Field(min_length=3, max_length=5); lots: list[LotPlan] = Field(min_length=2, max_length=4); tickets: list[TicketPlan] = Field(min_length=12, max_length=30); client_behaviour: list[ClientBehaviour]
  class Rejection(BaseModel): reason: str
  class GenerationResult(BaseModel): kind: Literal["plan","rejection"]; plan: ScenarioPlan | None = None; reason: str | None = None
  ```
- `billing_sim.scenario.validate.validate_plan(plan: ScenarioPlan) -> list[str]` — empty list means valid. Checks: duplicate ticket keys; `lot_key` not in lots; `depends_on` key unknown or self; dependency cycle (message names the tickets in the cycle); `client_behaviour` has exactly one entry per lot index `1..len(lots)`; `blocked` beat without `duration_days >= 1`.
- `billing_sim.scenario.fixture.load_fixture(name: str = "invoice_dashboard") -> ScenarioPlan`.

- [ ] **Step 1: Write the fixture** `fixtures/invoice_dashboard.json`, French content, satisfying: `product_summary` describes an invoice-tracking dashboard for a bank; team 4 members (2 `dev`, 1 `senior`, 1 `architect`); lots `L1` "Tableau de bord factures", `L2` "Suivi des paiements", `L3` "Exports et notifications"; tickets `BANK-1` "Filtres du tableau de bord" M dev L1, `BANK-2` "Export CSV" S dev L1 depends_on BANK-1, `BANK-3` "Export PDF" S dev L1 depends_on BANK-1; at least 9 more tickets across L2/L3 with mixed sizes and profiles, including one `architect` XL and dependencies that cross lots; exactly one ticket with `lot_key: null, charged_separately: true` (`BANK-12`, S, senior, "Correctif urgent — calcul de TVA"); at least one `blocked` beat (`duration_days: 2`, text "En attente des accès à l'API bancaire") and one `review_changes` beat; `client_behaviour` `[{1, 0.3333, 0}, {2, 1.0, 12}, {3, 0.5, 20}]`.
- [ ] **Step 2: Write the failing tests** in `test_scenario.py`:
  ```python
  def test_fixture_loads_and_is_valid(): plan = load_fixture(); assert validate_plan(plan) == []
  def test_fixture_lot1_prices_to_3000(contract): ...lot_price over L1 tickets == 3000
  def test_duplicate_ticket_key_reported(): errors mention "BANK-1"
  def test_unknown_lot_key_reported(): ...
  def test_self_dependency_reported(): ticket depends_on itself → error names it
  def test_cycle_reported(): A→B→A → error contains both keys
  def test_behaviour_must_cover_each_lot(): missing index 3 → error
  def test_blocked_beat_requires_duration(): ...
  def test_generation_result_rejection(): GenerationResult(kind="rejection", reason="x").plan is None
  ```
  Build the invalid plans by `plan.model_copy(deep=True)` of the fixture and mutating.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `schema.py`, `validate.py` (cycle detection: Kahn's algorithm; leftover nodes form the cycle), `fixture.py`. **Step 5: Run** → all pass. **Step 6:** `bash scripts/test.sh` green. **Step 7: Buildlog row + commit** `feat: scenario schema, validation and fallback fixture`.

---

### Task 3: Expander

**Files:**
- Create: `backend/billing_sim/expander/__init__.py`, `calendar.py`, `schedule.py`, `events.py`, `invoicing.py`, `expand.py`
- Test: `backend/tests/test_expander.py`
- Modify: `backend/tests/conftest.py` (add `plan` = fixture, `timeline` = `expand(plan, contract, seed=42, start_date=date(2026, 3, 2))`)

**Interfaces:**
- Consumes: `ScenarioPlan`, `validate_plan` (Task 2); `Contract`, `days_for_size`, `ticket_fee`, `lot_price`, `invoice_total`, `due_day` (Task 1).
- Produces, in `billing_sim.expander.expand` (all `@dataclass`):
  ```python
  class Sprint: number: int; start_day: int; end_day: int
  class ScheduledTicket: key: str; assignee: str; sprint_number: int; planned_start: int; planned_end: int; real_start: int; real_end: int; days_charged: int; fee: int
  class Event: ticket_key: str; day: int; seq: int; type: str; actor: str; payload: dict
  class Invoice: number: str; lot_key: str | None; ticket_key: str | None; issued_day: int; due_day: int; amount_ht: int; vat: int; amount_ttc: int; covers: list[str]
  class Payment: invoice_number: str; day: int; amount: int; reference: str
  class Approval: lot_key: str; day: int; approved_by: str
  class Timeline: sprints: list[Sprint]; tickets: list[ScheduledTicket]; events: list[Event]; invoices: list[Invoice]; payments: list[Payment]; approvals: list[Approval]; last_day: int; warnings: list[str]
  def expand(plan: ScenarioPlan, contract: Contract, seed: int, start_date: date) -> Timeline   # raises ValueError(errors) if validate_plan is non-empty
  ```
  `billing_sim.expander.calendar`: `date_for_day(start_date: date, day: int) -> date` (skips Sat/Sun; `start_date` must be a Monday, else ValueError), `day_for_date(start_date, d) -> int`.
  `billing_sim.expander.schedule`: `topo_order(plan) -> list[TicketPlan]` (ties: lot order, then key); `plan_schedule(plan, contract, order) -> dict[str, tuple[str, int, int]]` (assignee, start, end); `real_schedule(plan, contract, order, rng) -> dict[str, tuple[str, int, int]]`.
  `billing_sim.expander.events.ticket_events(ticket, sched, contract, team, rng) -> list[Event]`.
  `billing_sim.expander.invoicing.build_invoices(plan, contract, tickets, sprints, start_date) -> tuple[list[Invoice], list[Approval], list[Payment]]`.

Rules the signatures do not determine (from the spec, pinned here):
- Assignment: team member of the ticket's profile with the earliest free day; none of that profile → nearest profile in order `dev → senior → architect → senior → dev`, and append `f"{key}: no {profile} available, assigned to {name} ({their profile})"` to `warnings`.
- Planned: duration = `days_charged`; `start = max(assignee_free, max(dep planned_end) + 1)`; `end = start + duration − 1`; `assignee_free = end + 1`. Sprint number = `planned_start // 10 + 1`; sprints run `[(n−1)·10, n·10 − 1]` up to the max of all planned/real ends.
- Real: `f = clamp(rng.lognormvariate(0, 0.25), 0.6, 1.8)`; `base = max(1, round(days_charged × f))`; `blocked = Σ duration_days of blocked beats`; `review = 2 if any review_changes beat else 0`; `duration = base + blocked + review`; start = `max(assignee_really_free, max(dep real_end) + 1)`.
- Events per ticket, `seq` increasing within a day: day `real_start`: `transition {from:"À faire", to:"En cours"}`. Each working day in the work window: `worklog {hours: round(hours_per_day × rng.uniform(0.5, 1.0), 1), note}` where note cycles through sentences built from the description and `scope_note` beat texts. A `blocked` beat starts at offset `rng.randint(1, max(1, base−1))` from `real_start`: that day emits `blocked {reason: text}` + `transition {En cours → Bloqué}`, no worklogs for `duration_days` days, then `unblocked {}` + `transition {Bloqué → En cours}`. A `review_changes` beat: day `real_end−2` `review_requested {text}` + `transition {En cours → En revue}`; `real_end−1` `review_changes {text}` + `transition {En revue → En cours}`; `real_end` `review_approved {text:"OK pour moi"}`. Every ticket's `real_end` ends with `transition {… → Terminé}`. A `comment {text}` every `rng.choice([2,3])` working days, actor = assignee. Review actors = a `senior` or `architect` other than the assignee if one exists, else the assignee.
- Invoices: per lot, `issued = max(real_end of its tickets charged with the lot) + 1` (`on_delivery`) or the first sprint `end_day ≥ that` (`sprint_end`); `amount_ht = lot_price`; `covers` = those ticket keys. Per separately charged ticket: `issued = real_end`, `amount_ht = fee`, `lot_key None`, `ticket_key` set. Numbers `F-{start_date.year}-{NNN}` in issued-day order (ties: lot order, then ticket key). `due_day` via Task 1.
- Approvals: one per lot on its invoice's `issued_day`, `approved_by = "Direction des achats"`.
- Payments: lot invoices use `client_behaviour[invoice_index == lot position]`: `amount = round(pays_fraction × amount_ttc)` on `due_day + days_late`, reference `f"VIR-{number}-1"`; if `pays_fraction < 1`, remainder `amount_ttc − amount` on `+15` working days, reference `-2`; a fraction of 0 emits only the remainder row as `-1`. Separate-ticket invoices: full payment on `due_day`.
- `last_day = max(all event, invoice due, payment days) + 15`.

- [ ] **Step 1: Write the failing tests** in `test_expander.py`:
  ```python
  def test_deterministic(plan, contract): assert expand(plan, contract, 42, START) == expand(plan, contract, 42, START)
  def test_seed_changes_timeline(plan, contract): assert expand(plan,contract,42,START).events != expand(plan,contract,43,START).events
  def test_calendar_skips_weekends(): assert date_for_day(date(2026,3,2), 5) == date(2026,3,9)
  def test_calendar_requires_monday(): with pytest.raises(ValueError): date_for_day(date(2026,3,3), 0)
  def test_dependencies_respected(timeline, plan): for each ticket, real_start > real_end of every dependency (and same for planned)
  def test_each_ticket_has_one_start_and_one_done(timeline): exactly one transition to "En cours" from "À faire" and one to "Terminé"
  def test_blocked_span_has_no_worklogs(timeline): between a blocked and its unblocked event, no worklog for that ticket
  def test_review_changes_adds_two_days(plan, contract): mutate fixture so BANK-1 has only a review_changes beat; with rng patched so f=1, real duration == days_charged + 2
  def test_invoice_after_last_ticket(timeline): every lot invoice issued_day > max real_end of covered tickets; separate invoice issued_day == ticket real_end
  def test_sum_fees_equals_sum_invoices_ht(timeline, plan, contract)
  def test_payments_follow_behaviour(timeline): invoice 1 has two payments (round(0.3333×3600)=1200 at due_day, 2400 at due_day+15); invoice 2 one payment of ttc at due_day+12; invoice 3 two payments
  def test_full_fraction_single_payment(plan, contract): behaviour all 1.0 → exactly one payment per lot invoice and no amount-0 payment anywhere
  def test_missing_profile_warns(plan, contract): remove the architect from the team → warnings non-empty and every ticket still assigned
  def test_last_day_after_everything(timeline): last_day >= max(p.day for p in timeline.payments) + 15
  def test_invalid_plan_raises(plan, contract): plan with a cycle → ValueError
  ```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `calendar.py`, `schedule.py`, `events.py`, `invoicing.py`, `expand.py` in that order, running the relevant tests after each. **Step 4:** all pass, `bash scripts/test.sh` green. **Step 5: Buildlog row + commit** `feat: seeded timeline expander`.

---

### Task 4: Store, clock, CLI

**Files:**
- Create: `backend/billing_sim/store/__init__.py`, `schema.sql`, `db.py`, `load.py`, `queries.py`, `dev_queries.py`, `backend/billing_sim/engine/__init__.py`, `clock.py`, `backend/billing_sim/cli.py`
- Test: `backend/tests/test_store.py`, `backend/tests/test_engine.py`
- Modify: `conftest.py` (add `conn` = in-memory connection with the fixture loaded at seed 42, start 2026-03-02)

**Interfaces:**
- Consumes: `Timeline` and dataclasses (Task 3), `ScenarioPlan` (Task 2), `Contract` (Task 1).
- Produces:
  ```python
  # store.db
  def connect(path: str | Path = ":memory:") -> sqlite3.Connection   # Row factory, FK on, applies schema.sql idempotently
  def wipe(conn) -> None
  class NotFound(KeyError): ...
  # store.load
  def load_scenario(conn, *, plan: ScenarioPlan, contract: Contract, timeline: Timeline, request_text: str, seed: int, start_date: date) -> None   # wipes first; sets clock to 0
  # store.queries  (every function: conn, day, ... -> dict | list[dict]; JSON-serialisable; French "statut" values)
  def today(conn, day) -> {"jour": int, "date": "YYYY-MM-DD", "date_longue": "lundi 2 mars 2026"}
  def get_contract(conn) -> dict          # the contract table + "explication" sentence per profile ("Développeur : 600 € par jour")
  def summary(conn, day) -> {"contracte": int, "facture": int, "paye": int, "reste_a_payer": int, "en_retard": int, "lots": [...]}
  def list_lots(conn, day) -> list[dict]; def get_lot(conn, day, key) -> dict   # lot dict: cle, nom, description, prix, livraison_prevue (date), livre_le (date|None), tickets_termines, tickets_total, jours_factures, jours_reels, approuve_le (date|None), statut_facture ("À venir" | invoice statut), facture (number|None)
  def list_tickets(conn, day, lot_key=None, status=None) -> list[dict]; def get_ticket(conn, day, key) -> dict   # cle, titre, description, lot (key|None), facture_separement, taille, jours_factures, tjm, montant, statut, assigne, debut_reel, fin_reel (dates|None), jours_reels (float)
  def ticket_history(conn, day, key) -> list[dict]   # date, type, acteur, contenu (flattened payload, French type label)
  def list_invoices(conn, day) -> list[dict]; def get_invoice(conn, day, number) -> dict   # numero, lot, couvre (ticket keys), emise_le, echeance, montant_ht, tva, montant_ttc, paye, reste, statut, en_retard (bool)
  def list_payments(conn, day, invoice_number=None) -> list[dict]   # date, montant, reference, facture
  def pending_approvals(conn, day) -> list[dict]   # lots delivered (all tickets Terminé) with no approval ≤ day
  def explain_price(conn, day, key) -> dict   # for a ticket: taille→jours×tjm=montant, lot, facture; for a lot: lines per ticket + total
  # store.dev_queries
  def full_plan(conn) -> dict   # scenario, contract, team, sprints, lots, tickets (with planned days and pricing)
  def full_timeline(conn, from_day=None, to_day=None) -> dict   # events, invoices, payments, approvals
  def ticket_full(conn, key) -> dict
  def diff_plan_vs_real(conn) -> {"tickets": [...], "lots": [...]}   # planned_start/end, real_start/end, slip_days, days_charged, actual_days
  # engine.clock
  def get_day(conn) -> int; def set_day(conn, d: int) -> int; def step(conn, n: int) -> int; def last_day(conn) -> int
  ```
  Invoice `statut` as of D: `En retard` if `reste > 0 and D > echeance`, else `Payée` if `reste == 0`, else `Payée partiellement` if `paye > 0`, else `Émise`. `summary.en_retard` = Σ `reste` of overdue invoices.
  CLI `python -m billing_sim.cli load [--seed N] [--db PATH]` (fixture), `day N`, `summary` — prints JSON.

- [ ] **Step 1: Write the failing tests** (`test_store.py`):
  ```python
  def test_as_of_never_leaks_future(conn): for d in range(0, last_day(conn), 7): every date in ticket_history(... each ticket) <= date_for_day(start, d); every invoice emise_le <= that date; every payment date <= that date
  def test_day_zero_summary(conn): s = summary(conn, 0); s["contracte"] == sum of all ticket fees; s["facture"] == 0 == s["paye"]; list_invoices(conn, 0) == []
  def test_status_before_and_after_start(conn): BANK-1 real_start from dev_queries; get_ticket day start−1 → "À faire"; day start → "En cours"
  def test_invoice_statuses(conn): invoice 1: at issued_day → "Émise"; at due_day (after 1200 paid) → "Payée partiellement"; if a day exists where reste>0 and > echeance → "En retard"; invoice 2 at due_day+12 → "Payée"
  def test_overdue_amount_in_summary(conn): at invoice 1 due_day+1, summary en_retard == 2400
  def test_explain_price_ticket(conn): explain_price(conn, last, "BANK-1") has taille "M", jours 3, tjm 600, montant 1800, lot "L1"
  def test_explain_price_lot(conn): total == 3000
  def test_pending_approvals_window(conn): a lot is pending between its delivery day and its approval day, not after
  def test_not_found(conn): get_ticket(conn, 0, "BANK-999") raises NotFound
  def test_diff_has_every_ticket(conn): len(diff_plan_vs_real(conn)["tickets"]) == 12+
  ```
  (`test_engine.py`): `set_day(conn, -5) == 0`; `set_day(conn, 10**6) == last_day(conn)`; `step(conn, 3)` from 0 → 3; CLI smoke via `subprocess.run([sys.executable, "-m", "billing_sim.cli", "load", "--db", tmp])` then `summary --day 40` prints JSON with key `contracte`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `schema.sql` (tables from spec §4 + `clock`), `db.py`, `load.py`, `queries.py`, `dev_queries.py`, `clock.py`, `cli.py`. **Step 4:** all pass; `bash scripts/test.sh` green. **Step 5: Buildlog row + commit** `feat: sqlite store, clock and cli`.

---

### Task 5: API core, manager MCP server, dev routes

**Files:**
- Create: `backend/billing_sim/api/__init__.py`, `app.py`, `deps.py`, `routes_setup.py`, `routes_sim.py`, `routes_dev.py`, `backend/billing_sim/mcp_manager/__init__.py`, `pipeline.py`, `server.py`, `__main__.py`, `backend/billing_sim/scenario/haiku.py` (stub)
- Test: `backend/tests/test_api.py`, `backend/tests/test_mcp_manager.py`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  ```python
  # api.deps
  class Settings: db_path: Path (env SIM_DB_PATH, default ./sim.sqlite); contract_path: Path | None (env CONTRACT_TEMPLATE_PATH); model: str (env BILLING_SIM_MODEL, default "claude-haiku-5-5"); anthropic_api_key: str | None (env ANTHROPIC_API_KEY, else CLAUDE_API_KEY; `.env` at repo root is loaded with python-dotenv if present); start_date: date (env SIM_START_DATE, default 2026-03-02)
  def get_settings() -> Settings; def get_conn(settings=Depends(get_settings)) -> Iterator[sqlite3.Connection]
  # api.app
  def create_app(settings: Settings | None = None) -> FastAPI   # CORS allow http://localhost:5173
  # scenario.haiku (stub this task)
  class GenerationUnavailable(Exception); class GenerationFailed(Exception): raw: str
  def generate_plan(request_text: str, contract: Contract, *, client=None, model: str) -> GenerationResult   # this task: raise GenerationUnavailable("ANTHROPIC_API_KEY not set") if no key else NotImplementedError
  # mcp_manager.pipeline
  @dataclass class GenerateOutcome: kind: Literal["plan","rejection"]; plan: ScenarioPlan | None; reason: str | None; seed: int; warnings: list[str]
  def generate(request_text: str, *, seed: int | None, fallback: bool, settings: Settings) -> GenerateOutcome   # seed None → random 32-bit; fallback → load_fixture(); validate → expand → load_scenario
  # mcp_manager.server: mcp = FastMCP("billing-sim-manager") with tools generate, reset, get_clock, set_day, step, get_plan, get_timeline, get_ticket_full, diff_plan_vs_real, get_agent_tools (returns [] until Task 7)
  ```
  Routes: `POST /setup/generate` body `{request_text: str, seed?: int, fallback?: bool}` → 200 `{kind:"plan", plan, seed, warnings}` | 422 `{reason}` (rejection, blank request, validation errors) | 400 `{detail}` (GenerationUnavailable) | 502 `{detail, raw}` (GenerationFailed). `GET /sim/clock` → `{day, last_day, date}`; `PUT /sim/clock {day}`; `POST /sim/step {n}`. `GET /dev/plan`, `GET /dev/timeline?from_day&to_day`, `GET /dev/ticket/{key}`, `GET /dev/diff`, `GET /dev/agent-tools`. 404 on `NotFound`.

- [ ] **Step 1: Write the failing tests** (`test_api.py`, FastAPI `TestClient` with a tmp db path):
  ```python
  def test_generate_fallback(client): r = client.post("/setup/generate", json={"request_text":"x","fallback":True}); r.status_code == 200; len(r.json()["plan"]["lots"]) == 3
  def test_blank_request_422_without_haiku(client, monkeypatch): patch haiku.generate_plan to raise AssertionError; post request_text "   " → 422
  def test_generate_without_key_400(client, monkeypatch): delenv ANTHROPIC_API_KEY and CLAUDE_API_KEY; fallback False → 400
  def test_claude_api_key_accepted(monkeypatch): setenv CLAUDE_API_KEY only → get_settings().anthropic_api_key is set
  def test_clock_clamps(client): put 999999 → day == last_day
  def test_dev_timeline_includes_future(client): after generate, set clock 0, /dev/timeline has events with day > 0
  def test_dev_ticket_404(client): /dev/ticket/BANK-999 → 404
  ```
  (`test_mcp_manager.py`, async): `names = {t.name for t in await mcp.list_tools()}` equals the ten tool names; `await mcp.call_tool("generate", {"request_text":"x","fallback":True})` then `call_tool("set_day", {"d": 5})` returns 5 and `get_clock` reports 5.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `deps.py`, `pipeline.py`, `haiku.py` stub, routes, `app.py`, `server.py`, `__main__.py` (`mcp.run()` stdio). **Step 4:** pass; `bash scripts/test.sh` green. **Step 5: Buildlog row + commit** `feat: api, manager mcp server and dev routes`.

---

### Task 6: Frontend scaffold + dev page

**Files:**
- Create: `frontend/package.json`, `vite.config.ts` (proxy `/setup`, `/sim`, `/dev`, `/client` → `http://localhost:8000`), `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/types.ts`, `src/pages/DevPage.tsx`, `src/pages/ClientPage.tsx` (placeholder "Bientôt"), `src/components/dev/SetupPanel.tsx`, `ClockPanel.tsx`, `Gantt.tsx`, `Ledger.tsx`, `src/styles.css`, `src/test-setup.ts`
- Test: `src/components/dev/Gantt.test.tsx`, `src/components/dev/Ledger.test.tsx`

**Interfaces:**
- Consumes: `/setup/generate`, `/sim/*`, `/dev/*` JSON shapes (Task 5); `diff_plan_vs_real` rows.
- Produces: `src/api.ts` functions `generate(body)`, `getClock()`, `setClock(day)`, `stepClock(n)`, `getPlan()`, `getTimeline()`, `getDiff()`, `getAgentTools()`; `src/types.ts` mirrors the backend dicts. Components:
  - `Gantt({ rows: DiffTicketRow[], lots: {key,name}[], sprints: Sprint[], today: number, lastDay: number })` — SVG: one row per ticket grouped under a lot label; grey planned bar and coloured real bar; hatched `blocked` spans (from `/dev/timeline` events); vertical "today" line; sprint column bands; dependency arrows from `depends_on`.
  - `Ledger({ invoices, payments, diff, today })` — invoice table (number, lot, issued, due, ttc, paid, outstanding) and the diff table; rows with `issued_day > today` get class `future`.
  - `SetupPanel({ onGenerated })` — textarea, seed input, "Use fallback" checkbox (checked by default when `/setup/generate` returns 400 once), Generate button, `<pre>` with the returned plan JSON or the rejection reason.
  - `ClockPanel({ clock, onChange })` — range slider 0..lastDay, −5 −1 +1 +5 buttons, date.
  Vitest + jsdom + @testing-library/react; `npm test` = `vitest`.

- [ ] **Step 1: Scaffold** with `npm create vite@latest frontend -- --template react-ts`, add `react-router-dom`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`. **Step 2: Write the failing tests**: Gantt renders `rows.length` `<g class="ticket-row">` and a `<line class="today">` at `x = scale(today)`; Ledger marks an invoice with `issued_day > today` as `.future` and not one with `issued_day <= today`. **Step 3:** `npm test -- --run` → FAIL. **Step 4: Implement** components and pages; wire `/dev` route. **Step 5:** tests pass; `bash scripts/test.sh` green (both suites). **Step 6: Manual check**: `uvicorn billing_sim.api.app:create_app --factory` + `npm run dev`, open `/dev`, generate fallback, move the clock, Gantt and Ledger update (note the check in the buildlog row). **Step 7: Buildlog row + commit** `feat: dev page with setup, clock, gantt and ledger`.

---

### Task 7: Client MCP server + client routes

**Files:**
- Create: `backend/billing_sim/mcp_client/__init__.py`, `server.py`, `__main__.py`, `backend/billing_sim/api/routes_client.py`
- Modify: `backend/billing_sim/api/app.py` (include router), `backend/billing_sim/mcp_manager/server.py` (`get_agent_tools` returns the client server's tool list), `routes_dev.py` (`/dev/agent-tools`)
- Test: `backend/tests/test_mcp_client.py`

**Interfaces:**
- Consumes: `store.queries.*`, `engine.clock.get_day` (Task 4).
- Produces: `mcp_client.server.build_server(conn_factory: Callable[[], sqlite3.Connection]) -> FastMCP` named `billing-sim-client`, tools exactly: `get_today`, `get_contract`, `get_summary`, `list_lots`, `get_lot(key)`, `list_tickets(lot?, status?)`, `get_ticket(key)`, `get_ticket_history(key)`, `list_invoices`, `get_invoice(number)`, `list_payments(invoice?)`, `list_pending_approvals`, `explain_price(key)`. Each opens a connection, reads `get_day(conn)`, calls the matching query, returns the dict. `NotFound` → tool error text `"Enregistrement introuvable : {key}"`. Tool descriptions in English, one sentence each, saying "as of today".
  Routes `GET /client/today`, `/client/contract`, `/client/summary`, `/client/lots`, `/client/lots/{key}`, `/client/tickets?lot&status`, `/client/tickets/{key}`, `/client/tickets/{key}/history`, `/client/invoices`, `/client/invoices/{number}`, `/client/payments?invoice`, `/client/approvals/pending`, `/client/explain/{key}` — all using `get_day(conn)`.

- [ ] **Step 1: Write the failing tests**:
  ```python
  async def test_no_tool_accepts_a_day(server): for t in await server.list_tools(): assert not ({"day","as_of","date","jour"} & set(t.inputSchema.get("properties", {})))
  async def test_tool_names_exact(server): names == the 13 above
  async def test_parity_with_rest(server, client, conn): set clock 40; for each (tool, route) pair, tool result JSON == route JSON
  async def test_future_invisible(server, conn): clock 0 → list_invoices returns []
  async def test_not_found_message(server): get_ticket BANK-999 → result isError and text contains "introuvable"
  ```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4:** pass; `bash scripts/test.sh` green. **Step 5: Buildlog row + commit** `feat: past-only client mcp server and client routes`.

---

### Task 8: Client page (without chat)

**Files:**
- Create: `frontend/src/i18n/fr.ts`, `src/components/client/Header.tsx`, `SummaryTiles.tsx`, `LotCard.tsx`, `InvoiceList.tsx`, `PendingApprovals.tsx`
- Modify: `src/pages/ClientPage.tsx`, `src/api.ts` (client endpoints), `src/types.ts`
- Test: `src/components/client/SummaryTiles.test.tsx`, `src/components/client/InvoiceList.test.tsx`

**Interfaces:**
- Consumes: `/client/*` (Task 7), `/sim/clock` (Task 5).
- Produces: `ClientPage` layout: `Header` ("Aujourd'hui : {date_longue} · jour {n}", ◀ ▶, `<input type="date">` mapped to the nearest working day via `/sim/clock` and the day→date list from `/dev/plan`-free source: the page requests `/client/today` after each change); `SummaryTiles({summary})` five tiles, `En retard` tile gets class `alert` when > 0; `LotCard({lot, tickets})` collapsed by default, expands to a ticket table showing `taille → jours × TJM = montant`, `statut`, `jours_reels`; `InvoiceList({invoices, payments, onSelect})` with status pill class per status and a detail drawer listing `couvre` tickets and payments; `PendingApprovals({lots})`. Every lot, ticket and invoice element has `id="rec-{key}"` for citation links. All labels from `fr.ts`.

- [ ] **Step 1: Write the failing tests**: SummaryTiles renders "Reste à payer" with `2 400 €` formatted `fr-FR` and the alert class when `en_retard > 0`; InvoiceList renders pill text equal to each invoice's `statut` and class `pill-en-retard` for "En retard". **Step 2:** FAIL. **Step 3: Implement**. **Step 4:** pass; `bash scripts/test.sh` green. **Step 5: Manual check** on the fallback scenario at day 0, day of first invoice, and `last_day`; note in buildlog. **Step 6: Buildlog row + commit** `feat: french client dashboard`.

---

### Task 9: Client agent, chat route, assistant panel

**Files:**
- Create: `backend/billing_sim/agent/__init__.py`, `prompt.py`, `tools.py`, `loop.py`, `backend/billing_sim/api/routes_chat.py`, `frontend/src/components/client/Assistant.tsx`
- Modify: `app.py` (router), `ClientPage.tsx` (right column)
- Test: `backend/tests/test_agent.py`, `frontend/src/components/client/Assistant.test.tsx`

**Interfaces:**
- Consumes: `mcp_client.server.build_server` (Task 7), `Settings` (Task 5).
- Produces:
  ```python
  # agent.tools
  async def anthropic_tool_defs(server: FastMCP) -> list[dict]   # [{name, description, input_schema}] from list_tools()
  async def dispatch(server: FastMCP, name: str, args: dict) -> str   # call_tool → JSON text; tool errors returned as text, never raised
  # agent.loop
  AgentEvent = dict  # {"type":"text","text":str} | {"type":"tool_call","name":str,"input":dict} | {"type":"tool_result","name":str} | {"type":"done"} | {"type":"error","message":str}
  class ClientAgent:
      def __init__(self, client: anthropic.Anthropic, server: FastMCP, model: str, max_turns: int = 8): ...
      def chat(self, session_id: str, message: str) -> Iterator[AgentEvent]   # keeps per-session history in a dict, last 40 messages
  ```
  Loop: `client.messages.stream(model, max_tokens=4096, system=SYSTEM_PROMPT_FR, tools=defs, messages=history)`; yield `text` deltas as they stream; on `stop_reason == "tool_use"` yield `tool_call`, run `dispatch`, append the assistant content and a user message with all `tool_result` blocks, continue; `end_turn` → `done`. Any `anthropic.APIError` or missing scenario (`sqlite3.OperationalError` / empty `scenario` table) → `{"type":"error","message":"Je n'ai pas pu consulter les données de la simulation."}` then `done`.
  `SYSTEM_PROMPT_FR` (exact copy in `prompt.py`):
  > Tu es l'assistant du client sur ce projet de développement. Tu ne sais que ce que les outils te renvoient : commence toujours par `get_today` pour connaître la date du jour. Réponds en français, simplement, pour une personne non technique. Cite systématiquement les enregistrements utilisés entre crochets : [BANK-12], [F-2026-001], [L1]. Pour toute question de prix ou de montant, appelle `explain_price` et reprends son calcul (taille → jours × TJM) ; ne calcule jamais un prix toi-même. Si on te demande l'avenir, indique la date prévue dans le planning et précise que tu ne peux pas voir ce qui n'est pas encore arrivé. Si un enregistrement est introuvable, dis-le.

  Route `POST /client/chat` body `{session_id: str, message: str}` → `text/event-stream`, one `data: {json AgentEvent}\n\n` per event. Frontend `Assistant`: message list, input, streaming render; `tool_call` events render as chips `consulte {name}…`; citations `\[(BANK-\d+|F-\d{4}-\d{3}|L\d)\]` become `<a href="#rec-{key}">`.

- [ ] **Step 1: Write the failing tests** (`test_agent.py`, fake client whose `messages.stream` yields a scripted `tool_use` for `get_summary` then a final text "Le reste à payer est de 2 400 € [F-2026-001]."):
  ```python
  def test_tool_defs_match_server(server): names == 13 tool names; every def has input_schema
  def test_chat_event_sequence(agent): types == ["tool_call","tool_result","text",...,"done"] and the tool_call name == "get_summary"
  def test_tool_dispatched_against_clock(agent, conn): after set_day 0, the get_summary result passed back to the fake client has facture == 0
  def test_history_kept_per_session(agent): second chat on same session_id sends 3+ prior messages; different session_id sends 1
  def test_error_event_when_no_scenario(agent_empty_db): events contain type "error" with the French message, then "done"; no exception
  ```
  (`Assistant.test.tsx`): renders a chip for a `tool_call` event; renders `[BANK-1]` as a link to `#rec-BANK-1`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `tools.py`, `prompt.py`, `loop.py`, `routes_chat.py` (`StreamingResponse`, media type `text/event-stream`), `Assistant.tsx`. **Step 4:** pass; `bash scripts/test.sh` green. **Step 5: Manual check** with a real key on the fallback scenario: ask "Qu'est-ce qui est en retard ?" at `last_day`; note the answer quality in buildlog. **Step 6: Buildlog row + commit** `feat: client agent with streaming chat`.

---

### Task 10: Real Haiku generation

**Files:**
- Create: `backend/billing_sim/scenario/prompts.py`
- Modify: `backend/billing_sim/scenario/haiku.py` (replace stub), `backend/billing_sim/mcp_manager/pipeline.py` (502 path already wired in Task 5)
- Test: `backend/tests/test_haiku.py`

**Interfaces:**
- Consumes: `GenerationResult`, `validate_plan` (Task 2), `Contract.to_dict()` (Task 1).
- Produces: `generate_plan(request_text, contract, *, client: anthropic.Anthropic | None = None, model: str = "claude-haiku-5-5") -> GenerationResult`. Uses `client.messages.parse(model=model, max_tokens=16000, system=SYSTEM_PROMPT_FR, messages=[{"role":"user","content": request_text}], output_format=GenerationResult)` and reads `response.parsed_output`. If `kind == "plan"` and `validate_plan(plan)` is non-empty, retry once with a second user message `"Le plan précédent est invalide : {errors}. Renvoie un plan corrigé."`; still invalid → raise `GenerationFailed(raw=response.content text)`. Any `pydantic.ValidationError` from parsing counts as invalid for the retry. `client=None` → `anthropic.Anthropic(api_key=settings key)` where the key is `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`; neither set → `GenerationUnavailable`. Same rule for the client agent in Task 9.
  `SYSTEM_PROMPT_FR` (in `prompts.py`): French; says the model is the dev team lead; embeds `contract.to_dict()` as JSON so it knows what S/M/L mean; instructs: 2–4 lots, 12–30 tickets with keys `BANK-n`, 3–5 team members, `depends_on` only to earlier keys, at least two `blocked` beats and one `review_changes` across the plan, one `client_behaviour` per lot with varied `pays_fraction`/`days_late`, never any price or day count; if the request contains no identifiable software project, return `kind: "rejection"` with a one-sentence reason.

- [ ] **Step 1: Write the failing tests** (fake client with a `messages.parse` returning objects with `parsed_output`):
  ```python
  def test_plan_returned(contract): fake returns a valid fixture plan → result.kind == "plan"
  def test_rejection_returned(contract): fake returns kind rejection → result.reason set
  def test_retry_on_invalid_then_success(contract): first parsed plan has a cycle, second valid → 2 calls, second request has 3 messages
  def test_failed_after_two(contract): both invalid → GenerationFailed with raw text
  def test_no_key_unavailable(monkeypatch, contract): delenv → GenerationUnavailable
  def test_api_pipeline_502(client, monkeypatch): patch generate_plan to raise GenerationFailed("raw") → /setup/generate 502 with raw
  ```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4:** pass; `bash scripts/test.sh` green. **Step 5: Live check** once with a real key: "Un portail de suivi des factures pour une banque" → a plan; "bonjour" → a rejection; note both in buildlog with the seed. **Step 6: Buildlog row + commit** `feat: haiku scenario generation with retry`.

---

### Task 11: Docker, README, e2e

**Files:**
- Create: `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`, `frontend/playwright.config.ts`, `frontend/e2e/demo.spec.ts`
- Modify: `scripts/test.sh` (optional `E2E=1` runs Playwright against the compose stack)

- [ ] **Step 1: `docker-compose.yml`**: services `api` (build `backend`, `uvicorn billing_sim.api.app:create_app --factory --host 0.0.0.0 --port 8000`, env from `.env`, volume `./data:/data`, `SIM_DB_PATH=/data/sim.sqlite`) and `web` (build `frontend`, Vite preview on 5173 with the proxy pointing at `api:8000`). `.env.example`: `CLAUDE_API_KEY=` (or `ANTHROPIC_API_KEY=`, either works), `BILLING_SIM_MODEL=claude-haiku-5-5`.
- [ ] **Step 2: `README.md`** (English): what it is (three paragraphs, the guideline table), quick start (`git clone`, `cp .env.example .env`, add key or leave blank for fallback, `docker compose up`, open `/dev` then `/client`), the two MCP servers and how to attach Claude Desktop to `python -m billing_sim.mcp_manager`, the pricing policy file, dev setup and `bash scripts/test.sh`, the build-log convention.
- [ ] **Step 3: e2e** `demo.spec.ts`: open `/dev`, generate with fallback, set clock to `last_day`, open `/client`, expect a pill with text "En retard" or "Payée" visible and the tile "Reste à payer". **Step 4:** `docker compose config` exits 0; `docker compose up --build -d`, run `npx playwright test` → pass; `docker compose down`. **Step 5: Buildlog row + commit** `chore: docker compose, readme and e2e`. Final merge to `develop` and `main`, tests on both, push.

---

## Self-review notes

- Spec coverage: §2 decisions → Global Constraints; §3 packages → file structure and Tasks 1–10; §4 data model → Task 4 schema; §5 pipeline → Tasks 2, 3, 5, 10; §6 → Tasks 7, 9; §7 → Tasks 5, 6; §8 → Task 8; §9 error table → Tasks 5, 9, 10 tests; §10 tests → each task's test list; §11 build order → task order; §12 → Execution cadence.
- One spec deviation, deliberate: `last_day = max(all days incl. due and payment) + 15` instead of `+ payment_terms + 15`; the payment days already sit past the due dates, so the extra term only padded the slider.
- Names used across tasks: `Contract`, `ScenarioPlan`, `GenerationResult`, `Timeline`, `load_scenario`, `get_day`, `build_server`, `generate`, `ClientAgent` — checked for consistency.
