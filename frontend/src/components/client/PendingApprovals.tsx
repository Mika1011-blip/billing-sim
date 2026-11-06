import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientLot } from '../../types'

export function PendingApprovals({ lots }: { lots: ClientLot[] }) {
  const t = fr.approvals
  return (
    <section className="panel pending-approvals">
      <h2>{t.title}</h2>
      {lots.length === 0 ? (
        <p className="empty">{t.empty}</p>
      ) : (
        <ul>
          {lots.map((lot) => (
            <li key={lot.cle}>
              <strong>
                {lot.cle} · {lot.nom}
              </strong>{' '}
              ({t.deliveredOn} {fmtDate(lot.livre_le)}) · {fmtEuro(lot.prix)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
