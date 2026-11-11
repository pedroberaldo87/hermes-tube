// Preview scenarios of Cleanup (the collector's fixed interface): each scenario mounts the REAL screen
// over a fake `ctx` that answers from the `rest` map (key = contract route, value = the envelope's `data` or a
// function; throwing `{code, message}` simulates an error) and `rpc` (short method). Only the preview imports this file.
// Data: real demo channels and photos (plugin/data/demo_channels.json); synthetic channel ids in the
// contract format (`UC` + 22). Illustrative: reasons, dates, counts and the queue state.
import type { Channel, ChannelRow, CleanupCandidate, CleanupView as CleanupData, Device, Job, QueueItem, StatusResponse } from '../../../shared/api-types'
import type { Scenario, ScenarioRequest } from '../../components'
import { CleanupView } from './index'

const WIDTHS = [420, 900, 1440]
const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600
const D = 86400
const YT3 = 'https://yt3.googleusercontent.com/'

// ------------------------------------------------------------------ channels (demo)

type Seed = [key: string, title: string, handle: string, thumb: string, lastVideoDaysAgo: number, perWeek: number]

const SEEDS: Seed[] = [
  ['primeagen', 'ThePrimeagen', '@ThePrimeagen', 'ytc/AIdro_laY82JAzs_2edBDxrxLgLWshhMK04SpAqOfoEzexOBZg=s176-c-k-c0x00ffffff-no-rj', 2, 6],
  ['verge', 'The Verge', '@TheVerge', 'ZIj_dq7beCkAkhufNqCid_SjWW4mkv4tqIDtv7_AAKzWdhBWI-rpsRXYXB9X3mB0s0zNzNtYdQ=s176-c-k-c0x00ffffff-no-rj', 1, 14],
  ['babish', 'Binging with Babish', '@bingingwithbabish', 'AlCRk3X8JvmNqHC7R3c7yVDQaGyUvMAd3GXY77vTgzGS1Qa_vlVFY0ZNSH56otpeBKDq3gF-yw=s176-c-k-c0x00ffffff-no-rj', 214, 0],
  ['noclip', '/noclip', '@NoclipDocs', '093arh9Jg1MqfdvcqcrDcUQm9QMdXnzWEJ-dpT_YUn5QU_8AQYbBIL37TvUHQDUaG1XErynq3w=s176-c-k-c0x00ffffff-no-rj', 247, 0],
  ['foodwishes', 'Food Wishes', '@foodwishes', 'ytc/AIdro_kGZ14S6frarUZ0q3zzhqTSnl3zkYo_qxwQ8Wi-J11MaA=s176-c-k-c0x00ffffff-no-rj', 391, 0],
  ['ign', 'IGN', '@IGN', '4jRpju9vRtgoIA6SxuIomVcCmjub6ydA1TzGRHts853ZzxRITi41gxP50jTuGBdUlvAgehZJK8Y=s176-c-k-c0x00ffffff-no-rj', 0, 41],
  ['gamespot', 'GameSpot', '@gamespot', '2q8-YlqtAs3pWHamRcooAOvt_M88afnTwo7DYwqvHV9OSGlf2pBa5h3QJGeHrBkBidUjaL0mpA=s176-c-k-c0x00ffffff-no-rj', 0, 23],
  ['reuters', 'Reuters', '@Reuters', 'bCcVVrrV0EhGFJKsSvmeZHA9Y-YzSL9Keqrrr0HWYUPQy3-mVUVNHMbjwt7IoVkpsHt4E6BZ3pM=s176-c-k-c0x00ffffff-no-rj', 0, 35],
  ['aljazeera', 'Al Jazeera English', '@aljazeeraenglish', 'XsTga3Nsfc1E6ZgC6HfHfzTG_3zhuZleOnsKxSK2aILMjwkkIm-0vdALFaU-yt0Lw07iLtbSifk=s176-c-k-c0x00ffffff-no-rj', 0, 60],
  ['ltt', 'Linus Tech Tips', '@LinusTechTips', 'gnvYLhXy8FAlPXZ2RTrkrgj-5kyt0vdE2FUGVOiKGdEZIa-wN5A-7nwZBlWJLzUMmoh1NWAU=s176-c-k-c0x00ffffff-no-rj', 1, 9],
  ['dwnews', 'DW News', '@dwnews', 'NSOdTQTWlqMy8O_j32dx-ftfTCHMOt04Hm7KZ4pfAK6-eQzQSZMWvvss90kG8KQfJ7iNP3phyA=s176-c-k-c0x00ffffff-no-rj', 0, 48],
  ['nasa', 'NASA', '@NASA', 'eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s176-c-k-c0x00ffffff-no-rj', 3, 4],
  ['salt', 'Summoning Salt', '@SummoningSalt', 'ytc/AIdro_n8NSEiNfCuno3JKW2ggFYNvxVUKPg2jzf2O_7W-pmkAv4=s176-c-k-c0x00ffffff-no-rj', 40, 0.2]
]

/** Synthetic id in the contract format (`^UC[A-Za-z0-9_-]{22}$`), stable per key. */
function fakeId(key: string): string {
  return `UC${`${key}_demo_channel_id_xx`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 22).padEnd(22, '_')}`
}

const CH: Record<string, Channel> = Object.fromEntries(
  SEEDS.map(([key, title, handle, thumb, lastDays, perWeek], i) => [
    key,
    {
      id: fakeId(key),
      title,
      relation: 'subscribed',
      source: 'extension',
      added_at: NOW_S - (900 - i * 20) * D,
      handle,
      thumb: `${YT3}${thumb}`,
      url: `https://www.youtube.com/${handle}`,
      folder_id: null,
      favorite: false,
      muted: false,
      unsubscribed_at: null,
      last_video_at: NOW_S - lastDays * D - 5 * H,
      videos_per_week: perWeek,
      shorts_ratio: 0.1,
      ai_note: null,
      tag_ids: []
    } satisfies Channel
  ])
)

/** Watched in 90 days (`null` = no device sent history). */
const WATCHED: Record<string, number> = { ign: 0, gamespot: 0, reuters: 0, aljazeera: 0, primeagen: 1, verge: 0 }

// ------------------------------------------------------------------ cleanup

function cand(key: string, group: CleanupCandidate['group'], why: string, n: number): CleanupCandidate {
  return { id: `cc_${n}`, channel_id: CH[key].id, group, why, status: 'pending', scan_id: 'scan_7', created_at: NOW_S - 2 * D }
}

const FULL: CleanupCandidate[] = [
  cand('foodwishes', 'stale', 'Sem vídeo novo há 391 dias.', 1),
  cand('noclip', 'stale', 'Sem vídeo novo há 247 dias.', 2),
  cand('babish', 'stale', 'Sem vídeo novo há 214 dias.', 3),
  cand('ign', 'ignored', '41 vídeos em 90 dias e nenhum assistido.', 4),
  cand('aljazeera', 'ignored', '60 vídeos em 90 dias e nenhum assistido.', 5),
  cand('reuters', 'ignored', '35 vídeos em 90 dias e nenhum assistido.', 6),
  cand('gamespot', 'off_profile', 'Notícias de games; você guarda ciência, culinária e música, e só assiste aos documentários.', 7),
  cand('verge', 'off_profile', 'Notícias diárias de consumo; seus favoritos são canais de explicação longa.', 8)
]

const keyOf = (id: string) => Object.keys(CH).find((k) => CH[k].id === id)

function cleanup(candidates: CleanupCandidate[], model: string | null = 'claude-haiku-5-5', ageS = 2 * D): CleanupData {
  const channels: Record<string, Channel> = {}
  for (const c of candidates) {
    const key = keyOf(c.channel_id)
    if (key) channels[c.channel_id] = CH[key]
  }
  return { scan: { scan_id: 'scan_7', created_at: NOW_S - ageS, model, candidates }, channels }
}

function rowOf(id: string, history = true): ChannelRow | null {
  const key = keyOf(id)
  if (!key) return null
  return { channel: CH[key], new_count: 0, watched_90d: history ? (WATCHED[key] ?? 3) : null }
}

function exRow(key: string, daysAgo: number, expiresInDays?: number): ChannelRow {
  const row: ChannelRow & { expires_at?: number } = {
    channel: { ...CH[key], relation: 'ex', unsubscribed_at: NOW_S - daysAgo * D },
    new_count: 0,
    watched_90d: null
  }
  if (expiresInDays != null) row.expires_at = NOW_S + expiresInDays * D
  return row
}

const EX: ChannelRow[] = [exRow('ltt', 2), exRow('dwnews', 9), exRow('salt', 21)]

/** `GET /channels` with the screen's three uses: `relation=ex`, `ids=…` and the history check (`relation=subscribed`). */
function channelsRoute(ex: ChannelRow[], history = true) {
  return (req: ScenarioRequest) => {
    if (req.query.relation === 'ex') return { items: ex, total: ex.length }
    if (req.query.ids) {
      const items = req.query.ids
        .split(',')
        .map((id) => rowOf(id, history) ?? ex.find((r) => r.channel.id === id) ?? null)
        .filter((r): r is ChannelRow => !!r)
      return { items, total: items.length }
    }
    return { items: [{ channel: CH.nasa, new_count: 2, watched_90d: history ? 5 : null }], total: 40 }
  }
}

// ------------------------------------------------------------------ queue and status

function q(id: string, key: string, status: QueueItem['status'], over: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    channel_id: CH[key].id,
    action: 'unsubscribe',
    status,
    approved_at: NOW_S - 4 * 60,
    approved_via: 'desktop_rpc',
    created_at: NOW_S - 4 * 60 + Number(id.replace(/\D/g, '')),
    updated_at: NOW_S - 40,
    reason: null,
    error: null,
    device_id: status === 'approved' ? null : 'dev_chrome',
    ...over
  }
}

function queue(items: QueueItem[]) {
  return { items, pending: items.filter((i) => i.status === 'approved' || i.status === 'running').length }
}

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 12,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 3 * 60,
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

function job(st: Job['status'], done: number, total: number): Job {
  return {
    id: 'job_scan',
    kind: 'cleanup_scan',
    status: st,
    created_at: NOW_S - 20,
    updated_at: NOW_S - 1,
    progress: { stage: 'reasons', done, total, message: null },
    result: null,
    error: null
  }
}

const pending = () => new Promise<never>(() => undefined)

/** RPC of the actions (the collector announces `plugin-rpc-v1`): clicking in the preview works without hitting a missing route. */
const RPC: NonNullable<Scenario['rpc']> = {
  'cleanup.scan': () => ({ job: job('queued', 0, 40) }),
  'cleanup.approve': (params) => ({
    items: ((params.channel_ids as string[]) ?? []).map((id, i) => q(`q_${90 + i}`, keyOf(id) ?? 'ign', 'approved'))
  }),
  'cleanup.resubscribe': (params) => ({
    items: ((params.channel_ids as string[]) ?? []).map((id) => q('q_99', keyOf(id) ?? 'ltt', 'approved', { action: 'resubscribe' }))
  })
}

/** A browser paired with the extension (the extension notice needs `GET /devices` to say anything). */
const PAIRED: Device = { id: 'dev_1', name: 'Chrome — Mac', created_at: Math.floor(Date.now() / 1000) - 40 * 86400, last_seen: Math.floor(Date.now() / 1000) - 60, revoked_at: null, origin: null }

/** Routes of a full and healthy Cleanup; each scenario overrides what changes. */
function base(over: Scenario['rest'] = {}): NonNullable<Scenario['rest']> {
  return {
    'GET /cleanup': cleanup(FULL),
    'GET /status': status(),
    'GET /devices': { items: [PAIRED] },
    'GET /queue': queue([]),
    'GET /channels': channelsRoute(EX),
    'GET /jobs/{id}': job('running', 18, 40),
    'POST /cleanup/dismiss': (req) => ({ count: ((req.body as { ids?: string[] } | null)?.ids ?? []).length }),
    'POST /queue/undo': (req) => ({ items: ((req.body as { ids?: string[] } | null)?.ids ?? []).map((id) => q(id, 'ign', 'undone')) }),
    ...over
  }
}

const without = (keys: string[]) => FULL.filter((c) => !keys.includes(keyOf(c.channel_id) ?? ''))

export const scenarios: Scenario[] = [
  {
    id: 'cleanup-loading',
    title: 'Cleanup · loading',
    widths: WIDTHS,
    rest: base({ 'GET /cleanup': pending, 'GET /queue': pending, 'GET /channels': pending, 'GET /status': pending }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-never',
    title: 'Cleanup · never scanned (invitation)',
    widths: WIDTHS,
    rest: base({ 'GET /cleanup': { scan: null, channels: {} }, 'GET /channels': channelsRoute([]) }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-scanning',
    title: 'Cleanup · first scan running',
    widths: WIDTHS,
    rest: base({ 'GET /cleanup': { scan: null, channels: {} }, 'GET /channels': channelsRoute([]) }),
    rpc: RPC,
    render: () => <CleanupView scanJobId="job_scan" />
  },
  {
    id: 'cleanup-full',
    title: 'Cleanup · 3 full groups (reasons by AI)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-selection',
    title: 'Cleanup · selection + approval card',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: () => <CleanupView initialSelected={[CH.foodwishes.id, CH.noclip.id, CH.babish.id]} initialReview />
  },
  {
    id: 'cleanup-selection-all',
    title: 'Cleanup · card with many channels (see all open)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: () => <CleanupView initialSelected={FULL.map((c) => c.channel_id)} initialReview initialShowAll />
  },
  {
    id: 'cleanup-selecting',
    title: 'Cleanup · selecting (selection bar)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: () => <CleanupView initialSelected={[CH.ign.id, CH.aljazeera.id, CH.reuters.id, CH.verge.id]} />
  },
  {
    id: 'cleanup-queue',
    title: 'Cleanup · queue in progress',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup(without(['ign', 'aljazeera', 'reuters'])),
      'GET /queue': queue([
        q('q_1', 'ign', 'done', { updated_at: NOW_S - 50 }),
        q('q_2', 'aljazeera', 'running'),
        q('q_3', 'reuters', 'approved')
      ]),
      'GET /status': status({ queue_pending: 2 })
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-queue-failed',
    title: 'Cleanup · queue with a failure',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup(without(['foodwishes', 'noclip', 'babish'])),
      'GET /queue': queue([
        q('q_1', 'foodwishes', 'done', { updated_at: NOW_S - 9 * 60 }),
        q('q_2', 'noclip', 'failed', { error: 'O botão "Inscrito" não apareceu na página do canal.', updated_at: NOW_S - 7 * 60 }),
        q('q_3', 'babish', 'done', { updated_at: NOW_S - 5 * 60 })
      ])
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-clean',
    title: 'Cleanup · list up to date',
    widths: WIDTHS,
    rest: base({ 'GET /cleanup': cleanup([], 'claude-haiku-5-5', 5 * H), 'GET /channels': channelsRoute(EX.slice(0, 1)) }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-ex',
    title: 'Cleanup · Former subscriptions (expiry when present; resubscribe queued)',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup([], 'claude-haiku-5-5', 1 * D),
      'GET /channels': channelsRoute([exRow('ltt', 2, 28), exRow('dwnews', 9, 21), exRow('salt', 21, 9), exRow('primeagen', 27, 3)]),
      'GET /queue': queue([q('q_7', 'dwnews', 'approved', { action: 'resubscribe' })])
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-no-extension',
    title: 'Cleanup · extension disconnected (queue waits for the browser)',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup(without(['ign', 'reuters'])),
      'GET /queue': queue([q('q_1', 'ign', 'approved'), q('q_2', 'reuters', 'approved')]),
      'GET /status': status({ devices_online: 0, queue_pending: 2 })
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-not-paired',
    title: 'Cleanup · no browser ever paired (connect strip)',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ devices_online: 0 }), 'GET /devices': { items: [] } }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-no-model',
    title: 'Cleanup · no model (reasons by rule) and no extension history',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup(FULL.filter((c) => c.group === 'stale'), null),
      'GET /channels': channelsRoute(EX, false),
      'GET /ai/status': { available: false, model: null, reason: 'no_model' }
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-provider-unavailable',
    title: "Cleanup · rule-only scan: model configured but its provider can't be reached",
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': cleanup(FULL.filter((c) => c.group === 'stale'), null),
      'GET /ai/status': { available: false, model: 'claude-sonnet-5-5', reason: 'provider_unavailable', provider: 'claude-subscription' }
    }),
    rpc: RPC,
    render: () => <CleanupView />
  },
  {
    id: 'cleanup-rescanning',
    title: 'Cleanup · scanning again (the old list stays)',
    widths: WIDTHS,
    rest: base(),
    rpc: RPC,
    render: () => <CleanupView scanJobId="job_scan" />
  },
  {
    id: 'cleanup-error',
    title: 'Cleanup · error reading the scan',
    widths: WIDTHS,
    rest: base({
      'GET /cleanup': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    }),
    rpc: RPC,
    render: () => <CleanupView />
  }
]
