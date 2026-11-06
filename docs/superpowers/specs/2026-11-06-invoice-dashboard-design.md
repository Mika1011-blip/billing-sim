# Invoice dashboard, participant payments and ticket detail — design

Extends `2026-11-06-billing-sim-design.md` (the base spec). Everything not mentioned here is unchanged.

## 1. Purpose

The client page must answer, for a non-technical bank manager: *what am I paying, for what exactly, and am I up to date?* Today it shows a flat invoice list, scripted payments, and tickets reduced to a key, a title and a price. This change:

1. makes **payment a participant action** (nothing is paid unless the participant marks it paid), so the overdue state is real;
2. turns the invoice list into an **invoice dashboard** (cards, filters, overdue tiers, amounts due);
3. gives every invoice a **detail view**: a plain-language delivery summary, the tickets delivered with their own detail and journal, and the price calculation of each ticket and of the invoice;
4. makes the ticket journal **say what was actually done** each day (work steps written by Haiku at setup instead of the description repeated).

Billing cadence does not change: one invoice per lot on delivery, plus one per ticket flagged `charged_separately`. The TJM is the unit of pricing, never a billing period (régie would break the business model — base spec §1).

## 2. Fixed decisions

- Payments are recorded by the participant from the client page, at the **current clock day**, always **in full** (amount TTC). No partial payments, no amount input.
- The scripted `client_behaviour` (who pays late) is **removed** from the plan schema, the prompt, the fixture, the expander and the store.
- Scripted lot approvals (`approval` table, *Lots à valider*) are **unchanged** and out of scope.
- The client assistant stays **read-only**: it reports payment state and overdue amounts; it cannot pay.
- Invoice statuses (French, derived as of today; `Payée partiellement` disappears):
  - `À payer` — issued, unpaid, today ≤ due date
  - `En retard` — unpaid, due date < today ≤ due date + 30 calendar days
  - `Très en retard` — unpaid, today > due date + 30 calendar days
  - `Payée` — a payment row with `day ≤ today` exists
- Overdue and remaining days shown to the client are **calendar days** between dates (`date(today) − date(due)`), not working days.
- Haiku writes, per ticket, the ordered **work steps** (`steps`, 2–8 short French sentences) and, per lot, a **delivery summary** (`delivery_summary`, 2–4 French sentences in client language, no prices). Code never invents text at runtime beyond the fixed templates in §5.
- Existing databases are not migrated: upgrading means `docker compose down -v` (README note). The `scenario.client_behaviour` column is dropped from `schema.sql`.

## 3. Data model changes

`schema.sql`:
- `scenario`: drop `client_behaviour`.
- `lot`: add `delivery_summary TEXT NOT NULL`.
- `ticket`: add `steps TEXT NOT NULL` (JSON list of strings).
- `payment`: unchanged shape; rows are now written at runtime by the participant (see §4). It is the only timeline table a run writes to.

`scenario/schema.py`:
- `TicketPlan.steps: list[str]` — `Field(min_length=2, max_length=8)`, each item 1–160 chars after strip.
- `LotPlan.delivery_summary: str` — 1–600 chars after strip.
- Remove `ClientBehaviour` and `ScenarioPlan.client_behaviour`.

`scenario/validate.py` adds: blank step → `"ticket X : étape vide"`; blank delivery summary → `"lot L : résumé de livraison vide"`.

`scenario/prompts.py` (French, added to the rules):
- *steps* : « pour chaque ticket, 2 à 8 étapes de travail concrètes, dans l'ordre, une phrase courte chacune (ce que le développeur fait réellement : créer, brancher, tester, documenter…), sans chiffre de jours ni de prix ».
- *delivery_summary* : « pour chaque lot, 2 à 4 phrases que le client, non technique, comprend : ce qu'il peut désormais faire grâce à ce lot ; pas de vocabulaire technique, pas de prix ».
- Remove the `client_behaviour` rule.

`scenario/fixtures/invoice_dashboard.json`: every ticket gets `steps` (2–6 each), every lot a `delivery_summary`; `client_behaviour` removed.

## 4. Participant payment

`POST /client/invoices/{number}/payer` → `200 {"facture": number, "date": iso, "reference": "VIR-<number>-<n>", "montant": ttc}`.

Rules, in order:
1. The invoice must be visible as of today (`issued_day ≤ today`), else `404 {"detail": "Enregistrement introuvable : <number>"}`.
2. If a payment row with `day ≤ today` exists → `409 {"detail": "Facture déjà payée le <date>"}`.
3. Any payment rows for this invoice with `day > today` are deleted (the participant moved the clock back and is rewriting their own future action; a run never has two payments for one invoice at different points of one timeline).
4. Insert `payment(invoice_id, day = today, amount = amount_ttc, reference = "VIR-<number>-1")`.

`engine/payments.py`: `pay_invoice(conn, number) -> dict` implements 1–4; the route and the manager MCP `pay_invoice` tool (added for scripting demos) call it. The client MCP server does **not** expose it.

`expander/invoicing.py`: `build_invoices` returns no payments; `_lot_payments` and the behaviour map are deleted. `Timeline.payments` stays (empty from the expander) so `load_scenario` is unchanged.

## 5. Expander: work steps in the journal

`expander/events.py`, for a ticket with `D` real work days (days with a worklog) and `n = len(steps)`, work day `d` (0-based):

- `assigned = steps[ceil(d·n/D) : ceil((d+1)·n/D)]` (ceil, so a step is logged on its first day and continued afterwards; with floor the continuation would precede the step)
- note = `" ; ".join(assigned)` when `assigned` is non-empty, else `"Poursuite : " + steps[floor(d·n/D)]`
- The worklog payload becomes `{"hours": h, "note": note}` as today; `_notes()` and the description-sentence recycling are removed.
- The comment emitted on the day the ticket becomes `Terminé` is `"Terminé. Étapes réalisées : " + " ; ".join(steps)`. The periodic progress comment keeps its current rule but reads `"Point d'avancement : " + steps[floor(d·n/D)]`.
- `scope_note` beats stay comments as today; `blocked`/`review_changes` beats unchanged.

Seeded draws are not touched (same `random` draw order), so a given `(plan, seed)` keeps its dates; only note texts change. The dev snapshot (`frontend/src/test-fixtures/dev-snapshot.json`) is regenerated once.

## 6. Client API (as-of today; French keys like the rest)

`GET /client/invoices` and `GET /client/invoices/{number}` rows gain:

```
numero, lot (key|null), lot_nom, ticket (key|null), emise_le, echeance_le,
montant_ht, tva, montant_ttc,
statut: "À payer" | "En retard" | "Très en retard" | "Payée",
jours_de_retard (int, 0 unless overdue), jours_restants (int, 0 unless À payer),
paiement: {date, reference, montant} | null,
resume_livraison (lot delivery_summary, or the ticket description for a separate ticket),
tickets: [ticket record as GET /client/tickets/{key}, plus "etapes": [...]],
calcul: {total_ht, tva, taux_tva, total_ttc, jours_factures, jours_reels, ecart_jours}
```
`ecart_jours = jours_reels − jours_factures` (rounded to 2 decimals); the UI renders the overrun sentence (§8).

`GET /client/tickets/{key}` gains `etapes` (the steps) and `journal_nombre` (event count as of today). `GET /client/tickets/{key}/history` is unchanged.

`GET /client/summary` gains `en_retard_nombre` (count of En retard + Très en retard invoices), `a_payer` (TTC sum of À payer), and `prochaine_facture: {lot, nom, date_prevue, montant_ht} | null` — among the lots with no invoice issued as of today, the one with the earliest `planned_delivery_day` (the date is plan data: it is what the client was promised, even when the team is late).

`GET /client/lots` rows gain `resume_livraison`.

`explain_price` already returns the per-ticket lines; the invoice `calcul` reuses it.

## 7. Client MCP server and agent

- `list_invoices`, `get_invoice`, `get_summary`, `get_ticket`, `list_lots` return the extended records above (same functions, so no new tool).
- No `pay_invoice` tool on the client server. The agent prompt gains: « Le client règle ses factures depuis son tableau de bord ; tu ne peux pas payer à sa place. Une facture est *En retard* après sa date d'échéance et *Très en retard* 30 jours après ; rappelle les montants et les dates. »
- `agent_tool_list` test is updated for the new fields; the tool count is unchanged (13).

## 8. Client page (`/client`)

Layout, top to bottom (the assistant keeps the right column):

1. **Header** — unchanged.
2. **Tiles** — `Contracté (TTC)` with HT sub-line, `Facturé`, `Payé`, `Reste à payer`, **`En retard`** (amount + `N facture(s)`; the tile takes the danger style when > 0).
3. **Alert line** — when there is something to do: « ⚠ 2 factures en retard · 1 facture à payer avant le 20/05/2026 » and, when `prochaine_facture` exists, « Prochaine facture : L3 · Exports et notifications, prévue vers le 02/06/2026 (9 000 € HT) ».
4. **Factures** — filter pills `Toutes · À payer · En retard · Payées` (`En retard` includes `Très en retard`; counts in the pills), then a responsive card grid, newest first. Card: number · lot name (or ticket title + *facturée séparément*), amount TTC, `Émise le … · Échéance le …`, status pill (`Très en retard` in a darker danger style with `(N j)`, `En retard (N j)`, `À payer (N j restants)`, `Payée le …`), button **Marquer comme payée** (hidden when paid), and the card is clickable → detail (§9). Empty state: « Aucune facture émise pour le moment. »
5. **Lots en cours** — lots not yet invoiced: name, `livraison prévue le …`, `k/n tickets terminés`, `montant HT à venir`, expandable to their ticket rows (each with the ticket detail of §10).
6. **Lots à valider** — unchanged.
7. The old flat `InvoiceList` and the lot-grouped `TicketTable` sections are removed (tickets are reached through invoices and *Lots en cours*).

**Marquer comme payée** → `POST …/payer` → refetch everything; a `409` shows the backend message inline. The assistant's chat session is unaffected (same day).

## 9. Invoice detail (`InvoiceDetail`, a modal drawer over the client page, URL hash `#facture-<number>` so citations can open it)

```
F-2026-002 · Lot L2 — Suivi des paiements            [pill] · Échéance le 14/05/2026
Résumé de la livraison        → resume_livraison
Ce qui a été livré            → one row per ticket (§10), collapsed by default
Calcul
  <ticket lines>  BANK-5  L → 5 j × 750 € = 3 750 € HT
  Total HT 9 000 € · TVA 20 % 1 800 € · Total TTC 10 800 €
  Jours facturés 12 · jours réellement passés 14,2
  → sentence: ecart > 0: « L'écart de 2,2 j est absorbé par le prestataire : le prix du forfait ne change pas. »
              ecart ≤ 0: « Le lot a demandé moins de jours que prévu : le prix du forfait ne change pas. »
Paiement                      → « Payée le … (réf. …) » or the Marquer comme payée button
```
Close with ✕ or Escape; focus returns to the card.

## 10. Ticket detail (`TicketDetail`, used in §8.5 and §9)

Collapsed row: `BANK-5 · Rapprochement automatique · L → 5 j × 750 € = 3 750 €` · status pill · `6,4 j réels` · `12 événements ▸`.
Expanded: description · `Assigné à` · `Du … au …` (real dates, or `Non commencé`) · **Étapes prévues** (numbered list of `etapes`, each ticked when a worklog note containing it exists as of today) · **Journal** (`/history`, oldest first): date · icon per type (statut ↔, temps passé ⏱, blocage ⛔, déblocage ✅, commentaire 💬) · actor · text. History is fetched on first expand and cached per `(key, day)`.

Assistant citations: `[BANK-5]` scrolls to and expands the ticket row where it is visible (invoice drawer if open, else *Lots en cours*); `[F-2026-002]` opens the invoice drawer.

## 11. Dev page

- Ledger: payments column now reflects participant payments (no code change beyond the removed `Payée partiellement` status).
- Setup result panel no longer shows `client_behaviour`.
- Manager MCP: `pay_invoice(number)` tool added (for scripted demos), `full_plan` returns `steps` and `delivery_summary`.

## 12. Errors

- `POST …/payer` on an unknown or future invoice: 404 French message (§4). Already paid: 409. No scenario: 404 `no scenario loaded` as elsewhere.
- Haiku plan missing `steps`/`delivery_summary`: Pydantic rejects → existing retry-once path → `GenerationFailed`.
- UI: a failed `payer` call shows `fr.invoice.payError` under the button; the card keeps its state.

## 13. Testing

Backend (pytest): payment rules 1–4 (incl. the rewrite of a future payment), statuses at due−1 / due / due+1 / due+30 / due+31 / after payment, `jours_de_retard` and `jours_restants` in calendar days across a weekend, summary `en_retard_nombre`/`a_payer`/`prochaine_facture`, invoice `calcul` equals `explain_price` lines and VAT half-up, step distribution for `D < n`, `D = n`, `D > n` (every step appears at least once, order preserved), fixture validates, prompt contains the two new rules and no longer mentions `client_behaviour`, client MCP tool list has no `pay_invoice`, snapshot test.
Frontend (vitest): filter pills and counts, card status rendering for the four statuses, pay button → POST then refetch, 409 message shown, drawer opens from card and from hash, ticket row expands and fetches history once, steps ticked from worklog notes, alert line variants, tiles danger style.
E2E: generate (fallback), clock to end, `/client` shows ≥ 2 `Très en retard` cards, mark one paid → it becomes `Payée` and the `En retard` tile count drops by one, open its drawer → total TTC equals the card amount.

## 14. Out of scope

Partial payments, editing amounts, participant-driven approvals, payment reminders/e-mails, exporting invoices, a separate route for the invoice list.

## 15. Addendum (2026-11-06, after the interface guideline document)

### 15.1 Due date in calendar days
`due_day` was `issued_day + payment_terms_days` in **working** days. The contract's "30 jours" means calendar days and the overdue tiers already count calendar days, so: `due_day = day_for_date(first working day on or after date(issued_day) + payment_terms_days calendar days)` (Saturday/Sunday roll to Monday). `policy.due_day(contract, issued_day)` keeps its signature but needs `start_date`; it becomes `due_day(contract, issued_day, start_date)`. `last_day` (35 calendar days after the latest due date) follows automatically. Both snapshots are regenerated; the fixture's dates shift earlier.

### 15.2 Client chronology view (Vue 1)
A second client layout, switchable with two tabs under the tiles: **Chronologie** and **Factures** (the §8 dashboard; `Factures` is the default). Both share the header, the tiles, the alert line, *Lots à valider*, the assistant and the ticket detail (§10).

Chronologie, top to bottom:
1. **Avancement** — a French Gantt (`components/client/Avancement.tsx`), one row per ticket grouped by lot (then *Sans lot*), x-axis in working days with sprint bands and date ticks every 5 days, a grey bar for the planned span (`planned_start`/`planned_end`), a blue bar for the real span **clipped at today** (`debut_reel` to `min(fin_reel ?? today, today)`), hatched segments for days in `Bloqué` (from the history: between a *Blocage* and the next *Déblocage*, clipped at today), a red today line, the legend `prévu · réel · bloqué · aujourd'hui`. A ticket not started has no blue bar. Clicking a row opens its ticket detail (§10) below the chart (one open at a time).
2. **Terminé (n)** — the tickets with `statut = Terminé`, newest `fin_reel` first: `TicketDetail` rows.
3. **Reste à faire (n)** — the other tickets ordered by planned start: `TicketDetail` rows; a not-started ticket shows `Début prévu le …`.

Data: the client ticket record gains `debut_prevu` and `fin_prevu` (ISO dates from `planned_start_day`/`planned_end_day`; plan data, not future-filtered — the plan was shown to the client at signature); the history already exposes blocks. No new route.

Tests: planned-only row for a not-started ticket; real bar clipped at today for a ticket in progress; hatched block from the BANK-5 history in the snapshot; the tab switch keeps the tiles; the lists' counts equal the status counts in the snapshot; e2e: open *Chronologie* at the last day, every ticket is in *Terminé*, click one → the detail shows its journal.
