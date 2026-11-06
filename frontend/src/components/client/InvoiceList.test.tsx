import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvoiceList } from './InvoiceList'
import type { ClientInvoice, ClientPayment } from '../../types'

const invoice = (over: Partial<ClientInvoice>): ClientInvoice => ({
  numero: 'F-2026-001',
  lot: 'L1',
  couvre: ['BANK-1', 'BANK-2'],
  emise_le: '2026-02-02',
  echeance: '2026-03-04',
  montant_ht: 2000,
  tva: 400,
  montant_ttc: 2400,
  paye: 0,
  reste: 2400,
  statut: 'Émise',
  en_retard: false,
  ...over,
})

const invoices = [
  invoice({}),
  invoice({ numero: 'F-2026-002', lot: 'L2', couvre: ['BANK-3'], statut: 'En retard', en_retard: true }),
  invoice({ numero: 'F-2026-003', lot: null, couvre: ['BANK-9'], statut: 'Payée', paye: 2400, reste: 0 }),
  invoice({ numero: 'F-2026-004', statut: 'Payée partiellement', paye: 1000, reste: 1400 }),
]
const payments: ClientPayment[] = [
  { date: '2026-03-01', montant: 1000, reference: 'VIR-77', facture: 'F-2026-004' },
]

describe('InvoiceList', () => {
  it('renders one row per invoice with a pill equal to its statut', () => {
    render(<InvoiceList invoices={invoices} payments={payments} />)
    for (const inv of invoices) {
      const row = document.getElementById(`rec-${inv.numero}`)!
      expect(row).not.toBeNull()
      expect(within(row).getByText(inv.statut)).toHaveClass('pill')
    }
  })

  it('gives the late invoice the pill-en-retard class', () => {
    render(<InvoiceList invoices={invoices} payments={payments} />)
    const row = document.getElementById('rec-F-2026-002')!
    expect(within(row).getByText('En retard')).toHaveClass('pill-en-retard')
    expect(within(document.getElementById('rec-F-2026-001')!).getByText('Émise')).not.toHaveClass('pill-en-retard')
  })

  it('shows an empty message without invoices', () => {
    render(<InvoiceList invoices={[]} payments={[]} />)
    expect(screen.getByText('Aucune facture pour le moment.')).toBeInTheDocument()
  })

  it('opens a drawer with covered tickets and payments, and reports the selection', async () => {
    const onSelect = vi.fn()
    render(<InvoiceList invoices={invoices} payments={payments} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'F-2026-004' }))
    expect(onSelect).toHaveBeenCalledWith('F-2026-004')
    const drawer = screen.getByRole('region', { name: 'Détail de la facture F-2026-004' })
    expect(within(drawer).getByText('BANK-1')).toBeInTheDocument()
    expect(within(drawer).getByText('VIR-77')).toBeInTheDocument()
    expect(within(drawer).getByText('01/03/2026')).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
