// SKELETON — Home page on youtube.com.
//
// To be filled in: with `ExtState.home_on_youtube`, replace the home page (`/`) with the Hermes tabs
// (`feed.get` → `GET /ext/feed`), quick actions (`videos.state`, `read.mark`), thumbnail `hqdefault.jpg`
// (or `hq2.jpg` with the Extra). `stop()` restores the original Home.
// Language namespace: `home`.
// Skeleton: injects nothing.
import type { ExtRouteKey } from '../../../../shared/api-types'
import type { ContentModule } from '../../lib/content'

export const MODULE = 'content/home'
export const ROUTES = ['GET /ext/feed', 'POST /ext/videos/state', 'POST /ext/read'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = []

export const home: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: [],
  matches: (url, state) => url.pathname === '/' && state?.home_on_youtube === true,
  start() {},
  stop() {}
}
