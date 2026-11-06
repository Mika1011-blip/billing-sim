import type { ClientTicket } from '../types'

const EURO_WHOLE = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
const EURO_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

/** `2 400 €`: fr-FR grouping (narrow no-break space), cents only when there are any. */
export const fmtEuro = (n: number) =>
  (Number.isInteger(n) ? EURO_WHOLE : EURO_CENTS).format(n)

/** `2026-03-02` -> `02/03/2026`; a missing date is a dash. */
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** `14,2`: a plain number with the French decimal comma, at most two decimals. */
export const fmtNumber = (n: number) => NUMBER.format(n)

/** `6,4 j`: a day count with the French decimal comma, glued to its unit by a no-break space. */
export const fmtDays = (n: number) => `${fmtNumber(n)} j`

/** A ticket's fixed price: `L → 5 j × 750 € = 3 750 €` (taille → jours facturés × TJM = montant). */
export const fmtCalcul = (t: Pick<ClientTicket, 'taille' | 'jours_factures' | 'tjm' | 'montant'>) =>
  `${t.taille} → ${fmtDays(t.jours_factures)} × ${fmtEuro(t.tjm)} = ${fmtEuro(t.montant)}`
