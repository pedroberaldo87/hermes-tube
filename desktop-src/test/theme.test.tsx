// New topic tab (dialog): field with examples and options; steps in order through the events
// (`theme.progress`/`theme.ready` bring the GET /jobs/{id} poll forward) with each step's number; stop; preview
// (grid, seeds, name, folder, partial preview, 👎 with undo); save through `theme.save` with the choices, open the tab
// in Subscriptions and undo; resume (jobId, themeId, kept in storage); each error (no model, busy, job error, empty
// search, expired, save, no RPC); i18n EN = PT-BR; preview scenarios. Fake backend per route; no network.
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, ThemePreview, ThemeSaved, ThemeStep, Video } from '../../shared/api-types'
import { DESKTOP_ROUTES, PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import enCommon from '../locales/en/common.json'
import enTheme from '../locales/en/theme.json'
import ptTheme from '../locales/pt-BR/theme.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { interpolate, registerLocales } from '../lib/i18n'
import { HOME_TAB_KEY, PENDING_KEY, SETTINGS_PATH, ThemeDialog } from '../dialogs/theme'
import { absorbProgress, createParams, stepStates, stripHints } from '../dialogs/theme/model'
import { scenarios } from '../dialogs/theme/preview.scenarios'
import { ScenarioView } from '../preview/ScenarioView'
import { installScenario } from '../preview/scenario'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { advance, click, flush, render } from './render'
import { createMockCtx, emitEvent, rpcError, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ texts

type Tree = { [k: string]: Tree | string }

function pick(tree: Tree, key: string): string {
  let node: Tree | string = tree
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return node
}

const en = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enTheme as unknown as Tree, key), vars)
const enC = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enCommon as unknown as Tree, key), vars)

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

// ------------------------------------------------------------------ fixtures

const NOW_S = Math.floor(Date.now() / 1000)
const vid = (n: number) => `vid${String(n).padStart(8, '0')}`
const cid = (n: number) => `UC${String(n).padStart(22, 'x')}`

function video(n: number, ch: number): Video {
  return {
    id: vid(n),
    channel_id: cid(ch),
    title: `Video ${n}`,
    published_at: NOW_S - n * 86400,
    description: null,
    channel_title: `Channel ${ch}`,
    duration_s: 600 + n,
    is_short: false,
    views: 1000 * n,
    first_seen_at: NOW_S,
    origin: 'search'
  }
}

function preview(over: { items?: number; error?: string | null; status?: ThemePreview['theme']['status']; seeds?: number[] } = {}): ThemePreview {
  const count = over.items ?? 6
  const seeds = over.seeds ?? [1, 2, 3]
  const videos: Record<string, Video> = {}
  const items = Array.from({ length: count }, (_, i) => {
    const v = video(i + 1, (i % 3) + 1)
    videos[v.id] = v
    return { theme_id: 'th_1', video_id: v.id, verdict: 'keep' as const, source: 'search' as const, score: 0.9 - i * 0.01, reason: `Reason ${i + 1}` }
  })
  return {
    theme: {
      id: 'th_1',
      query: 'AI agents',
      status: over.status ?? 'preview',
      created_at: NOW_S,
      name: 'AI Agents',
      icon: '🤖',
      tab_id: over.status === 'saved' ? 'tab_th1' : null,
      searches: ['ai agents'],
      seeds: seeds.map(cid),
      include_terms: [],
      exclude_terms: [],
      last_search_at: NOW_S,
      cadence_days: 7,
      error: over.error ?? null
    },
    items,
    videos,
    seeds: seeds.map((n) => ({ channel_id: cid(n), title: `Seed ${n}`, kept_videos: 3 + n })),
    channel_count: 3
  }
}

function job(id: string, status: Job['status'], progress: Job['progress'] = null, result: unknown = null, error: Job['error'] = null): Job {
  return { id, kind: 'theme', status, created_at: NOW_S, updated_at: NOW_S, progress, result, error }
}

/** Core progress; `step` = structured numbers (`[done, total]` in the screen's unit). */
const P = (stage: string, done: number, total: number | null, message: string | null, step?: [number, number | null]): NonNullable<Job['progress']> => ({
  stage,
  done,
  total,
  message,
  ...(step ? { step: { name: stage as ThemeStep, done: step[0], total: step[1] } } : {})
})

const SAVED: ThemeSaved = {
  theme_id: 'th_1',
  tab: {
    id: 'tab_th1',
    name: 'AI Agents',
    kind: 'theme',
    rules: {
      include: { folders: [], tags: [], channels: [], themes: ['th_1'], lenses: [], all: false, favorites: false },
      exclude: { folders: [], tags: [], channels: [], shorts: false },
      filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
      mode: 'classics'
    },
    icon: '🤖',
    filters: {},
    sort: 5,
    builtin: false
  },
  folder_id: null,
  followed: [],
  to_subscribe: [],
  change_id: 52
}

// ------------------------------------------------------------------ fake backend

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

type Route = (req: Req) => unknown

let routes: Record<string, Route>
let calls: Req[]
let rpcs: Record<string, (params: Record<string, unknown> | undefined) => unknown>
let capability: boolean
let storage: Map<string, unknown>
let jobState: Job

const apiError = (code: string, message = code) => ({ code, message })
const ok = (data: unknown) => ({ ok: true, data })
const fail = (code: string, message = code) => ({ ok: false, error: apiError(code, message) })

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /jobs/{id}': () => jobState,
    'GET /jobs': () => ({ items: [] }),
    'GET /themes/{id}': () => preview(),
    'GET /channels': () => ({ items: [], total: 0 }),
    'POST /videos/state': (req) => ({ changed: (req.body as { video_ids: string[] }).video_ids.length }),
    'POST /changes/{id}/undo': () => ({ undone: [] })
  }
}

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET')
    const query = Object.fromEntries(new URLSearchParams(qs))
    const req: Req = { method, path, query, body: opts?.body }
    calls.push(req)
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ')
      return m === method && new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`).test(path)
    })
    if (!key) return { ok: false, error: apiError('not_found', `no route ${method} ${path}`) }
    return Promise.resolve()
      .then(() => routes[key](req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
  sdkMock.requestHandler = (method, params) => {
    if (method === 'runtime.describe') return { capabilities: capability ? [RPC_CAPABILITY] : [] }
    const short = method.startsWith(`plugin.${PLUGIN_ID}.`) ? method.slice(`plugin.${PLUGIN_ID}.`.length) : method
    const h = rpcs[short]
    if (!h) throw rpcError(-32601, `unknown method ${method}`)
    return h(params)
  }
}

const restTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
const rpcCalls = (name: string) => sdkMock.requests.filter((r) => r.method === rpcMethod(name as never))
const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1] as { kind: string; message: string; action?: { label: string; onClick: () => void } }
const phase = (root: ParentNode) => q(root, '[data-part="theme"]')?.getAttribute('data-phase')
const primary = (root: ParentNode) => q(document, '[data-part="theme-primary"]') ?? q(root, '[data-part="theme-primary"]')
const secondary = (root: ParentNode) => q(document, '[data-part="theme-secondary"]') ?? q(root, '[data-part="theme-secondary"]')
const steps = (root: ParentNode) => qa(root, '[data-part="steps"] > li').map((li) => li.getAttribute('data-status'))
const stepDetails = (root: ParentNode) => qa(root, '[data-part="steps"] > li').map((li) => li.querySelector('[class*="step-detail"]')?.textContent ?? '')
const cards = (root: ParentNode) => qa(root, '[data-part="card"][data-video]').map((c) => c.getAttribute('data-video'))

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

async function mount(props: Parameters<typeof ThemeDialog>[0] = { onClose: () => undefined }) {
  const v = render(<ThemeDialog {...props} />)
  await flush(15)
  return v
}

/** Mounts, types, asks for the preview: returns the view already following job `job_3`. */
async function startJob(text = 'AI agents', props: Partial<Parameters<typeof ThemeDialog>[0]> = {}) {
  const onClose = vi.fn()
  const v = await mount({ onClose, ...props })
  type(q(v.container, '[data-part="theme-query"]') as HTMLInputElement, text)
  click(primary(v.container))
  await flush(15)
  return { v, onClose }
}

async function progress(p: Job['progress']) {
  jobState = job('job_3', 'running', p)
  emitEvent(`plugin.${PLUGIN_ID}.theme.progress`, { job: 'job_3', progress: p })
  await flush(15)
}

async function finish(result: ThemePreview = preview()) {
  jobState = job('job_3', 'done', P('preview', 1, 1, `${result.items.length} vídeos de 3 canais, ${result.seeds.length} sementes`), result)
  emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'done' })
  await flush(20)
}

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  storage = handle.storage
  routes = defaultRoutes()
  calls = []
  capability = true
  jobState = job('job_3', 'queued')
  rpcs = {
    'theme.create': () => ok({ job: job('job_3', 'queued') }),
    'theme.save': () => ok(SAVED)
  }
  install()
})

// ------------------------------------------------------------------ pure model

describe('model', () => {
  it('createParams sends language and classics as fields (the text goes clean, with no hint attached)', () => {
    expect(createParams('  AI agents ', { language: 'any', classics: false })).toEqual({ query: 'AI agents' })
    expect(createParams('AI agents', { language: 'pt', classics: true })).toEqual({ query: 'AI agents', language: 'pt', classics: true })
    expect(createParams('AI agents', { language: 'en', classics: false })).toEqual({ query: 'AI agents', language: 'en' })
    expect(createParams('x'.repeat(250), { language: 'any', classics: false }).query.length).toBeLessThanOrEqual(200)
    // older topics (with the hint attached to the text) still show clean
    expect(stripHints(`AI agents ${en('hints.lang_pt')} ${en('hints.classics')}`, (k) => en(k))).toBe('AI agents')
  })

  it('absorbProgress reads the numbers from progress.step (never the digits of the message)', () => {
    let c = absorbProgress({}, P('expand', 1, 1, '999 buscas', [8, 8]))
    expect(c.searches).toBe(8)
    c = absorbProgress(c, P('search', 0, 16, 'Buscando 8 pesquisas no YouTube…', [0, null]))
    expect(c).toEqual({ searches: 8 })
    c = absorbProgress(c, P('search', 16, 16, '1 2 3', [212, 212]))
    expect(c.found).toBe(212)
    c = absorbProgress(c, P('curate', 1, 2, '777 de 888', [120, 212]))
    expect(c).toMatchObject({ searches: 8, found: 212, rated: 120 })
    c = absorbProgress(c, P('preview', 1, 1, null, [37, 212]))
    expect(c).toMatchObject({ rated: 212, kept: 37 })
    // without step (older core): no number comes out of the message
    expect(absorbProgress({}, P('curate', 1, 2, '120 de 212 vídeos avaliados'))).toEqual({})
  })

  it('stepStates: before = done, current = running, after = waiting; an error marks the current one', () => {
    expect(stepStates('curate', 'running')).toEqual(['done', 'done', 'running', 'waiting'])
    expect(stepStates(null, 'running')).toEqual(['running', 'waiting', 'waiting', 'waiting'])
    expect(stepStates('search', 'error')).toEqual(['done', 'failed', 'waiting', 'waiting'])
    expect(stepStates('preview', 'done')).toEqual(['done', 'done', 'done', 'done'])
  })
})

// ------------------------------------------------------------------ field

describe('initial field', () => {
  it('question, clickable examples fill the field; main action off with fewer than 2 letters', async () => {
    const v = await mount()
    expect(phase(v.container)).toBe('form')
    expect(v.text()).toContain(en('field.label'))
    expect(primary(v.container)?.textContent).toBe(en('footer.start'))
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(true)
    const examples = qa(v.container, '[data-part="theme-example"]')
    expect(examples.map((e) => e.textContent)).toEqual(['ex1', 'ex2', 'ex3', 'ex4', 'ex5'].map((k) => en(`examples.${k}`)))
    click(examples[2])
    expect((q(v.container, '[data-part="theme-query"]') as HTMLInputElement).value).toBe(en('examples.ex3'))
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(false)
    // the dismiss action never uses the main one's verb
    expect(secondary(v.container)?.textContent).toBe(en('footer.not_now'))
  })

  it('the query from the props comes filled in; Enter in the field asks for the preview with theme.create', async () => {
    const v = await mount({ onClose: () => undefined, query: 'rust' })
    const input = q(v.container, '[data-part="theme-query"]') as HTMLInputElement
    expect(input.value).toBe('rust')
    key(input, 'Enter')
    await flush(15)
    expect(rpcCalls('theme.create').map((r) => r.params)).toEqual([{ query: 'rust' }])
  })

  it('subtle options go as theme.create fields (language, classics), not as a hint in the text', async () => {
    const v = await mount()
    type(q(v.container, '[data-part="theme-query"]') as HTMLInputElement, 'AI agents')
    click(q(v.container, '[data-part="theme-lang"][data-value="pt"]'))
    expect(q(v.container, '[data-part="theme-lang"][data-value="pt"]')?.getAttribute('aria-pressed')).toBe('true')
    click(q(v.container, '[data-part="theme-classics"]'))
    click(primary(v.container))
    await flush(15)
    expect(rpcCalls('theme.create')[0].params).toEqual({ query: 'AI agents', language: 'pt', classics: true })
  })
})

// ------------------------------------------------------------------ progress

describe('progress by step', () => {
  it('steps in order through the events, with the number each one produced', async () => {
    const { v } = await startJob()
    expect(phase(v.container)).toBe('progress')
    expect(steps(v.container)).toEqual(['running', 'waiting', 'waiting', 'waiting'])
    expect(qa(v.container, '[data-part="steps"] > li').map((li) => li.textContent)).toEqual([
      expect.stringContaining(en('steps.expand')),
      expect.stringContaining(en('steps.search')),
      expect.stringContaining(en('steps.curate')),
      expect.stringContaining(en('steps.preview'))
    ])

    await progress(P('expand', 1, 1, '8 buscas planejadas', [8, 8]))
    expect(stepDetails(v.container)[0]).toBe(en('steps.searches_other', { count: '8' }))

    await progress(P('search', 0, 16, 'Buscando 8 pesquisas no YouTube…', [0, null]))
    expect(steps(v.container)).toEqual(['done', 'running', 'waiting', 'waiting'])
    expect(stepDetails(v.container)[1]).toBe(en('steps.search_running_other', { count: '8' }))

    await progress(P('search', 16, 16, '212 vídeos encontrados', [212, 212]))
    await progress(P('curate', 1, 2, '120 de 212 vídeos avaliados', [120, 212]))
    expect(steps(v.container)).toEqual(['done', 'done', 'running', 'waiting'])
    expect(stepDetails(v.container).slice(0, 3)).toEqual([
      en('steps.searches_other', { count: '8' }),
      en('steps.found_other', { count: '212' }),
      en('steps.rated_progress', { done: '120', total: '212' })
    ])

    await finish(preview({ items: 6 }))
    expect(phase(v.container)).toBe('preview')
    // the kept count comes from the final preview
    expect(cards(v.container)).toHaveLength(6)
  })

  it('numbers in the app language (1.204 in PT-BR)', async () => {
    sdkMock.locale.set('pt-BR')
    const { v } = await startJob()
    await progress(P('search', 16, 16, '1204 vídeos encontrados', [1204, 1204]))
    expect(stepDetails(v.container)[1]).toBe('1.204 vídeos')
  })

  it('without progress.step (older core) the step shows only the message, no made-up number', async () => {
    const { v } = await startJob()
    await progress(P('search', 0, 16, 'Buscando 8 pesquisas no YouTube…'))
    expect(steps(v.container)).toEqual(['done', 'running', 'waiting', 'waiting'])
    expect(stepDetails(v.container)[1]).toBe('Buscando 8 pesquisas no YouTube…')
    expect(stepDetails(v.container)[0]).toBe('')
  })

  it('during progress the footer has "Cancel" and "Continue in background" (no disabled primary)', async () => {
    const { v } = await startJob()
    expect(phase(v.container)).toBe('progress')
    expect(primary(v.container)).toBeNull()
    expect(secondary(v.container)?.textContent).toBe(en('footer.cancel'))
    expect(qa(document.body, '[data-slot="dialog-footer"] button').map((b) => b.textContent)).toEqual([en('footer.cancel'), en('footer.background')])
  })

  it('another job\'s event brings nothing forward; the poll follows the right job', async () => {
    const { v } = await startJob()
    jobState = job('job_3', 'running', P('search', 0, 16, null))
    emitEvent(`plugin.${PLUGIN_ID}.theme.progress`, { job: 'job_9', progress: P('curate', 1, 2, null) })
    await flush(10)
    expect(steps(v.container)).toEqual(['running', 'waiting', 'waiting', 'waiting'])
  })

  it('"Cancel" calls job.cancel, goes back to the field with the text and the options; asking again works right away', async () => {
    rpcs['job.cancel'] = (p) => {
      jobState = job(String(p?.job_id), 'error', P('search', 0, 16, null, [0, null]), null, { code: 'cancelled', message: 'cancelado' })
      return ok({ job: jobState, cancelled: true })
    }
    const v = await mount()
    type(q(v.container, '[data-part="theme-query"]') as HTMLInputElement, 'AI agents')
    click(q(v.container, '[data-part="theme-lang"][data-value="en"]'))
    click(primary(v.container))
    await flush(15)
    expect(storage.get(PENDING_KEY)).toMatchObject({ jobId: 'job_3', query: 'AI agents' })
    click(secondary(v.container))
    await flush(15)
    expect(rpcCalls('job.cancel').map((r) => r.params)).toEqual([{ job_id: 'job_3' }])
    expect(phase(v.container)).toBe('form')
    expect(q(v.container, '[data-part="error"]')).toBeNull()
    expect((q(v.container, '[data-part="theme-query"]') as HTMLInputElement).value).toBe('AI agents')
    expect(q(v.container, '[data-part="theme-lang"][data-value="en"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(storage.has(PENDING_KEY)).toBe(false)
    // the backend already released the "one at a time": the next request goes out and is followed
    jobState = job('job_4', 'running', P('expand', 0, 1, null, [0, null]))
    rpcs['theme.create'] = () => ok({ job: job('job_4', 'queued') })
    routes['GET /jobs/{id}'] = () => jobState
    click(primary(v.container))
    await flush(15)
    expect(rpcCalls('theme.create')).toHaveLength(2)
    expect(phase(v.container)).toBe('progress')
  })

  it('job cancelled elsewhere (the poll sees error.code=cancelled) is not an error: back to the field', async () => {
    const { v } = await startJob()
    jobState = job('job_3', 'error', P('curate', 0, 2, null, [0, 212]), null, { code: 'cancelled', message: 'cancelado' })
    emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'error' })
    await flush(20)
    expect(phase(v.container)).toBe('form')
    expect(q(v.container, '[data-part="error"]')).toBeNull()
    expect((q(v.container, '[data-part="theme-query"]') as HTMLInputElement).value).toBe('AI agents')
  })

  it('gateway without job.cancel (before the restart): says it did not work and keeps following', async () => {
    const { v } = await startJob() // rpcs without 'job.cancel' → -32601
    click(secondary(v.container))
    await flush(15)
    expect(rpcCalls('job.cancel')).toHaveLength(1)
    expect(phase(v.container)).toBe('progress')
    expect(q(v.container, '[data-part="theme-cancel-failed"]')?.textContent).toContain(en('progress.cancel_failed'))
    expect(storage.get(PENDING_KEY)).toMatchObject({ jobId: 'job_3' })
    // keeps following: the job finishes and the preview shows
    await finish()
    expect(phase(v.container)).toBe('preview')
  })

  it('cancelling when the job has just finished (cancelled: false) shows the result', async () => {
    rpcs['job.cancel'] = () => {
      jobState = job('job_3', 'done', P('preview', 1, 1, null, [6, 6]), preview())
      return ok({ job: jobState, cancelled: false })
    }
    const { v } = await startJob()
    click(secondary(v.container))
    await flush(20)
    expect(phase(v.container)).toBe('preview')
  })
})

// ------------------------------------------------------------------ honest wait

const elapsedText = (root: ParentNode) => q(root, '[data-part="theme-elapsed"]')?.textContent?.trim() ?? null

describe('honest wait', () => {
  it('real steps with the current one marked, the numbers, the elapsed time (fake clock) and an honest promise', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const { v } = await startJob()
    expect(en('progress.lead')).toBe('This usually takes 1–3 minutes: Hermes is reading the candidates one by one.')
    expect(q(v.container, '[data-part="theme-lead"]')?.textContent).toBe(en('progress.lead'))
    expect(q(v.container, '[data-part="theme-background-hint"]')?.textContent).toBe(en('progress.background'))
    expect(elapsedText(v.container)).toBe('0:00')
    expect(q(v.container, '[data-part="theme-elapsed"]')?.getAttribute('aria-label')).toBe(en('progress.elapsed', { time: '0:00' }))
    await progress(P('search', 16, 16, null, [160, 160]))
    await progress(P('curate', 0, 4, null, [0, 160]))
    await advance(83_000)
    expect(elapsedText(v.container)).toBe('1:23')
    expect(steps(v.container)).toEqual(['done', 'done', 'running', 'waiting'])
    expect(stepDetails(v.container)[1]).toBe(en('steps.found_other', { count: '160' }))
    expect(stepDetails(v.container)[2]).toBe(en('steps.rated_progress', { done: '0', total: '160' }))
    jobState = job('job_3', 'running', P('curate', 2, 4, null, [80, 160]))
    await advance(2_100) // the 2 s poll brings the next numbers
    expect(stepDetails(v.container)[2]).toBe(en('steps.rated_progress', { done: '80', total: '160' }))
    expect(elapsedText(v.container)).toBe('1:25')
    // no fake progress bar: only the steps list
    expect(q(v.container, '[role="progressbar"]')).toBeNull()
  })

  it('in PT-BR the promise is honest too', async () => {
    sdkMock.locale.set('pt-BR')
    const { v } = await startJob()
    expect(q(v.container, '[data-part="theme-lead"]')?.textContent).toBe('Costuma levar de 1 a 3 minutos: o Hermes lê os candidatos um por um.')
    expect(qa(document.body, '[data-slot="dialog-footer"] button').map((b) => b.textContent)).toEqual(['Cancelar', 'Continuar em segundo plano'])
  })

  it('no locale promises "about a minute" / "cerca de um minuto"', () => {
    const files = listRepoFiles('desktop-src/locales', ['.json'])
    expect(files.length).toBeGreaterThan(4)
    for (const f of files) expect(readRepoFile(f), f).not.toMatch(/about a minute|cerca de um minuto/i)
  })

  it('reopened on the job (Home notice): the time counts from the stored request, not from the reopening', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    storage.set(PENDING_KEY, { jobId: 'job_3', query: 'Astrophysics', at: Date.now() - 95_000 })
    jobState = job('job_3', 'running', P('curate', 0, 4, null, [0, 160]))
    const v = await mount({ onClose: () => undefined, jobId: 'job_3' })
    expect(phase(v.container)).toBe('progress')
    expect(q(v.container, '[data-part="theme-asked"]')?.textContent).toBe('“Astrophysics”')
    expect(elapsedText(v.container)).toBe('1:35')
  })

  it('nothing stored (another window started it): the time counts from the job created_at', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    jobState = { ...job('job_3', 'running', P('search', 0, 16, null, [0, null])), created_at: Math.floor(Date.now() / 1000) - 30 }
    const v = await mount({ onClose: () => undefined, jobId: 'job_3' })
    expect(elapsedText(v.container)).toBe('0:30')
  })
})

// ------------------------------------------------------------------ background

describe('background', () => {
  it('"Continue in background" closes without job.cancel; the job stays stored with the exact request', async () => {
    rpcs['job.cancel'] = () => ok({ job: jobState, cancelled: true })
    const v = await mount({ onClose: vi.fn() })
    type(q(v.container, '[data-part="theme-query"]') as HTMLInputElement, 'Astrophysics')
    click(q(v.container, '[data-part="theme-lang"][data-value="en"]'))
    click(primary(v.container))
    await flush(15)
    click(q(document.body, '[data-part="theme-background"]'))
    await flush(10)
    expect(rpcCalls('job.cancel')).toHaveLength(0)
    expect(storage.get(PENDING_KEY)).toMatchObject({ jobId: 'job_3', query: 'Astrophysics', params: { query: 'Astrophysics', language: 'en' } })
    expect((storage.get(PENDING_KEY) as { seen?: boolean }).seen).toBeUndefined()
  })

  it('closing the dialog (✕, Esc, click outside: the same onOpenChange(false)) does not cancel', async () => {
    rpcs['job.cancel'] = () => ok({ job: jobState, cancelled: true })
    const onClose = vi.fn()
    const { v } = await startJob('Astrophysics', { onClose })
    click(q(document.body, '[data-slot="dialog-dismiss"]'))
    await flush(10)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(rpcCalls('job.cancel')).toHaveLength(0)
    expect(storage.get(PENDING_KEY)).toMatchObject({ jobId: 'job_3', query: 'Astrophysics' })
    expect(phase(v.container)).toBe('progress')
  })

  it('"Cancel" still cancels (job.cancel) and drops the stored job', async () => {
    rpcs['job.cancel'] = (p) => {
      jobState = job(String(p?.job_id), 'error', null, null, { code: 'cancelled', message: 'cancelled' })
      return ok({ job: jobState, cancelled: true })
    }
    const { v } = await startJob('Astrophysics')
    expect(secondary(v.container)?.textContent).toBe(en('footer.cancel'))
    click(secondary(v.container))
    await flush(15)
    expect(rpcCalls('job.cancel').map((r) => r.params)).toEqual([{ job_id: 'job_3' }])
    expect(phase(v.container)).toBe('form')
    expect(storage.has(PENDING_KEY)).toBe(false)
  })

  it('the preview on screen marks the job as seen (Home will not announce it again)', async () => {
    const { v } = await startJob()
    expect((storage.get(PENDING_KEY) as { seen?: boolean }).seen).toBeUndefined()
    await finish()
    expect(phase(v.container)).toBe('preview')
    expect(storage.get(PENDING_KEY)).toMatchObject({ jobId: 'job_3', seen: true })
  })
})

// ------------------------------------------------------------------ preview

describe('preview', () => {
  it('grid + editable name + seeds with a choice + folder; the footer saves', async () => {
    const { v } = await startJob()
    await finish()
    expect(cards(v.container)).toEqual([1, 2, 3, 4, 5, 6].map(vid))
    expect((q(v.container, '[data-part="theme-name"]') as HTMLInputElement).value).toBe('AI Agents')
    expect(qa(v.container, '[data-part="theme-seed"]').map((r) => r.getAttribute('data-channel'))).toEqual([cid(1), cid(2), cid(3)])
    // default: follow
    for (const r of qa(v.container, '[data-part="theme-seed"]')) expect(q(r, '[data-part="seed-follow"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(q(v.container, '[data-part="theme-seed"]')?.textContent).toContain(en('preview.seed_kept_other', { count: '4' }))
    expect(primary(v.container)?.textContent).toBe(en('footer.save'))
    expect(q(v.container, '[data-part="banner"]')).toBeNull()
    // the AI reason stays visible on the card
    expect(q(v.container, `[data-video="${vid(1)}"]`)?.textContent).toContain('Reason 1')
  })

  it('seed choices, name, folder and removed items go in theme.save', async () => {
    routes['GET /channels'] = (req) =>
      req.query.ids
        ? { items: [{ channel: { id: cid(3), title: 'Seed 3', relation: 'subscribed' }, new_count: 0, watched_90d: null }], total: 1 }
        : { items: [], total: 0 }
    const onClose = vi.fn()
    const { v } = await startJob('AI agents', { onClose })
    await finish()
    // seed 3 is already in the list: no choice
    expect(q(v.container, `[data-part="theme-seed"][data-channel="${cid(3)}"]`)?.textContent).toContain(en('preview.in_list'))
    click(q(q(v.container, `[data-part="theme-seed"][data-channel="${cid(2)}"]`)!, '[data-part="seed-ignore"]'))
    type(q(v.container, '[data-part="theme-name"]') as HTMLInputElement, 'Agents!')
    click(q(v.container, '[data-part="theme-folder"]'))
    expect(primary(v.container)?.textContent).toBe(en('footer.save_folder'))
    click(q(q(v.container, `[data-video="${vid(2)}"]`)!, '[data-action="down"]'))
    await flush(10)
    click(primary(v.container))
    await flush(15)
    expect(rpcCalls('theme.save').map((r) => r.params)).toEqual([
      {
        theme_id: 'th_1',
        edits: {
          name: 'Agents!',
          icon: '🤖',
          create_folder: true,
          folder_name: 'Agents!',
          seed_actions: { [cid(1)]: 'follow', [cid(2)]: 'ignore' },
          removed_video_ids: [vid(2)]
        }
      }
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('follow all / ignore all', async () => {
    const { v } = await startJob()
    await finish()
    click(q(v.container, '[data-part="seeds-ignore-all"]'))
    for (const r of qa(v.container, '[data-part="theme-seed"]')) expect(q(r, '[data-part="seed-ignore"]')?.getAttribute('aria-pressed')).toBe('true')
    click(q(v.container, '[data-part="seeds-follow-all"]'))
    for (const r of qa(v.container, '[data-part="theme-seed"]')) expect(q(r, '[data-part="seed-follow"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('empty or long name: error in the field and save off', async () => {
    const { v } = await startJob()
    await finish()
    type(q(v.container, '[data-part="theme-name"]') as HTMLInputElement, '   ')
    expect(v.text()).toContain(en('preview.name_empty'))
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(true)
    type(q(v.container, '[data-part="theme-name"]') as HTMLInputElement, 'x'.repeat(41))
    expect(v.text()).toContain(en('preview.name_long', { max: '40' }))
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(true)
  })

  it('👎 removes the video at once, counts as a signal (reaction down) and has undo', async () => {
    const { v } = await startJob()
    await finish()
    click(q(q(v.container, `[data-video="${vid(1)}"]`)!, '[data-action="down"]'))
    await flush(10)
    expect(cards(v.container)).not.toContain(vid(1))
    expect(restTo('POST', '/videos/state').map((c) => c.body)).toEqual([{ video_ids: [vid(1)], reaction: 'down' }])
    expect(lastNotification().message).toBe(en('toast.removed', { title: 'Video 1' }))
    act(() => lastNotification().action!.onClick())
    await flush(10)
    expect(cards(v.container)).toContain(vid(1))
    expect(restTo('POST', '/videos/state').map((c) => c.body)[1]).toEqual({ video_ids: [vid(1)], reaction: null })
  })

  it('👎 through the keyboard (D on the focused card)', async () => {
    const { v } = await startJob()
    await finish()
    const cell = q(v.container, '[role="gridcell"][data-index="0"]')!
    key(cell, 'd')
    await flush(10)
    expect(cards(v.container)).not.toContain(vid(1))
  })

  it('a 👎 that fails brings the video back and notifies', async () => {
    routes['POST /videos/state'] = () => {
      throw apiError('invalid')
    }
    const { v } = await startJob()
    await finish()
    click(q(q(v.container, `[data-video="${vid(1)}"]`)!, '[data-action="down"]'))
    await flush(10)
    expect(cards(v.container)).toContain(vid(1))
    expect(lastNotification().message).toBe(en('toast.down_failed', { error: enC('errors.invalid') }))
  })

  it('partial preview: strip marked as such, still possible to save', async () => {
    const { v } = await startJob()
    await finish(preview({ error: 'Prévia parcial: o tempo acabou com 120 de 150 avaliados.' }))
    const banner = q(v.container, '[data-part="banner"]')!
    expect(banner.textContent).toContain(en('preview.partial_title'))
    expect(banner.textContent).toContain('120 de 150')
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(false)
  })

  it('empty search: empty state suggesting to rephrase; rephrase goes back to the field with the text', async () => {
    const { v } = await startJob('zzqx')
    await finish(preview({ items: 0, seeds: [], error: 'Nenhum vídeo encontrado para este tema. Tente outras palavras.' }))
    const empty = q(v.container, '[data-part="empty"]')!
    expect(empty.textContent).toContain(en('empty.title', { query: 'AI agents' }))
    expect(primary(v.container)?.hasAttribute('disabled')).toBe(true)
    click(qa(empty, 'button').find((b) => b.textContent === en('footer.rephrase'))!)
    await flush()
    expect(phase(v.container)).toBe('form')
    const input = q(v.container, '[data-part="theme-query"]') as HTMLInputElement
    expect(input.value).toBe('zzqx')
    expect(document.activeElement).toBe(input)
  })
})

// ------------------------------------------------------------------ save

describe('save', () => {
  it('closes, opens the new tab in Subscriptions and offers undo (POST /changes/{id}/undo)', async () => {
    const onClose = vi.fn()
    const { v } = await startJob('AI agents', { onClose })
    await finish()
    click(primary(v.container))
    await flush(15)
    expect(onClose).toHaveBeenCalled()
    expect(storage.get(HOME_TAB_KEY)).toBe('tab_th1')
    expect(sdkMock.navigations).toContain(DESKTOP_ROUTES.home)
    expect(storage.has(PENDING_KEY)).toBe(false)
    const toast = lastNotification()
    expect(toast.message).toBe(en('toast.saved', { name: 'AI Agents' }))
    expect(toast.action?.label).toBe(en('toast.undo'))
    act(() => toast.action!.onClick())
    await flush(10)
    expect(restTo('POST', '/changes/52/undo')).toHaveLength(1)
    const undone = lastNotification()
    expect(undone.message).toBe(en('toast.undone', { name: 'AI Agents' }))
    act(() => undone.action!.onClick())
    expect($dialogStack.get().at(-1)).toMatchObject({ id: 'theme', props: { themeId: 'th_1' } })
  })

  it('saving: busy button, locked fields; ⌘↩ also saves', async () => {
    let resolve: (v: unknown) => void = () => undefined
    rpcs['theme.save'] = () => new Promise((r) => (resolve = r))
    const { v } = await startJob()
    await finish()
    key(q(v.container, '[data-part="theme-name"]')!, 'Enter', { metaKey: true })
    await flush(10)
    expect(phase(v.container)).toBe('saving')
    expect(primary(v.container)?.getAttribute('aria-busy')).toBe('true')
    expect(q(v.container, '[data-part="theme-name"]')?.hasAttribute('disabled')).toBe(true)
    resolve(ok(SAVED))
    await flush(10)
    expect(rpcCalls('theme.save')).toHaveLength(1)
  })

  it('save error (conflict): error strip, the preview stays; nothing closes', async () => {
    rpcs['theme.save'] = () => fail('conflict', 'already saved')
    const onClose = vi.fn()
    const { v } = await startJob('AI agents', { onClose })
    await finish()
    click(primary(v.container))
    await flush(15)
    expect(onClose).not.toHaveBeenCalled()
    const banner = q(v.container, '[data-part="banner"][data-tone="error"]')!
    expect(banner.textContent).toContain(en('error.conflict'))
    expect(cards(v.container)).toHaveLength(6)
  })

  it('undo error: notifies with the message', async () => {
    routes['POST /changes/{id}/undo'] = () => {
      throw apiError('undo_refused')
    }
    const { v } = await startJob()
    await finish()
    click(primary(v.container))
    await flush(15)
    act(() => lastNotification().action!.onClick())
    await flush(10)
    expect(lastNotification().message).toBe(en('toast.undo_failed', { error: enC('errors.undo_refused') }))
  })
})

// ------------------------------------------------------------------ resume

describe('resume', () => {
  it('through the jobId in the props: does not create another, follows the same one', async () => {
    jobState = job('job_3', 'running', P('curate', 1, 2, '120 de 212 vídeos avaliados', [120, 212]))
    const v = await mount({ onClose: () => undefined, jobId: 'job_3' })
    expect(rpcCalls('theme.create')).toHaveLength(0)
    expect(phase(v.container)).toBe('progress')
    expect(steps(v.container)).toEqual(['done', 'done', 'running', 'waiting'])
    expect(stepDetails(v.container)[1]).toBe(en('steps.found_other', { count: '212' }))
  })

  it('reopening without props resumes the stored job (and shows the preview if it already finished)', async () => {
    storage.set(PENDING_KEY, { jobId: 'job_3', query: 'AI agents', at: Date.now(), counts: { searches: 8 } })
    jobState = job('job_3', 'done', P('preview', 1, 1, null), preview())
    const v = await mount()
    expect(phase(v.container)).toBe('preview')
    expect(cards(v.container)).toHaveLength(6)
  })

  it('through the themeId: loads GET /themes/{id} (skeleton with the same geometry first)', async () => {
    let release: () => void = () => undefined
    routes['GET /themes/{id}'] = () => new Promise((r) => (release = () => r(preview())))
    const v = await mount({ onClose: () => undefined, themeId: 'th_1' })
    expect(phase(v.container)).toBe('loading')
    expect(qa(v.container, '[data-part="card"][data-skeleton]').length).toBeGreaterThan(0)
    expect(qa(v.container, '[data-part="suggestion-row"][data-skeleton]').length).toBeGreaterThan(0)
    release()
    await flush(15)
    expect(restTo('GET', '/themes/th_1')).toHaveLength(1)
    expect(cards(v.container)).toHaveLength(6)
  })

  it('topic already saved: says so and the main action opens it in Subscriptions', async () => {
    routes['GET /themes/{id}'] = () => preview({ status: 'saved' })
    const onClose = vi.fn()
    const v = await mount({ onClose, themeId: 'th_1' })
    expect(q(v.container, '[data-part="banner"]')?.textContent).toContain(en('preview.saved_title'))
    expect(primary(v.container)?.textContent).toBe(en('footer.open_home'))
    click(primary(v.container))
    expect(storage.get(HOME_TAB_KEY)).toBe('tab_th1')
    expect(sdkMock.navigations).toContain(DESKTOP_ROUTES.home)
    expect(onClose).toHaveBeenCalled()
    expect(rpcCalls('theme.save')).toHaveLength(0)
  })

  it('a job that no longer exists: says "expired" and goes back to the field with the stored text', async () => {
    storage.set(PENDING_KEY, { jobId: 'job_old', query: 'old theme', at: Date.now() })
    routes['GET /jobs/{id}'] = () => {
      throw apiError('not_found')
    }
    const v = await mount()
    expect(phase(v.container)).toBe('expired')
    expect(v.text()).toContain(en('error.expired_title'))
    expect(storage.has(PENDING_KEY)).toBe(false)
    click(primary(v.container))
    expect(phase(v.container)).toBe('form')
    expect((q(v.container, '[data-part="theme-query"]') as HTMLInputElement).value).toBe('old theme')
  })

  it('error loading the themeId: ErrorView with try again', async () => {
    let failing = true
    routes['GET /themes/{id}'] = () => {
      if (failing) throw apiError('internal', 'db locked')
      return preview()
    }
    const v = await mount({ onClose: () => undefined, themeId: 'th_1' })
    expect(q(v.container, '[data-part="error"]')).not.toBeNull()
    failing = false
    click(qa(q(v.container, '[data-part="error"]')!, 'button').find((b) => b.textContent === enC('retry'))!)
    await flush(15)
    expect(cards(v.container)).toHaveLength(6)
  })
})

// ------------------------------------------------------------------ errors

describe('errors', () => {
  it('no model: its own state with a path to Settings', async () => {
    rpcs['theme.create'] = () => fail('llm_unavailable', 'no model')
    const onClose = vi.fn()
    const { v } = await startJob('AI agents', { onClose })
    expect(phase(v.container)).toBe('no-model')
    expect(v.text()).toContain(en('no_model.title'))
    click(qa(v.container, 'button').find((b) => b.textContent === en('no_model.action'))!)
    expect(sdkMock.navigations).toContain(SETTINGS_PATH)
    expect(onClose).toHaveBeenCalled()
  })

  it('a model that goes away mid-job also falls into "no model"', async () => {
    const { v } = await startJob()
    jobState = job('job_3', 'error', P('curate', 0, 2, null), null, { code: 'llm_unavailable', message: 'gone' })
    emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'error' })
    await flush(15)
    expect(phase(v.container)).toBe('no-model')
  })

  it('busy: explains and "Follow" resumes the active job from GET /jobs?kind=theme', async () => {
    rpcs['theme.create'] = () => fail('busy', 'one at a time')
    routes['GET /jobs'] = () => ({ items: [job('job_7', 'running', P('search', 0, 16, null))] })
    const { v } = await startJob()
    expect(phase(v.container)).toBe('busy')
    expect(v.text()).toContain(en('busy.title'))
    jobState = job('job_7', 'running', P('search', 0, 16, null))
    routes['GET /jobs/{id}'] = (req) => (req.path.endsWith('job_7') ? jobState : job('x', 'error'))
    click(qa(v.container, 'button').find((b) => b.textContent === en('busy.follow'))!)
    await flush(15)
    expect(restTo('GET', '/jobs').map((c) => c.query)).toEqual([{ kind: 'theme' }])
    expect(phase(v.container)).toBe('progress')
    expect(steps(v.container)).toEqual(['done', 'running', 'waiting', 'waiting'])
  })

  it('job error: step marked as failed + ErrorView; try again creates another with the same text', async () => {
    const { v } = await startJob()
    await progress(P('search', 0, 16, null))
    jobState = job('job_3', 'error', P('search', 0, 16, null), null, { code: 'youtube_error', message: 'search down' })
    emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'error' })
    await flush(15)
    expect(phase(v.container)).toBe('error')
    expect(steps(v.container)).toEqual(['done', 'failed', 'waiting', 'waiting'])
    const err = q(v.container, '[data-part="error"]')!
    expect(err.textContent).toContain(enC('errors.youtube_error'))
    expect(storage.has(PENDING_KEY)).toBe(false)
    click(qa(err, 'button').find((b) => b.textContent === enC('retry'))!)
    await flush(15)
    expect(rpcCalls('theme.create').map((r) => r.params)).toEqual([{ query: 'AI agents' }, { query: 'AI agents' }])
  })

  it('error requesting (internal): ErrorView, never a false empty preview', async () => {
    rpcs['theme.create'] = () => fail('internal', 'boom')
    const { v } = await startJob()
    expect(phase(v.container)).toBe('error')
    expect(q(v.container, '[data-part="empty"]')).toBeNull()
    expect(cards(v.container)).toHaveLength(0)
  })

  it('refused text (invalid): error in the field itself', async () => {
    rpcs['theme.create'] = () => fail('invalid', 'bad')
    const { v } = await startJob()
    expect(phase(v.container)).toBe('form')
    expect(v.text()).toContain(en('field.invalid'))
  })

  it('no RPC on this backend: notice to open from Desktop', async () => {
    capability = false
    const { v } = await startJob()
    expect(phase(v.container)).toBe('unavailable')
    expect(q(v.container, '[data-rpc-unavailable]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ finishing touches

describe('finishing touches', () => {
  const description = () => q(document.body, '[data-slot="dialog-description"]')

  it('saved topic: the "nothing is saved…" subtitle and the 👎 hint go away; the preview is read-only', async () => {
    routes['GET /themes/{id}'] = () => preview({ status: 'saved' })
    const v = await mount({ onClose: () => undefined, themeId: 'th_1' })
    expect(phase(v.container)).toBe('preview')
    expect(description()).toBeNull()
    expect(v.text()).not.toContain(en('description'))
    expect(v.text()).not.toContain(en('preview.videos_desc'))
    expect(v.text()).not.toContain(en('preview.seeds_desc'))
    expect(qa(v.container, '[data-action="down"]')).toHaveLength(0)
    expect(q(v.container, '[data-part="theme-name"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('preview not saved yet: subtitle and hint stay (that is where the decision happens)', async () => {
    const { v } = await startJob()
    await finish()
    expect(description()?.textContent).toBe(en('description'))
    expect(v.text()).toContain(en('preview.videos_desc'))
  })

  it('each video\'s reason takes up to 2 lines (not cut to one)', async () => {
    const { v } = await startJob()
    await finish()
    const whys = qa(v.container, '[data-part="card"][data-video] [data-part="why"]')
    expect(whys).toHaveLength(6)
    for (const w of whys) {
      expect(w.getAttribute('data-lines')).toBe('2')
      expect(w.style.whiteSpace).toBe('normal')
    }
    // after removing and restoring a video, the card that comes back does too
    click(q(q(v.container, `[data-video="${vid(1)}"]`)!, '[data-action="down"]'))
    await flush(10)
    act(() => lastNotification().action!.onClick())
    await flush(10)
    expect(q(v.container, `[data-video="${vid(1)}"] [data-part="why"]`)?.getAttribute('data-lines')).toBe('2')
  })

  it('"Tab name" and the topic field are the SDK Input (app frame), with a linked label', async () => {
    const v = await mount()
    const query = q(v.container, '[data-part="theme-query"]')!
    expect(query.getAttribute('data-slot')).toBe('input')
    expect(q(v.container, `label[for="${query.id}"]`)?.textContent).toBe(en('field.label'))
    type(query as HTMLInputElement, 'AI agents')
    click(primary(v.container))
    await flush(15)
    await finish()
    const name = q(v.container, '[data-part="theme-name"]')!
    expect(name.getAttribute('data-slot')).toBe('input')
    expect(q(v.container, `label[for="${name.id}"]`)?.textContent).toContain(en('preview.name_label'))
  })
})

describe('model configured but its provider is unreachable', () => {
  const PROVIDER = 'claude-subscription-directsdk-experimental'
  const SONNET = 'claude-sonnet-5-5'
  const ROUTE = `${PROVIDER} · ${SONNET}`
  const AUX_PATH = `/settings?tab=config:model&aux=${PLUGIN_ID.replace(/-/g, '_')}_curator`
  const UNREACHABLE = { available: false, model: SONNET, reason: 'provider_unavailable', provider: PROVIDER }
  const OK = { available: true, model: SONNET, reason: null, provider: PROVIDER }

  it('the job failed and the status now says provider_unavailable → "couldn\'t reach", with settings and try again', async () => {
    let statusCalls = 0
    routes['GET /ai/status'] = () => (++statusCalls === 1 ? OK : UNREACHABLE)
    const onClose = vi.fn()
    const { v } = await startJob('astrophysics', { onClose })
    jobState = job('job_3', 'error', P('expand', 0, 1, null), null, { code: 'llm_unavailable', message: 'unreachable' })
    emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'error' })
    await flush(20)
    expect(phase(v.container)).toBe('provider-unavailable')
    expect(v.text()).toContain(en('provider_unavailable.title'))
    expect(v.text()).toContain(enC('provider_unavailable', { route: ROUTE }))
    expect(v.text()).not.toContain(en('no_model.title'))
    click(qa(v.container, 'button').find((b) => b.textContent === en('provider_unavailable.retry'))!)
    await flush(15)
    expect(rpcCalls('theme.create')).toHaveLength(2)
  })

  it('theme.create refused with details.reason provider_unavailable → the same state; the button opens the task row', async () => {
    rpcs['theme.create'] = () => ({
      ok: false,
      error: { code: 'llm_unavailable', message: 'x', details: { reason: 'provider_unavailable', provider: null, model: SONNET } }
    })
    const onClose = vi.fn()
    const { v } = await startJob('astrophysics', { onClose })
    expect(phase(v.container)).toBe('provider-unavailable')
    expect(v.text()).toContain(enC('provider_unavailable', { route: SONNET }))
    click(qa(v.container, 'button').find((b) => b.textContent?.includes(en('provider_unavailable.action')))!)
    expect(sdkMock.navigations).toContain(AUX_PATH)
    expect(onClose).toHaveBeenCalled()
  })

  it('another llm_unavailable (status still available) → the error itself, not "pick a model"', async () => {
    routes['GET /ai/status'] = () => OK
    const { v } = await startJob()
    jobState = job('job_3', 'error', P('curate', 0, 2, null), null, { code: 'llm_unavailable', message: 'The AI provider failed: HTTP 500' })
    emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: 'job_3', status: 'error' })
    await flush(20)
    expect(phase(v.container)).toBe('error')
    expect(v.text()).toContain('The AI provider failed: HTTP 500')
    expect(v.text()).not.toContain(en('no_model.title'))
  })

  it('before the click: status provider_unavailable → notice in the field with the route', async () => {
    routes['GET /ai/status'] = () => UNREACHABLE
    const onClose = vi.fn()
    const v = await mount({ onClose })
    const warn = q(v.container, '[data-part="theme-ai-warning"]')
    expect(warn?.textContent).toContain(en('ai.provider_unavailable_title'))
    expect(warn?.textContent).toContain(enC('provider_unavailable', { route: ROUTE }))
    expect(warn?.textContent).not.toContain(en('ai.no_model_title'))
    click(q(warn!, '[data-part="banner-action"]'))
    expect(sdkMock.navigations).toContain(AUX_PATH)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('model before the click (GET /ai/status)', () => {
  it('explicit available: false → notice in the field, with a path to Settings; the request is still possible', async () => {
    routes['GET /ai/status'] = () => ({ available: false, model: null, reason: 'no_model' })
    const onClose = vi.fn()
    const v = await mount({ onClose })
    const warn = q(v.container, '[data-part="theme-ai-warning"]')
    expect(warn?.textContent).toContain(en('ai.no_model_title'))
    click(q(warn!, '[data-part="banner-action"]'))
    expect(sdkMock.navigations).toContain(SETTINGS_PATH)
    expect(onClose).toHaveBeenCalled()
  })

  it('missing route, with an error or slow = "unknown": no notice and no blocking', async () => {
    const a = await mount() // no route → not_found
    expect(q(a.container, '[data-part="theme-ai-warning"]')).toBeNull()
    a.unmount()
    routes['GET /ai/status'] = () => new Promise(() => undefined)
    const b = await mount({ onClose: () => undefined, query: 'rust' })
    expect(q(b.container, '[data-part="theme-ai-warning"]')).toBeNull()
    expect(primary(b.container)?.hasAttribute('disabled')).toBe(false)
    b.unmount()
    routes['GET /ai/status'] = () => ({ available: true, model: 'm', reason: null })
    const c = await mount()
    expect(q(c.container, '[data-part="theme-ai-warning"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ i18n, style and preview

describe('i18n', () => {
  it('EN = PT-BR keys (theme)', () => {
    expect(leafKeys(ptTheme as unknown as Tree).sort()).toEqual(leafKeys(enTheme as unknown as Tree).sort())
  })

  it('in PT-BR the dialog speaks Portuguese', async () => {
    sdkMock.locale.set('pt-BR')
    const v = await mount()
    expect(v.text()).toContain('Sobre o que você quer uma aba?')
    expect(primary(v.container)?.textContent).toBe('Montar prévia')
  })
})

describe('dialog style', () => {
  it('className only through cx(...) in the topic tab dialog files (no utility class)', () => {
    const files = listRepoFiles('desktop-src/dialogs/theme', ['.ts', '.tsx'])
    expect(files.length).toBeGreaterThan(0)
    const bad: string[] = []
    for (const f of files) {
      const code = readRepoFile(f)
      for (const m of code.matchAll(/\bclassName\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
        const expr = m[1]
        if (/^["']/.test(expr) || !/^\{(withClass\()?cx\(/.test(expr)) bad.push(`${f}: ${expr}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('preview scenarios', () => {
  it('unique ids, widths 420/900 and the minimum states', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of scenarios) expect(s.widths).toEqual([420, 900])
    for (const want of ['form', 'form-no-model', 'expand', 'search', 'curate', 'building', 'cancel-failed', 'preview', 'partial', 'saving', 'saved', 'empty', 'no-model', 'error', 'busy', 'loading'])
      expect(ids).toContain(`theme-${want}`)
  })

  it.each(scenarios.map((s) => [s.id, s] as const))('%s renders with no missing route and no error', async (_id, s) => {
    const runtime = installScenario(s, PLUGIN_ID)
    try {
      const v = render(<ScenarioView scenario={s} runtime={runtime} />)
      await flush(25)
      expect(v.container.querySelector('[data-preview-crash]')).toBeNull()
      expect(runtime.missing()).toEqual([])
      expect(v.container.querySelector('[data-part="theme"]')).not.toBeNull()
      v.unmount()
    } finally {
      runtime.dispose()
    }
  })
})
