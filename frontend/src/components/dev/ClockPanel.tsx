import { useState } from 'react'
import { setClock } from '../../api'
import type { Clock } from '../../types'

interface Props {
  clock: Clock
  onChange: (clock: Clock) => void
}

const BACK = [-5, -1]
const FORWARD = [1, 5]
const label = (n: number) => (n < 0 ? `−${-n}` : `+${n}`)

export function ClockPanel({ clock, onChange }: Props) {
  const [error, setError] = useState('')

  async function moveTo(day: number) {
    const target = Math.min(Math.max(day, 0), clock.last_day)
    try {
      setError('')
      onChange(await setClock(target))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="panel clock-panel">
      <h2>Clock</h2>
      <div className="row">
        {BACK.map((n) => (
          <button key={n} type="button" onClick={() => moveTo(clock.day + n)}>
            {label(n)}
          </button>
        ))}
        <input
          type="range"
          aria-label="Day"
          min={0}
          max={clock.last_day}
          value={clock.day}
          onChange={(e) => moveTo(Number(e.target.value))}
        />
        {FORWARD.map((n) => (
          <button key={n} type="button" onClick={() => moveTo(clock.day + n)}>
            {label(n)}
          </button>
        ))}
      </div>
      <p>
        Day {clock.day} / {clock.last_day} — {clock.date}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
