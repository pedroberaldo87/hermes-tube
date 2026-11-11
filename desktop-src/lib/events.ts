// Plugin events (`plugin.<id>.<name>`). An event SPEEDS UP, a query GUARANTEES:
// the listener only brings the next query forward (invalidates it); it is never the only source of truth.
// Events may not arrive (plugin host, isolation: host), arrive late, or arrive twice.
import { host } from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'
import type { TubeEventName, TubeEvents } from '../../shared/api-types'
import { PLUGIN_ID, eventType } from '../../shared/ids'
import { maybePluginContext } from './ctx'

type Listener<N extends TubeEventName> = (payload: TubeEvents[N]) => void

/** Wire type of an event the core emits on behalf of the plugin (e.g. `settings.changed`). */
export function pluginEventType(name: string): string {
  return `plugin.${PLUGIN_ID}.${name}`
}

function subscribe(type: string, listener: (payload: unknown) => void): () => void {
  const handler = (event: { payload?: unknown }) => {
    try {
      listener(event?.payload)
    } catch {
      // a listener that throws does not take down the others
    }
  }
  const ctx = maybePluginContext()
  if (ctx) return ctx.onEvent(type, handler as Parameters<typeof ctx.onEvent>[1])
  return host.onEvent(type as Parameters<typeof host.onEvent>[0], handler as Parameters<typeof host.onEvent>[1])
}

/** Subscribes to a plugin event (disposed on unload by ctx). Returns the disposer. */
export function onTubeEvent<N extends TubeEventName>(name: N, listener: Listener<N>): () => void {
  return subscribe(eventType(name), listener as (payload: unknown) => void)
}

/** Subscribes to any event by its wire name (e.g. `pluginEventType('settings.changed')`). */
export function onRawEvent(type: string, listener: (payload: unknown) => void): () => void {
  return subscribe(type, listener)
}

/** Hook: subscribes to several events while mounted. The latest listener is always the one used. */
export function useTubeEvents<N extends TubeEventName>(names: readonly N[], listener: (name: N, payload: TubeEvents[N]) => void, enabled = true): void {
  const ref = useRef(listener)
  ref.current = listener
  const key = names.join('|')
  useEffect(() => {
    if (!enabled) return
    const offs = (key ? (key.split('|') as N[]) : []).map((n) => onTubeEvent(n, (p) => ref.current(n, p)))
    return () => {
      for (const off of offs) off()
    }
  }, [key, enabled])
}

/** Hook: subscribes to one event while mounted. */
export function useTubeEvent<N extends TubeEventName>(name: N, listener: Listener<N>, enabled = true): void {
  useTubeEvents([name], (_n, p) => listener(p), enabled)
}
