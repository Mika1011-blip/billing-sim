import { useRef, useState, type KeyboardEvent } from 'react'
import { fr } from '../../i18n/fr'

export type ClientView = 'chronologie' | 'factures'

const VIEWS: ClientView[] = ['chronologie', 'factures']
const VIEW_KEY = 'billing-sim.client.view'

export const VIEW_PANEL_ID = 'client-view-panel'
export const viewTabId = (view: ClientView) => `client-tab-${view}`

/** The client page's tab, remembered in this browser; storage may be unavailable (private mode, blocked). */
export function useClientView(): [ClientView, (view: ClientView) => void] {
  const [view, setView] = useState<ClientView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'chronologie' ? 'chronologie' : 'factures'
    } catch {
      return 'factures'
    }
  })
  const choose = (next: ClientView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // not remembered: the tab still switches
    }
  }
  return [view, choose]
}

interface Props {
  value: ClientView
  onChange: (view: ClientView) => void
}

/** The *Chronologie* / *Factures* tabs under the tiles (arrow keys, Home and End move between them). */
export function ViewTabs({ value, onChange }: Props) {
  const tabs = useRef<Partial<Record<ClientView, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent) => {
    const i = VIEWS.indexOf(value)
    const moves: Record<string, ClientView | undefined> = {
      ArrowRight: VIEWS[(i + 1) % VIEWS.length],
      ArrowLeft: VIEWS[(i - 1 + VIEWS.length) % VIEWS.length],
      Home: VIEWS[0],
      End: VIEWS[VIEWS.length - 1],
    }
    const next = moves[e.key]
    if (!next) return
    e.preventDefault()
    onChange(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className="view-tabs" role="tablist" aria-label={fr.tabs.label}>
      {VIEWS.map((view) => (
        <button
          key={view}
          ref={(el) => {
            tabs.current[view] = el
          }}
          type="button"
          role="tab"
          id={viewTabId(view)}
          aria-selected={view === value}
          aria-controls={VIEW_PANEL_ID}
          tabIndex={view === value ? 0 : -1}
          onClick={() => onChange(view)}
          onKeyDown={onKeyDown}
        >
          {fr.tabs[view]}
        </button>
      ))}
    </div>
  )
}
