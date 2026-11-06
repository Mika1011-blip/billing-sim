import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevPage } from './DevPage'

const plan = {
  scenario: { request_text: '', product_summary: '', seed: 1, start_date: '2026-01-05', warnings: [] },
  contract: {},
  team: [],
  sprints: [{ number: 1, start_day: 0, end_day: 9 }],
  lots: [{ key: 'L1', name: 'Lot one', description: '', price: 1000, planned_delivery_day: 5 }],
  tickets: [
    { key: 'T-1', title: 'a', lot_key: 'L1', charged_separately: false, size: 'S', profile: 'dev', days_charged: 1, fee: 500, assignee: 'x', sprint_number: 1, planned_start_day: 0, planned_end_day: 2, depends_on: [] },
    { key: 'T-2', title: 'b', lot_key: 'L1', charged_separately: false, size: 'S', profile: 'dev', days_charged: 1, fee: 500, assignee: 'x', sprint_number: 1, planned_start_day: 3, planned_end_day: 5, depends_on: ['T-1'] },
  ],
}
const ticketRow = (key: string, ps: number, pe: number) => ({
  key, lot_key: 'L1', assignee: 'x', planned_start: ps, planned_end: pe, real_start: ps, real_end: pe + 1, slip_days: 1, days_charged: 1, actual_days: 3,
})
const diff = {
  tickets: [ticketRow('T-1', 0, 2), ticketRow('T-2', 3, 5)],
  lots: [{ key: 'L1', name: 'Lot one', planned_delivery: 5, real_delivery: 6, slip_days: 1, days_charged: 2, actual_days: 6 }],
}
const timeline = {
  events: [
    { ticket_key: 'T-2', day: 4, seq: 0, type: 'blocked', actor: 'x', payload: { reason: 'waiting' } },
    { ticket_key: 'T-2', day: 5, seq: 0, type: 'unblocked', actor: 'x', payload: {} },
  ],
  invoices: [{ number: 'F-1', lot_key: 'L1', ticket_key: null, issued_day: 7, due_day: 37, amount_ht: 1000, vat: 200, amount_ttc: 1200, covers: [] }],
  payments: [],
  approvals: [],
}

function reply(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: '', json: async () => body }
}

function installFetch(withPlan: boolean) {
  let day = 3
  const clock = () => ({ day, last_day: 20, date: `2026-01-${String(5 + day).padStart(2, '0')}` })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/sim/clock' && init?.method === 'PUT') {
        day = JSON.parse(String(init.body)).day
        return reply(clock())
      }
      if (!withPlan && url !== '/dev/agent-tools') return reply({ detail: 'no plan' }, 409)
      if (url === '/sim/clock') return reply(clock())
      if (url === '/dev/plan') return reply(plan)
      if (url.startsWith('/dev/timeline')) return reply(timeline)
      if (url === '/dev/diff') return reply(diff)
      if (url === '/dev/agent-tools')
        return reply([{ name: 'get_ticket', description: 'Read a ticket', input_schema: {} }])
      return reply({}, 404)
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('DevPage', () => {
  it('shows a hint instead of the charts when there is no plan yet', async () => {
    installFetch(false)
    render(<DevPage />)
    expect(await screen.findByText(/no simulation yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /gantt/i })).not.toBeInTheDocument()
    expect(await screen.findByText('get_ticket')).toBeInTheDocument()
  })

  it('renders gantt rows and ledger, and moves "today" when the clock moves', async () => {
    installFetch(true)
    const { container } = render(<DevPage />)
    expect(await screen.findByRole('img', { name: /gantt/i })).toBeInTheDocument()
    expect(container.querySelectorAll('g.ticket-row')).toHaveLength(2)
    expect(container.querySelectorAll('rect.blocked')).toHaveLength(1)
    expect(container.querySelectorAll('path.dependency')).toHaveLength(1)
    expect(screen.getByText('F-1').closest('tr')).toHaveClass('future')

    const before = container.querySelector('line.today')!.getAttribute('x1')
    await userEvent.click(screen.getByRole('button', { name: '+5' }))
    expect(await screen.findByText(/Day 8 \/ 20/)).toBeInTheDocument()
    expect(container.querySelector('line.today')!.getAttribute('x1')).not.toBe(before)
    expect(screen.getByText('F-1').closest('tr')).not.toHaveClass('future')
  })
})
