// New theme tab (dialog `theme`, opened by openDialog('theme', {query?, jobId?, themeId?}); registered in
// main.tsx/DIALOGS). Flow:
//   field ("What do you want a tab about?", examples, options) → `theme.create` (RPC, kind job) →
//   progress by named step (StepProgress; GET /jobs/{id} every 2 s, `theme.progress`/`theme.ready` speed it up) →
//   preview (grid with 👎, seed channels follow · ignore, name, folder; partial marked) → `theme.save` →
//   closes, opens the new tab on Home and offers undo (POST /changes/{id}/undo).
// Resume: `jobId` from props, or the job stored in ctx.storage on reopen; `themeId` opens the saved preview.
// Background: closing (✕, Esc, outside) or "Continue in background" never cancels — the job stays stored and Home shows
// it in the tab strip until it ends (lib/jobs `useThemeBuild`). Only "Cancel" calls `job.cancel`.
// Honest wait: the real steps, the current one marked, the numbers each step produced and the elapsed time.
// States: no model, busy, error (with retry), empty search (rephrase), expired, no RPC.
// Language/classics are fields of `theme.create`; steps come from `progress.step`; a real "Cancel"
// (`job.cancel`; cancelled is not an error: back to the field with the text; gateway without the method → warns and carries on); "no
// model" is warned before the click (`GET /ai/status`, tolerant: failure/404/slow = unknown).
// Rules: only lib/, components/ and shared/; all text through useT('theme').
import { Button, Codicon, host } from '@hermes/plugin-sdk'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiError, Job, ThemeCreateParams, ThemePreview } from '../../../shared/api-types'
import { DESKTOP_ROUTES, MESSAGE_KEYS, type DialogProps } from '../../../shared/ids'
import { Banner, DialogFrame, EmptyView, ErrorView, RpcUnavailableNotice, Stack } from '../../components'
import { openDialog, type DialogControls } from '../../lib/dialogs'
import { errorText, useT } from '../../lib/i18n'
import { formatElapsed, useNowTicker, useRpcJob } from '../../lib/jobs'
import { openSection } from '../../lib/nav'
import { invalidateRest, restCall, toApiError, useRest } from '../../lib/rest'
import { callRpc } from '../../lib/rpc'
import { cx } from '../../lib/style'
import { cancelJob, isCancelledError, modelSettingsPath, statusProblem, useAiProblem, useAiStatus } from './ai'
import {
  DEFAULT_OPTIONS,
  QUERY_MIN,
  SETTINGS_PATH,
  type SeedChoice,
  type StageCounts,
  type ThemeOptions,
  absorbProgress,
  buildEdits,
  cleanText,
  clearPending,
  createParams,
  defaultChoices,
  isThemePreview,
  nameProblem,
  readPending,
  rememberHomeTab,
  sameCounts,
  stageOf,
  stepDetails,
  stepStates,
  stripHints,
  writePending
} from './model'
import { FormView, PreviewBody, PreviewSkeleton, ProgressSteps, ProgressView } from './parts'

export { HOME_TAB_KEY, PENDING_KEY, SETTINGS_PATH } from './model'

/** Routes that change when a theme is saved/undone (tab, folder, followed channels, feed, counters). */
const CHANGED_BY_SAVE = ['GET /tabs', 'GET /status', 'GET /feed', 'GET /channels', 'GET /folders', 'GET /themes'] as const

/** Fixed state for the scenario preview and tests (without it, the dialog acts on its own). */
export interface ThemeSeedState {
  /** Opens straight into a state that depends on a click (busy, no RPC). */
  view?: 'busy' | 'unavailable'
  draft?: string
  options?: ThemeOptions
  counts?: StageCounts
  /** Preview: starts "saving" (scenario). */
  saving?: boolean
  /** Progress: starts with the "could not cancel" notice (scenario). */
  cancelFailed?: boolean
  name?: string
  createFolder?: boolean
  removed?: string[]
  choices?: Record<string, SeedChoice>
}

export type ThemeDialogProps = DialogProps['theme'] &
  DialogControls & {
    /** Preview/tests only: opens in a fixed state. */
    initial?: ThemeSeedState
  }

type Mode = 'form' | 'starting' | 'job' | 'theme' | 'busy' | 'no-model' | 'start-error' | 'unavailable' | 'expired'

interface Edits {
  themeId: string
  name: string
  createFolder: boolean
  choices: Record<string, SeedChoice>
  removed: string[]
}

type SaveError = { kind: 'error'; error: ApiError } | { kind: 'unavailable' }

export function ThemeDialog({ query, jobId, themeId, onClose, initial }: ThemeDialogProps) {
  const t = useT('theme')
  const tc = useT()

  // ---------------------------------------------------------------- where it starts
  const [boot] = useState(() => {
    const stored = themeId ? null : readPending()
    // opened on a given job (Home's notice, toast): the stored one only if it is that job
    const pending = jobId ? (stored?.jobId === jobId ? stored : null) : stored
    return { jobId: jobId ?? pending?.jobId ?? null, pending }
  })
  const [mode, setMode] = useState<Mode>(() => initial?.view ?? (boot.jobId ? 'job' : themeId ? 'theme' : 'form'))
  const [draft, setDraft] = useState(() => initial?.draft ?? query ?? boot.pending?.query ?? '')
  /** Requested text (no hints): progress title, retry, rephrase. */
  const [asked, setAsked] = useState(() => query ?? boot.pending?.query ?? initial?.draft ?? '')
  const [options, setOptions] = useState<ThemeOptions>(() => initial?.options ?? DEFAULT_OPTIONS)
  const [fieldError, setFieldError] = useState<'too_short' | 'invalid' | null>(null)
  const [startError, setStartError] = useState<ApiError | null>(null)
  /** `llm_unavailable` refused by `theme.create` itself (its `details.reason` says which AI case). */
  const [aiStartError, setAiStartError] = useState<ApiError | null>(null)
  const [counts, setCounts] = useState<StageCounts>(() => initial?.counts ?? boot.pending?.counts ?? {})
  /** Last request made (retry repeats exactly the same one). */
  const lastParams = useRef<ThemeCreateParams | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusField = useRef(false)
  /** When the request went out (ms): the elapsed time counts from here (null = take the job's `created_at`). */
  const [startedAt, setStartedAt] = useState<number | null>(() => boot.pending?.at ?? null)
  /** Cancel: request in flight, or the gateway could not cancel (the job finishes on its own). */
  const [cancelState, setCancelState] = useState<'idle' | 'pending' | 'failed'>(() => (initial?.cancelFailed ? 'failed' : 'idle'))

  const job = useRpcJob('theme.create', boot.jobId)
  const tracking = mode === 'job'
  // only on the field (before the click); failure/404/slow = "unknown" → nothing changes
  const ai = useAiStatus(mode === 'form')
  const liveCounts = useMemo(() => (tracking ? absorbProgress(counts, job.progress) : counts), [tracking, counts, job.progress])

  // ---------------------------------------------------------------- saved preview (themeId)
  const themeQ = useRest('GET /themes/{id}', { path: { id: themeId ?? '' } }, { enabled: mode === 'theme' && !!themeId })

  // ---------------------------------------------------------------- current preview
  const jobResult = tracking && job.phase === 'done' ? job.result : null
  const preview: ThemePreview | null =
    mode === 'theme' ? (isThemePreview(themeQ.data) ? themeQ.data : null) : isThemePreview(jobResult) ? jobResult : null
  const badResult = tracking && job.phase === 'done' && !preview

  // ---------------------------------------------------------------- preview edits (reset with each theme)
  const [edits, setEdits] = useState<Edits | null>(null)
  if (preview && edits?.themeId !== preview.theme.id) {
    setEdits({
      themeId: preview.theme.id,
      name: initial?.name ?? preview.theme.name ?? stripHints(preview.theme.query, t),
      createFolder: initial?.createFolder ?? false,
      choices: initial?.choices ?? defaultChoices(preview),
      removed: initial?.removed ?? []
    })
  }
  const [saving, setSaving] = useState(!!initial?.saving)
  const [saveError, setSaveError] = useState<SaveError | null>(null)

  // seeds already in the list (followed/subscribed): no choice; real photos when the channel is known
  const seedIds = preview?.seeds.map((s) => s.channel_id) ?? []
  const channelsQ = useRest('GET /channels', { query: { ids: seedIds.join(','), limit: Math.max(1, seedIds.length) } }, { enabled: seedIds.length > 0 })
  const { inList, thumbs } = useMemo(() => {
    const set = new Set<string>()
    const pics: Record<string, string | null> = {}
    for (const row of channelsQ.data?.items ?? []) {
      const ch = row?.channel
      if (!ch?.id) continue
      pics[ch.id] = ch.thumb ?? null
      if (ch.relation === 'subscribed' || ch.relation === 'followed') set.add(ch.id)
    }
    return { inList: set as ReadonlySet<string>, thumbs: pics }
  }, [channelsQ.data])

  // ---------------------------------------------------------------- phase (what the screen shows)
  const rawJobError = tracking && job.phase === 'error' ? job.error : null
  // cancelled (here or elsewhere) is not an error: the screen goes back to the field (effect below); until then, it stays on progress
  const cancelledJob = isCancelledError(rawJobError)
  const jobError = cancelledJob ? null : rawJobError
  // `llm_unavailable`: no model, a configured provider that cannot be reached, or another failure (the error itself)
  const aiFailure = useAiProblem(mode === 'no-model' ? aiStartError : jobError?.code === 'llm_unavailable' ? jobError : null)
  const aiPhase = (): string =>
    aiFailure.pending
      ? 'progress' // the status is being read (≤ 4 s): neither message yet
      : aiFailure.problem?.kind === 'provider_unavailable'
        ? 'provider-unavailable'
        : aiFailure.problem?.kind === 'other'
          ? 'error'
          : 'no-model'
  const phase: string = (() => {
    if (mode === 'form') return 'form'
    if (mode === 'starting') return 'progress'
    if (mode === 'no-model') return aiPhase()
    if (mode === 'busy' || mode === 'unavailable' || mode === 'expired') return mode
    if (mode === 'start-error') return 'error'
    if (mode === 'theme') return preview ? (saving ? 'saving' : 'preview') : themeQ.error ? 'error' : 'loading'
    // job
    if (job.phase === 'unavailable') return 'unavailable'
    if (jobError) {
      if (jobError.code === 'llm_unavailable') return aiPhase()
      if (jobError.code === 'not_found' && !job.job) return 'expired'
      return 'error'
    }
    if (badResult) return 'error'
    if (preview) return saving ? 'saving' : 'preview'
    return 'progress'
  })()

  // stored job: follows the numbers; leaves when the job fails or disappears
  useEffect(() => {
    if (!tracking) return
    if (!sameCounts(liveCounts, counts)) setCounts(liveCounts)
    if (job.jobId && (phase === 'progress' || phase === 'preview')) {
      const stored = readPending()
      const mine = stored?.jobId === job.jobId ? stored : null
      writePending({
        jobId: job.jobId,
        query: asked,
        at: mine?.at ?? startedAt ?? Date.now(),
        counts: liveCounts,
        params: lastParams.current ?? mine?.params,
        // the preview is on screen: Home has nothing left to announce
        seen: phase === 'preview' || mine?.seen ? true : undefined
      })
    } else if (phase === 'error' || phase === 'expired' || phase === 'no-model' || phase === 'provider-unavailable') clearPending()
  }, [tracking, liveCounts, counts, job.jobId, phase, asked, startedAt])

  // focus on the field: on opening at the field and when rephrasing
  useEffect(() => {
    if (mode !== 'form') return
    if (focusField.current || !initial) {
      focusField.current = false
      inputRef.current?.focus()
      inputRef.current?.select?.()
    }
  }, [mode, initial])

  // ---------------------------------------------------------------- actions
  const follow = useCallback(
    (id: string) => {
      setStartError(null)
      setMode('job')
      job.resume(id)
    },
    [job]
  )

  const begin = useCallback(
    async (text: string, sent?: ThemeCreateParams) => {
      const clean = cleanText(text)
      if (clean.length < QUERY_MIN) {
        setFieldError('too_short')
        inputRef.current?.focus()
        return
      }
      const params = sent ?? createParams(clean, options)
      lastParams.current = params
      setFieldError(null)
      setStartError(null)
      setAiStartError(null)
      setSaveError(null)
      setCancelState('idle')
      setAsked(clean)
      setCounts({})
      setStartedAt(Date.now())
      job.reset()
      setMode('starting')
      const out = await callRpc('theme.create', params)
      if (out.kind === 'ok') {
        const id = out.data?.job?.id
        if (!id) {
          setStartError({ code: 'internal', message: 'RPC returned no job' })
          setMode('start-error')
          return
        }
        const at = Date.now()
        setStartedAt(at)
        writePending({ jobId: id, query: clean, at, counts: {}, params })
        setMode('job')
        job.resume(id)
      } else if (out.kind === 'unavailable') setMode('unavailable')
      else if (out.error.code === 'llm_unavailable') {
        setAiStartError(out.error)
        setMode('no-model')
      }
      else if (out.error.code === 'busy') setMode('busy')
      else if (out.error.code === 'invalid') {
        setFieldError('invalid')
        focusField.current = true
        setMode('form')
      } else {
        setStartError(out.error)
        setMode('start-error')
      }
    },
    [job, options]
  )

  const submit = () => void begin(draft)
  const retry = () => void begin(asked, lastParams.current ?? undefined)

  const rephrase = useCallback(() => {
    job.reset()
    clearPending()
    setCancelState('idle')
    setDraft((d) => (asked || d))
    focusField.current = true
    setMode('form')
  }, [job, asked])

  // A real "Cancel": closed on the server → back to the field with the text and options (the next request
  // goes out at once; the backend already released the "one at a time" limit). A gateway without `job.cancel` → warns that
  // it could not and keeps following; already finished → carries on and shows the result.
  const cancel = useCallback(async () => {
    const id = job.jobId
    if (!id) return
    setCancelState('pending')
    const outcome = await cancelJob(id)
    if (outcome === 'cancelled') rephrase()
    else setCancelState(outcome === 'failed' ? 'failed' : 'idle')
  }, [job.jobId, rephrase])

  // cancelled elsewhere (the poll/event brought `error.code: cancelled`): the same path, no error on screen
  useEffect(() => {
    if (cancelledJob) rephrase()
  }, [cancelledJob, rephrase])

  const followActive = useCallback(async () => {
    try {
      const data = await restCall('GET /jobs', { query: { kind: 'theme' } })
      const active = (data.items ?? []).find((j: Job) => j.status === 'queued' || j.status === 'running')
      if (active) {
        follow(active.id)
        return
      }
    } catch {
      // without the list: try to create again (if still busy, it comes back here)
    }
    retry()
  }, [follow, retry])

  // ---------------------------------------------------------------- preview: 👎, seeds, save
  const setEdit = (patch: Partial<Edits>) => setEdits((e) => (e ? { ...e, ...patch } : e))

  const restore = useCallback((videoId: string) => {
    setEdits((e) => (e ? { ...e, removed: e.removed.filter((id) => id !== videoId) } : e))
    restCall('POST /videos/state', { body: { video_ids: [videoId], reaction: null } }).catch(() => undefined)
  }, [])

  const drop = useCallback(
    (videoId: string) => {
      if (!preview || edits?.removed.includes(videoId)) return
      const title = preview.videos[videoId]?.title ?? videoId
      setEdits((e) => (e ? { ...e, removed: [...e.removed, videoId] } : e))
      restCall('POST /videos/state', { body: { video_ids: [videoId], reaction: 'down' } }).then(
        () => host.notify({ kind: 'info', message: t('toast.removed', { title }), action: { label: t('toast.undo'), onClick: () => restore(videoId) } }),
        (error: unknown) => {
          setEdits((e) => (e ? { ...e, removed: e.removed.filter((id) => id !== videoId) } : e))
          host.notify({ kind: 'error', message: t('toast.down_failed', { error: errorText(tc, toApiError(error)) }) })
        }
      )
    },
    [preview, edits, t, tc, restore]
  )

  const openInHome = useCallback(
    (tabId: string) => {
      rememberHomeTab(tabId)
      void invalidateRest(...CHANGED_BY_SAVE)
      openSection('home')
      onClose()
    },
    [onClose]
  )

  const problem = edits ? nameProblem(edits.name) : null
  const visibleCount = preview && edits ? preview.items.filter((i) => !edits.removed.includes(i.video_id)).length : 0
  const alreadySaved = preview?.theme.status === 'saved'
  const canSave = !!preview && !!edits && !problem && visibleCount > 0 && !saving && !alreadySaved

  const save = useCallback(async () => {
    if (!preview || !edits || !canSave) return
    setSaving(true)
    setSaveError(null)
    const out = await callRpc('theme.save', {
      theme_id: preview.theme.id,
      edits: buildEdits({ preview, name: edits.name, createFolder: edits.createFolder, choices: edits.choices, inList, removed: edits.removed })
    })
    if (out.kind !== 'ok') {
      setSaving(false)
      setSaveError(out.kind === 'unavailable' ? { kind: 'unavailable' } : { kind: 'error', error: out.error })
      return
    }
    const saved = out.data
    const name = saved.tab?.name ?? cleanText(edits.name)
    clearPending()
    openInHome(saved.tab.id)
    const themeIdSaved = saved.theme_id
    const changeId = saved.change_id
    host.notify({
      kind: 'success',
      message: t('toast.saved', { name }),
      action:
        changeId != null
          ? {
              label: t('toast.undo'),
              onClick: () => {
                restCall('POST /changes/{id}/undo', { path: { id: changeId } }).then(
                  () => {
                    void invalidateRest(...CHANGED_BY_SAVE)
                    host.notify({
                      kind: 'success',
                      message: t('toast.undone', { name }),
                      action: { label: t('toast.reopen'), onClick: () => openDialog('theme', { themeId: themeIdSaved }) }
                    })
                  },
                  (error: unknown) => host.notify({ kind: 'error', message: t('toast.undo_failed', { error: errorText(tc, toApiError(error)) }) })
                )
              }
            }
          : undefined
    })
  }, [preview, edits, canSave, inList, openInHome, t, tc])

  const discard = () => {
    clearPending()
    onClose()
  }

  // ⌘↩ / Ctrl+↩ saves on the preview
  const onKeyDown = (e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (phase === 'preview' || phase === 'saving')) {
      e.preventDefault()
      void save()
    }
  }

  // ---------------------------------------------------------------- body and footer per phase
  const states = stepStates(tracking ? stageOf(job.progress) : null, phase === 'error' ? 'error' : 'running')
  const details = stepDetails(states, liveCounts, tracking ? job.progress : null)
  const shownQuery = asked || (preview ? stripHints(preview.theme.query, t) : '')
  const now = useNowTicker(phase === 'progress')
  const since = startedAt ?? (job.job ? job.job.created_at * 1000 : null)
  const elapsed = phase === 'progress' && since != null ? formatElapsed(now - since) : null

  /** "Couldn't reach your AI model (provider · model)…" (the shared text, with or without the route). */
  const unreachable = (route: string) => (route ? tc('provider_unavailable', { route }) : tc('provider_unavailable_plain'))
  const before = statusProblem(ai)

  let body: ReactNode
  let footer: ReactNode
  const notNow = (
    <Button variant="outline" size="sm" data-part="theme-secondary" onClick={onClose}>
      {t('footer.not_now')}
    </Button>
  )

  if (phase === 'form') {
    body = (
      <FormView
        t={t}
        draft={draft}
        onDraft={(v) => {
          setDraft(v)
          if (fieldError) setFieldError(null)
        }}
        options={options}
        onOptions={setOptions}
        fieldError={fieldError}
        onSubmit={submit}
        inputRef={inputRef}
        banner={
          // only an explicit `available: false` warns; the request stays possible (the config may have changed just now)
          before?.kind === 'provider_unavailable' ? (
            <div data-part="theme-ai-warning">
              <Banner
                tone="warning"
                title={t('ai.provider_unavailable_title')}
                action={{
                  label: t('ai.provider_unavailable_action'),
                  onClick: () => {
                    host.navigate(modelSettingsPath())
                    onClose()
                  }
                }}
              >
                {unreachable(before.route)}
              </Banner>
            </div>
          ) : before ? (
            <div data-part="theme-ai-warning">
              <Banner
                tone="warning"
                title={t('ai.no_model_title')}
                action={{
                  label: t('ai.open_settings'),
                  onClick: () => {
                    host.navigate(SETTINGS_PATH)
                    onClose()
                  }
                }}
              >
                {t('ai.no_model_desc')}
              </Banner>
            </div>
          ) : null
        }
      />
    )
    footer = (
      <>
        {notNow}
        {/* with no model the main path is the warning's; trying anyway stays possible, without emphasis */}
        <Button
          size="sm"
          variant={ai?.available === false ? 'outline' : undefined}
          data-part="theme-primary"
          disabled={cleanText(draft).length < QUERY_MIN}
          onClick={submit}
        >
          <Codicon name="sparkle" size={14} />
          {t('footer.start')}
        </Button>
      </>
    )
  } else if (phase === 'progress') {
    body = (
      <ProgressView
        t={t}
        query={shownQuery}
        states={states}
        details={details}
        elapsed={elapsed}
        banner={
          cancelState === 'failed' ? (
            <div data-part="theme-cancel-failed">
              <Banner tone="warning">{t('progress.cancel_failed')}</Banner>
            </div>
          ) : null
        }
      />
    )
    // the result shows up on its own: give up (Cancel) or leave it running (closing does the same, never cancels)
    footer = (
      <>
        <Button
          variant="outline"
          size="sm"
          data-part="theme-secondary"
          loading={cancelState === 'pending'}
          disabled={cancelState === 'pending' || !job.jobId}
          onClick={() => void cancel()}
        >
          {t('footer.cancel')}
        </Button>
        <Button size="sm" data-part="theme-background" disabled={cancelState === 'pending'} onClick={onClose}>
          {t('footer.background')}
        </Button>
      </>
    )
  } else if (phase === 'no-model') {
    body = (
      <EmptyView
        icon="sparkle"
        title={t('no_model.title')}
        description={t('no_model.desc')}
        action={
          <Button
            size="sm"
            data-part="theme-settings"
            onClick={() => {
              host.navigate(SETTINGS_PATH)
              onClose()
            }}
          >
            <Codicon name="settings-gear" size={14} />
            {t('no_model.action')}
          </Button>
        }
      />
    )
    footer = notNow
  } else if (phase === 'provider-unavailable') {
    const route = aiFailure.problem?.kind === 'provider_unavailable' ? aiFailure.problem.route : ''
    body = (
      <EmptyView
        icon="sparkle"
        title={t('provider_unavailable.title')}
        description={unreachable(route)}
        action={
          <>
            <Button variant="outline" size="sm" data-part="theme-retry" onClick={retry}>
              {t('provider_unavailable.retry')}
            </Button>
            <Button
              size="sm"
              data-part="theme-settings"
              onClick={() => {
                host.navigate(modelSettingsPath())
                onClose()
              }}
            >
              <Codicon name="settings-gear" size={14} />
              {t('provider_unavailable.action')}
            </Button>
          </>
        }
      />
    )
    footer = notNow
  } else if (phase === 'busy') {
    body = (
      <EmptyView
        icon="watch"
        title={t('busy.title')}
        description={t('busy.desc')}
        action={
          <>
            <Button variant="outline" size="sm" onClick={retry}>
              {t('busy.retry')}
            </Button>
            <Button size="sm" onClick={() => void followActive()}>
              {t('busy.follow')}
            </Button>
          </>
        }
      />
    )
    footer = notNow
  } else if (phase === 'unavailable') {
    body = <RpcUnavailableNotice />
    footer = notNow
  } else if (phase === 'expired') {
    body = <EmptyView icon="history" title={t('error.expired_title')} description={t('error.expired')} />
    footer = (
      <>
        {notNow}
        <Button size="sm" data-part="theme-primary" onClick={rephrase}>
          {t('footer.new_theme')}
        </Button>
      </>
    )
  } else if (phase === 'error') {
    if (mode === 'theme') {
      body = <ErrorView error={themeQ.error} title={t('error.load_title')} onRetry={() => void themeQ.refetch?.()} />
      footer = notNow
    } else {
      const error = startError ?? (mode === 'no-model' ? aiStartError : null) ?? jobError ?? { code: 'internal' as const, message: 'invalid job result' }
      // an `llm_unavailable` that is neither "no model" nor "provider unreachable": the backend's own (redacted) message
      const aiOther = aiFailure.problem?.kind === 'other' ? error.message : undefined
      body = (
        <Stack gap={5}>
          {mode === 'job' ? <ProgressSteps t={t} states={states} details={details} /> : null}
          <ErrorView error={error} title={t('error.title')} description={aiOther} onRetry={retry} compact={mode === 'job'} />
        </Stack>
      )
      footer = (
        <Button variant="outline" size="sm" data-part="theme-secondary" onClick={rephrase}>
          {t('footer.rephrase')}
        </Button>
      )
    }
  } else if (phase === 'loading') {
    body = <PreviewSkeleton t={t} />
    footer = (
      <>
        {notNow}
        <Button size="sm" data-part="theme-primary" disabled>
          <Codicon name="save" size={14} />
          {t('footer.save')}
        </Button>
      </>
    )
  } else if (preview && edits) {
    const partial = !alreadySaved && !!preview.theme.error && preview.items.length > 0
    let banner: ReactNode = null
    if (saveError) {
      const msg =
        saveError.kind === 'unavailable'
          ? tc(MESSAGE_KEYS.openDesktopBackend)
          : saveError.error.code === 'conflict'
            ? t('error.conflict')
            : errorText(tc, saveError.error)
      banner = (
        <Banner tone="error" title={t('error.save_title')}>
          {msg}
        </Banner>
      )
    } else if (alreadySaved) {
      banner = (
        <Banner tone="info" title={t('preview.saved_title')}>
          {t('preview.saved')}
        </Banner>
      )
    } else if (partial) {
      banner = (
        <Banner tone="warning" title={t('preview.partial_title')}>
          {t('preview.partial')} <span className={cx('t-label')}>{preview.theme.error}</span>
        </Banner>
      )
    }
    const allRemoved = preview.items.length > 0 && visibleCount === 0
    const empty = allRemoved ? (
      <EmptyView
        compact
        icon="thumbsdown"
        title={t('preview.all_removed_title')}
        description={t('preview.all_removed')}
        action={
          <Button variant="outline" size="sm" onClick={() => edits.removed.forEach(restore)}>
            {t('empty.restore')}
          </Button>
        }
      />
    ) : (
      <EmptyView
        compact
        icon="search"
        title={t('empty.title', { query: stripHints(preview.theme.query, t) })}
        description={preview.theme.error ? `${preview.theme.error} ${t('empty.desc')}` : t('empty.desc')}
        action={
          <Button variant="outline" size="sm" onClick={rephrase}>
            {t('footer.rephrase')}
          </Button>
        }
      />
    )
    body = (
      <PreviewBody
        t={t}
        preview={preview}
        about={shownQuery}
        name={edits.name}
        onName={(v) => setEdit({ name: v })}
        problem={alreadySaved ? null : problem}
        createFolder={edits.createFolder}
        onCreateFolder={(v) => setEdit({ createFolder: v })}
        choices={edits.choices}
        onChoice={(id, c) => setEdits((e) => (e ? { ...e, choices: { ...e.choices, [id]: c } } : e))}
        onChoiceAll={(c) => setEdits((e) => (e ? { ...e, choices: Object.fromEntries(preview.seeds.map((s) => [s.channel_id, c])) } : e))}
        inList={inList}
        thumbs={thumbs}
        removed={edits.removed}
        onDown={drop}
        banner={banner}
        empty={empty}
        disabled={saving}
        readOnly={alreadySaved}
      />
    )
    footer = alreadySaved ? (
      <>
        <Button variant="outline" size="sm" data-part="theme-secondary" onClick={rephrase}>
          {t('footer.new_theme')}
        </Button>
        <Button size="sm" data-part="theme-primary" onClick={() => preview.theme.tab_id && openInHome(preview.theme.tab_id)}>
          <Codicon name="home" size={14} />
          {t('footer.open_home')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" size="sm" data-part="theme-secondary" disabled={saving} onClick={discard}>
          {t('footer.discard')}
        </Button>
        <Button size="sm" data-part="theme-primary" title={t('footer.save_shortcut')} loading={saving} disabled={!canSave} onClick={() => void save()}>
          <Codicon name="save" size={14} />
          {edits.createFolder ? t('footer.save_folder') : t('footer.save')}
        </Button>
      </>
    )
  } else {
    body = <PreviewSkeleton t={t} />
    footer = notNow
  }

  return (
    // theme already saved: the preview is read-only and "nothing is saved until you confirm" no longer applies
    <DialogFrame title={t('title')} description={alreadySaved ? undefined : t('description')} onClose={onClose} footer={footer} size="lg">
      <div data-part="theme" data-phase={phase} onKeyDown={onKeyDown}>
        {body}
      </div>
    </DialogFrame>
  )
}
