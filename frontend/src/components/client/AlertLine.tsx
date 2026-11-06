import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientInvoice, ClientSummary } from '../../types'

interface Props {
  summary: ClientSummary
  invoices: ClientInvoice[]
}

/** What the client has to do: late invoices, invoices to pay before the earliest due date, the next invoice. */
export function AlertLine({ summary, invoices }: Props) {
  const t = fr.alert
  const toPay = invoices.filter((i) => i.statut === 'À payer')
  const firstDue = toPay.map((i) => i.echeance_le).sort()[0]

  const todo: string[] = []
  if (summary.en_retard_nombre > 0) todo.push(t.enRetard(summary.en_retard_nombre))
  if (toPay.length > 0) todo.push(t.aPayerAvant(toPay.length, fmtDate(firstDue)))
  const next = summary.prochaine_facture

  if (todo.length === 0 && !next) return null

  return (
    <div className="alert-line">
      {todo.length > 0 && <p className={summary.en_retard_nombre > 0 ? 'danger' : undefined}>{todo.join(' · ')}</p>}
      {next && (
        <p className="alert-next">
          {t.prochaineFacture(next.lot, next.nom, fmtDate(next.date_prevue), fmtEuro(next.montant_ht))}
        </p>
      )}
    </div>
  )
}
