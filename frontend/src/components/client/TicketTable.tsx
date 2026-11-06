import { fr } from '../../i18n/fr'
import { fmtEuro } from '../../lib/format'
import type { ClientTicket } from '../../types'

/** One row per ticket: `taille → jours × TJM = montant`, statut, jours réels. */
export function TicketTable({ tickets }: { tickets: ClientTicket[] }) {
  const t = fr.ticket
  return (
    <table className="tickets">
      <thead>
        <tr>
          <th>{t.ticket}</th>
          <th>{t.pricing}</th>
          <th>{t.status}</th>
          <th>{t.realDays}</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((tk) => (
          <tr key={tk.cle} id={`rec-${tk.cle}`}>
            <td>
              <strong>{tk.cle}</strong> {tk.titre}
              {tk.facture_separement && <small className="note"> · {t.separately}</small>}
            </td>
            <td>
              {tk.taille} → {tk.jours_factures} {t.daysUnit} × {fmtEuro(tk.tjm)} = {fmtEuro(tk.montant)}
            </td>
            <td>{tk.statut}</td>
            <td className="num">{tk.jours_reels}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
