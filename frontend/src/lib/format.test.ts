import snapshot from '../test-fixtures/client-snapshot.json'
import type { ClientTicket } from '../types'
import { fmtCalcul, fmtDate, fmtDays, fmtEuro } from './format'

// Intl uses U+202F (narrow no-break space) as group separator and U+00A0 before the euro sign.
const NNBSP = ' '
const NBSP = ' '

describe('fmtEuro', () => {
  it('formats whole amounts in fr-FR with narrow no-break space grouping', () => {
    expect(fmtEuro(2400)).toBe(`2${NNBSP}400${NBSP}€`)
    expect(fmtEuro(1234567)).toBe(`1${NNBSP}234${NNBSP}567${NBSP}€`)
  })

  it('formats zero and small amounts', () => {
    expect(fmtEuro(0)).toBe(`0${NBSP}€`)
    expect(fmtEuro(950)).toBe(`950${NBSP}€`)
  })

  it('keeps cents when there are any', () => {
    expect(fmtEuro(1234.5)).toBe(`1${NNBSP}234,50${NBSP}€`)
  })
})

describe('fmtDate', () => {
  it('turns an ISO date into DD/MM/YYYY', () => {
    expect(fmtDate('2026-03-02')).toBe('02/03/2026')
  })

  it('shows a dash for a missing date', () => {
    expect(fmtDate(null)).toBe('—')
  })
})

describe('fmtDays', () => {
  it('writes days with a French decimal comma and a no-break space before "j"', () => {
    expect(fmtDays(6.4)).toBe(`6,4${NBSP}j`)
    expect(fmtDays(5)).toBe(`5${NBSP}j`)
    expect(fmtDays(1.82)).toBe(`1,82${NBSP}j`)
  })
})

describe('fmtCalcul', () => {
  it('renders "taille → jours × TJM = montant" for a ticket of the snapshot', () => {
    const bank8 = snapshot.tickets.find((t) => t.cle === 'BANK-8') as ClientTicket // L, 5 j at 750 €
    expect(fmtCalcul(bank8)).toBe(`L → 5${NBSP}j × 750${NBSP}€ = 3${NNBSP}750${NBSP}€`)
  })
})
