// Preview scenarios of the tab editor (the collector's interface): each scenario mounts the REAL dialog over a fake `ctx`
// that answers from the `rest` map. The preview (`POST /feed/preview`) is a fake engine with the same rule as the
// server (recursive folders + tags + channels − excluded → Shorts, only new, duration, mode, N per channel),
// so each combination gives what it would for real. Only the preview imports this file (outside the bundle).
// Data: ids, titles and views of real videos (the same as the Subscriptions preview) and demo channels
// (plugin/data/demo_channels.json); states, durations and reasons are illustrative.
import type { ReactNode } from 'react'
import type { Channel, FeedItem, FeedPage, Folder, Tab, TabRules, Tag } from '../../../shared/api-types'
import type { Scenario, ScenarioRequest } from '../../components'
import { TabEditorDialog, type TabEditorDialogProps } from './index'

const WIDTHS = [420, 900, 1440]
const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600
const D = 86400

/**
 * PREVIEW ONLY (same adapter as the topic tab dialog): the `Input` stand-in in the preview SDK has no frame, and the field would show in the
 * screenshots as loose text. In Desktop the SDK's `Input` has the `desktop-input-chrome` frame; here it is reproduced
 * with the same app variables. Not in the bundle.
 */
const INPUT_CHROME = [
  '[data-slot="input"]{box-sizing:border-box;width:100%;min-width:0;height:30px;padding:6px 10px;border:1px solid ',
  'color-mix(in srgb,var(--dt-composer-ring,var(--ui-stroke-secondary)) var(--dt-input-border,100%),transparent);',
  'border-radius:2.5px;background:color-mix(in srgb,var(--dt-card,var(--ui-bg-quinary)) var(--dt-input-bg,100%),transparent);',
  'box-shadow:var(--dt-input-inset,none);font-size:12px;line-height:16px;color:var(--ui-text-primary);outline:none}',
  '[data-slot="input"]::placeholder{color:var(--ui-text-tertiary)}',
  '[data-slot="input"]:focus{border-color:var(--dt-composer-ring,var(--ui-stroke-primary))}',
  '[data-slot="input"]:disabled{opacity:.5}',
  '[data-slot="input"][type="search"]{padding-left:28px}'
].join('')

const withChrome = (node: ReactNode) => (
  <>
    <style>{INPUT_CHROME}</style>
    {node}
  </>
)

// ------------------------------------------------------------------ taxonomy

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'IA', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_science', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 2 }
]

const TAGS: Tag[] = [
  { id: 't_ia', name: 'ia', color: null },
  { id: 't_deep', name: 'aprofundado', color: null },
  { id: 't_weekend', name: 'fim de semana', color: null }
]

// ------------------------------------------------------------------ channels (demo)

const YT3 = 'https://yt3.googleusercontent.com/'
const AVATAR = '=s176-c-k-c0x00ffffff-no-rj'

type Seed = [id: string, title: string, handle: string, folder: string, tags: string[], favorite: boolean, thumb: string]

const SEEDS: Seed[] = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship', '@Fireship', 'f_tech', ['t_ia'], true, `${YT3}3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y${AVATAR}`],
  ['UCXUPKJO5MZQN11PqgIvyuvQ', 'Andrej Karpathy', '@AndrejKarpathy', 'f_ai', ['t_ia', 't_deep'], false, `${YT3}ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz${AVATAR}`],
  ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium', 'f_science', ['t_weekend'], true, `${YT3}7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA${AVATAR}`],
  ['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', '@kurzgesagt', 'f_science', ['t_weekend'], false, `${YT3}ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4${AVATAR}`],
  ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown', '@3blue1brown', 'f_science', ['t_deep'], false, `${YT3}ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU${AVATAR}`],
  ['UCnkp4xDOwqqJD7sSM3xdUiQ', 'Adam Neely', '@AdamNeely', 'f_music', [], false, `${YT3}584RoBu_Mr3Ocp2I-GAomClNWH6ZeuVWeDpFAhFqziYIyTjMEoHHWzmyg8XtIN8v73eJa-19kTA${AVATAR}`],
  ['UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', '@mkbhd', 'f_tech', [], false, `${YT3}qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ${AVATAR}`],
  ['UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers', '@TwoMinutePapers', 'f_ai', ['t_ia'], false, `${YT3}ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ${AVATAR}`]
]

const CHANNELS: Channel[] = SEEDS.map(([id, title, handle, folder, tags, favorite, thumb], i) => ({
  id,
  title,
  relation: 'subscribed',
  source: 'extension',
  added_at: NOW_S - 400 * D + i * D,
  handle,
  thumb,
  url: `https://www.youtube.com/${handle}`,
  folder_id: folder,
  favorite,
  muted: false,
  unsubscribed_at: null,
  last_video_at: NOW_S - (i + 1) * 5 * H,
  videos_per_week: 1 + (i % 3),
  shorts_ratio: 0.1,
  ai_note: null,
  tag_ids: tags
}))

const BY_ID = new Map(CHANNELS.map((c) => [c.id, c]))
const FOLDER_NAME = new Map(FOLDERS.map((f) => [f.id, f.name]))

// ------------------------------------------------------------------ videos

type V = [id: string, channel: string, title: string, ageH: number, views: number, durationS: number, isNew?: boolean, isShort?: boolean]

const VIDEOS: V[] = [
  ['KfODG5REyss', 'UCHnyfMqiRRG1u-2MsSQLbXA', "I finally saw quantum mechanics with my own eyes... (It's spookier than I expected)", 20, 14564759, 3955, true],
  ['iw9SZgyahqg', 'UCsBjURrPoezykLs9EqgamOA', 'The one thing holding theoretical CS together just broke... kinda', 6, 1905521, 312, true],
  ['k2ruCf_z75I', 'UCsBjURrPoezykLs9EqgamOA', 'The worst week in cybersecurity history... so far', 30, 2095834, 287, true],
  ['kIMIlLx4DIc', 'UCnkp4xDOwqqJD7sSM3xdUiQ', 'Music is Inherently Political', 52, 661306, 1848, true],
  ['rL0qEmTRI-I', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Why do deserts get cold at night?', 60, 1563718, 58, true, true],
  ['5_Fayfx2NUM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'How I Survived Late-Stage Cancer (A Fun Story)', 75, 8267833, 1034, true],
  ['nEaJMdM1djM', 'UCsBjURrPoezykLs9EqgamOA', 'Did the AI bubble just pop?', 90, 2677564, 296, false],
  ['VMj-3S1tku0', 'UCXUPKJO5MZQN11PqgIvyuvQ', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 110, 9100000, 8822, false],
  ['eyZEqSPeMwg', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'No device could prove Einstein wrong... until now', 130, 7987009, 1612, false],
  ['PXbVn-f_wuM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'You Will Only Like Half of This Video', 150, 5792024, 726, true],
  ['aircAruvnKk', 'UCYO_jab_esuFRV4b17AJtAw', 'But what is a neural network? | Deep learning chapter 1', 170, 21000000, 1150, false],
  ['G_em1hHPnXY', 'UCsBjURrPoezykLs9EqgamOA', 'China just dropped a new frontier model... and nobody can explain how', 190, 2474229, 304, true],
  ['NiCgcUTL9_Q', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Fiber Optics are so much cooler than I thought', 220, 15710623, 1922, false],
  ['ujkD4SxPKOI', 'UCsXVk37bltHxD1rDPwtNM8Q', 'AI Just Crossed the Terrifying Line - Now What?', 260, 23852199, 912, true],
  ['7xTGNNLPyMI', 'UCXUPKJO5MZQN11PqgIvyuvQ', 'Deep Dive into LLMs like ChatGPT', 300, 4100000, 12614, true],
  ['wjZofJX0v4M', 'UCYO_jab_esuFRV4b17AJtAw', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 340, 7900000, 1648, true]
]

// ------------------------------------------------------------------ fake engine (the same rule as the server)

function descendants(id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of FOLDERS) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
      out.add(f.id)
      grew = true
    }
  }
  return out
}

function previewFor(req: ScenarioRequest): FeedPage {
  const body = req.body as { rules: TabRules; limit?: number }
  const r = body.rules
  const folders = new Set<string>()
  for (const f of r.include.folders) for (const x of descendants(f)) folders.add(x)
  const why = new Map<string, FeedItem['why']>()
  for (const c of CHANNELS) {
    if (r.exclude.channels.includes(c.id)) continue
    if (r.include.channels.includes(c.id)) why.set(c.id, { via: 'channel', label: c.title, detail: null })
    else if (c.folder_id && folders.has(c.folder_id)) why.set(c.id, { via: 'folder', label: FOLDER_NAME.get(c.folder_id) ?? '', detail: null })
    else {
      const tag = c.tag_ids.find((t) => r.include.tags.includes(t))
      if (tag) why.set(c.id, { via: 'tag', label: TAGS.find((x) => x.id === tag)?.name ?? '', detail: null })
      else if (r.include.all || (r.include.favorites && c.favorite)) why.set(c.id, null)
    }
  }
  let list = VIDEOS.filter((v) => why.has(v[1]))
  if (r.exclude.shorts) list = list.filter((v) => !v[7])
  if (r.filters.only_new) list = list.filter((v) => v[6])
  if (r.filters.min_s != null) list = list.filter((v) => v[5] >= (r.filters.min_s ?? 0))
  if (r.filters.max_s != null) list = list.filter((v) => v[5] <= (r.filters.max_s ?? 0))
  if (r.mode === 'fresh') list = list.filter((v) => v[3] <= 30 * 24)
  if (r.mode === 'long') list = list.filter((v) => v[5] >= 1200)
  list = r.mode === 'classics' ? [...list].sort((a, b) => b[4] - a[4]) : [...list].sort((a, b) => a[3] - b[3])
  if (r.filters.per_channel != null) {
    const seen = new Map<string, number>()
    list = list.filter((v) => {
      const n = (seen.get(v[1]) ?? 0) + 1
      seen.set(v[1], n)
      return n <= (r.filters.per_channel ?? n)
    })
  }
  const items: FeedItem[] = list.map(([id, ch, title, ageH, views, durationS, isNew, isShort]) => {
    const channel = BY_ID.get(ch) ?? null
    return {
      video: {
        id,
        channel_id: ch,
        title,
        published_at: NOW_S - ageH * H,
        description: null,
        channel_title: channel?.title ?? null,
        duration_s: durationS,
        is_short: !!isShort,
        views,
        first_seen_at: NOW_S - ageH * H,
        origin: 'rss'
      },
      channel,
      state: isNew ? 'new' : 'seen',
      reaction: null,
      is_new: !!isNew,
      why: why.get(ch) ?? null,
      badges: []
    }
  })
  return { items: items.slice(0, body.limit ?? 30), next_cursor: null, counts: { total: items.length, new: items.filter((i) => i.is_new).length } }
}

// ------------------------------------------------------------------ tabs

const EMPTY_RULES: TabRules = {
  include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false },
  exclude: { folders: [], tags: [], channels: [], shorts: false },
  filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
  mode: 'fresh'
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'Tudo novo', kind: 'category', icon: '▶', rules: { ...EMPTY_RULES, include: { ...EMPTY_RULES.include, all: true }, filters: { ...EMPTY_RULES.filters, only_new: true } }, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favoritos', kind: 'category', icon: '⭐', rules: { ...EMPTY_RULES, include: { ...EMPTY_RULES.include, favorites: true } }, filters: {}, sort: 1, builtin: true },
  { id: 'tab_science', name: 'Ciência', kind: 'category', icon: '🔭', rules: { ...EMPTY_RULES, include: { ...EMPTY_RULES.include, folders: ['f_science'] }, exclude: { ...EMPTY_RULES.exclude, shorts: true } }, filters: {}, sort: 2, builtin: false }
]

const REST: Scenario['rest'] = {
  'GET /tabs': { items: TABS },
  'GET /folders': { items: FOLDERS },
  'GET /tags': { items: TAGS },
  'GET /channels': (req: ScenarioRequest) => {
    const ids = req.query.ids ? req.query.ids.split(',') : null
    const items = (ids ? CHANNELS.filter((c) => ids.includes(c.id)) : CHANNELS).map((channel) => ({ channel, new_count: 0, watched_90d: null }))
    return { items, total: items.length }
  },
  'POST /feed/preview': previewFor,
  'POST /tabs': (req: ScenarioRequest) => ({ ...TABS[2], ...(req.body as object), id: 'tab_new', builtin: false }),
  'PATCH /tabs/{id}': (req: ScenarioRequest) => ({ ...(TABS.find((t) => t.id === req.params.id) ?? TABS[2]), ...(req.body as object) }),
  'DELETE /tabs/{id}': (req: ScenarioRequest) => ({ id: req.params.id })
}

const close = () => undefined
const dialog = (props: Omit<TabEditorDialogProps, 'onClose'>) => () => withChrome(<TabEditorDialog onClose={close} {...props} />)

const FIRESHIP = 'UCsBjURrPoezykLs9EqgamOA'
const KARPATHY = 'UCXUPKJO5MZQN11PqgIvyuvQ'
const MKBHD = 'UCBJycsmduvYEL83R_U4JriQ'

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'tab-editor-new-folder',
    title: 'Tab editor · new by folder (full preview)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ preset: { kind: 'category', name: 'Ciência', rules: { include: { folders: ['f_science'] } } } })
  },
  {
    id: 'tab-editor-new-channels',
    title: 'Tab editor · new by channels (search open, two picked)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ preset: { kind: 'channels' }, initial: { draft: { channels: [FIRESHIP, KARPATHY] } } })
  },
  {
    id: 'tab-editor-mixed-filters',
    title: 'Tab editor · mixed with filters on (chips above the preview)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({
      preset: { kind: 'mixed' },
      initial: { draft: { folders: ['f_tech'], tags: ['t_deep'], excludeChannels: [MKBHD], noShorts: true, perChannel: 2, minS: 600, mode: 'classics' } }
    })
  },
  {
    id: 'tab-editor-edit-unsaved',
    title: 'Tab editor · editing with an unsaved change',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ tabId: 'tab_science', initial: { draft: { name: 'Ciência e IA', nameTouched: true, folders: ['f_science', 'f_ai'], onlyNew: true } } })
  },
  {
    id: 'tab-editor-preview-empty',
    title: 'Tab editor · empty preview explained ("remove X")',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ preset: { kind: 'category', rules: { include: { folders: ['f_music'] }, filters: { min_s: 3600 } } } })
  },
  {
    id: 'tab-editor-save-error',
    title: 'Tab editor · save error in the footer (choices kept)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({
      preset: { kind: 'category', rules: { include: { folders: ['f_tech'] } } },
      initial: { draft: { icon: '💻' }, saveError: { code: 'invalid', message: 'unknown folders: f_old' } }
    })
  },
  {
    id: 'tab-editor-builtin',
    title: 'Tab editor · built-in tab (filters only)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ tabId: 'all-new' })
  },
  {
    id: 'tab-editor-delete',
    title: 'Tab editor · delete with confirmation in the footer',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ tabId: 'tab_science', initial: { confirm: 'delete' } })
  },
  {
    id: 'tab-editor-need-source',
    title: 'Tab editor · no source (explains and disables save)',
    widths: WIDTHS,
    rest: REST,
    render: dialog({ preset: { kind: 'category' } })
  },
  {
    id: 'tab-editor-narrow',
    title: 'Tab editor · narrow (stacked panels)',
    widths: [420],
    rest: REST,
    render: dialog({
      preset: { kind: 'mixed' },
      initial: { draft: { folders: ['f_science'], channels: [FIRESHIP], noShorts: true, onlyNew: true } }
    })
  }
]
