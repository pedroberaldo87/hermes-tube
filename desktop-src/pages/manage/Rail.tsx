// Folder list to the left of the table: click filter (with recursive count within the chosen relation),
// drop target (moves the dragged row or the selection), create and rename folder in place. "All" is not a drop target;
// "No folder" removes from the folder. At 420–700 px the page swaps this list for a picker in the filter bar.
import { Codicon } from '@hermes/plugin-sdk'
import { type CSSProperties, type DragEvent, type KeyboardEvent, useRef, useState } from 'react'
import type { Folder } from '../../../shared/api-types'
import { useFormatCount } from '../../components'
import { useT } from '../../lib/i18n'
import { cssVar, cx } from '../../lib/style'

export interface RailProps {
  tree: ReadonlyArray<{ folder: Folder; level: number }>
  counts: ReadonlyMap<string, number>
  /** Current filter: id, `none` or `null` (all). */
  current: string | null
  onSelect: (folder: string | null) => void
  /** Something was dropped on `target` (folder id or `null` = no folder). */
  onDropTo: (target: string | null, dt: DataTransfer) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
}

export function Rail({ tree, counts, current, onSelect, onDropTo, onCreate, onRename }: RailProps) {
  const t = useT('manage')
  const fmt = useFormatCount()
  const [over, setOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const dropProps = (key: string, target: string | null) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setOver(null)
      if (e.dataTransfer) onDropTo(target, e.dataTransfer)
    }
  })

  const item = (key: string, label: string, opts: { icon: string; level?: number; folder?: Folder; droppable: boolean }) => {
    const filterValue = key === 'all' ? null : key
    const isCurrent = current === filterValue
    const style = opts.level && opts.level > 1 ? ({ [cssVar('level')]: opts.level } as CSSProperties) : undefined
    const count = counts.get(key) ?? 0
    return (
      <div
        key={key}
        className={cx('mrail-item t-body')}
        data-part="rail-item"
        data-folder={key}
        aria-current={isCurrent ? 'true' : undefined}
        data-drop={over === key ? 'true' : undefined}
        title={over === key ? t('rail.drop') : undefined}
        style={style}
        {...(opts.droppable ? dropProps(key, key === 'none' ? null : key) : {})}
      >
        {opts.folder && renaming === opts.folder.id ? (
          <NameInput
            initial={opts.folder.name}
            placeholder={t('rail.placeholder')}
            onDone={(name) => {
              setRenaming(null)
              if (name && name !== opts.folder?.name) onRename(opts.folder!.id, name)
            }}
          />
        ) : (
          <>
            <button type="button" className={cx('bare mrail-select')} data-part="rail-select" aria-pressed={isCurrent} onClick={() => onSelect(isCurrent && key !== 'all' ? null : filterValue)}>
              <Codicon name={opts.icon} size={14} className={cx('mrail-icon')} />
              <span className={cx('truncate')}>{label}</span>
            </button>
            {opts.folder ? (
              <button
                type="button"
                className={cx('bare mrail-rename')}
                data-part="rail-rename"
                aria-label={t('rail.rename', { name: label })}
                title={t('rail.rename', { name: label })}
                onClick={() => setRenaming(opts.folder!.id)}
              >
                <Codicon name="edit" size={12} />
              </button>
            ) : null}
            <span className={cx('mrail-count t-label')} data-part="rail-count">
              {fmt(count)}
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <nav className={cx('mrail')} data-part="manage-rail" aria-label={t('rail.label')}>
      <span className={cx('mrail-head t-label')} aria-hidden="true">
        {t('rail.label')}
      </span>
      {item('all', t('rail.all'), { icon: 'list-flat', droppable: false })}
      {tree.map(({ folder, level }) => item(folder.id, folder.name, { icon: 'folder', level, folder, droppable: true }))}
      {item('none', t('rail.none'), { icon: 'circle-slash', droppable: true })}
      <span className={cx('mrail-sep')} aria-hidden="true" />
      {creating ? (
        <div className={cx('mrail-item')}>
          <NameInput
            initial=""
            placeholder={t('rail.placeholder')}
            onDone={(name) => {
              setCreating(false)
              if (name) onCreate(name)
            }}
          />
        </div>
      ) : (
        <button type="button" className={cx('bare mrail-new t-body')} data-part="rail-new" onClick={() => setCreating(true)}>
          <Codicon name="add" size={14} />
          <span>{t('rail.new')}</span>
        </button>
      )}
    </nav>
  )
}

/** In-place name field: Enter saves, Esc gives up, leaving the field saves (only once). */
function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(value.trim() || null)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(null)
    }
  }
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field is born from the "New folder"/"Rename" click
      autoFocus
      type="text"
      className={cx('mrail-input t-body')}
      data-part="rail-input"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(value.trim() || null)}
    />
  )
}
