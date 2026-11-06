import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgentTools, getClock, getDiff, getPlan, getTimeline } from '../api'
import { ClockPanel } from '../components/dev/ClockPanel'
import { Gantt } from '../components/dev/Gantt'
import { Ledger } from '../components/dev/Ledger'
import { SetupPanel } from '../components/dev/SetupPanel'
import type { AgentTool, Clock, Diff, Plan, Timeline } from '../types'

interface Loaded {
  clock: Clock
  plan: Plan
  timeline: Timeline
  diff: Diff
}

export function DevPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [message, setMessage] = useState('Loading…')
  const [tools, setTools] = useState<AgentTool[]>([])

  const refresh = useCallback(async () => {
    try {
      const [clock, plan, timeline, diff] = await Promise.all([getClock(), getPlan(), getTimeline(), getDiff()])
      setLoaded({ clock, plan, timeline, diff })
    } catch {
      setLoaded(null)
      setMessage('No simulation yet. Generate a plan in the Setup panel.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    getAgentTools().then(setTools, () => setTools([]))
  }, [refresh])

  const dependencies = useMemo(
    () => Object.fromEntries((loaded?.plan.tickets ?? []).map((t) => [t.key, t.depends_on])),
    [loaded],
  )

  return (
    <main className="dev-page">
      <h1>Billing simulation: dev</h1>
      <SetupPanel onGenerated={() => void refresh()} />
      {tools.length > 0 && (
        <section className="panel agent-tools">
          <h2>Agent tools</h2>
          <ul>
            {tools.map((t) => (
              <li key={t.name}>
                <code>{t.name}</code>: {t.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loaded ? (
        <p className="empty">{message}</p>
      ) : (
        <>
          {/* The timeline and diff cover the whole simulation; the clock only moves "today". */}
          <ClockPanel
            clock={loaded.clock}
            onChange={(clock) => setLoaded((l) => (l ? { ...l, clock } : l))}
          />
          <section className="panel">
            <h2>Gantt</h2>
            <div className="gantt-scroll">
              <Gantt
                rows={loaded.diff.tickets}
                lots={loaded.plan.lots}
                sprints={loaded.plan.sprints}
                today={loaded.clock.day}
                lastDay={loaded.clock.last_day}
                events={loaded.timeline.events}
                dependencies={dependencies}
              />
            </div>
            <p className="legend">
              <span className="swatch planned" /> planned <span className="swatch real" /> real{' '}
              <span className="swatch blocked" /> blocked <span className="swatch today" /> today
            </p>
          </section>
          <section className="panel">
            <h2>Ledger</h2>
            <Ledger
              invoices={loaded.timeline.invoices}
              payments={loaded.timeline.payments}
              diff={loaded.diff}
              today={loaded.clock.day}
            />
          </section>
        </>
      )}
    </main>
  )
}
