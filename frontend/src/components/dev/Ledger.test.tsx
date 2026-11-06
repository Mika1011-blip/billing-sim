import { render, screen, within } from '@testing-library/react'
import { Ledger } from './Ledger'
import type { Diff, Invoice, Payment } from '../../types'

const inv = (number: string, issued: number, ttc: number): Invoice => ({
  number,
  lot_key: 'L1',
  ticket_key: null,
  issued_day: issued,
  due_day: issued + 30,
  amount_ht: Math.round(ttc / 1.2),
  vat: ttc - Math.round(ttc / 1.2),
  amount_ttc: ttc,
  covers: [],
})

const invoices = [inv('F-001', 3, 1200), inv('F-002', 10, 600)]
const payments: Payment[] = [
  { invoice_number: 'F-001', day: 4, amount: 500, reference: 'VIR-1' },
  { invoice_number: 'F-001', day: 20, amount: 700, reference: 'VIR-2' },
]
const diff: Diff = {
  tickets: [],
  lots: [
    {
      key: 'L1',
      name: 'Lot one',
      planned_delivery_day: 8,
      real_delivery_day: 10,
      slip_days: 2,
      days_charged: 5,
      actual_days: 7,
    },
  ],
}

describe('Ledger', () => {
  it('marks only invoices issued after today as future', () => {
    render(<Ledger invoices={invoices} payments={payments} diff={diff} today={5} />)
    expect(screen.getByText('F-001').closest('tr')).not.toHaveClass('future')
    expect(screen.getByText('F-002').closest('tr')).toHaveClass('future')
  })

  it('does not mark an invoice issued exactly today as future', () => {
    render(<Ledger invoices={invoices} payments={payments} diff={diff} today={10} />)
    expect(screen.getByText('F-002').closest('tr')).not.toHaveClass('future')
  })

  it('computes paid and outstanding from payments made up to today', () => {
    render(<Ledger invoices={invoices} payments={payments} diff={diff} today={5} />)
    const cells = within(screen.getByText('F-001').closest('tr')!).getAllByRole('cell')
    // number, lot, issued, due, ttc, paid, outstanding
    expect(cells.map((c) => c.textContent)).toEqual(['F-001', 'L1', '3', '33', '1200', '500', '700'])
  })

  it('renders the plan-vs-real diff table', () => {
    render(<Ledger invoices={invoices} payments={payments} diff={diff} today={5} />)
    const row = screen.getByText('Lot one').closest('tr')!
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toContain('+2')
  })

  it('shows delivery days in the lot diff and never prints "undefined"', () => {
    const { container } = render(<Ledger invoices={invoices} payments={payments} diff={diff} today={5} />)
    const row = screen.getByText('Lot one').closest('tr')!
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(0, 3)).toEqual(['Lot one', '8', '10'])
    expect(container.textContent).not.toContain('undefined')
  })
})
