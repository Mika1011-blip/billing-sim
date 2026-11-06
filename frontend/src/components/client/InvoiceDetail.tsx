import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { fr } from '../../i18n/fr'
import { fmtCalcul, fmtDate, fmtEuro, fmtNumber } from '../../lib/format'
import type { ClientInvoice } from '../../types'
import { statusText } from './InvoiceCard'
import { Pill } from './Pill'
import { TicketDetail } from './TicketDetail'

interface Props {
  invoice: ClientInvoice
  /** Clock day, for the ticket rows' journals. */
  day: number
  onClose: () => void
  /** Records the payment; rejects with the French message to show under the button. */
  onPay: (numero: string) => Promise<void>
  /** A ticket row to open from the start (the drawer was opened from a citation of that ticket). */
  revealKey?: string | null
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** `F-2026-002 · Lot L2 — Suivi des paiements`, or the ticket of a separately charged invoice. */
function title(invoice: ClientInvoice): string {
  const t = fr.invoiceDetail
  if (invoice.lot) return `${invoice.numero} · ${t.lot} ${invoice.lot} — ${invoice.lot_nom}`
  const ticket = invoice.tickets.find((tk) => tk.cle === invoice.ticket)
  return `${invoice.numero} · ${invoice.ticket} — ${ticket?.titre ?? ''} · ${fr.invoiceCard.separately}`
}

/** One invoice in a modal drawer: what was delivered, how the price is computed, and its payment (spec §9). */
export function InvoiceDetail({ invoice, day, onClose, onPay, revealKey = null }: Props) {
  const t = fr.invoiceDetail
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const { calcul } = invoice

  // The page behind does not scroll while the drawer is open; the focus starts on the close button.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Tab cycles through the drawer's own controls: it is modal. */
  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !panel.current) return
    const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  async function pay() {
    setPaying(true)
    setError('')
    try {
      await onPay(invoice.numero)
    } catch (err) {
      setError(err instanceof Error ? err.message : fr.invoiceCard.payError)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
      >
        <header className="drawer-header">
          <h2 id={titleId}>{title(invoice)}</h2>
          <button ref={closeButton} type="button" className="drawer-close" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="drawer-status">
          <Pill statut={invoice.statut}>{statusText(invoice)}</Pill> · {t.echeanceLe} {fmtDate(invoice.echeance_le)}
        </p>

        <section className="drawer-section">
          <h3>{t.resume}</h3>
          <p>{invoice.resume_livraison}</p>
        </section>

        <section className="drawer-section">
          <h3>{t.delivered}</h3>
          <div className="drawer-tickets">
            {invoice.tickets.map((ticket) => (
              <TicketDetail key={ticket.cle} ticket={ticket} day={day} revealKey={revealKey} />
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <h3>{t.calcul}</h3>
          <ul className="calc-lines">
            {invoice.tickets.map((ticket) => (
              <li key={ticket.cle}>
                <strong>{ticket.cle}</strong> {fmtCalcul(ticket)} {t.ht}
              </li>
            ))}
          </ul>
          <p className="calc-totals">
            <span>
              {t.totalHt} <strong>{fmtEuro(calcul.total_ht)}</strong>
            </span>{' '}
            ·{' '}
            <span>
              {t.tva} {fmtNumber(calcul.taux_tva * 100)}&nbsp;% <strong>{fmtEuro(calcul.tva)}</strong>
            </span>{' '}
            ·{' '}
            <span className="calc-ttc">
              {t.totalTtc} <strong>{fmtEuro(calcul.total_ttc)}</strong>
            </span>
          </p>
          <p className="calc-days">
            {t.joursFactures} {fmtNumber(calcul.jours_factures)} · {t.joursReels} {fmtNumber(calcul.jours_reels)}
          </p>
          <p className="calc-note">
            {calcul.ecart_jours > 0 ? t.ecartAbsorbe(fmtNumber(calcul.ecart_jours)) : t.moinsDeJours}
          </p>
        </section>

        <section className="drawer-section">
          <h3>{t.paiement}</h3>
          {invoice.paiement ? (
            <p>{t.payeeLe(fmtDate(invoice.paiement.date), invoice.paiement.reference)}</p>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={paying} onClick={() => void pay()}>
                {fr.invoiceCard.markPaid}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      </aside>
    </div>
  )
}
