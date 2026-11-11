// Side panel "Subscriptions" (PANES_AREA, id PANE_ID; main.tsx mounts it with a <ShellHost/>). It is a tab of the
// right column next to Files, which the user hides/shows without disabling the plugin (see ./contribution.tsx).
//   top      quick search (accent/case-insensitive; ↓ goes into the tree, Esc clears)
//   strip    one at a time: counters failed › YouTube feed down › extension disconnected
//   tree     All · Watch later · nested folders (recursive counter) · channels with avatar · No folder
//            click/Enter → Home (matching tab); arrows/Home/End/←/→ from the kit; Shift+F10/menu/⋯ → menu
//            drag channel → folder (PATCH /channels/{id}) and folder → folder (PATCH /folders/{id}), optimistic + undo
//   menu     open in Home · mark as read (POST /read) · ⭐ · mute · move to… · new tab · YouTube
//   states   skeleton with the tree's geometry · empty with a path to the welcome · error with retry
//            (reason: profile without the plugin / no connection)
// Fits 220 to 480 px (page container; labels with ellipsis). All text through useT('panes').
// Rules: no screen/dialog imported (openDialog, lib/nav.openSection); only lib/, components/ and shared/.
import {
  Button,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  SearchField,
  Tip,
  atom,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, StatusResponse } from '../../shared/api-types'
import type { DialogProps } from '../../shared/ids'
import { DIALOG_IDS } from '../../shared/ids'
import { Banner, EmptyView, ErrorView, Tree, TreeItem, TreeItemSkeleton, useFormatCount } from '../components'
import { maybePluginContext } from '../lib/ctx'
import { openDialog } from '../lib/dialogs'
import { useT } from '../lib/i18n'
import { openSection } from '../lib/nav'
import { invalidateRest, useRest } from '../lib/rest'
import { safeChannelUrl } from '../lib/safe-url'
import { useStatus } from '../lib/status'
import { cx } from '../lib/style'
import { applyOverlay, readAdjusted, usePaneActions } from './actions'
import {
  type FolderNode,
  type NodeRef,
  buildTree,
  channelsIn,
  dragData,
  failureKind,
  filterTree,
  folderCounts,
  homeTabFor,
  isInside,
  nodeKey,
  parseDrag,
  parseKey,
  readScopeOf
} from './model'
import { type MoveSubject, MoveDialog } from './MoveDialog'
import { HOME_TAB_KEY, PANE_KEYS, isStringList, isText, readPref, writePref } from './prefs'

/** Folders, channels and counters refresh on their own at this pace; the leader's /status brings it forward. */
const REFRESH_MS = 60_000
const CHANNEL_QUERY = { relation: 'subscribed,followed', limit: 2000 }

/** Fallback atom for an old Desktop without `host.state.profile`. */
const NO_PROFILE_ATOM = atom('default')

export interface PaneViewProps {
  /** Folders open at start (preview); without it, the remembered ones. */
  initialExpanded?: string[]
  /** Search already typed (preview). */
  initialQuery?: string
}

export function SubscriptionsPane() {
  return <PaneView />
}

function openMenuFrom(el: Element): void {
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width, 24), clientY: r.bottom }))
}

function sum(ids: Iterable<string>, counts: Readonly<Record<string, number>>): number {
  let n = 0
  for (const id of ids) n += counts[id] ?? 0
  return n
}

type TabPreset = NonNullable<DialogProps['tab-editor']['preset']>

function presetFor(ref: NodeRef, name: string): TabPreset | null {
  if (ref.kind === 'folder') return { name, kind: 'category', rules: { include: { folders: [ref.id] } } }
  if (ref.kind === 'channel') return { name, kind: 'channels', rules: { include: { channels: [ref.id] } } }
  return null
}

export function PaneView({ initialExpanded, initialQuery = '' }: PaneViewProps) {
  const t = useT('panes')
  const tc = useT()
  const profile = useValue(host.state?.profile ?? NO_PROFILE_ATOM) || 'default'
  const folders = useRest('GET /folders', {}, { refetchInterval: REFRESH_MS })
  const channels = useRest('GET /channels', { query: CHANNEL_QUERY }, { refetchInterval: REFRESH_MS })
  const state = useRest('GET /state', {}, { refetchInterval: REFRESH_MS })
  const tabs = useRest('GET /tabs', {}, { staleTime: REFRESH_MS })
  const status = useStatus()
  const st = status.data as StatusResponse | undefined
  const { overlay, moveChannel, moveFolder, setFlag, markRead } = usePaneActions(t, tc)

  // the counters follow the leader's /status (a new video arrived, a cycle finished)
  const pulse = st ? `${st.new_total}:${st.last_rss_at}:${st.refresh_running}` : null
  const lastPulse = useRef(pulse)
  useEffect(() => {
    if (lastPulse.current !== null && pulse !== null && pulse !== lastPulse.current) void invalidateRest('GET /state', 'GET /channels')
    if (pulse !== null) lastPulse.current = pulse
  }, [pulse])

  // ------------------------------------------------------------------ data + optimistic layer
  const view = useMemo(() => {
    const fItems = folders.data?.items
    const cItems = channels.data?.items
    if (!Array.isArray(fItems) || !Array.isArray(cItems)) return null
    const merged = applyOverlay(
      fItems,
      cItems.map((r) => r.channel),
      overlay
    )
    return { tree: buildTree(merged.folders, merged.channels) }
  }, [folders.data, channels.data, overlay])

  const serverCounts = state.data?.counts
  const counts = useMemo(() => readAdjusted(serverCounts?.by_channel, overlay), [serverCounts, overlay])
  const byFolder = useMemo(() => (view && counts ? folderCounts(view.tree, counts) : null), [view, counts])
  const allCount = useMemo(() => {
    if (!serverCounts || !counts) return null
    if (overlay.readAll) return 0
    return Math.max(0, (serverCounts.total ?? 0) - sum(overlay.read, serverCounts.by_channel ?? {}))
  }, [serverCounts, counts, overlay])

  // ------------------------------------------------------------------ preferences
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded ?? readPref<string[]>(PANE_KEYS.expanded, [], isStringList)))
  const [selected, setSelected] = useState<string | null>(() => readPref<string | null>(PANE_KEYS.selected, null, isText))
  const [query, setQuery] = useState(initialQuery)
  const [menuFor, setMenuFor] = useState<NodeRef | null>(null)
  const [moving, setMoving] = useState<MoveSubject | null>(null)
  const told = useRef(new Set<string>())
  const rootRef = useRef<HTMLDivElement>(null)
  const fmt = useFormatCount()

  const toggle = useCallback((key: string) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      writePref(PANE_KEYS.expanded, [...n])
      return n
    })
  }, [])

  const filtered = useMemo(() => (view && query.trim() ? filterTree(view.tree, query) : null), [view, query])

  // ------------------------------------------------------------------ names
  const nameOf = useCallback(
    (ref: NodeRef): string => {
      if (ref.kind === 'folder') return view?.tree.folders.get(ref.id)?.name ?? ''
      if (ref.kind === 'channel') return view?.tree.channels.get(ref.id)?.title ?? ''
      return t(`tree.${ref.kind}`)
    },
    [view, t]
  )

  // ------------------------------------------------------------------ navigate
  const openInHome = useCallback(
    (ref: NodeRef) => {
      const tabId = homeTabFor(ref, Array.isArray(tabs.data?.items) ? tabs.data.items : undefined)
      if (tabId) writePref(HOME_TAB_KEY, tabId)
      if (ref.kind === 'folder' || ref.kind === 'channel') writePref(PANE_KEYS.target, { kind: ref.kind, id: ref.id, at: Date.now() })
      openSection('home')
      const key = nodeKey(ref)
      const name = nameOf(ref)
      const preset = presetFor(ref, name)
      if (!tabId && preset && !told.current.has(key)) {
        told.current.add(key)
        host.notify({
          kind: 'info',
          message: t('nav.no_tab', { name }),
          action: { label: t('nav.create_tab'), onClick: () => openDialog(DIALOG_IDS.tabEditor, { preset }) }
        })
      }
    },
    [tabs.data, nameOf, t]
  )

  const select = useCallback(
    (ref: NodeRef) => {
      if (ref.kind === 'unfiled') {
        toggle('unfiled')
        return
      }
      const key = nodeKey(ref)
      setSelected(key)
      writePref(PANE_KEYS.selected, key)
      openInHome(ref)
    },
    [toggle, openInHome]
  )

  // ------------------------------------------------------------------ move (drag, menu)
  const destOf = (ref: NodeRef): string | null | undefined => {
    if (ref.kind === 'folder') return ref.id
    if (ref.kind === 'all' || ref.kind === 'unfiled') return null
    if (ref.kind === 'channel') return view?.tree.channels.get(ref.id)?.folder_id ?? null
    return undefined
  }

  const moveTo = useCallback(
    (item: { kind: 'channel' | 'folder'; id: string }, dest: string | null) => {
      if (!view) return
      const folderName = dest ? (view.tree.folders.get(dest)?.name ?? '') : ''
      if (item.kind === 'channel') {
        const c = view.tree.channels.get(item.id)
        if (!c || (c.folder_id ?? null) === dest) return
        moveChannel(c, dest, dest ? t('toast.moved_channel', { name: c.title, folder: folderName }) : t('toast.moved_channel_none', { name: c.title }))
        return
      }
      const f = view.tree.folders.get(item.id)
      if (!f || dest === f.id) return
      if (dest && isInside(view.tree.folders, dest, f.id)) {
        host.notify({ kind: 'info', message: t('toast.cycle') })
        return
      }
      if ((f.parent_id ?? null) === dest) return
      moveFolder(f, dest, dest ? t('toast.moved_folder', { name: f.name, folder: folderName }) : t('toast.moved_folder_root', { name: f.name }))
    },
    [view, moveChannel, moveFolder, t]
  )

  const onDrop = (target: NodeRef, data: string) => {
    const item = parseDrag(data)
    const dest = destOf(target)
    if (!item || dest === undefined) return
    moveTo(item, dest)
  }

  // ------------------------------------------------------------------ mark as read, menu
  const doMarkRead = (ref: NodeRef) => {
    const scope = readScopeOf(ref)
    if (!scope || !view) return
    const name = nameOf(ref)
    markRead(scope, channelsIn(view.tree, ref), {
      done: ref.kind === 'all' ? t('toast.read_all') : t('toast.read', { name }),
      nothing: ref.kind === 'all' ? t('toast.read_nothing_all') : t('toast.read_nothing', { name })
    })
  }

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const li = (e.target as HTMLElement).closest('[role="treeitem"]')
    const ref = parseKey(li?.getAttribute('data-id'))
    if (!ref || ref.kind === 'later' || ref.kind === 'unfiled') {
      e.preventDefault()
      setMenuFor(null)
      return
    }
    setMenuFor(ref)
  }

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return
    const li = (e.target as HTMLElement).closest('[role="treeitem"]')
    const row = li?.querySelector(':scope > [data-part="tree-row"]')
    if (!row) return
    e.preventDefault()
    openMenuFrom(row)
  }

  const menuItems = (ref: NodeRef): ReactNode => {
    if (!view) return null
    const item = (id: string, icon: string, label: string, run: () => void) => (
      <ContextMenuItem key={id} data-menu={id} onSelect={run}>
        <Codicon name={icon} size={14} />
        {label}
      </ContextMenuItem>
    )
    if (ref.kind === 'all') return [item('mark_all_read', 'check-all', t('menu.mark_all_read'), () => doMarkRead(ref))]
    if (ref.kind === 'folder') {
      const f = view.tree.folders.get(ref.id)
      if (!f) return null
      const preset = presetFor(ref, f.name)
      return [
        item('open_home', 'home', t('menu.open_home'), () => select(ref)),
        item('mark_read', 'check-all', t('menu.mark_read'), () => doMarkRead(ref)),
        <ContextMenuSeparator key="s1" />,
        item('new_tab', 'add', t('menu.new_tab'), () => preset && openDialog(DIALOG_IDS.tabEditor, { preset })),
        item('move', 'folder-active', t('menu.move'), () => setMoving({ kind: 'folder', id: f.id, name: f.name, current: f.parent_id ?? null }))
      ]
    }
    if (ref.kind === 'channel') {
      const c = view.tree.channels.get(ref.id)
      if (!c) return null
      // only an https YouTube page reaches the system opener (old rows may hold anything)
      const url = safeChannelUrl(c.url, c.id)
      return [
        item('open_home', 'home', t('menu.open_home'), () => select(ref)),
        item('mark_read', 'check-all', t('menu.mark_read'), () => doMarkRead(ref)),
        <ContextMenuSeparator key="s1" />,
        c.favorite
          ? item('unfavorite', 'star-empty', t('menu.unfavorite'), () => setFlag(c, 'favorite', false, t('toast.favorite_off', { name: c.title })))
          : item('favorite', 'star-full', t('menu.favorite'), () => setFlag(c, 'favorite', true, t('toast.favorite_on', { name: c.title }))),
        c.muted
          ? item('unmute', 'bell', t('menu.unmute'), () => setFlag(c, 'muted', false, t('toast.muted_off', { name: c.title })))
          : item('mute', 'bell-slash', t('menu.mute'), () => setFlag(c, 'muted', true, t('toast.muted_on', { name: c.title }))),
        item('move', 'folder-active', t('menu.move'), () => setMoving({ kind: 'channel', id: c.id, name: c.title, current: c.folder_id ?? null })),
        <ContextMenuSeparator key="s2" />,
        item('open_youtube', 'link-external', t('menu.open_youtube'), () => void maybePluginContext()?.os?.openExternal?.(url))
      ]
    }
    return null
  }

  // ------------------------------------------------------------------ tree pieces
  const rowMenu = (name: string) => (
    <Button
      variant="ghost"
      size="icon-xs"
      tabIndex={-1}
      aria-label={t('row.menu', { name })}
      data-part="row-menu"
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        openMenuFrom(e.currentTarget)
      }}
    >
      <Codicon name="ellipsis" size={14} />
    </Button>
  )

  const searching = !!filtered
  const isOpen = (key: string) => searching || expanded.has(key)

  const channelItem = (c: Channel, level: number) => {
    const ref: NodeRef = { kind: 'channel', id: c.id }
    const key = nodeKey(ref)
    return (
      <TreeItem
        key={key}
        id={key}
        level={level}
        avatar={{ title: c.title, thumb: c.thumb }}
        label={
          <>
            {c.title}
            {c.favorite ? (
              <>
                {' '}
                <Codicon name="star-full" size={11} />
                <span className={cx('sr')}>{t('row.favorite')}</span>
              </>
            ) : null}
            {c.muted ? (
              <>
                {' '}
                <Codicon name="bell-slash" size={11} />
                <span className={cx('sr')}>{t('row.muted')}</span>
              </>
            ) : null}
          </>
        }
        count={counts ? counts[c.id] || null : null}
        selected={selected === key}
        onSelect={() => select(ref)}
        onDropItem={(d) => onDrop(ref, d)}
        dragData={dragData({ kind: 'channel', id: c.id })}
        actions={rowMenu(c.title)}
      />
    )
  }

  const folderItem = (n: FolderNode, level: number): ReactNode => {
    const ref: NodeRef = { kind: 'folder', id: n.folder.id }
    const key = nodeKey(ref)
    const open = isOpen(key)
    const hasContent = n.children.length > 0 || n.channels.length > 0
    return (
      <TreeItem
        key={key}
        id={key}
        level={level}
        label={n.folder.name}
        icon={open && hasContent ? 'folder-opened' : 'folder'}
        count={byFolder?.get(n.folder.id) || null}
        expanded={hasContent ? open : undefined}
        onToggle={hasContent ? () => toggle(key) : undefined}
        selected={selected === key}
        onSelect={() => select(ref)}
        onDropItem={(d) => onDrop(ref, d)}
        dragData={dragData({ kind: 'folder', id: n.folder.id })}
        actions={rowMenu(n.folder.name)}
      >
        {open && hasContent ? [...n.children.map((k) => folderItem(k, level + 1)), ...n.channels.map((c) => channelItem(c, level + 1))] : undefined}
      </TreeItem>
    )
  }

  // ------------------------------------------------------------------ body
  let body: ReactNode
  const loadError = folders.error ?? channels.error
  if (!view) {
    if (loadError) {
      const kind = failureKind(loadError)
      body = (
        <ErrorView
          compact
          error={loadError}
          title={
            kind === 'unavailable' ? t('error.unavailable', { profile }) : kind === 'offline' ? t('error.offline') : t('error.title')
          }
          description={
            kind === 'unavailable'
              ? t('error.unavailable_hint', { profile })
              : kind === 'offline'
                ? t('error.offline_hint')
                : undefined
          }
          onRetry={() => {
            if (folders.error) void folders.refetch()
            if (channels.error) void channels.refetch()
          }}
        />
      )
    } else body = <PaneSkeleton label={t('tree.label')} />
  } else if (!view.tree.roots.length && !view.tree.channels.size) {
    body = (
      <EmptyView
        compact
        icon="inbox"
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button size="sm" onClick={() => openSection('home')}>
            {t('empty.action')}
          </Button>
        }
      />
    )
  } else if (filtered && !filtered.matches) {
    body = (
      <EmptyView
        compact
        icon="search"
        title={t('search.empty_title', { query: query.trim() })}
        description={t('search.empty_desc')}
        action={
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            {t('search.clear')}
          </Button>
        }
      />
    )
  } else {
    const tree = filtered?.tree ?? view.tree
    const grouped = view.tree.roots.length > 0
    const unfiledCount = counts ? sum(tree.unfiled.map((c) => c.id), counts) : null
    const unfiledOpen = isOpen('unfiled')
    body = (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div data-part="pane-tree" onContextMenu={onContextMenu} onKeyDown={onTreeKeyDown}>
            <Tree label={t('tree.label')}>
              {searching ? null : (
                <>
                  <TreeItem
                    id="all"
                    label={t('tree.all')}
                    icon="inbox"
                    count={allCount || null}
                    selected={selected === 'all'}
                    onSelect={() => select({ kind: 'all' })}
                    onDropItem={(d) => onDrop({ kind: 'all' }, d)}
                    actions={rowMenu(t('tree.all'))}
                  />
                  <TreeItem id="later" label={t('tree.later')} icon="clock" selected={selected === 'later'} onSelect={() => select({ kind: 'later' })} />
                </>
              )}
              {tree.roots.map((n) => folderItem(n, 1))}
              {grouped ? (
                tree.unfiled.length ? (
                  <TreeItem
                    id="unfiled"
                    label={t('tree.unfiled')}
                    icon="list-unordered"
                    count={unfiledCount || null}
                    expanded={unfiledOpen}
                    onToggle={() => toggle('unfiled')}
                    onSelect={() => toggle('unfiled')}
                    onDropItem={(d) => onDrop({ kind: 'unfiled' }, d)}
                  >
                    {unfiledOpen ? tree.unfiled.map((c) => channelItem(c, 2)) : undefined}
                  </TreeItem>
                ) : null
              ) : (
                tree.unfiled.map((c) => channelItem(c, 1))
              )}
            </Tree>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{menuFor ? menuItems(menuFor) : null}</ContextMenuContent>
      </ContextMenu>
    )
  }

  // ------------------------------------------------------------------ strip (one at a time)
  const subscribed = (channels.data?.items ?? []).some((r) => r.channel.relation === 'subscribed') ?? false
  const banner: ReactNode =
    view && state.error ? (
      <Banner tone="error" action={{ label: t('banner.retry'), onClick: () => void state.refetch() }}>
        {t('banner.counts_failed')}
      </Banner>
    ) : st?.rss_down_since ? (
      <Banner tone="warning" icon="rss">
        {t('banner.rss_down')}
      </Banner>
    ) : st && st.devices_online === 0 && subscribed ? (
      <Banner
        tone="info"
        icon="debug-disconnect"
        action={{ label: t('banner.reconnect'), onClick: () => openDialog(DIALOG_IDS.onboarding, { step: 'pair' }) }}
      >
        {t('banner.ext_disconnected')}
      </Banner>
    ) : null

  const hasContent = !!view && (view.tree.roots.length > 0 || view.tree.channels.size > 0)
  const showSearch = !view || hasContent

  return (
    <div className={cx('page')} data-part="pane" ref={rootRef}>
      {/* Its own title, always. Stacked with Files the name is also on the tab strip; but without a project folder
          Files disappears, the panel sits alone in the zone and the app draws no strip — without this it would have
          no name. Knowing whether the strip is visible would mean reading the app's markup (`[data-tree-group]`),
          which the catalog rules forbid — an accepted cost. */}
      <div className={cx('pane-head')} data-part="pane-head">
        <span className={cx('pane-head-title')} role="heading" aria-level={2}>
          {tc('pane.title')}
        </span>
        {view && allCount ? (
          <span className={cx('pane-head-count num')} data-part="pane-head-count" aria-label={tc('kit.tree.new_count', { count: fmt(allCount) })}>
            {fmt(allCount)}
          </span>
        ) : null}
        {/* The way back to the page in the center: the pane can be the only HermesTube surface on screen. */}
        <Tip label={tc('pane.open_page_tip')}>
          <button type="button" className={cx('pane-head-open')} data-part="pane-open-page" aria-label={tc('pane.open_page')} onClick={() => openSection('home')}>
            <Codicon name="play-circle" size={13} />
            <span className={cx('pane-head-open-label')}>{tc('pane.open_page_short')}</span>
            <Codicon name="arrow-right" size={11} />
          </button>
        </Tip>
      </div>
      {showSearch ? (
        <div className={cx('page-banner')} data-part="pane-search">
          <SearchField
            value={query}
            onChange={(next: string) => setQuery(next)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'ArrowDown') {
                const first = rootRef.current?.querySelector<HTMLElement>('[data-part="pane-tree"] [role="treeitem"]')
                if (first) {
                  e.preventDefault()
                  first.focus()
                }
              } else if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
            {...(query ? { onClear: () => setQuery('') } : {})}
          />
        </div>
      ) : null}
      {banner ? <div className={cx('page-banner')}>{banner}</div> : null}
      <div className={cx('page-body')} data-part="pane-body">
        {body}
      </div>
      {moving && view ? (
        <MoveDialog
          subject={moving}
          tree={view.tree}
          onClose={() => setMoving(null)}
          onPick={(dest) => moveTo({ kind: moving.kind, id: moving.id }, dest)}
        />
      ) : null}
    </div>
  )
}

/** Loading: the same geometry as the tree (All, Watch later, folders with channels). */
function PaneSkeleton({ label }: { label: string }) {
  return (
    <div data-part="pane-tree" aria-busy="true">
      <Tree label={label}>
        <TreeItemSkeleton />
        <TreeItemSkeleton />
        {[0, 1, 2].map((i) => (
          <SkeletonFolder key={i} channels={i === 0 ? 2 : 1} />
        ))}
        <TreeItemSkeleton />
      </Tree>
    </div>
  )
}

function SkeletonFolder({ channels }: { channels: number }) {
  return (
    <>
      <TreeItemSkeleton level={1} />
      {Array.from({ length: channels }, (_, i) => (
        <TreeItemSkeleton key={i} level={2} avatar />
      ))}
    </>
  )
}

