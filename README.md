# billing-sim

A runnable simulation of an agile, fixed-price software engagement between a development team and a non-technical client (a bank). It exists to show one thing: **"I can follow what I am paying for."**

The simulation connects what the team delivered, what the client was charged and what the client has paid. Every record can be traced from the dashboard, and an AI client agent answers the client's questions in French, citing the records it used (for example `[BANK-12]` for a ticket or `[F-2026-001]` for an invoice).

| Record | Tracks |
|---|---|
| Ticket | one piece of work, its size, price, status, history, time spent |
| Lot | related tickets delivered and priced together; a ticket may be charged separately |
| Contract | the pricing policy: daily rates (TJM), rate card, payment terms, overrun rule |
| Invoice | amount billed, which deliveries it covers, due date |
| Payment | money received against an invoice; remaining balance |

## How it works

1. **Setup (one LLM call).** The participant writes a request in plain language. Claude Haiku is called once to turn it into a `ScenarioPlan`: lots, tickets with sizes (S, M, L, XL) and their ordered work steps, a plain-language delivery summary per lot, a team and story beats (blockers, reviews, slips). The model never writes a price.
2. **Pricing is code.** The policy is [`contract_template.json`](contract_template.json): daily rates per profile (TJM), a rate card mapping sizes to days, 8 hours per day, 30 days payment terms and 20% VAT. Code computes every amount: `ticket fee = days x TJM`, `lot price = sum of its ticket fees`, VAT on top.
3. **A deterministic timeline.** A seeded expander turns the plan into a day-by-day timeline: worklogs (each day's note says which work step was done), status changes, comments, blockers, reviews, invoices and approvals. The same plan and seed always give the same timeline. Payments are not scripted: nothing is paid until the participant marks an invoice paid on the client page.
4. **One scenario in SQLite.** The database holds a single scenario. The clock moves a `day <= D` boundary over it: "today" is whatever the clock says.
5. **Two MCP servers** expose the simulation (see below), and a **client agent** (Claude, model from `BILLING_SIM_MODEL`) answers the client in French using only the past-only tools.

If no API key is configured, a canned fallback scenario (an invoice dashboard whose lot "Tableau de bord factures" is priced 3 000 EUR HT) runs the whole simulation without any LLM call.

## Quick start (Docker)

```bash
git clone <this repository>
cd billing-sim
cp .env.example .env     # add your key, or leave it blank to use the fallback scenario
docker compose up --build
```

- Open <http://localhost:5173/dev> (English developer page): describe a request and press **Generate** (tick **Use fallback** if you have no key), then move the clock.
- Open <http://localhost:5173/client> (French client dashboard, see [The client dashboard](#the-client-dashboard)): pay invoices, open their detail, ask the assistant.
- The API listens on <http://localhost:8000> (interactive docs at `/docs`). The SQLite file lives in `./data/sim.sqlite` on the host (`data/` is git-ignored); delete it to start over.

### Upgrading an existing install

Existing databases are not migrated (the schema gained work steps and delivery summaries and lost the scripted payment behaviour). Start from an empty database:

```bash
docker compose down -v
rm -f data/sim.sqlite    # the database is a bind mount (./data), which `down -v` does not remove
docker compose up --build
```

### API key

Put the key in `.env`. Either name works; `ANTHROPIC_API_KEY` wins if both are set:

```
CLAUDE_API_KEY=sk-ant-...
# ANTHROPIC_API_KEY=sk-ant-...
BILLING_SIM_MODEL=claude-haiku-5-5
```

Other optional settings: `SIM_DB_PATH` (default `./sim.sqlite`, `/data/sim.sqlite` in Docker), `SIM_START_DATE` (default `2026-03-02`, day 0), `CONTRACT_TEMPLATE_PATH`, and `BILLING_SIM_ENV_FILE` to read another env file. Real environment variables override `.env`. Never commit `.env`.

## The client dashboard

`/client` is what the bank manager sees, in French, as of the simulation clock ("today"). Top to bottom:

- **Tiles**: `Contracté` (TTC, with the HT amount underneath), `Facturé`, `Payé`, `Reste à payer` and `En retard` (amount and number of overdue invoices; red when there is any).
- **Alert line**, when there is something to do: overdue invoices, the next invoice to pay before its due date, and the next invoice expected (lot, promised date, amount HT).
- **Factures**: one card per issued invoice, newest first, with filter pills `Toutes · À payer · En retard · Payées` (`En retard` includes `Très en retard`). A card shows the number, the lot (or the ticket charged separately), the amount TTC, the issue and due dates and the status.
- **Lots en cours**: the lots not invoiced yet, with their promised delivery date, progress and amount to come, expandable to their tickets.
- **Lots à valider** and the **assistant** (right column).

Every invoice has one of four statuses, computed as of today; the day counts are calendar days:

| Status | When |
|---|---|
| `À payer` | issued, unpaid, today is on or before the due date (the pill shows the days left) |
| `En retard` | unpaid, past the due date by 1 to 30 days (the pill shows the days late) |
| `Très en retard` | unpaid, more than 30 days past the due date |
| `Payée` | a payment was recorded on or before today (the pill shows its date) |

**Paying.** Press **Marquer comme payée** on a card or in the invoice detail. The payment is recorded at today's date, always in full (the amount TTC, reference `VIR-<number>-1`), then the whole page reloads: the card turns `Payée le …`, the tiles and the alert line follow. Paying an invoice twice shows the server's message under the button. If you move the clock back before the payment date the invoice is unpaid again, and paying it then replaces the later payment. The assistant only reads: it reports what is due and late but cannot pay.

**Invoice detail.** Clicking a card opens a drawer (its URL is `/client#facture-<number>`, so it can be linked or reloaded): the delivery summary in plain language, the tickets delivered (each expands to its description, planned steps and day-by-day journal), the price calculation (each ticket's size → days × daily rate, total HT, VAT, total TTC, days charged against days really spent, and why a fixed price does not change), and the payment. Close it with ✕, Escape or a click outside.

In the assistant's answers, `[F-2026-001]` opens that invoice's drawer, `[BANK-5]` expands the ticket where it is shown (in *Lots en cours*, or inside the drawer of the invoice that billed it) and `[L2]` expands that lot in *Lots en cours*, or opens its invoice once it is billed.

## The two MCP servers

Both speak MCP over stdio and read the same SQLite file (`SIM_DB_PATH`). Install the backend first (see Development).

| Server | Command | Purpose |
|---|---|---|
| Manager | `python -m billing_sim.mcp_manager` | Control plane: `generate`, `reset`, `get_clock`, `set_day`, `step`, `get_plan`, `get_timeline`, `get_ticket_full`, `diff_plan_vs_real`, `get_agent_tools`. Sees everything, including the future. |
| Client | `python -m billing_sim.mcp_client` | What the client agent can call: 13 read-only tools (`get_today`, `get_contract`, `get_summary`, `list_lots`, `get_lot`, `list_tickets`, `get_ticket`, `get_ticket_history`, `list_invoices`, `get_invoice`, `list_payments`, `list_pending_approvals`, `explain_price`). Past-only: every tool reads the clock itself and none accepts a day. |

To drive the simulation from **Claude Desktop**, add the manager to `claude_desktop_config.json` (use the absolute path of your virtualenv's Python; on Windows `backend\\.venv\\Scripts\\python.exe`):

```json
{
  "mcpServers": {
    "billing-sim-manager": {
      "command": "/path/to/billing-sim/backend/.venv/bin/python",
      "args": ["-m", "billing_sim.mcp_manager"],
      "env": {
        "SIM_DB_PATH": "/path/to/billing-sim/data/sim.sqlite",
        "BILLING_SIM_ENV_FILE": "/path/to/billing-sim/.env"
      }
    }
  }
}
```

Then ask Claude to generate a scenario, move the clock and inspect tickets. Using the same `SIM_DB_PATH` as the Docker stack (`./data/sim.sqlite`) lets the web dashboard follow along.

## Pricing policy

[`contract_template.json`](contract_template.json) is the only place prices come from:

```json
{ "tjm": {"dev": 600, "senior": 750, "architect": 900},
  "rate_card": {"S": 1, "M": 3, "L": 5, "XL": 10},
  "hours_per_day": 8, "payment_terms_days": 30, "overrun_rule": "absorbed",
  "vat_rate": 0.2, "currency": "EUR", "invoice_timing": "on_delivery" }
```

A ticket's size gives its days through the rate card, its assignee's profile gives its TJM, and `overrun_rule: absorbed` means the fee stays the rate-card price: time spent beyond the estimate does not change what is billed. Edit the file (or point `CONTRACT_TEMPLATE_PATH` elsewhere) to change the economics; no code change is needed.

## Development

Requirements: Python 3.12+, Node 24, Docker (optional).

```bash
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -e "backend[dev]"   # Windows: backend/.venv/Scripts/python.exe
(cd frontend && npm ci)

# run without Docker
(cd backend && .venv/bin/python -m uvicorn billing_sim.api.app:create_app --factory --reload)   # :8000
(cd frontend && npm run dev)                                                                    # :5173, proxies to :8000

bash scripts/test.sh     # backend pytest, then frontend vitest
```

A command line is available for quick checks: `python -m billing_sim.cli load`, `day N`, `summary`, `snapshot PATH`.

#### Dev-page snapshot

The `/dev` page tests render from `frontend/src/test-fixtures/dev-snapshot.json`, the backend's own `full_plan`, `full_timeline`, `diff_plan_vs_real` and clock output for the fallback scenario, so the frontend can only read keys the API really sends. `backend/tests/test_snapshot.py` fails when the file is out of date with the backend. Regenerate it after changing a dev route or the fixture:

```bash
cd backend && .venv/bin/python -m pytest tests/test_snapshot.py --update-snapshot
# or: .venv/bin/python -m billing_sim.cli snapshot ../frontend/src/test-fixtures/dev-snapshot.json
```

The `/client` page tests render the same way from `frontend/src/test-fixtures/client-snapshot.json` (the client routes' output on the last day, after the first invoice is paid on day 20 and the second on the last day); `--update-snapshot` regenerates both snapshots.

### End-to-end test

The Playwright test drives the real stack in a browser using the fallback scenario (no key needed): it generates a plan on `/dev`, moves the clock to the last day and checks that the ledger shows no payment yet, then on `/client` marks a `Très en retard` invoice paid (its card turns `Payée le …` and the `En retard` tile counts one invoice fewer), opens its detail (total TTC equals the card amount) and closes it with Escape.

```bash
docker compose up --build -d
(cd frontend && npx playwright install chromium)    # once
E2E=1 bash scripts/test.sh                          # or: cd frontend && npx playwright test
docker compose down
```

`E2E_BASE_URL` overrides the target (default `http://localhost:5173`). Without Docker, run the backend with uvicorn and the built frontend with `npm run build && npm run preview` (it proxies the API to `VITE_API_TARGET`, default `http://localhost:8000`), then point `E2E_BASE_URL` at the preview.

## Build log

Every change to this repo gets a row in [`buildlog.md`](buildlog.md): date, branch, what changed and how it was verified. Work happens on a `task/NN-name` branch, is merged into `develop`, then into `main` with the test suite green on each, and each merge gets its own row.

## Layout

```
backend/                 FastAPI app, billing policy, scenario schema and Haiku generation, expander, SQLite store, MCP servers, CLI
frontend/                Vite + React: /dev (English) and /client (French); Playwright e2e in e2e/
contract_template.json   pricing policy
docker-compose.yml       api (:8000) and web (:5173)
scripts/test.sh          repo-wide tests
docs/                    design spec and implementation plan
```
