// The "Playlists" tab of Subscriptions (next to "Watch later"; not a server tab, not in the sidebar).
//   list     every local playlist as a card: the first video's thumbnail, the name, how many videos. Empty → one
//            sentence and the way there ("Use Add to playlist on any video").
//   open     one playlist: its videos in play order (the kit's VideoCard; a click opens the video with the playlist as
//            the Watch queue), "Play all" (the whole playlist into the queue, the first one playing), remove a video
//            (only from the playlist), rename (inline), delete (with confirmation; the videos stay).
// Playlists live only in the plugin database: nothing here touches the YouTube account. Texts in `home.playlists.*`.
import { Button, Codicon, ConfirmDialog, Input, host } from '@hermes/plugin-sdk'
import { type KeyboardEvent, useState } from 'react'
import type { FeedItem, Playlist } from '../../../shared/api-types'
import {
  type Density,
  EmptyView,
  ErrorView,
  Grid,
  GridSkeleton,
  type QuickAction,
  QuickActions,
  Section,
  Stack,
  Thumb,
  VideoCard,
  cardVariantFor
} from '../../components'
import { PLAYLIST_NAME_MAX, invalidatePlaylists, playlistCountKey } from '../../components/PlaylistPicker'
import { type Translate, errorText, useT } from '../../lib/i18n'
import { restCall, toApiError, useRest } from '../../lib/rest'
import { cx } from '../../lib/style'
import { openFromPlaylist, openPlaylistPicker, playAll } from '../../lib/video-actions'

/** Local id of the "Playlists" tab (not in `GET /tabs`; `:` never appears in a backend tab id). */
export const PLAYLISTS_TAB = ':playlists'

const countText = (t: Translate, count: number) => t(`playlists.${playlistCountKey(count)}`, { count })

export interface PlaylistsViewProps {
  density: Density
  /** "See all tabs" in the empty state. */
  onBrowse: () => void
  /** Playlist already open (preview/tests). */
  initialOpen?: string | null
}

export function PlaylistsView({ density, onBrowse, initialOpen = null }: PlaylistsViewProps) {
  const t = useT('home')
  const [openId, setOpenId] = useState<string | null>(initialOpen)
  /** Deleted here: out of the list at once, before the list comes back. */
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set())
  const listQ = useRest('GET /playlists', {}, { enabled: !openId })

  if (openId) {
    return (
      <PlaylistDetail
        key={openId}
        id={openId}
        density={density}
        onBack={() => setOpenId(null)}
        onDeleted={(id) => {
          setDeleted((s) => new Set(s).add(id))
          setOpenId(null)
        }}
      />
    )
  }
  if (listQ.error && !listQ.data) return <ErrorView error={listQ.error} onRetry={() => void listQ.refetch()} />
  if (!listQ.data) return <GridSkeleton density="comfortable" count={4} label={t('playlists.label')} />
  const items = (listQ.data.items ?? []).filter((p) => !deleted.has(p.id))
  if (!items.length) {
    return (
      <div data-part="playlists-empty">
        <EmptyView
          icon="list-unordered"
          title={t('playlists.empty_title')}
          description={t('playlists.empty_desc')}
          action={
            <Button variant="outline" size="sm" onClick={onBrowse}>
              {t('playlists.empty_action')}
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div data-part="playlists">
      <Section title={t('playlists.label')} count={items.length} description={t('playlists.local_note')}>
        <Grid
          items={items}
          getKey={(p) => p.id}
          label={t('playlists.label')}
          density="comfortable"
          onOpen={(p) => setOpenId(p.id)}
          renderItem={(p) => <PlaylistCard playlist={p} t={t} onOpen={() => setOpenId(p.id)} />}
        />
      </Section>
    </div>
  )
}

function PlaylistCard({ playlist, t, onOpen }: { playlist: Playlist; t: Translate; onOpen: () => void }) {
  const first = playlist.first_video_id
  return (
    <article className={cx('card')} data-part="playlist-card" data-variant="grid" data-playlist={playlist.id}>
      <div className={cx('card-frame')}>
        <div className={cx('card-media')} data-part="media">
          {first ? (
            <Thumb videoId={first} title={playlist.name} mark={false} />
          ) : (
            <div className={cx('thumb')} data-part="thumb" data-empty="true">
              <div className={cx('thumb-fallback')} role="img" aria-label={playlist.name}>
                <Codicon name="list-unordered" size={22} />
              </div>
            </div>
          )}
        </div>
        <div className={cx('card-body')} data-part="body">
          <h3 className={cx('card-title t-head')} data-part="title">
            <button type="button" className={cx('bare card-open')} data-part="playlist-open" aria-label={t('playlists.open', { name: playlist.name })} onClick={onOpen}>
              {playlist.name}
            </button>
          </h3>
          <div className={cx('card-meta t-label')} data-part="meta">
            <span className={cx('card-stat num')}>{countText(t, playlist.count)}</span>
          </div>
        </div>
      </div>
    </article>
  )
}

interface DetailProps {
  id: string
  density: Density
  onBack: () => void
  onDeleted: (id: string) => void
}

function PlaylistDetail({ id, density, onBack, onDeleted }: DetailProps) {
  const t = useT('home')
  const tc = useT()
  const detailQ = useRest('GET /playlists/{id}', { path: { id } })
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const fail = (error: unknown) => host.notify({ kind: 'error', message: t('playlists.failed', { error: errorText(tc, toApiError(error)) }) })

  const back = (
    <Button variant="ghost" size="sm" data-part="playlist-back" onClick={onBack}>
      <Codicon name="arrow-left" size={14} />
      {t('playlists.back')}
    </Button>
  )
  if (detailQ.error && !detailQ.data) {
    return (
      <div data-part="playlist-detail" data-playlist={id}>
        {back}
        <ErrorView error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      </div>
    )
  }
  if (!detailQ.data) return <GridSkeleton density={density} count={6} label={t('playlists.label')} />

  const playlist = detailQ.data.playlist
  const items: FeedItem[] = (detailQ.data.items ?? []).filter((it) => !removed.has(it.video.id))
  const ref = { id: playlist.id, name: playlist.name }

  const remove = (it: FeedItem) => {
    setRemoved((s) => new Set(s).add(it.video.id))
    restCall('POST /playlists/{id}/items/remove', { path: { id }, body: { video_ids: [it.video.id] } }).then(
      () => {
        host.notify({ kind: 'success', message: t('playlists.removed', { name: playlist.name }) })
        void invalidatePlaylists()
      },
      (error: unknown) => {
        setRemoved((s) => {
          const next = new Set(s)
          next.delete(it.video.id)
          return next
        })
        fail(error)
      }
    )
  }

  const clean = name.replace(/\s+/g, ' ').trim()
  const saveName = () => {
    if (!clean || savingName) return
    if (clean === playlist.name) {
      setRenaming(false)
      return
    }
    setSavingName(true)
    restCall('PATCH /playlists/{id}', { path: { id }, body: { name: clean } }).then(
      (next) => {
        setSavingName(false)
        setRenaming(false)
        host.notify({ kind: 'success', message: t('playlists.renamed', { name: next.name }) })
        void invalidatePlaylists()
      },
      (error: unknown) => {
        setSavingName(false)
        fail(error)
      }
    )
  }
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveName()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setRenaming(false)
    }
  }

  /** Already confirmed: an error stays in the dialog (the ConfirmDialog shows it). */
  const confirmDelete = async () => {
    try {
      await restCall('DELETE /playlists/{id}', { path: { id } })
    } catch (error) {
      throw new Error(t('playlists.failed', { error: errorText(tc, toApiError(error)) }))
    }
    host.notify({ kind: 'success', message: t('playlists.deleted', { name: playlist.name }) })
    void invalidatePlaylists()
    onDeleted(id)
  }

  const title = renaming ? (
    <Stack direction="row" gap={2} align="center">
      <Input
        data-part="playlist-rename-input"
        aria-label={t('playlists.rename_label')}
        maxLength={PLAYLIST_NAME_MAX}
        autoFocus
        value={name}
        onChange={(e: { target: { value: string } }) => setName(e.target.value)}
        onKeyDown={onNameKey}
      />
      <Button variant="secondary" size="xs" data-part="playlist-rename-save" disabled={!clean} loading={savingName} onClick={saveName}>
        {t('playlists.rename_save')}
      </Button>
      <Button variant="ghost" size="xs" data-part="playlist-rename-cancel" onClick={() => setRenaming(false)}>
        {t('playlists.rename_cancel')}
      </Button>
    </Stack>
  ) : (
    playlist.name
  )

  const actions = (
    <Stack direction="row" gap={2} align="center" wrap>
      <span className={cx('t-label num')}>{countText(t, items.length)}</span>
      <Button variant="secondary" size="xs" data-part="playlist-play-all" disabled={!items.length} onClick={() => playAll(ref, items)}>
        <Codicon name="play" size={13} />
        {t('playlists.play_all')}
      </Button>
      {renaming ? null : (
        <Button
          variant="ghost"
          size="xs"
          data-part="playlist-rename"
          onClick={() => {
            setName(playlist.name)
            setRenaming(true)
          }}
        >
          <Codicon name="edit" size={13} />
          {t('playlists.rename')}
        </Button>
      )}
      <Button variant="ghost" size="xs" data-part="playlist-delete" onClick={() => setConfirming(true)}>
        <Codicon name="trash" size={13} />
        {t('playlists.delete')}
      </Button>
    </Stack>
  )

  const cardActions = (it: FeedItem) => {
    const list: QuickAction[] = [
      { id: 'playlist', label: tc('playlists.add'), icon: 'list-unordered', onSelect: () => openPlaylistPicker(it) },
      { id: 'remove_from_playlist', label: t('playlists.remove'), icon: 'close', onSelect: () => remove(it) }
    ]
    return <QuickActions actions={list} />
  }

  return (
    <div data-part="playlist-detail" data-playlist={id}>
      {back}
      <Section title={title} actions={actions} description={t('playlists.local_note')}>
        {items.length ? (
          <Grid
            items={items}
            getKey={(it) => it.video.id}
            label={t('playlists.items_label', { name: playlist.name })}
            density={density}
            onOpen={(it) => openFromPlaylist(ref, items, it)}
            renderItem={(it) => (
              <VideoCard item={it} variant={cardVariantFor(density)} onOpen={() => openFromPlaylist(ref, items, it)} actions={cardActions(it)} />
            )}
          />
        ) : (
          <EmptyView compact icon="list-unordered" title={t('playlists.playlist_empty_title')} description={t('playlists.playlist_empty_desc')} />
        )}
      </Section>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirmDelete}
        title={t('playlists.delete_title', { name: playlist.name })}
        description={t('playlists.delete_desc')}
        confirmLabel={t('playlists.delete_confirm')}
        cancelLabel={t('playlists.delete_cancel')}
        destructive
      />
    </div>
  )
}
