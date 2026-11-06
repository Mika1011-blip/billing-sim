import { dayForDate } from './workdays'

// 2026-03-02 is a Monday.
const today = { date: '2026-03-02', jour: 10 }

describe('dayForDate', () => {
  it('returns the current day for the current date', () => {
    expect(dayForDate(today, '2026-03-02', 40)).toBe(10)
  })

  it('counts working days forward, skipping weekends', () => {
    expect(dayForDate(today, '2026-03-06', 40)).toBe(14) // Friday
    expect(dayForDate(today, '2026-03-09', 40)).toBe(15) // next Monday
    expect(dayForDate(today, '2026-03-16', 40)).toBe(20)
  })

  it('counts working days backward, skipping weekends', () => {
    expect(dayForDate(today, '2026-02-27', 40)).toBe(9) // previous Friday
    expect(dayForDate(today, '2026-02-23', 40)).toBe(5) // Monday a week before
  })

  it('maps a weekend date to the nearest preceding working day', () => {
    expect(dayForDate(today, '2026-03-07', 40)).toBe(14) // Saturday -> Friday
    expect(dayForDate(today, '2026-03-08', 40)).toBe(14) // Sunday -> Friday
    expect(dayForDate(today, '2026-02-28', 40)).toBe(9) // Saturday before -> Friday
  })

  it('works when today is a Friday', () => {
    const friday = { date: '2026-03-06', jour: 4 }
    expect(dayForDate(friday, '2026-03-09', 40)).toBe(5)
  })

  it('clamps to [0, last_day]', () => {
    expect(dayForDate(today, '2030-01-01', 40)).toBe(40)
    expect(dayForDate(today, '2020-01-01', 40)).toBe(0)
  })

  it('returns the current day for an invalid date', () => {
    expect(dayForDate(today, '', 40)).toBe(10)
  })
})
