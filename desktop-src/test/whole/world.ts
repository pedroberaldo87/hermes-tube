// ONE fake, coherent backend for the whole plugin: the same channels, folders, tabs, videos and status in
// every route (the pane, the chip, Subscriptions, Manage, Cleanup and the dialogs read the SAME world). Writes
// (move channel, mark read, create folder…) change the world, and every read route reflects the change.
//
// It installs itself in `sdkMock.restHandler` (the mock's `ctx.rest`) and in `sdkMock.requestHandler` (RPC). Each request
// goes into `calls`; a route the world does not know becomes a transport 404 (like Desktop without the route) and goes into
// `missing` — the test checks that the mounted plugin asks for nothing outside the table.
//
// Tailored failures: `fail(route, error)` (contract error envelope), `transport(route)` (transport 404),
// `everything(error)` (every route; e.g. `plugin_disabled`) and `rpc = 'unavailable'` (-32601 on describe).
import type {
  Channel,
  ChannelRow,
  ChangeRecord,
  CleanupView,
  Device,
  FeedItem,
  FeedPage,
  Folder,
  StateResponse,
  StatusResponse,
  Suggestion,
  Tab,
  TabRules,
  Tag,
  Video,
  VideoState
} from '../../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY } from '../../../shared/ids'
import { rpcError, sdkMock } from '../sdk-mock'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>

export interface WorldRequest {
  method: string
  path: string
  /** Key of the contract route that matched (`'GET /channels/{id}'`), or `null`. */
  route: string | null
  params: Record<string, string>
  query: Record<string, string>
  body: any
  /** Clock (ms) at the time of the request. */
  at: number
}

export interface ApiErrorLike {
  code: string
  message: string
  reason?: string
}

type Handler = (req: WorldRequest) => unknown

// ------------------------------------------------------------------ ids (contract format)

export const FIRESHIP = 'UCsBjURrPoezykLs9EqgamOA'
export const KARPATHY = 'UCXUPKJO5MZQN11PqgIvyuvQ'
export const VERITASIUM = 'UCHnyfMqiRRG1u-2MsSQLbXA'
export const NEELY = 'UCnkp4xDOwqqJD7sSM3xdUiQ'
export const VERGE = 'UCddiUEpeqJcYeBxX1IVBKvQ'
export const LTT = 'UCXuqSBlHAE6Xw-yeJA0Tunw'

const D = 86400

function rules(include: Partial<TabRules['include']>, onlyNew = false): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: onlyNew, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

/** 11-character video id, stable per channel and number. */
function videoId(channel: string, n: number): string {
  return `${channel.slice(2, 9)}_v${n}`.padEnd(11, 'x').slice(0, 11)
}

interface StateRow {
  state: VideoState
  reaction: 'up' | 'down' | null
  updated_at: number
}

export class World {
  readonly nowS: number
  channels: Channel[]
  folders: Folder[]
  tags: Tag[]
  tabs: Tab[]
  videos: Video[]
  states: Record<string, StateRow>
  changes: ChangeRecord[] = []
  suggestions: Suggestion[]
  devices: Device[]
  cleanupDismissed = new Set<string>()
  calls: WorldRequest[] = []
  missing: string[] = []
  rpcCalls: string[] = []
  /** `ok` = RPC announced; `unavailable` = describe answers -32601 (plugin without RPC on this backend). */
  rpc: 'ok' | 'unavailable' = 'ok'
  private failures = new Map<string, ApiErrorLike>()
  private transports = new Set<string>()
  private all: ApiErrorLike | null = null
  private undo = new Map<number, () => void>()
  private seq = 100

  constructor() {
    this.nowS = Math.floor(Date.now() / 1000)
    const now = this.nowS
    this.folders = [
      { id: 'f_tech', name: 'Technology', parent_id: null, color: null, sort: 0 },
      { id: 'f_ai', name: 'Machine learning', parent_id: 'f_tech', color: null, sort: 0 },
      { id: 'f_science', name: 'Science', parent_id: null, color: null, sort: 1 }
    ]
    this.tags = [{ id: 't_deep', name: 'deep dives', color: null }]
    const ch = (id: string, title: string, folder: string | null, over: Partial<Channel> = {}): Channel => ({
      id,
      title,
      relation: 'subscribed',
      source: 'extension',
      added_at: now - 400 * D,
      handle: `@${title.toLowerCase().replace(/\W/g, '')}`,
      thumb: null,
      url: `https://www.youtube.com/@${title.toLowerCase().replace(/\W/g, '')}`,
      folder_id: folder,
      favorite: false,
      muted: false,
      unsubscribed_at: null,
      last_video_at: now - 2 * D,
      videos_per_week: 2,
      shorts_ratio: 0,
      ai_note: null,
      tag_ids: [],
      ...over
    })
    this.channels = [
      ch(FIRESHIP, 'Fireship', 'f_tech', { favorite: true, tag_ids: ['t_deep'] }),
      ch(KARPATHY, 'Andrej Karpathy', 'f_ai'),
      ch(VERITASIUM, 'Veritasium', 'f_science'),
      ch(NEELY, 'Adam Neely', null),
      ch(VERGE, 'The Verge', null, { last_video_at: now - 300 * D }),
      ch(LTT, 'Linus Tech Tips', null, { relation: 'ex', unsubscribed_at: now - 3 * D })
    ]
    this.tabs = [
      { id: 'all-new', name: 'Everything', kind: 'mixed', rules: rules({ all: true }), icon: null, filters: {}, sort: 0, builtin: true },
      { id: 'favorites', name: 'Favourites', kind: 'mixed', rules: rules({ favorites: true }), icon: '⭐', filters: {}, sort: 1, builtin: true },
      { id: 'tab_science', name: 'Science tab', kind: 'category', rules: rules({ folders: ['f_science'] }), icon: null, filters: {}, sort: 2, builtin: false }
    ]
    this.videos = []
    this.states = {}
    const active = this.channels.filter((c) => c.relation !== 'ex')
    active.forEach((c, i) => {
      for (let n = 1; n <= 2; n++) {
        const id = videoId(c.id, n)
        this.videos.push({
          id,
          channel_id: c.id,
          title: `${c.title} episode ${n}`,
          published_at: now - (i * 2 + n) * 3600,
          description: null,
          channel_title: c.title,
          duration_s: 600 + i * 60,
          is_short: false,
          views: 1000 * (i + n),
          first_seen_at: now - (i * 2 + n) * 3600 + 60,
          origin: 'rss'
        })
        // each channel's 1st video is new; the 2nd was already watched
        this.states[id] = { state: n === 1 ? 'new' : 'seen', reaction: null, updated_at: now - D }
      }
    })
    this.suggestions = [
      {
        id: 'sg_1',
        kind: 'organize',
        status: 'pending',
        payload: { channel_id: NEELY, channel_title: 'Adam Neely', folder: 'Music theory', new_folder: true, confidence: 0.9, why: 'Videos about harmony' },
        created_at: now - 3600,
        channel_id: NEELY,
        model: 'mock-model',
        decided_at: null
      }
    ]
    this.devices = [{ id: 'dev_1', name: 'Chrome on the Mac', created_at: now - 30 * D, last_seen: now - 30, revoked_at: null, origin: 'chrome-extension://abc' }]
  }

  // ------------------------------------------------------------------ tailored failures

  /** The route answers the contract error envelope. */
  fail(route: string, error: ApiErrorLike): this {
    this.failures.set(route, error)
    return this
  }

  /** The route does not exist on this backend (Desktop transport 404). */
  transport(route: string): this {
    this.transports.add(route)
    return this
  }

  /** Every route answers this error (e.g. plugin turned off in the profile). */
  everything(error: ApiErrorLike | null): this {
    this.all = error
    return this
  }

  heal(): this {
    this.failures.clear()
    this.transports.clear()
    this.all = null
    return this
  }

  // ------------------------------------------------------------------ derived reads

  channel(id: string): Channel | undefined {
    return this.channels.find((c) => c.id === id)
  }

  folderName(id: string | null): string | null {
    return id ? (this.folders.find((f) => f.id === id)?.name ?? null) : null
  }

  /** Does folder `folderId` contain (recursively) folder `inner`? */
  inside(inner: string | null, folderId: string): boolean {
    let f = inner
    for (let guard = 0; f && guard < 50; guard++) {
      if (f === folderId) return true
      f = this.folders.find((x) => x.id === f)?.parent_id ?? null
    }
    return false
  }

  active(): Channel[] {
    return this.channels.filter((c) => c.relation === 'subscribed' || c.relation === 'followed')
  }

  newCount(channelId: string): number {
    return this.videos.filter((v) => v.channel_id === channelId && this.states[v.id]?.state === 'new').length
  }

  matches(c: Channel, r: TabRules): boolean {
    const inc = r.include
    const hit =
      inc.all ||
      (inc.favorites && c.favorite) ||
      inc.channels.includes(c.id) ||
      inc.folders.some((f) => this.inside(c.folder_id, f)) ||
      inc.tags.some((t) => c.tag_ids.includes(t))
    if (!hit) return false
    const exc = r.exclude
    if (exc.channels.includes(c.id) || exc.folders.some((f) => this.inside(c.folder_id, f)) || exc.tags.some((t) => c.tag_ids.includes(t))) return false
    return true
  }

  feedOf(pred: (c: Channel) => boolean, onlyNew = false, limit = 30, order: Record<string, string> = {}): FeedPage {
    const chans = new Map(this.active().filter(pred).map((c) => [c.id, c]))
    const all = this.videos
      .filter((v) => chans.has(v.channel_id))
      .filter((v) => !onlyNew || this.states[v.id]?.state === 'new')
      .sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0))
    const items = this.arrange(all.map((v) => this.feedItem(v)), order).slice(0, limit)
    return { items, next_cursor: null, counts: { total: all.length, new: all.filter((v) => this.states[v.id]?.state === 'new').length } }
  }

  /** `sort` and `group` of GET /feed — sorts by group and, within it, by `sort`. Without both, nothing changes. */
  arrange(items: FeedItem[], q: Record<string, string>): FeedItem[] {
    const sort = q.sort ?? 'newest'
    const group = q.group ?? 'none'
    if (sort === 'newest' && group === 'none') return items
    const tz = Number(q.tz_offset_min ?? 0)
    const pub = (it: FeedItem) => it.video.published_at ?? 0
    const last = (n: number | null | undefined, dir: 1 | -1) => (n == null ? Number.POSITIVE_INFINITY : dir * n)
    const within: Record<string, (a: FeedItem, b: FeedItem) => number> = {
      newest: (a, b) => pub(b) - pub(a),
      oldest: (a, b) => pub(a) - pub(b),
      longest: (a, b) => last(a.video.duration_s, -1) - last(b.video.duration_s, -1),
      shortest: (a, b) => last(a.video.duration_s, 1) - last(b.video.duration_s, 1),
      views: (a, b) => last(a.video.views, -1) - last(b.video.views, -1)
    }
    const folderRank = (id: string | null | undefined) => {
      const i = this.folders.findIndex((f) => f.id === id)
      return i < 0 ? this.folders.length : i
    }
    const rank = (it: FeedItem): [number, string] => {
      if (group === 'channel') return [0, (it.channel?.title ?? it.video.channel_title ?? '').toLowerCase()]
      if (group === 'folder') return [folderRank(it.channel?.folder_id), '']
      if (group === 'day') return [-Math.floor((pub(it) + tz * 60) / 86400), '']
      if (group === 'kind') return [it.video.is_short === false ? 0 : it.video.is_short ? 1 : 2, '']
      return [0, '']
    }
    return [...items].sort((a, b) => {
      const [na, sa] = rank(a)
      const [nb, sb] = rank(b)
      if (na !== nb) return na - nb
      if (sa !== sb) return sa < sb ? -1 : 1
      return within[sort] ? within[sort](a, b) : 0
    })
  }

  feedItem(v: Video): FeedItem {
    const c = this.channel(v.channel_id) ?? null
    const st = this.states[v.id] ?? { state: 'seen', reaction: null }
    const folder = this.folderName(c?.folder_id ?? null)
    return {
      video: v,
      channel: c,
      state: st.state,
      reaction: st.reaction,
      is_new: st.state === 'new',
      why: folder ? { via: 'folder', label: folder, detail: null } : c ? { via: 'channel', label: c.title, detail: null } : null,
      badges: []
    }
  }

  row(c: Channel): ChannelRow {
    return { channel: c, new_count: this.newCount(c.id), watched_90d: 2 }
  }

  stateResponse(): StateResponse {
    const by_channel: Record<string, number> = {}
    for (const c of this.active()) by_channel[c.id] = this.newCount(c.id)
    const by_folder: Record<string, number> = {}
    for (const f of this.folders) by_folder[f.id] = this.active().filter((c) => this.inside(c.folder_id, f.id)).reduce((n, c) => n + by_channel[c.id], 0)
    by_folder[''] = this.active().filter((c) => !c.folder_id).reduce((n, c) => n + by_channel[c.id], 0)
    const by_tab: Record<string, number> = {}
    for (const t of this.tabs) by_tab[t.id] = this.feedOf((c) => this.matches(c, t.rules)).counts.new
    const total = Object.values(by_channel).reduce((a, b) => a + b, 0)
    return { counts: { total, by_tab, by_folder, by_channel }, videos: {} }
  }

  status(): StatusResponse {
    const st = this.stateResponse()
    return {
      new_total: st.counts.total,
      new_by_tab: this.tabs.map((t) => ({ tab_id: t.id, name: t.name, count: st.counts.by_tab[t.id] ?? 0, icon: t.icon })),
      fav_new: this.active()
        .filter((c) => c.favorite && this.newCount(c.id) > 0)
        .map((c) => {
          const v = this.videos.find((x) => x.channel_id === c.id && this.states[x.id]?.state === 'new') ?? null
          return { channel_id: c.id, title: c.title, count: this.newCount(c.id), latest_video_id: v?.id ?? null, latest_title: v?.title ?? null }
        }),
      ext_endpoint_up: true,
      last_rss_at: this.nowS - 60,
      refresh_running: false,
      queue_pending: 0,
      search_pending: 0,
      devices_online: 1,
      ext_port: 47615,
      rss_down_since: null,
      rss_fallback_channels: 0,
      channels_total: this.channels.length,
      subscribed_total: this.channels.filter((c) => c.relation === 'subscribed').length
    }
  }

  cleanup(): CleanupView {
    const candidates = [VERGE]
      .filter((id) => !this.cleanupDismissed.has(id) && this.channel(id)?.relation === 'subscribed')
      .map((id, i) => ({
        id: `cc_${i + 1}`,
        channel_id: id,
        group: 'stale' as const,
        why: 'No new video in 300 days.',
        status: 'pending' as const,
        scan_id: 'scan_1',
        created_at: this.nowS - D
      }))
    const channels: Record<string, Channel> = {}
    for (const c of candidates) channels[c.channel_id] = this.channel(c.channel_id) as Channel
    return { scan: { scan_id: 'scan_1', created_at: this.nowS - D, model: 'mock-model', candidates }, channels }
  }

  /** Total requests (of one route, if given). */
  count(route?: string): number {
    return route ? this.calls.filter((c) => c.route === route).length : this.calls.length
  }

  // ------------------------------------------------------------------ writes

  private record(action: ChangeRecord['action'], payload: AnyRecord, undo: () => void): number {
    const id = ++this.seq
    this.changes.unshift({ id, ts: Math.floor(Date.now() / 1000), actor: 'user', action, payload, undo: {}, group_id: null, undone_at: null })
    this.undo.set(id, undo)
    return id
  }

  private patchChannel(id: string, body: AnyRecord): Channel {
    const c = this.channel(id)
    if (!c) throw { code: 'not_found', message: `channel ${id}` }
    const before = { ...c }
    Object.assign(c, body)
    this.record('channel_update', { id, ...body }, () => Object.assign(c, before))
    return c
  }

  private markRead(scope: { kind: string; id?: string | null }): { changed: number; ids: number[] } {
    const hit = (c: Channel) =>
      scope.kind === 'all' ||
      (scope.kind === 'channel' && c.id === scope.id) ||
      (scope.kind === 'folder' && !!scope.id && this.inside(c.folder_id, scope.id)) ||
      (scope.kind === 'tab' && this.matches(c, this.tabs.find((t) => t.id === scope.id)?.rules ?? rules({})))
    const changedChannels = new Set<string>()
    const before: Array<[string, StateRow]> = []
    for (const v of this.videos) {
      const c = this.channel(v.channel_id)
      if (!c || !hit(c) || this.states[v.id]?.state !== 'new') continue
      before.push([v.id, { ...this.states[v.id] }])
      this.states[v.id] = { ...this.states[v.id], state: 'seen', updated_at: Math.floor(Date.now() / 1000) }
      changedChannels.add(c.id)
    }
    if (!changedChannels.size) return { changed: 0, ids: [] }
    const id = this.record('mark_read', scope, () => {
      for (const [vid, row] of before) this.states[vid] = row
    })
    return { changed: changedChannels.size, ids: [id] }
  }

  private routes(): Record<string, Handler> {
    return {
      'GET /status': () => this.status(),
      'GET /state': () => this.stateResponse(),
      'GET /extras': () => ({ honest_thumbnails: false, hn_lens: false, hn_channels: false, import_lists: false, hn_dataset_ready: false, hn_video_count: 0, hn_credit: '' }),
      'GET /folders': () => ({ items: this.folders.map((f) => ({ ...f })) }),
      'GET /tags': () => ({ items: this.tags.map((t) => ({ ...t })) }),
      'GET /tabs': () => ({ items: this.tabs }),
      'GET /channels/{id}': (req) => {
        const c = this.channel(req.params.id)
        if (!c) throw { code: 'not_found', message: 'channel' }
        return this.row(c)
      },
      'GET /channels': (req) => {
        const q = req.query
        let list = [...this.channels]
        if (q.relation) {
          const rel = q.relation.split(',')
          list = list.filter((c) => rel.includes(c.relation))
        }
        if (q.folder === 'none') list = list.filter((c) => !c.folder_id)
        else if (q.folder) list = list.filter((c) => (q.recursive === 'false' ? c.folder_id === q.folder : this.inside(c.folder_id, q.folder)))
        if (q.tag) list = list.filter((c) => c.tag_ids.includes(q.tag))
        if (q.favorite) list = list.filter((c) => c.favorite === (q.favorite === 'true'))
        if (q.muted) list = list.filter((c) => c.muted === (q.muted === 'true'))
        if (q.ids) {
          const ids = q.ids.split(',')
          list = list.filter((c) => ids.includes(c.id))
        }
        if (q.q) list = list.filter((c) => c.title.toLowerCase().includes(q.q.toLowerCase()))
        const offset = Number(q.offset ?? 0)
        const limit = Number(q.limit ?? 50)
        return { items: list.slice(offset, offset + limit).map((c) => this.row(c)), total: list.length }
      },
      'GET /feed': (req) => {
        const q = req.query
        const limit = Number(q.limit ?? 30)
        if (q.tab) {
          const tab = this.tabs.find((t) => t.id === q.tab)
          if (!tab) throw { code: 'not_found', message: `tab ${q.tab}` }
          return this.feedOf((c) => this.matches(c, tab.rules), tab.rules.filters.only_new, limit, q)
        }
        if (q.folder) return this.feedOf((c) => this.inside(c.folder_id, q.folder), false, limit, q)
        if (q.channel) return this.feedOf((c) => c.id === q.channel, false, limit, q)
        if (q.state === 'later') {
          const items = this.arrange(this.videos.filter((v) => this.states[v.id]?.state === 'later').map((v) => this.feedItem(v)), q)
          return { items, next_cursor: null, counts: { total: items.length, new: 0 } }
        }
        throw { code: 'invalid', message: 'one of tab, folder, channel, state' }
      },
      'POST /feed/preview': (req) => {
        const body = req.body ?? {}
        const r = body.rules ?? {}
        const full = rules({ ...(r.include ?? {}) }, !!r.filters?.only_new)
        return this.feedOf((c) => this.matches(c, full), full.filters.only_new, body.limit ?? 30)
      },
      'GET /videos': (req) => ({ items: this.videos.filter((v) => (req.query.ids ?? '').split(',').includes(v.id)).map((v) => this.feedItem(v)) }),
      'GET /changes': (req) => ({ items: this.changes.slice(0, Number(req.query.limit ?? 50)) }),
      'GET /devices': () => ({ items: this.devices }),
      'GET /demo': () => ({ loaded: false }),
      'GET /jobs': () => ({ items: [] }),
      'GET /jobs/{id}': () => {
        throw { code: 'not_found', message: 'job' }
      },
      'GET /ai/status': () => ({ available: true, model: 'mock-model', reason: null }),
      'GET /suggestions': () => ({ items: this.suggestions.filter((s) => s.status === 'pending') }),
      'GET /cleanup': () => this.cleanup(),
      'GET /queue': () => ({ items: [], pending: 0 }),
      'GET /themes': () => ({ items: [] }),
      'GET /themes/{id}': () => {
        throw { code: 'not_found', message: 'theme' }
      },
      // ---------------------------------------------------------------- writes
      'POST /refresh': () => ({ result: 'skipped' }),
      'PATCH /channels/{id}': (req) => this.patchChannel(req.params.id, req.body ?? {}),
      'POST /channels/batch': (req) => {
        const { op, channel_ids: ids = [], value = null } = req.body ?? {}
        const changed: string[] = []
        const before = ids.map((id: string) => [id, { ...(this.channel(id) ?? {}) }] as const)
        for (const id of ids as string[]) {
          const c = this.channel(id)
          if (!c) continue
          if (op === 'move') c.folder_id = value
          else if (op === 'favorite' || op === 'unfavorite') c.favorite = op === 'favorite'
          else if (op === 'mute' || op === 'unmute') c.muted = op === 'mute'
          else if (op === 'tag' && value && !c.tag_ids.includes(value)) c.tag_ids = [...c.tag_ids, value]
          else if (op === 'untag') c.tag_ids = c.tag_ids.filter((t) => t !== value)
          changed.push(id)
        }
        const change_id = changed.length
          ? this.record('channel_batch', { op, ids, value }, () => {
              for (const [id, b] of before) Object.assign(this.channel(id) ?? {}, b)
            })
          : null
        return { batch: { changed, skipped: [], change_id }, proposed: [] }
      },
      'POST /read': (req) => {
        const out = this.markRead(req.body ?? { kind: 'all' })
        return req.query.change_ids === 'true' ? { changed: out.changed, change_ids: out.ids } : { changed: out.changed }
      },
      'POST /videos/state': (req) => {
        const { video_ids: ids = [], state, reaction } = req.body ?? {}
        for (const id of ids as string[]) {
          const cur = this.states[id] ?? { state: 'seen', reaction: null, updated_at: 0 }
          this.states[id] = { state: state ?? cur.state, reaction: reaction === undefined ? cur.reaction : reaction, updated_at: Math.floor(Date.now() / 1000) }
        }
        return { changed: ids.length }
      },
      'POST /changes/{id}/undo': (req) => {
        const id = Number(req.params.id)
        const fn = this.undo.get(id)
        const rec = this.changes.find((c) => c.id === id)
        if (!fn || !rec) throw { code: 'not_found', message: 'change' }
        fn()
        this.undo.delete(id)
        rec.undone_at = Math.floor(Date.now() / 1000)
        return { undone: [rec] }
      },
      'POST /folders': (req) => {
        const name = String(req.body?.name ?? '').trim()
        if (!name) throw { code: 'invalid', message: 'name' }
        const f: Folder = { id: `f_${++this.seq}`, name, parent_id: req.body?.parent_id ?? null, color: null, sort: this.folders.length }
        this.folders.push(f)
        this.record('folder_create', { id: f.id }, () => {
          this.folders = this.folders.filter((x) => x.id !== f.id)
        })
        return f
      },
      'PATCH /folders/{id}': (req) => {
        const f = this.folders.find((x) => x.id === req.params.id)
        if (!f) throw { code: 'not_found', message: 'folder' }
        Object.assign(f, req.body ?? {})
        return f
      },
      'POST /tags': (req) => {
        const t: Tag = { id: `t_${++this.seq}`, name: String(req.body?.name ?? ''), color: null }
        this.tags.push(t)
        return t
      },
      'POST /cleanup/dismiss': (req) => {
        const ids: string[] = req.body?.ids ?? []
        for (const c of this.cleanup().scan?.candidates ?? []) if (ids.includes(c.id)) this.cleanupDismissed.add(c.channel_id)
        return { count: ids.length }
      },
      'POST /queue/undo': () => ({ items: [] })
    }
  }

  // ------------------------------------------------------------------ wire

  private readonly table = this.routes()
  private readonly matchers = Object.keys(this.table).map((key) => {
    const [method, tpl] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)]
    const names: string[] = []
    const re = new RegExp(`^${tpl.replace(/\{(\w+)\}/g, (_m, n: string) => (names.push(n), '([^/]+)'))}$`)
    return { key, method, re, names }
  })

  /** Answers a mock `ctx.rest(path, opts)`: returns the envelope (or rejects, like Desktop without the route). */
  handle(rawPath: string, opts?: AnyRecord): Promise<unknown> {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const query = Object.fromEntries(new URLSearchParams(qs))
    let route: string | null = null
    let params: Record<string, string> = {}
    for (const m of this.matchers) {
      if (m.method !== method) continue
      const hit = path.match(m.re)
      if (!hit) continue
      route = m.key
      params = Object.fromEntries(m.names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]))
      break
    }
    const req: WorldRequest = { method, path, route, params, query, body: opts?.body, at: Date.now() }
    this.calls.push(req)
    const key = route ?? `${method} ${path}`
    if (this.all) return Promise.resolve({ ok: false, error: { ...this.all } })
    if (!route || this.transports.has(key)) {
      if (!route) this.missing.push(key)
      return Promise.reject(new Error('404: Not Found'))
    }
    const failure = this.failures.get(route)
    if (failure) return Promise.resolve({ ok: false, error: { ...failure } })
    const handler = this.table[route]
    return Promise.resolve()
      .then(() => handler(req))
      .then(
        (data) => ({ ok: true, data: structuredClone(data) }),
        (error: unknown) => ({ ok: false, error: toError(error) })
      )
  }

  /** RPC (`host.request`): `runtime.describe` + `plugin.<id>.*` (the world runs no AI: answers a contract error). */
  request(method: string): Promise<unknown> {
    this.rpcCalls.push(method)
    if (method === 'runtime.describe') {
      return this.rpc === 'unavailable' ? Promise.reject(rpcError(-32601, 'method not found')) : Promise.resolve({ capabilities: [RPC_CAPABILITY] })
    }
    if (method.startsWith(`plugin.${PLUGIN_ID}.`)) {
      if (this.rpc === 'unavailable') return Promise.reject(rpcError(-32601, 'method not found'))
      return Promise.resolve({ ok: false, error: { code: 'llm_unavailable', message: 'no AI in the whole-plugin world' } })
    }
    this.missing.push(`RPC ${method}`)
    return Promise.reject(rpcError(-32601, `no handler for ${method}`))
  }

  /** Connects this world to the SDK mock (`ctx.rest` and `host.request`). */
  install(): this {
    sdkMock.restHandler = (path, opts) => this.handle(path, opts)
    sdkMock.requestHandler = (method) => this.request(method)
    return this
  }

  /** Routes the world answers (contract keys). */
  routeKeys(): string[] {
    return Object.keys(this.table)
  }
}

function toError(thrown: unknown): ApiErrorLike {
  const e = thrown as Partial<ApiErrorLike> | null
  if (e && typeof e === 'object' && typeof e.code === 'string') return { code: e.code, message: String(e.message ?? e.code) }
  return { code: 'internal', message: thrown instanceof Error ? thrown.message : String(thrown) }
}
