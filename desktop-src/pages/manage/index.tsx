// Manage: every channel in a dense table, with filters and batch actions.
//   data       GET /channels (all relations, pages of 2000 by offset), GET /folders, GET /tags, GET /status
//   table      Table.tsx (row windowing, sticky header, sorting, keyboard, inline editing, dragging)
//   filters    one bar (the kit's FilterBar): search, folder (a selector only when narrow; wide = list on the left), tag,
//              relation, ⭐, muted, "no video for N months"; removable chips; "N of M channels"; remembered in
//              `ctx.storage` (they survive leaving and coming back)
//   batch      Batch.tsx (POST /channels/batch, POST /read; undo via change_id); "Organize with Hermes"
//   folders    Rail.tsx (filter, drop target, create/rename in place)
// Filtering and sorting happen on the client: the route returns everything at once (up to 2000 per page, 37 ms for 400 channels) and
// the contract has no sorting. History and "create tab" live in pages/manage/history; unsubscribing belongs to Cleanup (never here).
// Rules: only lib/, components/ and shared/ (no other screen/dialog imported). Text through useT('manage').
import { Button, Codicon, host, useQuery } from '@hermes/plugin-sdk'
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChannelRow, Folder, Tag } from '../../../shared/api-types'
import { Banner, EmptyView, ErrorView, FilterBar, PageFrame, SectionFrame, useFormatCount } from '../../components'
import { maybePluginContext } from '../../lib/ctx'
import { openDialog } from '../../lib/dialogs'
import { pickExtNotice, useNeverPaired } from '../../lib/ext-notice'
import { useT } from '../../lib/i18n'
import { showSection } from '../../lib/nav'
import { TubeApiError, restCall, restQueryKey, useRest } from '../../lib/rest'
import { useStatus } from '../../lib/status'
import { CLASS_PREFIX, cx } from '../../lib/style'
import { BatchBar } from './Batch'
import { type Plural, useManageActions } from './actions'
import {
  ALL_COLUMNS,
  type ChipFilter,
  DEFAULT_FILTERS,
  type Filters,
  RELATION_FILTERS,
  STALE_MONTHS,
  type Sort,
  type SortKey,
  VIEW_KEY,
  activeChips,
  applyFilters,
  clearChip,
  dataColumns,
  fitColumns,
  folderCounts,
  folderTree,
  hasFilters,
  inRelation,
  nameNeed,
  nextSort,
  parseView,
  pruneFilters,
  rangeIds,
  sortRows
} from './model'
import { Picker, type PickerOption } from './Picker'
import { Rail } from './Rail'
import { useManageStyles } from './style'
import { type Editing, ManageTable, ManageTableSkeleton } from './Table'

export { UNDO_MS } from './actions'

/** Width of the folder list + gap (px). */
const RAIL_SPACE = 208 + 16

/** Below this (content width), the folder list becomes a selector in the bar. */
export const NARROW_PX = 700

/** Page of `GET /channels` (the contract's maximum). */
const PAGE = 2000

/** Drag type between rows and folders (a list of ids). The pane reads `text/plain` = `channel:<id>`. */
export const DRAG_TYPE = `application/x-${CLASS_PREFIX}channels`

/** Fixed initial state (scenario preview and tests). */
export interface ManageSeed {
  filters?: Partial<Filters>
  sort?: Sort
  selected?: string[]
  editing?: Editing
}

/** All rows, page by page (the contract caps at 2000 per call). */
async function fetchAllChannels(): Promise<ChannelRow[]> {
  const out: ChannelRow[] = []
  for (let page = 0; page < 50; page++) {
    const data = await restCall('GET /channels', { query: { limit: PAGE, ...(out.length ? { offset: out.length } : {}) } })
    out.push(...data.items)
    if (!data.items.length || out.length >= data.total) break
  }
  return out
}

function retry(failureCount: number, error: unknown): boolean {
  return error instanceof TubeApiError && error.transport && failureCount < 2
}

function readView() {
  try {
    return parseView(maybePluginContext()?.storage.get<unknown>(VIEW_KEY, null))
  } catch {
    return parseView(null)
  }
}

function writeView(value: unknown) {
  try {
    maybePluginContext()?.storage.set(VIEW_KEY, value)
  } catch {
    // no storage: applies to this session only
  }
}

/** Content width (null = unknown, as in jsdom: everything fits). */
function useWidth(ref: RefObject<HTMLElement | null>, key: unknown): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, key])
  return width
}

export function ManagePage() {
  return <ManageView />
}

export function ManageView({ initial }: { initial?: ManageSeed }) {
  useManageStyles()
  const t = useT('manage')
  const tc = useT()
  const fmt = useFormatCount()
  const plural: Plural = useCallback((key, n, vars = {}) => t(`${key}_${n === 1 ? 'one' : 'other'}`, { ...vars, count: fmt(n) }), [t, fmt])

  // ------------------------------------------------------------ remembered state
  const [filters, setFilters] = useState<Filters>(() => ({ ...readView().filters, ...initial?.filters }))
  const [sort, setSort] = useState<Sort>(() => initial?.sort ?? readView().sort)
  useEffect(() => writeView({ filters, sort }), [filters, sort])

  // ------------------------------------------------------------ data
  const channelsQ = useQuery<ChannelRow[], TubeApiError>({
    queryKey: restQueryKey('GET /channels', { query: { view: 'manage' } }),
    queryFn: fetchAllChannels,
    retry
  })
  // `useRest`, not a separate query on the same key: the React Query cache is ONE for the whole plugin, and the
  // pane, Subscriptions and Organize store the raw response (`{ items }`) under that key. Storing only the list here made the
  // screen break in the real app ("folders.map is not a function") as soon as the pane loaded first.
  const foldersQ = useRest('GET /folders', {})
  const tagsQ = useRest('GET /tags', {})
  const status = useStatus().data
  const browserOnline = (status?.devices_online ?? 0) > 0
  const neverPaired = useNeverPaired()

  const folders = useMemo<Folder[]>(() => foldersQ.data?.items ?? [], [foldersQ.data])
  const tags = useMemo<Tag[]>(() => tagsQ.data?.items ?? [], [tagsQ.data])
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders])
  const tagMap = useMemo(() => new Map(tags.map((x) => [x.id, x])), [tags])
  const tagNames = useMemo(() => new Map(tags.map((x) => [x.id, x.name])), [tags])
  const tree = useMemo(() => folderTree(folders), [folders])

  // ------------------------------------------------------------ actions (optimistic layer)
  const byIdRef = useRef(new Map<string, ChannelRow>())
  const actions = useManageActions({
    t,
    tc,
    plural,
    current: (id) => byIdRef.current.get(id),
    folderName: (id) => (id ? (folderNames.get(id) ?? '') : t('no_folder')),
    tagName: (id) => tagNames.get(id) ?? ''
  })

  const allRows = useMemo(() => (channelsQ.data ?? []).map(actions.view), [channelsQ.data, actions.view])
  const byId = useMemo(() => new Map(allRows.map((r) => [r.channel.id, r])), [allRows])
  byIdRef.current = byId

  // ------------------------------------------------------------ filter + sort
  // biome-ignore lint/correctness/useExhaustiveDependencies: "now" follows the data arrival
  const nowS = useMemo(() => Math.floor(Date.now() / 1000), [channelsQ.data])
  const effective = useMemo(() => pruneFilters(filters, foldersQ.data?.items, tagsQ.data?.items), [filters, foldersQ.data, tagsQ.data])
  const scope = useMemo(() => allRows.filter((r) => inRelation(r.channel.relation, effective.relation)), [allRows, effective.relation])
  const filtered = useMemo(() => applyFilters(allRows, effective, { folders, nowS }), [allRows, effective, folders, nowS])
  const sorted = useMemo(() => sortRows(filtered, sort, folderNames, tagNames), [filtered, sort, folderNames, tagNames])
  const order = useMemo(() => sorted.map((r) => r.channel.id), [sorted])
  const counts = useMemo(() => folderCounts(scope, folders), [scope, folders])

  const patchFilters = (next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next }))
  const clearFilters = () => setFilters({ ...DEFAULT_FILTERS })

  // ------------------------------------------------------------ width → folders on the left or a selector; columns
  const rootRef = useRef<HTMLDivElement>(null)
  const data = channelsQ.data
  const hasChannels = !!data && data.length > 0
  const width = useWidth(rootRef, hasChannels)
  const narrow = width !== null && width < NARROW_PX
  const tableWidth = width === null ? null : narrow ? width : width - RAIL_SPACE
  const nameMin = useMemo(() => nameNeed(allRows), [allRows])
  // usable table width (without the page padding); the name column asks for what the names in this list need
  const columns = useMemo(() => fitColumns(dataColumns(allRows), tableWidth, nameMin), [allRows, tableWidth, nameMin])

  // ------------------------------------------------------------ selection
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.selected ?? []))
  const anchor = useRef<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(initial?.editing ?? null)

  // a channel that disappeared leaves the selection
  useEffect(() => {
    if (!channelsQ.data) return
    setSelected((s) => {
      const next = new Set([...s].filter((id) => byId.has(id)))
      return next.size === s.size ? s : next
    })
  }, [channelsQ.data, byId])

  const onToggle = useCallback(
    (id: string, range: boolean) => {
      if (range && anchor.current) {
        const ids = rangeIds(order, anchor.current, id)
        setSelected((s) => new Set([...s, ...ids]))
        return
      }
      anchor.current = id
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [order]
  )
  const onExtend = useCallback(
    (from: string, to: string) => {
      if (!anchor.current) anchor.current = from
      const ids = rangeIds(order, anchor.current, to)
      setSelected((s) => new Set([...s, ...ids]))
    },
    [order]
  )
  const selectAll = useCallback(() => setSelected((s) => new Set([...s, ...order])), [order])
  const clearSelection = useCallback(() => {
    anchor.current = null
    setSelected(new Set())
  }, [])
  const allSelected = order.length > 0 && order.every((id) => selected.has(id))
  const someSelected = !allSelected && order.some((id) => selected.has(id))
  const visible = useMemo(() => new Set(order), [order])
  const hidden = [...selected].filter((id) => !visible.has(id)).length
  /** In the order they were checked. */
  const selectedIds = () => [...selected]

  // ------------------------------------------------------------ selector options
  const folderOptions: PickerOption[] = useMemo(
    () => [
      { value: '', label: t('no_folder'), icon: 'circle-slash' },
      ...tree.map(({ folder, level }) => ({ value: folder.id, label: folder.name, icon: 'folder', level }))
    ],
    [tree, t]
  )
  const tagOptions: PickerOption[] = useMemo(() => tags.map((x) => ({ value: x.id, label: x.name, icon: 'tag' })), [tags])
  const untagOptions = useMemo(() => {
    const present = new Set<string>()
    for (const id of selected) for (const tg of byId.get(id)?.channel.tag_ids ?? []) present.add(tg)
    return tagOptions.filter((o) => present.has(o.value))
  }, [selected, byId, tagOptions])

  // ------------------------------------------------------------ row editing
  const setFolder = (row: ChannelRow, folderId: string | null, folderLabel?: string) => {
    const prev = row.channel.folder_id ?? null
    if (prev === folderId) return
    const name = row.channel.title
    const message = folderId
      ? plural('toast.move', 1, { name, folder: folderLabel ?? folderNames.get(folderId) ?? '' })
      : plural('toast.move_none', 1, { name })
    void actions.patch(row.channel.id, { folder_id: folderId }, { folder_id: prev }, message)
  }
  const setTags = (row: ChannelRow, ids: string[]) => {
    const prev = row.channel.tag_ids
    if (prev.length === ids.length && prev.every((x) => ids.includes(x))) return
    void actions.patch(row.channel.id, { tag_ids: ids }, { tag_ids: [...prev] }, t('toast.tags_set', { name: row.channel.title }))
  }
  const rowHandlers = {
    onToggle,
    onEdit: setEditing,
    onFavorite: (row: ChannelRow) => {
      const fav = row.channel.favorite
      void actions.patch(row.channel.id, { favorite: !fav }, { favorite: fav }, null)
    },
    onSetFolder: (row: ChannelRow, folderId: string | null) => setFolder(row, folderId),
    onCreateFolder: async (row: ChannelRow, name: string) => {
      const folder = await actions.createFolder(name)
      if (folder) setFolder(row, folder.id, folder.name)
    },
    onSetTags: setTags,
    onCreateTag: async (row: ChannelRow, name: string, marked: string[]) => {
      const tag = await actions.createTag(name)
      if (tag) setTags(row, [...marked.filter((x) => x !== tag.id), tag.id])
    },
    onDragStart: (row: ChannelRow, dt: DataTransfer) => {
      const id = row.channel.id
      const ids = selected.has(id) ? selectedIds() : [id]
      dt.setData('text/plain', `channel:${id}`)
      dt.setData(DRAG_TYPE, JSON.stringify(ids))
      dt.effectAllowed = 'move'
    }
  }

  const onDropTo = (target: string | null, dt: DataTransfer) => {
    let ids: string[] = []
    try {
      const raw = dt.getData(DRAG_TYPE)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      ids = []
    }
    if (!ids.length) {
      const text = dt.getData('text/plain').trim()
      const m = text.match(/^channel:(.+)$/)
      if (m) ids = [m[1]]
      else if (/^UC[\w-]{22}$/.test(text)) ids = [text]
    }
    ids = ids.filter((id) => byId.has(id))
    if (ids.length) void actions.batch('move', ids, target)
  }

  // ------------------------------------------------------------ filter bar
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const chipLabel = (chip: ChipFilter): string => {
    switch (chip) {
      case 'folder':
        return effective.folder === 'none' ? t('rail.none') : t('chips.folder', { name: folderNames.get(effective.folder ?? '') ?? '' })
      case 'tag':
        return t('chips.tag', { name: tagNames.get(effective.tag ?? '') ?? '' })
      case 'relation':
        return t(`relation.${effective.relation}`)
      case 'favorite':
        return t('filters.favorite')
      case 'muted':
        return t('filters.muted')
      case 'stale':
        return t('chips.stale', { count: effective.staleMonths ?? 0 })
    }
  }

  const filterMenu = (key: string, label: string, active: boolean, options: PickerOption[], value: string, onPick: (v: string) => void) => (
    <span className={cx('manchor')} key={key}>
      <button
        type="button"
        className={cx('bare chip t-label mfilter')}
        data-part="manage-filter"
        data-filter={key}
        data-active={active ? 'true' : undefined}
        aria-haspopup="listbox"
        aria-expanded={openFilter === key}
        onClick={() => setOpenFilter((o) => (o === key ? null : key))}
      >
        <span>{label}</span>
        <Codicon name="chevron-down" size={12} className={cx('mfilter-caret')} />
      </button>
      {openFilter === key ? <Picker label={label} options={options} value={value} onPick={onPick} onClose={() => setOpenFilter(null)} /> : null}
    </span>
  )

  const toggleFilter = (key: 'favorite' | 'muted', label: string, icon: string) => (
    <button
      key={key}
      type="button"
      className={cx('bare chip t-label mfilter')}
      data-part="manage-filter"
      data-filter={key}
      data-active={effective[key] ? 'true' : undefined}
      aria-pressed={effective[key]}
      onClick={() => patchFilters({ [key]: !effective[key] })}
    >
      <Codicon name={effective[key] ? 'check' : icon} size={12} />
      <span>{label}</span>
    </button>
  )

  const filterChildren: ReactNode[] = [
    narrow
      ? filterMenu(
          'folder',
          t('filters.folder'),
          !!effective.folder,
          [
            { value: '', label: t('filters.folder_all'), icon: 'list-flat', hint: fmt(counts.get('all') ?? 0) },
            { value: 'none', label: t('rail.none'), icon: 'circle-slash', hint: fmt(counts.get('none') ?? 0) },
            ...tree.map(({ folder, level }) => ({ value: folder.id, label: folder.name, icon: 'folder', level, hint: fmt(counts.get(folder.id) ?? 0) }))
          ],
          effective.folder ?? '',
          (v) => patchFilters({ folder: v || null })
        )
      : null,
    tags.length
      ? filterMenu(
          'tag',
          t('filters.tag'),
          !!effective.tag,
          [{ value: '', label: t('filters.tag_all') }, ...tagOptions],
          effective.tag ?? '',
          (v) => patchFilters({ tag: v || null })
        )
      : null,
    filterMenu(
      'relation',
      t('filters.relation'),
      effective.relation !== 'active',
      RELATION_FILTERS.map((r) => ({ value: r, label: t(`relation.${r}`) })),
      effective.relation,
      (v) => patchFilters({ relation: RELATION_FILTERS.find((r) => r === v) ?? 'active' })
    ),
    toggleFilter('favorite', t('filters.favorite'), 'star-empty'),
    toggleFilter('muted', t('filters.muted'), 'bell-slash'),
    filterMenu(
      'stale',
      t('filters.stale'),
      !!effective.staleMonths,
      [{ value: '', label: t('filters.stale_any') }, ...STALE_MONTHS.map((m) => ({ value: String(m), label: t('filters.stale_option', { count: m }) }))],
      effective.staleMonths ? String(effective.staleMonths) : '',
      (v) => patchFilters({ staleMonths: v ? Number(v) : null })
    ),
    ...activeChips(effective).map((chip) => {
      const label = chipLabel(chip)
      return (
        <span key={`chip-${chip}`} className={cx('chip t-label mchip')} data-part="manage-chip" data-filter={chip}>
          <span className={cx('chip-label')}>{label}</span>
          <button
            type="button"
            className={cx('bare chip-remove')}
            data-part="chip-remove"
            aria-label={t('chips.remove', { name: label })}
            onClick={() => setFilters((f) => clearChip(f, chip))}
          >
            <Codicon name="close" size={10} />
          </button>
        </span>
      )
    }),
    <span key="count" className={cx('mcount t-label')} data-part="manage-count" aria-live="polite">
      {t('count', { shown: fmt(sorted.length), total: fmt(scope.length) })}
    </span>
  ]

  // ------------------------------------------------------------ mounting
  const subscribed = allRows.filter((r) => r.channel.relation === 'subscribed').length
  const followed = allRows.filter((r) => r.channel.relation === 'followed').length

  // the browser-extension notice (same rule as Subscriptions and Cleanup): never paired → Connect; paired but
  // offline while there are subscribed channels → Reconnect. Both open the Welcome dialog on the pairing step.
  const extNotice = pickExtNotice({ status, neverPaired, needed: subscribed > 0 })
  const banner =
    extNotice === 'ext_not_paired' ? (
      <Banner tone="info" icon="extensions" action={{ label: t('banner.connect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_not_paired')}
      </Banner>
    ) : extNotice === 'ext_disconnected' ? (
      <Banner tone="info" icon="debug-disconnect" action={{ label: t('banner.reconnect'), onClick: () => openDialog('onboarding', { step: 'pair' }) }}>
        {t('banner.ext_disconnected')}
      </Banner>
    ) : undefined

  const toolbar = hasChannels ? (
    <div className={cx('mtoolbar')}>
      <FilterBar
        query={filters.q}
        onQueryChange={(q) => patchFilters({ q })}
        placeholder={t('filters.search')}
        searchRef={searchRef}
        onClear={hasFilters(effective) ? clearFilters : undefined}
      >
        {filterChildren}
      </FilterBar>
      {selected.size ? (
        <BatchBar
          count={selected.size}
          hidden={hidden}
          plural={plural}
          folderOptions={folderOptions}
          tagOptions={tagOptions}
          untagOptions={untagOptions}
          onMove={(fid) => void actions.batch('move', selectedIds(), fid)}
          onCreateFolder={async (name) => {
            const ids = selectedIds()
            const folder = await actions.createFolder(name)
            if (folder) await actions.batch('move', ids, folder.id, { folder: folder.name })
          }}
          onTag={(tagId) => void actions.batch('tag', selectedIds(), tagId)}
          onCreateTag={async (name) => {
            const ids = selectedIds()
            const tag = await actions.createTag(name)
            if (tag) await actions.batch('tag', ids, tag.id, { tag: tag.name })
          }}
          onUntag={(tagId) => void actions.batch('untag', selectedIds(), tagId)}
          onOp={(op) => void actions.batch(op, selectedIds())}
          onRead={() => void actions.markRead(selectedIds())}
          onOrganize={() => openDialog('organize', { channelIds: selectedIds() })}
          onClear={clearSelection}
        />
      ) : null}
    </div>
  ) : undefined

  let body: ReactNode
  if (!data && channelsQ.error) {
    body = <ErrorView error={channelsQ.error} title={t('error.title')} onRetry={() => void channelsQ.refetch()} />
  } else if (!data) {
    body = (
      <div className={cx('mlayout')} ref={rootRef}>
        <div className={cx('mmain')}>
          <ManageTableSkeleton columns={fitColumns(ALL_COLUMNS, tableWidth)} />
        </div>
      </div>
    )
  } else if (!hasChannels) {
    body = (
      <EmptyView
        icon="organization"
        title={t('empty.title')}
        description={t('empty.description')}
        action={<Button onClick={() => showSection('home')}>{t('empty.action')}</Button>}
      />
    )
  } else {
    body = (
      <div className={cx('mlayout')} ref={rootRef} data-part="manage" data-narrow={narrow ? 'true' : undefined}>
        {narrow ? null : (
          <Rail
            tree={tree}
            counts={counts}
            current={effective.folder}
            onSelect={(folder) => patchFilters({ folder })}
            onDropTo={onDropTo}
            onCreate={(name) => void actions.createFolder(name, true)}
            onRename={(id, name) => void actions.renameFolder(id, name)}
          />
        )}
        <div className={cx('mmain')}>
          {sorted.length ? (
            <ManageTable
              rows={sorted}
              columns={columns}
              nameMin={nameMin}
              sort={sort}
              onSort={(key: SortKey) => setSort((s) => nextSort(s, key))}
              selected={selected}
              onExtend={onExtend}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              allSelected={allSelected}
              someSelected={someSelected}
              folders={folderMap}
              folderOptions={folderOptions}
              tags={tagMap}
              tagOptions={tagOptions}
              errors={actions.errors}
              editing={editing}
              nowS={nowS}
              {...rowHandlers}
            />
          ) : (
            <div data-part="manage-no-results">
              <EmptyView
                icon="filter"
                title={t('no_results.title')}
                description={t('no_results.description')}
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    {t('no_results.action')}
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    <SectionFrame current="manage">
      <PageFrame
        title={t('title')}
        subtitle={hasChannels ? t('subtitle', { subscribed: fmt(subscribed), followed: fmt(followed) }) : undefined}
        actions={
          // with no channels at all, the way forward is the Welcome (the empty state's button is the main one);
          // the button is always there: the fixed way into the Welcome dialog (browser, channel link, demo). With a
          // browser online it says so instead of asking to connect one that is already connected.
          <>
            <Button
              variant="outline"
              size="sm"
              data-part="manage-connect"
              data-state={browserOnline ? 'connected' : 'idle'}
              title={t(browserOnline ? 'actions.connected_hint' : 'actions.connect_hint')}
              onClick={() => openDialog('onboarding', {})}
            >
              <Codicon name={browserOnline ? 'check' : 'plug'} size={14} />
              <span>{t(browserOnline ? 'actions.connected' : 'actions.connect')}</span>
            </Button>
            {!data || hasChannels ? (
              <Button size="sm" onClick={() => openDialog('organize')}>
                <Codicon name="sparkle" size={14} />
                <span>{t('actions.organize')}</span>
              </Button>
            ) : null}
          </>
        }
        toolbar={toolbar}
        banner={banner}
      >
        {body}
      </PageFrame>
    </SectionFrame>
  )
}
