// Preview scenarios of the Watch section — the collector's fixed interface: each scenario mounts the REAL screen
// (`WatchPage`, the same one the app's center tab draws) with the `lib/player` state already set, over a fake `ctx`
// that answers from the `rest` map. The preview has no core player: the preview's `MessageTextContent`
// (preview/sdk.tsx) draws a 16:9 frame labeled "player do Hermes" in its place. Only the preview imports this
// file (outside plugin.js).
// Data: ids, titles, channels, durations and views of real videos (the same as the chat and Subscriptions previews);
// descriptions, states and the folder are illustrative.
import { useState } from 'react'
import type { Channel, FeedItem, Folder } from '../../../shared/api-types'
import { type Scenario, ShellPage } from '../../components'
import { showSection } from '../../lib/nav'
import { $watch, LARGE_PLAYER_KEY, TIP_DISMISSED_KEY, type WatchState, setPlayerFlag, setWatchRenderer } from '../../lib/player'
import { type Queue, createQueue, queueOriginOf, removeItem, setQueue } from '../../lib/queue'
import { WatchPage } from './index'

const WIDTHS = [420, 900, 1440]
const NOW_S = Math.floor(Date.now() / 1000)
const H = 3600

// ------------------------------------------------------------------ data

const FOLDERS: Folder[] = [
  { id: 'f-sci', name: 'Ciência', parent_id: null, color: null, sort: 0 } as unknown as Folder,
  { id: 'f-tech', name: 'Tecnologia', parent_id: null, color: null, sort: 1 } as unknown as Folder
]

const CHANNELS: Record<string, Pick<Channel, 'id' | 'title' | 'handle' | 'folder_id'>> = {
  UCYO_jab_esuFRV4b17AJtAw: { id: 'UCYO_jab_esuFRV4b17AJtAw', title: '3Blue1Brown', handle: '@3blue1brown', folder_id: 'f-sci' },
  UCXUPKJO5MZQN11PqgIvyuvQ: { id: 'UCXUPKJO5MZQN11PqgIvyuvQ', title: 'Andrej Karpathy', handle: '@AndrejKarpathy', folder_id: 'f-tech' },
  UCsBjURrPoezykLs9EqgamOA: { id: 'UCsBjURrPoezykLs9EqgamOA', title: 'Fireship', handle: '@Fireship', folder_id: 'f-tech' },
  UCsXVk37bltHxD1rDPwtNM8Q: { id: 'UCsXVk37bltHxD1rDPwtNM8Q', title: 'Kurzgesagt – In a Nutshell', handle: '@kurzgesagt', folder_id: 'f-sci' },
  'UCHnyfMqiRRG1u-2MsSQLbXA': { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Veritasium', handle: '@veritasium', folder_id: 'f-sci' }
}

type V = [id: string, channel: string, title: string, ageH: number, views: number, durationS: number, extra?: Partial<FeedItem>]

const DESCRIPTION = [
  'Unpacking the transformer: what attention does, why it is the heart of large language models, and how the pieces fit together.',
  'Chapters: 0:00 Predicting the next word · 3:03 Inside a transformer · 6:36 Chapter layout · 9:20 Word embeddings · 18:25 Unembedding · 22:22 Softmax with temperature.',
  'Help fund future projects and see the rest of the series on the channel.',
  'These lessons are made possible by viewers. Thank you.'
].join('\n')

const VIDEOS: V[] = [
  ['aircAruvnKk', 'UCYO_jab_esuFRV4b17AJtAw', 'But what is a neural network? | Deep learning chapter 1', 170, 21000000, 1150, { state: 'watched', is_new: false }],
  ['wjZofJX0v4M', 'UCYO_jab_esuFRV4b17AJtAw', 'Transformers, the tech behind LLMs | Deep Learning Chapter 5', 52, 6400000, 1648, { video: { description: DESCRIPTION } as never }],
  ['ujkD4SxPKOI', 'UCsXVk37bltHxD1rDPwtNM8Q', 'AI Just Crossed the Terrifying Line - Now What?', 60, 23852199, 912],
  ['VMj-3S1tku0', 'UCXUPKJO5MZQN11PqgIvyuvQ', 'The spelled-out intro to neural networks and backpropagation: building micrograd', 110, 9100000, 8822],
  ['G_em1hHPnXY', 'UCsBjURrPoezykLs9EqgamOA', 'China just dropped a new frontier model... and nobody can explain how', 190, 2474229, 304],
  ['nEaJMdM1djM', 'UCsBjURrPoezykLs9EqgamOA', 'Did the AI bubble just pop?', 90, 2677564, 296, { state: 'later', is_new: false }],
  ['HeQX2HjkcNo', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Math’s Fundamental Flaw', 300, 30000000, 2041],
  ['Ilg3gGewQ5U', 'UCYO_jab_esuFRV4b17AJtAw', 'Backpropagation, step by step | Deep learning chapter 3', 400, 5400000, 760],
  ['eMlx5fFNoYc', 'UCYO_jab_esuFRV4b17AJtAw', 'Attention in transformers, step-by-step | Deep Learning Chapter 6', 30, 3100000, 1570]
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
  const { video: videoExtra, ...rest } = extra ?? {}
  const folder = FOLDERS.find((f) => f.id === CHANNELS[channelId].folder_id)
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
      origin: 'rss',
      ...(videoExtra ?? {})
    },
    channel: channelOf(channelId),
    state: 'new',
    reaction: null,
    is_new: true,
    why: folder ? { via: 'folder', label: folder.name, detail: null } : null,
    badges: [],
    ...rest
  }
}

const LIST = VIDEOS.map(toItem)
const BY_ID = new Map(LIST.map((it) => [it.video.id, it]))
const CURRENT = LIST[1]
/** Public video the backend does not know. */
const UNKNOWN = 'zjkBMFhNj_g'

type Req = { query?: Record<string, unknown> }

const REST = {
  'GET /videos': (req: Req) => ({ items: String(req.query?.ids ?? '').split(',').map((id) => BY_ID.get(id)).filter(Boolean) }),
  'GET /folders': { items: FOLDERS },
  'POST /videos/state': (req: { body?: unknown }) => ({ changed: (req.body as { video_ids?: string[] })?.video_ids?.length ?? 0 }),
  'GET /status': {}
}

// ------------------------------------------------------------------ stage: the single page at the Watch section

/** Stands in for the Subscriptions section (only reached by Back, which the preview does not click). */
function HomeStandIn() {
  return <div />
}

const SECTIONS = { home: HomeStandIn, watch: WatchPage }

interface StageOptions {
  large?: boolean
  tipDismissed?: boolean
  /** Edits on the queue copied from the list (as the user would make them). */
  edit?: (q: Queue) => Queue
}

/**
 * Sets the player state (as a click would: the queue is a copy of the list) and mounts the single page at the Watch
 * section: the real header (Back, brand, internal tabs with the Watch tab) and the real screen. Without a video: the
 * screen alone (its empty state).
 */
function Stage({ state, large = false, tipDismissed = false, edit }: { state: Omit<WatchState, 'seq'> | null } & StageOptions) {
  useState(() => {
    setWatchRenderer(() => <WatchPage />)
    setPlayerFlag(LARGE_PLAYER_KEY, large)
    setPlayerFlag(TIP_DISMISSED_KEY, tipDismissed)
    const origin = state ? queueOriginOf(state) : null
    const queue = state && origin ? createQueue(origin, state.list, state.id) : null
    setQueue(queue && edit ? edit(queue) : queue)
    $watch.set(state ? { ...state, seq: 1 } : null)
    if (state) showSection('watch', state.id)
    return true
  })
  return <div style={{ height: '100vh' }}>{state ? <ShellPage sections={SECTIONS} /> : <WatchPage />}</div>
}

const fromTab = (item: FeedItem, over: Partial<WatchState> = {}) => ({ id: item.video.id, item, list: LIST, source: 'Ciência', ...over })

// ------------------------------------------------------------------ scenarios

export const scenarios: Scenario[] = [
  {
    id: 'watch-tab',
    title: 'Watch · opened from a tab (Up next, description collapsed)',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage state={fromTab(CURRENT)} />
  },
  {
    id: 'watch-watched',
    title: 'Watch · already watched and liked (reason: topic; folder in the chip)',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Stage
        tipDismissed
        state={fromTab({ ...CURRENT, state: 'watched', reaction: 'up', is_new: false, why: { via: 'theme', label: 'Como funcionam os LLMs', detail: null } })}
      />
    )
  },
  {
    id: 'watch-larger',
    title: 'Watch · "Larger player" on (zoom on the core player; Up next beside it follows the height)',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage large tipDismissed state={fromTab(CURRENT)} />
  },
  {
    id: 'watch-queue-end',
    title: 'Watch · the last video of the queue (the list scrolled to it; "end of the queue")',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage tipDismissed state={fromTab(LIST[LIST.length - 1])} />
  },
  {
    id: 'watch-queue-empty',
    title: 'Watch · every video removed from the queue (the video keeps playing)',
    widths: WIDTHS,
    rest: REST,
    render: () => (
      <Stage
        tipDismissed
        state={fromTab(CURRENT, { list: [CURRENT] })}
        edit={(q) => removeItem(q, CURRENT.video.id).queue}
      />
    )
  },
  {
    id: 'watch-chat',
    title: 'Watch · opened from chat (id only; no Up next)',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage state={{ id: LIST[3].video.id, item: null, list: [], source: null }} />
  },
  {
    id: 'watch-unknown',
    title: 'Watch · video outside the library (removed or never seen)',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage state={{ id: UNKNOWN, item: null, list: [], source: null }} />
  },
  {
    id: 'watch-error',
    title: 'Watch · error fetching the data',
    widths: WIDTHS,
    rest: {
      ...REST,
      'GET /videos': () => {
        throw { code: 'internal', message: 'database is locked' }
      }
    },
    render: () => <Stage state={{ id: LIST[2].video.id, item: null, list: [], source: null }} />
  },
  {
    id: 'watch-empty',
    title: 'Watch · nothing playing',
    widths: WIDTHS,
    rest: REST,
    render: () => <Stage state={null} />
  }
]
