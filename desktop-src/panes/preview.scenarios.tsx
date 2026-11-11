// Preview scenarios for the side panel (fixed interface shared with the preview collector): each scenario mounts the
// REAL panel (PaneView) over a fake `ctx` that answers from the `rest` map (key = contract route, value = envelope
// `data` or a function; throwing `{code, message}` simulates an error). Only the preview imports this file.
// Data: the 40 public demo channels (plugin/data/demo_channels.json: ids, titles, @handles, photos), in the 6 demo
// folders + an "IA" subfolder inside Tecnologia. New counts: illustrative.
import type { ReactNode } from 'react'
import type { Channel, ChannelRow, Folder, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { PaneView } from './index'

export type Scenario = {
  id: string
  title: string
  widths?: number[]
  rest?: Record<string, unknown | ((req: { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown)>
  rpc?: Record<string, unknown | ((params: unknown) => unknown)>
  render: () => ReactNode
}

const WIDTHS = [260, 420]
const NOW_S = Math.floor(Date.now() / 1000)
const D = 86400

// ------------------------------------------------------------------ folders and channels (demo)

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'IA', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_science', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'f_cooking', name: 'Culinária', parent_id: null, color: null, sort: 2 },
  { id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 3 },
  { id: 'f_news', name: 'Notícias', parent_id: null, color: null, sort: 4 },
  { id: 'f_games', name: 'Games', parent_id: null, color: null, sort: 5 }
]

type Seed = [id: string, title: string, handle: string, folder: string, favorite: boolean, thumb: string]

const SEEDS: Seed[] = [
  ["UCsBjURrPoezykLs9EqgamOA", "Fireship", "@Fireship", "f_tech", true, "https://yt3.googleusercontent.com/3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s176-c-k-c0x00ffffff-no-rj"],
  ["UCBJycsmduvYEL83R_U4JriQ", "Marques Brownlee", "@mkbhd", "f_tech", false, "https://yt3.googleusercontent.com/qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj"],
  ["UCXuqSBlHAE6Xw-yeJA0Tunw", "Linus Tech Tips", "@LinusTechTips", "f_tech", false, "https://yt3.googleusercontent.com/gnvYLhXy8FAlPXZ2RTrkrgj-5kyt0vdE2FUGVOiKGdEZIa-wN5A-7nwZBlWJLzUMmoh1NWAU=s176-c-k-c0x00ffffff-no-rj"],
  ["UCbfYPyITQ-7l4upoX8nvctg", "Two Minute Papers", "@TwoMinutePapers", "f_ai", false, "https://yt3.googleusercontent.com/ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ=s176-c-k-c0x00ffffff-no-rj"],
  ["UC9-y-6csu5WGm29I7JiwpnA", "Computerphile", "@Computerphile", "f_ai", false, "https://yt3.googleusercontent.com/ebHMyRfch3u2UTZN1WQJDp9J5U7o38T_WnGkd2QhAIQwBgvozdaOCOnfDMtngtoHWutJvLl4i0c=s176-c-k-c0x00ffffff-no-rj"],
  ["UCXUPKJO5MZQN11PqgIvyuvQ", "Andrej Karpathy", "@AndrejKarpathy", "f_ai", false, "https://yt3.googleusercontent.com/ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz=s176-c-k-c0x00ffffff-no-rj"],
  ["UCddiUEpeqJcYeBxX1IVBKvQ", "The Verge", "@TheVerge", "f_tech", false, "https://yt3.googleusercontent.com/ZIj_dq7beCkAkhufNqCid_SjWW4mkv4tqIDtv7_AAKzWdhBWI-rpsRXYXB9X3mB0s0zNzNtYdQ=s176-c-k-c0x00ffffff-no-rj"],
  ["UC8ENHE5xdFSwx71u3fDH5Xw", "ThePrimeagen", "@ThePrimeagen", "f_tech", false, "https://yt3.googleusercontent.com/ytc/AIdro_laY82JAzs_2edBDxrxLgLWshhMK04SpAqOfoEzexOBZg=s176-c-k-c0x00ffffff-no-rj"],
  ["UCHnyfMqiRRG1u-2MsSQLbXA", "Veritasium", "@veritasium", "f_science", true, "https://yt3.googleusercontent.com/7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCsXVk37bltHxD1rDPwtNM8Q", "Kurzgesagt – In a Nutshell", "@kurzgesagt", "f_science", false, "https://yt3.googleusercontent.com/ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s176-c-k-c0x00ffffff-no-rj"],
  ["UCYO_jab_esuFRV4b17AJtAw", "3Blue1Brown", "@3blue1brown", "f_science", false, "https://yt3.googleusercontent.com/ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s176-c-k-c0x00ffffff-no-rj"],
  ["UC6107grRI4m0o2-emgoDnAA", "SmarterEveryDay", "@smartereveryday", "f_science", false, "https://yt3.googleusercontent.com/ytc/AIdro_l59Ewmp0DHZBRWbY9dVqjd2_mWwvrn8ad0bJfmdbMRYcA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCEIwxahdLz7bap-VDs9h35A", "Steve Mould", "@SteveMould", "f_science", false, "https://yt3.googleusercontent.com/iX-akiHlJYuPDq4YVBO83cfjWW0aQefdewmI326XVhZkzxnS3MrqNVi49J33jLBw5LR_ZVyKFA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCY1kMZp36IQSyNx_9h4mpCg", "Mark Rober", "@MarkRober", "f_science", false, "https://yt3.googleusercontent.com/ytc/AIdro_ksXY2REjZ6gYKSgnWT5jC_zT9mX900vyFtVinR8KbHww=s176-c-k-c0x00ffffff-no-rj"],
  ["UCLA_DiR1FfKNvjuUpBHmylQ", "NASA", "@NASA", "f_science", false, "https://yt3.googleusercontent.com/eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s176-c-k-c0x00ffffff-no-rj"],
  ["UCn9Erjy00mpnWeLnRqhsA1g", "Ciência Todo Dia", "@CienciaTodoDia", "f_science", false, "https://yt3.googleusercontent.com/ytc/AIdro_lQoeh3pIl35H0tiDQ6fG3YeSrn2hWxKKCIxN11NQvnDdg=s176-c-k-c0x00ffffff-no-rj"],
  ["UCqqJQ_cXSat0KIAVfIfKkVA", "J. Kenji López-Alt", "@JKenjiLopezAlt", "f_cooking", true, "https://yt3.googleusercontent.com/tEql8Eq4IgP3UNx5v646k5U1QKidegUlZRvS18PyF2WM9YGt770IlxFVRrdDatLKHRCFuv9kfA=s176-c-k-c0x00ffffff-no-rj"],
  ["UChBEbMKI1eCcejTtmI32UEw", "Joshua Weissman", "@JoshuaWeissman", "f_cooking", false, "https://yt3.googleusercontent.com/ytc/AIdro_nfXRvoxu5cFt2H4WhJfFLbL5SVdzmvEnFymnPzH3_1qPM=s176-c-k-c0x00ffffff-no-rj"],
  ["UCJHA_jMfCvEnv-3kRjTCQXw", "Binging with Babish", "@bingingwithbabish", "f_cooking", false, "https://yt3.googleusercontent.com/AlCRk3X8JvmNqHC7R3c7yVDQaGyUvMAd3GXY77vTgzGS1Qa_vlVFY0ZNSH56otpeBKDq3gF-yw=s176-c-k-c0x00ffffff-no-rj"],
  ["UCDq5v10l4wkV5-ZBIJJFbzQ", "Ethan Chlebowski", "@EthanChlebowski", "f_cooking", false, "https://yt3.googleusercontent.com/ytc/AIdro_nASBGz3OXASRVham6ZgSHJrheFcXNKHtI86bw0QeA9ENc=s176-c-k-c0x00ffffff-no-rj"],
  ["UC9_p50tH3WmMslWRWKnM7dQ", "Adam Ragusea", "@aragusea", "f_cooking", false, "https://yt3.googleusercontent.com/ytc/AIdro_k1Qk7novhk1zSZqL-Ws8Xp3cFPPtvzdhroHp1DMMOO1Go=s176-c-k-c0x00ffffff-no-rj"],
  ["UCRIZtPl9nb9RiXc9btSTQNw", "Food Wishes", "@foodwishes", "f_cooking", false, "https://yt3.googleusercontent.com/ytc/AIdro_kGZ14S6frarUZ0q3zzhqTSnl3zkYo_qxwQ8Wi-J11MaA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCJquYOG5EL82sKTfH9aMA9Q", "Rick Beato", "@RickBeato", "f_music", true, "https://yt3.googleusercontent.com/ZfDOigTWKzMkwaokreALniSPfAzaAq4v2T9hawgoFmjX4mHULaVyCcySqKjmvcBqvoPyWX7gsg=s176-c-k-c0x00ffffff-no-rj"],
  ["UCnkp4xDOwqqJD7sSM3xdUiQ", "Adam Neely", "@AdamNeely", "f_music", false, "https://yt3.googleusercontent.com/584RoBu_Mr3Ocp2I-GAomClNWH6ZeuVWeDpFAhFqziYIyTjMEoHHWzmyg8XtIN8v73eJa-19kTA=s176-c-k-c0x00ffffff-no-rj"],
  ["UC4eYXhJI4-7wSWc8UNRwD4A", "NPR Music", "@nprmusic", "f_music", false, "https://yt3.googleusercontent.com/IXJZjJSYR9kfnUcHwIzAYjunIfovC2QYOOAseZxrDHBwvCKQEHBNcdC6PmNxn8EALE357U3vvhE=s176-c-k-c0x00ffffff-no-rj"],
  ["UC2Qw1dzXDBAZPwS7zm37g8g", "COLORS", "@COLORSxSTUDIOS", "f_music", false, "https://yt3.googleusercontent.com/ytc/AIdro_nFe5LeXpVm-ggGY9NH3JqYvVyU1NBcXHZ827U0JtoFa0M=s176-c-k-c0x00ffffff-no-rj"],
  ["UC3I2GFN_F8WudD_2jUZbojA", "KEXP", "@kexp", "f_music", false, "https://yt3.googleusercontent.com/cl8yKGTNMIspmtTvc0UJIiFzn3b0jH-eOlSBwd4ODVbXNkxUEZ-7JVlCZi2DRPw8qtIDv-jN2Gg=s176-c-k-c0x00ffffff-no-rj"],
  ["UC8R8FRt1KcPiR-rtAflXmeg", "Nahre Sol", "@NahreSol", "f_music", false, "https://yt3.googleusercontent.com/ytc/AIdro_n5wdFCiUb0EmwOd_HTqrATVMY0lbwhDwGU1_Tifi-zCyA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCmGSJVG3mCRXVOP4yZrU1Dw", "Johnny Harris", "@johnnyharris", "f_news", true, "https://yt3.googleusercontent.com/ytc/AIdro_kswBDn49WW5IneVE-5RlKyud5GvdzyQQ5SJQyVvJ4S3pk=s176-c-k-c0x00ffffff-no-rj"],
  ["UCLXo7UDZvByw2ixzpQCufnA", "Vox", "@Vox", "f_news", false, "https://yt3.googleusercontent.com/iak9xjDjDoQHn9UNWSvkobPuxAzK1ApefjPH7HGObwo71AbaiEqdafMjmUJCgOoBFWNKPS2t2eI=s176-c-k-c0x00ffffff-no-rj"],
  ["UC16niRr50-MSBwiO3YDb3RA", "BBC News", "@BBCNews", "f_news", false, "https://yt3.googleusercontent.com/v4JamQ9B-PUiJHjmZQs9UwTaoLQW8vijJMMpV5QvA2wHQ6iwWM8Q1s6O4jgTl0dtDigVWAi7SA=s176-c-k-c0x00ffffff-no-rj"],
  ["UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters", "@Reuters", "f_news", false, "https://yt3.googleusercontent.com/bCcVVrrV0EhGFJKsSvmeZHA9Y-YzSL9Keqrrr0HWYUPQy3-mVUVNHMbjwt7IoVkpsHt4E6BZ3pM=s176-c-k-c0x00ffffff-no-rj"],
  ["UCknLrEdhRCp1aegoMqRaCZg", "DW News", "@dwnews", "f_news", false, "https://yt3.googleusercontent.com/NSOdTQTWlqMy8O_j32dx-ftfTCHMOt04Hm7KZ4pfAK6-eQzQSZMWvvss90kG8KQfJ7iNP3phyA=s176-c-k-c0x00ffffff-no-rj"],
  ["UCNye-wNBqNL5ZzHSJj3l8Bg", "Al Jazeera English", "@aljazeeraenglish", "f_news", false, "https://yt3.googleusercontent.com/XsTga3Nsfc1E6ZgC6HfHfzTG_3zhuZleOnsKxSK2aILMjwkkIm-0vdALFaU-yt0Lw07iLtbSifk=s176-c-k-c0x00ffffff-no-rj"],
  ["UCqJ-Xo29CKyLTjn6z2XwYAw", "Game Maker's Toolkit", "@GMTK", "f_games", true, "https://yt3.googleusercontent.com/fZzS7tuwCW14i6tAAtGG6q8E1Y3-_k2G36mbn7VNKHOwtaJ4vKF8Es8Ky6745TiNGOAVSAyR6A=s176-c-k-c0x00ffffff-no-rj"],
  ["UC0fDG3byEcMtbOqPMymDNbw", "/noclip", "@NoclipDocs", "f_games", false, "https://yt3.googleusercontent.com/093arh9Jg1MqfdvcqcrDcUQm9QMdXnzWEJ-dpT_YUn5QU_8AQYbBIL37TvUHQDUaG1XErynq3w=s176-c-k-c0x00ffffff-no-rj"],
  ["UC9PBzalIcEQCsiIkq36PyUA", "Digital Foundry", "@DigitalFoundry", "f_games", false, "https://yt3.googleusercontent.com/PBh4giP5yBGdq6OxwdAW32ZvLI-uy_kzMAlV7sQ-jTaWK3q4f3euUJL8lFX3onIkHlc6OBCTpQ=s176-c-k-c0x00ffffff-no-rj"],
  ["UCtUbO6rBht0daVIOGML3c8w", "Summoning Salt", "@SummoningSalt", "f_games", false, "https://yt3.googleusercontent.com/ytc/AIdro_n8NSEiNfCuno3JKW2ggFYNvxVUKPg2jzf2O_7W-pmkAv4=s176-c-k-c0x00ffffff-no-rj"],
  ["UCKy1dAqELo0zrOtPkf0eTMw", "IGN", "@IGN", "f_games", false, "https://yt3.googleusercontent.com/4jRpju9vRtgoIA6SxuIomVcCmjub6ydA1TzGRHts853ZzxRITi41gxP50jTuGBdUlvAgehZJK8Y=s176-c-k-c0x00ffffff-no-rj"],
  ["UCbu2SsF-Or3Rsn3NxqODImw", "GameSpot", "@gamespot", "f_games", false, "https://yt3.googleusercontent.com/2q8-YlqtAs3pWHamRcooAOvt_M88afnTwo7DYwqvHV9OSGlf2pBa5h3QJGeHrBkBidUjaL0mpA=s176-c-k-c0x00ffffff-no-rj"],
]

/** Two followed channels without a folder (pasted by link) for the "No folder" group. */
const UNFILED = new Set(['UCbu2SsF-Or3Rsn3NxqODImw', 'UCKy1dAqELo0zrOtPkf0eTMw'])
const MUTED = new Set(['UCKy1dAqELo0zrOtPkf0eTMw'])

function channelOf([id, title, handle, folder, favorite, thumb]: Seed, i: number): Channel {
  return {
    id,
    title,
    relation: UNFILED.has(id) ? 'followed' : 'subscribed',
    source: UNFILED.has(id) ? 'link' : 'extension',
    added_at: NOW_S - 300 * D + i * D,
    handle,
    thumb,
    url: `https://www.youtube.com/${handle}`,
    folder_id: UNFILED.has(id) ? null : folder,
    favorite,
    muted: MUTED.has(id),
    unsubscribed_at: null,
    last_video_at: NOW_S - (i % 9) * D,
    videos_per_week: 1 + (i % 4),
    shorts_ratio: 0.1,
    ai_note: null,
    tag_ids: []
  }
}

const CHANNELS: Channel[] = SEEDS.map(channelOf)

/** New per channel: some with plenty, many caught up (zero is not shown). */
const NEW: Record<string, number> = Object.fromEntries(CHANNELS.map((c, i) => [c.id, [3, 0, 1, 0, 2, 0, 0, 5, 1, 0, 0, 2][i % 12]]))

function rows(list: Channel[]): ChannelRow[] {
  return list.map((c) => ({ channel: c, new_count: NEW[c.id] ?? 0, watched_90d: null }))
}

function stateOf(byChannel: Record<string, number>) {
  return { counts: { total: Object.values(byChannel).reduce((a, b) => a + b, 0), by_tab: {}, by_folder: {}, by_channel: byChannel }, videos: {} }
}

function rules(include: Partial<TabRules['include']>): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: true, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'Tudo novo', kind: 'mixed', rules: rules({ all: true }), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favoritos', kind: 'mixed', rules: rules({ favorites: true }), icon: '⭐', filters: {}, sort: 1, builtin: true }
]

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: stateOf(NEW).counts.total,
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

function base(over: Partial<StatusResponse> = {}): NonNullable<Scenario['rest']> {
  return {
    'GET /folders': { items: FOLDERS },
    'GET /channels': { items: rows(CHANNELS), total: CHANNELS.length },
    'GET /state': stateOf(NEW),
    'GET /status': status(over),
    'GET /tabs': { items: TABS }
  }
}

const OPEN = ['folder:f_tech', 'folder:f_ai', 'folder:f_science', 'unfiled']

export const scenarios: Scenario[] = [
  {
    id: 'pane-lone-zone',
    title: 'Panel · own header "Subscriptions · N" (the app gives a lone pane no tab strip)',
    widths: [300, 420],
    rest: base(),
    render: () => <PaneView initialExpanded={['folder:f_tech']} />
  },
  {
    id: 'pane-full',
    title: 'Panel · full (Tecnologia, IA and Ciência open)',
    widths: [260, 420, 480],
    rest: base(),
    render: () => <PaneView initialExpanded={OPEN} />
  },
  {
    id: 'pane-nested',
    title: 'Panel · nested folder (Tecnologia › IA)',
    widths: WIDTHS,
    rest: base(),
    render: () => <PaneView initialExpanded={['folder:f_tech', 'folder:f_ai']} />
  },
  {
    id: 'pane-narrow',
    title: 'Panel · narrow (220 px, all collapsed)',
    widths: [220],
    rest: base(),
    render: () => <PaneView initialExpanded={[]} />
  },
  {
    id: 'pane-search',
    title: 'Panel · search "ciência"',
    widths: WIDTHS,
    rest: base(),
    render: () => <PaneView initialExpanded={[]} initialQuery="ciência" />
  },
  {
    id: 'pane-empty',
    title: 'Panel · empty (no subscriptions)',
    widths: WIDTHS,
    rest: { ...base({ new_total: 0 }), 'GET /folders': { items: [] }, 'GET /channels': { items: [], total: 0 }, 'GET /state': stateOf({}) },
    render: () => <PaneView />
  },
  {
    id: 'pane-loading',
    title: 'Panel · loading',
    widths: WIDTHS,
    rest: { ...base(), 'GET /folders': pending, 'GET /channels': pending, 'GET /state': pending },
    render: () => <PaneView />
  },
  {
    id: 'pane-error',
    title: 'Panel · load error (retry)',
    widths: WIDTHS,
    rest: {
      ...base(),
      'GET /folders': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    },
    render: () => <PaneView />
  },
  {
    id: 'pane-no-plugin',
    title: 'Panel · profile without the plugin (app 404)',
    widths: WIDTHS,
    rest: {
      ...base(),
      'GET /folders': () => {
        throw { code: 'plugin_disabled', message: 'plugin not enabled for this profile' }
      }
    },
    render: () => <PaneView />
  },
  {
    id: 'pane-ext-disconnected',
    title: 'Panel · extension disconnected',
    widths: WIDTHS,
    rest: base({ devices_online: 0 }),
    render: () => <PaneView initialExpanded={['folder:f_tech']} />
  },
  {
    id: 'pane-rss-down',
    title: 'Panel · YouTube feed down',
    widths: WIDTHS,
    rest: base({ rss_down_since: NOW_S - 2 * 3600, rss_fallback_channels: 31 }),
    render: () => <PaneView initialExpanded={['folder:f_science']} />
  }
]
