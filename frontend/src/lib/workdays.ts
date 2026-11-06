const DAY_MS = 86_400_000

const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const isWorkingDay = (utcMs: number) => {
  const dow = new Date(utcMs).getUTCDay()
  return dow !== 0 && dow !== 6
}

/**
 * Simulation day index for a picked calendar date, counting working days
 * (Monday to Friday) from today's date and day. A weekend date maps to the
 * working day before it; the result is clamped to [0, lastDay].
 */
export function dayForDate(
  today: { date: string; jour: number },
  picked: string,
  lastDay: number,
): number {
  const from = toUtc(today.date)
  const to = toUtc(picked)
  if (!picked || Number.isNaN(to) || Number.isNaN(from)) return today.jour

  let delta = 0
  if (to >= from) {
    for (let t = from + DAY_MS; t <= to; t += DAY_MS) if (isWorkingDay(t)) delta++
  } else {
    for (let t = from; t > to; t -= DAY_MS) if (isWorkingDay(t)) delta--
  }
  return Math.min(Math.max(today.jour + delta, 0), lastDay)
}
