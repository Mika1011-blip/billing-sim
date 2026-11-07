import { useEffect, useId, useRef, useState } from 'react'
import { getTicketHistory } from '../../api'
import { fr } from '../../i18n/fr'
import { fmtDate } from '../../lib/format'
import type { ClientHistoryEntry, ClientLot, ClientTicket, ClientToday } from '../../types'
import { Avancement } from './Avancement'
import { TicketDetail } from './TicketDetail'

interface Props {
  tickets: ClientTicket[]
  lots: ClientLot[]
  today: ClientToday
}

/** The client's *Chronologie* view: the planned vs real chart, then the done tickets and the ones left to do. */
export function ChronologieView({ tickets, lots, today }: Props) {
  const c = fr.chronologie
  const day = today.jour

  // The blocks come from each started ticket's history: one request per ticket, cached per (key, day) while mounted.
  const started = tickets.filter((t) => t.debut_reel !== null && t.debut_reel <= today.date)
  const startedKeys = started.map((t) => t.cle).join(' ')
  const [fetched, setFetched] = useState<Record<string, ClientHistoryEntry[]>>({}) // `${cle}@${day}` -> rows
  const [failed, setFailed] = useState<string[]>([]) // `${cle}@${day}` whose request failed
  const requested = useRef(new Set<string>())
  useEffect(() => {
    for (const cle of startedKeys.split(' ').filter(Boolean)) {
      const at = `${cle}@${day}`
      if (requested.current.has(at)) continue
      requested.current.add(at)
      getTicketHistory(cle).then(
        (rows) => setFetched((prev) => ({ ...prev, [at]: rows })),
        () => {
          requested.current.delete(at) // tried again on the next day or ticket change
          setFailed((prev) => [...prev, at])
        },
      )
    }
  }, [startedKeys, day])
  const history: Record<string, ClientHistoryEntry[]> = {}
  for (const t of started) {
    const rows = fetched[`${t.cle}@${day}`]
    if (rows) history[t.cle] = rows
  }
  const historyFailed = started.some((t) => failed.includes(`${t.cle}@${day}`) && !history[t.cle])

  // One detail open at a time below the chart; clicking its row again closes it.
  const [selected, setSelected] = useState<string | null>(null)
  const selectedTicket = tickets.find((t) => t.cle === selected)

  const done = tickets
    .filter((t) => t.statut === 'Terminé')
    .sort((a, b) => (b.fin_reel ?? '').localeCompare(a.fin_reel ?? ''))
  const rest = tickets
    .filter((t) => t.statut !== 'Terminé')
    .sort((a, b) => (a.debut_prevu ?? '￿').localeCompare(b.debut_prevu ?? '￿'))

  const chartId = useId()
  const doneId = useId()
  const restId = useId()

  return (
    <>
      <section className="panel chronologie" aria-labelledby={chartId}>
        <h2 id={chartId}>{c.avancement}</h2>
        <p className="meta">{c.hint}</p>
        <Avancement
          tickets={tickets}
          lots={lots}
          today={today}
          history={history}
          selected={selectedTicket ? selected : null}
          onSelect={(key) => setSelected((prev) => (prev === key ? null : key))}
        />
        {historyFailed && <p className="error">{c.historyError}</p>}
        {selectedTicket && (
          <section className="avancement-detail" aria-label={c.detail}>
            {/* The same ticket is also listed below, which holds its `rec-` anchor for citations. */}
            <TicketDetail key={selectedTicket.cle} ticket={selectedTicket} day={day} defaultOpen anchor={false} />
          </section>
        )}
      </section>

      <section className="panel" aria-labelledby={doneId}>
        <h2 id={doneId}>{c.termine(done.length)}</h2>
        {done.length === 0 ? (
          <p className="empty">{c.aucunTermine}</p>
        ) : (
          done.map((t) => <TicketDetail key={t.cle} ticket={t} day={day} />)
        )}
      </section>

      <section className="panel" aria-labelledby={restId}>
        <h2 id={restId}>{c.resteAFaire(rest.length)}</h2>
        {rest.length === 0 ? (
          <p className="empty">{c.toutTermine}</p>
        ) : (
          rest.map((t) => (
            <TicketDetail
              key={t.cle}
              ticket={t}
              day={day}
              note={t.debut_reel === null && t.debut_prevu ? c.debutPrevuLe(fmtDate(t.debut_prevu)) : undefined}
            />
          ))
        )}
      </section>
    </>
  )
}
