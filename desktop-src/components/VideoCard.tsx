// Video card (Subscriptions, topic tabs, tab preview, chat) in the variants grid | compact | row | featured.
// Fixed order: thumbnail → "why it is here" (subtle line, always present) → title (up to 2 lines) →
// channel · views · relative time (one line, tabular figures, numbers in the app language).
// Type + duration: a single mark — in the top corner of the thumbnail (grid, compact, featured) or, in the list
// (`row`, small thumbnail), at the end of the metadata line. With neither type nor duration, nothing.
// Never repeats metadata: if the reason is the channel itself, the overline shows only the reason ("favorite").
// Quick actions through the `actions` slot: in grid/compact they show on hover/focus over the bottom of the thumbnail; in row
// at the end of the line; in featured they are ALWAYS visible, labelled, in the card body.
// The title is the open target (a link to the video; the click opens via ctx.os.openExternal, never navigates the app)
// and stretches the click over the whole card. The title's 2-line height is reserved only inside the Grid.
import type { ReactNode } from 'react'
import type { FeedItem } from '../../shared/api-types'
import { formatCompact, openOnYouTube, openVideo, wantsYouTube, youtubeWatchUrl } from '../lib/format'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { ChannelAvatar, ChannelAvatarSkeleton } from './ChannelAvatar'
import { PersistentActionsContext, SkBar, SkLines, formatRelative, useInGrid, useLocale, withClass } from './kit'
import { Why } from './misc'
import { Thumb, ThumbSkeleton, VideoMark, hasVideoMark } from './Thumb'

export type VideoCardVariant = 'grid' | 'compact' | 'row' | 'featured'

export interface VideoCardProps {
  item: Pick<FeedItem, 'video' | 'channel' | 'why' | 'badges' | 'is_new'> & Partial<Pick<FeedItem, 'state' | 'reaction'>>
  /** grid (default) · compact (dense grid) · row (list, default in chat) · featured (Subscriptions highlight). */
  variant?: VideoCardVariant
  /** Compatibility: `layout="row"` = `variant="row"`. */
  layout?: 'grid' | 'row'
  /** Quick actions (watched, later, archive, 👍/👎) — the page decides which (use `QuickActions`). */
  actions?: ReactNode
  /** Video click; by default opens on YouTube (`ctx.os.openExternal`). */
  onOpen?: (videoId: string) => void
  /** Watched fraction (0..1), when the page knows it. */
  progress?: number | null
  /** Clock for the relative time (tests/preview); default `Date.now()`. */
  now?: number
  className?: string
}

export function VideoCard({ item, variant, layout, actions, onOpen, progress, now, className }: VideoCardProps) {
  const t = useT()
  const locale = useLocale()
  const inGrid = useInGrid()
  const kind: VideoCardVariant = variant ?? (layout === 'row' ? 'row' : 'grid')
  const featured = kind === 'featured'
  const row = kind === 'row'
  const { video, channel, why, badges, is_new } = item
  // list: the thumbnail is small, the type + duration mark goes in the metadata line
  const metaMark = row && hasVideoMark(video.duration_s, video.is_short, badges)
  const channelTitle = channel?.title ?? video.channel_title ?? ''
  // the click opens Hermes's Watch section (or YouTube, per the setting); ⌘/Ctrl+click and middle click always open YouTube
  const open = () => (onOpen ? onOpen(video.id) : openVideo(video.id, { item: item.state !== undefined ? (item as FeedItem) : null }))
  const when = formatRelative(video.published_at, now ?? Date.now(), locale)
  const actionsBox = actions ? (
    <div className={cx('card-actions')} data-part="actions" data-persistent={featured ? 'true' : undefined}>
      {featured ? <PersistentActionsContext.Provider value={true}>{actions}</PersistentActionsContext.Provider> : actions}
    </div>
  ) : null

  return (
    <article
      className={withClass(cx('card'), className)}
      data-part="card"
      data-variant={kind}
      data-video={video.id}
      data-new={is_new ? 'true' : 'false'}
      data-state={item.state ?? undefined}
    >
      <div className={cx('card-frame')}>
        <div className={cx('card-media')} data-part="media">
          <Thumb
            videoId={video.id}
            title={video.title}
            durationS={video.duration_s}
            progress={progress}
            watched={item.state === 'watched'}
            isNew={is_new}
            isShort={video.is_short}
            badges={badges}
            size={featured ? 'hq' : 'mq'}
            mark={!row}
          />
          {kind === 'grid' || kind === 'compact' ? actionsBox : null}
        </div>
        <div className={cx('card-body')} data-part="body">
          <Why why={why} subject={channelTitle} />
          <h3 className={cx('card-title', featured ? 't-title' : 't-head')} data-part="title">
            <a
              href={youtubeWatchUrl(video.id)}
              className={cx('bare card-open')}
              data-open-video
              onClick={(e) => {
                e.preventDefault()
                if (wantsYouTube(e)) openOnYouTube(video.id)
                else open()
              }}
              onAuxClick={(e) => {
                e.preventDefault()
                if (e.button === 1) openOnYouTube(video.id)
              }}
              tabIndex={inGrid ? -1 : undefined}
            >
              {video.title}
            </a>
          </h3>
          {featured && video.description ? (
            <p className={cx('card-excerpt t-body')} data-part="excerpt">
              {video.description}
            </p>
          ) : null}
          <div className={cx('card-meta t-label')} data-part="meta">
            <ChannelAvatar title={channelTitle} thumb={channel?.thumb} size={featured ? 20 : 16} />
            <span className={cx('card-channel')}>{channelTitle}</span>
            {video.views != null ? (
              <>
                <span className={cx('card-sep')} data-kind="views" aria-hidden="true">
                  ·
                </span>
                <span className={cx('card-stat')} data-kind="views">
                  {t('video.views', { count: formatCompact(video.views, locale) })}
                </span>
              </>
            ) : null}
            {when ? (
              <>
                <span className={cx('card-sep')} aria-hidden="true">
                  ·
                </span>
                <span className={cx('card-stat')} data-kind="time">
                  <time dateTime={video.published_at ? new Date(video.published_at * 1000).toISOString() : undefined}>{when}</time>
                </span>
              </>
            ) : null}
            {metaMark ? (
              <>
                <span className={cx('card-sep')} data-kind="mark" aria-hidden="true">
                  ·
                </span>
                <VideoMark durationS={video.duration_s} isShort={video.is_short} badges={badges} placement="meta" />
              </>
            ) : null}
          </div>
          {featured ? actionsBox : null}
        </div>
        {kind === 'row' ? actionsBox : null}
      </div>
    </article>
  )
}

export interface VideoCardSkeletonProps {
  variant?: VideoCardVariant
  /** `featured` only: reserves the always-visible actions line (pass `true` when the final card has `actions`). */
  actions?: boolean
}

/** Skeleton with the same box as the variant's final card (same classes, same lines). */
export function VideoCardSkeleton({ variant = 'grid', actions = false }: VideoCardSkeletonProps) {
  const featured = variant === 'featured'
  return (
    <article className={cx('card')} data-part="card" data-variant={variant} data-skeleton aria-busy="true">
      <div className={cx('card-frame')} aria-hidden="true">
        <div className={cx('card-media')} data-part="media">
          <ThumbSkeleton />
        </div>
        <div className={cx('card-body')} data-part="body">
          {/* div, not p: SkBar is a block (div inside p is invalid HTML); the `why` class zeroes the p margin */}
          <div className={cx('why t-label')} data-part="why">
            <SkBar width="38%" />
          </div>
          <div className={cx('card-title', featured ? 't-title' : 't-head')} data-part="title" data-skeleton>
            {/* the grid reserves 2 lines; in the list a normal title fits in 1 */}
            <SkLines widths={variant === 'row' ? ['78%'] : ['94%', '58%']} />
          </div>
          {featured ? (
            <div className={cx('card-excerpt t-body')} data-part="excerpt" data-skeleton>
              <SkLines widths={['100%', '82%']} />
            </div>
          ) : null}
          <div className={cx('card-meta t-label')} data-part="meta">
            <ChannelAvatarSkeleton size={featured ? 20 : 16} />
            <SkBar width="46%" />
          </div>
          {featured && actions ? (
            <div className={cx('card-actions')} data-part="actions" data-persistent="true">
              <span className={cx('card-actions-sk')}>
                <SkBar shape="block" />
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
