// In-memory fake of the `chrome` API used by the extension. Installed on `globalThis.chrome` before each
// test by extension/test/setup.ts; any extension test can get the current fake with `chromeFake()`.
//
// Covers: storage.local (get/set/remove/clear + onChanged), runtime (id, onMessage, sendMessage, getManifest,
// getURL, onInstalled/onStartup), alarms (create/get/getAll/clear/clearAll + onAlarm, `fire(name)`),
// tabs (sendMessage with a configurable responder, create/remove/query/get/update + onUpdated/onRemoved),
// scripting.executeScript (records calls). No network.

type Listener<A extends unknown[]> = (...args: A) => unknown

export class FakeEvent<A extends unknown[]> {
  listeners: Listener<A>[] = []
  addListener = (fn: Listener<A>): void => {
    this.listeners.push(fn)
  }
  removeListener = (fn: Listener<A>): void => {
    this.listeners = this.listeners.filter((l) => l !== fn)
  }
  hasListener = (fn: Listener<A>): boolean => this.listeners.includes(fn)
  hasListeners = (): boolean => this.listeners.length > 0
  emit(...args: A): unknown[] {
    return [...this.listeners].map((l) => l(...args))
  }
}

export interface FakeAlarm {
  name: string
  periodInMinutes?: number
  delayInMinutes?: number
  scheduledTime: number
}

export interface FakeTab {
  id: number
  url: string
  active: boolean
  status: 'loading' | 'complete'
}

export type TabResponder = (tabId: number, message: unknown) => unknown | Promise<unknown>

export interface ChromeFake {
  chrome: typeof chrome
  storage: Map<string, unknown>
  /** chrome.storage.session (only extension pages and the service worker can reach it) */
  session: Map<string, unknown>
  /** every `storage.session.setAccessLevel` call (the extension must never open it to content scripts) */
  sessionAccessLevels: string[]
  /** `chrome.action` badge */
  badge: { text: string; color: string | null }
  alarms: Map<string, FakeAlarm>
  tabs: Map<number, FakeTab>
  /** messages sent to tabs: `[tabId, msg]` */
  tabMessages: Array<[number, unknown]>
  /** answers `chrome.tabs.sendMessage` (default: rejects like "Receiving end does not exist") */
  tabResponder: TabResponder | null
  scriptingCalls: unknown[]
  /** fires the `name` alarm (as Chrome would) and waits for the async listeners */
  fire(name: string): Promise<void>
  /** waits for pending promises of the microtask/macrotask queue */
  flush(): Promise<void>
  events: {
    storageChanged: FakeEvent<[Record<string, chrome.storage.StorageChange>, string]>
    message: FakeEvent<[unknown, chrome.runtime.MessageSender, (r?: unknown) => void]>
    alarm: FakeEvent<[chrome.alarms.Alarm]>
    installed: FakeEvent<[chrome.runtime.InstalledDetails]>
    startup: FakeEvent<[]>
    tabUpdated: FakeEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>
    tabRemoved: FakeEvent<[number, chrome.tabs.OnRemovedInfo]>
  }
}

export const FAKE_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

export function createChromeFake(manifest: Record<string, unknown> = { manifest_version: 3, version: '0.0.0' }): ChromeFake {
  const storage = new Map<string, unknown>()
  const sessionStore = new Map<string, unknown>()
  const sessionAccessLevels: string[] = []
  const badge: { text: string; color: string | null } = { text: '', color: null }
  const alarms = new Map<string, FakeAlarm>()
  const tabs = new Map<number, FakeTab>()
  const tabMessages: Array<[number, unknown]> = []
  const scriptingCalls: unknown[] = []
  let nextTabId = 100

  const events: ChromeFake['events'] = {
    storageChanged: new FakeEvent(),
    message: new FakeEvent(),
    alarm: new FakeEvent(),
    installed: new FakeEvent(),
    startup: new FakeEvent(),
    tabUpdated: new FakeEvent(),
    tabRemoved: new FakeEvent()
  }

  const pending = new Set<Promise<unknown>>()
  const track = <T>(p: Promise<T>): Promise<T> => {
    pending.add(p)
    p.finally(() => pending.delete(p)).catch(() => undefined)
    return p
  }

  function storageGet(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (keys == null) {
      for (const [k, v] of storage) out[k] = clone(v)
    } else if (typeof keys === 'string') {
      if (storage.has(keys)) out[keys] = clone(storage.get(keys))
    } else if (Array.isArray(keys)) {
      for (const k of keys) if (storage.has(k)) out[k] = clone(storage.get(k))
    } else {
      for (const [k, def] of Object.entries(keys)) out[k] = storage.has(k) ? clone(storage.get(k)) : def
    }
    return out
  }

  function emitChanges(changes: Record<string, chrome.storage.StorageChange>): void {
    if (Object.keys(changes).length) events.storageChanged.emit(changes, 'local')
  }

  const local = {
    get: async (keys?: string | string[] | Record<string, unknown> | null) => storageGet(keys),
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(storage.get(k)), newValue: clone(v) }
        storage.set(k, clone(v))
      }
      emitChanges(changes)
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (!storage.has(k)) continue
        changes[k] = { oldValue: clone(storage.get(k)) }
        storage.delete(k)
      }
      emitChanges(changes)
    },
    clear: async () => {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [k, v] of storage) changes[k] = { oldValue: clone(v) }
      storage.clear()
      emitChanges(changes)
    }
  }

  const runtime = {
    id: FAKE_EXTENSION_ID,
    lastError: undefined,
    getManifest: () => clone(manifest),
    getURL: (p: string) => `chrome-extension://${FAKE_EXTENSION_ID}/${p.replace(/^\//, '')}`,
    onMessage: events.message,
    onInstalled: events.installed,
    onStartup: events.startup,
    /** delivers the message to the onMessage listeners (as popup/content → background) */
    sendMessage: (message: unknown, sender: Partial<chrome.runtime.MessageSender> = {}) =>
      track(
        new Promise<unknown>((resolve) => {
          let answered = false
          const sendResponse = (r?: unknown) => {
            if (answered) return
            answered = true
            resolve(r)
          }
          const fullSender = { id: FAKE_EXTENSION_ID, ...sender } as chrome.runtime.MessageSender
          const results = events.message.emit(clone(message), fullSender, sendResponse)
          // no listener that returns `true` (async response) and no sync response → undefined
          if (!answered && !results.some((r) => r === true)) resolve(undefined)
        })
      )
  }

  const alarmsApi = {
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo = {}) => {
      const delay = info.delayInMinutes ?? info.periodInMinutes ?? 0
      alarms.set(name, {
        name,
        periodInMinutes: info.periodInMinutes,
        delayInMinutes: info.delayInMinutes,
        scheduledTime: info.when ?? Date.now() + delay * 60_000
      })
    },
    get: async (name: string) => clone(alarms.get(name)),
    getAll: async () => [...alarms.values()].map(clone),
    clear: async (name: string) => alarms.delete(name),
    clearAll: async () => {
      const had = alarms.size > 0
      alarms.clear()
      return had
    },
    onAlarm: events.alarm
  }

  const tabsApi = {
    sendMessage: (tabId: number, message: unknown) => {
      tabMessages.push([tabId, clone(message)])
      if (!fake.tabResponder) return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
      return track(Promise.resolve(fake.tabResponder(tabId, clone(message))))
    },
    create: async (props: chrome.tabs.CreateProperties) => {
      const tab: FakeTab = { id: nextTabId++, url: props.url ?? 'about:blank', active: props.active ?? true, status: 'complete' }
      tabs.set(tab.id, tab)
      return clone(tab) as unknown as chrome.tabs.Tab
    },
    remove: async (ids: number | number[]) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) tabs.delete(id)
    },
    get: async (id: number) => clone(tabs.get(id)) as unknown as chrome.tabs.Tab,
    query: async () => [...tabs.values()].map(clone) as unknown as chrome.tabs.Tab[],
    update: async (id: number, props: chrome.tabs.UpdateProperties) => {
      const t = tabs.get(id)
      if (t && props.url) t.url = props.url
      return clone(t) as unknown as chrome.tabs.Tab
    },
    onUpdated: events.tabUpdated,
    onRemoved: events.tabRemoved
  }

  const scripting = {
    executeScript: async (inj: unknown) => {
      scriptingCalls.push(clone(inj))
      return []
    }
  }

  // storage.session: same shape, its own map and area name (cleared when the browser closes or the extension reloads)
  const sessionGet = (keys?: string | string[] | null): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    const wanted = keys == null ? [...sessionStore.keys()] : Array.isArray(keys) ? keys : [keys]
    for (const k of wanted) if (sessionStore.has(k)) out[k] = clone(sessionStore.get(k))
    return out
  }
  const session = {
    get: async (keys?: string | string[] | null) => sessionGet(keys),
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(sessionStore.get(k)), newValue: clone(v) }
        sessionStore.set(k, clone(v))
      }
      if (Object.keys(changes).length) events.storageChanged.emit(changes, 'session')
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (!sessionStore.has(k)) continue
        changes[k] = { oldValue: clone(sessionStore.get(k)) }
        sessionStore.delete(k)
      }
      if (Object.keys(changes).length) events.storageChanged.emit(changes, 'session')
    },
    clear: async () => {
      sessionStore.clear()
    },
    setAccessLevel: async (opts: { accessLevel: string }) => {
      sessionAccessLevels.push(opts.accessLevel)
    }
  }

  const action = {
    setBadgeText: async (d: { text: string }) => {
      badge.text = d.text
    },
    setBadgeBackgroundColor: async (d: { color: string }) => {
      badge.color = d.color
    }
  }

  const fake: ChromeFake = {
    chrome: {
      storage: { local, session, onChanged: events.storageChanged },
      action,
      runtime,
      alarms: alarmsApi,
      tabs: tabsApi,
      scripting
    } as unknown as typeof chrome,
    storage,
    session: sessionStore,
    sessionAccessLevels,
    badge,
    alarms,
    tabs,
    tabMessages,
    tabResponder: null,
    scriptingCalls,
    events,
    async fire(name: string) {
      const a = alarms.get(name)
      const alarm = { name, scheduledTime: Date.now(), periodInMinutes: a?.periodInMinutes } as chrome.alarms.Alarm
      await Promise.all(events.alarm.emit(alarm).map((r) => Promise.resolve(r)))
      await fake.flush()
    },
    async flush() {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 0))
        if (pending.size === 0) {
          await new Promise((r) => setTimeout(r, 0))
          if (pending.size === 0) return
        }
        await Promise.allSettled([...pending])
      }
    }
  }
  return fake
}

let current: ChromeFake | null = null

/** Replaces `globalThis.chrome` with a new fake (setup.ts calls it before each test). */
export function installChromeFake(manifest?: Record<string, unknown>): ChromeFake {
  current = createChromeFake(manifest)
  ;(globalThis as unknown as { chrome: typeof chrome }).chrome = current.chrome
  return current
}

/** Fake installed for the current test. */
export function chromeFake(): ChromeFake {
  if (!current) return installChromeFake()
  return current
}
