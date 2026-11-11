// Runtime lists of the contract keys. `shared/` only exports types for routes and messages;
// these lists are checked against the types at compile time (missing or extra = tsc error).
import type { ExtRouteKey } from '../../../shared/api-types'
import type { ExtRequestType, ExtTabCommandType } from '../../../shared/ext-messages'

/** Ensures the list has all the keys of type `T` (and only those). */
type Exhaustive<T, L extends readonly T[]> = [Exclude<T, L[number]>] extends [never] ? L : { missing: Exclude<T, L[number]> }
const exhaustive =
  <T>() =>
  <const L extends readonly T[]>(list: L & Exhaustive<T, L>): L =>
    list

/** Routes of the plugin's own server (`ExtRoutes` in shared/api-types.ts). */
export const EXT_ROUTE_KEYS = exhaustive<ExtRouteKey>()([
  'GET /health',
  'POST /pair/complete',
  'POST /ext/unpair',
  'GET /ext/state',
  'POST /ext/sync/subscriptions',
  'POST /ext/sync/watch',
  'GET /ext/feed',
  'POST /ext/videos/state',
  'POST /ext/read',
  'GET /ext/queue',
  'POST /ext/queue/{id}/result',
  'GET /ext/search-jobs',
  'POST /ext/search-jobs/{id}/result'
])

/** Routes without `Authorization: Bearer` (the rest require a token). */
export const UNAUTHENTICATED_ROUTES = ['GET /health', 'POST /pair/complete'] as const satisfies readonly ExtRouteKey[]
export type AuthedRouteKey = Exclude<ExtRouteKey, (typeof UNAUTHENTICATED_ROUTES)[number]>

/** Popup/content → background messages (`ExtRequests`). */
export const EXT_REQUEST_TYPES = exhaustive<ExtRequestType>()([
  'pair.submit',
  'pair.unpair',
  'conn.status',
  'state.get',
  'feed.get',
  'videos.state',
  'read.mark',
  'sync.subscriptions',
  'sync.watch',
  'sync.now',
  'queue.stop',
  'queue.resume'
])

/** Background → content script commands for a tab (`ExtTabCommands`). */
export const EXT_TAB_COMMAND_TYPES = exhaustive<ExtTabCommandType>()(['queue.execute', 'search.extract', 'scrape.subscriptions'])
