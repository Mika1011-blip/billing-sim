import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientLot, ClientTicket } from '../../types'
import { LotsEnCours } from './LotsEnCours'

// Day 23: L1 and L2 are invoiced, L3 (BANK-8..11, 1/4 done) is not. Last day: every lot is invoiced.
const midLots = snapshot.mid.lots as ClientLot[]
const lastDayLots = snapshot.lots as ClientLot[]
const tickets = snapshot.tickets as ClientTicket[]

const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')
const reply = (body: unknown) => ({ ok: true, status: 200, statusText: '', json: async () => body })

afterEach(() => vi.unstubAllGlobals())

describe('LotsEnCours', () => {
  it('lists only the lots not invoiced yet, with delivery date, progress and amount to come', () => {
    render(<LotsEnCours lots={midLots} tickets={tickets} day={23} />)
    expect(screen.getByRole('heading', { name: 'Lots en cours' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    const lot = document.getElementById('rec-L3')!
    const text = plain(lot.textContent)
    expect(text).toContain('L3 · Exports et notifications')
    expect(text).toContain('livraison prévue le 07/04/2026')
    expect(text).toContain('1/4 tickets terminés')
    expect(text).toContain('montant HT à venir : 8 100 €')
    expect(document.getElementById('rec-L1')).toBeNull()
  })

  it('expands to the ticket rows of the lot', async () => {
    render(<LotsEnCours lots={midLots} tickets={tickets} day={23} />)
    const lot = document.getElementById('rec-L3')!
    expect(within(lot).getByText(/Alertes e-mail pour factures en retard/)).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Afficher les tickets' }))
    for (const key of ['BANK-8', 'BANK-9', 'BANK-10', 'BANK-11']) {
      expect(document.getElementById(`rec-${key}`), key).toBeVisible()
    }
    expect(document.getElementById('rec-BANK-1')).toBeNull()
    expect(screen.getByRole('button', { name: 'Masquer les tickets' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens when a citation reveals one of its tickets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply([])))
    render(<LotsEnCours lots={midLots} tickets={tickets} day={23} />)
    act(() => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: 'BANK-9' })))
    expect(document.getElementById('rec-BANK-9')).toBeVisible()
    expect(await screen.findByText('Aucun événement pour le moment.')).toBeInTheDocument() // the row's journal
  })

  it('is not rendered once every lot is invoiced', () => {
    const { container } = render(<LotsEnCours lots={lastDayLots} tickets={tickets} day={75} />)
    expect(container).toBeEmptyDOMElement()
  })
})
