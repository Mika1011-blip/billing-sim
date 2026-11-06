import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getClientApprovals,
  getClientInvoices,
  getClientLots,
  getClientPayments,
  getClientSummary,
  getClientTickets,
  getClientToday,
  getClock,
  setClock,
} from '../api'
import { Header } from '../components/client/Header'
import { InvoiceList } from '../components/client/InvoiceList'
import { LotCard } from '../components/client/LotCard'
import { PendingApprovals } from '../components/client/PendingApprovals'
import { SummaryTiles } from '../components/client/SummaryTiles'
import { TicketTable } from '../components/client/TicketTable'
import { fr } from '../i18n/fr'
import { dayForDate } from '../lib/workdays'
import type {
  ClientInvoice,
  ClientLot,
  ClientPayment,
  ClientSummary,
  ClientTicket,
  ClientToday,
} from '../types'

interface Loaded {
  lastDay: number
  today: ClientToday
  summary: ClientSummary
  lots: ClientLot[]
  tickets: ClientTicket[]
  invoices: ClientInvoice[]
  payments: ClientPayment[]
  approvals: ClientLot[]
}

async function fetchAll(): Promise<Loaded> {
  const [clock, today, summary, lots, tickets, invoices, payments, approvals] = await Promise.all([
    getClock(),
    getClientToday(),
    getClientSummary(),
    getClientLots(),
    getClientTickets(),
    getClientInvoices(),
    getClientPayments(),
    getClientApprovals(),
  ])
  return { lastDay: clock.last_day, today, summary, lots, tickets, invoices, payments, approvals }
}

export function ClientPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [message, setMessage] = useState<string>(fr.page.loading)
  const [error, setError] = useState('')
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++latest.current
    try {
      const loaded = await fetchAll()
      if (id === latest.current) {
        setData(loaded)
        setError('')
      }
    } catch {
      if (id !== latest.current) return
      setData(null)
      setMessage(fr.page.empty)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const previous = document.title
    document.title = fr.page.title
    return () => {
      document.title = previous
    }
  }, [])

  // The client view depends on the clock, so every move refetches everything.
  async function moveTo(day: number) {
    if (!data) return
    try {
      await setClock(Math.min(Math.max(day, 0), data.lastDay))
      await refresh()
    } catch {
      setError(fr.page.error)
    }
  }

  if (!data) {
    return (
      <main className="client-page">
        <p className="empty">{message}</p>
      </main>
    )
  }

  const { today, lastDay } = data
  const ticketsOf = (lotKey: string) => data.tickets.filter((t) => t.lot === lotKey)
  const unassigned = data.tickets.filter((t) => t.lot === null)

  return (
    <div className="client-layout">
      <main className="client-page">
        <Header
          today={today}
          lastDay={lastDay}
          onStep={(delta) => void moveTo(today.jour + delta)}
          onPickDate={(iso) => void moveTo(dayForDate(today, iso, lastDay))}
        />
        {error && <p className="error">{error}</p>}
        <SummaryTiles summary={data.summary} />
        <PendingApprovals lots={data.approvals} />
        <section className="panel">
          <h2>{fr.page.lotsTitle}</h2>
          {data.lots.map((lot) => (
            <LotCard key={lot.cle} lot={lot} tickets={ticketsOf(lot.cle)} />
          ))}
        </section>
        {unassigned.length > 0 && (
          <section className="panel">
            <h2>{fr.page.separateTicketsTitle}</h2>
            <TicketTable tickets={unassigned} />
          </section>
        )}
        <section className="panel">
          <h2>{fr.page.invoicesTitle}</h2>
          <InvoiceList invoices={data.invoices} payments={data.payments} />
        </section>
      </main>
      <aside className="assistant">{fr.page.assistantPlaceholder}</aside>
    </div>
  )
}
