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
  const paidFor = (number: string) =>
    payments
      .filter((p) => p.invoice === number && p.day <= today)
      .reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="ledger">
      <h3>Invoices</h3>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Lot</th>
            <th>Issued</th>
            <th>Due</th>
            <th>TTC</th>
            <th>Paid</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const paid = paidFor(inv.number)
            return (
              <tr key={inv.number} className={inv.issued_day > today ? 'future' : undefined}>
                <td>{inv.number}</td>
                <td>{inv.lot ?? inv.ticket ?? '—'}</td>
                <td>{inv.issued_day}</td>
                <td>{inv.due_day}</td>
                <td>{inv.amount_ttc}</td>
                <td>{paid}</td>
                <td>{inv.amount_ttc - paid}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3>Plan vs real: lots</h3>
      <table>
        <thead>
          <tr>
            <th>Lot</th>
            <th>Planned delivery</th>
            <th>Real delivery</th>
            <th>Slip (days)</th>
            <th>Days charged</th>
            <th>Actual days</th>
          </tr>
        </thead>
        <tbody>
          {diff.lots.map((l) => (
            <tr key={l.key}>
              <td>{l.name}</td>
              <td>{fmtDay(l.planned_delivery_day)}</td>
              <td>{fmtDay(l.real_delivery_day)}</td>
              <td>{fmtSlip(l.slip_days)}</td>
              <td>{l.days_charged}</td>
              <td>{fmtDay(l.actual_days)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Plan vs real: tickets</h3>
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Lot</th>
            <th>Assignee</th>
            <th>Planned</th>
            <th>Real</th>
            <th>Slip (days)</th>
            <th>Days charged</th>
            <th>Actual days</th>
          </tr>
        </thead>
        <tbody>
          {diff.tickets.map((t) => (
            <tr key={t.key}>
              <td>{t.key}</td>
              <td>{t.lot ?? 'no lot'}</td>
              <td>{t.assignee}</td>
              <td>
                {fmtDay(t.planned_start)}–{fmtDay(t.planned_end)}
              </td>
              <td>
                {fmtDay(t.real_start)}–{fmtDay(t.real_end)}
              </td>
              <td>{fmtSlip(t.slip_days)}</td>
              <td>{t.days_charged}</td>
              <td>{fmtDay(t.actual_days)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
