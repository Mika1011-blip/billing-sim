import { render, screen } from '@testing-library/react'
import { SummaryTiles } from './SummaryTiles'
import type { ClientSummary } from '../../types'

const summary = (over: Partial<ClientSummary> = {}): ClientSummary => ({
  contracte: 10000,
  contracte_ttc: 12000,
  facture: 6000,
  paye: 3600,
  reste_a_payer: 2400,
  en_retard: 0,
  lots: [],
  ...over,
})

// Collapse any kind of unicode space (narrow / no-break) to a plain one.
const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

describe('SummaryTiles', () => {
  it('renders the five tiles with fr-FR amounts', () => {
    render(<SummaryTiles summary={summary()} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const tile = screen.getByText('Reste à payer').closest('li')!
    expect(plain(tile.textContent)).toContain('2 400 €')
    expect(screen.getAllByText('(TTC)')).toHaveLength(5)
    expect(screen.queryByText('(HT)')).toBeNull()
  })

  it('shows the contracted amount with VAT and its HT amount underneath', () => {
    render(<SummaryTiles summary={summary()} />)
    const tile = screen.getByText('Contracté').closest('li')!
    expect(plain(tile.querySelector('.tile-value')!.textContent)).toBe('12 000 €')
    expect(plain(tile.textContent)).toContain('Contracté (TTC)')
    expect(plain(tile.textContent)).toContain('soit 10 000 € HT')
  })

  it('marks the late tile with the alert class when en_retard > 0', () => {
    render(<SummaryTiles summary={summary({ en_retard: 1200 })} />)
    const late = screen.getByText('En retard').closest('li')!
    expect(late).toHaveClass('alert')
    expect(plain(late.textContent)).toContain('1 200 €')
  })

  it('has no alert class when nothing is late', () => {
    render(<SummaryTiles summary={summary()} />)
    expect(screen.getByText('En retard').closest('li')).not.toHaveClass('alert')
  })
})
