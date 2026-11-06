import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import type { ClientInvoice } from '../../types'
import { InvoiceGallery } from './InvoiceGallery'

// Last day: F-2026-001 and -002 Payée, F-2026-003 and -004 Très en retard. Day 23: F-2026-001 Payée, -002 À payer.
const lastDay = snapshot.invoices as ClientInvoice[]
const midRun = snapshot.mid.invoices as ClientInvoice[]

function setup(invoices: ClientInvoice[]) {
  const onPay = vi.fn(async () => {})
  const onOpen = vi.fn()
  render(<InvoiceGallery invoices={invoices} onPay={onPay} onOpen={onOpen} />)
  return { onPay, onOpen }
}

/** The numbers of the cards on screen, in display order. */
const shown = () => screen.queryAllByRole('article').map((card) => card.id.replace('rec-', ''))
const filter = (name: RegExp) => screen.getByRole('button', { name })

describe('InvoiceGallery', () => {
  it('shows every invoice, newest first, with the counts in the filter pills', () => {
    setup(lastDay)
    expect(shown()).toEqual(['F-2026-004', 'F-2026-003', 'F-2026-002', 'F-2026-001'])
    const pills = within(screen.getByRole('group', { name: 'Filtrer les factures' })).getAllByRole('button')
    expect(pills.map((p) => p.textContent)).toEqual(['Toutes (4)', 'À payer (0)', 'En retard (2)', 'Payées (2)'])
    expect(filter(/^Toutes/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('filters on a pill; En retard includes Très en retard', async () => {
    setup(lastDay)
    await userEvent.click(filter(/^En retard/))
    expect(shown()).toEqual(['F-2026-004', 'F-2026-003'])
    expect(filter(/^En retard/)).toHaveAttribute('aria-pressed', 'true')
    expect(filter(/^Toutes/)).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(filter(/^Payées/))
    expect(shown()).toEqual(['F-2026-002', 'F-2026-001'])
    await userEvent.click(filter(/^Toutes/))
    expect(shown()).toHaveLength(4)
  })

  it('says so when a filter matches no invoice', async () => {
    setup(lastDay)
    await userEvent.click(filter(/^À payer/))
    expect(shown()).toEqual([])
    expect(screen.getByText('Aucune facture pour ce filtre.')).toBeInTheDocument()
  })

  it('lists the invoices to pay mid-run', async () => {
    setup(midRun)
    expect(filter(/^À payer/)).toHaveTextContent('À payer (1)')
    await userEvent.click(filter(/^À payer/))
    expect(shown()).toEqual(['F-2026-002'])
  })

  it('passes the pay and open actions through the cards', async () => {
    const { onPay, onOpen } = setup(lastDay)
    const card = document.getElementById('rec-F-2026-003')!
    await userEvent.click(within(card).getByRole('button', { name: 'Marquer comme payée' }))
    expect(onPay).toHaveBeenCalledExactlyOnceWith('F-2026-003')
    await userEvent.click(within(card).getByRole('button', { name: /F-2026-003/ }))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('F-2026-003')
  })

  it('shows the empty state without filters when nothing is issued yet', () => {
    setup([])
    expect(screen.getByText('Aucune facture émise pour le moment.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Filtrer les factures' })).toBeNull()
  })
})
