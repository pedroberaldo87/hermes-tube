// Home feed paginated by cursor. Sources, all from the contract:
//   - tab:          GET /feed?tab=…&limit&cursor[&q]
//   - folder/channel:  GET /feed?folder=… | ?channel=…  (filter coming from the pane)
//   - "Watch later": GET /feed?state=later&limit&cursor[&q]  (order = last marked; `why` = origin)
//   - "show watched" of a tab with `only_new`: POST /feed/preview with the tab rules and `only_new: false`
//     (the preview has no `q`: there search filters what already came — see `serverSearch`)
// Search: `q` goes in GET /feed (title or channel, accent/case-insensitive, on the server; `counts` and cursor apply
// to the filtered list). Changing `q` = another key = cursor from scratch; the previous search still in flight is cancelled
// (`queryClient.cancelQueries` by exact key + React Query's `signal`), and until the new one arrives the
// previous list stays on screen (no skeleton: the search bar does not vanish or lose focus).
// Sort and group: `sort`, `group` (+ `tz_offset_min` with `group=day`) go in GET /feed only when they are not
// the default (newest/none); the server sorts by group and then by sort. Changing = another key = cursor from scratch,
// with the previous list on screen until the new one arrives (`reordering`). The preview (POST /feed/preview) does not sort.
// The 1st page lives in the React Query cache (key with the route prefix → `invalidateRest('GET /feed')`
// refreshes it without flicker: the old data stays until the new arrives). The following ones live in the hook state and are
// stitched without duplicating videos (stable cursor + dedupe by id).
import { queryClient, useQuery } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedItem, FeedPage, TabRules } from '../../../shared/api-types'
import { TubeApiError, restCall, restQueryKey } from '../../lib/rest'
import { DEFAULT_VIEW, type FeedGroup, type FeedSort } from './prefs'

export const PAGE_SIZE = 30

/** Local id of the "Watch later" tab (not in `GET /tabs`; `:` never appears in a backend tab id). */
export const LATER_TAB = ':later'

/** Folder or channel without a tab of its own (pane request): temporary filtered feed. */
export type ScopeFilter = { kind: 'folder' | 'channel'; id: string }

export type FeedSource =
  | { kind: 'tab'; tabId: string }
  | { kind: 'seen'; tabId: string; rules: TabRules }
  | { kind: 'later' }
  | { kind: 'scope'; scope: ScopeFilter }

/** Order asked of the server. `tzOffsetMin` = minutes to add to UTC (only applies with `group=day`). */
export interface FeedOrder {
  sort: FeedSort
  group: FeedGroup
  tzOffsetMin?: number
}

export function sourceKey(src: FeedSource): string {
  if (src.kind === 'later') return 'later'
  if (src.kind === 'scope') return `scope:${src.scope.kind}:${src.scope.id}`
  return `${src.kind}:${src.tabId}`
}

/** Does the source search on the server (`GET /feed?q=`)? The preview (`POST /feed/preview`) does not accept `q`. */
export function serverSearch(src: FeedSource | null): boolean {
  return !!src && src.kind !== 'seen'
}

/** Does the source sort/group on the server (`GET /feed?sort&group`)? The preview does not. */
export function serverOrder(src: FeedSource | null): boolean {
  return serverSearch(src)
}

/** Sort parameters of GET /feed: only what differs from the contract default. */
export function orderQuery(src: FeedSource, order?: FeedOrder | null): { sort?: FeedSort; group?: FeedGroup; tz_offset_min?: number } {
  if (!order || !serverOrder(src)) return {}
  return {
    ...(order.sort !== DEFAULT_VIEW.sort ? { sort: order.sort } : {}),
    ...(order.group !== DEFAULT_VIEW.group ? { group: order.group } : {}),
    ...(order.group === 'day' ? { tz_offset_min: Math.max(-840, Math.min(840, Math.round(order.tzOffsetMin ?? 0))) } : {})
  }
}

function seenRules(rules: TabRules): TabRules {
  return { ...rules, filters: { ...rules.filters, only_new: false } }
}

/** Cancelled request error (search swapped midway): never becomes an error screen. */
function cancelled(): TubeApiError {
  return new TubeApiError({ code: 'internal', message: 'cancelled', reason: 'cancelled' })
}

export async function fetchPage(src: FeedSource, cursor: string | null, q = '', signal?: AbortSignal, order?: FeedOrder | null): Promise<FeedPage> {
  const extra = { ...(q && serverSearch(src) ? { q } : {}), ...orderQuery(src, order), limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
  let page: FeedPage
  if (src.kind === 'tab') {
    page = await restCall('GET /feed', { query: { tab: src.tabId, ...extra } })
  } else if (src.kind === 'scope') {
    const scope = src.scope.kind === 'folder' ? { folder: src.scope.id } : { channel: src.scope.id }
    page = await restCall('GET /feed', { query: { ...scope, ...extra } })
  } else if (src.kind === 'later') {
    page = await restCall('GET /feed', { query: { state: 'later', ...extra } })
  } else {
    page = await restCall('POST /feed/preview', { body: { rules: seenRules(src.rules), limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } })
  }
  // the plugin route (`ctx.rest`) does not accept `signal`: the request finishes, but the response of a search already
  // swapped is discarded here (React Query reverts the cancelled query)
  if (signal?.aborted) throw cancelled()
  return page
}

function routeOf(src: FeedSource) {
  return src.kind === 'seen' ? ('POST /feed/preview' as const) : ('GET /feed' as const)
}

/** Key of the 1st page in the cache (route prefix → `invalidateRest` finds it). */
export function feedQueryKey(src: FeedSource, q: string, order?: FeedOrder | null): unknown[] {
  return restQueryKey(routeOf(src), { query: { source: sourceKey(src), ...(q ? { q } : {}), ...orderQuery(src, order) } })
}

/** Retries only transport failures (like `useRest`). */
function retry(failureCount: number, error: unknown): boolean {
  return error instanceof TubeApiError && error.transport && failureCount < 2
}

export function dedupe(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Set<string>()
  const out: FeedItem[] = []
  for (const it of items) {
    const id = it?.video?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(it)
  }
  return out
}

interface MoreState {
  key: string
  items: FeedItem[]
  /** `undefined` = still on the 1st page (uses its `next_cursor`). */
  cursor: string | null | undefined
  loading: boolean
  error: unknown
}

const EMPTY_MORE = (key: string): MoreState => ({ key, items: [], cursor: undefined, loading: false, error: null })

/** What was on screen for the same source: holds the list while a new search (or order) arrives. */
interface Shown {
  base: string
  q: string
  items: FeedItem[]
  total: number
  fresh: number | null
}

export interface FeedView {
  items: FeedItem[]
  /** Total of the whole list, already with the search (contract `counts.total`); `null` without a 1st page. */
  total: number | null
  /** New ones in the whole list, already with the search (`counts.new`); `null` without a 1st page. */
  fresh: number | null
  /** 1st page has not arrived yet (and no error, and nothing previous to hold the screen). */
  pending: boolean
  /** A new search is on its way; `items` are still the previous ones. */
  searching: boolean
  /** A new order/group is on its way (same search); `items` are still the previous ones. */
  reordering: boolean
  error: unknown
  refetch: () => void
  hasMore: boolean
  loadingMore: boolean
  moreError: unknown
  loadMore: () => void
}

export interface FeedOptions {
  refetchInterval?: number | false
  /** Search text with the typing debounce already applied (empty = no search). */
  q?: string
  /** Sort and group; absent = contract default. */
  order?: FeedOrder | null
}

export function useFeed(src: FeedSource | null, options: FeedOptions = {}): FeedView {
  const q = serverSearch(src) ? (options.q ?? '').trim() : ''
  const order = src && serverOrder(src) ? (options.order ?? null) : null
  const orderKey = src ? new URLSearchParams(Object.entries(orderQuery(src, order)).map(([k, v]) => [k, String(v)])).toString() : ''
  const base = src ? sourceKey(src) : ''
  const key = `${base}${q ? `?q=${q}` : ''}${orderKey ? `&${orderKey}` : ''}`
  const srcRef = useRef(src)
  srcRef.current = src
  const qRef = useRef(q)
  qRef.current = q
  const orderRef = useRef(order)
  orderRef.current = order
  const queryKey = src ? feedQueryKey(src, q, order) : ['home-feed-idle']
  const first = useQuery<FeedPage, TubeApiError>({
    queryKey,
    queryFn: ({ signal }: { signal?: AbortSignal }) => fetchPage(srcRef.current as FeedSource, null, qRef.current, signal, orderRef.current),
    enabled: !!src,
    retry,
    refetchInterval: options.refetchInterval ?? false
  })
  const data = first.data as FeedPage | undefined

  // search swapped (or source swapped) with the previous one still in flight → cancels the previous, by exact key
  const keyJson = JSON.stringify(queryKey)
  useEffect(() => {
    const searchKey = q ? (JSON.parse(keyJson) as unknown[]) : null
    return () => {
      if (searchKey) void queryClient.cancelQueries({ queryKey: searchKey, exact: true })
    }
  }, [keyJson, q])

  const [moreRaw, setMore] = useState<MoreState>(() => EMPTY_MORE(key))
  const more = moreRaw.key === key ? moreRaw : EMPTY_MORE(key)
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    setMore((m) => (m.key === key ? m : EMPTY_MORE(key)))
  }, [key])

  const cursor = more.cursor === undefined ? (data?.next_cursor ?? null) : more.cursor
  const hasMore = !!data && cursor != null

  const loadMore = useCallback(() => {
    const s = srcRef.current
    if (!s || !hasMore || more.loading || cursor == null) return
    const k = keyRef.current
    const qq = qRef.current
    const oo = orderRef.current
    setMore((m) => ({ ...(m.key === k ? m : EMPTY_MORE(k)), loading: true, error: null }))
    fetchPage(s, cursor, qq, undefined, oo).then(
      (p) => {
        if (keyRef.current !== k) return
        setMore((m) => (m.key !== k ? m : { key: k, items: [...m.items, ...(p.items ?? [])], cursor: p.next_cursor ?? null, loading: false, error: null }))
      },
      (error: unknown) => {
        if (keyRef.current !== k) return
        setMore((m) => (m.key !== k ? m : { ...m, loading: false, error }))
      }
    )
  }, [hasMore, more.loading, cursor])

  const items = data ? dedupe([...(data.items ?? []), ...more.items]) : []
  const total = data ? (data.counts?.total ?? items.length) : null
  const fresh = data ? (data.counts?.new ?? null) : null

  // holds what was on screen (same source) until the 1st page of a new search/order arrives
  const shownRef = useRef<Shown | null>(null)
  if (data) shownRef.current = { base, q, items, total: total ?? items.length, fresh }
  const held = !data && !first.error && !!src && shownRef.current?.base === base ? shownRef.current : null

  return {
    items: held ? held.items : items,
    total: held ? null : total,
    fresh: held ? null : fresh,
    pending: !data && !first.error && !held,
    searching: !!held && held.q !== q,
    reordering: !!held && held.q === q,
    error: data ? null : first.error,
    refetch: () => {
      void first.refetch()
    },
    hasMore: held ? false : hasMore,
    loadingMore: more.loading,
    moreError: more.error,
    loadMore
  }
}
