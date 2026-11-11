// "Run now": the human click that releases a round of the unsubscribe queue.
//
// The server only hands out items a person approved in Hermes, but the extension cannot tell who wrote them into
// the plugin's database. So before each round it asks again, inside the extension:
// - the service worker lists the approved items (`GET /ext/queue?peek=1`, nothing is lent) in `QUEUE_WAITING_KEY`
//   and shows the count on the toolbar badge;
// - the popup shows "N approved unsubscribes are waiting" with **Run now** / **Not now**. Run now writes the ids the
//   user saw in `QUEUE_RELEASE_KEY`; the executor only runs those ids, each once.
//
// Everything lives in `chrome.storage.session`: only extension pages (the popup) and the service worker can read or
// write it (content scripts cannot, and the extension never changes that access level), and Chrome clears it when the
// browser closes or the extension reloads — which drops any release. No message, page or server can write a release.

import type { QueueAction } from '../../../shared/api-types'

export const QUEUE_WAITING_KEY = 'queue_waiting'
export const QUEUE_RELEASE_KEY = 'queue_release'
export const QUEUE_SNOOZE_KEY = 'queue_snooze'
/** a release older than this is ignored (the user clicked long ago) */
export const RELEASE_TTL_MS = 2 * 3600_000
/** how many ids one prompt lists (the server lists at most this many too) */
export const WAITING_MAX = 100

export interface WaitingItem {
  id: string
  channel_id: string
  channel_title: string | null
  action: QueueAction
}

/** What the service worker last saw approved on the server (`at` = epoch ms). */
export interface QueueWaiting {
  items: WaitingItem[]
  at: number
}

/** Ids released by "Run now" (`at` = epoch ms of the click). */
export interface QueueRelease {
  ids: string[]
  at: number
}

/** "Not now": ids the user chose not to run yet (no badge for them). */
export interface QueueSnooze {
  ids: string[]
  at: number
}

function area(): chrome.storage.StorageArea | null {
  return (globalThis.chrome?.storage as { session?: chrome.storage.StorageArea } | undefined)?.session ?? null
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200))].slice(0, WAITING_MAX * 4) : []

async function read<T>(key: string): Promise<T | null> {
  const s = area()
  if (!s) return null
  const got = await s.get(key)
  const v = got[key]
  return v && typeof v === 'object' ? (v as T) : null
}

export async function readWaiting(): Promise<QueueWaiting | null> {
  const w = await read<QueueWaiting>(QUEUE_WAITING_KEY)
  if (!w || !Array.isArray(w.items)) return null
  return { items: w.items.filter((i) => i && typeof i.id === 'string'), at: Number(w.at) || 0 }
}

export async function writeWaiting(w: QueueWaiting | null): Promise<void> {
  const s = area()
  if (!s) return
  if (w && w.items.length) await s.set({ [QUEUE_WAITING_KEY]: w })
  else await s.remove(QUEUE_WAITING_KEY)
}

/** Current release; `null` when absent, empty or expired. */
export async function readRelease(now: number = Date.now()): Promise<QueueRelease | null> {
  const r = await read<QueueRelease>(QUEUE_RELEASE_KEY)
  if (!r) return null
  const at = Number(r.at)
  const ids = idList(r.ids)
  if (!Number.isFinite(at) || now - at > RELEASE_TTL_MS || at - now > 60_000 || ids.length === 0) return null
  return { ids, at }
}

/** "Run now" (popup only): releases these ids, on top of what is still released. */
export async function releaseQueue(ids: readonly string[], now: number = Date.now()): Promise<void> {
  const s = area()
  if (!s) return
  const prev = await readRelease(now)
  const next: QueueRelease = { ids: idList([...(prev?.ids ?? []), ...ids]), at: now }
  await s.set({ [QUEUE_RELEASE_KEY]: next })
}

/** The executor took this id: it is never released again by the same click. */
export async function consumeRelease(id: string): Promise<void> {
  const s = area()
  if (!s) return
  const r = await read<QueueRelease>(QUEUE_RELEASE_KEY)
  if (!r) return
  const ids = idList(r.ids).filter((x) => x !== id)
  if (ids.length) await s.set({ [QUEUE_RELEASE_KEY]: { ids, at: r.at } })
  else await s.remove(QUEUE_RELEASE_KEY)
}

/** "Not now" (popup only). */
export async function snoozeQueue(ids: readonly string[], now: number = Date.now()): Promise<void> {
  const s = area()
  if (!s) return
  const prev = await read<QueueSnooze>(QUEUE_SNOOZE_KEY)
  await s.set({ [QUEUE_SNOOZE_KEY]: { ids: idList([...idList(prev?.ids), ...ids]), at: now } })
}

export async function readSnooze(): Promise<string[]> {
  return idList((await read<QueueSnooze>(QUEUE_SNOOZE_KEY))?.ids)
}

/** Items that still need a click (not released, not snoozed). */
export function unreleased(w: QueueWaiting | null, release: QueueRelease | null, snoozed: readonly string[] = []): WaitingItem[] {
  const skip = new Set([...(release?.ids ?? []), ...snoozed])
  return (w?.items ?? []).filter((i) => !skip.has(i.id))
}
