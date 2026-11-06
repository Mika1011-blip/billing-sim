import { render, screen } from '@testing-library/react'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientSummary } from '../../types'
import { SummaryTiles } from './SummaryTiles'

const lastDay = snapshot.summary as ClientSummary // two invoices Très en retard: 10 620 € late
const midRun = snapshot.mid.summary as ClientSummary // nothing late yet

// Collapse any kind of unicode space (narrow / no-break) to a plain one.
const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

describe('SummaryTiles', () => {
  it('renders the five tiles with fr-FR amounts', () => {
    render(<SummaryTiles summary={lastDay} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const tile = screen.getByText('Reste à payer').closest('li')!
    expect(plain(tile.textContent)).toContain('10 620 €')
    expect(screen.getAllByText('(TTC)')).toHaveLength(5)
    expect(screen.queryByText('(HT)')).toBeNull()
  })

  it('shows the contracted amount with VAT and its HT amount underneath', () => {
    render(<SummaryTiles summary={lastDay} />)
    const tile = screen.getByText('Contracté').closest('li')!
    expect(plain(tile.querySelector('.tile-value')!.textContent)).toBe('30 600 €')
    expect(plain(tile.textContent)).toContain('Contracté (TTC)')
    expect(plain(tile.textContent)).toContain('soit 25 500 € HT')
  })

  it('shows the late amount and the number of late invoices, in the danger style when > 0', () => {
    render(<SummaryTiles summary={lastDay} />)
    const late = screen.getByText('En retard').closest('li')!
    expect(late).toHaveClass('tile', 'danger')
    expect(plain(late.querySelector('.tile-value')!.textContent)).toBe('10 620 €')
    expect(late.querySelector('.tile-sub')).toHaveTextContent('2 factures')
  })

  it('has no danger style when nothing is late', () => {
    render(<SummaryTiles summary={midRun} />)
    const late = screen.getByText('En retard').closest('li')!
    expect(late).not.toHaveClass('danger')
    expect(late.querySelector('.tile-sub')).toHaveTextContent('0 facture')
  })
})
