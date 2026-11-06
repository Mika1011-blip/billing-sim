import { fr } from '../../i18n/fr'
import { fmtEuro } from '../../lib/format'
import type { ClientSummary } from '../../types'

export function SummaryTiles({ summary }: { summary: ClientSummary }) {
  const t = fr.summary
  // Every main figure is TTC; the contracted tile also shows its HT amount underneath.
  const tiles = [
    {
      label: t.contracted,
      basis: t.ttc,
      value: summary.contracte_ttc,
      sub: `${t.contractedHt} ${fmtEuro(summary.contracte)} ${t.htUnit}`,
      alert: false,
    },
    { label: t.invoiced, basis: t.ttc, value: summary.facture, sub: '', alert: false },
    { label: t.paid, basis: t.ttc, value: summary.paye, sub: '', alert: false },
    { label: t.remaining, basis: t.ttc, value: summary.reste_a_payer, sub: '', alert: false },
    { label: t.late, basis: t.ttc, value: summary.en_retard, sub: '', alert: summary.en_retard > 0 },
  ]
  return (
    <ul className="tiles" aria-label={t.title}>
      {tiles.map((tile) => (
        <li key={tile.label} className={tile.alert ? 'tile alert' : 'tile'}>
          <div className="tile-label">
            <span>{tile.label}</span> <small>{tile.basis}</small>
          </div>
          <div className="tile-value">{fmtEuro(tile.value)}</div>
          {tile.sub && <div className="tile-sub">{tile.sub}</div>}
        </li>
      ))}
    </ul>
  )
}
