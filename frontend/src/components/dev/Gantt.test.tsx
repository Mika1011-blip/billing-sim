import { render } from '@testing-library/react'
import { Gantt, scale } from './Gantt'
import type { DiffTicketRow, Sprint, TimelineEvent } from '../../types'

const row = (key: string, lot: string, ps: number, pe: number, rs: number, re: number): DiffTicketRow => ({
  key,
  lot_key: lot,
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

const ev = (ticket_key: string, day: number, type: 'blocked' | 'unblocked', seq = 0): TimelineEvent => ({
  ticket_key,
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

  it('draws a dependency arrow only between rows that exist', () => {
    const deps = { 'T-2': ['T-1'], 'T-3': ['T-2', 'T-missing'] }
    const { container } = render(
      <Gantt rows={rows} lots={lots} sprints={sprints} today={5} lastDay={20} dependencies={deps} />,
    )
    expect(container.querySelectorAll('path.dependency')).toHaveLength(2)
  })
})
