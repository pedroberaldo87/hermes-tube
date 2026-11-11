// Pure logic of the welcome dialog: cadences, link/@handle validation (lenient mirror of
// `dedup.parse_channel_ref` — the server decides), mapping each contract error to the right text
// key, and detection of the freshly paired device. No React; tested directly.
import type { ApiError, Channel, Device } from '../../../shared/api-types'

/** Live wait (new device, channels arriving, demo videos) — only with the window visible. */
export const LIVE_POLL_MS = 2_000
/** Countdown of the "closes by itself" when the channels arrive. */
export const AUTO_CLOSE_S = 5
/** After this, the first sync gets the notice "you can close this, the channels will appear on their own". */
export const SYNC_PATIENCE_MS = 90_000
/** After this the demo is considered ready even without videos (RSS keeps going in the background). */
export const DEMO_PATIENCE_MS = 60_000
/** `last_seen` more recent than this = "connected now". */
export const ONLINE_WINDOW_S = 120
/** Routes whose data changes when channels come and go (tell Home). */
export const AFTER_CHANNELS = ['GET /channels', 'GET /tabs', 'GET /status', 'GET /feed', 'GET /demo'] as const

export type OnboardingView = 'paths' | 'pair' | 'link' | 'demo'

// ------------------------------------------------------------------ link / @handle

export type ChannelInputKind = 'handle' | 'channel_id' | 'channel_url' | 'video_url'

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/
const VIDEO_ID = /^[0-9A-Za-z_-]{11}$/
const HANDLE = /^@[\p{L}\p{M}\p{N}._\-·]{1,100}$/u
const VANITY = /^[\p{L}\p{N}_.-]+$/u
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be'])
const VIDEO_PREFIXES = new Set(['shorts', 'live', 'embed', 'v', 'e'])
const RESERVED = new Set([
  'about', 'account', 'attribution_link', 'c', 'channel', 'feed', 'gaming', 'hashtag', 'howyoutubeworks', 'kids',
  'logout', 'music', 'playlist', 'post', 'premium', 'redirect', 'results', 'signin', 'source', 't', 'trending', 'upload',
  'user', 'watch'
])

function segmentsOf(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
}

/** What the pasted text looks like; `null` = not a YouTube channel (not worth a trip to the server). */
export function parseChannelInput(raw: string): ChannelInputKind | null {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return null
  if (CHANNEL_ID.test(value)) return 'channel_id'
  if (value.startsWith('@')) return HANDLE.test(value) ? 'handle' : null
  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const segs = segmentsOf(url.pathname)
  if (SHORT_HOSTS.has(host)) return segs[0] && VIDEO_ID.test(segs[0]) ? 'video_url' : null
  if (!YOUTUBE_HOSTS.has(host) || !segs.length) return null
  const first = segs[0]
  const lower = first.toLowerCase()
  if (first.startsWith('@')) return HANDLE.test(first) ? 'channel_url' : null
  if (lower === 'channel') return segs[1] && CHANNEL_ID.test(segs[1]) ? 'channel_url' : null
  if (lower === 'c' || lower === 'user') return segs[1] && VANITY.test(segs[1]) ? 'channel_url' : null
  if (lower === 'watch') return VIDEO_ID.test(url.searchParams.get('v') ?? '') ? 'video_url' : null
  if (VIDEO_PREFIXES.has(lower)) return segs[1] && VIDEO_ID.test(segs[1]) ? 'video_url' : null
  if (RESERVED.has(lower)) return null
  return VANITY.test(first) ? 'channel_url' : null
}

// ------------------------------------------------------------------ errors → text

export type PairErrorKind = 'ext_endpoint_down' | 'timeout' | 'generic'

/** `pair.start` failure (RPC or REST drop) → which human explanation to show. */
export function pairErrorKind(error: Pick<ApiError, 'code'> | null | undefined): PairErrorKind {
  if (error?.code === 'ext_endpoint_down') return 'ext_endpoint_down'
  if (error?.code === 'timeout') return 'timeout'
  return 'generic'
}

export type LinkRowState = 'pending' | 'added' | 'exists' | 'late' | 'error' | 'undoing' | 'undone'

export interface AddOutcome {
  state: 'exists' | 'late' | 'error'
  /** Key in the `onboarding` namespace. */
  key: string
  /** Worth a "try again" (transient failure). */
  retryable: boolean
  /** `conflict`: the channel already in the list (`details.channel`). */
  existing?: Partial<Channel> | null
}

/** `POST /channels/add` error → row state and text (duplicate, not found, YouTube down…). */
export function addErrorOutcome(error: ApiError): AddOutcome {
  const details = (error.details ?? {}) as Record<string, unknown>
  switch (error.code) {
    case 'conflict': {
      const existing = details.channel && typeof details.channel === 'object' ? (details.channel as Partial<Channel>) : null
      return { state: 'exists', key: 'link.status.exists', retryable: false, existing }
    }
    case 'invalid':
      return { state: 'error', key: 'link.errors.format', retryable: false }
    case 'youtube_error': {
      const status = Number(details.status)
      if (status === 404 || status === 410) return { state: 'error', key: 'link.errors.not_found', retryable: false }
      if (status === 429) return { state: 'error', key: 'link.errors.rate_limited', retryable: true }
      return { state: 'error', key: 'link.errors.youtube_down', retryable: true }
    }
    case 'timeout':
      return details.pending === true
        ? { state: 'late', key: 'link.status.late', retryable: false }
        : { state: 'error', key: 'link.errors.timeout', retryable: true }
    default:
      return { state: 'error', key: 'link.errors.generic', retryable: true }
  }
}

// ------------------------------------------------------------------ live wait

/**
 * The device that just paired: the one that was not in the list when the code was generated. Without that list
 * (the query had not returned yet), whatever was created after the code counts (with 30 s of slack).
 */
export function findNewDevice(items: readonly Device[], baseline: readonly string[] | null, issuedAtS: number): Device | null {
  const fresh = items.filter((d) =>
    d.revoked_at == null && (baseline ? !baseline.includes(d.id) : d.created_at >= issuedAtS - 30)
  )
  if (!fresh.length) return null
  return fresh.reduce((a, b) => (b.created_at > a.created_at ? b : a))
}

/** Plural category (EN and PT-BR: 1 = singular; 0 is plural in both). */
export function pluralCategory(count: number): 'one' | 'other' {
  return count === 1 ? 'one' : 'other'
}

/** Acceptable external URL to open (extension store link, coming from the locale). */
export function isSafeExternalUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url)
}
