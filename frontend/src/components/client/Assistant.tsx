import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { fr } from '../../i18n/fr'

type Part = { kind: 'text'; text: string } | { kind: 'tool'; name: string }

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; parts: Part[]; error?: string }

type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string }
  | { type: 'error'; message?: string }
  | { type: 'done' }

/** Event name a citation click announces; `LotCard` listens and expands itself when it holds the record. */
export const REVEAL_EVENT = 'reveal-record'

const CITATION = /\[(BANK-\d+|F-\d{4}-\d{3}|L\d)\]/g

function reveal(key: string) {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: key }))
  // Let the collapsed lot card re-render before scrolling to the record inside it.
  setTimeout(() => document.getElementById(`rec-${key}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0)
}

/** Text with each `[KEY]` citation turned into a link to the record's anchor on the page. */
function withCitations(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(CITATION)) {
    const key = match[1]
    if (match.index > last) nodes.push(text.slice(last, match.index))
    nodes.push(
      <a
        key={match.index}
        href={`#rec-${key}`}
        onClick={(e) => {
          e.preventDefault()
          reveal(key)
        }}
      >
        {match[0]}
      </a>,
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Reads a `text/event-stream` body and calls `onEvent` for each `data:` payload, however the chunks split. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (block: string) => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data) onEvent(JSON.parse(data) as AgentEvent)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    blocks.forEach(flush)
  }
  buffer += decoder.decode()
  if (buffer.trim()) flush(buffer)
}

function appendPart(parts: Part[], event: AgentEvent): Part[] {
  if (event.type === 'tool_call') return [...parts, { kind: 'tool', name: event.name }]
  if (event.type === 'text') {
    const last = parts[parts.length - 1]
    if (last?.kind === 'text') return [...parts.slice(0, -1), { kind: 'text', text: last.text + event.text }]
    return [...parts, { kind: 'text', text: event.text }]
  }
  return parts
}

export function Assistant() {
  const t = fr.assistant
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionId] = useState(() => crypto.randomUUID())
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  /** Applies `change` to the assistant message being streamed (always the last one). */
  const updateLast = (change: (m: Extract<Message, { role: 'assistant' }>) => Message) =>
    setMessages((all) => {
      const last = all[all.length - 1]
      return last?.role === 'assistant' ? [...all.slice(0, -1), change(last)] : all
    })

  async function send(e: FormEvent) {
    e.preventDefault()
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)
    setMessages((all) => [...all, { role: 'user', text: question }, { role: 'assistant', parts: [] }])
    const controller = new AbortController()
    abort.current = controller
    try {
      const res = await fetch('/client/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: question }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`)
      let finished = false
      await readEvents(res.body, (event) => {
        if (event.type === 'done') finished = true
        if (event.type === 'error') updateLast((m) => ({ ...m, error: event.message || t.error }))
        else updateLast((m) => ({ ...m, parts: appendPart(m.parts, event) }))
      })
      // A stream that ends without `done` was cut short: say so, unless an error line is already there.
      if (!finished) updateLast((m) => ({ ...m, error: m.error ?? t.error }))
    } catch {
      if (!controller.signal.aborted) updateLast((m) => ({ ...m, error: t.error }))
    } finally {
      if (abort.current === controller) abort.current = null
      setBusy(false)
    }
  }

  return (
    <section className="assistant-panel" aria-label={t.title}>
      <h2>{t.title}</h2>
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && <p className="empty">{t.hint}</p>}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className="bubble user">
              {m.text}
            </p>
          ) : (
            <div key={i} className="bubble assistant-reply">
              {m.parts.map((part, j) =>
                part.kind === 'tool' ? (
                  <span key={j} className="chip">
                    {t.consulting} {part.name}…
                  </span>
                ) : (
                  <p key={j}>{withCitations(part.text)}</p>
                ),
              )}
              {m.error && <p className="error">{m.error}</p>}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      <form className="chat-form" onSubmit={(e) => void send(e)}>
        <input
          type="text"
          value={input}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {t.send}
        </button>
      </form>
    </section>
  )
}
