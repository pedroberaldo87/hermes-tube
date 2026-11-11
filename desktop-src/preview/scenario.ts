// Preview scenario collector — the `Scenario` type and the fake `ctx` each scenario installs.
//
// A screen writes, next to its code, `<screen>/preview.scenarios.tsx`:
//   import type { Scenario } from '../../components'      // (or from here: '../../preview/scenario')
//   export const scenarios: Scenario[] = [{ id, title, widths?, rest?, rpc?, render }]
// `node desktop-src/preview/build.mjs` discovers those files and builds each scenario as a page
// (`?scenario=<id>`); with `--shots`, it photographs to docs/design/shots/real-<id>.<theme>.<width>.jpg.
//
// The fake ctx (installed by lib/ctx.ts, as the real register() would):
//  - `rest(path, init)`: matches METHOD + route (with `{param}`) against the `rest` keys and returns the ENVELOPE
//    `{ok: true, data}`; a function that throws `{code, message}` → `{ok: false, error}`.
//  - RPC (`host.request`, used by lib/rpc.ts): `runtime.describe` announces `plugin-rpc-v1`;
//    `plugin.<id>.<name>` matches `<name>` against the `rpc` keys, same envelope.
//  - Route/method with no entry: error envelope AND a record in `missing()` (the page shows an alert).
//  - storage, i18n, onEvent, os.openExternal and timers (ctx.setTimeout/setInterval): in memory.
import { PLUGIN_ID, RPC_CAPABILITY } from '../../shared/ids'
import type { Scenario, ScenarioRequest } from '../components/scenario'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { createMockCtx, emitEvent, rpcError, sdkMock } from '../test/sdk-mock'

export type { Scenario, ScenarioRequest, ScenarioValue } from '../components/scenario'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = any

export interface ScenarioRuntime {
  /** The fake ctx (also installed in lib/ctx). */
  ctx: Ctx
  /** Routes/methods requested with no entry in the scenario, in order (`'GET /tabs'`, `'RPC organize.run'`). */
  missing(): string[]
  /** Notifies on each new miss (the page redraws the alert). */
  subscribe(listener: () => void): () => void
  /** Delivers a gateway event to the listeners (`ctx.onEvent`). */
  emit(type: string, payload: unknown): void
  /** Undoes: ctx, RPC handlers and timers. */
  dispose(): void
}

/** Matches `'GET /jobs/{id}'` against method + path (the query is ignored). Returns the parameters or null. */
export function matchRoute(key: string, method: string, path: string): Record<string, string> | null {
  const space = key.indexOf(' ')
  if (space < 0) return null
  if (key.slice(0, space).toUpperCase() !== method.toUpperCase()) return null
  const want = key.slice(space + 1).split('?')[0].split('/').filter(Boolean)
  const got = path.split('?')[0].split('/').filter(Boolean)
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const m = want[i].match(/^\{(\w+)\}$/)
    if (m) params[m[1]] = safeDecode(got[i])
    else if (want[i] !== got[i]) return null
  }
  return params
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function queryOf(path: string): Record<string, string> {
  const q = path.split('?')[1]
  return q ? Object.fromEntries(new URLSearchParams(q)) : {}
}

/** A thrown `{code, message}` becomes the contract error; anything else becomes `internal`. */
function errorOf(thrown: unknown): { code: string; message: string } {
  const e = thrown as { code?: unknown; message?: unknown } | null
  if (e && typeof e === 'object' && typeof e.code === 'string') return { code: e.code, message: typeof e.message === 'string' ? e.message : e.code }
  return { code: 'internal', message: thrown instanceof Error ? thrown.message : String(thrown) }
}

async function envelope(value: unknown, arg: unknown): Promise<unknown> {
  try {
    const data = typeof value === 'function' ? await (value as (a: unknown) => unknown)(arg) : value
    return { ok: true, data }
  } catch (thrown) {
    return { ok: false, error: errorOf(thrown) }
  }
}

/** Installs the scenario's fake ctx (lib/ctx + plugin i18n + host RPC). */
export function installScenario(scenario: Scenario, pluginId: string = PLUGIN_ID): ScenarioRuntime {
  const handle = createMockCtx(pluginId)
  const ctx = handle.ctx
  const missing: string[] = []
  const listeners = new Set<() => void>()
  const miss = (what: string) => {
    missing.push(what)
    console.error(`[preview] scenario "${scenario.id}" has no response for ${what}`)
    for (const l of [...listeners]) l()
  }

  ctx.rest = async (path: string, init?: { method?: string; body?: unknown }) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    sdkMock.restCalls.push({ path, opts: init })
    for (const [key, value] of Object.entries(scenario.rest ?? {})) {
      const params = matchRoute(key, method, path)
      if (!params) continue
      const req: ScenarioRequest = { method, path: path.split('?')[0], params, query: queryOf(path), body: init?.body }
      return envelope(value, req)
    }
    const what = `${method} ${path.split('?')[0]}`
    miss(what)
    return { ok: false, error: { code: 'internal', message: `preview: scenario has no entry for ${what}` } }
  }

  const prefix = `plugin.${pluginId}.`
  const previousHandler = sdkMock.requestHandler
  sdkMock.requestHandler = (method: string, params?: Record<string, unknown>) => {
    const table = scenario.rpc ?? {}
    if (method.startsWith(prefix)) {
      const name = method.slice(prefix.length)
      if (name in table) return envelope(table[name], params ?? {})
      miss(`RPC ${name}`)
      return { ok: false, error: { code: 'internal', message: `preview: scenario has no entry for RPC ${name}` } }
    }
    if (method in table) {
      const value = table[method]
      return Promise.resolve(typeof value === 'function' ? (value as (p: unknown) => unknown)(params ?? {}) : value)
    }
    if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
    miss(`RPC ${method}`)
    return Promise.reject(rpcError(-32601, `preview: scenario has no entry for ${method}`))
  }

  setPluginContext(ctx)
  registerLocales(ctx)

  return {
    ctx,
    missing: () => [...missing],
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (type, payload) => emitEvent(type, payload),
    dispose() {
      handle.dispose()
      sdkMock.requestHandler = previousHandler
      setPluginContext(null)
      listeners.clear()
    }
  }
}
