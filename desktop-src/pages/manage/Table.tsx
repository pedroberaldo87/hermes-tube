// Manage table: role=grid (the table has its own keyboard), fixed header with sorting (aria-sort),
// stable width (fixed columns + flexible name; right-aligned numbers in tabular figures), 38 px row and
// ROW WINDOW: only the visible rows (+ slack) become DOM; spacers above/below hold the total height.
// The scroller is the page body (`page-body`): the header sticks to its top.
// Keyboard (focus on the table, active row via aria-activedescendant): ↑/↓/Home/End/PgUp/PgDn move; Shift+↑/↓ extends the
// selection; Space checks; ⌘/Ctrl+A checks the filtered ones; Esc clears; Enter opens the row's folder; F favorites.
import { Checkbox, Codicon } from '@hermes/plugin-sdk'
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChannelRow, Folder, Tag } from '../../../shared/api-types'
import { ChannelAvatar, ChannelAvatarSkeleton, ChipSkeleton, FolderChip, TagChip, formatNumber, formatRelative, useLocale } from '../../components'
import { type Translate, useT } from '../../lib/i18n'
import { cssVar, cx } from '../../lib/style'
import { type Column, NUMERIC_COLUMNS, ROW_H, type Sort, type SortKey, gridTemplate, windowRange } from './model'
import { Picker, type PickerOption } from './Picker'

export type EditField = 'folder' | 'tags'

export interface Editing {
  id: string
  field: EditField
}

export interface RowHandlers {
  onToggle: (id: string, range: boolean) => void
  onFavorite: (row: ChannelRow) => void
  onEdit: (editing: Editing | null) => void
  onSetFolder: (row: ChannelRow, folderId: string | null) => void
  onCreateFolder: (row: ChannelRow, name: string) => void
  onSetTags: (row: ChannelRow, tagIds: string[]) => void
  onCreateTag: (row: ChannelRow, name: string, marked: string[]) => void
  onDragStart: (row: ChannelRow, dt: DataTransfer) => void
}

export interface ManageTableProps extends RowHandlers {
  rows: readonly ChannelRow[]
  columns: readonly Column[]
  /** Minimum name width (px; `nameNeed`). */
  nameMin?: number
  sort: Sort
  onSort: (key: SortKey) => void
  selected: ReadonlySet<string>
  /** Shift+arrow: extends the selection from the anchor to `to`. */
  onExtend: (from: string, to: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  /** Header checkbox: all filtered ones checked? */
  allSelected: boolean
  someSelected: boolean
  folders: ReadonlyMap<string, Folder>
  folderOptions: readonly PickerOption[]
  tags: ReadonlyMap<string, Tag>
  tagOptions: readonly PickerOption[]
  errors: Readonly<Record<string, string>>
  editing: Editing | null
  nowS: number
}

const SORTABLE: ReadonlySet<Column> = new Set(['name', 'folder', 'tags', 'last', 'rhythm', 'shorts', 'watched', 'relation'])

/** Extra rows rendered above and below the visible area. */
const OVERSCAN = 8

/** Up to here, all rows become DOM (cheap; and the full-page screenshot shows them all). Above, a window. */
export const VIRTUAL_MIN = 200

/** Height of the fixed header (px): the active row does not vanish behind it. */
const HEAD_H = 32

interface ScrollBox {
  scrollTop: number
  viewport: number
  bodyTop: number
}

/**
 * The real scroller: the closest ancestor that scrolls (in the app, `page-body`); with none, the window (`null`) —
 * as in the preview, where the page grows with the content. Resolved on every measure (the page body only starts scrolling
 * once the data arrives).
 */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null
  for (let n = el?.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1) return n
  }
  return null
}

function windowHeight(): number {
  return typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 760
}

function measure(body: HTMLElement | null): ScrollBox {
  if (!body) return { scrollTop: 0, viewport: windowHeight(), bodyTop: 0 }
  const scroller = scrollerOf(body)
  const rect = body.getBoundingClientRect()
  if (scroller) {
    return { scrollTop: scroller.scrollTop, viewport: scroller.clientHeight, bodyTop: rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop }
  }
  const y = window.scrollY || document.documentElement.scrollTop || 0
  return { scrollTop: y, viewport: windowHeight(), bodyTop: rect.top + y }
}

const raf: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (fn) => void requestAnimationFrame(fn) : (fn) => void setTimeout(fn, 16)

function useNumberFormats(locale: string) {
  return useMemo(() => {
    const fmt = (opts: Intl.NumberFormatOptions) => {
      try {
        return new Intl.NumberFormat(locale, opts)
      } catch {
        return new Intl.NumberFormat('en', opts)
      }
    }
    return { one: fmt({ maximumFractionDigits: 1 }), zero: fmt({ maximumFractionDigits: 0 }), pct: fmt({ style: 'percent', maximumFractionDigits: 0 }) }
  }, [locale])
}

export function ManageTable(props: ManageTableProps) {
  const t = useT('manage')
  const locale = useLocale()
  const { rows, columns, sort, onSort, selected, editing } = props
  const base = useId().replace(/:/g, '')
  const gridRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<ScrollBox>(() => ({ scrollTop: 0, viewport: 760, bodyTop: 0 }))
  const [active, setActive] = useState(-1)
  const formats = useNumberFormats(locale)
  const propsRef = useRef(props)
  propsRef.current = props

  // scroll (from any scroller: the event is captured on the document) and size → window
  const update = useCallback(() => {
    setBox((prev) => {
      const next = measure(bodyRef.current)
      return prev.scrollTop === next.scrollTop && prev.viewport === next.viewport && prev.bodyTop === next.bodyTop ? prev : next
    })
  }, [])
  useLayoutEffect(() => {
    let pending = false
    const onScroll = () => {
      if (pending) return
      pending = true
      raf(() => {
        pending = false
        update()
      })
    }
    update()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && bodyRef.current) {
      ro = new ResizeObserver(onScroll)
      ro.observe(bodyRef.current)
    }
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      ro?.disconnect()
    }
  }, [update])
  // the list changed size: the scroller and the body position may have changed
  useLayoutEffect(update, [rows.length, update])

  // the active row stays valid when the list changes
  useEffect(() => {
    if (active >= rows.length) setActive(rows.length - 1)
  }, [rows.length, active])

  const { start, end } = rows.length <= VIRTUAL_MIN ? { start: 0, end: rows.length } : windowRange({ ...box, total: rows.length, overscan: OVERSCAN })
  const rowId = (id: string) => `${base}-r-${id}`

  /** Brings row `i` into the visible area (discounting the fixed header). */
  const reveal = useCallback((i: number) => {
    const body = bodyRef.current
    if (!body) return
    const scroller = scrollerOf(body)
    const m = measure(body)
    const top = m.bodyTop + i * ROW_H
    let next: number | null = null
    if (top - HEAD_H < m.scrollTop) next = Math.max(0, top - HEAD_H)
    else if (top + ROW_H > m.scrollTop + m.viewport) next = top + ROW_H - m.viewport
    if (next === null) return
    if (scroller) scroller.scrollTop = next
    else window.scrollTo?.({ top: next })
    setBox(measure(body))
  }, [])

  const moveTo = (i: number, extend: boolean) => {
    if (!rows.length) return
    const next = Math.max(0, Math.min(rows.length - 1, i))
    const from = rows[active]?.channel.id ?? rows[next].channel.id
    setActive(next)
    reveal(next)
    if (extend) props.onExtend(from, rows[next].channel.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return // keyboard from a field/picker inside
    const mod = e.metaKey || e.ctrlKey
    const cur = rows[active]
    if (e.key === 'ArrowDown') moveTo(active < 0 ? 0 : active + 1, e.shiftKey)
    else if (e.key === 'ArrowUp') moveTo(active < 0 ? 0 : active - 1, e.shiftKey)
    else if (e.key === 'Home') moveTo(0, e.shiftKey)
    else if (e.key === 'End') moveTo(rows.length - 1, e.shiftKey)
    else if (e.key === 'PageDown') moveTo(active + 10, e.shiftKey)
    else if (e.key === 'PageUp') moveTo(active - 10, e.shiftKey)
    else if (e.key === ' ' && cur) props.onToggle(cur.channel.id, e.shiftKey)
    else if ((e.key === 'a' || e.key === 'A') && mod) props.onSelectAll()
    else if (e.key === 'Escape' && selected.size) props.onClearSelection()
    else if (e.key === 'Enter' && cur && !mod) props.onEdit({ id: cur.channel.id, field: 'folder' })
    else if ((e.key === 'f' || e.key === 'F') && cur && !mod && !e.altKey) props.onFavorite(cur)
    else return
    e.preventDefault()
  }

  /** Click on a row (outside the controls): activates; Shift = range; ⌘/Ctrl = check/uncheck. */
  const onRowClick = useCallback((e: MouseEvent<HTMLDivElement>, index: number, id: string) => {
    if ((e.target as HTMLElement).closest('button, input, a, [role="option"], [data-part="manage-picker"]')) return
    setActive(index)
    gridRef.current?.focus({ preventScroll: true })
    if (e.shiftKey) propsRef.current.onToggle(id, true)
    else if (e.metaKey || e.ctrlKey) propsRef.current.onToggle(id, false)
  }, [])

  const onSelectCell = useCallback((e: MouseEvent<HTMLDivElement>, index: number, id: string) => {
    e.stopPropagation()
    setActive(index)
    propsRef.current.onToggle(id, e.shiftKey)
  }, [])

  const style = { [cssVar('cols')]: gridTemplate(columns, props.nameMin) } as CSSProperties
  const activeId = rows[active] && active >= start && active < end ? rowId(rows[active].channel.id) : undefined

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={t('table_label')}
      aria-multiselectable="true"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
      aria-activedescendant={activeId}
      tabIndex={0}
      className={cx('mtable')}
      data-part="manage-table"
      style={style}
      onKeyDown={onKeyDown}
    >
      <div role="rowgroup">
        <div role="row" aria-rowindex={1} className={cx('mhead')} data-part="manage-head">
          {columns.map((c) => (
            <HeadCell
              key={c}
              col={c}
              t={t}
              sort={sort}
              onSort={onSort}
              allSelected={props.allSelected}
              someSelected={props.someSelected}
              count={rows.length}
              onSelectAll={props.allSelected ? props.onClearSelection : props.onSelectAll}
            />
          ))}
        </div>
      </div>
      <div role="rowgroup" ref={bodyRef}>
        {start > 0 ? <div aria-hidden="true" data-part="manage-spacer-top" style={{ height: `${start * ROW_H}px` }} /> : null}
        {rows.slice(start, end).map((row, k) => {
          const i = start + k
          const id = row.channel.id
          return (
            <Row
              key={id}
              domId={rowId(id)}
              index={i}
              row={row}
              columns={columns}
              selected={selected.has(id)}
              active={i === active}
              editing={editing && editing.id === id ? editing.field : null}
              error={props.errors[id] ?? null}
              folder={row.channel.folder_id ? (props.folders.get(row.channel.folder_id) ?? null) : null}
              tags={props.tags}
              folderOptions={props.folderOptions}
              tagOptions={props.tagOptions}
              nowS={props.nowS}
              locale={locale}
              formats={formats}
              onRowClick={onRowClick}
              onSelectCell={onSelectCell}
              handlers={propsRef}
            />
          )
        })}
        <div aria-hidden="true" data-part="manage-spacer-bottom" style={{ height: `${Math.max(0, rows.length - end) * ROW_H}px` }} />
      </div>
    </div>
  )
}

function HeadCell({
  col,
  t,
  sort,
  onSort,
  allSelected,
  someSelected,
  count,
  onSelectAll
}: {
  col: Column
  t: Translate
  sort: Sort
  onSort: (key: SortKey) => void
  allSelected: boolean
  someSelected: boolean
  count: number
  onSelectAll: () => void
}) {
  const fmtLocale = useLocale()
  if (col === 'select') {
    return (
      <div
        role="columnheader"
        className={cx('mcell mhead-cell')}
        data-col="select"
        onClick={(e) => {
          e.stopPropagation()
          onSelectAll()
        }}
      >
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={() => undefined}
          tabIndex={-1}
          data-part="manage-select-all"
          aria-label={t('select_all', { count: formatNumber(count, fmtLocale) })}
        />
      </div>
    )
  }
  const sortable = SORTABLE.has(col)
  const on = sort.key === col
  const ariaSort = !sortable ? undefined : on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  const label = t(`columns.${col}`)
  const hint = col === 'last' || col === 'rhythm' || col === 'shorts' || col === 'watched' ? t(`column_hints.${col}`) : undefined
  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
      className={cx('mcell mhead-cell')}
      data-col={col}
      data-num={NUMERIC_COLUMNS.has(col) ? 'true' : undefined}
    >
      {sortable ? (
        <button type="button" tabIndex={-1} className={cx('bare msort')} title={hint} aria-label={t('sort_by', { name: label })} onClick={() => onSort(col as SortKey)}>
          <span className={cx('truncate')}>{label}</span>
          <Codicon name={on && sort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} className={cx('msort-icon')} />
        </button>
      ) : (
        <span className={cx('truncate')}>{label}</span>
      )}
    </div>
  )
}

interface RowProps {
  domId: string
  index: number
  row: ChannelRow
  columns: readonly Column[]
  selected: boolean
  active: boolean
  editing: EditField | null
  error: string | null
  folder: Folder | null
  tags: ReadonlyMap<string, Tag>
  folderOptions: readonly PickerOption[]
  tagOptions: readonly PickerOption[]
  nowS: number
  locale: string
  formats: ReturnType<typeof useNumberFormats>
  onRowClick: (e: MouseEvent<HTMLDivElement>, index: number, id: string) => void
  onSelectCell: (e: MouseEvent<HTMLDivElement>, index: number, id: string) => void
  /** Stable ref with the current handlers (the memoized row does not re-render because of them). */
  handlers: { current: RowHandlers }
}

const Row = memo(function Row({
  domId,
  index,
  row,
  columns,
  selected,
  active,
  editing,
  error,
  folder,
  tags,
  folderOptions,
  tagOptions,
  nowS,
  locale,
  formats,
  onRowClick,
  onSelectCell,
  handlers
}: RowProps) {
  const t = useT('manage')
  const c = row.channel
  const h = () => handlers.current
  const dash = <span className={cx('mnone')}>–</span>
  const rowTags = c.tag_ids.map((id) => tags.get(id)).filter((x): x is Tag => !!x)

  const cell = (col: Column) => {
    switch (col) {
      case 'select':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="select" onClick={(e) => onSelectCell(e, index, c.id)}>
            <Checkbox checked={selected} onCheckedChange={() => undefined} tabIndex={-1} aria-label={t('select_row', { name: c.title })} />
          </div>
        )
      case 'name':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="name">
            <ChannelAvatar title={c.title} thumb={c.thumb} size={24} />
            <span className={cx('mname-text')}>
              <span className={cx('mname-line')}>
                <span className={cx('mname-title truncate')} title={c.ai_note ? `${c.title} — ${c.ai_note}` : c.title}>
                  {c.title}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  className={cx('bare mfav')}
                  data-part="manage-fav"
                  aria-pressed={c.favorite}
                  aria-label={t('favorite')}
                  onClick={() => h().onFavorite(row)}
                >
                  <Codicon name={c.favorite ? 'star-full' : 'star-empty'} size={13} />
                </button>
                {c.muted ? (
                  <span className={cx('mmuted')} role="img" aria-label={t('muted')} title={t('muted')}>
                    <Codicon name="bell-slash" size={12} />
                  </span>
                ) : null}
              </span>
              {error ? (
                <span className={cx('mrow-error t-label')} data-part="manage-row-error" role="status" title={error}>
                  <Codicon name="error" size={12} className={cx('mrow-error-icon')} />
                  <span className={cx('truncate')}>{error}</span>
                </span>
              ) : c.handle ? (
                <span className={cx('mname-sub t-label truncate')}>{c.handle}</span>
              ) : null}
            </span>
          </div>
        )
      case 'folder':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="folder">
            <button
              type="button"
              tabIndex={-1}
              className={cx('bare medit')}
              data-part="manage-folder-edit"
              aria-haspopup="listbox"
              aria-expanded={editing === 'folder'}
              aria-label={t('edit_folder', { name: c.title })}
              onClick={() => h().onEdit(editing === 'folder' ? null : { id: c.id, field: 'folder' })}
            >
              {folder ? <FolderChip folder={folder} /> : <span className={cx('mplaceholder t-label')}>{t('no_folder')}</span>}
            </button>
            {editing === 'folder' ? (
              <Picker
                label={t('edit_folder', { name: c.title })}
                options={folderOptions}
                value={c.folder_id ?? ''}
                searchable
                onPick={(v) => h().onSetFolder(row, v || null)}
                onCreate={(name) => h().onCreateFolder(row, name)}
                createLabel={(name) => t('picker.create_folder', { name })}
                onClose={() => h().onEdit(null)}
              />
            ) : null}
          </div>
        )
      case 'tags':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="tags">
            <button
              type="button"
              tabIndex={-1}
              className={cx('bare medit')}
              data-part="manage-tags-edit"
              aria-haspopup="listbox"
              aria-expanded={editing === 'tags'}
              aria-label={t('edit_tags', { name: c.title })}
              onClick={() => h().onEdit(editing === 'tags' ? null : { id: c.id, field: 'tags' })}
            >
              {rowTags.length ? (
                <>
                  {rowTags.slice(0, 2).map((tag) => (
                    <TagChip key={tag.id} tag={tag} />
                  ))}
                  {rowTags.length > 2 ? <span className={cx('mmore t-label')}>+{rowTags.length - 2}</span> : null}
                </>
              ) : (
                <span className={cx('mplaceholder t-label')} data-hover="true">
                  {t('add_tags')}
                </span>
              )}
            </button>
            {editing === 'tags' ? (
              <Picker
                label={t('edit_tags', { name: c.title })}
                options={tagOptions}
                mode="multi"
                values={c.tag_ids}
                searchable
                onCommit={(ids) => h().onSetTags(row, ids)}
                onCreate={(name, marked) => h().onCreateTag(row, name, marked ?? c.tag_ids)}
                createLabel={(name) => t('picker.create_tag', { name })}
                onClose={() => h().onEdit(null)}
              />
            ) : null}
          </div>
        )
      case 'last':
        return (
          <div
            key={col}
            role="gridcell"
            className={cx('mcell t-label')}
            data-col="last"
            data-num="true"
            title={c.last_video_at ? new Date(c.last_video_at * 1000).toLocaleDateString(locale) : undefined}
          >
            {c.last_video_at ? formatRelative(c.last_video_at, nowS * 1000, locale) : dash}
          </div>
        )
      case 'rhythm': {
        const v = c.videos_per_week
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="rhythm" data-num="true">
            {v == null ? dash : t('rhythm_value', { n: (v < 10 ? formats.one : formats.zero).format(v) })}
          </div>
        )
      }
      case 'shorts':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="shorts" data-num="true">
            {c.shorts_ratio == null ? dash : formats.pct.format(c.shorts_ratio)}
          </div>
        )
      case 'watched':
        return (
          <div key={col} role="gridcell" className={cx('mcell')} data-col="watched" data-num="true">
            {row.watched_90d == null ? dash : formatNumber(row.watched_90d, locale)}
          </div>
        )
      case 'relation':
        return (
          <div key={col} role="gridcell" className={cx('mcell t-label')} data-col="relation">
            {t(`relation.${c.relation}`)}
          </div>
        )
    }
  }

  return (
    <div
      id={domId}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={cx('mrow')}
      data-part="manage-row"
      data-channel={c.id}
      data-active={active ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      draggable={editing ? undefined : true}
      onDragStart={(e) => {
        if (e.dataTransfer) h().onDragStart(row, e.dataTransfer)
      }}
      onClick={(e) => onRowClick(e, index, c.id)}
    >
      {columns.map(cell)}
    </div>
  )
})

/** Same geometry as the table, without data (loading). */
export function ManageTableSkeleton({ columns, rows = 12 }: { columns: readonly Column[]; rows?: number }) {
  const t = useT('manage')
  const style = { [cssVar('cols')]: gridTemplate(columns) } as CSSProperties
  const widths = ['52%', '64%', '44%', '72%', '58%', '48%']
  return (
    <div role="grid" aria-label={t('loading')} aria-busy="true" className={cx('mtable')} data-part="manage-table" style={style}>
      <div role="rowgroup">
        <div role="row" className={cx('mhead')} data-part="manage-head">
          {columns.map((c) => (
            <div key={c} role="columnheader" className={cx('mcell mhead-cell')} data-col={c} data-num={NUMERIC_COLUMNS.has(c) ? 'true' : undefined}>
              {c === 'select' ? null : <span className={cx('truncate')}>{t(`columns.${c}`)}</span>}
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} role="row" className={cx('mrow')} data-part="manage-row" data-skeleton aria-hidden="true">
            {columns.map((c) => (
              <div key={c} role="gridcell" className={cx('mcell')} data-col={c} data-num={NUMERIC_COLUMNS.has(c) ? 'true' : undefined}>
                {c === 'name' ? (
                  <>
                    <ChannelAvatarSkeleton size={24} />
                    <span className={cx('mname-text')}>
                      <span className={cx('t-body')}>
                        <SkLine width={widths[i % widths.length]} />
                      </span>
                    </span>
                  </>
                ) : c === 'folder' || c === 'tags' ? (
                  <ChipSkeleton width={c === 'folder' ? '76px' : '56px'} />
                ) : c === 'select' ? null : (
                  <span className={cx('t-label')}>
                    <SkLine width="32px" />
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Skeleton bar inside a text row (same kit class). */
function SkLine({ width }: { width: string }) {
  return (
    <span className={cx('sk-line')} style={{ width }}>
      <span className={cx('sk')} style={{ [cssVar('sk-w')]: '100%' } as CSSProperties} />
    </span>
  )
}
