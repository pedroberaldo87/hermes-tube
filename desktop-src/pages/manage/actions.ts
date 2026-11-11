// Manage actions, all OPTIMISTIC: the table changes right away (local layer per channel), the route saves, the toast brings
// "Undo". After success, the layer only leaves once the new data has arrived (nothing flickers); on failure, it leaves right away.
//   batch         POST /channels/batch (atomic) → undo = POST /changes/{change_id}/undo
//   row           PATCH /channels/{id} (⭐, folder, tags) → undo = inverse PATCH (the route returns no change_id);
//                 the error stays ON THE ROW (the table carries on)
//   read          POST /read?change_ids=true, one per channel (ReadScope only accepts one id) → undo by the ids
//   folders/tags  POST /folders, PATCH /folders/{id}, POST /tags
import { host } from '@hermes/plugin-sdk'
import { useCallback, useRef, useState } from 'react'
import type { BatchOp, Channel, ChannelPatchBody, ChannelRow, Folder, Tag } from '../../../shared/api-types'
import { type Translate, errorText } from '../../lib/i18n'
import { invalidateRest, restCall, toApiError } from '../../lib/rest'

/** Duration of the toast with "Undo". */
export const UNDO_MS = 7000

/** "Mark as read" requests in parallel. */
const READ_CONCURRENCY = 4

const REFRESH = ['GET /channels', 'GET /state', 'GET /status'] as const

export type Plural = (key: string, count: number, vars?: Record<string, string | number>) => string

/** Name of the freshly created folder/tag (the list has not arrived yet). */
export interface BatchLabels {
  folder?: string
  tag?: string
}

interface Layer {
  patch: Partial<Channel>
  token: number
}

export interface ActionDeps {
  t: Translate
  tc: Translate
  plural: Plural
  /** Current row (with the local layer) of an id. */
  current: (id: string) => ChannelRow | undefined
  folderName: (id: string | null) => string
  tagName: (id: string) => string
}

/** What the operation changes on a channel (for the optimistic layer). */
function patchFor(op: BatchOp, c: Channel, value: string | null | undefined): Partial<Channel> {
  switch (op) {
    case 'move':
      return { folder_id: value ?? null }
    case 'favorite':
    case 'unfavorite':
      return { favorite: op === 'favorite' }
    case 'mute':
    case 'unmute':
      return { muted: op === 'mute' }
    case 'tag':
      return value && !c.tag_ids.includes(value) ? { tag_ids: [...c.tag_ids, value] } : {}
    case 'untag':
      return { tag_ids: c.tag_ids.filter((x) => x !== value) }
    case 'follow':
      return { relation: 'followed' }
    case 'ignore':
      return { relation: 'ignored' }
  }
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { ok: true, value: await fn(items[i]) }
      } catch (error) {
        out[i] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

export function useManageActions(deps: ActionDeps) {
  const depsRef = useRef(deps)
  depsRef.current = deps
  const [overlay, setOverlay] = useState<Record<string, Layer>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const seq = useRef(0)

  const push = (patches: Record<string, Partial<Channel>>): number => {
    const token = ++seq.current
    setOverlay((o) => {
      const next = { ...o }
      for (const [id, patch] of Object.entries(patches)) next[id] = { patch: { ...o[id]?.patch, ...patch }, token }
      return next
    })
    return token
  }

  /** Removes the layer from the ids — only if nobody put another on top afterwards. */
  const drop = (ids: readonly string[], token: number) =>
    setOverlay((o) => {
      let changed = false
      const next = { ...o }
      for (const id of ids)
        if (next[id] && next[id].token === token) {
          delete next[id]
          changed = true
        }
      return changed ? next : o
    })

  const setError = (id: string, message: string | null) =>
    setErrors((e) => {
      if (message === null && !(id in e)) return e
      const next = { ...e }
      if (message === null) delete next[id]
      else next[id] = message
      return next
    })

  const view = useCallback(
    (row: ChannelRow): ChannelRow => {
      const l = overlay[row.channel.id]
      return l ? { ...row, channel: { ...row.channel, ...l.patch } } : row
    },
    [overlay]
  )

  const fail = (key: string, error: unknown) => {
    const { t, tc } = depsRef.current
    host.notify({ kind: 'error', message: t(key, { error: errorText(tc, toApiError(error)) }) })
  }

  const refresh = () => invalidateRest(...REFRESH)

  const undoChanges = useCallback(async (ids: readonly number[]) => {
    const { t } = depsRef.current
    try {
      for (const id of ids) await restCall('POST /changes/{id}/undo', { path: { id } })
      await refresh()
      host.notify({ kind: 'info', message: t('toast.undone') })
    } catch (error) {
      await refresh()
      fail('toast.undo_failed', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Toast message of a batch. */
  const batchMessage = (op: BatchOp, ids: readonly string[], value: string | null | undefined, labels: BatchLabels): string => {
    const { plural, current, folderName, tagName } = depsRef.current
    const name = ids.length === 1 ? (current(ids[0])?.channel.title ?? '') : ''
    switch (op) {
      case 'move':
        return value
          ? plural('toast.move', ids.length, { name, folder: labels.folder ?? folderName(value) })
          : plural('toast.move_none', ids.length, { name })
      case 'tag':
      case 'untag':
        return plural(`toast.${op}`, ids.length, { name, tag: labels.tag ?? (value ? tagName(value) : '') })
      default:
        return plural(`toast.${op}`, ids.length, { name })
    }
  }

  const batch = useCallback(async (op: BatchOp, ids: readonly string[], value?: string | null, labels: BatchLabels = {}) => {
    if (!ids.length) return
    const { t, current } = depsRef.current
    const patches: Record<string, Partial<Channel>> = {}
    for (const id of ids) {
      const row = current(id)
      if (row) patches[id] = patchFor(op, row.channel, value)
    }
    const token = push(patches)
    const withValue = op === 'move' || op === 'tag' || op === 'untag'
    try {
      const out = await restCall('POST /channels/batch', {
        body: { op, channel_ids: [...ids], ...(withValue ? { value: value ?? null } : {}) }
      })
      const changeId = out.batch?.change_id ?? null
      if (!out.batch || !out.batch.changed.length || changeId === null) {
        host.notify({ kind: 'info', message: t('toast.nothing') })
      } else {
        host.notify({
          kind: 'success',
          message: batchMessage(op, ids, value, labels),
          durationMs: UNDO_MS,
          action: { label: t('toast.undo'), onClick: () => void undoChanges([changeId]) }
        })
      }
      for (const id of ids) setError(id, null)
      await refresh()
      drop(ids, token)
    } catch (error) {
      drop(ids, token)
      fail('toast.failed', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Edit of a row (⭐, folder, tags). `inverse` = the PATCH that undoes it. */
  const patch = useCallback(async (id: string, body: ChannelPatchBody, inverse: ChannelPatchBody, message: string | null) => {
    const { t, tc } = depsRef.current
    const token = push({ [id]: body as Partial<Channel> })
    setError(id, null)
    try {
      await restCall('PATCH /channels/{id}', { path: { id }, body })
      if (message)
        host.notify({
          kind: 'success',
          message,
          durationMs: UNDO_MS,
          action: {
            label: t('toast.undo'),
            onClick: () => {
              const back = push({ [id]: inverse as Partial<Channel> })
              restCall('PATCH /channels/{id}', { path: { id }, body: inverse }).then(
                async () => {
                  await refresh()
                  drop([id], back)
                },
                (error: unknown) => {
                  drop([id], back)
                  fail('toast.undo_failed', error)
                }
              )
            }
          }
        })
      await refresh()
      drop([id], token)
    } catch (error) {
      drop([id], token)
      setError(id, t('row_error', { error: errorText(tc, toApiError(error)) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markRead = useCallback(async (ids: readonly string[]) => {
    if (!ids.length) return
    const { t, tc, plural, current } = depsRef.current
    const results = await pool(ids, READ_CONCURRENCY, (id) =>
      restCall('POST /read', { query: { change_ids: true }, body: { kind: 'channel', id } })
    )
    const changeIds: number[] = []
    let channels = 0
    let failed = 0
    let firstError: unknown = null
    for (const r of results) {
      if (!r.ok) {
        failed++
        firstError ??= r.error
        continue
      }
      if (r.value.changed > 0) channels++
      changeIds.push(...(r.value.change_ids ?? []))
    }
    void invalidateRest('GET /status', 'GET /state', 'GET /feed')
    if (failed) {
      host.notify({ kind: 'error', message: t('toast.read_partial', { count: failed, error: errorText(tc, toApiError(firstError)) }) })
    }
    if (!channels) {
      if (!failed) host.notify({ kind: 'info', message: t('toast.read_nothing') })
      return
    }
    const name = ids.length === 1 ? (current(ids[0])?.channel.title ?? '') : ''
    host.notify({
      kind: 'success',
      message: plural('toast.read', channels, { name }),
      durationMs: UNDO_MS,
      ...(changeIds.length ? { action: { label: t('toast.undo'), onClick: () => void undoChanges(changeIds) } } : {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createFolder = useCallback(async (name: string, notify = false): Promise<Folder | null> => {
    const { t } = depsRef.current
    try {
      const folder = await restCall('POST /folders', { body: { name } })
      await invalidateRest('GET /folders')
      if (notify) host.notify({ kind: 'success', message: t('toast.folder_created', { name: folder.name }) })
      return folder
    } catch (error) {
      fail('toast.failed', error)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { t } = depsRef.current
    try {
      const folder = await restCall('PATCH /folders/{id}', { path: { id }, body: { name } })
      await invalidateRest('GET /folders')
      host.notify({ kind: 'success', message: t('toast.folder_renamed', { name: folder.name }) })
    } catch (error) {
      fail('toast.failed', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createTag = useCallback(async (name: string): Promise<Tag | null> => {
    try {
      const tag = await restCall('POST /tags', { body: { name } })
      await invalidateRest('GET /tags')
      return tag
    } catch (error) {
      fail('toast.failed', error)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { view, errors, batch, patch, markRead, createFolder, renameFolder, createTag, clearError: (id: string) => setError(id, null) }
}

export type ManageActions = ReturnType<typeof useManageActions>
