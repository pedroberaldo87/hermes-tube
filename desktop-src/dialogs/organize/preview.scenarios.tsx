// Preview scenarios of "Organize with Hermes" (the collector's fixed interface): each scenario
// mounts the REAL dialog over a fake `ctx` that answers from the `rest` map (key = contract route, value =
// the envelope's `data` or a function; throwing `{code, message}` simulates an error) and `rpc`. States that depend on a user
// action (all accepted, declined in the window, no model) come through `initial`. Only the preview imports this file.
// Data: real channels and avatars from plugin/data/demo_channels.json; reasons and confidences are illustrative.
import type { Channel, ChannelRow, Folder, Job, Suggestion } from '../../../shared/api-types'
import type { Scenario } from '../../components'
import { OrganizeDialog, type OrganizeSeed } from './index'

const WIDTHS = [420, 900]
const MODEL = 'claude-haiku-5-5'
const nowS = () => Math.floor(Date.now() / 1000)

// ------------------------------------------------------------------ channels (real demo)

const T = 'https://yt3.googleusercontent.com/'
const RAW: [string, string, string][] = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship', `${T}3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s176-c-k-c0x00ffffff-no-rj`],
  ['UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', `${T}qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj`],
  ['UCXuqSBlHAE6Xw-yeJA0Tunw', 'Linus Tech Tips', `${T}gnvYLhXy8FAlPXZ2RTrkrgj-5kyt0vdE2FUGVOiKGdEZIa-wN5A-7nwZBlWJLzUMmoh1NWAU=s176-c-k-c0x00ffffff-no-rj`],
  ['UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers', `${T}ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ=s176-c-k-c0x00ffffff-no-rj`],
  ['UC9-y-6csu5WGm29I7JiwpnA', 'Computerphile', `${T}ebHMyRfch3u2UTZN1WQJDp9J5U7o38T_WnGkd2QhAIQwBgvozdaOCOnfDMtngtoHWutJvLl4i0c=s176-c-k-c0x00ffffff-no-rj`],
  ['UCXUPKJO5MZQN11PqgIvyuvQ', 'Andrej Karpathy', `${T}ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz=s176-c-k-c0x00ffffff-no-rj`],
  ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', `${T}7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj`],
  ['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt – In a Nutshell', `${T}ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s176-c-k-c0x00ffffff-no-rj`],
  ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown', `${T}ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s176-c-k-c0x00ffffff-no-rj`],
  ['UC6107grRI4m0o2-emgoDnAA', 'SmarterEveryDay', `${T}ytc/AIdro_l59Ewmp0DHZBRWbY9dVqjd2_mWwvrn8ad0bJfmdbMRYcA=s176-c-k-c0x00ffffff-no-rj`],
  ['UCEIwxahdLz7bap-VDs9h35A', 'Steve Mould', `${T}iX-akiHlJYuPDq4YVBO83cfjWW0aQefdewmI326XVhZkzxnS3MrqNVi49J33jLBw5LR_ZVyKFA=s176-c-k-c0x00ffffff-no-rj`],
  ['UCJquYOG5EL82sKTfH9aMA9Q', 'Rick Beato', `${T}ZfDOigTWKzMkwaokreALniSPfAzaAq4v2T9hawgoFmjX4mHULaVyCcySqKjmvcBqvoPyWX7gsg=s176-c-k-c0x00ffffff-no-rj`],
  ['UCnkp4xDOwqqJD7sSM3xdUiQ', 'Adam Neely', `${T}584RoBu_Mr3Ocp2I-GAomClNWH6ZeuVWeDpFAhFqziYIyTjMEoHHWzmyg8XtIN8v73eJa-19kTA=s176-c-k-c0x00ffffff-no-rj`],
  ['UC4eYXhJI4-7wSWc8UNRwD4A', 'NPR Music', `${T}IXJZjJSYR9kfnUcHwIzAYjunIfovC2QYOOAseZxrDHBwvCKQEHBNcdC6PmNxn8EALE357U3vvhE=s176-c-k-c0x00ffffff-no-rj`],
  ['UC3I2GFN_F8WudD_2jUZbojA', 'KEXP', `${T}cl8yKGTNMIspmtTvc0UJIiFzn3b0jH-eOlSBwd4ODVbXNkxUEZ-7JVlCZi2DRPw8qtIDv-jN2Gg=s176-c-k-c0x00ffffff-no-rj`],
  ['UCqqJQ_cXSat0KIAVfIfKkVA', 'J. Kenji López-Alt', `${T}tEql8Eq4IgP3UNx5v646k5U1QKidegUlZRvS18PyF2WM9YGt770IlxFVRrdDatLKHRCFuv9kfA=s176-c-k-c0x00ffffff-no-rj`],
  ['UChBEbMKI1eCcejTtmI32UEw', 'Joshua Weissman', `${T}ytc/AIdro_nfXRvoxu5cFt2H4WhJfFLbL5SVdzmvEnFymnPzH3_1qPM=s176-c-k-c0x00ffffff-no-rj`],
  ['UCJHA_jMfCvEnv-3kRjTCQXw', 'Binging with Babish', `${T}AlCRk3X8JvmNqHC7R3c7yVDQaGyUvMAd3GXY77vTgzGS1Qa_vlVFY0ZNSH56otpeBKDq3gF-yw=s176-c-k-c0x00ffffff-no-rj`],
  ['UCDq5v10l4wkV5-ZBIJJFbzQ', 'Ethan Chlebowski', `${T}ytc/AIdro_nASBGz3OXASRVham6ZgSHJrheFcXNKHtI86bw0QeA9ENc=s176-c-k-c0x00ffffff-no-rj`],
  ['UC9_p50tH3WmMslWRWKnM7dQ', 'Adam Ragusea', `${T}ytc/AIdro_k1Qk7novhk1zSZqL-Ws8Xp3cFPPtvzdhroHp1DMMOO1Go=s176-c-k-c0x00ffffff-no-rj`],
  ['UCqJ-Xo29CKyLTjn6z2XwYAw', "Game Maker's Toolkit", `${T}fZzS7tuwCW14i6tAAtGG6q8E1Y3-_k2G36mbn7VNKHOwtaJ4vKF8Es8Ky6745TiNGOAVSAyR6A=s176-c-k-c0x00ffffff-no-rj`],
  ['UC0fDG3byEcMtbOqPMymDNbw', '/noclip', `${T}093arh9Jg1MqfdvcqcrDcUQm9QMdXnzWEJ-dpT_YUn5QU_8AQYbBIL37TvUHQDUaG1XErynq3w=s176-c-k-c0x00ffffff-no-rj`],
  ['UC9PBzalIcEQCsiIkq36PyUA', 'Digital Foundry', `${T}PBh4giP5yBGdq6OxwdAW32ZvLI-uy_kzMAlV7sQ-jTaWK3q4f3euUJL8lFX3onIkHlc6OBCTpQ=s176-c-k-c0x00ffffff-no-rj`],
  ['UCtUbO6rBht0daVIOGML3c8w', 'Summoning Salt', `${T}ytc/AIdro_n8NSEiNfCuno3JKW2ggFYNvxVUKPg2jzf2O_7W-pmkAv4=s176-c-k-c0x00ffffff-no-rj`]
]

function channel([id, title, thumb]: [string, string, string]): Channel {
  return {
    id,
    title,
    relation: 'subscribed',
    source: 'extension',
    added_at: nowS() - 400 * 86400,
    handle: null,
    thumb,
    url: null,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: nowS() - 3 * 86400,
    videos_per_week: 1.5,
    shorts_ratio: 0.1,
    ai_note: null,
    tag_ids: []
  }
}

const CHANNELS = RAW.map(channel)
const ROWS: ChannelRow[] = CHANNELS.map((c) => ({ channel: c, new_count: 0, watched_90d: null }))
const byTitle = (title: string) => CHANNELS.find((c) => c.title === title) as Channel

// ------------------------------------------------------------------ suggestions: 5 folders, 2 new

type Spec = [title: string, folder: string, isNew: boolean, why: string, confidence: number, tags?: string[]]

const SPECS: Spec[] = [
  ['Veritasium', 'Ciência', false, 'Experimentos de física e engenharia explicados', 0.94, ['física']],
  ['Kurzgesagt – In a Nutshell', 'Ciência', false, 'Animações sobre ciência, espaço e biologia', 0.93],
  ['3Blue1Brown', 'Ciência', false, 'Matemática visual: álgebra linear, cálculo, redes neurais', 0.88, ['matemática']],
  ['SmarterEveryDay', 'Ciência', false, 'Física do dia a dia filmada em câmera lenta', 0.86],
  ['Steve Mould', 'Ciência', false, 'Fenômenos físicos curiosos com demonstração', 0.84],
  ['J. Kenji López-Alt', 'Culinária', true, 'Receitas com ciência da cozinha, em primeira pessoa', 0.91, ['receitas']],
  ['Joshua Weissman', 'Culinária', true, 'Receitas caseiras de fast food e pães', 0.89, ['receitas']],
  ['Binging with Babish', 'Culinária', true, 'Pratos de filmes e séries recriados', 0.87],
  ['Ethan Chlebowski', 'Culinária', true, 'Técnica de cozinha para o dia a dia', 0.83],
  ['Adam Ragusea', 'Culinária', true, 'Cozinha caseira e história dos alimentos', 0.74],
  ["Game Maker's Toolkit", 'Jogos', true, 'Análise de design de jogos', 0.9, ['game design']],
  ['/noclip', 'Jogos', true, 'Documentários sobre estúdios de games', 0.86],
  ['Digital Foundry', 'Jogos', true, 'Análise técnica de gráficos e desempenho em jogos', 0.82],
  ['Summoning Salt', 'Jogos', true, 'História dos recordes de speedrun', 0.78],
  ['Rick Beato', 'Música', false, 'Teoria musical e análise de canções', 0.92],
  ['Adam Neely', 'Música', false, 'Teoria musical e o mundo do baixo', 0.88],
  ['NPR Music', 'Música', false, 'Tiny Desk e apresentações ao vivo', 0.85, ['ao vivo']],
  ['KEXP', 'Música', false, 'Sessões ao vivo de bandas independentes', 0.81, ['ao vivo']],
  ['Fireship', 'Tecnologia', false, 'Programação em vídeos curtos de 100 segundos', 0.95, ['programação']],
  ['Andrej Karpathy', 'Tecnologia', false, 'Aulas sobre redes neurais e modelos de linguagem', 0.93, ['IA']],
  ['Two Minute Papers', 'Tecnologia', false, 'Artigos de IA resumidos em minutos', 0.9, ['IA']],
  ['Computerphile', 'Tecnologia', false, 'Ciência da computação explicada por pesquisadores', 0.87],
  ['Marques Brownlee', 'Tecnologia', false, 'Reviews de celulares e gadgets', 0.86, ['reviews']],
  ['Linus Tech Tips', 'Tecnologia', false, 'Hardware de PC e reviews', 0.52, ['reviews']]
]

function suggestion([title, folder, isNew, why, confidence, tags = []]: Spec, i: number): Suggestion {
  const c = byTitle(title)
  return {
    id: `sg_${i}`,
    kind: 'organize',
    status: 'pending',
    payload: { channel_id: c.id, channel_title: c.title, folder, new_folder: isNew, tags, confidence, why },
    created_at: nowS() - 60,
    channel_id: c.id,
    model: MODEL,
    decided_at: null
  }
}

const ALL = SPECS.map(suggestion)
const FIRST_BATCHES = ALL.filter((s) => ['Tecnologia', 'Ciência', 'Música'].includes(String(s.payload.folder))).slice(0, 11)

const FOLDERS: Folder[] = [
  { id: 'f_tec', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_cie', name: 'Ciência', parent_id: null, color: null, sort: 1 },
  { id: 'f_mus', name: 'Música', parent_id: null, color: null, sort: 2 },
  { id: 'f_fis', name: 'Física', parent_id: 'f_cie', color: null, sort: 0 }
]

function job(status: Job['status'], extra: Partial<Job> = {}): Job {
  return { id: 'job_demo', kind: 'organize', status, created_at: nowS() - 30, updated_at: nowS(), progress: null, result: null, error: null, ...extra }
}

/** Backend of someone with 412 channels without a folder (the returned list has the 24 demo ones, with photos). */
function base(extra: Scenario['rest'] = {}): Scenario['rest'] {
  return {
    'GET /channels': { items: ROWS, total: 412 },
    'GET /suggestions': { items: [] },
    'GET /jobs': { items: [] },
    'GET /folders': { items: FOLDERS },
    // there is a model (the opening says which one answers)
    'GET /ai/status': { available: true, model: MODEL, reason: null },
    ...extra
  }
}

const show = (props: { jobId?: string; channelIds?: string[]; initial?: OrganizeSeed } = {}) => () => (
  <OrganizeDialog onClose={() => undefined} {...props} />
)

const ids = (list: Suggestion[]) => list.map((s) => s.id)
const accepted = (list: Suggestion[]) => Object.fromEntries(ids(list).map((id) => [id, 'accepted' as const]))

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'organize-intro',
    title: 'Organize · opening (412 channels without a folder, model, what will happen)',
    widths: WIDTHS,
    rest: base(),
    render: show()
  },
  {
    id: 'organize-intro-no-model',
    title: 'Organize · opening with no model set up (notice before the click)',
    widths: WIDTHS,
    rest: base({ 'GET /ai/status': { available: false, model: null, reason: 'no_model' } }),
    render: show()
  },
  {
    id: 'organize-loading',
    title: 'Organize · loading (opening skeleton)',
    widths: WIDTHS,
    rest: base({ 'GET /channels': () => new Promise(() => undefined) }),
    render: show()
  },
  {
    id: 'organize-selection',
    title: 'Organize · selection from Manage (3 channels)',
    widths: WIDTHS,
    rest: base({ 'GET /channels': { items: ROWS.slice(0, 3), total: 3 } }),
    render: show({ channelIds: CHANNELS.slice(0, 3).map((c) => c.id) })
  },
  {
    id: 'organize-progress',
    title: 'Organize · progress 120 of 400, suggestions arriving by batch',
    widths: WIDTHS,
    rest: base({
      'GET /jobs/{id}': job('running', { progress: { stage: 'organize', done: 120, total: 400, message: 'batch 2 of 7' } }),
      'GET /suggestions': { items: FIRST_BATCHES }
    }),
    render: show({ jobId: 'job_demo' })
  },
  {
    id: 'organize-cancel-failed',
    title: 'Organize · cancel failed (gateway without job.cancel): keeps following',
    widths: WIDTHS,
    rest: base({
      'GET /jobs/{id}': job('running', { progress: { stage: 'organize', done: 120, total: 400, message: 'batch 2 of 7' } }),
      'GET /suggestions': { items: FIRST_BATCHES }
    }),
    render: show({ jobId: 'job_demo', initial: { notice: 'cancel_failed' } })
  },
  {
    id: 'organize-busy',
    title: 'Organize · busy: following the organize run that was already going',
    widths: WIDTHS,
    rest: base({
      'GET /jobs/{id}': job('running', { progress: { stage: 'organize', done: 60, total: 400, message: 'batch 1 of 7' } }),
      'GET /suggestions': { items: FIRST_BATCHES.slice(0, 4) }
    }),
    render: show({ jobId: 'job_demo', initial: { notice: 'busy' } })
  },
  {
    id: 'organize-result',
    title: 'Organize · result: 24 channels in 5 folders (2 new)',
    widths: WIDTHS,
    rest: base({ 'GET /suggestions': { items: ALL } }),
    render: show()
  },
  {
    id: 'organize-actions',
    title: 'Organize · mid-review (group accepted, folder changed, one declined)',
    widths: WIDTHS,
    rest: base({ 'GET /suggestions': { items: ALL.filter((s) => s.payload.folder !== 'Ciência') } }),
    render: show({
      initial: {
        items: ALL,
        decisions: { ...accepted(ALL.filter((s) => s.payload.folder === 'Ciência')), sg_23: 'rejected' },
        edits: { [byTitle('Two Minute Papers').id]: 'Tecnologia/IA' },
        sessionGroups: [{ group: 'grp_demo', ids: ids(ALL.filter((s) => s.payload.folder === 'Ciência')) }]
      }
    })
  },
  {
    id: 'organize-accepted',
    title: 'Organize · all accepted + undo organize',
    widths: WIDTHS,
    // the channels already got a folder; the list only feeds the photos (in the real session they were already on screen)
    rest: base({ 'GET /suggestions': { items: [] } }),
    render: show({ initial: { items: ALL, decisions: accepted(ALL), sessionGroups: [{ group: 'grp_demo', ids: ids(ALL) }] } })
  },
  {
    id: 'organize-partial',
    title: 'Organize · partial error: one batch did not come back (retry the rest)',
    widths: WIDTHS,
    rest: base({
      'GET /jobs/{id}': job('done', {
        progress: { stage: 'organize', done: 24, total: 24, message: 'batch 1 of 1 · 1 batch(es) failed' },
        result: { suggestions: ALL.slice(0, 18), model: MODEL }
      }),
      'GET /suggestions': { items: ALL.slice(0, 18) },
      'GET /channels': { items: ROWS, total: ROWS.length }
    }),
    render: show({ jobId: 'job_demo' })
  },
  {
    id: 'organize-no-model',
    title: 'Organize · no model (explains and leads to settings)',
    widths: WIDTHS,
    rest: base(),
    render: show({ initial: { view: 'no_model' } })
  },
  {
    id: 'organize-provider-unavailable',
    title: "Organize · model configured, provider can't be reached (sign in again or pick another)",
    widths: WIDTHS,
    rest: base(),
    render: show({ initial: { view: 'provider_unavailable', aiRoute: 'claude-subscription · claude-sonnet-5-5' } })
  },
  {
    id: 'organize-intro-provider-unavailable',
    title: "Organize · opening when the provider can't be reached (notice before the click)",
    widths: WIDTHS,
    rest: base({ 'GET /ai/status': { available: false, model: 'claude-sonnet-5-5', reason: 'provider_unavailable', provider: 'claude-subscription' } }),
    render: show()
  },
  {
    id: 'organize-unavailable',
    title: 'Organize · no RPC on this backend',
    widths: WIDTHS,
    rest: base(),
    render: show({ initial: { view: 'unavailable' } })
  },
  {
    id: 'organize-error',
    title: 'Organize · job failed (try again)',
    widths: WIDTHS,
    rest: base({ 'GET /jobs/{id}': job('error', { error: { code: 'llm_invalid', message: 'The model response did not follow the format.' } }) }),
    render: show({ jobId: 'job_demo' })
  },
  {
    id: 'organize-nothing',
    title: 'Organize · nothing to organize (every channel in a folder)',
    widths: WIDTHS,
    rest: base({ 'GET /channels': { items: [], total: 0 } }),
    render: show()
  }
]
