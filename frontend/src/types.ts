// Mirrors the backend JSON shapes (see /setup, /sim and /dev routes). The dev shapes are the exact keys of
// `store/dev_queries.py`; `src/test-fixtures/dev-snapshot.json` is generated from the backend and the dev page
// tests render from it, so a drift between the two fails there.

export interface Clock {
  day: number
  last_day: number
  date: string // YYYY-MM-DD
}

export interface GenerateBody {
  request_text: string
  seed?: number
  fallback?: boolean
}

export type GenerateResult =
  | { kind: 'plan'; plan: unknown; seed: number; warnings: string[] }
  | { kind: 'rejected'; reason: string } // 422
  | { kind: 'error'; status: number; detail: string; raw?: string } // 400 / 502 / other

export interface TeamMember {
  name: string
  profile: string
}

export interface Sprint {
  number: number
  start_day: number
  end_day: number
}

export interface Lot {
  key: string
  name: string
  description: string
  price: number
  planned_delivery_day: number
}

export interface PlanTicket {
  key: string
  title: string
  description: string
  lot: string | null
  charged_separately: boolean
  size: string
  profile: string
  days_charged: number
  tjm: number
  fee: number
  assignee: string
  sprint: number
  planned_start: number
  planned_end: number
  depends_on: string[]
  beats: unknown[]
}

export interface Plan {
  scenario: {
    request_text: string
    product_summary: string
    seed: number
    start_date: string
    signed_day: number
    last_day: number
    warnings: string[]
  }
  contract: Record<string, unknown>
  team: TeamMember[]
  sprints: Sprint[]
  lots: Lot[]
  tickets: PlanTicket[]
}

export type EventType =
  | 'transition'
  | 'worklog'
  | 'comment'
  | 'blocked'
  | 'unblocked'
  | 'review_requested'
  | 'review_changes'
  | 'review_approved'

export interface TimelineEvent {
  ticket: string
  day: number
  date: string
  seq: number
  type: EventType
  actor: string
  payload: Record<string, unknown>
}

export interface Invoice {
  number: string
  lot: string | null
  ticket: string | null
  issued_day: number
  due_day: number
  amount_ht: number
  vat: number
  amount_ttc: number
  covers: string[]
}

export interface Payment {
  invoice: string
  day: number
  amount: number
  reference: string
}

export interface Approval {
  lot: string
  day: number
  approved_by: string
}

export interface Timeline {
  events: TimelineEvent[]
  invoices: Invoice[]
  payments: Payment[]
  approvals: Approval[]
}

export interface DiffTicketRow {
  key: string
  lot: string | null // null: not priced with a lot
  assignee: string
  planned_start: number | null
  planned_end: number | null
  real_start: number | null
  real_end: number | null
  slip_days: number | null
  days_charged: number
  actual_days: number | null
}

export interface DiffLotRow {
  key: string
  name: string
  planned_delivery_day: number | null
  real_delivery_day: number | null
  slip_days: number | null
  days_charged: number
  actual_days: number | null
}

export interface Diff {
  tickets: DiffTicketRow[]
  lots: DiffLotRow[]
}

export interface AgentTool {
  name: string
  description: string
  input_schema: unknown
}

// ---- /client/* (French-keyed dicts from the backend store) ----

export interface ClientToday {
  jour: number
  date: string // YYYY-MM-DD
  date_longue: string // "lundi 2 mars 2026"
}

export type InvoiceStatus = 'À payer' | 'En retard' | 'Très en retard' | 'Payée'
export type LotInvoiceStatus = 'À venir' | InvoiceStatus
export type TicketStatus = 'À faire' | 'En cours' | 'Bloqué' | 'En revue' | 'Terminé'

export interface ClientLot {
  cle: string
  nom: string
  description: string
  prix: number
  livraison_prevue: string
  livre_le: string | null
  tickets_termines: number
  tickets_total: number
  jours_factures: number
  jours_reels: number
  approuve_le: string | null
  statut_facture: LotInvoiceStatus
  facture: string | null
  resume_livraison: string
}

/** `GET /client/tickets` and `/client/tickets/{key}` rows; an invoice's `tickets` are the same records. */
export interface ClientTicket {
  cle: string
  titre: string
  description: string
  lot: string | null
  facture_separement: boolean
  taille: 'S' | 'M' | 'L' | 'XL'
  jours_factures: number
  tjm: number
  montant: number
  statut: TicketStatus
  assigne: string
  debut_reel: string | null
  fin_reel: string | null
  jours_reels: number
  etapes: string[]
  journal_nombre: number // events as of today
}

export type HistoryType =
  | 'Changement de statut'
  | 'Temps passé'
  | 'Blocage'
  | 'Déblocage'
  | 'Commentaire'
  | 'Revue demandée'
  | 'Revue validée'
  | 'Retour de revue'

/** One row of `GET /client/tickets/{key}/history`, oldest first. */
export interface ClientHistoryEntry {
  date: string
  type: HistoryType
  acteur: string
  contenu: string
}

export interface ClientPaiement {
  date: string
  reference: string
  montant: number // TTC, always in full
}

export interface InvoiceCalcul {
  total_ht: number
  tva: number
  taux_tva: number // 0.2
  total_ttc: number
  jours_factures: number
  jours_reels: number
  ecart_jours: number // jours_reels − jours_factures
}

export interface ClientInvoice {
  numero: string
  lot: string | null
  lot_nom: string | null
  ticket: string | null // the ticket key of a separately charged ticket
  couvre: string[]
  emise_le: string
  echeance_le: string
  montant_ht: number
  tva: number
  montant_ttc: number
  statut: InvoiceStatus
  jours_de_retard: number // calendar days, 0 unless overdue
  jours_restants: number // calendar days, 0 unless À payer
  paiement: ClientPaiement | null
  resume_livraison: string
  tickets: ClientTicket[]
  calcul: InvoiceCalcul
}

/** `GET /client/payments` rows, and the answer of `POST /client/invoices/{number}/payer`. */
export interface ClientPayment {
  date: string
  montant: number
  reference: string
  facture: string
}

export interface ProchaineFacture {
  lot: string
  nom: string
  date_prevue: string // plan data: the promised delivery date
  montant_ht: number
}

export interface ClientSummary {
  contracte: number // HT
  contracte_ttc: number // TTC
  facture: number // TTC
  paye: number // TTC
  reste_a_payer: number // TTC
  en_retard: number // TTC, En retard + Très en retard
  en_retard_nombre: number
  a_payer: number // TTC of the À payer invoices
  prochaine_facture: ProchaineFacture | null
  lots: ClientLot[]
}
