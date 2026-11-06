import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgentTools, getClock, getDiff, getPlan, getTimeline } from '../api'
import { ClockPanel } from '../components/dev/ClockPanel'
import { Gantt } from '../components/dev/Gantt'
import { Ledger } from '../components/dev/Ledger'
import { SetupPanel } from '../components/dev/SetupPanel'
import { fr } from '../i18n/fr'
import { useOnSimReset, useSimClock } from '../sim'
import type { AgentTool, Clock, Diff, Plan, Timeline } from '../types'

interface Loaded {
  clock: Clock
  plan: Plan
  timeline: Timeline
  diff: Diff
}

export function DevPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const t = fr.dev
  const [message, setMessage] = useState(t.loading)
  const [tools, setTools] = useState<AgentTool[]>([])
  const { reportClock } = useSimClock()

  const refresh = useCallback(async () => {
    try {
      const [clock, plan, timeline, diff] = await Promise.all([getClock(), getPlan(), getTimeline(), getDiff()])
      setLoaded({ clock, plan, timeline, diff })
      reportClock(clock) // a freshly generated plan shows up in the shell's clock badge at once
    } catch {
      setLoaded(null)
      setMessage(fr.dev.empty)
    }
  }, [reportClock])

  useOnSimReset(() => {
    setLoaded(null)
    setMessage(t.loading)
    void refresh()
  })

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
      <h1>{t.title}</h1>
      <SetupPanel onGenerated={() => void refresh()} />
      {tools.length > 0 && (
        <section className="panel agent-tools">
          <h2>{t.agentTools}</h2>
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
            onChange={(clock) => {
              setLoaded((l) => (l ? { ...l, clock } : l))
              reportClock(clock)
            }}
          />
          <section className="panel">
            <h2>{t.gantt.title}</h2>
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
              <span className="legend-chip">
                <span className="swatch planned" /> {t.gantt.planned}
              </span>
              <span className="legend-chip">
                <span className="swatch real" /> {t.gantt.real}
              </span>
              <span className="legend-chip">
                <span className="swatch blocked" /> {t.gantt.blocked}
              </span>
              <span className="legend-chip">
                <span className="swatch today" /> {t.gantt.today}
              </span>
            </p>
          </section>
          <section className="panel">
            <h2>{t.ledger.title}</h2>
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
