// content/sidebar — pure parts: normalized state (untrusted data), folder tree with recursive counts,
// keyboard navigation order, numbers/age in the language and the only links/images the bar creates.
import type { ExtState, FolderCount } from '../../../../shared/api-types'
import type { Language } from '../../lib/i18n'

export interface TabEntry {
  id: string
  name: string
  count: number
  icon: string | null
}

export interface SidebarData {
  total: number
  tabs: TabEntry[]
  folders: FolderCount[]
  refreshing: boolean
}

export interface FolderNode {
  id: string
  name: string
  /** displayed count: the server's (already recursive), never less than the sum of the children */
  count: number
  level: number
  parentId: string | null
  children: FolderNode[]
}

export type ScopeKind = 'tab' | 'folder'

export interface Scope {
  kind: ScopeKind
  id: string
  name: string
}

/** Stable key of a row (roving tabindex, focus, `data-key`). */
export const keyOf = (kind: ScopeKind, id: string): string => `${kind === 'tab' ? 't' : 'f'}:${id}`

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const nonNeg = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** Everything coming from the server goes through here: wrong types become empty/zero, nothing throws. */
export function normalizeState(raw: ExtState | null | undefined): SidebarData {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tabs: TabEntry[] = []
  const seenTabs = new Set<string>()
  for (const t of Array.isArray(s.tabs) ? s.tabs : []) {
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    const id = str(r.tab_id)
    if (!id || seenTabs.has(id)) continue
    seenTabs.add(id)
    tabs.push({ id, name: str(r.name) ?? '', count: nonNeg(r.count), icon: str(r.icon) })
  }
  const folders: FolderCount[] = []
  for (const f of Array.isArray(s.folders) ? s.folders : []) {
    if (!f || typeof f !== 'object') continue
    const r = f as Record<string, unknown>
    const id = str(r.folder_id)
    if (!id) continue
    folders.push({ folder_id: id, name: str(r.name) ?? '', count: nonNeg(r.count), parent_id: str(r.parent_id) })
  }
  return { total: nonNeg(s.new_total), tabs, folders, refreshing: s.refresh_running === true }
}

/** Tree by `parent_id`. Missing parent → root; cycle → broken at the root; repeated id → the first. */
export function buildFolderTree(folders: readonly FolderCount[]): FolderNode[] {
  const byId = new Map<string, FolderCount>()
  for (const f of folders) if (!byId.has(f.folder_id)) byId.set(f.folder_id, f)

  // effective parent: exists and does not lead to a cycle
  const parentOf = new Map<string, string | null>()
  for (const f of byId.values()) {
    let p = f.parent_id && byId.has(f.parent_id) && f.parent_id !== f.folder_id ? f.parent_id : null
    if (p) {
      const seen = new Set([f.folder_id])
      for (let cur: string | null = p; cur; cur = byId.get(cur)?.parent_id ?? null) {
        if (seen.has(cur)) {
          p = null
          break
        }
        seen.add(cur)
        if (!byId.has(cur)) break
      }
    }
    parentOf.set(f.folder_id, p)
  }

  const kids = new Map<string | null, FolderCount[]>()
  for (const f of byId.values()) {
    const p = parentOf.get(f.folder_id) ?? null
    const list = kids.get(p) ?? []
    list.push(f)
    kids.set(p, list)
  }

  const build = (parent: string | null, level: number): FolderNode[] =>
    (kids.get(parent) ?? []).map((f) => {
      const children = build(f.folder_id, level + 1)
      const sum = children.reduce((a, c) => a + c.count, 0)
      return { id: f.folder_id, name: f.name, count: Math.max(f.count, sum), level, parentId: parent, children }
    })
  return build(null, 1)
}

/** Visible rows, in screen order: tabs, then folders (descending only into open ones). */
export function visibleKeys(tabs: readonly TabEntry[], tree: readonly FolderNode[], expanded: ReadonlySet<string>): string[] {
  const out = tabs.map((t) => keyOf('tab', t.id))
  const walk = (nodes: readonly FolderNode[]) => {
    for (const n of nodes) {
      out.push(keyOf('folder', n.id))
      if (n.children.length && expanded.has(n.id)) walk(n.children)
    }
  }
  walk(tree)
  return out
}

export function findFolder(tree: readonly FolderNode[], id: string): FolderNode | null {
  for (const n of tree) {
    if (n.id === id) return n
    const hit = findFolder(n.children, id)
    if (hit) return hit
  }
  return null
}

const locale = (lang: Language) => (lang === 'pt-BR' ? 'pt-BR' : 'en')

/** Counter: empty when zero (the counter disappears), compact from a thousand. */
export function formatCount(n: number, lang: Language): string {
  if (!n || n <= 0) return ''
  if (n < 1000) return String(n)
  return new Intl.NumberFormat(locale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60]
]

/** `published_at` (seconds, server) → "3 hours ago" in the active language. */
export function relativeAge(publishedAtS: number | null | undefined, nowMs: number, lang: Language): string {
  if (typeof publishedAtS !== 'number' || !Number.isFinite(publishedAtS) || publishedAtS <= 0) return ''
  const diff = Math.max(0, nowMs / 1000 - publishedAtS)
  const fmt = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'always' })
  for (const [unit, size] of UNITS) if (diff >= size) return fmt.format(-Math.floor(diff / size), unit)
  return fmt.format(-Math.max(1, Math.floor(diff / 60)), 'minute')
}

export function durationLabel(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return ''
  const total = Math.round(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export const isVideoId = (id: unknown): id is string => typeof id === 'string' && VIDEO_ID.test(id)

/** The only link destination the bar creates. */
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

/** Thumbnail from the contract (ext-protocol). */
export const thumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/** Own drawing of the built-in tabs: each one with its own, in the stroke of the others. */
export type BuiltinTabIcon = 'new' | 'star' | 'later'

const BUILTIN_TAB_ICONS: Readonly<Record<string, BuiltinTabIcon>> = { 'all-new': 'new', favorites: 'star', later: 'later', ':later': 'later' }

/** Built-in tab (by id) → its icon; the own drawing beats the server's emoji ("▶", "⭐"). */
export function builtinTabIcon(id: string): BuiltinTabIcon | null {
  return Object.prototype.hasOwnProperty.call(BUILTIN_TAB_ICONS, id) ? BUILTIN_TAB_ICONS[id] : null
}

/** Tab icon from the server: only a short emoji is shown (as text); anything else uses the default icon. */
export function tabGlyph(icon: string | null): string | null {
  if (!icon) return null
  const s = icon.trim()
  if (!s || [...s].length > 2 || /[\w<>&"'/\\]/.test(s)) return null
  return s
}
