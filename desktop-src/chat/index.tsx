// Video card in the chat — `::tube-video{id="…"}` directive (TRANSCRIPT_DIRECTIVE_AREA, name
// CHAT_DIRECTIVE) — and mascot lines (`mascotLines`, handed to the shell by main.tsx).
//  - Strict validation (`directive.ts`): only `{id: <11 characters from the YouTube alphabet>}`; anything else becomes the
//    original text, as prose (React escapes; nothing clickable, no network).
//  - Batched data (`videos.ts`): the cards of one reply request together (`GET /videos?ids=`).
//  - States: loading (REAL public thumbnail + text skeleton, same box as the final card) →
//    ready (`VideoCard variant="row"` with actions) | unknown (minimal card: thumbnail + link) |
//    error (plain link + retry). The root does not remount: nothing jumps when the data arrives.
//  - Optimistic actions with undo (`actions.ts`): Watch later (l), Watched (w), Open (o) — buttons and keyboard.
//  - Several consecutive cards become a stack (chat sheet in `styles.ts`).
// Does not import screens/dialogs. i18n namespace: `chat`.
import { Button, Codicon } from '@hermes/plugin-sdk'
import { type KeyboardEvent, useInsertionEffect } from 'react'
import type { FeedItem } from '../../shared/api-types'
import { ChannelAvatarSkeleton, type QuickAction, QuickActions, Thumb, VideoCard } from '../components'
import { SkBar, SkLines } from '../components/kit'
import { openOnYouTube, openVideo, wantsYouTube, youtubeWatchUrl } from '../lib/format'
import { type Translate, errorText, useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { type ChatAction, runChatAction, shortcutFor } from './actions'
import { fallbackText, parseVideoDirective } from './directive'
import { ensureChatStyles } from './styles'
import { applyLayer, retryFailedChatVideos, useChatLayer, useChatVideo } from './videos'

export { mascotLines, MascotSettings, isMascotEnabled, setMascotEnabled } from './mascot'

export interface ChatVideoCardProps {
  /** Directive attributes — model output, UNTRUSTED. */
  attrs: unknown
  /** Original directive text (shown as text when it is rejected). */
  source?: string
  streaming?: boolean
  sessionId?: string | null
}

export function ChatVideoCard({ attrs, source }: ChatVideoCardProps) {
  const id = parseVideoDirective(attrs)
  if (!id) {
    const text = fallbackText(source)
    return text ? <p className={cx('chat-raw')}>{text}</p> : null
  }
  return <ChatVideo id={id} />
}

function ChatVideo({ id }: { id: string }) {
  useInsertionEffect(() => ensureChatStyles(), [])
  const t = useT('chat')
  const tc = useT()
  const entry = useChatVideo(id)
  const layer = useChatLayer(id)
  const ready = entry.status === 'ready' ? entry.item : null

  const run = (action: ChatAction) => {
    if (action === 'open') openOnYouTube(id) // "Open on YouTube" (button and `o` key): always external
    else if (ready) runChatAction(action, ready, t, tc)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = shortcutFor(e)
    if (!action || (action !== 'open' && !ready)) return
    e.preventDefault()
    e.stopPropagation()
    run(action)
  }

  let body
  let label: string
  if (entry.status === 'ready' && ready) {
    const item = applyLayer(ready, layer)
    label = t('card.label', { title: item.video.title })
    body = <VideoCard item={item} variant="row" actions={<ChatActions t={t} item={item} onAction={run} />} />
  } else if (entry.status === 'unknown') {
    label = t('card.unknown_title')
    body = <MinimalCard id={id} t={t} onAction={run} />
  } else if (entry.status === 'error') {
    label = t('card.error')
    body = <FallbackLink id={id} t={t} reason={errorText(tc, entry.error)} />
  } else {
    label = t('card.loading')
    body = <LoadingCard id={id} />
  }

  return (
    <div
      className={cx('chat')}
      role="group"
      aria-label={label}
      aria-busy={entry.status === 'loading' ? 'true' : undefined}
      data-chat-video={id}
      data-chat-status={entry.status}
      onKeyDown={onKeyDown}
    >
      {body}
    </div>
  )
}

/** Card actions: "Watch later"/"Watched" toggle (`aria-pressed`); the kit's hint says what the click will do. */
function ChatActions({ t, item, onAction }: { t: Translate; item?: FeedItem; onAction: (a: ChatAction) => void }) {
  const tc = useT()
  const actions: QuickAction[] = []
  if (item) {
    const later = item.state === 'later'
    const watched = item.state === 'watched'
    actions.push(
      { id: 'later', label: t('actions.later'), hint: tc(later ? 'kit.actions.later_undo' : 'kit.actions.later_do'), icon: 'clock', shortcut: 'l', onSelect: () => onAction('later'), pressed: later },
      { id: 'watched', label: t('actions.watched'), hint: tc(watched ? 'kit.actions.watched_undo' : 'kit.actions.watched_do'), icon: 'eye', shortcut: 'w', onSelect: () => onAction('watched'), pressed: watched }
    )
  }
  actions.push({ id: 'open', label: t('actions.open'), icon: 'link-external', shortcut: 'o', onSelect: () => onAction('open') })
  return <QuickActions actions={actions} label={t('actions.label')} />
}

/** Same box as `VideoCard variant="row"` (same classes and parts); the thumbnail is already the real one. */
function LoadingCard({ id }: { id: string }) {
  return (
    <article className={cx('card')} data-part="card" data-variant="row" data-skeleton>
      <div className={cx('card-frame')}>
        <div className={cx('card-media')} data-part="media">
          <Thumb videoId={id} />
        </div>
        <div className={cx('card-body')} data-part="body" aria-hidden="true">
          <div className={cx('card-title t-head')} data-part="title" data-skeleton>
            <SkLines widths={['78%']} />
          </div>
          <div className={cx('card-meta t-label')} data-part="meta">
            <ChannelAvatarSkeleton size={16} />
            <SkBar width="46%" />
          </div>
        </div>
      </div>
    </article>
  )
}

/** A video the backend does not know: only what is public (YouTube thumbnail) and the link. */
function MinimalCard({ id, t, onAction }: { id: string; t: Translate; onAction: (a: ChatAction) => void }) {
  return (
    <article className={cx('card')} data-part="card" data-variant="row" data-video={id}>
      <div className={cx('card-frame')}>
        <div className={cx('card-media')} data-part="media">
          <Thumb videoId={id} />
        </div>
        <div className={cx('card-body')} data-part="body">
          <h3 className={cx('card-title t-head')} data-part="title">
            <a
              href={youtubeWatchUrl(id)}
              className={cx('bare card-open')}
              data-open-video
              onClick={(e) => {
                e.preventDefault()
                if (wantsYouTube(e)) onAction('open')
                else openVideo(id) // opens the Watch screen
              }}
              onAuxClick={(e) => {
                e.preventDefault()
                if (e.button === 1) onAction('open')
              }}
            >
              {t('card.unknown_title')}
            </a>
          </h3>
          <div className={cx('card-meta t-label')} data-part="meta">
            <span className={cx('chat-note')}>{t('card.unknown_note')}</span>
          </div>
        </div>
        <div className={cx('card-actions')} data-part="actions">
          <ChatActions t={t} onAction={onAction} />
        </div>
      </div>
    </article>
  )
}

/** Error: the video stays reachable through a plain link; the reason goes in the hint; retry re-reads. */
function FallbackLink({ id, t, reason }: { id: string; t: Translate; reason: string }) {
  const url = youtubeWatchUrl(id)
  return (
    <div className={cx('chat-fallback t-body')}>
      <a
        href={url}
        className={cx('chat-link')}
        data-open-video
        onClick={(e) => {
          e.preventDefault()
          openVideo(id)
        }}
      >
        <Codicon name="play-circle" size={14} />
        {url.replace(/^https:\/\/www\./, '')}
      </a>
      <span className={cx('chat-why t-label')} title={reason}>
        {t('card.error')}
      </span>
      <Button variant="ghost" size="xs" data-chat-retry onClick={() => retryFailedChatVideos()}>
        <Codicon name="refresh" size={12} />
        {t('card.retry')}
      </Button>
    </div>
  )
}
