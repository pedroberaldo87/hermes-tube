// YouTube formatting and links used by components and screens.
import { host } from '@hermes/plugin-sdk'
import type { FeedItem } from '../../shared/api-types'
import { maybePluginContext } from './ctx'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** YouTube video id (11 characters). Chat directive attributes are untrusted input. */
export function isVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value)
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`
}

/** 725 → "12:05"; 3725 → "1:02:05"; null → "". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

// ------------------------------------------------------------------ numbers and dates in the app language
// All through Intl with the app locale (`useLocale()` from the kit): "661 mil" / "14,6 mi" in pt-BR, "661K" /
// "14.6M" in English. An invalid locale falls back to English (never throws).

const numberFormats = new Map<string, Intl.NumberFormat>()

function numberFormat(locale: string, key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${locale}|${key}`
  let fmt = numberFormats.get(id)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale || 'en', options)
    } catch {
      fmt = new Intl.NumberFormat('en', options)
    }
    numberFormats.set(id, fmt)
  }
  return fmt
}

// 1 decimal place only when it helps (14.6M; 1.9M), never more than 3 significant digits (661K)
const COMPACT: Intl.NumberFormatOptions = {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  maximumSignificantDigits: 3,
  roundingPriority: 'lessPrecision'
} as Intl.NumberFormatOptions

/** Compact number in the app language: 661306 → "661 mil" (pt-BR) / "661K" (en). `null` → "". */
export function formatCompact(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return ''
  return numberFormat(locale, 'compact', COMPACT).format(value)
}

/** Count with the locale separator: 1204 → "1.204" (pt-BR) / "1,204" (en). */
export function formatCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) return String(value)
  return numberFormat(locale, 'count', {}).format(value)
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60]
]

/** Short relative time: (ts in seconds, now in ms) → "2 hr. ago" / "há 3 dias". */
export function formatRelativeTime(tsSeconds: number | null | undefined, nowMs: number, locale: string): string {
  if (tsSeconds == null || !Number.isFinite(tsSeconds)) return ''
  const diff = tsSeconds - nowMs / 1000
  const abs = Math.abs(diff)
  let fmt: Intl.RelativeTimeFormat
  try {
    fmt = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto', style: 'short' })
  } catch {
    fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  }
  for (const [unit, size] of RELATIVE_UNITS) if (abs >= size) return fmt.format(Math.round(diff / size), unit)
  return fmt.format(0, 'minute')
}

/** Opens a URL in the system browser (ctx.os); without that port, shows a notice with the URL. */
export function openExternal(url: string): void {
  const os = maybePluginContext()?.os
  if (os?.openExternal) {
    void os.openExternal(url).then((ok) => {
      if (!ok) host.notify({ kind: 'info', message: url })
    })
    return
  }
  host.notify({ kind: 'info', message: url })
}

/** Where the video was opened from: the item already on screen, the list of the same tab/source and its name. */
export interface VideoOpenFrom {
  item?: FeedItem | null
  list?: readonly FeedItem[] | null
  source?: string | null
}

/** Whoever opens the video inside Hermes (`lib/player`); `false` = did not open (falls through to YouTube). */
export type VideoOpener = (videoId: string, from: VideoOpenFrom) => boolean

let videoOpener: VideoOpener | null = null

export function setVideoOpener(opener: VideoOpener | null): void {
  videoOpener = opener
}

/** Video click: the Hermes "Watching" screen when possible, otherwise YouTube in the browser. */
export function openVideo(videoId: string, from: VideoOpenFrom = {}): void {
  if (videoOpener?.(videoId, from)) return
  openOnYouTube(videoId)
}

/** Always external, in the system browser (⌘/Ctrl+click, middle button, "Open on YouTube"). */
export function openOnYouTube(videoId: string): void {
  openExternal(youtubeWatchUrl(videoId))
}

/** A click that asks for the browser instead of the Hermes screen: ⌘ (Mac) or Ctrl. */
export function wantsYouTube(e: { metaKey?: boolean; ctrlKey?: boolean }): boolean {
  return !!(e.metaKey || e.ctrlKey)
}
