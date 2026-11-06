import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientInvoice } from '../../types'
import { InvoiceCard } from './InvoiceCard'

// Last day of the run: F-2026-001 paid on 30/03, F-2026-003 (BANK-12, charged separately) 39 j late,
// F-2026-004 (L3) 35 j late. Day 23 (`mid`): F-2026-002 (L2) is À payer with 32 days left.
const invoices = snapshot.invoices as ClientInvoice[]
const byNumber = (n: string) => invoices.find((i) => i.numero === n)!
const paid = byNumber('F-2026-001')
const separate = byNumber('F-2026-003')
const veryLate = byNumber('F-2026-004')
const toPay = (snapshot.mid.invoices as ClientInvoice[]).find((i) => i.numero === 'F-2026-002')!
// The snapshot has no invoice in the first overdue tier: F-2026-004 as it would read 12 days after its due date.
const late: ClientInvoice = { ...veryLate, statut: 'En retard', jours_de_retard: 12 }

const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

function setup(invoice: ClientInvoice, onPay = vi.fn(async () => {})) {
  const onOpen = vi.fn()
  render(<InvoiceCard invoice={invoice} onPay={onPay} onOpen={onOpen} />)
  return { onPay, onOpen, card: document.getElementById(`rec-${invoice.numero}`)! }
}

describe('InvoiceCard', () => {
  it('shows the number, lot name, amount TTC and dates', () => {
    const { card } = setup(veryLate)
    expect(card).not.toBeNull()
    const text = plain(card.textContent)
    expect(text).toContain('F-2026-004 · Exports et notifications')
    expect(text).toContain('9 720 € TTC')
    expect(text).toContain('Émise le 10/04/2026 · Échéance le 11/05/2026')
  })

  it('names a separately charged ticket by its title', () => {
    const { card } = setup(separate)
    expect(plain(card.textContent)).toContain('F-2026-003 · Correctif urgent — calcul de TVA · facturée séparément')
  })

  it.each([
    ['Très en retard', veryLate, 'Très en retard (35 j)', 'pill-danger-strong'],
    ['En retard', late, 'En retard (12 j)', 'pill-danger'],
    ['À payer', toPay, 'À payer (32 j restants)', 'pill-info'],
    ['Payée', paid, 'Payée le 30/03/2026', 'pill-ok'],
  ])('renders the %s status pill with its day count', (_, invoice, text, cls) => {
    setup(invoice)
    expect(screen.getByText(text)).toHaveClass('pill', cls)
  })

  it.each([
    [veryLate, true],
    [late, true],
    [toPay, true],
    [paid, false],
  ])('pay button follows paiement (%s)', (invoice, shown) => {
    setup(invoice)
    const button = screen.queryByRole('button', { name: 'Marquer comme payée' })
    if (shown) expect(button).toBeInTheDocument()
    else expect(button).toBeNull()
  })

  it('calls onPay with the number, without opening the detail', async () => {
    const { onPay, onOpen } = setup(veryLate)
    await userEvent.click(screen.getByRole('button', { name: 'Marquer comme payée' }))
    expect(onPay).toHaveBeenCalledExactlyOnceWith('F-2026-004')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens the detail when the card is clicked', async () => {
    const { onOpen, card } = setup(paid)
    await userEvent.click(within(card).getByText('Payée le 30/03/2026'))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('F-2026-001')
    await userEvent.click(screen.getByRole('button', { name: /F-2026-001/ }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('shows the failure message under the button and keeps the card as it was', async () => {
    const onPay = vi.fn(async () => {
      throw new Error('Facture déjà payée le 15/06/2026')
    })
    const { card } = setup(veryLate, onPay)
    await userEvent.click(screen.getByRole('button', { name: 'Marquer comme payée' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Facture déjà payée le 15/06/2026')
    expect(screen.getByRole('button', { name: 'Marquer comme payée' })).toBeEnabled()
    expect(screen.getByText('Très en retard (35 j)')).toBeInTheDocument()
  })

  it('disables the button while the payment is being recorded', async () => {
    let finish = () => {}
    const onPay = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    setup(toPay, onPay)
    const button = screen.getByRole('button', { name: 'Marquer comme payée' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onPay).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(button).toBeEnabled()
  })
})
