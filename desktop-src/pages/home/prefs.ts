// Home preferences kept in the plugin's `ctx.storage` (active tab, density, sort/group per source). Without ctx (preview without
// storage, old host) or with a strange stored value, falls back to the default — never throws.
import type { RestRoutes } from '../../../shared/api-types'
import { DENSITIES, type Density } from '../../components'
import { maybePluginContext } from '../../lib/ctx'

export const STORAGE_KEYS = {
  tab: 'home.tab',
  density: 'home.density',
  /** Sort and group PER SOURCE — `{ [tab | ':later' | ':folder:<id>' | ':channel:<id>']: {sort, group} }`. */
  view: 'home.view',
  /** Written by the pane (`panes/prefs.ts` → `PANE_KEYS.target`): `{kind, id, at}` of the clicked folder/channel. Read-only here. */
  paneTarget: 'pane.target'
} as const

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
    // storage unavailable: the choice only holds for this session
  }
}

export const isDensity = (v: unknown): v is Density => typeof v === 'string' && (DENSITIES as readonly string[]).includes(v)

export const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

// ------------------------------------------------------------------ sort and group (GET /feed?sort&group)

type FeedQuery = RestRoutes['GET /feed']['query']
export type FeedSort = NonNullable<FeedQuery['sort']>
export type FeedGroup = NonNullable<FeedQuery['group']>

export const SORTS: readonly FeedSort[] = ['newest', 'oldest', 'longest', 'shortest', 'views']
export const GROUPS: readonly FeedGroup[] = ['none', 'channel', 'folder', 'day', 'kind']

export interface ListView {
  sort: FeedSort
  group: FeedGroup
}

/** Contract defaults (the request omits the parameter). */
export const DEFAULT_VIEW: ListView = { sort: 'newest', group: 'none' }

export const isSort = (v: unknown): v is FeedSort => typeof v === 'string' && (SORTS as readonly string[]).includes(v)
export const isGroup = (v: unknown): v is FeedGroup => typeof v === 'string' && (GROUPS as readonly string[]).includes(v)

export type ViewMap = Readonly<Record<string, ListView>>

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Stored map, with valid entries only (a strange value from another version disappears without throwing). */
export function readViewMap(): ViewMap {
  const raw = readPref<Record<string, unknown>>(STORAGE_KEYS.view, {}, isObject)
  const out: Record<string, ListView> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!isObject(v)) continue
    out[k] = { sort: isSort(v.sort) ? v.sort : DEFAULT_VIEW.sort, group: isGroup(v.group) ? v.group : DEFAULT_VIEW.group }
  }
  return out
}
