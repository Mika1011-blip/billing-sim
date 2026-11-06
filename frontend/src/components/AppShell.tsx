import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ApiError, getClock, resetSim } from '../api'
import { fr } from '../i18n/fr'
import { fmtDate } from '../lib/format'
import { SIM_RESET_EVENT, SimClockContext } from '../sim'
import type { Clock } from '../types'

/** How often the shell asks the backend whether the clock was moved elsewhere (the other page, another tab). */
export const CLOCK_POLL_MS = 5000

const sameClock = (a: Clock | null, b: Clock | null) =>
  a === b || (!!a && !!b && a.day === b.day && a.last_day === b.last_day && a.date === b.date)

/** Top bar (brand, Dev/Client nav, clock badge, reset) around both pages; the only clock poll in the app. */
export function AppShell() {
  const t = fr.shell
  const [clock, setClockState] = useState<Clock | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Keep the previous object when nothing changed, so pages watching the clock only react to a real move.
  const reportClock = useCallback((next: Clock | null) => {
    setClockState((prev) => (sameClock(prev, next) ? prev : next))
  }, [])

  const loadClock = useCallback(async () => {
    try {
      reportClock(await getClock())
    } catch (e) {
      // 404: no simulation, so no badge. Anything else (offline, restarting): keep the last one, retry next tick.
      if (e instanceof ApiError && e.status === 404) reportClock(null)
    }
  }, [reportClock])

  useEffect(() => {
    const previous = document.title
    const previousLang = document.documentElement.lang
    document.title = fr.page.title
    document.documentElement.lang = 'fr'
    return () => {
      document.title = previous
      document.documentElement.lang = previousLang
    }
  }, [])

  useEffect(() => {
    void loadClock()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadClock()
    }, CLOCK_POLL_MS)
    return () => clearInterval(timer)
  }, [loadClock])

  async function reset() {
    if (!window.confirm(t.resetConfirm)) return
    setBusy(true)
    setError('')
    try {
      await resetSim()
      reportClock(null)
      window.dispatchEvent(new Event(SIM_RESET_EVENT))
      void loadClock()
    } catch {
      setError(t.resetError)
    } finally {
      setBusy(false)
    }
  }

  const context = useMemo(() => ({ clock, reportClock }), [clock, reportClock])
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')

  return (
    <SimClockContext.Provider value={context}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">{t.brand}</span>
          <nav className="topnav" aria-label={t.nav}>
            <NavLink to="/dev" className={navClass}>
              {t.dev}
            </NavLink>
            <NavLink to="/client" className={navClass}>
              {t.client}
            </NavLink>
          </nav>
          <div className="topbar-end">
            {error && (
              <span className="topbar-error" role="alert">
                {error}
              </span>
            )}
            {clock && (
              <span className="clock-badge">
                {t.day} {clock.day} · {fmtDate(clock.date)}
              </span>
            )}
            <button type="button" className="btn-danger" onClick={() => void reset()} disabled={busy}>
              {t.reset}
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </SimClockContext.Provider>
  )
}
