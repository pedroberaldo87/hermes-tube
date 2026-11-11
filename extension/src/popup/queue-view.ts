// Unsubscribe queue card in the popup: from what the service worker left in `chrome.storage.local`
// (`queue_run` = `QueueProgress`, `queue_ctl`, `queue_ledger`, `state_cache.queue_pending`) to what the screen shows.
// Pure function, no effects: the popup only **reads** this state; stopping and resuming are messages to the background.
// Texts come from the `popup` namespace, chosen by `state`/`hold_reason`/reason — the `message` the SW wrote (in
// its language at the time) is not used.
import type { QueueHoldReason, QueueProgress } from '../../../shared/ext-messages'
import type { WaitingItem } from '../lib/queue-release'
import { p, plural, relTime } from './text'

/** `running`: round in progress · `stopping`: Stop requested, finishes the current channel · `stopped`: stopped until Resume ·
 *  `held`: held for a reason (logged out, verification, failures, cap) · `done`: round finished ·
 *  `resuming`: Resume requested, waiting for the round to start ·
 *  `waiting`: queue items wait for **Run now** (nothing runs on YouTube before that click) */
export type QueueCardState = 'running' | 'stopping' | 'stopped' | 'held' | 'done' | 'resuming' | 'waiting'

/** How many channel names the "Run now" card lists before "and N more". */
export const WAITING_SHOWN = 5

export interface QueueCtlView {
  stopped?: boolean
  /** `popup`, `overlay`, `tab`, `page` */
  by?: string
  at?: number
}

export type LedgerView = Record<string, { status?: string; error?: string | null; at?: number }>

export interface QueueInputs {
  run: QueueProgress | null
  ctl: QueueCtlView | null
  ledger: LedgerView | null
  /** `queue_pending` from the last `ExtState` (cache) and when it was read */
  pending: { count: number; at: number } | null
  now: number
  /** the user clicked Stop during this popup opening (before the SW wrote it) */
  stopRequested: boolean
  /** the user clicked Resume and the round has not started yet */
  resuming: boolean
  /** queue items not yet released by "Run now" (nor put off with "Not now") */
  waiting?: WaitingItem[]
}

export interface QueueView {
  state: QueueCardState
  /** title of the reason (`held` only) */
  heading: string | null
  /** main line (announced) */
  line: string
  notes: string[]
  /** readable reasons for the failures (grouped) */
  failures: string[]
  holdReason: QueueHoldReason | null
  /** `waiting` only: the channels listed (at most `WAITING_SHOWN` lines + "and N more") */
  channels?: string[]
  /** `waiting` only: the ids "Run now" releases — exactly the ones counted on the card */
  ids?: string[]
}

function waitingView(items: WaitingItem[]): QueueView {
  const count = items.length
  const allUnsub = items.every((i) => i.action === 'unsubscribe')
  const lines = items.slice(0, WAITING_SHOWN).map((i) => {
    const channel = i.channel_title || i.channel_id
    return i.action === 'resubscribe' ? p('queue_waiting_resubscribe_item', { channel }) : channel
  })
  if (count > WAITING_SHOWN) lines.push(p('queue_waiting_more', { count: count - WAITING_SHOWN }))
  return {
    state: 'waiting',
    heading: null,
    line: plural(allUnsub ? 'queue_waiting' : 'queue_waiting_changes', count),
    notes: [p('queue_waiting_note')],
    failures: [],
    holdReason: null,
    channels: lines,
    ids: items.map((i) => i.id)
  }
}

/** A finished round stays in view for a day; after that the card disappears. */
export const DONE_VISIBLE_MS = 24 * 3600_000

const FAIL_REASONS = new Set([
  'button_not_found',
  'confirm_not_found',
  'state_unchanged',
  'wrong_channel',
  'logged_out',
  'challenge',
  'timeout',
  'stopped',
  'interrupted',
  'tab_closed',
  'invalid_item',
  'page_error'
])

/** Stable executor reason → human sentence. */
export function queueReasonText(reason: string | null | undefined): string {
  return p(`queue_reason_${reason && FAIL_REASONS.has(reason) ? reason : 'other'}`)
}

function progressLine(run: QueueProgress): string {
  const channel = run.channel_title || run.channel_id || ''
  if (!run.action || run.index <= 0) return p('queue_starting')
  return p(`queue_running_${run.action === 'resubscribe' ? 'resubscribe' : 'unsubscribe'}`, {
    index: run.index,
    total: Math.max(run.total, run.index),
    channel
  })
}

/** How many are left: the server's count, if newer than the round; otherwise what remains of the round. */
function remaining(run: QueueProgress, pending: QueueInputs['pending']): number {
  if (pending && Number.isFinite(pending.count) && pending.at >= run.updated_at) return Math.max(0, pending.count)
  return Math.max(0, run.total - run.index)
}

/** Failures of this round (ledger from its start), grouped by reason, in the order they happened. */
function failuresOf(run: QueueProgress, ledger: LedgerView | null): string[] {
  const since = run.started_at ?? Number.POSITIVE_INFINITY
  const entries = Object.values(ledger ?? {})
    .filter((e) => e && e.status === 'failed' && typeof e.at === 'number' && e.at >= since)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const reasons = entries.map((e) => e.error ?? null)
  if (reasons.length === 0 && run.last?.status === 'failed') reasons.push(run.last.error)
  const counts = new Map<string, number>()
  for (const r of reasons) {
    const text = queueReasonText(r)
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return [...counts].map(([text, n]) => (n > 1 ? `${n} × ${text}` : text))
}

export function queueView(i: QueueInputs): QueueView | null {
  const run = i.run && typeof i.run === 'object' ? i.run : null
  const base = { heading: null, notes: [] as string[], failures: [] as string[], holdReason: null }

  if (run?.state === 'running') {
    if (i.stopRequested || i.ctl?.stopped) return { ...base, state: 'stopping', line: progressLine(run), notes: [p('queue_stopping')] }
    return { ...base, state: 'running', line: progressLine(run), notes: [p('queue_running_note')] }
  }
  if (i.resuming) return { ...base, state: 'resuming', line: p('queue_resuming'), notes: [p('queue_resuming_note')] }
  // queue items wait for the click: this comes before any other summary
  if (i.waiting?.length) return waitingView(i.waiting)
  if (!run) return null

  if (run.state === 'stopped') {
    const left = remaining(run, i.pending)
    return {
      ...base,
      state: 'stopped',
      line: left > 0 ? plural('queue_stopped', left) : p('queue_stopped'),
      notes: [p(i.ctl?.by === 'tab' ? 'queue_stopped_tab' : 'queue_stopped_note')]
    }
  }

  const hold = run.hold_reason
  if (run.state === 'paused' && hold && typeof run.hold_until === 'number' && run.hold_until > i.now) {
    const when = relTime(run.hold_until, i.now)
    return {
      state: 'held',
      holdReason: hold,
      heading: p(`queue_held_${hold}_title`, { count: Math.max(run.index, run.done + run.failed) }),
      line: p(`queue_held_${hold}_body`),
      notes: [p(hold === 'cap' ? 'queue_held_cap_until' : 'queue_held_until', { when })],
      failures: hold === 'failures' ? failuresOf(run, null).slice(-1) : []
    }
  }

  const finished = run.done + run.failed
  if (finished > 0 && i.now - run.updated_at < DONE_VISIBLE_MS) {
    const parts: string[] = []
    if (run.done > 0) parts.push(plural(`queue_done_${run.action === 'resubscribe' ? 'resubscribe' : 'unsubscribe'}`, run.done))
    if (run.failed > 0) parts.push(plural('queue_failed', run.failed))
    return {
      ...base,
      state: 'done',
      line: parts.join(' · '),
      notes: [p('queue_finished', { when: relTime(run.updated_at, i.now) })],
      failures: run.failed > 0 ? failuresOf(run, i.ledger) : []
    }
  }
  return null
}
