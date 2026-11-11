// Service worker core. background/index.ts only calls `startBackground()`.
//
// - `ExtRequests` router (popup/content → background). The core answers `conn.status`, `state.get`, `feed.get`,
//   `videos.state`, `read.mark` (thin proxies to the routes); everything else belongs to the feature modules (`BackgroundModule.register`).
// - `ALARMS.state` alarm every `EXT_STATE_ALARM_S` (30 s) **while paired** (token saved): `GET /ext/state`,
//   cache in `STORAGE_KEYS.stateCache` (`{state, fetched_at}`) and notify the modules (`ctx.onState`). Pairing starts it and fetches
//   right away; unpairing stops it. Without a server the alarm keeps running (`reconnect_needed` state → "open Hermes").
// - Event listeners are registered synchronously in `start()` (MV3 requires it for the alarm to wake the SW).
import type { Envelope, ExtRouteKey, ExtState } from '../../../shared/api-types'
import type { ExtRequestType, ExtRequests, ExtTabCommandType, ExtTabCommands, ExtTabReply } from '../../../shared/ext-messages'
import { ALARMS, STORAGE_KEYS } from '../../../shared/ext-messages'
import { EXT_STATE_ALARM_S } from '../../../shared/ids'
import { onInstalledWelcome } from '../background/welcome'
import { ExtClient, type StoredConnection } from './client'
import { fail, ok } from './envelope'
import { setLanguage } from './i18n'
import { sendTabCommand } from './messaging'
import { createRouter, type Router } from './router'

export interface CachedState {
  state: ExtState
  /** epoch ms */
  fetched_at: number
}

export type StateListener = (state: ExtState) => void | Promise<void>
export type AlarmListener = (alarm: chrome.alarms.Alarm) => void | Promise<void>

/** What each feature module receives in `register(ctx)`. */
export interface BackgroundContext {
  client: ExtClient
  router: Router<ExtRequests>
  /** called on every new `ExtState` (30 s alarm, `state.get {refresh}`, pairing) */
  onState(cb: StateListener): () => void
  /** the module's own alarm (e.g. `ALARMS.sync`); the module creates/clears it with chrome.alarms */
  onAlarm(name: string, cb: AlarmListener): void
  /** last cached ExtState (no network) */
  getState(): Promise<CachedState | null>
  /** forces `GET /ext/state` (updates the cache and notifies listeners) */
  refreshState(): Promise<Envelope<ExtState>>
  sendTabCommand<K extends ExtTabCommandType>(tabId: number, type: K, payload: ExtTabCommands[K]['req']): Promise<ExtTabReply<K>>
  now(): number
}

/** Contract of a background feature module. */
export interface BackgroundModule {
  /** module path, e.g. `background/sync` */
  MODULE: string
  /** server routes the module uses (contract) */
  ROUTES: readonly ExtRouteKey[]
  /** routes that are really implemented (skeleton: empty → answers with a stub) */
  REAL_ROUTES: readonly ExtRouteKey[]
  /** `ExtRequests` messages the module handles */
  MESSAGES: readonly ExtRequestType[]
  register(ctx: BackgroundContext): void
}

/** Messages handled by the core. */
export const CORE_MESSAGES = ['conn.status', 'state.get', 'feed.get', 'videos.state', 'read.mark'] as const satisfies readonly ExtRequestType[]
/** Routes used by the core (client + proxies), all real. */
export const CORE_ROUTES = ['GET /health', 'GET /ext/state', 'GET /ext/feed', 'POST /ext/videos/state', 'POST /ext/read'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = CORE_ROUTES

export interface BackgroundOptions {
  client?: ExtClient
  modules: readonly BackgroundModule[]
  now?: () => number
}

export interface Background {
  ctx: BackgroundContext
  router: Router<ExtRequests>
  client: ExtClient
  /** registers listeners (synchronous) and syncs the alarm with the pairing */
  start(): void
  refreshState(): Promise<Envelope<ExtState>>
}

export function createBackground(opts: BackgroundOptions): Background {
  const client = opts.client ?? new ExtClient()
  const now = opts.now ?? (() => Date.now())
  const router = createRouter<ExtRequests>()
  const stateListeners = new Set<StateListener>()
  const alarmListeners = new Map<string, AlarmListener[]>()
  let inflight: Promise<Envelope<ExtState>> | null = null

  async function getState(): Promise<CachedState | null> {
    const got = await chrome.storage.local.get(STORAGE_KEYS.stateCache)
    return (got[STORAGE_KEYS.stateCache] as CachedState | undefined) ?? null
  }

  async function doRefresh(): Promise<Envelope<ExtState>> {
    const res = await client.request('GET /ext/state')
    if (res.ok) {
      setLanguage(res.data.language)
      const cached: CachedState = { state: res.data, fetched_at: now() }
      await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: cached })
      for (const cb of [...stateListeners]) {
        try {
          await cb(res.data)
        } catch (e) {
          console.warn('[tube] state listener failed', e)
        }
      }
    }
    return res
  }

  /** one `GET /ext/state` at a time (alarm + popup at the same time) */
  function refreshState(): Promise<Envelope<ExtState>> {
    if (!inflight) inflight = doRefresh().finally(() => (inflight = null))
    return inflight
  }

  async function syncAlarm(): Promise<void> {
    const got = await chrome.storage.local.get(STORAGE_KEYS.connection)
    const paired = Boolean((got[STORAGE_KEYS.connection] as StoredConnection | undefined)?.token)
    if (!paired) {
      await chrome.alarms.clear(ALARMS.state)
      return
    }
    const period = EXT_STATE_ALARM_S / 60
    const existing = await chrome.alarms.get(ALARMS.state)
    // recreating would push back the next firing: only create if missing or the period changed
    if (!existing || existing.periodInMinutes !== period) {
      await chrome.alarms.create(ALARMS.state, { periodInMinutes: period, delayInMinutes: period })
    }
  }

  const ctx: BackgroundContext = {
    client,
    router,
    onState(cb) {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    onAlarm(name, cb) {
      const list = alarmListeners.get(name) ?? []
      list.push(cb)
      alarmListeners.set(name, list)
    },
    getState,
    refreshState,
    sendTabCommand,
    now
  }

  // ------------------------------------------------------------ core messages
  router.on('conn.status', async (p) => {
    if (p?.probe) await refreshState()
    return client.status()
  })
  router.onEnvelope('state.get', async (p) => {
    if (p?.refresh) return refreshState()
    return ok((await getState())?.state ?? null)
  })
  router.onEnvelope('feed.get', async (p) => {
    const picked = (['tab', 'folder', 'channel'] as const).filter((k) => p?.[k])
    if (picked.length !== 1) return fail('invalid', 'exactly one of tab, folder, channel', { details: { field: 'tab|folder|channel' } })
    return client.request('GET /ext/feed', {
      query: { tab: p.tab, folder: p.folder, channel: p.channel, limit: p.limit, cursor: p.cursor ?? undefined }
    })
  })
  router.onEnvelope('videos.state', async (p) => client.request('POST /ext/videos/state', { body: p }))
  router.onEnvelope('read.mark', async (p) => client.request('POST /ext/read', { body: p }))

  // ------------------------------------------------------------ feature modules
  for (const m of opts.modules) m.register(ctx)

  return {
    ctx,
    router,
    client,
    refreshState,
    start() {
      router.listen()
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARMS.state) return void refreshState()
        for (const cb of alarmListeners.get(alarm.name) ?? []) {
          Promise.resolve()
            .then(() => cb(alarm))
            .catch((e) => console.warn(`[tube] alarm ${alarm.name} failed`, e))
        }
      })
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !(STORAGE_KEYS.connection in changes)) return
        const { oldValue, newValue } = changes[STORAGE_KEYS.connection] as {
          oldValue?: StoredConnection
          newValue?: StoredConnection
        }
        if (oldValue?.token === newValue?.token) return // only status/port changed
        void syncAlarm()
        if (newValue?.token) void refreshState() // just paired: fetch state right away
      })
      chrome.runtime.onInstalled?.addListener((details) => {
        void syncAlarm()
        onInstalledWelcome(details) // first load: the pairing screen opens in a tab
      })
      chrome.runtime.onStartup?.addListener(() => void syncAlarm())
      void syncAlarm()
    }
  }
}
