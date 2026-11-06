import { render, screen } from '@testing-library/react'
import { Pill } from './Pill'

describe('Pill', () => {
  it.each([
    ['Terminé', 'pill-termine'],
    ['Payée', 'pill-payee'],
    ['Bloqué', 'pill-bloque'],
    ['Payée partiellement', 'pill-payee-partiellement'],
    ['En retard', 'pill-en-retard'],
    ['En cours', 'pill-en-cours'],
    ['En revue', 'pill-en-revue'],
    ['Émise', 'pill-emise'],
    ['À faire', 'pill-a-faire'],
    ['À venir', 'pill-a-venir'],
  ])('shows %s with the class %s', (statut, cls) => {
    render(<Pill statut={statut} />)
    expect(screen.getByText(statut)).toHaveClass('pill', cls)
  })

  it('falls back to the neutral pill for an unknown statut', () => {
    render(<Pill statut="Autre" />)
    expect(screen.getByText('Autre').className).toBe('pill')
  })
})
