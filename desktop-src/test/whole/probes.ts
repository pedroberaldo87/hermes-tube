// "The surface shows data": what each screen must show from the SAME world (world.ts) when it mounts.
// Does not check the design; only that the screen reached the state with data (and not error, skeleton or empty).
import { queryClient } from '../sdk-mock'
import { PLUGIN_ID } from '../../../shared/ids'
import type { SurfaceId, WholePlugin } from './mount'
import { isPlainKey, shapeProblems } from './shape'
import { FIRESHIP, NEELY, VERGE, type World } from './world'

export interface ProbeResult {
  ok: boolean
  why: string
}

const has = (text: string, needle: string): ProbeResult => ({ ok: text.includes(needle), why: `expected "${needle}" in: ${text.slice(0, 160)}` })

/** Title of the 1st video of the 1st tab (Subscriptions opens on it). */
function firstFeedTitle(world: World): string {
  const tab = world.tabs[0]
  return world.feedOf((c) => world.matches(c, tab.rules)).items[0].video.title
}

export function probe(app: WholePlugin, id: SurfaceId): ProbeResult {
  const root = app.root(id)
  if (!root) return { ok: false, why: `${id} is not mounted` }
  const text = app.text(id)
  if (root.querySelector('[data-whole-crash]')) return { ok: false, why: `${id} caiu` }
  const w = app.world
  switch (id) {
    case 'pane': {
      const folder = root.querySelector('[role="treeitem"][data-id="folder:f_tech"]')
      if (!folder) return { ok: false, why: `pane without the f_tech folder: ${text.slice(0, 160)}` }
      return has(text, w.folderName('f_science') ?? '?')
    }
    case 'chip':
      return has(text, String(w.status().new_total))
    case 'home':
      return has(text, firstFeedTitle(w))
    case 'manage':
      return has(text, w.channel(NEELY)?.title ?? '?')
    case 'cleanup':
      return has(text, w.channel(VERGE)?.title ?? '?')
    case 'dialog:onboarding':
      return has(text, w.devices[0].name)
    case 'dialog:organize':
      return has(text, w.channel(NEELY)?.title ?? '?')
    case 'dialog:theme':
      return { ok: !!root.querySelector('[data-part="theme"]') && !root.querySelector('[data-part="error"]'), why: `topic tab dialog without the form: ${text.slice(0, 160)}` }
    case 'dialog:tab-editor':
      // skeleton (the dialog is not built yet): it only needs to open
      return { ok: text.length > 0, why: 'empty tab editor' }
  }
  return { ok: false, why: `no probe for ${id} (${FIRESHIP})` }
}

export interface CacheEntry {
  key: readonly unknown[]
  route: string
  plain: boolean
  data: unknown
}

/** Plugin cache entries (`[PLUGIN_ID, 'rest', route, path, query]`) that already have data. */
export function restCacheEntries(): CacheEntry[] {
  const out: CacheEntry[] = []
  for (const q of queryClient.queries.values()) {
    const [id, kind, route, path, query] = q.queryKey as unknown[]
    if (id !== PLUGIN_ID || kind !== 'rest' || typeof route !== 'string') continue
    if (q.state.data === undefined) continue
    out.push({ key: q.queryKey, route, plain: isPlainKey(route, path, query), data: q.state.data })
  }
  return out
}

/** Shape problems in every key without a differentiator (empty = each key stores the route's raw response). */
export function cacheShapeProblems(): string[] {
  return restCacheEntries()
    .filter((e) => e.plain)
    .flatMap((e) => shapeProblems(e.route, e.data).map((p) => `${JSON.stringify(e.key.slice(2))} → ${p}`))
}
