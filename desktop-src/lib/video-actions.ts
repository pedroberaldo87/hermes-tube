// Video action on/off, shared by Home and chat: what the action changes, the exact inverse (for the
// toast "Undo") and the MEMORY of the state before turning on — turning off goes back to it, not to `seen` (a new video
// goes back to being new). The screen keeps the optimistic layer its own way; only the rule lives here.
// Also "Add to playlist" (any screen asks for the picker with `openPlaylistPicker`; the picker itself is
// `components/PlaylistPicker`) and "Play all" (a local playlist → the Watch queue). Playlists are local to the plugin:
// nothing here writes to the YouTube account.
import { atom, useValue } from '@hermes/plugin-sdk'
import type { FeedItem, Reaction, VideoState, VideoStateChange } from '../../shared/api-types'
import { openOnYouTube, openVideo } from './format'
import { onShellReset } from './lifecycle'
import { type WatchFrom, watchVideo } from './player'

export type VideoAction = 'watched' | 'later' | 'archive' | 'up' | 'down'

export const VIDEO_ACTIONS: readonly VideoAction[] = ['watched', 'later', 'archive', 'up', 'down']

export const isVideoAction = (a: string): a is VideoAction => (VIDEO_ACTIONS as readonly string[]).includes(a)

/** The body of `POST /videos/state` without the ids. */
export type VideoChange = Omit<VideoStateChange, 'video_ids'>

/** Optimistic layer per video (what the screen shows before the response). */
export interface VideoLayer {
  state?: VideoState
  reaction?: Reaction | null
}

type Current = Pick<FeedItem, 'state' | 'reaction'>

/**
 * What the action changes, given the current state (on/off). Turning off goes back to the state from BEFORE turning on
 * (`prior`, remembered in this session: a new video goes back to being new); without a memory (it came that way from the server),
 * "watched"/"later" turn off to `seen` and "archived" goes back to `seen`.
 */
export function changeFor(action: VideoAction, item: Current, prior?: VideoState | null): { change: VideoChange; toast: string } {
  const back = (on: VideoState): VideoState => (prior && prior !== on ? prior : 'seen')
  switch (action) {
    case 'watched':
      return item.state === 'watched' ? { change: { state: back('watched') }, toast: 'toast.unwatched' } : { change: { state: 'watched' }, toast: 'toast.watched' }
    case 'later':
      return item.state === 'later' ? { change: { state: back('later') }, toast: 'toast.unlater' } : { change: { state: 'later' }, toast: 'toast.later' }
    case 'archive':
      return item.state === 'archived' ? { change: { state: back('archived') }, toast: 'toast.unarchived' } : { change: { state: 'archived' }, toast: 'toast.archived' }
    case 'up':
      return item.reaction === 'up' ? { change: { reaction: null }, toast: 'toast.reaction_cleared' } : { change: { reaction: 'up' }, toast: 'toast.up' }
    case 'down':
      return item.reaction === 'down' ? { change: { reaction: null }, toast: 'toast.reaction_cleared' } : { change: { reaction: 'down' }, toast: 'toast.down' }
  }
}

/** The state each state action turns ON. */
const STATE_OF: Partial<Record<VideoAction, VideoState>> = { watched: 'watched', later: 'later', archive: 'archived' }

/** Exact inverse: only the fields the action touched, with the previous value. */
export function inverseOf(change: VideoChange, before: Current): VideoChange {
  const out: VideoChange = {}
  if ('state' in change) out.state = before.state
  if ('reaction' in change) out.reaction = before.reaction
  return out
}

export function asLayer(change: VideoChange): VideoLayer {
  const l: VideoLayer = {}
  if (change.state !== undefined) l.state = change.state
  if ('reaction' in change) l.reaction = change.reaction ?? null
  return l
}

/** Memory of the state before turning on, per video and action (`${id}:${action}`). */
export type PriorMemory = Map<string, VideoState>

export interface VideoActionPlan {
  change: VideoChange
  /** i18n key of the toast (`toast.*`). */
  toast: string
  /** Inverse route (the toast's "Undo"). */
  inverse: VideoChange
  /** Save failed: the memory goes back to what it was before this click. */
  restore: () => void
}

/**
 * Decides the click and updates the memory: turning on remembers the current state; turning off forgets. Call `restore()` if the
 * save fails.
 */
export function planVideoAction(priors: PriorMemory, action: VideoAction, id: string, current: Current): VideoActionPlan {
  const memo = `${id}:${action}`
  const prevPrior = priors.get(memo)
  const { change, toast } = changeFor(action, current, prevPrior)
  if (change.state !== undefined) {
    if (change.state === STATE_OF[action]) priors.set(memo, current.state)
    else priors.delete(memo)
  }
  return {
    change,
    toast,
    inverse: inverseOf(change, { state: current.state, reaction: current.reaction }),
    restore: () => {
      if (prevPrior === undefined) priors.delete(memo)
      else priors.set(memo, prevPrior)
    }
  }
}

// ------------------------------------------------------------------ Add to playlist

/** A pending "Add to playlist" request: the picker shows for this video. */
export interface PlaylistPick {
  item: FeedItem
}

export const $playlistPick = atom<PlaylistPick | null>(null)

onShellReset(() => {
  $playlistPick.set(null)
})

/** Opens the "Add to playlist" picker for a video (the screen's `PlaylistPicker` draws it). */
export function openPlaylistPicker(item: FeedItem): void {
  $playlistPick.set({ item })
}

export function closePlaylistPicker(): void {
  if ($playlistPick.get() !== null) $playlistPick.set(null)
}

export function usePlaylistPick(): PlaylistPick | null {
  return useValue($playlistPick)
}

// ------------------------------------------------------------------ Play all

/** Origin kind of a queue copied from a local playlist (`lib/queue`). */
export const PLAYLIST_ORIGIN = 'playlist'

/**
 * "Play all": the playlist goes to the Watch queue (in its order, the first video playing). The queue only exists in
 * the Hermes player, so this asks for it even when videos usually open on YouTube; without the Watch screen, the first
 * video opens on YouTube. `false` = nothing to play.
 */
export function playAll(playlist: { id: string; name: string }, items: readonly FeedItem[]): boolean {
  const first = items[0]
  if (!first) return false
  const origin = { kind: PLAYLIST_ORIGIN, id: playlist.id, label: playlist.name }
  if (!watchVideo(first.video.id, { item: first, list: items, source: playlist.name, origin })) openOnYouTube(first.video.id)
  return true
}

/**
 * A click on one video of a playlist: opens it as any video click does (Hermes or YouTube, per the setting), with the
 * playlist as the Watch queue.
 */
export function openFromPlaylist(playlist: { id: string; name: string }, items: readonly FeedItem[], item: FeedItem): void {
  const from: WatchFrom = { item, list: items, source: playlist.name, origin: { kind: PLAYLIST_ORIGIN, id: playlist.id, label: playlist.name } }
  openVideo(item.video.id, from)
}
