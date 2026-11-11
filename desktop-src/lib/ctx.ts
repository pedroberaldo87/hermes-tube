// The Desktop `PluginContext`, stored in `register(ctx)` and read by clients and screens.
// Screens do not receive `ctx` as props: they use the clients in lib/ (rest, rpc, events, pet).
import type { PluginContext } from '@hermes/plugin-sdk'
import { PLUGIN_ID } from '../../shared/ids'
import { onShellReset } from './lifecycle'

let current: PluginContext | null = null

export function setPluginContext(ctx: PluginContext | null): void {
  current = ctx
}

/** /** Plugin context; throws if the plugin is not registered yet (or was already unloaded). */
export function getPluginContext(): PluginContext {
  if (!current) throw new Error(`${PLUGIN_ID}: plugin context not registered`)
  return current
}

export function maybePluginContext(): PluginContext | null {
  return current
}

onShellReset(() => {
  current = null
})
