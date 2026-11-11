// Sort and group the video list (GET /feed?sort&group).
//   controls     two compact SDK menus (`DropdownMenu`): Order (Newest · Oldest · Longest · Shortest · Most
//                viewed) and Group (None · Channel · Folder · Day · Type); the trigger shows the current choice. Narrow:
//                a single "View" button with both sections.
//   combinations only the ones that make sense for the source (`groupsFor`): channel only → no Channel/Folder; folder → no Folder
//   groups       the server only SORTS by group; here the header appears when the key changes from one item to the next
//                (`runsOf`). Header: name (channel with avatar, folder with icon, day "Today"/"Yesterday"/date, type
//                "Videos"/"Shorts"), count OF THE LOADED ONES ("N+" on the last group while there are more pages) and
//                click collapses/expands. One `Grid` per group; the keyboard crosses the groups (`GroupedGrids`).
import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import type { FeedItem, Folder, Tab } from '../../../shared/api-types'
import { ChannelAvatar, formatNumber } from '../../components'
import type { Translate } from '../../lib/i18n'
import { useT } from '../../lib/i18n'
import { cx } from '../../lib/style'
import type { ScopeFilter } from './feed'
import { type FeedGroup, type FeedSort, GROUPS, type ListView, SORTS } from './prefs'

// ------------------------------------------------------------------ which groups make sense

/** Groups possible for the source: grouping by channel in a single channel, or by folder inside a folder, does not show. */
export function groupsFor(scope: ScopeFilter | null, tab: Tab | null): FeedGroup[] {
  const drop = new Set<FeedGroup>()
  if (scope?.kind === 'channel') {
    drop.add('channel')
    drop.add('folder')
  } else if (scope?.kind === 'folder') {
    drop.add('folder')
  } else if (tab?.rules?.include) {
    const inc = tab.rules.include
    const others = (keep: 'channels' | 'folders') =>
      (keep !== 'channels' && inc.channels.length > 0) ||
      (keep !== 'folders' && inc.folders.length > 0) ||
      inc.tags.length > 0 ||
      inc.themes.length > 0 ||
      inc.lenses.length > 0 ||
      inc.all ||
      inc.favorites
    if (inc.channels.length === 1 && !others('channels')) {
      drop.add('channel')
      drop.add('folder')
    } else if (inc.folders.length === 1 && !others('folders')) {
      drop.add('folder')
    }
  }
  return GROUPS.filter((g) => !drop.has(g))
}

/** The stored choice, applied to the source (a group that does not fit becomes "None"). */
export function effectiveView(view: ListView, groups: readonly FeedGroup[]): ListView {
  return groups.includes(view.group) ? view : { ...view, group: 'none' }
}

/** Minutes to add to UTC to find the local day (the contract: -180 in Brasília). */
export function browserTzOffsetMin(): number {
  return -new Date().getTimezoneOffset()
}

// ------------------------------------------------------------------ controls

type MenuId = 'sort' | 'group' | 'view'

export interface ViewControlsProps {
  value: ListView
  groups: readonly FeedGroup[]
  onChange: (next: ListView) => void
  /** Narrow bar: a single button ("View") with both sections. */
  narrow: boolean
  /** Menu already open (preview). */
  initialOpen?: MenuId
}

const SORT_ICON = 'sort-precedence'
const GROUP_ICON = 'group-by-ref-type'

function Choice({ checked, label, data, onSelect }: { checked: boolean; label: string; data: Record<string, string>; onSelect: () => void }) {
  return (
    <DropdownMenuItem role="menuitemradio" aria-checked={checked} {...data} onSelect={onSelect}>
      <Codicon name="check" size={14} className={cx(checked ? 'view-check' : 'view-check view-check-off')} />
      <span className={cx('t-body')}>{label}</span>
    </DropdownMenuItem>
  )
}

/** Trigger (an element, not a component: the menu's `asChild` passes click, ref and aria straight to the button). */
function trigger(part: string, icon: string, text: string, label: string, open: boolean) {
  return (
    <Button variant="ghost" size="xs" className={cx('view-trigger')} data-part={part} data-open={open ? 'true' : undefined} aria-label={label} title={label}>
      <Codicon name={icon} size={13} />
      <span className={cx('view-trigger-text')}>{text}</span>
      <Codicon name="chevron-down" size={12} className={cx('view-trigger-caret')} />
    </Button>
  )
}

/** Order and group in the filter bar (two menus; narrow, just one). */
export function ViewControls({ value, groups, onChange, narrow, initialOpen }: ViewControlsProps) {
  const t = useT('home')
  const [open, setOpen] = useState<MenuId | null>(initialOpen ?? null)
  const toggle = (id: MenuId) => (next: boolean) => setOpen((cur) => (next ? id : cur === id ? null : cur))
  const sortText = t(`view.sort.${value.sort}`)
  const groupText = t(`view.group_trigger.${value.group}`)
  const sortItems = SORTS.map((s: FeedSort) => (
    <Choice key={s} checked={value.sort === s} label={t(`view.sort.${s}`)} data={{ 'data-sort': s }} onSelect={() => onChange({ ...value, sort: s })} />
  ))
  const groupItems = groups.map((g) => (
    <Choice key={g} checked={value.group === g} label={t(`view.group.${g}`)} data={{ 'data-group-option': g }} onSelect={() => onChange({ ...value, group: g })} />
  ))

  if (narrow) {
    const label = t('view.menu_label', { sort: sortText, group: groupText })
    return (
      <DropdownMenu open={open === 'view'} onOpenChange={toggle('view')}>
        <DropdownMenuTrigger asChild>
          {trigger('view-menu', SORT_ICON, t('view.label'), label, open === 'view')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <div className={cx('view-menu-label t-label')} role="presentation">
            {t('view.sort_title')}
          </div>
          {sortItems}
          <DropdownMenuSeparator />
          <div className={cx('view-menu-label t-label')} role="presentation">
            {t('view.group_title')}
          </div>
          {groupItems}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className={cx('view-controls')} data-part="view-controls">
      <DropdownMenu open={open === 'sort'} onOpenChange={toggle('sort')}>
        <DropdownMenuTrigger asChild>
          {trigger('view-sort', SORT_ICON, sortText, t('view.sort_label', { value: sortText }), open === 'sort')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{sortItems}</DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu open={open === 'group'} onOpenChange={toggle('group')}>
        <DropdownMenuTrigger asChild>
          {trigger('view-group', GROUP_ICON, groupText, t('view.group_label', { value: t(`view.group.${value.group}`) }), open === 'group')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{groupItems}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ------------------------------------------------------------------ groups (runs of the same key)

export interface FeedRun {
  /** Group key (the same across repeated runs, if the server did not group). */
  key: string
  /** Unique key of the run (React, focus). */
  id: string
  items: FeedItem[]
}

const DAY_S = 86400

function dayOf(ts: number, tzOffsetMin: number): number {
  return Math.floor((ts + tzOffsetMin * 60) / DAY_S)
}

/** Group key of an item (the same rule as the server). */
export function groupKeyOf(it: FeedItem, group: FeedGroup, tzOffsetMin: number): string {
  switch (group) {
    case 'channel':
      return `c:${it.channel?.id ?? it.video.channel_id}`
    case 'folder':
      return `f:${it.channel?.folder_id ?? ''}`
    case 'day':
      return it.video.published_at == null ? 'd:' : `d:${dayOf(it.video.published_at, tzOffsetMin)}`
    case 'kind':
      return `k:${it.video.is_short === true ? 'short' : it.video.is_short === false ? 'video' : 'unknown'}`
    default:
      return ''
  }
}

/** Items in consecutive runs of the same key (the header appears when the key changes). */
export function runsOf(items: readonly FeedItem[], group: FeedGroup, tzOffsetMin: number): FeedRun[] {
  const out: FeedRun[] = []
  for (const it of items) {
    const key = groupKeyOf(it, group, tzOffsetMin)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(it)
    else out.push({ key, id: `${key}#${out.length}`, items: [it] })
  }
  return out
}

function capitalize(text: string, locale: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text
}

/** "Today", "Yesterday" or the date in the app language (with the year only if it is another one). */
export function dayLabel(day: number, tzOffsetMin: number, t: Translate, locale: string, nowMs: number = Date.now()): string {
  const today = dayOf(Math.floor(nowMs / 1000), tzOffsetMin)
  if (day === today) return t('group.today')
  if (day === today - 1) return t('group.yesterday')
  const d = new Date(day * DAY_S * 1000)
  const sameYear = d.getUTCFullYear() === new Date(today * DAY_S * 1000).getUTCFullYear()
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) }
  try {
    return capitalize(new Intl.DateTimeFormat(locale, opts).format(d), locale)
  } catch {
    return capitalize(new Intl.DateTimeFormat('en', opts).format(d), 'en')
  }
}

const KIND_ICON: Record<string, string> = { video: 'device-camera-video', short: 'device-mobile', unknown: 'question' }

interface HeadInfo {
  label: string
  lead: ReactNode
}

function headInfo(run: FeedRun, group: FeedGroup, folders: ReadonlyMap<string, Folder>, tzOffsetMin: number, t: Translate, locale: string): HeadInfo {
  const first = run.items[0]
  const icon = (name: string) => <Codicon name={name} size={14} className={cx('feed-group-icon')} />
  switch (group) {
    case 'channel': {
      const title = first.channel?.title ?? first.video.channel_title ?? ''
      return { label: title || t('group.no_channel'), lead: <ChannelAvatar title={title} thumb={first.channel?.thumb ?? null} size={20} /> }
    }
    case 'folder': {
      const id = first.channel?.folder_id ?? null
      const name = id ? folders.get(id)?.name : null
      return { label: id ? (name ?? '…') : t('group.no_folder'), lead: icon(id ? 'folder' : 'folder-opened') }
    }
    case 'day': {
      const ts = first.video.published_at
      return { label: ts == null ? t('group.no_date') : dayLabel(dayOf(ts, tzOffsetMin), tzOffsetMin, t, locale), lead: icon('calendar') }
    }
    default: {
      const kind = run.key.slice(2)
      return { label: t(`group.kind.${kind}`), lead: icon(KIND_ICON[kind] ?? 'question') }
    }
  }
}

// ------------------------------------------------------------------ keyboard across the grids

const gridsIn = (root: Element) => [...root.querySelectorAll<HTMLElement>('[role="grid"]')]
const cellsIn = (grid: Element) => [...grid.querySelectorAll<HTMLElement>('[role="gridcell"]')]

/** Grid columns measured in the DOM (without layout, jsdom: 1) — the same math as `Grid`. */
function columnsIn(grid: Element): number {
  const rows = [...grid.querySelectorAll<HTMLElement>(':scope > [role="row"]')]
  if (!rows.length) return 1
  const first = rows[0].getBoundingClientRect()
  if (first.width === 0 && first.height === 0) return 1
  let n = 0
  for (const r of rows) {
    if (Math.abs(r.getBoundingClientRect().top - first.top) > 2) break
    n++
  }
  return Math.max(1, n)
}

/**
 * Before `Grid` (capture phase): at group edges, arrows, j/k, Home and End move on to the neighboring group's grid
 * (or the first/last). Inside the group, `Grid` handles it as usual (including the w/l/e/u/d shortcuts).
 */
function crossGridKeys(e: KeyboardEvent<HTMLDivElement>): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target as HTMLElement
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  const cell = target.closest<HTMLElement>('[role="gridcell"]')
  const grid = cell?.closest<HTMLElement>('[role="grid"]')
  if (!cell || !grid) return
  const grids = gridsIn(e.currentTarget)
  const gi = grids.indexOf(grid)
  if (gi < 0) return
  const cells = cellsIn(grid)
  const idx = cells.indexOf(cell)
  const cols = columnsIn(grid)
  const next = grids[gi + 1]
  const prev = grids[gi - 1]
  let to: HTMLElement | undefined
  switch (e.key) {
    case 'ArrowRight':
    case 'j':
      if (idx === cells.length - 1 && next) to = cellsIn(next)[0]
      break
    case 'ArrowLeft':
    case 'k':
      if (idx === 0 && prev) to = cellsIn(prev).at(-1)
      break
    case 'ArrowDown':
      if (idx + cols >= cells.length && next) {
        const below = cellsIn(next)
        to = below[Math.min(idx % cols, below.length - 1)]
      }
      break
    case 'ArrowUp':
      if (idx - cols < 0 && prev) {
        const above = cellsIn(prev)
        const pc = columnsIn(prev)
        const lastRow = Math.floor((above.length - 1) / pc) * pc
        to = above[Math.min(lastRow + (idx % cols), above.length - 1)]
      }
      break
    case 'Home':
      if (gi > 0) to = cellsIn(grids[0])[0]
      break
    case 'End':
      if (gi < grids.length - 1) to = cellsIn(grids[grids.length - 1]).at(-1)
      break
    default:
      return
  }
  if (!to) return
  e.preventDefault()
  e.stopPropagation()
  to.focus()
  to.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

// ------------------------------------------------------------------ grouped list

export interface GroupedGridsProps {
  runs: readonly FeedRun[]
  group: FeedGroup
  folders: ReadonlyMap<string, Folder>
  tzOffsetMin: number
  locale: string
  /** There are more pages: the last group can grow ("N+"). */
  more: boolean
  /** Collapsed group keys (applies to repeated runs of the same key). */
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  /** The `Grid` of a run (the page mounts it: cards, actions, shortcuts). */
  renderGrid: (run: FeedRun, label: string) => ReactNode
}

/** Header + grid per group; the keyboard crosses the groups (collapsed = skipped). */
export function GroupedGrids({ runs, group, folders, tzOffsetMin, locale, more, collapsed, onToggle, renderGrid }: GroupedGridsProps) {
  const t = useT('home')
  return (
    <div className={cx('feed-groups')} data-part="feed-groups" data-group-by={group} onKeyDownCapture={crossGridKeys}>
      {runs.map((run, i) => {
        const info = headInfo(run, group, folders, tzOffsetMin, t, locale)
        const open = !collapsed.has(run.key)
        const count = formatNumber(run.items.length, locale)
        const last = i === runs.length - 1
        const countText = last && more ? t('group.count_more', { count }) : count
        const countHint = t('group.count_hint', { count })
        return (
          <section key={run.id} className={cx('feed-group')} data-part="feed-group" data-group={run.key} data-collapsed={open ? undefined : 'true'}>
            <div className={cx('feed-group-head')} data-part="group-head" role="heading" aria-level={3}>
              <button type="button" className={cx('bare feed-group-toggle')} aria-expanded={open} onClick={() => onToggle(run.key)}>
                <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} className={cx('feed-group-caret')} />
                <span className={cx('feed-group-lead')}>{info.lead}</span>
                <span className={cx('feed-group-name t-head')} data-part="group-name">
                  {info.label}
                </span>
                <span className={cx('feed-group-count t-label num')} data-part="group-count" title={countHint}>
                  {countText}
                </span>
              </button>
            </div>
            {open ? renderGrid(run, info.label) : null}
          </section>
        )
      })}
    </div>
  )
}
