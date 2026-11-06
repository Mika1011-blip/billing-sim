import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientHistoryEntry, ClientTicket } from '../../types'
import { TicketDetail } from './TicketDetail'

// BANK-5 as the client API sends it on the snapshot's last day, and its journal (`/client/tickets/BANK-5/history`).
const ticket = snapshot.tickets.find((t) => t.cle === 'BANK-5') as ClientTicket
const history = snapshot.history['BANK-5'] as ClientHistoryEntry[]
const DAY = snapshot.day
const HISTORY_URL = '/client/tickets/BANK-5/history'

// Collapse any kind of unicode space (narrow / no-break) to a plain one.
const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

function stubHistory(rows: ClientHistoryEntry[] = history) {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, statusText: '', json: async () => rows }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const historyFetches = (fetchMock: ReturnType<typeof stubHistory>) =>
  fetchMock.mock.calls.filter(([url]) => url === HISTORY_URL).length

const row = () => document.getElementById('rec-BANK-5')!
const toggle = () => within(row()).getByRole('button', { name: /BANK-5/ })
const reveal = (key: string) => act(() => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: key })))
const journalLoaded = () => screen.findByText("En attente des accès à l'API bancaire")

afterEach(() => vi.unstubAllGlobals())

describe('TicketDetail', () => {
  it('renders the collapsed line: key, title, price calculation, statut, real days and event count', () => {
    const fetchMock = stubHistory()
    render(<TicketDetail ticket={ticket} day={DAY} />)
    const text = plain(row().textContent)
    expect(text).toContain('BANK-5')
    expect(text).toContain('Import des relevés bancaires')
    expect(text).toContain('M → 3 j × 750 € = 2 250 €')
    expect(text).toContain('1,82 j réels')
    expect(text).toContain('9 événements ▸')
    expect(within(row()).getByText('Terminé')).toHaveClass('pill', 'pill-termine')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(ticket.description)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('expands to the detail and fetches the journal once, however often it is toggled', async () => {
    const fetchMock = stubHistory()
    render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(ticket.description)).toBeInTheDocument()
    expect(plain(row().textContent)).toContain('Assigné à Sophie Lambert')
    expect(plain(row().textContent)).toContain('Du 19/03/2026 au 24/03/2026')
    await journalLoaded()
    expect(historyFetches(fetchMock)).toBe(1)

    await userEvent.click(toggle())
    expect(screen.queryByText(ticket.description)).toBeNull()
    await userEvent.click(toggle())
    expect(screen.getByText("En attente des accès à l'API bancaire")).toBeInTheDocument()
    expect(historyFetches(fetchMock)).toBe(1)
  })

  it('lists the journal oldest first with date, an icon per type, actor and text', async () => {
    stubHistory()
    render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    await journalLoaded()
    const items = within(screen.getByRole('list', { name: 'Journal' })).getAllByRole('listitem')
    expect(items).toHaveLength(history.length)
    expect(plain(items[0].textContent)).toBe('19/03/2026 ↔ Sophie Lambert À faire → En cours')
    const iconOf = (contenu: string) => plain(items.find((li) => li.textContent?.includes(contenu))!.textContent)
    expect(iconOf('8,0 h : Brancher')).toContain('⏱')
    expect(iconOf("En attente des accès à l'API bancaire")).toContain('⛔')
    expect(iconOf('Le blocage est levé.')).toContain('✅')
    expect(iconOf('Terminé. Étapes réalisées')).toContain('💬')
  })

  it('numbers the planned steps and ticks only those found in a worklog note', async () => {
    // As if the second worklog were not written yet: steps 3 and 4 then only appear in the closing comment.
    const firstWorklogOnly = history.filter((r) => !(r.type === 'Temps passé' && r.date === '2026-03-24'))
    stubHistory(firstWorklogOnly)
    render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    await journalLoaded()
    const steps = screen.getByRole('list', { name: 'Étapes prévues' })
    expect(steps.tagName).toBe('OL')
    const items = within(steps).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.includes('✓'))).toEqual([true, true, false, false])
    expect(items[0]).toHaveTextContent(ticket.etapes[0])
  })

  it('ticks every step once all worklogs are in', async () => {
    stubHistory()
    render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    await journalLoaded()
    const items = within(screen.getByRole('list', { name: 'Étapes prévues' })).getAllByRole('listitem')
    expect(items.every((li) => li.textContent?.includes('✓'))).toBe(true)
  })

  it('says "Non commencé" for a ticket without real dates', async () => {
    stubHistory([])
    const notStarted: ClientTicket = { ...ticket, statut: 'À faire', debut_reel: null, fin_reel: null, journal_nombre: 0 }
    render(<TicketDetail ticket={notStarted} day={DAY} />)
    await userEvent.click(toggle())
    expect(await screen.findByText('Aucun événement pour le moment.')).toBeInTheDocument()
    expect(plain(row().textContent)).toContain('Non commencé')
    expect(plain(row().textContent)).not.toContain('Du ')
  })

  it('gives only the start date of a ticket still in progress', async () => {
    stubHistory(history.filter((r) => r.date <= '2026-03-20'))
    render(<TicketDetail ticket={{ ...ticket, statut: 'En cours', fin_reel: null }} day={DAY} />)
    await userEvent.click(toggle())
    await journalLoaded()
    expect(plain(row().textContent)).toContain('Depuis le 19/03/2026')
  })

  it('opens when a citation reveals its key, and ignores other keys', async () => {
    const fetchMock = stubHistory()
    render(<TicketDetail ticket={ticket} day={DAY} />)
    reveal('BANK-4')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    reveal('BANK-5')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await journalLoaded()
    expect(historyFetches(fetchMock)).toBe(1)
  })

  it('opens from the start with defaultOpen or a matching revealKey', async () => {
    stubHistory()
    const { unmount } = render(<TicketDetail ticket={ticket} day={DAY} defaultOpen />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await journalLoaded()
    unmount()
    render(<TicketDetail ticket={ticket} day={DAY} revealKey="BANK-5" />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await journalLoaded()
  })

  it('fetches the journal again when the day changes', async () => {
    const fetchMock = stubHistory()
    const { rerender } = render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    await journalLoaded()
    rerender(<TicketDetail ticket={ticket} day={DAY} />)
    expect(historyFetches(fetchMock)).toBe(1)
    rerender(<TicketDetail ticket={ticket} day={DAY - 1} />)
    await journalLoaded()
    expect(historyFetches(fetchMock)).toBe(2)
  })

  it('shows a French error when the journal cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: '', json: async () => ({}) })))
    render(<TicketDetail ticket={ticket} day={DAY} />)
    await userEvent.click(toggle())
    expect(await screen.findByText('Impossible de charger le journal.')).toBeInTheDocument()
  })
})
