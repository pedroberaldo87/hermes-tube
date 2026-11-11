// Pure tab-editor rules: draft ⇄ contract rule (`include − exclude → filters`, `mode`),
// folders with coverage (checking a parent covers its children), suggested name, validation, PATCH diff, filter
// chips and the count of covered channels. Nothing here touches the network or React.
import type { Channel, FeedMode, Folder, Tab, TabCreate, TabKind, TabPatchBody, TabRules } from '../../../shared/api-types'
import type { DialogProps } from '../../../shared/ids'
import { maybePluginContext } from '../../lib/ctx'

export type Preset = NonNullable<DialogProps['tab-editor']['preset']>
export type PresetKind = NonNullable<Preset['kind']>
export type SourceGroup = 'folders' | 'tags' | 'channels'

/** Key under which Home (`pages/home/prefs.ts`) stores and re-reads the active tab. */
export const HOME_TAB_KEY = 'home.tab'
/** Typing wait before `POST /feed/preview`. */
export const PREVIEW_DEBOUNCE_MS = 300
/** Preview cards (the total comes from `counts.total`). */
export const PREVIEW_LIMIT = 6
export const NAME_MAX = 40
export const ICON_MAX = 8
/** "Short" shortcut: up to 10 min. */
export const SHORT_MAX_S = 600
/** "Long" shortcut: 20 min or more (the same cutoff as the `long` mode). */
export const LONG_MIN_S = 1200
export const MODES: readonly FeedMode[] = ['fresh', 'long', 'classics']

/** What the rule has that the editor does not show: passed along intact (themes, lenses, default tabs, per-folder/tag exclusions). */
export interface Kept {
  themes: string[]
  lenses: string[]
  all: boolean
  favorites: boolean
  excludeFolders: string[]
  excludeTags: string[]
}

export interface Draft {
  name: string
  /** The person typed the name: the suggestion stops. */
  nameTouched: boolean
  icon: string
  folders: string[]
  tags: string[]
  channels: string[]
  excludeChannels: string[]
  noShorts: boolean
  onlyNew: boolean
  perChannel: number | null
  minS: number | null
  maxS: number | null
  mode: FeedMode
  keep: Kept
}

const NO_KEEP: Kept = { themes: [], lenses: [], all: false, favorites: false, excludeFolders: [], excludeTags: [] }

const uniq = (ids: readonly string[] | undefined): string[] => [...new Set((ids ?? []).filter((x) => typeof x === 'string' && x))]

export function draftFromPreset(preset: Preset | undefined): Draft {
  const r = preset?.rules ?? {}
  const name = (preset?.name ?? '').trim()
  return {
    name,
    nameTouched: false,
    icon: '',
    folders: uniq(r.include?.folders),
    tags: uniq(r.include?.tags),
    channels: uniq(r.include?.channels),
    excludeChannels: uniq(r.exclude?.channels),
    noShorts: !!r.exclude?.shorts,
    onlyNew: !!r.filters?.only_new,
    perChannel: r.filters?.per_channel ?? null,
    minS: r.filters?.min_s ?? null,
    maxS: r.filters?.max_s ?? null,
    mode: r.mode ?? 'fresh',
    keep: {
      ...NO_KEEP,
      themes: uniq(r.include?.themes),
      lenses: uniq(r.include?.lenses),
      all: !!r.include?.all,
      favorites: !!r.include?.favorites,
      excludeFolders: uniq(r.exclude?.folders),
      excludeTags: uniq(r.exclude?.tags)
    }
  }
}

export function draftFromTab(tab: Tab): Draft {
  return { ...draftFromPreset({ name: tab.name, rules: tab.rules }), name: tab.name, nameTouched: true, icon: tab.icon ?? '' }
}

/** The full rule, in the contract's shape (all keys; the server receives exactly what was chosen). */
export function rulesOf(d: Draft): TabRules {
  return {
    include: {
      folders: [...d.folders],
      tags: [...d.tags],
      channels: [...d.channels],
      themes: [...d.keep.themes],
      lenses: [...d.keep.lenses],
      all: d.keep.all,
      favorites: d.keep.favorites
    },
    exclude: { folders: [...d.keep.excludeFolders], tags: [...d.keep.excludeTags], channels: [...d.excludeChannels], shorts: d.noShorts },
    filters: { only_new: d.onlyNew, per_channel: d.perChannel, min_s: d.minS, max_s: d.maxS },
    mode: d.mode
  }
}

/** JSON with ordered keys (the server stores the rule with `sort_keys`; key order is not a change). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function sameRules(a: TabRules, b: TabRules): boolean {
  return canonical(rulesOf(draftFromPreset({ rules: a }))) === canonical(rulesOf(draftFromPreset({ rules: b })))
}

/** Stable key of the rule (fires the preview only when the rule really changes). */
export function rulesKey(r: TabRules): string {
  return canonical(r)
}

export function hasSource(d: Draft): boolean {
  return !!(d.folders.length || d.tags.length || d.channels.length || d.keep.themes.length || d.keep.lenses.length || d.keep.all || d.keep.favorites)
}

/** `kind` is just a label (the engine evaluates the same rule): folders/tags → category; channels only → channels; both → mixed. */
export function deriveKind(d: Draft, original?: TabKind): TabKind {
  if (original === 'theme' || (d.keep.themes.length && !d.folders.length && !d.tags.length && !d.channels.length)) return original ?? 'theme'
  const cat = d.folders.length + d.tags.length > 0 || d.keep.all || d.keep.favorites
  const ch = d.channels.length > 0
  if (cat && ch) return 'mixed'
  if (ch) return 'channels'
  if (cat) return 'category'
  return original ?? 'category'
}

/** Source groups that open: `preset.kind` decides; editing opens whatever already has a choice. */
export function openGroups(kind: PresetKind | undefined, d: Draft): SourceGroup[] {
  if (kind === 'channels') return ['channels']
  if (kind === 'mixed') return ['folders', 'tags', 'channels']
  if (kind === 'category') return d.channels.length ? ['folders', 'tags', 'channels'] : ['folders', 'tags']
  const open: SourceGroup[] = []
  if (d.folders.length) open.push('folders')
  if (d.tags.length) open.push('tags')
  if (d.channels.length) open.push('channels')
  return open.length ? open : ['folders', 'tags', 'channels']
}

// ------------------------------------------------------------------ folders

/** Direct children per parent (`null` = root), in `sort` order. */
export function childrenOf(folders: readonly Folder[]): Map<string | null, Folder[]> {
  const ids = new Set(folders.map((f) => f.id))
  const map = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const parent = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null
    const list = map.get(parent) ?? []
    list.push(f)
    map.set(parent, list)
  }
  for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  return map
}

export function descendants(folders: readonly Folder[], id: string): Set<string> {
  const kids = childrenOf(folders)
  const out = new Set<string>()
  const walk = (p: string) => {
    for (const c of kids.get(p) ?? []) {
      if (out.has(c.id)) continue
      out.add(c.id)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/** Ancestors of `id`, from the parent up to the root. */
function ancestors(folders: readonly Folder[], id: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const out: string[] = []
  let cur = byId.get(id)?.parent_id ?? null
  while (cur && byId.has(cur) && !out.includes(cur)) {
    out.push(cur)
    cur = byId.get(cur)?.parent_id ?? null
  }
  return out
}

/** The checked folder that covers `id` (a chosen ancestor), or null. */
export function coveredBy(selected: readonly string[], id: string, folders: readonly Folder[]): string | null {
  for (const a of ancestors(folders, id)) if (selected.includes(a)) return a
  return null
}

/**
 * Checks/unchecks a folder. Checking covers the children (they leave the list: the rule is recursive). Clicking a covered child
 * unchecks only it: the parent leaves and the siblings along the path come in.
 */
export function toggleFolder(selected: readonly string[], id: string, folders: readonly Folder[]): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id)
  const cover = coveredBy(selected, id, folders)
  if (cover) {
    const kids = childrenOf(folders)
    const path = [id, ...ancestors(folders, id)]
    const upTo = path.indexOf(cover)
    const replacement: string[] = []
    // top to bottom: at each level, the siblings along the path
    for (let i = upTo - 1; i >= 0; i--) {
      const node = path[i]
      const parent = path[i + 1]
      for (const sib of kids.get(parent) ?? []) if (sib.id !== node) replacement.push(sib.id)
    }
    const at = selected.indexOf(cover)
    return [...selected.slice(0, at), ...replacement, ...selected.slice(at + 1)]
  }
  const under = descendants(folders, id)
  return [...selected.filter((x) => !under.has(x)), id]
}

// ------------------------------------------------------------------ name

/** Name suggested from the source labels: 1 → the name; 2 → "a + b"; 3+ → "a + b +N". */
export function suggestName(labels: readonly string[]): string {
  const clean = labels.map((l) => l.trim()).filter(Boolean)
  if (!clean.length) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} + ${clean[1]}`
  return `${clean[0]} + ${clean[1]} +${clean.length - 2}`
}

export function normName(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export type NameProblem = { kind: 'empty' } | { kind: 'long' } | { kind: 'duplicate'; name: string }

export function nameProblem(name: string, tabs: readonly Tab[] | undefined, selfId?: string): NameProblem | null {
  const clean = name.trim()
  if (!clean) return { kind: 'empty' }
  if ([...clean].length > NAME_MAX) return { kind: 'long' }
  const n = normName(clean)
  const other = (tabs ?? []).find((t) => t.id !== selfId && normName(t.name) === n)
  return other ? { kind: 'duplicate', name: other.name } : null
}

// ------------------------------------------------------------------ filters

export type FilterId = 'exclude' | 'shorts' | 'only_new' | 'per_channel' | 'duration' | 'mode'

export function durationProblem(d: Draft): boolean {
  return d.minS != null && d.maxS != null && d.minS > d.maxS
}

export function filterChips(d: Draft): FilterId[] {
  const out: FilterId[] = []
  if (d.excludeChannels.length) out.push('exclude')
  if (d.noShorts) out.push('shorts')
  if (d.onlyNew) out.push('only_new')
  if (d.perChannel != null) out.push('per_channel')
  if (d.minS != null || d.maxS != null) out.push('duration')
  if (d.mode !== 'fresh') out.push('mode')
  return out
}

export function clearFilter(d: Draft, id: FilterId): Draft {
  switch (id) {
    case 'exclude':
      return { ...d, excludeChannels: [] }
    case 'shorts':
      return { ...d, noShorts: false }
    case 'only_new':
      return { ...d, onlyNew: false }
    case 'per_channel':
      return { ...d, perChannel: null }
    case 'duration':
      return { ...d, minS: null, maxS: null }
    case 'mode':
      return { ...d, mode: 'fresh' }
  }
}

/** Empty preview: the filter most likely to empty the tab (what we suggest removing). */
export function emptySuggestion(d: Draft): FilterId | null {
  const order: FilterId[] = ['only_new', 'duration', 'mode', 'shorts', 'exclude', 'per_channel']
  const on = new Set(filterChips(d))
  return order.find((f) => on.has(f)) ?? null
}

// ------------------------------------------------------------------ channels

const ACTIVE = new Set(['subscribed', 'followed'])

/** Channels the rule covers (the same count as the engine: folder/tag/all/⭐ only active and unmuted; a chosen channel always). */
export function channelsCovered(d: Draft, channels: readonly Channel[], folders: readonly Folder[]): number {
  return coveredChannels(d, channels, folders).length
}

export function isActive(c: Channel): boolean {
  return ACTIVE.has(c.relation)
}

export function coveredChannels(d: Draft, channels: readonly Channel[], folders: readonly Folder[]): Channel[] {
  const folderSet = new Set<string>()
  for (const f of d.folders) {
    folderSet.add(f)
    for (const x of descendants(folders, f)) folderSet.add(x)
  }
  const tagSet = new Set(d.tags)
  const explicit = new Set(d.channels)
  const excluded = new Set(d.excludeChannels)
  const out: Channel[] = []
  for (const c of channels) {
    if (excluded.has(c.id)) continue
    const open = ACTIVE.has(c.relation) && !c.muted
    const inside =
      explicit.has(c.id) ||
      (open && (d.keep.all || (d.keep.favorites && c.favorite) || (c.folder_id != null && folderSet.has(c.folder_id)) || c.tag_ids.some((t) => tagSet.has(t))))
    if (inside) out.push(c)
  }
  return out
}

/** Text for search: no accents, no case. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

export function searchChannels(channels: readonly Channel[], query: string, skip: ReadonlySet<string>, limit: number): Channel[] {
  const qf = fold(query)
  const pool = channels.filter((c) => !skip.has(c.id))
  if (!qf) {
    return [...pool].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)).slice(0, limit)
  }
  const scored = pool
    .map((c) => {
      const t = fold(c.title)
      const h = fold(c.handle ?? '')
      const at = t.indexOf(qf)
      const score = at === 0 ? 0 : t.split(/\s+/).some((w) => w.startsWith(qf)) ? 1 : at > 0 ? 2 : h.includes(qf) ? 3 : -1
      return { c, score }
    })
    .filter((x) => x.score >= 0)
  scored.sort((a, b) => a.score - b.score || a.c.title.localeCompare(b.c.title))
  return scored.slice(0, limit).map((x) => x.c)
}

// ------------------------------------------------------------------ save

export function cleanIcon(icon: string): string | null {
  const v = icon.trim()
  return v ? v : null
}

export function buildCreate(d: Draft, name: string): TabCreate {
  const icon = cleanIcon(d.icon)
  return { name: name.trim(), kind: deriveKind(d), ...(icon ? { icon } : {}), rules: rulesOf(d) }
}

/** PATCH only what changed (the rule goes whole when any part changes: the server replaces the whole rule). */
export function buildPatch(original: Tab, d: Draft): TabPatchBody {
  const out: TabPatchBody = {}
  const name = d.name.trim()
  if (name !== original.name) out.name = name
  const icon = cleanIcon(d.icon)
  if (icon !== (original.icon ?? null)) out.icon = icon
  const r = rulesOf(d)
  if (!sameRules(r, original.rules)) {
    const kind = deriveKind(d, original.kind)
    if (kind !== original.kind) out.kind = kind
    out.rules = r
  }
  return out
}

/** Asks Home for the active tab: Home reads `home.tab` on mount and re-reads it while open (same path as the pane). */
export function rememberHomeTab(tabId: string): void {
  try {
    maybePluginContext()?.storage?.set(HOME_TAB_KEY, tabId)
  } catch {
    // no storage: Home opens on the previously remembered tab
  }
}

/** Change id in the response (the current contract does not carry one for tabs). */
export function changeIdOf(data: unknown): number | null {
  const v = data && typeof data === 'object' ? (data as { change_id?: unknown }).change_id : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
