import { useState } from 'react'
import { setClock } from '../../api'
import { fr } from '../../i18n/fr'
import { fmtDate } from '../../lib/format'
import type { Clock } from '../../types'

interface Props {
  clock: Clock
  onChange: (clock: Clock) => void
}

const BACK = [-5, -1]
const FORWARD = [1, 5]
const label = (n: number) => (n < 0 ? `−${-n}` : `+${n}`)

export function ClockPanel({ clock, onChange }: Props) {
  const t = fr.dev.clock
  const [error, setError] = useState('')

  async function moveTo(day: number) {
    const target = Math.min(Math.max(day, 0), clock.last_day)
    try {
      setError('')
      onChange(await setClock(target))
    } catch {
      setError(t.error)
    }
  }

  // The step buttons read "−5 / −1 / +1 / +5"; the tooltip says it in words.
  const stepTitle = (n: number) => `${n < 0 ? t.previous : t.next} (${label(n)})`

  return (
    <section className="panel clock-panel">
      <h2>{t.title}</h2>
      <div className="row clock-controls">
        <button type="button" onClick={() => moveTo(0)} disabled={clock.day <= 0}>
          {t.start}
        </button>
        {BACK.map((n) => (
          <button key={n} type="button" title={stepTitle(n)} onClick={() => moveTo(clock.day + n)}>
            {label(n)}
          </button>
        ))}
        <input
          type="range"
          aria-label={t.day}
          title={t.goTo}
          min={0}
          max={clock.last_day}
          value={clock.day}
          onChange={(e) => moveTo(Number(e.target.value))}
        />
        {FORWARD.map((n) => (
          <button key={n} type="button" title={stepTitle(n)} onClick={() => moveTo(clock.day + n)}>
            {label(n)}
          </button>
        ))}
        <button type="button" onClick={() => moveTo(clock.last_day)} disabled={clock.day >= clock.last_day}>
          {t.end}
        </button>
      </div>
      <p>
        {t.day} {clock.day} / {clock.last_day} — {fmtDate(clock.date)}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
