import { useState } from 'react'
import { fr } from '../../i18n/fr'
import { fmtDate, fmtEuro } from '../../lib/format'
import type { ClientInvoice, ClientPayment } from '../../types'
import { Pill } from './Pill'

interface Props {
  invoices: ClientInvoice[]
  payments: ClientPayment[]
  onSelect?: (numero: string) => void
}

export function InvoiceList({ invoices, payments, onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const t = fr.invoices
  const current = invoices.find((i) => i.numero === selected)

  if (invoices.length === 0) return <p className="empty">{t.empty}</p>

  return (
    <div className="invoice-list">
      <table>
        <thead>
          <tr>
            <th>{t.number}</th>
            <th>{t.lot}</th>
            <th>{t.issued}</th>
            <th>{t.due}</th>
            <th className="num">{t.ttc}</th>
            <th className="num">{t.paid}</th>
            <th className="num">{t.remaining}</th>
            <th>{t.status}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.numero} id={`rec-${inv.numero}`}>
              <td>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setSelected(inv.numero)
                    onSelect?.(inv.numero)
                  }}
                >
                  {inv.numero}
                </button>
              </td>
              <td>{inv.lot ?? '—'}</td>
              <td>{fmtDate(inv.emise_le)}</td>
              <td>{fmtDate(inv.echeance)}</td>
              <td className="num">{fmtEuro(inv.montant_ttc)}</td>
              <td className="num">{fmtEuro(inv.paye)}</td>
              <td className="num">{fmtEuro(inv.reste)}</td>
              <td>
                <Pill statut={inv.statut} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {current && (
        <section className="drawer" aria-label={`${t.drawerTitle} ${current.numero}`}>
          <div className="row">
            <h3>
              {t.drawerTitle} {current.numero}
            </h3>
            <button type="button" onClick={() => setSelected(null)}>
              {t.close}
            </button>
          </div>
          <p>
            {t.ht} {fmtEuro(current.montant_ht)} · {t.vat} {fmtEuro(current.tva)} · {t.ttc}{' '}
            {fmtEuro(current.montant_ttc)}
          </p>
          <h4>{t.covers}</h4>
          <ul>
            {current.couvre.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          <h4>{t.payments}</h4>
          <DrawerPayments payments={payments.filter((p) => p.facture === current.numero)} />
        </section>
      )}
    </div>
  )
}

function DrawerPayments({ payments }: { payments: ClientPayment[] }) {
  const t = fr.invoices
  if (payments.length === 0) return <p className="empty">{t.noPayments}</p>
  return (
    <table>
      <thead>
        <tr>
          <th>{t.paymentDate}</th>
          <th className="num">{t.paymentAmount}</th>
          <th>{t.paymentReference}</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={`${p.reference}-${p.date}`}>
            <td>{fmtDate(p.date)}</td>
            <td className="num">{fmtEuro(p.montant)}</td>
            <td>{p.reference}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
