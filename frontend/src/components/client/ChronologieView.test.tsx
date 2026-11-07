import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import { ticketsAsOf } from '../../test-fixtures/asOf'
import type { ClientLot, ClientTicket, ClientToday } from '../../types'
import { ChronologieView } from './ChronologieView'

const lastDay = snapshot.today as ClientToday
const mid = snapshot.mid.today as ClientToday
const lots = snapshot.lots as ClientLot[]
const tickets = snapshot.tickets as ClientTicket[]
const midTickets = ticketsAsOf(tickets, mid.date)

const reply = (body: unknown) => ({ ok: true, status: 200, statusText: '', json: async () => body })
const HISTORY = /^\/client\/tickets\/(.+)\/history$/

/** Answers each ticket's history from the snapshot (BANK-5 has one; the others are empty here). */
function installFetch() {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = HISTORY.exec(url)?.[1]
      return reply(key ? ((snapshot.history as Record<string, unknown[]>)[key] ?? []) : {})
    }),
  )
  return calls
}

const section = (name: RegExp) => screen.getByRole('region', { name })
const keysIn = (el: HTMLElement) => [...el.querySelectorAll('.ticket-detail')].map((d) => d.id.replace(/^rec-/, ''))

afterEach(() => vi.unstubAllGlobals())

describe('ChronologieView', () => {
  it('lists every ticket as done on the last day, newest end first', async () => {
    const calls = installFetch()
    render(<ChronologieView tickets={tickets} lots={lots} today={lastDay} />)
    const done = tickets.filter((t) => t.statut === 'Terminé')
    expect(screen.getByRole('heading', { name: `Terminé (${done.length})` })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: `Reste à faire (${tickets.length - done.length})` })).toBeInTheDocument()
    const listed = keysIn(section(/^Terminé/))
    expect(listed).toHaveLength(done.length)
    const ends = listed.map((k) => tickets.find((t) => t.cle === k)!.fin_reel!)
    expect(ends).toEqual([...ends].sort().reverse())
    expect(listed[0]).toBe('BANK-10') // done 09/04/2026, the latest
    expect(within(section(/^Reste à faire/)).getByText('Tous les tickets sont terminés.')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('rect.blocked')).not.toBeNull()) // BANK-5's block
    expect(calls).toHaveLength(tickets.length) // one history per started ticket
  })

  it('counts mid-run match the snapshot: done tickets per lot, the rest by planned start', async () => {
    const calls = installFetch()
    render(<ChronologieView tickets={midTickets} lots={lots} today={mid} />)
    const doneInLots = (snapshot.mid.lots as ClientLot[]).reduce((n, l) => n + l.tickets_termines, 0)
    expect(keysIn(section(/^Terminé/))).toHaveLength(doneInLots) // BANK-12 (no lot) is not done yet
    expect(screen.getByRole('heading', { name: `Terminé (${doneInLots})` })).toBeInTheDocument()
    const rest = section(/^Reste à faire/)
    expect(keysIn(rest)).toEqual(['BANK-8', 'BANK-9', 'BANK-10', 'BANK-12']) // planned 27/03, 30/03, 03/04, 03/04
    expect(screen.getByRole('heading', { name: 'Reste à faire (4)' })).toBeInTheDocument()
    const plain = (key: string) => (document.getElementById(`rec-${key}`)?.textContent ?? '').replace(/\s/g, ' ')
    expect(plain('BANK-10')).toContain('Début prévu le 03/04/2026')
    expect(plain('BANK-8')).not.toContain('Début prévu') // already started
    // histories only for the started tickets
    await waitFor(() => expect(calls).toHaveLength(midTickets.filter((t) => t.debut_reel).length))
    expect(calls).not.toContain('/client/tickets/BANK-10/history')
  })

  it('fetches each history once per day', async () => {
    const calls = installFetch()
    const { rerender } = render(<ChronologieView tickets={tickets} lots={lots} today={lastDay} />)
    await waitFor(() => expect(calls).toHaveLength(tickets.length))
    rerender(<ChronologieView tickets={[...tickets]} lots={lots} today={{ ...lastDay }} />)
    expect(calls).toHaveLength(tickets.length)
    const day74 = { jour: 74, date: '2026-06-12', date_longue: 'vendredi 12 juin 2026' }
    rerender(<ChronologieView tickets={tickets} lots={lots} today={day74} />)
    await waitFor(() => expect(calls).toHaveLength(2 * tickets.length))
    await screen.findByRole('heading', { name: /^Terminé/ })
  })

  it('opens the detail of a clicked row below the chart, one at a time', async () => {
    installFetch()
    render(<ChronologieView tickets={tickets} lots={lots} today={lastDay} />)
    const chart = screen.getByRole('group', { name: /Avancement des tickets/ })
    await userEvent.click(within(chart).getByRole('button', { name: /^BANK-5 · / }))
    const detail = screen.getByRole('region', { name: 'Détail du ticket' })
    expect(within(detail).getByRole('button', { expanded: true })).toHaveTextContent('BANK-5')
    expect(await within(detail).findByText("En attente des accès à l'API bancaire")).toBeInTheDocument()
    await userEvent.click(within(chart).getByRole('button', { name: /^BANK-2 · / }))
    expect(within(detail).getAllByRole('button', { expanded: true })).toHaveLength(1)
    expect(within(detail).getByRole('button', { expanded: true })).toHaveTextContent('BANK-2')
    await within(detail).findByText('Aucun événement pour le moment.')
    // clicking the open row again closes it
    await userEvent.click(within(chart).getByRole('button', { name: /^BANK-2 · / }))
    expect(screen.queryByRole('region', { name: 'Détail du ticket' })).toBeNull()
    // a single element per ticket id on the page
    expect(document.querySelectorAll('[id="rec-BANK-2"]')).toHaveLength(1)
  })
})
