// Page for a screen scenario in the preview: renders `scenario.render()` over the fake ctx and makes
// VISIBLE what went wrong — a route/method with no entry in the scenario (alert at the top) and an exception while rendering
// (error frame in place of the screen, never a blank page). Preview only: none of this goes in plugin.js.
import { Component, type ReactNode, useSyncExternalStore } from 'react'
import type { Scenario, ScenarioRuntime } from './scenario'

/* Inline styles using only theme variables: the preview cannot depend on app classes. */
const ALERT = {
  margin: '0 0 12px',
  padding: '8px 12px',
  border: '1px solid var(--ui-red)',
  borderRadius: 6,
  background: 'var(--ui-bg-elevated)',
  color: 'var(--ui-text-primary)',
  font: '12px/16px var(--dt-font-mono, monospace)'
} as const

class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div data-preview-crash role="alert" style={ALERT}>
          <strong>Scenario crashed while rendering:</strong> {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}

function MissingRoutes({ runtime }: { runtime: ScenarioRuntime }) {
  const missing = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.missing().join('\n'),
    () => ''
  )
  if (!missing) return null
  return (
    <div data-preview-missing role="alert" style={ALERT}>
      <strong>Scenario has no response for:</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
        {missing.split('\n').map((m, i) => (
          <li key={`${m}-${i}`} data-missing-route={m}>
            {m}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `render()` runs INSIDE the error boundary (called here, not in the parent). */
function Rendered({ scenario }: { scenario: Scenario }) {
  return <>{scenario.render()}</>
}

export function ScenarioView({ scenario, runtime }: { scenario: Scenario; runtime: ScenarioRuntime }) {
  return (
    <div data-scenario-id={scenario.id} style={{ display: 'contents' }}>
      <MissingRoutes runtime={runtime} />
      <CrashBoundary>
        <Rendered scenario={scenario} />
      </CrashBoundary>
    </div>
  )
}
