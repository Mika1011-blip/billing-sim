import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  getClientApprovals,
  getClientInvoices,
  getClientLots,
  getClientSummary,
  getClientTickets,
  getClientToday,
  getClock,
  payInvoice,
  setClock,
} from '../api'
import { AlertLine } from '../components/client/AlertLine'
import { Assistant } from '../components/client/Assistant'
import { Header } from '../components/client/Header'
import { InvoiceGallery } from '../components/client/InvoiceGallery'
import { LotsEnCours } from '../components/client/LotsEnCours'
import { PendingApprovals } from '../components/client/PendingApprovals'
import { SummaryTiles } from '../components/client/SummaryTiles'
import { fr } from '../i18n/fr'
import { dayForDate } from '../lib/workdays'
import { useOnSimReset, useSimClock } from '../sim'
import type { ClientInvoice, ClientLot, ClientSummary, ClientTicket, ClientToday } from '../types'

interface Loaded {
  lastDay: number
  today: ClientToday
  summary: ClientSummary
  lots: ClientLot[]
  tickets: ClientTicket[]
  invoices: ClientInvoice[]
  approvals: ClientLot[]
}

async function fetchAll(): Promise<Loaded> {
  const [clock, today, summary, lots, tickets, invoices, approvals] = await Promise.all([
    getClock(),
    getClientToday(),
    getClientSummary(),
    getClientLots(),
    getClientTickets(),
    getClientInvoices(),
    getClientApprovals(),
  ])
  return { lastDay: clock.last_day, today, summary, lots, tickets, invoices, approvals }
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

  // Paying changes the tiles, the alert line and the card: refetch everything. On failure the card keeps its
  // state and shows why under its button (a 409 carries the backend's French message).
  async function pay(numero: string) {
    try {
      await payInvoice(numero)
    } catch (e) {
      throw new Error(e instanceof ApiError && e.status === 409 && e.detail ? e.detail : fr.invoiceCard.payError)
    }
    await refresh()
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
        <AlertLine summary={data.summary} invoices={data.invoices} />
        {/* The invoice dashboard: invoices, then the lots still to invoice. */}
        <section className="panel invoices">
          <h2>{fr.invoiceCard.title}</h2>
          <InvoiceGallery invoices={data.invoices} onPay={pay} onOpen={() => {}} />
        </section>
        <LotsEnCours lots={data.lots} tickets={data.tickets} day={today.jour} />
        <PendingApprovals lots={data.approvals} />
      </main>
      <aside className="assistant">
        <Assistant />
      </aside>
    </div>
  )
}
