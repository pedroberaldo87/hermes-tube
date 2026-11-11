// Preview scenarios behind the public screenshots (docs/screenshots/*.png) and the demo video frames, taken by
// scripts/docs-screenshots.mjs. Each one mounts a real screen over fake routes that answer only with the invented
// sample catalog (sample.ts, from docs/sample-data/catalog.json): no real channel, brand or person. The UI language
// comes from the page (`lang=en`). The Watch screen is staged here; its player stand-in shows the video's poster instead
// of the labeled frame (`__previewPlayerPoster`, preview/sdk.tsx). The topic dialog reuses its screen's render (same
// field frame); its preview comes from the routes below. Preview only (outside plugin.js).
import { useState } from 'react'
import { type Scenario, type ScenarioRequest, ShellPage } from '../../components'
import { scenarios as themeScenarios } from '../../dialogs/theme/preview.scenarios'
import { showSection } from '../../lib/nav'
import { $watch, LARGE_PLAYER_KEY, TIP_DISMISSED_KEY, type WatchState, setPlayerFlag, setWatchRenderer } from '../../lib/player'
import { createQueue, queueOriginOf, setQueue } from '../../lib/queue'
import { CleanupView } from '../../pages/cleanup'
import { HomeView } from '../../pages/home'
import { ManageView } from '../../pages/manage'
import { WatchPage } from '../../pages/watch'
import { PaneView } from '../../panes'
import {
  CLEANUP_IDS,
  CLEANUP_VIEW,
  FOLDERS,
  NEW_BY_CHANNEL,
  ROWS,
  TABS,
  TOPIC,
  TOPIC_FEED,
  TOPIC_TAB,
  channelByTitle,
  feedPage,
  status,
  topicPreview
} from './sample'

type Rest = NonNullable<Scenario['rest']>
type Req = ScenarioRequest

const EMPTY_PAGE = { items: [], next_cursor: null, counts: { total: 0, new: 0 } }
const bodyIds = (req: Req, key: string): string[] => ((req.body as Record<string, string[]> | undefined)?.[key] ?? []) as string[]

// ------------------------------------------------------------------ routes per screen

/** Subscriptions (Home): tabs, status, feed and what the page asks around them. */
const HOME_REST: Rest = {
  'GET /tabs': { items: TABS },
  'GET /status': status(),
  'GET /feed': (req) => feedPage(req),
  'GET /folders': { items: FOLDERS },
  'POST /feed/preview': EMPTY_PAGE,
  'POST /videos/state': (req) => ({ changed: bodyIds(req, 'video_ids').length }),
  'POST /read': { changed: 0, change_ids: [] },
  'POST /refresh': { result: 'started' },
  'GET /changes': { items: [] },
  'GET /ai/status': { available: true, model: 'claude-haiku-5-5', reason: null },
  'GET /jobs': { items: [] },
  'GET /extras': { honest_thumbnails: false, hn_lens: false, hn_channels: false, import_lists: false, hn_dataset_ready: false, hn_video_count: 0, hn_credit: '' }
}

/** Folder pane: the catalog folders with their channels and new counts. */
const PANE_REST: Rest = {
  'GET /folders': { items: FOLDERS },
  'GET /channels': { items: ROWS, total: ROWS.length },
  'GET /state': { counts: { total: Object.values(NEW_BY_CHANNEL).reduce((a, b) => a + b, 0), by_tab: {}, by_folder: {}, by_channel: NEW_BY_CHANNEL }, videos: {} },
  'GET /status': status(),
  'GET /tabs': { items: TABS.filter((t) => t.builtin) }
}

const MANAGE_REST: Rest = {
  'GET /channels': { items: ROWS, total: ROWS.length },
  'GET /folders': { items: FOLDERS },
  'GET /tags': { items: [] },
  'GET /status': status()
}

const CLEANUP_REST: Rest = {
  'GET /cleanup': CLEANUP_VIEW,
  'GET /status': status(),
  'GET /queue': { items: [], pending: 0 },
  // the screen's three uses: former subscriptions (none), rows by id, and the history check
  'GET /channels': (req) => {
    if (req.query.relation === 'ex') return { items: [], total: 0 }
    const ids = req.query.ids ? String(req.query.ids).split(',') : null
    const items = ids ? ROWS.filter((r) => ids.includes(r.channel.id)) : ROWS
    return { items, total: items.length }
  },
  'POST /cleanup/dismiss': (req) => ({ count: bodyIds(req, 'ids').length }),
  'POST /queue/undo': { items: [] }
}

/** The topic dialog: the preview of the catalog topic (its channels are not in the list). */
const TOPIC_REST: Rest = {
  'GET /themes/{id}': (req) => topicPreview(req.params.id ?? ''),
  'GET /channels': { items: [], total: 0 },
  'GET /ai/status': { available: true, model: 'claude-haiku-5-5', reason: null }
}

// ------------------------------------------------------------------ Watch (staged here)

const BY_ID = new Map(TOPIC_FEED.map((it) => [it.video.id, it]))
/** Opened from the topic tab: the first video plays, the rest of the tab is the queue. */
const CURRENT = TOPIC_FEED[0]

const WATCH_REST: Rest = {
  'GET /videos': (req) => ({ items: String(req.query.ids ?? '').split(',').map((id) => BY_ID.get(id)).filter(Boolean) }),
  'GET /folders': { items: FOLDERS },
  'POST /videos/state': (req) => ({ changed: bodyIds(req, 'video_ids').length }),
  'GET /status': status()
}

const SECTIONS = { home: () => <div />, watch: WatchPage }

/** The single page at the Watch section with a video opened from a tab (as a click would leave it). */
function WatchStage({ state }: { state: Omit<WatchState, 'seq'> }) {
  useState(() => {
    ;(globalThis as Record<string, unknown>).__previewPlayerPoster = true
    setWatchRenderer(() => <WatchPage />)
    setPlayerFlag(LARGE_PLAYER_KEY, false)
    setPlayerFlag(TIP_DISMISSED_KEY, true)
    const origin = queueOriginOf(state)
    setQueue(origin ? createQueue(origin, state.list, state.id) : null)
    $watch.set({ ...state, seq: 1 })
    showSection('watch', state.id)
    return true
  })
  return (
    <div style={{ height: '100vh' }}>
      <ShellPage sections={SECTIONS} />
    </div>
  )
}

// ------------------------------------------------------------------ scenarios

const PAGE = [1440]
const topicRender = themeScenarios.find((s) => s.id === 'theme-preview')?.render
if (!topicRender) throw new Error('screenshot scenario: no screen scenario "theme-preview"')

/** Five channels picked in Manage (two folders' worth). */
const MANAGE_SELECTED = ['Patch Cable Diaries', 'Beige Box Revival', 'Pocket Telescope Notes', 'Tide Pool Statistics', 'Cairn Path Rambles'].map((t) => channelByTitle(t).id)
/** The pane with every folder open (the six folders and their channels fill its height). */
const PANE_OPEN = FOLDERS.map((f) => `folder:${f.id}`)

export const scenarios: Scenario[] = [
  {
    id: 'docs-home',
    title: 'Screenshot · Subscriptions with the sample data (All new, comfortable grid)',
    widths: PAGE,
    rest: HOME_REST,
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" />
  },
  {
    id: 'docs-new-tab-menu',
    title: 'Screenshot · the "New tab" menu open (Category, Channels, Topic, Mixed)',
    widths: PAGE,
    rest: HOME_REST,
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" initialMenuOpen />
  },
  {
    id: 'docs-folder-pane',
    title: 'Screenshot · folder pane (folders, channels, new counts)',
    widths: [320],
    rest: PANE_REST,
    render: () => <PaneView initialExpanded={PANE_OPEN} />
  },
  {
    id: 'docs-manage',
    title: 'Screenshot · Manage with channels selected and the batch bar',
    widths: PAGE,
    rest: MANAGE_REST,
    render: () => <ManageView initial={{ filters: {}, selected: MANAGE_SELECTED }} />
  },
  {
    id: 'docs-cleanup',
    title: 'Screenshot · Cleanup with three sample channels, reasons and a selection to review',
    widths: PAGE,
    rest: CLEANUP_REST,
    render: () => <CleanupView initialSelected={CLEANUP_IDS.slice(0, 2)} />
  },
  {
    id: 'docs-topic-tab-preview',
    title: `Screenshot · New topic tab dialog showing the "${TOPIC.name}" preview`,
    widths: PAGE,
    rest: TOPIC_REST,
    render: topicRender
  },
  {
    id: 'docs-watching-tab',
    title: 'Screenshot · a video open in the Watch section, queued from the topic tab (player stand-in with the poster)',
    widths: PAGE,
    rest: WATCH_REST,
    render: () => <WatchStage state={{ id: CURRENT.video.id, item: CURRENT, list: TOPIC_FEED, source: TOPIC.name }} />
  },
  {
    id: 'docs-topic-tab',
    title: `Video frame · Subscriptions on the "${TOPIC.name}" topic tab`,
    widths: PAGE,
    rest: HOME_REST,
    render: () => <HomeView initialTab={TOPIC_TAB} initialDensity="comfortable" />
  }
]
