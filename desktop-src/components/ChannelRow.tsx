// Channel table: ChannelTable (role=table, optional header, selection) and ChannelRow (channel with ⭐,
// folder, tags, new videos, last video, actions). Columns disappear by container width (tags < 860 px; folder
// and last video < 600 px) — the same grid on every row, skeleton included.
import { Checkbox, Codicon } from '@hermes/plugin-sdk'
import { type ReactNode, createContext, useContext } from 'react'
import type { Channel, Folder, Tag } from '../../shared/api-types'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { ChannelAvatar, ChannelAvatarSkeleton } from './ChannelAvatar'
import { ChipSkeleton, FolderChip, TagChip } from './FolderChip'
import { SkLines, formatRelative, useLocale } from './kit'
import { Count } from './misc'

const TableContext = createContext({ selectable: false })

export type ChannelColumn = 'channel' | 'folder' | 'tags' | 'new' | 'last' | 'actions'

const COLUMNS: readonly ChannelColumn[] = ['channel', 'folder', 'tags', 'new', 'last', 'actions']

export interface ChannelTableProps {
  label: string
  children?: ReactNode
  /** Selection column (batch) on the left. */
  selectable?: boolean
  /** Header row (default: yes). */
  header?: boolean
}

export function ChannelTable({ label, children, selectable = false, header = true }: ChannelTableProps) {
  const t = useT()
  return (
    <div role="table" aria-label={label} className={cx('table')} data-part="table" data-selectable={selectable ? 'true' : 'false'}>
      <TableContext.Provider value={{ selectable }}>
        {header ? (
          <div role="rowgroup">
            <div role="row" className={cx('crow')} data-head="true">
              {selectable ? (
                <span role="columnheader" className={cx('ccell chead')} data-col="select">
                  <span className={cx('sr')}>{t('kit.channel.columns.channel')}</span>
                </span>
              ) : null}
              {COLUMNS.map((c) => (
                <span key={c} role="columnheader" className={cx('ccell chead')} data-col={c}>
                  {c === 'actions' ? <span className={cx('sr')}>{t('kit.channel.columns.actions')}</span> : t(`kit.channel.columns.${c}`)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div role="rowgroup">{children}</div>
      </TableContext.Provider>
    </div>
  )
}

export interface ChannelRowProps {
  channel: Pick<Channel, 'id' | 'title' | 'handle' | 'thumb' | 'favorite' | 'last_video_at'>
  folder?: Pick<Folder, 'id' | 'name'> | null
  tags?: ReadonlyArray<Pick<Tag, 'id' | 'name'>>
  /** New videos of the channel (accent when > 0). */
  newCount?: number
  /** Last video (title + when, in seconds). Without it, uses `channel.last_video_at`. */
  lastVideo?: { title: string; at: number | null } | null
  now?: number
  selected?: boolean
  onSelect?: (selected: boolean) => void
  onToggleFavorite?: () => void
  onFolderClick?: (folder: Pick<Folder, 'id' | 'name'>) => void
  /** Row actions (e.g. folder menu, open on YouTube). */
  actions?: ReactNode
}

export function ChannelRow({
  channel,
  folder,
  tags,
  newCount,
  lastVideo,
  now,
  selected,
  onSelect,
  onToggleFavorite,
  onFolderClick,
  actions
}: ChannelRowProps) {
  const t = useT()
  const locale = useLocale()
  const { selectable } = useContext(TableContext)
  const clock = now ?? Date.now()
  const lastAt = lastVideo?.at ?? channel.last_video_at
  return (
    <div
      role="row"
      className={cx('crow')}
      data-part="channel-row"
      data-channel={channel.id}
      aria-selected={selectable ? !!selected : undefined}
    >
      {selectable ? (
        <span role="cell" className={cx('ccell')} data-col="select">
          <Checkbox
            checked={!!selected}
            onCheckedChange={(v: boolean | 'indeterminate') => onSelect?.(v === true)}
            aria-label={t('kit.channel.select', { name: channel.title })}
          />
        </span>
      ) : null}
      <span role="cell" className={cx('ccell')} data-col="channel">
        <ChannelAvatar title={channel.title} thumb={channel.thumb} size={28} />
        <span className={cx('cname')}>
          <span className={cx('cname-title t-body')}>
            <span className={cx('truncate')}>{channel.title}</span>
            {onToggleFavorite ? (
              <button
                type="button"
                className={cx('bare fav')}
                data-part="channel-fav"
                aria-pressed={channel.favorite}
                aria-label={t('kit.channel.favorite')}
                onClick={onToggleFavorite}
              >
                <Codicon name={channel.favorite ? 'star-full' : 'star-empty'} size={13} />
              </button>
            ) : channel.favorite ? (
              <span className={cx('fav')} data-part="channel-fav" aria-pressed="true" role="img" aria-label={t('kit.channel.favorite')}>
                <Codicon name="star-full" size={13} />
              </span>
            ) : null}
          </span>
          {channel.handle ? <span className={cx('cname-sub t-label truncate')}>{channel.handle}</span> : null}
        </span>
      </span>
      <span role="cell" className={cx('ccell')} data-col="folder">
        {folder ? (
          <FolderChip folder={folder} onClick={onFolderClick} />
        ) : (
          <span className={cx('cnone t-label')}>{t('kit.channel.no_folder')}</span>
        )}
      </span>
      <span role="cell" className={cx('ccell')} data-col="tags">
        {tags?.map((tag) => <TagChip key={tag.id} tag={tag} />)}
      </span>
      <span role="cell" className={cx('ccell t-body')} data-col="new">
        {newCount ? <Count value={newCount} tone="new" label={t('kit.tree.new_count', { count: newCount })} /> : <span className={cx('cnone')}>–</span>}
      </span>
      <span role="cell" className={cx('ccell')} data-col="last">
        {lastVideo || lastAt ? (
          <span className={cx('clast')}>
            {lastVideo ? <span className={cx('t-body truncate')}>{lastVideo.title}</span> : null}
            {lastAt ? <span className={cx('clast-when t-label')}>{formatRelative(lastAt, clock, locale)}</span> : null}
          </span>
        ) : (
          <span className={cx('cnone t-label')}>{t('kit.channel.no_videos')}</span>
        )}
      </span>
      <span role="cell" className={cx('ccell')} data-col="actions">
        {actions}
      </span>
    </div>
  )
}

export function ChannelRowSkeleton() {
  const { selectable } = useContext(TableContext)
  return (
    <div role="row" className={cx('crow')} data-part="channel-row" data-skeleton aria-busy="true">
      {selectable ? <span role="cell" className={cx('ccell')} data-col="select" /> : null}
      <span role="cell" className={cx('ccell')} data-col="channel">
        <ChannelAvatarSkeleton size={28} />
        <span className={cx('cname')}>
          <span className={cx('cname-title t-body')}>
            <SkLines widths={['120px']} />
          </span>
          <span className={cx('cname-sub t-label')}>
            <SkLines widths={['72px']} />
          </span>
        </span>
      </span>
      <span role="cell" className={cx('ccell')} data-col="folder">
        <ChipSkeleton width="76px" />
      </span>
      <span role="cell" className={cx('ccell')} data-col="tags">
        <ChipSkeleton width="52px" />
      </span>
      <span role="cell" className={cx('ccell t-body')} data-col="new">
        <SkLines widths={['16px']} />
      </span>
      <span role="cell" className={cx('ccell')} data-col="last">
        <span className={cx('clast')}>
          <span className={cx('t-body')}>
            <SkLines widths={['140px']} />
          </span>
          <span className={cx('clast-when t-label')}>
            <SkLines widths={['56px']} />
          </span>
        </span>
      </span>
      <span role="cell" className={cx('ccell')} data-col="actions" />
    </div>
  )
}
