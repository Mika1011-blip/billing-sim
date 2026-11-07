import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell, CLOCK_POLL_MS } from '../components/AppShell'
import { SIM_RESET_EVENT } from '../sim'
import snapshot from '../test-fixtures/client-snapshot.json'
import type { ClientInvoice, ClientLot, ClientSummary } from '../types'
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
// `lastDay`: F-2026-001/-002 Payée, F-2026-003/-004 Très en retard, every lot invoiced.
// `midRun` (day 23): F-2026-001 Payée, F-2026-002 À payer, L3 not invoiced yet (prochaine_facture).
interface View {
  summary: ClientSummary
  lots: ClientLot[]
  invoices: ClientInvoice[]
}
const lastDay = snapshot as unknown as View
const midRun = snapshot.mid as unknown as View
const lot = snapshot.lots.find((l) => l.cle === 'L1')!

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', json: async () => body })

let failClient = false
let wasReset = false // the backend after POST /sim/reset: no clock, no client data
let view: View = lastDay // what the client routes answer
let payReply: { status: number; body: unknown } | null = null // null: POST …/payer pays, the refetch sees lastDay

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
      const paying = /^\/client\/invoices\/(.+)\/payer$/.exec(url)
      if (paying && init?.method === 'POST') {
        if (payReply) return reply(payReply.body, payReply.status)
        const paid = lastDay.invoices.find((i) => i.numero === paying[1])!
        view = lastDay // the refetch sees the invoice paid
        return reply({ facture: paid.numero, ...paid.paiement })
      }
      if (url === '/client/today') return reply({ jour: day, date: DATES[day], date_longue: LONG[day] })
      if (url === '/client/summary') return reply(view.summary)
      if (url === '/client/lots') return reply(view.lots)
      if (url === '/client/tickets') return reply(snapshot.tickets)
      if (url === '/client/invoices') return reply(view.invoices)
      const history = /^\/client\/tickets\/(.+)\/history$/.exec(url)
      if (history) return reply((snapshot.history as Record<string, unknown[]>)[history[1]] ?? [])
      if (url === '/client/approvals/pending') return reply([{ ...lot, statut_facture: 'À venir' }])
      return reply({}, 404)
    }),
  )
  return calls
}

const summaryFetches = (calls: string[]) => calls.filter((c) => c === 'GET /client/summary').length
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ')
/** Resolves once the page title shows this clock day. */
const shownDay = (n: number) => screen.findByRole('heading', { level: 1, name: new RegExp(`· jour ${n}$`) })

afterEach(() => {
  vi.useRealTimers()
  failClient = false
  wasReset = false
  view = lastDay
  payReply = null
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('ClientPage', () => {
  it('loads everything and renders the invoice dashboard', async () => {
    installFetch()
    renderPage()
    expect(await shownDay(2)).toHaveTextContent("Aujourd'hui : mercredi 4 mars 2026 · jour 2")
    expect(screen.getByRole('list', { name: 'Synthèse' })).toBeInTheDocument()
    expect(plain(document.querySelector('.alert-line')?.textContent)).toBe('⚠ 2 factures en retard')
    expect(screen.getByRole('heading', { name: 'Factures' })).toBeInTheDocument()
    for (const n of ['F-2026-001', 'F-2026-002', 'F-2026-003', 'F-2026-004']) {
      expect(document.getElementById(`rec-${n}`), n).not.toBeNull()
    }
    expect(screen.queryByRole('heading', { name: 'Lots en cours' })).toBeNull() // every lot is invoiced
    expect(screen.getByText('Lots à valider')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Posez une question…')).toBeInTheDocument()
    // the old flat sections are gone: tickets are reached through the invoices and Lots en cours
    expect(screen.queryByRole('heading', { name: 'Lots' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the alert line, the invoice to pay and the lots in progress mid-run', async () => {
    view = midRun
    installFetch()
    renderPage()
    await shownDay(2)
    expect(screen.getByText('1 facture à payer avant le 04/05/2026')).toBeInTheDocument()
    expect(screen.getByText(/^Prochaine facture : L3/)).toBeInTheDocument()
    expect(screen.getByText('À payer (32 j restants)')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lots en cours' })).toBeInTheDocument()
    expect(document.getElementById('rec-L3')).not.toBeNull()
  })

  describe('marking an invoice paid', () => {
    const card = () => document.getElementById('rec-F-2026-002')!
    const payButton = () => within(card()).getByRole('button', { name: 'Marquer comme payée' })
    const POST = 'POST /client/invoices/F-2026-002/payer'

    it('posts the payment, then refetches everything', async () => {
      view = midRun
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      expect(summaryFetches(calls)).toBe(1)
      await userEvent.click(payButton())
      expect(await within(card()).findByText('Payée le 15/06/2026')).toBeInTheDocument()
      expect(calls.indexOf(POST)).toBeGreaterThan(-1)
      expect(calls.indexOf(POST)).toBeLessThan(calls.lastIndexOf('GET /client/summary'))
      expect(summaryFetches(calls)).toBe(2)
      expect(calls.filter((c) => c === 'GET /client/invoices')).toHaveLength(2)
      expect(within(card()).queryByRole('button', { name: 'Marquer comme payée' })).toBeNull()
    })

    it('shows the backend message of a 409 under the button and keeps the card', async () => {
      view = midRun
      payReply = { status: 409, body: { detail: 'Facture déjà payée le 02/04/2026' } }
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      await userEvent.click(payButton())
      expect(await within(card()).findByRole('alert')).toHaveTextContent('Facture déjà payée le 02/04/2026')
      expect(within(card()).getByText('À payer (32 j restants)')).toBeInTheDocument()
      expect(payButton()).toBeEnabled()
      expect(calls).toContain(POST)
      // the card may be stale: a 409 refetches everything too
      await waitFor(() => expect(summaryFetches(calls)).toBe(2))
      expect(calls.filter((c) => c === 'GET /client/invoices')).toHaveLength(2)
    })

    it('shows the generic French message when the payment fails otherwise', async () => {
      view = midRun
      payReply = { status: 500, body: { detail: 'boom' } }
      installFetch()
      renderPage()
      await shownDay(2)
      await userEvent.click(payButton())
      expect(await within(card()).findByRole('alert')).toHaveTextContent("Le paiement n'a pas pu être enregistré.")
    })
  })

  describe('the invoice drawer', () => {
    const drawer = (name: RegExp) => screen.findByRole('dialog', { name })
    // A citation click comes long after the page loaded: let the mount effects (the listeners) run first, since
    // findBy resolves on the DOM change, before React flushes them.
    const reveal = async (key: string) => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
      await act(async () => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: key })))
    }

    it('opens on load when the URL hash names an invoice', async () => {
      window.history.replaceState(null, '', '/client#facture-F-2026-001')
      installFetch()
      renderPage()
      const dialog = await drawer(/^F-2026-001 · Lot L1/)
      expect(within(dialog).getByText('Payée le 30/03/2026 (réf. VIR-F-2026-001-1)')).toBeInTheDocument()
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('ignores a hash that names no visible invoice', async () => {
      window.history.replaceState(null, '', '/client#facture-F-2026-099')
      installFetch()
      renderPage()
      await shownDay(2)
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => expect(window.location.hash).toBe('')) // forgotten (passive effect): a refetch cannot pop it open
    })

    it('forgets an open invoice that is no longer visible after a refetch', async () => {
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      await userEvent.click(within(document.getElementById('rec-F-2026-004')!).getByRole('button', { name: /^F-2026-004/ }))
      await drawer(/^F-2026-004/)
      view = midRun // the clock moved back from /dev: F-2026-004 is not issued yet
      await act(async () => void window.dispatchEvent(new Event('focus')))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(window.location.hash).toBe(''))
      view = lastDay // and forward again: the drawer stays closed
      await act(async () => void window.dispatchEvent(new Event('focus')))
      await waitFor(() => expect(summaryFetches(calls)).toBe(3))
      expect(await screen.findByText(/^F-2026-004/)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    describe('history', () => {
      // Mark the entry the page was loaded on: Back from the page must land before it.
      const loadedOn = (url: string) => window.history.replaceState({ mark: 'loaded' }, '', url)
      const onLoadedEntry = () =>
        waitFor(() => expect((window.history.state as { mark?: string } | null)?.mark).toBe('loaded'))

      it('leaves no history entry behind once a drawer opened from a card is closed', async () => {
        loadedOn('/client')
        const before = window.history.length
        installFetch()
        renderPage()
        await shownDay(2)
        for (const numero of ['F-2026-004', 'F-2026-003']) {
          await userEvent.click(within(document.getElementById(`rec-${numero}`)!).getByRole('button', { name: new RegExp(`^${numero}`) }))
          await drawer(new RegExp(`^${numero}`))
          expect(window.location.hash).toBe(`#facture-${numero}`)
          await userEvent.keyboard('{Escape}')
          await onLoadedEntry() // closing went back to the entry the drawer pushed onto
          expect(window.location.hash).toBe('')
          expect(screen.queryByRole('dialog')).toBeNull()
        }
        // Each opening reuses the one entry above the page's (jsdom may or may not still count it after Back);
        // a close that only rewrote the entry would leave one more per cycle.
        expect(window.history.length).toBeLessThanOrEqual(before + 1)
      })

      it('closes in place a drawer opened by the URL it was loaded with', async () => {
        loadedOn('/client#facture-F-2026-001')
        const before = window.history.length
        installFetch()
        renderPage()
        await userEvent.click(within(await drawer(/^F-2026-001/)).getByRole('button', { name: 'Fermer' }))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(window.location.hash).toBe('')
        expect(window.history.length).toBe(before)
        await onLoadedEntry() // the same entry, rewritten without the hash
      })

      it('closes when Back is pressed', async () => {
        loadedOn('/client')
        installFetch()
        renderPage()
        await shownDay(2)
        const cardButton = within(document.getElementById('rec-F-2026-003')!).getByRole('button', { name: /^F-2026-003/ })
        await userEvent.click(cardButton)
        await drawer(/^F-2026-003/)
        await act(async () => window.history.back())
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await onLoadedEntry()
        expect(cardButton).toHaveFocus()
      })
    })

    it('opens from a card, sets the hash, and Escape closes it, clears the hash and refocuses the card', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      const card = document.getElementById('rec-F-2026-004')!
      const cardButton = within(card).getByRole('button', { name: /^F-2026-004/ })
      await userEvent.click(cardButton)
      const dialog = await drawer(/^F-2026-004 · Lot L3/)
      expect(window.location.hash).toBe('#facture-F-2026-004')
      expect(within(dialog).getByRole('button', { name: 'Fermer' })).toHaveFocus()
      expect(document.body.style.overflow).toBe('hidden')
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('')
      expect(cardButton).toHaveFocus()
      expect(document.body.style.overflow).toBe('')
    })

    it('closes with ✕ and refocuses the card', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      const cardButton = within(document.getElementById('rec-F-2026-003')!).getByRole('button', { name: /^F-2026-003/ })
      await userEvent.click(cardButton)
      await userEvent.click(within(await drawer(/^F-2026-003/)).getByRole('button', { name: 'Fermer' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('')
      expect(cardButton).toHaveFocus()
    })

    it('opens when the hash changes, as an invoice citation link does', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      await act(async () => {
        window.location.hash = 'facture-F-2026-003'
        await new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }))
      })
      expect(await drawer(/^F-2026-003 · BANK-12/)).toBeInTheDocument()
    })

    it('pays from the drawer and shows the new payment after the refetch', async () => {
      view = midRun
      const calls = installFetch()
      window.history.replaceState(null, '', '/client#facture-F-2026-002')
      renderPage()
      const dialog = await drawer(/^F-2026-002/)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Marquer comme payée' }))
      expect(await within(dialog).findByText('Payée le 15/06/2026 (réf. VIR-F-2026-002-1)')).toBeInTheDocument()
      expect(calls).toContain('POST /client/invoices/F-2026-002/payer')
      expect(summaryFetches(calls)).toBe(2)
      expect(within(dialog).queryByRole('button', { name: 'Marquer comme payée' })).toBeNull()
    })

    it('opens the invoice that covers a cited ticket whose lot is invoiced, with its row expanded', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      await reveal('BANK-5')
      const dialog = await drawer(/^F-2026-002 · Lot L2/)
      expect(window.location.hash).toBe('#facture-F-2026-002')
      expect(within(dialog).getByRole('button', { name: /^BANK-5/ })).toHaveAttribute('aria-expanded', 'true')
      expect(await within(dialog).findByText("En attente des accès à l'API bancaire")).toBeInTheDocument()
    })

    it('opens the invoice of a cited separately charged ticket, and of a cited invoiced lot', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      await reveal('BANK-12')
      expect(await drawer(/^F-2026-003 · BANK-12/)).toBeInTheDocument()
      await reveal('L1')
      expect(await drawer(/^F-2026-001 · Lot L1/)).toBeInTheDocument()
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('leaves a cited ticket of a lot in progress to Lots en cours', async () => {
      view = midRun
      installFetch()
      renderPage()
      await shownDay(2)
      await reveal('BANK-9')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.getElementById('rec-BANK-9')).toBeVisible()
    })
  })

  describe('the Chronologie and Factures tabs', () => {
    const VIEW_KEY = 'billing-sim.client.view'
    const tab = (name: string) => screen.getByRole('tab', { name })
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0))) // lets the history fetches land
    afterEach(() => {
      vi.restoreAllMocks()
      localStorage.clear()
    })

    it('opens on Factures, and switching keeps the tiles, the alert line and the approvals', async () => {
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      expect(screen.getByRole('tablist').textContent).toBe('ChronologieFactures')
      expect(tab('Factures')).toHaveAttribute('aria-selected', 'true')
      expect(tab('Chronologie')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tabpanel', { name: 'Factures' })).toBeInTheDocument()
      await userEvent.click(tab('Chronologie'))
      expect(tab('Chronologie')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel', { name: 'Chronologie' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Synthèse' })).toBeInTheDocument()
      expect(document.querySelector('.alert-line')).not.toBeNull()
      expect(screen.getByText('Lots à valider')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Avancement' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Factures' })).toBeNull()
      expect(document.getElementById('rec-F-2026-001')).toBeNull()
      expect(localStorage.getItem(VIEW_KEY)).toBe('chronologie')
      await settle()
      expect(calls).toContain('GET /client/tickets/BANK-1/history') // started on 02/03, before today (04/03)
      expect(calls).not.toContain('GET /client/tickets/BANK-2/history') // its record starts after today
      await userEvent.click(tab('Factures'))
      expect(screen.getByRole('heading', { name: 'Factures' })).toBeInTheDocument()
      expect(localStorage.getItem(VIEW_KEY)).toBe('factures')
    })

    it('restores the tab saved in localStorage', async () => {
      localStorage.setItem(VIEW_KEY, 'chronologie')
      installFetch()
      renderPage()
      await shownDay(2)
      expect(tab('Chronologie')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('heading', { name: 'Avancement' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /^Terminé \(\d+\)$/ })).toBeInTheDocument()
      await settle()
    })

    it('falls back to Factures when localStorage is unavailable', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied')
      })
      installFetch()
      renderPage()
      await shownDay(2)
      expect(tab('Factures')).toHaveAttribute('aria-selected', 'true')
      await userEvent.click(tab('Chronologie'))
      expect(tab('Chronologie')).toHaveAttribute('aria-selected', 'true')
      await settle()
    })

    it('moves between the tabs with the arrow keys', async () => {
      installFetch()
      renderPage()
      await shownDay(2)
      tab('Factures').focus()
      await userEvent.keyboard('{ArrowLeft}')
      expect(tab('Chronologie')).toHaveAttribute('aria-selected', 'true')
      expect(tab('Chronologie')).toHaveFocus()
      await userEvent.keyboard('{ArrowRight}')
      expect(tab('Factures')).toHaveFocus()
      expect(tab('Factures')).toHaveAttribute('aria-selected', 'true')
      await settle()
    })

    it('reveals a cited ticket in the Chronologie lists instead of opening its invoice', async () => {
      localStorage.setItem(VIEW_KEY, 'chronologie')
      installFetch()
      renderPage()
      await shownDay(2)
      await settle()
      await act(async () => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: 'BANK-5' })))
      expect(screen.queryByRole('dialog')).toBeNull()
      const row = within(document.getElementById('rec-BANK-5')!).getByRole('button', { name: /^BANK-5/ })
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(await screen.findByText("En attente des accès à l'API bancaire")).toBeInTheDocument()
      // an invoice citation still opens the drawer from this tab
      await act(async () => {
        window.location.hash = 'facture-F-2026-001'
        await new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }))
      })
      expect(await screen.findByRole('dialog', { name: /^F-2026-001/ })).toBeInTheDocument()
    })
  })

  describe('when the clock is moved elsewhere', () => {
    async function loaded() {
      const calls = installFetch()
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) // promises and findBy keep running normally
      renderInShell() // the shell polls the clock; the page refetches when the polled day differs from its own
      await shownDay(2)
      return calls
    }

    const tick = () => act(async () => void vi.advanceTimersByTime(CLOCK_POLL_MS))

    it('refetches once when the polled clock day changed, and shows the new date', async () => {
      const calls = await loaded()
      expect(summaryFetches(calls)).toBe(1)
      day = 4 // moved from /dev
      await tick()
      expect(await shownDay(4)).toHaveTextContent('vendredi 6 mars 2026')
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
      // A refresh starts all its fetches at once: they are recorded as soon as the event is handled.
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
      expect(summaryFetches(calls)).toBe(2)
      await act(async () => void window.dispatchEvent(new Event('focus')))
      expect(summaryFetches(calls)).toBe(3)
    })
  })

  it('moves the clock with the arrows then refetches the client data', async () => {
    const calls = installFetch()
    renderPage()
    await shownDay(2)
    await userEvent.click(screen.getByRole('button', { name: 'Jour suivant' }))
    expect(await shownDay(3)).toHaveTextContent('jeudi 5 mars 2026')
    expect(calls).toContain('PUT /sim/clock')
    expect(summaryFetches(calls)).toBe(2)
    await userEvent.click(screen.getByRole('button', { name: 'Jour précédent' }))
    expect(await shownDay(2)).toHaveTextContent('mercredi 4 mars 2026')
  })

  it('maps a picked date to a working day', async () => {
    installFetch()
    renderPage()
    await shownDay(2)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-07' } }) // Saturday
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('mercredi 4 mars 2026') // typing alone does not move the clock
    fireEvent.blur(picker)
    expect(await shownDay(4)).toHaveTextContent('vendredi 6 mars 2026')
  })

  it('disables the arrows at both ends of the simulation', async () => {
    installFetch()
    renderPage()
    await shownDay(2)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-02' } }) // the first day
    fireEvent.blur(picker)
    await shownDay(0)
    expect(screen.getByRole('button', { name: 'Jour précédent' })).toBeDisabled()
    fireEvent.change(picker, { target: { value: '2026-03-09' } }) // the last day
    fireEvent.keyDown(picker, { key: 'Enter' })
    await shownDay(5)
    expect(screen.getByRole('button', { name: 'Jour suivant' })).toBeDisabled()
  })

  it('keeps a date typed the moment the previous move lands', async () => {
    // Go on as soon as the new day is in the DOM, before React runs its deferred effects:
    // the date typed then must not be overwritten by the day that just loaded.
    const committed = (n: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (screen.queryByRole('heading', { level: 1 })?.textContent?.endsWith(`jour ${n}`)) {
            observer.disconnect()
            resolve()
          }
        }
        const observer = new MutationObserver(check)
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
        check()
      })
    installFetch()
    renderPage()
    await shownDay(2)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-02' } })
    fireEvent.blur(picker)
    await committed(0)
    fireEvent.change(picker, { target: { value: '2026-03-09' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(await shownDay(5)).toBeInTheDocument()
  })

  it('keeps the dashboard and shows an error banner when a refetch fails', async () => {
    installFetch()
    renderPage()
    await shownDay(2)
    // The clock move succeeds, then every client fetch fails with a 500.
    failClient = true
    await userEvent.click(screen.getByRole('button', { name: 'Jour suivant' }))
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(document.getElementById('rec-F-2026-001')).not.toBeNull()
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
    it('refetches and shows the empty state with a link to /dev', async () => {
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      expect(summaryFetches(calls)).toBe(1)
      wasReset = true
      await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
      expect(await screen.findByText(/Aucune simulation en cours/)).toBeInTheDocument()
      expect(summaryFetches(calls)).toBe(2)
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
      expect(screen.queryByText('Impossible de charger les données.')).toBeNull()
      expect(screen.getByRole('link', { name: 'Aller à la page Dev' })).toHaveAttribute('href', '/dev')
    })

    it('closes the invoice drawer and clears its hash', async () => {
      window.history.replaceState(null, '', '/client#facture-F-2026-001')
      installFetch()
      renderPage()
      await screen.findByRole('dialog')
      await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
      expect(await shownDay(2)).toBeInTheDocument() // the new simulation has an F-2026-001 too
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('')
    })

    it('loads the new simulation when a plan exists again', async () => {
      const calls = installFetch()
      renderPage()
      await shownDay(2)
      await act(async () => void window.dispatchEvent(new Event(SIM_RESET_EVENT)))
      expect(summaryFetches(calls)).toBe(2) // the refresh starts its fetches as the event is handled
      expect(await shownDay(2)).toBeInTheDocument()
    })
  })
})
