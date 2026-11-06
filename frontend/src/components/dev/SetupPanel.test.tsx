import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetupPanel } from './SetupPanel'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('SetupPanel', () => {
  it('checks "Utiliser le scénario de secours" after a 400 and shows the detail', async () => {
    mockFetch(400, { detail: 'no API key' })
    render(<SetupPanel onGenerated={() => {}} />)
    const box = screen.getByRole('checkbox', { name: /utiliser le scénario de secours/i })
    expect(box).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Générer' }))
    expect(await screen.findByText(/no API key/)).toBeInTheDocument()
    expect(box).toBeChecked()
  })

  it('shows the rejection reason on 422 without ticking the fallback', async () => {
    mockFetch(422, { reason: 'not a software request' })
    render(<SetupPanel onGenerated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Générer' }))
    expect(await screen.findByText(/not a software request/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /utiliser le scénario de secours/i })).not.toBeChecked()
  })

  it('sends seed and fallback, prints the plan and calls onGenerated', async () => {
    const fetchMock = mockFetch(200, { kind: 'plan', plan: { lots: [] }, seed: 7, warnings: [] })
    const onGenerated = vi.fn()
    render(<SetupPanel onGenerated={onGenerated} />)
    await userEvent.type(screen.getByLabelText(/demande du client/i), 'hello')
    await userEvent.type(screen.getByLabelText(/graine/i), '7')
    await userEvent.click(screen.getByRole('checkbox', { name: /utiliser le scénario de secours/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Générer' }))
    expect(await screen.findByText(/"lots"/)).toBeInTheDocument()
    expect(onGenerated).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      request_text: 'hello',
      seed: 7,
      fallback: true,
    })
  })
})
