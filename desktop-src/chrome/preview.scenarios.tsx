// Preview scenarios of the status bar chip (the collector's fixed interface). The REAL chip
// (StatusChip) reads `GET /status` from the `rest` map; the states the envelope does not simulate (no connection, mascot)
// use the direct drawing (ChipView) with the same state StatusChip would compute. Width 360 (status bar).
import type { ReactNode } from 'react'
import type { StatusResponse } from '../../shared/api-types'
import { ChipView, StatusChip } from './index'

export type Scenario = {
  id: string
  title: string
  widths?: number[]
  rest?: Record<string, unknown | ((req: { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown)>
  rpc?: Record<string, unknown | ((params: unknown) => unknown)>
  render: () => ReactNode
}

const WIDTHS = [360]
const NOW_S = Math.floor(Date.now() / 1000)

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 12,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 240,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 1,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    ...over
  }
}

const pending = () => new Promise<never>(() => undefined)

export const scenarios: Scenario[] = [
  { id: 'chip-new', title: 'Chip · 12 new', widths: WIDTHS, rest: { 'GET /status': status() }, render: () => <StatusChip /> },
  { id: 'chip-zero', title: 'Chip · nothing new (subtle)', widths: WIDTHS, rest: { 'GET /status': status({ new_total: 0 }) }, render: () => <StatusChip /> },
  {
    id: 'chip-refreshing',
    title: 'Chip · refreshing',
    widths: WIDTHS,
    rest: { 'GET /status': status({ new_total: 4, refresh_running: true }) },
    render: () => <StatusChip />
  },
  { id: 'chip-loading', title: 'Chip · loading', widths: WIDTHS, rest: { 'GET /status': pending }, render: () => <StatusChip /> },
  {
    id: 'chip-error-unavailable',
    title: 'Chip · profile without the plugin (▶ —, never 0)',
    widths: WIDTHS,
    rest: {
      'GET /status': () => {
        throw { code: 'plugin_disabled', message: 'plugin not enabled for this profile' }
      }
    },
    render: () => <StatusChip />
  },
  {
    id: 'chip-error-offline',
    title: 'Chip · no connection (▶ —, never 0)',
    widths: WIDTHS,
    render: () => <ChipView state={{ kind: 'error', reason: 'offline', error: { code: 'internal', message: 'connect ECONNREFUSED' } }} />
  },
  {
    id: 'chip-pet',
    title: 'Chip · hidden mascot (⭐ with the speech in the tooltip)',
    widths: WIDTHS,
    render: () => <ChipView state={{ kind: 'new', count: 3, lastRssAt: NOW_S - 240 }} petText="Veritasium posted: I finally saw quantum mechanics with my own eyes" />
  }
]
