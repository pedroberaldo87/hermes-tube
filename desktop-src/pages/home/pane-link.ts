// Pane → Home with Home OPEN. The pane writes to the plugin's `ctx.storage`:
//   - `home.tab`    the tab that matches the node (All, Watch later, folder/channel with a tab of its own);
//   - `pane.target` `{kind: 'folder'|'channel', id, at}` on every folder/channel click.
// `ctx.storage` does not notify changes (only get/set/remove) and the pane emits no event; so, while Home is
// mounted, it rereads both keys every `PANE_POLL_MS` (local in-memory read, no network; the timer dies
// with the page). A new request (`at` greater than the last seen) beats a tab switch in the same interval.
// On mount, a request up to `PANE_FRESH_MS` old still counts (the pane writes and navigates right after).
import { useEffect, useRef } from 'react'
import type { Tab } from '../../../shared/api-types'
import type { ScopeFilter } from './feed'
import { STORAGE_KEYS, isText, readPref } from './prefs'

export const PANE_POLL_MS = 600
export const PANE_FRESH_MS = 5000

export interface PaneTarget extends ScopeFilter {
  at: number
}

export function isPaneTarget(v: unknown): v is PaneTarget {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (o.kind === 'folder' || o.kind === 'channel') && typeof o.id === 'string' && o.id.length > 0 && typeof o.at === 'number'
}

/** The tab whose rule is EXACTLY this folder/channel (same criterion as the pane), or null. */
export function exactTabFor(target: ScopeFilter, tabs: readonly Tab[] | null | undefined): string | null {
  const key = target.kind === 'folder' ? 'folders' : 'channels'
  const other = target.kind === 'folder' ? 'channels' : 'folders'
  for (const tab of tabs ?? []) {
    const inc = tab.rules?.include
    if (!inc || inc.all || inc.favorites) continue
    const list = inc[key] ?? []
    if (list.length !== 1 || list[0] !== target.id) continue
    if ((inc[other] ?? []).length || (inc.tags ?? []).length || (inc.themes ?? []).length || (inc.lenses ?? []).length) continue
    return tab.id
  }
  return null
}

export interface PaneLinkHandlers {
  /** The pane wrote another tab (All, Watch later, folder/channel with a tab). */
  onTab: (tabId: string) => void
  /** The pane asked for a folder/channel (with or without a tab of its own; the caller decides). */
  onTarget: (target: PaneTarget) => void
}

/** Follows the pane's choices while Home is mounted. Returns `noteTab` so Home can report what it wrote itself (no echo). */
export function usePaneLink(handlers: PaneLinkHandlers): { noteTab: (tabId: string) => void } {
  const ref = useRef(handlers)
  ref.current = handlers
  const lastTab = useRef<string | null>(null)
  const lastAt = useRef(0)

  useEffect(() => {
    lastTab.current = readPref<string | null>(STORAGE_KEYS.tab, null, isText)
    const first = readPref<PaneTarget | null>(STORAGE_KEYS.paneTarget, null, isPaneTarget)
    lastAt.current = first?.at ?? 0
    if (first && Date.now() - first.at <= PANE_FRESH_MS) ref.current.onTarget(first)
    const id = setInterval(() => {
      const target = readPref<PaneTarget | null>(STORAGE_KEYS.paneTarget, null, isPaneTarget)
      const tab = readPref<string | null>(STORAGE_KEYS.tab, null, isText)
      if (target && target.at > lastAt.current) {
        lastAt.current = target.at
        lastTab.current = tab
        ref.current.onTarget(target)
        return
      }
      if (tab && tab !== lastTab.current) {
        lastTab.current = tab
        ref.current.onTab(tab)
      }
    }, PANE_POLL_MS)
    return () => clearInterval(id)
  }, [])

  return {
    noteTab: (tabId: string) => {
      lastTab.current = tabId
    }
  }
}
