// Preview outside the app: mounts the plugin's real sheet (lib/style) over the app's real CSS
// (ref/hermes-desktop/host-compiled.css) and renders a composition OR a screen scenario. URL parameters:
//   ?view=<id> (VIEW_IDS) · ?scenario=<id> (scenarios discovered in **/preview.scenarios.tsx)
//   &theme=light|dark · &lang=pt|en · &shot=1 (without the preview bar)
import { useEffect, useState } from 'react'
import { PLUGIN_ID } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { CLASS_PREFIX, mountStyles } from '../lib/style'
import { createMockCtx, sdkMock } from '../test/sdk-mock'
import { type Scenario, type ScenarioRuntime, installScenario } from './scenario'
import { SCENARIO_SOURCES } from './scenarios.generated'
import { ScenarioView } from './ScenarioView'
import { VIEW_FRAME, VIEW_IDS, VIEW_TITLES, type ViewId, renderView } from './views'

interface Params {
  view: ViewId
  scenario: string | null
  theme: 'light' | 'dark'
  lang: 'pt' | 'en'
  shot: boolean
}

export interface ScenarioEntry {
  id: string
  title: string
  widths: number[] | null
  file: string
}

/** Discovered scenarios (in file order) + registration problems (repeated id, missing export). */
export function listScenarios(): { entries: ScenarioEntry[]; problems: string[]; byId: Map<string, Scenario> } {
  const entries: ScenarioEntry[] = []
  const problems: string[] = []
  const byId = new Map<string, Scenario>()
  for (const src of SCENARIO_SOURCES) {
    if (!Array.isArray(src.scenarios) || !src.scenarios.length) {
      problems.push(`${src.file}: no scenario in \`export const scenarios\``)
      continue
    }
    for (const s of src.scenarios) {
      if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id) || typeof s.render !== 'function') {
        problems.push(`${src.file}: invalid scenario (lowercase-with-hyphens id and render are required)`)
        continue
      }
      if (byId.has(s.id)) {
        problems.push(`${src.file}: duplicate id "${s.id}"`)
        continue
      }
      byId.set(s.id, s)
      entries.push({ id: s.id, title: s.title, widths: Array.isArray(s.widths) && s.widths.length ? s.widths : null, file: src.file })
    }
  }
  return { entries, problems, byId }
}

function readParams(): Params {
  const q = new URLSearchParams(globalThis.location?.search ?? '')
  const view = (VIEW_IDS as readonly string[]).includes(q.get('view') ?? '') ? (q.get('view') as ViewId) : 'gallery'
  return {
    view,
    scenario: q.get('scenario'),
    theme: q.get('theme') === 'dark' ? 'dark' : 'light',
    lang: q.get('lang') === 'en' ? 'en' : 'pt',
    shot: q.get('shot') === '1'
  }
}

function href(p: Params, change: Partial<Params>): string {
  const n = { ...p, ...change }
  const target = n.scenario ? `scenario=${encodeURIComponent(n.scenario)}` : `view=${n.view}`
  return `?${target}&theme=${n.theme}&lang=${n.lang}${n.shot ? '&shot=1' : ''}`
}

interface Boot {
  params: Params
  scenario: Scenario | null
  runtime: ScenarioRuntime | null
  unknownScenario: string | null
}

/** Prepares the preview "app": simulated ctx (or the scenario's), languages, theme and the plugin sheet. */
export function bootPreview(): Boot {
  const p = readParams()
  const { entries, problems, byId } = listScenarios()
  const g = globalThis as Record<string, unknown>
  g.__previewScenarios = entries
  g.__previewScenarioProblems = problems
  sdkMock.locale.set(p.lang === 'pt' ? 'pt-br' : 'en')
  const scenario = p.scenario ? (byId.get(p.scenario) ?? null) : null
  let runtime: ScenarioRuntime | null = null
  if (scenario) {
    runtime = installScenario(scenario, PLUGIN_ID)
    g.__previewMissing = () => runtime?.missing() ?? []
    g.__previewEmit = (type: string, payload: unknown) => runtime?.emit(type, payload)
  } else {
    const { ctx } = createMockCtx(PLUGIN_ID)
    setPluginContext(ctx)
    registerLocales(ctx)
    g.__previewMissing = () => []
  }
  document.documentElement.classList.toggle('dark', p.theme === 'dark')
  document.documentElement.lang = p.lang === 'pt' ? 'pt-BR' : 'en'
  document.documentElement.dataset.previewShot = p.shot ? 'true' : 'false'
  mountStyles()
  return { params: p, scenario, runtime, unknownScenario: p.scenario && !scenario ? p.scenario : null }
}

function PreviewBar({ p }: { p: Params }) {
  const { entries } = listScenarios()
  return (
    <nav data-preview-bar>
      <strong>Preview · {PLUGIN_ID}</strong>
      <span data-preview-note>
        Outside the app. The SDK controls (button, badge, tabs, field, dialog…) are simple stand-ins over the tests'
        sdk-mock; layout, colors, typography and states are the plugin's real sheet (prefix <code>{CLASS_PREFIX}</code>) over the app's
        real CSS. Screen scenarios: the scenario's own fake data (in-memory rest/rpc).
      </span>
      <span data-preview-links>
        {VIEW_IDS.map((v) => (
          <a key={v} href={href(p, { view: v, scenario: null })} aria-current={!p.scenario && v === p.view ? 'page' : undefined}>
            {VIEW_TITLES[v]}
          </a>
        ))}
      </span>
      {entries.length ? (
        <span data-preview-links>
          {entries.map((s) => (
            <a key={s.id} href={href(p, { scenario: s.id })} aria-current={p.scenario === s.id ? 'page' : undefined} title={s.file}>
              ▸ {s.title}
            </a>
          ))}
        </span>
      ) : null}
      <span data-preview-links>
        <a href={href(p, { theme: p.theme === 'dark' ? 'light' : 'dark' })}>{p.theme === 'dark' ? '☀︎ claro' : '☾ escuro'}</a>
        <a href={href(p, { lang: p.lang === 'pt' ? 'en' : 'pt' })}>{p.lang === 'pt' ? 'EN' : 'PT-BR'}</a>
      </span>
    </nav>
  )
}

export function PreviewApp({ boot }: { boot: Boot }) {
  const [b] = useState(boot)
  const p = b.params
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const frame = p.scenario ? 'page' : VIEW_FRAME[p.view]
  return (
    <>
      {p.shot ? null : <PreviewBar p={p} />}
      <main
        data-preview-frame={frame}
        data-preview-view={p.scenario ? `real-${p.scenario}` : p.view}
        data-preview-ready={ready ? 'true' : 'false'}
      >
        <div data-preview-surface>
          {b.scenario && b.runtime ? (
            <ScenarioView scenario={b.scenario} runtime={b.runtime} />
          ) : b.unknownScenario ? (
            <div data-preview-missing role="alert">
              Unknown scenario: {b.unknownScenario}
            </div>
          ) : (
            renderView(p.view)
          )}
        </div>
      </main>
    </>
  )
}
