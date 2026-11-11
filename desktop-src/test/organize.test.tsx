// Organize with Hermes: opening (count, model, what will happen), progress by batch with the
// suggestions showing as they arrive, result by folder (new one marked), accept group/one/all with the
// right calls (optimistic), decline with an undo window, change the folder (becomes `edits`), undo the
// whole organize run, resume by id, `busy`, `llm_unavailable`, partial error, nothing to organize, no RPC,
// preview scenarios and EN = PT-BR.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeRecord, Channel, ChannelRow, Folder, Job, Suggestion } from '../../shared/api-types'
import { DESKTOP_ROUTES, JOB_POLL_MS, PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import { OrganizeDialog } from '../dialogs/organize'
import {
  REJECT_GRACE_MS,
  curatorTask,
  groupItems,
  mergeSuggestions,
  missingChannels,
  modelSettingsPath,
  proposalOf
} from '../dialogs/organize/model'
import { scenarios } from '../dialogs/organize/preview.scenarios'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { currentSection } from '../lib/nav'
import enCommon from '../locales/en/common.json'
import enJson from '../locales/en/organize.json'
import ptJson from '../locales/pt-BR/organize.json'
import { ScenarioView } from '../preview/ScenarioView'
import { installScenario, type ScenarioRuntime } from '../preview/scenario'
import { advance, click, flush, render } from './render'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { createMockCtx, emitEvent, rpcError, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }
const EN = enJson as unknown as Tree
const PT = ptJson as unknown as Tree

/** EN text of a key in the `organize` namespace (fails if the key does not exist). */
function L(key: string, vars: Record<string, string | number> = {}): string {
  let node: Tree | string | undefined = EN
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
  if (typeof node !== 'string') throw new Error(`chave ausente em en/organize.json: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}

const NOW_S = 1_762_700_000
const MODEL = 'claude-haiku-5-5'

// ------------------------------------------------------------------ data

function channel(id: string, title: string, folder_id: string | null = null): Channel {
  return {
    id,
    title,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S,
    handle: null,
    thumb: null,
    url: null,
    folder_id,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: null,
    videos_per_week: null,
    shorts_ratio: null,
    ai_note: null,
    tag_ids: []
  }
}

const row = (c: Channel): ChannelRow => ({ channel: c, new_count: 0, watched_90d: null })

const C = {
  fire: channel('UCsBjURrPoezykLs9EqgamOA', 'Fireship'),
  mkbhd: channel('UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee'),
  veri: channel('UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium'),
  kurz: channel('UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt'),
  kenji: channel('UCqqJQ_cXSat0KIAVfIfKkVA', 'J. Kenji López-Alt'),
  babish: channel('UCJHA_jMfCvEnv-3kRjTCQXw', 'Binging with Babish'),
  beato: channel('UCJquYOG5EL82sKTfH9aMA9Q', 'Rick Beato')
}
const ALL = Object.values(C)

function sug(id: string, c: Channel, folder: string, extra: Partial<Record<string, unknown>> = {}, model: string | null = MODEL): Suggestion {
  return {
    id,
    kind: 'organize',
    status: 'pending',
    payload: {
      channel_id: c.id,
      channel_title: c.title,
      folder,
      new_folder: false,
      tags: [],
      confidence: 0.9,
      why: `${c.title} fala de ${folder}`,
      ...extra
    },
    created_at: NOW_S,
    channel_id: c.id,
    model,
    decided_at: null
  }
}

// Tecnologia (exists): fire, mkbhd · Ciência (exists): veri, kurz · Culinária (new): kenji, babish
const S = {
  fire: sug('sg_fire', C.fire, 'Tecnologia', { tags: ['dev'], confidence: 0.92 }),
  mkbhd: sug('sg_mkbhd', C.mkbhd, 'Tecnologia', { confidence: 0.81 }),
  veri: sug('sg_veri', C.veri, 'Ciência'),
  kurz: sug('sg_kurz', C.kurz, 'Ciência'),
  kenji: sug('sg_kenji', C.kenji, 'Culinária', { new_folder: true }),
  babish: sug('sg_babish', C.babish, 'Culinária', { new_folder: true })
}
const SIX = [S.fire, S.mkbhd, S.veri, S.kurz, S.kenji, S.babish]

function job(id: string, status: Job['status'], extra: Partial<Job> = {}): Job {
  return { id, kind: 'organize', status, created_at: NOW_S, updated_at: NOW_S, progress: null, result: null, error: null, ...extra }
}

const progress = (done: number, total: number) => ({ stage: 'organize', done, total, message: `lote ${Math.ceil(done / 60)}` })

const FOLDERS: Folder[] = [
  { id: 'f_tec', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_cie', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'f_fis', name: 'Física', parent_id: 'f_cie', color: null, sort: 0 }
]

function change(id: number, group_id: string | null, undone_at: number | null = null): ChangeRecord {
  return { id, ts: NOW_S, actor: 'user', action: 'channel_move', payload: {}, undo: {}, group_id, undone_at }
}

// ------------------------------------------------------------------ fake backend

interface Req {
  body?: any
  query: URLSearchParams
  params: Record<string, string>
}
type Route = unknown | ((req: Req) => unknown)

function backend(routes: Record<string, Route>) {
  sdkMock.restHandler = (path, opts) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const [p, qs = ''] = path.split('?')
    for (const [key, route] of Object.entries(routes)) {
      const [m, tmpl] = key.split(' ')
      if (m !== method) continue
      const names: string[] = []
      const re = new RegExp(`^${tmpl.replace(/\{(\w+)\}/g, (_x, n: string) => (names.push(n), '([^/]+)'))}$`)
      const hit = p.match(re)
      if (!hit) continue
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]))
      const req: Req = { body: opts?.body, query: new URLSearchParams(qs), params }
      return Promise.resolve()
        .then(() => (typeof route === 'function' ? (route as (r: Req) => unknown)(req) : route))
        .then(
          (data) => ({ ok: true, data }),
          (error: unknown) => ({ ok: false, error })
        )
    }
    return { ok: false, error: { code: 'not_found', message: `no route ${method} ${p}` } }
  }
}

interface World {
  channels?: Channel[]
  suggestions?: () => Suggestion[]
  jobs?: Job[]
  job?: () => Job
  changes?: ChangeRecord[]
  extra?: Record<string, Route>
}

function world(w: World = {}) {
  backend({
    'GET /channels': (req: Req) => {
      const list = (w.channels ?? ALL).filter((c) => (req.query.get('folder') === 'none' ? c.folder_id === null : true))
      return { items: list.map(row), total: list.length }
    },
    'GET /suggestions': () => ({ items: w.suggestions ? w.suggestions() : [] }),
    'GET /jobs': () => ({ items: w.jobs ?? [] }),
    'GET /jobs/{id}': (req: Req) => (w.job ? w.job() : job(req.params.id, 'running')),
    'GET /folders': { items: FOLDERS },
    'GET /changes': { items: w.changes ?? [] },
    'POST /changes/{id}/undo': (req: Req) => ({ undone: [change(Number(req.params.id), 'grp_1', NOW_S)] }),
    ...(w.extra ?? {})
  })
}

const okEnv = (data: unknown) => ({ ok: true, data })
const errEnv = (code: string, message = code) => ({ ok: false, error: { code, message } })

interface Rpc {
  capability?: boolean
  run?: (params: any) => unknown
  accept?: (params: any) => unknown
  reject?: (params: any) => unknown
  /** `job.cancel`. Without it, the gateway does not know the method (before the restart): -32601. */
  cancel?: (params: any) => unknown
}

function rpc(r: Rpc = {}) {
  sdkMock.requestHandler = (method, params) => {
    if (method === 'runtime.describe') return { capabilities: r.capability === false ? [] : [RPC_CAPABILITY] }
    if (method === rpcMethod('job.cancel') && r.cancel) return r.cancel(params)
    if (method === rpcMethod('organize.run')) return r.run ? r.run(params) : okEnv({ job: job('job_1', 'queued') })
    if (method === rpcMethod('organize.accept'))
      return r.accept ? r.accept(params) : okEnv({ accepted: params?.suggestion_ids ?? [], created_folders: [], created_tags: [], change_group: 'grp_1' })
    if (method === rpcMethod('organize.reject'))
      return r.reject ? r.reject(params) : okEnv({ count: (params?.suggestion_ids as string[] | undefined)?.length ?? 0 })
    throw rpcError(-32601, `unknown method ${method}`)
  }
}

const calls = (name: Parameters<typeof rpcMethod>[0]) => sdkMock.requests.filter((r) => r.method === rpcMethod(name)).map((r) => r.params)
const restCalls = (method: string, path: string) =>
  sdkMock.restCalls.filter((c) => String(c.opts?.method ?? 'GET') === method && c.path.split('?')[0] === path)

const $ = (root: ParentNode, sel: string) => root.querySelector(sel)
const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)]
const view = (root: ParentNode) => $(root, '[data-part="organize"]')?.getAttribute('data-view')
const groupEl = (root: ParentNode, folder: string) =>
  $$(root, '[data-part="sgroup"]').find((g) => (g.querySelector('h3')?.textContent ?? '').includes(folder)) ?? null
const rowEl = (root: ParentNode, title: string) =>
  $$(root, '[data-part="suggestion-row"]').find((r) => (r.querySelector('[class$="srow-subject"]')?.textContent ?? r.textContent ?? '').includes(title)) ?? null
const statusOf = (root: ParentNode, title: string) => rowEl(root, title)?.getAttribute('data-status')

function typeInto(input: Element | null, value: string) {
  if (!input) throw new Error('typeInto: campo ausente')
  act(() => {
    const el = input as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(target: Element | null, k: string, mods: KeyboardEventInit = {}) {
  if (!target) throw new Error('key: alvo ausente')
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }))
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let onClose: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_S * 1000)
  const h = createMockCtx(PLUGIN_ID)
  setPluginContext(h.ctx)
  registerLocales(h.ctx)
  onClose = vi.fn<() => void>()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Dialog opened with suggestions already pending (direct review). */
async function openReview(w: World = {}, r: Rpc = {}) {
  let pending = [...SIX]
  world({ suggestions: () => pending, ...w })
  rpc(r)
  const v = render(<OrganizeDialog onClose={onClose} />)
  await flush(10)
  return { v, setPending: (s: Suggestion[]) => (pending = s) }
}

// ------------------------------------------------------------------ model (pure)

describe('model', () => {
  it('proposal read from the payload defensively (odd field → null/default)', () => {
    expect(proposalOf(S.kenji)).toMatchObject({ channelId: C.kenji.id, folder: 'Culinária', newFolder: true, confidence: 0.9 })
    expect(proposalOf({ ...S.fire, payload: { folder: 3 } })).toBeNull()
    expect(proposalOf({ ...S.fire, payload: { ...S.fire.payload, confidence: 'x', tags: 'a' } })).toMatchObject({ confidence: null, tags: [] })
  })

  it('groups by folder in the order they appeared; new folder marked; the same folder spelled differently merges', () => {
    const items = mergeSuggestions([], [S.veri, S.fire, S.kenji, { ...S.kurz, payload: { ...S.kurz.payload, folder: 'ciência ' } }], () => false, true)
    const groups = groupItems(items)
    expect(groups.map((g) => [g.folder, g.isNew, g.items.length])).toEqual([
      ['Ciência', false, 2],
      ['Tecnologia', false, 1],
      ['Culinária', true, 1]
    ])
  })

  it('merging keeps the order, adds the new and only prunes what left the server and is not protected', () => {
    const a = mergeSuggestions([], [S.fire, S.veri], () => false, true)
    const b = mergeSuggestions(a, [S.kenji, S.veri], (id) => id === 'sg_fire', true)
    expect(b.map((i) => i.suggestion.id)).toEqual(['sg_fire', 'sg_veri', 'sg_kenji'])
    const c = mergeSuggestions(b, [S.veri], () => false, true)
    expect(c.map((i) => i.suggestion.id)).toEqual(['sg_veri'])
    const d = mergeSuggestions(b, [S.mkbhd], () => false, false)
    expect(d.map((i) => i.suggestion.id)).toEqual(['sg_fire', 'sg_veri', 'sg_kenji', 'sg_mkbhd'])
  })

  it('channels without a suggestion = targets minus the ones with a suggestion', () => {
    const items = mergeSuggestions([], [S.fire, S.veri], () => false, true)
    expect(missingChannels([C.fire.id, C.veri.id, C.beato.id, C.kurz.id], items)).toEqual([C.beato.id, C.kurz.id])
  })

  it('the settings path leads to the plugin\'s auxiliary task (no id literal)', () => {
    expect(curatorTask()).toBe(`${PLUGIN_ID.replace(/-/g, '_')}_curator`)
    expect(modelSettingsPath()).toBe(`/settings?tab=config:model&aux=${curatorTask()}`)
  })
})

// ------------------------------------------------------------------ opening

describe('opening', () => {
  it('counts the channels without a folder, says nothing changes without accepting, shows the model and starts', async () => {
    world({ channels: [...ALL, channel('UCaaaaaaaaaaaaaaaaaaaaaa', 'Already in a folder', 'f_tec')] })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('intro')
    expect($(v.container, '[data-part="organize-count"]')?.textContent).toContain('7')
    expect(v.text()).toContain(L('intro.lead'))
    expect($(v.container, '[data-part="organize-model"]')?.textContent).toContain('mock-model')
    // the requested list is the channels without a folder, followed or subscribed
    const q = new URLSearchParams(restCalls('GET', '/channels')[0].path.split('?')[1])
    expect(q.get('folder')).toBe('none')
    expect(q.get('relation')).toBe('subscribed,followed')
    // no AI before the click
    expect(calls('organize.run')).toHaveLength(0)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(calls('organize.run')).toEqual([{}])
    expect(view(v.container)).toBe('running')
  })

  it('with the selection from Manage: counts the selection and sends the ids', async () => {
    world()
    rpc()
    const v = render(<OrganizeDialog channelIds={[C.fire.id, C.beato.id]} onClose={onClose} />)
    await flush(10)
    expect($(v.container, '[data-part="organize-count"]')?.textContent).toContain('2')
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(calls('organize.run')).toEqual([{ channel_ids: [C.fire.id, C.beato.id] }])
  })

  it('loading: skeleton with the opening geometry (no false "0")', async () => {
    backend({ 'GET /channels': () => new Promise(() => undefined), 'GET /suggestions': { items: [] }, 'GET /jobs': { items: [] } })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(5)
    expect(view(v.container)).toBe('boot')
    expect($(v.container, '[data-skeleton]')).not.toBeNull()
    expect($(v.container, '[data-part="organize-count"]')).toBeNull()
  })

  it('failure counting: error with try again (never "0 channels")', async () => {
    let fail = true
    world({
      extra: {
        'GET /channels': () => {
          if (fail) throw { code: 'internal', message: 'db locked' }
          return { items: ALL.map(row), total: ALL.length }
        }
      }
    })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('error')
    expect($(v.container, '[data-part="organize-count"]')).toBeNull()
    fail = false
    click($$(v.container, '[data-part="error"] button')[0] ?? null)
    await flush(10)
    expect(view(v.container)).toBe('intro')
  })

  it('nothing to organize: empty state with a way forward (Manage)', async () => {
    world({ channels: [channel('UCaaaaaaaaaaaaaaaaaaaaaa', 'Already in a folder', 'f_tec')] })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('nothing')
    expect(v.text()).toContain(L('nothing.title'))
    click($(v.container, '[data-part="organize-open-manage"]'))
    // one page only: the Manage section inside it, never the old Manage route
    expect(currentSection()).toBe('manage')
    expect(sdkMock.navigations).not.toContain(DESKTOP_ROUTES.manage)
    expect(sdkMock.navigations).toContain(DESKTOP_ROUTES.home)
    expect(onClose).toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ progress

describe('progress by batch', () => {
  it('"120 of 400" bar, suggestions showing as they arrive, without waiting for the end', async () => {
    let state = job('job_1', 'running', { progress: progress(0, 400) })
    let pending: Suggestion[] = []
    world({ suggestions: () => pending, job: () => state })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(view(v.container)).toBe('running')
    // first batch arrives
    state = job('job_1', 'running', { progress: progress(120, 400) })
    pending = [S.fire, S.veri]
    await advance(JOB_POLL_MS)
    await flush(10)
    const bar = $(v.container, '[data-part="organize-progress"]')
    expect(bar?.getAttribute('role')).toBe('progressbar')
    expect(bar?.getAttribute('aria-valuenow')).toBe('30')
    expect(v.text()).toContain(L('progress.channels', { done: '120', total: '400' }))
    expect($$(v.container, '[data-part="suggestion-row"]:not([data-skeleton])')).toHaveLength(2)
    // what already arrived can be accepted while the job runs
    expect(rowEl(v.container, 'Fireship')?.querySelector('[data-part="suggestion-accept"]')).not.toBeNull()
    // second batch
    state = job('job_1', 'running', { progress: progress(240, 400) })
    pending = [S.fire, S.veri, S.kenji, S.mkbhd]
    await advance(JOB_POLL_MS)
    await flush(10)
    expect($$(v.container, '[data-part="suggestion-row"]:not([data-skeleton])')).toHaveLength(4)
    // end
    state = job('job_1', 'done', { progress: progress(400, 400), result: { suggestions: SIX, model: MODEL } })
    pending = SIX
    await advance(JOB_POLL_MS)
    await flush(10)
    expect(view(v.container)).toBe('review')
    expect($$(v.container, '[data-part="suggestion-row"]')).toHaveLength(6)
  })

  it('the organize.done event brings the job poll forward', async () => {
    let state = job('job_1', 'running', { progress: progress(0, 6) })
    world({ suggestions: () => [], job: () => state })
    rpc()
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    const before = restCalls('GET', '/jobs/job_1').length
    state = job('job_1', 'done', { progress: progress(6, 6), result: { suggestions: [], model: MODEL } })
    act(() => emitEvent(`plugin.${PLUGIN_ID}.organize.done`, { job: 'job_1', status: 'done' }))
    await flush(10)
    expect(restCalls('GET', '/jobs/job_1').length).toBeGreaterThan(before)
    expect(view(v.container)).not.toBe('running')
  })

  it('closing with the job running cancels nothing (it continues in the background)', async () => {
    world({ job: () => job('job_1', 'running', { progress: progress(60, 400) }) })
    rpc()
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-background"]'))
    expect(onClose).toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ resume and busy

describe('resume and busy', () => {
  it('resumes by the id in the props: follows GET /jobs/{id} without starting another job', async () => {
    world({ job: () => job('job_7', 'running', { progress: progress(120, 400) }) })
    rpc()
    const v = render(<OrganizeDialog jobId="job_7" onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('running')
    expect(restCalls('GET', '/jobs/job_7').length).toBeGreaterThan(0)
    expect(calls('organize.run')).toHaveLength(0)
  })

  it('closed and reopened midway: finds the active job through GET /jobs?kind=organize and resumes', async () => {
    world({ jobs: [job('job_8', 'running')], job: () => job('job_8', 'running', { progress: progress(60, 400) }) })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(new URLSearchParams(restCalls('GET', '/jobs')[0].path.split('?')[1]).get('kind')).toBe('organize')
    expect(view(v.container)).toBe('running')
    expect(restCalls('GET', '/jobs/job_8').length).toBeGreaterThan(0)
    expect(calls('organize.run')).toHaveLength(0)
  })

  it('busy: one is already running → follows the existing one and says so', async () => {
    let jobs: Job[] = []
    world({ extra: { 'GET /jobs': () => ({ items: jobs }) }, job: () => job('job_9', 'running', { progress: progress(60, 400) }) })
    rpc({
      run: () => {
        jobs = [job('job_9', 'running')]
        return errEnv('busy', 'An organization is already running')
      }
    })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(15)
    expect(view(v.container)).toBe('running')
    expect(restCalls('GET', '/jobs/job_9').length).toBeGreaterThan(0)
    expect($(v.container, '[data-part="organize-notice"]')?.textContent).toContain(L('notice.busy'))
  })

  it('busy without an active organize job (full queue): error with try again', async () => {
    world()
    rpc({ run: () => errEnv('busy', 'cheio') })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(15)
    expect(view(v.container)).toBe('error')
    expect($(v.container, '[data-part="error"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ no model / no RPC / error

describe('no model, no RPC, error', () => {
  it('llm_unavailable: explains and leads to the model settings (no dead end)', async () => {
    world()
    rpc({ run: () => errEnv('llm_unavailable', 'no model') })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(view(v.container)).toBe('no_model')
    expect(v.text()).toContain(L('no_model.title'))
    click($(v.container, '[data-part="organize-choose-model"]'))
    expect(sdkMock.navigations).toEqual([modelSettingsPath()])
    expect(onClose).toHaveBeenCalled()
  })

  it('no model: try again after setting it up calls organize.run again', async () => {
    let n = 0
    world()
    rpc({ run: () => (++n === 1 ? errEnv('llm_unavailable') : okEnv({ job: job('job_1', 'queued') })) })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    click($(v.container, '[data-part="organize-retry"]'))
    await flush(10)
    expect(calls('organize.run')).toHaveLength(2)
    expect(view(v.container)).toBe('running')
  })

  it('no RPC on this backend: notice to open from Desktop', async () => {
    world()
    rpc({ capability: false })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(view(v.container)).toBe('unavailable')
    expect($(v.container, '[data-rpc-unavailable]')).not.toBeNull()
  })

  it('the job ended in error (no batch came back): error with try again', async () => {
    world({ job: () => job('job_1', 'error', { error: { code: 'llm_invalid', message: 'invalid output' } }) })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(15)
    expect(view(v.container)).toBe('error')
    click($$(v.container, '[data-part="error"] button')[0] ?? null)
    await flush(10)
    expect(calls('organize.run')).toHaveLength(2)
  })
})

// ------------------------------------------------------------------ result

describe('result by folder', () => {
  it('groups by folder, new folder marked, channel with reason and confidence; model in view', async () => {
    const { v } = await openReview()
    expect(view(v.container)).toBe('review')
    expect($$(v.container, '[data-part="sgroup"]')).toHaveLength(3)
    expect(groupEl(v.container, 'Culinária')?.querySelector('[data-part="organize-new-folder"]')).not.toBeNull()
    expect(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="organize-new-folder"]')).toBeNull()
    const fire = rowEl(v.container, 'Fireship')
    expect(fire?.textContent).toContain('Fireship fala de Tecnologia')
    expect(fire?.textContent).toContain('92%')
    expect(fire?.textContent).toContain('#dev')
    expect($(v.container, '[data-part="organize-summary"]')?.textContent).toContain(MODEL)
    expect($(v.container, '[data-part="organize-accept-all"]')?.textContent).toContain('6')
  })

  it('accept the group: optimistic at once, organize.accept with the group\'s ids, invalidates the rest of the app', async () => {
    const d = deferred<unknown>()
    const { v } = await openReview({}, { accept: () => d.promise })
    const before = restCalls('GET', '/channels').length
    click(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush()
    // optimistic: already shows accepted before the response
    expect(statusOf(v.container, 'Fireship')).toBe('accepted')
    expect(statusOf(v.container, 'Marques Brownlee')).toBe('accepted')
    expect(statusOf(v.container, 'Veritasium')).toBe('pending')
    expect(calls('organize.accept')).toEqual([{ suggestion_ids: ['sg_fire', 'sg_mkbhd'] }])
    d.resolve(okEnv({ accepted: ['sg_fire', 'sg_mkbhd'], created_folders: [], created_tags: [], change_group: 'grp_1' }))
    await flush(10)
    expect(restCalls('GET', '/channels').length).toBeGreaterThan(before) // pane/Subscriptions refetch
    expect($(v.container, '[data-part="organize-undo"]')?.textContent).toContain(L('undo.action'))
    expect($(v.container, '[data-part="organize-accept-all"]')?.textContent).toContain('4')
  })

  it('accept a single channel', async () => {
    const { v } = await openReview()
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="suggestion-accept"]') ?? null)
    await flush(10)
    expect(calls('organize.accept')).toEqual([{ suggestion_ids: ['sg_veri'] }])
    expect(statusOf(v.container, 'Veritasium')).toBe('accepted')
    expect(statusOf(v.container, 'Kurzgesagt')).toBe('pending')
  })

  it('accept all: only the pending ones, with the count; then it becomes "Done"', async () => {
    const { v, setPending } = await openReview()
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="suggestion-accept"]') ?? null)
    await flush(10)
    setPending(SIX.filter((s) => s.id !== 'sg_veri'))
    expect($(v.container, '[data-part="organize-accept-all"]')?.textContent).toContain('5')
    click($(v.container, '[data-part="organize-accept-all"]'))
    await flush(10)
    expect(calls('organize.accept')[1]).toEqual({ suggestion_ids: ['sg_fire', 'sg_mkbhd', 'sg_kurz', 'sg_kenji', 'sg_babish'] })
    expect($(v.container, '[data-part="organize-accept-all"]')).toBeNull()
    click($(v.container, '[data-part="organize-done"]'))
    expect(onClose).toHaveBeenCalled()
  })

  it('keyboard: ⌘/Ctrl+Enter accepts all', async () => {
    const { v } = await openReview()
    key($(v.container, '[data-part="organize"]'), 'Enter', { metaKey: true })
    await flush(10)
    expect(calls('organize.accept')).toHaveLength(1)
    expect((calls('organize.accept')[0] as { suggestion_ids: string[] }).suggestion_ids).toHaveLength(6)
  })

  it('failure accepting: back to pending and offers try again', async () => {
    let n = 0
    const { v } = await openReview({}, { accept: (p) => (++n === 1 ? errEnv('conflict', 'mudou') : okEnv({ accepted: p.suggestion_ids, created_folders: [], created_tags: [], change_group: 'grp_2' })) })
    click(groupEl(v.container, 'Ciência')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    expect(statusOf(v.container, 'Veritasium')).toBe('pending')
    const banner = $(v.container, '[data-part="organize-action-error"]')
    expect(banner).not.toBeNull()
    click(banner?.querySelector('[data-part="banner-action"]') ?? null)
    await flush(10)
    expect(calls('organize.accept')).toHaveLength(2)
    expect(statusOf(v.container, 'Veritasium')).toBe('accepted')
  })

  it('decline a channel: leaves the count at once, sends organize.reject after the undo window', async () => {
    const { v } = await openReview()
    click(rowEl(v.container, 'Marques Brownlee')?.querySelector('[data-part="suggestion-reject"]') ?? null)
    await flush()
    expect(statusOf(v.container, 'Marques Brownlee')).toBe('rejected')
    expect(calls('organize.reject')).toHaveLength(0)
    expect($(v.container, '[data-part="organize-reject-undo"]')).not.toBeNull()
    await advance(REJECT_GRACE_MS)
    expect(calls('organize.reject')).toEqual([{ suggestion_ids: ['sg_mkbhd'] }])
  })

  it('decline the group and undo within the window: nothing goes to the server', async () => {
    const { v } = await openReview()
    click(groupEl(v.container, 'Culinária')?.querySelector('[data-part="group-reject"]') ?? null)
    await flush()
    expect(statusOf(v.container, 'Binging with Babish')).toBe('rejected')
    click($(v.container, '[data-part="organize-reject-undo"] [data-part="banner-action"]'))
    await flush()
    expect(statusOf(v.container, 'Binging with Babish')).toBe('pending')
    await advance(REJECT_GRACE_MS * 2)
    expect(calls('organize.reject')).toHaveLength(0)
  })

  it('a pending decline goes to the server when the dialog closes', async () => {
    const { v } = await openReview()
    click(rowEl(v.container, 'Kurzgesagt')?.querySelector('[data-part="suggestion-reject"]') ?? null)
    await flush()
    v.unmount()
    await flush()
    expect(calls('organize.reject')).toEqual([{ suggestion_ids: ['sg_kurz'] }])
  })

  it('change a channel\'s folder right there → goes as `edits` in the accept (becomes an example)', async () => {
    const { v } = await openReview()
    const r = rowEl(v.container, 'Veritasium')
    click(r?.querySelector('[data-part="organize-folder-pick"]') ?? null)
    const input = $(v.container, '[data-part="organize-folder-input"]')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    // the existing folders become options (full path)
    const options = $$(v.container, 'datalist option').map((o) => o.getAttribute('value'))
    expect(options).toContain('Ciência/Física')
    typeInto(input, 'Ciência/Física')
    key(input, 'Enter')
    await flush()
    expect($(v.container, '[data-part="organize-folder-input"]')).toBeNull()
    expect(rowEl(v.container, 'Veritasium')?.textContent).toContain('Ciência/Física')
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="suggestion-accept"]') ?? null)
    await flush(10)
    expect(calls('organize.accept')).toEqual([{ suggestion_ids: ['sg_veri'], edits: { [C.veri.id]: { folder: 'Ciência/Física' } } }])
  })

  it('Esc in the folder field cancels the change', async () => {
    const { v } = await openReview()
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="organize-folder-pick"]') ?? null)
    const input = $(v.container, '[data-part="organize-folder-input"]')
    typeInto(input, 'Outra')
    key(input, 'Escape')
    await flush()
    expect($(v.container, '[data-part="organize-folder-input"]')).toBeNull()
    expect(rowEl(v.container, 'Veritasium')?.textContent).not.toContain('Outra')
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="suggestion-accept"]') ?? null)
    await flush(10)
    expect(calls('organize.accept')).toEqual([{ suggestion_ids: ['sg_veri'] }])
  })

  it('undo organize: one button undoes every accept of the session through the history', async () => {
    let group = 0
    const { v, setPending } = await openReview(
      { changes: [change(31, 'grp_2'), change(30, 'grp_2'), change(20, 'grp_1'), change(19, 'grp_1'), change(5, null)] },
      { accept: (p) => okEnv({ accepted: p.suggestion_ids, created_folders: [], created_tags: [], change_group: `grp_${++group}` }) }
    )
    click(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    click(groupEl(v.container, 'Culinária')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    setPending([S.veri, S.kurz])
    click($(v.container, '[data-part="organize-undo"] [data-part="banner-action"]'))
    await flush()
    // optimistic: already back to pending
    expect(statusOf(v.container, 'Fireship')).toBe('pending')
    setPending(SIX)
    await flush(15)
    const undos = restCalls('POST', '/changes/31/undo').length + restCalls('POST', '/changes/20/undo').length
    expect(undos).toBe(2)
    // the newest first
    const order = sdkMock.restCalls.filter((c) => /\/changes\/\d+\/undo/.test(c.path)).map((c) => c.path)
    expect(order).toEqual(['/changes/31/undo', '/changes/20/undo'])
    expect($(v.container, '[data-part="organize-undo"]')).toBeNull()
    expect(statusOf(v.container, 'Fireship')).toBe('pending')
    expect(statusOf(v.container, 'J. Kenji López-Alt')).toBe('pending')
  })

  it('undo refused: shows accepted again and says the error', async () => {
    const { v } = await openReview({
      changes: [change(20, 'grp_1')],
      extra: {
        'POST /changes/{id}/undo': () => {
          throw { code: 'undo_refused', reason: 'not_undoable', message: 'cannot' }
        }
      }
    })
    click(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    click($(v.container, '[data-part="organize-undo"] [data-part="banner-action"]'))
    await flush(15)
    expect(statusOf(v.container, 'Fireship')).toBe('accepted')
    expect($(v.container, '[data-part="organize-action-error"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ partial error

describe('partial error', () => {
  it('one batch did not come back: shows what came and offers to retry only the rest', async () => {
    let state = job('job_1', 'running', { progress: progress(0, 7) })
    let pending: Suggestion[] = []
    world({ suggestions: () => pending, job: () => state })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    state = job('job_1', 'done', { progress: progress(7, 7), result: { suggestions: [S.fire, S.veri, S.kenji], model: MODEL } })
    pending = [S.fire, S.veri, S.kenji]
    await advance(JOB_POLL_MS)
    await flush(15)
    expect(view(v.container)).toBe('review')
    expect($$(v.container, '[data-part="suggestion-row"]')).toHaveLength(3)
    const banner = $(v.container, '[data-part="organize-partial"]')
    expect(banner?.textContent).toContain('4')
    click(banner?.querySelector('[data-part="banner-action"]') ?? null)
    await flush(10)
    expect(calls('organize.run')[1]).toEqual({ channel_ids: [C.mkbhd.id, C.kurz.id, C.babish.id, C.beato.id] })
  })

  it('old pending items opened without a job in the session do not report a partial error', async () => {
    const { v } = await openReview()
    expect($(v.container, '[data-part="organize-partial"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ channels without a folder first

describe('channels without a folder first; nothing-new hidden', () => {
  const ciTodo = channel('UCcienciaTodoDia00000001', 'Ciência Todo Dia', 'f_cie')
  const threeB = channel('UCthreeBlueOneBrown00001', '3Blue1Brown', 'f_cie')
  const mover = channel('UCfiledMoverChannel00001', 'Moved Channel', 'f_tec')
  /** Older backend: no `same_folder`; the folder it is in is the one suggested, no tag. */
  const NOOP_OLD = sug('sg_noop_old', ciTodo, 'Ciência', { from_folder: 'Ciência', from_folder_id: 'f_cie' })
  const NOOP_NEW = sug('sg_noop_new', ciTodo, 'Ciência', { from_folder: 'Ciência', from_folder_id: 'f_cie', same_folder: true, new_tags: [] })
  const TAG = sug('sg_math', threeB, 'Ciência', { from_folder: 'Ciência', from_folder_id: 'f_cie', tags: ['math'], same_folder: true, new_tags: ['math'] })
  const MOVE = sug('sg_move', mover, 'Ciência', { from_folder: 'Tecnologia', from_folder_id: 'f_tec' })
  const ARRIVAL = [TAG, MOVE, NOOP_OLD, S.kenji, S.veri]

  it('model: a suggestion that changes nothing is dropped; groups with channels without a folder first, tag-only last', () => {
    expect(proposalOf(TAG)).toMatchObject({ sameFolder: true, newTags: ['math'] })
    expect(proposalOf(NOOP_OLD)).toMatchObject({ sameFolder: true, newTags: [] })
    expect(proposalOf(S.veri)).toMatchObject({ sameFolder: false })
    const items = mergeSuggestions([], [...ARRIVAL, NOOP_NEW], () => false, true)
    expect(items.map((i) => i.suggestion.id).sort()).toEqual(['sg_kenji', 'sg_math', 'sg_move', 'sg_veri'])
    expect(groupItems(items).map((g) => [g.kind, g.items.map((i) => i.suggestion.id)])).toEqual([
      ['folder', ['sg_kenji']],
      ['folder', ['sg_veri', 'sg_move']],
      ['tags', ['sg_math']]
    ])
  })

  it('on screen: no "folder → same folder" row, tag-only says "add tag #math", header count = rows, singular when 1', async () => {
    const { v } = await openReview({ suggestions: () => ARRIVAL, channels: [...ALL, ciTodo, threeB, mover] })
    const rows = $$(v.container, '[data-part="suggestion-row"]')
    expect(rows).toHaveLength(4)
    expect(rowEl(v.container, 'Ciência Todo Dia')).toBeNull()
    expect(rows[0].textContent).toContain('J. Kenji')
    const math = rowEl(v.container, '3Blue1Brown')
    expect(math?.querySelector('[data-part="organize-add-tags"]')?.textContent).toBe(L('row.add_tags_one', { tags: '#math' }))
    expect(math?.querySelector('[data-part="organize-folder-pick"]')).toBeNull()
    const summary = $(v.container, '[data-part="organize-summary"]')?.textContent ?? ''
    expect(summary).toContain(L('review.suggestions_other', { count: 4 }))
    expect(summary).toContain(L('review.folders_other', { count: 2 }))
    expect(groupEl(v.container, 'Culinária')?.querySelector('h3')?.textContent).toContain(L('review.suggestions_one', { count: 1 }))
    expect(v.text()).not.toContain('1 suggestions')
    expect($(v.container, '[data-part="organize-accept-all"]')?.textContent).toContain('4')
  })

  it('header in the singular with one suggestion', async () => {
    const { v } = await openReview({ suggestions: () => [S.veri] })
    const summary = $(v.container, '[data-part="organize-summary"]')?.textContent ?? ''
    expect(summary).toContain(L('review.suggestions_one', { count: 1 }))
    expect(summary).toContain(L('review.folders_one', { count: 1 }))
    expect(v.text()).not.toContain('1 suggestions')
  })

  it('stored suggestions that leave channels without a folder uncovered say so and suggest only for those', async () => {
    const { v } = await openReview() // six suggestions; Rick Beato has no folder and no suggestion
    const banner = $(v.container, '[data-part="organize-uncovered"]')
    expect(banner?.textContent).toContain(L('uncovered.title_one', { count: 1 }))
    click(banner?.querySelector('[data-part="banner-action"]') ?? null)
    await flush(10)
    expect(calls('organize.run')).toEqual([{ channel_ids: [C.beato.id] }])
  })
})

// ------------------------------------------------------------------ finishing touches + model status

/** Props React stored on the node (the SDK mock does not interpret Radix's Esc). */
function propsOf(el: Element | null): Record<string, any> {
  const k = el ? Object.keys(el).find((x) => x.startsWith('__reactProps$')) : undefined
  return k ? (el as any)[k] : {}
}

function escapeEvent(target: Element | null): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'target', { value: target })
  return ev
}

const footerOf = (root: ParentNode) => $(root, '[data-slot="dialog-footer"]')

describe('finishing touches', () => {
  it('accepted: "Undo organize" only in the strip; the footer has "Done"', async () => {
    const { v } = await openReview()
    click($(v.container, '[data-part="organize-accept-all"]'))
    await flush(10)
    expect($(v.container, '[data-part="organize-undo"] [data-part="banner-action"]')?.textContent).toBe(L('undo.action'))
    expect($(v.container, '[data-part="organize-undo-footer"]')).toBeNull()
    expect(footerOf(v.container)?.textContent).not.toContain(L('undo.action'))
    expect($(footerOf(v.container)!, '[data-part="organize-done"]')?.textContent).toBe(L('review.done'))
    expect(v.text().split(L('undo.action'))).toHaveLength(2)
  })

  it('opening: "nothing changes until you accept" only once (in step 3)', async () => {
    world()
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('intro')
    expect(v.text().toLowerCase().split('nothing changes until you accept')).toHaveLength(2)
    expect(v.text()).toContain(L('steps.review'))
  })

  it('Esc inside the folder field only cancels the change; outside it, Esc closes the dialog', async () => {
    const { v } = await openReview()
    click(rowEl(v.container, 'Veritasium')?.querySelector('[data-part="organize-folder-pick"]') ?? null)
    const input = $(v.container, '[data-part="organize-folder-input"]')
    typeInto(input, 'Outra')
    const onEsc = propsOf($(v.container, '[data-slot="dialog-content"]')).onEscapeKeyDown as (e: KeyboardEvent) => void
    expect(typeof onEsc).toBe('function')
    const inside = escapeEvent(input)
    onEsc(inside)
    expect(inside.defaultPrevented).toBe(true) // Radix does not close
    key(input, 'Escape') // the field cancels the change
    await flush()
    expect($(v.container, '[data-part="organize-folder-input"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    const outside = escapeEvent($(v.container, '[data-part="organize"]'))
    onEsc(outside)
    expect(outside.defaultPrevented).toBe(false)
  })
})

// ------------------------------------------------------------------ model configured, provider unreachable

describe('model configured but its provider is unreachable', () => {
  const PROVIDER = 'claude-subscription-directsdk-experimental'
  const SONNET = 'claude-sonnet-5-5'
  const ROUTE = `${PROVIDER} · ${SONNET}`
  const unreachableText = enCommon.provider_unavailable.replace('{route}', ROUTE)
  const UNREACHABLE = { available: false, model: SONNET, reason: 'provider_unavailable', provider: PROVIDER }
  const OK = { available: true, model: SONNET, reason: null, provider: PROVIDER }

  it('job ended in llm_unavailable and the status now says provider_unavailable → "couldn\'t reach", not "choose a model"', async () => {
    let statusCalls = 0
    world({
      job: () => job('job_1', 'error', { error: { code: 'llm_unavailable', message: 'unreachable' } }),
      extra: { 'GET /ai/status': () => (++statusCalls === 1 ? OK : UNREACHABLE) }
    })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(20)
    expect(view(v.container)).toBe('provider_unavailable')
    expect(v.text()).toContain(L('provider_unavailable.title'))
    expect(v.text()).toContain(unreachableText)
    expect(v.text()).not.toContain(L('no_model.title'))
    click($(v.container, '[data-part="organize-open-model"]'))
    expect(sdkMock.navigations).toEqual([modelSettingsPath()])
  })

  it('try again from the "couldn\'t reach" view runs organize.run again', async () => {
    let n = 0
    world({ extra: { 'GET /ai/status': OK } })
    rpc({
      run: () =>
        ++n === 1
          ? { ok: false, error: { code: 'llm_unavailable', message: 'x', details: { reason: 'provider_unavailable', provider: PROVIDER, model: SONNET } } }
          : okEnv({ job: job('job_1', 'queued') })
    })
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(10)
    expect(view(v.container)).toBe('provider_unavailable')
    expect(v.text()).toContain(unreachableText)
    click($(v.container, '[data-part="organize-retry"]'))
    await flush(10)
    expect(calls('organize.run')).toHaveLength(2)
    expect(view(v.container)).toBe('running')
  })

  it('another llm_unavailable (provider error, status still available) → the error itself, with try again', async () => {
    world({
      job: () => job('job_1', 'error', { error: { code: 'llm_unavailable', message: 'The AI provider failed: HTTP 500' } }),
      extra: { 'GET /ai/status': OK }
    })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-start"]'))
    await flush(20)
    expect(view(v.container)).toBe('error')
    expect(v.text()).toContain('The AI provider failed: HTTP 500')
    expect(v.text()).not.toContain(L('no_model.title'))
  })

  it('before the click: status provider_unavailable → "couldn\'t reach" notice with the route and the settings path', async () => {
    world({ extra: { 'GET /ai/status': UNREACHABLE } })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    const warn = $(v.container, '[data-part="organize-ai-warning"]')
    expect(warn?.textContent).toContain(L('ai.provider_unavailable_title'))
    expect(warn?.textContent).toContain(unreachableText)
    expect(warn?.textContent).not.toContain(L('ai.no_model_title'))
    click(warn?.querySelector('[data-part="banner-action"]') ?? null)
    expect(sdkMock.navigations).toEqual([modelSettingsPath()])
  })
})

describe('model before the click (GET /ai/status)', () => {
  it('explicit available: false → notice before the click, with a path to pick the model', async () => {
    world({ extra: { 'GET /ai/status': { available: false, model: null, reason: 'no_model' } } })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('intro')
    const warn = $(v.container, '[data-part="organize-ai-warning"]')
    expect(warn?.textContent).toContain(L('ai.no_model_title'))
    // a single message about the model: no "Uses model X" under the "no model" notice
    expect($(v.container, '[data-part="organize-model"]')).toBeNull()
    expect($(v.container, '[data-part="organize-start"]')?.getAttribute('data-variant')).toBe('outline')
    expect(calls('organize.run')).toHaveLength(0)
    click(warn?.querySelector('[data-part="banner-action"]') ?? null)
    expect(sdkMock.navigations).toEqual([modelSettingsPath()])
  })

  it('available: true with a model → the opening says which model answers; no notice', async () => {
    world({ extra: { 'GET /ai/status': { available: true, model: 'gpt-6-mini', reason: null } } })
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect($(v.container, '[data-part="organize-ai-warning"]')).toBeNull()
    expect($(v.container, '[data-part="organize-model"]')?.textContent).toContain(L('intro.model_exact', { model: 'gpt-6-mini' }))
  })

  it('missing route (404/not_found) or one that does not answer = "unknown": opens normally, no notice and no blocking', async () => {
    world() // no 'GET /ai/status' → not_found
    rpc()
    const a = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(view(a.container)).toBe('intro')
    expect($(a.container, '[data-part="organize-ai-warning"]')).toBeNull()
    expect($(a.container, '[data-part="organize-start"]')?.hasAttribute('disabled')).toBe(false)
    a.unmount()
    world({ extra: { 'GET /ai/status': () => new Promise(() => undefined) } })
    const b = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    await advance(10_000)
    expect(view(b.container)).toBe('intro')
    expect($(b.container, '[data-part="organize-ai-warning"]')).toBeNull()
    expect($(b.container, '[data-part="organize-start"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('a failed transport (new route without restarting Hermes) is also "unknown"', async () => {
    world()
    rpc()
    const base = sdkMock.restHandler!
    sdkMock.restHandler = (path, opts) => (path.startsWith('/ai/status') ? Promise.reject(new Error('HTTP 404')) : base(path, opts))
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(15)
    expect(view(v.container)).toBe('intro')
    expect($(v.container, '[data-part="organize-ai-warning"]')).toBeNull()
  })
})

describe('real cancel (job.cancel)', () => {
  const cancelled = (id: string) => job(id, 'error', { error: { code: 'cancelled', message: 'Trabalho cancelado a pedido.' } })

  it('"Cancel" calls job.cancel; cancelled is not an error: back to the opening and stops polling', async () => {
    let state = job('job_1', 'running', { progress: progress(60, 400) })
    world({ job: () => state })
    rpc({
      cancel: (p) => {
        state = cancelled(p.job_id)
        return okEnv({ job: state, cancelled: true })
      }
    })
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    expect(view(v.container)).toBe('running')
    const btn = $(v.container, '[data-part="organize-cancel"]')
    expect(btn?.textContent).toBe(L('progress.cancel'))
    click(btn)
    await flush(10)
    expect(calls('job.cancel')).toEqual([{ job_id: 'job_1' }])
    expect(view(v.container)).toBe('intro')
    expect($(v.container, '[data-part="error"]')).toBeNull()
    expect($(v.container, '[data-part="organize-notice"]')?.textContent).toContain(L('notice.cancelled'))
    const n = restCalls('GET', '/jobs/job_1').length
    await advance(JOB_POLL_MS * 3)
    expect(restCalls('GET', '/jobs/job_1').length).toBe(n)
  })

  it('cancelled with batches ready: the suggestions that arrived stay for review (nothing applied)', async () => {
    let state = job('job_1', 'running', { progress: progress(120, 400) })
    world({ suggestions: () => [S.fire, S.veri], job: () => state })
    rpc({ cancel: (p) => ((state = cancelled(p.job_id)), okEnv({ job: state, cancelled: true })) })
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-cancel"]'))
    await flush(10)
    expect(view(v.container)).toBe('review')
    expect($$(v.container, '[data-part="suggestion-row"]:not([data-skeleton])')).toHaveLength(2)
    expect(calls('organize.accept')).toHaveLength(0)
  })

  it('job cancelled elsewhere (the poll sees error.code=cancelled): shows no error', async () => {
    let state = job('job_1', 'running', { progress: progress(60, 400) })
    world({ job: () => state })
    rpc()
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    state = cancelled('job_1')
    await advance(JOB_POLL_MS)
    await flush(10)
    expect(view(v.container)).not.toBe('error')
    expect($(v.container, '[data-part="error"]')).toBeNull()
    expect($(v.container, '[data-part="organize-notice"]')?.textContent).toContain(L('notice.cancelled'))
  })

  it('gateway without job.cancel (before the restart): says it did not work and keeps following', async () => {
    world({ job: () => job('job_1', 'running', { progress: progress(60, 400) }) })
    rpc() // job.cancel → -32601
    const v = render(<OrganizeDialog jobId="job_1" onClose={onClose} />)
    await flush(10)
    click($(v.container, '[data-part="organize-cancel"]'))
    await flush(10)
    expect(calls('job.cancel')).toHaveLength(1)
    expect(view(v.container)).toBe('running')
    expect($(v.container, '[data-part="organize-notice"]')?.textContent).toContain(L('notice.cancel_failed'))
    const n = restCalls('GET', '/jobs/job_1').length
    await advance(JOB_POLL_MS)
    expect(restCalls('GET', '/jobs/job_1').length).toBeGreaterThan(n)
  })
})

describe('undo through the accept\'s change_ids', () => {
  it('with change_ids: undoes directly by id, without scanning GET /changes', async () => {
    const { v } = await openReview(
      {},
      { accept: (p) => okEnv({ accepted: p.suggestion_ids, created_folders: [], created_tags: [], change_group: 'grp_1', change_ids: [41, 42] }) }
    )
    click(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    click($(v.container, '[data-part="organize-undo"] [data-part="banner-action"]'))
    await flush(15)
    expect(restCalls('GET', '/changes')).toHaveLength(0)
    expect(restCalls('POST', '/changes/41/undo')).toHaveLength(1)
    expect(restCalls('POST', '/changes/42/undo')).toHaveLength(0)
    expect($(v.container, '[data-part="organize-undo"]')).toBeNull()
    expect(statusOf(v.container, 'Fireship')).toBe('pending')
  })

  it('mixed accepts (one with change_ids, another without): each through its own path, the newest first', async () => {
    let n = 0
    const { v } = await openReview(
      { changes: [change(20, 'grp_old')] },
      {
        accept: (p) =>
          ++n === 1
            ? okEnv({ accepted: p.suggestion_ids, created_folders: [], created_tags: [], change_group: 'grp_old' })
            : okEnv({ accepted: p.suggestion_ids, created_folders: [], created_tags: [], change_group: 'grp_new', change_ids: [31] })
      }
    )
    click(groupEl(v.container, 'Tecnologia')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    click(groupEl(v.container, 'Culinária')?.querySelector('[data-part="group-accept"]') ?? null)
    await flush(10)
    click($(v.container, '[data-part="organize-undo"] [data-part="banner-action"]'))
    await flush(15)
    const order = sdkMock.restCalls.filter((c) => /\/changes\/\d+\/undo/.test(c.path)).map((c) => c.path)
    expect(order).toEqual(['/changes/31/undo', '/changes/20/undo'])
  })
})

// ------------------------------------------------------------------ language, preview and hygiene

function keysOf(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keysOf(v, `${prefix}${k}.`)))
}

function placeholders(tree: Tree): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const k of keysOf(tree)) {
    let node: Tree | string = tree
    for (const p of k.split('.')) node = (node as Tree)[p]
    out[k] = [...String(node).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  }
  return out
}

describe('language', () => {
  it('EN = PT-BR: same keys and same placeholders', () => {
    expect(keysOf(PT).sort()).toEqual(keysOf(EN).sort())
    expect(placeholders(PT)).toEqual(placeholders(EN))
    expect(keysOf(EN).length).toBeGreaterThan(30)
  })

  it('PT-BR on screen, with numbers in the app language', async () => {
    sdkMock.locale.set('pt-BR')
    world()
    rpc()
    const v = render(<OrganizeDialog onClose={onClose} />)
    await flush(10)
    expect(v.text()).toContain('nada muda até você aceitar')
    expect(v.text()).toContain('Sugerir pastas')
  })

  it('every key used in the code exists in EN', () => {
    const files = listRepoFiles('desktop-src/dialogs/organize', ['.tsx', '.ts']).filter((f) => !f.endsWith('preview.scenarios.tsx'))
    const used = new Set<string>()
    for (const f of files) for (const m of readRepoFile(f).matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1])
    const known = new Set(keysOf(EN))
    const missing = [...used].filter((k) => !known.has(k) && !known.has(`${k}_one`))
    expect(missing).toEqual([])
  })
})

describe('hygiene', () => {
  it('className only through cx() with kit classes; no fixed color', () => {
    const files = listRepoFiles('desktop-src/dialogs/organize', ['.tsx', '.ts'])
    const bad: string[] = []
    for (const f of files) {
      const code = readRepoFile(f)
      for (const m of code.matchAll(/\bclassName\s*=\s*(["'{])/g)) {
        const rest = code.slice(m.index! + m[0].length - 1, m.index! + m[0].length + 80)
        if (m[1] !== '{' || !/^\{\s*(withClass\()?cx\(/.test(rest)) bad.push(`${f}: ${rest.slice(0, 40)}`)
      }
      if (/['"`(\s:](#[0-9a-fA-F]{3,8})\b|\brgba?\(|\bhsla?\(/.test(code)) bad.push(`${f}: cor fixa`)
      if (/from '\.\.\/\.\.\/(pages|panes|chrome|chat|dialogs)\//.test(code)) bad.push(`${f}: imports another screen`)
    }
    expect(bad).toEqual([])
  })
})

describe('preview scenarios', () => {
  let runtime: ScenarioRuntime | null = null
  afterEach(() => {
    runtime?.dispose()
    runtime = null
  })

  it('covers the requested states, widths 420 and 900, unique ids with a prefix', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of scenarios) {
      expect(s.id).toMatch(/^organize-[a-z0-9-]+$/)
      expect(s.widths).toEqual([420, 900])
      // every scenario answers GET /ai/status (the opening asks)
      expect(Object.keys(s.rest ?? {})).toContain('GET /ai/status')
    }
    for (const want of [
      'organize-intro',
      'organize-intro-no-model',
      'organize-progress',
      'organize-cancel-failed',
      'organize-result',
      'organize-accepted',
      'organize-no-model',
      'organize-partial',
      'organize-nothing'
    ])
      expect(ids).toContain(want)
  })

  it.each(scenarios.map((s) => [s.id, s] as const))('%s mounts with no missing route and without breaking', async (_id, scenario) => {
    vi.useRealTimers()
    runtime = installScenario(scenario, PLUGIN_ID)
    const v = render(<ScenarioView scenario={scenario} runtime={runtime} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    await flush(10)
    expect(v.container.querySelector('[data-preview-crash]')).toBeNull()
    expect(runtime.missing()).toEqual([])
    expect(v.container.querySelector('[data-part="organize"]')).not.toBeNull()
  })
})
