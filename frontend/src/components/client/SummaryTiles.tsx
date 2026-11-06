import { fr } from '../../i18n/fr'
import { fmtEuro } from '../../lib/format'
import type { ClientSummary } from '../../types'

export function SummaryTiles({ summary }: { summary: ClientSummary }) {
  const t = fr.summary
  // `contracte` is before VAT; the other four amounts include it.
  const tiles = [
    { label: t.contracted, basis: t.ht, value: summary.contracte, alert: false },
    { label: t.invoiced, basis: t.ttc, value: summary.facture, alert: false },
    { label: t.paid, basis: t.ttc, value: summary.paye, alert: false },
    { label: t.remaining, basis: t.ttc, value: summary.reste_a_payer, alert: false },
    { label: t.late, basis: t.ttc, value: summary.en_retard, alert: summary.en_retard > 0 },
  ]
  return (
    <ul className="tiles" aria-label={t.title}>
      {tiles.map((tile) => (
        <li key={tile.label} className={tile.alert ? 'tile alert' : 'tile'}>
          <div className="tile-label">
            <span>{tile.label}</span> <small>{tile.basis}</small>
          </div>
          <div className="tile-value">{fmtEuro(tile.value)}</div>
        </li>
      ))}
    </ul>
  )
}
