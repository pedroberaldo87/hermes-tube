// Show/hide the channels pane using only what the SDK exposes (no app markup).
//
// The Desktop SDK does NOT export `registerPaneCloser`/`registerPaneOpener`/`dismissTreePane` (they live in the
// app's tree store, outside `@hermes/plugin-sdk`). What exists and we use:
//  - `host.paneVisibility(id)`  reactive atom "the pane is on screen" (in the tree, not hidden, zone not minimized,
//                               active tab, side not collapsed) — the button's source of truth;
//  - `host.revealPane(id)`      explicit user action: undoes Close/Hide, opens the column, brings the tab to front;
//  - `ctx.runAction('view.toggleRightSidebar')`  the app's ⌘J — the only "hide" a plugin can ask for.
// The id in the tree is `<plugin>:<pane>` (`ctx.register` adds the namespace).
import { host } from '@hermes/plugin-sdk'
import { useCallback, useSyncExternalStore } from 'react'
import { PANE_ID, PLUGIN_ID } from '../../shared/ids'
import { maybePluginContext } from './ctx'
import { tNow } from './i18n'

/** Id of the channels pane in the app's layout tree. */
export const PANE_TREE_ID = `${PLUGIN_ID}:${PANE_ID}`

/** App action (`PLUGIN_APP_ACTIONS` list) that collapses/opens the right column — the ⌘J. */
export const RIGHT_SIDEBAR_ACTION = 'view.toggleRightSidebar'

interface Readable<T> {
  get(): T
  listen?(cb: (value: T) => void): () => void
  subscribe?(cb: (value: T) => void): () => void
}

type PaneHost = {
  paneVisibility?: (paneId: string) => Readable<boolean>
  revealPane?: (paneId: string) => void
}

const paneHost = (): PaneHost => host as unknown as PaneHost

/** Desktop with the SDK's pane hooks (older ones lack them; then no button and no command). */
export function paneControlsAvailable(): boolean {
  const h = paneHost()
  return typeof h.paneVisibility === 'function' && typeof h.revealPane === 'function'
}

/** "Is on screen" atom (memoized in the app per id); null on an older Desktop. */
export function paneShownAtom(): Readable<boolean> | null {
  const h = paneHost()
  if (typeof h.paneVisibility !== 'function') return null
  try {
    return h.paneVisibility(PANE_TREE_ID)
  } catch {
    return null
  }
}

/** Shows the pane (undoes Hide/Close, opens the column, tab in front). false = Desktop without the hook. */
export function showPane(): boolean {
  const h = paneHost()
  if (typeof h.revealPane !== 'function') return false
  h.revealPane(PANE_TREE_ID)
  return true
}

export type HideResult = 'hidden' | 'elsewhere' | 'unavailable'

/**
 * Hides the pane with the app's ⌘J. One press is enough when the pane is in the right column with Files open;
 * with Files closed and the column open (the pane was revealed alone), the 1st ⌘J opens Files and the 2nd collapses
 * the column. If after two the pane is still on screen, it does not live in the right column (the user dragged it):
 * two ⌘J restore the column to its previous state and the user gets the app's path (tab → Hide).
 */
export function hidePane(): HideResult {
  const shown = paneShownAtom()
  const run = maybePluginContext()?.runAction
  if (!shown || typeof run !== 'function') return 'unavailable'
  for (let i = 0; i < 2 && shown.get(); i++) {
    const out = run(RIGHT_SIDEBAR_ACTION as Parameters<typeof run>[0]) as { ok?: boolean } | undefined
    if (!out?.ok) return 'unavailable'
  }
  if (!shown.get()) return 'hidden'
  host.notify({ kind: 'info', message: tNow('panes', 'toggle.elsewhere') })
  return 'elsewhere'
}

/** Off screen → show; on screen → hide. */
export function togglePane(): void {
  const shown = paneShownAtom()
  if (shown?.get()) hidePane()
  else showPane()
}

const NO_ATOM: Readable<boolean> = { get: () => false, listen: () => () => undefined }

function listenTo(store: Readable<boolean>, cb: () => void): () => void {
  if (typeof store.listen === 'function') return store.listen(() => cb())
  if (typeof store.subscribe === 'function') return store.subscribe(() => cb())
  return () => undefined
}

/** Live pane state for a button: true/false; null when the Desktop does not expose it (do not draw the button). */
export function usePaneShown(): boolean | null {
  const store = paneShownAtom()
  const target = store ?? NO_ATOM
  const subscribe = useCallback((cb: () => void) => listenTo(target, cb), [target])
  const read = useCallback(() => target.get(), [target])
  const value = useSyncExternalStore(subscribe, read, read)
  return store && paneControlsAvailable() ? value : null
}
