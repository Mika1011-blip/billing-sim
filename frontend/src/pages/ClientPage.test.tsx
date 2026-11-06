import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { ClientPage, CLOCK_POLL_MS } from './ClientPage'

// Day 3 = Wednesday 2026-03-04; day 0 = Monday 2026-03-02.
const DATES = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09']
const LONG = ['lundi 2 mars 2026', 'mardi 3 mars 2026', 'mercredi 4 mars 2026', 'jeudi 5 mars 2026', 'vendredi 6 mars 2026', 'lundi 9 mars 2026']

const lot = {
  cle: 'L1', nom: 'Tableau de bord', description: 'Vue des factures', prix: 2000, livraison_prevue: '2026-03-06',
  livre_le: '2026-03-05', tickets_termines: 1, tickets_total: 1, jours_factures: 2, jours_reels: 3,
  approuve_le: null, statut_facture: 'À venir', facture: null,
}
const ticket = {
  cle: 'BANK-12', titre: 'Écran des factures', description: '', lot: 'L1', facture_separement: false, taille: 'M',
  jours_factures: 2, tjm: 1000, montant: 2000, statut: 'Terminé', assigne: 'Léa', debut_reel: '2026-03-02',
  fin_reel: '2026-03-05', jours_reels: 3,
}
const loose = { ...ticket, cle: 'BANK-99', titre: 'Correctif isolé', lot: null, facture_separement: true }
const invoice = {
  numero: 'F-2026-001', lot: 'L1', couvre: ['BANK-12'], emise_le: '2026-03-05', echeance: '2026-04-04',
  montant_ht: 2000, tva: 400, montant_ttc: 2400, paye: 0, reste: 2400, statut: 'Émise', en_retard: false,
}
const summary = { contracte: 2000, contracte_ttc: 2400, facture: 2400, paye: 0, reste_a_payer: 2400, en_retard: 0, lots: [lot] }

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', json: async () => body })

let failClient = false

let day = 2 // the backend clock; a test moves it to simulate /dev moving it

function installFetch() {
  day = 2
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (failClient && url.startsWith('/client/')) return reply({ detail: 'boom' }, 500)
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
  vi.unstubAllGlobals()
})

describe('ClientPage', () => {
  it('loads everything and renders the French dashboard with record anchors', async () => {
    installFetch()
    render(<ClientPage />)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      "Aujourd'hui : mercredi 4 mars 2026 · jour 2",
    )
    expect(screen.getByText('Reste à payer')).toBeInTheDocument()
    expect(screen.getByText('Lots à valider')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Posez une question…')).toBeInTheDocument()
    for (const id of ['rec-L1', 'rec-BANK-12', 'rec-BANK-99', 'rec-F-2026-001']) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
    // the ticket without a lot is listed on its own, the other one inside its lot card
    expect(within(document.getElementById('rec-L1')!).getByText('Écran des factures')).toBeInTheDocument()
    expect(within(document.getElementById('rec-L1')!).queryByText('Correctif isolé')).toBeNull()
  })

  it('sets the page language to French while mounted and restores it after', async () => {
    installFetch()
    document.documentElement.lang = 'en'
    const { unmount } = render(<ClientPage />)
    expect(document.documentElement.lang).toBe('fr')
    await screen.findByText(/mercredi 4 mars 2026/)
    unmount()
    expect(document.documentElement.lang).toBe('en')
  })

  describe('when the clock is moved elsewhere', () => {
    const summaryFetches = (calls: string[]) => calls.filter((c) => c === 'GET /client/summary').length

    async function loaded() {
      const calls = installFetch()
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) // promises and findBy keep running normally
      render(<ClientPage />)
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
    render(<ClientPage />)
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
    render(<ClientPage />)
    await screen.findByText(/mercredi 4 mars 2026/)
    const picker = screen.getByLabelText('Choisir une date')
    fireEvent.change(picker, { target: { value: '2026-03-07' } }) // Saturday
    expect(screen.getByText(/mercredi 4 mars 2026/)).toBeInTheDocument() // typing alone does not move the clock
    fireEvent.blur(picker)
    expect(await screen.findByText(/vendredi 6 mars 2026 · jour 4/)).toBeInTheDocument()
  })

  it('disables the arrows at both ends of the simulation', async () => {
    installFetch()
    render(<ClientPage />)
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
    render(<ClientPage />)
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
    render(<ClientPage />)
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
    expect(screen.queryByText(/Aucune simulation en cours/)).toBeNull()
  })

  it('shows the error message when the initial load hits a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    render(<ClientPage />)
    expect(await screen.findByText('Impossible de charger les données.')).toBeInTheDocument()
  })

  it('shows a French message when there is no simulation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ detail: 'no plan' }, 409)))
    render(<ClientPage />)
    expect(await screen.findByText(/Aucune simulation en cours/)).toBeInTheDocument()
  })
})
