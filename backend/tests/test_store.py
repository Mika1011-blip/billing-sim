import json
import sqlite3
from datetime import date

import pytest

from billing_sim.billing.policy import invoice_total
from billing_sim.engine.clock import get_day, last_day, set_day
from billing_sim.engine.payments import pay_invoice
from billing_sim.expander.calendar import date_for_day
from billing_sim.expander.expand import expand
from billing_sim.store.db import NotFound, connect, wipe
from billing_sim.store.dev_queries import (
    diff_plan_vs_real,
    full_plan,
    full_timeline,
    ticket_full,
)
from billing_sim.store.load import load_scenario
from billing_sim.store.queries import (
    explain_price,
    get_contract,
    get_invoice,
    get_lot,
    get_ticket,
    list_invoices,
    list_lots,
    list_payments,
    list_tickets,
    pending_approvals,
    summary,
    ticket_history,
    today,
)

from .conftest import START

INV1 = "F-2026-001"
INV2 = "F-2026-002"
STATUSES = {"À faire", "En cours", "Bloqué", "En revue", "Terminé"}
INVOICE_KEYS = {
    "numero", "lot", "lot_nom", "ticket", "couvre", "emise_le", "echeance_le", "montant_ht", "tva", "montant_ttc",
    "statut", "jours_de_retard", "jours_restants", "paiement", "resume_livraison", "tickets", "calcul",
}  # fmt: skip


def _invoice(conn, number):
    return next(i for i in full_timeline(conn)["invoices"] if i["number"] == number)


def _diff_ticket(conn, key):
    return next(t for t in diff_plan_vs_real(conn)["tickets"] if t["key"] == key)


def _pay(conn, number, day, amount, n=1):
    """Payments are written at runtime now (the expander emits none): insert one row as the participant would."""
    with conn:
        conn.execute(
            "INSERT INTO payment (invoice_id, day, amount, reference)"
            " SELECT id, ?, ?, ? FROM invoice WHERE number = ?",
            (day, amount, f"VIR-{number}-{n}", number),
        )


# --- the brief's tests -------------------------------------------------------------------


def test_as_of_never_leaks_future(conn):
    for d in range(0, last_day(conn), 7):
        limit = date_for_day(START, d).isoformat()
        for ticket in list_tickets(conn, d):
            for entry in ticket_history(conn, d, ticket["cle"]):
                assert entry["date"] <= limit
            for field in ("debut_reel", "fin_reel"):
                assert ticket[field] is None or ticket[field] <= limit
        for invoice in list_invoices(conn, d):
            assert invoice["emise_le"] <= limit
        for payment in list_payments(conn, d):
            assert payment["date"] <= limit
        for lot in list_lots(conn, d):
            for field in ("livre_le", "approuve_le"):
                assert lot[field] is None or lot[field] <= limit


def test_day_zero_summary(conn, timeline):
    s = summary(conn, 0)
    assert s["contracte"] == sum(t.fee for t in timeline.tickets)
    assert s["contracte_ttc"] == 30600 == round(s["contracte"] * 1.2)  # HT 25 500 + 20 % VAT
    assert s["facture"] == 0 == s["paye"]
    assert s["reste_a_payer"] == 0 and s["en_retard"] == 0
    assert list_invoices(conn, 0) == []


def test_status_before_and_after_start(conn):
    starts = {key: _diff_ticket(conn, key)["real_start"] for key in ("BANK-1", "BANK-5")}
    assert starts["BANK-5"] > 0  # a ticket that really starts after day 0, so "before" is testable
    for key, start in starts.items():
        if start > 0:
            assert get_ticket(conn, start - 1, key)["statut"] == "À faire"
        assert get_ticket(conn, start, key)["statut"] == "En cours"


def test_loaded_scenario_has_no_payments(conn):
    assert conn.execute("SELECT COUNT(*) FROM payment").fetchone()[0] == 0
    unpaid = get_invoice(conn, last_day(conn), INV1)
    assert unpaid["statut"] == "Très en retard" and unpaid["paiement"] is None
    assert unpaid["jours_de_retard"] > 30 and unpaid["jours_restants"] == 0


def _d(day):
    return date_for_day(START, day).isoformat()


def _pay_on(conn, number, day):
    """Pay as the participant does: move the clock to `day`, then mark the invoice paid."""
    set_day(conn, day)
    return pay_invoice(conn, number)


@pytest.mark.parametrize("offset,expected", [(-1, "À payer"), (0, "À payer"), (1, "En retard")])
def test_invoice_status_around_due_day(conn, offset, expected):
    due = _invoice(conn, INV1)["due_day"]
    assert get_invoice(conn, due + offset, INV1)["statut"] == expected


def test_invoice_very_late_after_30_calendar_days(conn):
    due = _invoice(conn, INV1)["due_day"]
    due_date = date_for_day(START, due)
    first = next(d for d in range(due, last_day(conn) + 1) if (date_for_day(START, d) - due_date).days > 30)
    assert (date_for_day(START, first - 1) - due_date).days == 30  # the fixture has a day exactly 30 days late
    before, after = get_invoice(conn, first - 1, INV1), get_invoice(conn, first, INV1)
    assert (before["statut"], before["jours_de_retard"]) == ("En retard", 30)
    assert (after["statut"], after["jours_de_retard"]) == ("Très en retard", 31)


def test_invoice_paid_status_and_paiement_block(conn):
    assert get_invoice(conn, 19, INV1)["paiement"] is None
    _pay_on(conn, INV1, 20)
    for day in (20, last_day(conn)):
        paid = get_invoice(conn, day, INV1)
        assert paid["statut"] == "Payée" and paid["jours_de_retard"] == 0 == paid["jours_restants"]
        assert paid["paiement"] == {"date": _d(20), "reference": "VIR-F-2026-001-1", "montant": 3600}
    before = get_invoice(conn, 19, INV1)
    assert before["statut"] == "À payer" and before["paiement"] is None


def test_days_late_and_remaining_are_calendar_days(conn):
    due = _invoice(conn, INV1)["due_day"]
    assert date_for_day(START, due).weekday() == 1  # due on a Tuesday
    friday, monday = due - 2, due + 4
    assert date_for_day(START, friday).weekday() == 4 and date_for_day(START, monday).weekday() == 0
    remaining = get_invoice(conn, friday, INV1)
    assert (remaining["jours_restants"], remaining["jours_de_retard"]) == (4, 0)  # 2 working days, 4 calendar days
    late = get_invoice(conn, monday, INV1)
    assert (late["jours_de_retard"], late["jours_restants"]) == (6, 0)  # 4 working days, 6 calendar days
    assert get_invoice(conn, due, INV1)["jours_restants"] == 0


def test_invoice_due_after_last_day_is_a_payer(conn):
    end = last_day(conn)
    with conn:  # the separate ticket's invoice issued late in the run, due after its end
        conn.execute("UPDATE invoice SET issued_day = ?, due_day = ? WHERE ticket_id IS NOT NULL", (end - 2, end + 28))
    separate = next(i for i in list_invoices(conn, end) if i["ticket"] is not None)
    expected = (date_for_day(START, end + 28) - date_for_day(START, end)).days
    assert separate["statut"] == "À payer" and separate["jours_restants"] == expected == 40
    assert separate["echeance_le"] == _d(end + 28) and separate["jours_de_retard"] == 0


def test_invoice_row_keys_and_delivery_summary(conn, plan):
    end = last_day(conn)
    rows = list_invoices(conn, end)
    assert [i["numero"] for i in rows] == [INV1, INV2, "F-2026-003", "F-2026-004"]
    for row in rows:
        assert set(row) == INVOICE_KEYS
    lot_invoice, separate = rows[0], rows[2]
    assert (lot_invoice["lot"], lot_invoice["ticket"]) == ("L1", None)
    assert lot_invoice["lot_nom"] == "Tableau de bord factures"
    assert lot_invoice["resume_livraison"] == next(lot.delivery_summary for lot in plan.lots if lot.key == "L1")
    assert (separate["lot"], separate["lot_nom"], separate["ticket"]) == (None, None, "BANK-12")
    assert separate["resume_livraison"] == next(t.description for t in plan.tickets if t.key == "BANK-12")
    assert get_invoice(conn, end, INV2) == rows[1]


def test_invoice_detail_calcul_matches_explain_price(conn, contract):
    end = last_day(conn)
    for number, key in ((INV2, "L2"), ("F-2026-003", "BANK-12")):
        inv = get_invoice(conn, end, number)
        explained = explain_price(conn, end, key)
        total_ht = explained["total"] if explained["type"] == "lot" else explained["montant"]
        tickets = inv["tickets"]
        assert [t["cle"] for t in tickets] == inv["couvre"]
        assert tickets == [get_ticket(conn, end, t["cle"]) for t in tickets]
        assert all(t["etapes"] for t in tickets)
        calcul = inv["calcul"]
        vat, ttc = invoice_total(contract, total_ht)
        jours_reels = round(sum(t["jours_reels"] for t in tickets), 2)
        jours_factures = sum(t["jours_factures"] for t in tickets)
        assert calcul == {
            "total_ht": total_ht,
            "tva": vat,
            "taux_tva": 0.2,
            "total_ttc": ttc,
            "jours_factures": jours_factures,
            "jours_reels": jours_reels,
            "ecart_jours": round(jours_reels - jours_factures, 2),
        }
        totals = (calcul["total_ht"], calcul["tva"], calcul["total_ttc"])
        assert totals == (inv["montant_ht"], inv["tva"], inv["montant_ttc"])
    assert list_invoices(conn, end)[1] == get_invoice(conn, end, INV2)


def test_summary_extras(conn):
    early = summary(conn, 20)
    assert (early["en_retard_nombre"], early["en_retard"], early["a_payer"]) == (0, 0, 3600)
    assert early["prochaine_facture"] == {
        "lot": "L2", "nom": "Suivi des paiements", "date_prevue": _d(19), "montant_ht": 13650,
    }  # fmt: skip
    end = last_day(conn)
    late = summary(conn, end)
    assert late["en_retard_nombre"] == 4 and late["en_retard"] == late["facture"] and late["a_payer"] == 0
    assert late["prochaine_facture"] is None
    _pay_on(conn, INV1, end)
    paid = summary(conn, end)
    assert (paid["en_retard_nombre"], paid["en_retard"]) == (3, late["en_retard"] - 3600)
    assert paid["paye"] == 3600 and paid["reste_a_payer"] == paid["facture"] - 3600


def test_prochaine_facture_skips_lot_without_invoice(plan, contract):
    tickets = [t.model_copy(update={"charged_separately": True}) if t.lot_key == "L2" else t for t in plan.tickets]
    separate_l2 = plan.model_copy(update={"tickets": tickets})
    timeline = expand(separate_l2, contract, seed=42, start_date=START)
    c = connect(":memory:")
    try:
        load_scenario(
            c, plan=separate_l2, contract=contract, timeline=timeline, request_text="x", seed=42, start_date=START
        )
        assert c.execute("SELECT planned_delivery_day FROM lot WHERE key = 'L2'").fetchone()[0] is None
        l1_issued = c.execute(
            "SELECT i.issued_day FROM invoice i JOIN lot l ON l.id = i.lot_id WHERE l.key = 'L1'"
        ).fetchone()[0]
        assert summary(c, l1_issued)["prochaine_facture"]["lot"] == "L3"
        assert summary(c, l1_issued - 1)["prochaine_facture"]["lot"] == "L1"
    finally:
        c.close()


def test_ticket_has_etapes_and_journal_nombre(conn, plan):
    steps = next(t.steps for t in plan.tickets if t.key == "BANK-5")
    for day in (0, 30, last_day(conn)):
        t = get_ticket(conn, day, "BANK-5")
        assert t["etapes"] == steps
        assert t["journal_nombre"] == len(ticket_history(conn, day, "BANK-5"))
    assert get_ticket(conn, last_day(conn), "BANK-5")["journal_nombre"] > 0
    listed = {t["cle"]: t for t in list_tickets(conn, 30)}
    assert listed["BANK-5"] == get_ticket(conn, 30, "BANK-5")


def test_lot_has_resume_livraison(conn, plan):
    summaries = {lot.key: lot.delivery_summary for lot in plan.lots}
    assert {lot["cle"]: lot["resume_livraison"] for lot in list_lots(conn, 0)} == summaries
    assert get_lot(conn, 0, "L2")["resume_livraison"] == summaries["L2"]
    assert get_lot(conn, last_day(conn), "L1")["statut_facture"] == "Très en retard"


def test_lot_actual_days_match_its_invoice_calcul(conn):
    for day in (30, last_day(conn)):
        invoices = {i["lot"]: i for i in list_invoices(conn, day) if i["lot"] is not None}
        for lot in list_lots(conn, day):
            tickets = list_tickets(conn, day, lot_key=lot["cle"])
            own = [t for t in tickets if not t["facture_separement"]]
            assert lot["jours_reels"] == round(sum(t["jours_reels"] for t in own), 2)
            if lot["cle"] in invoices:
                assert lot["jours_reels"] == invoices[lot["cle"]]["calcul"]["jours_reels"]
    end = last_day(conn)
    assert get_lot(conn, end, "L3")["jours_reels"] == get_invoice(conn, end, "F-2026-004")["calcul"]["jours_reels"]


def test_explain_price_ticket(conn):
    e = explain_price(conn, last_day(conn), "BANK-1")
    assert e["taille"] == "M" and e["jours"] == 3 and e["tjm"] == 600 and e["montant"] == 1800
    assert e["lot"] == "L1"
    assert e["facture"] == INV1


def test_explain_price_lot(conn):
    e = explain_price(conn, last_day(conn), "L1")
    assert e["total"] == 3000
    assert [line["cle"] for line in e["lignes"]] == ["BANK-1", "BANK-2", "BANK-3"]
    assert sum(line["montant"] for line in e["lignes"]) == e["total"]
    assert e["facture"] == INV1


def test_explain_price_hides_invoice_before_it_is_issued(conn):
    assert explain_price(conn, 0, "BANK-1")["facture"] is None
    assert explain_price(conn, 0, "L1")["facture"] is None


def test_pending_approvals_window(conn):
    timeline = full_timeline(conn)
    lots = {lot["key"]: lot for lot in diff_plan_vs_real(conn)["lots"]}
    assert timeline["approvals"]

    def pending(day):
        return {p["cle"] for p in pending_approvals(conn, day)}

    for approval in timeline["approvals"]:
        key, approved = approval["lot"], approval["day"]
        delivered = lots[key]["real_delivery_day"]
        assert delivered < approved
        assert key in pending(delivered)
        assert key in pending(approved - 1)
        assert key not in pending(approved)
        assert key not in pending(last_day(conn))
        if delivered > 0:
            assert key not in pending(delivered - 1)


def test_not_found(conn):
    with pytest.raises(NotFound):
        get_ticket(conn, 0, "BANK-999")
    with pytest.raises(NotFound):
        get_lot(conn, 0, "L9")
    with pytest.raises(NotFound):
        get_invoice(conn, 0, "F-2026-999")
    with pytest.raises(NotFound):
        explain_price(conn, 0, "nope")
    with pytest.raises(NotFound):
        ticket_history(conn, 0, "BANK-999")
    with pytest.raises(KeyError):  # NotFound is a KeyError
        ticket_full(conn, "BANK-999")


def test_diff_has_every_ticket(conn, plan):
    diff = diff_plan_vs_real(conn)
    assert len(diff["tickets"]) == len(plan.tickets) >= 12
    assert len(diff["lots"]) == len(plan.lots)
    assert {lot["key"]: lot["name"] for lot in diff["lots"]} == {lot.key: lot.name for lot in plan.lots}
    assert {t["key"]: t["assignee"] for t in diff["tickets"]} == {t["key"]: t["assignee"] for t in full_plan(conn)["tickets"]}
    for t in diff["tickets"]:
        assert t["slip_days"] == t["real_end"] - t["planned_end"]
        assert t["planned_start"] <= t["planned_end"] and t["real_start"] <= t["real_end"]


# --- more behaviour ----------------------------------------------------------------------


def test_today_is_french_without_locale(conn):
    assert today(conn, 0) == {"jour": 0, "date": "2026-03-02", "date_longue": "lundi 2 mars 2026"}
    assert today(conn, 4)["date_longue"] == "vendredi 6 mars 2026"
    assert today(conn, 5)["date_longue"] == "lundi 9 mars 2026"
    assert today(conn, 21 * 5)["date_longue"] == "lundi 27 juillet 2026"
    assert today(conn, 5 * 43 + 2)["date_longue"] == "mercredi 30 décembre 2026"


def test_first_of_the_month_is_written_1er(conn):
    assert today(conn, 22) == {"jour": 22, "date": "2026-04-01", "date_longue": "mercredi 1er avril 2026"}
    assert today(conn, 23)["date_longue"] == "jeudi 2 avril 2026"


def test_get_contract_explains_each_profile(conn, contract):
    c = get_contract(conn)
    assert c["tjm"] == contract.tjm and c["rate_card"] == contract.rate_card
    assert c["payment_terms_days"] == 30 and c["vat_rate"] == 0.2 and c["currency"] == "EUR"
    assert c["explication"]["dev"] == "Développeur : 600 € par jour"
    assert set(c["explication"]) == set(contract.tjm)


def test_ticket_statuses_are_valid_and_end_done(conn):
    for d in range(0, last_day(conn), 3):
        for t in list_tickets(conn, d):
            assert t["statut"] in STATUSES
    assert {t["statut"] for t in list_tickets(conn, last_day(conn))} == {"Terminé"}
    assert {t["statut"] for t in list_tickets(conn, 0)} <= {"À faire", "En cours"}


def test_ticket_dict_fields(conn):
    t = get_ticket(conn, last_day(conn), "BANK-1")
    assert t["cle"] == "BANK-1" and t["lot"] == "L1" and t["facture_separement"] is False
    assert t["taille"] == "M" and t["jours_factures"] == 3 and t["tjm"] == 600 and t["montant"] == 1800
    assert t["assigne"] == "Camille Roux"
    ref = _diff_ticket(conn, "BANK-1")
    assert t["debut_reel"] == date_for_day(START, ref["real_start"]).isoformat()
    assert t["fin_reel"] == date_for_day(START, ref["real_end"]).isoformat()
    assert t["jours_reels"] == pytest.approx(ref["actual_days"], abs=0.01)
    separate = get_ticket(conn, 0, "BANK-12")
    assert separate["lot"] is None and separate["facture_separement"] is True


def test_actual_days_grow_with_the_clock(conn):
    values = [get_ticket(conn, d, "BANK-4")["jours_reels"] for d in range(0, last_day(conn), 4)]
    assert values == sorted(values) and values[0] == 0 and values[-1] > 0


def test_list_tickets_filters(conn):
    end = last_day(conn)
    assert [t["cle"] for t in list_tickets(conn, end, lot_key="L1")] == ["BANK-1", "BANK-2", "BANK-3"]
    assert len(list_tickets(conn, 0)) == 12
    assert len(list_tickets(conn, end, status="Terminé")) == 12
    assert list_tickets(conn, end, status="Bloqué") == []
    started = _diff_ticket(conn, "BANK-1")["real_start"]
    assert "BANK-1" in {t["cle"] for t in list_tickets(conn, started, status="En cours")}


def test_history_is_flattened_and_ordered(conn):
    history = ticket_history(conn, last_day(conn), "BANK-1")
    assert history[0]["type"] == "Changement de statut"
    assert history[0]["contenu"] == "À faire → En cours"
    assert history == sorted(history, key=lambda h: h["date"])
    assert all(isinstance(h["contenu"], str) and h["acteur"] for h in history)
    assert {h["type"] for h in history} >= {"Changement de statut", "Temps passé", "Commentaire"}


def test_lot_dict(conn):
    _pay_on(conn, INV1, _invoice(conn, INV1)["due_day"])
    lot = get_lot(conn, last_day(conn), "L1")
    assert lot["nom"] == "Tableau de bord factures" and lot["prix"] == 3000
    assert lot["tickets_total"] == 3 and lot["tickets_termines"] == 3 and lot["jours_factures"] == 5
    assert lot["statut_facture"] == "Payée" and lot["facture"] == INV1
    assert lot["approuve_le"] is not None and lot["livre_le"] is not None
    assert lot["livraison_prevue"] is not None
    early = get_lot(conn, 0, "L1")
    assert early["statut_facture"] == "À venir" and early["facture"] is None
    assert early["livre_le"] is None and early["approuve_le"] is None and early["tickets_termines"] == 0
    assert [entry["cle"] for entry in list_lots(conn, 0)] == ["L1", "L2", "L3"]


def test_lot_delivery_matches_the_expander(conn):
    for lot in diff_plan_vs_real(conn)["lots"]:
        delivered = lot["real_delivery_day"]
        assert get_lot(conn, delivered, lot["key"])["livre_le"] == date_for_day(START, delivered).isoformat()
        if delivered > 0:
            assert get_lot(conn, delivered - 1, lot["key"])["livre_le"] is None


def test_summary_totals(conn, timeline):
    end = summary(conn, last_day(conn))
    assert end["contracte"] == sum(t.fee for t in timeline.tickets)
    assert end["facture"] == sum(i.amount_ttc for i in timeline.invoices)
    assert end["paye"] == 0 == len(timeline.payments)
    assert end["reste_a_payer"] == end["facture"] == end["en_retard"] > 0  # nothing paid: every invoice is overdue
    due = _invoice(conn, INV1)["due_day"]
    _pay_on(conn, INV1, due)
    mid = summary(conn, due + 1)
    assert mid["paye"] == 3600 and mid["reste_a_payer"] == mid["facture"] - mid["paye"] > 0
    assert mid["en_retard"] == 0  # the only invoice due by then was paid on its due day
    assert [lot["cle"] for lot in mid["lots"]] == ["L1", "L2", "L3"]


def test_invoice_dict_and_payments(conn):
    end = last_day(conn)
    inv = get_invoice(conn, end, INV1)
    assert inv["numero"] == INV1 and inv["lot"] == "L1" and inv["couvre"] == ["BANK-1", "BANK-2", "BANK-3"]
    assert (inv["montant_ht"], inv["tva"], inv["montant_ttc"]) == (3000, 600, 3600)
    assert inv["emise_le"] < inv["echeance_le"]
    assert list_payments(conn, end) == []
    _pay_on(conn, INV1, _invoice(conn, INV1)["due_day"])
    _pay_on(conn, INV2, end)
    assert [p["montant"] for p in list_payments(conn, end, INV1)] == [3600]
    assert all(p["facture"] == INV1 for p in list_payments(conn, end, INV1))
    assert len(list_payments(conn, end)) == 2
    separate = next(i for i in list_invoices(conn, end) if i["lot"] is None)
    assert separate["couvre"] == ["BANK-12"]


def test_future_invoice_is_not_found(conn):
    inv = _invoice(conn, INV1)
    with pytest.raises(NotFound):
        get_invoice(conn, inv["issued_day"] - 1, INV1)
    assert INV1 not in {i["numero"] for i in list_invoices(conn, inv["issued_day"] - 1)}


def test_every_query_is_json_serialisable(conn):
    d = 40
    json.dumps([today(conn, d), get_contract(conn), summary(conn, d), list_lots(conn, d), list_tickets(conn, d)])
    json.dumps([list_invoices(conn, d), list_payments(conn, d), pending_approvals(conn, d), explain_price(conn, d, "L2")])
    json.dumps([full_plan(conn), full_timeline(conn), ticket_full(conn, "BANK-4"), diff_plan_vs_real(conn)])


# --- dev side ----------------------------------------------------------------------------


def test_full_plan(conn, plan, contract):
    p = full_plan(conn)
    assert p["scenario"]["seed"] == 42 and p["scenario"]["start_date"] == "2026-03-02"
    assert "client_behaviour" not in p["scenario"]
    assert p["contract"]["tjm"] == contract.tjm
    assert [m["name"] for m in p["team"]] == [m.name for m in plan.team]
    assert [lot["key"] for lot in p["lots"]] == ["L1", "L2", "L3"]
    assert next(lot for lot in p["lots"] if lot["key"] == "L1")["price"] == 3000
    t = next(t for t in p["tickets"] if t["key"] == "BANK-2")
    assert t["depends_on"] == ["BANK-1"] and t["days_charged"] == 1 and t["tjm"] == 600 and t["fee"] == 600
    assert "planned_start" in t and "planned_end" in t and "sprint" in t and t["assignee"]
    assert len(p["tickets"]) == len(plan.tickets) and p["sprints"]


def test_full_plan_carries_steps_and_delivery_summaries(conn, plan):
    p = full_plan(conn)
    assert [lot["delivery_summary"] for lot in p["lots"]] == [lot.delivery_summary for lot in plan.lots]
    assert [t["steps"] for t in p["tickets"]] == [t.steps for t in plan.tickets]
    assert ticket_full(conn, "BANK-5")["steps"] == next(t.steps for t in plan.tickets if t.key == "BANK-5")


def test_store_columns_for_steps_and_summaries(conn):
    def columns(table):
        return {r["name"]: r for r in conn.execute(f"PRAGMA table_info({table})")}

    assert "client_behaviour" not in columns("scenario")
    for table, column in (("lot", "delivery_summary"), ("ticket", "steps")):
        info = columns(table)[column]
        assert info["type"] == "TEXT" and info["notnull"] == 1
    raw = conn.execute("SELECT steps FROM ticket WHERE key = 'BANK-1'").fetchone()[0]
    assert isinstance(json.loads(raw), list)


def test_full_timeline_range(conn, timeline):
    everything = full_timeline(conn)
    assert len(everything["events"]) == len(timeline.events)
    assert len(everything["invoices"]) == 4 and everything["payments"] == [] and len(everything["approvals"]) == 3
    window = full_timeline(conn, from_day=10, to_day=20)
    assert window["events"] and all(10 <= e["day"] <= 20 for e in window["events"])
    assert all(10 <= i["issued_day"] <= 20 for i in window["invoices"])
    assert full_timeline(conn, from_day=20)["events"][0]["day"] >= 20
    assert full_timeline(conn, from_day=50)["events"] == []
    _pay(conn, INV1, 51, 1200)
    _pay(conn, INV1, 56, 2400, n=2)
    _pay(conn, INV2, 61, 100)
    assert [p["day"] for p in full_timeline(conn, from_day=50, to_day=60)["payments"]] == [51, 56]
    assert max(e["day"] for e in full_timeline(conn, to_day=5)["events"]) <= 5


def test_ticket_full(conn, timeline):
    t = ticket_full(conn, "BANK-1")
    assert t["key"] == "BANK-1" and t["real_start"] == _diff_ticket(conn, "BANK-1")["real_start"]
    assert len(t["events"]) == sum(1 for e in timeline.events if e.ticket_key == "BANK-1")
    assert "beats" in t and t["invoice"] == INV1


def test_diff_agrees_with_events(conn):
    """The stored real_start/real_end are the days of the first En cours / Terminé transitions."""
    for t in diff_plan_vs_real(conn)["tickets"]:
        events = ticket_full(conn, t["key"])["events"]
        transitions = [e for e in events if e["type"] == "transition"]
        assert next(e["day"] for e in transitions if e["payload"]["to"] == "En cours") == t["real_start"]
        assert next(e["day"] for e in transitions if e["payload"]["to"] == "Terminé") == t["real_end"]
        hours = sum(e["payload"]["hours"] for e in events if e["type"] == "worklog")
        assert t["actual_days"] == pytest.approx(hours / 8, abs=0.01)


# --- store plumbing ----------------------------------------------------------------------


def test_connect_is_idempotent_and_enforces_foreign_keys(tmp_path):
    path = tmp_path / "x.sqlite"
    connect(path).close()
    c = connect(path)
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert isinstance(c.execute("SELECT 1 AS one").fetchone(), sqlite3.Row)
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO payment (invoice_id, day, amount, reference) VALUES (999, 0, 1, 'x')")
    c.close()


def test_wipe_empties_every_table_and_resets_clock(conn):
    set_day(conn, 30)
    wipe(conn)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    assert "clock" in tables and "ticket_event" in tables
    for table in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        assert count == (1 if table == "clock" else 0), table  # the clock keeps its single row, at 0
    assert get_day(conn) == 0


def test_reload_replaces_the_scenario_and_resets_the_clock(conn, plan, contract):
    set_day(conn, 50)
    other = expand(plan, contract, seed=7, start_date=date(2026, 3, 9))
    load_scenario(
        conn, plan=plan, contract=contract, timeline=other, request_text="autre", seed=7, start_date=date(2026, 3, 9)
    )
    assert get_day(conn) == 0
    assert full_plan(conn)["scenario"]["seed"] == 7
    assert today(conn, 0)["date"] == "2026-03-09"
    assert conn.execute("SELECT COUNT(*) FROM scenario").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM ticket").fetchone()[0] == len(plan.tickets)
    assert conn.execute("SELECT COUNT(*) FROM ticket_event").fetchone()[0] == len(other.events)
