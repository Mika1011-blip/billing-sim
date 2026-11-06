import { useState } from 'react'
import { generate } from '../../api'
import { fr } from '../../i18n/fr'
import type { GenerateResult } from '../../types'

export type GeneratedPlan = Extract<GenerateResult, { kind: 'plan' }>

interface Props {
  onGenerated: (result: GeneratedPlan) => void
}

export function SetupPanel({ onGenerated }: Props) {
  const t = fr.dev.setup
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
        setOutput(`${t.rejected} ${result.reason}`)
      } else {
        setOutput(`${t.error} ${result.status} : ${result.detail}${result.raw ? `\n\n${result.raw}` : ''}`)
        // 400 means no API key / LLM unavailable: offer the built-in fixture next time.
        if (result.status === 400) setFallback(true)
      }
    } catch (e) {
      setOutput(`${t.failed} ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel setup-panel">
      <h2>{t.title}</h2>
      <label>
        {t.request}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <div className="row">
        <label>
          {t.seed}
          <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
          {t.fallback}
        </label>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? t.generating : t.generate}
        </button>
      </div>
      {output && <pre className="output">{output}</pre>}
    </section>
  )
}
