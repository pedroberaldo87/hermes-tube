// RPC client: checks for `plugin-rpc-v1` in `runtime.describe`; without it (or with -32601) it follows the method's
// `fallback` in contract/rpc.yaml — the `open_desktop_backend` message or the same operation over REST.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Job } from '../../shared/api-types'
import { MESSAGE_KEYS, RPC_CAPABILITY, RPC_TIMEOUT_MS, RPC_UNAVAILABLE_CODE, rpcMethod } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { RPC_FALLBACK, callRpc, hasPluginRpc, resetRpcCapability } from '../lib/rpc'
import { readRepoFile } from './repo.mjs'
import { type MockProfileRoute, createMockCtx, host, rpcError, sdkMock } from './sdk-mock'

const JOB: Job = {
  id: 'job_1',
  kind: 'theme',
  status: 'queued',
  created_at: 1762700000,
  updated_at: 1762700000,
  progress: null,
  result: null,
  error: null
}

type Handler = (params?: Record<string, unknown>) => unknown

function backend(methods: Record<string, Handler>) {
  sdkMock.requestHandler = (method, params) => {
    const h = methods[method]
    if (!h) throw rpcError(RPC_UNAVAILABLE_CODE, `unknown method: ${method}`)
    return h(params)
  }
}

const withRpc = { 'runtime.describe': () => ({ capabilities: ['durable-admission-v1', RPC_CAPABILITY] }) }
const withoutRpc = { 'runtime.describe': () => ({ capabilities: ['durable-admission-v1'] }) }

beforeEach(() => {
  setPluginContext(createMockCtx().ctx)
})

describe('callRpc with plugin-rpc-v1', () => {
  it('calls plugin.<id>.<method> with the params and the 30 s cutoff and unwraps the envelope', async () => {
    backend({ ...withRpc, [rpcMethod('theme.create')]: () => ({ ok: true, data: { job: JOB } }) })
    const out = await callRpc('theme.create', { query: 'agentes de IA' })
    expect(out).toEqual({ kind: 'ok', data: { job: JOB } })
    const call = sdkMock.requests.find((r) => r.method === rpcMethod('theme.create'))
    expect(call?.params).toEqual({ query: 'agentes de IA' })
    expect(call?.timeoutMs).toBe(RPC_TIMEOUT_MS)
  })

  it('queries runtime.describe only once (cached per gateway activation)', async () => {
    backend({ ...withRpc, [rpcMethod('cleanup.scan')]: () => ({ ok: true, data: { job: JOB } }) })
    await callRpc('cleanup.scan', {})
    await callRpc('cleanup.scan', {})
    expect(sdkMock.requests.filter((r) => r.method === 'runtime.describe')).toHaveLength(1)
    sdkMock.epoch += 1 // gateway/profile switch → checks again
    await callRpc('cleanup.scan', {})
    expect(sdkMock.requests.filter((r) => r.method === 'runtime.describe')).toHaveLength(2)
  })

  it('an error envelope becomes kind=error with the contract ApiError', async () => {
    backend({
      ...withRpc,
      [rpcMethod('cleanup.approve')]: () => ({
        ok: false,
        error: { code: 'approval_refused', message: 'no', reason: 'via' }
      })
    })
    const out = await callRpc('cleanup.approve', { channel_ids: ['UCBJycsmduvYEL83R_U4JriQ'] })
    expect(out).toEqual({ kind: 'error', error: { code: 'approval_refused', message: 'no', reason: 'via' } })
  })

  it('method -32601 with plugin-rpc-v1 (plugin not loaded) → unavailable', async () => {
    backend({ ...withRpc })
    const out = await callRpc('organize.run', { channel_ids: null })
    expect(out).toEqual({ kind: 'unavailable', messageKey: MESSAGE_KEYS.openDesktopBackend })
  })

  it('client cutoff (timeout) becomes kind=error code=timeout', async () => {
    backend({
      ...withRpc,
      [rpcMethod('theme.save')]: () => {
        throw new Error('Request timed out after 30000ms')
      }
    })
    const out = await callRpc('theme.save', { theme_id: 'th_1' })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.error.code).toBe('timeout')
  })

  it('a response that is not an envelope → kind=error code=internal', async () => {
    backend({ ...withRpc, [rpcMethod('organize.reject')]: () => 'lixo' })
    const out = await callRpc('organize.reject', { channel_ids: ['x'] })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.error.code).toBe('internal')
  })
})

describe('callRpc without plugin-rpc-v1', () => {
  it('describe without the capability → unavailable and never calls the method', async () => {
    backend({ ...withoutRpc, [rpcMethod('theme.create')]: () => ({ ok: true, data: { job: JOB } }) })
    const out = await callRpc('theme.create', { query: 'x' })
    expect(out).toEqual({ kind: 'unavailable', messageKey: 'open_desktop_backend' })
    expect(sdkMock.requests.map((r) => r.method)).toEqual(['runtime.describe'])
    expect(await hasPluginRpc()).toBe(false)
  })

  it('runtime.describe missing (-32601, standalone backend) → unavailable', async () => {
    backend({})
    const out = await callRpc('lists.import', { url: 'https://example.com/post' })
    expect(out).toEqual({ kind: 'unavailable', messageKey: 'open_desktop_backend' })
    expect(sdkMock.requests.map((r) => r.method)).toEqual(['runtime.describe'])
  })

  it('pair.start falls back to the same operation over REST (POST /pair/start)', async () => {
    backend({ ...withoutRpc })
    const pairing = { code: '123456', expires_at: 1762700300, port: 47615 }
    sdkMock.restHandler = () => ({ ok: true, data: pairing })
    const out = await callRpc('pair.start', {})
    expect(out).toEqual({ kind: 'ok', data: pairing })
    expect(sdkMock.restCalls).toHaveLength(1)
    expect(sdkMock.restCalls[0].path).toBe('/pair/start')
    expect(sdkMock.restCalls[0].opts?.method).toBe('POST')
  })

  it('a transient describe failure (gateway disconnected) is not cached', async () => {
    let up = false
    sdkMock.requestHandler = (method) => {
      if (!up) throw new Error('Hermes gateway is not connected')
      if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
      return { ok: true, data: { job: JOB } }
    }
    const first = await callRpc('cleanup.scan', {})
    expect(first.kind).toBe('error')
    up = true
    const second = await callRpc('cleanup.scan', {})
    expect(second).toEqual({ kind: 'ok', data: { job: JOB } })
  })
})

// Seen in the real app: the window was on an additional profile (here `work`; REST ok) and the socket on the `default`
// gateway, where the plugin does not exist → -32601 → "This needs Hermes' AI". The RPC must go to the chosen profile's gateway.
describe('callRpc when the window socket is on another profile', () => {
  const MAX: MockProfileRoute = { connectionId: 'c-max', mode: 'remote', profile: 'work', targetProfile: 'work' }
  const AIR: MockProfileRoute = { connectionId: 'c-air', mode: 'local', primary: true, profile: 'default', targetProfile: 'default' }
  const ok = { ok: true, data: { job: JOB } }

  beforeEach(() => {
    resetRpcCapability()
    host.state.profile.set('work')
    backend({ ...withRpc }) // the socket's gateway announces plugin-rpc-v1 but does not have the plugin
  })

  it('-32601 on the socket → sends through the chosen profile route (host.profileRoutes descriptor)', async () => {
    sdkMock.profileRoutes = [AIR, MAX]
    sdkMock.profileRequestHandler = (route) => {
      if (route !== MAX) throw rpcError(RPC_UNAVAILABLE_CODE)
      return ok
    }
    const out = await callRpc('theme.create', { query: 'agentes de IA' })
    expect(out).toEqual({ kind: 'ok', data: { job: JOB } })
    expect(sdkMock.profileRequests).toEqual([
      { route: MAX, method: rpcMethod('theme.create'), params: { query: 'agentes de IA' } }
    ])
  })

  it('remembers the route: the next call goes straight through it, skipping the socket', async () => {
    sdkMock.profileRoutes = [MAX]
    sdkMock.profileRequestHandler = () => ok
    await callRpc('theme.create', { query: 'a' })
    const before = sdkMock.requests.length
    const out = await callRpc('organize.run', { channel_ids: null })
    expect(out.kind).toBe('ok')
    expect(sdkMock.requests).toHaveLength(before)
    expect(sdkMock.profileRequests.map((r) => r.method)).toEqual([rpcMethod('theme.create'), rpcMethod('organize.run')])
  })

  it('no route registry (webapp, old Desktop): tries the profile name', async () => {
    sdkMock.profileRoutes = null
    sdkMock.profileRequestHandler = (route) => {
      expect(route).toBe('work')
      return ok
    }
    expect(await callRpc('cleanup.scan', {})).toEqual({ kind: 'ok', data: { job: JOB } })
  })

  it('a route with a routing error (no code) is skipped; the next one answers', async () => {
    const stale: MockProfileRoute = { ...MAX, connectionId: 'c-stale' }
    sdkMock.profileRoutes = [stale, MAX]
    sdkMock.profileRequestHandler = (route) => {
      if (route === stale) throw new Error('Profile "work" no longer exists')
      return ok
    }
    expect((await callRpc('theme.create', { query: 'a' })).kind).toBe('ok')
    expect(sdkMock.profileRequests.map((r) => r.route)).toEqual([stale, MAX])
  })

  it('no route has the plugin → unavailable (the usual message), and nothing is remembered', async () => {
    sdkMock.profileRoutes = [MAX]
    const out = await callRpc('organize.run', { channel_ids: null })
    expect(out).toEqual({ kind: 'unavailable', messageKey: MESSAGE_KEYS.openDesktopBackend })
    const before = sdkMock.requests.length
    await callRpc('organize.run', { channel_ids: null })
    expect(sdkMock.requests.length).toBeGreaterThan(before) // asked the socket again
  })

  it('a contract error coming through the route arrives as an error, not as unavailable', async () => {
    sdkMock.profileRoutes = [MAX]
    sdkMock.profileRequestHandler = () => ({ ok: false, error: { code: 'ai_unavailable', message: 'no model' } })
    expect(await callRpc('theme.create', { query: 'a' })).toEqual({
      kind: 'error',
      error: { code: 'ai_unavailable', message: 'no model' }
    })
  })

  it('a timeout on the right route becomes code=timeout', async () => {
    sdkMock.profileRoutes = [MAX]
    sdkMock.profileRequestHandler = () => {
      throw new Error('Request timed out after 30000ms')
    }
    const out = await callRpc('theme.create', { query: 'a' })
    expect(out.kind === 'error' && out.error.code).toBe('timeout')
  })

  it('switching profile forgets the remembered route', async () => {
    sdkMock.profileRoutes = [MAX]
    sdkMock.profileRequestHandler = () => ok
    await callRpc('theme.create', { query: 'a' })
    host.state.profile.set('default')
    backend({ ...withRpc, [rpcMethod('theme.create')]: () => ok })
    const n = sdkMock.profileRequests.length
    expect((await callRpc('theme.create', { query: 'b' })).kind).toBe('ok')
    expect(sdkMock.profileRequests).toHaveLength(n) // answered through the socket
  })

  it('pair.start with no RPC on any route still falls back to REST', async () => {
    sdkMock.profileRoutes = [MAX]
    sdkMock.restHandler = () => ({ ok: true, data: { code: '123456', expires_at: 1 } })
    const out = await callRpc('pair.start', {})
    expect(out.kind).toBe('ok')
    expect(sdkMock.restCalls[0].path).toBe('/pair/start')
  })
})

// The socket's gateway serves another profile that ALSO has the plugin: a write sent there would land in that
// profile's database while the screen (REST) shows the selected one. `runtime.describe` names the socket's profile
// (`profile_id` = that profile's Hermes home), so the call goes to the selected profile's route or nowhere.
describe('callRpc when the socket serves a different profile with the plugin', () => {
  const WORK: MockProfileRoute = { connectionId: 'c-work', mode: 'local', profile: 'work', targetProfile: 'work' }
  const DEFAULT_HOME = '/srv/hermes'
  const ok = { ok: true, data: { items: [] } }
  const WRITES = [
    'cleanup.approve',
    'cleanup.resubscribe',
    'organize.accept',
    'organize.reject',
    'theme.save',
    'lists.to_tab',
    'cleanup.scan',
    'organize.run',
    'theme.create',
    'theme.refresh',
    'job.cancel'
  ] as const

  function socketOn(profileId: string, methods: Record<string, Handler> = {}): void {
    backend({
      'runtime.describe': () => ({ profile_id: profileId, capabilities: [RPC_CAPABILITY] }),
      ...methods
    })
  }

  const socketPluginCalls = () => sdkMock.requests.filter((r) => r.method.startsWith('plugin.'))

  beforeEach(() => {
    resetRpcCapability()
    host.state.profile.set('work')
  })

  it.each(WRITES)('%s goes to the selected profile route, never to the socket', async (name) => {
    const everything: Record<string, Handler> = {}
    for (const m of WRITES) everything[rpcMethod(m)] = () => ok
    socketOn(DEFAULT_HOME, everything)
    sdkMock.profileRoutes = [WORK]
    sdkMock.profileRequestHandler = () => ok
    const out = await callRpc(name, {} as never)
    expect(out).toEqual({ kind: 'ok', data: { items: [] } })
    expect(socketPluginCalls()).toEqual([])
    expect(sdkMock.profileRequests.map((r) => [r.route, r.method])).toEqual([[WORK, rpcMethod(name)]])
  })

  it('no route reaches the selected profile → unavailable, and the socket is never asked to write', async () => {
    socketOn(DEFAULT_HOME, { [rpcMethod('cleanup.approve')]: () => ok })
    sdkMock.profileRoutes = [WORK]
    sdkMock.profileRequestHandler = () => {
      throw new Error('Backend for "work" is reconnecting; retry after it settles.')
    }
    const out = await callRpc('cleanup.approve', { channel_ids: ['UCBJycsmduvYEL83R_U4JriQ'] })
    expect(out).toEqual({ kind: 'unavailable', messageKey: MESSAGE_KEYS.openDesktopBackend })
    expect(socketPluginCalls()).toEqual([])
  })

  it('without host.requestProfile the write is refused instead of landing in the socket profile', async () => {
    socketOn(DEFAULT_HOME, { [rpcMethod('theme.save')]: () => ok })
    const saved = host.requestProfile
    ;(host as { requestProfile?: unknown }).requestProfile = undefined
    try {
      const out = await callRpc('theme.save', { theme_id: 'th_1' })
      expect(out).toEqual({ kind: 'unavailable', messageKey: MESSAGE_KEYS.openDesktopBackend })
      expect(socketPluginCalls()).toEqual([])
    } finally {
      ;(host as { requestProfile?: unknown }).requestProfile = saved
    }
  })

  it('pair.start falls back to REST (the selected profile), not to the socket', async () => {
    socketOn(DEFAULT_HOME, { [rpcMethod('pair.start')]: () => ({ ok: true, data: { code: '999999' } }) })
    sdkMock.profileRoutes = [WORK]
    sdkMock.restHandler = () => ({ ok: true, data: { code: '123456', expires_at: 1 } })
    const out = await callRpc('pair.start', {})
    expect(out.kind === 'ok' && (out.data as { code: string }).code).toBe('123456')
    expect(socketPluginCalls()).toEqual([])
  })

  it('a timeout on the selected route is a timeout, not a retry on the socket', async () => {
    socketOn(DEFAULT_HOME, { [rpcMethod('organize.accept')]: () => ok })
    sdkMock.profileRoutes = [WORK]
    sdkMock.profileRequestHandler = () => {
      throw new Error('Request timed out after 30000ms')
    }
    const out = await callRpc('organize.accept', { suggestion_ids: ['s1'] })
    expect(out.kind === 'error' && out.error.code).toBe('timeout')
    expect(socketPluginCalls()).toEqual([])
  })

  it.each([
    ['default', DEFAULT_HOME],
    ['default', `${DEFAULT_HOME}/`],
    ['work', `${DEFAULT_HOME}/profiles/work`],
    ['work', 'C:\\Users\\someone\\.hermes\\profiles\\work'],
    ['work', 'work']
  ])('socket on the selected profile (%s ← %s): straight through the socket, as before', async (selected, home) => {
    host.state.profile.set(selected)
    socketOn(home, { [rpcMethod('cleanup.approve')]: () => ok })
    const out = await callRpc('cleanup.approve', { channel_ids: ['UCBJycsmduvYEL83R_U4JriQ'] })
    expect(out.kind).toBe('ok')
    expect(sdkMock.profileRequests).toEqual([])
    expect(socketPluginCalls().map((r) => r.method)).toEqual([rpcMethod('cleanup.approve')])
  })

  it('a host that does not name the selected profile keeps using its only backend (the socket)', async () => {
    const state = host.state as { profile?: unknown }
    const saved = state.profile
    state.profile = undefined
    try {
      socketOn('/srv/hermes/profiles/work', { [rpcMethod('theme.save')]: () => ok })
      const out = await callRpc('theme.save', { theme_id: 'th_1' })
      expect(out).toEqual({ kind: 'ok', data: { items: [] } })
      expect(socketPluginCalls().map((r) => r.method)).toEqual([rpcMethod('theme.save')])
    } finally {
      state.profile = saved
    }
  })

  it('the socket profile is read once per gateway activation', async () => {
    socketOn(DEFAULT_HOME)
    sdkMock.profileRoutes = [WORK]
    sdkMock.profileRequestHandler = () => ok
    await callRpc('organize.reject', { channel_ids: ['x'] })
    await callRpc('organize.reject', { channel_ids: ['x'] })
    expect(sdkMock.requests.filter((r) => r.method === 'runtime.describe').length).toBeLessThanOrEqual(1)
  })
})

describe('RPC_FALLBACK', () => {
  it('matches each method\'s `fallback` in contract/rpc.yaml', () => {
    const yaml = readRepoFile('contract/rpc.yaml')
    const methodsBlock = yaml.slice(yaml.indexOf('\nmethods:'), yaml.indexOf('\nevents:'))
    const found: Record<string, string> = {}
    let current = ''
    for (const line of methodsBlock.split('\n')) {
      const m = line.match(/^ {2}([a-z_]+\.[a-z_]+):\s*$/)
      if (m) current = m[1]
      const f = line.match(/^ {4}fallback:\s*\{(message|rest):\s*([A-Za-z_]+)\}/)
      if (f && current) found[current] = `${f[1]}:${f[2]}`
    }
    const api = readRepoFile('shared/api-types.ts')
    const expected: Record<string, string> = {}
    for (const [name, fb] of Object.entries(RPC_FALLBACK)) {
      if ('message' in fb) expected[name] = `message:${fb.message}`
      else {
        const block = api.slice(api.indexOf(`"${fb.rest}": {`))
        const op = block.match(/operationId: "([A-Za-z]+)"/)?.[1]
        expected[name] = `rest:${op}`
      }
    }
    expect(Object.keys(found).length).toBeGreaterThan(0)
    expect(expected).toEqual(found)
  })
})
