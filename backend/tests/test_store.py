import json
import sqlite3
from datetime import date

import pytest

from billing_sim.engine.clock import get_day, last_day, set_day
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


def _invoice(conn, number):
    return next(i for i in full_timeline(conn)["invoices"] if i["number"] == number)


def _diff_ticket(conn, key):
    return next(t for t in diff_plan_vs_real(conn)["tickets"] if t["key"] == key)


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


def test_invoice_statuses(conn):
    inv = _invoice(conn, INV1)
    assert get_invoice(conn, inv["issued_day"], INV1)["statut"] == "Émise"
    partial = get_invoice(conn, inv["due_day"], INV1)
    assert partial["paye"] == 1200 and partial["reste"] == 2400
    assert partial["statut"] == "Payée partiellement" and partial["en_retard"] is False
    late = get_invoice(conn, inv["due_day"] + 1, INV1)
    assert late["statut"] == "En retard" and late["en_retard"] is True
    assert get_invoice(conn, inv["due_day"] + 15, INV1)["statut"] == "Payée"

    inv2 = _invoice(conn, INV2)
    assert get_invoice(conn, inv2["due_day"] + 11, INV2)["statut"] == "En retard"
    paid = get_invoice(conn, inv2["due_day"] + 12, INV2)
    assert paid["statut"] == "Payée" and paid["reste"] == 0 and paid["en_retard"] is False


def test_overdue_amount_in_summary(conn):
    inv = _invoice(conn, INV1)
    assert summary(conn, inv["due_day"] + 1)["en_retard"] == 2400
    assert summary(conn, inv["due_day"])["en_retard"] == 0


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
    assert end["paye"] == sum(p.amount for p in timeline.payments) == end["facture"]
    assert end["reste_a_payer"] == 0 and end["en_retard"] == 0
    mid = summary(conn, _invoice(conn, INV1)["due_day"] + 1)
    assert mid["reste_a_payer"] == mid["facture"] - mid["paye"] > 0
    assert [lot["cle"] for lot in mid["lots"]] == ["L1", "L2", "L3"]


def test_invoice_dict_and_payments(conn):
    end = last_day(conn)
    inv = get_invoice(conn, end, INV1)
    assert inv["numero"] == INV1 and inv["lot"] == "L1" and inv["couvre"] == ["BANK-1", "BANK-2", "BANK-3"]
    assert (inv["montant_ht"], inv["tva"], inv["montant_ttc"]) == (3000, 600, 3600)
    assert inv["emise_le"] < inv["echeance"]
    assert [p["montant"] for p in list_payments(conn, end, INV1)] == [1200, 2400]
    assert all(p["facture"] == INV1 for p in list_payments(conn, end, INV1))
    assert len(list_payments(conn, end)) == 6
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
    assert p["contract"]["tjm"] == contract.tjm
    assert [m["name"] for m in p["team"]] == [m.name for m in plan.team]
    assert [lot["key"] for lot in p["lots"]] == ["L1", "L2", "L3"]
    assert next(lot for lot in p["lots"] if lot["key"] == "L1")["price"] == 3000
    t = next(t for t in p["tickets"] if t["key"] == "BANK-2")
    assert t["depends_on"] == ["BANK-1"] and t["days_charged"] == 1 and t["tjm"] == 600 and t["fee"] == 600
    assert "planned_start" in t and "planned_end" in t and "sprint" in t and t["assignee"]
    assert len(p["tickets"]) == len(plan.tickets) and p["sprints"]


def test_full_timeline_range(conn, timeline):
    everything = full_timeline(conn)
    assert len(everything["events"]) == len(timeline.events)
    assert len(everything["invoices"]) == 4 and len(everything["payments"]) == 6 and len(everything["approvals"]) == 3
    window = full_timeline(conn, from_day=10, to_day=20)
    assert window["events"] and all(10 <= e["day"] <= 20 for e in window["events"])
    assert all(10 <= i["issued_day"] <= 20 for i in window["invoices"])
    assert full_timeline(conn, from_day=20)["events"][0]["day"] >= 20
    assert full_timeline(conn, from_day=50)["events"] == []
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
