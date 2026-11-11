// Panel actions, all OPTIMISTIC: a local layer changes the tree at once, the route writes, the toast offers
// "Undo" (the inverse route with the previous value). Failure → the layer goes away (back to what the server says)
// and the toast says why. After success, the layer only goes away once the new data has arrived (nothing flickers
// or jumps).
//   move channel     PATCH /channels/{id} {folder_id}       favorite/mute        PATCH /channels/{id}
//   move folder      PATCH /folders/{id} {parent_id}        mark as read         POST /read + undo through history
import { host } from '@hermes/plugin-sdk'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Channel, Folder, ReadScope } from '../../shared/api-types'
import { type Translate, errorText } from '../lib/i18n'
import { invalidateRest, restCall, toApiError } from '../lib/rest'

/** How long the toast with "Undo" stays. */
export const UNDO_MS = 7000

type ChannelField = 'folder_id' | 'favorite' | 'muted'

interface Layer {
  value: unknown
  token: number
}

export interface Overlay {
  /** `c:<id>:<field>` / `f:<id>:parent_id` → optimistic value. */
  fields: Readonly<Record<string, Layer>>
  /** Mark as read in progress: channels zeroed (or everything). */
  readAll: boolean
  read: ReadonlySet<string>
}

const channelKey = (id: string, field: ChannelField) => `c:${id}:${field}`
const folderKey = (id: string) => `f:${id}:parent_id`

/** Server data + optimistic layer. */
export function applyOverlay(folders: readonly Folder[], channels: readonly Channel[], overlay: Overlay): { folders: Folder[]; channels: Channel[] } {
  const f = overlay.fields
  if (!Object.keys(f).length) return { folders: [...folders], channels: [...channels] }
  const out = {
    folders: folders.map((x) => {
      const l = f[folderKey(x.id)]
      return l ? { ...x, parent_id: l.value as string | null } : x
    }),
    channels: channels.map((c) => {
      let next = c
      for (const field of ['folder_id', 'favorite', 'muted'] as const) {
        const l = f[channelKey(c.id, field)]
        if (l) next = { ...next, [field]: l.value }
      }
      return next
    })
  }
  return out
}

/** New per channel with the "read" layer applied. */
export function readAdjusted(byChannel: Readonly<Record<string, number>> | null | undefined, overlay: Overlay): Record<string, number> | null {
  if (!byChannel) return null
  if (!overlay.readAll && !overlay.read.size) return { ...byChannel }
  const out: Record<string, number> = {}
  for (const [id, n] of Object.entries(byChannel)) out[id] = overlay.readAll || overlay.read.has(id) ? 0 : n
  return out
}

const REFRESH_ROUTES = ['GET /channels', 'GET /folders', 'GET /state', 'GET /status', 'GET /feed'] as const

function refresh(): Promise<void> {
  return invalidateRest(...REFRESH_ROUTES).catch(() => undefined)
}

/** `mark_read` entries written since `sinceTs` (to undo through history; `POST /read` does not return the id). */
async function markReadChanges(sinceTs: number): Promise<number[]> {
  const { items } = await restCall('GET /changes', { query: { limit: 20 } })
  return items.filter((c) => c.action === 'mark_read' && c.undone_at == null && c.ts >= sinceTs).slice(0, 1).map((c) => c.id)
}

export interface ChangeSpec<T> {
  key: string
  before: T
  after: T
  send: (value: T) => Promise<unknown>
  message: string
}

export function usePaneActions(t: Translate, tc: Translate) {
  const [fields, setFields] = useState<Record<string, Layer>>({})
  const [reads, setReads] = useState<Record<number, readonly string[] | 'all'>>({})
  const token = useRef(0)

  const put = useCallback((key: string, value: unknown): number => {
    const tk = ++token.current
    setFields((f) => ({ ...f, [key]: { value, token: tk } }))
    return tk
  }, [])

  /** Removes the layer only if it still belongs to this action (a newer action on the same field stays in effect). */
  const settle = useCallback((key: string, tk: number) => {
    setFields((f) => {
      if (f[key]?.token !== tk) return f
      const next = { ...f }
      delete next[key]
      return next
    })
  }, [])

  const fail = useCallback(
    (msg: string, error: unknown) => host.notify({ kind: 'error', message: t(msg, { error: errorText(tc, toApiError(error)) }) }),
    [t, tc]
  )

  /** Changes a field with an optimistic response, a toast with undo, and rolls back on failure. */
  const change = useCallback(
    <T>(spec: ChangeSpec<T>) => {
      const tk = put(spec.key, spec.after)
      spec.send(spec.after).then(
        async () => {
          await refresh()
          settle(spec.key, tk)
          host.notify({
            kind: 'success',
            message: spec.message,
            durationMs: UNDO_MS,
            action: {
              label: t('toast.undo'),
              onClick: () => {
                const tu = put(spec.key, spec.before)
                spec.send(spec.before).then(
                  async () => {
                    await refresh()
                    settle(spec.key, tu)
                  },
                  (error: unknown) => {
                    // the server keeps the new value: without the layer, the tree shows that
                    settle(spec.key, tu)
                    fail('toast.undo_failed', error)
                  }
                )
              }
            }
          })
        },
        (error: unknown) => {
          settle(spec.key, tk)
          fail('toast.failed', error)
        }
      )
    },
    [put, settle, fail, t]
  )

  const moveChannel = useCallback(
    (c: Channel, folderId: string | null, message: string) =>
      change<string | null>({
        key: channelKey(c.id, 'folder_id'),
        before: c.folder_id,
        after: folderId,
        send: (v) => restCall('PATCH /channels/{id}', { path: { id: c.id }, body: { folder_id: v } }),
        message
      }),
    [change]
  )

  const moveFolder = useCallback(
    (f: Folder, parentId: string | null, message: string) =>
      change<string | null>({
        key: folderKey(f.id),
        before: f.parent_id,
        after: parentId,
        send: (v) => restCall('PATCH /folders/{id}', { path: { id: f.id }, body: { parent_id: v } }),
        message
      }),
    [change]
  )

  const setFlag = useCallback(
    (c: Channel, field: 'favorite' | 'muted', value: boolean, message: string) =>
      change<boolean>({
        key: channelKey(c.id, field),
        before: c[field],
        after: value,
        send: (v) => restCall('PATCH /channels/{id}', { path: { id: c.id }, body: { [field]: v } }),
        message
      }),
    [change]
  )

  /** Mark as read: the scope's counters vanish at once; undo through history (`mark_read`). */
  const markRead = useCallback(
    (scope: ReadScope, channelIds: readonly string[], messages: { done: string; nothing: string }) => {
      const op = ++token.current
      const drop = () =>
        setReads((r) => {
          const next = { ...r }
          delete next[op]
          return next
        })
      setReads((r) => ({ ...r, [op]: scope.kind === 'all' ? 'all' : channelIds }))
      const since = Math.floor(Date.now() / 1000) - 2
      restCall('POST /read', { body: scope }).then(
        async (res) => {
          await refresh()
          drop()
          if (!res.changed) {
            host.notify({ kind: 'info', message: messages.nothing })
            return
          }
          let undoIds: number[] = []
          try {
            undoIds = await markReadChanges(since)
          } catch {
            undoIds = []
          }
          host.notify({
            kind: 'success',
            message: messages.done,
            durationMs: UNDO_MS,
            ...(undoIds.length
              ? {
                  action: {
                    label: t('toast.undo'),
                    onClick: () => {
                      Promise.all(undoIds.map((id) => restCall('POST /changes/{id}/undo', { path: { id } }))).then(
                        () => refresh(),
                        (error: unknown) => fail('toast.undo_failed', error)
                      )
                    }
                  }
                }
              : {})
          })
        },
        (error: unknown) => {
          drop()
          fail('toast.failed', error)
        }
      )
    },
    [fail, t]
  )

  const overlay = useMemo<Overlay>(() => {
    const all = Object.values(reads)
    const read = new Set<string>()
    for (const r of all) if (r !== 'all') for (const id of r) read.add(id)
    return { fields, readAll: all.includes('all'), read }
  }, [fields, reads])

  return { overlay, moveChannel, moveFolder, setFlag, markRead }
}
