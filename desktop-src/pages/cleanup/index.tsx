// Cleanup. Built only from the kit (docs/design/DESIGN.md).
//   header     title · "Last scan X ago · reasons by <model> | by rule" · Scan again (cleanup.scan,
//              a job followed by lib/jobs: GET /jobs/{id} every 2 s, events only bring it forward)
//   bar        selection (count + "Review unsubscribe (N)") or the ApprovalCard (stays outside the scroller)
//   strip      one at a time: scan failed/no RPC/running › server down › extension disconnected › no model
//   body       Live queue (approved → in progress → done/failed, undo via REST) · 3 groups (inactive ·
//              you don't watch · off your profile; + marked by you) · Former subscriptions with Resubscribe
// Invariant: nothing is unsubscribed without a human click. Approve and resubscribe only via RPC (`cleanup.approve` /
// `cleanup.resubscribe`); the approving button describes the effect with the count, never gets the initial focus, is not
// triggered by Enter (only click or Space) and the dismiss button says "Not now". All text through useT('cleanup').
import { Button, Codicon, host } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ApiError, Channel, ChannelRow, CleanupCandidate, CleanupGroup, QueueView } from '../../../shared/api-types'
import { MESSAGE_KEYS } from '../../../shared/ids'
import {
  ApprovalCard,
  Banner,
  ChannelAvatar,
  EmptyView,
  ErrorView,
  Page,
  RpcUnavailableNotice,
  SectionFrame,
  Stack,
  Toolbar,
  formatRelative,
  useFormatCount,
  useLocale
} from '../../components'
import { openDialog } from '../../lib/dialogs'
import { useTubeEvents } from '../../lib/events'
import { useNeverPaired } from '../../lib/ext-notice'
import { errorText, useT } from '../../lib/i18n'
import { showSection } from '../../lib/nav'
import { useAiStatus, useRpcJob } from '../../lib/jobs'
import { invalidateRest, useRest } from '../../lib/rest'
import { useStatus } from '../../lib/status'
import { cx } from '../../lib/style'
import { type RequestOutcome, useKeep, useQueueActions } from './actions'
import {
  EX_RETENTION_DAYS,
  GROUPS,
  QUEUE_IDLE_POLL_MS,
  QUEUE_POLL_MS,
  QUEUE_STATUSES,
  activeChannels,
  groupCandidates,
  isPluginUnavailable,
  lacksWatchHistory,
  mergeQueue,
  modelSettingsPath,
  pickBanner,
  plural,
  unreachableRoute
} from './model'
import { ExSection, GroupSection, GroupsSkeleton, NeverScanned, QueueSection } from './parts'

export { QUEUE_POLL_MS, UNDO_MS } from './model'

/** Clock of the relative times ("3 days ago"). */
const CLOCK_MS = 30_000
/** How many channels are named in the approval card (the rest becomes "+N" and "see all"). */
const PREVIEW_NAMES = 6
/** Max height of the full list inside the card (scrolls inside; ~5.5 rows, the half row hints that it scrolls). */
const APPROVAL_LIST_MAX_PX = 232

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

type Review = { kind: 'unsubscribe' } | { kind: 'resubscribe'; channel: Channel }

type ReviewProblem = { kind: 'error'; error: ApiError } | { kind: 'unavailable' } | null

export function CleanupPage() {
  return <CleanupView />
}

export interface CleanupViewProps {
  /** Initial selection (preview/tests). */
  initialSelected?: readonly string[]
  /** Opens the approval card for the initial selection (preview). */
  initialReview?: boolean
  /** Resumes a running scan (preview; or whoever already has the job). */
  scanJobId?: string | null
  /** Approval card with the full list already open (preview). */
  initialShowAll?: boolean
}

export function CleanupView({ initialSelected, initialReview, scanJobId, initialShowAll }: CleanupViewProps = {}) {
  const t = useT('cleanup')
  const tc = useT()
  const locale = useLocale()
  const fmt = useFormatCount()
  const now = useNow(CLOCK_MS)
  const nowS = Math.floor(now / 1000)

  // ---------------------------------------------------------------- data
  const cleanupQ = useRest('GET /cleanup', {})
  const statusQ = useStatus()
  const status = statusQ.data
  const neverPaired = useNeverPaired()
  const queueQ = useRest(
    'GET /queue',
    { query: { status: QUEUE_STATUSES, limit: 200 } },
    { refetchInterval: (data: QueueView | undefined) => (data && data.pending > 0 ? QUEUE_POLL_MS : QUEUE_IDLE_POLL_MS) }
  )
  const exQ = useRest('GET /channels', { query: { relation: 'ex', limit: 500 } })
  const historyQ = useRest('GET /channels', { query: { relation: 'subscribed', limit: 1 } })

  const scanData = cleanupQ.data?.scan ?? null
  // a scan without a model: is none configured, or is the configured provider unreachable? (no network on the server)
  const aiStatus = useAiStatus(!!scanData && scanData.model == null)
  const candidateIds = useMemo(() => [...new Set((scanData?.candidates ?? []).map((c) => c.channel_id))].sort(), [scanData])
  const factsQ = useRest('GET /channels', { query: { ids: candidateIds.join(','), limit: Math.max(1, candidateIds.length) } }, { enabled: candidateIds.length > 0 })
  const facts = useMemo(() => new Map<string, ChannelRow>((factsQ.data?.items ?? []).map((r) => [r.channel.id, r])), [factsQ.data])

  // events only bring it forward (the query is the guarantee)
  useTubeEvents(['queue.changed', 'cleanup.scanned'], (name) => {
    if (name === 'queue.changed') void invalidateRest('GET /queue', 'GET /status')
    else void invalidateRest('GET /cleanup')
  })

  // ---------------------------------------------------------------- scan (job)
  const scan = useRpcJob('cleanup.scan', scanJobId ?? null)
  const startScan = useCallback(() => void scan.start({}), [scan])
  useEffect(() => {
    if (scan.phase !== 'done') return
    // the new list arrives before the screen leaves "scanning" (nothing flickers)
    void invalidateRest('GET /cleanup', 'GET /channels').finally(() => scan.reset())
  }, [scan.phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const scanning = scan.phase === 'starting' || scan.phase === 'running' || scan.phase === 'done'

  // ---------------------------------------------------------------- local actions
  const queueActions = useQueueActions(t, tc, fmt)
  const { kept, keep } = useKeep(t, tc)
  const queue = useMemo(
    () => mergeQueue(queueQ.data?.items, queueActions.local, queueActions.hidden, nowS),
    [queueQ.data, queueActions.local, queueActions.hidden, nowS]
  )
  const unsubscribing = useMemo(() => activeChannels(queue, 'unsubscribe'), [queue])
  const resubscribing = useMemo(() => activeChannels(queue, 'resubscribe'), [queue])

  // an item that finished → relations changed (Former subscriptions, candidates)
  const doneSeen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const done = new Set((queueQ.data?.items ?? []).filter((it) => it.status === 'done' || it.status === 'failed').map((it) => it.id))
    const before = doneSeen.current
    doneSeen.current = done
    if (before && [...done].some((id) => !before.has(id))) void invalidateRest('GET /channels', 'GET /cleanup')
  }, [queueQ.data])

  // channel names: memory of everything the screen has seen (the approved candidate disappears from GET /cleanup)
  const known = useRef(new Map<string, Channel>())
  for (const ch of Object.values(cleanupQ.data?.channels ?? {})) known.current.set(ch.id, ch)
  for (const r of exQ.data?.items ?? []) known.current.set(r.channel.id, r.channel)
  for (const r of factsQ.data?.items ?? []) if (!known.current.has(r.channel.id)) known.current.set(r.channel.id, r.channel)
  const unknownIds = [...new Set(queue.map((it) => it.channel_id))].filter((id) => !known.current.has(id)).sort()
  const lookupQ = useRest('GET /channels', { query: { ids: unknownIds.join(','), limit: Math.max(1, unknownIds.length) } }, { enabled: unknownIds.length > 0 })
  for (const r of lookupQ.data?.items ?? []) known.current.set(r.channel.id, r.channel)
  const channelName = (id: string) => known.current.get(id)?.title ?? t('queue.unknown_channel', { id })

  // ---------------------------------------------------------------- groups and selection
  const hiddenChannels = useMemo(() => new Set([...kept, ...unsubscribing]), [kept, unsubscribing])
  const groups = useMemo(() => groupCandidates(scanData?.candidates ?? [], hiddenChannels), [scanData, hiddenChannels])
  const channels = cleanupQ.data?.channels ?? {}
  const visibleIds = useMemo(() => new Set(GROUPS.flatMap((g) => groups[g].map((c) => c.channel_id)).filter((id) => channels[id])), [groups, channels])
  const visibleCount = visibleIds.size

  const [selectedRaw, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected ?? []))
  const selected = useMemo(() => new Set([...selectedRaw].filter((id) => visibleIds.has(id))), [selectedRaw, visibleIds])
  const select = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((s) => {
      const next = new Set(s)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  // ---------------------------------------------------------------- approval (card)
  const [review, setReview] = useState<Review | null>(() => (initialReview && initialSelected?.length ? { kind: 'unsubscribe' } : null))
  const [problem, setProblem] = useState<ReviewProblem>(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(!!initialShowAll)
  const listId = useId()
  const returnFocus = useRef<HTMLElement | null>(null)

  const openReview = (r: Review) => {
    returnFocus.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    setProblem(null)
    setShowAll(false)
    setReview(r)
  }
  const closeReview = useCallback(() => {
    setReview(null)
    setProblem(null)
    setShowAll(false)
    const el = returnFocus.current
    returnFocus.current = null
    if (el && el.isConnected) setTimeout(() => el.focus(), 0)
  }, [])

  // the selection emptied (a channel left the list) → the unsubscribe card does not stay up with no effect
  const loaded = !!cleanupQ.data
  useEffect(() => {
    if (loaded && review?.kind === 'unsubscribe' && selected.size === 0 && !busy) setReview(null)
  }, [loaded, review, selected.size, busy])

  const confirm = async () => {
    if (!review || busy) return
    setBusy(true)
    setProblem(null)
    let out: RequestOutcome
    if (review.kind === 'unsubscribe') {
      const ids = [...selected]
      out = await queueActions.request('unsubscribe', ids, (items) => plural(t, 'toast.queued', items.length || ids.length, fmt))
      if (out.kind === 'ok') select(ids, false)
    } else {
      const ch = review.channel
      out = await queueActions.request('resubscribe', [ch.id], () => t('toast.resub_queued', { name: ch.title }))
    }
    setBusy(false)
    if (out.kind === 'ok') closeReview()
    else setProblem(out.kind === 'error' ? { kind: 'error', error: out.error } : { kind: 'unavailable' })
  }

  /** Enter never approves (not even with focus on the button): only click or Space. Esc dismisses. */
  const guardKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('[data-part="approval-confirm"]')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  const escape = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault()
      closeReview()
    }
  }

  const offline = !!status && (status.devices_online === 0 || !status.ext_endpoint_up)

  let approval: ReactNode = null
  if (review) {
    const problemNode =
      problem?.kind === 'unavailable' ? (
        <RpcUnavailableNotice />
      ) : problem?.kind === 'error' ? (
        <Banner tone="error">{problem.error.code === 'approval_refused' ? t('approve.refused') : t('approve.failed', { error: errorText(tc, problem.error) })}</Banner>
      ) : null
    if (review.kind === 'unsubscribe') {
      const count = selected.size
      const chosen = [...selected].map((id) => channels[id]).filter((c): c is Channel => !!c)
      const names = chosen.slice(0, PREVIEW_NAMES).map((c) => c.title)
      const rest = chosen.length - names.length
      approval = (
        <ApprovalCard
          title={plural(t, 'approve.title', count, fmt)}
          description={t('approve.description')}
          effects={[
            plural(t, 'approve.effect', count, fmt),
            t('approve.effect_resubscribe', { days: EX_RETENTION_DAYS }),
            offline ? t('approve.effect_offline') : t('approve.effect_undo')
          ]}
          confirmLabel={plural(t, 'approve.confirm', count, fmt)}
          onConfirm={() => void confirm()}
          onCancel={closeReview}
          busy={busy}
          autoFocus
        >
          <Stack direction="row" gap={2} align="center" wrap>
            {showAll ? null : (
              <>
                <Stack direction="row" gap={1} align="center">
                  {chosen.slice(0, PREVIEW_NAMES).map((c) => (
                    <ChannelAvatar key={c.id} title={c.title} thumb={c.thumb} size={20} />
                  ))}
                </Stack>
                <span className={cx('t-label')}>
                  {names.join(' · ')}
                  {rest > 0 ? ` ${t('approve.more', { count: fmt(rest) })}` : ''}
                </span>
              </>
            )}
            {rest > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                data-part="approval-show-all"
                aria-expanded={showAll}
                aria-controls={listId}
                onClick={() => setShowAll((v) => !v)}
              >
                <Codicon name={showAll ? 'chevron-up' : 'chevron-down'} size={13} />
                {showAll ? t('approve.show_less') : t('approve.show_all', { count: fmt(chosen.length) })}
              </Button>
            ) : null}
          </Stack>
          {showAll && rest > 0 ? (
            // full list inside the card: scrolls inside, max height (the kit has no class for it)
            <div
              id={listId}
              role="list"
              aria-label={t('approve.list_label')}
              className={cx('sgroup')}
              data-part="approval-list"
              tabIndex={0}
              style={{ maxHeight: APPROVAL_LIST_MAX_PX, overflowY: 'auto', overscrollBehavior: 'contain' }}
            >
              {chosen.map((c) => (
                <div key={c.id} role="listitem" className={cx('srow')} data-part="approval-list-item" data-channel={c.id}>
                  <ChannelAvatar title={c.title} thumb={c.thumb} size={20} />
                  <div className={cx('srow-main')}>
                    <div className={cx('srow-line t-body')}>
                      <span className={cx('srow-subject')}>{c.title}</span>
                    </div>
                  </div>
                  <div className={cx('srow-actions')} />
                </div>
              ))}
            </div>
          ) : null}
          {problemNode}
        </ApprovalCard>
      )
    } else {
      const ch = review.channel
      approval = (
        <ApprovalCard
          title={t('resub.title', { name: ch.title })}
          description={t('resub.description')}
          effects={[t('resub.effect', { name: ch.title }), offline ? t('approve.effect_offline') : t('resub.effect_undo')]}
          confirmLabel={t('resub.confirm', { name: ch.title })}
          onConfirm={() => void confirm()}
          onCancel={closeReview}
          busy={busy}
          tone="default"
          autoFocus
        >
          {problemNode}
        </ApprovalCard>
      )
    }
  }

  // ---------------------------------------------------------------- bar (selection or card)
  const hasScan = !!scanData
  let toolbar: ReactNode = null
  if (approval) {
    toolbar = (
      <div data-part="approval-wrap" onKeyDownCapture={guardKeys} onKeyDown={escape}>
        {approval}
      </div>
    )
  } else if (hasScan && visibleCount > 0) {
    const count = selected.size
    toolbar = (
      <div data-part="selection-bar" aria-label={t('selection.label')} role="group">
        <Toolbar
          end={
            <>
              {count > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  {t('selection.clear')}
                </Button>
              ) : null}
              <Button size="sm" data-part="review" disabled={count === 0} onClick={() => openReview({ kind: 'unsubscribe' })}>
                <Codicon name="shield" size={14} />
                {count > 0 ? plural(t, 'selection.review', count, fmt) : t('selection.review_none')}
              </Button>
            </>
          }
        >
          <span className={cx('t-label')} aria-live="polite">
            {count > 0 ? plural(t, 'selection.count', count, fmt) : t('selection.none')}
          </span>
        </Toolbar>
      </div>
    )
  }

  // ---------------------------------------------------------------- strip
  const needsExtension = queue.some((it) => it.status === 'approved') || visibleCount > 0
  // off/missing: the error state already says it; the "no contact" strip would contradict it
  const pluginUnavailable = isPluginUnavailable(statusQ.error) || isPluginUnavailable(cleanupQ.error)
  const noModel = hasScan && scanData?.model == null && visibleCount > 0
  // a rule-only scan: no model configured, or a configured provider that cannot be reached right now
  const aiRoute = unreachableRoute(aiStatus)
  const bannerKind = pickBanner({
    scanPhase: scan.phase === 'error' ? 'error' : scan.phase === 'unavailable' ? 'unavailable' : scanning ? 'scanning' : 'idle',
    status,
    statusFailed: !!statusQ.error,
    pluginUnavailable,
    needsExtension,
    noModel,
    providerUnavailable: aiRoute !== null,
    neverPaired,
    subscribed: typeof status?.subscribed_total === 'number' ? status.subscribed_total : null
  })
  let banner: ReactNode = null
  const progress = scan.progress
  if (bannerKind === 'scan_failed' && scan.error) {
    banner = (
      <Banner tone="error" action={{ label: t('banner.retry'), onClick: startScan }} onDismiss={scan.reset}>
        {t('banner.scan_failed', { error: errorText(tc, scan.error) })}
      </Banner>
    )
  } else if (bannerKind === 'scan_unavailable') {
    banner = (
      <Banner tone="info" icon="plug" onDismiss={scan.reset}>
        {tc(MESSAGE_KEYS.openDesktopBackend)}
      </Banner>
    )
  } else if (bannerKind === 'scanning') {
    banner = (
      <Banner tone="info" icon="sync">
        {progress && progress.total ? t('banner.scanning_progress', { done: fmt(progress.done), total: fmt(progress.total) }) : t('banner.scanning')}
      </Banner>
    )
  } else if (bannerKind === 'server_down') {
    banner = (
      <Banner tone="warning" action={{ label: t('banner.retry'), onClick: () => void statusQ.refetch() }}>
        {t('banner.server_down')}
      </Banner>
    )
  } else if (bannerKind === 'ext_endpoint_down') {
    banner = (
      <Banner tone="warning" icon="debug-disconnect">
        {t('banner.ext_endpoint_down')}
      </Banner>
    )
  } else if (bannerKind === 'ext_not_paired') {
    banner = (
      <Banner tone="info" icon="extensions" action={{ label: t('banner.connect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_not_paired')}
      </Banner>
    )
  } else if (bannerKind === 'ext_disconnected') {
    banner = (
      <Banner tone="info" icon="debug-disconnect" action={{ label: t('banner.reconnect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_disconnected')}
      </Banner>
    )
  } else if (bannerKind === 'provider_unavailable') {
    banner = (
      <Banner tone="warning" icon="sparkle" action={{ label: t('banner.provider_unavailable_action'), onClick: () => host.navigate(modelSettingsPath()) }}>
        {aiRoute ? t('banner.provider_unavailable', { route: aiRoute }) : t('banner.provider_unavailable_plain')}
      </Banner>
    )
  } else if (bannerKind === 'no_model') {
    banner = (
      <Banner tone="info" icon="sparkle">
        {t('banner.no_model')}
      </Banner>
    )
  }

  // ---------------------------------------------------------------- header
  let subtitle: ReactNode = '\u00a0' // reserves the line (no jump)
  if (scanData) {
    const by = scanData.model ? t('subtitle.by_model', { model: scanData.model }) : t('subtitle.by_rule')
    subtitle = `${t('subtitle.last_scan', { when: formatRelative(scanData.created_at, now, locale) })} · ${by}`
  } else if (cleanupQ.data) {
    subtitle = scanning ? t('subtitle.scanning') : t('subtitle.never')
  } else if (cleanupQ.error) {
    subtitle = t('subtitle.error')
  }

  const neverScanned = !!cleanupQ.data && !scanData && !scanning
  const actions = neverScanned ? null : (
    <Button variant="outline" size="sm" loading={scanning} disabled={scanning || !cleanupQ.data} onClick={startScan}>
      <Codicon name="refresh" size={14} />
      {t('actions.scan')}
    </Button>
  )

  // ---------------------------------------------------------------- body
  const connect = () => openDialog('onboarding', { step: 'pair' })
  const queueNode = queue.length ? (
    <QueueSection items={queue} channelName={channelName} offline={offline} onUndo={queueActions.undo} now={now} />
  ) : null
  const exNode = (
    <ExSection
      rows={exQ.data?.items}
      error={exQ.error}
      queued={resubscribing}
      onResubscribe={(ch) => openReview({ kind: 'resubscribe', channel: ch })}
      onRetry={() => void exQ.refetch()}
      now={now}
    />
  )

  let main: ReactNode
  if (!cleanupQ.data && cleanupQ.error) {
    // missing (transport 404) means the same as off, not "unexpected error"
    main = (
      <ErrorView
        error={cleanupQ.error}
        description={isPluginUnavailable(cleanupQ.error) ? tc('errors.plugin_disabled') : undefined}
        onRetry={() => void cleanupQ.refetch()}
      />
    )
  } else if (!cleanupQ.data || (!scanData && scanning)) {
    main = <GroupsSkeleton label={scanning ? t('subtitle.scanning') : t('groups.loading')} />
  } else if (!scanData) {
    main = <NeverScanned onScan={startScan}>{scan.phase === 'unavailable' ? <RpcUnavailableNotice /> : null}</NeverScanned>
  } else if (visibleCount === 0) {
    main = (
      <EmptyView
        icon="check-all"
        title={t('empty.clean_title')}
        description={t('empty.clean_desc', { when: formatRelative(scanData.created_at, now, locale) })}
        action={
          <Button variant="outline" size="sm" onClick={() => showSection('home')}>
            {t('actions.home')}
          </Button>
        }
      />
    )
  } else {
    // a group with nobody disappears (GroupSection returns null), except "You don't watch" without history
    const shown: readonly CleanupGroup[] = GROUPS
    // fragment: each group is a direct child of the page body (24 px rhythm between sections)
    main = (
      <>
        {shown.map((g) => (
          <GroupSection
            key={g}
            group={g}
            items={groups[g]}
            channels={channels}
            facts={facts}
            selected={selected}
            needsHistory={g === 'ignored' && lacksWatchHistory(historyQ.data?.items)}
            onSelect={select}
            onKeep={(c: CleanupCandidate, ch: Channel) => {
              select([ch.id], false)
              keep(
                ch.id,
                (scanData.candidates ?? []).filter((x) => x.channel_id === c.channel_id && x.status === 'pending').map((x) => x.id),
                ch.title
              )
            }}
            onConnect={connect}
            now={now}
          />
        ))}
      </>
    )
  }

  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    <SectionFrame current="cleanup">
      <Page title={t('title')} subtitle={subtitle} actions={actions} toolbar={toolbar} banner={banner}>
        {queueNode}
        {main}
        {cleanupQ.data ? exNode : null}
      </Page>
    </SectionFrame>
  )
}
