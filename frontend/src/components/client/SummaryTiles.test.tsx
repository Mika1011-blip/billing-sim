import { render, screen } from '@testing-library/react'
import { SummaryTiles } from './SummaryTiles'
import type { ClientSummary } from '../../types'

const summary = (over: Partial<ClientSummary> = {}): ClientSummary => ({
  contracte: 10000,
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
    expect(screen.getByText('Contracté')).toBeInTheDocument()
    expect(screen.getByText('(HT)')).toBeInTheDocument()
    expect(screen.getAllByText('(TTC)')).toHaveLength(4)
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
