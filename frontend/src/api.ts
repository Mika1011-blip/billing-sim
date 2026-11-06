import type {
  AgentTool,
  Clock,
  ClientInvoice,
  ClientLot,
  ClientPayment,
  ClientSummary,
  ClientTicket,
  ClientToday,
  Diff,
  GenerateBody,
  GenerateResult,
  Plan,
  Timeline,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new ApiError(`${init?.method ?? 'GET'} ${url} failed: ${res.status}`, res.status)
  return (await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Never throws on HTTP errors: 422/400/502 are expected outcomes the panel displays. */
export async function generate(body: GenerateBody): Promise<GenerateResult> {
  const res = await fetch('/setup/generate', json('POST', body))
  const data = await res.json().catch(() => ({}))
  if (res.ok) return data as GenerateResult
  if (res.status === 422) return { kind: 'rejected', reason: String(data.reason ?? 'rejected') }
  return {
    kind: 'error',
    status: res.status,
    detail: String(data.detail ?? res.statusText),
    raw: typeof data.raw === 'string' ? data.raw : undefined,
  }
}

export const getClock = () => request<Clock>('/sim/clock')
export const setClock = (day: number) => request<Clock>('/sim/clock', json('PUT', { day }))
export const stepClock = (n: number) => request<Clock>('/sim/step', json('POST', { n }))
export const resetSim = () => request<{ status: string }>('/sim/reset', { method: 'POST' })

export const getPlan = () => request<Plan>('/dev/plan')
export const getTimeline = (fromDay?: number, toDay?: number) => {
  const q = new URLSearchParams()
  if (fromDay !== undefined) q.set('from_day', String(fromDay))
  if (toDay !== undefined) q.set('to_day', String(toDay))
  const qs = q.toString()
  return request<Timeline>(`/dev/timeline${qs ? `?${qs}` : ''}`)
}
export const getDiff = () => request<Diff>('/dev/diff')
export const getAgentTools = () => request<AgentTool[]>('/dev/agent-tools')

export const getClientToday = () => request<ClientToday>('/client/today')
export const getClientSummary = () => request<ClientSummary>('/client/summary')
export const getClientLots = () => request<ClientLot[]>('/client/lots')
export const getClientTickets = () => request<ClientTicket[]>('/client/tickets')
export const getClientInvoices = () => request<ClientInvoice[]>('/client/invoices')
export const getClientPayments = () => request<ClientPayment[]>('/client/payments')
export const getClientApprovals = () => request<ClientLot[]>('/client/approvals/pending')
