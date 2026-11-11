// Skeleton responses (a stub answers with the contract example). Feature modules use these
// values while `REAL_ROUTES` does not list the route; tests use them as sample data.
// Source: `example` of the x-transport: ext routes in contract/api.yaml.
import type { ExtState, SyncReport, SyncSignal } from '../../../shared/api-types'

/** `GET /ext/state` (contract example). */
export const EXT_STATE_EXAMPLE: ExtState = {
  new_total: 12,
  tabs: [{ tab_id: 'all-new', name: 'Tudo novo', count: 12, icon: null }],
  folders: [{ folder_id: 'f_tech', name: 'Tech', count: 9, parent_id: null }],
  search_pending: 0,
  queue_pending: 1,
  home_on_youtube: true,
  extras_honest_thumbnails: false,
  extras_hn_lens: false,
  extras_hn_channels: false,
  extras_import_lists: false,
  refresh_running: false,
  last_rss_at: 1762700000,
  language: 'auto',
  device_id: 'dev_1',
  server_time: 1762700100
}

/** `POST /ext/sync/subscriptions` (contract example, with the given signal). */
export function syncReportStub(signal: SyncSignal): SyncReport {
  return { signal, added: [], updated: [], marked_ex: [] }
}
