// Path 3 — demo mode: one click loads it (POST /demo/load, no network) and immediately asks for the RSS
// (POST /refresh force); progress follows the videos arriving (GET /status every 2 s) and, once there are channels in the list,
// it closes by itself. While loading there is no destructive action (only "see my subscriptions"); "Clear demo"
// shows up once it is ready or already loaded (POST /demo/clear removes only `source=demo`); clearing is optimistic and
// "load again" is the undo.
import { Button } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataReport, StatusResponse } from '../../../shared/api-types'
import { Banner, EmptyView, Stack, type Step, StepProgress, StepProgressSkeleton, useUiLocale } from '../../components'
import { useT } from '../../lib/i18n'
import { invalidateRest, restCall, useRest } from '../../lib/rest'
import { cx } from '../../lib/style'
import { AFTER_CHANNELS, DEMO_PATIENCE_MS, LIVE_POLL_MS } from './model'
import { AutoClose, usePlural, useWindowVisible } from './parts'

export type DemoPhase = 'checking' | 'idle' | 'loading' | 'arriving' | 'ready' | 'loaded' | 'cleared' | 'error'

export interface DemoState {
  phase: DemoPhase
  report?: DataReport
  /** When the load finished (ms): only a `GET /status` newer than this counts. */
  since?: number
  /** New videos seen in the last `GET /status` (never an invented 0: `undefined` = not known yet). */
  videos?: number
  /** The demo became ready by patience (videos keep arriving). */
  late?: boolean
  /** Last request that failed. */
  failed?: 'load' | 'clear'
}

export interface DemoPanelProps {
  seed?: DemoState
  /** Load right on open (the user chose this path), unless it is already loaded. */
  autoLoad: boolean
  onFinish: () => void
  onDirty: () => void
}

export function DemoPanel({ seed, autoLoad, onFinish, onDirty }: DemoPanelProps) {
  const t = useT('onboarding')
  const tc = useT()
  const plural = usePlural()
  const visible = useWindowVisible()
  const [state, setState] = useState<DemoState>(seed ?? { phase: 'checking' })
  const { phase } = state
  const live = phase === 'arriving'

  const demo = useRest('GET /demo', {}, { enabled: !seed })
  const status = useRest('GET /status', {}, { refetchInterval: visible && live ? LIVE_POLL_MS : false })

  const uiLocale = useUiLocale()
  const load = useCallback(() => {
    setState({ phase: 'loading' })
    // demo folder names come out in the language the app is in
    restCall('POST /demo/load', { body: { ui_locale: uiLocale } }).then(
      (report) => {
        onDirty()
        setState({ phase: 'arriving', report, since: Date.now() })
        // videos come through RSS: ask for the cycle right away (without waiting for the `kick_if_due` grace period)
        restCall('POST /refresh', { body: { force: true } }).catch(() => undefined)
        void invalidateRest(...AFTER_CHANNELS)
      },
      () => setState({ phase: 'error', failed: 'load' })
    )
  }, [onDirty, uiLocale])

  const clear = () => {
    const before = state
    setState({ phase: 'cleared' })
    restCall('POST /demo/clear').then(
      () => {
        onDirty()
        void invalidateRest(...AFTER_CHANNELS)
      },
      () => setState({ ...before, failed: 'clear' })
    )
  }

  // first decision: already loaded → show "clear"; otherwise load (or wait for the click)
  const decided = useRef(!!seed)
  useEffect(() => {
    if (decided.current || phase !== 'checking') return
    if (demo.data !== undefined) {
      decided.current = true
      if (demo.data.loaded) setState({ phase: 'loaded' })
      else if (autoLoad) load()
      else setState({ phase: 'idle' })
    } else if (demo.error) {
      decided.current = true
      if (autoLoad) load()
      else setState({ phase: 'idle' })
    }
  }, [demo.data, demo.error, phase, autoLoad, load])

  // videos arriving: the RSS cycle finished with videos (or the last cycle is newer than the load)
  const data: StatusResponse | undefined = status.data
  useEffect(() => {
    if (phase !== 'arriving' || !data || state.since === undefined || seed) return
    if (status.dataUpdatedAt < state.since) return
    const videos = data.new_total
    const finished = !data.refresh_running && (videos > 0 || (data.last_rss_at ?? 0) * 1000 > state.since)
    setState((s) => (s.phase !== 'arriving' ? s : { ...s, videos, phase: finished ? 'ready' : 'arriving' }))
  }, [data, status.dataUpdatedAt, phase, state.since, seed])

  // patience: RSS may be down; the demo is already usable
  useEffect(() => {
    if (phase !== 'arriving' || seed) return undefined
    const left = (state.since ?? Date.now()) + DEMO_PATIENCE_MS - Date.now()
    const ready = () => setState((s) => (s.phase === 'arriving' ? { ...s, phase: 'ready', late: true } : s))
    if (left <= 0) {
      ready()
      return undefined
    }
    const id = setTimeout(ready, left)
    return () => clearTimeout(id)
  }, [phase, state.since, seed])

  const report = state.report
  const videos = state.videos
  const steps: Step[] = [
    {
      id: 'channels',
      label: t('demo.step_channels'),
      status: phase === 'loading' ? 'running' : 'done',
      detail: report ? `${plural('channels', report.channels)} · ${plural('folders', report.folders)}` : undefined
    },
    {
      id: 'videos',
      label: t('demo.step_videos'),
      status: phase === 'loading' ? 'waiting' : phase === 'arriving' ? 'running' : 'done',
      detail: videos !== undefined && videos > 0 ? plural('videos', videos) : phase === 'ready' && state.late ? t('demo.videos_later') : undefined
    },
    { id: 'ready', label: t('demo.step_ready'), status: phase === 'ready' ? 'done' : 'waiting' }
  ]
  const progress = phase === 'loading' || phase === 'arriving' || phase === 'ready'
  const rssDown = progress && data?.rss_down_since != null
  const clearButton = (
    <Button variant="outline" size="sm" data-part="demo-clear" onClick={clear}>
      {t('demo.clear')}
    </Button>
  )

  return (
    <div data-part="demo" data-phase={phase}>
      <Stack gap={5}>
        {state.failed === 'clear' ? (
          <Banner tone="error" action={{ label: tc('retry'), onClick: clear }}>
            {t('demo.errors.clear')}
          </Banner>
        ) : null}
        {phase === 'error' ? (
          <Banner tone="error" action={{ label: tc('retry'), onClick: load }}>
            {t('demo.errors.load')}
          </Banner>
        ) : null}
        {rssDown ? <Banner tone="warning">{t('demo.rss_down')}</Banner> : null}

        {phase === 'checking' ? <StepProgressSkeleton count={3} /> : null}
        {progress ? <StepProgress steps={steps} label={t('demo.steps_label')} /> : null}
        {progress && report && report.skipped > 0 ? (
          <p className={cx('section-desc t-label')}>{t('demo.skipped', { count: report.skipped })}</p>
        ) : null}

        {phase === 'idle' || phase === 'error' ? (
          <Stack direction="row" justify="end">
            <Button size="sm" data-part="demo-load" onClick={load}>
              {t('demo.load')}
            </Button>
          </Stack>
        ) : null}

        {phase === 'loaded' ? (
          <EmptyView
            compact
            icon="beaker"
            title={t('demo.loaded_title')}
            description={t('demo.loaded_desc')}
            action={
              <>
                {clearButton}
                <Button size="sm" data-part="demo-open" onClick={onFinish}>
                  {t('done.open_now')}
                </Button>
              </>
            }
          />
        ) : null}

        {phase === 'cleared' ? (
          <EmptyView
            compact
            icon="check"
            title={t('demo.cleared_title')}
            description={t('demo.cleared_desc')}
            action={
              <Button variant="outline" size="sm" data-part="demo-load-again" onClick={load}>
                {t('demo.load_again')}
              </Button>
            }
          />
        ) : null}

        {/* during the load, nothing destructive: the way forward is seeing what has already arrived (clear comes back at the end) */}
        {phase === 'arriving' ? (
          <Stack direction="row" justify="end">
            <Button variant="outline" size="sm" data-part="demo-open" onClick={onFinish}>
              {t('done.open_now')}
            </Button>
          </Stack>
        ) : null}
        {phase === 'ready' ? (
          <Stack gap={3}>
            <Stack direction="row" justify="end">
              {clearButton}
            </Stack>
            <AutoClose onDone={onFinish} />
          </Stack>
        ) : null}
      </Stack>
    </div>
  )
}
