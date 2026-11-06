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
import { Assistant, invoiceHash, REVEAL_EVENT } from '../components/client/Assistant'
import { Header } from '../components/client/Header'
import { InvoiceDetail } from '../components/client/InvoiceDetail'
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

/** The invoice number the URL hash names (`#facture-F-2026-002`), if any. */
function hashInvoice(): string | null {
  const match = /^#facture-(.+)$/.exec(window.location.hash)
  return match ? decodeURIComponent(match[1]) : null
}

/** The invoice whose drawer shows a cited ticket or lot, unless the record is visible in *Lots en cours*. */
function invoiceFor(key: string, data: Loaded): ClientInvoice | undefined {
  const lot = data.lots.find((l) => l.cle === key)
  if (lot) return lot.facture === null ? undefined : data.invoices.find((i) => i.lot === key)
  const ticket = data.tickets.find((tk) => tk.cle === key)
  if (!ticket) return undefined
  const inProgress = ticket.lot !== null && data.lots.some((l) => l.cle === ticket.lot && l.facture === null)
  return inProgress ? undefined : data.invoices.find((i) => i.couvre.includes(key))
}

interface OpenInvoice {
  numero: string
  /** The ticket row to expand inside, when a citation of that ticket opened the drawer. */
  revealKey: string | null
}

export function ClientPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [message, setMessage] = useState<string>(fr.page.loading)
  const [error, setError] = useState('')
  const latest = useRef(0)
  const hasData = useRef(false)
  const shownDay = useRef<number | null>(null) // the clock day the dashboard was last loaded at
  // The invoice drawer follows the URL hash, so a citation link (or a reload) opens it too.
  const [open, setOpen] = useState<OpenInvoice | null>(() => {
    const numero = hashInvoice()
    return numero ? { numero, revealKey: null } : null
  })
  const opener = useRef<HTMLElement | null>(null) // where the focus goes back when the drawer closes
  const openRef = useRef(open) // the hash listener reads it without re-subscribing
  useEffect(() => {
    openRef.current = open
  })
  // Whether opening the drawer pushed the current history entry (a card, a citation link), as opposed to the page
  // being loaded with the hash: closing then goes back to the entry it came from instead of leaving a copy of it.
  const pushed = useRef(false)

  const closeInvoice = useCallback(() => {
    openRef.current = null
    setOpen(null)
    if (hashInvoice() === null) return
    if (pushed.current) {
      pushed.current = false
      window.history.back() // its hashchange finds no invoice: nothing left to do there
    } else {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
  }, [])

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
    closeInvoice() // the new simulation's invoices are other records, even under the same numbers
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

  const rememberOpener = () => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }

  function openInvoice(numero: string, revealKey: string | null = null) {
    rememberOpener()
    const next = { numero, revealKey }
    openRef.current = next // before the hashchange below arrives, so it reads as our own
    setOpen(next)
    if (hashInvoice() === numero) return
    if (hashInvoice() !== null) {
      window.location.replace(invoiceHash(numero)) // another invoice's entry: switch in place
    } else {
      pushed.current = true
      window.location.hash = invoiceHash(numero)
    }
  }

  // Back/forward, a citation link or a typed URL change the hash: the drawer follows.
  useEffect(() => {
    const onHash = () => {
      const numero = hashInvoice()
      if (numero && !openRef.current) {
        rememberOpener()
        pushed.current = true // a citation link (or Forward) put this entry on top of the page's own
      }
      if (!numero) pushed.current = false
      // Our own hash change names the open invoice: keep its row to reveal.
      setOpen((prev) => (prev?.numero === numero ? prev : numero ? { numero, revealKey: null } : null))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // A ticket or lot citation: once its lot is invoiced it is no longer in *Lots en cours*, so the drawer of the
  // invoice that covers it opens with the row expanded. Rows already on screen reveal themselves.
  useEffect(() => {
    if (!data) return
    const onReveal = (e: Event) => {
      const key = (e as CustomEvent<string>).detail
      const invoice = invoiceFor(key, data)
      if (invoice && invoice.numero !== open?.numero) openInvoice(invoice.numero, key)
      else if (!invoice && open) closeInvoice() // the record is on the page, under the drawer
    }
    window.addEventListener(REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(REVEAL_EVENT, onReveal)
  }, [data, open, closeInvoice]) // openInvoice only sets state and the hash: no stale value to miss

  const shown = open && data ? data.invoices.find((i) => i.numero === open.numero) : undefined

  // An invoice that is not (or no longer) visible as of today: forget it, hash included, so that a later refetch
  // where it is visible again does not pop the drawer open by itself.
  useEffect(() => {
    if (data && open && !shown) closeInvoice()
  }, [data, open, shown, closeInvoice])

  // Focus goes back where it was when the drawer opened: the card, or the citation link; else the card.
  const lastShown = useRef<string | null>(null)
  useEffect(() => {
    const was = lastShown.current
    lastShown.current = shown?.numero ?? null
    if (!was || shown) return
    const target = opener.current?.isConnected
      ? opener.current
      : document.getElementById(`rec-${was}`)?.querySelector<HTMLElement>('.invoice-card-title')
    opener.current = null
    target?.focus()
  }, [shown])

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
    <>
      <div className="client-layout" inert={shown !== undefined}>
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
            <InvoiceGallery invoices={data.invoices} onPay={pay} onOpen={(numero) => openInvoice(numero)} />
          </section>
          <LotsEnCours lots={data.lots} tickets={data.tickets} day={today.jour} />
          <PendingApprovals lots={data.approvals} />
        </main>
        <aside className="assistant">
          <Assistant />
        </aside>
      </div>
      {shown && (
        <InvoiceDetail
          key={shown.numero}
          invoice={shown}
          day={today.jour}
          onClose={closeInvoice}
          onPay={pay}
          revealKey={open?.revealKey}
        />
      )}
    </>
  )
}
