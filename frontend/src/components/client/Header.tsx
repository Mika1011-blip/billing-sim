import { fr } from '../../i18n/fr'
import type { ClientToday } from '../../types'

interface Props {
  today: ClientToday
  lastDay: number
  onStep: (delta: number) => void
  onPickDate: (isoDate: string) => void
}

export function Header({ today, lastDay, onStep, onPickDate }: Props) {
  const t = fr.header
  return (
    <header className="client-header row">
      <button type="button" aria-label={t.previous} disabled={today.jour <= 0} onClick={() => onStep(-1)}>
        ◀
      </button>
      <h1>
        {t.today} : {today.date_longue} · {t.day} {today.jour}
      </h1>
      <button type="button" aria-label={t.next} disabled={today.jour >= lastDay} onClick={() => onStep(1)}>
        ▶
      </button>
      <input
        type="date"
        aria-label={t.pickDate}
        value={today.date}
        onChange={(e) => e.target.value && onPickDate(e.target.value)}
      />
    </header>
  )
}
