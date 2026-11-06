import { useEffect, useState } from 'react'
import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientLot, ClientTicket } from '../../types'
import { REVEAL_EVENT } from './Assistant'
import { TicketDetail } from './TicketDetail'

interface Props {
  lots: ClientLot[]
  tickets: ClientTicket[]
  /** Clock day, for the ticket rows' journals. */
  day: number
}

/** The lots not invoiced yet, each expandable to its ticket rows; not rendered once every lot is invoiced. */
export function LotsEnCours({ lots, tickets, day }: Props) {
  const t = fr.lotsEnCours
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string, value: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })

  const inProgress = lots.filter((lot) => lot.facture === null)
  const ticketsOf = (lotKey: string) => tickets.filter((tk) => tk.lot === lotKey)

  // A citation in the assistant panel asks to reveal a record: open the lot that is it or holds it.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const key = (e as CustomEvent<string>).detail
      const lotKey = tickets.find((tk) => tk.cle === key)?.lot ?? key
      if (lots.some((l) => l.cle === lotKey && l.facture === null)) toggle(lotKey, true)
    }
    window.addEventListener(REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(REVEAL_EVENT, onReveal)
  }, [lots, tickets])

  if (inProgress.length === 0) return null

  return (
    <section className="panel lots-en-cours">
      <h2>{t.title}</h2>
      {inProgress.map((lot) => {
        const isOpen = open.has(lot.cle)
        return (
          <article key={lot.cle} className="lot-card" id={`rec-${lot.cle}`}>
            <h3>
              {lot.cle} · {lot.nom}
            </h3>
            <p className="meta">
              {t.livraisonPrevue} {fmtDate(lot.livraison_prevue)} · {lot.tickets_termines}/{lot.tickets_total}{' '}
              {t.ticketsTermines} · {t.aVenir} {fmtEuro(lot.prix)}
            </p>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(lot.cle, !isOpen)}>
              {isOpen ? t.collapse : t.expand}
            </button>
            {/* Always in the DOM (hidden while collapsed) so a citation link to a ticket finds its anchor. */}
            <div className="lot-tickets" hidden={!isOpen}>
              {ticketsOf(lot.cle).map((ticket) => (
                <TicketDetail key={ticket.cle} ticket={ticket} day={day} />
              ))}
            </div>
          </article>
        )
      })}
    </section>
  )
}
