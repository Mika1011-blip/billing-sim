import { useEffect, useId, useRef, useState } from 'react'
import { getTicketHistory } from '../../api'
import { fr } from '../../i18n/fr'
import { fmtCalcul, fmtDate, fmtDays } from '../../lib/format'
import type { ClientHistoryEntry, ClientTicket, HistoryType } from '../../types'
import { REVEAL_EVENT } from './Assistant'
import { Pill } from './Pill'

const ICON: Record<HistoryType, string> = {
  'Changement de statut': '↔',
  'Temps passé': '⏱',
  Blocage: '⛔',
  Déblocage: '✅',
  Commentaire: '💬',
  'Revue demandée': '🔍',
  'Revue validée': '🔍',
  'Retour de revue': '🔍',
}

interface Props {
  ticket: ClientTicket
  /** Clock day the ticket is shown at: the journal is fetched on first expand, and again once the day changes. */
  day: number
  defaultOpen?: boolean
  /** Opens the row when it names this ticket (e.g. a drawer opened from a citation). */
  revealKey?: string | null
}

/** One ticket: a collapsed price line that expands to its description, planned steps and journal. */
export function TicketDetail({ ticket, day, defaultOpen = false, revealKey = null }: Props) {
  const t = fr.ticketDetail
  const [open, setOpen] = useState(defaultOpen || revealKey === ticket.cle)
  const [seenRevealKey, setSeenRevealKey] = useState(revealKey)
  if (revealKey !== seenRevealKey) {
    setSeenRevealKey(revealKey)
    if (revealKey === ticket.cle) setOpen(true)
  }

  // A citation in the assistant panel asks to reveal a record: open when it is this ticket.
  useEffect(() => {
    const onReveal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === ticket.cle) setOpen(true)
    }
    window.addEventListener(REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(REVEAL_EVENT, onReveal)
  }, [ticket.cle])

  // The journal as of `day`, fetched once per (key, day) while this row is mounted.
  const at = `${ticket.cle}@${day}`
  const [journal, setJournal] = useState<{ at: string; rows: ClientHistoryEntry[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const requested = useRef<string | null>(null)
  useEffect(() => {
    if (!open || requested.current === at) return
    requested.current = at
    getTicketHistory(ticket.cle).then(
      (rows) => {
        if (requested.current !== at) return
        setFailed(false)
        setJournal({ at, rows })
      },
      () => {
        if (requested.current !== at) return
        requested.current = null // the next expand tries again
        setFailed(true)
      },
    )
  }, [open, at, ticket.cle])
  const rows = journal?.at === at ? journal.rows : null

  // A planned step is done once a worklog note mentions it (the closing comment lists every step: not proof).
  const notes = (rows ?? []).filter((r) => r.type === 'Temps passé').map((r) => r.contenu)
  const isDone = (step: string) => notes.some((note) => note.includes(step))

  const stepsId = useId()
  const journalId = useId()

  let period: string = t.nonCommence
  if (ticket.debut_reel && ticket.fin_reel) {
    period = `${t.du} ${fmtDate(ticket.debut_reel)} ${t.au} ${fmtDate(ticket.fin_reel)}`
  } else if (ticket.debut_reel) {
    period = `${t.depuis} ${fmtDate(ticket.debut_reel)}`
  }

  return (
    <div className="ticket-detail" id={`rec-${ticket.cle}`}>
      <button type="button" className="ticket-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ticket-row-title">
          <strong>{ticket.cle}</strong> · {ticket.titre} · {fmtCalcul(ticket)}
        </span>
        <Pill statut={ticket.statut} />
        <span className="ticket-row-meta">
          {fmtDays(ticket.jours_reels)} {t.reels}
        </span>
        <span className="ticket-row-meta">
          {t.evenements(ticket.journal_nombre)} {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="ticket-body">
          <p>{ticket.description}</p>
          <p className="meta">
            {t.assigneA} {ticket.assigne} · {period}
          </p>

          <h4 id={stepsId}>{t.etapes}</h4>
          <ol className="steps" aria-labelledby={stepsId}>
            {ticket.etapes.map((step) => {
              const done = isDone(step)
              return (
                <li key={step} className={done ? 'done' : undefined}>
                  {step}
                  {done && (
                    <span className="tick" role="img" aria-label={t.etapeFaite}>
                      {' '}✓
                    </span>
                  )}
                </li>
              )
            })}
          </ol>

          <h4 id={journalId}>{t.journal}</h4>
          {rows === null ? (
            <p className={failed ? 'error' : 'empty'}>{failed ? t.journalError : t.journalLoading}</p>
          ) : rows.length === 0 ? (
            <p className="empty">{t.journalEmpty}</p>
          ) : (
            <ul className="journal" aria-labelledby={journalId}>
              {rows.map((r, i) => (
                <li key={i}>
                  <span className="journal-date">{fmtDate(r.date)}</span>{' '}
                  <span className="journal-icon" role="img" aria-label={r.type} title={r.type}>
                    {ICON[r.type] ?? '•'}
                  </span>{' '}
                  <span className="journal-actor">{r.acteur}</span> <span>{r.contenu}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
