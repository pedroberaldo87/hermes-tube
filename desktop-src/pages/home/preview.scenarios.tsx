// Preview scenarios of Subscriptions (the collector's fixed interface): each scenario mounts the
// REAL screen over a fake `ctx` that answers from the `rest` map (key = contract route, value = the `data` of the
// envelope or a function; throwing `{code, message}` simulates an error). Only the preview imports this file (outside the bundle).
// Data: ids, titles, relative dates and views of real videos (public RSS feeds of Fireship, Veritasium,
// Kurzgesagt, Adam Neely, 3Blue1Brown — the same as the kit preview) and demo channels (plugin/data/demo_channels.json).
// Illustrative: states (watched/later), reasons, new counts, durations. The fake `GET /feed` sorts and groups
// like the server (`arrange`); the `home-marks-*` scenarios show cards with and without duration/type (like older servers).
import type { ReactNode } from 'react'
import type { Channel, Device, FeedItem, FeedPage, StatusResponse, Tab, TabRules, Why } from '../../../shared/api-types'
import { HomeView } from './index'

export type Scenario = {
  id: string
  title: string
  widths?: number[]
  rest?: Record<string, unknown | ((req: { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown)>
  rpc?: Record<string, unknown | ((params: unknown) => unknown)>
  render: () => ReactNode
}

type Req = { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }

const WIDTHS = [420, 900, 1440]
const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600
const D = 86400

// ------------------------------------------------------------------ channels (demo)

type Seed = [id: string, title: string, handle: string, folder: string, favorite: boolean, thumb: string]

// photos: each channel's `thumb` in plugin/data/demo_channels.json (yt3.googleusercontent.com; the import
// rule does not let the screen read plugin/data, so the URL is copied here)
const YT3 = 'https://yt3.googleusercontent.com/'
const AVATAR = '=s176-c-k-c0x00ffffff-no-rj'
const SEEDS: Seed[] = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship', '@Fireship', 'f_tech', true, `${YT3}3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y${AVATAR}`],
  ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium', 'f_science', true, `${YT3}7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA${AVATAR}`],
  ['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', '@kurzgesagt', 'f_science', false, `${YT3}ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4${AVATAR}`],
  ['UCnkp4xDOwqqJD7sSM3xdUiQ', 'Adam Neely', '@AdamNeely', 'f_music', false, `${YT3}584RoBu_Mr3Ocp2I-GAomClNWH6ZeuVWeDpFAhFqziYIyTjMEoHHWzmyg8XtIN8v73eJa-19kTA${AVATAR}`],
  ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown', '@3blue1brown', 'f_science', false, `${YT3}ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU${AVATAR}`],
  ['UCXUPKJO5MZQN11PqgIvyuvQ', 'Andrej Karpathy', '@AndrejKarpathy', 'f_tech', false, `${YT3}ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz${AVATAR}`]
]

const CHANNELS: Record<string, Channel> = Object.fromEntries(
  SEEDS.map(([id, title, handle, folder, favorite, thumb], i) => [
    id,
    {
      id,
      title,
      relation: 'subscribed',
      source: 'extension',
      added_at: NOW_S - 400 * D + i * D,
      handle,
      thumb,
      url: `https://www.youtube.com/${handle}`,
      folder_id: folder,
      favorite: !!favorite,
      muted: false,
      unsubscribed_at: null,
      last_video_at: NOW_S - (i + 1) * 5 * H,
      videos_per_week: 1 + (i % 3),
      shorts_ratio: 0.1,
      ai_note: null,
      tag_ids: []
    } satisfies Channel
  ])
)

const FOLDER_NAME: Record<string, string> = { f_tech: 'Tecnologia', f_science: 'Ciência', f_music: 'Música' }

// ------------------------------------------------------------------ videos

type V = [id: string, channel: string, title: string, ageH: number, views: number, durationS: number, extra?: Partial<FeedItem>]

const VIDEOS: V[] = [
  ['KfODG5REyss', 'UCHnyfMqiRRG1u-2MsSQLbXA', "I finally saw quantum mechanics with my own eyes... (It's spookier than I expected)", 20, 14564759, 3955, {
    why: { via: 'channel', label: 'Veritasium', detail: 'favorito' }
  }],
  ['iw9SZgyahqg', 'UCsBjURrPoezykLs9EqgamOA', 'The one thing holding theoretical CS together just broke... kinda', 6, 1905521, 312],
  ['k2ruCf_z75I', 'UCsBjURrPoezykLs9EqgamOA', 'The worst week in cybersecurity history... so far', 30, 2095834, 287, { why: { via: 'tag', label: 'ia', detail: null } }],
  ['kIMIlLx4DIc', 'UCnkp4xDOwqqJD7sSM3xdUiQ', 'Music is Inherently Political', 52, 661306, 1848],
  ['rL0qEmTRI-I', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Why do deserts get cold at night?', 60, 1563718, 58, { video: { is_short: true } as FeedItem['video'] }],
  ['5_Fayfx2NUM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'How I Survived Late-Stage Cancer (A Fun Story)', 75, 8267833, 1034],
  ['nEaJMdM1djM', 'UCsBjURrPoezykLs9EqgamOA', 'Did the AI bubble just pop?', 90, 2677564, 296, { state: 'watched', is_new: false }],
  ['VMj-3S1tku0', 'UCXUPKJO5MZQN11PqgIvyuvQ', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 110, 9100000, 8822, {
    why: { via: 'hn', label: 'HN: melhor ponto de partida para backprop', detail: null },
    badges: ['hn'],
    is_new: false,
    state: 'seen'
  }],
  ['eyZEqSPeMwg', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'No device could prove Einstein wrong... until now', 130, 7987009, 1612, { state: 'later', is_new: false }],
  ['PXbVn-f_wuM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'You Will Only Like Half of This Video', 150, 5792024, 726],
  ['aircAruvnKk', 'UCYO_jab_esuFRV4b17AJtAw', 'But what is a neural network? | Deep learning chapter 1', 170, 21000000, 1150, {
    why: { via: 'theme', label: 'Agentes de IA', detail: 'citado 3× nas buscas' },
    is_new: false,
    state: 'seen'
  }],
  ['G_em1hHPnXY', 'UCsBjURrPoezykLs9EqgamOA', 'China just dropped a new frontier model... and nobody can explain how', 190, 2474229, 304],
  ['NiCgcUTL9_Q', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Fiber Optics are so much cooler than I thought', 220, 15710623, 1922, { state: 'watched', is_new: false }],
  ['ujkD4SxPKOI', 'UCsXVk37bltHxD1rDPwtNM8Q', 'AI Just Crossed the Terrifying Line - Now What?', 260, 23852199, 912],
  ['EfeGc02nzC4', 'UCnkp4xDOwqqJD7sSM3xdUiQ', 'They Teach AI Music at Music School Now...', 300, 464995, 1530],
  ['wjZofJX0v4M', 'UCYO_jab_esuFRV4b17AJtAw', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 340, 6400000, 1648],
  ['l3L_lETiSzc', 'UCsBjURrPoezykLs9EqgamOA', 'The runtime wars are over... and Node won', 380, 1221305, 341],
  ['_y9JuojAIg0', 'UCsXVk37bltHxD1rDPwtNM8Q', 'We Finally Know More About Humanity’s First Civilization', 420, 12061826, 1105]
]

function toItem([id, channelId, title, ageH, views, durationS, extra]: V): FeedItem {
  const ch = CHANNELS[channelId]
  const why: Why = { via: 'folder', label: FOLDER_NAME[ch.folder_id ?? ''] ?? ch.title, detail: null }
  const base: FeedItem = {
    video: {
      id,
      channel_id: channelId,
      title,
      published_at: NOW_S - ageH * H,
      description: id === 'KfODG5REyss' ? 'A real double-slit experiment with single photons: the interference pattern builds up one click at a time.' : null,
      channel_title: ch.title,
      duration_s: durationS,
      is_short: false,
      views,
      first_seen_at: NOW_S - ageH * H + 600,
      origin: 'rss'
    },
    channel: ch,
    state: 'new',
    reaction: null,
    is_new: ageH < 7 * 24,
    why,
    badges: []
  }
  return { ...base, ...extra, video: { ...base.video, ...(extra?.video ?? {}) } }
}

const FEED: FeedItem[] = VIDEOS.map(toItem)

// ------------------------------------------------------------------ tabs and status

function rules(include: Partial<TabRules['include']>, onlyNew = false, mode: TabRules['mode'] = 'fresh'): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: onlyNew, per_channel: null, min_s: null, max_s: null },
    mode
  }
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'Tudo novo', kind: 'mixed', rules: rules({ all: true }, true), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favoritos', kind: 'mixed', rules: rules({ favorites: true }, true), icon: '⭐', filters: {}, sort: 1, builtin: true },
  { id: 'tab_tech', name: 'Tecnologia', kind: 'category', rules: rules({ folders: ['f_tech'] }), icon: null, filters: {}, sort: 2, builtin: false },
  { id: 'tab_science', name: 'Ciência', kind: 'category', rules: rules({ folders: ['f_science'] }), icon: null, filters: {}, sort: 3, builtin: false },
  { id: 'tab_music', name: 'Música', kind: 'category', rules: rules({ folders: ['f_music'] }), icon: null, filters: {}, sort: 4, builtin: false },
  { id: 'tab_ai', name: 'Agentes de IA', kind: 'theme', rules: rules({ themes: ['th_ai'], lenses: ['hn'] }, false, 'classics'), icon: '🤖', filters: {}, sort: 5, builtin: false }
]

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 38,
    new_by_tab: [
      { tab_id: 'all-new', name: 'Tudo novo', count: 38, icon: null },
      { tab_id: 'favorites', name: 'Favoritos', count: 6, icon: '⭐' },
      { tab_id: 'tab_tech', name: 'Tecnologia', count: 14, icon: null },
      { tab_id: 'tab_science', name: 'Ciência', count: 11, icon: null },
      { tab_id: 'tab_music', name: 'Música', count: 2, icon: null }
    ],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 2 * 60,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 1,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    channels_total: 40,
    subscribed_total: 34,
    ...over
  }
}

const FOLDER_OF_TAB: Record<string, string> = { tab_tech: 'f_tech', tab_science: 'f_science', tab_music: 'f_music' }

/** Same rule as the server: each word in the title or the channel, ignoring accents and case. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function searchFilter(list: FeedItem[], q: unknown): FeedItem[] {
  const words = fold(String(q ?? '')).split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((i) => {
    const title = fold(i.video.title)
    const channel = fold(i.channel?.title ?? i.video.channel_title ?? '')
    return words.every((w) => title.includes(w) || channel.includes(w))
  })
}

const FOLDER_ORDER = Object.keys(FOLDER_NAME)

/** Sorts by group (channel: name · folder: folder order, no folder last · day: most recent
 *  first, in the `tz_offset_min` time zone · type: videos, Shorts, unknown) and, within it, by `sort`. */
function arrange(list: FeedItem[], query: Req['query']): FeedItem[] {
  const sort = String(query?.sort ?? 'newest')
  const group = String(query?.group ?? 'none')
  const tz = Number(query?.tz_offset_min ?? 0)
  const pub = (it: FeedItem) => it.video.published_at ?? 0
  const last = (n: number | null | undefined, dir: 1 | -1) => (n == null ? Number.POSITIVE_INFINITY : dir * n)
  const within: Record<string, (a: FeedItem, b: FeedItem) => number> = {
    newest: (a, b) => pub(b) - pub(a),
    oldest: (a, b) => pub(a) - pub(b),
    longest: (a, b) => last(a.video.duration_s, -1) - last(b.video.duration_s, -1),
    shortest: (a, b) => last(a.video.duration_s, 1) - last(b.video.duration_s, 1),
    views: (a, b) => last(a.video.views, -1) - last(b.video.views, -1)
  }
  const rank = (it: FeedItem): [number, string] => {
    if (group === 'channel') return [0, (it.channel?.title ?? it.video.channel_title ?? '').toLowerCase()]
    if (group === 'folder') {
      const i = FOLDER_ORDER.indexOf(it.channel?.folder_id ?? '')
      return [i < 0 ? FOLDER_ORDER.length : i, '']
    }
    if (group === 'day') return [-Math.floor((pub(it) + tz * 60) / D), '']
    if (group === 'kind') return [it.video.is_short === false ? 0 : it.video.is_short ? 1 : 2, '']
    return [0, '']
  }
  return [...list].sort((a, b) => {
    const [na, sa] = rank(a)
    const [nb, sb] = rank(b)
    if (na !== nb) return na - nb
    if (sa !== sb) return sa.localeCompare(sb)
    return (within[sort] ?? within.newest)(a, b)
  })
}

/** Fake `GET /feed`: tab, folder, channel or `state=later`, with `q`, sort/group and cursor (offset). */
function feedFor(req: Req, source: FeedItem[] = FEED): FeedPage {
  const tab = String(req.query?.tab ?? 'all-new')
  const cursor = req.query?.cursor ? Number(req.query.cursor) : 0
  let list = source
  if (req.query?.state === 'later') list = LATER
  else if (req.query?.folder) list = source.filter((i) => i.channel?.folder_id === req.query?.folder)
  else if (req.query?.channel) list = source.filter((i) => i.channel?.id === req.query?.channel)
  else if (tab === 'favorites') list = source.filter((i) => i.channel?.favorite)
  else if (FOLDER_OF_TAB[tab]) list = source.filter((i) => i.channel?.folder_id === FOLDER_OF_TAB[tab])
  else if (tab === 'tab_ai') list = source.filter((i) => i.why?.via === 'hn' || i.why?.via === 'theme' || i.channel?.id === 'UCXUPKJO5MZQN11PqgIvyuvQ')
  list = arrange(searchFilter(list, req.query?.q), req.query)
  const size = 12
  const items = list.slice(cursor, cursor + size)
  const next = cursor + size < list.length ? String(cursor + size) : null
  return { items, next_cursor: next, counts: { total: list.length, new: list.filter((i) => i.is_new).length } }
}

const EMPTY_PAGE: FeedPage = { items: [], next_cursor: null, counts: { total: 0, new: 0 } }

// Like older servers: half without duration, some without type. Each card shows only what is known:
// video with duration · Short with and without duration · unknown type with duration · nothing (no type and no duration).
const MIXED: FeedItem[] = FEED.map((it, i) => {
  const cases: Array<Partial<FeedItem['video']>> = [
    {},
    { duration_s: null },
    { is_short: true, duration_s: 47 },
    { is_short: null },
    { is_short: null, duration_s: null },
    { is_short: true, duration_s: null }
  ]
  return { ...it, video: { ...it.video, ...cases[i % cases.length] } }
})
const mixedFeed = (req: Req) => feedFor(req, MIXED)

// "Watch later" (`GET /feed?state=later`): `why` is the video's origin (channel folder › channel › topic)
const LATER: FeedItem[] = FEED.filter((i) => i.state === 'later' || i.video.id === 'PXbVn-f_wuM').map((i) => ({ ...i, state: 'later' as const, is_new: false }))

/** A browser paired with the extension (the extension notice needs `GET /devices` to say anything). */
const PAIRED: Device = { id: 'dev_1', name: 'Chrome — Mac', created_at: Math.floor(Date.now() / 1000) - 40 * 86400, last_seen: Math.floor(Date.now() / 1000) - 60, revoked_at: null, origin: null }

/** Routes of a full and healthy Subscriptions; each scenario overrides what changes. */
function base(over: Scenario['rest'] = {}): NonNullable<Scenario['rest']> {
  return {
    'GET /tabs': { items: TABS },
    'GET /status': status(),
    'GET /devices': { items: [PAIRED] },
    'GET /feed': (req: Req) => feedFor(req),
    'POST /feed/preview': EMPTY_PAGE,
    'POST /videos/state': { changed: 1 },
    'POST /read': { changed: 3, change_ids: [1] },
    'POST /refresh': { result: 'started' },
    'GET /changes': { items: [] },
    'GET /ai/status': { available: true, model: 'demo-model', reason: null },
    'GET /jobs': { items: [] },
    'POST /channels/add': () => {
      throw { code: 'youtube_error', message: 'resolve failed' }
    },
    'POST /demo/load': { channels: 40, folders: 6, tags: 0, tabs: 1, videos: 0, skipped: 0, warnings: [] },
    'GET /extras': { honest_thumbnails: false, hn_lens: true, hn_channels: false, import_lists: false, hn_dataset_ready: true, hn_video_count: 4200, hn_credit: 'HackerTube' },
    'GET /folders': {
      items: Object.entries(FOLDER_NAME).map(([id, name], i) => ({ id, name, parent_id: null, color: null, sort: i }))
    },
    ...over
  }
}

const pending = () => new Promise<never>(() => undefined)

export const scenarios: Scenario[] = [
  { id: 'home-comfortable', title: 'Subscriptions · full · comfortable', widths: WIDTHS, rest: base(), render: () => <HomeView initialTab="all-new" initialDensity="comfortable" /> },
  { id: 'home-compact', title: 'Subscriptions · full · compact', widths: WIDTHS, rest: base(), render: () => <HomeView initialTab="all-new" initialDensity="compact" /> },
  { id: 'home-list', title: 'Subscriptions · full · list', widths: WIDTHS, rest: base(), render: () => <HomeView initialTab="all-new" initialDensity="list" /> },
  { id: 'home-theme-tab', title: 'Subscriptions · topic tab (topic and HN reasons)', widths: WIDTHS, rest: base(), render: () => <HomeView initialTab="tab_ai" initialDensity="comfortable" /> },
  { id: 'home-later', title: 'Subscriptions · Watch later', widths: WIDTHS, rest: base(), render: () => <HomeView initialTab=":later" initialDensity="comfortable" /> },
  {
    id: 'home-tab-empty',
    title: 'Subscriptions · tab with nothing new',
    widths: WIDTHS,
    rest: base({ 'GET /feed': EMPTY_PAGE, 'GET /status': status({ new_total: 0, new_by_tab: [] }) }),
    render: () => <HomeView initialTab="tab_music" initialDensity="comfortable" />
  },
  {
    id: 'home-welcome',
    title: 'Subscriptions · zero channels (welcome)',
    widths: WIDTHS,
    rest: base({
      'GET /feed': EMPTY_PAGE,
      'GET /status': status({ new_total: 0, new_by_tab: [], devices_online: 0, last_rss_at: null, channels_total: 0, subscribed_total: 0 })
    }),
    render: () => <HomeView />
  },
  {
    id: 'home-loading',
    title: 'Subscriptions · loading',
    widths: WIDTHS,
    rest: base({ 'GET /tabs': pending, 'GET /status': pending, 'GET /feed': pending }),
    render: () => <HomeView initialDensity="comfortable" />
  },
  {
    id: 'home-loading-feed',
    title: 'Subscriptions · loading the feed (tabs ready)',
    widths: WIDTHS,
    rest: base({ 'GET /feed': pending }),
    render: () => <HomeView initialTab="tab_tech" initialDensity="compact" />
  },
  {
    id: 'home-error',
    title: 'Subscriptions · feed error',
    widths: WIDTHS,
    rest: base({
      'GET /feed': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    }),
    render: () => <HomeView initialTab="all-new" />
  },
  {
    id: 'home-rss-down',
    title: 'Subscriptions · YouTube RSS down',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ rss_down_since: NOW_S - 3 * H, rss_fallback_channels: 12, devices_online: 0 }) }),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" />
  },
  {
    id: 'home-ext-disconnected',
    title: 'Subscriptions · extension disconnected',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ devices_online: 0 }) }),
    render: () => <HomeView initialTab="favorites" initialDensity="compact" />
  },
  {
    id: 'home-refreshing',
    title: 'Subscriptions · refreshing',
    widths: WIDTHS,
    rest: base({ 'GET /status': status({ refresh_running: true }) }),
    render: () => <HomeView initialTab="tab_science" initialDensity="list" />
  },
  {
    id: 'home-new-tab-menu',
    title: 'Subscriptions · "+ New tab" menu open (anchored at the end of the tab bar)',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" initialMenuOpen />
  },
  {
    id: 'home-pane-filter',
    title: 'Subscriptions · filtering by a pane folder (no tab of its own)',
    widths: WIDTHS,
    rest: base({ 'GET /tabs': { items: TABS.filter((t) => t.id !== 'tab_music') } }),
    render: () => <HomeView initialDensity="comfortable" initialFilter={{ kind: 'folder', id: 'f_music' }} />
  },
  {
    id: 'home-search',
    title: 'Subscriptions · server search (GET /feed?q=), search count',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" initialQuery="neural" />
  },
  {
    id: 'home-seen-in-place',
    title: 'Subscriptions · after acting: watched highlight in the same place, 1 archived (place kept), 1 in Watch later',
    widths: WIDTHS,
    rest: base(),
    render: () => (
      <HomeView
        initialTab="all-new"
        initialDensity="comfortable"
        initialActions={[
          ['watched', 0],
          ['archive', 2],
          ['later', 3]
        ]}
      />
    )
  },
  {
    id: 'home-tab-menu',
    title: 'Subscriptions · active tab menu opened by the "⋯" (Edit · Move · Delete), floating over the page',
    widths: WIDTHS,
    rest: base({ 'POST /tabs/reorder': { count: 6 } }),
    render: () => <HomeView initialTab="tab_science" initialDensity="comfortable" initialTabMenu="tab_science" />
  },
  {
    id: 'home-quick-tip',
    title: 'Subscriptions · quick action tooltip open ("Mark as watched · W" over the grid\'s 1st card)',
    widths: WIDTHS,
    rest: base(),
    // the preview opens the tooltip of the trigger the selector finds (preview/sdk.tsx, `Tip`); in the app it opens on hover
    render: () => (
      <div data-preview-tip-open='[data-part="grid"] [data-action="watched"]' style={{ display: 'contents' }}>
        <HomeView initialTab="all-new" initialDensity="comfortable" />
      </div>
    )
  },
  {
    id: 'home-tab-delete',
    title: 'Subscriptions · confirmation to delete the tab in the app dialog (says the name; channels and videos stay)',
    widths: WIDTHS,
    rest: base({ 'DELETE /tabs/{id}': (req: Req) => ({ id: String(req.path?.id ?? '') }) }),
    render: () => <HomeView initialTab="tab_science" initialDensity="comfortable" initialDelete="tab_science" />
  },
  {
    id: 'home-marks-comfortable',
    title: 'Subscriptions · type + duration on the cards (comfortable; with and without duration, with and without type)',
    widths: WIDTHS,
    rest: base({ 'GET /feed': mixedFeed }),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" />
  },
  {
    id: 'home-marks-compact',
    title: 'Subscriptions · type + duration on the cards (compact; with and without duration, with and without type)',
    widths: WIDTHS,
    rest: base({ 'GET /feed': mixedFeed, 'GET /status': status({ refresh_running: true }) }),
    render: () => <HomeView initialTab="all-new" initialDensity="compact" />
  },
  {
    id: 'home-marks-list',
    title: 'Subscriptions · type + duration in the metadata line (list; with and without duration, with and without type)',
    widths: WIDTHS,
    rest: base({ 'GET /feed': mixedFeed }),
    render: () => <HomeView initialTab="all-new" initialDensity="list" />
  },
  {
    id: 'home-group-channel',
    title: 'Subscriptions · list grouped by channel (header with avatar and count of loaded items; no highlight)',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="compact" initialView={{ sort: 'newest', group: 'channel' }} />
  },
  {
    id: 'home-group-day',
    title: 'Subscriptions · list grouped by day (Today, Yesterday, dates), in the list',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="list" initialView={{ sort: 'newest', group: 'day' }} />
  },
  {
    id: 'home-sort-menu',
    title: 'Subscriptions · sort menu open (Longest chosen)',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" initialView={{ sort: 'longest', group: 'none' }} initialViewMenu="sort" />
  },
  {
    id: 'home-search-empty',
    title: 'Subscriptions · nothing found for «x» (with clear search)',
    widths: WIDTHS,
    rest: base(),
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" initialQuery="tricotar meias" />
  }
]
