// Preview scenarios of the chat card — the collector's fixed interface: each scenario mounts the
// REAL card (`ChatVideoCard`, the same one the directive renders) over a fake `ctx` that answers from the
// `rest` map (value = the envelope's `data`, or a function; throwing `{code, message}` simulates an error). Only the preview
// imports this file (outside plugin.js).
// The column mimics an agent reply: paragraphs with the app chat's spacing (`--paragraph-gap`) and each
// directive as its own block, as Desktop mounts it (one sibling per directive, no wrapper).
// Data: ids, titles, channels, durations and views of real videos (the same as the Subscriptions preview);
// states (watched/later) are illustrative. The demo scene: "build a tab about AI agents".
import type { CSSProperties, ReactNode } from 'react'
import type { Channel, FeedItem } from '../../shared/api-types'
import type { Scenario } from '../components'
import { cx } from '../lib/style'
import { ChatVideoCard, MascotSettings } from './index'

const WIDTHS = [360, 600, 900]
const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600

// ------------------------------------------------------------------ data

const CHANNELS: Record<string, Pick<Channel, 'id' | 'title' | 'handle'>> = {
  UCYO_jab_esuFRV4b17AJtAw: { id: 'UCYO_jab_esuFRV4b17AJtAw', title: '3Blue1Brown', handle: '@3blue1brown' },
  UCXUPKJO5MZQN11PqgIvyuvQ: { id: 'UCXUPKJO5MZQN11PqgIvyuvQ', title: 'Andrej Karpathy', handle: '@AndrejKarpathy' },
  UCsBjURrPoezykLs9EqgamOA: { id: 'UCsBjURrPoezykLs9EqgamOA', title: 'Fireship', handle: '@Fireship' },
  UCsXVk37bltHxD1rDPwtNM8Q: { id: 'UCsXVk37bltHxD1rDPwtNM8Q', title: 'Kurzgesagt – In a Nutshell', handle: '@kurzgesagt' },
  'UCHnyfMqiRRG1u-2MsSQLbXA': { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Veritasium', handle: '@veritasium' }
}

type V = [id: string, channel: string, title: string, ageH: number, views: number, durationS: number, extra?: Partial<FeedItem>]

const VIDEOS: V[] = [
  ['wjZofJX0v4M', 'UCYO_jab_esuFRV4b17AJtAw', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 340, 6400000, 1648],
  ['VMj-3S1tku0', 'UCXUPKJO5MZQN11PqgIvyuvQ', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 110, 9100000, 8822],
  ['ujkD4SxPKOI', 'UCsXVk37bltHxD1rDPwtNM8Q', 'AI Just Crossed the Terrifying Line - Now What?', 260, 23852199, 912, { is_new: true }],
  ['G_em1hHPnXY', 'UCsBjURrPoezykLs9EqgamOA', 'China just dropped a new frontier model... and nobody can explain how', 190, 2474229, 304],
  ['aircAruvnKk', 'UCYO_jab_esuFRV4b17AJtAw', 'But what is a neural network? | Deep learning chapter 1', 170, 21000000, 1150, { state: 'watched' }],
  ['nEaJMdM1djM', 'UCsBjURrPoezykLs9EqgamOA', 'Did the AI bubble just pop?', 90, 2677564, 296, { state: 'later' }]
]

function channelOf(id: string): Channel {
  const c = CHANNELS[id]
  return {
    ...c,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S - 400 * 86400,
    thumb: null,
    url: `https://www.youtube.com/${c.handle}`,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: NOW_S - 5 * H,
    videos_per_week: 1,
    shorts_ratio: 0,
    ai_note: null,
    tag_ids: []
  }
}

function toItem([id, channelId, title, ageH, views, durationS, extra]: V): FeedItem {
  return {
    video: {
      id,
      channel_id: channelId,
      title,
      published_at: NOW_S - ageH * H,
      description: null,
      channel_title: CHANNELS[channelId].title,
      duration_s: durationS,
      is_short: false,
      views,
      first_seen_at: NOW_S - ageH * H + 600,
      origin: 'search'
    },
    channel: channelOf(channelId),
    state: 'seen',
    reaction: null,
    is_new: false,
    why: null,
    badges: [],
    ...extra
  }
}

const ITEMS = new Map(VIDEOS.map((v) => [v[0], toItem(v)]))
const [TRANSFORMERS, MICROGRAD, KURZ, FIRESHIP, NEURAL, BUBBLE] = VIDEOS.map((v) => v[0])
/** Public video the backend does not know (minimal card). */
const UNKNOWN = 'zjkBMFhNj_g'

type Req = { query?: Record<string, unknown> }

/** `GET /videos` like the server: known items in the requested order; unknown ones are left out. */
function videos(req: Req) {
  const ids = String(req.query?.ids ?? '').split(',')
  return { items: ids.map((id) => ITEMS.get(id)).filter(Boolean) }
}

const pending = () => new Promise<never>(() => undefined)

const REST = {
  'GET /videos': videos,
  'POST /videos/state': (req: { body?: unknown }) => ({ changed: (req.body as { video_ids?: string[] })?.video_ids?.length ?? 0 }),
  'GET /status': {}
}

// ------------------------------------------------------------------ frame: an agent reply

const COLUMN: CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '16px 16px 24px' }
const PARA: CSSProperties = { margin: 'var(--paragraph-gap, 0.7rem) 0 0' }

function Reply({ children }: { children: ReactNode }) {
  return <div style={COLUMN}>{children}</div>
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className={cx('t-body')} style={PARA}>
      {children}
    </p>
  )
}

const card = (id: string, extra: Record<string, string> = {}) => {
  const attrs = { id, ...extra }
  const source = `::tube-video{${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')}}`
  return <ChatVideoCard key={source} attrs={attrs} source={source} streaming={false} sessionId={null} />
}

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'chat-one',
    title: 'Chat · 1 card',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Reply>
        <P>To start from the foundation, this is the best starting point on transformers:</P>
        {card(TRANSFORMERS)}
        <P>Want me to create the “AI agents” tab with it and about 20 more?</P>
      </Reply>
    )
  },
  {
    id: 'chat-stack',
    title: 'Chat · 4 stacked cards',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Reply>
        <P>I built the “AI agents” tab. The four that best match what you watch:</P>
        {card(TRANSFORMERS)}
        {card(MICROGRAD)}
        {card(KURZ)}
        {card(FIRESHIP)}
        <P>The tab is already in your Subscriptions, with 24 videos.</P>
      </Reply>
    )
  },
  {
    id: 'chat-states',
    title: 'Chat · watched and later (states the user marked)',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Reply>
        <P>Of the ones you already had:</P>
        {card(NEURAL)}
        {card(BUBBLE)}
      </Reply>
    )
  },
  {
    id: 'chat-loading',
    title: 'Chat · loading (real thumbnail + text skeleton)',
    widths: WIDTHS,
    rest: { ...REST, 'GET /videos': () => pending() },
    render: () => (
      <Reply>
        <P>I found these:</P>
        {card(TRANSFORMERS)}
        {card(MICROGRAD)}
        {card(KURZ)}
      </Reply>
    )
  },
  {
    id: 'chat-unknown',
    title: 'Chat · unknown video (minimal card) in the stack',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Reply>
        <P>One from your library and one I found outside it:</P>
        {card(MICROGRAD)}
        {card(UNKNOWN)}
      </Reply>
    )
  },
  {
    id: 'chat-invalid',
    title: 'Chat · invalid directive becomes text (short id, HTML, extra attribute)',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Reply>
        <P>The model wrote three wrong directives and one right one:</P>
        {card('dQw4w9WgXc')}
        {card('"><img src=x onerror=alert(1)>')}
        {card(TRANSFORMERS, { title: 'extra' })}
        {card(TRANSFORMERS)}
      </Reply>
    )
  },
  {
    id: 'chat-error',
    title: 'Chat · error (plain link + try again)',
    widths: WIDTHS,
    rest: {
      ...REST,
      'GET /videos': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    },
    render: () => (
      <Reply>
        <P>These are the videos:</P>
        {card(TRANSFORMERS)}
        {card(MICROGRAD)}
      </Reply>
    )
  },
  {
    id: 'chat-narrow',
    title: 'Chat · narrow (actions over the corner, no shortcut)',
    widths: [300, 360],
    rest: REST,
    render: () => (
      <Reply>
        <P>The two most recent:</P>
        {card(KURZ)}
        {card(FIRESHIP)}
        {card(UNKNOWN)}
      </Reply>
    )
  },
  {
    id: 'chat-mascot-setting',
    title: 'Chat · mascot setting',
    widths: [360, 600],
    render: () => (
      <Reply>
        <MascotSettings />
      </Reply>
    )
  }
]
