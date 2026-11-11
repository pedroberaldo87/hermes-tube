// Actions of the Watch screen: the same as the card (Watched, Watch later, Archive, Like, Dislike), with the
// same on/off and undo rule as Home and chat (`lib/video-actions`): the optimistic layer changes at
// once, `POST /videos/state` persists, the toast offers "Undo" with the exact inverse; on failure the layer rolls back and the
// toast says why. The layer is per video and lives as long as the plugin: switching video via "Up next" and
// coming back shows what was already done. After persisting, the feed is re-read (Home, in another tab, follows).
import { atom, host, useValue } from '@hermes/plugin-sdk'
import type { FeedItem } from '../../../shared/api-types'
import { type Translate, errorText } from '../../lib/i18n'
import { onShellReset } from '../../lib/lifecycle'
import { invalidateRest, restCall, toApiError } from '../../lib/rest'
import { type PriorMemory, type VideoAction, type VideoChange, type VideoLayer, asLayer, planVideoAction } from '../../lib/video-actions'

export { type VideoAction, VIDEO_ACTIONS, isVideoAction } from '../../lib/video-actions'

/** How long the toast with "Undo" stays up (the same as Home and chat). */
export const UNDO_MS = 7000

/** Action shortcuts (Home's: w · l · e · u · d). */
export const ACTION_KEYS: Readonly<Record<string, VideoAction>> = { w: 'watched', l: 'later', e: 'archive', u: 'up', d: 'down' }

/** Navigation shortcuts in "Up next". */
export const NAV_KEYS: Readonly<Record<string, 'next' | 'prev'>> = { n: 'next', j: 'next', arrowright: 'next', p: 'prev', k: 'prev', arrowleft: 'prev' }

export const $watchOverlay = atom<Readonly<Record<string, VideoLayer>>>({})
const priors: PriorMemory = new Map()

onShellReset(() => {
  $watchOverlay.set({})
  priors.clear()
})

function setLayer(id: string, layer: VideoLayer | undefined): void {
  const next = { ...$watchOverlay.get() }
  if (layer && Object.keys(layer).length) next[id] = layer
  else delete next[id]
  $watchOverlay.set(next)
}

/** The item with the optimistic layer on top (the server has not answered yet). */
export function applyWatchLayer(item: FeedItem, layer: VideoLayer | undefined): FeedItem {
  if (!layer) return item
  const state = layer.state ?? item.state
  return {
    ...item,
    state,
    reaction: layer.reaction !== undefined ? layer.reaction : item.reaction,
    is_new: state !== 'new' ? false : item.state === 'new' ? item.is_new : layer.state === 'new'
  }
}

export function useWatchOverlay(): Readonly<Record<string, VideoLayer>> {
  return useValue($watchOverlay)
}

const send = (id: string, change: VideoChange) => restCall('POST /videos/state', { body: { video_ids: [id], ...change } })

function refreshAfterWrite(): void {
  void invalidateRest('GET /status', 'GET /feed', 'POST /feed/preview')
}

/** Runs the action on the video. `t` = `watch` namespace (toasts); `tc` = `common` (contract errors). */
export function runWatchAction(action: VideoAction, raw: FeedItem, t: Translate, tc: Translate): void {
  const id = raw.video.id
  const prevLayer = $watchOverlay.get()[id]
  const current = applyWatchLayer(raw, prevLayer)
  const { change, toast, inverse, restore } = planVideoAction(priors, action, id, current)
  const applied: VideoLayer = { ...prevLayer, ...asLayer(change) }
  const fail = (key: string, error: unknown) => host.notify({ kind: 'error', message: t(key, { error: errorText(tc, toApiError(error)) }) })
  setLayer(id, applied)
  send(id, change).then(
    () => {
      refreshAfterWrite()
      host.notify({
        kind: 'success',
        message: t(toast),
        durationMs: UNDO_MS,
        action: {
          label: t('toast.undo'),
          onClick: () => {
            setLayer(id, { ...applied, ...asLayer(inverse) })
            send(id, inverse).then(refreshAfterWrite, (error: unknown) => {
              setLayer(id, applied)
              fail('toast.undo_failed', error)
            })
          }
        }
      })
    },
    (error: unknown) => {
      // only undo the layer if nobody touched it since (another click is already the screen's truth)
      if ($watchOverlay.get()[id] === applied) {
        setLayer(id, prevLayer)
        restore()
      }
      fail('toast.failed', error)
    }
  )
}

/** Key with no modifier, not repeated, outside a text field (lowercase); otherwise `null`. */
export function plainKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat?: boolean; target: EventTarget | null }): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))) return null
  return e.key.toLowerCase()
}
