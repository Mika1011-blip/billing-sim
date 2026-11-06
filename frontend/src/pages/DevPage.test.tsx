import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { SIM_RESET_EVENT } from '../sim'
import { snapshot } from '../test-fixtures/snapshot'
import { DevPage } from './DevPage'

const { plan, timeline, diff, clock: lastClock } = snapshot

function reply(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: '', json: async () => body }
}

let wasReset = false // the backend after POST /sim/reset: no plan

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
      if ((!withPlan || wasReset) && url !== '/dev/agent-tools') return reply({ detail: 'no plan' }, 409)
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

afterEach(() => {
  wasReset = false
  vi.unstubAllGlobals()
})

const cellsOf = (table: HTMLElement) => within(table).getAllByRole('cell')

describe('DevPage', () => {
  it('shows a hint instead of the charts when there is no plan yet', async () => {
    installFetch(false)
    render(<DevPage />)
    expect(await screen.findByText(/aucune simulation pour le moment/i)).toBeInTheDocument()
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
    const invoices = screen.getByRole('heading', { name: 'Factures' }).nextElementSibling as HTMLElement
    const rows = within(invoices).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(timeline.invoices.length)
    const paid = rows.map((r) => Number(within(r).getAllByRole('cell')[5].textContent))
    expect(paid.some((p) => p > 0)).toBe(true)
    const lotCells = rows.map((r) => within(r).getAllByRole('cell')[1].textContent)
    expect(lotCells).not.toContain('—')
    expect(lotCells).toContain('L1')

    // Plan vs real tables: every cell is filled with the backend's names.
    for (const heading of ['Prévu / réel : lots', 'Prévu / réel : tickets']) {
      const table = screen.getByRole('heading', { name: heading }).nextElementSibling as HTMLElement
      for (const cell of cellsOf(table)) {
        expect(cell.textContent?.trim(), heading).toBeTruthy()
        expect(cell.textContent).not.toContain('undefined')
      }
    }
    const lotTable = screen.getByRole('heading', { name: 'Prévu / réel : lots' }).nextElementSibling as HTMLElement
    expect(lotTable).toHaveTextContent(plan.lots[0].name)
    const ticketTable = screen.getByRole('heading', { name: 'Prévu / réel : tickets' }).nextElementSibling as HTMLElement
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
    expect(await screen.findByText(new RegExp(`Jour ${day} / ${lastClock.last_day}`))).toBeInTheDocument()
    expect(container.querySelector('line.today')!.getAttribute('x1')).not.toBe(before)
    expect(container.querySelectorAll('tr.future')).toHaveLength(futureAt(day))
  })

  it('is all French: title, panels, legend', async () => {
    installFetch(true)
    render(<DevPage />)
    expect(await screen.findByRole('img', { name: /gantt/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pilotage de la simulation')
    for (const name of ['Configuration', "Outils de l'agent", 'Horloge', 'Diagramme de Gantt', 'Grand livre']) {
      expect(screen.getByRole('heading', { name }), name).toBeInTheDocument()
    }
    const legend = document.querySelector('.legend')!
    for (const word of ['prévu', 'réel', 'bloqué', "aujourd'hui"]) expect(legend).toHaveTextContent(word)
  })

  it('after a reset shows the setup panel and the empty message again', async () => {
    installFetch(true)
    render(<DevPage />)
    expect(await screen.findByRole('img', { name: /gantt/i })).toBeInTheDocument()
    wasReset = true
    await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
    expect(await screen.findByText(/aucune simulation pour le moment/i)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /gantt/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Générer' })).toBeInTheDocument()
  })
})
