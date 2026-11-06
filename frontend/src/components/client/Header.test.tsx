import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Header } from './Header'

// Day 3 = Thursday 2026-03-05; the simulation runs from day 0 (Mon 2026-03-02) to day 10 (Mon 2026-03-16).
const today = { jour: 3, date: '2026-03-05', date_longue: 'jeudi 5 mars 2026' }

function setup() {
  const onPickDate = vi.fn()
  render(<Header today={today} lastDay={10} onStep={vi.fn()} onPickDate={onPickDate} />)
  return { onPickDate, picker: screen.getByLabelText('Choisir une date') as HTMLInputElement }
}

describe('Header date picker', () => {
  it('applies a date inside the simulation only on blur, not on each change', () => {
    const { onPickDate, picker } = setup()
    fireEvent.change(picker, { target: { value: '2026-03-10' } })
    expect(onPickDate).not.toHaveBeenCalled()
    fireEvent.blur(picker)
    expect(onPickDate).toHaveBeenCalledExactlyOnceWith('2026-03-10')
  })

  it('applies the picked date on Enter', async () => {
    const { onPickDate, picker } = setup()
    fireEvent.change(picker, { target: { value: '2026-03-16' } }) // the last day: allowed
    await userEvent.type(picker, '{Enter}')
    expect(onPickDate).toHaveBeenCalledExactlyOnceWith('2026-03-16')
  })

  it('ignores a date before the first day or after the last day, and shows the current date again', () => {
    const { onPickDate, picker } = setup()
    for (const outside of ['2026-03-01', '0002-03-05', '2026-03-17', '2030-01-01']) {
      fireEvent.change(picker, { target: { value: outside } })
      fireEvent.blur(picker)
      expect(picker.value).toBe('2026-03-05')
    }
    expect(onPickDate).not.toHaveBeenCalled()
  })

  it('does not report the unchanged date', () => {
    const { onPickDate, picker } = setup()
    fireEvent.blur(picker)
    expect(onPickDate).not.toHaveBeenCalled()
  })
})
