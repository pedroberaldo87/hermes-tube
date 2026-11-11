// Preview scenario collector, browser side: the fake `ctx` each scenario installs.
// `rest` matches method + route (with path parameters) and returns the envelope; `request` (RPC) likewise through the
// `rpc` map; a route with no entry becomes a VISIBLE error on the page. storage, i18n, onEvent, os and clocks in memory.
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_ID } from '../../shared/ids'
import { maybePluginContext } from '../lib/ctx'
import { useT } from '../lib/i18n'
import { TubeApiError, restCall, restCallLoose } from '../lib/rest'
import { callRpc } from '../lib/rpc'
import { ScenarioView } from '../preview/ScenarioView'
import { type Scenario, type ScenarioRuntime, installScenario, matchRoute } from '../preview/scenario'
import { flush, render } from './render'
import { emitEvent, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ example scenario (this test's fixture)

function Probe() {
  const t = useT()
  const [out, setOut] = useState<string[]>([])
  useEffect(() => {
    void (async () => {
      const lines: string[] = []
      const feed = await restCall('GET /feed', { query: { tab: 'all' } } as never).catch((e: TubeApiError) => `err:${e.code}`)
      lines.push(`feed:${JSON.stringify(feed)}`)
      const job = await restCallLoose('GET /jobs/{id}', { path: { id: 'j42' } })
      lines.push(`job:${JSON.stringify(job)}`)
      const rpc = await callRpc('theme.create', { theme: 'agents' } as never)
      lines.push(`rpc:${rpc.kind}:${JSON.stringify(rpc.kind === 'ok' ? rpc.data : null)}`)
      const missing = await restCallLoose('GET /tabs').catch((e: TubeApiError) => `err:${e.code}`)
      lines.push(`tabs:${String(missing)}`)
      setOut(lines)
    })()
  }, [])
  return (
    <div data-probe>
      <span>{t('kit.approval.not_now')}</span>
      {out.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  )
}

const EXAMPLE: Scenario = {
  id: 'example',
  title: 'Collector example',
  widths: [360],
  rest: {
    'GET /feed': (req) => ({ items: [], tab: req.query.tab }),
    'GET /jobs/{id}': (req) => ({ id: req.params.id, status: 'running' }),
    'POST /boom': () => {
      throw { code: 'invalid', message: 'bad input' }
    },
    'GET /static': { fixed: true }
  },
  rpc: {
    'theme.create': (params) => ({ job_id: 'job-1', echo: params.theme }),
    'cleanup.scan': () => {
      throw { code: 'llm_unavailable', message: 'no model' }
    }
  },
  render: () => <Probe />
}

let runtime: ScenarioRuntime | null = null
afterEach(() => {
  runtime?.dispose()
  runtime = null
})

describe('matchRoute', () => {
  it('matches method and path, with parameters and without the query', () => {
    expect(matchRoute('GET /feed', 'GET', '/feed?tab=all')).toEqual({})
    expect(matchRoute('GET /jobs/{id}', 'GET', '/jobs/j%2042')).toEqual({ id: 'j 42' })
    expect(matchRoute('GET /jobs/{id}', 'POST', '/jobs/1')).toBeNull()
    expect(matchRoute('GET /jobs/{id}', 'GET', '/jobs/1/cancel')).toBeNull()
    expect(matchRoute('POST /channels/{id}/folder', 'POST', '/channels/UCx/folder')).toEqual({ id: 'UCx' })
  })
})

describe('the scenario\'s fake ctx', () => {
  it('installs the ctx through lib/ctx and answers rest with the envelope', async () => {
    runtime = installScenario(EXAMPLE, PLUGIN_ID)
    const ctx = maybePluginContext()
    expect(ctx).toBe(runtime.ctx)
    await expect(ctx?.rest('/static', { method: 'GET' })).resolves.toEqual({ ok: true, data: { fixed: true } })
    await expect(ctx?.rest('/feed?tab=tech')).resolves.toEqual({ ok: true, data: { items: [], tab: 'tech' } })
    await expect(ctx?.rest('/boom', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', message: 'bad input' }
    })
    await expect(restCall('GET /jobs/{id}', { path: { id: 'j1' } } as never)).resolves.toEqual({ id: 'j1', status: 'running' })
    expect(runtime.missing()).toEqual([])
  })

  it('RPC through the `rpc` map: runtime.describe announces the capability; a thrown error becomes an error envelope', async () => {
    runtime = installScenario(EXAMPLE, PLUGIN_ID)
    await expect(callRpc('theme.create', { theme: 'ai' } as never)).resolves.toEqual({ kind: 'ok', data: { job_id: 'job-1', echo: 'ai' } })
    await expect(callRpc('cleanup.scan', {} as never)).resolves.toEqual({
      kind: 'error',
      error: { code: 'llm_unavailable', message: 'no model' }
    })
  })

  it('route or method with no entry: error in the envelope AND recorded as missing (never silent)', async () => {
    runtime = installScenario(EXAMPLE, PLUGIN_ID)
    await expect(restCallLoose('GET /tabs')).rejects.toBeInstanceOf(TubeApiError)
    const rpc = await callRpc('organize.run', {} as never)
    expect(rpc.kind).toBe('error')
    expect(runtime.missing()).toEqual(['GET /tabs', 'RPC organize.run'])
  })

  it('storage, i18n, onEvent and os.openExternal work in memory; dispose undoes them', async () => {
    runtime = installScenario(EXAMPLE, PLUGIN_ID)
    const ctx = runtime.ctx
    ctx.storage.set('k', 1)
    expect(ctx.storage.get('k', 0)).toBe(1)
    const got: unknown[] = []
    ctx.onEvent('plugin.x', (e: { payload?: unknown }) => got.push(e.payload))
    emitEvent('plugin.x', { n: 1 })
    runtime.emit('plugin.x', { n: 2 })
    expect(got).toEqual([{ n: 1 }, { n: 2 }])
    await ctx.os.openExternal('https://www.youtube.com/watch?v=x')
    expect(sdkMock.openedExternal).toContain('https://www.youtube.com/watch?v=x')
    let ticks = 0
    ctx.setTimeout(() => ticks++, 1)
    await new Promise((r) => setTimeout(r, 10))
    expect(ticks).toBe(1)
    runtime.dispose()
    runtime = null
    expect(maybePluginContext()).toBeNull()
  })
})

describe('ScenarioView', () => {
  it('renders the scenario, shows the fake data and the missing-route error on the page', async () => {
    runtime = installScenario(EXAMPLE, PLUGIN_ID)
    const v = render(<ScenarioView scenario={EXAMPLE} runtime={runtime} />)
    await flush(20)
    const text = v.text()
    expect(text).toContain('Not now') // the plugin i18n registered in the fake ctx
    expect(text).toContain('feed:{"items":[],"tab":"all"}')
    expect(text).toContain('job:{"id":"j42","status":"running"}')
    expect(text).toContain('rpc:ok:{"job_id":"job-1","echo":"agents"}')
    expect(text).toContain('tabs:err:internal')
    const alert = v.container.querySelector('[data-preview-missing]')
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('GET /tabs')
    expect(v.container.querySelector('[data-scenario-id]')?.getAttribute('data-scenario-id')).toBe('example')
  })

  it('a scenario that throws while rendering shows the error (not a blank screen)', () => {
    const broken: Scenario = {
      id: 'broken',
      title: 'Broken',
      render: () => {
        throw new Error('kaboom')
      }
    }
    runtime = installScenario(broken, PLUGIN_ID)
    const v = render(<ScenarioView scenario={broken} runtime={runtime} />)
    expect(v.container.querySelector('[data-preview-crash]')?.textContent).toContain('kaboom')
  })
})
