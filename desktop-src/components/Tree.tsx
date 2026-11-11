// Side pane tree: Tree (role=tree; ↑/↓/Home/End move focus, roving tabindex) and
// TreeItem (role=treeitem; indent per level, new-video counter, expand/collapse with ←/→, Enter selects,
// drag-and-drop target).
import { Codicon } from '@hermes/plugin-sdk'
import { type DragEvent, type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { ChannelAvatar, ChannelAvatarSkeleton } from './ChannelAvatar'
import { SkLines, useFormatCount, vars } from './kit'

const ITEM = '[role="treeitem"]'

function visibleItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(ITEM)].filter(
    (el) => !el.parentElement?.closest('[role="treeitem"][aria-expanded="false"]') && !el.hasAttribute('data-skeleton')
  )
}

function focusItem(items: HTMLElement[], el: HTMLElement | undefined): void {
  if (!el) return
  for (const it of items) it.tabIndex = it === el ? 0 : -1
  el.focus()
}

export function Tree({ label, children }: { label: string; children?: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)

  // exactly one item is in the Tab order: the selected one, else the first
  useEffect(() => {
    const items = visibleItems(ref.current)
    if (!items.length || items.some((i) => i.tabIndex === 0)) return
    const pick = items.find((i) => i.getAttribute('aria-selected') === 'true') ?? items[0]
    pick.tabIndex = 0
  })

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = visibleItems(ref.current)
    const current = (e.target as HTMLElement).closest<HTMLElement>(ITEM)
    const i = current ? items.indexOf(current) : -1
    if (i < 0) return
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = items[i + 1]
    else if (e.key === 'ArrowUp') next = items[i - 1]
    else if (e.key === 'Home') next = items[0]
    else if (e.key === 'End') next = items[items.length - 1]
    else return
    e.preventDefault()
    focusItem(items, next ?? current ?? undefined)
  }

  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM)
    if (!item) return
    for (const it of visibleItems(ref.current)) it.tabIndex = it === item ? 0 : -1
  }

  return (
    <ul ref={ref} role="tree" aria-label={label} className={cx('tree')} data-part="tree" onKeyDown={onKeyDown} onFocus={onFocus}>
      {children}
    </ul>
  )
}

export interface TreeItemProps {
  id: string
  label: ReactNode
  /** Level in the tree (1 = root). */
  level?: number
  /** Codicon (folder, tab); or `avatar` for a channel. */
  icon?: string
  avatar?: { title: string; thumb: string | null | undefined }
  /** New videos (accent; zero is not shown). */
  count?: number | null
  expanded?: boolean
  onToggle?: () => void
  selected?: boolean
  onSelect?: () => void
  /** Drop target: receives the dragged text (`dataTransfer.getData(dropType)`). */
  onDropItem?: (data: string) => void
  dropType?: string
  /** Makes the item draggable with this text (e.g. the channel id). */
  dragData?: string
  /** Actions shown on hover/focus (e.g. mark as read). */
  actions?: ReactNode
  children?: ReactNode
}

export function TreeItem({
  id,
  label,
  level = 1,
  icon,
  avatar,
  count,
  expanded,
  onToggle,
  selected,
  onSelect,
  onDropItem,
  dropType = 'text/plain',
  dragData,
  actions,
  children
}: TreeItemProps) {
  const t = useT()
  const fmt = useFormatCount()
  const [over, setOver] = useState(false)
  const expandable = !!onToggle || !!children
  const isOpen = expandable ? !!expanded : undefined

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return // event bubbled up from a child
    if (e.key === 'Enter' || e.key === ' ') {
      onSelect?.()
    } else if (e.key === 'ArrowRight') {
      if (expandable && !expanded) onToggle?.()
      else if (expanded) (e.currentTarget.querySelector<HTMLElement>(`:scope > [role="group"] > ${ITEM}`) ?? undefined)?.focus()
      else return
    } else if (e.key === 'ArrowLeft') {
      if (expandable && expanded) onToggle?.()
      else e.currentTarget.parentElement?.closest<HTMLElement>(ITEM)?.focus()
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  const dropHandlers = onDropItem
    ? {
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          if (!over) setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          setOver(false)
          const data = e.dataTransfer?.getData(dropType)
          if (data) onDropItem(data)
        }
      }
    : {}

  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={isOpen}
      aria-selected={!!selected}
      tabIndex={-1}
      className={cx('tree-item')}
      data-part="tree-item"
      data-id={id}
      style={vars({ level })}
      onKeyDown={onKeyDown}
    >
      <div
        className={cx('tree-row')}
        data-part="tree-row"
        data-drop={over ? 'true' : undefined}
        title={onDropItem && over ? t('kit.tree.drop') : undefined}
        onClick={onSelect}
        draggable={dragData ? true : undefined}
        onDragStart={dragData ? (e) => e.dataTransfer?.setData(dropType, dragData) : undefined}
        {...dropHandlers}
      >
        {expandable ? (
          <button
            type="button"
            className={cx('bare tree-caret')}
            tabIndex={-1}
            aria-label={expanded ? t('kit.tree.collapse') : t('kit.tree.expand')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle?.()
            }}
          >
            <Codicon name="chevron-right" size={12} />
          </button>
        ) : (
          <span className={cx('tree-spacer')} />
        )}
        {avatar ? (
          <ChannelAvatar title={avatar.title} thumb={avatar.thumb} size={18} />
        ) : icon ? (
          <Codicon name={icon} size={14} className={cx('tree-icon')} />
        ) : null}
        <span className={cx('tree-label')}>{label}</span>
        {actions ? <span className={cx('tree-actions')}>{actions}</span> : null}
        {count ? (
          <span className={cx('tree-count')} aria-label={t('kit.tree.new_count', { count: fmt(count) })}>
            {fmt(count)}
          </span>
        ) : null}
      </div>
      {expandable && expanded && children ? (
        <ul role="group" className={cx('tree-group')}>
          {children}
        </ul>
      ) : null}
    </li>
  )
}

export function TreeItemSkeleton({ level = 1, avatar }: { level?: number; avatar?: boolean }) {
  return (
    <li className={cx('tree-item')} data-skeleton aria-hidden="true" style={vars({ level })}>
      <div className={cx('tree-row')}>
        <span className={cx('tree-spacer')} />
        {avatar ? <ChannelAvatarSkeleton size={18} /> : null}
        <span className={cx('tree-label')}>
          <SkLines widths={[level > 1 ? '64%' : '48%']} />
        </span>
      </div>
    </li>
  )
}
