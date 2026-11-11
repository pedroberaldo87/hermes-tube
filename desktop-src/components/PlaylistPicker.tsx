// "Add to playlist": a small dialog with the person's local playlists (check = in it, uncheck = out) and
// "New playlist…". Any screen asks for it with `openPlaylistPicker(item)` (lib/video-actions) and renders one
// `<PlaylistPicker />`; it shows only while a request is pending. Each check saves at once and says so with the
// app's notice ("Saved to Physics"); a failure puts the check back and says why. Playlists are local to the plugin:
// nothing here writes to the YouTube account. Texts in the `common` namespace (`playlists.*`).
import { Button, Checkbox, Codicon, Input, host } from '@hermes/plugin-sdk'
import { type KeyboardEvent, useState } from 'react'
import type { FeedItem, Playlist } from '../../shared/api-types'
import { errorText, useT } from '../lib/i18n'
import { invalidateRest, restCall, toApiError, useRest } from '../lib/rest'
import { cx } from '../lib/style'
import { closePlaylistPicker, usePlaylistPick } from '../lib/video-actions'
import { DialogFrame } from './DialogFrame'
import { Stack } from './Page'

/** Same limit as the backend (`core/playlists.MAX_NAME_LEN`). */
export const PLAYLIST_NAME_MAX = 80

/** Routes whose cached answers change when a playlist changes. */
export function invalidatePlaylists(): Promise<void> {
  return invalidateRest('GET /playlists', 'GET /playlists/{id}')
}

/** "1 video" / "N videos" (`playlists.count_one` / `playlists.count`). */
export function playlistCountKey(count: number): string {
  return count === 1 ? 'count_one' : 'count'
}

export function PlaylistPicker() {
  const pick = usePlaylistPick()
  if (!pick) return null
  // a new request (another video) starts the dialog over
  return <PickerDialog key={pick.item.video.id} item={pick.item} />
}

function PickerDialog({ item }: { item: FeedItem }) {
  const t = useT()
  const videoId = item.video.id
  const listQ = useRest('GET /playlists', { query: { video_id: videoId } })
  /** Checks changed here, until the list comes back with them. */
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const items: Playlist[] = listQ.data?.items ?? []
  const member = new Set(listQ.data?.member_of ?? [])
  const isChecked = (id: string) => local[id] ?? member.has(id)
  const fail = (error: unknown) => host.notify({ kind: 'error', message: t('playlists.failed', { error: errorText(t, toApiError(error)) }) })
  const setBusyFor = (id: string, on: boolean) =>
    setBusy((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const toggle = (p: Playlist, on: boolean) => {
    if (busy.has(p.id)) return
    const before = isChecked(p.id)
    setLocal((m) => ({ ...m, [p.id]: on }))
    setBusyFor(p.id, true)
    const call = on
      ? restCall('POST /playlists/{id}/items', { path: { id: p.id }, body: { video_ids: [videoId] } })
      : restCall('POST /playlists/{id}/items/remove', { path: { id: p.id }, body: { video_ids: [videoId] } })
    call.then(
      () => {
        setBusyFor(p.id, false)
        host.notify({ kind: 'success', message: t(on ? 'playlists.saved' : 'playlists.removed', { name: p.name }) })
        void invalidatePlaylists()
      },
      (error: unknown) => {
        setBusyFor(p.id, false)
        setLocal((m) => ({ ...m, [p.id]: before }))
        fail(error)
      }
    )
  }

  const clean = name.replace(/\s+/g, ' ').trim()
  const create = () => {
    if (!clean || saving) return
    setSaving(true)
    restCall('POST /playlists', { body: { name: clean, video_ids: [videoId] } }).then(
      (made) => {
        setSaving(false)
        setCreating(false)
        setName('')
        setLocal((m) => ({ ...m, [made.id]: true }))
        host.notify({ kind: 'success', message: t('playlists.saved', { name: made.name }) })
        void invalidatePlaylists()
      },
      (error: unknown) => {
        setSaving(false)
        fail(error)
      }
    )
  }
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      create()
    }
  }

  const footer = (
    <Button variant="secondary" size="sm" data-part="playlist-picker-done" onClick={closePlaylistPicker}>
      {t('playlists.picker.done')}
    </Button>
  )

  return (
    <DialogFrame size="sm" title={t('playlists.picker.title')} description={t('playlists.picker.description')} onClose={closePlaylistPicker} footer={footer}>
      <div data-part="playlist-picker" data-video={videoId}>
        <Stack gap={2}>
          <p className={cx('t-label')}>{item.video.title}</p>
          {listQ.error && !listQ.data ? (
            <p className={cx('t-body')} role="alert">
              {t('playlists.failed', { error: errorText(t, toApiError(listQ.error)) })}
            </p>
          ) : !listQ.data ? (
            <p className={cx('t-label')} role="status">
              {t('playlists.picker.loading')}
            </p>
          ) : items.length === 0 ? (
            <p className={cx('t-body')}>{t('playlists.picker.empty')}</p>
          ) : (
            <div role="group" aria-label={t('playlists.picker.title')}>
              <Stack gap={1}>
                {items.map((p) => (
                  <label key={p.id} data-part="playlist-option" data-playlist={p.id}>
                    <Stack direction="row" gap={2} align="center">
                      <Checkbox checked={isChecked(p.id)} disabled={busy.has(p.id)} onCheckedChange={(v: boolean | 'indeterminate') => toggle(p, v === true)} aria-label={p.name} />
                      <span className={cx('t-body')}>{p.name}</span>
                      <span className={cx('t-label num')}>{t(`playlists.${playlistCountKey(p.count)}`, { count: p.count })}</span>
                    </Stack>
                  </label>
                ))}
              </Stack>
            </div>
          )}
          {creating ? (
            <Stack direction="row" gap={2} align="center">
              <Input
                data-part="playlist-new-name"
                aria-label={t('playlists.picker.name_label')}
                placeholder={t('playlists.picker.name_placeholder')}
                maxLength={PLAYLIST_NAME_MAX}
                autoFocus
                value={name}
                onChange={(e: { target: { value: string } }) => setName(e.target.value)}
                onKeyDown={onNameKey}
              />
              <Button variant="secondary" size="sm" data-part="playlist-new-create" disabled={!clean} loading={saving} onClick={create}>
                {t('playlists.picker.create')}
              </Button>
              <Button variant="ghost" size="sm" data-part="playlist-new-cancel" onClick={() => setCreating(false)}>
                {t('playlists.picker.cancel')}
              </Button>
            </Stack>
          ) : (
            <Button variant="ghost" size="sm" data-part="playlist-new" onClick={() => setCreating(true)}>
              <Codicon name="add" size={14} />
              {t('playlists.picker.new')}
            </Button>
          )}
        </Stack>
      </div>
    </DialogFrame>
  )
}
