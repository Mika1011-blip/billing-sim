import { fmtDate, fmtEuro } from './format'

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
