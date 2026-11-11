// Panel preferences in the plugin's `ctx.storage` (open folders, selected node) and the bridge to Home.
// Without ctx (preview, old host) or with an odd stored value, falls back to the default — never throws.
//
// Bridge to Home (an adapter until shared/ids.ts publishes the parameter for a filtered Home):
//  - `home.tab`   is the key where Home (pages/home/prefs.ts) keeps the active tab and reads it on mount;
//                 the panel writes there the tab that matches the node (All → `all-new`, Watch later → `:later`,
//                 folder/channel → the tab that has exactly that folder/channel).
//  - `pane.target` records the full request `{kind, id, at}` (folder/channel without a tab of its own) for Home
//                 to filter once the contract exists.
import { maybePluginContext } from '../lib/ctx'

export const PANE_KEYS = {
  expanded: 'pane.expanded',
  selected: 'pane.selected',
  target: 'pane.target'
} as const

/** Key of Home's active tab (mirror of `STORAGE_KEYS.tab` in pages/home/prefs.ts). */
export const HOME_TAB_KEY = 'home.tab'

function storage() {
  try {
    return maybePluginContext()?.storage ?? null
  } catch {
    return null
  }
}

export function readPref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const value = storage()?.get<unknown>(key, fallback)
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    storage()?.set(key, value)
  } catch {
    // storage unavailable: applies to this session only
  }
}

export const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
export const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
