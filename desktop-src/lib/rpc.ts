// The plugin's RPC client. AI and human approval exist only over RPC on the gateway
// (`host.request('plugin.<id>.<group>.<verb>')`). Before calling, it checks for `plugin-rpc-v1` in
// `runtime.describe` (cached per gateway activation). Without the capability, or with `-32601` (no plugin RPC on
// this backend: standalone dashboard, plugin host, plugin not loaded), it follows the method's `fallback` in
// contract/rpc.yaml: the same operation over REST (`pair.start`) or the message
// `open_desktop_backend` ("open it from the Desktop with a local backend") — it never waits for a job that does not exist.
//
// Profile: `ctx.rest` follows the profile chosen in the app; `host.request` talks to the gateway the window's socket
// is on, which can belong to ANOTHER profile (seen in the real app: window on an additional profile, socket on
// `default` → `-32601`, and AI showed as unavailable while REST worked). So, before giving up, the RPC tries the
// chosen profile's gateway through `host.requestProfile` (a route from `host.profileRoutes()`; with no routes —
// webapp, old Desktop — the profile name). The route that answered is remembered.
//
// When the socket's gateway serves ANOTHER profile that also has the plugin, nothing is sent to it: an approval
// there would land in that profile's database (and its paired browser) while the screen shows the selected one.
// `runtime.describe` names the socket's profile (`profile_id` = that profile's Hermes home); if it is not the
// selected profile, the call goes only through the selected profile's route, and with no route it is refused
// (`unavailable`, or the REST fallback, which already targets the selected profile).
import { gatewayActivationEpoch, host } from '@hermes/plugin-sdk'
import type { ApiError, RestRouteKey, RpcMethodName, RpcMethods } from '../../shared/api-types'
import { MESSAGE_KEYS, RPC_CAPABILITY, RPC_TIMEOUT_MS, RPC_UNAVAILABLE_CODE, rpcMethod } from '../../shared/ids'
import { onShellReset } from './lifecycle'
import { TubeApiError, restCallLoose, toApiError, unwrapEnvelope } from './rest'

export type RpcFallback = { message: typeof MESSAGE_KEYS.openDesktopBackend } | { rest: RestRouteKey }

/** Each method's `fallback` (mirror of contract/rpc.yaml; checked by a test). */
export const RPC_FALLBACK: Record<RpcMethodName, RpcFallback> = {
  'job.cancel': { message: MESSAGE_KEYS.openDesktopBackend },
  'organize.run': { message: MESSAGE_KEYS.openDesktopBackend },
  'organize.accept': { message: MESSAGE_KEYS.openDesktopBackend },
  'organize.reject': { message: MESSAGE_KEYS.openDesktopBackend },
  'cleanup.scan': { message: MESSAGE_KEYS.openDesktopBackend },
  'cleanup.approve': { message: MESSAGE_KEYS.openDesktopBackend },
  'cleanup.resubscribe': { message: MESSAGE_KEYS.openDesktopBackend },
  'theme.create': { message: MESSAGE_KEYS.openDesktopBackend },
  'theme.save': { message: MESSAGE_KEYS.openDesktopBackend },
  'theme.refresh': { message: MESSAGE_KEYS.openDesktopBackend },
  'lists.import': { message: MESSAGE_KEYS.openDesktopBackend },
  'lists.to_tab': { message: MESSAGE_KEYS.openDesktopBackend },
  'pair.start': { rest: 'POST /pair/start' }
}

export type RpcParams<N extends RpcMethodName> = RpcMethods[N]['params']
export type RpcData<N extends RpcMethodName> = RpcMethods[N]['data']

/** Result of a call: success, a contract error, or no RPC on this backend. */
export type RpcOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'error'; error: ApiError }
  | { kind: 'unavailable'; messageKey: typeof MESSAGE_KEYS.openDesktopBackend }

// ------------------------------------------------------------------ capability

/** What the window's gateway says about itself: plugin RPC support and the profile it serves (`null` = not said). */
type GatewayInfo = { rpc: boolean; profile: string | null }

let capability: { epoch: number; value: Promise<GatewayInfo> } | null = null

type ProfileRoute = Parameters<typeof host.requestProfile>[0]

/** Route of the chosen profile that already answered for the plugin (valid while the profile and gateway stay the same). */
let routed: { epoch: number; profile: string; route: ProfileRoute } | null = null

onShellReset(() => {
  capability = null
  routed = null
})

/** Forgets the `runtime.describe` result and the remembered route (backend switch, tests). */
export function resetRpcCapability(): void {
  capability = null
  routed = null
}

/**
 * Profile name behind a gateway's `profile_id` (its Hermes home): `<root>/profiles/<name>` → `<name>`; any other
 * path is the root profile, `default`; a bare name is itself. `null` when the gateway did not say.
 */
export function profileNameFromId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  const text = id.trim()
  const parts = text.split(/[\\/]+/).filter(Boolean)
  if (!/[\\/]/.test(text)) return parts[0] ?? null
  const at = parts.lastIndexOf('profiles')
  return at >= 0 && at === parts.length - 2 ? parts[at + 1] : 'default'
}

function rpcCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'number' ? code : undefined
}

function isMethodNotFound(error: unknown): boolean {
  return rpcCode(error) === RPC_UNAVAILABLE_CODE
}

function isTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /time[d ]?\s*out/i.test(message)
}

/**
 * `true` if the active gateway announces `plugin-rpc-v1`. `-32601` on describe = no (cached).
 * Any other failure (gateway disconnected) throws and is not cached.
 */
export function hasPluginRpc(): Promise<boolean> {
  return describeGateway().then((info) => info.rpc)
}

function describeGateway(): Promise<GatewayInfo> {
  const epoch = gatewayActivationEpoch()
  if (capability && capability.epoch === epoch) return capability.value
  const value = host
    .request<{ capabilities?: unknown; profile_id?: unknown }>('runtime.describe', {}, RPC_TIMEOUT_MS)
    .then(
      (res): GatewayInfo => ({
        rpc: Array.isArray(res?.capabilities) && res.capabilities.includes(RPC_CAPABILITY),
        profile: profileNameFromId(res?.profile_id)
      }),
      (error: unknown): GatewayInfo => {
        if (isMethodNotFound(error)) return { rpc: false, profile: null }
        throw error
      }
    )
  const entry = { epoch, value }
  capability = entry
  value.catch(() => {
    if (capability === entry) capability = null
  })
  return value
}

// ------------------------------------------------------------------ route of the chosen profile

/** The profile the host says is selected; `null` when the host does not say (web app, older Desktop). */
function statedProfile(): string | null {
  const value = host.state?.profile?.get?.()
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function selectedProfile(): string {
  return statedProfile() ?? 'default'
}

/** Candidates, most specific first: registry routes with this profile, then the bare name. */
async function profileCandidates(profile: string): Promise<ProfileRoute[]> {
  const out: ProfileRoute[] = []
  if (typeof host.profileRoutes === 'function') {
    try {
      const routes = await host.profileRoutes()
      const exact = routes.filter((r) => r.profile === profile)
      const target = routes.filter((r) => r.profile !== profile && r.targetProfile === profile)
      out.push(...exact, ...target)
    } catch {
      // no route registry (webapp, old Desktop): the bare name
    }
  }
  out.push(profile)
  return out
}

function envelope<N extends RpcMethodName>(raw: unknown): RpcOutcome<RpcData<N>> {
  try {
    return { kind: 'ok', data: unwrapEnvelope<RpcData<N>>(raw) }
  } catch (error) {
    return { kind: 'error', error: error instanceof TubeApiError ? error.toApiError() : toApiError(error) }
  }
}

function timeoutOutcome(error: unknown): RpcOutcome<never> {
  return { kind: 'error', error: { code: 'timeout', message: error instanceof Error ? error.message : 'timeout' } }
}

/**
 * The same RPC on the gateway of the profile chosen in the app. `null` = no route has the plugin (follow the fallback).
 * An error without a numeric code is a routing/transport error of that route: try the next one.
 */
async function viaProfileRoute<N extends RpcMethodName>(
  name: N,
  params: RpcParams<N>
): Promise<RpcOutcome<RpcData<N>> | null> {
  if (typeof host.requestProfile !== 'function') return null
  const epoch = gatewayActivationEpoch()
  const profile = selectedProfile()
  const known = routed && routed.epoch === epoch && routed.profile === profile ? routed.route : null
  const candidates = known ? [known] : await profileCandidates(profile)
  let timedOut: unknown = null
  for (const route of candidates) {
    try {
      const raw = await host.requestProfile<unknown>(route, rpcMethod(name), params as Record<string, unknown>, RPC_TIMEOUT_MS)
      routed = { epoch, profile, route }
      return envelope<N>(raw)
    } catch (error) {
      if (isMethodNotFound(error)) continue // this route does not have the plugin either
      if (isTimeout(error)) timedOut = error
      // JSON-RPC error from the right gateway (it has a code): that is the answer, not a route problem
      else if (rpcCode(error) !== undefined) return { kind: 'error', error: toApiError(error) }
    }
  }
  routed = null
  return timedOut ? timeoutOutcome(timedOut) : null
}

// ------------------------------------------------------------------ call

async function viaFallback<N extends RpcMethodName>(name: N, params: RpcParams<N>): Promise<RpcOutcome<RpcData<N>>> {
  const fb = RPC_FALLBACK[name]
  if ('rest' in fb) {
    const body = params && typeof params === 'object' && Object.keys(params).length ? params : undefined
    try {
      const data = await restCallLoose(fb.rest, { body })
      return { kind: 'ok', data: data as RpcData<N> }
    } catch (error) {
      return { kind: 'error', error: toApiError(error) }
    }
  }
  return { kind: 'unavailable', messageKey: fb.message }
}

/**
 * Calls `plugin.<id>.<name>` on the gateway and unwraps the envelope. Never throws.
 * `kind: 'unavailable'` → mostre `common.open_desktop_backend` (ex.: `<RpcUnavailableNotice/>`).
 */
export async function callRpc<N extends RpcMethodName>(name: N, params: RpcParams<N>): Promise<RpcOutcome<RpcData<N>>> {
  // the profile's route is already known: go straight through it (the window's socket does not have the plugin)
  if (routed && routed.epoch === gatewayActivationEpoch() && routed.profile === selectedProfile()) {
    const viaRoute = await viaProfileRoute(name, params)
    if (viaRoute) return viaRoute
  }
  let gateway: GatewayInfo
  try {
    gateway = await describeGateway()
  } catch (error) {
    return { kind: 'error', error: toApiError(error) }
  }
  // the socket serves another profile: only the selected profile's route, never the socket (see the top comment)
  // a host that does not name the selected profile has a single backend: nothing to compare, the socket is it
  const selected = statedProfile()
  const elsewhere = gateway.profile !== null && selected !== null && gateway.profile !== selected
  if (elsewhere || !gateway.rpc) return (await viaProfileRoute(name, params)) ?? viaFallback(name, params)
  let raw: unknown
  try {
    raw = await host.request<unknown>(rpcMethod(name), params as Record<string, unknown>, RPC_TIMEOUT_MS)
  } catch (error) {
    if (isMethodNotFound(error)) return (await viaProfileRoute(name, params)) ?? viaFallback(name, params)
    if (isTimeout(error)) return timeoutOutcome(error)
    return { kind: 'error', error: toApiError(error) }
  }
  return envelope<N>(raw)
}
