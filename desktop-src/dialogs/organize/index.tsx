// "Organize with Hermes" (dialog `organize`, opened by openDialog('organize', {channelIds?, jobId?}) from
// Manage and ⌘K; registered in main.tsx/DIALOGS). Hundreds of channels get folders.
//
// Flow: opening (how many channels have no folder, what will happen, the model) → `organize.run` (job; lib/jobs
// follows `GET /jobs/{id}` every 2 s, `organize.done` speeds it up) → suggestions appear PER BATCH (on each
// progress signal we re-read `GET /suggestions`) → groups by folder (new one marked) → accept group/channel/all via
// `organize.accept` (optimistic; `edits` when the user changed the folder), reject via `organize.reject` (with 5 s
// to undo before it goes to the server) → "Undo organization" undoes every accept of the session through the
// history (`POST /changes/{id}/undo`, one per group). After applying, `invalidateRest()` makes the pane/Home
// reflect it at once.
// States: loading (skeleton), nothing to organize, no model (leads to settings), a configured model whose provider
// cannot be reached (sign in again or pick another model; same settings path + try again), no RPC, error with retry,
// `busy` (follows the job already running), partial error (retries only the rest), reopen midway (finds the
// active job via `GET /jobs?kind=organize` or receives `jobId`). "No model" is warned before the click
// (`GET /ai/status`, tolerant), a real "Cancel" (`job.cancel`; cancelled is not an error: back to the start and the
// finished batches stay for review) and undo through the accept's `change_ids` (without them, the legacy path through
// `GET /changes`). Channels without a folder come first (groups and rows); a suggestion that keeps the channel in
// its folder and adds nothing is not shown, one that only adds tags says so ("add tag #x"); reopened with stored
// suggestions that leave channels without a folder uncovered, a strip offers to ask only for those.
// Rules: only lib/, components/ and shared/.
import { Button, Codicon, atom, host, useValue } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiError, Channel, OrganizeAcceptParams, OrganizeEdit, Suggestion } from '../../../shared/api-types'
import { DESKTOP_ROUTES, type DialogProps, MESSAGE_KEYS } from '../../../shared/ids'
import { DialogFrame, EmptyView, ErrorView, RpcUnavailableNotice, Stack } from '../../components'
import type { DialogControls } from '../../lib/dialogs'
import { errorText, useT } from '../../lib/i18n'
import { isJobActive, useRpcJob } from '../../lib/jobs'
import { openSection } from '../../lib/nav'
import { TubeApiError, invalidateRest, restCall, toApiError, useRest } from '../../lib/rest'
import { callRpc } from '../../lib/rpc'
import { cx } from '../../lib/style'
import { type AiProblem, cancelJob, isCancelledError, statusProblem, useAiProblem, useAiStatus } from './ai'
import {
  CHANGES_LOOKUP_LIMIT,
  CHANNEL_LIST_LIMIT,
  type Item,
  ORGANIZABLE_RELATIONS,
  REJECT_GRACE_MS,
  folderKey,
  folderPaths,
  groupItems,
  mergeSuggestions,
  missingChannels,
  modelSettingsPath
} from './model'
import { type Decision, IntroBody, IntroSkeleton, ModelLine, Notice, ProgressPanel, SuggestionList, statusOf, usePlural } from './parts'

export type OrganizeView = 'boot' | 'intro' | 'nothing' | 'running' | 'review' | 'no_model' | 'provider_unavailable' | 'unavailable' | 'error'

/** Accepts of this session: one history group per `organize.accept` call. */
export interface SessionGroup {
  group: string
  ids: string[]
  /** Exact ids of the accept's entries (undoing any one undoes the accept); absent = older backend. */
  changeIds?: number[]
}

export type OrganizeNotice = 'busy' | 'cancelled' | 'cancel_failed'

/** Fixed initial state (scenario preview and tests); without it, the dialog acts on its own. */
export interface OrganizeSeed {
  view?: 'no_model' | 'provider_unavailable' | 'unavailable'
  /** `provider · model` of the `provider_unavailable` view. */
  aiRoute?: string
  items?: Suggestion[]
  decisions?: Record<string, 'accepted' | 'rejected'>
  edits?: Record<string, string>
  sessionGroups?: SessionGroup[]
  notice?: OrganizeNotice
}

export type OrganizeDialogProps = DialogProps['organize'] &
  DialogControls & {
    /** Preview/tests only: opens in a fixed state. */
    initial?: OrganizeSeed
  }

interface ActionError {
  kind: 'accept' | 'reject' | 'undo'
  error: ApiError | null
  retry: () => void
}

/** Shortcut shown per platform (the shortcut itself accepts ⌘ and Ctrl). */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
}

/** Empty atom for an older Desktop without `host.state.model`. */
const NO_MODEL_ATOM = atom('')

type Decisions = Record<string, Decision>

function omit(map: Readonly<Decisions>, ids: readonly string[], only?: Decision): Decisions {
  const out = { ...map }
  for (const id of ids) if (only === undefined || out[id] === only) delete out[id]
  return out
}

function mark(map: Readonly<Decisions>, ids: readonly string[], value: Decision): Decisions {
  const out = { ...map }
  for (const id of ids) out[id] = value
  return out
}

export function OrganizeDialog({ channelIds, jobId, onClose, initial }: OrganizeDialogProps) {
  const t = useT('organize')
  const tc = useT()
  const tp = usePlural()
  const selection = useMemo(() => (channelIds && channelIds.length ? [...new Set(channelIds)] : null), [channelIds])

  // ---------------------------------------------------------------- server
  const job = useRpcJob('organize.run', jobId ?? null)
  const { start, resume, reset } = job
  const channelsQ = useRest(
    'GET /channels',
    selection
      ? { query: { ids: selection.join(','), limit: CHANNEL_LIST_LIMIT } }
      : { query: { folder: 'none', relation: ORGANIZABLE_RELATIONS, limit: CHANNEL_LIST_LIMIT } }
  )
  const suggestionsQ = useRest('GET /suggestions', {})
  const jobsQ = useRest('GET /jobs', { query: { kind: 'organize' } }, { enabled: !jobId })
  const foldersQ = useRest('GET /folders', {})
  const mainModel = useValue(host.state?.model ?? NO_MODEL_ATOM)
  const ai = useAiStatus()

  // ---------------------------------------------------------------- local state
  const [items, setItems] = useState<Item[]>(() => mergeSuggestions([], initial?.items ?? [], () => true, false))
  const [decisions, setDecisionsState] = useState<Record<string, Decision>>(initial?.decisions ?? {})
  const decisionsRef = useRef(decisions)
  const setDecisions = useCallback((fn: (d: Record<string, Decision>) => Record<string, Decision>) => {
    const next = fn(decisionsRef.current)
    if (next === decisionsRef.current) return
    decisionsRef.current = next
    setDecisionsState(next)
  }, [])
  const [edits, setEdits] = useState<Record<string, string>>(initial?.edits ?? {})
  const editsRef = useRef(edits)
  editsRef.current = edits
  const [session, setSession] = useState<SessionGroup[]>(initial?.sessionGroups ?? [])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [notice, setNotice] = useState<OrganizeNotice | null>(initial?.notice ?? null)
  const [forced, setForced] = useState<OrganizeSeed['view'] | null>(initial?.view ?? null)
  const [busyFailed, setBusyFailed] = useState<ApiError | null>(null)
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [rejectCount, setRejectCount] = useState(0)
  const pendingRejects = useRef<string[]>([])
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRun = useRef<string[] | null>(null)
  const autoResumed = useRef(!!jobId || !!initial)
  const rootRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<number | null>(null)

  /** Channels seen (photo and name): they do not vanish when the channel gets a folder and leaves the "no folder" list. */
  const channelMap = useRef(new Map<string, Channel>())
  if (channelsQ.data) for (const r of channelsQ.data.items) channelMap.current.set(r.channel.id, r.channel)

  // ---------------------------------------------------------------- suggestions arriving
  useEffect(() => {
    const data = suggestionsQ.data
    if (!data) return
    setItems((prev) => mergeSuggestions(prev, data.items, (id) => id in decisionsRef.current, true))
    const present = new Set(data.items.map((s) => s.id))
    setDecisions((d) => {
      const back = Object.keys(d).filter((id) => d[id] === 'restoring' && present.has(id))
      return back.length ? omit(d, back) : d
    })
  }, [suggestionsQ.data, setDecisions])

  const result = job.phase === 'done' ? job.result : null
  useEffect(() => {
    const list = result?.suggestions
    if (!list?.length) return
    setItems((prev) => mergeSuggestions(prev, list.filter((s) => s.status === 'pending'), () => true, false))
  }, [result])

  // on each batch (progress signal) and at the end, re-read the suggestions: they appear without waiting for the job to finish
  const progressDone = job.progress?.done ?? -1
  useEffect(() => {
    if (job.phase === 'running') void invalidateRest('GET /suggestions')
    else if (job.phase === 'done') void invalidateRest('GET /suggestions', 'GET /channels')
  }, [progressDone, job.phase])

  // reopened midway: an active organize job is resumed (once, only if nothing started here)
  const activeJob = jobsQ.data?.items.find((j) => isJobActive(j)) ?? null
  useEffect(() => {
    if (autoResumed.current || !jobsQ.data) return
    autoResumed.current = true
    if (job.phase === 'idle' && activeJob) resume(activeJob.id)
  }, [jobsQ.data, activeJob, job.phase, resume])

  // cancelled (here or elsewhere): not an error — back to the start; finished batches stay for review
  const cancelledJob = job.phase === 'error' && isCancelledError(job.error)
  useEffect(() => {
    if (!cancelledJob) return
    reset()
    setNotice('cancelled')
    void invalidateRest('GET /suggestions')
  }, [cancelledJob, reset])
  /** Job phase for the screen: cancelled counts as "nothing running". */
  const jobPhase = cancelledJob ? 'idle' : job.phase
  // `llm_unavailable`: no model, a configured provider that cannot be reached, or another failure (the error itself)
  const aiFailure = useAiProblem(jobPhase === 'error' ? job.error : null)

  // busy: an organize job is already running → follow the existing one
  const busy = job.phase === 'error' && job.error?.code === 'busy' ? job.error : null
  useEffect(() => {
    if (!busy) return
    let alive = true
    restCall('GET /jobs', { query: { kind: 'organize' } }).then(
      (data) => {
        if (!alive) return
        const running = data.items.find((j) => isJobActive(j))
        if (running) {
          setNotice('busy')
          resume(running.id)
        } else setBusyFailed(busy)
      },
      () => {
        if (alive) setBusyFailed(busy)
      }
    )
    return () => {
      alive = false
    }
  }, [busy, resume])

  // ---------------------------------------------------------------- reject (with an undo window)
  const flushRejects = useCallback(() => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current)
    rejectTimer.current = null
    const ids = pendingRejects.current
    pendingRejects.current = []
    setRejectCount(0)
    if (ids.length) sendReject(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendReject = (ids: string[]) => {
    void callRpc('organize.reject', { suggestion_ids: ids }).then((out) => {
      if (out.kind === 'ok') return
      setDecisions((d) => omit(d, ids, 'rejected'))
      setActionError({
        kind: 'reject',
        error: out.kind === 'error' ? out.error : null,
        retry: () => {
          setActionError(null)
          setDecisions((d) => mark(d, ids, 'rejected'))
          sendReject(ids)
        }
      })
    })
  }

  const reject = useCallback(
    (target: Item[]) => {
      const ids = target.map((i) => i.suggestion.id).filter((id) => statusOf(decisionsRef.current[id]) === 'pending')
      if (!ids.length) return
      setActionError(null)
      setDecisions((d) => mark(d, ids, 'rejected'))
      pendingRejects.current = [...pendingRejects.current, ...ids]
      setRejectCount(pendingRejects.current.length)
      if (rejectTimer.current) clearTimeout(rejectTimer.current)
      rejectTimer.current = setTimeout(flushRejects, REJECT_GRACE_MS)
    },
    [flushRejects, setDecisions]
  )

  const undoReject = useCallback(() => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current)
    rejectTimer.current = null
    const ids = pendingRejects.current
    pendingRejects.current = []
    setRejectCount(0)
    setDecisions((d) => omit(d, ids, 'rejected'))
  }, [setDecisions])

  // closed the dialog with a reject in the window: it goes to the server (that is what the user saw)
  useEffect(() => () => flushRejects(), [flushRejects])

  // ---------------------------------------------------------------- accept (optimistic)
  const acceptRef = useRef<(target: Item[]) => void>(() => undefined)
  acceptRef.current = (target: Item[]) => {
    const chosen = target.filter((i) => statusOf(decisionsRef.current[i.suggestion.id]) === 'pending')
    const ids = chosen.map((i) => i.suggestion.id)
    if (!ids.length) return
    const changed: Record<string, OrganizeEdit> = {}
    for (const i of chosen) {
      const edit = editsRef.current[i.proposal.channelId]
      if (edit !== undefined && folderKey(edit) !== folderKey(i.proposal.folder)) changed[i.proposal.channelId] = { folder: edit }
    }
    const params: OrganizeAcceptParams = { suggestion_ids: ids, ...(Object.keys(changed).length ? { edits: changed } : {}) }
    setActionError(null)
    setDecisions((d) => mark(d, ids, 'accepted'))
    void callRpc('organize.accept', params).then((out) => {
      if (out.kind === 'ok') {
        const group = out.data?.change_group ?? null
        const changeIds = Array.isArray(out.data?.change_ids) ? out.data.change_ids.filter((n) => Number.isInteger(n)) : undefined
        if (group || changeIds?.length) setSession((s) => [...s, { group: group ?? '', ids, ...(changeIds ? { changeIds } : {}) }])
        void invalidateRest()
        return
      }
      setDecisions((d) => omit(d, ids, 'accepted'))
      setActionError({ kind: 'accept', error: out.kind === 'error' ? out.error : null, retry: () => acceptRef.current(chosen) })
    })
  }
  const accept = useCallback((target: Item[]) => acceptRef.current(target), [])

  const edit = useCallback((channelId: string, folder: string | null) => {
    setEdits((e) => {
      const next = { ...e }
      if (folder === null) delete next[channelId]
      else next[channelId] = folder
      return next
    })
  }, [])

  // ---------------------------------------------------------------- undo the session's organization
  const undoAll = useCallback(async () => {
    const groups = sessionRef.current
    if (!groups.length) return
    setUndoing(true)
    setActionError(null)
    setDecisions((d) => mark(d, groups.flatMap((g) => g.ids), 'restoring'))
    const failed: SessionGroup[] = []
    let error: ApiError | null = null
    try {
      // with `change_ids` the id is already known; only an older backend's accept needs to scan the history
      const changes = groups.some((g) => !g.changeIds) ? await restCall('GET /changes', { query: { limit: CHANGES_LOOKUP_LIMIT } }) : null
      for (const g of [...groups].reverse()) {
        let id: number
        if (g.changeIds) {
          if (!g.changeIds.length) continue // the accept changed nothing
          id = g.changeIds[0] // undoing any entry undoes the whole accept
        } else {
          const items = changes?.items ?? []
          const rec = items.find((c) => c.group_id === g.group && c.undone_at === null) ?? items.find((c) => c.group_id === g.group)
          if (rec && rec.undone_at !== null) continue // already undone (another screen)
          if (!rec) {
            failed.push(g)
            error = error ?? toApiError(new TubeApiError({ code: 'not_found', message: g.group }))
            continue
          }
          id = rec.id
        }
        try {
          await restCall('POST /changes/{id}/undo', { path: { id } })
        } catch (e) {
          const api = toApiError(e)
          if (api.code === 'undo_refused' && api.reason === 'already_undone') continue
          failed.push(g)
          error = error ?? api
        }
      }
    } catch (e) {
      failed.push(...groups.filter((g) => !failed.includes(g)))
      error = toApiError(e)
    }
    if (failed.length) setDecisions((d) => mark(d, failed.flatMap((g) => g.ids), 'accepted'))
    setSession(failed)
    if (error) setActionError({ kind: 'undo', error, retry: () => void undoAll() })
    setUndoing(false)
    void invalidateRest()
  }, [setDecisions])

  // ---------------------------------------------------------------- start / stop
  const run = useCallback(
    (ids?: string[] | null) => {
      flushRejects()
      setNotice(null)
      setBusyFailed(null)
      setForced(null)
      setActionError(null)
      autoResumed.current = true
      const list = ids ?? selection
      lastRun.current = ids ?? null
      void start(list ? { channel_ids: list } : {})
    },
    [flushRejects, start, selection]
  )

  // A real "Cancel": the job stops at the next batch; whatever already arrived stays pending (nothing applied).
  // A gateway without `job.cancel` → warns and keeps following; never freezes the screen.
  const cancel = useCallback(async () => {
    const id = job.jobId
    if (!id) return
    setCancelling(true)
    setNotice(null)
    const outcome = await cancelJob(id)
    setCancelling(false)
    if (outcome === 'cancelled') {
      reset()
      setNotice('cancelled')
      void invalidateRest('GET /suggestions')
    } else if (outcome === 'failed') setNotice('cancel_failed')
  }, [job.jobId, reset])

  // Esc inside the folder field only abandons the swap: Radix listens to Esc on the document before the field
  const keepOpenOnFieldEscape = useCallback((e: globalThis.KeyboardEvent) => {
    const target = e.target instanceof Element ? e.target : typeof document !== 'undefined' ? document.activeElement : null
    if (target?.closest('[data-part="organize-folder-input"]')) e.preventDefault()
  }, [])

  const chooseModel = useCallback(() => {
    onClose()
    host.navigate(modelSettingsPath())
  }, [onClose])

  // ---------------------------------------------------------------- what to show
  const groups = useMemo(() => groupItems(items), [items])
  const pending = useMemo(() => items.filter((i) => statusOf(decisions[i.suggestion.id]) === 'pending'), [items, decisions])
  const models = useMemo(() => [...new Set(items.map((i) => i.suggestion.model).filter((m): m is string => !!m))], [items])
  const suggester = result?.model ?? models[0] ?? null
  const tracked = job.jobId !== null
  const countError = !selection && channelsQ.data === undefined && channelsQ.error ? channelsQ.error : null
  const count = selection ? selection.length : (channelsQ.data?.total ?? null)

  let view: OrganizeView
  if (forced) view = forced
  else if (jobPhase === 'unavailable') view = 'unavailable'
  else if (jobPhase === 'error' && job.error?.code === 'llm_unavailable' && aiFailure.problem?.kind !== 'other')
    view = aiFailure.pending ? 'boot' : aiFailure.problem?.kind === 'provider_unavailable' ? 'provider_unavailable' : 'no_model'
  else if (busy && !busyFailed) view = 'running'
  else if (jobPhase === 'error') view = 'error'
  else if (jobPhase === 'starting' || jobPhase === 'running') view = 'running'
  else if (jobPhase === 'done') view = 'review'
  else if (!autoResumed.current && !jobsQ.error && (jobsQ.data === undefined || activeJob)) view = activeJob ? 'running' : 'boot'
  else if (items.length) view = 'review'
  else if (suggestionsQ.data === undefined && suggestionsQ.error) view = 'error'
  else if (suggestionsQ.data === undefined) view = 'boot'
  else if (countError) view = 'error'
  else if (count === null) view = 'boot'
  else if (count === 0) view = 'nothing'
  else view = 'intro'

  // partial error: the job followed here finished and left channels without a suggestion
  const targets = selection ?? channelsQ.data?.items.map((r) => r.channel.id) ?? null
  const missing = view === 'review' && tracked && job.phase === 'done' && targets ? missingChannels(targets, items) : []
  // stored suggestions (no run in this session) that leave channels without a folder uncovered — new
  // subscriptions, or a run that did not reach them: say so and offer to ask only for those (cheaper than everything)
  const uncovered = view === 'review' && !tracked && !selection && channelsQ.data ? missingChannels(channelsQ.data.items.map((r) => r.channel.id), items) : []
  const timedOut = !!job.progress && job.progress.total != null && job.progress.done < job.progress.total

  const acceptAll = useCallback(() => accept(pending), [accept, pending])

  // ⌘/Ctrl+Enter accepts everything (in review and with suggestions already arrived)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey) return
    if ((view !== 'review' && view !== 'running') || !pending.length) return
    e.preventDefault()
    acceptAll()
  }

  // after deciding a row by keyboard, focus moves to the next pending one
  const actOn = useCallback(
    (fn: (items: Item[]) => void) => (target: Item[]) => {
      const flat = groupItems(items).flatMap((g) => g.items)
      const last = Math.max(...target.map((i) => flat.indexOf(i)))
      const root = rootRef.current
      focusAfter.current = root && root.contains(document.activeElement) ? last : null
      fn(target)
    },
    [items]
  )
  useEffect(() => {
    const idx = focusAfter.current
    focusAfter.current = null
    const root = rootRef.current
    if (idx === null || !root) return
    const rows = [...root.querySelectorAll('[data-part="suggestion-row"]:not([data-skeleton])')]
    const next = rows.slice(idx + 1).find((r) => r.getAttribute('data-status') === 'pending') ?? rows.find((r) => r.getAttribute('data-status') === 'pending')
    const target = next?.querySelector<HTMLElement>('[data-part="suggestion-accept"]')
    if (target) target.focus()
  }, [decisions])

  // ---------------------------------------------------------------- body
  const folderOptions = useMemo(() => {
    const own = foldersQ.data ? folderPaths(foldersQ.data.items) : []
    const suggested = groups.map((g) => g.folder)
    return [...new Set([...own, ...suggested])]
  }, [foldersQ.data, groups])

  // the model that will answer (`GET /ai/status`) outweighs the history; without it, the earlier one
  const modelText =
    ai?.available && ai.model
      ? t('intro.model_exact', { model: ai.model })
      : suggester
        ? t('intro.model_last', { model: suggester })
        : mainModel
          ? t('intro.model_main', { model: mainModel })
          : t('intro.model_unknown')
  /** "Couldn't reach your AI model (provider · model)…" (the shared text, with or without the route). */
  const unreachable = (route: string) => (route ? tc('provider_unavailable', { route }) : tc('provider_unavailable_plain'))
  // only an explicit `available: false` warns; "unknown" (route missing, slow, erroring) opens normally
  const before: AiProblem | null = statusProblem(ai)
  const aiWarning =
    before?.kind === 'provider_unavailable' ? (
      <Notice
        key="ai"
        part="organize-ai-warning"
        tone="warning"
        title={t('ai.provider_unavailable_title')}
        action={{ label: t('provider_unavailable.action'), onClick: chooseModel }}
      >
        {unreachable(before.route)}
      </Notice>
    ) : before ? (
      <Notice
        key="ai"
        part="organize-ai-warning"
        tone="warning"
        title={t('ai.no_model_title')}
        action={{ label: t('ai.choose_model'), onClick: chooseModel }}
      >
        {t('ai.no_model_desc')}
      </Notice>
    ) : null

  const list = (arriving: boolean) =>
    groups.length || arriving ? (
      <SuggestionList
        groups={groups}
        decisions={decisions}
        edits={edits}
        channels={channelMap.current}
        folderOptions={folderOptions}
        showModelPerGroup={models.length > 1}
        arriving={arriving}
        onAccept={actOn(accept)}
        onReject={actOn(reject)}
        onEdit={edit}
      />
    ) : null

  const sessionChannels = new Set(session.flatMap((g) => g.ids)).size
  const banners: ReactNode[] = []
  if (notice) banners.push(<Notice key="notice" part="organize-notice">{t(`notice.${notice}`)}</Notice>)
  if (actionError)
    banners.push(
      <Notice
        key="action-error"
        part="organize-action-error"
        tone="error"
        title={t(`error.${actionError.kind}`)}
        action={{ label: t('error.retry'), onClick: actionError.retry }}
      >
        {actionError.error ? errorText(tc, actionError.error) : tc(MESSAGE_KEYS.openDesktopBackend)}
      </Notice>
    )
  if (missing.length)
    banners.push(
      <Notice
        key="partial"
        part="organize-partial"
        tone="warning"
        title={tp('partial.title', missing.length)}
        action={{ label: t('partial.retry'), onClick: () => run(missing) }}
      >
        {timedOut ? t('partial.timeout') : t('partial.batch')}
      </Notice>
    )
  if (uncovered.length)
    banners.push(
      <Notice
        key="uncovered"
        part="organize-uncovered"
        tone="warning"
        title={tp('uncovered.title', uncovered.length)}
        action={{ label: t('uncovered.action'), onClick: () => run(uncovered) }}
      >
        {t('uncovered.desc')}
      </Notice>
    )
  if (suggestionsQ.error && (view === 'review' || view === 'running'))
    banners.push(
      <Notice
        key="read-error"
        part="organize-read-error"
        tone="warning"
        action={{ label: t('error.retry'), onClick: () => void suggestionsQ.refetch() }}
      >
        {errorText(tc, toApiError(suggestionsQ.error))}
      </Notice>
    )
  if (session.length && (view === 'review' || view === 'running'))
    banners.push(
      <Notice
        key="undo"
        part="organize-undo"
        icon="pass"
        title={tp('undo.organized', sessionChannels)}
        action={undoing ? undefined : { label: t('undo.action'), onClick: () => void undoAll() }}
      >
        {undoing ? t('undo.undoing') : null}
      </Notice>
    )
  if (rejectCount)
    banners.push(
      <Notice key="reject" part="organize-reject-undo" icon="close" title={tp('reject.pending', rejectCount)} action={{ label: t('reject.undo'), onClick: undoReject }} />
    )

  let body: ReactNode
  let footer: ReactNode
  const closeBtn = (part = 'organize-close') => (
    <Button variant="outline" size="sm" data-part={part} onClick={onClose}>
      {t('review.close')}
    </Button>
  )

  if (view === 'boot' || view === 'intro') {
    body =
      view === 'intro' && count !== null ? (
        <>
          {notice ? <Notice key="notice" part="organize-notice">{t(`notice.${notice}`)}</Notice> : null}
          {aiWarning}
          {/* no model: the warning is the only statement about the model (not "No model" + "Uses model X" together) */}
          <IntroBody count={count} selection={!!selection} modelLine={aiWarning ? null : modelText} onChooseModel={chooseModel} />
        </>
      ) : (
        <IntroSkeleton />
      )
    footer = (
      <>
        <Button variant="outline" size="sm" data-part="organize-not-now" onClick={onClose}>
          {t('intro.not_now')}
        </Button>
        {/* with no model the main path is the warning's; trying anyway stays possible, without emphasis */}
        <Button
          size="sm"
          variant={aiWarning ? 'outline' : undefined}
          data-part="organize-start"
          disabled={view !== 'intro'}
          onClick={() => run()}
        >
          <Codicon name="sparkle" size={14} />
          {t('intro.start')}
        </Button>
      </>
    )
  } else if (view === 'nothing') {
    body = (
      <EmptyView
        icon="pass"
        title={t('nothing.title')}
        description={t('nothing.desc')}
        action={
          <Button
            variant="outline"
            size="sm"
            data-part="organize-open-manage"
            onClick={() => {
              onClose()
              openSection('manage')
            }}
          >
            {t('nothing.action')}
          </Button>
        }
      />
    )
    footer = closeBtn()
  } else if (view === 'no_model') {
    body = (
      <EmptyView
        icon="sparkle"
        title={t('no_model.title')}
        description={t('no_model.desc')}
        action={
          <Button variant="outline" size="sm" data-part="organize-retry" onClick={() => run(lastRun.current)}>
            {t('no_model.retry')}
          </Button>
        }
      />
    )
    footer = (
      <>
        {closeBtn()}
        <Button size="sm" data-part="organize-choose-model" onClick={chooseModel}>
          {t('no_model.action')}
        </Button>
      </>
    )
  } else if (view === 'provider_unavailable') {
    const route = forced === 'provider_unavailable' ? (initial?.aiRoute ?? '') : aiFailure.problem?.kind === 'provider_unavailable' ? aiFailure.problem.route : ''
    body = (
      <EmptyView
        icon="sparkle"
        title={t('provider_unavailable.title')}
        description={unreachable(route)}
        action={
          <Button variant="outline" size="sm" data-part="organize-retry" onClick={() => run(lastRun.current)}>
            {t('provider_unavailable.retry')}
          </Button>
        }
      />
    )
    footer = (
      <>
        {closeBtn()}
        <Button size="sm" data-part="organize-open-model" onClick={chooseModel}>
          {t('provider_unavailable.action')}
        </Button>
      </>
    )
  } else if (view === 'unavailable') {
    body = <RpcUnavailableNotice />
    footer = closeBtn()
  } else if (view === 'error') {
    const err = countError ?? (suggestionsQ.data === undefined && !tracked ? suggestionsQ.error : null) ?? busyFailed ?? job.error
    const retry = countError
      ? () => void channelsQ.refetch()
      : suggestionsQ.data === undefined && !tracked && suggestionsQ.error
        ? () => void suggestionsQ.refetch()
        : () => run(lastRun.current)
    // an `llm_unavailable` that is neither "no model" nor "provider unreachable": the backend's own (redacted) message
    const aiOther = err === job.error && aiFailure.problem?.kind === 'other' ? job.error?.message : undefined
    body = <ErrorView error={err} title={t('error.title')} description={aiOther} onRetry={retry} />
    footer = closeBtn()
  } else if (view === 'running') {
    body = (
      <>
        {banners}
        <ProgressPanel progress={job.progress} />
        {list(true)}
      </>
    )
    footer = (
      <>
        <Button variant="ghost" size="sm" data-part="organize-cancel" loading={cancelling} disabled={cancelling || !job.jobId} onClick={() => void cancel()}>
          {t('progress.cancel')}
        </Button>
        <Button variant="outline" size="sm" data-part="organize-background" onClick={onClose}>
          {t('progress.background')}
        </Button>
        {pending.length ? (
          <Button size="sm" data-part="organize-accept-all" onClick={acceptAll}>
            <Codicon name="check-all" size={14} />
            {tp('progress.accept_ready', pending.length)}
          </Button>
        ) : null}
      </>
    )
  } else {
    // review
    const newFolders = groups.filter((g) => g.isNew).length
    // the same rows that are on screen (suggestions that change nothing never get here); the tag-only group is not a folder
    const folderGroups = groups.filter((g) => g.kind === 'folder').length
    body = items.length ? (
      <>
        {banners}
        <Stack gap={1}>
          <p className={cx('t-head')} data-part="organize-summary">
            {tp('review.suggestions', items.length)}
            {folderGroups ? <> · {tp('review.folders', folderGroups)}</> : null}
            {newFolders ? <> · {tp('review.new_folders', newFolders)}</> : null}
            {suggester && models.length <= 1 ? <span className={cx('sgroup-meta t-label')}> · {t('review.by_model', { model: suggester })}</span> : null}
          </p>
          {pending.length ? (
            <p className={cx('section-desc t-body')} data-part="organize-hint">
              {t('review.nothing_changes')}{' '}
              <span className={cx('stat-label t-label')}>{isMac() ? t('review.shortcut_mac') : t('review.shortcut_other')}</span>
            </p>
          ) : null}
        </Stack>
        {list(false)}
        {!tracked ? <ModelLine text={modelText} onChooseModel={chooseModel} /> : null}
      </>
    ) : (
      <>
        {banners}
        <EmptyView
          icon="search"
          title={t('empty.title')}
          description={t('empty.desc')}
          action={
            <Button variant="outline" size="sm" data-part="organize-retry" onClick={() => run(lastRun.current)}>
              {t('empty.retry')}
            </Button>
          }
        />
      </>
    )
    footer = (
      <>
        {/* "Undo organization" lives only in the top strip; the footer keeps "Done" */}
        {items.length && !tracked && !session.length ? (
          <Button variant="ghost" size="sm" data-part="organize-again" onClick={() => run()}>
            <Codicon name="refresh" size={14} />
            {t('review.suggest_again')}
          </Button>
        ) : null}
        {pending.length ? closeBtn() : null}
        {pending.length ? (
          <Button size="sm" data-part="organize-accept-all" onClick={acceptAll}>
            <Codicon name="check-all" size={14} />
            {t('review.accept_all', { count: pending.length })}
          </Button>
        ) : (
          <Button size="sm" data-part="organize-done" onClick={onClose}>
            {t('review.done')}
          </Button>
        )}
      </>
    )
  }

  return (
    <DialogFrame title={t('title')} onClose={onClose} size="lg" footer={footer} onEscapeKeyDown={keepOpenOnFieldEscape}>
      <div ref={rootRef} data-part="organize" data-view={view} onKeyDown={onKeyDown}>
        <Stack gap={4}>{body}</Stack>
      </div>
    </DialogFrame>
  )
}
