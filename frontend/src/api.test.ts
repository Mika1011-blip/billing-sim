import { ApiError, getInvoice, getTicketHistory, payInvoice } from './api'
import snapshot from './test-fixtures/client-snapshot.json'

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', json: async () => body })

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply(body, status))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('client api', () => {
  it('reads one invoice and a ticket history from their routes', async () => {
    const invoice = snapshot.invoices[0]
    const fetchMock = stubFetch(invoice)
    expect(await getInvoice('F-2026-001')).toEqual(invoice)
    expect(fetchMock).toHaveBeenLastCalledWith('/client/invoices/F-2026-001', undefined)
    stubFetch(snapshot.history['BANK-5'])
    expect(await getTicketHistory('BANK-5')).toEqual(snapshot.history['BANK-5'])
  })

  it('pays an invoice with a POST and returns the payment', async () => {
    const paid = snapshot.invoices[0]
    const payment = { facture: paid.numero, ...paid.paiement }
    const fetchMock = stubFetch(payment)
    expect(await payInvoice('F-2026-001')).toEqual(payment)
    expect(fetchMock).toHaveBeenCalledWith('/client/invoices/F-2026-001/payer', { method: 'POST' })
  })

  it("keeps the backend's French detail on an error, e.g. an invoice already paid", async () => {
    stubFetch({ detail: 'Facture déjà payée le 30/03/2026' }, 409)
    const error = await payInvoice('F-2026-001').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, detail: 'Facture déjà payée le 30/03/2026' })
  })
})
