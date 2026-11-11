// Preview scenarios of the welcome dialog (the collector's fixed interface): each scenario mounts the
// REAL dialog over a fake `ctx` that answers from the `rest` map (key = contract route, value = the `data` of the
// envelope or a function; throwing `{code, message}` simulates an error) and `rpc`. States that depend on time/sequence
// (code generated, waiting, connected, expired…) come through `initial` (fixed state), so the screenshot does not
// depend on the collector's clock. Only the preview imports this file (outside the bundle).
// Data: real channels and avatars from plugin/data/demo_channels.json; devices and numbers are illustrative.
import type { ReactNode } from 'react'
import type { Channel, Device, ExtensionBrowser, ExtensionSetupResult, ExtensionSetupStatus, StatusResponse } from '../../../shared/api-types'
import { OnboardingDialog, type OnboardingSeed } from './index'
import type { LinkItem } from './link'
import type { PairState } from './pair'

export type Scenario = {
  id: string
  title: string
  widths?: number[]
  rest?: Record<string, unknown | ((req: { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown)>
  rpc?: Record<string, unknown | ((params: unknown) => unknown)>
  render: () => ReactNode
}

const WIDTHS = [420, 900]
const nowS = () => Math.floor(Date.now() / 1000)
const CODE = '482913'

// ------------------------------------------------------------------ data

const AVATAR = {
  veritasium: 'https://yt3.googleusercontent.com/7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj',
  mkbhd: 'https://yt3.googleusercontent.com/qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj',
  kurzgesagt: 'https://yt3.googleusercontent.com/ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s176-c-k-c0x00ffffff-no-rj',
  fireship: 'https://yt3.googleusercontent.com/3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s176-c-k-c0x00ffffff-no-rj'
}

function channel(id: string, title: string, handle: string, thumb: string): Channel {
  return {
    id,
    title,
    relation: 'followed',
    source: 'link',
    added_at: nowS(),
    handle,
    thumb,
    url: `https://www.youtube.com/${handle}`,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: null,
    videos_per_week: null,
    shorts_ratio: null,
    ai_note: null,
    tag_ids: []
  }
}

const VERITASIUM = channel('UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium', AVATAR.veritasium)
const KURZGESAGT = channel('UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', '@kurzgesagt', AVATAR.kurzgesagt)
const FIRESHIP = channel('UCsBjURrPoezykLs9EqgamOA', 'Fireship', '@fireship', AVATAR.fireship)

function device(id: string, name: string, ageS: number, seenS: number | null): Device {
  return { id, name, created_at: nowS() - ageS, last_seen: seenS === null ? null : nowS() - seenS, revoked_at: null, origin: null }
}

function status(extra: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 0,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: null,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 0,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    ...extra
  }
}

const REPORT = { channels: 40, folders: 6, tags: 0, tabs: 1, videos: 0, skipped: 0, warnings: [] }

/** Empty backend of someone who just installed (no RPC: `pair.start` falls back to POST /pair/start). */
function base(extra: Scenario['rest'] = {}): Scenario['rest'] {
  return {
    'GET /demo': { loaded: false },
    'GET /devices': { items: [] },
    'GET /channels': { items: [], total: 0 },
    'GET /status': status(),
    'POST /pair/start': () => ({ code: CODE, expires_at: nowS() + 300, port: 47615 }),
    'POST /demo/load': REPORT,
    'POST /demo/clear': REPORT,
    'POST /refresh': { result: 'started' },
    ...extra
  }
}

const RPC: Scenario['rpc'] = { 'runtime.describe': { capabilities: [] } }

const show = (initial?: OnboardingSeed, step?: 'pair' | 'link' | 'demo') => () => (
  <OnboardingDialog onClose={() => undefined} initial={initial} step={step} />
)

const waitingSeed = (leftS: number): OnboardingSeed => ({
  view: 'pair',
  pair: {
    phase: 'waiting',
    code: CODE,
    expiresAt: Date.now() + leftS * 1000,
    issuedAt: Date.now() - (300 - leftS) * 1000,
    baseline: [],
    channelsBefore: 0
  }
})

const CHROME = device('dev_1', 'Chrome — Mac', 20, 4)

// ------------------------------------------------------------------ "Set up the extension" (next to the code)

const EXT_PATH = '/home-folder/ana/HermesTube Extension'
const CHROME_BROWSER: ExtensionBrowser = {
  key: 'chrome',
  name: 'Google Chrome',
  extensions_url: 'chrome://extensions/',
  sandbox: null,
  app_id: null,
  folder_visible: true
}

function setupStatus(extra: Partial<ExtensionSetupStatus> = {}): ExtensionSetupStatus {
  return { state: 'not_installed', path: EXT_PATH, bundled_version: '0.1.0', installed_version: null, platform: 'macos', browsers: [CHROME_BROWSER], ...extra }
}

const SETUP_RESULT: ExtensionSetupResult = {
  state: 'installed',
  action: 'installed',
  path: EXT_PATH,
  version: '0.1.0',
  opened: { extensions_page: true, folder: true },
  open_problem: null,
  platform: 'macos',
  browser: CHROME_BROWSER
}

/** The pairing step as most people first see it: the setup part, the live code and one older browser. */
const setupSeed = (extra: Partial<PairState> = {}): OnboardingSeed => {
  const seed = waitingSeed(287)
  return { ...seed, pair: { ...seed.pair, phase: 'waiting', ...extra } }
}

const linkAdded: LinkItem[] = [
  { key: 'a3', input: '@fireship', state: 'pending' },
  { key: 'a2', input: '@kurzgesagt', state: 'late', errorKey: 'link.status.late', channel: null },
  { key: 'a1', input: '@veritasium', state: 'added', channel: VERITASIUM },
  { key: 'a0', input: 'youtube.com/@fireship', state: 'undone', channel: FIRESHIP }
]

const linkErrors: LinkItem[] = [
  {
    key: 'e3',
    input: '@mkbhd',
    state: 'exists',
    errorKey: 'link.status.exists',
    existing: { title: 'Marques Brownlee', thumb: AVATAR.mkbhd, handle: '@mkbhd' }
  },
  { key: 'e2', input: '@channel-that-does-not-exist', state: 'error', errorKey: 'link.errors.not_found', retryable: false },
  { key: 'e1', input: 'https://youtu.be/dQw4w9WgXcQ', state: 'error', errorKey: 'link.errors.youtube_down', retryable: true },
  { key: 'e0', input: '@kurzgesagt', state: 'added', channel: KURZGESAGT, undoFailed: true }
]

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'onboarding-initial',
    title: 'Welcome · initial (3 paths)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: show()
  },
  {
    id: 'onboarding-devices',
    title: 'Welcome · with devices and the demo loaded',
    widths: WIDTHS,
    rest: base({
      'GET /demo': { loaded: true },
      'GET /devices': { items: [CHROME, device('dev_0', 'Brave — Linux', 40 * 86400, 3 * 86400)] }
    }),
    rpc: RPC,
    render: show()
  },
  {
    id: 'onboarding-devices-error',
    title: 'Welcome · error listing devices',
    widths: WIDTHS,
    rest: base({
      'GET /devices': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    }),
    rpc: RPC,
    render: show()
  },
  {
    id: 'onboarding-pair-starting',
    title: 'Pairing · loading (code skeleton)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: show({ view: 'pair', pair: { phase: 'starting' } })
  },
  {
    id: 'onboarding-pair-code',
    title: 'Pairing · code generated',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: show(waitingSeed(299))
  },
  {
    id: 'onboarding-pair-waiting',
    title: 'Pairing · waiting for the extension (with another device already connected)',
    widths: WIDTHS,
    rest: base({ 'GET /devices': { items: [device('dev_0', 'Brave — Linux', 40 * 86400, 3 * 86400)] } }),
    rpc: RPC,
    render: show(waitingSeed(134))
  },
  {
    id: 'onboarding-pair-syncing',
    title: 'Pairing · connected + reading the subscriptions',
    widths: WIDTHS,
    rest: base({ 'GET /devices': { items: [CHROME] } }),
    rpc: RPC,
    render: show({
      view: 'pair',
      pair: { phase: 'syncing', device: CHROME, syncSince: Date.now() - 8000, baseline: [], channelsBefore: 0 }
    })
  },
  {
    id: 'onboarding-pair-done',
    title: 'Pairing · channels arrived (closes by itself)',
    widths: WIDTHS,
    rest: base({ 'GET /devices': { items: [CHROME] }, 'GET /channels': { items: [], total: 212 } }),
    rpc: RPC,
    render: show({ view: 'pair', pair: { phase: 'done', device: CHROME, total: 212, channelsBefore: 0 } })
  },
  {
    id: 'onboarding-pair-expired',
    title: 'Pairing · code expired',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: show({
      view: 'pair',
      pair: { phase: 'expired', code: CODE, expiresAt: Date.now() - 5000, issuedAt: Date.now() - 305_000, baseline: [], channelsBefore: 0 }
    })
  },
  {
    id: 'onboarding-pair-down',
    title: 'Pairing · extension server down (ext_endpoint_down)',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ ext_endpoint_up: false, ext_port: null }) }),
    rpc: RPC,
    render: show({ view: 'pair', pair: { phase: 'error', error: 'ext_endpoint_down' } })
  },
  {
    id: 'onboarding-pair-reconnect',
    title: 'Pairing · degraded: "open Hermes to reconnect"',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ ext_endpoint_up: false, ext_port: null }) }),
    rpc: RPC,
    render: show(waitingSeed(212))
  },
  {
    id: 'onboarding-setup-offer',
    title: 'Pairing · "Set up the extension" offered next to the code',
    widths: WIDTHS,
    rest: base({ 'GET /extension/setup': setupStatus(), 'POST /extension/setup': SETUP_RESULT }),
    rpc: RPC,
    render: show(setupSeed())
  },
  {
    id: 'onboarding-setup-ready',
    title: 'Pairing · extension folder ready (with an older browser listed)',
    widths: WIDTHS,
    rest: base({
      'GET /extension/setup': setupStatus({ state: 'installed', installed_version: '0.1.0' }),
      'POST /extension/setup': { ...SETUP_RESULT, action: 'unchanged' },
      'GET /devices': { items: [device('dev_0', 'Brave — Linux', 40 * 86400, 3 * 86400)] }
    }),
    rpc: RPC,
    render: show(setupSeed())
  },
  {
    id: 'onboarding-setup-done',
    title: 'Pairing · after "Set up the extension" (the browser gestures left)',
    widths: WIDTHS,
    rest: base({ 'GET /extension/setup': setupStatus({ state: 'installed', installed_version: '0.1.0' }), 'POST /extension/setup': SETUP_RESULT }),
    rpc: RPC,
    render: show(setupSeed({ setup: SETUP_RESULT }))
  },
  {
    id: 'onboarding-setup-manual',
    title: 'Pairing · no bundled extension (install by hand)',
    widths: WIDTHS,
    rest: base({ 'GET /extension/setup': setupStatus({ state: 'unavailable', bundled_version: null }) }),
    rpc: RPC,
    render: show(setupSeed())
  },
  {
    id: 'onboarding-setup-read-failed',
    title: 'Pairing · the folder check failed (the button works anyway)',
    widths: WIDTHS,
    rest: base({
      'GET /extension/setup': () => {
        throw { code: 'internal', message: 'database is locked' }
      },
      'POST /extension/setup': SETUP_RESULT
    }),
    rpc: RPC,
    render: show(setupSeed())
  },
  {
    id: 'onboarding-link-success',
    title: 'Paste link · added (looking up, slow, following, undone)',
    widths: WIDTHS,
    rest: base({ 'POST /channels/add': VERITASIUM }),
    rpc: RPC,
    render: show({ view: 'link', link: { items: linkAdded } })
  },
  {
    id: 'onboarding-link-error',
    title: 'Paste link · errors (format, duplicate, not found, YouTube down)',
    widths: WIDTHS,
    rest: base({
      'POST /channels/add': () => {
        throw { code: 'youtube_error', message: 'YouTube unavailable (HTTP 503)', details: { status: 503 } }
      }
    }),
    rpc: RPC,
    render: show({ view: 'link', link: { items: linkErrors, draft: 'some channel', fieldError: 'format' } })
  },
  {
    id: 'onboarding-demo-loading',
    title: 'Demo · loading (videos arriving)',
    widths: WIDTHS,
    rest: base({ 'GET /demo': { loaded: true }, 'GET /status': status({ refresh_running: true, new_total: 12 }) }),
    rpc: RPC,
    render: show({ view: 'demo', demo: { phase: 'arriving', report: REPORT, since: Date.now() - 4000, videos: 12 } })
  },
  {
    id: 'onboarding-demo-ready',
    title: 'Demo · ready (clear in view, closes by itself)',
    widths: WIDTHS,
    rest: base({ 'GET /demo': { loaded: true }, 'GET /status': status({ new_total: 37, last_rss_at: nowS() }) }),
    rpc: RPC,
    render: show({ view: 'demo', demo: { phase: 'ready', report: REPORT, since: Date.now() - 9000, videos: 37 } })
  },
  {
    id: 'onboarding-demo-degraded',
    title: 'Demo · flaky YouTube (strip)',
    widths: WIDTHS,
    rest: base({ 'GET /demo': { loaded: true }, 'GET /status': status({ refresh_running: true, rss_down_since: nowS() - 900 }) }),
    rpc: RPC,
    render: show({ view: 'demo', demo: { phase: 'arriving', report: REPORT, since: Date.now() - 4000 } })
  },
  {
    id: 'onboarding-demo-loaded',
    title: 'Demo · already loaded (clear demo)',
    widths: WIDTHS,
    rest: base({ 'GET /demo': { loaded: true } }),
    rpc: RPC,
    render: show({ view: 'demo', demo: { phase: 'loaded' } })
  },
  {
    id: 'onboarding-demo-error',
    title: 'Demo · failed to load (try again)',
    widths: WIDTHS,
    rest: base({
      'POST /demo/load': () => {
        throw { code: 'conflict', message: 'demo busy' }
      }
    }),
    rpc: RPC,
    render: show({ view: 'demo', demo: { phase: 'error', failed: 'load' } })
  }
]
