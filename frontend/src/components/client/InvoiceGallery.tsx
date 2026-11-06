import { useState } from 'react'
import { fr } from '../../i18n/fr'
import type { ClientInvoice } from '../../types'
import { InvoiceCard } from './InvoiceCard'

type Filter = 'toutes' | 'a_payer' | 'en_retard' | 'payees'

const FILTERS: { key: Filter; label: string; keep: (invoice: ClientInvoice) => boolean }[] = [
  { key: 'toutes', label: fr.invoiceCard.filters.toutes, keep: () => true },
  { key: 'a_payer', label: fr.invoiceCard.filters.aPayer, keep: (i) => i.statut === 'À payer' },
  {
    key: 'en_retard',
    label: fr.invoiceCard.filters.enRetard,
    keep: (i) => i.statut === 'En retard' || i.statut === 'Très en retard',
  },
  { key: 'payees', label: fr.invoiceCard.filters.payees, keep: (i) => i.statut === 'Payée' },
]

interface Props {
  invoices: ClientInvoice[]
  onPay: (numero: string) => Promise<void>
  onOpen: (numero: string) => void
}

/** The invoice cards, newest first, with the status filter pills above them. */
export function InvoiceGallery({ invoices, onPay, onOpen }: Props) {
  const t = fr.invoiceCard
  const [filter, setFilter] = useState<Filter>('toutes')

  if (invoices.length === 0) return <p className="empty">{t.empty}</p>

  const newestFirst = [...invoices].sort(
    (a, b) => b.emise_le.localeCompare(a.emise_le) || b.numero.localeCompare(a.numero),
  )
  const shown = newestFirst.filter(FILTERS.find((f) => f.key === filter)!.keep)

  return (
    <>
      <div className="filter-pills" role="group" aria-label={t.filtersLabel}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} ({invoices.filter(f.keep).length})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="empty">{t.emptyFilter}</p>
      ) : (
        <div className="invoice-grid">
          {shown.map((invoice) => (
            <InvoiceCard key={invoice.numero} invoice={invoice} onPay={onPay} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
  )
}
