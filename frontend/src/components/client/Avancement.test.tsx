import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import snapshot from '../../test-fixtures/client-snapshot.json'
import { ticketsAsOf } from '../../test-fixtures/asOf'
import type { ClientHistoryEntry, ClientLot, ClientTicket, ClientToday } from '../../types'
import { Avancement, DAY_PX, dayX } from './Avancement'

// Last day (75, 15/06/2026): every ticket is done. Day 23 (02/04/2026, `mid`): BANK-8 and BANK-9 are in progress,
// BANK-10 and BANK-12 not started. BANK-5 was blocked on 20/03 (day 14) and unblocked on 23/03 (day 15).
const lastDay = snapshot.today as ClientToday
const mid = snapshot.mid.today as ClientToday
const lots = snapshot.lots as ClientLot[]
const tickets = snapshot.tickets as ClientTicket[]
const midTickets = ticketsAsOf(tickets, mid.date)
const history = snapshot.history as Record<string, ClientHistoryEntry[]>

const row = (key: string) => screen.getByRole('button', { name: new RegExp(`^${key} · `) })
const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr))
const todayX = () => num(document.querySelector('line.today'), 'x1')
const right = (rect: Element) => num(rect, 'x') + num(rect, 'width')

describe('Avancement', () => {
  it('draws one row per ticket, grouped by lot then Sans lot, with the legend', () => {
    render(<Avancement tickets={tickets} lots={lots} today={lastDay} history={{}} onSelect={() => {}} />)
    const chart = screen.getByRole('group', { name: /Avancement des tickets/ })
    const labels = [...chart.querySelectorAll('text.lot-label')].map((t) => t.textContent)
    expect(labels).toEqual([
      'L1 · Tableau de bord factures',
      'L2 · Suivi des paiements',
      'L3 · Exports et notifications',
      'Sans lot',
    ])
    expect(within(chart).getAllByRole('button')).toHaveLength(tickets.length)
    // rows follow the lots: BANK-11 (L3) comes before BANK-12 (no lot)
    const order = within(chart).getAllByRole('button').map((b) => b.getAttribute('data-key'))
    expect(order.indexOf('BANK-11')).toBeLessThan(order.indexOf('BANK-12'))
    const legend = screen.getByRole('list', { name: 'Légende' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([
      'prévu',
      'réel',
      'bloqué',
      "aujourd'hui",
    ])
  })

  it('has sprint bands of 10 working days and a date tick every 5 days', () => {
    render(<Avancement tickets={tickets} lots={lots} today={lastDay} history={{}} onSelect={() => {}} />)
    const bands = document.querySelectorAll('rect.sprint-band')
    expect(bands.length).toBe(Math.ceil((lastDay.jour + 1) / 10))
    expect(num(bands[1], 'x')).toBe(dayX(10))
    expect(num(bands[0], 'width')).toBe(10 * DAY_PX)
    const ticks = [...document.querySelectorAll('text.date-tick')].map((t) => t.textContent)
    expect(ticks.slice(0, 3)).toEqual(['02/03', '09/03', '16/03']) // days 0, 5, 10
  })

  it('shows only the planned bar for a ticket not started yet', () => {
    render(<Avancement tickets={midTickets} lots={lots} today={mid} history={{}} onSelect={() => {}} />)
    const bank10 = row('BANK-10') // planned 03/04 → 07/04 (days 24 → 26)
    const planned = bank10.querySelector('rect.planned')!
    expect(num(planned, 'x')).toBe(dayX(24))
    expect(num(planned, 'width')).toBe(3 * DAY_PX)
    expect(bank10.querySelector('rect.real')).toBeNull()
    expect(bank10.querySelector('rect.blocked')).toBeNull()
  })

  it('clips the real bar of a ticket in progress at today', () => {
    render(<Avancement tickets={midTickets} lots={lots} today={mid} history={{}} onSelect={() => {}} />)
    const real = row('BANK-8').querySelector('rect.real')! // started 30/03 (day 20), still in progress on day 23
    expect(num(real, 'x')).toBe(dayX(20))
    expect(right(real)).toBe(dayX(mid.jour + 1)) // through today, inclusive
    expect(right(real)).toBe(todayX()) // ends on the today line
  })

  it('never draws real work past today, even from records that end later', () => {
    // The last-day records rendered on day 23: their later starts and ends must not leak.
    render(<Avancement tickets={tickets} lots={lots} today={mid} history={history} onSelect={() => {}} />)
    for (const rect of document.querySelectorAll('rect.real, rect.blocked')) {
      expect(right(rect)).toBeLessThanOrEqual(todayX())
    }
    expect(row('BANK-10').querySelector('rect.real')).toBeNull() // starts on 06/04, after today
    expect(right(row('BANK-9').querySelector('rect.real')!)).toBe(todayX()) // ends 07/04, clipped at 02/04
  })

  it('hatches the days BANK-5 was blocked, from its history', () => {
    render(<Avancement tickets={tickets} lots={lots} today={lastDay} history={history} onSelect={() => {}} />)
    const blocked = row('BANK-5').querySelectorAll('rect.blocked')
    expect(blocked).toHaveLength(1)
    expect(num(blocked[0], 'x')).toBe(dayX(14)) // Blocage 20/03
    expect(right(blocked[0])).toBe(dayX(16)) // through Déblocage 23/03 (day 15)
    expect(row('BANK-4').querySelector('rect.blocked')).toBeNull()
  })

  it('does not show a block that comes after today', () => {
    const day13 = { jour: 13, date: '2026-03-19', date_longue: 'jeudi 19 mars 2026' }
    render(
      <Avancement
        tickets={ticketsAsOf(tickets, day13.date)}
        lots={lots}
        today={day13}
        history={history}
        onSelect={() => {}}
      />,
    )
    expect(row('BANK-5').querySelector('rect.real')).not.toBeNull() // started that day
    expect(row('BANK-5').querySelector('rect.blocked')).toBeNull() // blocked on day 14
  })

  it('clips a block still open at today', () => {
    const day14 = { jour: 14, date: '2026-03-20', date_longue: 'vendredi 20 mars 2026' }
    const asOf14 = history['BANK-5'].filter((r) => r.date <= day14.date)
    render(
      <Avancement
        tickets={ticketsAsOf(tickets, day14.date)}
        lots={lots}
        today={day14}
        history={{ 'BANK-5': asOf14 }}
        onSelect={() => {}}
      />,
    )
    const blocked = row('BANK-5').querySelector('rect.blocked')!
    expect(num(blocked, 'x')).toBe(dayX(14))
    expect(right(blocked)).toBe(todayX())
  })

  it('reports a click or Enter on a row', async () => {
    const onSelect = vi.fn()
    render(<Avancement tickets={tickets} lots={lots} today={lastDay} history={{}} selected="BANK-3" onSelect={onSelect} />)
    expect(row('BANK-3')).toHaveAttribute('aria-expanded', 'true')
    expect(row('BANK-5')).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row('BANK-5'))
    expect(onSelect).toHaveBeenLastCalledWith('BANK-5')
    row('BANK-7').focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith('BANK-7')
  })
})
