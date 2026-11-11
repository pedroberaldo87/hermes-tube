// Preview scenarios of Manage (the collector's interface): each scenario mounts the REAL screen over a fake `ctx`
// that answers from the `rest` map (contract route → the envelope's `data`, or a function; throwing `{code, message}` = error).
// Data: the 40 real demo channels (ids, @handles and photos from plugin/data/demo_channels.json, copied: the import
// rule does not let `pages/` read `plugin/data`) + 4 synthetic ones (long name, followed, former, muted). Dates, pace,
// % Shorts and watched counts are illustrative (deterministic by index).
import type { Channel, ChannelRow, Device, Folder, StatusResponse, Tag } from '../../../shared/api-types'
import type { Scenario } from '../../components'
import { ManagePage, ManageView } from './index'

const WIDTHS = [420, 900, 1440]
const NOW_S = Math.floor(Date.now() / 1000)
const D = 86400
const YT3 = 'https://yt3.googleusercontent.com/'

type Seed = [id: string, title: string, handle: string, thumb: string | null, folder: string | null, favorite: boolean]

const SEEDS: Seed[] = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship', '@Fireship', '3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s176-c-k-c0x00ffffff-no-rj', 'tech', true],
  ['UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', '@mkbhd', 'qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj', 'tech', false],
  ['UCXuqSBlHAE6Xw-yeJA0Tunw', 'Linus Tech Tips', '@LinusTechTips', 'gnvYLhXy8FAlPXZ2RTrkrgj-5kyt0vdE2FUGVOiKGdEZIa-wN5A-7nwZBlWJLzUMmoh1NWAU=s176-c-k-c0x00ffffff-no-rj', 'tech', false],
  ['UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers', '@TwoMinutePapers', 'ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ=s176-c-k-c0x00ffffff-no-rj', 'ai', false],
  ['UC9-y-6csu5WGm29I7JiwpnA', 'Computerphile', '@Computerphile', 'ebHMyRfch3u2UTZN1WQJDp9J5U7o38T_WnGkd2QhAIQwBgvozdaOCOnfDMtngtoHWutJvLl4i0c=s176-c-k-c0x00ffffff-no-rj', 'tech', false],
  ['UCXUPKJO5MZQN11PqgIvyuvQ', 'Andrej Karpathy', '@AndrejKarpathy', 'ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz=s176-c-k-c0x00ffffff-no-rj', 'ai', false],
  ['UCddiUEpeqJcYeBxX1IVBKvQ', 'The Verge', '@TheVerge', 'ZIj_dq7beCkAkhufNqCid_SjWW4mkv4tqIDtv7_AAKzWdhBWI-rpsRXYXB9X3mB0s0zNzNtYdQ=s176-c-k-c0x00ffffff-no-rj', 'tech', false],
  ['UC8ENHE5xdFSwx71u3fDH5Xw', 'ThePrimeagen', '@ThePrimeagen', 'ytc/AIdro_laY82JAzs_2edBDxrxLgLWshhMK04SpAqOfoEzexOBZg=s176-c-k-c0x00ffffff-no-rj', 'tech', false],
  ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium', '7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj', 'science', true],
  ['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', '@kurzgesagt', 'ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown', '@3blue1brown', 'ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UC6107grRI4m0o2-emgoDnAA', 'SmarterEveryDay', '@smartereveryday', 'ytc/AIdro_l59Ewmp0DHZBRWbY9dVqjd2_mWwvrn8ad0bJfmdbMRYcA=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCEIwxahdLz7bap-VDs9h35A', 'Steve Mould', '@SteveMould', 'iX-akiHlJYuPDq4YVBO83cfjWW0aQefdewmI326XVhZkzxnS3MrqNVi49J33jLBw5LR_ZVyKFA=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCY1kMZp36IQSyNx_9h4mpCg', 'Mark Rober', '@MarkRober', 'ytc/AIdro_ksXY2REjZ6gYKSgnWT5jC_zT9mX900vyFtVinR8KbHww=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCLA_DiR1FfKNvjuUpBHmylQ', 'NASA', '@NASA', 'eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCn9Erjy00mpnWeLnRqhsA1g', 'Ciência Todo Dia', '@CienciaTodoDia', 'ytc/AIdro_lQoeh3pIl35H0tiDQ6fG3YeSrn2hWxKKCIxN11NQvnDdg=s176-c-k-c0x00ffffff-no-rj', 'science', false],
  ['UCqqJQ_cXSat0KIAVfIfKkVA', 'J. Kenji López-Alt', '@JKenjiLopezAlt', 'tEql8Eq4IgP3UNx5v646k5U1QKidegUlZRvS18PyF2WM9YGt770IlxFVRrdDatLKHRCFuv9kfA=s176-c-k-c0x00ffffff-no-rj', 'cooking', true],
  ['UChBEbMKI1eCcejTtmI32UEw', 'Joshua Weissman', '@JoshuaWeissman', 'ytc/AIdro_nfXRvoxu5cFt2H4WhJfFLbL5SVdzmvEnFymnPzH3_1qPM=s176-c-k-c0x00ffffff-no-rj', 'cooking', false],
  ['UCJHA_jMfCvEnv-3kRjTCQXw', 'Binging with Babish', '@bingingwithbabish', 'AlCRk3X8JvmNqHC7R3c7yVDQaGyUvMAd3GXY77vTgzGS1Qa_vlVFY0ZNSH56otpeBKDq3gF-yw=s176-c-k-c0x00ffffff-no-rj', 'cooking', false],
  ['UCDq5v10l4wkV5-ZBIJJFbzQ', 'Ethan Chlebowski', '@EthanChlebowski', 'ytc/AIdro_nASBGz3OXASRVham6ZgSHJrheFcXNKHtI86bw0QeA9ENc=s176-c-k-c0x00ffffff-no-rj', 'cooking', false],
  ['UC9_p50tH3WmMslWRWKnM7dQ', 'Adam Ragusea', '@aragusea', 'ytc/AIdro_k1Qk7novhk1zSZqL-Ws8Xp3cFPPtvzdhroHp1DMMOO1Go=s176-c-k-c0x00ffffff-no-rj', 'cooking', false],
  ['UCRIZtPl9nb9RiXc9btSTQNw', 'Food Wishes', '@foodwishes', 'ytc/AIdro_kGZ14S6frarUZ0q3zzhqTSnl3zkYo_qxwQ8Wi-J11MaA=s176-c-k-c0x00ffffff-no-rj', 'cooking', false],
  ['UCJquYOG5EL82sKTfH9aMA9Q', 'Rick Beato', '@RickBeato', 'ZfDOigTWKzMkwaokreALniSPfAzaAq4v2T9hawgoFmjX4mHULaVyCcySqKjmvcBqvoPyWX7gsg=s176-c-k-c0x00ffffff-no-rj', 'music', true],
  ['UCnkp4xDOwqqJD7sSM3xdUiQ', 'Adam Neely', '@AdamNeely', '584RoBu_Mr3Ocp2I-GAomClNWH6ZeuVWeDpFAhFqziYIyTjMEoHHWzmyg8XtIN8v73eJa-19kTA=s176-c-k-c0x00ffffff-no-rj', 'music', false],
  ['UC4eYXhJI4-7wSWc8UNRwD4A', 'NPR Music', '@nprmusic', 'IXJZjJSYR9kfnUcHwIzAYjunIfovC2QYOOAseZxrDHBwvCKQEHBNcdC6PmNxn8EALE357U3vvhE=s176-c-k-c0x00ffffff-no-rj', 'music', false],
  ['UC2Qw1dzXDBAZPwS7zm37g8g', 'COLORS', '@COLORSxSTUDIOS', 'ytc/AIdro_nFe5LeXpVm-ggGY9NH3JqYvVyU1NBcXHZ827U0JtoFa0M=s176-c-k-c0x00ffffff-no-rj', 'music', false],
  ['UC3I2GFN_F8WudD_2jUZbojA', 'KEXP', '@kexp', 'cl8yKGTNMIspmtTvc0UJIiFzn3b0jH-eOlSBwd4ODVbXNkxUEZ-7JVlCZi2DRPw8qtIDv-jN2Gg=s176-c-k-c0x00ffffff-no-rj', 'music', false],
  ['UC8R8FRt1KcPiR-rtAflXmeg', 'Nahre Sol', '@NahreSol', 'ytc/AIdro_n5wdFCiUb0EmwOd_HTqrATVMY0lbwhDwGU1_Tifi-zCyA=s176-c-k-c0x00ffffff-no-rj', 'music', false],
  ['UCmGSJVG3mCRXVOP4yZrU1Dw', 'Johnny Harris', '@johnnyharris', 'ytc/AIdro_kswBDn49WW5IneVE-5RlKyud5GvdzyQQ5SJQyVvJ4S3pk=s176-c-k-c0x00ffffff-no-rj', 'news', true],
  ['UCLXo7UDZvByw2ixzpQCufnA', 'Vox', '@Vox', 'iak9xjDjDoQHn9UNWSvkobPuxAzK1ApefjPH7HGObwo71AbaiEqdafMjmUJCgOoBFWNKPS2t2eI=s176-c-k-c0x00ffffff-no-rj', 'news', false],
  ['UC16niRr50-MSBwiO3YDb3RA', 'BBC News', '@BBCNews', 'v4JamQ9B-PUiJHjmZQs9UwTaoLQW8vijJMMpV5QvA2wHQ6iwWM8Q1s6O4jgTl0dtDigVWAi7SA=s176-c-k-c0x00ffffff-no-rj', 'news', false],
  ['UChqUTb7kYRX8-EiaN3XFrSQ', 'Reuters', '@Reuters', 'bCcVVrrV0EhGFJKsSvmeZHA9Y-YzSL9Keqrrr0HWYUPQy3-mVUVNHMbjwt7IoVkpsHt4E6BZ3pM=s176-c-k-c0x00ffffff-no-rj', null, false],
  ['UCknLrEdhRCp1aegoMqRaCZg', 'DW News', '@dwnews', 'NSOdTQTWlqMy8O_j32dx-ftfTCHMOt04Hm7KZ4pfAK6-eQzQSZMWvvss90kG8KQfJ7iNP3phyA=s176-c-k-c0x00ffffff-no-rj', null, false],
  ['UCNye-wNBqNL5ZzHSJj3l8Bg', 'Al Jazeera English', '@aljazeeraenglish', 'XsTga3Nsfc1E6ZgC6HfHfzTG_3zhuZleOnsKxSK2aILMjwkkIm-0vdALFaU-yt0Lw07iLtbSifk=s176-c-k-c0x00ffffff-no-rj', null, false],
  ['UCqJ-Xo29CKyLTjn6z2XwYAw', "Game Maker's Toolkit", '@GMTK', 'fZzS7tuwCW14i6tAAtGG6q8E1Y3-_k2G36mbn7VNKHOwtaJ4vKF8Es8Ky6745TiNGOAVSAyR6A=s176-c-k-c0x00ffffff-no-rj', 'games', true],
  ['UC0fDG3byEcMtbOqPMymDNbw', '/noclip', '@NoclipDocs', '093arh9Jg1MqfdvcqcrDcUQm9QMdXnzWEJ-dpT_YUn5QU_8AQYbBIL37TvUHQDUaG1XErynq3w=s176-c-k-c0x00ffffff-no-rj', 'games', false],
  ['UC9PBzalIcEQCsiIkq36PyUA', 'Digital Foundry', '@DigitalFoundry', 'PBh4giP5yBGdq6OxwdAW32ZvLI-uy_kzMAlV7sQ-jTaWK3q4f3euUJL8lFX3onIkHlc6OBCTpQ=s176-c-k-c0x00ffffff-no-rj', 'games', false],
  ['UCtUbO6rBht0daVIOGML3c8w', 'Summoning Salt', '@SummoningSalt', 'ytc/AIdro_n8NSEiNfCuno3JKW2ggFYNvxVUKPg2jzf2O_7W-pmkAv4=s176-c-k-c0x00ffffff-no-rj', 'games', false],
  ['UCKy1dAqELo0zrOtPkf0eTMw', 'IGN', '@IGN', '4jRpju9vRtgoIA6SxuIomVcCmjub6ydA1TzGRHts853ZzxRITi41gxP50jTuGBdUlvAgehZJK8Y=s176-c-k-c0x00ffffff-no-rj', null, false],
  ['UCbu2SsF-Or3Rsn3NxqODImw', 'GameSpot', '@gamespot', '2q8-YlqtAs3pWHamRcooAOvt_M88afnTwo7DYwqvHV9OSGlf2pBa5h3QJGeHrBkBidUjaL0mpA=s176-c-k-c0x00ffffff-no-rj', 'games', false],
  // synthetic: a very long name (no photo: placeholder on purpose), followed without subscribing, muted, former subscription
  ['UCstanford_online_lectures_x', 'Stanford Online — Computer Science Lectures, Seminars and Courses', '@stanfordonline', null, 'ai', false],
  ['UCfollowed_only_channel_xxxx', 'Física e Afins com a Professora Ana Beatriz', '@fisicaeafins', null, 'science', false],
  ['UCmuted_reaction_channel_xxx', 'Reações ao Vivo (silenciado)', '@reacoesaovivo', null, null, false],
  ['UCformer_subscription_xxxxxx', 'Canal Antigo de Unboxing', '@unboxingantigo', null, 'tech', false]
]

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'Inteligência artificial', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_science', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'f_cooking', name: 'Culinária', parent_id: null, color: null, sort: 2 },
  { id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 3 },
  { id: 'f_news', name: 'Notícias', parent_id: null, color: null, sort: 4 },
  { id: 'f_games', name: 'Games', parent_id: null, color: null, sort: 5 }
]

const TAGS: Tag[] = [
  { id: 't_long', name: 'longform', color: null },
  { id: 't_review', name: 'review', color: null },
  { id: 't_live', name: 'ao vivo', color: null },
  { id: 't_weekend', name: 'fim de semana', color: null }
]

/** Tags by position (deterministic). */
function tagsFor(i: number, folder: string | null): string[] {
  const out: string[] = []
  if (folder === 'science' || folder === 'news' || i % 7 === 0) out.push('t_long')
  if (folder === 'tech' && i % 2 === 0) out.push('t_review')
  if (folder === 'music' && i % 2 === 1) out.push('t_live')
  if (i % 5 === 2) out.push('t_weekend')
  return out
}

const LAST_DAYS = [0, 1, 3, 2, 12, 8, 0, 1, 20, 34, 61, 95, 14, 40, 3, 6, 9, 5, 214, 7, 10, 391, 2, 18, 1, 4, 0, 9, 25, 1, 0, 0, 0, 0, 33, 247, 6, 120, 0, 0, 11, 52, 0, 600]
const PER_WEEK = [6, 2, 9, 2.5, 1.5, 0.3, 14, 5, 0.8, 0.5, 0.4, 0.3, 0.6, 0.4, 4, 3, 0.5, 2, 0, 1, 1.2, 0, 2, 0.7, 3, 8, 6, 0.3, 1.1, 7, 21, 35, 48, 60, 0.4, 0, 1.5, 0.2, 41, 23, 0.6, 1, 9, 0]

const ROWS: ChannelRow[] = SEEDS.map(([id, title, handle, thumb, folder, favorite], i) => {
  const relation: Channel['relation'] = i === 41 ? 'followed' : i === 43 ? 'ex' : i % 9 === 4 ? 'followed' : 'subscribed'
  const channel: Channel = {
    id,
    title,
    relation,
    source: relation === 'followed' ? 'link' : 'extension',
    added_at: NOW_S - (900 - i * 15) * D,
    handle: handle.toLowerCase(),
    thumb: thumb ? `${YT3}${thumb}` : null,
    url: `https://www.youtube.com/${handle}`,
    folder_id: folder ? `f_${folder}` : null,
    favorite,
    muted: i === 42 || i === 38,
    unsubscribed_at: relation === 'ex' ? NOW_S - 12 * D : null,
    last_video_at: LAST_DAYS[i] === undefined ? null : NOW_S - LAST_DAYS[i] * D - (i % 5) * 3600,
    videos_per_week: i === 40 ? null : (PER_WEEK[i] ?? null),
    shorts_ratio: i === 40 ? null : ((i * 37) % 100) / 100 < 0.6 ? Math.round(((i * 37) % 60) / 2) / 100 : 0.7,
    ai_note: null,
    tag_ids: tagsFor(i, folder)
  }
  return { channel, new_count: (i * 3) % 7 === 0 ? 2 : 0, watched_90d: i === 40 ? null : (i * 11) % 9 }
})

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 12,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 120,
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

/** A browser paired with the extension (the extension notice needs `GET /devices` to say anything). */
const PAIRED: Device = { id: 'dev_1', name: 'Chrome — Mac', created_at: Math.floor(Date.now() / 1000) - 40 * 86400, last_seen: Math.floor(Date.now() / 1000) - 60, revoked_at: null, origin: null }

const BASE = {
  'GET /channels': { items: ROWS, total: ROWS.length },
  'GET /folders': { items: FOLDERS },
  'GET /tags': { items: TAGS },
  'GET /status': status(),
  'GET /devices': { items: [PAIRED] }
}

/** 2000 rows: the 44 real ones (with photos) + synthetic ones without photos (placeholder on purpose), folders in rotation. */
const MANY: ChannelRow[] = Array.from({ length: 2000 }, (_, i) => {
  const src = ROWS[i % ROWS.length]
  if (i < ROWS.length) return src
  const n = String(i).padStart(4, '0')
  return {
    ...src,
    channel: { ...src.channel, id: `UCsynthetic_${n}_xxxxxxxxx`, title: `${src.channel.title} ${n}`, thumb: null, handle: `@canal${n}`, folder_id: FOLDERS[i % FOLDERS.length].id }
  }
})

const id = (title: string) => ROWS.find((r) => r.channel.title === title)!.channel.id

export const scenarios: Scenario[] = [
  {
    id: 'manage-full',
    title: 'Manage · full (44 channels, long names)',
    widths: WIDTHS,
    rest: BASE,
    render: () => <ManagePage />
  },
  {
    id: 'manage-selection',
    title: 'Manage · selection with the batch bar',
    widths: WIDTHS,
    rest: BASE,
    render: () => (
      <ManageView
        initial={{
          filters: {},
          selected: [id('Fireship'), id('Marques Brownlee'), id('Computerphile'), id('The Verge'), id('ThePrimeagen')]
        }}
      />
    )
  },
  {
    id: 'manage-filters',
    title: 'Manage · filters on (folder + tag + ⭐ off + inactive)',
    widths: WIDTHS,
    rest: BASE,
    render: () => <ManageView initial={{ filters: { folder: 'f_science', tag: 't_long', staleMonths: null, relation: 'active' } }} />
  },
  {
    id: 'manage-edit-folder',
    title: 'Manage · folder edit open in the row',
    widths: WIDTHS,
    rest: BASE,
    render: () => <ManageView initial={{ filters: {}, editing: { id: id('Two Minute Papers'), field: 'folder' } }} />
  },
  {
    id: 'manage-empty',
    title: 'Manage · no channels (leads to Welcome)',
    widths: WIDTHS,
    rest: { ...BASE, 'GET /channels': { items: [], total: 0 }, 'GET /folders': { items: [] }, 'GET /tags': { items: [] } },
    render: () => <ManagePage />
  },
  {
    id: 'manage-no-results',
    title: 'Manage · filter with no result',
    widths: WIDTHS,
    rest: BASE,
    render: () => <ManageView initial={{ filters: { q: 'a channel that does not exist', favorite: true } }} />
  },
  {
    id: 'manage-error',
    title: 'Manage · error with try again',
    widths: WIDTHS,
    rest: {
      ...BASE,
      'GET /channels': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    },
    render: () => <ManagePage />
  },
  {
    id: 'manage-loading',
    title: 'Manage · loading (skeleton with the table geometry)',
    widths: WIDTHS,
    rest: { ...BASE, 'GET /channels': () => new Promise<never>(() => undefined) },
    render: () => <ManagePage />
  },
  {
    id: 'manage-narrow',
    title: 'Manage · narrow (folders become a selector in the bar)',
    widths: [420, 560, 680],
    rest: BASE,
    render: () => <ManageView initial={{ filters: { folder: 'f_tech' } }} />
  },
  {
    id: 'manage-many',
    title: 'Manage · 2000 channels (row windowing)',
    widths: [1440],
    rest: { ...BASE, 'GET /channels': { items: MANY, total: MANY.length } },
    render: () => <ManagePage />
  },
  {
    id: 'manage-disconnected',
    title: 'Manage · extension disconnected (kit strip)',
    widths: WIDTHS,
    rest: { ...BASE, 'GET /status': status({ devices_online: 0 }) },
    render: () => <ManagePage />
  },
  {
    id: 'manage-not-paired',
    title: 'Manage · no browser ever paired (connect strip)',
    widths: WIDTHS,
    rest: { ...BASE, 'GET /status': status({ devices_online: 0 }), 'GET /devices': { items: [] } },
    render: () => <ManagePage />
  }
]
