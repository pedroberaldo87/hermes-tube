// Sample data of the public screenshots and of the demo video frames: everything comes from the invented catalog in
// docs/sample-data/catalog.json (no real channel, brand or person). Folders, channels, favorites, videos with their
// durations and ages ("age_hours" before the moment the page opens), the "Wildlife Documentaries" topic with the
// catalog's reasons. Avatars and thumbnails point at YouTube image hosts (the only ones the app loads); the capture
// (scripts/docs-screenshots.mjs) answers those requests with the sample images and blocks everything else.
// Illustrative (not in the catalog): watched counts in Manage, the cleanup reasons, the topic preview scores.
import catalog from '../../../docs/sample-data/catalog.json'
import type { Channel, ChannelRow, CleanupCandidate, CleanupView, FeedItem, FeedPage, Folder, StatusResponse, Tab, TabRules, ThemePreview, Video, Why } from '../../../shared/api-types'

interface SampleAvatar {
  bg: string
  fg: string
  monogram: string
}
interface SampleChannel {
  id: string
  title: string
  handle: string
  folder?: string
  favorite?: boolean
  avatar: SampleAvatar
}
interface SampleVideo {
  id: string
  channel_id: string
  title: string
  duration_s: number
  age_hours: number
  reason?: string
}
interface SampleCatalog {
  folders: Array<{ key: string; name: string; color: string }>
  channels: SampleChannel[]
  videos: SampleVideo[]
  topic: { query: string; name: string; icon: string; channels: SampleChannel[]; videos: Array<SampleVideo & { reason: string }> }
}

const CATALOG = catalog as SampleCatalog

export const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600
const D = 86400
/** A video is new for a week (the same window the tabs use). */
const NEW_HOURS = 7 * 24
/** Weeks the catalog covers (its oldest video), for the posting pace. */
const SPAN_WEEKS = Math.max(...CATALOG.videos.map((v) => v.age_hours)) / (7 * 24)

/** The avatar address of a sample channel (answered by the capture with the channel's monogram). */
export const avatarUrl = (channelId: string): string => `https://yt3.googleusercontent.com/sample-avatar/${channelId}=s176-c-k-c0x00ffffff-no-rj`

// ------------------------------------------------------------------ folders, channels, videos

export const folderId = (key: string): string => `f_${key}`
export const tabIdOf = (key: string): string => `tab_${key}`
export const TOPIC_TAB = 'tab_wildlife'
export const TOPIC = CATALOG.topic

export const FOLDERS: Folder[] = CATALOG.folders.map((f, i) => ({ id: folderId(f.key), name: f.name, parent_id: null, color: f.color, sort: i }))
const FOLDER_NAME: Record<string, string> = Object.fromEntries(FOLDERS.map((f) => [f.id, f.name]))

const videosOf = (channelId: string, list: readonly SampleVideo[] = CATALOG.videos) => list.filter((v) => v.channel_id === channelId)
const publishedAt = (v: SampleVideo): number => NOW_S - v.age_hours * H

function channelOf(c: SampleChannel, i: number): Channel {
  const own = videosOf(c.id)
  const newest = own.length ? Math.min(...own.map((v) => v.age_hours)) : null
  return {
    id: c.id,
    title: c.title,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S - (720 - i * 23) * D,
    handle: c.handle,
    thumb: avatarUrl(c.id),
    url: `https://www.youtube.com/${c.handle}`,
    folder_id: c.folder ? folderId(c.folder) : null,
    favorite: !!c.favorite,
    muted: false,
    unsubscribed_at: null,
    last_video_at: newest == null ? null : NOW_S - newest * H,
    videos_per_week: Math.round((own.length / SPAN_WEEKS) * 10) / 10,
    shorts_ratio: 0,
    ai_note: null,
    tag_ids: []
  }
}

export const CHANNELS: Channel[] = CATALOG.channels.map((c, i) => channelOf(c, i))
const CHANNEL = new Map(CHANNELS.map((c) => [c.id, c]))
export const channelById = (id: string): Channel => {
  const c = CHANNEL.get(id)
  if (!c) throw new Error(`sample data: no channel ${id}`)
  return c
}
export const channelByTitle = (title: string): Channel => {
  const c = CHANNELS.find((x) => x.title === title)
  if (!c) throw new Error(`sample data: no channel "${title}"`)
  return c
}
/** Title of any sample channel: a subscription or one of the topic's channels (not followed). */
const TITLE: Record<string, string> = Object.fromEntries([...CATALOG.channels, ...TOPIC.channels].map((c) => [c.id, c.title]))

function videoOf(v: SampleVideo, origin: Video['origin']): Video {
  return {
    id: v.id,
    channel_id: v.channel_id,
    title: v.title,
    published_at: publishedAt(v),
    description: null,
    channel_title: TITLE[v.channel_id] ?? null,
    duration_s: v.duration_s,
    is_short: false,
    views: null,
    first_seen_at: publishedAt(v) + 600,
    origin
  }
}

/** Why a subscription video is in a tab: a favorite channel, else its folder. */
function whyOf(ch: Channel): Why {
  if (ch.favorite) return { via: 'channel', label: ch.title, detail: 'favorite' }
  return { via: 'folder', label: FOLDER_NAME[ch.folder_id ?? ''] ?? ch.title, detail: null }
}

/** The 40 subscription videos, newest first. */
export const FEED: FeedItem[] = CATALOG.videos
  .slice()
  .sort((a, b) => a.age_hours - b.age_hours)
  .map((v) => {
    const channel = channelById(v.channel_id)
    const isNew = v.age_hours < NEW_HOURS
    return { video: videoOf(v, 'rss'), channel, state: isNew ? 'new' : 'seen', reaction: null, is_new: isNew, why: whyOf(channel), badges: [] }
  })

/**
 * The 14 topic videos, newest first, each with the catalog's reason. Their channels are not followed (the topic found
 * them by search), so `channel` is null, as the backend sends it.
 */
export const TOPIC_FEED: FeedItem[] = TOPIC.videos
  .slice()
  .sort((a, b) => a.age_hours - b.age_hours)
  .map((v) => ({
    video: videoOf(v, 'search'),
    channel: null,
    state: 'new',
    reaction: null,
    is_new: v.age_hours < NEW_HOURS,
    why: { via: 'theme', label: TOPIC.name, detail: v.reason },
    badges: []
  }))

// ------------------------------------------------------------------ tabs, status and the feed route

function rules(include: Partial<TabRules['include']>, onlyNew = false): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: onlyNew, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

export const TABS: Tab[] = [
  { id: 'all-new', name: 'All new', kind: 'mixed', rules: rules({ all: true }, true), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favorites', kind: 'mixed', rules: rules({ favorites: true }, true), icon: '⭐', filters: {}, sort: 1, builtin: true },
  ...CATALOG.folders.map(
    (f, i): Tab => ({ id: tabIdOf(f.key), name: f.name, kind: 'category', rules: rules({ folders: [folderId(f.key)] }), icon: null, filters: {}, sort: 2 + i, builtin: false })
  ),
  { id: TOPIC_TAB, name: TOPIC.name, kind: 'theme', rules: rules({ themes: ['th_wildlife'] }), icon: TOPIC.icon, filters: {}, sort: 2 + CATALOG.folders.length, builtin: false }
]
const FOLDER_OF_TAB: Record<string, string> = Object.fromEntries(CATALOG.folders.map((f) => [tabIdOf(f.key), folderId(f.key)]))

type Query = Record<string, unknown> | undefined

/** The items of one tab (or folder/channel filter), before search and paging. */
export function itemsFor(query: Query): FeedItem[] {
  const tab = String(query?.tab ?? 'all-new')
  if (query?.state === 'later') return []
  if (query?.folder) return FEED.filter((i) => i.channel?.folder_id === query.folder)
  if (query?.channel) return [...FEED, ...TOPIC_FEED].filter((i) => i.channel?.id === query.channel)
  if (tab === 'all-new') return FEED.filter((i) => i.is_new)
  if (tab === 'favorites') return FEED.filter((i) => i.is_new && i.channel?.favorite)
  if (tab === TOPIC_TAB) return TOPIC_FEED
  if (FOLDER_OF_TAB[tab]) return FEED.filter((i) => i.channel?.folder_id === FOLDER_OF_TAB[tab])
  return []
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Fake `GET /feed`: tab or filter, `q`, newest first, pages of 12 (cursor = offset). */
export function feedPage(req: { query?: Query }): FeedPage {
  const words = fold(String(req.query?.q ?? '')).split(/\s+/).filter(Boolean)
  const list = itemsFor(req.query)
    .filter((i) => words.every((w) => fold(`${i.video.title} ${i.video.channel_title ?? ''}`).includes(w)))
    .sort((a, b) => (b.video.published_at ?? 0) - (a.video.published_at ?? 0))
  const cursor = req.query?.cursor ? Number(req.query.cursor) : 0
  const items = list.slice(cursor, cursor + 12)
  return { items, next_cursor: cursor + 12 < list.length ? String(cursor + 12) : null, counts: { total: list.length, new: list.filter((i) => i.is_new).length } }
}

const newCount = (tabId: string) => itemsFor({ tab: tabId }).filter((i) => i.is_new).length

export function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: newCount('all-new'),
    new_by_tab: TABS.filter((t) => t.id !== TOPIC_TAB).map((t) => ({ tab_id: t.id, name: t.name, count: newCount(t.id), icon: t.icon })),
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
    channels_total: CHANNELS.length,
    subscribed_total: CHANNELS.length,
    ...over
  }
}

/** New videos per subscription (the pane and Manage counts). */
export const NEW_BY_CHANNEL: Record<string, number> = Object.fromEntries(CHANNELS.map((c) => [c.id, FEED.filter((i) => i.is_new && i.channel?.id === c.id).length]))

// ------------------------------------------------------------------ Manage and Cleanup

/** The three channels the cleanup proposes: the board-game corner nobody opens. */
const CLEANUP: Array<[title: string, group: CleanupCandidate['group'], why: string]> = [
  ['Late Night Roguelike Log', 'ignored', '11 videos in 90 days, none watched.'],
  ['Meeple Maintenance', 'ignored', '10 videos in 90 days, none watched.'],
  ['Felt Tray Almanac', 'off_profile', 'Tabletop crafts and dice maths; you mostly watch science, cooking and nature.']
]
export const CLEANUP_IDS = CLEANUP.map(([title]) => channelByTitle(title).id)

/** Videos watched in the last 90 days (illustrative): favorites more, the cleanup candidates none. */
function watched90(c: Channel, i: number): number {
  if (CLEANUP_IDS.includes(c.id)) return 0
  return c.favorite ? 9 + (i % 4) : 2 + ((i * 5) % 6)
}

export const ROWS: ChannelRow[] = CHANNELS.map((c, i) => ({ channel: c, new_count: NEW_BY_CHANNEL[c.id] ?? 0, watched_90d: watched90(c, i) }))

export const CLEANUP_VIEW: CleanupView = {
  scan: {
    scan_id: 'scan_1',
    created_at: NOW_S - 2 * D,
    model: 'claude-haiku-5-5',
    candidates: CLEANUP.map(([title, group, why], i) => ({
      id: `cc_${i + 1}`,
      channel_id: channelByTitle(title).id,
      group,
      why,
      status: 'pending',
      scan_id: 'scan_1',
      created_at: NOW_S - 2 * D
    }))
  },
  channels: Object.fromEntries(CLEANUP_IDS.map((id) => [id, channelById(id)]))
}

// ------------------------------------------------------------------ the topic preview

/**
 * The New topic tab preview of the catalog topic (`themeId` = the id the dialog asked for). Seed channels are the ones
 * with 3 or more kept videos; the catalog keeps 2 per channel, so there are none and the dialog says the tab will rely
 * on search.
 */
export function topicPreview(themeId: string): ThemePreview {
  const videos: Record<string, Video> = {}
  for (const it of TOPIC_FEED) videos[it.video.id] = it.video
  const seeds = TOPIC.channels
    .map((c) => ({ channel_id: c.id, title: c.title, kept_videos: videosOf(c.id, TOPIC.videos).length }))
    .filter((s) => s.kept_videos >= 3)
  return {
    theme: {
      id: themeId,
      query: TOPIC.query,
      status: 'preview',
      created_at: NOW_S - 60,
      name: TOPIC.name,
      icon: TOPIC.icon,
      tab_id: null,
      searches: [TOPIC.query, 'wildlife documentary full episode'],
      seeds: seeds.map((s) => s.channel_id),
      include_terms: [],
      exclude_terms: [],
      last_search_at: NOW_S - 30,
      cadence_days: 7,
      error: null
    },
    // in the catalog's order, best first
    items: TOPIC.videos.map((v, i) => ({ theme_id: themeId, video_id: v.id, verdict: 'keep', source: 'search', score: Math.round((0.96 - i * 0.02) * 100) / 100, reason: v.reason })),
    videos,
    seeds,
    channel_count: TOPIC.channels.length
  }
}
