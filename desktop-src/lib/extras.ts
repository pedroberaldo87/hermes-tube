// `extras` atom (`GET /extras`): Extras state read by components (e.g. VideoCard swaps the
// thumbnail when "honest thumbnails" is on). Pages do not know about Extras: only the Extras
// page writes here (`setExtras`) after saving; the ShellHost keeps it in sync.
import { atom, useValue } from '@hermes/plugin-sdk'
import type { ExtrasState } from '../../shared/api-types'
import { onShellReset } from './lifecycle'

export const $extras = atom<ExtrasState | null>(null)

/**
 * The Extras page is still a "coming soon" notice: while it is, nothing links to it (menu, ⌘K, Home
 * button). The route stays registered. Becomes `true` once the page ships.
 */
export const EXTRAS_PAGE_READY: boolean = false

onShellReset(() => {
  $extras.set(null)
})

/** Writes the Extras state (the Extras page after `POST /extras`; ShellHost on every read). */
export function setExtras(next: ExtrasState | null): void {
  $extras.set(next)
}

export function useExtras(): ExtrasState | null {
  return useValue($extras)
}

/** Refetch interval of `GET /extras` (data at 60 s). */
export const EXTRAS_REFRESH_MS = 60_000

export type ThumbSize = 'mq' | 'hq'

/**
 * Thumbnail URL of a video. With "honest thumbnails" on, uses a frame from the middle of the video
 * (`hq2.jpg`) instead of the cover picked by the channel.
 */
export function thumbnailUrl(videoId: string, extras: Pick<ExtrasState, 'honest_thumbnails'> | null, size: ThumbSize = 'mq'): string {
  const id = encodeURIComponent(videoId)
  if (extras?.honest_thumbnails) return `https://i.ytimg.com/vi/${id}/hq2.jpg`
  return `https://i.ytimg.com/vi/${id}/${size}default.jpg`
}
