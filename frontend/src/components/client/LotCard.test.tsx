import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LotCard } from './LotCard'
import type { ClientLot, ClientTicket } from '../../types'

const lot: ClientLot = {
  cle: 'L1', nom: 'Tableau de bord', description: 'Vue des factures', prix: 2000, livraison_prevue: '2026-03-06',
  livre_le: null, tickets_termines: 0, tickets_total: 1, jours_factures: 2, jours_reels: 1,
  approuve_le: null, statut_facture: 'À venir', facture: null,
}
const ticket: ClientTicket = {
  cle: 'BANK-12', titre: 'Écran des factures', description: '', lot: 'L1', facture_separement: false, taille: 'M',
  jours_factures: 2, tjm: 1000, montant: 2000, statut: 'En cours', assigne: 'Léa', debut_reel: '2026-03-02',
  fin_reel: null, jours_reels: 1,
}

describe('LotCard', () => {
  it('is collapsed by default and expands to the ticket table', async () => {
    render(<LotCard lot={lot} tickets={[ticket]} />)
    expect(document.getElementById('rec-L1')).not.toBeNull()
    expect(screen.queryByText('Écran des factures')).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Afficher les tickets' }))
    expect(screen.getByText('Écran des factures')).toBeVisible()
    const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')
    expect(plain(document.getElementById('rec-BANK-12')!.textContent)).toContain('M → 2 j × 1 000 € = 2 000 €')
    expect(screen.getByText('En cours')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Masquer les tickets' })).toBeInTheDocument()
  })

  it('shows the delivery state and the invoice statut', () => {
    render(<LotCard lot={lot} tickets={[]} />)
    expect(screen.getByText('À venir')).toHaveClass('pill')
    expect(screen.getByText(/Non livré/)).toBeInTheDocument()
  })
})
