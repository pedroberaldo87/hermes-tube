// Navigation: TabBar over the SDK's Tabs* (counter, horizontal scroll with edge shadow,
// "+ new tab"), ModeSwitch (density, the SDK's SegmentedControl) and FilterBar (the SDK's SearchField).
// Tab management on the bar itself: drag to reorder (near the edge, the bar scrolls), Alt+Shift+←/→
// on the keyboard, and the tab menu (right click, Shift+F10/Menu key, subtle "⋯" on the active tab).
import {
  Button,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SearchField,
  SegmentedControl,
  Tabs,
  TabsList,
  TabsTrigger,
  Tip
} from '@hermes/plugin-sdk'
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useT } from '../lib/i18n'
import { CLASS_PREFIX, cx } from '../lib/style'
import { DENSITIES, type Density } from './Grid'
import { SkBar, useFormatCount, vars } from './kit'
import { TIP_DELAY_MS } from './QuickActions'

/** Inset of the active tab's underline from the tab's edges (same as the horizontal padding). */
const TAB_INK_INSET = 10
/** Dragging closer than this to the bar's edge scrolls it (px) — and how far it scrolls per `dragover`. */
const DRAG_EDGE_PX = 32
const DRAG_SCROLL_STEP = 16
/** Drag type of the tab (custom: dropping a tab on a text field does not paste the id). */
const TAB_DRAG_TYPE = `application/x-${CLASS_PREFIX}tab`

/** A tab menu item. */
export interface TabMenuEntry {
  id: string
  label: string
  /** Codicon. */
  icon?: string
  onSelect: () => void
  disabled?: boolean
  /** Destructive action (Delete…): comes after a separator. */
  destructive?: boolean
}

export interface TabBarItem {
  id: string
  label: string
  /** New videos in the tab (accent when > 0; zero is not shown). */
  count?: number | null
  /** Codicon. */
  icon?: string | null
}

export interface TabBarProps {
  tabs: readonly TabBarItem[]
  value: string
  onChange: (id: string) => void
  /** "+ New tab". */
  onAdd?: () => void
  addLabel?: string
  /** Replaces the default "+" (e.g. the trigger of a menu anchored at the end of the bar). With it, `onAdd` is unused. */
  addSlot?: ReactNode
  /** Accessible label of the tab list. */
  label?: string
  /** Reorder (drag, Alt+Shift+←/→): receives the new order of the reorderable tabs (only those). */
  onReorder?: (ids: string[]) => void
  /** Which tabs move (default: all, with `onReorder`); the others stay put and accept no drop. */
  reorderable?: (id: string) => boolean
  /** Tab menu items (null/empty = no menu: neither right click nor "⋯"). */
  menu?: (id: string) => readonly TabMenuEntry[] | null
  /** Accessible name of the "⋯" (receives the tab label); kit default. */
  menuLabel?: (tabLabel: string) => string
  /** Menu already open on this tab (preview). */
  defaultMenuTab?: string
}

type Overflow = 'none' | 'start' | 'end' | 'both'

/** New order: `from` leaves and goes before/after `to` (only among the reorderable ones). */
function reorderIds(ids: readonly string[], from: string, to: string, side: 'before' | 'after'): string[] {
  const rest = ids.filter((id) => id !== from)
  const at = rest.indexOf(to)
  if (at < 0 || !ids.includes(from)) return [...ids]
  rest.splice(side === 'after' ? at + 1 : at, 0, from)
  return rest
}

export function TabBar({ tabs, value, onChange, onAdd, addLabel, label, addSlot, onReorder, reorderable, menu, menuLabel, defaultMenuTab }: TabBarProps) {
  const t = useT()
  const fmt = useFormatCount()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<Overflow>('none')
  const [menuTab, setMenuTab] = useState<string | null>(defaultMenuTab ?? null)
  const dragId = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const refocus = useRef<string | null>(null)
  const canMove = (id: string) => !!onReorder && (reorderable ? reorderable(id) : true)
  const movable = tabs.filter((x) => canMove(x.id)).map((x) => x.id)

  // after a keyboard move the tab keeps focus (React moves the node; moving drops focus)
  useLayoutEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find((n) => n.getAttribute('data-tab-id') === id)
    if (el && document.activeElement !== el) el.focus()
  }, [tabs])

  const endDrag = () => {
    dragId.current = null
    setDragging(null)
    setOver(null)
  }

  const sideFor = (target: string): 'before' | 'after' | null => {
    const from = dragId.current
    if (!from || from === target || !canMove(target)) return null
    return movable.indexOf(from) < movable.indexOf(target) ? 'after' : 'before'
  }

  const dragProps = (id: string) =>
    onReorder
      ? {
          draggable: canMove(id),
          onDragStart: (e: DragEvent<HTMLElement>) => {
            if (!canMove(id)) {
              e.preventDefault()
              return
            }
            dragId.current = id
            setDragging(id)
            setMenuTab(null)
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(TAB_DRAG_TYPE, id)
            }
          },
          onDragEnter: (e: DragEvent<HTMLElement>) => {
            if (sideFor(id)) e.preventDefault()
          },
          onDragOver: (e: DragEvent<HTMLElement>) => {
            const side = sideFor(id)
            if (!side) return
            e.preventDefault()
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            setOver((o) => (o && o.id === id && o.side === side ? o : { id, side }))
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            const side = sideFor(id)
            const from = dragId.current
            if (side && from) {
              e.preventDefault()
              const next = reorderIds(movable, from, id, side)
              if (next.join('\n') !== movable.join('\n')) onReorder(next)
            }
            endDrag()
          },
          onDragEnd: endDrag
        }
      : {}

  // dragging near the edge scrolls the bar (tabs outside come into view)
  const onScrollDragOver = (e: DragEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!dragId.current || !el) return
    const r = el.getBoundingClientRect()
    if (e.clientX > r.right - DRAG_EDGE_PX) el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + DRAG_SCROLL_STEP)
    else if (e.clientX < r.left + DRAG_EDGE_PX) el.scrollLeft = Math.max(0, el.scrollLeft - DRAG_SCROLL_STEP)
  }

  const moveBy = (id: string, delta: -1 | 1) => {
    const i = movable.indexOf(id)
    const j = i + delta
    if (!onReorder || i < 0 || j < 0 || j >= movable.length) return
    const next = [...movable]
    next.splice(i, 1)
    next.splice(j, 0, id)
    refocus.current = id
    onReorder(next)
  }

  const onTabKeyDown = (id: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (!canMove(id)) return
      e.preventDefault()
      moveBy(id, e.key === 'ArrowLeft' ? -1 : 1)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      if (!menu?.(id)?.length) return
      e.preventDefault()
      setMenuTab(id)
    }
  }

  const onTabContextMenu = (id: string) => (e: MouseEvent<HTMLElement>) => {
    if (!menu) return
    e.preventDefault()
    setMenuTab(menu(id)?.length ? id : null)
  }

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none')
  }, [])

  useEffect(() => {
    measure()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, tabs.length])

  // the active tab stays in view
  useEffect(() => {
    const tabs = scrollRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
    const active = [...tabs].find((el) => el.getAttribute('data-tab-id') === value)
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [value])

  // single indicator that slides to the active tab (measured position; without a measurement — jsdom —, each tab uses
  // its own underline). The first placement does not animate; later changes slide.
  const [ink, setInk] = useState<{ x: number; w: number; moved: boolean } | null>(null)
  const placeInk = useCallback(() => {
    const box = scrollRef.current
    const el = box ? [...box.querySelectorAll<HTMLElement>('[data-tab-id]')].find((n) => n.getAttribute('data-tab-id') === value) : null
    if (!box || !el) return setInk(null)
    const a = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (a.width === 0) return setInk(null)
    const x = Math.round(a.left - b.left + box.scrollLeft + TAB_INK_INSET)
    const w = Math.max(0, Math.round(a.width - 2 * TAB_INK_INSET))
    setInk((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w, moved: prev != null }))
  }, [value])
  useLayoutEffect(() => {
    placeInk()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(placeInk)
    ro.observe(el)
    return () => ro.disconnect()
  }, [placeInk, tabs])

  // Radix activates on mousedown and the click repeats it: only tell the page when it changes
  const select = (id: string) => {
    if (id !== value) onChange(id)
  }

  return (
    <div className={cx('tabbar')} data-part="tabbar" data-overflow={overflow} data-ink={ink ? 'true' : undefined}>
      <Tabs value={value} onValueChange={select} className={cx('tabbar-root')}>
        <div className={cx('tabbar-scroll')} data-part="tabbar-scroll" ref={scrollRef} onScroll={measure} onDragOver={onScrollDragOver}>
          <span
            className={cx('tab-ink')}
            data-part="tab-ink"
            data-moved={ink?.moved ? 'true' : undefined}
            aria-hidden="true"
            style={ink ? vars({ 'ink-x': `${ink.x}px`, 'ink-w': `${ink.w}px` }) : undefined}
          />
          <TabsList aria-label={label ?? t('kit.tabs.label')} className={cx('tabbar-list')}>
            {tabs.map((tab) => {
              const entries = menu?.(tab.id) ?? null
              const hasMenu = !!entries?.length
              const open = hasMenu && menuTab === tab.id
              const active = tab.id === value
              const moreLabel = menuLabel ? menuLabel(tab.label) : t('kit.tabs.menu', { name: tab.label })
              // menu trigger: the "⋯" on the active tab; on the others, an invisible anchor (opened by right click)
              const anchor =
                hasMenu && active ? (
                  <Tip label={moreLabel} delayDuration={TIP_DELAY_MS} side="top">
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" className={cx('tab-more')} data-part="tab-more" tabIndex={-1} aria-label={moreLabel}>
                        <Codicon name="ellipsis" size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tip>
                ) : open ? (
                  <DropdownMenuTrigger asChild>
                    <span className={cx('tab-menu-anchor')} aria-hidden="true" />
                  </DropdownMenuTrigger>
                ) : null
              return (
                <span
                  key={tab.id}
                  className={cx('tab-cell')}
                  data-tab-cell={tab.id}
                  data-drop={over?.id === tab.id ? over.side : undefined}
                  data-dragging={dragging === tab.id ? 'true' : undefined}
                >
                  <TabsTrigger
                    value={tab.id}
                    className={cx('tab')}
                    data-tab-id={tab.id}
                    onClick={() => select(tab.id)}
                    onKeyDown={onTabKeyDown(tab.id)}
                    onContextMenu={onTabContextMenu(tab.id)}
                    {...dragProps(tab.id)}
                  >
                    {tab.icon ? <Codicon name={tab.icon} size={14} className={cx('tab-icon')} /> : null}
                    <span>{tab.label}</span>
                    {tab.count ? (
                      <span className={cx('tab-count')} data-part="tab-count" aria-label={t('kit.tabs.new_count', { count: fmt(tab.count) })}>
                        {fmt(tab.count)}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  {anchor ? (
                    <DropdownMenu open={open} onOpenChange={(o: boolean) => setMenuTab(o ? tab.id : null)}>
                      {anchor}
                      <DropdownMenuContent align="start">
                        {open && entries
                          ? entries.flatMap((entry, i) => [
                              entry.destructive && i > 0 ? <DropdownMenuSeparator key={`sep-${entry.id}`} /> : null,
                              <DropdownMenuItem
                                key={entry.id}
                                data-menu={entry.id}
                                disabled={entry.disabled}
                                variant={entry.destructive ? 'destructive' : undefined}
                                onSelect={() => {
                                  setMenuTab(null)
                                  if (!entry.disabled) entry.onSelect()
                                }}
                              >
                                {entry.icon ? <Codicon name={entry.icon} size={14} /> : null}
                                {entry.label}
                              </DropdownMenuItem>
                            ])
                          : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </span>
              )
            })}
          </TabsList>
        </div>
      </Tabs>
      {addSlot != null && addSlot !== false ? (
        <div className={cx('tab-add-slot')} data-part="tab-add-slot">
          {addSlot}
        </div>
      ) : onAdd ? (
        <Button variant="ghost" size="xs" className={cx('tab-add')} data-part="tab-add" onClick={onAdd}>
          <Codicon name="add" size={14} />
          <span className={cx('tab-add-label')}>{addLabel ?? t('kit.tabs.add')}</span>
        </Button>
      ) : null}
    </div>
  )
}

const TAB_SKELETON_WIDTHS = ['44px', '72px', '56px', '88px', '64px', '52px']

export function TabBarSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={cx('tabbar')} data-part="tabbar" data-skeleton aria-busy="true">
      <div className={cx('tabbar-list')} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={cx('tab-skeleton')} style={{ width: TAB_SKELETON_WIDTHS[i % TAB_SKELETON_WIDTHS.length] }}>
            <SkBar width="100%" />
          </span>
        ))}
      </div>
    </div>
  )
}

export interface ModeSwitchProps {
  value: Density
  onChange: (density: Density) => void
}

/** Grid density: comfortable · compact · list. */
export function ModeSwitch({ value, onChange }: ModeSwitchProps) {
  const t = useT()
  const options = DENSITIES.map((id) => ({ id, label: t(`kit.density.${id}`) }))
  return (
    <div className={cx('mode')} data-part="mode" role="group" aria-label={t('kit.density.label')}>
      <SegmentedControl<Density> options={options} value={value} onChange={onChange} sizing="content" />
    </div>
  )
}

export interface StatusBarItemProps {
  /** Text (e.g. "12 new"); the count, if separate, goes in `count` (accent). */
  label: ReactNode
  count?: number | null
  icon?: string
  /** Small text after the label (e.g. "refreshing…"). */
  note?: ReactNode
  title?: string
  onClick?: () => void
}

/** App status bar item (the chip): inherits the host font, monochrome; new items in accent. */
export function StatusBarItem({ label, count, icon, note, title, onClick }: StatusBarItemProps) {
  const fmt = useFormatCount()
  return (
    <button type="button" className={cx('bare baritem')} data-part="baritem" title={title} onClick={onClick}>
      {icon ? <Codicon name={icon} size={12} /> : null}
      {count ? <span className={cx('baritem-count')}>{fmt(count)}</span> : null}
      <span>{label}</span>
      {note ? <span className={cx('baritem-note')}>{note}</span> : null}
    </button>
  )
}

export interface FilterBarProps {
  /** Search text (controlled). Without `onQueryChange`, there is no search field. */
  query?: string
  onQueryChange?: (query: string) => void
  placeholder?: string
  /** Filter chips (FolderChip, TagChip, …). */
  children?: ReactNode
  /** Result count (tabular figures). */
  resultCount?: number | null
  /** "Clear filters". */
  onClear?: () => void
  /** Input ref (the page focuses it with `/`). */
  searchRef?: RefObject<HTMLInputElement | null>
}

export function FilterBar({ query, onQueryChange, placeholder, children, resultCount, onClear, searchRef }: FilterBarProps) {
  const t = useT()
  const fmt = useFormatCount()
  const text = placeholder ?? t('kit.filter.search')
  return (
    <div className={cx('filterbar')} data-part="filterbar">
      {onQueryChange ? (
        <div className={cx('filterbar-search')}>
          <SearchField
            value={query ?? ''}
            onChange={(next: string) => onQueryChange(next)}
            placeholder={text}
            aria-label={text}
            {...(searchRef ? { inputRef: searchRef } : {})}
            {...(query ? { onClear: () => onQueryChange('') } : {})}
          />
        </div>
      ) : null}
      {children ? <div className={cx('filterbar-filters')}>{children}</div> : null}
      {resultCount != null ? (
        <span className={cx('filterbar-count t-label')} aria-live="polite">
          {t('kit.filter.results', { count: fmt(resultCount) })}
        </span>
      ) : null}
      {onClear ? (
        <Button variant="text" size="xs" data-part="filter-clear" onClick={onClear}>
          {t('kit.filter.clear')}
        </Button>
      ) : null}
    </div>
  )
}
