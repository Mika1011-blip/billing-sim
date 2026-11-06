import { render, screen } from '@testing-library/react'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientInvoice, ClientSummary } from '../../types'
import { AlertLine } from './AlertLine'

// Last day: two invoices Très en retard, none to pay, every lot invoiced (no prochaine_facture).
const lastDay = { summary: snapshot.summary as ClientSummary, invoices: snapshot.invoices as ClientInvoice[] }
// Day 23: nothing late, F-2026-002 to pay before 04/05/2026, L3 still to invoice.
const midRun = { summary: snapshot.mid.summary as ClientSummary, invoices: snapshot.mid.invoices as ClientInvoice[] }

const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')
const line = () => document.querySelector('.alert-line')

describe('AlertLine', () => {
  it('counts the overdue invoices', () => {
    render(<AlertLine {...lastDay} />)
    expect(plain(line()!.textContent)).toBe('⚠ 2 factures en retard')
  })

  it('gives the earliest due date of the invoices to pay, and the next invoice', () => {
    render(<AlertLine {...midRun} />)
    expect(screen.getByText('1 facture à payer avant le 04/05/2026')).toBeInTheDocument()
    expect(plain(screen.getByText(/^Prochaine facture/).textContent)).toBe(
      'Prochaine facture : L3 · Exports et notifications, prévue vers le 07/04/2026 (8 100 € HT)',
    )
  })

  it('joins the overdue count and the invoices to pay on one line', () => {
    const toPay = midRun.invoices.filter((i) => i.statut === 'À payer')
    render(<AlertLine summary={lastDay.summary} invoices={[...lastDay.invoices, ...toPay]} />)
    expect(screen.getByText('⚠ 2 factures en retard · 1 facture à payer avant le 04/05/2026')).toBeInTheDocument()
  })

  it('is not rendered when there is nothing to say', () => {
    const { container } = render(
      <AlertLine
        summary={{ ...midRun.summary, prochaine_facture: null }}
        invoices={midRun.invoices.filter((i) => i.statut === 'Payée')}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
