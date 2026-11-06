import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SIM_RESET_EVENT } from '../sim'
import { AppShell, CLOCK_POLL_MS } from './AppShell'

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: '', json: async () => body })

function installFetch(clock: { day: number; last_day: number; date: string } | null) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/sim/reset' && init?.method === 'POST') return reply({ status: 'reset' })
    if (url === '/sim/clock') return clock ? reply(clock) : reply({ detail: 'no simulation' }, 404)
    return reply({}, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/dev" element={<p>dev page</p>} />
          <Route path="/client" element={<p>client page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AppShell', () => {
  it('shows the brand and both nav links, the current route marked active', async () => {
    installFetch(null)
    renderAt('/dev')
    expect(screen.getByText('Simulation de facturation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dev' })).toHaveAttribute('href', '/dev')
    expect(screen.getByRole('link', { name: 'Dev' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Client' })).toHaveAttribute('href', '/client')
    expect(screen.getByRole('link', { name: 'Client' })).not.toHaveClass('active')
    expect(screen.getByText('dev page')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('marks Client active on /client', async () => {
    installFetch(null)
    renderAt('/client')
    expect(screen.getByRole('link', { name: 'Client' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Dev' })).not.toHaveClass('active')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('shows the clock badge when the backend has a clock', async () => {
    installFetch({ day: 3, last_day: 10, date: '2026-03-05' })
    renderAt('/dev')
    expect(await screen.findByText('Jour 3 · 05/03/2026')).toBeInTheDocument()
  })

  it('hides the clock badge when /sim/clock answers 404', async () => {
    const fetchMock = installFetch(null)
    renderAt('/dev')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/sim/clock', undefined))
    expect(screen.queryByText(/^Jour \d+/)).toBeNull()
  })

  it('polls the clock and follows a day moved elsewhere', async () => {
    let clock = { day: 3, last_day: 10, date: '2026-03-05' }
    vi.stubGlobal('fetch', vi.fn(async () => reply(clock)))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    renderAt('/client')
    expect(await screen.findByText('Jour 3 · 05/03/2026')).toBeInTheDocument()
    clock = { day: 4, last_day: 10, date: '2026-03-06' }
    await act(async () => void vi.advanceTimersByTime(CLOCK_POLL_MS))
    expect(await screen.findByText('Jour 4 · 06/03/2026')).toBeInTheDocument()
  })

  it('sets the page language and title to French while mounted', async () => {
    installFetch(null)
    document.documentElement.lang = 'en'
    const { unmount } = renderAt('/client')
    expect(document.documentElement.lang).toBe('fr')
    expect(document.title).toBe('Simulation de facturation')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    unmount()
    expect(document.documentElement.lang).toBe('en')
  })

  it('resets the simulation after confirmation and tells the pages to refetch', async () => {
    const fetchMock = installFetch({ day: 3, last_day: 10, date: '2026-03-05' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onReset = vi.fn()
    window.addEventListener(SIM_RESET_EVENT, onReset)
    renderAt('/dev')
    await screen.findByText('Jour 3 · 05/03/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(confirm).toHaveBeenCalledWith(
      "Réinitialiser la simulation ? Le plan, l'horloge et la facturation seront effacés.",
    )
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/sim/reset', expect.objectContaining({ method: 'POST' }))
    window.removeEventListener(SIM_RESET_EVENT, onReset)
  })

  it('does nothing when the reset is not confirmed', async () => {
    const fetchMock = installFetch(null)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onReset = vi.fn()
    window.addEventListener(SIM_RESET_EVENT, onReset)
    renderAt('/dev')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onReset).not.toHaveBeenCalled()
    window.removeEventListener(SIM_RESET_EVENT, onReset)
  })
})
