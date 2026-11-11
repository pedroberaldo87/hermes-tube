// Quick Home actions, all OPTIMISTIC: the screen changes right away (local layer per video), the route saves
// (`POST /videos/state`), the toast offers "Undo" (which calls the inverse route with the previous state). Failure →
// the layer goes back to what it was and the toast says why (contract code translated). The feed is not reloaded
// after each action (the watched card keeps its veil, the archived one disappears without a jump); only `/status` (counters).
import { host } from '@hermes/plugin-sdk'
import { useCallback, useRef, useState } from 'react'
import type { FeedItem, ReadScope, Tab } from '../../../shared/api-types'
import { type Translate, errorText } from '../../lib/i18n'
import { invalidateRest, restCall, toApiError } from '../../lib/rest'
import { type PriorMemory, type VideoAction, type VideoChange as Change, type VideoLayer as Layer, asLayer, planVideoAction } from '../../lib/video-actions'

// the on/off rule (with the memory of the state before) is shared by Home and chat
export { type VideoAction, VIDEO_ACTIONS, changeFor, isVideoAction } from '../../lib/video-actions'

/** Duration of the toast with "Undo". */
export const UNDO_MS = 7000

type Overlay = Record<string, Layer>

export function useVideoActions(t: Translate, tc: Translate) {
  const [overlay, setOverlay] = useState<Overlay>({})
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay

  const view = useCallback(
    (item: FeedItem): FeedItem => {
      const l = overlay[item.video.id]
      if (!l) return item
      const state = l.state ?? item.state
      return {
        ...item,
        state,
        reaction: l.reaction !== undefined ? l.reaction : item.reaction,
        // going back to `new` here (undo) is new again, even if the feed has already arrived with the video watched
        // (if the feed says `new` but not fresh — already read by the watermark —, it stays not fresh)
        is_new: state !== 'new' ? false : item.state === 'new' ? item.is_new : l.state === 'new'
      }
    },
    [overlay]
  )

  const isHidden = useCallback((item: FeedItem) => overlay[item.video.id]?.state === 'archived', [overlay])

  const setLayer = (id: string, layer: Layer | undefined) =>
    setOverlay((o) => {
      const next = { ...o }
      if (layer && Object.keys(layer).length) next[id] = layer
      else delete next[id]
      return next
    })

  const send = (id: string, change: Change) => restCall('POST /videos/state', { body: { video_ids: [id], ...change } })

  const fail = (key: string, error: unknown) =>
    host.notify({ kind: 'error', message: t(key, { error: errorText(tc, toApiError(error)) }) })

  /** State before turning on each action (per video): turning off goes back to it, not to `seen`. */
  const priorRef = useRef<PriorMemory>(new Map())

  const run = useCallback(
    (action: VideoAction, raw: FeedItem) => {
      const id = raw.video.id
      const prevLayer = overlayRef.current[id]
      const current = view(raw)
      const { change, toast, inverse, restore } = planVideoAction(priorRef.current, action, id, current)
      const applied = { ...prevLayer, ...asLayer(change) }
      setLayer(id, applied)
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
                setLayer(id, { ...applied, ...asLayer(inverse) })
                send(id, inverse).then(
                  () => void invalidateRest('GET /status'),
                  (error: unknown) => {
                    setLayer(id, applied)
                    fail('toast.undo_failed', error)
                  }
                )
              }
            }
          })
        },
        (error: unknown) => {
          setLayer(id, prevLayer)
          restore()
          fail('toast.failed', error)
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, t, tc]
  )

  return { view, isHidden, run }
}

// ------------------------------------------------------------------ mark the tab as read

/**
 * Does the tab offer "mark as read"? It needs channels (folder, tag, ⭐, channel, everything): theme/lens tabs have no
 * watermark, and `POST /read {kind: 'tab'}` answers `invalid` for a theme tab and for "Watch later" (which is not a tab).
 */
export function canMarkRead(tab: Tab | null | undefined): boolean {
  if (!tab || tab.kind === 'theme') return false
  const inc = tab.rules?.include
  if (!inc) return false
  return !!(inc.all || inc.favorites || inc.folders?.length || inc.channels?.length || inc.tags?.length)
}

/** Scope of the tab's `POST /read`: the server resolves the channels the tab shows (⭐, tags, exclusions). */
export function readScopeOf(tab: Tab): ReadScope {
  return { kind: 'tab', id: tab.id }
}

export function useMarkRead(t: Translate, tc: Translate) {
  /** Tabs (or pane filters) marked as read in this session (optimistic: cards without "new", counter disappears). */
  const [read, setRead] = useState<ReadonlySet<string>>(new Set())

  /** `key` = tab id on screen; `scope` = what `POST /read` marks; `label` = name in the toast. */
  const mark = (key: string, scope: ReadScope, label: string) => {
    const add = () => setRead((s) => new Set(s).add(key))
    const drop = () =>
      setRead((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    add()
    // `change_ids=true`: the response carries the history entries written by THIS marking → exact undo
    restCall('POST /read', { query: { change_ids: true }, body: scope })
      .then((result) => {
        void invalidateRest('GET /status')
        if (!(result.changed > 0)) {
          host.notify({ kind: 'info', message: t('toast.read_nothing') })
          return
        }
        const undoIds = result.change_ids ?? []
        host.notify({
          kind: 'success',
          message: t('toast.read', { tab: label }),
          durationMs: UNDO_MS,
          ...(undoIds.length
            ? {
                action: {
                  label: t('toast.undo'),
                  onClick: () => {
                    drop()
                    Promise.all(undoIds.map((id) => restCall('POST /changes/{id}/undo', { path: { id } }))).then(
                      () => void invalidateRest('GET /status', 'GET /feed'),
                      (error: unknown) => {
                        add()
                        host.notify({ kind: 'error', message: t('toast.undo_failed', { error: errorText(tc, toApiError(error)) }) })
                      }
                    )
                  }
                }
              }
            : {})
        })
      })
      .catch((error: unknown) => {
        drop()
        host.notify({ kind: 'error', message: t('toast.failed', { error: errorText(tc, toApiError(error)) }) })
      })
  }

  return { read, mark }
}
