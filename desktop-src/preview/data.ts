// Preview sample data. Channels, folders and the theme tab come from plugin/data/demo_channels.json;
// videos (id, title, date and views) from the real RSS feeds in tests/fixtures/youtube/rss (Fireship,
// Veritasium) and from public RSS feeds (Kurzgesagt, Adam Neely); HN classics from the
// tests/fixtures/hackertube fixture. Thumbnails: i.ytimg.com by real id.
// Avatars: each channel's real thumb from demo_channels.json (yt3.googleusercontent.com).
// Illustrative (not from the sources): durations (except KfODG5REyss, 3955 s from the watch fixture), states
// (watched/later/progress), new counts, AI suggestions and cleanup reasons.
import demo from '../../plugin/data/demo_channels.json'
import type { Channel, FeedItem, Folder, Tag, Video } from '../../shared/api-types'

/** Real channel avatars (yt3.googleusercontent.com), from demo_channels.json. */
const AVATAR: Record<string, string> = Object.fromEntries(
  (demo.channels as Array<{ id: string; thumb?: string | null }>).filter((c) => c.thumb).map((c) => [c.id, c.thumb as string])
)

/** Fixed preview clock (reproducible screenshots). */
export const NOW = Date.UTC(2026, 10, 9, 15, 0, 0)
const day = 86400
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)

export const FOLDERS: Folder[] = [
  { id: 'tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'science', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'cooking', name: 'Culinária', parent_id: null, color: null, sort: 2 },
  { id: 'music', name: 'Música', parent_id: null, color: null, sort: 3 },
  { id: 'news', name: 'Notícias', parent_id: null, color: null, sort: 4 },
  { id: 'games', name: 'Games', parent_id: null, color: null, sort: 5 }
]

export const TAGS: Tag[] = [
  { id: 'ai', name: 'ia', color: null },
  { id: 'deep', name: 'aprofundado', color: null },
  { id: 'weekly', name: 'semanal', color: null },
  { id: 'pt', name: 'pt-br', color: null }
]

type Seed = [id: string, title: string, handle: string, folder: string, favorite?: boolean]

const SEEDS: Seed[] = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship', '@Fireship', 'tech', true],
  ['UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', '@mkbhd', 'tech'],
  ['UCXuqSBlHAE6Xw-yeJA0Tunw', 'Linus Tech Tips', '@LinusTechTips', 'tech'],
  ['UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers', '@TwoMinutePapers', 'tech'],
  ['UC9-y-6csu5WGm29I7JiwpnA', 'Computerphile', '@Computerphile', 'tech'],
  ['UCXUPKJO5MZQN11PqgIvyuvQ', 'Andrej Karpathy', '@AndrejKarpathy', 'tech'],
  ['UCddiUEpeqJcYeBxX1IVBKvQ', 'The Verge', '@TheVerge', 'tech'],
  ['UC8ENHE5xdFSwx71u3fDH5Xw', 'ThePrimeagen', '@ThePrimeagen', 'tech'],
  ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium', 'science', true],
  ['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', '@kurzgesagt', 'science'],
  ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown', '@3blue1brown', 'science'],
  ['UC6107grRI4m0o2-emgoDnAA', 'SmarterEveryDay', '@smartereveryday', 'science'],
  ['UCEIwxahdLz7bap-VDs9h35A', 'Steve Mould', '@SteveMould', 'science'],
  ['UCn9Erjy00mpnWeLnRqhsA1g', 'Ciência Todo Dia', '@CienciaTodoDia', 'science'],
  ['UCqqJQ_cXSat0KIAVfIfKkVA', 'J. Kenji López-Alt', '@JKenjiLopezAlt', 'cooking', true],
  ['UChBEbMKI1eCcejTtmI32UEw', 'Joshua Weissman', '@JoshuaWeissman', 'cooking'],
  ['UCJquYOG5EL82sKTfH9aMA9Q', 'Rick Beato', '@RickBeato', 'music', true],
  ['UCnkp4xDOwqqJD7sSM3xdUiQ', 'Adam Neely', '@AdamNeely', 'music'],
  ['UC3I2GFN_F8WudD_2jUZbojA', 'KEXP', '@kexp', 'music'],
  ['UCmGSJVG3mCRXVOP4yZrU1Dw', 'Johnny Harris', '@johnnyharris', 'news', true],
  ['UCLXo7UDZvByw2ixzpQCufnA', 'Vox', '@Vox', 'news'],
  ['UCknLrEdhRCp1aegoMqRaCZg', 'DW News', '@dwnews', 'news'],
  ['UCqJ-Xo29CKyLTjn6z2XwYAw', "Game Maker's Toolkit", '@GMTK', 'games', true],
  ['UC9PBzalIcEQCsiIkq36PyUA', 'Digital Foundry', '@DigitalFoundry', 'games'],
  ['UCtUbO6rBht0daVIOGML3c8w', 'Summoning Salt', '@SummoningSalt', 'games']
]

const TAGS_BY_CHANNEL: Record<string, string[]> = {
  UCsBjURrPoezykLs9EqgamOA: ['ai', 'weekly'],
  UCXUPKJO5MZQN11PqgIvyuvQ: ['ai', 'deep'],
  'UCbfYPyITQ-7l4upoX8nvctg': ['ai'],
  UCYO_jab_esuFRV4b17AJtAw: ['deep'],
  UCn9Erjy00mpnWeLnRqhsA1g: ['pt'],
  'UCHnyfMqiRRG1u-2MsSQLbXA': ['deep']
}

export const CHANNELS: Channel[] = SEEDS.map(([id, title, handle, folder, favorite], i) => ({
  id,
  title,
  relation: 'subscribed',
  source: 'demo',
  added_at: at('2025-03-01T00:00:00Z') + i * day,
  handle,
  thumb: AVATAR[id] ?? null,
  url: `https://www.youtube.com/${handle}`,
  folder_id: folder,
  favorite: !!favorite,
  muted: false,
  unsubscribed_at: null,
  last_video_at: Math.floor(NOW / 1000) - ((i * 7) % 40) * day - 3600 * (i % 9),
  videos_per_week: 1 + (i % 5),
  shorts_ratio: (i % 4) / 10,
  ai_note: null,
  tag_ids: TAGS_BY_CHANNEL[id] ?? []
}))

export const channelById = (id: string): Channel => CHANNELS.find((c) => c.id === id) ?? CHANNELS[0]
/** Avatar (title + real photo) of a channel by id. */
export const avatarOf = (id: string): { title: string; thumb: string | null } => {
  const c = channelById(id)
  return { title: c.title, thumb: c.thumb }
}
export const folderById = (id: string | null): Folder | null => FOLDERS.find((f) => f.id === id) ?? null
export const tagsOf = (c: Channel): Tag[] => TAGS.filter((t) => c.tag_ids.includes(t.id))

type V = [id: string, channel: string, title: string, published: string, views: number, durationS: number, short?: boolean]

const VIDEOS: V[] = [
  ['iw9SZgyahqg', 'UCsBjURrPoezykLs9EqgamOA', 'The one thing holding theoretical CS together just broke... kinda', '2026-11-06T17:00:00Z', 1905521, 312],
  ['KfODG5REyss', 'UCHnyfMqiRRG1u-2MsSQLbXA', "I finally saw quantum mechanics with my own eyes... (It's spookier than I expected)", '2026-11-04T15:00:00Z', 14564759, 3955],
  ['k2ruCf_z75I', 'UCsBjURrPoezykLs9EqgamOA', 'The worst week in cybersecurity history... so far', '2026-11-03T18:30:00Z', 2095834, 287],
  ['kIMIlLx4DIc', 'UCnkp4xDOwqqJD7sSM3xdUiQ', 'Music is Inherently Political', '2026-11-02T16:00:00Z', 661306, 1848],
  ['5_Fayfx2NUM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'How I Survived Late-Stage Cancer (A Fun Story)', '2026-10-27T14:00:00Z', 8267833, 1034],
  ['nEaJMdM1djM', 'UCsBjURrPoezykLs9EqgamOA', 'Did the AI bubble just pop?', '2026-10-28T19:00:00Z', 2677564, 296],
  ['eyZEqSPeMwg', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'No device could prove Einstein wrong... until now', '2026-10-23T15:00:00Z', 7987009, 1612],
  ['PXbVn-f_wuM', 'UCsXVk37bltHxD1rDPwtNM8Q', 'You Will Only Like Half of This Video', '2026-10-20T14:00:00Z', 5792024, 726],
  ['G_em1hHPnXY', 'UCsBjURrPoezykLs9EqgamOA', 'China just dropped a new frontier model... and nobody can explain how', '2026-10-26T17:00:00Z', 2474229, 304],
  ['NiCgcUTL9_Q', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Fiber Optics are so much cooler than I thought', '2026-10-12T15:00:00Z', 15710623, 1922],
  ['ujkD4SxPKOI', 'UCsXVk37bltHxD1rDPwtNM8Q', 'AI Just Crossed the Terrifying Line - Now What?', '2026-10-05T14:00:00Z', 23852199, 912],
  ['EfeGc02nzC4', 'UCnkp4xDOwqqJD7sSM3xdUiQ', 'They Teach AI Music at Music School Now...', '2026-05-28T16:00:00Z', 464995, 1530],
  ['rL0qEmTRI-I', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Why do deserts get cold at night?', '2026-11-06T20:00:00Z', 1563718, 58, true],
  ['l3L_lETiSzc', 'UCsBjURrPoezykLs9EqgamOA', 'The runtime wars are over... and Node won', '2026-10-15T17:00:00Z', 1221305, 341],
  ['_y9JuojAIg0', 'UCsXVk37bltHxD1rDPwtNM8Q', 'We Finally Know More About Humanity’s First Civilization', '2026-10-08T14:00:00Z', 12061826, 1105],
  ['zv6B6PQOuHE', 'UCsBjURrPoezykLs9EqgamOA', 'The last real programmers are dying out...', '2026-10-22T17:00:00Z', 1763569, 318]
]

const WHY_FOLDER: Record<string, string> = Object.fromEntries(FOLDERS.map((f) => [f.id, f.name]))

function toVideo([id, channel, title, published, views, durationS, short]: V): Video {
  const ch = channelById(channel)
  return {
    id,
    channel_id: channel,
    title,
    published_at: at(published),
    description: null,
    channel_title: ch.title,
    duration_s: durationS,
    is_short: !!short,
    views,
    first_seen_at: at(published) + 600,
    origin: 'rss'
  }
}

export const FEED: FeedItem[] = VIDEOS.map((v, i) => {
  const video = toVideo(v)
  const channel = channelById(video.channel_id)
  const isNew = video.published_at != null && video.published_at > Math.floor(NOW / 1000) - 8 * day
  return {
    video,
    channel,
    state: i === 5 || i === 9 ? 'watched' : i === 7 ? 'later' : isNew ? 'new' : 'seen',
    reaction: null,
    is_new: isNew && i !== 5,
    why:
      i % 5 === 3
        ? { via: 'tag', label: 'ia', detail: null }
        : channel.favorite && i % 3 === 0
          ? { via: 'channel', label: channel.title, detail: 'favorito' }
          : { via: 'folder', label: WHY_FOLDER[channel.folder_id ?? ''] ?? '', detail: null },
    badges: []
  }
})

/** Illustrative watch progress per video. */
export const PROGRESS: Record<string, number> = { nEaJMdM1djM: 1, NiCgcUTL9_Q: 0.92, eyZEqSPeMwg: 0.35, 'PXbVn-f_wuM': 0.6 }

export const FEATURED: FeedItem = {
  ...FEED[1],
  video: {
    ...FEED[1].video,
    description:
      'Veritasium sets up a real double-slit experiment with single photons and watches the interference pattern build up, one click at a time.'
  },
  why: { via: 'channel', label: 'Veritasium', detail: 'canal favorito' }
}

type HN = [id: string, channel: string, title: string, why: string]

/** HN classics (hackertube fixture) for the theme tab "Inteligência artificial". */
const HN_CLASSICS: HN[] = [
  ['VMj-3S1tku0', 'Andrej Karpathy', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 'HN: melhor ponto de partida para backprop'],
  ['aircAruvnKk', '3Blue1Brown', 'But what is a neural network? | Deep learning chapter 1', 'HN: primeira parada para redes neurais'],
  ['wjZofJX0v4M', '3Blue1Brown', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 'HN: introdução visual a transformers'],
  ['7xTGNNLPyMI', 'Andrej Karpathy', 'Deep Dive into LLMs like ChatGPT', 'HN: base clara de como LLMs funcionam'],
  ['7Pq-S557XQU', 'CGP Grey', 'What Happened to Horses Is Happening to Us', 'HN: o explicador clássico de automação'],
  ['spUNpyF58BY', '3Blue1Brown', 'But what is the Fourier Transform?  A visual introduction.', 'HN: recomendação padrão para Fourier']
]

export const THEME_FEED: FeedItem[] = HN_CLASSICS.map(([id, channelTitle, title, why], i) => ({
  video: {
    id,
    channel_id: '',
    title,
    published_at: Math.floor(NOW / 1000) - (400 + i * 170) * day,
    description: null,
    channel_title: channelTitle,
    duration_s: [8822, 1150, 1648, 12614, 916, 1235][i],
    is_short: false,
    views: null,
    first_seen_at: Math.floor(NOW / 1000),
    origin: 'hn'
  },
  channel: CHANNELS.find((c) => c.title === channelTitle) ?? null,
  state: 'new',
  reaction: null,
  is_new: false,
  why: { via: i % 2 ? 'hn' : 'theme', label: i % 2 ? why : 'Agentes de IA', detail: i % 2 ? null : 'citado 3× nas buscas' },
  badges: i % 2 ? ['hn'] : []
}))

export const TABS = [
  { id: 'all', label: 'Tudo', count: 38 },
  { id: 'tech', label: 'Tecnologia', count: 12, icon: 'folder' },
  { id: 'science', label: 'Ciência', count: 9, icon: 'folder' },
  { id: 'cooking', label: 'Culinária', count: 4, icon: 'folder' },
  { id: 'music', label: 'Música', count: 6, icon: 'folder' },
  { id: 'news', label: 'Notícias', count: 5, icon: 'folder' },
  { id: 'games', label: 'Games', count: 2, icon: 'folder' },
  { id: 'ai', label: 'Inteligência artificial', count: 7, icon: 'sparkle' },
  { id: 'later', label: 'Ver depois', count: 0, icon: 'clock' }
]

/** New per channel (illustrative). */
export const NEW_BY_CHANNEL: Record<string, number> = {
  UCsBjURrPoezykLs9EqgamOA: 4,
  'UCHnyfMqiRRG1u-2MsSQLbXA': 3,
  UCsXVk37bltHxD1rDPwtNM8Q: 2,
  UCnkp4xDOwqqJD7sSM3xdUiQ: 1,
  UCXUPKJO5MZQN11PqgIvyuvQ: 1,
  UCmGSJVG3mCRXVOP4yZrU1Dw: 2,
  'UCqJ-Xo29CKyLTjn6z2XwYAw': 1
}

/** Last known video per channel (from the real RSS feeds). */
export const LAST_VIDEO: Record<string, { title: string; at: number }> = Object.fromEntries(
  VIDEOS.slice()
    .sort((a, b) => Date.parse(b[3]) - Date.parse(a[3]))
    .map((v) => [v[1], { title: v[2], at: at(v[3]) }])
    .reverse()
)

/** Cleanup: candidates per group (illustrative reasons, in the tone of the cleanup_reasons prompt). */
export const CLEANUP = {
  stale: [
    { channel: 'UCddiUEpeqJcYeBxX1IVBKvQ', reason: 'Sem vídeo novo assistido há 7 meses' },
    { channel: 'UCtUbO6rBht0daVIOGML3c8w', reason: 'Publica raramente e você não abriu os últimos 4' }
  ],
  ignored: [
    { channel: 'UCXuqSBlHAE6Xw-yeJA0Tunw', reason: 'Você arquivou 23 vídeos seguidos sem assistir' },
    { channel: 'UCknLrEdhRCp1aegoMqRaCZg', reason: 'Nenhum vídeo assistido em 90 dias (52 publicados)' },
    { channel: 'UCLXo7UDZvByw2ixzpQCufnA', reason: 'Só Shorts nos últimos 2 meses; você não assiste Shorts' }
  ],
  off_profile: [{ channel: 'UC9PBzalIcEQCsiIkq36PyUA', reason: 'Fora dos temas que você mais assiste (Ciência, IA)' }]
}

/** Organize with Hermes: suggestions per folder (illustrative). */
export const ORGANIZE = [
  {
    folder: 'Inteligência artificial',
    newFolder: true,
    rows: [
      { channel: 'UCbfYPyITQ-7l4upoX8nvctg', reason: 'Resumos semanais de artigos de IA', confidence: 0.94 },
      { channel: 'UCXUPKJO5MZQN11PqgIvyuvQ', reason: 'Aulas longas sobre redes neurais e LLMs', confidence: 0.97 }
    ]
  },
  {
    folder: 'Ciência',
    newFolder: false,
    rows: [{ channel: 'UCEIwxahdLz7bap-VDs9h35A', reason: 'Experimentos de física explicados', confidence: 0.88 }]
  }
]
