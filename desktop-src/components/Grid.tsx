// Video grid: auto-fill by container width, 3 densities and full keyboard support.
//   arrows / j k  move focus · Home/End · Enter opens · w watched · l later · e archive · / search
// ARIA: grid > row > gridcell (one cell per row; the 2D layout is visual), roving tabindex (only the
// active cell is in the Tab order; actions inside the card leave the Tab order and answer to shortcuts).
import { type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../lib/style'
import { GridContext, vars } from './kit'
import { VideoCardSkeleton, type VideoCardVariant } from './VideoCard'

export type Density = 'comfortable' | 'compact' | 'list'

export const DENSITIES: readonly Density[] = ['comfortable', 'compact', 'list']

/** Letter shortcuts → action (the same applies to the Kbd shown in the quick actions). */
export const GRID_SHORTCUTS: Readonly<Record<string, string>> = { w: 'watched', l: 'later', e: 'archive' }

/** Card variant for each density. */
export function cardVariantFor(density: Density): VideoCardVariant {
  return density === 'list' ? 'row' : density === 'compact' ? 'compact' : 'grid'
}

export interface GridProps<T> {
  items: readonly T[]
  getKey: (item: T, index: number) => string
  renderItem: (item: T, state: { index: number; active: boolean }) => ReactNode
  /** Accessible label of the grid (e.g. the tab name). */
  label: string
  density?: Density
  /** Forces the number of columns for navigation (default: measured in the DOM). */
  columns?: number
  onOpen?: (item: T, index: number) => void
  onAction?: (action: string, item: T, index: number) => void
  /** `/` — the page focuses the search. */
  onSearch?: () => void
  shortcuts?: Readonly<Record<string, string>>
  /** Loading: skeleton with the same geometry (same density). */
  loading?: boolean
  skeletonCount?: number
  /** No items: empty state (always with a way forward). */
  empty?: ReactNode
}

function measureColumns(root: HTMLElement | null): number {
  const rows = root ? [...root.querySelectorAll<HTMLElement>(':scope > [role="row"]')] : []
  if (!rows.length) return 1
  const first = rows[0].getBoundingClientRect()
  if (first.width === 0 && first.height === 0) return 1 // no layout (jsdom)
  let n = 0
  for (const r of rows) {
    if (Math.abs(r.getBoundingClientRect().top - first.top) > 2) break
    n++
  }
  return Math.max(1, n)
}

function isTextField(el: HTMLElement): boolean {
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function Grid<T>(props: GridProps<T>) {
  const {
    items,
    getKey,
    renderItem,
    label,
    density = 'comfortable',
    columns,
    onOpen,
    onAction,
    onSearch,
    shortcuts = GRID_SHORTCUTS,
    loading,
    skeletonCount,
    empty
  } = props
  const ref = useRef<HTMLDivElement>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const lastIndex = useRef(0)
  const keys = items.map((it, i) => getKey(it, i))
  let activeIndex = activeKey === null ? -1 : keys.indexOf(activeKey)
  // the active item left (archived): focus stays on the neighbour at the same position
  if (activeIndex < 0) activeIndex = Math.max(0, Math.min(lastIndex.current, items.length - 1))

  useEffect(() => {
    lastIndex.current = activeIndex
  })

  // the active item left while it had focus: give focus back to the cell now in its place
  const hadFocus = useRef(false)
  useEffect(() => {
    if (!hadFocus.current) return
    const root = ref.current
    if (root && !root.contains(document.activeElement)) root.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.focus()
  }, [items.length, activeIndex])

  if (loading) return <GridSkeleton density={density} count={skeletonCount} label={label} />
  if (!items.length) return <>{empty ?? null}</>

  const focusIndex = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i))
    setActiveKey(keys[n])
    const el = ref.current?.querySelector<HTMLElement>(`[data-index="${n}"]`)
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const cell = target.closest<HTMLElement>('[role="gridcell"]')
    if (!cell || !ref.current?.contains(cell) || isTextField(target)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const idx = Number(cell.getAttribute('data-index'))
    const cols = columns ?? measureColumns(ref.current)
    const onCell = target === cell
    switch (e.key) {
      case 'ArrowRight':
      case 'j':
        focusIndex(idx + 1)
        break
      case 'ArrowLeft':
      case 'k':
        focusIndex(idx - 1)
        break
      case 'ArrowDown':
        if (idx + cols < items.length) focusIndex(idx + cols)
        break
      case 'ArrowUp':
        if (idx - cols >= 0) focusIndex(idx - cols)
        break
      case 'Home':
        focusIndex(0)
        break
      case 'End':
        focusIndex(items.length - 1)
        break
      case 'Enter':
        if (!onCell) return // inner button: keep the native click
        onOpen?.(items[idx], idx)
        break
      case '/':
        if (!onSearch) return
        onSearch()
        break
      default: {
        const action = shortcuts[e.key]
        if (!action || !onAction) return
        onAction(action, items[idx], idx)
      }
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    hadFocus.current = true
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]')
    const key = cell?.getAttribute('data-key')
    if (key != null && key !== activeKey) setActiveKey(key)
  }

  return (
    <GridContext.Provider value={true}>
      <div
        ref={ref}
        role="grid"
        aria-label={label}
        aria-rowcount={items.length}
        className={cx('grid')}
        data-part="grid"
        data-density={density}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={(e) => {
          if (!ref.current?.contains(e.relatedTarget as Node | null)) hadFocus.current = false
        }}
      >
        {items.map((item, i) => (
          <div key={keys[i]} role="row" aria-rowindex={i + 1} className={cx('grid-row')} style={vars({ i })}>
            <div
              role="gridcell"
              className={cx('grid-cell')}
              tabIndex={i === activeIndex ? 0 : -1}
              data-index={i}
              data-key={keys[i]}
            >
              {renderItem(item, { index: i, active: i === activeIndex })}
            </div>
          </div>
        ))}
      </div>
    </GridContext.Provider>
  )
}

export interface GridSkeletonProps {
  density?: Density
  /** Minimum number of cards (default 8); always completes the grid's last row. */
  count?: number
  /** Whole rows (wins over `count`): `rows × columns`. */
  rows?: number
  /** Columns (default: measured in the DOM, the same as the real grid — auto-fill by width). */
  columns?: number
  label?: string
}

/** Columns the grid (auto-fill) resolves at the current width; without layout (jsdom), null. */
function resolvedColumns(el: HTMLElement | null): number | null {
  if (!el || typeof getComputedStyle !== 'function') return null
  const tracks = getComputedStyle(el).gridTemplateColumns
  if (!tracks || tracks === 'none') return null
  const n = tracks.trim().split(/\s+/).filter((t) => /px$/.test(t)).length
  return n > 0 ? n : null
}

/** Grid skeleton: same density, same geometry and the SAME number of columns (complete rows). */
export function GridSkeleton({ density = 'comfortable', count = 8, rows, columns, label }: GridSkeletonProps) {
  const variant = cardVariantFor(density)
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (columns != null) return
    const read = () => setMeasured(resolvedColumns(ref.current))
    read()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [columns, density])
  const cols = density === 'list' ? 1 : Math.max(1, columns ?? measured ?? 1)
  const total = rows != null ? Math.max(1, rows) * cols : Math.ceil(Math.max(1, count) / cols) * cols
  return (
    <div ref={ref} className={cx('grid')} data-part="grid" data-density={density} aria-busy="true" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={cx('grid-row')} style={vars({ i })}>
          <VideoCardSkeleton variant={variant} />
        </div>
      ))}
    </div>
  )
}
