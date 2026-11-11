// `GET /status` (StatusResponse): what the chip, pane and mascot need without depending on events.
// The leader ShellHost queries every STATUS_POLL_MS (5 s) only while the window is visible; other readers
// use `useStatus()` (same cache, no poll of its own) or the `$status` atom.
//
// Also where the reads land: `useGatewayPlace()` tells whether the active gateway is on this computer or on another
// one (a registered remote/ssh/cloud connection), and `pluginMissing()` tells a read that never reached the plugin in
// the active profile (route missing on that gateway, plugin not loaded or turned off) from any other failure.
import { atom, host, useValue, type PluginContext } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import type { StatusResponse } from '../../shared/api-types'
import { STATUS_POLL_MS } from '../../shared/ids'
import { onShellReset } from './lifecycle'
import { TubeApiError, activeConnectionId, toApiError, useRest } from './rest'

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/** Window visible (Page Visibility API). */
export const $windowVisible = atom<boolean>(documentVisible())

/** Latest `GET /status` snapshot (null until the first response). */
export const $status = atom<StatusResponse | null>(null)

onShellReset(() => {
  $status.set(null)
  $windowVisible.set(documentVisible())
})

/** Binds `$windowVisible` to the document events (listener disposed on unload by ctx). */
export function bindWindowVisibility(ctx: PluginContext): void {
  if (typeof document === 'undefined') return
  const update = () => $windowVisible.set(documentVisible())
  update()
  ctx.addEventListener(document, 'visibilitychange', update)
}

/** Status poll interval: 5 s visible, stopped when hidden. */
export function statusPollInterval(visible: boolean): number | false {
  return visible ? STATUS_POLL_MS : false
}

/** `GET /status` read (shared cache). `poll: true` only on the leader ShellHost. */
export function useStatus(options: { poll?: boolean } = {}) {
  const visible = useValue($windowVisible)
  return useRest('GET /status', {}, { refetchInterval: options.poll ? statusPollInterval(visible) : false })
}

/** Current snapshot without subscribing to the query (for those who only want to react to the leader's poll). */
export function useStatusSnapshot(): StatusResponse | null {
  return useValue($status)
}

// ------------------------------------------------------------------ is the plugin there?

/** What the Desktop says when the active gateway has no such plugin route (404 page, HTML instead of JSON, …). */
const NOT_HERE = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i

/**
 * The read never reached the plugin in the active profile: a transport failure that names a missing route/plugin.
 * With `disabled: true`, the plugin's own `plugin_disabled` answer counts too.
 */
export function pluginMissing(error: unknown, options: { disabled?: boolean } = {}): boolean {
  if (!error) return false
  if (error instanceof TubeApiError) {
    if (error.code === 'plugin_disabled') return options.disabled === true
    return error.transport && NOT_HERE.test(error.message)
  }
  const api = toApiError(error)
  if (api.code === 'plugin_disabled') return options.disabled === true
  return api.code === 'internal' && NOT_HERE.test(api.message)
}

// ------------------------------------------------------------------ where the gateway is

/** One entry of `host.connections()` (only what is read here). */
export interface ConnectionInfo {
  id: string
  kind?: string
  label?: string
  primary?: boolean
  url?: string
  host?: string
}

export interface GatewayPlace {
  /** `false` while the connection list is still being read. */
  known: boolean
  /** The active gateway runs on another computer. */
  remote: boolean
  /** Name of that connection (as the app shows it); `null` when local. */
  name: string | null
  /** Name the app gives this computer's connection ("This device"); `null` when the host does not say. */
  local: string | null
}

const LOCAL_PLACE: GatewayPlace = { known: true, remote: false, name: null, local: null }
const UNKNOWN_PLACE: GatewayPlace = { known: false, remote: false, name: null, local: null }

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i

function hostnameOf(c: ConnectionInfo): string | null {
  if (typeof c.host === 'string' && c.host.trim()) return c.host.trim()
  if (typeof c.url !== 'string' || !c.url) return null
  try {
    return new URL(c.url).hostname || null
  } catch {
    return null
  }
}

/**
 * Where the gateway of connection `id` runs. `id = null` (the primary path) → the connection marked `primary`.
 * A remote/ssh/cloud connection whose address is this computer (localhost) counts as local.
 */
export function placeOf(list: readonly ConnectionInfo[], id: string | null): GatewayPlace {
  const items = list.filter((c): c is ConnectionInfo => !!c && typeof c === 'object' && typeof c.id === 'string')
  const local = items.find((c) => c.kind === 'local')?.label?.trim() || null
  const conn = id ? items.find((c) => c.id === id) : items.find((c) => c.primary)
  if (!conn || !conn.kind || conn.kind === 'local') return { known: true, remote: false, name: null, local }
  const address = hostnameOf(conn)
  if (address && LOOPBACK.test(address)) return { known: true, remote: false, name: null, local }
  return { known: true, remote: true, name: conn.label?.trim() || address || conn.kind, local }
}

type ConnectionsHost = { connections?: () => Promise<ConnectionInfo[]> }

/** Fallback atoms for an older Desktop without `host.state.connectionId` / `host.state.profile`. */
const NO_CONNECTION = atom<string | null>(null)
const NO_PROFILE = atom<string>('default')

/**
 * Is the active gateway on this computer? Read from the Desktop's connection list (`host.connections()`), again on
 * every connection or profile switch. A Desktop without the list → this computer.
 */
export function useGatewayPlace(): GatewayPlace {
  const connection = useValue(host.state?.connectionId ?? NO_CONNECTION)
  const profile = useValue(host.state?.profile ?? NO_PROFILE)
  const api = host as unknown as ConnectionsHost
  const [place, setPlace] = useState<GatewayPlace>(() => (typeof api.connections === 'function' ? UNKNOWN_PLACE : LOCAL_PLACE))
  useEffect(() => {
    if (typeof api.connections !== 'function') {
      setPlace(LOCAL_PLACE)
      return undefined
    }
    let alive = true
    const id = activeConnectionId()
    let pending: Promise<ConnectionInfo[]>
    try {
      pending = Promise.resolve(api.connections())
    } catch (error) {
      pending = Promise.reject(error)
    }
    pending.then(
      (list) => {
        if (alive) setPlace(placeOf(Array.isArray(list) ? list : [], id))
      },
      () => {
        if (alive) setPlace(LOCAL_PLACE)
      }
    )
    return () => {
      alive = false
    }
  }, [api, connection, profile])
  return place
}
