// Extension popup — the face of the extension: small, calm, no jargon. Three fully designed states:
//   1. not paired — what it is, the 6-digit code (submits itself on the 6th), "where do I find the code?", advanced;
//   2. paired — device, connection, last sync (`SyncStatus`), "Sync now", open in Hermes,
//      disconnect with confirmation;
//   3. problem — Hermes closed, token refused (pair again), not logged in to YouTube, other error.
// In any paired state, the unsubscribe queue card appears when there is something to show: queue items waiting
// for **Run now** / **Not now**, progress with **Stop**, stopped with **Resume**, held with the reason and **Try again**,
// finished with the result. The popup only releases (the ids it lists), stops and resumes — it neither chooses nor
// creates any item. "Run now" is the human click the executor needs before each round: it is written to
// `chrome.storage.session` (`lib/queue-release`), which content scripts cannot reach.
// Talks only to the background (`conn.status`, `pair.submit`, `pair.unpair`, `sync.now`, `queue.stop`, `queue.resume`) and
// only **reads** from `chrome.storage.local` what the service worker leaves for it (`sync_status`, `pair_info`, `pair_port`,
// `queue_run`, `queue_ctl`, `queue_ledger`, state cache). Never writes there. Never receives the token: changes to
// `STORAGE_KEYS.connection` only trigger a new `conn.status`, the value is not read.
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { ApiError } from '../../../shared/api-types'
import { STORAGE_KEYS, type ConnectionStatus, type QueueProgress, type SyncStatus } from '../../../shared/ext-messages'
import { DESKTOP_ROUTES } from '../../../shared/ids'
import { PAIR_INFO_KEY, PAIR_PORT_KEY, deviceName, type PairInfo } from '../background/pairing'
import { getLanguage, setLanguage } from '../lib/i18n'
import { sendRequest } from '../lib/messaging'
import {
  QUEUE_RELEASE_KEY,
  QUEUE_SNOOZE_KEY,
  QUEUE_WAITING_KEY,
  readRelease,
  readSnooze,
  readWaiting,
  releaseQueue,
  snoozeQueue,
  unreleased,
  type QueueRelease,
  type QueueWaiting
} from '../lib/queue-release'
import { queueView, type LedgerView, type QueueCtlView } from './queue-view'
import { isLoggedOut, isRunning, p, syncErrorText } from './text'
import { Device, Footer, Header, Problem, QueueCard, SyncButton, SyncCard, Unpaired, type PillState } from './views'

/** Plugin page in Hermes Desktop (`hermes://open/<route>` → app route). */
export const HERMES_URL = `hermes://open${DESKTOP_ROUTES.home}`
export const YOUTUBE_URL = 'https://www.youtube.com/'
/** Resume requested and no round started (nothing pending on the server): goes back to the summary after this. */
export const RESUMING_MS = 20_000

export interface AppProps {
  now?: () => number
}

const UNPAIRED: ConnectionStatus = { state: 'unpaired', port: null, device_id: null, last_ok_at: null, error: null }

type CachedState = { state?: { language?: string; queue_pending?: number }; fetched_at?: number } | undefined

function pendingOf(cache: CachedState): { count: number; at: number } | null {
  const count = cache?.state?.queue_pending
  return typeof count === 'number' && typeof cache?.fetched_at === 'number' ? { count, at: cache.fetched_at } : null
}

export function App({ now = Date.now }: AppProps) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [info, setInfo] = useState<PairInfo | null>(null)
  const [portOverride, setPortOverride] = useState<number | null>(null)
  const [syncRequested, setSyncRequested] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  // queue: read-only view of what the SW writes
  const [queueRun, setQueueRun] = useState<QueueProgress | null>(null)
  const [queueCtl, setQueueCtl] = useState<QueueCtlView | null>(null)
  const [ledger, setLedger] = useState<LedgerView | null>(null)
  const [pending, setPending] = useState<{ count: number; at: number } | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  // "Run now": what the SW listed, what was released and what was put off (chrome.storage.session)
  const [waiting, setWaiting] = useState<QueueWaiting | null>(null)
  const [release, setRelease] = useState<QueueRelease | null>(null)
  const [snoozed, setSnoozed] = useState<string[]>([])
  const [, setTick] = useState(0)

  const refreshConn = useCallback(async (probe = false) => {
    if (probe) setChecking(true)
    const res = await sendRequest('conn.status', probe ? { probe: true } : {})
    if (probe) setChecking(false)
    if (res.ok) setConn(res.data)
    else setConn((c) => c ?? UNPAIRED)
  }, [])

  // opening: what the SW left stored, quick state (no network) and then the probe
  useEffect(() => {
    let alive = true
    void (async () => {
      const got = await chrome.storage.local.get([
        STORAGE_KEYS.syncStatus,
        STORAGE_KEYS.stateCache,
        PAIR_INFO_KEY,
        PAIR_PORT_KEY,
        STORAGE_KEYS.queueRun,
        STORAGE_KEYS.queueCtl,
        STORAGE_KEYS.queueLedger
      ])
      if (!alive) return
      const cache = got[STORAGE_KEYS.stateCache] as CachedState
      const lang = cache?.state?.language
      if (lang) setLanguage(lang)
      document.documentElement.lang = getLanguage()
      setSync((got[STORAGE_KEYS.syncStatus] as SyncStatus | undefined) ?? null)
      setInfo((got[PAIR_INFO_KEY] as PairInfo | undefined) ?? null)
      const port = got[PAIR_PORT_KEY]
      setPortOverride(typeof port === 'number' ? port : null)
      setQueueRun((got[STORAGE_KEYS.queueRun] as QueueProgress | undefined) ?? null)
      setQueueCtl((got[STORAGE_KEYS.queueCtl] as QueueCtlView | undefined) ?? null)
      setLedger((got[STORAGE_KEYS.queueLedger] as LedgerView | undefined) ?? null)
      setPending(pendingOf(cache))
      await readSessionQueue()
      await refreshConn(false)
      if (alive) await refreshConn(true)
    })()

    async function readSessionQueue(): Promise<void> {
      const [wt, rl, sn] = await Promise.all([readWaiting(), readRelease(), readSnooze()])
      if (!alive) return
      setWaiting(wt)
      setRelease(rl)
      setSnoozed(sn)
    }

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session') {
        if (QUEUE_WAITING_KEY in changes || QUEUE_RELEASE_KEY in changes || QUEUE_SNOOZE_KEY in changes) void readSessionQueue()
        return
      }
      if (area !== 'local') return
      if (STORAGE_KEYS.syncStatus in changes) {
        const next = (changes[STORAGE_KEYS.syncStatus].newValue as SyncStatus | undefined) ?? null
        setSync(next)
        if (!next || next.state !== 'running') setSyncRequested(null)
      }
      if (PAIR_INFO_KEY in changes) setInfo((changes[PAIR_INFO_KEY].newValue as PairInfo | undefined) ?? null)
      if (STORAGE_KEYS.queueRun in changes) {
        const next = (changes[STORAGE_KEYS.queueRun].newValue as QueueProgress | undefined) ?? null
        setQueueRun(next)
        if (!next || next.state !== 'running') setStopRequested(false)
        // the round started (or stopped/held again): "resuming…" is over
        if (!next || next.state !== 'idle') setResuming(false)
      }
      if (STORAGE_KEYS.queueCtl in changes) setQueueCtl((changes[STORAGE_KEYS.queueCtl].newValue as QueueCtlView | undefined) ?? null)
      if (STORAGE_KEYS.queueLedger in changes) setLedger((changes[STORAGE_KEYS.queueLedger].newValue as LedgerView | undefined) ?? null)
      if (STORAGE_KEYS.stateCache in changes) setPending(pendingOf(changes[STORAGE_KEYS.stateCache].newValue as CachedState))
      // credential changed (paired, new port, new state, erased): ask the background; the value is not read
      if (STORAGE_KEYS.connection in changes) void refreshConn(false)
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [refreshConn])

  const t0 = now()
  const running = syncRequested !== null || isRunning(sync, t0)
  const waitingItems = unreleased(waiting, release, snoozed)
  const queue = queueView({ run: queueRun, ctl: queueCtl, ledger, pending, now: t0, stopRequested, resuming, waiting: waitingItems })
  const queueMoving = queue?.state === 'running' || queue?.state === 'stopping' || queue?.state === 'resuming'

  // clock: "12 s ago" ticks while syncing or while the queue runs; the rest every 15 s
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), running || queueMoving ? 1000 : 15_000)
    return () => clearInterval(id)
  }, [running, queueMoving])

  // Resume without a new round (nothing authorized on the server): "resuming…" does not last forever
  useEffect(() => {
    if (!resuming) return
    const id = setTimeout(() => setResuming(false), RESUMING_MS)
    return () => clearTimeout(id)
  }, [resuming])

  async function submitCode(code: string, port: number | null): Promise<ApiError | null> {
    // the advanced port goes as a parameter; the background remembers the choice
    const res = await sendRequest('pair.submit', port === null ? { code } : { code, port })
    setPortOverride(port)
    if (!res.ok) return res.error
    setConn(res.data)
    return null
  }

  async function syncNow(): Promise<void> {
    setSyncError(null)
    setSyncRequested(now())
    const res = await sendRequest('sync.now', {})
    if (!res.ok) {
      setSyncRequested(null)
      setSyncError(syncErrorText(res.error.code))
      if (res.error.code === 'unauthorized') void refreshConn(false)
      return
    }
    if (!res.data.started) {
      setSyncRequested(null)
      setSyncError(syncErrorText('not_started'))
    }
  }

  /** Stop: only asks the background (which records the stop); the item in progress finishes. */
  async function onQueueStop(): Promise<void> {
    setQueueError(null)
    setQueueBusy(true)
    setStopRequested(true)
    const res = await sendRequest('queue.stop', {})
    setQueueBusy(false)
    if (!res.ok) {
      setStopRequested(false)
      setQueueError(p('queue_err'))
    }
  }

  /** Resume / Try again: the background releases the queue; what runs still comes from the server. */
  async function onQueueResume(): Promise<void> {
    setQueueError(null)
    setQueueBusy(true)
    setResuming(true)
    const res = await sendRequest('queue.resume', {})
    setQueueBusy(false)
    if (!res.ok) {
      setResuming(false)
      setQueueError(p('queue_err'))
    }
  }

  /**
   * Run now: releases exactly the ids the card lists (session storage), then asks the background for a fresh state —
   * the round still takes its items from the server, one by one, and only these ids.
   */
  async function onQueueRunNow(ids: string[]): Promise<void> {
    if (!ids.length) return
    setQueueError(null)
    setQueueBusy(true)
    setResuming(true)
    try {
      await releaseQueue(ids)
      const res = await sendRequest('queue.resume', {})
      if (!res.ok) throw new Error(res.error.code)
    } catch {
      setResuming(false)
      setQueueError(p('queue_err'))
    } finally {
      setQueueBusy(false)
    }
  }

  /** Not now: these items stay in the Hermes queue and wait; the badge goes away until something new arrives. */
  async function onQueueNotNow(ids: string[]): Promise<void> {
    setQueueError(null)
    await snoozeQueue(ids)
    setSnoozed((s) => [...new Set([...s, ...ids])])
  }

  async function unpair(): Promise<void> {
    const res = await sendRequest('pair.unpair', {})
    setSync(null)
    setInfo(null)
    setPortOverride(null)
    setSyncRequested(null)
    setSyncError(null)
    setQueueRun(null)
    setQueueCtl(null)
    setLedger(null)
    setStopRequested(false)
    setResuming(false)
    setConn(res.ok ? res.data : UNPAIRED)
  }

  const open = (url: string) => void chrome.tabs.create({ url })

  const state = conn?.state ?? null
  const pill: PillState = !conn ? 'loading' : checking && state !== 'connected' && state !== 'unpaired' ? 'checking' : conn.state

  const queueCard = queue ? (
    <QueueCard
      view={queue}
      busy={queueBusy}
      error={queueError}
      onStop={() => void onQueueStop()}
      onResume={() => void onQueueResume()}
      onOpenYouTube={() => open(YOUTUBE_URL)}
      onRunNow={() => void onQueueRunNow(queue.ids ?? [])}
      onNotNow={() => void onQueueNotNow(queue.ids ?? [])}
    />
  ) : null

  let body
  if (!conn) {
    body = (
      <div class="pane skeleton" aria-busy="true">
        <p class="sr-only">{p('loading')}</p>
        <span class="sk sk-line" />
        <span class="sk sk-line sk-short" />
        <span class="sk sk-block" />
      </div>
    )
  } else if (conn.state === 'unpaired') {
    body = <Unpaired initialAddress={portOverride ? `http://127.0.0.1:${portOverride}` : ''} onSubmit={submitCode} />
  } else {
    const device = (
      <Device
        name={info?.device_name ?? deviceName()}
        pairedAt={info?.paired_at ?? null}
        lastOkAt={conn.last_ok_at}
        connected={conn.state === 'connected'}
        port={conn.port}
        deviceId={conn.device_id}
        now={t0}
      />
    )
    const footer = <Footer onOpenHermes={() => open(HERMES_URL)} onDisconnect={unpair} />
    const retry = (
      <button type="button" class="btn btn-primary" data-testid="problem-retry" disabled={checking} onClick={() => void refreshConn(true)}>
        {checking ? p('checking') : p('retry')}
      </button>
    )
    if (conn.state === 'unauthorized') {
      body = (
        <div class="pane">
          <Problem kind="unauthorized">
            <button type="button" class="btn btn-primary" data-testid="pair-again" onClick={() => void unpair()}>
              {p('pair_again')}
            </button>
          </Problem>
          {queueCard}
        </div>
      )
    } else if (conn.state === 'reconnect_needed') {
      body = (
        <div class="pane">
          <Problem kind="closed">
            {retry}
            <button type="button" class="btn btn-secondary" data-testid="open-hermes-problem" onClick={() => open(HERMES_URL)}>
              {p('open_hermes')}
            </button>
          </Problem>
          {queueCard}
          {device}
          {footer}
        </div>
      )
    } else if (conn.state === 'error') {
      body = (
        <div class="pane">
          <Problem kind="error" body={connErrorText(conn.error)}>
            {retry}
          </Problem>
          {queueCard}
          {device}
          {footer}
        </div>
      )
    } else if (isLoggedOut(sync) && !running) {
      body = (
        <div class="pane">
          <Problem kind="logged_out">
            <button type="button" class="btn btn-primary" data-testid="open-youtube" onClick={() => open(YOUTUBE_URL)}>
              {p('open_youtube')}
            </button>
            <SyncButton running={running} onClick={() => void syncNow()} quiet />
          </Problem>
          {queueCard}
          {device}
          {footer}
        </div>
      )
    } else {
      body = (
        <div class="pane">
          {queueCard}
          {device}
          <SyncCard
            sync={sync}
            running={running}
            startedAt={isRunning(sync, t0) ? (sync?.started_at ?? null) : null}
            error={syncError}
            now={t0}
            onSyncNow={() => void syncNow()}
          />
          {footer}
        </div>
      )
    }
  }

  return (
    <main class="popup" data-testid="conn-state" data-state={state ?? ''} aria-busy={conn ? undefined : 'true'}>
      <Header pill={pill} />
      {body}
    </main>
  )
}

/** `error` connection state (transport error stored by the client): text by code. */
function connErrorText(err: ApiError | null): string {
  const code = err?.code as string | undefined
  if (code === 'plugin_disabled') return p('err_plugin_disabled')
  if (code === 'timeout') return p('err_timeout')
  if (code && ['origin_forbidden', 'origin_mismatch', 'host_forbidden'].includes(code)) return p('err_refused')
  return p('problem_error_body')
}
