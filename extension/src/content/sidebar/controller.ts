// content/sidebar — controller: one state, three hosts (guide section, mini-guide entry, pane),
// synchronous Preact render on every change. Every entry point (start, new state, observer, event, response) goes
// through `guard`: any exception turns the bar off silently — removes the hosts, listeners and observers — and
// never reaches the page (no `error`/`unhandledrejection` on the window).
import { h, render } from 'preact'
import type { Envelope, ExtState, FeedItem, FeedPage, ReadScope } from '../../../../shared/api-types'
import type { ConnectionStatus } from '../../../../shared/ext-messages'
import { STORAGE_KEYS } from '../../../../shared/ext-messages'
import type { ContentContext } from '../../lib/content'
import { getLanguage } from '../../lib/i18n'
import {
  MINI_TAG,
  PANEL_TAG,
  SECTION_TAG,
  drawerOpen,
  guideEdge,
  guideSections,
  mastheadBottom,
  measureGuide,
  metricsCss,
  miniItems,
  miniVisible,
  placeMini,
  placeSection,
  watchGuide
} from './guide'
import { type FolderNode, type Scope, type SidebarData, buildFolderTree, findFolder, keyOf, normalizeState, visibleKeys } from './model'
import { MINI_CSS, PANEL_CSS, SECTION_CSS } from './styles'
import { type ConnState, type PanelState, type Tr, MiniView, PanelView, SectionView } from './view'

/** Own key in chrome.storage.local: open folders in the tree (`{expanded: string[]}`). */
export const SIDEBAR_TREE_KEY = STORAGE_KEYS.sidebarTree
export const FEED_LIMIT = 20
export const UNDO_MS = 5000
/** More than this many re-placements in 10 s = a fight with YouTube: the bar gives up (disappears). */
const MAX_PLACEMENTS = 40

export type HostKind = 'section' | 'mini' | 'panel'

export interface SidebarOptions {
  doc?: Document
  now?: () => number
  /** tests: receives each (closed) Shadow root created */
  inspect?: (kind: HostKind, root: ShadowRoot) => void
}

interface Host {
  el: HTMLElement
  root: ShadowRoot
  vars: HTMLStyleElement
  mount: HTMLElement
}

export interface SidebarController {
  stop(): void
}

export async function startSidebar(ctx: ContentContext, opts: SidebarOptions = {}): Promise<SidebarController> {
  const doc = opts.doc ?? document
  const now = opts.now ?? (() => Date.now())
  const win = doc.defaultView ?? window

  let dead = false
  let data: SidebarData = normalizeState(ctx.state)
  let tree: FolderNode[] = buildFolderTree(data.folders)
  let conn: ConnState = 'unknown'
  const expanded = new Set<string>()
  let focusKey: string | null = null
  let open: PanelState | null = null
  let openKey: string | null = null
  let seq = 0
  let pendingRead: { scope: Scope; timer: ReturnType<typeof setTimeout> } | null = null
  let theme: 'light' | 'dark' = 'light'
  let placements: number[] = []
  let section: Host | null = null
  let mini: Host | null = null
  let panel: Host | null = null
  let watcher: ReturnType<typeof watchGuide> | null = null
  const cleanups: Array<() => void> = []

  const tr: Tr = (key, vars) => ctx.t('sidebar', key, vars)

  // ------------------------------------------------------------------ guard

  function die(e: unknown): void {
    if (dead) return
    try {
      console.debug('[tube] sidebar off:', e instanceof Error ? e.message : String(e))
    } catch {
      /* console missing */
    }
    teardown(false)
  }

  function guard<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
    return (...a: A) => {
      if (dead) return
      try {
        fn(...a)
      } catch (e) {
        die(e)
      }
    }
  }

  const later = (p: Promise<unknown>): void => {
    p.catch(die)
  }

  // ------------------------------------------------------------------ hosts

  function makeHost(tag: string, kind: HostKind, css: string): Host {
    const el = doc.createElement(tag)
    el.setAttribute('data-theme', theme)
    const root = el.attachShadow({ mode: 'closed' })
    opts.inspect?.(kind, root)
    const base = doc.createElement('style')
    base.textContent = css
    const vars = doc.createElement('style')
    const mount = doc.createElement('div')
    mount.className = 'mount'
    root.append(base, vars, mount)
    // keys inside the bar do not reach YouTube's shortcuts (k, j, /, f…)
    for (const type of ['keydown', 'keyup', 'keypress']) mount.addEventListener(type, (e) => e.stopPropagation())
    return { el, root, vars, mount }
  }

  /** Follows `html[dark]`; returns whether it changed (the section line is measured again in the new theme). */
  function setTheme(): boolean {
    const next = doc.documentElement.hasAttribute('dark') ? 'dark' : 'light'
    const changed = next !== theme
    theme = next
    for (const host of [section, mini, panel]) if (host && host.el.getAttribute('data-theme') !== theme) host.el.setAttribute('data-theme', theme)
    return changed
  }

  function remeasure(): void {
    const sections = guideSections(doc)
    if (!sections) return
    const css = metricsCss(measureGuide(sections))
    for (const host of [section, mini, panel]) if (host && host.vars.textContent !== css) host.vars.textContent = css
  }

  function placed(): void {
    const t = Date.now()
    placements = placements.filter((x) => t - x < 10_000)
    placements.push(t)
    if (placements.length > MAX_PLACEMENTS) throw new Error('guide keeps rebuilding; giving up')
  }

  /** Checks the position of the hosts (called by the observers and by navigation). */
  function check(): void {
    let moved = setTheme()
    const sections = guideSections(doc)
    if (sections) {
      if (!section) {
        section = makeHost(SECTION_TAG, 'section', SECTION_CSS)
        moved = true
      }
      const r = placeSection(sections, section.el)
      if (r === true) {
        placed()
        moved = true
      }
    } else if (section?.el.isConnected) {
      section.el.remove()
    }
    const items = miniItems(doc)
    if (items) {
      if (!mini) {
        mini = makeHost(MINI_TAG, 'mini', MINI_CSS)
        moved = true
      }
      if (placeMini(items, mini.el)) {
        placed()
        moved = true
      }
    }
    if (moved) {
      remeasure()
      draw()
    }
    // pane: the anchor is gone or the drawer/mini-guide closed
    if (open) {
      const anchor = open.anchor === 'section' ? section?.el : mini?.el
      const visible = anchor?.isConnected && (open.anchor === 'section' ? drawerOpen(anchor) : miniVisible(anchor))
      if (!visible) closePanel(false)
    }
    watcher?.retarget()
  }

  // ------------------------------------------------------------------ rendering

  function scopeCount(scope: Scope | null): number {
    if (!scope) return data.total
    if (scope.kind === 'tab') return data.tabs.find((t) => t.id === scope.id)?.count ?? 0
    return findFolder(tree, scope.id)?.count ?? 0
  }

  function draw(): void {
    if (dead) return
    const lang = getLanguage()
    if (section) {
      render(
        h(SectionView, {
          t: tr,
          lang,
          data,
          tree,
          expanded,
          focusKey: focusKey ?? keys()[0] ?? null,
          openKey: open?.anchor === 'section' ? openKey : null,
          conn,
          onClick: onTreeClick,
          onKeyDown: onTreeKey,
          onFocusIn: onTreeFocus
        }),
        section.mount
      )
    }
    if (mini) render(h(MiniView, { t: tr, lang, total: data.total, open: open?.anchor === 'mini', conn, onClick: onMiniClick }), mini.mount)
    if (panel) {
      const anchorEl = open?.anchor === 'mini' ? mini?.el : section?.el
      render(
        h(PanelView, {
          t: tr,
          lang,
          now: now(),
          open,
          data,
          tree,
          left: anchorEl ? guideEdge(anchorEl, open?.anchor ?? 'section') : 240,
          top: mastheadBottom(doc),
          undoMs: UNDO_MS,
          scopeCount: scopeCount(open?.scope ?? null),
          on: panelOn
        }),
        panel.mount
      )
    }
  }

  // ------------------------------------------------------------------ state and connection

  function applyState(state: ExtState | null): void {
    if (!state) return
    data = normalizeState(state)
    tree = buildFolderTree(data.folders)
    const keys = visibleKeys(data.tabs, tree, expanded)
    if (focusKey && !keys.includes(focusKey)) focusKey = null
    draw()
  }

  async function refreshConn(): Promise<void> {
    const res = (await ctx.send('conn.status', {})) as Envelope<ConnectionStatus>
    if (dead || !res?.ok || !res.data) return
    const next = res.data.state
    if (next !== conn) {
      conn = next
      draw()
    }
  }

  // ------------------------------------------------------------------ tree

  const keys = (): string[] => visibleKeys(data.tabs, tree, expanded)

  /** Row by key (ids come from the server: text comparison, never a built selector). */
  function rowEl(key: string): HTMLElement | null {
    if (!section) return null
    for (const el of section.root.querySelectorAll<HTMLElement>('[data-key]')) if (el.getAttribute('data-key') === key) return el
    return null
  }

  function focusRow(key: string): void {
    focusKey = key
    draw()
    rowEl(key)?.focus()
  }

  function scopeOf(key: string): Scope | null {
    const id = key.slice(2)
    if (key.startsWith('t:')) {
      const tab = data.tabs.find((t) => t.id === id)
      return tab ? { kind: 'tab', id, name: tab.name } : null
    }
    const f = findFolder(tree, id)
    return f ? { kind: 'folder', id, name: f.name } : null
  }

  function setExpanded(id: string, on: boolean): void {
    if (on === expanded.has(id)) return
    if (on) expanded.add(id)
    else expanded.delete(id)
    draw()
    later(chrome.storage.local.set({ [SIDEBAR_TREE_KEY]: { expanded: [...expanded] } }))
  }

  const keyFromEvent = (e: Event): string | null => (e.target as Element | null)?.closest?.('[data-key]')?.getAttribute('data-key') ?? null

  const onTreeClick = guard((e: MouseEvent) => {
    const key = keyFromEvent(e)
    if (!key) return
    if ((e.target as Element).closest('[data-part="toggle"]')) {
      e.preventDefault()
      setExpanded(key.slice(2), !expanded.has(key.slice(2)))
      return
    }
    focusKey = key
    toggleScope(key, 'section')
  })

  const onTreeFocus = guard((e: FocusEvent) => {
    const key = keyFromEvent(e)
    if (key && key !== focusKey) {
      focusKey = key
      draw()
    }
  })

  const onTreeKey = guard((e: KeyboardEvent) => {
    const key = keyFromEvent(e)
    if (!key || e.altKey || e.ctrlKey || e.metaKey) return
    const list = keys()
    const i = list.indexOf(key)
    const folder = key.startsWith('f:') ? findFolder(tree, key.slice(2)) : null
    const go = (k: string | undefined) => {
      if (k) focusRow(k)
      e.preventDefault()
    }
    switch (e.key) {
      case 'ArrowDown':
        return go(list[Math.min(list.length - 1, i + 1)])
      case 'ArrowUp':
        return go(list[Math.max(0, i - 1)])
      case 'Home':
        return go(list[0])
      case 'End':
        return go(list[list.length - 1])
      case 'ArrowRight':
        e.preventDefault()
        if (folder?.children.length) {
          if (!expanded.has(folder.id)) setExpanded(folder.id, true)
          else focusRow(keyOf('folder', folder.children[0].id))
        }
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (folder?.children.length && expanded.has(folder.id)) setExpanded(folder.id, false)
        else if (folder?.parentId) focusRow(keyOf('folder', folder.parentId))
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        focusKey = key
        toggleScope(key, 'section')
        return
      case 'Escape':
        if (open) {
          e.preventDefault()
          closePanel(true)
        }
        return
      case 'Tab':
        if (!e.shiftKey && open && open.anchor === 'section' && openKey === key && focusFirstInPanel()) e.preventDefault()
        return
    }
  })

  const onMiniClick = guard(() => {
    if (open?.anchor === 'mini') return closePanel(true)
    flushRead()
    openPanel({ anchor: 'mini', view: 'tree', scope: null, status: 'ready', items: [], cursor: null, more: 'idle', read: 'idle' }, null)
  })

  // ------------------------------------------------------------------ pane

  function ensurePanel(): Host {
    if (!panel) {
      panel = makeHost(PANEL_TAG, 'panel', PANEL_CSS)
      remeasure()
    }
    if (!panel.el.isConnected) (doc.body ?? doc.documentElement).append(panel.el)
    return panel
  }

  function focusables(): HTMLElement[] {
    if (!panel || !open) return []
    return [...panel.root.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !el.hasAttribute('disabled'))
  }

  function focusFirstInPanel(): boolean {
    const first = focusables()[0]
    if (!first) return false
    first.focus()
    return true
  }

  function anchorEl(): HTMLElement | null {
    if (!open) return null
    if (open.anchor === 'mini') return mini?.root.querySelector<HTMLElement>('[data-part="mini"]') ?? null
    return openKey ? rowEl(openKey) : null
  }

  function openPanel(state: PanelState, key: string | null): void {
    ensurePanel()
    open = state
    openKey = key
    draw()
    if (!listening) listen(true)
  }

  function toggleScope(key: string, anchor: 'section' | 'mini'): void {
    if (open && openKey === key && open.anchor === anchor && open.view === 'feed') {
      closePanel(true)
      return
    }
    const scope = scopeOf(key)
    if (!scope) return
    flushRead()
    openPanel({ anchor, view: 'feed', scope, status: 'loading', items: [], cursor: null, more: 'idle', read: 'idle' }, key)
    later(load(false))
  }

  async function load(more: boolean): Promise<void> {
    if (!open?.scope) return
    const mine = ++seq
    const scope = open.scope
    const req: Record<string, unknown> = { [scope.kind]: scope.id, limit: FEED_LIMIT }
    if (more && open.cursor) req.cursor = open.cursor
    if (more) open = { ...open, more: 'loading' }
    else open = { ...open, status: 'loading', items: [], cursor: null, more: 'idle' }
    draw()
    const res = (await ctx.send('feed.get', req as never)) as Envelope<FeedPage>
    if (dead || mine !== seq || !open?.scope || open.scope.id !== scope.id || open.scope.kind !== scope.kind) return
    if (res?.ok && res.data && Array.isArray(res.data.items)) {
      const items: FeedItem[] = more ? [...open.items, ...res.data.items] : res.data.items
      const seen = new Set<string>()
      const unique = items.filter((i) => {
        const id = i?.video?.id
        if (typeof id !== 'string' || seen.has(id)) return false
        seen.add(id)
        return true
      })
      const cursor = typeof res.data.next_cursor === 'string' && res.data.next_cursor ? res.data.next_cursor : null
      open = { ...open, status: 'ready', items: unique, cursor, more: 'idle' }
      if (conn !== 'connected' && conn !== 'unknown') later(refreshConn())
    } else {
      open = more ? { ...open, more: 'error' } : { ...open, status: 'error' }
      later(refreshConn())
    }
    draw()
  }

  function closePanel(restoreFocus: boolean): void {
    if (!open) return
    const target = restoreFocus ? anchorEl() : null
    flushRead()
    open = null
    openKey = null
    seq++
    draw()
    if (listening) listen(false)
    target?.focus()
  }

  // ------------------------------------------------------------------ mark as read (5 s with Undo)

  function scopeBody(scope: Scope): ReadScope {
    return { kind: scope.kind, id: scope.id }
  }

  async function sendRead(scope: Scope): Promise<void> {
    const res = (await ctx.send('read.mark', scopeBody(scope))) as Envelope<unknown>
    if (dead) return
    const here = open?.scope && open.scope.kind === scope.kind && open.scope.id === scope.id
    if (!res?.ok) {
      if (here) {
        open = { ...open!, read: 'error' }
        draw()
      }
      return
    }
    if (here) {
      open = { ...open!, read: 'done', items: open!.items.map((i) => ({ ...i, is_new: false })) }
      draw()
    }
    const fresh = (await ctx.send('state.get', { refresh: true })) as Envelope<ExtState | null>
    if (!dead && fresh?.ok && fresh.data) applyState(fresh.data)
  }

  function flushRead(): void {
    if (!pendingRead) return
    const { scope, timer } = pendingRead
    pendingRead = null
    clearTimeout(timer)
    if (open?.read === 'pending') open = { ...open, read: 'sending' }
    later(sendRead(scope))
  }

  const panelOn = {
    close: guard(() => closePanel(true)),
    back: guard(() => {
      if (!open) return
      flushRead()
      seq++
      open = { ...open, view: 'tree', scope: null, status: 'ready', items: [], cursor: null, more: 'idle', read: 'idle' }
      openKey = null
      draw()
      panel?.root.querySelector<HTMLElement>('[data-pick]')?.focus()
    }),
    pick: guard((e: MouseEvent) => {
      const key = (e.currentTarget as Element | null)?.getAttribute('data-pick')
      if (!key) return
      const scope = scopeOf(key)
      if (!scope || !open) return
      flushRead()
      open = { ...open, view: 'feed', scope, status: 'loading', items: [], cursor: null, more: 'idle', read: 'idle' }
      openKey = key
      draw()
      panel?.root.querySelector<HTMLElement>('[data-part="heading"]')?.focus()
      later(load(false))
    }),
    mark: guard(() => {
      if (!open?.scope || open.read !== 'idle') return
      const scope = open.scope
      const timer = setTimeout(
        guard(() => {
          if (pendingRead?.timer !== timer) return
          flushRead()
        }),
        UNDO_MS
      )
      pendingRead = { scope, timer }
      open = { ...open, read: 'pending' }
      draw()
      panel?.root.querySelector<HTMLElement>('[data-part="undo-bar"] button')?.focus()
    }),
    undo: guard(() => {
      if (!pendingRead) return
      clearTimeout(pendingRead.timer)
      pendingRead = null
      if (open) open = { ...open, read: 'idle' }
      draw()
      panel?.root.querySelector<HTMLElement>('[data-part="mark"]')?.focus()
    }),
    retry: guard(() => later(load(false))),
    more: guard(() => later(load(true))),
    keydown: guard((e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePanel(true)
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      const at = list.indexOf(panel!.root.activeElement as HTMLElement)
      const back = anchorEl()
      if (!back) return
      if ((e.shiftKey && at <= 0) || (!e.shiftKey && at === list.length - 1)) {
        e.preventDefault()
        back.focus()
      }
    }),
    imgError: guard((e: Event) => {
      const img = e.currentTarget as HTMLImageElement | null
      if (img) img.style.visibility = 'hidden'
    })
  }

  // ------------------------------------------------------------------ document listeners (only with the pane open)

  let listening = false
  const pathHasOurs = (e: Event): boolean => {
    const path = e.composedPath()
    return [section?.el, mini?.el, panel?.el].some((el) => el && path.includes(el))
  }
  const onPointerDown = guard((e: Event) => {
    if (!open || pathHasOurs(e)) return
    const anchor = anchorEl()
    closePanel(false)
    // click on something that does not take focus: focus goes back to the entry (without stealing from a page field)
    setTimeout(
      guard(() => {
        const active = doc.activeElement
        if (!active || active === doc.body || active === doc.documentElement) anchor?.focus({ preventScroll: true })
      }),
      0
    )
  })
  const onDocKey = guard((e: KeyboardEvent) => {
    if (open && e.key === 'Escape' && !pathHasOurs(e)) closePanel(true)
  })
  const onResize = guard(() => draw())

  function listen(on: boolean): void {
    listening = on
    const fn = on ? 'addEventListener' : 'removeEventListener'
    doc[fn]('pointerdown', onPointerDown as EventListener, true)
    doc[fn]('mousedown', onPointerDown as EventListener, true)
    doc[fn]('keydown', onDocKey as EventListener, true)
    win[fn]('resize', onResize as EventListener)
  }

  // ------------------------------------------------------------------ start and end

  function teardown(sendPending: boolean): void {
    if (dead) return
    if (sendPending && pendingRead) {
      const { scope, timer } = pendingRead
      clearTimeout(timer)
      pendingRead = null
      void Promise.resolve()
        .then(() => ctx.send('read.mark', scopeBody(scope)))
        .catch(() => undefined)
    }
    if (pendingRead) clearTimeout(pendingRead.timer)
    pendingRead = null
    dead = true
    if (listening) {
      try {
        listen(false)
      } catch {
        /* nothing */
      }
    }
    watcher?.dispose()
    for (const c of cleanups.splice(0)) {
      try {
        c()
      } catch {
        /* nothing */
      }
    }
    for (const host of [section, mini, panel]) {
      if (!host) continue
      try {
        render(null, host.mount)
      } catch {
        /* nothing */
      }
      host.el.remove()
    }
    section = mini = panel = null
  }

  const onNavigate = guard(() => check())

  // Guide not drawn yet = observing the whole document (the page changes all the time): at most one check
  // every 200 ms, the first one immediately. Once the guide is found, only the drawer is observed and the check is immediate.
  let lastBoot = 0
  let bootTimer: ReturnType<typeof setTimeout> | null = null
  const onMutate = guard(() => {
    if (!watcher?.booting()) return check()
    const t = Date.now()
    if (t - lastBoot >= 200) {
      lastBoot = t
      check()
    } else if (!bootTimer) {
      bootTimer = setTimeout(
        guard(() => {
          bootTimer = null
          lastBoot = Date.now()
          check()
        }),
        200 - (t - lastBoot)
      )
    }
  })
  cleanups.push(() => {
    if (bootTimer) clearTimeout(bootTimer)
  })
  const onStorage = guard((changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return
    // the credential is never read: the change only triggers the `conn.status` question to the background
    if (STORAGE_KEYS.connection in changes) later(refreshConn())
    if (SIDEBAR_TREE_KEY in changes) {
      const list = (changes[SIDEBAR_TREE_KEY].newValue as { expanded?: unknown } | undefined)?.expanded
      if (Array.isArray(list)) {
        expanded.clear()
        for (const id of list) if (typeof id === 'string') expanded.add(id)
        draw()
      }
    }
  })
  const onVisible = guard(() => {
    if (doc.visibilityState === 'visible') later(refreshConn())
  })
  const onPageHide = guard(() => flushRead())

  try {
    const got = await chrome.storage.local.get(SIDEBAR_TREE_KEY)
    const saved = (got?.[SIDEBAR_TREE_KEY] as { expanded?: unknown } | undefined)?.expanded
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string') expanded.add(id)
  } catch {
    /* no stored state: everything closed */
  }

  try {
    cleanups.push(ctx.onState(guard((s: ExtState | null) => applyState(s))))
    doc.addEventListener('yt-navigate-finish', onNavigate)
    cleanups.push(() => doc.removeEventListener('yt-navigate-finish', onNavigate))
    doc.addEventListener('visibilitychange', onVisible)
    cleanups.push(() => doc.removeEventListener('visibilitychange', onVisible))
    win.addEventListener('pagehide', onPageHide)
    cleanups.push(() => win.removeEventListener('pagehide', onPageHide))
    chrome.storage.onChanged.addListener(onStorage)
    cleanups.push(() => chrome.storage.onChanged.removeListener(onStorage))
    watcher = watchGuide(doc, onMutate)
    check()
    later(refreshConn())
  } catch (e) {
    die(e)
  }

  return {
    stop() {
      teardown(true)
    }
  }
}
