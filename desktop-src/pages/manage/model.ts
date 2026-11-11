// Pure Manage model: filters, sorting, count per folder, columns that really exist, columns that
// fit the width, row window (virtualization) and the remembered state (`ctx.storage`). No React, no network.
import type { ChannelRow, Folder, Relation, Tag } from '../../../shared/api-types'

// ------------------------------------------------------------------ filters

/** `active` = subscribed + followed (the default); `ex` and `ignored` only behind the filter. */
export type RelationFilter = 'active' | 'subscribed' | 'followed' | 'ex' | 'ignored'

export const RELATION_FILTERS: readonly RelationFilter[] = ['active', 'subscribed', 'followed', 'ex', 'ignored']

/** Months of "no video for N months". */
export const STALE_MONTHS: readonly number[] = [3, 6, 12]

export interface Filters {
  q: string
  /** folder id (recursive) or `none` = no folder; `null` = all. */
  folder: string | null
  tag: string | null
  relation: RelationFilter
  favorite: boolean
  muted: boolean
  staleMonths: number | null
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  folder: null,
  tag: null,
  relation: 'active',
  favorite: false,
  muted: false,
  staleMonths: null
}

/** Filters that become a chip (the search already shows in the field). Fixed order. */
export type ChipFilter = 'folder' | 'tag' | 'relation' | 'favorite' | 'muted' | 'stale'

export function activeChips(f: Filters): ChipFilter[] {
  const out: ChipFilter[] = []
  if (f.folder) out.push('folder')
  if (f.tag) out.push('tag')
  if (f.relation !== 'active') out.push('relation')
  if (f.favorite) out.push('favorite')
  if (f.muted) out.push('muted')
  if (f.staleMonths) out.push('stale')
  return out
}

export function clearChip(f: Filters, chip: ChipFilter): Filters {
  switch (chip) {
    case 'folder':
      return { ...f, folder: null }
    case 'tag':
      return { ...f, tag: null }
    case 'relation':
      return { ...f, relation: 'active' }
    case 'favorite':
      return { ...f, favorite: false }
    case 'muted':
      return { ...f, muted: false }
    case 'stale':
      return { ...f, staleMonths: null }
  }
}

export function hasFilters(f: Filters): boolean {
  return f.q.trim() !== '' || activeChips(f).length > 0
}

/** Accent- and case-insensitive (like the server's `dedup.normalize_name`). */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim()
}

export function inRelation(relation: Relation, filter: RelationFilter): boolean {
  if (filter === 'active') return relation === 'subscribed' || relation === 'followed'
  return relation === filter
}

/** The folder and all its descendants (filter and count are recursive, like `GET /channels?folder=`). */
export function folderDescendants(folders: readonly Folder[], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parent_id) continue
    const list = children.get(f.parent_id) ?? []
    list.push(f.id)
    children.set(f.parent_id, list)
  }
  const out = new Set<string>([id])
  const stack = [id]
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (out.has(c)) continue
      out.add(c)
      stack.push(c)
    }
  }
  return out
}

const MONTH_S = 30 * 86400

export interface FilterContext {
  folders: readonly Folder[]
  nowS: number
}

export function applyFilters(rows: readonly ChannelRow[], f: Filters, ctx: FilterContext): ChannelRow[] {
  const known = new Set(ctx.folders.map((x) => x.id))
  const inFolder = f.folder && f.folder !== 'none' ? folderDescendants(ctx.folders, f.folder) : null
  const words = normalize(f.q).split(/\s+/).filter(Boolean)
  const staleBefore = f.staleMonths ? ctx.nowS - f.staleMonths * MONTH_S : null
  return rows.filter(({ channel: c }) => {
    if (!inRelation(c.relation, f.relation)) return false
    if (f.folder === 'none' && c.folder_id && known.has(c.folder_id)) return false
    if (inFolder && !(c.folder_id && inFolder.has(c.folder_id))) return false
    if (f.tag && !c.tag_ids.includes(f.tag)) return false
    if (f.favorite && !c.favorite) return false
    if (f.muted && !c.muted) return false
    // "no video for N months": only those with a known, old date (an unknown date is not "stalled")
    if (staleBefore !== null && !(c.last_video_at != null && c.last_video_at < staleBefore)) return false
    if (words.length) {
      const hay = normalize(`${c.title} ${c.handle ?? ''}`)
      if (!words.every((w) => hay.includes(w))) return false
    }
    return true
  })
}

/** Channels per folder (recursive), `none` (no folder or a folder that vanished) and `all`. */
export function folderCounts(rows: readonly ChannelRow[], folders: readonly Folder[]): Map<string, number> {
  const parent = new Map(folders.map((f) => [f.id, f.parent_id]))
  const out = new Map<string, number>([['all', rows.length], ['none', 0]])
  for (const f of folders) out.set(f.id, 0)
  for (const { channel: c } of rows) {
    if (!c.folder_id || !parent.has(c.folder_id)) {
      out.set('none', (out.get('none') ?? 0) + 1)
      continue
    }
    const seen = new Set<string>()
    for (let id: string | null | undefined = c.folder_id; id && !seen.has(id); id = parent.get(id)) {
      seen.add(id)
      out.set(id, (out.get(id) ?? 0) + 1)
    }
  }
  return out
}

/** Folders in tree order (siblings by `sort` and name), with the level. */
export function folderTree(folders: readonly Folder[]): Array<{ folder: Folder; level: number }> {
  const known = new Set(folders.map((f) => f.id))
  const byParent = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const p = f.parent_id && known.has(f.parent_id) ? f.parent_id : null
    const list = byParent.get(p) ?? []
    list.push(f)
    byParent.set(p, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  const out: Array<{ folder: Folder; level: number }> = []
  const seen = new Set<string>()
  const walk = (p: string | null, level: number) => {
    for (const f of byParent.get(p) ?? []) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push({ folder: f, level })
      walk(f.id, level + 1)
    }
  }
  walk(null, 1)
  return out
}

// ------------------------------------------------------------------ sorting

export type SortKey = 'name' | 'folder' | 'tags' | 'last' | 'rhythm' | 'shorts' | 'watched' | 'relation'

export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' }

/** First click: text ascends (A→Z); number and date descend (largest/most recent first). */
export function firstDir(key: SortKey): Sort['dir'] {
  return key === 'name' || key === 'folder' || key === 'relation' || key === 'tags' ? 'asc' : 'desc'
}

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: firstDir(key) }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

const RELATION_ORDER: Record<Relation, number> = { subscribed: 0, followed: 1, ignored: 2, ex: 3 }

type SortValue = string | number | null

function sortValue(row: ChannelRow, key: SortKey, folderName: ReadonlyMap<string, string>, tagName: ReadonlyMap<string, string>): SortValue {
  const c = row.channel
  switch (key) {
    case 'name':
      return normalize(c.title)
    case 'folder': {
      const name = c.folder_id ? folderName.get(c.folder_id) : undefined
      return name ? normalize(name) : null
    }
    case 'tags': {
      const names = c.tag_ids.map((id) => tagName.get(id)).filter((n): n is string => !!n)
      return names.length ? normalize(names.sort().join(' ')) : null
    }
    case 'last':
      return c.last_video_at
    case 'rhythm':
      return c.videos_per_week
    case 'shorts':
      return c.shorts_ratio
    case 'watched':
      return row.watched_90d
    case 'relation':
      return RELATION_ORDER[c.relation] ?? 9
  }
}

/** Sorts by the column; empty (no folder, no data) always last; ties by name. */
export function sortRows(
  rows: readonly ChannelRow[],
  sort: Sort,
  folderName: ReadonlyMap<string, string>,
  tagName: ReadonlyMap<string, string> = new Map()
): ChannelRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const keyed = rows.map((r) => ({ r, v: sortValue(r, sort.key, folderName, tagName), n: normalize(r.channel.title) }))
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v === null && b.v !== null) return 1
      if (b.v === null && a.v !== null) return -1
    } else if (a.v !== b.v) {
      const cmp = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))
      if (cmp) return sign * cmp
    }
    return a.n.localeCompare(b.n) || a.r.channel.id.localeCompare(b.r.channel.id)
  })
  return keyed.map((k) => k.r)
}

// ------------------------------------------------------------------ columns

export type Column = 'select' | 'name' | 'folder' | 'tags' | 'last' | 'rhythm' | 'shorts' | 'watched' | 'relation'

export const ALL_COLUMNS: readonly Column[] = ['select', 'name', 'folder', 'tags', 'last', 'rhythm', 'shorts', 'watched', 'relation']

/** Numeric columns (right-aligned, tabular figures). */
export const NUMERIC_COLUMNS: ReadonlySet<Column> = new Set(['last', 'rhythm', 'shorts', 'watched'])

/** Minimum width (px) of each column; the name grows (`minmax(NAME, 1fr)`). */
export const COLUMN_WIDTH: Record<Column, number> = {
  select: 28,
  name: 220,
  folder: 136,
  tags: 152,
  last: 96,
  rhythm: 76,
  shorts: 64,
  watched: 80,
  relation: 92
}

export const COLUMN_GAP = 12

/** Who goes first when width is short (the name never goes). */
const DROP_ORDER: readonly Column[] = ['shorts', 'rhythm', 'relation', 'watched', 'tags', 'last', 'folder']

/**
 * Columns whose data the route really returns: pace, % Shorts and watched only exist if SOME channel has the number
 * (`watched_90d` is `null` for all until a device sends history). Without data, the column does not show.
 */
export function dataColumns(rows: readonly ChannelRow[]): Column[] {
  const has = (fn: (r: ChannelRow) => unknown) => rows.some((r) => fn(r) != null)
  return ALL_COLUMNS.filter((c) => {
    if (c === 'rhythm') return has((r) => r.channel.videos_per_week)
    if (c === 'shorts') return has((r) => r.channel.shorts_ratio)
    if (c === 'watched') return has((r) => r.watched_90d)
    return true
  })
}

/** Ceiling of the width the name asks for (above that, ellipsis + full name in the tooltip). */
export const NAME_MAX_NEED = 340

/** Avatar + gaps + ⭐ + 🔕 around the name text (px). */
const NAME_CHROME = 24 + 6 + 4 + 20 + 16

/**
 * Width the name column asks for given this list's names: the p90 of the length (one outlier name does not
 * take down columns by itself), estimated at ~6.8 px per character (13 px, weight 550), between the minimum and `NAME_MAX_NEED`.
 */
export function nameNeed(rows: readonly ChannelRow[]): number {
  if (!rows.length) return COLUMN_WIDTH.name
  const lens = rows.map((r) => r.channel.title.length).sort((a, b) => a - b)
  const p90 = lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))]
  return Math.round(Math.min(NAME_MAX_NEED, Math.max(COLUMN_WIDTH.name, p90 * 6.8 + NAME_CHROME)))
}

function widthOf(cols: readonly Column[], nameMin: number): number {
  return cols.reduce((s, c) => s + (c === 'name' ? nameMin : COLUMN_WIDTH[c]), 0) + Math.max(0, cols.length - 1) * COLUMN_GAP
}

/**
 * Drops secondary columns (in `DROP_ORDER`) until it fits in `width` with the name at the width it asks for
 * (`nameMin`): the name is not cut while there is a secondary column left to drop. 0/unknown = all.
 */
export function fitColumns(cols: readonly Column[], width: number | null, nameMin: number = COLUMN_WIDTH.name): Column[] {
  let out = [...cols]
  if (!width) return out
  for (const drop of DROP_ORDER) {
    if (widthOf(out, nameMin) <= width) break
    out = out.filter((c) => c !== drop)
  }
  return out
}

/** `grid-template-columns` of the visible columns. */
export function gridTemplate(cols: readonly Column[], nameMin: number = COLUMN_WIDTH.name): string {
  return cols.map((c) => (c === 'name' ? `minmax(${nameMin}px, 1fr)` : `${COLUMN_WIDTH[c]}px`)).join(' ')
}

// ------------------------------------------------------------------ row window

/** Fixed row height (px): the window computes without measuring each row. */
export const ROW_H = 38

export interface WindowInput {
  scrollTop: number
  /** Visible height of the scroller. */
  viewport: number
  /** Distance from the top of the table body to the top of the scroller content. */
  bodyTop: number
  total: number
  overscan?: number
}

export function windowRange({ scrollTop, viewport, bodyTop, total, overscan = 8 }: WindowInput): { start: number; end: number } {
  const top = Math.max(0, scrollTop - bodyTop)
  const first = Math.floor(top / ROW_H)
  const last = Math.ceil((top + Math.max(viewport, 0)) / ROW_H)
  const start = Math.min(Math.max(0, first - overscan), Math.max(0, total))
  const end = Math.min(total, Math.max(start, last + overscan))
  return { start, end }
}

// ------------------------------------------------------------------ remembered state

export const VIEW_KEY = 'manage.view'

export interface SavedView {
  filters: Filters
  sort: Sort
}

const SORT_KEYS: readonly SortKey[] = ['name', 'folder', 'tags', 'last', 'rhythm', 'shorts', 'watched', 'relation']

/** Reads what was saved, field by field; a strange value falls back to the default (never throws). */
export function parseView(raw: unknown): SavedView {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const f = v.filters && typeof v.filters === 'object' ? (v.filters as Record<string, unknown>) : {}
  const s = v.sort && typeof v.sort === 'object' ? (v.sort as Record<string, unknown>) : {}
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null)
  return {
    filters: {
      q: typeof f.q === 'string' ? f.q : '',
      folder: str(f.folder),
      tag: str(f.tag),
      relation: RELATION_FILTERS.includes(f.relation as RelationFilter) ? (f.relation as RelationFilter) : 'active',
      favorite: f.favorite === true,
      muted: f.muted === true,
      staleMonths: STALE_MONTHS.includes(f.staleMonths as number) ? (f.staleMonths as number) : null
    },
    sort: {
      key: SORT_KEYS.includes(s.key as SortKey) ? (s.key as SortKey) : DEFAULT_SORT.key,
      dir: s.dir === 'desc' ? 'desc' : s.dir === 'asc' ? 'asc' : DEFAULT_SORT.dir
    }
  }
}

/** A folder/tag filter that vanished (deleted elsewhere) goes back to the default. */
export function pruneFilters(f: Filters, folders: readonly Folder[] | undefined, tags: readonly Tag[] | undefined): Filters {
  let out = f
  if (folders && f.folder && f.folder !== 'none' && !folders.some((x) => x.id === f.folder)) out = { ...out, folder: null }
  if (tags && f.tag && !tags.some((x) => x.id === f.tag)) out = { ...out, tag: null }
  return out
}

// ------------------------------------------------------------------ selection

/** Ids between `a` and `b` (inclusive) in the displayed order. */
export function rangeIds(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return j >= 0 ? [b] : []
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  return order.slice(lo, hi + 1)
}
