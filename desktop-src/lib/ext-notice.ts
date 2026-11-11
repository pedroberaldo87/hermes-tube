// The browser-extension notice at the top of the central area (Subscriptions — every tab —, Manage and Cleanup):
// one rule for the three pages, each with its own wording.
//   - never paired: `GET /devices` lists no browser at all, not even a revoked one → "Connect the browser
//     extension…" + Connect;
//   - paired but none online (`/status.devices_online = 0`) while something on the page depends on the extension
//     (subscribed channels, a cleanup queue…) → the page's own "disconnected" text + Reconnect.
// Both open the Welcome dialog on the pairing step. Nothing is shown while `/status` or `/devices` is loading or
// failed (an unknown state never becomes a notice).
import type { StatusResponse } from '../../shared/api-types'
import { useRest } from './rest'

export type ExtNotice = 'ext_not_paired' | 'ext_disconnected'

export interface ExtNoticeInput {
  status: StatusResponse | undefined
  /** No browser was ever paired (`GET /devices` empty); `null` = unknown (loading, failed). */
  neverPaired: boolean | null
  /** Something on this page depends on the extension (subscribed channels, a queue…). */
  needed: boolean
}

export function pickExtNotice({ status, neverPaired, needed }: ExtNoticeInput): ExtNotice | null {
  if (!status || neverPaired === null) return null
  if (neverPaired) return 'ext_not_paired'
  if (status.devices_online === 0 && needed) return 'ext_disconnected'
  return null
}

/** `true`/`false` from `GET /devices`; `null` while it loads, when it failed, or when `enabled` is off. */
export function useNeverPaired(enabled = true): boolean | null {
  const devices = useRest('GET /devices', {}, { enabled })
  if (!enabled || devices.isError || !devices.data) return null
  return devices.data.items.length === 0
}
