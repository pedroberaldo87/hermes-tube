// Cleanup actions, all optimistic and with undo:
//  - approve/resubscribe: ONLY `callRpc('cleanup.approve' | 'cleanup.resubscribe')` (native Desktop credential;
//    never REST). Channels go into the queue right away (local items) and come back if the RPC refuses.
//  - undo approval: `POST /queue/undo` (REST, safe rollback). `undo_refused`/`already_executed` → message
//    "already executed — use Resubscribe".
//  - "Keep": disappears right away; `POST /cleanup/dismiss` only goes out when the toast with "Undo" ends (there is no
//    route that undoes a dismissal). Leaving the screen saves whatever was pending.
import { host } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError, QueueAction, QueueItem } from '../../../shared/api-types'
import { MESSAGE_KEYS } from '../../../shared/ids'
import { type Translate, errorText } from '../../lib/i18n'
import { invalidateRest, restCall, toApiError } from '../../lib/rest'
import { callRpc } from '../../lib/rpc'
import { UNDO_MS, localItem } from './model'

/** Undo error text: already executed has its own message (with the way out: Resubscribe). */
export function undoErrorText(tc: Translate, error: ApiError): string {
  if (error.code === 'undo_refused' && error.reason === MESSAGE_KEYS.alreadyExecuted) return tc(MESSAGE_KEYS.alreadyExecuted)
  return errorText(tc, error)
}

const without = (set: ReadonlySet<string>, ids: readonly string[]) => {
  const next = new Set(set)
  for (const id of ids) next.delete(id)
  return next
}

const withAll = (set: ReadonlySet<string>, ids: readonly string[]) => {
  const next = new Set(set)
  for (const id of ids) next.add(id)
  return next
}

// ------------------------------------------------------------------ queue: approve, resubscribe, undo

export type RequestOutcome = { kind: 'ok'; items: QueueItem[] } | { kind: 'error'; error: ApiError } | { kind: 'unavailable' }

export function useQueueActions(t: Translate, tc: Translate, fmt: (n: number) => string) {
  /** Items the screen knows about before the server (optimistic ones and the RPC response). */
  const [local, setLocal] = useState<QueueItem[]>([])
  /** Items undone on screen (they disappear before the response). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  const refresh = () => void invalidateRest('GET /queue', 'GET /cleanup', 'GET /status', 'GET /channels')

  const undo = useCallback(
    (ids: readonly string[]) => {
      const real = ids.filter((id) => !id.startsWith('local:'))
      if (!real.length) return
      setHidden((h) => withAll(h, real))
      restCall('POST /queue/undo', { body: { ids: [...real] } }).then(
        (r) => {
          setLocal((l) => l.filter((it) => !real.includes(it.id)))
          refresh()
          const n = r.items?.length || real.length
          host.notify({ kind: 'success', message: t(`toast.undone_${n === 1 ? 'one' : 'other'}`, { count: fmt(n) }) })
        },
        (error: unknown) => {
          setHidden((h) => without(h, real))
          void invalidateRest('GET /queue')
          host.notify({ kind: 'error', message: t('toast.undo_failed', { error: undoErrorText(tc, toApiError(error)) }) })
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, fmt]
  )

  const request = useCallback(
    async (action: QueueAction, channelIds: readonly string[], toast: (items: QueueItem[]) => string): Promise<RequestOutcome> => {
      const nowS = Math.floor(Date.now() / 1000)
      const placeholders = channelIds.map((id) => localItem(id, action, nowS))
      const ids = new Set(placeholders.map((p) => p.id))
      setLocal((l) => [...l.filter((it) => !ids.has(it.id)), ...placeholders])
      const params = { channel_ids: [...channelIds] }
      const out = action === 'unsubscribe' ? await callRpc('cleanup.approve', params) : await callRpc('cleanup.resubscribe', params)
      if (out.kind !== 'ok') {
        setLocal((l) => l.filter((it) => !ids.has(it.id)))
        return out.kind === 'error' ? { kind: 'error', error: out.error } : { kind: 'unavailable' }
      }
      const items = Array.isArray(out.data?.items) ? out.data.items : []
      setLocal((l) => [...l.filter((it) => !ids.has(it.id)), ...items])
      refresh()
      host.notify({
        kind: 'success',
        message: toast(items),
        durationMs: UNDO_MS,
        action: { label: t('toast.undo'), onClick: () => undo(items.filter((it) => it.status === 'approved').map((it) => it.id)) }
      })
      return { kind: 'ok', items }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, undo]
  )

  return { local, hidden, request, undo }
}

// ------------------------------------------------------------------ "Keep" (dismiss) with undo

interface PendingKeep {
  timer: ReturnType<typeof setTimeout>
  candidateIds: string[]
}

export function useKeep(t: Translate, tc: Translate) {
  /** Channels dismissed on screen (they leave the list right away). */
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set())
  const pending = useRef(new Map<string, PendingKeep>())
  const mounted = useRef(true)

  const release = (channelId: string) => {
    if (mounted.current) setKept((k) => without(k, [channelId]))
  }

  const commit = useCallback(
    (channelId: string) => {
      const entry = pending.current.get(channelId)
      if (!entry) return
      pending.current.delete(channelId)
      clearTimeout(entry.timer)
      restCall('POST /cleanup/dismiss', { body: { ids: entry.candidateIds } }).then(
        // stays hidden until the new list arrives (no flicker back)
        () => invalidateRest('GET /cleanup').finally(() => release(channelId)),
        (error: unknown) => {
          release(channelId)
          host.notify({ kind: 'error', message: t('toast.keep_failed', { error: errorText(tc, toApiError(error)) }) })
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc]
  )

  const keep = useCallback(
    (channelId: string, candidateIds: string[], name: string) => {
      if (pending.current.has(channelId) || !candidateIds.length) return
      setKept((k) => withAll(k, [channelId]))
      const timer = setTimeout(() => commit(channelId), UNDO_MS)
      pending.current.set(channelId, { timer, candidateIds })
      host.notify({
        kind: 'success',
        message: t('toast.kept', { name }),
        durationMs: UNDO_MS,
        action: {
          label: t('toast.undo'),
          onClick: () => {
            const entry = pending.current.get(channelId)
            if (!entry) return
            clearTimeout(entry.timer)
            pending.current.delete(channelId)
            release(channelId)
          }
        }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, commit]
  )

  // leaving the screen saves the dismissals still waiting for the toast (switching language does not count as leaving)
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    mounted.current = true
    const map = pending.current
    return () => {
      mounted.current = false
      for (const id of [...map.keys()]) commitRef.current(id)
    }
  }, [])

  return { kept, keep }
}
