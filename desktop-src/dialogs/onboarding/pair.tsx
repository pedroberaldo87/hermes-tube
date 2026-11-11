// Path 1 — connect the extension. First "Set up the extension" (setup.tsx: Hermes copies the bundled extension
// and opens Chrome; the screen lists the gestures Chrome still needs). Then `callRpc('pair.start')` (falls back to POST /pair/start without RPC) →
// big code with countdown and copy; numbered step by step; live wait (GET /devices every 2 s with the
// window visible) until the new device shows up; then follows the first sync until the channels arrive (the
// total grew) or the extension delivered a read (`ext_last_sync_at` in GET /status moved past the one known
// when the code was generated — a re-pairing that brings no new channel) and closes by itself. Expired code → another with one click. The code only lives in screen state:
// it never goes to a log, notification or storage.
import { Button, Codicon } from '@hermes/plugin-sdk'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { Device, ExtensionSetupResult, StatusResponse } from '../../../shared/api-types'
import { MESSAGE_KEYS, STATUS_POLL_MS } from '../../../shared/ids'
import {
  Banner,
  EmptyView,
  PairingCode,
  PairingCodeSkeleton,
  Stack,
  type Step,
  StepProgress,
  StepProgressSkeleton,
  formatNumber,
  useLocale
} from '../../components'
import { useT } from '../../lib/i18n'
import { invalidateRest, useRest } from '../../lib/rest'
import { callRpc } from '../../lib/rpc'
import { cx } from '../../lib/style'
import { LIVE_POLL_MS, type PairErrorKind, SYNC_PATIENCE_MS, findNewDevice, pairErrorKind } from './model'
import { AutoClose, usePlural, useWindowVisible } from './parts'
import { ExtensionSetup } from './setup'

export type PairPhase = 'starting' | 'waiting' | 'expired' | 'syncing' | 'done' | 'error'

export interface PairState {
  phase: PairPhase
  code?: string
  /** ms since the epoch. */
  expiresAt?: number
  /** When the code was generated (ms). */
  issuedAt?: number
  /** Ids of the devices that already existed when the code was generated (`null` = not known yet). */
  baseline?: string[] | null
  /** Total channels when the code was generated (`null` = not known yet). */
  channelsBefore?: number | null
  /** `ext_last_sync_at` when the code was generated (`null` = no read yet; `undefined` = not known, or an
   * older backend without the field). */
  syncBefore?: number | null
  device?: Device
  syncSince?: number
  /** When `GET /status` showed a read newer than `syncBefore` (ms); the next channel count closes the step. */
  syncSeenAt?: number
  total?: number
  error?: PairErrorKind
  /** Preview/tests only: the setup part starts as if "Set up the extension" had already answered. */
  setup?: ExtensionSetupResult
}

/** `ext_last_sync_at` of the status: `undefined` when the backend does not send the field. */
export function lastSyncAt(status: StatusResponse | undefined): number | null | undefined {
  if (!status || !('ext_last_sync_at' in status)) return undefined
  return typeof status.ext_last_sync_at === 'number' ? status.ext_last_sync_at : null
}

/** A subscription read arrived after the code: newer than the one known then; without that baseline, not
 * older than the paired device (both are server clocks). */
export function readArrived(at: number | null | undefined, before: number | null | undefined, device?: Device): boolean {
  if (typeof at !== 'number') return false
  if (typeof before === 'number') return at > before
  if (before === null) return true
  return device !== undefined && at >= device.created_at
}

export interface PairPanelProps {
  /** Fixed initial state (preview); without it the pane asks for a code on mount. */
  seed?: PairState
  /** Close and tell Home. */
  onFinish: () => void
  /** Something changed in the library (tell Home on close). */
  onDirty: () => void
  /** The phase changed (the dialog swaps the subtitle: once paired, it states the status instead of asking for the code). */
  onPhase?: (phase: PairPhase) => void
  /** Shown under the setup part (the connected browsers); after everything once the browser paired. */
  aside?: ReactNode
}

export function PairPanel({ seed, onFinish, onDirty, onPhase, aside }: PairPanelProps) {
  const t = useT('onboarding')
  const tc = useT()
  const locale = useLocale()
  const plural = usePlural()
  const visible = useWindowVisible()
  const [state, setState] = useState<PairState>(seed ?? { phase: 'starting' })
  const [slow, setSlow] = useState(false)
  const { phase } = state
  const waiting = phase === 'waiting' || phase === 'expired'
  const syncing = phase === 'syncing'

  useEffect(() => {
    onPhase?.(phase)
  }, [phase, onPhase])

  const devices = useRest('GET /devices', {}, { refetchInterval: visible && waiting ? LIVE_POLL_MS : false })
  const channels = useRest('GET /channels', { query: { limit: 1 } }, { refetchInterval: visible && syncing ? LIVE_POLL_MS : false })
  const status = useRest('GET /status', {}, { refetchInterval: visible && (waiting || syncing) ? STATUS_POLL_MS : false })

  // the `pair.start` callback reads the latest query data without depending on them
  const devicesRef = useRef(devices.data)
  devicesRef.current = devices.data
  const channelsRef = useRef(channels.data)
  channelsRef.current = channels.data
  const statusRef = useRef(status.data)
  statusRef.current = status.data
  const request = useRef(0)
  const mounted = useRef(true)

  const start = useCallback(() => {
    const token = ++request.current
    setSlow(false)
    setState({ phase: 'starting' })
    void callRpc('pair.start', {}).then((out) => {
      if (!mounted.current || token !== request.current) return
      if (out.kind === 'ok') {
        setState({
          phase: 'waiting',
          code: out.data.code,
          expiresAt: out.data.expires_at * 1000,
          issuedAt: Date.now(),
          baseline: devicesRef.current ? devicesRef.current.items.map((d) => d.id) : null,
          channelsBefore: channelsRef.current ? channelsRef.current.total : null,
          syncBefore: lastSyncAt(statusRef.current)
        })
      } else {
        setState({ phase: 'error', error: out.kind === 'error' ? pairErrorKind(out.error) : 'generic' })
      }
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    if (!seed) start()
    return () => {
      mounted.current = false
    }
    // only on mount: the seed is fixed
  }, [])

  // code expires → "expired" state (PairingCode also fades by its own clock)
  useEffect(() => {
    if (phase !== 'waiting' || state.expiresAt === undefined) return undefined
    const expire = () => setState((s) => (s.phase === 'waiting' ? { ...s, phase: 'expired' } : s))
    const ms = state.expiresAt - Date.now()
    if (ms <= 0) {
      expire()
      return undefined
    }
    const id = setTimeout(expire, ms)
    return () => clearTimeout(id)
  }, [phase, state.expiresAt])

  // baselines that were not loaded yet when the code arrived: fill them while no browser is paired (otherwise
  // a library that already has channels would count as "the list grew" from zero)
  useEffect(() => {
    if (!waiting || seed) return
    const total = channels.data?.total
    const synced = lastSyncAt(status.data)
    setState((s) => {
      if (s.phase !== 'waiting' && s.phase !== 'expired') return s
      let next = s
      if (s.channelsBefore == null && total !== undefined) next = { ...next, channelsBefore: total }
      if (s.syncBefore === undefined && synced !== undefined) next = { ...next, syncBefore: synced }
      return next
    })
  }, [waiting, channels.data, status.data, seed])

  // live wait: a new device appeared → connected, follow the sync
  useEffect(() => {
    if (!waiting || !devices.data || seed) return
    const found = findNewDevice(devices.data.items, state.baseline ?? null, (state.issuedAt ?? Date.now()) / 1000)
    if (!found) return
    onDirty()
    setState((s) => ({ ...s, phase: 'syncing', device: found, syncSince: Date.now() }))
    void invalidateRest('GET /channels', 'GET /status')
  }, [devices.data, waiting, state.baseline, state.issuedAt, seed, onDirty])

  // the extension delivered a read after the code (even with zero new channels) → recount, then ready
  useEffect(() => {
    if (!syncing || seed || state.syncSeenAt !== undefined) return
    if (!readArrived(lastSyncAt(status.data), state.syncBefore, state.device)) return
    setState((s) => (s.phase === 'syncing' && s.syncSeenAt === undefined ? { ...s, syncSeenAt: Date.now() } : s))
    void invalidateRest('GET /channels')
  }, [status.data, syncing, state.syncSeenAt, state.syncBefore, state.device, seed])

  // channels arrived (the list grew since the code) or a count taken after the read → ready
  useEffect(() => {
    if (!syncing || !channels.data || seed) return
    const total = channels.data.total
    const grew = total > (state.channelsBefore ?? 0)
    const read = state.syncSeenAt !== undefined && channels.dataUpdatedAt >= state.syncSeenAt
    if (grew || read) {
      setState((s) => ({ ...s, phase: 'done', total }))
      void invalidateRest('GET /tabs', 'GET /feed', 'GET /status')
    }
  }, [channels.data, channels.dataUpdatedAt, syncing, state.channelsBefore, state.syncSeenAt, seed])

  // slow first read → "you can close this, the channels will appear on their own"
  useEffect(() => {
    if (!syncing) return undefined
    const left = (state.syncSince ?? Date.now()) + SYNC_PATIENCE_MS - Date.now()
    if (left <= 0) {
      setSlow(true)
      return undefined
    }
    const id = setTimeout(() => setSlow(true), left)
    return () => clearTimeout(id)
  }, [syncing, state.syncSince])

  const n = (i: number) => `${formatNumber(i, locale)}.`
  const name = state.device?.name?.trim() || t('pair.unnamed')
  const connected = phase === 'syncing' || phase === 'done'
  const steps: Step[] = [
    {
      id: 'open',
      label: `${n(1)} ${t('pair.step_open')}`,
      status: connected ? 'done' : phase === 'waiting' ? 'running' : 'waiting',
      // connected: the device name is already in the success message just above (nothing repeated)
      detail: connected ? undefined : t('pair.step_open_detail')
    },
    {
      id: 'read',
      label: `${n(2)} ${t('pair.step_read')}`,
      status: phase === 'syncing' ? 'running' : phase === 'done' ? 'done' : 'waiting',
      detail: t('pair.step_read_detail')
    },
    {
      id: 'ready',
      label: `${n(3)} ${t('pair.step_ready')}`,
      status: phase === 'done' ? 'done' : 'waiting'
    }
  ]

  const endpointDown = status.data?.ext_endpoint_up === false && !(phase === 'error' && state.error === 'ext_endpoint_down')

  // two columns while the setup part is on screen (it steps aside once the browser pairs): the setup and the
  // browser list on the left; the code, its expiry, "Copy code" and the live wait on the right (the CSS puts them
  // side by side only when the dialog is wide enough, otherwise one compact column in the same order)
  const columns = connected ? '1' : '2'
  return (
    <div data-part="pair" data-phase={phase} data-columns={columns} className={cx('obpair')}>
      {connected ? null : (
        <div data-part="pair-side" className={cx('obpair-side')}>
          {/* first the extension itself ("Set up the extension") */}
          <ExtensionSetup connected={connected} seedResult={seed?.setup} />
          {aside}
        </div>
      )}
      <div data-part="pair-main" className={cx('obpair-main')}>
        {endpointDown ? (
          <Banner tone="warning" icon="debug-disconnect" title={tc(MESSAGE_KEYS.reconnectOpenHermes)}>
            {t('pair.endpoint_down')}
          </Banner>
        ) : null}

        {phase === 'error' && state.error ? (
          <Banner tone="error" title={t(`pair.errors.${state.error}.title`)} action={{ label: tc('retry'), onClick: start }}>
            {t(`pair.errors.${state.error}.body`)}
          </Banner>
        ) : null}

        {phase === 'starting' ? <PairingCodeSkeleton /> : null}

        {(phase === 'waiting' || phase === 'expired') && state.code && state.expiresAt !== undefined ? (
          <Stack gap={3} align="center">
            <PairingCode
              key={`${state.code}:${state.expiresAt}`}
              code={state.code}
              expiresAt={state.expiresAt}
              onRegenerate={start}
              label={t('pair.code_label')}
            />
            <div className={cx('t-label')} role="status" aria-live="polite" data-part="pair-live">
              {phase === 'waiting' ? (
                <Stack direction="row" gap={2} align="center">
                  <Codicon name="loading" size={12} spinning />
                  <span>{t('pair.waiting')}</span>
                </Stack>
              ) : (
                t('pair.expired_hint')
              )}
            </div>
          </Stack>
        ) : null}

        {connected ? (
          <div role="status" aria-live="polite" data-part="pair-success">
            <EmptyView
              compact
              icon={phase === 'done' ? 'pass-filled' : 'plug'}
              title={phase === 'done' ? t('pair.done_title') : t('pair.connected_title', { name })}
              description={phase === 'done' && state.total !== undefined ? plural('channels', state.total) : t('pair.connected_desc')}
            />
          </div>
        ) : null}

        {phase === 'starting' ? <StepProgressSkeleton count={3} /> : phase === 'error' ? null : <StepProgress steps={steps} label={t('pair.steps_label')} />}

        {phase === 'syncing' && slow ? (
          <Stack direction="row" gap={3} justify="between" align="center" wrap>
            <p className={cx('t-label')}>{t('pair.slow')}</p>
            <Button variant="outline" size="sm" data-part="pair-close" onClick={onFinish}>
              {t('pair.close')}
            </Button>
          </Stack>
        ) : null}

        {phase === 'done' ? <AutoClose onDone={onFinish} /> : null}
      </div>
      {connected ? aside : null}
    </div>
  )
}
