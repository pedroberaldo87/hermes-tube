// SKELETON — search executor.
//
// To be filled in: in the search tab opened by background/search, the `search.extract {job_id}` command returns the
// page's `ytInitialData` (object) for `POST /ext/search-jobs/{id}/result`. Read it from the inline `<script>` (the
// content script cannot see page globals; if needed, use a `main-world` target + a manifest entry).
// Fixtures: tests/fixtures/youtube/search/*.html.
// Skeleton: returns `payload: null`.
import type { ExtRouteKey } from '../../../shared/api-types'
import type { ContentModule } from '../lib/content'

export const MODULE = 'content/search'
/** the result goes to the server through background/search */
export const ROUTES = [] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = []

export const searchContent: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: ['search.extract'],
  matches: (url) => url.pathname === '/results',
  start() {},
  commands: {
    'search.extract': async () => ({ payload: null }) // stub
  }
}
