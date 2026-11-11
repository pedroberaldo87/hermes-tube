// Pure logic of "Organize with Hermes" (no React): defensive reading of the proposal (the payload comes from the
// database, written from the model's output — already checked server-side, but the screen does not trust the shape), groups
// by folder in STABLE order (arrival order: nothing jumps while batches arrive), merge of the suggestions that
// arrive by query, channels left without a suggestion (partial error) and the path to the model settings.
import type { Folder, Suggestion } from '../../../shared/api-types'
import { PLUGIN_ID } from '../../../shared/ids'

/** Window to undo a reject before it goes to the server (the reject becomes an example and does not come back). */
export const REJECT_GRACE_MS = 5_000
/** `GET /channels` limit (api.yaml); covers "hundreds of channels" in a single read. */
export const CHANNEL_LIST_LIMIT = 2_000
/** Relations the organizer considers (`ORGANIZABLE`). */
export const ORGANIZABLE_RELATIONS = 'subscribed,followed'
/** How many history entries to read to find the id of a group for "Undo organization". */
export const CHANGES_LOOKUP_LIMIT = 200

/** The plugin's auxiliary task in Hermes (mirror of `wiring.CURATOR_TASK`, derived from the id). */
export function curatorTask(): string {
  return `${PLUGIN_ID.replace(/-/g, '_')}_curator`
}

/** Settings → Models, already on the plugin task's row (the Desktop's `aux` deep link). */
export function modelSettingsPath(): string {
  return `/settings?tab=config:model&aux=${encodeURIComponent(curatorTask())}`
}

// ------------------------------------------------------------------ proposal

export interface Proposal {
  channelId: string
  channelTitle: string | null
  folder: string
  newFolder: boolean
  tags: string[]
  /** 0..1 or `null` (absent/invalid: not shown). */
  confidence: number | null
  why: string
  /** Folder the channel is in today (selection in Manage with a channel already in a folder). */
  fromFolder: string | null
  /** The suggested folder is the one the channel is already in (only tags would change). */
  sameFolder: boolean
  /** Suggested tags the channel does not have yet (an older backend without `new_tags`: all of them). */
  newTags: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [])

/** Proposal of a `kind=organize` suggestion; `null` if the essentials are missing (channel or folder). */
export function proposalOf(s: Suggestion): Proposal | null {
  const p = (s.payload ?? {}) as Record<string, unknown>
  const channelId = str(p.channel_id) ?? str(s.channel_id)
  const folder = str(p.folder)
  if (!channelId || !folder) return null
  const conf = typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? Math.min(1, Math.max(0, p.confidence)) : null
  const tags = strings(p.tags)
  const fromFolder = str(p.from_folder)
  // the server says it (`same_folder`); an older backend only stored where the channel was
  const sameFolder = typeof p.same_folder === 'boolean' ? p.same_folder : fromFolder !== null && folderKey(fromFolder) === folderKey(folder)
  return {
    channelId,
    channelTitle: str(p.channel_title),
    folder: folder.trim(),
    newFolder: p.new_folder === true,
    tags,
    confidence: conf,
    why: typeof p.why === 'string' ? p.why : '',
    fromFolder,
    sameFolder,
    newTags: Array.isArray(p.new_tags) ? strings(p.new_tags) : tags
  }
}

/** A suggestion that keeps the channel where it is and adds nothing: not shown (it is noise). */
export function changesNothing(p: Proposal): boolean {
  return p.sameFolder && p.newTags.length === 0
}

/** 0 = channel without a folder · 1 = moves a channel that has one · 2 = only adds tags. */
export function rankOf(p: Proposal): number {
  return p.sameFolder ? 2 : p.fromFolder === null ? 0 : 1
}

// ------------------------------------------------------------------ items and groups

export interface Item {
  suggestion: Suggestion
  proposal: Proposal
}

export interface Group {
  /** Normalized name (groups "Ciência" and "ciência "); the tag-only group has its own key. */
  key: string
  /** `folder`: channels that go to this folder · `tags`: channels that stay, gaining tags. */
  kind: 'folder' | 'tags'
  /** Displayed spelling (the first one that arrived); empty in the tag-only group. */
  folder: string
  /** Some suggestion in the group creates the folder. */
  isNew: boolean
  items: Item[]
}

/** Key of the tag-only group (cannot clash with a folder key: those never start with a control character). */
export const TAGS_GROUP_KEY = '\u0000tags'

/** Folder key: case-insensitive, no stray spaces, no Unicode composition difference. */
export function folderKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Groups by folder, in the order each folder appeared (stable while batches arrive), with the channels
 * without a folder first: groups that hold one come before groups that only move filed channels, and
 * inside a group they come first. Suggestions that only add tags go to one last group.
 */
export function groupItems(items: readonly Item[]): Group[] {
  const groups = new Map<string, Group>()
  /** Best rank in the group and the arrival position of its first item with that rank. */
  const order = new Map<string, [number, number]>()
  items.forEach((item, index) => {
    const r = rankOf(item.proposal)
    const tagsOnly = r === 2
    const key = tagsOnly ? TAGS_GROUP_KEY : folderKey(item.proposal.folder)
    let g = groups.get(key)
    if (!g) {
      g = { key, kind: tagsOnly ? 'tags' : 'folder', folder: tagsOnly ? '' : item.proposal.folder, isNew: false, items: [] }
      groups.set(key, g)
    }
    g.items.push(item)
    const best = order.get(key)
    if (!best || r < best[0]) order.set(key, [r, index])
    if (item.proposal.newFolder && !tagsOnly) g.isNew = true
  })
  const byRank = (a: Item, b: Item) => rankOf(a.proposal) - rankOf(b.proposal)
  const pos = (g: Group) => order.get(g.key) ?? [0, 0]
  // Array.prototype.sort is stable: arrival order is kept within the same rank
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort(byRank) }))
    .sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1])
}

/**
 * Merges what the server returned into what the screen already shows: keeps arrival order, updates content,
 * appends the new at the end. With `prune`, what left the server's pending list (replaced,
 * decided elsewhere) disappears — except what `keep(id)` protects (decided here, in undo).
 */
export function mergeSuggestions(
  prev: readonly Item[],
  incoming: readonly Suggestion[],
  keep: (id: string) => boolean,
  prune: boolean
): Item[] {
  const fresh = new Map<string, Item>()
  for (const s of incoming) {
    if (s.kind !== 'organize') continue
    const proposal = proposalOf(s)
    // "stay in the folder you are in" is not a suggestion (an older backend still sends them)
    if (proposal && !changesNothing(proposal)) fresh.set(s.id, { suggestion: s, proposal })
  }
  const out: Item[] = []
  const seen = new Set<string>()
  for (const item of prev) {
    const id = item.suggestion.id
    seen.add(id)
    const next = fresh.get(id)
    if (next) out.push(next)
    else if (!prune || keep(id)) out.push(item)
  }
  for (const [id, item] of fresh) if (!seen.has(id)) out.push(item)
  return out
}

/** Target channels that have no suggestion on screen (failed batch, timeout, the model omitted them). */
export function missingChannels(targets: readonly string[], items: readonly Item[]): string[] {
  const covered = new Set(items.map((i) => i.proposal.channelId))
  return [...new Set(targets)].filter((id) => !covered.has(id))
}

/** Full paths (`A/B`) of the existing folders, to suggest in the swap field. */
export function folderPaths(folders: readonly Folder[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (f: Folder, depth = 0): string => {
    const parent = f.parent_id ? byId.get(f.parent_id) : undefined
    return parent && depth < 8 ? `${pathOf(parent, depth + 1)}/${f.name}` : f.name
  }
  return folders.map((f) => pathOf(f)).sort((a, b) => a.localeCompare(b))
}

/** `<base>_one` / `<base>_other` by the language's plural rule. */
export function pluralKey(base: string, count: number, locale: string): string {
  let rule = 'other'
  try {
    rule = new Intl.PluralRules(locale).select(count)
  } catch {
    rule = count === 1 ? 'one' : 'other'
  }
  return `${base}_${rule === 'one' ? 'one' : 'other'}`
}
