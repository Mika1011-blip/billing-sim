import { fr } from '../../i18n/fr'
import type { Diff, Invoice, Payment } from '../../types'

interface Props {
  invoices: Invoice[]
  payments: Payment[]
  diff: Diff
  today: number
}

const fmtDay = (d: number | null | undefined) => (d == null ? '—' : String(d))
const fmtSlip = (s: number | null) => (s === null ? '—' : s > 0 ? `+${s}` : String(s))

export function Ledger({ invoices, payments, diff, today }: Props) {
  const label = fr.dev.ledger
  const paidFor = (number: string) =>
    payments
      .filter((p) => p.invoice === number && p.day <= today)
      .reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="ledger">
      <h3>{label.invoices}</h3>
      <table>
        <thead>
          <tr>
            <th>{label.invoice}</th>
            <th>{label.lot}</th>
            <th className="num">{label.issued}</th>
            <th className="num">{label.due}</th>
            <th className="num">{label.ttc}</th>
            <th className="num">{label.paid}</th>
            <th className="num">{label.outstanding}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const paid = paidFor(inv.number)
            return (
              <tr key={inv.number} className={inv.issued_day > today ? 'future' : undefined}>
                <td>{inv.number}</td>
                <td>{inv.lot ?? inv.ticket ?? '—'}</td>
                <td className="num">{inv.issued_day}</td>
                <td className="num">{inv.due_day}</td>
                <td className="num">{inv.amount_ttc}</td>
                <td className="num">{paid}</td>
                <td className="num">{inv.amount_ttc - paid}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3>{label.lotsDiff}</h3>
      <table>
        <thead>
          <tr>
            <th>{label.lot}</th>
            <th className="num">{label.plannedDelivery}</th>
            <th className="num">{label.realDelivery}</th>
            <th className="num">{label.slip}</th>
            <th className="num">{label.daysCharged}</th>
            <th className="num">{label.actualDays}</th>
          </tr>
        </thead>
        <tbody>
          {diff.lots.map((l) => (
            <tr key={l.key}>
              <td>{l.name}</td>
              <td className="num">{fmtDay(l.planned_delivery_day)}</td>
              <td className="num">{fmtDay(l.real_delivery_day)}</td>
              <td className="num">{fmtSlip(l.slip_days)}</td>
              <td className="num">{l.days_charged}</td>
              <td className="num">{fmtDay(l.actual_days)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{label.ticketsDiff}</h3>
      <table>
        <thead>
          <tr>
            <th>{label.ticket}</th>
            <th>{label.lot}</th>
            <th>{label.assignee}</th>
            <th className="num">{label.planned}</th>
            <th className="num">{label.real}</th>
            <th className="num">{label.slip}</th>
            <th className="num">{label.daysCharged}</th>
            <th className="num">{label.actualDays}</th>
          </tr>
        </thead>
        <tbody>
          {diff.tickets.map((t) => (
            <tr key={t.key}>
              <td>{t.key}</td>
              <td>{t.lot ?? label.noLot}</td>
              <td>{t.assignee}</td>
              <td className="num">
                {fmtDay(t.planned_start)}–{fmtDay(t.planned_end)}
              </td>
              <td className="num">
                {fmtDay(t.real_start)}–{fmtDay(t.real_end)}
              </td>
              <td className="num">{fmtSlip(t.slip_days)}</td>
              <td className="num">{t.days_charged}</td>
              <td className="num">{fmtDay(t.actual_days)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
