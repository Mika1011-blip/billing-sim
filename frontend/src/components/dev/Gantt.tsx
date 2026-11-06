import { fr } from '../../i18n/fr'
import type { DiffTicketRow, Sprint, TimelineEvent } from '../../types'

export const PAD = 160 // left margin holds the labels
export const DAY_PX = 14
const ROW_H = 24
const LOT_H = 22
const HEAD_H = 24
const BAR_H = 8
const NO_LOT = ''

export const scale = (day: number) => PAD + day * DAY_PX

interface Props {
  rows: DiffTicketRow[]
  lots: { key: string; name: string }[]
  sprints: Sprint[]
  today: number
  lastDay: number
  events?: TimelineEvent[]
  /** ticket key -> keys it depends on */
  dependencies?: Record<string, string[]>
}

interface Span {
  from: number
  to: number
}

/** A span runs from the blocked day through the unblocked day, inclusive. */
export function blockedSpans(events: TimelineEvent[], lastDay: number): Record<string, Span[]> {
  const out: Record<string, Span[]> = {}
  const open: Record<string, number> = {}
  const sorted = events
    .filter((e) => e.type === 'blocked' || e.type === 'unblocked')
    .sort((a, b) => a.day - b.day || a.seq - b.seq)
  for (const e of sorted) {
    if (e.type === 'blocked') {
      if (!(e.ticket in open)) open[e.ticket] = e.day
    } else if (e.ticket in open) {
      const spans = (out[e.ticket] ??= [])
      spans.push({ from: open[e.ticket], to: e.day })
      delete open[e.ticket]
    }
  }
  for (const [key, from] of Object.entries(open)) {
    const spans = (out[key] ??= [])
    spans.push({ from, to: lastDay })
  }
  return out
}

interface Layout {
  lotLabels: { key: string; name: string; y: number }[]
  rowY: Record<string, number>
  height: number
}

function layout(rows: DiffTicketRow[], lots: { key: string; name: string }[]): Layout {
  const lotLabels: Layout['lotLabels'] = []
  const rowY: Record<string, number> = {}
  let y = HEAD_H
  const known = new Set(lots.map((l) => l.key))
  // Tickets with no lot (or an unknown one) still get a group, so every row is drawn.
  const orphans = [...new Set(rows.map((r) => r.lot ?? NO_LOT))]
    .filter((k) => !known.has(k))
    .map((k) => ({ key: k, name: k === NO_LOT ? fr.dev.gantt.noLot : k }))
  for (const lot of [...lots, ...orphans]) {
    const lotRows = rows.filter((r) => (r.lot ?? NO_LOT) === lot.key)
    if (lotRows.length === 0) continue
    lotLabels.push({ key: lot.key, name: lot.name, y })
    y += LOT_H
    for (const r of lotRows) {
      rowY[r.key] = y
      y += ROW_H
    }
  }
  return { lotLabels, rowY, height: y + 8 }
}

const barW = (start: number, end: number) => (end - start + 1) * DAY_PX

export function Gantt({ rows, lots, sprints, today, lastDay, events = [], dependencies = {} }: Props) {
  const { lotLabels, rowY, height } = layout(rows, lots)
  const width = scale(lastDay + 1) + 20
  const spans = blockedSpans(events, lastDay)
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))

  const arrows: { id: string; d: string }[] = []
  for (const [key, deps] of Object.entries(dependencies)) {
    const to = byKey[key]
    if (!to || to.planned_start === null || !(key in rowY)) continue
    for (const dep of deps) {
      const from = byKey[dep]
      if (!from || from.planned_end === null || !(dep in rowY)) continue
      const x1 = scale(from.planned_end + 1)
      const y1 = rowY[dep] + 7
      const x2 = scale(to.planned_start)
      const y2 = rowY[key] + 7
      const mx = Math.max(x1, x2 - 6) + 4
      arrows.push({ id: `${dep}->${key}`, d: `M${x1},${y1} H${mx} V${y2} H${x2}` })
    }
  }

  return (
    <svg className="gantt" width={width} height={height} role="img" aria-label={fr.dev.gantt.title}>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#b45309" strokeWidth="3" />
        </pattern>
        <marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#555" />
        </marker>
      </defs>

      {sprints.map((s) => (
        <g key={s.number}>
          <rect
            className="sprint-band"
            x={scale(s.start_day)}
            y={0}
            width={barW(s.start_day, s.end_day)}
            height={height}
            fill={s.number % 2 ? '#f1f5f9' : '#e2e8f0'}
          />
          <text x={scale(s.start_day) + 3} y={14} className="sprint-label">
            S{s.number}
          </text>
        </g>
      ))}

      {lotLabels.map((l) => (
        <text key={l.key} className="lot-label" x={4} y={l.y + 15}>
          {l.name}
        </text>
      ))}

      {rows.map((r) => {
        const y = rowY[r.key]
        if (y === undefined) return null
        return (
          <g key={r.key} className="ticket-row" data-key={r.key}>
            <text x={12} y={y + 15} className="ticket-label">
              {r.key}
            </text>
            {r.planned_start !== null && r.planned_end !== null && (
              <rect
                className="planned"
                x={scale(r.planned_start)}
                y={y + 3}
                width={barW(r.planned_start, r.planned_end)}
                height={BAR_H}
                fill="#cbd5e1"
              />
            )}
            {r.real_start !== null && r.real_end !== null && (
              <rect
                className="real"
                x={scale(r.real_start)}
                y={y + 13}
                width={barW(r.real_start, r.real_end)}
                height={BAR_H}
                fill="#4f46e5"
              />
            )}
            {(spans[r.key] ?? []).map((s) => (
              <rect
                key={`${s.from}-${s.to}`}
                className="blocked"
                x={scale(s.from)}
                y={y + 12}
                width={barW(s.from, s.to)}
                height={BAR_H + 2}
                fill="url(#hatch)"
                stroke="#b45309"
              />
            ))}
          </g>
        )
      })}

      {arrows.map((a) => (
        <path key={a.id} className="dependency" d={a.d} fill="none" stroke="#555" strokeWidth="1" markerEnd="url(#arrowhead)" />
      ))}

      <line className="today" x1={scale(today)} x2={scale(today)} y1={0} y2={height} stroke="#b91c1c" strokeWidth="2" />
    </svg>
  )
}
