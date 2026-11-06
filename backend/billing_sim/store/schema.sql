-- billing-sim store. Applied on every connect, so every statement is idempotent.
-- Static layer: written once by load_scenario. Timeline layer: every row carries a `day`;
-- "state as of day D" is always `WHERE day <= D`. Nothing is updated during a run except `clock`.

CREATE TABLE IF NOT EXISTS scenario (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    request_text     TEXT NOT NULL,
    product_summary  TEXT NOT NULL,
    seed             INTEGER NOT NULL,
    start_date       TEXT NOT NULL,                 -- ISO date of day 0 (a Monday)
    signed_day       INTEGER NOT NULL DEFAULT 0,
    last_day         INTEGER NOT NULL,
    warnings         TEXT NOT NULL DEFAULT '[]'     -- JSON list of strings
);

CREATE TABLE IF NOT EXISTS contract (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    data                TEXT NOT NULL,              -- JSON snapshot of Contract.to_dict()
    hours_per_day       INTEGER NOT NULL,
    payment_terms_days  INTEGER NOT NULL,
    vat_rate            REAL NOT NULL,
    overrun_rule        TEXT NOT NULL,
    currency            TEXT NOT NULL,
    invoice_timing      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_member (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    profile  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprint (
    id         INTEGER PRIMARY KEY,
    number     INTEGER NOT NULL UNIQUE,
    start_day  INTEGER NOT NULL,
    end_day    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lot (
    id                    INTEGER PRIMARY KEY,
    key                   TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    description           TEXT NOT NULL,
    delivery_summary      TEXT NOT NULL,            -- client-language summary of what the lot delivers
    price                 INTEGER NOT NULL,         -- sum of the fees of the tickets charged with the lot
    planned_delivery_day  INTEGER                   -- NULL when no ticket is charged with the lot
);

CREATE TABLE IF NOT EXISTS ticket (
    id                 INTEGER PRIMARY KEY,
    key                TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    description        TEXT NOT NULL,
    steps              TEXT NOT NULL,               -- JSON list of the ordered work steps from the plan
    lot_id             INTEGER REFERENCES lot(id),
    charged_separately INTEGER NOT NULL,
    size               TEXT NOT NULL,
    profile            TEXT NOT NULL,
    days_charged       INTEGER NOT NULL,
    fee                INTEGER NOT NULL,
    assignee_id        INTEGER NOT NULL REFERENCES team_member(id),
    sprint_id          INTEGER NOT NULL REFERENCES sprint(id),
    planned_start_day  INTEGER NOT NULL,
    planned_end_day    INTEGER NOT NULL,
    real_start_day     INTEGER NOT NULL,            -- first En cours / Terminé transition days, kept for the dev diff
    real_end_day       INTEGER NOT NULL,
    beats              TEXT NOT NULL DEFAULT '[]',  -- JSON story beats from the plan
    position           INTEGER NOT NULL             -- order in the plan
);

CREATE TABLE IF NOT EXISTS ticket_dependency (
    ticket_id      INTEGER NOT NULL REFERENCES ticket(id),
    depends_on_id  INTEGER NOT NULL REFERENCES ticket(id),
    PRIMARY KEY (ticket_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS ticket_event (
    id         INTEGER PRIMARY KEY,
    ticket_id  INTEGER NOT NULL REFERENCES ticket(id),
    day        INTEGER NOT NULL,
    seq        INTEGER NOT NULL,                    -- order within a day
    type       TEXT NOT NULL,
    actor_id   INTEGER NOT NULL REFERENCES team_member(id),
    payload    TEXT NOT NULL                        -- JSON
);
CREATE INDEX IF NOT EXISTS ix_ticket_event_day ON ticket_event(day, seq);
CREATE INDEX IF NOT EXISTS ix_ticket_event_ticket ON ticket_event(ticket_id, day, seq);

CREATE TABLE IF NOT EXISTS invoice (
    id          INTEGER PRIMARY KEY,
    number      TEXT NOT NULL UNIQUE,
    lot_id      INTEGER REFERENCES lot(id),
    ticket_id   INTEGER REFERENCES ticket(id),      -- set for tickets invoiced on their own
    issued_day  INTEGER NOT NULL,
    due_day     INTEGER NOT NULL,
    amount_ht   INTEGER NOT NULL,
    vat         INTEGER NOT NULL,
    amount_ttc  INTEGER NOT NULL,
    covers      TEXT NOT NULL                       -- JSON list of ticket keys
);

CREATE TABLE IF NOT EXISTS payment (
    id          INTEGER PRIMARY KEY,
    invoice_id  INTEGER NOT NULL REFERENCES invoice(id),
    day         INTEGER NOT NULL,
    amount      INTEGER NOT NULL,
    reference   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payment_day ON payment(day);

CREATE TABLE IF NOT EXISTS approval (
    id           INTEGER PRIMARY KEY,
    lot_id       INTEGER NOT NULL REFERENCES lot(id),
    day          INTEGER NOT NULL,
    approved_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clock (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    current_day  INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO clock (id, current_day) VALUES (1, 0);
