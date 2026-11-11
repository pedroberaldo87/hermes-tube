// Chat card data in BATCHES: each card asks for its id; requests from the same render (the
// cards of a reply mount together) become ONE `GET /videos?ids=a,b,c` call (≤ 50 per call,
// requested order, no repeats). In-memory per-id cache (cleared on unload): remounting the same card does not call
// again; after STALE_MS a silent re-read refreshes without going back to the skeleton.
// States: loading → ready (FeedItem) | unknown (the backend does not know the id) | error (request failed).
// Optimistic actions: per-video `$chatOverlay` layer (all cards of the same video move together).
import { atom, useValue } from '@hermes/plugin-sdk'
import { useEffect } from 'react'
import type { ApiError, FeedItem, Reaction, VideoState } from '../../shared/api-types'
import { onShellReset } from '../lib/lifecycle'
import { restCall, toApiError } from '../lib/rest'

/** Max ids per `GET /videos` (contract). */
export const BATCH_MAX = 50

/** Age after which a remounted card re-reads its data (no skeleton). */
export const STALE_MS = 60_000

export type ChatVideoEntry =
  | { status: 'loading' }
  | { status: 'ready'; item: FeedItem; at: number }
  | { status: 'unknown'; at: number }
  | { status: 'error'; error: ApiError; at: number }

export const $chatVideos = atom<Readonly<Record<string, ChatVideoEntry>>>({})

/** Optimistic layer per video (state/reaction the screen shows before the reply). */
export interface ChatLayer {
  state?: VideoState
  reaction?: Reaction | null
}
export const $chatOverlay = atom<Readonly<Record<string, ChatLayer>>>({})

const pending = new Set<string>()
const inFlight = new Set<string>()
let scheduled = false
/** Changes on unload: a reply from before the unload does not write to the new cache. */
let generation = 0

onShellReset(() => {
  generation++
  pending.clear()
  inFlight.clear()
  scheduled = false
  $chatVideos.set({})
  $chatOverlay.set({})
})

function patch(next: Record<string, ChatVideoEntry>): void {
  $chatVideos.set({ ...$chatVideos.get(), ...next })
}

async function fetchChunk(ids: string[]): Promise<void> {
  const gen = generation
  const now = Date.now()
  try {
    const data = await restCall('GET /videos', { query: { ids: ids.join(',') } })
    if (gen !== generation) return
    const found = new Map<string, FeedItem>()
    for (const it of data?.items ?? []) if (it?.video?.id) found.set(it.video.id, it)
    const next: Record<string, ChatVideoEntry> = {}
    for (const id of ids) {
      const it = found.get(id)
      next[id] = it ? { status: 'ready', item: it, at: now } : { status: 'unknown', at: now }
    }
    patch(next)
  } catch (error) {
    if (gen !== generation) return
    const err = toApiError(error)
    const current = $chatVideos.get()
    const next: Record<string, ChatVideoEntry> = {}
    // a silent re-read that fails does not erase what was already on screen (error only for those with no data)
    for (const id of ids) if (current[id]?.status !== 'ready') next[id] = { status: 'error', error: err, at: now }
    patch(next)
  } finally {
    if (gen === generation) for (const id of ids) inFlight.delete(id)
  }
}

function flushPending(): void {
  scheduled = false
  const ids = [...pending].filter((id) => !inFlight.has(id))
  pending.clear()
  for (const id of ids) inFlight.add(id)
  for (let i = 0; i < ids.length; i += BATCH_MAX) void fetchChunk(ids.slice(i, i + BATCH_MAX))
}

/**
 * Schedules the read of the ids (one batch per render). `silent`: keeps what is on screen (re-read);
 * otherwise the card goes to `loading`.
 */
export function requestChatVideos(ids: readonly string[], options: { silent?: boolean } = {}): void {
  const fresh = ids.filter((id) => !inFlight.has(id) && !pending.has(id))
  if (!fresh.length) return
  if (!options.silent) {
    const next: Record<string, ChatVideoEntry> = {}
    for (const id of fresh) next[id] = { status: 'loading' }
    patch(next)
  }
  for (const id of fresh) pending.add(id)
  if (!scheduled) {
    scheduled = true
    queueMicrotask(flushPending)
  }
}

/** Retry: every card in error goes back to loading in one batch. */
export function retryFailedChatVideos(): void {
  const failed = Object.entries($chatVideos.get())
    .filter(([, e]) => e.status === 'error')
    .map(([id]) => id)
  requestChatVideos(failed)
}

/** Video entry in the cache; requests (or re-reads, if stale) on mount. */
export function useChatVideo(id: string): ChatVideoEntry {
  const all = useValue($chatVideos)
  const entry = all[id]
  useEffect(() => {
    const current = $chatVideos.get()[id]
    if (!current) requestChatVideos([id])
    else if (current.status !== 'loading' && Date.now() - current.at > STALE_MS) requestChatVideos([id], { silent: current.status === 'ready' })
  }, [id])
  return entry ?? { status: 'loading' }
}

export function setChatLayer(id: string, layer: ChatLayer | undefined): void {
  const next = { ...$chatOverlay.get() }
  if (layer && Object.keys(layer).length) next[id] = layer
  else delete next[id]
  $chatOverlay.set(next)
}

/** The item with the optimistic layer applied. */
export function applyLayer(item: FeedItem, layer: ChatLayer | undefined): FeedItem {
  if (!layer) return item
  const state = layer.state ?? item.state
  return {
    ...item,
    state,
    reaction: layer.reaction !== undefined ? layer.reaction : item.reaction,
    is_new: item.is_new && state === 'new'
  }
}

export function useChatLayer(id: string): ChatLayer | undefined {
  return useValue($chatOverlay)[id]
}
