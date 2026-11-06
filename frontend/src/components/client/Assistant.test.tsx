import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Assistant } from './Assistant'

/** A fetch whose body streams the given SSE chunks (a chunk may cut an event in two). */
function streamOf(chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`

function mockChat(chunks: string[], ok = true) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, status: ok ? 200 : 500, body: streamOf(chunks) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function ask(question = 'Où en est-on ?') {
  await userEvent.type(screen.getByPlaceholderText('Posez une question…'), question)
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('Assistant', () => {
  it('posts the message with a session id and renders the user bubble', async () => {
    const fetchMock = mockChat([sse({ type: 'done' })])
    render(<Assistant />)
    await ask()
    expect(screen.getByText('Où en est-on ?')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/client/chat')
    const body = JSON.parse(String(init?.body))
    expect(body.message).toBe('Où en est-on ?')
    expect(body.session_id).toEqual(expect.any(String))
    await waitFor(() => expect(screen.getByPlaceholderText('Posez une question…')).toHaveValue(''))
  })

  it('keeps the same session id across questions', async () => {
    const fetchMock = mockChat([sse({ type: 'done' })])
    render(<Assistant />)
    await ask('Un')
    await waitFor(() => expect(screen.getByPlaceholderText('Posez une question…')).toHaveValue(''))
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, body: streamOf([sse({ type: 'done' })]) }))
    await ask('Deux')
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).session_id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
  })

  it('renders a French chip for a tool_call event, using the call input where the label has a slot', async () => {
    mockChat([
      sse({ type: 'tool_call', name: 'get_summary', input: {} }),
      sse({ type: 'tool_result', name: 'get_summary' }),
      sse({ type: 'tool_call', name: 'get_ticket', input: { key: 'BANK-12' } }),
      sse({ type: 'tool_call', name: 'explain_price', input: { key: 'L1' } }),
      sse({ type: 'tool_call', name: 'get_today', input: {} }),
      sse({ type: 'tool_call', name: 'list_invoices', input: {} }),
      sse({ type: 'done' }),
    ])
    render(<Assistant />)
    await ask()
    for (const label of [
      'consulte le résumé…',
      'consulte BANK-12…',
      'calcule le prix de L1…',
      'vérifie la date…',
      'consulte les factures…',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('falls back to "consulte <tool>…" for an unmapped tool, or a mapped one missing its input', async () => {
    mockChat([
      sse({ type: 'tool_call', name: 'some_new_tool', input: {} }),
      sse({ type: 'tool_call', name: 'get_ticket', input: {} }),
      sse({ type: 'done' }),
    ])
    render(<Assistant />)
    await ask()
    expect(await screen.findByText('consulte some_new_tool…')).toBeInTheDocument()
    expect(screen.getByText('consulte get_ticket…')).toBeInTheDocument()
  })

  it('renders an info event as a divider ahead of the new reply', async () => {
    mockChat([
      sse({ type: 'info', message: 'Nouvelle date : la conversation repart de zéro.' }),
      sse({ type: 'text', text: 'Bonjour' }),
      sse({ type: 'done' }),
    ])
    render(<Assistant />)
    await ask()
    const divider = await screen.findByRole('separator')
    expect(divider).toHaveTextContent('Nouvelle date : la conversation repart de zéro.')
    expect(await screen.findByText('Bonjour')).toBeInTheDocument()
    const log = divider.parentElement!
    const order = [...log.children].map((c) => c.className)
    expect(order.indexOf('chat-divider')).toBeGreaterThan(order.indexOf('bubble user'))
    expect(order.indexOf('chat-divider')).toBeLessThan(order.indexOf('bubble assistant-reply'))
  })

  it('renders **bold** as <strong> text, with citations still linked inside and outside it', async () => {
    mockChat([
      sse({ type: 'text', text: 'Le total est **2 400 €** pour **[BANK-1]** et [F-2026-001], **non clos.' }),
      sse({ type: 'done' }),
    ])
    const { container } = render(<Assistant />)
    await ask()
    const strongs = await waitFor(() => {
      const found = container.querySelectorAll('.assistant-reply strong')
      expect(found).toHaveLength(2)
      return found
    })
    expect(strongs[0].textContent).toBe('2 400 €')
    expect(within(strongs[1] as HTMLElement).getByRole('link', { name: '[BANK-1]' })).toHaveAttribute('href', '#rec-BANK-1')
    expect(screen.getByRole('link', { name: '[F-2026-001]' })).toHaveAttribute('href', '#rec-F-2026-001')
    const reply = container.querySelector('.assistant-reply p')!
    expect(reply.textContent).toBe('Le total est 2 400 € pour [BANK-1] et [F-2026-001], **non clos.') // an unclosed ** stays as typed
  })

  it('never interprets HTML in the model text', async () => {
    mockChat([sse({ type: 'text', text: '**<img src=x onerror=alert(1)>**' }), sse({ type: 'done' })])
    const { container } = render(<Assistant />)
    await ask()
    await screen.findByText('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
  })

  it('accumulates text deltas, even when an event is split across chunks', async () => {
    const second = sse({ type: 'text', text: 'monde' })
    mockChat([sse({ type: 'text', text: 'Bonjour ' }), second.slice(0, 10), second.slice(10), sse({ type: 'done' })])
    render(<Assistant />)
    await ask()
    expect(await screen.findByText('Bonjour monde')).toBeInTheDocument()
  })

  it('renders citations as links to the record anchors', async () => {
    mockChat([sse({ type: 'text', text: 'Voir [BANK-1], [F-2026-001] et [L2].' }), sse({ type: 'done' })])
    render(<Assistant />)
    await ask()
    const link = await screen.findByRole('link', { name: '[BANK-1]' })
    expect(link).toHaveAttribute('href', '#rec-BANK-1')
    expect(screen.getByRole('link', { name: '[F-2026-001]' })).toHaveAttribute('href', '#rec-F-2026-001')
    expect(screen.getByRole('link', { name: '[L2]' })).toHaveAttribute('href', '#rec-L2')
  })

  it('announces the record to reveal when a citation is clicked, then scrolls to it', async () => {
    mockChat([sse({ type: 'text', text: 'Voir [BANK-1].' }), sse({ type: 'done' })])
    const target = document.createElement('div')
    target.id = 'rec-BANK-1'
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    const revealed: string[] = []
    const listener = (e: Event) => revealed.push((e as CustomEvent<string>).detail)
    window.addEventListener('reveal-record', listener)
    try {
      render(<Assistant />)
      await ask()
      await userEvent.click(await screen.findByRole('link', { name: '[BANK-1]' }))
      expect(revealed).toEqual(['BANK-1'])
      await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled())
    } finally {
      window.removeEventListener('reveal-record', listener)
      target.remove()
    }
  })

  it('shows the message of an error event', async () => {
    mockChat([sse({ type: 'error', message: 'Aucune clé API configurée.' }), sse({ type: 'done' })])
    render(<Assistant />)
    await ask()
    expect(await screen.findByText('Aucune clé API configurée.')).toBeInTheDocument()
  })

  it('shows the error line when the stream ends without a done event', async () => {
    mockChat([sse({ type: 'text', text: 'Début de répon' })])
    render(<Assistant />)
    await ask()
    expect(await screen.findByText("L'assistant n'a pas pu répondre.")).toBeInTheDocument()
    expect(screen.getByText('Début de répon')).toBeInTheDocument()
  })

  it('shows the error line only once when an error event ends the stream without done', async () => {
    mockChat([sse({ type: 'error', message: 'Panne.' })])
    render(<Assistant />)
    await ask()
    expect(await screen.findByText('Panne.')).toBeInTheDocument()
    expect(screen.queryByText("L'assistant n'a pas pu répondre.")).toBeNull()
  })

  it('shows a French error when the request fails', async () => {
    mockChat([], false)
    render(<Assistant />)
    await ask()
    expect(await screen.findByText("L'assistant n'a pas pu répondre.")).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Posez une question…'), 'Encore')
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled() // not stuck in the busy state
  })

  it('shows a French error on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    render(<Assistant />)
    await ask()
    expect(await screen.findByText("L'assistant n'a pas pu répondre.")).toBeInTheDocument()
  })

  it('does not send a blank question', async () => {
    const fetchMock = mockChat([sse({ type: 'done' })])
    render(<Assistant />)
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText('Posez une question…'), '   ')
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
