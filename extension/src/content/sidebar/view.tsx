// content/sidebar — pure views (Preact, no state of their own): guide section, mini-guide entry and pane.
// The controller (controller.ts) re-renders on every change; Preact's diff keeps the nodes (counters change
// without remounting). All text coming from the server enters as a text child — never HTML. The only links are
// `watchUrl(id)` of valid ids.
import type { JSX } from 'preact'
import type { FeedItem } from '../../../../shared/api-types'
import type { ConnectionState } from '../../../../shared/ext-messages'
import type { Language } from '../../lib/i18n'
import { BackIcon, CheckIcon, ChevronIcon, CloseIcon, FolderIcon, HermesIcon, InfoIcon, LaterIcon, NewIcon, OffIcon, StarIcon, TabIcon, ViaIcon, WingIcon } from './icons'
import {
  type BuiltinTabIcon,
  type FolderNode,
  type Scope,
  type SidebarData,
  type TabEntry,
  builtinTabIcon,
  durationLabel,
  formatCount,
  isVideoId,
  keyOf,
  relativeAge,
  tabGlyph,
  thumbUrl,
  watchUrl
} from './model'

export type Tr = (key: string, vars?: Record<string, string | number>) => string
export type ConnState = ConnectionState | 'unknown'

const OFF_TEXT: Partial<Record<ConnState, string>> = { reconnect_needed: 'disconnected', unauthorized: 'unauthorized', error: 'conn_error' }
export const isOff = (c: ConnState): boolean => c in OFF_TEXT

export function plural(t: Tr, lang: Language, base: string, count: number): string {
  const rule = new Intl.PluralRules(lang === 'pt-BR' ? 'pt-BR' : 'en').select(count)
  return t(`${base}_${rule === 'one' ? 'one' : 'other'}`, { count: formatCount(count, lang) || '0' })
}

// ------------------------------------------------------------------ guide section

export interface SectionProps {
  t: Tr
  lang: Language
  data: SidebarData
  tree: FolderNode[]
  expanded: ReadonlySet<string>
  focusKey: string | null
  openKey: string | null
  conn: ConnState
  onClick: (e: MouseEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
  onFocusIn: (e: FocusEvent) => void
}

function Count({ n, lang }: { n: number; lang: Language }): JSX.Element | null {
  const text = formatCount(n, lang)
  return text ? (
    <span class="count" data-part="count" aria-hidden="true">
      {text}
    </span>
  ) : null
}

function itemLabel(p: SectionProps, name: string, count: number): string {
  return count > 0 ? `${name}, ${plural(p.t, p.lang, 'new_count', count)}` : name
}

function FolderItem({ node, p }: { node: FolderNode; p: SectionProps }): JSX.Element {
  const key = keyOf('folder', node.id)
  const has = node.children.length > 0
  const open = has && p.expanded.has(node.id)
  return (
    <div
      role="treeitem"
      data-key={key}
      aria-level={node.level}
      aria-expanded={has ? (open ? 'true' : 'false') : undefined}
      aria-selected={p.openKey === key ? 'true' : 'false'}
      aria-label={itemLabel(p, node.name, node.count)}
      tabIndex={p.focusKey === key ? 0 : -1}
    >
      <div class={node.level > 1 ? 'row sub' : 'row'} style={node.level > 1 ? { '--indent': `${(node.level - 2) * 12}px` } : undefined}>
        {node.level === 1 ? (
          <span class="icon">
            <FolderIcon />
          </span>
        ) : null}
        <span class="label">{node.name}</span>
        <Count n={node.count} lang={p.lang} />
        {has ? (
          <span class="toggle" data-part="toggle" title={p.t(open ? 'collapse' : 'expand')}>
            <ChevronIcon />
          </span>
        ) : null}
      </div>
      {open ? (
        <div role="group">
          {node.children.map((c) => (
            <FolderItem key={c.id} node={c} p={p} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SectionView(p: SectionProps): JSX.Element {
  const { t, data } = p
  const off = isOff(p.conn)
  const empty = data.tabs.length === 0 && data.folders.length === 0
  const total = formatCount(data.total, p.lang)
  return (
    <div class="section" data-part="section" data-off={off ? 'true' : undefined}>
      <h3 class="head">
        <span class="head-mark" data-part="wing">
          <WingIcon />
        </span>
        <span class="head-title">{t('title')}</span>
        {data.refreshing ? <span class="spin" data-part="refreshing" role="img" aria-label={t('refreshing')} title={t('refreshing')} /> : null}
        {total ? (
          <span class="total" data-part="total" aria-label={plural(t, p.lang, 'new_count', data.total)}>
            {total}
          </span>
        ) : null}
      </h3>
      {off ? (
        <p class="note" data-part="conn" role="status">
          <OffIcon />
          <span>{t(OFF_TEXT[p.conn]!)}</span>
        </p>
      ) : null}
      {empty ? (
        <p class="note" data-part="empty">
          <InfoIcon />
          <span>{t('empty_hint')}</span>
        </p>
      ) : (
        <div class="tree" role="tree" aria-label={t('tree_label')} data-off={off ? 'true' : undefined} onClick={p.onClick} onKeyDown={p.onKeyDown} onFocusIn={p.onFocusIn}>
          {data.tabs.map((tab) => {
            const key = keyOf('tab', tab.id)
            return (
              <div
                key={key}
                role="treeitem"
                data-key={key}
                aria-level={1}
                aria-selected={p.openKey === key ? 'true' : 'false'}
                aria-label={itemLabel(p, tab.name, tab.count)}
                tabIndex={p.focusKey === key ? 0 : -1}
              >
                <div class="row">
                  <TabIconBox tab={tab} />
                  <span class="label">{tab.name}</span>
                  <Count n={tab.count} lang={p.lang} />
                </div>
              </div>
            )
          })}
          {p.tree.map((n) => (
            <FolderItem key={keyOf('folder', n.id)} node={n} p={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ mini-guide

export interface MiniProps {
  t: Tr
  lang: Language
  total: number
  open: boolean
  conn: ConnState
  onClick: (e: MouseEvent) => void
}

export function MiniView(p: MiniProps): JSX.Element {
  const badge = formatCount(p.total, p.lang)
  const label = p.total > 0 ? `${p.t('title')}, ${plural(p.t, p.lang, 'new_count', p.total)}` : p.t('title')
  return (
    <button type="button" class="mini" data-part="mini" aria-label={label} aria-expanded={p.open ? 'true' : 'false'} title={label} onClick={p.onClick}>
      <span class="mini-icon">
        <HermesIcon />
        {badge && !isOff(p.conn) ? (
          <span class="badge" data-part="badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      <span class="mini-title">{p.t('title')}</span>
    </button>
  )
}

// ------------------------------------------------------------------ pane

export type ReadPhase = 'idle' | 'pending' | 'sending' | 'done' | 'error'

export interface PanelState {
  anchor: 'section' | 'mini'
  view: 'tree' | 'feed'
  scope: Scope | null
  status: 'loading' | 'ready' | 'error'
  items: FeedItem[]
  cursor: string | null
  more: 'idle' | 'loading' | 'error'
  read: ReadPhase
}

export interface PanelProps {
  t: Tr
  lang: Language
  now: number
  open: PanelState | null
  data: SidebarData
  tree: FolderNode[]
  left: number
  top: number
  undoMs: number
  scopeCount: number
  on: {
    close(): void
    back(): void
    pick(e: MouseEvent): void
    mark(): void
    undo(): void
    retry(): void
    more(): void
    keydown(e: KeyboardEvent): void
    imgError(e: Event): void
  }
}

function VideoCard({ item, p }: { item: FeedItem; p: PanelProps }): JSX.Element {
  const v = item.video
  const id = v.id
  const channel = (item.channel && typeof item.channel.title === 'string' ? item.channel.title : null) ?? (typeof v.channel_title === 'string' ? v.channel_title : '')
  const why = item.why && typeof item.why.label === 'string' && item.why.label ? item.why.label + (typeof item.why.detail === 'string' && item.why.detail ? ` · ${item.why.detail}` : '') : ''
  const dur = durationLabel(v.duration_s)
  const age = relativeAge(v.published_at, p.now, p.lang)
  const seen = !item.is_new || p.open?.read === 'done' || p.open?.read === 'pending' || p.open?.read === 'sending'
  return (
    <a class={seen ? 'video seen' : 'video'} data-part="video" href={watchUrl(id)}>
      <span class="thumb">
        <img src={thumbUrl(id)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={p.on.imgError} />
        {dur ? (
          <span class="dur" data-part="duration">
            {dur}
          </span>
        ) : null}
      </span>
      <span class="meta">
        {why ? (
          <span class="why">
            <ViaIcon />
            <span data-part="why">{why}</span>
          </span>
        ) : null}
        <span class="title" data-part="title">
          {typeof v.title === 'string' ? v.title : ''}
        </span>
        {channel ? (
          <span class="line" data-part="channel">
            {channel}
          </span>
        ) : null}
        <span class="line">
          {item.is_new && !seen ? <span class="new-dot" aria-hidden="true" /> : null}
          <span data-part="age">{age}</span>
        </span>
      </span>
    </a>
  )
}

function Skeleton({ n }: { n: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div class="video" data-part="skeleton" key={`sk${i}`} aria-hidden="true">
          <span class="thumb sk" />
          <span class="meta">
            <span class="sk sk-line" style={{ width: '40%' }} />
            <span class="sk sk-line" style={{ width: '92%' }} />
            <span class="sk sk-line" style={{ width: '70%' }} />
          </span>
        </div>
      ))}
    </>
  )
}

const BUILTIN_ICON: Readonly<Record<BuiltinTabIcon, () => JSX.Element>> = { new: NewIcon, star: StarIcon, later: LaterIcon }

/** Tab icon: the built-in tabs' own drawing › short server emoji (text) › the default. */
function TabIconBox({ tab }: { tab: TabEntry }): JSX.Element {
  const builtin = builtinTabIcon(tab.id)
  if (builtin) {
    const Icon = BUILTIN_ICON[builtin]
    return (
      <span class="icon" data-icon={builtin}>
        <Icon />
      </span>
    )
  }
  const glyph = tabGlyph(tab.icon)
  return (
    <span class="icon" data-icon={glyph ? 'glyph' : 'tab'}>
      {glyph ? <span class="glyph">{glyph}</span> : <TabIcon />}
    </span>
  )
}

function Picks({ p }: { p: PanelProps }): JSX.Element {
  const rows: JSX.Element[] = []
  for (const tab of p.data.tabs) {
    const key = keyOf('tab', tab.id)
    rows.push(
      <button type="button" class="pick" data-pick={key} key={key} onClick={p.on.pick}>
        <TabIconBox tab={tab} />
        <span class="label">{tab.name}</span>
        {formatCount(tab.count, p.lang) ? <span class="count">{formatCount(tab.count, p.lang)}</span> : null}
      </button>
    )
  }
  const walk = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      const key = keyOf('folder', n.id)
      rows.push(
        <button type="button" class="pick" data-pick={key} key={key} onClick={p.on.pick} style={{ '--indent': `${(n.level - 1) * 16}px` }}>
          <span class="icon">
            <FolderIcon />
          </span>
          <span class="label">{n.name}</span>
          {formatCount(n.count, p.lang) ? <span class="count">{formatCount(n.count, p.lang)}</span> : null}
        </button>
      )
      walk(n.children)
    }
  }
  walk(p.tree)
  if (!rows.length) {
    return (
      <div class="state" data-part="empty">
        <span class="state-hint">{p.t('empty_hint')}</span>
      </div>
    )
  }
  return <>{rows}</>
}

function FeedBody({ s, p }: { s: PanelState; p: PanelProps }): JSX.Element {
  if (s.status === 'loading') return <Skeleton n={5} />
  if (s.status === 'error') {
    return (
      <div class="state" data-part="error" role="alert">
        <span class="state-title">{p.t('feed_error')}</span>
        <span class="state-hint">{p.t('feed_error_hint')}</span>
        <button type="button" class="pill" onClick={p.on.retry}>
          {p.t('retry')}
        </button>
      </div>
    )
  }
  const items = s.items.filter((i) => i && i.video && isVideoId(i.video.id))
  if (!items.length && !s.cursor) {
    return (
      <div class="state" data-part="empty">
        <span class="state-title">{p.t('feed_empty')}</span>
        <span class="state-hint">{p.t('feed_empty_hint')}</span>
      </div>
    )
  }
  return (
    <>
      {items.map((item) => (
        <VideoCard key={item.video.id} item={item} p={p} />
      ))}
      {s.more === 'loading' ? <Skeleton n={2} /> : null}
      {s.cursor && s.more !== 'loading' ? (
        <div class="more">
          {s.more === 'error' ? <span class="msg">{p.t('more_error')}</span> : null}
          <button type="button" class="pill" data-part="more" onClick={p.on.more}>
            {p.t(s.more === 'error' ? 'retry' : 'load_more')}
          </button>
        </div>
      ) : null}
    </>
  )
}

export function PanelView(p: PanelProps): JSX.Element {
  const s = p.open
  const feed = s?.view === 'feed' && s.scope
  const heading = feed ? s!.scope!.name : p.t('title')
  const count = feed ? p.scopeCount : p.data.total
  const canMark = Boolean(feed) && s!.status === 'ready' && s!.read === 'idle' && (p.scopeCount > 0 || s!.items.some((i) => i?.is_new))
  const back = Boolean(feed) && s!.anchor === 'mini'
  return (
    <section
      class="panel"
      data-part="panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tube-panel-title"
      hidden={!s}
      style={{ '--left': `${Math.round(p.left + 8)}px`, '--top': `${Math.round(p.top + 8)}px`, '--undo-ms': `${p.undoMs}ms` }}
      onKeyDown={p.on.keydown}
    >
      {s ? (
        <>
          <header class={back ? 'p-head with-back' : 'p-head'}>
            {back ? (
              <button type="button" class="round" data-part="back" aria-label={p.t('back')} title={p.t('back')} onClick={p.on.back}>
                <BackIcon />
              </button>
            ) : null}
            <div class="p-titles">
              <h2 class="p-title" id="tube-panel-title" data-part="heading" tabIndex={-1}>
                {heading}
              </h2>
              <span class="p-sub">{count > 0 ? plural(p.t, p.lang, 'new_count', count) : p.t('none_new')}</span>
            </div>
            {canMark ? (
              <button type="button" class="pill" data-part="mark" onClick={p.on.mark}>
                <CheckIcon />
                {p.t('mark_read')}
              </button>
            ) : null}
            <button type="button" class="round" data-part="close" aria-label={p.t('close')} title={p.t('close')} onClick={p.on.close}>
              <CloseIcon />
            </button>
          </header>
          {s.read === 'pending' ? (
            <div class="undo" data-part="undo-bar" role="status">
              <span class="undo-text">{p.t('marked_read')}</span>
              <button type="button" onClick={p.on.undo}>
                {p.t('undo')}
              </button>
              <span class="undo-progress" aria-hidden="true" />
            </div>
          ) : null}
          {s.read === 'error' ? (
            <p class="msg" data-part="read-error" role="alert">
              {p.t('mark_failed')}
            </p>
          ) : null}
          <div class="p-body" data-part="list" aria-busy={s.view === 'feed' && s.status === 'loading' ? 'true' : 'false'}>
            {s.view === 'tree' ? <Picks p={p} /> : <FeedBody s={s} p={p} />}
          </div>
        </>
      ) : null}
    </section>
  )
}
