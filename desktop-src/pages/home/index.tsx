// Subscriptions: the screen that opens the demo video. Built only from the kit (docs/design/DESIGN.md).
//   header     title · "N new · updated X ago" (live, from /status) · Extras · Refresh (Subscriptions is read-only:
//              no accent button)
//   bar        TabBar from GET /tabs + "Watch later" + "Playlists" (./playlists), counters from /status.new_by_tab;
//              remembered tab (ctx.storage);
//              "+ New tab" at the end of the bar (addSlot) with the type menu anchored to it — the only one on the screen
//   strip      one at a time: arriving (demo/link) › flaky YouTube RSS › extension never connected › disconnected
//   body       search/chips + sort/group (per source, remembered) + density (remembered; icons when narrow) ·
//              highlight (comfortable, no grouping) · Grid of VideoCard paged by cursor with continuous loading
//              (grouped: one Grid per group, collapsible header, keyboard crosses them) · optimistic quick actions
//   pane       while open, follows the pane's choice (tab, or folder/channel without a tab = filtered feed)
//   empty      zero channels → welcome (Hero + 3 paths); tab with nothing new → calm + see all/show watched
// Rules: no other screen/dialog imported (openDialog, host.navigate); all text through useT('home').
import {
  Button,
  Codicon,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tip,
  host
} from '@hermes/plugin-sdk'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FeedItem, StatusResponse, Tab } from '../../../shared/api-types'
import {
  Banner,
  DENSITIES,
  type Density,
  EmptyView,
  ErrorView,
  FilterBar,
  GRID_SHORTCUTS,
  Grid,
  GridSkeleton,
  ModeSwitch,
  Page,
  type QuickAction,
  QuickActions,
  Section,
  SectionFrame,
  Stack,
  type TabBarItem,
  TabBar,
  TabBarSkeleton,
  type TabMenuEntry,
  Toolbar,
  VideoCard,
  type VideoCardVariant,
  cardVariantFor,
  formatNumber,
  formatRelative,
  useInGrid,
  useLocale,
  useStandardQuickActions
} from '../../components'
import { PlaylistPicker } from '../../components/PlaylistPicker'
import { openDialog } from '../../lib/dialogs'
import { useNeverPaired } from '../../lib/ext-notice'
import { EXTRAS_PAGE_READY } from '../../lib/extras'
import { type ThemeBuildEnd, formatElapsed, retryThemeBuild, useAiStatus, useNowTicker, useThemeBuild } from '../../lib/jobs'
import { isVideoId, openVideo } from '../../lib/format'
import { type Translate, errorText, useT } from '../../lib/i18n'
import { showSection, useNavDetail, useNavRestore } from '../../lib/nav'
import { togglePane, usePaneShown } from '../../lib/pane-visibility'
import { OpenModeSwitch } from '../../lib/player'
import { invalidateRest, restCall, toApiError, useRest } from '../../lib/rest'
import { cx } from '../../lib/style'
import { openPlaylistPicker } from '../../lib/video-actions'
import { UNDO_MS, type VideoAction, canMarkRead, isVideoAction, readScopeOf, useMarkRead, useVideoActions } from './actions'
import { pickBanner } from './banners'
import { type FeedOrder, type FeedSource, LATER_TAB, type ScopeFilter, serverOrder, serverSearch, useFeed } from './feed'
import { type PaneTarget, exactTabFor, usePaneLink } from './pane-link'
import { PLAYLISTS_TAB, PlaylistsView } from './playlists'
import { DEFAULT_VIEW, type ListView, STORAGE_KEYS, type ViewMap, isDensity, isText, readPref, readViewMap, writePref } from './prefs'
import { type FeedRun, GroupedGrids, ViewControls, browserTzOffsetMin, effectiveView, groupsFor, runsOf } from './view'
import { type Arriving, Welcome } from './Welcome'

export { STORAGE_KEYS } from './prefs'
export { LATER_TAB } from './feed'
export { PLAYLISTS_TAB } from './playlists'

/** Faster polling while something is arriving (refresh running, demo, pasted channel). */
const FAST_POLL_MS = 3000
/** Clock of the "updated X ago". */
const CLOCK_MS = 30_000
/** After this the arriving strip goes away even without a video (RSS down: the demo arrives slowly). */
const ARRIVING_MAX_MS = 180_000
/** Typing delay of the search before `GET /feed?q=`. */
const SEARCH_DEBOUNCE_MS = 250
/** Below this body width, the density becomes icons (the label stays in the aria-label/tooltip). */
const NARROW_PX = 560
/** Grid shortcuts: the kit's 3 + 👍 (u), 👎 (d) and "Add to playlist" (p). */
const SHORTCUTS: Readonly<Record<string, string>> = { ...GRID_SHORTCUTS, u: 'up', d: 'down', p: 'playlist' }
const BUILTIN_TABS = new Set(['all-new', 'favorites'])
const CODICON_NAME = /^[a-z][a-z0-9-]*$/
const KIND_ICON: Record<string, string> = { category: 'folder', channels: 'account', theme: 'sparkle', mixed: 'layers' }
const BUILTIN_ICON: Record<string, string> = { 'all-new': 'inbox', favorites: 'star-full' }
const DENSITY_ICON: Record<Density, string> = { comfortable: 'preview', compact: 'extensions', list: 'list-flat' }
const MORE_SKELETON: Record<Density, number> = { comfortable: 4, compact: 6, list: 3 }
const NO_KEYS: ReadonlySet<string> = new Set()

// ------------------------------------------------------------------ pure helpers

/**
 * Tabs in optimistic order: the ids in `order` first, in the given order; a tab not listed (created
 * meanwhile) comes after, in server order. Without `order`, the server's.
 */
export function withOrder(tabs: readonly Tab[], order: readonly string[] | null): Tab[] {
  if (!order) return [...tabs]
  const pos = new Map(order.map((id, i) => [id, i]))
  const rank = (t: Tab, i: number) => pos.get(t.id) ?? order.length + i
  return tabs
    .map((t, i) => [t, rank(t, i)] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([t]) => t)
}

/** The tab's own emoji (an icon that is not a codicon name). */
function tabEmoji(tab: Tab): string | null {
  return tab.icon && !CODICON_NAME.test(tab.icon) ? tab.icon : null
}

function tabLabel(tab: Tab, t: Translate): string {
  if (tab.builtin && BUILTIN_TABS.has(tab.id)) return t(`tabs.${tab.id}`)
  const emoji = tabEmoji(tab)
  return emoji && !tab.name.startsWith(emoji) ? `${emoji} ${tab.name}` : tab.name
}

/** The tab's icon (codicon). A tab with its own emoji shows only the emoji (in the label), never two icons. */
function tabIcon(tab: Tab): string | null {
  if (tab.icon && CODICON_NAME.test(tab.icon)) return tab.icon
  if (tab.builtin && BUILTIN_ICON[tab.id]) return BUILTIN_ICON[tab.id]
  if (tabEmoji(tab)) return null
  return KIND_ICON[tab.kind] ?? null
}

/** Search ignoring accents and case (only in "show watched": the preview has no `q`; the rest searches on the server). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Value after `ms` without change (typing delay); empty passes at once (clearing does not wait). */
function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (!value) {
      setSettled('')
      return
    }
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return value ? settled : ''
}

function matches(item: FeedItem, needle: string): boolean {
  if (!needle) return true
  const hay = fold(`${item.video.title} ${item.channel?.title ?? item.video.channel_title ?? ''} ${item.why?.label ?? ''}`)
  return needle.split(/\s+/).every((w) => hay.includes(w))
}

// A Short is never the highlight: the thumbnail is vertical and, in the large 16:9 frame, becomes a strip with two black
// bars (seen in the real app). Only Shorts among the candidates = no highlight; they stay in the grid.
function featuredOf(items: readonly FeedItem[]): FeedItem | null {
  return items.find((it) => (it.is_new || it.channel?.favorite) && canFeature(it)) ?? null
}

/** Can take the highlight (a real video, not a Short) — a pinned highlight still holds after being watched. */
function canFeature(it: FeedItem): boolean {
  return isVideoId(it.video.id) && it.video.is_short !== true
}

/**
 * Compact: the "why it is here" keeps only the main part, whole — without the complement (`detail`) and, in a
 * "X: comment" label (HN), only the X. A channel reason stays as is (`Why` already shows only the reason).
 */
export function compactWhy(item: FeedItem): FeedItem {
  const why = item.why
  if (!why || why.via === 'channel') return item
  const head = why.label.split(/:\s/, 1)[0]?.trim() ?? ''
  const label = head && head.length < why.label.length && head.length <= 24 ? head : why.label
  if (label === why.label && !why.detail) return item
  return { ...item, why: { ...why, label, detail: null } }
}

/** Time the RSS went down: "23:02" (today), "yesterday 23:02", or day + time. */
export function sinceText(ts: number, locale: string, now: number = Date.now()): string {
  const d = new Date(ts * 1000)
  const today = new Date(now)
  try {
    const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d)
    if (today.toDateString() === d.toDateString()) return time
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (yesterday.toDateString() === d.toDateString()) return `${new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day')} ${time}`
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d)
  } catch {
    return d.toISOString()
  }
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Element width below `limit`? (without ResizeObserver, as in jsdom: never narrow). */
function useNarrow(limit: number): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const w = entries[entries.length - 1]?.contentRect?.width
      if (typeof w === 'number' && w > 0) setNarrow(w < limit)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, limit])
  return [setEl, narrow]
}

// ------------------------------------------------------------------ pieces

function CardActions({ item, onAction, reactions }: { item: FeedItem; onAction: (a: VideoAction, item: FeedItem) => void; reactions: boolean }) {
  const tc = useT()
  const standard = useStandardQuickActions({
    watched: () => onAction('watched', item),
    later: () => onAction('later', item),
    archive: () => onAction('archive', item),
    state: item.state
  })
  const playlist: QuickAction = { id: 'playlist', label: tc('playlists.add'), icon: 'list-unordered', shortcut: 'p', onSelect: () => openPlaylistPicker(item) }
  const actions: QuickAction[] = reactions
    ? [
        ...standard,
        {
          id: 'up',
          label: tc('kit.actions.up'),
          hint: tc(item.reaction === 'up' ? 'kit.actions.up_undo' : 'kit.actions.up_do'),
          icon: 'thumbsup',
          shortcut: 'u',
          onSelect: () => onAction('up', item),
          pressed: item.reaction === 'up'
        },
        {
          id: 'down',
          label: tc('kit.actions.down'),
          hint: tc(item.reaction === 'down' ? 'kit.actions.down_undo' : 'kit.actions.down_do'),
          icon: 'thumbsdown',
          shortcut: 'd',
          onSelect: () => onAction('down', item),
          pressed: item.reaction === 'down'
        },
        playlist
      ]
    : [...standard, playlist]
  return <QuickActions actions={actions} />
}

/**
 * Place of a video archived by a click: the card leaves (no longer clickable or read), but the space stays
 * its own until the list changes — the neighbour does not move up under the cursor. Under the cursor there is only this
 * video's "Undo" (a 2nd click in the same place undoes, like "Watched"). The geometry is the card's own
 * (drawn invisible and inert beneath the notice).
 */
function GoneSlot({ children, onUndo }: { children: ReactNode; onUndo: () => void }) {
  const t = useT('home')
  const inGrid = useInGrid()
  return (
    <div className={cx('card-gone')} data-part="card-gone">
      <div className={cx('card-gone-ghost')} aria-hidden="true" inert>
        {children}
      </div>
      <div className={cx('card-gone-note')} role="status">
        <Codicon name="archive" size={14} />
        <span className={cx('t-label')}>{t('gone.archived')}</span>
        <Button variant="ghost" size="xs" data-part="gone-undo" tabIndex={inGrid ? -1 : undefined} onClick={onUndo}>
          {t('gone.undo')}
        </Button>
      </div>
    </div>
  )
}

/**
 * A "list" = the same source with the same filters (and the same refresh request). While it lasts, what the
 * person already touched stays in place: the highlight pinned to the same video, the marked one keeps showing with "Only new", the one archived
 * by a click leaves its place marked. Switching tab/filter, refreshing or leaving and coming back starts another.
 */
interface ListSession {
  key: string
  featured: string | null
  touched: Set<string>
  gone: Set<string>
}

function useListSession(key: string): ListSession {
  const ref = useRef<ListSession | null>(null)
  if (!ref.current || ref.current.key !== key) ref.current = { key, featured: null, touched: new Set(), gone: new Set() }
  return ref.current
}

interface NewTabEntry {
  id: string
  icon: string
  run: () => void
}

const NEW_TAB_ENTRIES: NewTabEntry[] = [
  { id: 'category', icon: 'folder', run: () => openDialog('tab-editor', { preset: { kind: 'category' } }) },
  { id: 'channels', icon: 'account', run: () => openDialog('tab-editor', { preset: { kind: 'channels' } }) },
  { id: 'theme', icon: 'sparkle', run: () => openDialog('theme', {}) },
  { id: 'mixed', icon: 'layers', run: () => openDialog('tab-editor', { preset: { kind: 'mixed' } }) }
]

/**
 * "+ New tab" at the end of the tab bar (goes in the `TabBar`'s `addSlot`): the button itself is the trigger of the type
 * menu, so the menu opens anchored to it. Category/channels/mixed → editor; topic → topic tab dialog.
 */
function NewTabMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT('home')
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" className={cx('tab-add')} data-part="new-tab" aria-label={t('actions.new_tab')}>
          <Codicon name="add" size={14} />
          <span className={cx('tab-add-label')}>{t('actions.new_tab')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NEW_TAB_ENTRIES.map((e) => (
          <DropdownMenuItem key={e.id} data-entry={e.id} onSelect={() => e.run()}>
            <Codicon name={e.icon} size={14} />
            <Stack gap={0}>
              <span className={cx('t-body')}>{t(`new_tab.${e.id}`)}</span>
              <span className={cx('t-label')}>{t(`new_tab.${e.id}_desc`)}</span>
            </Stack>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Theme tab with AI, in sight next to "+ New tab": "New theme" opens the theme dialog straight away. While a theme is
 * built in the background it becomes the "Building “X”… 1:23" notice (click = the dialog on that job); the end comes
 * as a notice (ready → open the preview; failed → the reason and "Try again"). No AI model (`GET /ai/status` says
 * so) → disabled, with the reason. Narrow → icon only, the label in the tip. The job lives in lib/jobs.
 */
function ThemeSlot({ compact }: { compact: boolean }) {
  const t = useT('home')
  const tc = useT()
  const ai = useAiStatus()
  const onEnd = (end: ThemeBuildEnd) => {
    const name = end.query
    if (end.kind === 'ready') {
      host.notify({
        kind: 'success',
        message: name ? t('theme_build.ready', { name }) : t('theme_build.ready_unnamed'),
        action: { label: t('theme_build.open_preview'), onClick: () => openDialog('theme', { jobId: end.jobId }) }
      })
      return
    }
    const error = errorText(tc, end.error)
    const params = end.params ?? (name ? { query: name } : null)
    host.notify({
      kind: 'error',
      message: name ? t('theme_build.failed', { name, error }) : t('theme_build.failed_unnamed', { error }),
      action: {
        label: t('theme_build.retry'),
        onClick: () => {
          if (!params) return openDialog('theme', {})
          void retryThemeBuild(params, name).then((started) => (started ? undefined : openDialog('theme', { query: name })))
        }
      }
    })
  }
  const build = useThemeBuild(onEnd)
  const now = useNowTicker(!!build)
  if (build) {
    const label = build.query ? t('theme_build.building', { name: build.query }) : t('theme_build.building_unnamed')
    const time = formatElapsed(now - build.startedAt)
    return (
      <Tip label={compact ? label : t('theme_build.building_tip')}>
        <Button variant="ghost" size="xs" className={cx('tab-building')} data-part="theme-building" data-job={build.jobId} aria-label={`${label} ${time}`} onClick={() => openDialog('theme', { jobId: build.jobId })}>
          <Codicon name="loading" size={14} spinning />
          {compact ? null : <span className={cx('tab-building-label')}>{label}</span>}
          <span className={cx('tab-building-time')} data-part="theme-building-time">
            {time}
          </span>
        </Button>
      </Tip>
    )
  }
  const off = ai?.available === false
  const label = t('theme_build.button')
  const button = (
    <Button variant="outline" size="xs" className={cx('tab-theme')} data-part="new-theme" aria-label={label} disabled={off} onClick={() => openDialog('theme', {})}>
      <Codicon name="wand" size={14} className={cx('tab-theme-icon')} />
      {compact ? null : <span className={cx('tab-theme-label')}>{label}</span>}
    </Button>
  )
  // a disabled button gets no pointer events: the reason sits on a focusable wrapper
  if (off)
    return (
      <Tip label={t('theme_build.no_ai')}>
        <span className={cx('tab-theme-off')} data-part="new-theme-off" tabIndex={0}>
          {button}
        </span>
      </Tip>
    )
  return <Tip label={compact ? label : t('theme_build.button_tip')}>{button}</Tip>
}

/**
 * Subtle channels-pane button (header action, next to Refresh and above "+ New tab"):
 * off screen → show (host.revealPane); on screen → hide (the app's ⌘J). The state comes from host.paneVisibility, the
 * app's truth (active tab, open zone, column not collapsed); a Desktop without these hooks → not shown.
 */
export function PaneToggle() {
  // pane texts (namespace `panes`): the same button/command reads the same on every screen
  const tp = useT('panes')
  const shown = usePaneShown()
  if (shown === null) return null
  const label = shown ? tp('toggle.hide') : tp('toggle.show')
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" data-part="pane-toggle" aria-label={label} aria-pressed={shown} onClick={togglePane}>
        <Codicon name={shown ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} size={15} />
      </Button>
    </Tip>
  )
}

/** Filter chip: the kit chip as a control (aria-pressed, subtle background + weight when on, ✓ instead of the icon). */
function FilterChip({ label, active, onToggle, icon }: { label: string; active: boolean; onToggle: () => void; icon: string }) {
  return (
    <button type="button" className={cx('bare chip t-label')} aria-pressed={active} data-active={active ? 'true' : undefined} onClick={onToggle}>
      <Codicon name={active ? 'check' : icon} size={12} className={cx('chip-icon')} />
      <span className={cx('chip-label')}>{label}</span>
    </button>
  )
}

/** Density as icons (narrow body): same value as `ModeSwitch`, label in the aria-label and the tooltip. */
function DensityIcons({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  const tc = useT()
  return (
    <div className={cx('mode')} data-part="density-icons" role="group" aria-label={tc('kit.density.label')}>
      <Stack direction="row" gap={1}>
        {DENSITIES.map((d) => (
          <Button
            key={d}
            variant={value === d ? 'secondary' : 'ghost'}
            size="icon-xs"
            aria-label={tc(`kit.density.${d}`)}
            title={tc(`kit.density.${d}`)}
            aria-pressed={value === d}
            onClick={() => onChange(d)}
          >
            <Codicon name={DENSITY_ICON[d]} size={14} />
          </Button>
        ))}
      </Stack>
    </div>
  )
}

/** End of the list: watches for reaching near the end and asks for the next page (without IntersectionObserver: a button). */
function MoreLoader({ onLoad, label, watchKey }: { onLoad: () => void; label: string; watchKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onLoad)
  cb.current = onLoad
  const supported = typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const el = ref.current
    if (!el || !supported) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) cb.current()
    }, { rootMargin: '0px 0px 800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [supported, watchKey])
  return (
    <div ref={ref} data-part="feed-more">
      {supported ? null : (
        <Button variant="outline" size="sm" onClick={onLoad}>
          {label}
        </Button>
      )}
    </div>
  )
}

/** Fake tab that stands for the pane filter (for `POST /read` by folder/channel). */
function scopeTab(scope: ScopeFilter, name: string): Tab {
  return {
    id: `:${scope.kind}:${scope.id}`,
    name,
    kind: scope.kind === 'folder' ? 'category' : 'channels',
    rules: {
      include: { folders: scope.kind === 'folder' ? [scope.id] : [], tags: [], channels: scope.kind === 'channel' ? [scope.id] : [], themes: [], lenses: [], all: false, favorites: false },
      exclude: { folders: [], tags: [], channels: [], shorts: false },
      filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
      mode: 'fresh'
    },
    icon: null,
    filters: {},
    sort: 0,
    builtin: false
  }
}

// ------------------------------------------------------------------ page

export interface HomeViewProps {
  /** Initial tab (otherwise the remembered one; preview/tests). */
  initialTab?: string
  /** Initial density (otherwise the remembered one; preview/tests). */
  initialDensity?: Density
  /** "+ New tab" menu already open (preview). */
  initialMenuOpen?: boolean
  /** Feed filtered by folder/channel already active (preview; in the app it comes from the pane). */
  initialFilter?: ScopeFilter
  /** Text already in the search (preview). */
  initialQuery?: string
  /** Actions already done by click, by position in the visible list (0 = highlight); preview. */
  initialActions?: ReadonlyArray<readonly [VideoAction, number]>
  /** Tab menu already open on this tab (preview). */
  initialTabMenu?: string
  /** Delete confirmation already open for this tab (preview). */
  initialDelete?: string
  /** Sort/group already chosen for the initial source (preview; not saved). */
  initialView?: ListView
  /** Sort/group menu already open (preview). */
  initialViewMenu?: 'sort' | 'group' | 'view'
}

export function HomePage() {
  return <HomeView />
}

export function HomeView({
  initialTab,
  initialDensity,
  initialMenuOpen,
  initialFilter,
  initialQuery,
  initialActions,
  initialTabMenu,
  initialDelete,
  initialView,
  initialViewMenu
}: HomeViewProps) {
  const t = useT('home')
  const tc = useT()
  const locale = useLocale()
  const now = useNow(CLOCK_MS)
  const fmt = useCallback((n: number) => formatNumber(n, locale), [locale])

  // ---------------------------------------------------------------- preferences
  const [density, setDensityState] = useState<Density>(() => initialDensity ?? readPref(STORAGE_KEYS.density, 'comfortable', isDensity))
  const [wantedTab, setWantedTab] = useState<string | null>(() => initialTab ?? readPref<string | null>(STORAGE_KEYS.tab, null, isText))
  const setDensity = (d: Density) => {
    setDensityState(d)
    writePref(STORAGE_KEYS.density, d)
  }
  // sort/group per source: a map stored in the same place as the density
  const [viewMap, setViewMap] = useState<ViewMap>(() => {
    const stored = readViewMap()
    const first = initialFilter ? `:${initialFilter.kind}:${initialFilter.id}` : initialTab
    return initialView && first ? { ...stored, [first]: initialView } : stored
  })
  const tzOffsetMin = useMemo(() => browserTzOffsetMin(), [])

  // ---------------------------------------------------------------- session state
  const [query, setQuery] = useState(initialQuery ?? '')
  const searchText = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS)
  const [newOnly, setNewOnly] = useState(false)
  const [noShorts, setNoShorts] = useState(false)
  const [seen, setSeen] = useState(false)
  const [arriving, setArriving] = useState<Arriving | null>(null)
  const [kickedAt, setKickedAt] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(!!initialMenuOpen)
  const [paneFilter, setPaneFilter] = useState<ScopeFilter | null>(initialFilter ?? null)
  const [pendingTarget, setPendingTarget] = useState<PaneTarget | null>(null)
  /** Each "Refresh" starts a new list (the highlight and the watched items reorganize). */
  const [epoch, setEpoch] = useState(0)
  const toolbarEl = useRef<HTMLDivElement | null>(null)
  const [observeWidth, narrow] = useNarrow(NARROW_PX)
  const toolbarRef = useCallback(
    (el: HTMLDivElement | null) => {
      toolbarEl.current = el
      observeWidth(el)
    },
    [observeWidth]
  )
  const rssRef = useRef<HTMLSpanElement>(null)

  const resetFilters = () => {
    setQuery('')
    setNewOnly(false)
    setNoShorts(false)
    setSeen(false)
  }

  // ---------------------------------------------------------------- pane → Subscriptions (an open Subscriptions follows it)
  const link = usePaneLink({
    onTab: (id) => {
      setPaneFilter(null)
      setWantedTab(id)
      resetFilters()
    },
    onTarget: (target) => setPendingTarget(target)
  })

  // ---------------------------------------------------------------- data
  const refreshingGuess = kickedAt != null
  const tabsQ = useRest('GET /tabs', {})
  const statusQ = useRest('GET /status', {}, { refetchInterval: refreshingGuess || arriving ? FAST_POLL_MS : false })
  const status = statusQ.data as StatusResponse | undefined
  // /status totals (optional): missing = not known yet → never becomes 0 (neither welcome nor strip)
  const totalChannels = typeof status?.channels_total === 'number' ? status.channels_total : null
  const subscribedCount = typeof status?.subscribed_total === 'number' ? status.subscribed_total : null
  const foldersQ = useRest('GET /folders', {}, { enabled: paneFilter?.kind === 'folder' })
  const channelQ = useRest('GET /channels/{id}', { path: { id: paneFilter?.kind === 'channel' ? paneFilter.id : '' } }, { enabled: paneFilter?.kind === 'channel' })

  // ---------------------------------------------------------------- tabs: optimistic order, deletion
  const [tabOrder, setTabOrder] = useState<string[] | null>(null)
  const [deletedTabs, setDeletedTabs] = useState<ReadonlySet<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(initialDelete ?? null)
  const serverTabs = tabsQ.data ? (tabsQ.data.items ?? []) : null
  const tabs: Tab[] | null = useMemo(
    () => (serverTabs ? withOrder(serverTabs, tabOrder).filter((x) => !deletedTabs.has(x.id)) : null),
    [serverTabs, tabOrder, deletedTabs]
  )
  // the server is already in the requested order → the optimistic layer goes away
  useEffect(() => {
    if (tabOrder && serverTabs && serverTabs.map((x) => x.id).join('\n') === withOrder(serverTabs, tabOrder).map((x) => x.id).join('\n')) setTabOrder(null)
  }, [serverTabs, tabOrder])
  const tabId = tabs
    ? wantedTab === LATER_TAB || wantedTab === PLAYLISTS_TAB || (wantedTab && tabs.some((x) => x.id === wantedTab))
      ? wantedTab
      : (tabs[0]?.id ?? LATER_TAB)
    : null
  const onPlaylists = !paneFilter && tabId === PLAYLISTS_TAB

  // pane request: with its own tab → that tab; without a tab → temporary filtered feed
  useEffect(() => {
    if (!pendingTarget || !tabs) return
    setPendingTarget(null)
    const exact = exactTabFor(pendingTarget, tabs)
    resetFilters()
    if (exact) {
      setPaneFilter(null)
      setWantedTab(exact)
    } else {
      setPaneFilter({ kind: pendingTarget.kind, id: pendingTarget.id })
    }
  }, [pendingTarget, tabs])

  const filterName =
    paneFilter?.kind === 'folder'
      ? (foldersQ.data?.items?.find((f) => f.id === paneFilter.id)?.name ?? '')
      : paneFilter?.kind === 'channel'
        ? (channelQ.data?.channel?.title ?? '')
        : ''
  const activeId = paneFilter ? null : tabId
  const activeTab = paneFilter ? scopeTab(paneFilter, filterName) : (tabs?.find((x) => x.id === activeId) ?? null)
  const onlyNewTab = !paneFilter && !!activeTab?.rules?.filters?.only_new
  const isWelcome = totalChannels === 0 && !arriving

  const source: FeedSource | null = isWelcome
    ? null
    : paneFilter
      ? { kind: 'scope', scope: paneFilter }
      : !activeId || activeId === PLAYLISTS_TAB
        ? null
        : activeId === LATER_TAB
          ? { kind: 'later' }
          : seen && onlyNewTab && activeTab
            ? { kind: 'seen', tabId: activeId, rules: activeTab.rules }
            : { kind: 'tab', tabId: activeId }
  // sort and group of the source: per tab / "Watch later" / folder / channel; a grouping meaningless for the source means "None"
  const viewKey = paneFilter ? `:${paneFilter.kind}:${paneFilter.id}` : activeId
  const groupChoices = groupsFor(paneFilter, paneFilter ? null : activeTab)
  const listView = effectiveView((viewKey ? viewMap[viewKey] : undefined) ?? DEFAULT_VIEW, groupChoices)
  const orderable = serverOrder(source)
  const order: FeedOrder | null = orderable ? { ...listView, tzOffsetMin } : null
  const grouping = order?.group ?? 'none'
  const setListView = (next: ListView) => {
    if (!viewKey) return
    setViewMap((m) => ({ ...m, [viewKey]: next }))
    writePref(STORAGE_KEYS.view, { ...readViewMap(), [viewKey]: next })
  }
  const feed = useFeed(source, { refetchInterval: arriving ? FAST_POLL_MS : false, q: searchText, order })
  const remoteSearch = serverSearch(source)

  const actions = useVideoActions(t, tc)
  const reads = useMarkRead(t, tc)

  // ---------------------------------------------------------------- refresh
  const refreshing = !!status?.refresh_running || refreshingGuess
  const refresh = useCallback(() => {
    setKickedAt(Date.now())
    setEpoch((e) => e + 1)
    restCall('POST /refresh', { body: { force: true } }).then(
      (r) => {
        if (r.result === 'skipped') {
          setKickedAt(null)
          host.notify({ kind: 'info', message: t('toast.refresh_skipped') })
        }
        void invalidateRest('GET /status')
      },
      (error: unknown) => {
        setKickedAt(null)
        host.notify({ kind: 'error', message: t('toast.refresh_failed', { error: errorText(tc, toApiError(error)) }) })
      }
    )
  }, [t, tc])

  // end of the cycle (refresh_running dropped or last_rss_at changed) → renewed feed (no flicker: the old one stays until the new)
  const prevRunning = useRef<boolean | undefined>(undefined)
  const prevRss = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    if (!status) return
    const wasRunning = prevRunning.current
    const lastRss = prevRss.current
    prevRunning.current = status.refresh_running
    prevRss.current = status.last_rss_at
    const finished = wasRunning === true && !status.refresh_running
    if (finished) setKickedAt(null)
    if (finished || (lastRss !== undefined && lastRss !== status.last_rss_at)) void invalidateRest('GET /feed', 'POST /feed/preview')
  }, [status])

  // the refresh request does not become an endless "refreshing" if /status does not show the cycle
  useEffect(() => {
    if (kickedAt == null) return
    const id = setTimeout(() => setKickedAt(null), 15_000)
    return () => clearTimeout(id)
  }, [kickedAt])

  // arriving (demo/link) ends when there is a video and the cycle finished, or at the cap
  useEffect(() => {
    if (!arriving) return
    const age = now - arriving.since
    if (age > ARRIVING_MAX_MS || (feed.items.length > 0 && status && !status.refresh_running && age > 8000)) setArriving(null)
  }, [arriving, now, feed.items.length, status])
  useEffect(() => {
    if (!arriving) return
    const id = setTimeout(() => setArriving((a) => (a === arriving ? null : a)), ARRIVING_MAX_MS)
    return () => clearTimeout(id)
  }, [arriving])

  // ---------------------------------------------------------------- tabs
  const selectTab = (id: string) => {
    setPaneFilter(null)
    setWantedTab(id)
    writePref(STORAGE_KEYS.tab, id)
    link.noteTab(id)
    resetFilters()
  }
  // in-page history: the Subscriptions entry remembers the tab; Back to it brings that tab back
  useNavDetail('home', activeId)
  useNavRestore('home', (id) => {
    if (id !== activeId && tabItems?.some((x) => x.id === id)) selectTab(id)
  })

  /** New server tab order: shows at once; refused → back to the server's and a notice. */
  const reorderTabs = (ids: string[]) => {
    setTabOrder(ids)
    restCall('POST /tabs/reorder', { body: { ids } }).then(
      () => void invalidateRest('GET /tabs'),
      (error: unknown) => {
        setTabOrder(null)
        void invalidateRest('GET /tabs')
        host.notify({ kind: 'error', message: t('toast.reorder_failed', { error: errorText(tc, toApiError(error)) }) })
      }
    )
  }
  const moveTab = (id: string, delta: -1 | 1) => {
    const ids = (tabs ?? []).map((x) => x.id)
    const i = ids.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ids.splice(i, 1)
    ids.splice(j, 0, id)
    reorderTabs(ids)
  }
  // tab menu: edit (all, built-ins included: the editor locks what cannot change), move, delete (not built-in).
  // "Watch later" is not a server tab: no menu and no dragging.
  const tabMenu = (id: string): TabMenuEntry[] | null => {
    const list = tabs ?? []
    const i = list.findIndex((x) => x.id === id)
    if (i < 0) return null
    const tab = list[i]
    const entries: TabMenuEntry[] = [
      { id: 'edit', label: t('tab_menu.edit'), icon: 'edit', onSelect: () => openDialog('tab-editor', { tabId: id }) },
      { id: 'move_left', label: t('tab_menu.move_left'), icon: 'arrow-left', disabled: i === 0, onSelect: () => moveTab(id, -1) },
      { id: 'move_right', label: t('tab_menu.move_right'), icon: 'arrow-right', disabled: i === list.length - 1, onSelect: () => moveTab(id, 1) }
    ]
    if (!tab.builtin) entries.push({ id: 'delete', label: t('tab_menu.delete'), icon: 'trash', destructive: true, onSelect: () => setDeletingId(id) })
    return entries
  }
  const deleting = deletingId ? (tabs?.find((x) => x.id === deletingId) ?? null) : null
  const deletingName = deleting ? tabLabel(deleting, t) : ''
  /** Delete (already confirmed): the neighbour becomes active; an error stays in the dialog; undo only if a `change_id` comes back. */
  const confirmDelete = async () => {
    const tab = deleting
    if (!tab) return
    const list = tabs ?? []
    const i = list.findIndex((x) => x.id === tab.id)
    const neighbor = list[i + 1]?.id ?? list[i - 1]?.id ?? LATER_TAB
    const name = tabLabel(tab, t)
    let result: unknown
    try {
      result = await restCall('DELETE /tabs/{id}', { path: { id: tab.id } })
    } catch (error) {
      throw new Error(t('tab_menu.delete_failed', { error: errorText(tc, toApiError(error)) }))
    }
    setDeletedTabs((s) => new Set(s).add(tab.id))
    setTabOrder((o) => (o ? o.filter((x) => x !== tab.id) : o))
    if (tabId === tab.id && !paneFilter) selectTab(neighbor)
    void invalidateRest('GET /tabs', 'GET /status')
    const changeId = (result as { change_id?: unknown } | null)?.change_id
    host.notify({
      kind: 'success',
      message: t('toast.tab_deleted', { name }),
      durationMs: UNDO_MS,
      ...(typeof changeId === 'number'
        ? {
            action: {
              label: t('toast.undo'),
              onClick: () => {
                restCall('POST /changes/{id}/undo', { path: { id: changeId } }).then(
                  () => {
                    setDeletedTabs((s) => {
                      const n = new Set(s)
                      n.delete(tab.id)
                      return n
                    })
                    void invalidateRest('GET /tabs', 'GET /status')
                  },
                  (error: unknown) => host.notify({ kind: 'error', message: t('toast.undo_failed', { error: errorText(tc, toApiError(error)) }) })
                )
              }
            }
          }
        : {})
    })
  }

  const countByTab = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of status?.new_by_tab ?? []) m.set(c.tab_id, c.count)
    return m
  }, [status])

  const tabItems: TabBarItem[] | null = tabs
    ? [
        ...tabs.map((tab) => ({
          id: tab.id,
          label: tabLabel(tab, t),
          icon: tabIcon(tab),
          count: reads.read.has(tab.id) ? null : (countByTab.get(tab.id) ?? null)
        })),
        { id: LATER_TAB, label: t('tabs.later'), icon: 'clock' },
        { id: PLAYLISTS_TAB, label: t('tabs.playlists'), icon: 'list-unordered' }
      ]
    : null
  const activeLabel = paneFilter
    ? filterName
    : activeId === LATER_TAB
      ? t('tabs.later')
      : activeId === PLAYLISTS_TAB
        ? t('tabs.playlists')
        : activeTab
          ? tabLabel(activeTab, t)
          : ''

  // ---------------------------------------------------------------- visible items
  const readKey = activeTab?.id ?? null
  const readActive = !!readKey && reads.read.has(readKey)
  const typed = query.trim()
  // text: on the server (GET /feed?q=); only "show watched" (preview without `q`) filters what already arrived
  const localNeedle = remoteSearch ? '' : fold(typed)
  const searching = !!typed
  const chips = newOnly || noShorts
  const filtering = searching || chips
  const sessionKey = JSON.stringify([source, searchText, newOnly, noShorts, seen, density, epoch, order])
  const session = useListSession(sessionKey)
  // collapsed groups: valid while the list lasts (changing source/filter/order starts another)
  const [collapsedRaw, setCollapsed] = useState<{ key: string; keys: ReadonlySet<string> }>(() => ({ key: sessionKey, keys: new Set() }))
  const collapsed = collapsedRaw.key === sessionKey ? collapsedRaw.keys : NO_KEYS
  const toggleGroup = (k: string) =>
    setCollapsed((c) => {
      const keys = new Set(c.key === sessionKey ? c.keys : NO_KEYS)
      if (keys.has(k)) keys.delete(k)
      else keys.add(k)
      return { key: sessionKey, keys }
    })
  // until the list in the new order arrives, the previous one stays on screen with its grouping (no swapped headers)
  const shownGrouping = useRef(grouping)
  if (!feed.reordering && !feed.pending) shownGrouping.current = grouping
  const drawGroup = feed.reordering ? shownGrouping.current : grouping
  // folder names for the group header (same key as the pane filter query: a single request)
  const groupFoldersQ = useRest('GET /folders', {}, { enabled: grouping === 'folder' || drawGroup === 'folder' })
  const folderById = useMemo(() => new Map((groupFoldersQ.data?.items ?? []).map((f) => [f.id, f] as const)), [groupFoldersQ.data])
  const isGone = (it: FeedItem) => session.gone.has(it.video.id) && actions.isHidden(it)
  const shown = feed.items
    .filter((it) => !actions.isHidden(it) || session.gone.has(it.video.id))
    .map((it) => {
      const v = actions.view(it)
      return readActive && v.is_new ? { ...v, is_new: false } : v
    })
  const visible = shown.filter(
    (it) => matches(it, localNeedle) && (!newOnly || it.is_new || session.touched.has(it.video.id)) && (!noShorts || !it.video.is_short)
  )
  // once the person touched this list, the highlight stays pinned to the same video (marking as watched does not move
  // the video, nor does an RSS cycle that brings a new video); before that, it follows the feed
  let featured: FeedItem | null = null
  if (density === 'comfortable' && !filtering && drawGroup === 'none') {
    const pinned = session.touched.size && session.featured ? visible.find((it) => it.video.id === session.featured && canFeature(it)) : undefined
    featured = pinned ?? featuredOf(visible.filter((it) => !isGone(it)))
    session.featured = featured?.video.id ?? null
  }
  /** Results: from the server search = its `counts` (the total, or the new ones with "only new"); local chips = on screen. */
  const resultCount = !filtering
    ? null
    : feed.searching || feed.reordering
      ? null
      : remoteSearch && searching && !noShorts
        ? newOnly
          ? feed.fresh
          : feed.total
        : visible.length
  const gridItems = featured ? visible.filter((it) => it !== featured) : visible
  // the click opens the Watch section with this list (in screen order) in "Up next"
  const playFrom = (it: FeedItem) => openVideo(it.video.id, { item: it, list: (featured ? [featured, ...gridItems] : gridItems).filter((x) => !isGone(x)), source: activeLabel })
  const variant: VideoCardVariant = cardVariantFor(density)
  const reactions = density !== 'compact'

  /** Click on a card button: the card stays in place; archiving leaves its place marked (with "Undo"). */
  const onAction = (a: string, item: FeedItem) => {
    if (!isVideoAction(a)) return
    session.touched.add(item.video.id)
    if (a === 'archive' && item.state !== 'archived') session.gone.add(item.video.id)
    actions.run(a, item)
  }
  /** Grid shortcut (w/l/e/u/d on the focused cell): archiving removes the cell and focus moves to the neighbour. */
  const onKeyAction = (a: string, item: FeedItem) => {
    if (a === 'playlist' && !isGone(item)) return openPlaylistPicker(item)
    if (!isVideoAction(a) || (isGone(item) && a !== 'archive')) return
    session.touched.add(item.video.id)
    actions.run(a, item)
  }
  const initialDone = useRef(false)
  useEffect(() => {
    if (initialDone.current || !initialActions?.length || !visible.length) return
    initialDone.current = true
    for (const [a, i] of initialActions) if (visible[i]) onAction(a, visible[i])
  })
  const cardFor = (it: FeedItem, v: VideoCardVariant, withReactions: boolean) => {
    const cardEl = <VideoCard item={v === 'compact' ? compactWhy(it) : it} variant={v} onOpen={() => playFrom(it)} actions={<CardActions item={it} onAction={onAction} reactions={withReactions} />} />
    return isGone(it) ? <GoneSlot onUndo={() => onAction('archive', it)}>{cardEl}</GoneSlot> : cardEl
  }
  const focusSearch = () => toolbarEl.current?.querySelector<HTMLInputElement>('input')?.focus()
  /** A grid of cards (the whole list, or one group of it). */
  const gridOf = (items: FeedItem[], label: string) => (
    <Grid
      items={items}
      getKey={(it) => it.video.id}
      label={label}
      density={density}
      shortcuts={SHORTCUTS}
      onAction={onKeyAction}
      onOpen={(it) => {
        if (!isGone(it)) playFrom(it)
      }}
      onSearch={focusSearch}
      renderItem={(it) => cardFor(it, variant, reactions)}
    />
  )
  const clearFilters = () => {
    setQuery('')
    setNewOnly(false)
    setNoShorts(false)
  }
  const markRead = () => {
    if (paneFilter) reads.mark(`:${paneFilter.kind}:${paneFilter.id}`, { kind: paneFilter.kind, id: paneFilter.id }, activeLabel)
    else if (activeTab) reads.mark(activeTab.id, readScopeOf(activeTab), activeLabel)
  }

  // ---------------------------------------------------------------- strip
  // no browser ever paired → an early "connect the extension" (not on the Welcome card, which already offers it)
  const neverPaired = useNeverPaired(!isWelcome)
  const bannerKind = pickBanner({ status, subscribed: subscribedCount, arriving: !!arriving, neverPaired })
  const rssDetail = bannerKind === 'rss_down' && status && status.rss_fallback_channels > 0 ? t('banner.rss_fallback', { count: fmt(status.rss_fallback_channels) }) : null
  let banner: ReactNode = null
  if (bannerKind === 'arriving' && arriving) {
    banner = (
      <Banner tone="info" icon="sync">
        {arriving.kind === 'demo'
          ? t('banner.demo_arriving', { count: fmt(feed.total ?? 0), channels: fmt(arriving.channels) })
          : t('banner.channel_arriving', { title: arriving.title ?? '' })}
      </Banner>
    )
  } else if (bannerKind === 'rss_down' && status?.rss_down_since != null) {
    banner = (
      <Banner tone="warning" action={{ label: t('banner.retry'), onClick: refresh }}>
        <span ref={rssRef} data-part="rss-down">
          {t(status.rss_fallback_channels > 0 ? 'banner.rss_down' : 'banner.rss_down_stale', { time: sinceText(status.rss_down_since, locale, now) })}
        </span>
      </Banner>
    )
  } else if (bannerKind === 'ext_not_paired') {
    banner = (
      <Banner tone="info" icon="extensions" action={{ label: t('banner.connect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_not_paired')}
      </Banner>
    )
  } else if (bannerKind === 'ext_disconnected') {
    banner = (
      <Banner tone="info" icon="debug-disconnect" action={{ label: t('banner.reconnect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_disconnected')}
      </Banner>
    )
  }
  // the technical detail (how many channels come through the channel page) goes in the "Try again" tooltip
  // (the kit's `Banner` does not pass `title` to the action)
  useLayoutEffect(() => {
    const action = rssRef.current?.closest('[data-part="banner"]')?.querySelector('[data-part="banner-action"]')
    if (!action) return
    if (rssDetail) action.setAttribute('title', rssDetail)
    else action.removeAttribute('title')
  })

  // ---------------------------------------------------------------- welcome (zero channels)
  if (isWelcome && !(!tabs && tabsQ.error)) {
    return (
      <SectionFrame current="home">
        <Page narrow banner={banner}>
          <Welcome onArriving={setArriving} />
        </Page>
      </SectionFrame>
    )
  }

  // ---------------------------------------------------------------- header
  let subtitle: ReactNode = '\u00a0' // reserves the line while /status has not arrived (no jump)
  if (status) {
    const when = refreshing
      ? t('subtitle.refreshing')
      : status.last_rss_at
        ? t('subtitle.updated', { when: formatRelative(status.last_rss_at, now, locale) })
        : t('subtitle.never')
    subtitle = `${t('subtitle.new', { count: fmt(status.new_total) })} · ${when}`
  } else if (statusQ.error) {
    subtitle = t('subtitle.status_error')
  }

  const headerActions = (
    <>
      <PaneToggle />
      {EXTRAS_PAGE_READY ? (
        <Button variant="ghost" size="sm" onClick={() => showSection('extras')}>
          <Codicon name="sparkle" size={14} />
          {t('actions.extras')}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" loading={refreshing} onClick={refresh} aria-label={t('actions.refresh')}>
        <Codicon name="refresh" size={14} />
        {t('actions.refresh')}
      </Button>
    </>
  )

  const toolbar = tabItems && tabId ? (
    <TabBar
      tabs={tabItems}
      value={activeId ?? ''}
      onChange={selectTab}
      label={t('tabs.label')}
      addSlot={
        <>
          <NewTabMenu open={menuOpen} onOpenChange={setMenuOpen} />
          <ThemeSlot compact={narrow} />
        </>
      }
      onReorder={reorderTabs}
      reorderable={(id) => id !== LATER_TAB && id !== PLAYLISTS_TAB}
      menu={tabMenu}
      defaultMenuTab={initialTabMenu}
    />
  ) : tabsQ.error ? null : (
    <TabBarSkeleton count={5} />
  )

  // ---------------------------------------------------------------- pane filter
  const filterRow = paneFilter ? (
    <div data-part="pane-filter" role="status">
    <Stack direction="row" gap={2} wrap>
      <span className={cx('chip t-label')} data-part="pane-filter-chip" data-active="true">
        <Codicon name={paneFilter.kind === 'folder' ? 'folder' : 'account'} size={12} className={cx('chip-icon')} />
        <span className={cx('chip-label')}>{t('pane_filter.label', { name: filterName || '…' })}</span>
        <button type="button" className={cx('bare chip-remove')} data-part="pane-filter-clear" aria-label={t('pane_filter.clear')} title={t('pane_filter.clear')} onClick={() => setPaneFilter(null)}>
          <Codicon name="close" size={10} />
        </button>
      </span>
      <Button
        variant="ghost"
        size="xs"
        data-part="pane-filter-create"
        onClick={() =>
          openDialog('tab-editor', {
            preset:
              paneFilter.kind === 'folder'
                ? { name: filterName, kind: 'category', rules: { include: { folders: [paneFilter.id] } } }
                : { name: filterName, kind: 'channels', rules: { include: { channels: [paneFilter.id] } } }
          })
        }
      >
        <Codicon name="add" size={13} />
        {t('pane_filter.create_tab')}
      </Button>
    </Stack>
    </div>
  ) : null

  // ---------------------------------------------------------------- body
  const filterBar = (
    <div ref={toolbarRef}>
      <Toolbar
        end={
          <>
            <OpenModeSwitch compact={narrow} />
            {orderable ? <ViewControls value={listView} groups={groupChoices} onChange={setListView} narrow={narrow} initialOpen={initialViewMenu} /> : null}
            {narrow ? <DensityIcons value={density} onChange={setDensity} /> : <ModeSwitch value={density} onChange={setDensity} />}
          </>
        }
      >
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          placeholder={t('filters.search')}
          resultCount={resultCount}
          onClear={filtering ? clearFilters : undefined}
        >
          {activeId !== LATER_TAB ? <FilterChip icon="circle-filled" label={t('filters.new_only')} active={newOnly} onToggle={() => setNewOnly((v) => !v)} /> : null}
          <FilterChip icon="device-mobile" label={t('filters.no_shorts')} active={noShorts} onToggle={() => setNoShorts((v) => !v)} />
          {onlyNewTab ? <FilterChip icon="eye" label={t('filters.show_seen')} active={seen} onToggle={() => setSeen((v) => !v)} /> : null}
        </FilterBar>
      </Toolbar>
    </div>
  )

  // nothing found: text → "nothing found for «x»" (the search covers the whole tab, on the server); chips only → filters
  const searchEmpty = (
    <div data-part="search-empty">
      <EmptyView
        compact
        icon="search"
        title={searching ? t('empty.search_title', { query: typed }) : t('empty.filter_title')}
        description={searching ? (remoteSearch ? t('empty.search_desc') : t('empty.search_loaded_desc', { query: typed })) : t('empty.filter_desc')}
        action={
          <Button variant="outline" size="sm" onClick={clearFilters}>
            {searching && chips ? t('empty.clear') : searching ? t('empty.clear_search') : t('empty.clear_filters')}
          </Button>
        }
      />
    </div>
  )

  // empty feed without knowing whether there are channels (/status without `channels_total`) → skeleton, never a false empty or welcome
  const unknownChannels = totalChannels === null && !statusQ.error
  let body: ReactNode
  if (!tabs && tabsQ.error) {
    body = <ErrorView error={tabsQ.error} onRetry={() => void tabsQ.refetch()} />
  } else if (onPlaylists) {
    body = <PlaylistsView density={density} onBrowse={() => selectTab(tabs?.[0]?.id ?? 'all-new')} />
  } else if (!tabs || feed.pending || (!feed.items.length && !feed.error && !searching && (arriving || unknownChannels))) {
    body = (
      <>
        {filterRow}
        <GridSkeleton density={density} count={density === 'list' ? 6 : 8} label={t('feed.loading')} />
      </>
    )
  } else if (feed.error) {
    // a search error keeps the bar (the text can be fixed); a tab error, only try again
    body = (
      <>
        {filterRow}
        {searching ? filterBar : null}
        <ErrorView error={feed.error} onRetry={feed.refetch} />
      </>
    )
  } else if (!shown.length && !searching) {
    body = (
      <>
        {filterRow}
        {tabEmpty()}
      </>
    )
  } else {
    body = (
      <>
        {filterRow}
        {filterBar}
        {featured ? (
          <Section title={t('sections.featured')}>
            <div data-part="featured-slot">{cardFor(featured, 'featured', true)}</div>
          </Section>
        ) : null}
        <Section
          title={activeLabel}
          actions={
            <Stack direction="row" gap={3} align="center">
              {feed.searching ? (
                <span className={cx('t-label')} data-part="feed-searching" aria-live="polite">
                  {t('feed.searching')}
                </span>
              ) : feed.reordering ? (
                <span className={cx('t-label')} data-part="feed-reordering" aria-live="polite">
                  {t('feed.reordering')}
                </span>
              ) : feed.total != null ? (
                <span className={cx('t-label num')}>{t('feed.count', { count: fmt(feed.total) })}</span>
              ) : null}
              {activeId !== LATER_TAB && canMarkRead(activeTab) ? (
                <Button variant="ghost" size="xs" onClick={markRead}>
                  <Codicon name="check-all" size={13} />
                  {t('actions.mark_read')}
                </Button>
              ) : null}
            </Stack>
          }
        >
          {gridItems.length && drawGroup !== 'none' ? (
            <GroupedGrids
              runs={runsOf(gridItems, drawGroup, tzOffsetMin)}
              group={drawGroup}
              folders={folderById}
              tzOffsetMin={tzOffsetMin}
              locale={locale}
              more={feed.hasMore}
              collapsed={collapsed}
              onToggle={toggleGroup}
              renderGrid={(run: FeedRun, name: string) => gridOf(run.items, t('feed.group_label', { tab: activeLabel, group: name }))}
            />
          ) : gridItems.length ? (
            gridOf(gridItems, t('feed.label', { tab: activeLabel }))
          ) : filtering && !feed.searching && !feed.reordering ? (
            searchEmpty
          ) : null}
          {feed.loadingMore ? <GridSkeleton density={density} count={MORE_SKELETON[density]} label={t('feed.loading_more')} /> : null}
          {feed.moreError ? <ErrorView compact title={t('feed.more_error')} error={feed.moreError} onRetry={feed.loadMore} /> : null}
          {feed.hasMore && !feed.loadingMore && !feed.moreError ? (
            <MoreLoader
              onLoad={feed.loadMore}
              label={t('feed.load_more')}
              watchKey={`${source ? JSON.stringify(source) : ''}:${seen}:${searchText}:${JSON.stringify(order)}:${feed.items.length}:${visible.length}`}
            />
          ) : null}
        </Section>
      </>
    )
  }

  function tabEmpty(): ReactNode {
    if (activeId === LATER_TAB) {
      return (
        <EmptyView
          icon="clock"
          title={t('empty.later_title')}
          description={t('empty.later_desc')}
          action={
            <Button variant="outline" size="sm" onClick={() => selectTab(tabs?.[0]?.id ?? 'all-new')}>
              {t('empty.see_all')}
            </Button>
          }
        />
      )
    }
    const first = tabs?.[0]?.id
    const canSeeAll = !!first && (!!paneFilter || activeId !== first)
    const canShowSeen = onlyNewTab && !seen
    return (
      <EmptyView
        icon={refreshing ? 'sync' : 'check-all'}
        title={refreshing ? t('empty.refreshing_title') : t('empty.tab_title')}
        description={t('empty.tab_desc', { tab: activeLabel })}
        action={
          <Stack direction="row" gap={2} wrap justify="end">
            {canSeeAll ? (
              <Button variant="outline" size="sm" onClick={() => selectTab(first)}>
                {t('empty.see_all')}
              </Button>
            ) : null}
            {canShowSeen ? (
              <Button variant="outline" size="sm" onClick={() => setSeen(true)}>
                {t('empty.show_seen')}
              </Button>
            ) : null}
            {!canSeeAll && !canShowSeen ? (
              <Button variant="outline" size="sm" onClick={refresh} loading={refreshing}>
                {t('actions.refresh')}
              </Button>
            ) : null}
          </Stack>
        }
      />
    )
  }

  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    <SectionFrame current="home">
      <Page title={t('title')} subtitle={subtitle} actions={headerActions} toolbar={toolbar} banner={banner}>
        {body}
        <PlaylistPicker />
        <ConfirmDialog
          open={!!deleting}
          onClose={() => setDeletingId(null)}
          onConfirm={confirmDelete}
          title={t('tab_menu.delete_title', { name: deletingName })}
          description={t('tab_menu.delete_desc')}
          confirmLabel={t('tab_menu.delete_confirm')}
          cancelLabel={t('tab_menu.delete_cancel')}
          destructive
        />
      </Page>
    </SectionFrame>
  )
}
