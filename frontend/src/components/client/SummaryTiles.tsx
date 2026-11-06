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
      danger: false,
    },
    { label: t.invoiced, basis: t.ttc, value: summary.facture, sub: '', danger: false },
    { label: t.paid, basis: t.ttc, value: summary.paye, sub: '', danger: false },
    { label: t.remaining, basis: t.ttc, value: summary.reste_a_payer, sub: '', danger: false },
    {
      label: t.late,
      basis: t.ttc,
      value: summary.en_retard,
      sub: fr.alert.nombreFactures(summary.en_retard_nombre),
      danger: summary.en_retard > 0,
    },
  ]
  return (
    <ul className="tiles" aria-label={t.title}>
      {tiles.map((tile) => (
        <li key={tile.label} className={tile.danger ? 'tile danger' : 'tile'}>
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
