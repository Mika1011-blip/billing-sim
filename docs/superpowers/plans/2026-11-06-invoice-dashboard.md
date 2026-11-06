# Invoice Dashboard, Participant Payments and Ticket Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client page becomes an invoice dashboard where the participant pays invoices, sees what is overdue, and can open any invoice down to what each ticket actually did and how its price is computed.

**Architecture:** The plan schema gains per-ticket work steps and per-lot delivery summaries (Haiku writes them, the fixture carries them); the expander stops scripting payments and writes the steps into the worklogs; a small `engine/payments.py` records participant payments at the current day; the client queries derive the four invoice statuses and the detail blocks; the React client page is rebuilt around invoice cards, a detail drawer and an expandable ticket row. A backend-generated client snapshot pins the JSON seam.

**Tech Stack:** Python 3.12+ / FastAPI / SQLite / Pydantic v2 / pytest; React 19 / Vite / TypeScript / vitest + testing-library / Playwright. Unchanged from the base plan.

**Spec:** `docs/superpowers/specs/2026-11-06-invoice-dashboard-design.md` (extends `docs/superpowers/specs/2026-11-06-billing-sim-design.md`).

## Global Constraints

- Everything the client sees is French; JSON keys stay French like the existing client API (`numero`, `statut`, `montant_ttc` …); plan-schema field names stay English (`steps`, `delivery_summary`).
- Invoice statuses are exactly `À payer`, `En retard`, `Très en retard`, `Payée`; `Payée partiellement` and `Émise` disappear everywhere (backend, types, i18n, tests).
- Payment = full `amount_ttc` at the current clock day, reference `VIR-<number>-1`; no partial payments, no amount input, no client-MCP `pay_invoice`.
- Client-facing day counts are calendar days between ISO dates.
- Seeded random draw order in the expander does not change (dates for a given `(plan, seed)` stay identical).
- Code never invents prose: only the templates in the spec §5 and the i18n file.
- Each task runs in its own worktree (`.worktrees/task-NN-*`, branch `task/NN-*` from `develop`), ends green on `bash scripts/test.sh`, appends one `buildlog.md` row, commits with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; the controller integrates task → develop → main with tests at each step.
- Frontend tests that need backend-shaped data read `frontend/src/test-fixtures/client-snapshot.json` (Task 4) or `dev-snapshot.json`; never hand-written records with guessed keys.

## Review Focus

1. Paying before any invoice is issued (day 0) or a number that exists only in the future → 404 with the French message, never a 500. (Task 3 test `test_pay_future_invoice_is_404`.)
2. Pay, scrub the clock back before the payment day, pay again → exactly one payment row remains, at the earlier day; the card went back to unpaid in between. (Task 3 `test_pay_after_rewind_rewrites_future_payment`; Task 6 `pay button follows paiement`.)
3. An invoice whose due date is after the simulation's last day is `À payer` with a positive `jours_restants` at the last day. (Task 4 `test_invoice_due_after_last_day_is_a_payer`.)
4. A ticket with more real work days than steps: every step still appears once, in order, and the extra days read `Poursuite : …`. (Task 2 `test_step_notes_more_days_than_steps`.)
5. A lot whose tickets are all charged separately has no lot invoice and no `planned_delivery_day`; `prochaine_facture` must skip it. (Task 4 `test_prochaine_facture_skips_lot_without_invoice`.)

---

## File structure

Backend (`backend/billing_sim/`):
- `scenario/schema.py`, `scenario/validate.py`, `scenario/prompts.py`, `scenario/fixtures/invoice_dashboard.json` — plan fields (Task 1).
- `store/schema.sql`, `store/load.py`, `store/dev_queries.py` — columns `lot.delivery_summary`, `ticket.steps`; drop `scenario.client_behaviour` (Task 1).
- `expander/invoicing.py` — no scripted payments (Task 1). `expander/events.py` — step notes (Task 2).
- `engine/payments.py` (new) — `pay_invoice` (Task 3); `api/routes_client.py`, `mcp_manager/server.py` — route and manager tool (Task 3).
- `store/queries.py` — statuses, invoice detail, summary extras, ticket extras (Task 4); `agent/prompt.py` (Task 4).
- Tests mirror: `tests/test_scenario.py`, `test_haiku.py`, `test_expander.py`, `test_store.py`, `test_engine.py`, `test_api.py`, `test_mcp_manager.py`, `test_mcp_client.py`, `test_snapshot.py`.

Frontend (`frontend/src/`):
- `types.ts`, `api.ts`, `i18n/fr.ts`, `lib/format.ts` (Task 5).
- `components/client/TicketDetail.tsx` (new, Task 5) — collapsed row + expanded detail + journal.
- `components/client/SummaryTiles.tsx`, `AlertLine.tsx` (new), `InvoiceGallery.tsx` (new), `InvoiceCard.tsx` (new), `LotsEnCours.tsx` (new), `pages/ClientPage.tsx` (Task 6); `InvoiceList.tsx` and `TicketTable.tsx` deleted (Task 6).
- `components/client/InvoiceDetail.tsx` (new, Task 7), `Assistant.tsx` (citations → drawer), `styles.css`, `e2e/demo.spec.ts`, `README.md` (Task 7).

Task order: 1 and 3 in parallel; 2 after 1; 4 after 2 and 3; 5 after 4; 6 after 5; 7 after 6.

---

### Task 1: Plan carries steps and delivery summaries; nobody pays by script

**Files:**
- Modify: `backend/billing_sim/scenario/schema.py`, `scenario/validate.py`, `scenario/prompts.py`, `scenario/fixtures/invoice_dashboard.json`
- Modify: `backend/billing_sim/store/schema.sql`, `store/load.py:33-42,79-106`, `store/dev_queries.py` (every `client_behaviour` read)
- Modify: `backend/billing_sim/expander/invoicing.py:77-115`
- Test: `backend/tests/test_scenario.py`, `test_haiku.py`, `test_expander.py`, `test_store.py`, `test_snapshot.py`

**Interfaces:**
- Produces: `TicketPlan.steps: list[str]` (2–8 items, each 1–160 chars after strip), `LotPlan.delivery_summary: str` (1–600 chars after strip); `ScenarioPlan` has no `client_behaviour`; `build_invoices(...)` returns `(invoices, approvals, [])`; DB columns `lot.delivery_summary TEXT NOT NULL`, `ticket.steps TEXT NOT NULL` (JSON list); `scenario` table has no `client_behaviour` column; `dev_queries.full_plan()` lots carry `delivery_summary`, tickets carry `steps`.

- [ ] **Step 1: Write the failing schema/validator/prompt tests** in `tests/test_scenario.py`

```python
def test_fixture_has_steps_and_summaries():
    plan = load_fixture()
    assert all(2 <= len(t.steps) <= 8 for t in plan.tickets)
    assert all(lot.delivery_summary.strip() for lot in plan.lots)
    assert not hasattr(plan, "client_behaviour")

def test_ticket_without_steps_is_rejected():
    data = fixture_dict(); data["tickets"][0].pop("steps")
    with pytest.raises(ValidationError): ScenarioPlan.model_validate(data)

def test_blank_step_and_blank_summary_messages():
    data = fixture_dict(); data["tickets"][0]["steps"][0] = "  "; data["lots"][0]["delivery_summary"] = " "
    errors = validate_plan(ScenarioPlan.model_validate(data))  # model-level: strip happens in the validator, not Pydantic
    assert "ticket BANK-1 : étape vide" in errors and "lot L1 : résumé de livraison vide" in errors

def test_prompt_mentions_steps_and_summary_not_behaviour():
    text = SYSTEM_PROMPT_FR.format(contract_json="{}")
    assert "steps" in text and "delivery_summary" in text and "client_behaviour" not in text
```
(`fixture_dict()` = `json.loads(fixture_path.read_text())`; add the helper if the file lacks one.)

- [ ] **Step 2: Run them** — `pytest tests/test_scenario.py -v` → FAIL (`steps` unknown / fixture invalid).

- [ ] **Step 3: Change the schema** in `scenario/schema.py`: add `steps: list[str] = Field(min_length=2, max_length=8)` to `TicketPlan` and `delivery_summary: str = Field(min_length=1, max_length=600)` to `LotPlan`; delete `ClientBehaviour` and `ScenarioPlan.client_behaviour`. Blank-after-strip checks go in `validate_plan` (so the message is French and collected with the others), not in Pydantic.

- [ ] **Step 4: Prompt rules** in `scenario/prompts.py`: replace the `client_behaviour` bullet with the two French rules from spec §3 (verbatim, naming the fields `steps` and `delivery_summary`).

- [ ] **Step 5: Fixture** — for all 13 tickets add `steps` (2–6 concrete French sentences each, in order; no digits of days or prices) and for the 3 lots `delivery_summary` (2–4 client-language sentences); delete `client_behaviour`.

- [ ] **Step 6: Store** — `schema.sql`: drop `scenario.client_behaviour`, add `lot.delivery_summary TEXT NOT NULL` and `ticket.steps TEXT NOT NULL`; `load.py`: insert them (`_json(ticket.steps)`), stop inserting `client_behaviour`; `dev_queries.full_plan()`: include `delivery_summary` on lots and `steps` (parsed) on tickets, remove any `client_behaviour` output.

- [ ] **Step 7: Expander** — `invoicing.py`: `build_invoices` returns `payments = []`; delete `_lot_payments`, the `behaviour`/`lot_position` maps and the `Payment` import if unused. Update `tests/test_expander.py` expectations: `len(timeline.payments) == 0`, drop behaviour-based assertions. Update `test_haiku.py` plan fixtures (add `steps`/`delivery_summary`, drop `client_behaviour`) and `test_store.py` assertions that counted payments or read `client_behaviour`.

- [ ] **Step 8: Snapshot** — `pytest tests/test_snapshot.py --update-snapshot` then plain run passes. Frontend `dev-snapshot.json` is committed with the change; `npm test -- --run` still green (the dev page ignores unknown keys — confirm).

- [ ] **Step 9: Full run** — `bash scripts/test.sh` → all green. Commit `feat(plan): work steps and delivery summaries; remove scripted payments`.

---

### Task 2: Worklogs say what was done (step notes)

**Files:**
- Modify: `backend/billing_sim/expander/events.py:33-38,50-53,115-128`
- Test: `backend/tests/test_expander.py`

**Interfaces:**
- Consumes: `TicketPlan.steps` (Task 1).
- Produces: `step_notes(steps: list[str], work_days: int) -> list[str]` (pure, module-level in `events.py`); worklog payload `{"hours": float, "note": str}` unchanged in shape; done-day comment `"Terminé. Étapes réalisées : " + " ; ".join(steps)`; progress comment `"Point d'avancement : " + steps[floor(d·n/D)]`.

- [ ] **Step 1: Failing tests**

```python
def test_step_notes_fewer_days_than_steps():
    assert step_notes(["a", "b", "c", "d"], 2) == ["a ; b", "c ; d"]

def test_step_notes_equal():
    assert step_notes(["a", "b", "c"], 3) == ["a", "b", "c"]

def test_step_notes_more_days_than_steps():
    notes = step_notes(["a", "b"], 5)
    assert notes == ["a", "Poursuite : a", "b", "Poursuite : b", "Poursuite : b"]

def test_worklogs_walk_the_steps_and_done_comment_lists_them():
    timeline = expand(load_fixture(), contract, seed=1, start_date=START)
    ev = [e for e in timeline.events if e.ticket_key == "BANK-5"]
    notes = [e.payload["note"] for e in ev if e.type == "worklog"]
    steps = next(t.steps for t in load_fixture().tickets if t.key == "BANK-5")
    assert all(any(s in n for n in notes) for s in steps)           # every step appears
    done = [e for e in ev if e.type == "comment" and e.payload["text"].startswith("Terminé. Étapes réalisées : ")]
    assert len(done) == 1 and all(s in done[0].payload["text"] for s in steps)

def test_dates_unchanged_by_step_notes():
    # Same seed → same real_start/real_end as the committed dev snapshot (draw order untouched).
```
(For the last test compare `ScheduledTicket.real_start/real_end` for the fixture at seed 1 against the values in `frontend/src/test-fixtures/dev-snapshot.json` `diff.tickets`.)

- [ ] **Step 2: Run** — FAIL (`step_notes` not defined).

- [ ] **Step 3: Implement** `step_notes` with the spec §5 rule: for `d in range(D)`, `assigned = steps[floor(d*n/D):floor((d+1)*n/D)]`; note is `" ; ".join(assigned)` or `"Poursuite : " + steps[floor(d*n/D)]`. In the ticket loop compute `work_days = [day for day in range(start, end+1) if day not in blocked_set]` *before* the loop, call `step_notes(ticket.steps, len(work_days))` and index with `worked`. Replace `_COMMENTS` formatting with `"Point d'avancement : " + steps[floor(worked*n/D)]` (same cadence draws). Add the done comment on `end` with rank `_R_COMMENT` just before the `DONE` transition. Delete `_notes` and the `re` import if unused.

- [ ] **Step 4: Run** `pytest tests/test_expander.py -v` → PASS; regenerate the snapshot (`--update-snapshot`), `bash scripts/test.sh` green. Commit `feat(expander): worklogs follow the ticket's work steps`.

---

### Task 3: Participant payment (engine, route, manager tool)

**Files:**
- Create: `backend/billing_sim/engine/payments.py`
- Modify: `backend/billing_sim/api/routes_client.py`, `backend/billing_sim/mcp_manager/server.py`
- Test: `backend/tests/test_engine.py`, `test_api.py`, `test_mcp_manager.py`, `test_mcp_client.py`

**Interfaces:**
- Produces: `pay_invoice(conn: sqlite3.Connection, number: str) -> dict` returning `{"facture", "date", "reference", "montant"}`; raises `store.db.NotFound("Enregistrement introuvable : <number>")` and `AlreadyPaid(Exception)` whose `str()` is `"Facture déjà payée le <date>"` (French long date via the existing `date_longue` helper is not required — ISO is fine). Route `POST /client/invoices/{number}/payer` → 200 / 404 / 409 `{"detail": ...}`. Manager MCP tool `pay_invoice(number: str) -> dict`.

- [ ] **Step 1: Failing engine tests** (`tests/test_engine.py`, fixture scenario loaded in memory, `set_day` as needed)

```python
def test_pay_records_full_amount_today(conn):
    set_day(conn, 20)  # F-2026-001 issued on day 7 in the fixture
    r = pay_invoice(conn, "F-2026-001")
    assert r == {"facture": "F-2026-001", "date": iso(20), "reference": "VIR-F-2026-001-1", "montant": 3600}

def test_pay_future_invoice_is_404(conn):
    set_day(conn, 0)
    with pytest.raises(NotFound): pay_invoice(conn, "F-2026-001")

def test_pay_twice_is_409(conn):
    set_day(conn, 20); pay_invoice(conn, "F-2026-001")
    with pytest.raises(AlreadyPaid): pay_invoice(conn, "F-2026-001")

def test_pay_after_rewind_rewrites_future_payment(conn):
    set_day(conn, 40); pay_invoice(conn, "F-2026-001")
    set_day(conn, 20); pay_invoice(conn, "F-2026-001")
    rows = conn.execute("SELECT day FROM payment WHERE invoice_id = (SELECT id FROM invoice WHERE number='F-2026-001')").fetchall()
    assert [r[0] for r in rows] == [20]
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement** `engine/payments.py` per spec §4 rules 1–4 in one `with conn:` transaction.

- [ ] **Step 4: Route and tool** — `routes_client.py`: `@router.post("/invoices/{number}/payer")` mapping `NotFound` → 404, `AlreadyPaid` → 409 (the existing `NotFound` handler covers 404; add a handler or `HTTPException` for 409). `mcp_manager/server.py`: `@mcp.tool() def pay_invoice(number: str) -> dict`. Tests: `test_api.py` 200/404/409 and the 404 message; `test_mcp_manager.py` tool listed; `test_mcp_client.py` asserts `"pay_invoice" not in agent_tool_list(...)`.

- [ ] **Step 5:** `bash scripts/test.sh` green. Commit `feat(payments): participant pays an invoice at the current day`.

---

### Task 4: Client queries: statuses, invoice detail, summary extras, ticket extras; agent prompt; client snapshot

**Files:**
- Modify: `backend/billing_sim/store/queries.py:131-168,228-245,256-300`, `backend/billing_sim/agent/prompt.py`
- Create: `frontend/src/test-fixtures/client-snapshot.json` (generated)
- Test: `backend/tests/test_store.py`, `test_api.py`, `test_snapshot.py`, `test_agent.py`, `test_mcp_client.py`

**Interfaces:**
- Consumes: `pay_invoice` (Task 3), columns from Task 1.
- Produces, as of `day`:
  - `_Ctx.invoices()` rows: `numero, lot, lot_nom, ticket, couvre, emise_le, echeance_le, montant_ht, tva, montant_ttc, statut, jours_de_retard, jours_restants, paiement, resume_livraison` (drop `paye`, `reste`, `en_retard`, `echeance`).
  - `get_invoice(conn, day, number)` adds `tickets: list[ticket record + "etapes"]` and `calcul: {total_ht, tva, taux_tva, total_ttc, jours_factures, jours_reels, ecart_jours}`; `list_invoices` rows carry the same two keys (spec §6).
  - `get_ticket`/`list_tickets` rows add `etapes: list[str]`, `journal_nombre: int`.
  - `summary()` adds `en_retard_nombre: int`, `a_payer: int`, `prochaine_facture: {lot, nom, date_prevue, montant_ht} | None`.
  - `_Ctx.lots()` rows add `resume_livraison`; lot `statut_facture` uses the new invoice statuses.
  - Client snapshot: `{"day": D, "today", "summary", "invoices", "tickets", "lots", "history": {"BANK-5": [...]}}` at `D = last_day` after `pay_invoice` of the first invoice at day 20 and of the second at `last_day` (so the snapshot holds `Payée` twice, at least one `Très en retard` and, if any, `À payer`).

- [ ] **Step 1: Failing store tests** (`tests/test_store.py`; `due` = `due_day` of F-2026-001, `d(x)` = ISO date of working day x)

```python
@pytest.mark.parametrize("day,expected", [("due-1", "À payer"), ("due", "À payer"), ("due+1", "En retard")])
def test_invoice_status_around_due_day(conn, day, expected): ...
def test_invoice_very_late_after_30_calendar_days(conn):
    # first day whose date − due date > 30 calendar days → "Très en retard"; the day before → "En retard"
def test_invoice_paid_status_and_paiement_block(conn):  # pay at day 20 → statut "Payée", paiement == {"date": d(20), "reference": "VIR-F-2026-001-1", "montant": 3600}
def test_days_late_and_remaining_are_calendar_days(conn):  # across a weekend: Friday due, Monday today → jours_de_retard == 3
def test_invoice_due_after_last_day_is_a_payer(conn):      # a separate-ticket invoice issued late in the run
def test_invoice_detail_calcul_matches_explain_price(conn):  # total_ht == explain_price total, tva half-up, total_ttc, jours_reels == Σ ticket jours_reels
def test_summary_extras(conn):  # en_retard_nombre, a_payer, prochaine_facture at day 20 == {"lot": "L2", "nom": ..., "date_prevue": d(planned), "montant_ht": price}
def test_prochaine_facture_skips_lot_without_invoice(conn):  # build a plan where one lot's tickets are all charged_separately
def test_ticket_has_etapes_and_journal_nombre(conn):
def test_lot_has_resume_livraison(conn):
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `queries.py`: statuses with `date.fromisoformat` arithmetic (`(today − due).days`), the `paiement` block from the earliest payment row with `day ≤ today`, `resume_livraison` (lot summary or ticket description), `tickets`+`calcul` built from `self.tickets("WHERE t.key IN (...)")` and the existing `explain_price` line logic (factor the `line()` helper to module level and reuse it), summary extras, `prochaine_facture` = lots with `planned_delivery_day IS NOT NULL` and no invoice with `issued_day ≤ today`, ordered by `planned_delivery_day`, first or `None`.

- [ ] **Step 4: Agent prompt** — append the French sentence from spec §7 to `SYSTEM_PROMPT_FR`; `test_agent.py` asserts `"Très en retard" in SYSTEM_PROMPT_FR`. `test_mcp_client.py`: `get_invoice` output contains `"calcul"` and `"resume_livraison"`; still 13 tools.

- [ ] **Step 5: Client snapshot test** in `tests/test_snapshot.py`: `test_client_snapshot_matches` builds the dict above, compares with the file, and `--update-snapshot` rewrites it (same flag as the dev snapshot). Generate it. README dev section: one sentence that both snapshots regenerate with the flag.

- [ ] **Step 6:** `bash scripts/test.sh` green (frontend untouched but run). Commit `feat(client-api): invoice statuses, detail, summary extras, client snapshot`.

---

### Task 5: Frontend types, API, i18n, TicketDetail

**Files:**
- Modify: `frontend/src/types.ts`, `src/api.ts`, `src/i18n/fr.ts`, `src/lib/format.ts`
- Create: `frontend/src/components/client/TicketDetail.tsx`, `TicketDetail.test.tsx`
- Modify: `src/components/client/Pill.tsx`, `Pill.test.tsx`

**Interfaces:**
- Consumes: `client-snapshot.json` (Task 4).
- Produces: `InvoiceStatus = 'À payer' | 'En retard' | 'Très en retard' | 'Payée'`; `ClientInvoice` (spec §6 keys, `tickets: ClientTicketDetail[]`, `calcul: InvoiceCalcul`, `paiement: ClientPaiement | null`); `ClientTicket` + `etapes: string[]`, `journal_nombre: number`; `ClientSummary` + `en_retard_nombre`, `a_payer`, `prochaine_facture: ProchaineFacture | null`; `ClientLot` + `resume_livraison`. `api.ts`: `getInvoice(number)`, `payInvoice(number) => request<Paiement>(`/client/invoices/${number}/payer`, { method: 'POST' })`, `getTicketHistory(key)` (exists or add). `fr.ts` new sections `invoiceStatus`, `invoiceCard`, `invoiceDetail`, `ticketDetail`, `alert`, `lotsEnCours` (all copy from spec §8–10). `fmtCalcul(t: ClientTicket) => "L → 5 j × 750 € = 3 750 €"`, `fmtDays(n) => "6,4 j"`.
- `TicketDetail({ ticket, defaultOpen?, revealKey? })`: collapsed row `id="rec-<key>"` with key, title, `fmtCalcul`, `<Pill>`, `fmtDays(jours_reels) réels`, `journal_nombre événements ▸`; expanded: description, `Assigné à`, `Du … au …` or `Non commencé`, numbered `Étapes prévues` with a `✓` on each step that appears in a worklog note, `Journal` list from `getTicketHistory(key)` fetched once per mount (icon per type: statut ↔, temps passé ⏱, blocage ⛔, déblocage ✅, commentaire 💬). Listens to `reveal-record` and opens when `detail.key === ticket.cle`.

- [ ] **Step 1: Failing tests** `TicketDetail.test.tsx` (fetch mocked with the snapshot's `history["BANK-5"]`): renders collapsed line with calc and event count; click expands and fetches history exactly once (second toggle: no new fetch); steps ticked = steps found in worklog notes; `reveal-record` with its key opens it. `Pill.test.tsx`: the four invoice statuses map to classes `ok`/`danger`/`danger-strong`/`info`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the files above. **Step 4:** `npm test -- --run`, `npx tsc --noEmit` green. Commit `feat(client): types, i18n and the ticket detail row`.

---

### Task 6: Client page as an invoice dashboard

**Files:**
- Create: `src/components/client/AlertLine.tsx`, `InvoiceGallery.tsx`, `InvoiceCard.tsx`, `LotsEnCours.tsx` (+ `.test.tsx` each)
- Modify: `src/components/client/SummaryTiles.tsx` (+test), `src/pages/ClientPage.tsx` (+test), `src/styles.css`
- Delete: `src/components/client/InvoiceList.tsx`, `InvoiceList.test.tsx`, `TicketTable.tsx`, `LotCard.tsx`, `LotCard.test.tsx`

**Interfaces:**
- Consumes: Task 5 types/components; `getInvoice` not needed here (list rows carry `tickets`/`calcul`).
- Produces: `InvoiceGallery({ invoices, onPay(number), onOpen(number) })` with filter state `'toutes' | 'a_payer' | 'en_retard' | 'payees'` (`en_retard` = both overdue statuses; pill labels with counts); `InvoiceCard({ invoice, onPay, onOpen })` with button `Marquer comme payée` (hidden when `paiement`), card `id="rec-<numero>"`, status text per spec §8.4; `AlertLine({ summary, invoices })`; `LotsEnCours({ lots, tickets })` = lots with `facture === null`, expandable to `TicketDetail` rows; `SummaryTiles` fifth tile `En retard` with `N facture(s)` and class `danger` when `> 0`; `ClientPage` layout per spec §8 and `pay(number)` = `payInvoice` → `refresh()`, 409 → `setError(detail)`.

- [ ] **Step 1: Failing tests** (render from `client-snapshot.json`; fetch mocked per URL): `InvoiceGallery` filter pills show counts and filter; `InvoiceCard` renders the four status variants (`Très en retard (N j)`, `En retard (N j)`, `À payer (N j restants)`, `Payée le …`) and hides the button when paid (`pay button follows paiement`); clicking the button calls `onPay(numero)`; `AlertLine` variants (nothing to do → not rendered; overdue count; `prochaine_facture`); `LotsEnCours` lists only uninvoiced lots and expands to ticket rows; `SummaryTiles` danger class; `ClientPage`: `POST …/payer` then a refetch of `/client/summary`, 409 body `detail` shown.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; delete the old components and their imports; styles: card grid (`repeat(auto-fill, minmax(260px, 1fr))`), `.pill.danger-strong`, `.tile.danger`, `.alert-line`. **Step 4:** `npm test -- --run`, `npm run build` green. Commit `feat(client): invoice dashboard with cards, filters and payment`.

---

### Task 7: Invoice detail drawer, citations, e2e, README

**Files:**
- Create: `src/components/client/InvoiceDetail.tsx` (+test)
- Modify: `src/pages/ClientPage.tsx`, `src/components/client/Assistant.tsx:20-60`, `src/styles.css`, `frontend/e2e/demo.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `ClientInvoice` rows (with `tickets`, `calcul`), `TicketDetail`, `InvoiceCard.onOpen`.
- Produces: `InvoiceDetail({ invoice, onClose, onPay })` modal drawer (`role="dialog"`, `aria-labelledby`), content per spec §9, forfait sentence chosen on `calcul.ecart_jours > 0`; `ClientPage` opens it for `location.hash === '#facture-<numero>'` and on `onOpen`, closes on ✕/Escape and clears the hash, returns focus to the card. `Assistant` citation links: `[F-…]` → `href="#facture-<n>"`; `[BANK-…]`/`[L…]` keep `#rec-<key>` + `reveal-record`.

- [ ] **Step 1: Failing tests** `InvoiceDetail.test.tsx`: title, summary text, one `TicketDetail` row per ticket, calc lines and totals, both forfait sentences, pay button vs `Payée le`; Escape calls `onClose`. `ClientPage.test.tsx`: hash `#facture-F-2026-001` on mount opens the drawer; `Assistant.test.tsx`: `[F-2026-001]` renders `href="#facture-F-2026-001"`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (drawer: fixed right panel ≤ 720px wide, backdrop, body scroll lock). **Step 4:** `npm test -- --run`, `npm run build` green.

- [ ] **Step 5: E2E** (`e2e/demo.spec.ts`): after generate + clock to end, go to `/client`; expect ≥ 2 cards with text `Très en retard`; click the first card's `Marquer comme payée`; expect that card to show `Payée le`; expect the `En retard` tile's count to have dropped by one; click the card → dialog visible, its `Total TTC` equals the card amount; Escape closes it. Replace the dev-page "Paid > 0" assertion with "Payé cells are all 0 before any participant payment".

- [ ] **Step 6: README** — client section: the dashboard, how to pay, the four statuses; upgrade note `docker compose down -v`. Run `E2E=1 bash scripts/test.sh` against local servers (uvicorn + `vite preview`) → green. Commit `feat(client): invoice detail drawer, citations, e2e`.

---

## Self-review notes

- Spec coverage: §2 decisions → T1 (schema/prompt/fixture/behaviour), T3 (payment rules), T4 (statuses, calendar days); §3 → T1; §4 → T3; §5 → T2; §6 → T4; §7 → T4; §8 → T6; §9 → T7; §10 → T5; §11 → T1 (`full_plan`), T3 (manager tool), T6 (ledger statuses fall out of T4); §12 → T3/T7; §13 → spread as named; §14 nothing to do.
- Type consistency: `paiement`, `calcul`, `etapes`, `journal_nombre`, `resume_livraison`, `prochaine_facture`, `en_retard_nombre`, `a_payer` used identically in T4–T7; `pay_invoice`/`AlreadyPaid` in T3/T4; `step_notes` in T2 only.
- Review Focus items each have a named test in T2, T3, T4, T6.

---

### Task 8: Due date in calendar days (spec §15.1)

**Files:**
- Modify: `backend/billing_sim/billing/policy.py:76-77` (`due_day`), `backend/billing_sim/expander/invoicing.py` (its one caller), `backend/billing_sim/expander/calendar.py` (reuse `first_working_day_on_or_after` if it lives in `expand.py`: move it to `calendar.py`)
- Test: `backend/tests/test_billing.py`, `test_expander.py`, snapshots regenerated (`--update-snapshot`), `frontend/src/test-fixtures/{dev,client}-snapshot.json`

**Interfaces:**
- Produces: `due_day(contract, issued_day: int, start_date: date) -> int` = index of the first working day whose date ≥ `date_for_day(start_date, issued_day) + timedelta(days=contract.payment_terms_days)`.

- [ ] **Step 1: Failing tests** — `test_due_day_is_30_calendar_days_rolled_to_monday`: issued on a Monday (day 0, 2026-03-02) → due date 2026-04-01 (Wednesday) → day index 22; issued day 4 (Friday 2026-03-06) → 2026-04-05 is a Sunday → 2026-04-06 (Monday) → day 25. `test_fixture_due_dates_are_calendar` in `test_expander.py`: for every invoice, `date(due) − date(issued)` is 30, 31 or 32 days and `date(due).weekday() < 5`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; update the caller; regenerate both snapshots; `bash scripts/test.sh` green (frontend tests read the snapshots, so they follow). Commit `fix(billing): due date is 30 calendar days`.

### Task 9: Client chronology view (spec §15.2) — after Task 7

**Files:**
- Modify: `backend/billing_sim/store/queries.py` (`tickets()` rows + `debut_prevu`, `fin_prevu`), `backend/tests/test_store.py`, snapshots regenerated
- Create: `frontend/src/components/client/Avancement.tsx` (+test), `ChronologieView.tsx` (+test), `ViewTabs.tsx`
- Modify: `frontend/src/pages/ClientPage.tsx` (+test), `types.ts`, `i18n/fr.ts` (`tabs`, `chronologie`), `styles.css`, `e2e/demo.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `TicketDetail` (Task 5), client snapshot incl. `history["BANK-5"]`, `ClientTicket` + `debut_prevu/fin_prevu`.
- Produces: `Avancement({ tickets, lots, today, history: Record<string, HistoryRow[]>, onSelect(key) })`; `ChronologieView({ tickets, lots, today })` (fetches history for in-progress/done tickets lazily, one request per ticket, cached as in `TicketDetail`); `ViewTabs({ value: 'factures' | 'chronologie', onChange })`; `ClientPage` keeps the tab in `localStorage` key `billing-sim.client.view`.

- [ ] **Step 1: Backend** — failing store test `test_ticket_has_planned_dates` (BANK-1 `debut_prevu == '2026-03-02'`), implement, regenerate snapshots.
- [ ] **Step 2: Frontend failing tests** per spec §15.2 (planned-only row; real bar clipped at today; hatched block from BANK-5 history; tab switch keeps tiles; list counts equal status counts). **Step 3: Implement.** **Step 4:** `npm test -- --run`, `npm run build` green; e2e extended per §15.2; README updated. Commit `feat(client): chronology view with planned vs real and ticket lists`.
