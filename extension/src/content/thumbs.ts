// SKELETON — sidebar and thumbnails.
//
// To be filled in: "honest thumbnails" Extra — with `ExtState.extras_honest_thumbnails`, replace the thumbnails of
// all of youtube.com with `https://i.ytimg.com/vi/<id>/hq2.jpg` (MutationObserver) and **undo** it in `stop()`
// (the runtime calls `stop` when the Extra is turned off).
// Skeleton: replaces nothing.
import type { ExtRouteKey } from '../../../shared/api-types'
import type { ContentModule } from '../lib/content'

export const MODULE = 'content/thumbs'
export const ROUTES = ['GET /ext/state'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = []

export const thumbs: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: [],
  matches: (_url, state) => state?.extras_honest_thumbnails === true,
  start() {},
  stop() {}
}
