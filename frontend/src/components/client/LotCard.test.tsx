import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientLot, ClientTicket } from '../../types'
import { LotCard } from './LotCard'

const lot = snapshot.lots.find((l) => l.cle === 'L1') as ClientLot
const tickets = snapshot.tickets.filter((t) => t.lot === 'L1') as ClientTicket[] // BANK-1..3, all Terminé
const notDelivered = snapshot.mid.lots.find((l) => l.cle === 'L3') as ClientLot // À venir at day 23
const firstTitle = 'Filtres du tableau de bord' // BANK-1

describe('LotCard', () => {
  it('is collapsed by default and expands to the ticket table', async () => {
    render(<LotCard lot={lot} tickets={tickets} />)
    expect(document.getElementById('rec-L1')).not.toBeNull()
    expect(screen.queryByText(firstTitle)).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Afficher les tickets' }))
    expect(screen.getByText(firstTitle)).toBeVisible()
    const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')
    expect(plain(document.getElementById('rec-BANK-1')!.textContent)).toContain('M → 3 j × 600 € = 1 800 €')
    expect(screen.getAllByText('Terminé')[0]).toBeVisible()
    expect(screen.getByRole('button', { name: 'Masquer les tickets' })).toBeInTheDocument()
  })

  it('shows the delivery state and the invoice statut', () => {
    render(<LotCard lot={notDelivered} tickets={[]} />)
    expect(screen.getByText('À venir')).toHaveClass('pill')
    expect(screen.getByText(/Non livré/)).toBeInTheDocument()
  })

  it('expands when a citation asks to reveal one of its tickets or itself, and ignores other keys', () => {
    render(<LotCard lot={lot} tickets={tickets} />)
    const reveal = (key: string) => act(() => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: key })))
    reveal('BANK-5') // a ticket of L2
    expect(screen.getByText(firstTitle)).not.toBeVisible()
    reveal('BANK-1')
    expect(screen.getByText(firstTitle)).toBeVisible()
  })

  it('expands when its own key is revealed', () => {
    render(<LotCard lot={lot} tickets={tickets} />)
    act(() => void window.dispatchEvent(new CustomEvent('reveal-record', { detail: 'L1' })))
    expect(screen.getByText(firstTitle)).toBeVisible()
  })
})
