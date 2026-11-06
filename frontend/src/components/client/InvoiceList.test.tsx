import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientInvoice, ClientPayment } from '../../types'
import { InvoiceList } from './InvoiceList'

// The last day of the snapshot (two Payée, two Très en retard) plus the mid view's À payer invoice.
const invoices = [...snapshot.invoices, snapshot.mid.invoices[1]] as ClientInvoice[]
const payments: ClientPayment[] = invoices.flatMap((inv) => (inv.paiement ? [{ ...inv.paiement, facture: inv.numero }] : []))
const rowOf = (numero: string) => document.getElementById(`rec-${numero}`)!

describe('InvoiceList', () => {
  it('renders one row per invoice with a pill equal to its statut', () => {
    render(<InvoiceList invoices={snapshot.invoices as ClientInvoice[]} payments={payments} />)
    for (const inv of snapshot.invoices) {
      expect(within(rowOf(inv.numero)).getByText(inv.statut)).toHaveClass('pill')
    }
  })

  it('colours each statut: Très en retard strong danger, Payée ok, À payer info', () => {
    render(<InvoiceList invoices={[invoices[2], invoices[0]]} payments={payments} />)
    expect(within(rowOf('F-2026-003')).getByText('Très en retard')).toHaveClass('pill-danger-strong')
    expect(within(rowOf('F-2026-001')).getByText('Payée')).toHaveClass('pill-ok')
  })

  it('shows the À payer pill of the mid view', () => {
    render(<InvoiceList invoices={[invoices[4]]} payments={[]} />)
    expect(within(rowOf('F-2026-002')).getByText('À payer')).toHaveClass('pill-info')
  })

  it('shows an empty message without invoices', () => {
    render(<InvoiceList invoices={[]} payments={[]} />)
    expect(screen.getByText('Aucune facture pour le moment.')).toBeInTheDocument()
  })

  it('opens a drawer with covered tickets and payments, and reports the selection', async () => {
    const onSelect = vi.fn()
    render(<InvoiceList invoices={invoices.slice(0, 4)} payments={payments} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'F-2026-001' }))
    expect(onSelect).toHaveBeenCalledWith('F-2026-001')
    const drawer = screen.getByRole('region', { name: 'Détail de la facture F-2026-001' })
    expect(within(drawer).getByText('BANK-1')).toBeInTheDocument()
    expect(within(drawer).getByText('VIR-F-2026-001-1')).toBeInTheDocument()
    expect(within(drawer).getByText('30/03/2026')).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
