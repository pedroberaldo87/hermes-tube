// Watch screen: the Watch section of the single HermesTube page (opened by `lib/player`; no center tab of its own).
//   layout   one grid, left-aligned in the section, like YouTube: Hermes' OWN player at the top left —
//            `MessageTextContent` with the plain video link; the app draws the embedded player (youtube-nocookie.com)
//            under its embed consent (a "click to load" facade when pending; a plain link when off). No iframe of
//            ours. By default at the size the app gives it (up to 640×360, 1/3 of the window height): the YouTube
//            iframe draws its controls for its real width, so this is the sharp size. Under the player, in the same
//            column (same edges): the line with the tip, then the details. "Up next" is a column of its own on the
//            right, starting at the player's top line and as tall as the section allows (it scrolls inside; it
//            stays in view while the details scroll). Narrow → one column, the queue under the player.
//            "Larger player" (a remembered preference, off by default) scales the player up with `zoom` on OUR
//            wrapper (measured by a ResizeObserver, nothing from the app's markup) for whoever prefers size to sharpness.
//            A one-time tip under the player teaches the app's "Always allow YouTube" (the plugin cannot read or
//            change that consent, nor skip its click).
//            Behind the band, the video thumbnail blurred and faint (the only color on the screen).
//   below    what is ours: reason ("why is this here"), title, channel (avatar, name, folder), date, duration,
//            the card actions (Watched highlighted, Watch later, Archive, Like, Dislike — same shortcuts and the
//            same undo), "Add to playlist" (the shared picker, components/PlaylistPicker) + "Open on YouTube" always at
//            hand (some channels forbid embedding), collapsed description
//   Up next  an editable queue copied from the list the video came from (`lib/queue`, panel in ./queue): remove,
//            reorder by dragging or Alt+↑/↓, "Play next"; clicking swaps the video; N/J/→ and P/K/← follow its order.
//            The player belongs to the core, with no API: we cannot know the video ended — no autoplay.
//   states   no data yet (only the id) → fetches `GET /videos`; backend does not know it → notice, player and link
//            stay; error → notice with retry; nothing playing → empty state with a way back.
// Opening does NOT mark as watched. All text through useT('watch'); own stylesheet in ./styles.
import { Button, Codicon, MessageTextContent, useValue } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type RefObject, useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FeedItem } from '../../../shared/api-types'
import { ChannelAvatar, EmptyView, FolderChip, Why, formatRelative, useLocale } from '../../components'
import { PlaylistPicker } from '../../components/PlaylistPicker'
import { thumbnailUrl, useExtras } from '../../lib/extras'
import { formatCompact, formatDuration, youtubeWatchUrl } from '../../lib/format'
import { type Translate, errorText, useT } from '../../lib/i18n'
import { closeWatch } from '../../lib/nav'
import {
  $watch,
  LARGE_PLAYER_KEY,
  OpenModeSwitch,
  TIP_DISMISSED_KEY,
  type WatchState,
  openOnYouTube,
  playQueued,
  setPlayerFlag,
  setWatchItem,
  usePlayerFlag
} from '../../lib/player'
import { nextOf, prevOf, useQueue } from '../../lib/queue'
import { toApiError, useRest } from '../../lib/rest'
import { cssVar, cx } from '../../lib/style'
import { openPlaylistPicker } from '../../lib/video-actions'
import { ACTION_KEYS, NAV_KEYS, type VideoAction, applyWatchLayer, plainKey, runWatchAction, useWatchOverlay } from './actions'
import { QueuePanel } from './queue'
import { ensureWatchStyles } from './styles'

export { WATCH_CSS, ensureWatchStyles } from './styles'

/** The Watch section (main.tsx hands it to the shell). */
export function WatchPage() {
  useInsertionEffect(() => ensureWatchStyles(), [])
  const state = useValue($watch)
  if (!state) return <WatchEmpty />
  return <WatchView state={state} />
}

function WatchEmpty() {
  const t = useT('watch')
  return (
    <div className={cx('watch')} data-part="watch-empty">
      <EmptyView
        icon="play-circle"
        title={t('state.empty_title')}
        description={t('state.empty_desc')}
        action={
          <Button variant="outline" size="sm" onClick={() => closeWatch()}>
            {t('state.empty_action')}
          </Button>
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------ stage

/** Ceiling for the scaling and the player width; fraction of the section height the player may take. */
const ZOOM_MAX = 3
const STAGE_MAX_W = 1280
const STAGE_H_FRAC = 0.62
const STAGE_MIN_H = 200
/** Below this the app drew neither player nor facade (embeds off: just a link) — nothing to scale. */
const LINK_MAX_H = 64
/** Guard against back-and-forth in an engine where `zoom` does not scale the player's measures uniformly. */
const ZOOM_MAX_STEPS = 8

function zoomSupported(): boolean {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '2')
  } catch {
    return false
  }
}

/**
 * "Larger player" only: how much to scale the core's player so it fills its column. Measures only what is ours: the
 * section (`root`), the player column (`lane`) and the player wrapper (`box`). Off (the default), without
 * ResizeObserver or without `zoom` (tests, old browser): 1, and nothing is measured.
 */
function usePlayerZoom(
  enabled: boolean,
  root: RefObject<HTMLElement | null>,
  lane: RefObject<HTMLElement | null>,
  box: RefObject<HTMLElement | null>,
  key: string
): number {
  const [zoom, setZoom] = useState(1)
  const live = useRef({ zoom: 1, sig: '', steps: 0 })
  // `key` is in the dependencies because it swaps the wrapper (another video): the observer moves to the new one
  useLayoutEffect(() => {
    const st = live.current
    if (!enabled) {
      st.zoom = 1
      st.sig = ''
      st.steps = 0
      setZoom(1)
      return
    }
    const rootEl = root.current
    const laneEl = lane.current
    const boxEl = box.current
    if (!rootEl || !laneEl || !boxEl || typeof ResizeObserver === 'undefined' || !zoomSupported()) return
    const measure = () => {
      const r = boxEl.getBoundingClientRect()
      const laneW = laneEl.clientWidth
      const rootH = rootEl.clientHeight
      if (r.width < 1 || r.height < 1 || laneW < 1 || rootH < 1) return
      const rootBox = rootEl.getBoundingClientRect()
      if (r.bottom < rootBox.top || r.top > rootBox.bottom) return // out of view: the app swaps the player's measure
      const natW = r.width / st.zoom
      const natH = r.height / st.zoom
      const availW = Math.min(laneW, STAGE_MAX_W)
      const availH = Math.max(STAGE_MIN_H, rootH * STAGE_H_FRAC)
      const want = natH < LINK_MAX_H ? 1 : Math.min(ZOOM_MAX, Math.max(1, Math.min(availW / natW, availH / natH)))
      const next = Math.round(want * 200) / 200
      if (Math.abs(next - st.zoom) < 0.01) return
      const sig = `${laneW}x${rootH}`
      if (sig !== st.sig) {
        st.sig = sig
        st.steps = 0
      }
      if (++st.steps > ZOOM_MAX_STEPS) return
      st.zoom = next
      setZoom(next)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(rootEl)
    ro.observe(laneEl)
    ro.observe(boxEl)
    measure()
    return () => ro.disconnect()
  }, [enabled, root, lane, box, key])
  return enabled ? zoom : 1
}

/** The video thumbnail, blurred and faint, behind the band. If it fails to load: it disappears (the band stays plain). */
function Ambient({ id }: { id: string }) {
  const extras = useExtras()
  const [failed, setFailed] = useState<string | null>(null)
  const src = thumbnailUrl(id, extras, 'mq')
  if (failed === src) return null
  // `data-bleed`: the image goes past the edges on purpose and this wrapper crops it (the preview auditor skips it)
  return (
    <div className={cx('watch-ambient-clip')} data-bleed="" aria-hidden="true">
      <img className={cx('watch-ambient')} data-part="watch-ambient" src={src} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
    </div>
  )
}

export interface WatchViewProps {
  state: WatchState
  /** Clock for relative time (preview/tests). */
  now?: number
  /** Description already open (preview). */
  initialDescriptionOpen?: boolean
}

export function WatchView({ state, now, initialDescriptionOpen }: WatchViewProps) {
  useInsertionEffect(() => ensureWatchStyles(), [])
  const t = useT('watch')
  const tc = useT()
  const overlay = useWatchOverlay()
  const rootRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const large = usePlayerFlag(LARGE_PLAYER_KEY)
  const zoom = usePlayerZoom(large, rootRef, laneRef, boxRef, state.id)

  // only the id (chat, link): the data comes from the backend; with the item in hand, no call
  const fetched = useRest('GET /videos', { query: { ids: state.id } }, { enabled: !state.item })
  const fetchedItem = state.item ? null : (fetched.data?.items?.find((it) => it.video.id === state.id) ?? null)
  useEffect(() => {
    if (fetchedItem) setWatchItem(fetchedItem)
  }, [fetchedItem])
  const raw = state.item ?? fetchedItem
  const item = raw ? applyWatchLayer(raw, overlay[raw.video.id]) : null
  const phase: 'ready' | 'loading' | 'unknown' | 'error' = raw ? 'ready' : fetched.error ? 'error' : fetched.data ? 'unknown' : 'loading'

  // the queue (`lib/queue`): N/P and "n of m" follow its order, edits included
  const queue = useQueue()
  const prevItem = queue ? prevOf(queue) : null
  const nextItem = queue ? nextOf(queue) : null
  const go = (it: FeedItem | null) => {
    if (it) playQueued(it.video.id)
  }
  const run = (action: VideoAction) => {
    if (raw) runWatchAction(action, raw, t, tc)
  }

  // on every open: focus comes to the screen (shortcuts work at once) and scroll returns to the top
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.scrollTop = 0
    el.focus({ preventScroll: true })
  }, [state.seq])

  // the section's height, for the queue beside the player (it takes the height available, not the player's)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const set = () => el.style.setProperty(cssVar('watch-h'), `${el.clientHeight}px`)
    const ro = new ResizeObserver(set)
    ro.observe(el)
    set()
    return () => ro.disconnect()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = plainKey(e)
    if (!key) return
    const nav = NAV_KEYS[key]
    if (nav) {
      e.preventDefault()
      go(nav === 'next' ? nextItem : prevItem)
      return
    }
    if (key === 'o') {
      e.preventDefault()
      openOnYouTube(state.id)
      return
    }
    const action = ACTION_KEYS[key]
    if (action && raw) {
      e.preventDefault()
      run(action)
    }
  }

  const title = item?.video.title ?? ''
  // the picker sits outside the screen root: its keys (typing a name) never reach the Watch shortcuts
  return (
    <>
    <div
      ref={rootRef}
      className={cx('watch')}
      data-part="watch"
      data-video={state.id}
      data-large={large ? 'true' : 'false'}
      data-queue={queue ? 'true' : 'false'}
      tabIndex={-1}
      aria-label={title ? t('label', { title }) : t('tab.title')}
      onKeyDown={onKeyDown}
    >
      <div className={cx('watch-page')}>
        <Ambient id={state.id} />
        <div className={cx('watch-layout')} data-part="watch-layout">
          <section className={cx('watch-stage')} data-part="watch-player" aria-label={t('player.label')} ref={laneRef}>
            <div className={cx('watch-player')} key={state.id} ref={boxRef} data-zoom={zoom} style={zoom === 1 ? undefined : { zoom }}>
              <MessageTextContent text={youtubeWatchUrl(state.id)} />
            </div>
          </section>
          <PlayerFoot t={t} large={large} />
          {queue ? <QueuePanel queue={queue} t={t} seq={state.seq} now={now} /> : null}
          <div className={cx('watch-below')} data-part="watch-below">
            {item ? (
              <Details key={state.seq} item={item} now={now} t={t} tc={tc} onAction={run} id={state.id} initialDescriptionOpen={initialDescriptionOpen} />
            ) : (
              <Missing phase={phase} t={t} tc={tc} id={state.id} error={fetched.error} onRetry={() => void fetched.refetch()} />
            )}
            <div className={cx('watch-mode t-label')}>
              <span>{t('open_mode.label')}</span>
              <OpenModeSwitch />
            </div>
          </div>
        </div>
      </div>
    </div>
    <PlaylistPicker />
    </>
  )
}

/** Under the player: the one-time "Always allow" tip (dismissable for good) and the discreet "Larger player" toggle. */
function PlayerFoot({ t, large }: { t: Translate; large: boolean }) {
  const dismissed = usePlayerFlag(TIP_DISMISSED_KEY)
  return (
    <div className={cx('watch-foot')} data-part="watch-foot">
      {dismissed ? (
        <span className={cx('watch-foot-spacer')} />
      ) : (
        <p className={cx('watch-tip t-label')} data-part="watch-tip">
          <Codicon name="lightbulb" size={12} className={cx('watch-tip-icon')} />
          <span className={cx('watch-tip-text')}>{t('tip.always_allow')}</span>
          <Button variant="ghost" size="xs" data-part="watch-tip-dismiss" onClick={() => setPlayerFlag(TIP_DISMISSED_KEY, true)}>
            {t('tip.dismiss')}
          </Button>
        </p>
      )}
      <Button
        variant="ghost"
        size="xs"
        className={cx('watch-larger')}
        data-part="watch-larger"
        aria-pressed={large}
        title={t(large ? 'player.larger_off_hint' : 'player.larger_hint')}
        onClick={() => setPlayerFlag(LARGE_PLAYER_KEY, !large)}
      >
        <Codicon name={large ? 'screen-normal' : 'screen-full'} size={12} />
        {t('player.larger')}
      </Button>
    </div>
  )
}

// ------------------------------------------------------------------ parts

interface DetailsProps {
  id: string
  item: FeedItem
  now?: number
  t: Translate
  tc: Translate
  onAction: (a: VideoAction) => void
  initialDescriptionOpen?: boolean
}

function Details({ id, item, now, t, tc, onAction, initialDescriptionOpen }: DetailsProps) {
  const locale = useLocale()
  const [open, setOpen] = useState(!!initialDescriptionOpen)
  const { video, channel } = item
  const channelTitle = channel?.title ?? video.channel_title ?? ''
  const foldersQ = useRest('GET /folders', {}, { enabled: !!channel?.folder_id })
  const folderFound = channel?.folder_id ? (foldersQ.data?.items?.find((f) => f.id === channel.folder_id) ?? null) : null
  // never repeats metadata: if the reason is the folder itself, the chip is dropped
  const folder = folderFound && !(item.why?.via === 'folder' && item.why.label === folderFound.name) ? folderFound : null
  const when = formatRelative(video.published_at, now ?? Date.now(), locale)
  const duration = formatDuration(video.duration_s)
  const description = (video.description ?? '').trim()
  const watched = item.state === 'watched'

  // `iconOnly`: like / dislike — the icon is enough; the name goes in the accessible label and the tooltip
  const toggle = (action: VideoAction, icon: string, labelKey: string, pressed: boolean, hint: string, key: string, iconOnly = false) => (
    <Button
      variant="ghost"
      size="sm"
      data-watch-action={action}
      data-icon-only={iconOnly ? 'true' : undefined}
      aria-label={iconOnly ? tc(labelKey) : undefined}
      aria-pressed={pressed}
      aria-keyshortcuts={key}
      title={`${hint} · ${key.toUpperCase()}`}
      onClick={() => onAction(action)}
    >
      <Codicon name={icon} size={14} />
      {iconOnly ? null : tc(labelKey)}
    </Button>
  )

  return (
    <div className={cx('watch-info')}>
      <Why why={item.why} subject={channelTitle} />
      <h1 className={cx('watch-title t-title')} data-part="watch-title">
        {video.title}
      </h1>
      <div className={cx('watch-meta')} data-part="watch-meta">
        <ChannelAvatar title={channelTitle} thumb={channel?.thumb} size={32} />
        <div className={cx('watch-byline')}>
          <div className={cx('watch-byline-top')}>
            <span className={cx('watch-channel t-body')}>{channelTitle}</span>
            {folder ? <FolderChip folder={folder} /> : null}
          </div>
          <div className={cx('watch-facts t-label')}>
            {when ? (
              <time
                className={cx('num')}
                dateTime={video.published_at ? new Date(video.published_at * 1000).toISOString() : undefined}
                title={video.published_at ? t('meta.published', { date: fullDate(video.published_at, locale) }) : undefined}
              >
                {when}
              </time>
            ) : null}
            {duration ? (
              <span className={cx('num')} title={t('meta.duration', { duration })}>
                {duration}
              </span>
            ) : null}
            {video.views != null ? <span className={cx('num')}>{t('meta.views', { count: formatCompact(video.views, locale) })}</span> : null}
          </div>
        </div>
      </div>
      <div className={cx('watch-actions')} data-part="watch-actions" role="group" aria-label={t('actions.label')}>
        <Button
          variant="secondary"
          size="sm"
          className={cx('watch-primary')}
          data-watch-action="watched"
          aria-pressed={watched}
          aria-keyshortcuts="w"
          title={`${tc(watched ? 'kit.actions.watched_undo' : 'kit.actions.watched_do')} · W`}
          onClick={() => onAction('watched')}
        >
          <Codicon name={watched ? 'check' : 'eye'} size={14} />
          {watched ? t('actions.watched') : t('actions.mark_watched')}
        </Button>
        <div className={cx('watch-group')}>
          {toggle('later', 'clock', 'kit.actions.later', item.state === 'later', tc(item.state === 'later' ? 'kit.actions.later_undo' : 'kit.actions.later_do'), 'l')}
          {toggle('archive', 'archive', 'kit.actions.archive', item.state === 'archived', tc(item.state === 'archived' ? 'kit.actions.archive_undo' : 'kit.actions.archive_do'), 'e')}
        </div>
        <div className={cx('watch-group')}>
          {toggle('up', 'thumbsup', 'kit.actions.up', item.reaction === 'up', tc(item.reaction === 'up' ? 'kit.actions.up_undo' : 'kit.actions.up_do'), 'u', true)}
          {toggle('down', 'thumbsdown', 'kit.actions.down', item.reaction === 'down', tc(item.reaction === 'down' ? 'kit.actions.down_undo' : 'kit.actions.down_do'), 'd', true)}
        </div>
        <div className={cx('watch-group')}>
          <Button variant="ghost" size="sm" data-watch-action="playlist" title={tc('playlists.add')} onClick={() => openPlaylistPicker(item)}>
            <Codicon name="list-unordered" size={14} />
            {tc('playlists.add')}
          </Button>
        </div>
        <span className={cx('watch-actions-end')}>
          <OpenOnYouTube id={id} t={t} />
        </span>
      </div>
      {description ? (
        <div className={cx('watch-desc')} data-part="watch-desc" data-open={open ? 'true' : 'false'}>
          <p className={cx('watch-desc-text t-body')} id={`watch-desc-${id}`}>
            {description}
          </p>
          <Button
            variant="ghost"
            size="xs"
            data-part="watch-desc-toggle"
            aria-expanded={open}
            aria-controls={`watch-desc-${id}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('description.less') : t('description.more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function OpenOnYouTube({ id, t }: { id: string; t: Translate }) {
  return (
    <Button variant="ghost" size="sm" data-watch-action="youtube" aria-keyshortcuts="o" title={`${t('player.note')} · O`} onClick={() => openOnYouTube(id)}>
      <Codicon name="link-external" size={14} />
      {t('actions.open')}
    </Button>
  )
}

interface MissingProps {
  id: string
  phase: 'loading' | 'unknown' | 'error' | 'ready'
  t: Translate
  tc: Translate
  error: unknown
  onRetry: () => void
}

/** Without the video data: loading, unknown (outside the library, removed) or error. The link stays at hand. */
function Missing({ id, phase, t, tc, error, onRetry }: MissingProps) {
  const part = phase === 'error' ? 'watch-error' : phase === 'unknown' ? 'watch-unknown' : 'watch-loading'
  return (
    <div className={cx('watch-info')} data-part={part} aria-busy={phase === 'loading' ? 'true' : undefined}>
      {phase === 'unknown' ? (
        <>
          <h1 className={cx('watch-title t-title')}>{t('state.unknown_title')}</h1>
          <p className={cx('watch-note t-body')}>{t('state.unknown_desc')}</p>
        </>
      ) : phase === 'error' ? (
        <p className={cx('watch-note t-body')} role="alert">
          {t('state.error', { error: errorText(tc, toApiError(error)) })}
        </p>
      ) : (
        <p className={cx('watch-note t-body')} role="status">
          {t('state.loading')}
        </p>
      )}
      <div className={cx('watch-actions')} data-part="watch-actions">
        {phase === 'error' ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <Codicon name="refresh" size={14} />
            {t('state.retry')}
          </Button>
        ) : null}
        <span className={cx('watch-actions-end')}>
          <OpenOnYouTube id={id} t={t} />
        </span>
      </div>
    </div>
  )
}

function fullDate(tsSeconds: number, locale: string): string {
  const d = new Date(tsSeconds * 1000)
  try {
    return new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}
