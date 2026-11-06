import { useEffect, useState } from 'react'
import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientLot, ClientTicket } from '../../types'
import { Pill } from './Pill'
import { TicketTable } from './TicketTable'

interface Props {
  lot: ClientLot
  tickets: ClientTicket[]
}

export function LotCard({ lot, tickets }: Props) {
  const [open, setOpen] = useState(false)
  const t = fr.lot

  // A citation in the assistant panel asks to reveal a record: open this card when it holds it.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const key = (e as CustomEvent<string>).detail
      if (key === lot.cle || tickets.some((tk) => tk.cle === key)) setOpen(true)
    }
    window.addEventListener('reveal-record', onReveal)
    return () => window.removeEventListener('reveal-record', onReveal)
  }, [lot.cle, tickets])

  return (
    <article className="lot-card" id={`rec-${lot.cle}`}>
      <header className="row">
        <h3>
          {lot.cle} · {lot.nom}
        </h3>
        <Pill statut={lot.statut_facture} />
        <strong className="num">{fmtEuro(lot.prix)}</strong>
      </header>
      <p>{lot.description}</p>
      <p className="meta">
        {t.plannedDelivery} {fmtDate(lot.livraison_prevue)} ·{' '}
        {lot.livre_le ? `${t.delivered} ${fmtDate(lot.livre_le)}` : t.notDelivered}
        {lot.approuve_le && ` · ${t.approved} ${fmtDate(lot.approuve_le)}`}
        {lot.facture && ` · ${t.invoice} ${lot.facture}`}
      </p>
      <p className="meta">
        {lot.tickets_termines}/{lot.tickets_total} {t.tickets} · {lot.jours_factures} {t.invoicedDays} ·{' '}
        {lot.jours_reels} {t.realDays}
      </p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t.collapse : t.expand}
      </button>
      {/* Always in the DOM (hidden while collapsed) so a citation link to a ticket finds its anchor. */}
      <div hidden={!open}>
        {tickets.length === 0 ? <p className="empty">{t.noTickets}</p> : <TicketTable tickets={tickets} />}
      </div>
    </article>
  )
}
