// Pure Cleanup rules (no React): groups, what shows in the list, the merged queue (server + optimistic),
// the status strip and the plural. Nothing here calls the network.
import type { AiStatus, ChannelRow, CleanupCandidate, CleanupGroup, QueueAction, QueueItem, StatusResponse } from '../../../shared/api-types'
import { JOB_POLL_MS, PLUGIN_ID } from '../../../shared/ids'
import { pickExtNotice } from '../../lib/ext-notice'
import type { Translate } from '../../lib/i18n'
import { TubeApiError, toApiError } from '../../lib/rest'

/** Order of the groups on screen; `manual` only shows when it has someone. */
export const GROUPS: readonly CleanupGroup[] = ['stale', 'ignored', 'off_profile', 'manual']

/** The three rule groups (skeleton, invite). In the list, a group with nobody does not show. */
export const RULE_GROUPS: readonly CleanupGroup[] = ['stale', 'ignored', 'off_profile']

/** Numbers a candidate row can show after the reason. */
export type RowFact = 'watched' | 'last_video' | 'per_week'

/**
 * What each group's reason already says (not repeated in the row): "No new video in 391 days" already is the last
 * video (and 0 per week); "41 videos in 90 days and none watched" already is the volume and the watched count.
 */
export const SAID_BY_REASON: Readonly<Record<CleanupGroup, readonly RowFact[]>> = {
  stale: ['last_video', 'per_week'],
  ignored: ['watched', 'per_week'],
  off_profile: [],
  manual: []
}

/** Backend reason without the trailing period (a " · " follows right after; "391 dias. ·" is a defect). */
export function trimReason(why: string): string {
  return why.trim().replace(/\s*[.。]+$/u, '').trim()
}

/** Retention of Former subscriptions (`ex_retention_days` default). Not served by a route yet. */
export const EX_RETENTION_DAYS = 30

/** Duration of the toast with "Undo" (and of the "Keep" delay). */
export const UNDO_MS = 7000

/** Queue with an approved/in-progress item: polls every 2 s (the `queue.changed` event only brings it forward). */
export const QUEUE_POLL_MS = JOB_POLL_MS

/** Idle queue: polls slowly (the extension can fail/finish an item without an event). */
export const QUEUE_IDLE_POLL_MS = 30_000

/** Finished items stay in view for a day. */
export const QUEUE_RECENT_S = 24 * 3600

/** States the screen asks `GET /queue` for (`undone` leaves the queue). */
export const QUEUE_STATUSES = 'approved,running,done,failed'

/** Prefix of optimistic items (before the RPC response). */
export const LOCAL_PREFIX = 'local:'

export function isActive(item: Pick<QueueItem, 'status'>): boolean {
  return item.status === 'approved' || item.status === 'running'
}

/** Plural key (`_one`/`_other`) with the count already formatted in the app language. */
export function plural(t: Translate, key: string, count: number, fmt: (n: number) => string, vars: Record<string, string | number> = {}): string {
  return t(`${key}_${count === 1 ? 'one' : 'other'}`, { ...vars, count: fmt(count) })
}

/** Optimistic item (same shape as the contract) while the RPC has not answered. */
export function localItem(channelId: string, action: QueueAction, nowS: number): QueueItem {
  return {
    id: `${LOCAL_PREFIX}${action}:${channelId}`,
    channel_id: channelId,
    action,
    status: 'approved',
    approved_at: nowS,
    approved_via: 'desktop_rpc',
    created_at: nowS,
    updated_at: nowS,
    reason: null,
    error: null,
    device_id: null
  }
}

/**
 * Queue shown: what the server says (wins by id) + the local items it has not shown yet, minus the ones
 * undone on screen. Active always; finished ones from the last 24 h. Execution order (oldest first).
 */
export function mergeQueue(server: readonly QueueItem[] | undefined, local: readonly QueueItem[], hidden: ReadonlySet<string>, nowS: number): QueueItem[] {
  const byId = new Map<string, QueueItem>()
  for (const it of server ?? []) byId.set(it.id, it)
  for (const it of local) {
    if (byId.has(it.id)) continue
    if (it.id.startsWith(LOCAL_PREFIX) && [...byId.values()].some((s) => s.channel_id === it.channel_id && s.action === it.action && isActive(s))) continue
    byId.set(it.id, it)
  }
  return [...byId.values()]
    .filter((it) => !hidden.has(it.id) && it.status !== 'undone' && (isActive(it) || nowS - it.updated_at <= QUEUE_RECENT_S))
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

/** Channels with an active request for an action (they leave the candidates list / show "Queued"). */
export function activeChannels(queue: readonly QueueItem[], action: QueueAction): Set<string> {
  return new Set(queue.filter((it) => it.action === action && isActive(it)).map((it) => it.channel_id))
}

/** Candidates in view per group: pending, with no active request and not dismissed on screen. */
export function groupCandidates(
  candidates: readonly CleanupCandidate[],
  hiddenChannels: ReadonlySet<string>
): Record<CleanupGroup, CleanupCandidate[]> {
  const out: Record<CleanupGroup, CleanupCandidate[]> = { stale: [], ignored: [], off_profile: [], manual: [] }
  const seen = new Set<string>()
  for (const c of candidates) {
    if (c.status !== 'pending' || hiddenChannels.has(c.channel_id) || seen.has(c.channel_id)) continue
    seen.add(c.channel_id)
    out[c.group]?.push(c)
  }
  return out
}

/** No extension history: the backend returns `watched_90d = null` for all (no device sent any). */
export function lacksWatchHistory(rows: readonly ChannelRow[] | undefined): boolean {
  return !!rows && rows.length > 0 && rows.every((r) => r.watched_90d === null)
}

export type CleanupBanner =
  | 'scan_failed'
  | 'scan_unavailable'
  | 'scanning'
  | 'server_down'
  | 'ext_endpoint_down'
  | 'ext_not_paired'
  | 'ext_disconnected'
  | 'no_model'
  | 'provider_unavailable'

export interface BannerInput {
  scanPhase: 'idle' | 'scanning' | 'error' | 'unavailable'
  status: StatusResponse | undefined
  statusFailed: boolean
  /** Something depends on the extension (active queue or candidates). */
  needsExtension: boolean
  noModel: boolean
  /** With `noModel`: a model is configured but its provider cannot be reached (`GET /ai/status`). */
  providerUnavailable?: boolean
  /** Plugin disabled or missing in this profile (`isPluginUnavailable`): the screen already says so in the error state. */
  pluginUnavailable?: boolean
  /** No browser was ever paired (`GET /devices` empty); `null`/absent = unknown (loading, failed). */
  neverPaired?: boolean | null
  /** `subscribed` channels (`/status.subscribed_total`): they depend on the extension even with nothing queued. */
  subscribed?: number | null
}

// Same rule as the chip (`chrome`) and the pane: 404/HTML/"plugin … disabled" on the transport = plugin is not here.
const NOT_HERE = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i

/** The error says the plugin is disabled (`plugin_disabled`) or missing (transport 404) in this profile. */
export function isPluginUnavailable(error: unknown): boolean {
  if (!error) return false
  if (error instanceof TubeApiError) return error.code === 'plugin_disabled' || (error.transport && NOT_HERE.test(error.message))
  return toApiError(error).code === 'plugin_disabled'
}

/**
 * One strip at a time, by priority: scan (failed/no RPC/running) › server › extension (server off › never paired ›
 * disconnected) › no model.
 * Plugin disabled/missing: no "no contact with the server" nor extension notice (it would contradict the disabled notice).
 */
export function pickBanner({
  scanPhase,
  status,
  statusFailed,
  needsExtension,
  noModel,
  providerUnavailable,
  pluginUnavailable,
  neverPaired = null,
  subscribed = null
}: BannerInput): CleanupBanner | null {
  if (scanPhase === 'error') return 'scan_failed'
  if (scanPhase === 'unavailable') return 'scan_unavailable'
  if (scanPhase === 'scanning') return 'scanning'
  if (pluginUnavailable) return null
  if (statusFailed && !status) return 'server_down'
  if (status && needsExtension && !status.ext_endpoint_up) return 'ext_endpoint_down'
  // the browser-extension notice, the same rule as Subscriptions and Manage (never paired → Connect; offline → Reconnect)
  const ext = pickExtNotice({ status, neverPaired, needed: needsExtension || (subscribed != null && subscribed > 0) })
  if (ext) return ext
  if (noModel) return providerUnavailable ? 'provider_unavailable' : 'no_model'
  return null
}

// ------------------------------------------------------------------ AI unavailable

/** Cut for the provider and the model on screen (same as the backend's message). */
const ROUTE_PART_CHARS = 80

function routePart(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim()
  // a local model may be configured by path: only its file name goes on screen
  if (/^([/~\\]|[A-Za-z]:[\\/])/.test(text)) text = text.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return text.length <= ROUTE_PART_CHARS ? text : `${text.slice(0, ROUTE_PART_CHARS - 1)}…`
}

/**
 * `provider · model` when `GET /ai/status` says the configured provider cannot be reached (refused the sign-in a moment
 * ago); `null` otherwise (available, no model, unknown). `''` = unreachable, route unknown.
 */
export function unreachableRoute(status: AiStatus | null): string | null {
  if (!status || status.available !== false || status.reason !== 'provider_unavailable') return null
  return [routePart(status.provider), routePart(status.model)].filter(Boolean).join(' · ')
}

/** Settings → Model → Auxiliary models, on the plugin task's row (the Desktop's `aux` deep link; mirror of
 * `wiring.CURATOR_TASK`, derived from the id). */
export function modelSettingsPath(): string {
  return `/settings?tab=config:model&aux=${encodeURIComponent(`${PLUGIN_ID.replace(/-/g, '_')}_curator`)}`
}

/** Former-subscription expiry only if the backend sends it (`expires_at`); never computed here. */
export function expiresAt(row: ChannelRow): number | null {
  const v = (row as ChannelRow & { expires_at?: unknown }).expires_at
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
