import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { snapshot } from '../test-fixtures/snapshot'
import { DevPage } from './DevPage'

const { plan, timeline, diff, clock: lastClock } = snapshot

function reply(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: '', json: async () => body }
}

function installFetch(withPlan: boolean) {
  let day = lastClock.day
  const clock = () => ({ ...lastClock, day })
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

const cellsOf = (table: HTMLElement) => within(table).getAllByRole('cell')

describe('DevPage', () => {
  it('shows a hint instead of the charts when there is no plan yet', async () => {
    installFetch(false)
    render(<DevPage />)
    expect(await screen.findByText(/no simulation yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /gantt/i })).not.toBeInTheDocument()
    expect(await screen.findByText('get_ticket')).toBeInTheDocument()
  })

  it('renders the backend snapshot: gantt grouped by lot with blocked spans, paid invoices, filled diff tables', async () => {
    installFetch(true)
    const { container } = render(<DevPage />)
    expect(await screen.findByRole('img', { name: /gantt/i })).toBeInTheDocument()

    // Gantt: one row per ticket, one group per lot (plus the ticket priced outside any lot), hatched blocked spans.
    expect(container.querySelectorAll('g.ticket-row')).toHaveLength(plan.tickets.length)
    expect(container.querySelectorAll('.lot-label').length).toBeGreaterThanOrEqual(2)
    for (const lot of plan.lots) expect(container.querySelector('svg.gantt')).toHaveTextContent(lot.name)
    expect(container.querySelectorAll('rect.blocked').length).toBeGreaterThanOrEqual(1)
    expect(container.querySelectorAll('path.dependency').length).toBeGreaterThan(0)

    // Ledger at the last day: money has been paid, every invoice names its lot or ticket.
    const invoices = screen.getByRole('heading', { name: 'Invoices' }).nextElementSibling as HTMLElement
    const rows = within(invoices).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(timeline.invoices.length)
    const paid = rows.map((r) => Number(within(r).getAllByRole('cell')[5].textContent))
    expect(paid.some((p) => p > 0)).toBe(true)
    const lotCells = rows.map((r) => within(r).getAllByRole('cell')[1].textContent)
    expect(lotCells).not.toContain('—')
    expect(lotCells).toContain('L1')

    // Plan vs real tables: every cell is filled with the backend's names.
    for (const heading of ['Plan vs real: lots', 'Plan vs real: tickets']) {
      const table = screen.getByRole('heading', { name: heading }).nextElementSibling as HTMLElement
      for (const cell of cellsOf(table)) {
        expect(cell.textContent?.trim(), heading).toBeTruthy()
        expect(cell.textContent).not.toContain('undefined')
      }
    }
    const lotTable = screen.getByRole('heading', { name: 'Plan vs real: lots' }).nextElementSibling as HTMLElement
    expect(lotTable).toHaveTextContent(plan.lots[0].name)
    const ticketTable = screen.getByRole('heading', { name: 'Plan vs real: tickets' }).nextElementSibling as HTMLElement
    expect(ticketTable).toHaveTextContent(plan.tickets[0].assignee)
  })

  it('moves "today" when the clock moves', async () => {
    installFetch(true)
    const { container } = render(<DevPage />)
    expect(await screen.findByRole('img', { name: /gantt/i })).toBeInTheDocument()
    const futureAt = (day: number) => timeline.invoices.filter((i) => i.issued_day > day).length
    expect(container.querySelectorAll('tr.future')).toHaveLength(0)

    const before = container.querySelector('line.today')!.getAttribute('x1')
    await userEvent.click(screen.getByRole('button', { name: '−5' }))
    const day = lastClock.day - 5
    expect(await screen.findByText(new RegExp(`Day ${day} / ${lastClock.last_day}`))).toBeInTheDocument()
    expect(container.querySelector('line.today')!.getAttribute('x1')).not.toBe(before)
    expect(container.querySelectorAll('tr.future')).toHaveLength(futureAt(day))
  })
})
