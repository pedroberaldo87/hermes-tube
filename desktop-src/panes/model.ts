// Pure panel model: tree of folders/channels, recursive counters, search, drag, "mark as read" scopes, the Home
// tab that matches a node, failure classification. No React, no network.
import type { Channel, Folder, ReadScope, Tab } from '../../shared/api-types'
import { TubeApiError, toApiError } from '../lib/rest'

// ------------------------------------------------------------------ nodes

export type NodeRef =
  | { kind: 'all' }
  | { kind: 'later' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; id: string }
  | { kind: 'channel'; id: string }

/** Tree item id (the TreeItem's `data-id`): `all`, `later`, `unfiled`, `folder:<id>`, `channel:<id>`. */
export function nodeKey(ref: NodeRef): string {
  return ref.kind === 'folder' || ref.kind === 'channel' ? `${ref.kind}:${ref.id}` : ref.kind
}

export function parseKey(key: string | null | undefined): NodeRef | null {
  if (!key) return null
  if (key === 'all' || key === 'later' || key === 'unfiled') return { kind: key }
  const i = key.indexOf(':')
  if (i < 0) return null
  const kind = key.slice(0, i)
  const id = key.slice(i + 1)
  if (!id) return null
  return kind === 'folder' || kind === 'channel' ? { kind, id } : null
}

// ------------------------------------------------------------------ tree

export interface FolderNode {
  folder: Folder
  children: FolderNode[]
  channels: Channel[]
}

export interface ChannelTree {
  roots: FolderNode[]
  /** Channels without a folder (or with a folder that no longer exists). */
  unfiled: Channel[]
  folders: ReadonlyMap<string, Folder>
  channels: ReadonlyMap<string, Channel>
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function byFolderOrder(a: Folder, b: Folder): number {
  return a.sort - b.sort || collator.compare(a.name, b.name)
}

function byTitle(a: Channel, b: Channel): number {
  return collator.compare(a.title, b.title)
}

/** Nested folders (by `sort`, then name) with their channels (by title). Missing parent or cycle → root. */
export function buildTree(folders: readonly Folder[], channels: readonly Channel[]): ChannelTree {
  const folderMap = new Map(folders.map((f) => [f.id, f]))
  const kids = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const parent = f.parent_id && folderMap.has(f.parent_id) && !reachesSelf(folderMap, f) ? f.parent_id : null
    const list = kids.get(parent) ?? []
    list.push(f)
    kids.set(parent, list)
  }
  const inFolder = new Map<string, Channel[]>()
  const unfiled: Channel[] = []
  for (const c of channels) {
    if (c.folder_id && folderMap.has(c.folder_id)) {
      const list = inFolder.get(c.folder_id) ?? []
      list.push(c)
      inFolder.set(c.folder_id, list)
    } else unfiled.push(c)
  }
  const build = (f: Folder): FolderNode => ({
    folder: f,
    children: (kids.get(f.id) ?? []).sort(byFolderOrder).map(build),
    channels: (inFolder.get(f.id) ?? []).sort(byTitle)
  })
  return {
    roots: (kids.get(null) ?? []).sort(byFolderOrder).map(build),
    unfiled: unfiled.sort(byTitle),
    folders: folderMap,
    channels: new Map(channels.map((c) => [c.id, c]))
  }
}

function reachesSelf(map: ReadonlyMap<string, Folder>, f: Folder): boolean {
  const seen = new Set<string>([f.id])
  let p = f.parent_id
  while (p) {
    if (seen.has(p)) return true
    seen.add(p)
    p = map.get(p)?.parent_id ?? null
  }
  return false
}

/** Is `id` inside `ancestorId` (strict descendant)? */
export function isInside(folders: readonly Folder[] | ReadonlyMap<string, Folder>, id: string, ancestorId: string): boolean {
  const map = folders instanceof Map ? folders : new Map((folders as readonly Folder[]).map((f) => [f.id, f]))
  const seen = new Set<string>()
  let p = map.get(id)?.parent_id ?? null
  while (p && !seen.has(p)) {
    if (p === ancestorId) return true
    seen.add(p)
    p = map.get(p)?.parent_id ?? null
  }
  return false
}

/** New per folder, including subfolders (from the per-channel new counts: what is on screen adds up). */
export function folderCounts(tree: ChannelTree, byChannel: Readonly<Record<string, number>> | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!byChannel) return out
  const walk = (n: FolderNode): number => {
    let sum = 0
    for (const c of n.channels) sum += byChannel[c.id] ?? 0
    for (const k of n.children) sum += walk(k)
    out.set(n.folder.id, sum)
    return sum
  }
  for (const r of tree.roots) walk(r)
  return out
}

/** Ids of the channels a scope covers (recursive folder). */
export function channelsIn(tree: ChannelTree, ref: NodeRef): string[] {
  if (ref.kind === 'all') return [...tree.channels.keys()]
  if (ref.kind === 'channel') return [ref.id]
  if (ref.kind === 'unfiled') return tree.unfiled.map((c) => c.id)
  if (ref.kind !== 'folder') return []
  const out: string[] = []
  const walk = (n: FolderNode) => {
    for (const c of n.channels) out.push(c.id)
    n.children.forEach(walk)
  }
  const find = (nodes: FolderNode[]): FolderNode | null => {
    for (const n of nodes) {
      if (n.folder.id === ref.id) return n
      const hit = find(n.children)
      if (hit) return hit
    }
    return null
  }
  const node = find(tree.roots)
  if (node) walk(node)
  return out
}

/** `POST /read` scope of a node ("Watch later" and "No folder" have none). */
export function readScopeOf(ref: NodeRef): ReadScope | null {
  if (ref.kind === 'all') return { kind: 'all' }
  if (ref.kind === 'folder' || ref.kind === 'channel') return { kind: ref.kind, id: ref.id }
  return null
}

// ------------------------------------------------------------------ search

/** Accent- and case-insensitive. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export interface FilteredTree {
  tree: ChannelTree
  /** Channels + folders that matched. */
  matches: number
}

/** Keeps what matches and the path to it; a matching folder brings all its content along. */
export function filterTree(tree: ChannelTree, query: string): FilteredTree {
  const words = fold(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { tree, matches: 0 }
  const hit = (text: string) => {
    const hay = fold(text)
    return words.every((w) => hay.includes(w))
  }
  let matches = 0
  const channelHit = (c: Channel) => hit(`${c.title} ${c.handle ?? ''}`)
  const walk = (n: FolderNode): FolderNode | null => {
    if (hit(n.folder.name)) {
      matches++
      return n
    }
    const children = n.children.map(walk).filter((k): k is FolderNode => k !== null)
    const channels = n.channels.filter(channelHit)
    matches += channels.length
    return children.length || channels.length ? { folder: n.folder, children, channels } : null
  }
  const roots = tree.roots.map(walk).filter((k): k is FolderNode => k !== null)
  const unfiled = tree.unfiled.filter(channelHit)
  matches += unfiled.length
  return { tree: { ...tree, roots, unfiled }, matches }
}

/** Folders visible in a tree (to expand everything during a search). */
export function folderIds(tree: ChannelTree): string[] {
  const out: string[] = []
  const walk = (n: FolderNode) => {
    out.push(n.folder.id)
    n.children.forEach(walk)
  }
  tree.roots.forEach(walk)
  return out
}

// ------------------------------------------------------------------ drag

export type DragItem = { kind: 'channel' | 'folder'; id: string }

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/

export function dragData(item: DragItem): string {
  return `${item.kind}:${item.id}`
}

/** Dragged text → item. Accepts `channel:<id>`, `folder:<id>` and a raw channel id (from another screen). */
export function parseDrag(data: string | null | undefined): DragItem | null {
  const text = (data ?? '').trim()
  if (CHANNEL_ID.test(text)) return { kind: 'channel', id: text }
  const m = /^(channel|folder):(.+)$/.exec(text)
  if (!m) return null
  if (m[1] === 'channel' && !CHANNEL_ID.test(m[2])) return null
  return { kind: m[1] as DragItem['kind'], id: m[2] }
}

// ------------------------------------------------------------------ Home

/** Home's "Watch later" tab (local). */
export const HOME_LATER_TAB = ':later'
/** Default "All new" tab (always present on the server). */
export const HOME_ALL_TAB = 'all-new'

function onlyThis(tab: Tab, key: 'folders' | 'channels', id: string): boolean {
  const inc = tab.rules?.include
  if (!inc || inc.all || inc.favorites) return false
  const other = key === 'folders' ? 'channels' : 'folders'
  const list = inc[key] ?? []
  return list.length === 1 && list[0] === id && !(inc[other] ?? []).length && !(inc.tags ?? []).length && !(inc.themes ?? []).length && !(inc.lenses ?? []).length
}

/** The Home tab that shows exactly this node (or null: Home does not yet filter by a folder/channel without a tab). */
export function homeTabFor(ref: NodeRef, tabs: readonly Tab[] | null | undefined): string | null {
  if (ref.kind === 'later') return HOME_LATER_TAB
  if (ref.kind === 'all') return tabs?.find((t) => t.id === HOME_ALL_TAB)?.id ?? tabs?.find((t) => t.rules?.include?.all)?.id ?? HOME_ALL_TAB
  if (ref.kind === 'folder') return tabs?.find((t) => onlyThis(t, 'folders', ref.id))?.id ?? null
  if (ref.kind === 'channel') return tabs?.find((t) => onlyThis(t, 'channels', ref.id))?.id ?? null
  return null
}

// ------------------------------------------------------------------ failures

/** Why the read failed: plugin missing in this profile (404/disabled), no connection, or a contract error. */
export type FailureKind = 'unavailable' | 'offline' | 'error'

const NOT_HERE = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i

export function failureKind(error: unknown): FailureKind {
  if (error instanceof TubeApiError) {
    if (error.code === 'plugin_disabled') return 'unavailable'
    if (error.transport) return NOT_HERE.test(error.message) ? 'unavailable' : 'offline'
    return 'error'
  }
  const api = toApiError(error)
  if (api.code === 'plugin_disabled') return 'unavailable'
  if (api.code !== 'internal') return 'error'
  return NOT_HERE.test(api.message) ? 'unavailable' : 'offline'
}
