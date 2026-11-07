import { useId, type KeyboardEvent } from 'react'
import { fr } from '../../i18n/fr'
import { fmtDate } from '../../lib/format'
import { dateForDay, dayForDate } from '../../lib/workdays'
import type { ClientHistoryEntry, ClientLot, ClientTicket, ClientToday } from '../../types'

export const DAY_PX = 12
const PAD = 150 // left margin holds the ticket keys
const ROW_H = 24
const LOT_H = 22
const HEAD_H = 34 // sprint labels, then the date ticks
const BAR_H = 7
const SPRINT_DAYS = 10
const TICK_EVERY = 5

/** Left edge of a working day's column. */
export const dayX = (day: number) => PAD + day * DAY_PX
const spanWidth = (from: number, to: number) => (to - from + 1) * DAY_PX // both days included

interface Span {
  from: number
  to: number
}

/** Working-day index of an ISO date, counted from today's date and day (not clamped to the run's end). */
const dayOf = (today: ClientToday, iso: string) => dayForDate(today, iso, Number.POSITIVE_INFINITY)

/** The real span as of today: from the start to the end, or to today while in progress; never past today. */
function realSpan(t: ClientTicket, today: ClientToday): Span | null {
  if (t.debut_reel === null) return null
  const from = dayOf(today, t.debut_reel)
  if (from > today.jour) return null
  const end = t.fin_reel === null ? today.jour : dayOf(today, t.fin_reel)
  return { from, to: Math.min(end, today.jour) }
}

/** Days in Bloqué from the history: a *Blocage* through the next *Déblocage* (or today), clipped at today. */
function blockedSpans(rows: ClientHistoryEntry[], today: ClientToday): Span[] {
  const spans: Span[] = []
  let from: number | null = null
  for (const r of rows) {
    if (r.type === 'Blocage' && from === null) from = dayOf(today, r.date)
    else if (r.type === 'Déblocage' && from !== null) {
      spans.push({ from, to: dayOf(today, r.date) })
      from = null
    }
  }
  if (from !== null) spans.push({ from, to: today.jour })
  return spans.filter((s) => s.from <= today.jour).map((s) => ({ from: s.from, to: Math.min(s.to, today.jour) }))
}

interface Group {
  key: string
  name: string
  tickets: ClientTicket[]
}

/** The lots in their order, then the tickets with no (known) lot under *Sans lot*; empty groups are skipped. */
function groups(tickets: ClientTicket[], lots: ClientLot[]): Group[] {
  const known = new Set(lots.map((l) => l.cle))
  return [
    ...lots.map((l) => ({ key: l.cle, name: `${l.cle} · ${l.nom}`, tickets: tickets.filter((t) => t.lot === l.cle) })),
    { key: '', name: fr.chronologie.noLot, tickets: tickets.filter((t) => t.lot === null || !known.has(t.lot)) },
  ].filter((g) => g.tickets.length > 0)
}

interface Props {
  tickets: ClientTicket[]
  lots: ClientLot[]
  today: ClientToday
  /** Ticket key -> its history as of today (the blocks come from it); a missing key draws no block. */
  history: Record<string, ClientHistoryEntry[]>
  /** The row whose detail is open. */
  selected?: string | null
  onSelect: (key: string) => void
}

/** French Gantt of the tickets: planned span, real span and blocks as of today, by working day. */
export function Avancement({ tickets, lots, today, history, selected = null, onSelect }: Props) {
  const c = fr.chronologie
  const hatchId = `hatch-${useId().replace(/[^\w-]/g, '')}`
  const date = (day: number) => fmtDate(dateForDay(today, day))

  // The plan is shown in full (it was shown at signature); the real work stops at today.
  const planned = (t: ClientTicket): Span | null =>
    t.debut_prevu && t.fin_prevu ? { from: dayOf(today, t.debut_prevu), to: dayOf(today, t.fin_prevu) } : null
  const days = Math.max(today.jour, ...tickets.map((t) => planned(t)?.to ?? 0)) + 1
  const width = dayX(days) + 16

  let y = HEAD_H
  const layout = groups(tickets, lots).map((g) => {
    const labelY = y
    y += LOT_H
    const rows = g.tickets.map((t) => {
      const rowY = y
      y += ROW_H
      return { t, y: rowY }
    })
    return { ...g, labelY, rows }
  })
  const height = y + 8
  const todayX = dayX(today.jour + 1) // the end of today: real work never crosses it

  const sprints: Span[] = []
  for (let from = 0; from < days; from += SPRINT_DAYS) sprints.push({ from, to: Math.min(from + SPRINT_DAYS, days) - 1 })
  const ticks: number[] = []
  for (let d = 0; d < days; d += TICK_EVERY) ticks.push(d)

  const onKeyDown = (key: string) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onSelect(key)
  }

  return (
    <>
      <div className="avancement-scroll">
        <svg className="avancement" width={width} height={height} role="group" aria-label={c.chartLabel}>
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect className="hatch-bg" width="6" height="6" />
              <line className="hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>

          {sprints.map((s, i) => (
            <g key={s.from} aria-hidden="true">
              <rect
                className={`sprint-band ${i % 2 ? 'even' : 'odd'}`}
                x={dayX(s.from)}
                y={0}
                width={spanWidth(s.from, s.to)}
                height={height}
              />
              <text className="sprint-label" x={dayX(s.from) + 3} y={12}>
                {c.sprint(i + 1)}
              </text>
            </g>
          ))}

          {ticks.map((d) => (
            <g key={d} aria-hidden="true">
              <line className="date-tick-mark" x1={dayX(d)} x2={dayX(d)} y1={HEAD_H - 4} y2={height} />
              <text className="date-tick" x={dayX(d) + 2} y={28}>
                {date(d).slice(0, 5)}
              </text>
            </g>
          ))}

          {layout.map((g) => (
            <g key={g.key || 'sans-lot'}>
              <text className="lot-label" x={4} y={g.labelY + 15}>
                {g.name}
              </text>
              {g.rows.map(({ t, y: rowY }) => {
                const plan = planned(t)
                const real = realSpan(t, today)
                const blocks = real ? blockedSpans(history[t.cle] ?? [], today) : []
                return (
                  <g
                    key={t.cle}
                    className={`chrono-row${selected === t.cle ? ' selected' : ''}`}
                    data-key={t.cle}
                    role="button"
                    tabIndex={0}
                    aria-label={`${t.cle} · ${t.titre}`}
                    aria-expanded={selected === t.cle}
                    onClick={() => onSelect(t.cle)}
                    onKeyDown={onKeyDown(t.cle)}
                  >
                    <rect className="row-hit" x={0} y={rowY} width={width} height={ROW_H} />
                    <text className="ticket-label" x={14} y={rowY + 16}>
                      {t.cle}
                    </text>
                    {plan && (
                      <rect
                        className="planned"
                        x={dayX(plan.from)}
                        y={rowY + 4}
                        width={spanWidth(plan.from, plan.to)}
                        height={BAR_H}
                      >
                        <title>{c.plannedSpan(date(plan.from), date(plan.to))}</title>
                      </rect>
                    )}
                    {real && (
                      <rect
                        className="real"
                        x={dayX(real.from)}
                        y={rowY + 13}
                        width={spanWidth(real.from, real.to)}
                        height={BAR_H}
                      >
                        <title>{c.realSpan(date(real.from), date(real.to))}</title>
                      </rect>
                    )}
                    {blocks.map((b) => (
                      <rect
                        key={b.from}
                        className="blocked"
                        x={dayX(b.from)}
                        y={rowY + 12}
                        width={spanWidth(b.from, b.to)}
                        height={BAR_H + 2}
                        fill={`url(#${hatchId})`}
                      >
                        <title>{c.blockedSpan(date(b.from), date(b.to))}</title>
                      </rect>
                    ))}
                  </g>
                )
              })}
            </g>
          ))}

          <line className="today" x1={todayX} x2={todayX} y1={0} y2={height}>
            <title>{c.todayLine(fmtDate(today.date))}</title>
          </line>
        </svg>
      </div>
      <ul className="legend" aria-label={c.legend}>
        <li className="legend-chip">
          <span className="swatch planned" aria-hidden="true" /> {c.planned}
        </li>
        <li className="legend-chip">
          <span className="swatch real" aria-hidden="true" /> {c.real}
        </li>
        <li className="legend-chip">
          <span className="swatch blocked" aria-hidden="true" /> {c.blocked}
        </li>
        <li className="legend-chip">
          <span className="swatch today" aria-hidden="true" /> {c.today}
        </li>
      </ul>
    </>
  )
}
