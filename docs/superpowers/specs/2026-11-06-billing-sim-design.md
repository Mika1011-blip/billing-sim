# billing-sim — Design spec

Date: 2026-11-06
Status: approved in conversation, awaiting written review

## 1. Purpose

A runnable simulation of an agile, fixed-price software engagement between a dev
team and a non-technical client (a bank). It exists to demonstrate one thing to a
non-technical audience: **"I can follow what I am paying for."**

The simulation connects what the team delivered, what the client was charged, and
what the client has paid, through these records:

| Record | Tracks |
|---|---|
| Ticket | one piece of work, its size, price, status, history, time spent |
| Lot | related tickets delivered and priced together; a ticket may be charged separately |
| Contract | the pricing policy: daily rates (TJM), rate card, payment terms, overrun rule |
| Invoice | amount billed, which deliveries it covers, due date |
| Payment | money received against an invoice; remaining balance |

Two AI roles appear, but only one runs at runtime:

- **Simulation manager** — Claude (Haiku) is called **once at setup** to turn the
  participant's request into a scenario. After that the manager is plain code: a
  deterministic engine and an MCP server exposing its API. No LLM at runtime.
- **Client agent** — Claude, inside the simulation, answering the client's
  questions in French. It sees only the state up to "today" through a dedicated
  MCP server whose tools cannot take a day parameter.

## 2. Fixed decisions

| Topic | Decision |
|---|---|
| Audience | D3sir3's manager and a bank director; non-technical |
| Participant | explores freely, asks the agent anything (must be robust) |
| Participant actions | **observe only**: signing the contract is the only action; approvals and payments are scripted in the generated timeline |
| Setup | participant types a request; Haiku either returns a full scenario or a rejection ("no usable project in this input"); no negotiation loop |
| Pricing policy | a repo file (`contract_template.json`); **code computes every price**; Haiku only sizes tickets (S/M/L/XL) and picks profiles |
| Billing model | bottom-up *forfait*: `ticket fee = days_charged × TJM[profile]`, `lot price = Σ fees of tickets charged with the lot`; tickets flagged `charged_separately` get their own invoice |
| Timeline | generated once with a seed; deterministic; scrubbing backward shows the same past |
| Day contents | worklogs, comments, status transitions with timestamps, blockers, reviews (Jira-like) |
| Generation split | Haiku writes the plan and story beats; a seeded expander produces day-by-day records |
| Model | cheapest (Haiku) for generation; client agent model configurable, default Haiku |
| Stack | Python, FastAPI, SQLite, official `mcp` Python SDK, Anthropic Python SDK; React/Vite frontend; `docker compose up` |
| Language | French for everything the client sees (UI, generated data, agent); English for the dev page and code |
| Distribution | public GitHub repo; a clone plus one Anthropic API key runs it; a canned fallback scenario runs without a key |
| Sprints | internal to the team; never shown on the client page |

### Glossary

- **TJM** (*taux journalier moyen*): daily rate per profile, from the contract.
- **Forfait**: fixed price agreed before the work, for a defined scope (a lot).
- **Régie**: time & materials; fee = actual days × TJM. Used only for tickets charged separately when the contract says so.
- **Days charged**: the day count a ticket is priced on (from the rate card). Fixed at approval.
- **Actual days**: Σ worklog hours / hours_per_day. Measured, never fixed.
- The gap between the two is the honesty check the demo must make visible.

## 3. Architecture

One repo, three processes behind `docker compose up`:

```
┌──────────────────────────────────────────────────────────────┐
│ frontend (React/Vite, port 5173)                             │
│   /client  → client page (FR)       /dev → dev page (EN)     │
└───────────────┬──────────────────────────────┬───────────────┘
                │ HTTP                         │ HTTP
┌───────────────▼──────────────────────────────▼───────────────┐
│ api (FastAPI, port 8000)                                     │
│   /setup/*      generation (calls Haiku once)                │
│   /sim/*        clock: current day, set day, step            │
│   /client/*     as-of reads   /client/chat  client agent     │
│   /dev/*        full read of DB incl. future                 │
└───────┬─────────────────────────────┬────────────────────────┘
        │                             │
┌───────▼────────┐          ┌─────────▼──────────┐
│ mcp-client     │          │ mcp-manager        │
│ as_of clock,   │          │ generate, reset,   │
│ past only      │          │ set_day, inspect   │
└───────┬────────┘          └─────────┬──────────┘
        └──────────┬──────────────────┘
            ┌──────▼──────┐
            │ sim.sqlite  │  one scenario at a time
            └─────────────┘
```

### Python packages (`backend/`)

| Package | Responsibility | Depends on |
|---|---|---|
| `billing/` | load `contract_template.json`; compute ticket fee, lot price, invoice totals, outstanding. Pure functions, no DB | — |
| `scenario/` | Haiku call with forced tool-use JSON schema; Pydantic validation; the canned fallback plan | `anthropic`, `billing` |
| `expander/` | plan + beats + seed → full event list (schedule, worklogs, comments, transitions, invoices, payments, approvals) | `billing` |
| `store/` | SQLite schema; load a scenario; "state as of day D" queries | — |
| `engine/` | the clock: current day, step, jump; thin layer over `store` | `store` |
| `mcp_client/` | MCP server exposing past-only tools; each tool reads the clock from the engine, never from the caller | `engine`, `store` |
| `mcp_manager/` | MCP server exposing generate / reset / clock / full inspection | `scenario`, `expander`, `engine`, `store` |
| `agent/` | client agent: Anthropic SDK tool-use loop, French system prompt, tools bound to `mcp_client` | `anthropic`, `mcp_client` |
| `api/` | FastAPI routes wiring the above | everything |

Why two MCP servers: the client agent must be unable to see the future even by
accident. A separate server whose tools physically cannot take a day parameter is
the cleanest guarantee, and it makes the guideline's "two agents" concrete. The
manager server can also be driven from an external MCP host (e.g. Claude Desktop).

Why SQLite, one scenario at a time: the demo runs one engagement. Regenerating
wipes the DB. No users, no auth.

## 4. Data model

Two layers in `sim.sqlite`: **static** (written once at generation) and
**timeline** (every row carries a `day` integer). "State as of day D" is always
`WHERE day <= D`. No row is updated during the run; the clock only changes which
rows are visible.

### Static layer

| Table | Fields |
|---|---|
| `scenario` | id, request_text, product_summary, seed, start_date (calendar date of day 0), signed_day = 0, warnings JSON |
| `contract` | snapshot of the template: tjm per profile, rate card (size → days), hours_per_day, payment_terms_days, overrun_rule, vat_rate, currency, invoice_timing (`on_delivery` or `sprint_end`) |
| `team_member` | id, name, profile ∈ {dev, senior, architect} |
| `sprint` | id, number, start_day, end_day (10 working days each) |
| `lot` | id, key, name, description, price (= Σ fee of tickets charged with the lot), planned_delivery_day |
| `ticket` | id, key (`BANK-12`), title, description, lot_id (nullable), charged_separately (bool), size ∈ {S, M, L, XL}, profile, days_charged, fee, assignee_id, sprint_id, planned_start_day, planned_end_day |
| `ticket_dependency` | ticket_id, depends_on_id |

`days_charged` and `fee` are computed by `billing/` at load and stored so anyone
can recompute them from `contract`. Haiku never produces these numbers.

### Timeline layer

| Table | Fields |
|---|---|
| `ticket_event` | id, ticket_id, day, seq (order within a day), type ∈ {transition, worklog, comment, blocked, unblocked, review_requested, review_changes, review_approved}, actor_id, payload JSON |
| `invoice` | id, number, lot_id (nullable), ticket_id (nullable, for separate charges), issued_day, due_day (= issued + payment_terms), amount_ht, vat, amount_ttc, covers JSON (ticket ids) |
| `payment` | id, invoice_id, day, amount, reference |
| `approval` | id, lot_id, day, approved_by |
| `clock` | current_day (single row) |

Event payloads: transition `{from, to}`; worklog `{hours, note}`; comment `{text}`;
blocked `{reason}`; review_* `{text}`.

Statuses (French, as displayed): `À faire`, `En cours`, `Bloqué`, `En revue`, `Terminé`.

### Derived, never stored (as-of-D queries in `store/`)

- ticket **status** = `to` of latest transition ≤ D, default `À faire`
- ticket **actual_days** = Σ worklog hours ≤ D / hours_per_day
- ticket **real_start_day / real_end_day** = first `En cours` / `Terminé` transition, if ≤ D
- lot **delivered** = all tickets `Terminé` ≤ D; **actual_days** = Σ tickets
- invoice **paid** = Σ payments ≤ D; **outstanding** = amount_ttc − paid; **overdue** = outstanding > 0 and D > due_day
- scenario totals: contracted, invoiced, paid, outstanding, overdue

Calendar: `day` is a working-day index from signature; `start_date` + skipping
weekends gives the displayed date. Last day of the run = last timeline event +
payment_terms + 15.

## 5. Generation pipeline

```
participant request (text)
   ▼
[1] Haiku, one call, forced tool-use   →  ScenarioPlan | Rejection
   ▼
[2] billing/: price every ticket and lot from contract_template.json
   ▼
[3] expander/: ScenarioPlan + seed → schedule → events → invoices/payments
   ▼
[4] store/: wipe DB, load static + timeline, clock = day 0
```

### [1] Haiku call

System prompt (French): you are the dev team's lead; here is the contract
(rates and rate card, so you understand S/M/L; you never write prices); turn the
client's request into a plan. Fidelity to the request is not important; coherence
is. Output forced through a tool with this schema:

```
ScenarioPlan
  product_summary: str                       2–3 sentences, FR
  team: [{name, profile}]                    3–5 people
  lots: [{key, name, description}]           2–4 lots
  tickets: [{key, title, description,
             lot_key | null, charged_separately: bool,
             size: S|M|L|XL, profile,
             depends_on: [key],
             beats: [Beat]}]                 12–30 tickets
  client_behaviour: [{invoice_index, pays_fraction, days_late}]
                                             one per lot
Beat = {kind: blocked | review_changes | scope_note, text, duration_days?}
Rejection = {reason: str}
```

Haiku decides *what* and *how big*; never *when* or *how much*. On `Rejection`
the API returns 422 with the reason.

### [2] Pricing

Pure functions over the plan and the template. Validation before expansion:
unknown lot/profile keys, cyclic dependencies, and duplicate ticket keys are
rejected (422, naming the ticket).

### [3] Expander (`random.Random(seed)`)

1. **Topological order** of tickets from `depends_on`; ties by lot order then key.
2. **Planned schedule**: walk tickets in order; assign to the team member of the
   ticket's profile with the earliest free day (closest profile if none, recorded
   in `scenario.warnings`); planned duration = `days_charged`; start = max(assignee
   free, dependencies' planned end). Sprints cut every 10 days; a ticket belongs to
   the sprint containing its planned start. Lot planned delivery = max planned end
   of its tickets.
3. **Real schedule**: same walk; duration = `round(days_charged × f)` with
   `f ~ lognormal(0, 0.25)` clamped to [0.6, 1.8], min 1 day, plus Σ `blocked` beat
   durations; start = max(assignee really free, dependencies' real end).
4. **Daily events** per ticket between real start and real end: `transition →
   En cours` on day 1; one `worklog` per working day, hours = hours_per_day ×
   U(0.5, 1.0), note drawn from the description and beat texts; beats on specific
   days (`blocked` inserts a blocked/unblocked pair and suppresses worklogs in
   between; `review_changes` adds review_requested → review_changes → one more
   working day → review_approved); a `comment` every 2–3 days; `transition →
   Terminé` on the last day.
5. **Invoices**: when a lot's last ticket is `Terminé` on day D, invoice issued on
   D+1 (or the next sprint end if `invoice_timing = sprint_end`); due = issued +
   payment_terms. Separately-charged tickets get their own invoice on their
   `Terminé` day. Invoice numbers `F-2026-001`, …
6. **Approvals and payments** from `client_behaviour`: approval on invoice day;
   payment of `pays_fraction × amount_ttc` on `due_day + days_late`; if
   `pays_fraction < 1`, the remainder is paid 15 working days later.

### Fallback

`scenario/fixtures/invoice_dashboard.json` is a hand-written `ScenarioPlan`
matching the guideline example: lot "Tableau de bord factures" containing filter
and export tickets priced to €3,000 HT; the client pays €1,000 then the rest late.
Used when no API key is set, when `fallback=true`, and by all tests.

## 6. Clock, client MCP server, client agent

**Clock** (`engine/`): `set_day(d)` clamps to `[0, last_day]`; `step(n)` is sugar.
Scrubbing only moves the `WHERE day <= D` boundary.

**Client MCP server** (`mcp_client/`). No tool accepts a day. Tool names in
English, content French-labelled, every payload carries record keys for citation:

| Tool | Returns (as of today) |
|---|---|
| `get_today` | day index, calendar date |
| `get_contract` | pricing policy in plain terms |
| `get_summary` | totals (contracted, invoiced, paid, outstanding, overdue) and lots with status |
| `list_lots`, `get_lot(key)` | name, description, price, tickets with status, planned vs delivered, days charged vs actual |
| `list_tickets(lot?, status?)`, `get_ticket(key)` | title, description, lot or separate, size → days → fee, status, assignee, real start/end, actual days |
| `get_ticket_history(key)` | visible events with dates |
| `list_invoices`, `get_invoice(number)` | amount, covers, issued, due, paid, outstanding, overdue |
| `list_payments(invoice?)` | date, amount, reference |
| `list_pending_approvals` | lots delivered and not yet approved |
| `explain_price(key)` | size → days × TJM = fee, summed to lot price, and the invoice covering it |

**Client agent** (`agent/`): Anthropic SDK tool-use loop. System prompt (French):
you are the client's assistant on this engagement; you only know what the tools
return; today is what `get_today` says; always cite the records used (ticket key,
invoice number); for questions about the future, say the planning shows a planned
date but you cannot see outcomes; never compute a price yourself, call
`explain_price`. History per browser session, in memory. Exposed as
`POST /client/chat` streaming SSE.

## 7. Manager MCP server and dev page

**Manager MCP server** (`mcp_manager/`), no LLM behind it:

| Tool | Does |
|---|---|
| `generate(request_text, seed?, fallback?)` | runs the pipeline, wipes and reloads the DB, clock = 0; returns the plan or the rejection |
| `reset()` | wipes the DB |
| `get_clock`, `set_day(d)`, `step(n)` | the clock |
| `get_plan` | full static layer with pricing arithmetic |
| `get_timeline(from_day?, to_day?)` | every event, invoice, payment, approval, including future |
| `get_ticket_full(key)` | planned vs real, beats, all events |
| `diff_plan_vs_real` | per ticket and lot: planned vs real dates, days charged vs actual, slip |
| `get_agent_tools` | the client MCP's tool list and schemas |

**Dev page** (`/dev`, English, no chat), four panels: **Setup** (request textarea,
seed, fallback toggle, Generate, raw `ScenarioPlan` JSON or rejection); **Clock**
(day slider, ±1/±5, calendar date; shared with the client page); **Gantt** (one
row per ticket grouped by lot, planned bar grey and real bar coloured, today line,
blocked spans hatched, dependency arrows, sprint bands); **Ledger** (invoices
across the whole run and the `diff_plan_vs_real` table, future shaded).

`/dev/*` REST routes are thin wrappers over the same functions the manager MCP
exposes.

## 8. Client page

`/client`, French. Header "Aujourd'hui : lundi 3 mars 2026 · jour 32" with ◀ ▶
and a date picker ("revoir l'historique"). **Résumé**: tiles Contracté, Facturé,
Payé, Reste à payer, En retard (red if > 0). **Lots**: cards with price, planned
vs delivered date, progress, approval status; expand to tickets (title, size →
days → fee, status, actual days). **Factures**: list with status pill (À venir /
Émise / Payée partiellement / Payée / En retard); click shows covered tickets and
payments. **Approbations en attente**. **Assistant**: persistent chat panel,
streaming, tool calls shown as chips ("consulte BANK-12…"), citations rendered as
links that scroll to the record.

`/client/*` REST routes use the same `store/` as-of queries the client MCP uses,
so dashboard and agent cannot disagree.

## 9. Error handling

| Where | Failure | Behaviour |
|---|---|---|
| Haiku call | no API key | `/setup/generate` 400 "no key, use fallback"; dev toggle defaults to fallback |
| Haiku call | schema validation fails | one retry with the validation errors appended; then 502 with raw output on the dev page |
| Haiku call | `Rejection` | 422 with reason |
| Validation | cyclic deps, unknown keys, duplicates | 422 naming the ticket |
| Expander | no team member of a profile | closest profile, noted in `scenario.warnings` |
| Client agent | tool or API error | chat shows "Je n'ai pas pu consulter les données"; server log; dashboard unaffected |
| Clock | out-of-range day | clamped |

## 10. Testing (pytest, offline via the fixture)

- `billing/`: guideline example prices to exactly €3,000 HT; separate charges excluded from lot price; VAT and outstanding arithmetic.
- `expander/`: same seed → identical timeline; dependencies respected; no ticket starts before its dependency ends; blocked spans contain no worklogs; each lot's invoice after its last ticket; payments match `client_behaviour`; Σ fees = Σ invoices HT.
- `store/`: as-of queries never return `day > D`; status derivation; outstanding/overdue at specific days.
- `mcp_client/`: each tool's output equals the REST route for the same day; no tool signature accepts a day.
- `scenario/`: schema accepts the fixture, rejects malformed plans; Haiku client tested with a recorded response.
- `agent/`: smoke test with a stubbed Anthropic client checking the tool loop and citation format.
- Frontend: component tests on tiles and invoice pill; one Playwright run on the fallback (generate → day 40 → an invoice shows "En retard").

## 11. Build order (each step runnable alone)

1. `billing/` + `contract_template.json` + fixture plan.
2. `scenario/` schema + fixture loading (Haiku stubbed), then `expander/`.
3. `store/` + `engine/`; CLI `sim load`, `sim day 32`, `sim summary`.
4. `mcp_manager/` + `/dev/*` + dev page. First visual milestone.
5. `mcp_client/` + `/client/*` + client dashboard without chat.
6. `agent/` + `/client/chat` + assistant panel. Demo works end to end on the fallback.
7. Real Haiku generation, retry, rejection path.
8. Docker compose, README, push.

## 12. Execution rules (from the project owner)

- Each task is built in its own git worktree by a subagent.
- Tests run on the task branch before merge; after each merge the receiving branch is re-tested; `main` is tested after every merge into it.
- Every change is recorded in `buildlog.md` at the repo root (date, branch, what changed, test result).
