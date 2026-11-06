import { createContext, useContext, useEffect, useRef } from 'react'
import type { Clock } from './types'

/** Window event the shell fires after `POST /sim/reset`: every page drops what it shows and refetches. */
export const SIM_RESET_EVENT = 'sim:reset'

interface SimClock {
  /** The clock the shell last polled (null: no simulation, or not loaded yet). */
  clock: Clock | null
  /** A page moved or reloaded the clock: the shell shows it at once instead of waiting for its next poll. */
  reportClock: (clock: Clock) => void
}

export const SimClockContext = createContext<SimClock>({ clock: null, reportClock: () => {} })

export const useSimClock = () => useContext(SimClockContext)

/** Calls `onReset` (latest version) each time the shell resets the simulation. */
export function useOnSimReset(onReset: () => void) {
  const latest = useRef(onReset)
  useEffect(() => {
    latest.current = onReset
  })
  useEffect(() => {
    const handler = () => latest.current()
    window.addEventListener(SIM_RESET_EVENT, handler)
    return () => window.removeEventListener(SIM_RESET_EVENT, handler)
  }, [])
}
