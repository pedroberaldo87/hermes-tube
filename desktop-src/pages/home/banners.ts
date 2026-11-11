// Partial/degraded state strip on Home: at most one, by priority
//   1. arriving (demo or freshly added channel: the user just acted and expects to see videos)
//   2. YouTube RSS down (`rss_down_since`): the feed carries on with what we already have
//   3. the browser-extension notice, the same rule as Manage and Cleanup (lib/ext-notice.ts):
//      never connected (`GET /devices` lists no browser at all, not even a revoked one) → "connect the browser
//      extension" with Connect — for whoever started with the demo or a pasted channel and no longer sees the
//      Welcome card; otherwise disconnected (`devices_online = 0`) when there are `subscribed` channels (only
//      followed/demo do not depend on the extension) → Reconnect
// Without `/status` (loading or failed) no strip is invented; nor an extension notice while `/devices` is unknown.
import type { StatusResponse } from '../../../shared/api-types'
import { type ExtNotice, pickExtNotice } from '../../lib/ext-notice'

export type HomeBanner = 'arriving' | 'rss_down' | ExtNotice

export interface BannerInput {
  status: StatusResponse | undefined
  /** `subscribed` channels (`/status.subscribed_total`); `null` = unknown (field absent). */
  subscribed: number | null
  arriving: boolean
  /** No browser was ever paired (`GET /devices` empty); `null`/absent = unknown (loading, failed). */
  neverPaired?: boolean | null
}

export function pickBanner({ status, subscribed, arriving, neverPaired = null }: BannerInput): HomeBanner | null {
  if (arriving) return 'arriving'
  if (status?.rss_down_since != null) return 'rss_down'
  return pickExtNotice({ status, neverPaired, needed: subscribed != null && subscribed > 0 })
}
