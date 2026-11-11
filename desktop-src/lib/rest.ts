// plugin_api REST client: `ctx.rest` (prefix /api/plugins/<id> already applied by the Desktop) +
// contract envelope (always HTTP 200 + `{ok, data | error}`) + the app's React Query.
// Routes typed by `RestRoutes` (shared/api-types.ts): `restCall('GET /jobs/{id}', {path: {id}})`.
//
// Cache scope: the Desktop can point `ctx.rest` at another gateway (a registered connection on another computer) or
// another profile at any time. Each cached answer is keyed by the connection and the profile it came from, so a switch
// reads again instead of showing the previous gateway's answer.
import { atom, host, useMutation, useQuery, useValue, queryClient } from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'
import type { ApiError, ErrorCode, RestRouteKey, RestRoutes } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { getPluginContext } from './ctx'

// ------------------------------------------------------------------ errors

export class TubeApiError extends Error {
  readonly code: ErrorCode
  readonly reason?: string
  readonly details?: Record<string, unknown>
  /** true = the call never reached an envelope (network, Desktop 4xx/5xx, plugin off). */
  readonly transport: boolean

  constructor(error: ApiError, transport = false) {
    super(error.message)
    this.name = 'TubeApiError'
    this.code = error.code
    if (error.reason !== undefined) this.reason = error.reason
    if (error.details !== undefined) this.details = error.details
    this.transport = transport
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.reason !== undefined ? { reason: this.reason } : {}),
      ...(this.details !== undefined ? { details: this.details } : {})
    }
  }
}

/** Anything thrown → contract ApiError (unknown = `internal`). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof TubeApiError) return error.toApiError()
  if (isApiError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'internal', message }
}

function isApiError(value: unknown): value is ApiError {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ApiError).code === 'string' &&
    typeof (value as ApiError).message === 'string'
  )
}

/** `{ok:true,data}` → data; `{ok:false,error}` → throws TubeApiError; anything else → `internal`. */
export function unwrapEnvelope<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'ok' in value) {
    const env = value as { ok: unknown; data?: unknown; error?: unknown }
    if (env.ok === true) return env.data as T
    if (env.ok === false && isApiError(env.error)) throw new TubeApiError(env.error)
  }
  throw new TubeApiError({ code: 'internal', message: 'invalid response envelope' })
}

// ------------------------------------------------------------------ argument types

type Route<K extends RestRouteKey> = RestRoutes[K]
type EmptyRecord = Record<string, never>

type PathArg<P> = P extends EmptyRecord ? { path?: undefined } : { path: P }
// `{} extends X` = all keys of X are optional
type QueryArg<Q> = Q extends EmptyRecord ? { query?: undefined } : {} extends Q ? { query?: Q } : { query: Q }
type BodyArg<B> = [B] extends [never] ? { body?: undefined } : {} extends B ? { body?: B } : { body: B }

/** Arguments of a route: `path` (parameters), `query`, `body` — only what the route accepts. */
export type RestArgs<K extends RestRouteKey> = PathArg<Route<K>['path']> &
  QueryArg<Route<K>['query']> &
  BodyArg<Route<K>['body']>

/** `data` of the route's success envelope. */
export type RestData<K extends RestRouteKey> = Route<K>['data']

type ArgsTuple<K extends RestRouteKey> = {} extends RestArgs<K> ? [args?: RestArgs<K>] : [args: RestArgs<K>]

interface LooseArgs {
  path?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
}

// ------------------------------------------------------------------ call

/** Method and relative path (with query) of a route. Empty path parameter → `invalid`. */
export function buildRestRequest(key: RestRouteKey, args: LooseArgs = {}): { method: string; path: string } {
  const space = key.indexOf(' ')
  const method = key.slice(0, space)
  const template = key.slice(space + 1)
  const path = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = args.path?.[name]
    if (v === undefined || v === null || v === '') {
      throw new TubeApiError({ code: 'invalid', message: `missing path parameter "${name}" for ${key}` })
    }
    return encodeURIComponent(String(v))
  })
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    qs.append(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const q = qs.toString()
  return { method, path: q ? `${path}?${q}` : path }
}

async function restLoose(key: RestRouteKey, args: LooseArgs = {}): Promise<unknown> {
  const { method, path } = buildRestRequest(key, args)
  const opts = method === 'GET' || args.body === undefined ? { method } : { method, body: args.body }
  let raw: unknown
  try {
    raw = await getPluginContext().rest<unknown>(path, opts)
  } catch (error) {
    if (error instanceof TubeApiError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new TubeApiError({ code: 'internal', message }, true)
  }
  return unwrapEnvelope(raw)
}

/** Calls a plugin_api route and returns `data` (throws `TubeApiError` on error). */
export function restCall<K extends RestRouteKey>(key: K, ...[args]: ArgsTuple<K>): Promise<RestData<K>> {
  return restLoose(key, args as LooseArgs | undefined) as Promise<RestData<K>>
}

/** Version without argument types (RPC → REST fallback, internal tools). */
export function restCallLoose(key: RestRouteKey, args?: LooseArgs): Promise<unknown> {
  return restLoose(key, args)
}

// ------------------------------------------------------------------ connection scope

/** Fallback atoms for an older Desktop without `host.state.connectionId` / `host.state.profile`. */
const NO_CONNECTION = atom<string | null>(null)
const NO_PROFILE = atom<string>('default')

type ConnectionHost = { activeConnectionId?: () => string | null }

/**
 * Registry id of the connection serving the active gateway: `host.state.connectionId`, else
 * `host.activeConnectionId()`; `null` = the primary path (or a host that does not say).
 */
export function activeConnectionId(): string | null {
  const stated = host.state?.connectionId?.get?.()
  if (typeof stated === 'string' && stated) return stated
  try {
    const fn = (host as unknown as ConnectionHost).activeConnectionId
    const id = typeof fn === 'function' ? fn() : null
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

function scopeOf(connection: string | null, profile: string | null | undefined): string {
  return `${connection ?? ''}::${(typeof profile === 'string' && profile.trim()) || 'default'}`
}

/** `<connection>::<profile>` the plugin's reads go to right now (part of every cache key). */
export function restScope(): string {
  return scopeOf(activeConnectionId(), host.state?.profile?.get?.())
}

/** `restScope()` for a component: re-renders when the connection or the profile changes. */
export function useRestScope(): string {
  const stated = useValue(host.state?.connectionId ?? NO_CONNECTION)
  const profile = useValue(host.state?.profile ?? NO_PROFILE)
  return scopeOf((typeof stated === 'string' && stated) || activeConnectionId(), profile)
}

// ------------------------------------------------------------------ React Query

/**
 * Cache key: `[PLUGIN_ID, 'rest', route, path, query, scope]` (invalidation by prefix; `scope` = connection +
 * profile, so another gateway's answer is never reused).
 */
export function restQueryKey(key: RestRouteKey, args?: LooseArgs, scope: string = restScope()): unknown[] {
  return [PLUGIN_ID, 'rest', key, args?.path ?? null, args?.query ?? null, scope]
}

export interface RestQueryOptions<T> {
  enabled?: boolean
  /** ms, `false`, or a function of the last `data`/error (e.g. active job → 2 s). */
  refetchInterval?: number | false | ((data: T | undefined, error: unknown) => number | false)
  staleTime?: number
}

/** Does not retry envelope errors (they do not change on their own); retries transport failures 2×. */
function retryPolicy(failureCount: number, error: unknown): boolean {
  return error instanceof TubeApiError && error.transport && failureCount < 2
}

/** `useQuery` over a GET route. `data` = envelope `data`; `error` = `TubeApiError`. */
export function useRest<K extends RestRouteKey>(key: K, args: RestArgs<K>, options: RestQueryOptions<RestData<K>> = {}) {
  const loose = args as LooseArgs
  const ri = options.refetchInterval
  const scope = useRestScope()
  return useQuery<RestData<K>, TubeApiError>({
    queryKey: restQueryKey(key, loose, scope),
    queryFn: () => restLoose(key, loose) as Promise<RestData<K>>,
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
    retry: retryPolicy,
    refetchInterval:
      typeof ri === 'function'
        ? (query: { state: { data: RestData<K> | undefined; error: unknown } }) => ri(query.state.data, query.state.error)
        : ri
  })
}

/** First wait before reading again after a failed read; it doubles each time, up to `RETRY_MAX_MS`. */
export const RETRY_BASE_MS = 2_000
export const RETRY_MAX_MS = 30_000

/** Wait before retry number `attempt` (0-based). */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt), RETRY_MAX_MS)
}

/**
 * A read that failed is read again by itself, waiting longer each time (2 s, 4 s, 8 s … 30 s), while `enabled` and
 * the component is on screen; a success resets the wait. For screens where an error should not stay until someone
 * presses "Try again" (React Query does not retry envelope errors on its own).
 */
export function useRetryOnError(
  query: { isError: boolean; isFetching: boolean; refetch: () => unknown },
  enabled = true
): void {
  const attempt = useRef(0)
  const refetch = useRef(query.refetch)
  refetch.current = query.refetch
  if (!query.isError) attempt.current = 0
  const waiting = enabled && query.isError && !query.isFetching
  useEffect(() => {
    if (!waiting) return undefined
    const id = setTimeout(() => {
      attempt.current += 1
      void refetch.current()
    }, retryDelay(attempt.current))
    return () => clearTimeout(id)
  }, [waiting])
}

export interface RestMutationOptions<K extends RestRouteKey> {
  /** Routes to invalidate after success (by key prefix). */
  invalidate?: RestRouteKey[]
  onSuccess?: (data: RestData<K>, args: RestArgs<K>) => void
}

/** `useMutation` over a write route; invalidates the given routes on success. */
export function useRestMutation<K extends RestRouteKey>(key: K, options: RestMutationOptions<K> = {}) {
  return useMutation<RestData<K>, TubeApiError, RestArgs<K>>({
    mutationFn: (args: RestArgs<K>) => restLoose(key, args as LooseArgs) as Promise<RestData<K>>,
    onSuccess: async (data: RestData<K>, args: RestArgs<K>) => {
      if (options.invalidate?.length) await invalidateRest(...options.invalidate)
      options.onSuccess?.(data, args)
    }
  })
}

/** Invalidates (refetches) the queries of the given routes; with no routes, all of the plugin's. */
export function invalidateRest(...keys: RestRouteKey[]): Promise<void> {
  if (!keys.length) return queryClient.invalidateQueries({ queryKey: [PLUGIN_ID] })
  return Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [PLUGIN_ID, 'rest', k] }))).then(
    () => undefined
  )
}

/** Invalidates one exact query (route + arguments). */
export function invalidateRestExact(key: RestRouteKey, args?: LooseArgs): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: restQueryKey(key, args) })
}
