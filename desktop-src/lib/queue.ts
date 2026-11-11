// The Watch queue ("Up next"): an editable copy of the list a video was opened from.
//  - Model: where it came from (`origin`), the items in play order and the video being played (`current`, always one
//    of the items or `null`). Every operation below is pure: it returns a new queue (or the same object when nothing
//    changes) and never touches the video's state or the list it was copied from.
//  - Store: `$queue` lives as long as the plugin (switching sections and coming back keeps it; it is not saved across
//    reloads — the Watch section itself does not survive one). `lib/player` calls `openInQueue` when a video is opened
//    from outside the queue and `setQueue(setCurrent(…))` when the screen plays one of its items.
//  - Ready for saved lists: a caller that knows what it is playing (a saved playlist, Watch later) passes `origin`
//    in the open request; otherwise the origin is the list's name.
import { atom, useValue } from '@hermes/plugin-sdk'
import type { FeedItem } from '../../shared/api-types'
import { onShellReset } from './lifecycle'

/** What the queue was copied from. `kind`: 'list' (a tab or any on-screen list) today; saved lists add their own. */
export interface QueueOrigin {
  kind: string
  id: string
  label: string | null
}

export interface Queue {
  origin: QueueOrigin | null
  items: readonly FeedItem[]
  /** Id of the video being played: one of `items`, or `null` (nothing marked). */
  current: string | null
  /** New for every queue built from a list: an undo from an older queue does not apply to a newer one. */
  serial: number
}

/** A removed item, enough to put it back exactly where it was. */
export interface RemovedItem {
  item: FeedItem
  index: number
  wasCurrent: boolean
  serial: number
}

/** Where a video is opened from (the same shape as the open request, plus an optional explicit origin). */
export interface QueueSource {
  list?: readonly FeedItem[] | null
  source?: string | null
  origin?: QueueOrigin | null
}

let serials = 0

const idOf = (it: FeedItem) => it.video.id

/** A new queue: a copy of `items` without repeated videos; `current` only if it is in the list. */
export function createQueue(origin: QueueOrigin | null, items: readonly FeedItem[], current: string | null): Queue {
  const seen = new Set<string>()
  const copy: FeedItem[] = []
  for (const it of items) {
    const id = idOf(it)
    if (seen.has(id)) continue
    seen.add(id)
    copy.push(it)
  }
  return { origin, items: copy, current: current && seen.has(current) ? current : null, serial: ++serials }
}

export function indexOf(q: Queue, id: string): number {
  return q.items.findIndex((it) => idOf(it) === id)
}

/** Position of the current video (-1 when nothing is marked). */
export function queueIndex(q: Queue): number {
  return q.current ? indexOf(q, q.current) : -1
}

/** The video after the current one (the first one when nothing is marked). */
export function nextOf(q: Queue): FeedItem | null {
  return q.items[queueIndex(q) + 1] ?? null
}

export function prevOf(q: Queue): FeedItem | null {
  const i = queueIndex(q)
  return i > 0 ? q.items[i - 1] : null
}

/** Marks `id` as the video being played (no change when it is not queued). */
export function setCurrent(q: Queue, id: string): Queue {
  if (q.current === id || indexOf(q, id) < 0) return q
  return { ...q, current: id }
}

/**
 * Takes a video out of the queue. Removing the current one moves the mark to the video that took its place (the
 * next one; the previous one when it was last; none when the queue is now empty).
 */
export function removeItem(q: Queue, id: string): { queue: Queue; removed: RemovedItem | null } {
  const index = indexOf(q, id)
  if (index < 0) return { queue: q, removed: null }
  const items = q.items.filter((_, i) => i !== index)
  const wasCurrent = q.current === id
  const current = wasCurrent ? (items[index] ?? items[index - 1] ?? null) : null
  return {
    queue: { ...q, items, current: wasCurrent ? (current ? idOf(current) : null) : q.current },
    removed: { item: q.items[index], index, wasCurrent, serial: q.serial }
  }
}

/** Undo of `removeItem`: back at its old position (clamped) and, if it was the current one, current again. */
export function restoreItem(q: Queue, removed: RemovedItem): Queue {
  const id = idOf(removed.item)
  if (indexOf(q, id) >= 0) return q
  const items = [...q.items]
  items.splice(Math.min(Math.max(0, removed.index), items.length), 0, removed.item)
  return { ...q, items, current: removed.wasCurrent ? id : q.current }
}

/** Moves the item at `from` to position `to` (both indexes in the current order). */
export function moveItem(q: Queue, from: number, to: number): Queue {
  const n = q.items.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return q
  const items = [...q.items]
  const [it] = items.splice(from, 1)
  items.splice(to, 0, it)
  return { ...q, items }
}

/** One step up (-1) or down (+1). */
export function moveBy(q: Queue, id: string, delta: number): Queue {
  const from = indexOf(q, id)
  if (from < 0) return q
  return moveItem(q, from, from + delta)
}

/** Puts the video right after the current one. No change for the current one, the one already next, or with nothing playing. */
export function playNext(q: Queue, id: string): Queue {
  const cur = queueIndex(q)
  const from = indexOf(q, id)
  if (cur < 0 || from < 0 || from === cur || from === cur + 1) return q
  return moveItem(q, from, from < cur ? cur : cur + 1)
}

export function sameOrigin(a: QueueOrigin | null | undefined, b: QueueOrigin | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id
}

/** The origin of an open request: the explicit one, else the list's name; no list → no queue. */
export function queueOriginOf(from: QueueSource): QueueOrigin | null {
  if (from.origin) return from.origin
  if (!from.list?.length) return null
  const label = from.source ?? null
  return { kind: 'list', id: label ?? '', label }
}

// ------------------------------------------------------------------ store

export const $queue = atom<Queue | null>(null)

onShellReset(() => {
  $queue.set(null)
})

export function getQueue(): Queue | null {
  return $queue.get()
}

export function setQueue(q: Queue | null): void {
  if ($queue.get() !== q) $queue.set(q)
}

export function useQueue(): Queue | null {
  return useValue($queue)
}

/**
 * A video opened from outside the queue (a tab, the chat, a link):
 *  - with a list: the same origin with the video still queued keeps the (possibly edited) queue and moves the mark;
 *    anything else replaces the queue with a copy of the list, without asking;
 *  - without a list: a queued video keeps the queue; any other video drops it (nothing to play next).
 */
export function openInQueue(id: string, from: QueueSource): void {
  const cur = $queue.get()
  const origin = queueOriginOf(from)
  const queued = !!cur && indexOf(cur, id) >= 0
  if (origin && from.list?.length) {
    if (cur && queued && sameOrigin(cur.origin, origin)) setQueue(setCurrent(cur, id))
    else setQueue(createQueue(origin, from.list, id))
    return
  }
  setQueue(cur && queued ? setCurrent(cur, id) : null)
}
