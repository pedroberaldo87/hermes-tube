// Preview scenarios of the New topic tab dialog (the collector's fixed interface): each scenario mounts the
// REAL dialog over a fake `ctx` that answers from the `rest` map (key = contract route, value = the `data` of the
// envelope or a function; throwing `{code, message}` simulates an error) and `rpc`. The steps come through the job (`GET /jobs/{id}`
// with the `progress` of that moment) and the numbers already seen through `initial.counts` (what the dialog keeps in
// storage to resume). Only the preview imports this file (outside the bundle).
// Data: real videos and channels (Fireship, Andrej Karpathy, 3Blue1Brown); reasons and numbers are illustrative.
import type { ReactNode } from 'react'
import type { ChannelRow, Job, Progress, ThemePreview, ThemeStep, Video } from '../../../shared/api-types'
import type { Scenario } from '../../components'
import { ThemeDialog, type ThemeSeedState } from './index'

const WIDTHS = [420, 900]

/**
 * PREVIEW ONLY: the `Input` stand-in in `test/sdk-mock.ts` (the preview's SDK) has no frame, and the
 * field would show in the screenshots as loose text. In Desktop the SDK's `Input` has the `desktop-input-chrome` frame
 * (card background, rule, 2.5 px radius, padding 6/10); here it is reproduced with the same app variables, so the
 * screenshot shows the field as it is. Not in the bundle (scenarios are preview only).
 */
const INPUT_CHROME = [
  '[data-slot="input"]{box-sizing:border-box;width:100%;min-width:0;padding:6px 10px;border:1px solid ',
  'color-mix(in srgb,var(--dt-composer-ring,var(--ui-stroke-secondary)) var(--dt-input-border,100%),transparent);',
  'border-radius:2.5px;background:color-mix(in srgb,var(--dt-card,var(--ui-bg-quinary)) var(--dt-input-bg,100%),transparent);',
  'box-shadow:var(--dt-input-inset,none);font-size:12px;line-height:16px;color:var(--ui-text-primary);outline:none}',
  '[data-slot="input"]::placeholder{color:var(--ui-text-tertiary)}',
  '[data-slot="input"]:focus{border-color:var(--dt-composer-ring,var(--ui-stroke-primary))}',
  '[data-slot="input"]:disabled{opacity:.5}'
].join('')
const withChrome = (node: ReactNode) => (
  <>
    <style>{INPUT_CHROME}</style>
    {node}
  </>
)
const nowS = () => Math.floor(Date.now() / 1000)
const DAY = 86_400

// ------------------------------------------------------------------ data

const CH = {
  fireship: { id: 'UCsBjURrPoezykLs9EqgamOA', title: 'Fireship', thumb: 'https://yt3.googleusercontent.com/3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s176-c-k-c0x00ffffff-no-rj' },
  karpathy: { id: 'UCXUPKJO5MZQN11PqgIvyuvQ', title: 'Andrej Karpathy', thumb: 'https://yt3.googleusercontent.com/ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz=s176-c-k-c0x00ffffff-no-rj' },
  b1b: { id: 'UCYO_jab_esuFRV4b17AJtAw', title: '3Blue1Brown', thumb: 'https://yt3.googleusercontent.com/ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s176-c-k-c0x00ffffff-no-rj' }
}

type Row = [id: string, ch: keyof typeof CH, title: string, ageDays: number, durationS: number, views: number, reason: string, source?: 'search' | 'classics']

const ROWS: Row[] = [
  ['I_KVMFrUtPk', 'fireship', 'Did a 50 year old military secret just solve agent prompt injection?', 6, 312, 1_240_000, 'Segurança de agentes, direto ao ponto'],
  ['7xTGNNLPyMI', 'karpathy', 'Deep Dive into LLMs like ChatGPT', 280, 12_614, 4_100_000, 'Base sólida de como os modelos funcionam', 'classics'],
  ['wjZofJX0v4M', 'b1b', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 560, 1_648, 7_900_000, 'Explicação visual da arquitetura', 'classics'],
  ['nEaJMdM1djM', 'fireship', 'Did the AI bubble just pop?', 12, 289, 2_300_000, 'Contexto do mercado de agentes'],
  ['VMj-3S1tku0', 'karpathy', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 1_100, 8_822, 2_900_000, 'Fundamentos para quem constrói agentes', 'classics'],
  ['G_em1hHPnXY', 'fireship', 'China just dropped a new frontier model... and nobody can explain how', 18, 301, 1_800_000, 'Modelos novos que movem agentes'],
  ['aircAruvnKk', 'b1b', 'But what is a neural network? | Deep learning chapter 1', 2_400, 1_150, 19_000_000, 'Primeiro passo recomendado', 'classics'],
  ['b2tjnxX8IHU', 'fireship', 'Did Google just dethrone OpenAI and Anthropic?', 25, 276, 1_500_000, 'Disputa entre os laboratórios']
]

function video([id, ch, title, ageDays, durationS, views]: Row): Video {
  return {
    id,
    channel_id: CH[ch].id,
    title,
    published_at: nowS() - ageDays * DAY,
    description: null,
    channel_title: CH[ch].title,
    duration_s: durationS,
    is_short: false,
    views,
    first_seen_at: nowS(),
    origin: 'search'
  }
}

function preview(over: { rows?: Row[]; error?: string | null; status?: 'preview' | 'saved'; query?: string } = {}): ThemePreview {
  const rows = over.rows ?? ROWS
  const videos: Record<string, Video> = {}
  for (const r of rows) videos[r[0]] = video(r)
  return {
    theme: {
      id: 'th_ai',
      query: over.query ?? 'agentes de IA',
      status: over.status ?? 'preview',
      created_at: nowS() - 60,
      name: 'Agentes de IA',
      icon: '🤖',
      tab_id: over.status === 'saved' ? 'tab_ai' : null,
      searches: ['agentes de IA', 'AI agents tutorial'],
      seeds: rows.length ? [CH.fireship.id, CH.karpathy.id, CH.b1b.id] : [],
      include_terms: [],
      exclude_terms: [],
      last_search_at: nowS() - 30,
      cadence_days: 7,
      error: over.error ?? null
    },
    items: rows.map((r, i) => ({ theme_id: 'th_ai', video_id: r[0], verdict: 'keep', source: r[7] ?? 'search', score: 0.92 - i * 0.03, reason: r[6] })),
    videos,
    seeds: rows.length
      ? [
          { channel_id: CH.fireship.id, title: CH.fireship.title, kept_videos: 4 },
          { channel_id: CH.karpathy.id, title: CH.karpathy.title, kept_videos: 3 },
          { channel_id: CH.b1b.id, title: CH.b1b.title, kept_videos: 3 }
        ]
      : [],
    channel_count: rows.length ? 3 : 0
  }
}

/** Fireship is already in your list (subscribed): no choice. The other two come only from the search. */
const CHANNELS: { items: ChannelRow[]; total: number } = {
  items: [
    {
      channel: {
        id: CH.fireship.id,
        title: CH.fireship.title,
        relation: 'subscribed',
        source: 'extension',
        added_at: nowS() - 400 * DAY,
        handle: '@Fireship',
        thumb: CH.fireship.thumb,
        url: 'https://www.youtube.com/@Fireship',
        folder_id: null,
        favorite: false,
        muted: false,
        unsubscribed_at: null,
        last_video_at: nowS() - 6 * DAY,
        videos_per_week: 3,
        shorts_ratio: 0.1,
        ai_note: null,
        tag_ids: []
      },
      new_count: 1,
      watched_90d: 4
    }
  ],
  total: 1
}

function job(status: Job['status'], progress: Progress | null, extra: Partial<Job> = {}): Job {
  return { id: 'job_3', kind: 'theme', status, created_at: nowS() - 20, updated_at: nowS(), progress, result: null, error: null, ...extra }
}

/** Progress as the core sends it; `step` = structured numbers (`[done, total]`). */
const P = (stage: string, done: number, total: number | null, message: string | null, step?: [number, number | null]): Progress => ({
  stage,
  done,
  total,
  message,
  ...(step ? { step: { name: stage as ThemeStep, done: step[0], total: step[1] } } : {})
})

/** The field asks `GET /ai/status` when it opens. */
const AI_OK = { 'GET /ai/status': { available: true, model: 'claude-haiku-5-5', reason: null } }
/** A model is configured, but its provider refused the sign-in a moment ago. */
const UNREACHABLE = { available: false, model: 'claude-sonnet-5-5', reason: 'provider_unavailable', provider: 'claude-subscription' }

const close = () => undefined

const atJob = (initial?: ThemeSeedState) => () => withChrome(<ThemeDialog onClose={close} jobId="job_3" initial={initial} />)
const atTheme = (initial?: ThemeSeedState) => () => withChrome(<ThemeDialog onClose={close} themeId="th_ai" initial={initial} />)
const atForm = (initial: ThemeSeedState) => () => withChrome(<ThemeDialog onClose={close} initial={initial} />)

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'theme-form',
    title: 'New topic tab · initial field',
    widths: WIDTHS,
    rest: AI_OK,
    render: atForm({ draft: '' })
  },
  {
    id: 'theme-form-filled',
    title: 'New topic tab · filled field with options',
    widths: WIDTHS,
    rest: AI_OK,
    render: atForm({ draft: 'agentes de IA', options: { language: 'pt', classics: true } })
  },
  {
    id: 'theme-form-no-model',
    title: 'New topic tab · no model set up (notice before the click)',
    widths: WIDTHS,
    rest: { 'GET /ai/status': { available: false, model: null, reason: 'no_model' } },
    render: atForm({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-expand',
    title: 'New topic tab · expanding the topic',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('running', P('expand', 0, 1, 'Understanding the topic…', [0, null])) },
    render: atJob({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-search',
    title: 'New topic tab · searching',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('running', P('search', 0, 16, 'Running 8 YouTube searches…', [0, null]), { created_at: nowS() - 9 }) },
    render: atJob({ draft: 'agentes de IA', counts: { searches: 8 } })
  },
  {
    id: 'theme-curate',
    title: 'New topic tab · curating',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('running', P('curate', 2, 4, '80 of 160 videos rated', [80, 160]), { created_at: nowS() - 83 }) },
    render: atJob({ draft: 'agentes de IA', counts: { searches: 8, found: 160 } })
  },
  {
    id: 'theme-cancel-failed',
    title: 'New topic tab · cancel failed (gateway without job.cancel): keeps following',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('running', P('curate', 2, 4, '80 of 160 videos rated', [80, 160]), { created_at: nowS() - 95 }) },
    render: atJob({ draft: 'agentes de IA', counts: { searches: 8, found: 160 }, cancelFailed: true })
  },
  {
    id: 'theme-building',
    title: 'New topic tab · building the preview',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('running', P('preview', 1, 1, '37 videos from 3 channels', [37, 160])) },
    render: atJob({ draft: 'agentes de IA', counts: { searches: 8, found: 160, rated: 160 } })
  },
  {
    id: 'theme-preview',
    title: 'New topic tab · full preview',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': preview(), 'GET /channels': CHANNELS },
    render: atTheme()
  },
  {
    id: 'theme-preview-edited',
    title: 'New topic tab · preview with 👎, ignored seed and folder',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': preview(), 'GET /channels': CHANNELS },
    render: atTheme({ removed: ['nEaJMdM1djM'], choices: { [CH.karpathy.id]: 'follow', [CH.b1b.id]: 'ignore' }, createFolder: true })
  },
  {
    id: 'theme-partial',
    title: 'New topic tab · partial preview (time ran out)',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': preview({ rows: ROWS.slice(0, 5), error: 'Partial preview: time ran out with 120 of 212 rated.' }), 'GET /channels': CHANNELS },
    render: atTheme()
  },
  {
    id: 'theme-saving',
    title: 'New topic tab · saving',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': preview(), 'GET /channels': CHANNELS },
    render: atTheme({ saving: true, createFolder: true })
  },
  {
    id: 'theme-saved',
    title: 'New topic tab · topic that already became a tab',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': preview({ status: 'saved' }), 'GET /channels': CHANNELS },
    render: atTheme()
  },
  {
    id: 'theme-loading',
    title: 'New topic tab · loading the preview (skeleton)',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': () => new Promise(() => undefined) },
    render: atTheme()
  },
  {
    id: 'theme-empty',
    title: 'New topic tab · empty search',
    widths: WIDTHS,
    rest: {
      'GET /themes/{id}': preview({ rows: [], query: 'xilogravura em marfim lunar', error: 'No videos found for this topic. Try other words.' })
    },
    render: atTheme()
  },
  {
    id: 'theme-no-model',
    title: 'New topic tab · no AI model',
    widths: WIDTHS,
    rest: {
      'GET /jobs/{id}': job('error', P('expand', 0, 1, null, [0, null]), { error: { code: 'llm_unavailable', message: 'No model set up.' } }),
      'GET /ai/status': { available: false, model: null, reason: 'no_model' }
    },
    render: atJob({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-provider-unavailable',
    title: "New topic tab · model configured, provider can't be reached (sign in again)",
    widths: WIDTHS,
    rest: {
      'GET /jobs/{id}': job('error', P('expand', 0, 1, null, [0, null]), { error: { code: 'llm_unavailable', message: 'unreachable' } }),
      'GET /ai/status': UNREACHABLE
    },
    render: atJob({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-form-provider-unavailable',
    title: "New topic tab · provider can't be reached (notice before the click)",
    widths: WIDTHS,
    rest: { 'GET /ai/status': UNREACHABLE },
    render: atForm({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-busy',
    title: 'New topic tab · a topic is already being built',
    widths: WIDTHS,
    rest: { 'GET /jobs': { items: [] } },
    rpc: { 'theme.create': () => { throw { code: 'busy', message: 'One topic at a time.' } } },
    render: atForm({ draft: 'agentes de IA', view: 'busy' })
  },
  {
    id: 'theme-error',
    title: 'New topic tab · search error',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': job('error', P('search', 0, 16, null, [0, null]), { error: { code: 'youtube_error', message: 'The YouTube search failed.' } }) },
    render: atJob({ draft: 'agentes de IA', counts: { searches: 8 } })
  },
  {
    id: 'theme-expired',
    title: 'New topic tab · the saved search expired',
    widths: WIDTHS,
    rest: { 'GET /jobs/{id}': () => { throw { code: 'not_found', message: 'job not found' } } },
    render: atJob({ draft: 'agentes de IA' })
  },
  {
    id: 'theme-load-error',
    title: 'New topic tab · error opening the preview',
    widths: WIDTHS,
    rest: { 'GET /themes/{id}': () => { throw { code: 'internal', message: 'database is locked' } } },
    render: atTheme()
  }
]
