import { useState, type MouseEvent } from 'react'
import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientInvoice } from '../../types'
import { Pill } from './Pill'

interface Props {
  invoice: ClientInvoice
  /** Records the payment; rejects with the French message to show under the button. */
  onPay: (numero: string) => Promise<void>
  onOpen: (numero: string) => void
}

/** The status pill text: the tier with its calendar-day count, or the payment date. */
function statusText(invoice: ClientInvoice): string {
  const t = fr.invoiceStatus
  switch (invoice.statut) {
    case 'Très en retard':
      return `${t.tresEnRetard} ${t.joursDeRetard(invoice.jours_de_retard)}`
    case 'En retard':
      return `${t.enRetard} ${t.joursDeRetard(invoice.jours_de_retard)}`
    case 'À payer':
      return `${t.aPayer} ${t.joursRestants(invoice.jours_restants)}`
    case 'Payée':
      return `${t.payeeLe} ${fmtDate(invoice.paiement?.date)}`
  }
}

/** What the invoice is for: its lot's name, or the separately charged ticket's title. */
function subject(invoice: ClientInvoice): string {
  if (invoice.lot_nom) return invoice.lot_nom
  const ticket = invoice.tickets.find((tk) => tk.cle === invoice.ticket)
  return `${ticket?.titre ?? invoice.ticket} · ${fr.invoiceCard.separately}`
}

/** One invoice of the dashboard; a click anywhere on the card opens its detail. */
export function InvoiceCard({ invoice, onPay, onOpen }: Props) {
  const t = fr.invoiceCard
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')

  async function pay(e: MouseEvent) {
    e.stopPropagation() // paying is not opening the detail
    setPaying(true)
    setError('')
    try {
      await onPay(invoice.numero)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.payError)
    } finally {
      setPaying(false)
    }
  }

  return (
    <article className="invoice-card" id={`rec-${invoice.numero}`} onClick={() => onOpen(invoice.numero)}>
      {/* The keyboard way in: the click bubbles to the card. */}
      <button type="button" className="invoice-card-title">
        <strong>{invoice.numero}</strong> · {subject(invoice)}
      </button>
      <div className="invoice-card-amount">
        {fmtEuro(invoice.montant_ttc)} <small>{t.ttc}</small>
      </div>
      <p className="meta">
        {t.emiseLe} {fmtDate(invoice.emise_le)} · {t.echeanceLe} {fmtDate(invoice.echeance_le)}
      </p>
      <div className="invoice-card-footer">
        <Pill statut={invoice.statut}>{statusText(invoice)}</Pill>
        {!invoice.paiement && (
          <button type="button" className="btn-primary" disabled={paying} onClick={(e) => void pay(e)}>
            {t.markPaid}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
