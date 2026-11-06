import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientHistoryEntry, ClientInvoice } from '../../types'
import { InvoiceDetail } from './InvoiceDetail'

// Last day of the run: F-2026-001 (L1) paid on 30/03 with 0,74 j over the 5 j charged; F-2026-002 (L2) paid
// on 15/06, 3,12 j under; F-2026-003 (BANK-12, charged separately) and F-2026-004 (L3) unpaid, very late.
const invoices = snapshot.invoices as ClientInvoice[]
const byNumber = (n: string) => invoices.find((i) => i.numero === n)!
const l1 = byNumber('F-2026-001')
const l2 = byNumber('F-2026-002')
const separate = byNumber('F-2026-003')
const l3 = byNumber('F-2026-004')
const DAY = snapshot.day

// Collapse any kind of unicode space (narrow / no-break) to a plain one.
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ')

function setup(invoice: ClientInvoice, { onPay = vi.fn(async () => {}), revealKey = null as string | null } = {}) {
  const onClose = vi.fn()
  const view = render(
    <InvoiceDetail invoice={invoice} day={DAY} onClose={onClose} onPay={onPay} revealKey={revealKey} />,
  )
  return { ...view, onClose, onPay, dialog: screen.getByRole('dialog') }
}

/** The text of the section under the given heading. */
const section = (dialog: HTMLElement, heading: string) =>
  within(dialog).getByRole('heading', { name: heading }).closest('section')!

afterEach(() => vi.unstubAllGlobals())

describe('InvoiceDetail', () => {
  it('is a modal dialog labelled by its title: number, lot and lot name', () => {
    const { dialog } = setup(l2)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('F-2026-002 · Lot L2 — Suivi des paiements')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('F-2026-002 · Lot L2 — Suivi des paiements')
  })

  it('titles a separately charged invoice with its ticket', () => {
    const { dialog } = setup(separate)
    expect(dialog).toHaveAccessibleName('F-2026-003 · BANK-12 — Correctif urgent — calcul de TVA · facturée séparément')
  })

  it('shows the status pill and the due date under the title', () => {
    const { dialog } = setup(l3)
    const status = dialog.querySelector('.drawer-status')!
    expect(plain(status.textContent)).toBe(`Très en retard (${l3.jours_de_retard} j) · Échéance le 11/05/2026`)
    expect(status.querySelector('.pill-danger-strong')).not.toBeNull()
  })

  it('shows the delivery summary in client language', () => {
    const { dialog } = setup(l2)
    expect(section(dialog, 'Résumé de la livraison')).toHaveTextContent(l2.resume_livraison)
  })

  it('lists one collapsed ticket row per delivered ticket', () => {
    const { dialog } = setup(l2)
    const delivered = section(dialog, 'Ce qui a été livré')
    const rows = within(delivered).getAllByRole('button', { expanded: false })
    expect(rows.map((r) => r.textContent?.split(' · ')[0])).toEqual(['BANK-4', 'BANK-5', 'BANK-6', 'BANK-7'])
  })

  it('opens the ticket row a citation asked for', async () => {
    const history = snapshot.history['BANK-5'] as ClientHistoryEntry[]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: '', json: async () => history })))
    const { dialog } = setup(l2, { revealKey: 'BANK-5' })
    const row = within(dialog).getByRole('button', { name: /^BANK-5/ })
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(await within(dialog).findByText("En attente des accès à l'API bancaire")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^BANK-4/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the price of each ticket, the totals and the days', () => {
    const { dialog } = setup(l2)
    const calc = section(dialog, 'Calcul')
    const lines = [...calc.querySelectorAll('.calc-lines li')].map((li) => plain(li.textContent))
    expect(lines).toEqual([
      'BANK-4 XL → 10 j × 900 € = 9 000 € HT',
      'BANK-5 M → 3 j × 750 € = 2 250 € HT',
      'BANK-6 M → 3 j × 600 € = 1 800 € HT',
      'BANK-7 S → 1 j × 600 € = 600 € HT',
    ])
    expect(plain(calc.querySelector('.calc-totals')?.textContent)).toBe(
      'Total HT 13 650 € · TVA 20 % 2 730 € · Total TTC 16 380 €',
    )
    expect(plain(calc.querySelector('.calc-days')?.textContent)).toBe('Jours facturés 17 · jours réellement passés 13,88')
  })

  it('says the overrun is absorbed when more days were spent than charged', () => {
    const { dialog } = setup(l1) // 5 j charged, 5,74 j spent
    expect(section(dialog, 'Calcul')).toHaveTextContent(
      "L'écart de 0,74 j est absorbé par le prestataire : le prix du forfait ne change pas.",
    )
    expect(within(dialog).queryByText(/moins de jours que prévu/)).toBeNull()
  })

  it('says the price does not change either when fewer days were spent', () => {
    const { dialog } = setup(l2) // 17 j charged, 13,88 j spent
    expect(section(dialog, 'Calcul')).toHaveTextContent(
      'Le lot a demandé moins de jours que prévu : le prix du forfait ne change pas.',
    )
    expect(within(dialog).queryByText(/absorbé/)).toBeNull()
  })

  it('shows the payment date and reference of a paid invoice, and no pay button', () => {
    const { dialog } = setup(l2)
    expect(section(dialog, 'Paiement')).toHaveTextContent('Payée le 15/06/2026 (réf. VIR-F-2026-002-1)')
    expect(within(dialog).queryByRole('button', { name: 'Marquer comme payée' })).toBeNull()
  })

  it('pays an unpaid invoice from its pay button', async () => {
    const { dialog, onPay } = setup(l3)
    expect(within(section(dialog, 'Paiement')).queryByText(/^Payée le/)).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marquer comme payée' }))
    expect(onPay).toHaveBeenCalledWith('F-2026-004')
  })

  it('shows why a payment failed under the button', async () => {
    const onPay = vi.fn(async () => {
      throw new Error('Facture déjà payée le 02/04/2026')
    })
    const { dialog } = setup(l3, { onPay })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marquer comme payée' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Facture déjà payée le 02/04/2026')
    expect(within(dialog).getByRole('button', { name: 'Marquer comme payée' })).toBeEnabled()
  })

  it('focuses its close button when it opens', () => {
    setup(l2)
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus()
  })

  it('closes with the ✕ button, with Escape and on the backdrop', async () => {
    const { onClose, container } = setup(l2)
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(container.querySelector('.drawer-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps the focus inside while tabbing', async () => {
    setup(l3)
    const close = screen.getByRole('button', { name: 'Fermer' })
    const pay = screen.getByRole('button', { name: 'Marquer comme payée' })
    await userEvent.tab({ shift: true }) // from the first control backwards: the last one
    expect(pay).toHaveFocus()
    await userEvent.tab() // past the last one: back to the first
    expect(close).toHaveFocus()
  })

  it('locks the page scroll while open and restores it when closed', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = setup(l2)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })
})
