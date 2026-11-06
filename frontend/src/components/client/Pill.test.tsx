import { render, screen } from '@testing-library/react'
import { Pill } from './Pill'

describe('Pill', () => {
  it.each([
    // invoices (and the lot's invoice statut)
    ['À payer', 'pill-info'],
    ['En retard', 'pill-danger'],
    ['Très en retard', 'pill-danger-strong'],
    ['Payée', 'pill-ok'],
    ['À venir', 'pill-a-venir'],
    // tickets
    ['Terminé', 'pill-termine'],
    ['Bloqué', 'pill-bloque'],
    ['En cours', 'pill-en-cours'],
    ['En revue', 'pill-en-revue'],
    ['À faire', 'pill-a-faire'],
  ])('shows %s with the class %s', (statut, cls) => {
    render(<Pill statut={statut} />)
    expect(screen.getByText(statut)).toHaveClass('pill', cls)
  })

  it('falls back to the neutral pill for an unknown statut', () => {
    render(<Pill statut="Autre" />)
    expect(screen.getByText('Autre').className).toBe('pill')
  })
})
