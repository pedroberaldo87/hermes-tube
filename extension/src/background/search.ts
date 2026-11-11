// SKELETON — search executor.
//
// To be filled in (contract/ext-protocol.md, "Delegated searches"):
// - `ctx.onState(s => …)`: with `search_pending > 0`, poll `GET /ext/search-jobs` every `SEARCH_JOBS_POLL_MS`
//   (3 s, chained `setTimeout` while the SW is awake); with 0, stop. The core's 30 s alarm already reads
//   `/ext/state` and wakes the SW.
// - For each job: discard if `expires_at` has passed (server clock: `ExtState.server_time`); otherwise open
//   `https://www.youtube.com/results?search_query=…` (with the date `sp` when `order = date`) in a background tab,
//   `search.extract` command (content/search) and `POST /ext/search-jobs/{id}/result {payload}` (or `{error}`);
//   `409 conflict` (expired on the server) → ignore.
// - When implementing, list the routes in REAL_ROUTES.
// Skeleton: does not poll.
import type { ExtRouteKey } from '../../../shared/api-types'
import type { BackgroundModule } from '../lib/background'

export const MODULE = 'background/search'
export const ROUTES = ['GET /ext/search-jobs', 'POST /ext/search-jobs/{id}/result'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = []
export const MESSAGES = [] as const

export const search: BackgroundModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  MESSAGES,
  register(ctx) {
    ctx.onState(() => {
      // stub: turn the poll on when state.search_pending > 0
    })
  }
}
