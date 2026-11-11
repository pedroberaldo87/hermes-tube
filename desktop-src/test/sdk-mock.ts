// Mock of `@hermes/plugin-sdk` for vitest. The vitest.config.ts alias swaps the
// `@hermes/plugin-sdk` import for this file; `tsc` still types the code against the real .d.ts.
//
// Covers what the shell and the screens use: `host` (request/navigate/notify/onEvent/state), a minimal React Query
// (useQuery/useMutation/useQueryClient/queryClient with refetchInterval, enabled, staleTime,
// invalidateQueries by prefix), minimal nanostores (atom/computed/useValue), the plugin i18n
// (usePluginI18n/translateNow), areas and kit components as plain DOM.
//
// Test-only helpers (import from `desktop-src/test/sdk-mock`, not from `@hermes/plugin-sdk`):
// `sdkMock` (recorded state and hooks), `createMockCtx()`, `emitEvent()`, `resetSdkMock()`.
// No network: `host.request` and `ctx.rest` call the handlers set up in the test.
import type { ReactElement, ReactNode } from 'react'
import { cloneElement, createElement, Fragment, isValidElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>

// ------------------------------------------------------------------ minimal nanostores

export interface MockStore<T> {
  get(): T
  readonly value: T
  /** Calls right away with the current value and on each change. */
  subscribe(cb: (value: T) => void): () => void
  /** Changes only. */
  listen(cb: (value: T) => void): () => void
}

export interface MockAtom<T> extends MockStore<T> {
  set(value: T): void
}

export function atom<T>(initial: T): MockAtom<T> {
  let value = initial
  const listeners = new Set<(v: T) => void>()
  return {
    get: () => value,
    get value() {
      return value
    },
    set(next: T) {
      if (Object.is(next, value)) return
      value = next
      for (const l of [...listeners]) l(value)
    },
    listen(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    subscribe(cb) {
      cb(value)
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}

export function computed<T>(stores: MockStore<any> | MockStore<any>[], fn: (...values: any[]) => T): MockStore<T> {
  const list = Array.isArray(stores) ? stores : [stores]
  const calc = () => fn(...list.map((s) => s.get()))
  const out = atom<T>(calc())
  for (const s of list) s.listen(() => out.set(calc()))
  return out
}

export function useValue<T>(store: MockStore<T>): T {
  return useSyncExternalStore(
    (cb) => store.listen(() => cb()),
    () => store.get(),
    () => store.get()
  )
}

// ------------------------------------------------------------------ minimal React Query

type QueryStatus = 'pending' | 'success' | 'error'

interface QueryState {
  data: unknown
  error: unknown
  status: QueryStatus
  fetchStatus: 'idle' | 'fetching'
  dataUpdatedAt: number
  errorUpdatedAt: number
  isInvalidated: boolean
}

interface Observer {
  options: () => AnyProps
  schedule: () => void
  stop: () => void
}

export class MockQuery {
  readonly hash: string
  readonly queryKey: readonly unknown[]
  state: QueryState = {
    data: undefined,
    error: null,
    status: 'pending',
    fetchStatus: 'idle',
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    isInvalidated: false
  }
  version = 0
  fetchCount = 0
  readonly observers = new Set<Observer>()
  private readonly listeners = new Set<() => void>()
  private promise: Promise<void> | null = null

  constructor(queryKey: readonly unknown[]) {
    this.queryKey = queryKey
    this.hash = hashKey(queryKey)
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  getVersion = (): number => this.version

  notify(): void {
    this.version += 1
    for (const l of [...this.listeners]) l()
  }

  fetch(queryFn: ((ctx: AnyProps) => unknown) | undefined): Promise<void> {
    if (this.promise) return this.promise
    if (!queryFn) return Promise.resolve()
    this.fetchCount += 1
    this.state = { ...this.state, fetchStatus: 'fetching' }
    this.notify()
    const signal = new AbortController().signal
    this.promise = Promise.resolve()
      .then(() => queryFn({ queryKey: this.queryKey, signal, meta: undefined }))
      .then(
        (data) => {
          this.state = {
            ...this.state,
            data,
            error: null,
            status: 'success',
            dataUpdatedAt: Date.now(),
            isInvalidated: false
          }
        },
        (error: unknown) => {
          this.state = { ...this.state, error, status: 'error', errorUpdatedAt: Date.now(), isInvalidated: false }
        }
      )
      .finally(() => {
        this.state = { ...this.state, fetchStatus: 'idle' }
        this.promise = null
        this.notify()
        for (const o of this.observers) o.schedule()
      })
    return this.promise
  }

  firstQueryFn(): ((ctx: AnyProps) => unknown) | undefined {
    for (const o of this.observers) {
      const opts = o.options()
      if (opts.enabled !== false && opts.queryFn) return opts.queryFn
    }
    return undefined
  }
}

export function hashKey(key: readonly unknown[]): string {
  return JSON.stringify(key, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as AnyProps)[k]]))
      : v
  )
}

function keyMatches(prefix: readonly unknown[] | undefined, key: readonly unknown[]): boolean {
  if (!prefix) return true
  if (prefix.length > key.length) return false
  return prefix.every((p, i) => hashKey([p]) === hashKey([key[i]]))
}

export class MockQueryClient {
  readonly queries = new Map<string, MockQuery>()

  build(queryKey: readonly unknown[]): MockQuery {
    const hash = hashKey(queryKey)
    let q = this.queries.get(hash)
    if (!q) {
      q = new MockQuery(queryKey)
      this.queries.set(hash, q)
    }
    return q
  }

  find(queryKey: readonly unknown[]): MockQuery | undefined {
    return this.queries.get(hashKey(queryKey))
  }

  getQueryData<T = unknown>(queryKey: readonly unknown[]): T | undefined {
    return this.find(queryKey)?.state.data as T | undefined
  }

  setQueryData<T>(queryKey: readonly unknown[], updater: T | ((old: T | undefined) => T)): T {
    const q = this.build(queryKey)
    const next =
      typeof updater === 'function' ? (updater as (old: T | undefined) => T)(q.state.data as T | undefined) : updater
    q.state = { ...q.state, data: next, status: 'success', error: null, dataUpdatedAt: Date.now() }
    q.notify()
    return next
  }

  invalidateQueries(filters: { queryKey?: readonly unknown[] } = {}): Promise<void> {
    const runs: Promise<void>[] = []
    for (const q of this.queries.values()) {
      if (!keyMatches(filters.queryKey, q.queryKey)) continue
      q.state = { ...q.state, isInvalidated: true }
      if (q.observers.size > 0) runs.push(q.fetch(q.firstQueryFn()))
    }
    return Promise.all(runs).then(() => undefined)
  }

  refetchQueries(filters: { queryKey?: readonly unknown[] } = {}): Promise<void> {
    return this.invalidateQueries(filters)
  }

  removeQueries(filters: { queryKey?: readonly unknown[] } = {}): void {
    for (const [hash, q] of [...this.queries]) {
      if (keyMatches(filters.queryKey, q.queryKey)) {
        for (const o of q.observers) o.stop()
        this.queries.delete(hash)
      }
    }
  }

  cancelQueries(): Promise<void> {
    return Promise.resolve()
  }

  clear(): void {
    this.removeQueries()
  }
}

export const queryClient = new MockQueryClient()

export function useQueryClient(): MockQueryClient {
  return queryClient
}

function intervalOf(options: AnyProps, query: MockQuery): number | false {
  const ri = options.refetchInterval
  const value = typeof ri === 'function' ? ri(query) : ri
  return typeof value === 'number' && value > 0 ? value : false
}

export function useQuery(options: AnyProps): AnyProps {
  const query = queryClient.build(options.queryKey as unknown[])
  const optionsRef = useRef(options)
  optionsRef.current = options
  useSyncExternalStore(query.subscribe, query.getVersion, query.getVersion)
  const enabled = options.enabled !== false
  const interval = intervalOf(options, query)
  const observerRef = useRef<Observer | null>(null)

  // mount/enable: subscribes and fetches if there is no fresh data (like React Query)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const observer: Observer = {
      options: () => optionsRef.current,
      stop,
      schedule: () => {
        stop()
        const opts = optionsRef.current
        if (opts.enabled === false) return
        const ms = intervalOf(opts, query)
        if (ms === false) return
        timer = setTimeout(() => {
          void query.fetch(optionsRef.current.queryFn)
        }, ms)
      }
    }
    observerRef.current = observer
    query.observers.add(observer)
    if (enabled) {
      const staleTime = typeof optionsRef.current.staleTime === 'number' ? optionsRef.current.staleTime : 0
      const fresh =
        query.state.status === 'success' &&
        !query.state.isInvalidated &&
        Date.now() - query.state.dataUpdatedAt < staleTime
      if (!fresh) void query.fetch(optionsRef.current.queryFn)
      else observer.schedule()
    }
    return () => {
      stop()
      query.observers.delete(observer)
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [query, enabled])

  // changing the interval only reschedules (does not fetch)
  useEffect(() => {
    observerRef.current?.schedule()
  }, [interval])

  const s = query.state
  return {
    data: s.data,
    error: s.error,
    status: s.status,
    fetchStatus: s.fetchStatus,
    isPending: s.status === 'pending',
    isLoading: s.status === 'pending' && s.fetchStatus === 'fetching',
    isFetching: s.fetchStatus === 'fetching',
    isError: s.status === 'error',
    isSuccess: s.status === 'success',
    dataUpdatedAt: s.dataUpdatedAt,
    refetch: () => query.fetch(optionsRef.current.queryFn).then(() => ({ data: query.state.data })),
    queryKey: options.queryKey
  }
}

export function useMutation(options: AnyProps): AnyProps {
  const [state, setState] = useState<AnyProps>({ status: 'idle', data: undefined, error: null, variables: undefined })
  const optionsRef = useRef(options)
  optionsRef.current = options
  const mutateAsync = async (variables: unknown, callbacks: AnyProps = {}) => {
    setState({ status: 'pending', data: undefined, error: null, variables })
    try {
      const data = await optionsRef.current.mutationFn(variables)
      setState({ status: 'success', data, error: null, variables })
      await optionsRef.current.onSuccess?.(data, variables, undefined)
      callbacks.onSuccess?.(data, variables, undefined)
      await optionsRef.current.onSettled?.(data, null, variables, undefined)
      callbacks.onSettled?.(data, null, variables, undefined)
      return data
    } catch (error) {
      setState({ status: 'error', data: undefined, error, variables })
      await optionsRef.current.onError?.(error, variables, undefined)
      callbacks.onError?.(error, variables, undefined)
      await optionsRef.current.onSettled?.(undefined, error, variables, undefined)
      callbacks.onSettled?.(undefined, error, variables, undefined)
      throw error
    }
  }
  return {
    ...state,
    isIdle: state.status === 'idle',
    isPending: state.status === 'pending',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    mutateAsync,
    mutate: (variables: unknown, callbacks?: AnyProps) => {
      mutateAsync(variables, callbacks).catch(() => undefined)
    },
    reset: () => setState({ status: 'idle', data: undefined, error: null, variables: undefined })
  }
}

// ------------------------------------------------------------------ recorded state + host

export interface RecordedRequest {
  method: string
  params: Record<string, unknown> | undefined
  timeoutMs: number | undefined
}

export interface RecordedRest {
  path: string
  opts: AnyProps | undefined
}

export interface PetLine {
  text: string
  options: AnyProps | undefined
}

type EventListener = (event: AnyProps) => void

export interface MockProfileRoute {
  connectionId: string
  mode: 'local' | 'remote'
  primary?: true
  profile: string
  targetProfile: string
}

interface MockState {
  requests: RecordedRequest[]
  restCalls: RecordedRest[]
  navigations: string[]
  notifications: AnyProps[]
  petLines: PetLine[]
  openedExternal: string[]
  /** Answers `host.request`; default: rejects (no backend). */
  requestHandler: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => unknown
  /** `host.profileRoutes()`; `null` = no route registry (webapp, older Desktop): throws. */
  profileRoutes: MockProfileRoute[] | null
  /** Answers `host.requestProfile(route, …)`; default: rejects (no per-route backend). */
  profileRequestHandler: (route: MockProfileRoute | string, method: string, params?: Record<string, unknown>) => unknown
  profileRequests: { route: MockProfileRoute | string; method: string; params?: Record<string, unknown> }[]
  /** Answers `ctx.rest`; default: rejects (no backend). */
  restHandler: (path: string, opts?: AnyProps) => unknown
  eventListeners: Map<string, Set<EventListener>>
  i18nBundles: Map<string, AnyProps>
  epoch: number
  /** `host.openWorkspace`: tabs opened by id (the last call wins, as in the app). */
  workspaces: Map<string, MockWorkspace>
  /** Every `host.openWorkspace` call, in order. */
  workspaceOpens: Array<{ id: string; title: string | undefined }>
  /** `host.paneVisibility(id)`: one atom per pane id in the tree (`<plugin>:<pane>`); starts off screen. */
  paneVisible: Map<string, MockAtom<boolean>>
  /** Every `host.revealPane` call, in order (the mock puts the pane on screen, like the app). */
  paneReveals: string[]
  /** Every `host.undismissPane` call, in order. */
  paneUndismisses: string[]
  /** Every `ctx.runAction` call, in order. */
  actions: string[]
  /** Answers `ctx.runAction`; default: the app refuses (`{ ok: false }`), nothing changes. */
  actionHandler: (id: string) => { ok: boolean; error?: string }
}

/** What `host.openWorkspace(id, options)` received. */
export interface MockWorkspace {
  id: string
  title: string | undefined
  render: () => ReactNode
  onClose?: () => void
  minWidth?: string
  /** The tab's ✕ (like the app: unmounts and calls `onClose`). */
  close: () => void
}

function freshState(): MockState {
  return {
    requests: [],
    restCalls: [],
    navigations: [],
    notifications: [],
    petLines: [],
    openedExternal: [],
    requestHandler: (method) => Promise.reject(Object.assign(new Error(`no handler for ${method}`), { code: -32000 })),
    profileRoutes: null,
    profileRequestHandler: (_route, method) =>
      Promise.reject(Object.assign(new Error(`unknown method: ${method}`), { code: -32601 })),
    profileRequests: [],
    restHandler: (path) => Promise.reject(new Error(`no rest handler for ${path}`)),
    eventListeners: new Map(),
    i18nBundles: new Map(),
    epoch: 1,
    workspaces: new Map(),
    workspaceOpens: [],
    paneVisible: new Map(),
    paneReveals: [],
    paneUndismisses: [],
    actions: [],
    actionHandler: () => ({ ok: false, error: 'mock' })
  }
}

/** Visibility atom of a pane (the same object on each call, like the app's memoized `$paneVisible`). */
export function paneVisibleAtom(id: string): MockAtom<boolean> {
  let a = sdkMock.paneVisible.get(id)
  if (!a) {
    a = atom(false)
    sdkMock.paneVisible.set(id, a)
  }
  return a
}

/** Puts a pane on/off screen (what the user would do in the app: tab, ⌘J, zone menu). */
export function setPaneVisible(id: string, visible: boolean): void {
  paneVisibleAtom(id).set(visible)
}

/** Mock state: the test reads what was called and swaps the handlers. */
export const sdkMock: MockState & { locale: MockAtom<string>; petVisible: MockAtom<boolean> } = Object.assign(
  freshState(),
  { locale: atom('en'), petVisible: atom(true) }
)

function addListener(type: string, listener: EventListener): () => void {
  let set = sdkMock.eventListeners.get(type)
  if (!set) {
    set = new Set()
    sdkMock.eventListeners.set(type, set)
  }
  set.add(listener)
  return () => {
    sdkMock.eventListeners.get(type)?.delete(listener)
  }
}

/** Delivers a gateway event (`{type, payload, session_id: ''}`) to every listener of the type and of `*`. */
export function emitEvent(type: string, payload: unknown): void {
  const frame = { type, payload, session_id: '' }
  for (const key of [type, '*']) {
    for (const l of [...(sdkMock.eventListeners.get(key) ?? [])]) l(frame)
  }
}

export function listenerCount(type: string): number {
  return sdkMock.eventListeners.get(type)?.size ?? 0
}

/** JSON-RPC error like Desktop's (`JsonRpcGatewayError`: `message` + `code`). */
export function rpcError(code: number, message = 'rpc error'): Error & { code: number } {
  return Object.assign(new Error(message), { code })
}

export const host = {
  state: {
    activeSessionId: atom<string | null>(null),
    awaitingResponse: atom(false),
    busy: atom(false),
    busyBySession: atom<Record<string, boolean>>({}),
    connectionId: atom<string | null>(null),
    cwd: atom(''),
    focusedSessionId: atom<string | null>(null),
    focusedSessionProfile: atom('default'),
    focusedStoredSessionId: atom<string | null>(null),
    focusedUsage: atom(null),
    gateway: atom('open'),
    model: atom('mock-model'),
    profile: atom('default'),
    viewport: atom({ width: 1280, height: 800, narrow: false })
  },
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    sdkMock.requests.push({ method, params, timeoutMs })
    try {
      return Promise.resolve(sdkMock.requestHandler(method, params, timeoutMs)) as Promise<T>
    } catch (error) {
      return Promise.reject(error)
    }
  },
  profileRoutes(): Promise<MockProfileRoute[]> {
    if (!sdkMock.profileRoutes) return Promise.reject(new Error('Hermes Desktop connection routing unavailable'))
    return Promise.resolve(sdkMock.profileRoutes)
  },
  requestProfile<T>(route: MockProfileRoute | string, method: string, params?: Record<string, unknown>): Promise<T> {
    sdkMock.profileRequests.push({ route, method, params })
    try {
      return Promise.resolve(sdkMock.profileRequestHandler(route, method, params)) as Promise<T>
    } catch (error) {
      return Promise.reject(error)
    }
  },
  navigate(path: string): void {
    sdkMock.navigations.push(path)
  },
  notify(n: AnyProps): string {
    sdkMock.notifications.push(n)
    return `n${sdkMock.notifications.length}`
  },
  notifyError(error: unknown, fallback: string): string {
    sdkMock.notifications.push({ kind: 'error', message: fallback, error })
    return `n${sdkMock.notifications.length}`
  },
  onEvent(type: string, listener: EventListener): () => void {
    return addListener(type, listener)
  },
  status: () => Promise.resolve({}),
  logs: () => Promise.resolve({}),
  restartGateway: () => Promise.resolve(true),
  i18n: {
    registerAppLocale: () => () => undefined,
    languageOptions: () => []
  },
  /** Center area tab. Older Desktop test: `host.openWorkspace = undefined` (the reset restores it). */
  openWorkspace: mockOpenWorkspace as typeof mockOpenWorkspace | undefined,
  /** Reactive visibility of a pane. Older Desktop: `= undefined` (the reset restores it). */
  paneVisibility: mockPaneVisibility as typeof mockPaneVisibility | undefined,
  /** Explicit "show the pane" action: in the app it undoes Close/Hide, opens the column and brings the tab to front. */
  revealPane: mockRevealPane as typeof mockRevealPane | undefined,
  /** Forgets a remembered Close without bringing it to front. */
  undismissPane: mockUndismissPane as typeof mockUndismissPane | undefined
}

function mockPaneVisibility(id: string): MockAtom<boolean> {
  return paneVisibleAtom(id)
}

function mockRevealPane(id: string): void {
  sdkMock.paneReveals.push(id)
  setPaneVisible(id, true)
}

function mockUndismissPane(id: string): void {
  sdkMock.paneUndismisses.push(id)
}

/** Like the app: reopening the same id swaps `render`/`title` in place (a single tab); returns the closer. */
function mockOpenWorkspace(
  id: string,
  options: { title?: string; render: () => ReactNode; onClose?: () => void; minWidth?: string; dock?: unknown; headerVeto?: boolean }
): () => void {
  if (!id || typeof options?.render !== 'function') throw new Error('openWorkspace: an id and a render function are required')
  sdkMock.workspaceOpens.push({ id, title: options.title })
  const ws: MockWorkspace = {
    id,
    title: options.title,
    render: options.render,
    onClose: options.onClose,
    minWidth: options.minWidth,
    close: () => {
      if (sdkMock.workspaces.get(id) === ws) sdkMock.workspaces.delete(id)
      options.onClose?.()
    }
  }
  sdkMock.workspaces.set(id, ws)
  return ws.close
}

export function gatewayActivationEpoch(): number {
  return sdkMock.epoch
}

// ------------------------------------------------------------------ plugin i18n

function lookup(tree: AnyProps | undefined, key: string): unknown {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as AnyProps)[part]
  }
  return node
}

function translate(pluginId: string, key: string, args: unknown[]): string {
  const bundles = sdkMock.i18nBundles.get(pluginId) ?? {}
  for (const loc of [sdkMock.locale.get(), 'en']) {
    const hit = lookup(bundles[loc], key)
    if (typeof hit === 'string') return hit
    if (typeof hit === 'function') return String((hit as (...a: unknown[]) => unknown)(...args))
  }
  return key
}

export function usePluginI18n(pluginId: string): (key: string, ...args: unknown[]) => string {
  const locale = useValue(sdkMock.locale)
  // the translator changes identity when the language changes (like in the app)
  const ref = useRef<{ locale: string; t: (key: string, ...args: unknown[]) => string } | null>(null)
  if (!ref.current || ref.current.locale !== locale) {
    ref.current = { locale, t: (key, ...args) => translate(pluginId, key, args) }
  }
  return ref.current.t
}

export function translateNow(key: string): string {
  return key
}

// ------------------------------------------------------------------ plugin ctx

export interface MockCtxHandle {
  ctx: any
  /** Registered contributions (with the local id, no namespace). */
  registrations: AnyProps[]
  disposers: Array<() => void>
  /** Runs every `onDispose` and disposer (like the plugin unload). */
  dispose(): void
  storage: Map<string, unknown>
}

export function createMockCtx(pluginId = 'mock-plugin'): MockCtxHandle {
  const registrations: AnyProps[] = []
  const disposers: Array<() => void> = []
  const storage = new Map<string, unknown>()
  const track = (fn: () => void) => {
    disposers.push(fn)
    return fn
  }
  const register = (c: AnyProps) => {
    registrations.push(c)
    return track(() => {
      const i = registrations.indexOf(c)
      if (i >= 0) registrations.splice(i, 1)
    })
  }
  const ctx = {
    source: `plugin:${pluginId}`,
    register,
    registerMany: (cs: AnyProps[]) => {
      const ds = cs.map((c) => register(c))
      return () => ds.forEach((d) => d())
    },
    registerSettingsPage: (page: AnyProps) => register({ id: page.id, area: 'settings.plugins', data: page }),
    onDispose: (fn: () => void) => {
      track(fn)
    },
    onEvent: (type: string, listener: EventListener) => track(addListener(type, listener)),
    setTimeout: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      return track(() => clearTimeout(t))
    },
    setInterval: (fn: () => void, ms: number) => {
      const t = setInterval(fn, ms)
      return track(() => clearInterval(t))
    },
    addEventListener: (target: EventTarget, type: string, listener: any, options?: any) => {
      target.addEventListener(type, listener, options)
      return track(() => target.removeEventListener(type, listener, options))
    },
    rest: <T>(path: string, opts?: AnyProps): Promise<T> => {
      sdkMock.restCalls.push({ path, opts })
      try {
        return Promise.resolve(sdkMock.restHandler(path, opts)) as Promise<T>
      } catch (error) {
        return Promise.reject(error)
      }
    },
    socket: () => () => undefined,
    os: {
      notify: () => undefined,
      openExternal: (url: string) => {
        sdkMock.openedExternal.push(url)
        return Promise.resolve(true)
      },
      revealPath: () => Promise.resolve(false),
      pickSavePath: () => Promise.resolve(null),
      pickOpenPath: () => Promise.resolve(null),
      writeClipboard: () => Promise.resolve(true)
    },
    pet: {
      say: (text: string, options?: AnyProps) => {
        sdkMock.petLines.push({ text, options })
        return () => undefined
      },
      clear: () => undefined,
      visible: sdkMock.petVisible
    },
    runAction: (id: string) => {
      sdkMock.actions.push(id)
      return sdkMock.actionHandler(id)
    },
    listActions: () => [],
    preview: { isAvailable: () => false, executeJavaScript: () => Promise.reject(new Error('mock')) },
    storage: {
      get: <T>(key: string, fallback: T): T => (storage.has(key) ? (storage.get(key) as T) : fallback),
      set: (key: string, value: unknown) => {
        storage.set(key, value)
      },
      remove: (key: string) => {
        storage.delete(key)
      }
    },
    files: {},
    i18n: {
      register: (bundles: AnyProps) => {
        const prev = sdkMock.i18nBundles.get(pluginId) ?? {}
        const merged: AnyProps = { ...prev }
        for (const [loc, tree] of Object.entries(bundles)) merged[loc] = { ...(prev[loc] ?? {}), ...(tree ?? {}) }
        sdkMock.i18nBundles.set(pluginId, merged)
        return track(() => sdkMock.i18nBundles.delete(pluginId))
      },
      t: (key: string, ...args: unknown[]) => translate(pluginId, key, args),
      onLocaleChange: (listener: () => void) => track(sdkMock.locale.listen(() => listener())),
      registerAppLocale: () => () => undefined
    }
  }
  return {
    ctx,
    registrations,
    disposers,
    storage,
    dispose() {
      for (const d of disposers.splice(0).reverse()) d()
    }
  }
}

// ------------------------------------------------------------------ reset between tests

export function resetSdkMock(): void {
  queryClient.clear()
  Object.assign(sdkMock, freshState())
  host.openWorkspace = mockOpenWorkspace
  host.paneVisibility = mockPaneVisibility
  host.revealPane = mockRevealPane
  host.undismissPane = mockUndismissPane
  sdkMock.locale.set('en')
  sdkMock.petVisible.set(true)
}

// ------------------------------------------------------------------ areas (same values as the SDK)

export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const PANES_AREA = 'panes'
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'
export const WORKSPACE_PAGE_HEADER_AREA = 'workspace.pageHeader'
export const SETTINGS_PLUGINS_AREA = 'settings.plugins'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' } as const
export const TITLEBAR_AREAS = { center: 'titleBar.center', left: 'titleBar.left', right: 'titleBar.right' } as const

// ------------------------------------------------------------------ UI kit as plain DOM

function passthrough(tag: string, slot: string) {
  const C = ({ children, asChild: _asChild, variant, size, loading, ...rest }: AnyProps) =>
    createElement(
      tag,
      {
        'data-slot': slot,
        ...(variant ? { 'data-variant': String(variant) } : {}),
        ...(size ? { 'data-size': String(size) } : {}),
        ...(loading ? { 'aria-busy': 'true' } : {}),
        ...rest
      },
      children
    )
  C.displayName = `Mock(${slot})`
  return C
}

export const Button = ({ children, asChild: _a, variant, size, loading, type, ...rest }: AnyProps) =>
  createElement(
    'button',
    {
      'data-slot': 'button',
      type: type ?? 'button',
      ...(variant ? { 'data-variant': String(variant) } : {}),
      ...(size ? { 'data-size': String(size) } : {}),
      ...(loading ? { 'aria-busy': 'true' } : {}),
      ...rest
    },
    children
  )
export const Badge = passthrough('span', 'badge')
export const Kbd = passthrough('kbd', 'kbd')
export const KbdGroup = passthrough('span', 'kbd-group')
export const Separator = () => createElement('hr', { 'data-slot': 'separator' })
export const Skeleton = passthrough('div', 'skeleton')
export const ScrollArea = passthrough('div', 'scroll-area')
export const RowButton = ({ children, ...rest }: AnyProps) =>
  createElement('button', { type: 'button', 'data-slot': 'row-button', ...rest }, children)
export const Input = (props: AnyProps) => createElement('input', { 'data-slot': 'input', ...props })
export const Textarea = (props: AnyProps) => createElement('textarea', { 'data-slot': 'textarea', ...props })
export const SearchField = ({ onChange, value, ...rest }: AnyProps) =>
  createElement('input', {
    'data-slot': 'search-field',
    value,
    onChange: (e: AnyProps) => onChange?.(e.target.value, e),
    ...rest
  })
export const Checkbox = ({ checked, onCheckedChange, ...rest }: AnyProps) =>
  createElement('input', {
    type: 'checkbox',
    'data-slot': 'checkbox',
    checked: !!checked,
    onChange: (e: AnyProps) => onCheckedChange?.(e.target.checked),
    ...rest
  })
export const Switch = ({ checked, onCheckedChange, ...rest }: AnyProps) =>
  createElement('input', {
    type: 'checkbox',
    role: 'switch',
    'data-slot': 'switch',
    checked: !!checked,
    onChange: (e: AnyProps) => onCheckedChange?.(e.target.checked),
    ...rest
  })
export const Codicon = ({ name, className }: AnyProps) =>
  createElement('i', { 'data-slot': 'codicon', 'data-icon': name, className })
export const StatusDot = ({ tone }: AnyProps) => createElement('span', { 'data-slot': 'status-dot', 'data-tone': tone })
export const GlyphSpinner = () => createElement('span', { 'data-slot': 'glyph-spinner' })
export const Loader = ({ label, className }: AnyProps) =>
  createElement('div', { 'data-slot': 'loader', role: 'status', 'aria-label': label, className }, label ?? null)
export const EmptyState = ({ title, description, className }: AnyProps) =>
  createElement(
    'div',
    { 'data-slot': 'empty-state', className },
    createElement('p', { 'data-slot': 'empty-title' }, title),
    description ? createElement('p', { 'data-slot': 'empty-description' }, description) : null
  )
export const ErrorState = ({ title, description, children, className }: AnyProps) =>
  createElement(
    'div',
    { 'data-slot': 'error-state', role: 'alert', className },
    createElement('p', { 'data-slot': 'error-title' }, title),
    description ? createElement('p', { 'data-slot': 'error-description' }, description) : null,
    children ?? null
  )
// Like the app's: `TooltipTrigger asChild` — no wrapper and no native `title`; the child carries the tooltip and the delay
// (`data-tip`, `data-tip-delay`) for the tests to read. Without `label`, returns the child as is.
export const Tip = ({ children, label, delayDuration }: AnyProps) =>
  label && isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        'data-tip': typeof label === 'string' ? label : '',
        'data-tip-delay': delayDuration === undefined ? undefined : String(delayDuration)
      })
    : createElement(Fragment, null, children)
export const Tooltip = passthrough('span', 'tooltip')
export const TooltipTrigger = passthrough('span', 'tooltip-trigger')
export const TooltipContent = passthrough('span', 'tooltip-content')
export const TooltipProvider = ({ children }: AnyProps) => createElement(Fragment, null, children)

// Controlled dialog: a false `open` renders nothing; "close" calls onOpenChange(false).
export const Dialog = ({ open, onOpenChange, children }: AnyProps) =>
  open === false
    ? null
    : createElement(
        'div',
        { 'data-slot': 'dialog', role: 'dialog' },
        createElement(
          'button',
          { type: 'button', 'data-slot': 'dialog-dismiss', onClick: () => onOpenChange?.(false) },
          '×'
        ),
        children
      )
export const DialogContent = ({ children, showCloseButton: _s, banner, ...rest }: AnyProps) =>
  createElement('div', { 'data-slot': 'dialog-content', ...rest }, banner ?? null, children)
export const DialogHeader = passthrough('div', 'dialog-header')
export const DialogFooter = passthrough('div', 'dialog-footer')
export const DialogTitle = ({ children, icon: _i, ...rest }: AnyProps) =>
  createElement('h2', { 'data-slot': 'dialog-title', ...rest }, children)
export const DialogDescription = passthrough('p', 'dialog-description')
export const DialogTrigger = passthrough('span', 'dialog-trigger')
export const DialogClose = passthrough('span', 'dialog-close')
// Like the app's: `onClose` closes (cancel, or after `onConfirm` resolves); an `onConfirm` that rejects shows the
// error inside the dialog (`confirm-error`) and does not close. `onOpenChange` is still accepted (older mocks).
function ConfirmDialogMock({ title, description, onConfirm, onOpenChange, onClose, confirmLabel, cancelLabel, destructive }: AnyProps) {
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    onOpenChange?.(false)
    onClose?.()
  }
  return createElement(
    'div',
    { 'data-slot': 'confirm-dialog', role: 'alertdialog', 'data-destructive': destructive ? 'true' : undefined },
    createElement('p', { 'data-slot': 'confirm-title' }, title),
    description ? createElement('p', { 'data-slot': 'confirm-description' }, description) : null,
    error ? createElement('p', { 'data-slot': 'confirm-error' }, error) : null,
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => {
          setError(null)
          Promise.resolve()
            .then(() => onConfirm?.())
            .then(
              () => onClose?.(),
              (e: unknown) => setError(e instanceof Error ? e.message : String(e))
            )
        }
      },
      confirmLabel ?? 'OK'
    ),
    createElement('button', { type: 'button', onClick: close }, cancelLabel ?? 'cancel')
  )
}
export const ConfirmDialog = (props: AnyProps) => (props.open ? createElement(ConfirmDialogMock, props) : null)

export const Tabs = passthrough('div', 'tabs')
export const TabsList = passthrough('div', 'tabs-list')
export const TabsTrigger = ({ children, value, ...rest }: AnyProps) =>
  createElement('button', { type: 'button', 'data-slot': 'tabs-trigger', 'data-value': value, ...rest }, children)
export const SegmentedControl = passthrough('div', 'segmented-control')
export const Select = passthrough('div', 'select')
export const SelectTrigger = passthrough('div', 'select-trigger')
export const SelectValue = passthrough('span', 'select-value')
export const SelectContent = passthrough('div', 'select-content')
export const SelectItem = passthrough('div', 'select-item')
export const DropdownMenu = passthrough('div', 'dropdown-menu')
export const DropdownMenuTrigger = passthrough('div', 'dropdown-menu-trigger')
export const DropdownMenuContent = passthrough('div', 'dropdown-menu-content')
export const DropdownMenuItem = ({ children, onSelect, ...rest }: AnyProps) =>
  createElement('div', { role: 'menuitem', 'data-slot': 'dropdown-menu-item', onClick: onSelect, ...rest }, children)
export const DropdownMenuSeparator = () => createElement('hr', { 'data-slot': 'dropdown-menu-separator' })
export const ContextMenu = passthrough('div', 'context-menu')
export const ContextMenuTrigger = passthrough('div', 'context-menu-trigger')
export const ContextMenuContent = passthrough('div', 'context-menu-content')
export const ContextMenuItem = ({ children, onSelect, ...rest }: AnyProps) =>
  createElement('div', { role: 'menuitem', 'data-slot': 'context-menu-item', onClick: onSelect, ...rest }, children)
export const ContextMenuSeparator = () => createElement('hr', { 'data-slot': 'context-menu-separator' })
export const Popover = passthrough('div', 'popover')
export const PopoverTrigger = passthrough('div', 'popover-trigger')
export const PopoverContent = passthrough('div', 'popover-content')
export const CopyButton = ({ text }: AnyProps) =>
  createElement('button', { type: 'button', 'data-slot': 'copy-button', 'data-text': text }, 'copy')
export const ListRow = ({ label, description, children }: AnyProps) =>
  createElement('div', { 'data-slot': 'list-row' }, label, description ?? null, children ?? null)
export const ToggleRow = ({ label, checked, onCheckedChange }: AnyProps) =>
  createElement(
    'label',
    { 'data-slot': 'toggle-row' },
    label,
    createElement('input', {
      type: 'checkbox',
      role: 'switch',
      checked: !!checked,
      onChange: (e: AnyProps) => onCheckedChange?.(e.target.checked)
    })
  )
// The app's message renderer: in the app, a bare video link becomes the core's embedded player; here
// only the text, in a marker the tests read.
export const MessageTextContent = ({ text }: { text: string; media?: boolean; previewOnly?: boolean }) =>
  createElement('div', { 'data-slot': 'message-text', 'data-text': text }, text)
export const Contribute = (_props: { area: string; id: string; order?: number; children: ReactNode }) => null
export const WorkspacePageHeaderControl = ({ children }: AnyProps) => createElement(Fragment, null, children)

const IconStub = ({ className }: AnyProps) => createElement('svg', { 'data-slot': 'icon', className })
export const icons: Record<string, typeof IconStub> = new Proxy({} as Record<string, typeof IconStub>, {
  get: () => IconStub
})

// ------------------------------------------------------------------ helpers

export function cn(...inputs: unknown[]): string {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (!v) return
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'object') for (const [k, on] of Object.entries(v as AnyProps)) if (on) out.push(k)
  }
  inputs.forEach(walk)
  return out.join(' ')
}

export function haptic(): void {}

export function relativeTime(targetMs: number, nowMs = Date.now()): string {
  const s = Math.round((targetMs - nowMs) / 1000)
  return s < 0 ? `${-s}s ago` : `in ${s}s`
}

export function formatAgo(ms: number): string {
  return `${Math.max(0, Math.round((Date.now() - ms) / 1000))}s ago`
}

export function coarseElapsed(ms: number): { unit: string; value: number } {
  return { unit: 's', value: Math.max(0, Math.round(ms / 1000)) }
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString()
}

export function fmtDayTime(ms: number): string {
  return new Date(ms).toISOString()
}

export function compactNumber(value: number | null | undefined): string {
  if (value == null) return ''
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(value)
}

export function profileColor(name: string | null | undefined): string | null {
  return name ? 'var(--ui-accent)' : null
}

export function profileColorSoft(name: string | null | undefined): string | null {
  return name ? 'var(--ui-accent)' : null
}

export function writeClipboardText(_text: string): Promise<boolean> {
  return Promise.resolve(true)
}

export function isSubmitEnter(event: { key?: string; isComposing?: boolean }): boolean {
  return event.key === 'Enter' && !event.isComposing
}

export function useI18n(): AnyProps {
  return { t: {}, locale: sdkMock.locale.get() }
}
