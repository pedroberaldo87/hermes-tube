// Watching inside Hermes: the "Watch" screen is a SECTION of the single HermesTube page (lib/nav) — no center tab of
// its own — and the player is the core's OWN: the screen passes the plain video link to the SDK's
// `MessageTextContent`, which the app renders with the embedded player (youtube-nocookie.com), under the app's embed
// consent. No iframe of our own.
//  - Opening a video sets `$watch`, switches the page to the Watch section and brings the page to the front
//    (`host.navigate` to the single page route: opens it when closed). Another video swaps the content of the same
//    section and does not stack a history entry (one Back leaves Watch).
//  - State in the `$watch` atom (current video, item if it came with one, the list it came from and the source name); the screen
//    reads from it. The screen is registered by main.tsx (`setWatchRenderer`): lib does not import screens.
//  - Without the screen registered (plugin unloading, old tests) or with an invalid id → `watchVideo` returns `false`
//    and whoever called it goes on to open YouTube.
//  - "Up next" is an editable queue (`lib/queue`): opening from outside copies the list it came from (or keeps the
//    queue, see `openInQueue`); playing from inside the queue (`playQueued`) only moves its mark.
import { Button, Codicon, atom, useValue } from '@hermes/plugin-sdk'
import { type ReactNode, createElement } from 'react'
import type { FeedItem } from '../../shared/api-types'
import { maybePluginContext } from './ctx'
import { $dialogStack } from './dialogs'
import { type VideoOpenFrom, isVideoId, setVideoOpener } from './format'
import { useT } from './i18n'
import { onShellReset } from './lifecycle'
import { currentSection, frontPage, noteDetail, setSectionGuard, setWatchCloser, showSection } from './nav'
import { type QueueOrigin, getQueue, openInQueue, setCurrent, setQueue } from './queue'
import { cx } from './style'

export { openOnYouTube } from './format'

/** Maximum length of a title shown as a tab label. */
export const TAB_TITLE_MAX = 40

/**
 * Where the video was opened from: the item (if the screen has it), the list of the same tab/source and its name.
 * `origin` (optional): what the list is, for callers that know (a saved playlist, Watch later); see `lib/queue`.
 */
export interface WatchFrom extends VideoOpenFrom {
  origin?: QueueOrigin | null
}

export interface WatchState {
  id: string
  item: FeedItem | null
  list: readonly FeedItem[]
  source: string | null
  /** Changes on every open (the screen takes focus back and collapses the description). */
  seq: number
}

export const $watch = atom<WatchState | null>(null)

let renderer: (() => ReactNode) | null = null

onShellReset(() => {
  renderer = null
  $watch.set(null)
})

// the Watch section exists only while a video is open; its ✕ clears the video
setSectionGuard('watch', () => !!renderer && $watch.get() !== null)
setWatchCloser(() => $watch.set(null))

/** main.tsx hands over the screen. `null` turns it off (videos go to YouTube). Returns the disposer. */
export function setWatchRenderer(render: (() => ReactNode) | null): () => void {
  renderer = render
  return () => {
    if (renderer === render) renderer = null
  }
}

/** The registered Watch screen (the shell draws it as the Watch section). */
export function watchRenderer(): (() => ReactNode) | null {
  return renderer
}

/** Is the Watch screen registered? */
export function canWatchInHermes(): boolean {
  return !!renderer
}

/** Tab title: the video's, cut at a word boundary (with an ellipsis); empty → `fallback`. */
export function tabTitle(title: string | null | undefined, fallback: string, max: number = TAB_TITLE_MAX): string {
  const text = (title ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  if (text.length <= max) return text
  const room = text.slice(0, max - 1)
  const space = room.lastIndexOf(' ')
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`
}

/**
 * Opens (or swaps) the video in the Watch section of the single page. `false` = could not (screen not registered,
 * invalid id): the caller opens YouTube.
 */
export function watchVideo(id: string, from: WatchFrom = {}): boolean {
  if (!isVideoId(id) || !canWatchInHermes()) return false
  const list = from.list ? [...from.list] : []
  const item = from.item ?? list.find((it) => it.video.id === id) ?? null
  // opened from outside the queue: the queue follows the list it came from (see `openInQueue`)
  openInQueue(id, from)
  show(id, item, list, from.source ?? null)
  return true
}

/**
 * Plays a video of the queue (a click in "Up next", N/P, removing the current one): the queue keeps its order and
 * edits, only the mark moves. `false` when the video is not queued or the screen is not registered.
 */
export function playQueued(id: string): boolean {
  const q = getQueue()
  const item = q?.items.find((it) => it.video.id === id)
  if (!q || !item || !canWatchInHermes()) return false
  setQueue(setCurrent(q, id))
  const prev = $watch.get()
  show(id, item, prev?.list ?? [], prev?.source ?? null)
  return true
}

function show(id: string, item: FeedItem | null, list: readonly FeedItem[], source: string | null): void {
  const prev = $watch.get()
  $watch.set({ id, item, list, source, seq: (prev?.seq ?? 0) + 1 })
  // swapping inside Watch (Up next, N/P) does not stack: only the entry's video changes
  if (currentSection() === 'watch') noteDetail('watch', id)
  else showSection('watch', id)
  frontPage()
}

/** The current video's data arrived later (opened by id only): stores it (the internal tab title follows). */
export function setWatchItem(item: FeedItem): void {
  const cur = $watch.get()
  if (!cur || cur.id !== item.video.id || cur.item === item) return
  $watch.set({ ...cur, item })
}

// ------------------------------------------------------------------ Watch screen preferences
// Stored in the plugin's `ctx.storage` like the open mode. Both default to off/not dismissed.

/** "Larger player": scale the core's player up with `zoom` (trades sharpness for size). */
export const LARGE_PLAYER_KEY = 'player.large'
/** The one-time "Always allow YouTube" tip under the player was dismissed. */
export const TIP_DISMISSED_KEY = 'player.always_allow_tip_dismissed'

const $flags = atom<Readonly<Record<string, boolean>>>({})

onShellReset(() => {
  $flags.set({})
})

function storedFlag(key: string): boolean {
  try {
    return maybePluginContext()?.storage?.get<unknown>(key, false) === true
  } catch {
    return false
  }
}

export function getPlayerFlag(key: string): boolean {
  const v = $flags.get()[key]
  return v ?? storedFlag(key)
}

export function setPlayerFlag(key: string, value: boolean): void {
  $flags.set({ ...$flags.get(), [key]: value })
  try {
    maybePluginContext()?.storage?.set(key, value)
  } catch {
    // storage unavailable: the choice only holds for this session
  }
}

export function usePlayerFlag(key: string): boolean {
  const v = useValue($flags)[key]
  return v ?? storedFlag(key)
}

// ------------------------------------------------------------------ where the click goes
// Local setting "Open videos: In Hermes | On YouTube", stored in the plugin's `ctx.storage` like the Home density.
// Default: In Hermes (when the Watch screen is registered; without it the setting does not even show and the click goes outside).

export type OpenMode = 'hermes' | 'youtube'

export const OPEN_MODES: readonly OpenMode[] = ['hermes', 'youtube']

/** Key in the plugin's `ctx.storage`. */
export const OPEN_MODE_KEY = 'player.open'

const $openMode = atom<OpenMode | null>(null)

onShellReset(() => {
  $openMode.set(null)
})

const isOpenMode = (v: unknown): v is OpenMode => v === 'hermes' || v === 'youtube'

function storedOpenMode(): OpenMode {
  try {
    const v = maybePluginContext()?.storage?.get<unknown>(OPEN_MODE_KEY, 'hermes')
    return isOpenMode(v) ? v : 'hermes'
  } catch {
    return 'hermes'
  }
}

export function getOpenMode(): OpenMode {
  return $openMode.get() ?? storedOpenMode()
}

export function setOpenMode(mode: OpenMode): void {
  $openMode.set(mode)
  try {
    maybePluginContext()?.storage?.set(OPEN_MODE_KEY, mode)
  } catch {
    // storage unavailable: the choice only holds for this session
  }
}

export function useOpenMode(): OpenMode {
  return useValue($openMode) ?? storedOpenMode()
}

/**
 * The video click (installed in `lib/format.openVideo`): the Watch section when the setting is "In Hermes" and the
 * screen is registered. With a plugin dialog open (e.g. the theme list), outside: the section would open hidden
 * behind the dialog.
 */
export function playVideo(id: string, from: WatchFrom = {}): boolean {
  if (getOpenMode() !== 'hermes' || $dialogStack.get().length > 0) return false
  return watchVideo(id, from)
}

setVideoOpener(playVideo)

const MODE_ICON: Record<OpenMode, string> = { hermes: 'play-circle', youtube: 'link-external' }

/**
 * "Open videos: In Hermes | On YouTube" — two buttons like the Home icon density (visible label, or icon only
 * with `compact`; the name goes in the aria-label and tooltip). Hidden when the Watch screen is not registered.
 */
export function OpenModeSwitch({ compact = false }: { compact?: boolean }) {
  const t = useT('watch')
  const mode = useOpenMode()
  if (!canWatchInHermes()) return null
  return createElement(
    'div',
    { className: cx('mode'), 'data-part': 'open-mode', role: 'group', 'aria-label': t('open_mode.label') },
    createElement(
      'div',
      { className: cx('stack'), 'data-direction': 'row', 'data-gap': 1, 'data-align': 'center' },
      OPEN_MODES.map((m) => {
        // (separate object: `data-mode` does not go through the literal's excess-property check)
        const props = {
          key: m,
          variant: mode === m ? ('secondary' as const) : ('ghost' as const),
          size: compact ? ('icon-xs' as const) : ('xs' as const),
          'data-mode': m,
          'aria-pressed': mode === m,
          'aria-label': compact ? `${t('open_mode.label')}: ${t(`open_mode.${m}`)}` : undefined,
          title: t(`open_mode.${m}_hint`),
          onClick: () => setOpenMode(m)
        }
        return createElement(Button, props, createElement(Codicon, { name: MODE_ICON[m], size: 14 }), compact ? null : t(`open_mode.${m}`))
      })
    )
  )
}
