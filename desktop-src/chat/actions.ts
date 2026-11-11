// Quick actions on the chat card, all OPTIMISTIC: the video overlay changes immediately (every card of
// the same video together), `POST /videos/state` persists, and the toast offers "Undo" (inverse route with
// the exact previous state). On failure the overlay rolls back and the toast says why (contract code translated).
// "Watch later" and "Watched" toggle as on Home (`lib/video-actions`): turning off restores the state from BEFORE
// turning on (a new video goes back to new); with no memory (it came that way from the server), to `seen`. "Open" goes through `ctx.os`.
import { host } from '@hermes/plugin-sdk'
import type { FeedItem } from '../../shared/api-types'
import { openVideo } from '../lib/format'
import { type Translate, errorText } from '../lib/i18n'
import { onShellReset } from '../lib/lifecycle'
import { invalidateRest, restCall, toApiError } from '../lib/rest'
import { type PriorMemory, type VideoChange as Change, asLayer, planVideoAction } from '../lib/video-actions'
import { $chatOverlay, type ChatLayer, applyLayer, setChatLayer } from './videos'

export type ChatAction = 'later' | 'watched' | 'open'

/** Shortcuts for the focused card (same letters as Home: l, w; `o` opens). */
export const CHAT_SHORTCUTS: Readonly<Record<string, ChatAction>> = { l: 'later', w: 'watched', o: 'open' }

/** How long the toast with "Undo" stays up. */
export const UNDO_MS = 7000

/** State from before each action was turned on, per video (all cards of the same video together); cleared on unload. */
const priors: PriorMemory = new Map()
onShellReset(() => priors.clear())

const send = (id: string, change: Change) => restCall('POST /videos/state', { body: { video_ids: [id], ...change } })

/**
 * Runs the action on the video. `t` = translator for the `chat` namespace; `tc` = `common` (error messages).
 * `raw` is the server item (no overlay): the current overlay is read from the atom at click time.
 */
export function runChatAction(action: ChatAction, raw: FeedItem, t: Translate, tc: Translate): void {
  const id = raw.video.id
  if (action === 'open') {
    openVideo(id)
    return
  }
  const prevLayer = $chatOverlay.get()[id]
  const current = applyLayer(raw, prevLayer)
  const { change, toast, inverse, restore } = planVideoAction(priors, action, id, current)
  const applied: ChatLayer = { ...prevLayer, ...asLayer(change) }
  const fail = (key: string, error: unknown) => host.notify({ kind: 'error', message: t(key, { error: errorText(tc, toApiError(error)) }) })
  setChatLayer(id, applied)
  send(id, change).then(
    () => {
      void invalidateRest('GET /status')
      host.notify({
        kind: 'success',
        message: t(toast),
        durationMs: UNDO_MS,
        action: {
          label: t('toast.undo'),
          onClick: () => {
            const undone: ChatLayer = { ...applied, ...asLayer(inverse) }
            setChatLayer(id, undone)
            send(id, inverse).then(
              () => void invalidateRest('GET /status'),
              (error: unknown) => {
                setChatLayer(id, applied)
                fail('toast.undo_failed', error)
              }
            )
          }
        }
      })
    },
    (error: unknown) => {
      // only undo the overlay if nobody touched it since (another click is already the screen's truth)
      if ($chatOverlay.get()[id] === applied) {
        setChatLayer(id, prevLayer)
        restore()
      }
      fail('toast.failed', error)
    }
  )
}

/** Key → action, or `null` (with a modifier, repeated, or from a text field: nothing). */
export function shortcutFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat?: boolean; target: EventTarget | null }): ChatAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return null
  return CHAT_SHORTCUTS[e.key.toLowerCase()] ?? null
}
