// content/sidebar — "HermesTube" section in the youtube.com left guide: Hermes tabs and folders with counters of
// new items, a pane with the videos of a tab/folder next to the guide and "mark as read" with Undo.
//
// - Attaches when there is an `ExtState` (paired); stays attached across SPA navigations and puts itself back when YouTube
//   redraws the guide (guide.ts). Collapsed guide: only the icon in the mini-guide with the total. Video page: inside the
//   guide drawer.
// - Talks only to the background: `state.get`, `feed.get`, `read.mark`, `conn.status` (routes `GET /ext/state`,
//   `GET /ext/feed`, `POST /ext/read`).
// - Any internal error turns the bar off silently (controller.ts); the page never sees an exception of ours.
// - Language namespace: `sidebar`.
import type { ExtRouteKey } from '../../../../shared/api-types'
import type { ContentContext, ContentModule } from '../../lib/content'
import { type SidebarController, type SidebarOptions, startSidebar } from './controller'

export { SIDEBAR_TREE_KEY, UNDO_MS, FEED_LIMIT } from './controller'

export const MODULE = 'content/sidebar'
export const ROUTES = ['GET /ext/state', 'GET /ext/feed', 'POST /ext/read'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ROUTES

export type SidebarModule = ContentModule & { start(ctx: ContentContext): Promise<void>; stop(): void }

export function createSidebarModule(opts: SidebarOptions = {}): SidebarModule {
  let ctl: SidebarController | null = null
  let gen = 0
  return {
    MODULE,
    ROUTES,
    REAL_ROUTES,
    COMMANDS: [],
    matches: (url, state) => state !== null && !url.pathname.startsWith('/embed/'),
    async start(ctx: ContentContext) {
      const mine = ++gen
      ctl?.stop()
      ctl = null
      try {
        const c = await startSidebar(ctx, opts)
        if (mine !== gen) c.stop()
        else ctl = c
      } catch (e) {
        console.debug('[tube] sidebar did not start:', e instanceof Error ? e.message : String(e))
      }
    },
    stop() {
      gen++
      ctl?.stop()
      ctl = null
    }
  }
}

export const sidebar: SidebarModule = createSidebarModule()
