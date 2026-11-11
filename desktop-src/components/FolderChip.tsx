// Folder and tag chips (Manage, pane, filters, suggestions). Clickable when given `onClick`.
// Monochrome: the folder color (Folder.color) does not paint the interface — the thumbnail is the only color.
import { Codicon } from '@hermes/plugin-sdk'
import type { Folder, Tag } from '../../shared/api-types'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { SkBar, useFormatCount, withClass } from './kit'

export interface FolderChipProps {
  folder: Pick<Folder, 'id' | 'name'>
  count?: number
  active?: boolean
  onClick?: (folder: Pick<Folder, 'id' | 'name'>) => void
  className?: string
}

export function FolderChip({ folder, count, active, onClick, className }: FolderChipProps) {
  const fmt = useFormatCount()
  const classes = withClass(cx('chip t-label'), className)
  const body = (
    <>
      <Codicon name="folder" size={12} className={cx('chip-icon')} />
      <span className={cx('chip-label')}>{folder.name}</span>
      {count ? <span className={cx('chip-count')}>{fmt(count)}</span> : null}
    </>
  )
  if (!onClick) {
    return (
      <span className={classes} data-folder={folder.id} data-active={active ? 'true' : undefined}>
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={withClass(cx('bare'), classes)}
      data-folder={folder.id}
      data-active={active ? 'true' : undefined}
      aria-pressed={!!active}
      onClick={() => onClick(folder)}
    >
      {body}
    </button>
  )
}

export interface TagChipProps {
  tag: Pick<Tag, 'id' | 'name'>
  active?: boolean
  onClick?: (tag: Pick<Tag, 'id' | 'name'>) => void
  onRemove?: (tag: Pick<Tag, 'id' | 'name'>) => void
}

export function TagChip({ tag, active, onClick, onRemove }: TagChipProps) {
  const t = useT()
  const label = (
    <>
      <span className={cx('chip-hash')} aria-hidden="true">
        #
      </span>
      <span className={cx('chip-label')}>{tag.name}</span>
    </>
  )
  return (
    <span className={cx('chip t-label')} data-tag={tag.id} data-active={active ? 'true' : undefined}>
      {onClick ? (
        <button type="button" className={cx('bare chip-label')} aria-pressed={!!active} onClick={() => onClick(tag)}>
          {label}
        </button>
      ) : (
        label
      )}
      {onRemove ? (
        <button
          type="button"
          className={cx('bare chip-remove')}
          data-part="chip-remove"
          aria-label={t('kit.chip.remove', { name: tag.name })}
          onClick={(e) => {
            e.stopPropagation()
            onRemove(tag)
          }}
        >
          <Codicon name="close" size={10} />
        </button>
      ) : null}
    </span>
  )
}

export function ChipSkeleton({ width = '64px' }: { width?: string }) {
  return (
    <span className={cx('chip t-label')} data-skeleton aria-hidden="true" style={{ width }}>
      <SkBar width="100%" />
    </span>
  )
}
