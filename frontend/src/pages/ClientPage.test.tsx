import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell, CLOCK_POLL_MS } from '../components/AppShell'
import { SIM_RESET_EVENT } from '../sim'
import snapshot from '../test-fixtures/client-snapshot.json'
import { ClientPage } from './ClientPage'

/** The page alone (inside a router, for its links). */
const renderPage = () => render(<ClientPage />, { wrapper: MemoryRouter })

/** The page inside the app shell, which owns the clock poll. */
const renderInShell = () =>
  render(
    <MemoryRouter initialEntries={['/client']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/client" element={<ClientPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

// Day 3 = Wednesday 2026-03-04; day 0 = Monday 2026-03-02.
const DATES = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09']
const LONG = ['lundi 2 mars 2026', 'mardi 3 mars 2026', 'mercredi 4 mars 2026', 'jeudi 5 mars 2026', 'vendredi 6 mars 2026', 'lundi 9 mars 2026']

// Records exactly as the client API sends them (snapshot); the dates and the clock are this test's own.
const lot = snapshot.lots.find((l) => l.cle === 'L1')! // tickets BANK-1..3, invoice F-2026-001
const ticket = snapshot.tickets.find((t) => t.cle === 'BANK-1')!
const loose = snapshot.tickets.find((t) => t.cle === 'BANK-12')! // charged separately, no lot
const invoice = snapshot.invoices.find((i) => i.numero === 'F-2026-001')!
const summary = { ...snapshot.summary, lots: [lot] }

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', json: async () => body })

let failClient = false
let wasReset = false // the backend after POST /sim/reset: no clock, no client data

let day = 2 // the backend clock; a test moves it to simulate /dev moving it

function installFetch() {
  day = 2
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (failClient && url.startsWith('/client/')) return reply({ detail: 'boom' }, 500)
      if (wasReset && url === '/sim/clock') return reply({ detail: 'no simulation' }, 404)
      if (wasReset && url.startsWith('/client/')) return reply({ detail: 'no plan' }, 409)
      if (url === '/sim/clock' && init?.method === 'PUT') day = JSON.parse(String(init.body)).day
      if (url === '/sim/clock') return reply({ day, last_day: 5, date: DATES[day] })
      if (url === '/client/today') return reply({ jour: day, date: DATES[day], date_longue: LONG[day] })
      if (url === '/client/summary') return reply(summary)
      if (url === '/client/lots') return reply([lot])
      if (url === '/client/tickets') return reply([ticket, loose])
      if (url === '/client/invoices') return reply([invoice])
      if (url === '/client/payments') return reply([])
      if (url === '/client/approvals/pending') return reply([{ ...lot, statut_facture: 'À venir' }])
      return reply({}, 404)
    }),
  )
  return calls
}

afterEach(() => {
  vi.useRealTimers()
  failClient = false
  wasReset = false
  vi.unstubAllGlobals()
})

describe('ClientPage', () => {
  it('loads everything and renders the French dashboard with record anchors', async () => {
    installFetch()
    renderPage()
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      "Aujourd'hui : mercredi 4 mars 2026 · jour 2",
    )
    expect(screen.getByText('Reste à payer')).toBeInTheDocument()
    expect(screen.getByText('Lots à valider')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Posez une question…')).toBeInTheDocument()
    for (const id of ['rec-L1', 'rec-BANK-1', 'rec-BANK-12', 'rec-F-2026-001']) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
    // the ticket without a lot is listed on its own, the other one inside its lot card
    expect(within(document.getElementById('rec-L1')!).getByText(ticket.titre)).toBeInTheDocument()
    expect(within(document.getElementById('rec-L1')!).queryByText(loose.titre)).toBeNull()
  })

  describe('when the clock is moved elsewhere', () => {
    const summaryFetches = (calls: string[]) => calls.filter((c) => c === 'GET /client/summary').length

    async function loaded() {
      const calls = installFetch()
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) // promises and findBy keep running normally
      renderInShell() // the shell polls the clock; the page refetches when the polled day differs from its own
      await screen.findByText(/mercredi 4 mars 2026/)
      return calls
    }

    const tick = () => act(async () => void vi.advanceTimersByTime(CLOCK_POLL_MS))

    it('refetches once when the polled clock day changed, and shows the new date', async () => {
      const calls = await loaded()
      expect(summaryFetches(calls)).toBe(1)
      day = 4 // moved from /dev
      await tick()
      expect(await screen.findByText(/vendredi 6 mars 2026 · jour 4/)).toBeInTheDocument()
      expect(summaryFetches(calls)).toBe(2)
      await tick() // now unchanged
      expect(summaryFetches(calls)).toBe(2)
    })

    it('does not refetch while the polled clock day is unchanged', async () => {
      const calls = await loaded()
      await tick()
      await tick()
      expect(calls.filter((c) => c === 'GET /sim/clock').length).toBeGreaterThanOrEqual(3) // initial load + 2 polls
      expect(summaryFetches(calls)).toBe(1)
    })

    it('refetches when the tab becomes visible again and when the window is focused', async () => {
      const calls = await loaded()
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
      await waitFor(() => expect(summaryFetches(calls)).toBe(2))
      await act(async () => void window.dispatchEvent(new Event('focus')))
      await waitFor(() => expect(summaryFetches(calls)).toBe(3))
    })
  })

  it('moves the clock with the arrows then refetches the client data', async () => {
    const calls = installFetch()
    renderPage()
    await screen.findByText(/mercredi 4 mars 2026/)
    await userEvent.click(screen.getByRole('button', { name: 'Jour suivant' }))
    expect(await screen.findByText(/jeudi 5 mars 2026 · jour 3/)).toBeInTheDocument()
    expect(calls).toContain('PUT /sim/clock')
    expect(calls.filter((c) => c === 'GET /client/summary')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Jour précédent' }))
    expect(await screen.findByText(/mercredi 4 mars 2026 · jour 2/)).toBeInTheDocument()
  })

  it('maps a picked date to a working day', async () => {
    installFetch()
    renderPage()
    await screen.findByText(/mercredi 4 mars 2026/)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-07' } }) // Saturday
    expect(screen.getByText(/mercredi 4 mars 2026/)).toBeInTheDocument() // typing alone does not move the clock
    fireEvent.blur(picker)
    expect(await screen.findByText(/vendredi 6 mars 2026 · jour 4/)).toBeInTheDocument()
  })

  it('disables the arrows at both ends of the simulation', async () => {
    installFetch()
    renderPage()
    await screen.findByText(/mercredi 4 mars 2026/)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-02' } }) // the first day
    fireEvent.blur(picker)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jour précédent' })).toBeDisabled())
    fireEvent.change(picker, { target: { value: '2026-03-09' } }) // the last day
    fireEvent.keyDown(picker, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jour suivant' })).toBeDisabled())
  })

  it('keeps the dashboard and shows an error banner when a refetch fails', async () => {
    installFetch()
    renderPage()
    await screen.findByText(/mercredi 4 mars 2026/)
    // The clock move succeeds, then every client fetch fails with a 500.
    failClient = true
    await userEvent.click(screen.getByRole('button', { name: 'Jour suivant' }))
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(document.getElementById('rec-L1')).not.toBeNull()
    expect(screen.queryByText(/Aucune simulation en cours/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Jour suivant' })).toBeEnabled()
  })

  it('shows the error message, not the empty state, when the initial load fails with a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ detail: 'boom' }, 500)))
    renderPage()
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
    expect(screen.queryByText(/Aucune simulation en cours/)).toBeNull()
  })

  it('shows the error message when the initial load hits a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    renderPage()
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
  })

  it('shows a French message when there is no simulation, with a link to the dev page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ detail: 'no plan' }, 409)))
    renderPage()
    expect(await screen.findByText(/Aucune simulation en cours/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Aller à la page Dev' })).toHaveAttribute('href', '/dev')
  })

  describe('after a reset', () => {
    const summaryFetches = (calls: string[]) => calls.filter((c) => c === 'GET /client/summary').length

    it('refetches and shows the empty state with a link to /dev', async () => {
      const calls = installFetch()
      renderPage()
      await screen.findByText(/mercredi 4 mars 2026/)
      expect(summaryFetches(calls)).toBe(1)
      wasReset = true
      await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
      expect(await screen.findByText(/Aucune simulation en cours/)).toBeInTheDocument()
      expect(summaryFetches(calls)).toBe(2)
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
      expect(screen.queryByText('Impossible de charger les données.')).toBeNull()
      expect(screen.getByRole('link', { name: 'Aller à la page Dev' })).toHaveAttribute('href', '/dev')
    })

    it('loads the new simulation when a plan exists again', async () => {
      const calls = installFetch()
      renderPage()
      await screen.findByText(/mercredi 4 mars 2026/)
      await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
      await waitFor(() => expect(summaryFetches(calls)).toBe(2))
      expect(await screen.findByText(/mercredi 4 mars 2026/)).toBeInTheDocument()
    })
  })
})
