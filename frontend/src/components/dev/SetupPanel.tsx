import { useState } from 'react'
import { generate } from '../../api'
import type { GenerateResult } from '../../types'

export type GeneratedPlan = Extract<GenerateResult, { kind: 'plan' }>

interface Props {
  onGenerated: (result: GeneratedPlan) => void
}

export function SetupPanel({ onGenerated }: Props) {
  const [text, setText] = useState('')
  const [seed, setSeed] = useState('')
  const [fallback, setFallback] = useState(false)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')

  async function submit() {
    setBusy(true)
    try {
      const body = {
        request_text: text,
        ...(seed.trim() !== '' ? { seed: Number(seed) } : {}),
        ...(fallback ? { fallback: true } : {}),
      }
      const result = await generate(body)
      if (result.kind === 'plan') {
        setOutput(JSON.stringify({ seed: result.seed, warnings: result.warnings, plan: result.plan }, null, 2))
        onGenerated(result)
      } else if (result.kind === 'rejected') {
        setOutput(`Rejected: ${result.reason}`)
      } else {
        setOutput(`Error ${result.status}: ${result.detail}${result.raw ? `\n\n${result.raw}` : ''}`)
        // 400 means no API key / LLM unavailable: offer the built-in fixture next time.
        if (result.status === 400) setFallback(true)
      }
    } catch (e) {
      setOutput(`Request failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel setup-panel">
      <h2>Setup</h2>
      <label>
        Client request
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <div className="row">
        <label>
          Seed
          <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
          Use fallback
        </label>
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {output && <pre className="output">{output}</pre>}
    </section>
  )
}
