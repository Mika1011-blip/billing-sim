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
