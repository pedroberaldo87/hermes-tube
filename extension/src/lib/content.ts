// Content script runtime. content/bootstrap.ts calls `startContent({ modules: CONTENT_MODULES })`.
//
// - Each feature module says where it attaches (`matches(url, state)`); the runtime attaches/detaches on load, on every SPA
//   navigation of YouTube (`yt-navigate-finish`, `popstate`) and when the cached `ExtState` changes (`chrome.storage.onChanged`
//   on `STORAGE_KEYS.stateCache`, written by the background's 30 s alarm). Content scripts do not talk to the
//   server: they ask the background via `sendRequest`.
// - Background commands for the tab (`ExtTabCommands`) go to the module that declares them in `COMMANDS`.
// - Sets `<html data-tube-ext="ready" data-tube-ext-modules="a,b">` (load proof for the test harness and debugging).
import type { ExtRouteKey, ExtState } from '../../../shared/api-types'
import type { ExtTabCommandType, ExtTabCommands } from '../../../shared/ext-messages'
import { STORAGE_KEYS } from '../../../shared/ext-messages'
import type { CachedState } from './background'
import { errorMessage } from './envelope'
import { setLanguage, t } from './i18n'
import { sendRequest } from './messaging'
import { createRouter } from './router'

export const CONTENT_ATTR = 'data-tube-ext'

export type ContentStateListener = (state: ExtState | null) => void

export interface ContentContext {
  url: URL
  /** last cached ExtState (null = not paired or no state yet) */
  state: ExtState | null
  send: typeof sendRequest
  t: typeof t
  /** notifies on every new ExtState while the module is attached */
  onState(cb: ContentStateListener): () => void
}

export type ContentCommandHandlers = {
  [K in ExtTabCommandType]?: (payload: ExtTabCommands[K]['req']) => Promise<ExtTabCommands[K]['res']>
}

/** Contract of a content feature module. */
export interface ContentModule {
  MODULE: string
  /** server routes reached (via background) by this module */
  ROUTES: readonly ExtRouteKey[]
  /** routes that are really implemented (skeleton: empty) */
  REAL_ROUTES: readonly ExtRouteKey[]
  /** background commands the module handles in this tab */
  COMMANDS: readonly ExtTabCommandType[]
  matches(url: URL, state: ExtState | null): boolean
  start(ctx: ContentContext): void | Promise<void>
  stop?(): void
  commands?: ContentCommandHandlers
}

export interface ContentRuntime {
  active(): string[]
  /** re-evaluates now (navigation and state already trigger it on their own) */
  refresh(): Promise<void>
  dispose(): void
}

export interface ContentOptions {
  modules: readonly ContentModule[]
  url?: () => URL
  doc?: Document
}

export async function startContent(opts: ContentOptions): Promise<ContentRuntime> {
  const doc = opts.doc ?? document
  const urlOf = opts.url ?? (() => new URL(location.href))
  const active = new Map<string, { mod: ContentModule; listeners: Set<ContentStateListener> }>()
  let state: ExtState | null = null

  const got = await chrome.storage.local.get(STORAGE_KEYS.stateCache)
  state = (got[STORAGE_KEYS.stateCache] as CachedState | undefined)?.state ?? null
  setLanguage(state?.language)

  // background commands → owning module (registered even while the module is detached)
  const router = createRouter<ExtTabCommands>()
  for (const mod of opts.modules) {
    for (const cmd of mod.COMMANDS) {
      const fn = mod.commands?.[cmd]
      if (fn) router.on(cmd, fn as never)
    }
  }
  const stopListening = router.listen()

  function mark(): void {
    doc.documentElement.setAttribute(CONTENT_ATTR, 'ready')
    doc.documentElement.setAttribute(`${CONTENT_ATTR}-modules`, [...active.keys()].join(','))
  }

  function wants(mod: ContentModule, url: URL): boolean {
    try {
      return mod.matches(url, state)
    } catch (e) {
      console.warn(`[tube] ${mod.MODULE}.matches failed`, e)
      return false
    }
  }

  async function evaluate(): Promise<void> {
    const url = urlOf()
    for (const [name, entry] of [...active]) {
      if (wants(entry.mod, url)) continue
      active.delete(name)
      try {
        entry.mod.stop?.()
      } catch (e) {
        console.warn(`[tube] ${name}.stop failed`, e)
      }
    }
    for (const mod of opts.modules) {
      if (active.has(mod.MODULE) || !wants(mod, url)) continue
      const listeners = new Set<ContentStateListener>()
      const ctx: ContentContext = {
        url,
        state,
        send: sendRequest,
        t,
        onState(cb) {
          listeners.add(cb)
          return () => listeners.delete(cb)
        }
      }
      active.set(mod.MODULE, { mod, listeners })
      try {
        await mod.start(ctx)
      } catch (e) {
        active.delete(mod.MODULE)
        console.warn(`[tube] ${mod.MODULE}.start failed: ${errorMessage(e)}`)
      }
    }
    mark()
  }

  // one re-evaluation at a time, in event order
  let chain: Promise<void> = Promise.resolve()
  const schedule = (): Promise<void> => (chain = chain.then(evaluate, evaluate))

  const onNavigate = () => void schedule()
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(STORAGE_KEYS.stateCache in changes)) return
    state = (changes[STORAGE_KEYS.stateCache].newValue as CachedState | undefined)?.state ?? null
    setLanguage(state?.language)
    for (const { listeners } of active.values()) for (const cb of listeners) cb(state)
    void schedule()
  }
  doc.addEventListener('yt-navigate-finish', onNavigate)
  doc.defaultView?.addEventListener('popstate', onNavigate)
  chrome.storage.onChanged.addListener(onStorage)

  await schedule()

  return {
    active: () => [...active.keys()],
    refresh: schedule,
    dispose() {
      doc.removeEventListener('yt-navigate-finish', onNavigate)
      doc.defaultView?.removeEventListener('popstate', onNavigate)
      chrome.storage.onChanged.removeListener(onStorage)
      stopListening()
      for (const { mod } of active.values()) mod.stop?.()
      active.clear()
    }
  }
}
