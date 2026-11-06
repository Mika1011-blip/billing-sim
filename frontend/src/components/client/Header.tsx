import { useState } from 'react'
import { fr } from '../../i18n/fr'
import { dateForDay } from '../../lib/workdays'
import type { ClientToday } from '../../types'

interface Props {
  today: ClientToday
  lastDay: number
  onStep: (delta: number) => void
  onPickDate: (isoDate: string) => void
}

export function Header({ today, lastDay, onStep, onPickDate }: Props) {
  const t = fr.header
  // The picked date is only applied on Enter or blur, so typing a year digit by digit never moves the clock;
  // a date outside the simulation (before its first day or after its last) is dropped.
  // The draft follows a new day in the same render (not in an effect, which can run after the next keystroke
  // and overwrite a date typed right after the page loaded the previous one).
  const [draft, setDraft] = useState(today.date)
  const [shownDate, setShownDate] = useState(today.date)
  if (today.date !== shownDate) {
    setShownDate(today.date)
    setDraft(today.date)
  }

  function commit() {
    const first = dateForDay(today, 0)
    const last = dateForDay(today, lastDay)
    if (draft && draft !== today.date && draft >= first && draft <= last) onPickDate(draft)
    else setDraft(today.date)
  }

  return (
    <header className="client-header row">
      <h1>
        {t.today} : {today.date_longue} · {t.day} {today.jour}
      </h1>
      <div className="date-control" role="group">
        <button type="button" aria-label={t.previous} disabled={today.jour <= 0} onClick={() => onStep(-1)}>
          ◀
        </button>
        <input
          type="date"
          aria-label={t.pickDate}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
        <button type="button" aria-label={t.next} disabled={today.jour >= lastDay} onClick={() => onStep(1)}>
          ▶
        </button>
      </div>
    </header>
  )
}
