import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
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
import { Assistant } from '../components/client/Assistant'
import { Header } from '../components/client/Header'
import { InvoiceList } from '../components/client/InvoiceList'
import { LotCard } from '../components/client/LotCard'
import { PendingApprovals } from '../components/client/PendingApprovals'
import { SummaryTiles } from '../components/client/SummaryTiles'
import { TicketTable } from '../components/client/TicketTable'
import { fr } from '../i18n/fr'
import { dayForDate } from '../lib/workdays'
import { useOnSimReset, useSimClock } from '../sim'
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
  const hasData = useRef(false)
  const shownDay = useRef<number | null>(null) // the clock day the dashboard was last loaded at

  const refresh = useCallback(async () => {
    const id = ++latest.current
    try {
      const loaded = await fetchAll()
      if (id !== latest.current) return
      hasData.current = true
      shownDay.current = loaded.today.jour
      setData(loaded)
      setError('')
    } catch (e) {
      if (id !== latest.current) return
      if (hasData.current) {
        // Keep the dashboard (and the header) so the user can retry.
        setError(fr.page.error)
        return
      }
      // Initial load: only "no scenario yet" (404/409) gets the empty-state message.
      const noSimulation = e instanceof ApiError && (e.status === 404 || e.status === 409)
      setMessage(noSimulation ? fr.page.empty : fr.page.error)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // A reset empties the backend: forget the dashboard so the refetch lands on the empty state, not an error banner.
  useOnSimReset(() => {
    hasData.current = false
    shownDay.current = null
    setData(null)
    setError('')
    setMessage(fr.page.loading)
    void refresh()
  })

  // The clock can be moved from /dev while this page is open: the numbers here must follow what the agent sees.
  // The shell polls the clock; the dashboard reloads when the polled day is not the one it was loaded at.
  const { clock: polledClock, reportClock } = useSimClock()
  useEffect(() => {
    if (polledClock && shownDay.current !== null && polledClock.day !== shownDay.current) void refresh()
  }, [polledClock, refresh])

  useEffect(() => {
    const visible = () => document.visibilityState !== 'hidden'
    const onShow = () => {
      if (visible() && hasData.current) void refresh()
    }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [refresh])

  // The client view depends on the clock, so every move refetches everything.
  async function moveTo(day: number) {
    if (!data) return
    try {
      const moved = await setClock(Math.min(Math.max(day, 0), data.lastDay))
      await refresh()
      reportClock(moved) // after the refresh, so the shell's badge moves without a second reload here
    } catch {
      setError(fr.page.error)
    }
  }

  if (!data) {
    return (
      <main className="client-page">
        <p className="empty">
          {message}
          {message === fr.page.empty && (
            <>
              {' '}
              <Link to="/dev">{fr.page.goToDev}</Link>
            </>
          )}
        </p>
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
      <aside className="assistant">
        <Assistant />
      </aside>
    </div>
  )
}
