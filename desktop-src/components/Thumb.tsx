// 16:9 thumbnail: loads lazily and fades in; type + duration mark, watched progress, "watched"
// veil (derived from the theme background, never black), new dot (accent) and badges from the backend.
// Image failure: tries another resolution and then draws a placeholder. Reads the `extras` atom (honest
// thumbnails → hq2.jpg) — screens know nothing about Extras.
// The mark (`VideoMark`) is a SINGLE one, in the top-right corner, always visible (quick actions sit at the
// bottom): type icon + duration. Video: 🎥 17:14 · Short: 📱 Short 0:58 · unknown type: duration only ·
// no type and no duration: nothing (never made up) · backend `live`/`premiere` badge: 📡 Live / 📅 Premiere.
import { Badge, Codicon } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type ThumbSize, thumbnailUrl, useExtras } from '../lib/extras'
import { formatDuration } from '../lib/format'
import { type Translate, useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { SkBar, formatNumber, useLocale, vars } from './kit'

// ------------------------------------------------------------------ type + duration mark

export type VideoMarkKind = 'video' | 'short' | 'live' | 'premiere' | 'unknown'

/** Backend badges that become the mark's type (and are not repeated among the thumbnail badges). */
const MARK_BADGES: Readonly<Record<string, VideoMarkKind>> = { live: 'live', premiere: 'premiere', upcoming: 'premiere' }
const MARK_ICON: Readonly<Record<Exclude<VideoMarkKind, 'unknown'>, string>> = {
  video: 'device-camera-video',
  short: 'device-mobile',
  live: 'broadcast',
  premiere: 'calendar'
}
const MARK_KEY: Readonly<Record<Exclude<VideoMarkKind, 'unknown'>, string>> = {
  video: 'video.kind.video',
  short: 'video.short',
  live: 'video.live',
  premiere: 'video.premiere'
}

/** Mark type: live/premiere badge › `is_short` (true/false) › unknown. */
export function videoMarkKind(isShort: boolean | null | undefined, badges?: readonly string[] | null): VideoMarkKind {
  for (const b of badges ?? []) if (MARK_BADGES[b]) return MARK_BADGES[b]
  return isShort === true ? 'short' : isShort === false ? 'video' : 'unknown'
}

/** Is there a mark to draw? (known type or known duration). */
export function hasVideoMark(durationS: number | null | undefined, isShort: boolean | null | undefined, badges?: readonly string[] | null): boolean {
  return videoMarkKind(isShort, badges) !== 'unknown' || !!formatDuration(durationS)
}

/** Spoken duration (alt text/tooltip): "17 min 14 s", "1 h 5 min 55 s", "58 s"; without a duration, "". */
export function spokenDuration(seconds: number | null | undefined, t: Translate, locale: string): string {
  if (!formatDuration(seconds)) return ''
  const s = Math.floor(seconds as number)
  const parts: Array<[string, number]> = [
    ['video.duration.h', Math.floor(s / 3600)],
    ['video.duration.m', Math.floor((s % 3600) / 60)],
    ['video.duration.s', s % 60]
  ]
  const out = parts.filter(([, n]) => n > 0).map(([key, n]) => t(key, { count: formatNumber(n, locale) }))
  return out.length ? out.join(' ') : t('video.duration.s', { count: formatNumber(0, locale) })
}

export interface VideoMarkProps {
  durationS?: number | null
  isShort?: boolean | null
  badges?: readonly string[] | null
  /** `thumb` (default): pill in the thumbnail corner · `meta`: text in the metadata line (list). */
  placement?: 'thumb' | 'meta'
}

/** The type + duration mark (one per card). With neither type nor duration, draws nothing. */
export function VideoMark({ durationS, isShort, badges, placement = 'thumb' }: VideoMarkProps) {
  const t = useT()
  const locale = useLocale()
  const kind = videoMarkKind(isShort, badges)
  const duration = formatDuration(durationS)
  if (kind === 'unknown' && !duration) return null
  const name = kind === 'unknown' ? '' : t(MARK_KEY[kind])
  const label = [name, spokenDuration(durationS, t, locale)].filter(Boolean).join(' · ')
  return (
    <span
      className={cx(placement === 'thumb' ? 'thumb-pill thumb-mark' : 'card-mark')}
      data-part="thumb-mark"
      data-kind={kind}
      data-placement={placement}
      role="img"
      aria-label={label}
      title={label}
    >
      {kind !== 'unknown' ? <Codicon name={MARK_ICON[kind]} size={12} className={cx('mark-icon')} /> : null}
      {kind !== 'unknown' && kind !== 'video' ? <span className={cx('mark-kind')}>{name}</span> : null}
      {duration ? (
        <span className={cx('mark-duration')} data-part="thumb-duration">
          {duration}
        </span>
      ) : null}
    </span>
  )
}

// ------------------------------------------------------------------ thumbnail

export interface ThumbProps {
  videoId: string
  /** Video title (alt text of the placeholder). */
  title?: string
  durationS?: number | null
  /** Watched fraction, 0..1. */
  progress?: number | null
  watched?: boolean
  isNew?: boolean
  isShort?: boolean | null
  /** Backend badges (`FeedItem.badges`, e.g. `hn`). */
  badges?: readonly string[]
  /** Explicit URL (otherwise YouTube's, per Extras). */
  src?: string
  size?: ThumbSize
  /** Draws the type + duration mark in the corner (default); `false` when it goes elsewhere (list). */
  mark?: boolean
  /** Layer on top (e.g. quick actions). */
  children?: ReactNode
}

const BADGE_ICON: Record<string, string> = { hn: 'flame' }
const BADGE_KEY: Record<string, string> = { hn: 'video.badge.hn' }

function fallbackFor(primary: string, videoId: string): string {
  const id = encodeURIComponent(videoId)
  return primary.includes('/mqdefault.jpg') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

export function Thumb({ videoId, title, durationS, progress, watched, isNew, isShort, badges, src, size = 'mq', mark = true, children }: ThumbProps) {
  const t = useT()
  const extras = useExtras()
  const primary = src ?? thumbnailUrl(videoId, extras, size)
  const candidates = [primary, fallbackFor(primary, videoId)]
  const [state, setState] = useState({ primary, attempt: 0, loaded: false })
  // new URL (Extras turned on/off, another video): start over
  const current = state.primary === primary ? state : { primary, attempt: 0, loaded: false }
  const imgRef = useRef<HTMLImageElement>(null)
  const url = candidates[current.attempt]

  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) setState({ primary, attempt: current.attempt, loaded: true })
  }, [url, primary, current.attempt])

  const shownBadges = badges?.filter((b) => !MARK_BADGES[b]) ?? []
  const pct = progress != null && progress > 0 ? Math.round(Math.min(1, progress) * 100) : null

  return (
    <div
      className={cx('thumb')}
      data-part="thumb"
      data-watched={watched ? 'true' : undefined}
      data-has-progress={pct != null ? 'true' : undefined}
    >
      {url ? (
        <img
          ref={imgRef}
          key={url}
          data-thumb
          className={cx('thumb-img')}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-loaded={current.loaded ? 'true' : 'false'}
          onLoad={() => setState({ primary, attempt: current.attempt, loaded: true })}
          onError={() => setState({ primary, attempt: current.attempt + 1, loaded: false })}
        />
      ) : (
        <div className={cx('thumb-fallback')} data-part="thumb-fallback" role="img" aria-label={title || t('kit.thumb.unavailable')}>
          <Codicon name="play" size={22} />
        </div>
      )}
      {watched ? (
        <div className={cx('thumb-veil')} data-part="thumb-veil">
          <span className={cx('thumb-pill')}>
            <Codicon name="check" size={11} />
            {t('kit.thumb.watched')}
          </span>
        </div>
      ) : null}
      {isNew ? <span className={cx('thumb-new')} data-part="thumb-new" role="img" aria-label={t('kit.thumb.new')} /> : null}
      {mark ? <VideoMark durationS={durationS} isShort={isShort} badges={badges} /> : null}
      {shownBadges.length ? (
        <span className={cx('thumb-badges')} data-part="thumb-badges">
          {shownBadges.map((b) => (
            <Badge key={b} size="xs" variant="muted" className={cx('thumb-pill')} data-badge={b}>
              {BADGE_ICON[b] ? <Codicon name={BADGE_ICON[b]} size={11} /> : null}
              {BADGE_KEY[b] ? t(BADGE_KEY[b]) : b}
            </Badge>
          ))}
        </span>
      ) : null}
      {pct != null ? (
        <div
          className={cx('thumb-progress')}
          data-part="thumb-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t('kit.thumb.progress', { percent: pct })}
        >
          <span className={cx('thumb-progress-fill')} style={vars({ progress: `${pct}%` })} />
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function ThumbSkeleton() {
  return (
    <div className={cx('thumb')} data-part="thumb" data-skeleton aria-hidden="true">
      <SkBar shape="block" />
    </div>
  )
}
