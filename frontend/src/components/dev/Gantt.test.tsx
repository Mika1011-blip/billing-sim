import { render } from '@testing-library/react'
import { Gantt, scale } from './Gantt'
import { snapshot } from '../../test-fixtures/snapshot'
import type { DiffTicketRow, Sprint, TimelineEvent } from '../../types'

const row = (key: string, lot: string, ps: number, pe: number, rs: number, re: number): DiffTicketRow => ({
  key,
  lot,
  assignee: 'a',
  planned_start: ps,
  planned_end: pe,
  real_start: rs,
  real_end: re,
  slip_days: re - pe,
  days_charged: 1,
  actual_days: re - rs + 1,
})

const rows = [
  row('T-1', 'L1', 0, 2, 0, 3),
  row('T-2', 'L1', 3, 5, 4, 7),
  row('T-3', 'L2', 6, 8, 8, 10),
]
const lots = [
  { key: 'L1', name: 'Lot one' },
  { key: 'L2', name: 'Lot two' },
]
const sprints: Sprint[] = [
  { number: 1, start_day: 0, end_day: 4 },
  { number: 2, start_day: 5, end_day: 9 },
]

const ev = (ticket: string, day: number, type: 'blocked' | 'unblocked', seq = 0): TimelineEvent => ({
  ticket,
  date: '2026-01-05',
  day,
  seq,
  type,
  actor: 'x',
  payload: {},
})

describe('Gantt', () => {
  it('renders one ticket row per diff row, plus a label per lot', () => {
    const { container } = render(
      <Gantt rows={rows} lots={lots} sprints={sprints} today={5} lastDay={20} />,
    )
    expect(container.querySelectorAll('g.ticket-row')).toHaveLength(3)
    expect(container.querySelectorAll('.lot-label')).toHaveLength(2)
    expect(container.textContent).toContain('Lot one')
    expect(container.querySelectorAll('.sprint-band')).toHaveLength(2)
  })

  it('draws the today line at the scaled day', () => {
    const { container } = render(
      <Gantt rows={rows} lots={lots} sprints={sprints} today={5} lastDay={20} />,
    )
    const line = container.querySelector('line.today')
    expect(line).not.toBeNull()
    expect(Number(line!.getAttribute('x1'))).toBe(scale(5))
    expect(Number(line!.getAttribute('x2'))).toBe(scale(5))
  })

  it('draws blocked spans from blocked/unblocked events, inclusive of both days', () => {
    const events = [ev('T-2', 5, 'blocked'), ev('T-2', 6, 'unblocked')]
    const { container } = render(
      <Gantt rows={rows} lots={lots} sprints={sprints} today={5} lastDay={20} events={events} />,
    )
    const spans = container.querySelectorAll('rect.blocked')
    expect(spans).toHaveLength(1)
    expect(Number(spans[0].getAttribute('x'))).toBe(scale(5))
    expect(Number(spans[0].getAttribute('width'))).toBe(scale(7) - scale(5))
  })

  it('groups the backend snapshot by lot and hatches its blocked spans', () => {
    const { diff, plan, timeline, clock } = snapshot
    const { container } = render(
      <Gantt
        rows={diff.tickets}
        lots={plan.lots}
        sprints={plan.sprints}
        today={clock.day}
        lastDay={clock.last_day}
        events={timeline.events}
      />,
    )
    expect(container.querySelectorAll('g.ticket-row')).toHaveLength(plan.tickets.length)
    const labels = [...container.querySelectorAll('.lot-label')].map((l) => l.textContent)
    expect(labels.length).toBeGreaterThanOrEqual(2)
    for (const lot of plan.lots) expect(labels).toContain(lot.name)
    const blockedTickets = new Set(timeline.events.filter((e) => e.type === 'blocked').map((e) => e.ticket))
    expect(container.querySelectorAll('rect.blocked').length).toBeGreaterThanOrEqual(1)
    for (const key of blockedTickets) {
      expect(container.querySelector(`g[data-key="${key}"] rect.blocked`)).not.toBeNull()
    }
  })

  it('still draws a ticket that has no lot', () => {
    const loose = { ...row('T-9', 'L1', 9, 9, 9, 9), lot: null }
    const { container } = render(
      <Gantt rows={[...rows, loose]} lots={lots} sprints={sprints} today={5} lastDay={20} />,
    )
    expect(container.querySelectorAll('g.ticket-row')).toHaveLength(4)
    expect(container.textContent).toContain('Sans lot')
  })

  it('draws a dependency arrow only between rows that exist', () => {
    const deps = { 'T-2': ['T-1'], 'T-3': ['T-2', 'T-missing'] }
    const { container } = render(
      <Gantt rows={rows} lots={lots} sprints={sprints} today={5} lastDay={20} dependencies={deps} />,
    )
    expect(container.querySelectorAll('path.dependency')).toHaveLength(2)
  })
})
