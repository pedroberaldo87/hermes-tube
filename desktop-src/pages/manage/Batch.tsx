// Manage batch bar: appears with a selection. Move to folder (with "new folder…"), add/remove tag (with
// "new tag…"), ⭐, mute/unmute, mark as read and "Organize with Hermes". Each action goes through
// POST /channels/batch (or POST /read) and keeps the selection. No unsubscribing here (that is Cleanup).
import { Button, Codicon } from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'
import { useT } from '../../lib/i18n'
import { cx } from '../../lib/style'
import type { Plural } from './actions'
import { Picker, type PickerOption } from './Picker'

export type SimpleBatchOp = 'favorite' | 'unfavorite' | 'mute' | 'unmute'

export interface BatchBarProps {
  count: number
  /** Selected ones that the filter hides (the action applies to them too). */
  hidden: number
  plural: Plural
  folderOptions: readonly PickerOption[]
  tagOptions: readonly PickerOption[]
  /** Tags present in the selection (for "remove tag"). */
  untagOptions: readonly PickerOption[]
  onMove: (folderId: string | null) => void
  onCreateFolder: (name: string) => void
  onTag: (tagId: string) => void
  onCreateTag: (name: string) => void
  onUntag: (tagId: string) => void
  onOp: (op: SimpleBatchOp) => void
  onRead: () => void
  onOrganize: () => void
  onClear: () => void
}

type Open = 'move' | 'tag' | 'untag' | null

export function BatchBar(p: BatchBarProps) {
  const t = useT('manage')
  const [open, setOpen] = useState<Open>(null)
  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which))

  const menu = (which: Exclude<Open, null>, icon: string, picker: ReactNode) => (
    <span className={cx('manchor')}>
      <Button variant="ghost" size="xs" data-action={which} aria-haspopup="listbox" aria-expanded={open === which} onClick={() => toggle(which)}>
        <Codicon name={icon} size={13} />
        <span>{t(`batch.${which}`)}</span>
      </Button>
      {open === which ? picker : null}
    </span>
  )

  const simple = (op: SimpleBatchOp, icon: string) => (
    <Button variant="ghost" size="xs" data-action={op} onClick={() => p.onOp(op)}>
      <Codicon name={icon} size={13} />
      <span>{t(`batch.${op}`)}</span>
    </Button>
  )

  const close = () => setOpen(null)

  return (
    <div className={cx('mbatch')} data-part="manage-batch" role="toolbar" aria-label={t('batch.label')}>
      <span className={cx('mbatch-count t-label')} aria-live="polite">
        {p.plural('batch.selected', p.count)}
      </span>
      {p.hidden ? <span className={cx('mbatch-hidden t-label')}>{p.plural('batch.hidden', p.hidden)}</span> : null}
      <span className={cx('mbatch-sep')} aria-hidden="true" />
      <span className={cx('mbatch-actions')}>
        {menu(
          'move',
          'folder',
          <Picker
            label={t('picker.move')}
            options={p.folderOptions}
            searchable
            onPick={(v) => p.onMove(v || null)}
            onCreate={p.onCreateFolder}
            createLabel={(name) => t('picker.create_folder', { name })}
            onClose={close}
          />
        )}
        {menu(
          'tag',
          'tag',
          <Picker
            label={t('picker.tag')}
            options={p.tagOptions}
            searchable
            onPick={p.onTag}
            onCreate={p.onCreateTag}
            createLabel={(name) => t('picker.create_tag', { name })}
            onClose={close}
          />
        )}
        {p.untagOptions.length
          ? menu('untag', 'close', <Picker label={t('picker.untag')} options={p.untagOptions} onPick={p.onUntag} onClose={close} />)
          : null}
        {simple('favorite', 'star-full')}
        {simple('unfavorite', 'star-empty')}
        {simple('mute', 'bell-slash')}
        {simple('unmute', 'bell')}
        <Button variant="ghost" size="xs" data-action="read" onClick={p.onRead}>
          <Codicon name="check-all" size={13} />
          <span>{t('batch.read')}</span>
        </Button>
        <Button variant="ghost" size="xs" data-action="organize" onClick={p.onOrganize}>
          <Codicon name="sparkle" size={13} />
          <span>{t('batch.organize')}</span>
        </Button>
      </span>
      <span className={cx('mbatch-end')}>
        <Button variant="ghost" size="xs" data-action="clear" aria-label={t('batch.clear')} title={t('batch.clear')} onClick={p.onClear}>
          <Codicon name="close" size={13} />
        </Button>
      </span>
    </div>
  )
}
