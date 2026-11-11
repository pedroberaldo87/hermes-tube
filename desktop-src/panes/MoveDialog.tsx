// "Move to…" from the context menu: the folders in a tree (the kit's tree keyboard), with "No folder" (channel)
// or "Top level" (folder) at the top. A folder cannot go into itself or inside itself (those are left out).
// Choosing closes the dialog and moves (optimistic, the same path as dragging).
import { Button } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { DialogFrame, Tree, TreeItem } from '../components'
import { useT } from '../lib/i18n'
import type { ChannelTree, FolderNode } from './model'

export interface MoveSubject {
  kind: 'channel' | 'folder'
  id: string
  name: string
  /** Current folder (channel) or current parent (folder). */
  current: string | null
}

export function MoveDialog({ subject, tree, onPick, onClose }: { subject: MoveSubject; tree: ChannelTree; onPick: (folderId: string | null) => void; onClose: () => void }) {
  const t = useT('panes')
  const pick = (id: string | null) => {
    onClose()
    if (id !== subject.current) onPick(id)
  }
  const render = (n: FolderNode, level: number): ReactNode => {
    if (subject.kind === 'folder' && n.folder.id === subject.id) return null
    const kids = n.children.map((k) => render(k, level + 1)).filter(Boolean)
    return (
      <TreeItem
        key={n.folder.id}
        id={`dest:${n.folder.id}`}
        level={level}
        label={n.folder.name}
        icon="folder"
        expanded={kids.length ? true : undefined}
        selected={subject.current === n.folder.id}
        onSelect={() => pick(n.folder.id)}
      >
        {kids.length ? kids : undefined}
      </TreeItem>
    )
  }
  return (
    <DialogFrame
      size="sm"
      title={t('move.title', { name: subject.name })}
      description={subject.kind === 'channel' ? t('move.description_channel') : t('move.description_folder')}
      onClose={onClose}
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('move.cancel')}
        </Button>
      }
    >
      <Tree label={t('move.title', { name: subject.name })}>
        <TreeItem
          id="dest:"
          label={subject.kind === 'channel' ? t('move.no_folder') : t('move.top_level')}
          icon={subject.kind === 'channel' ? 'circle-slash' : 'list-tree'}
          selected={subject.current === null}
          onSelect={() => pick(null)}
        />
        {tree.roots.map((n) => render(n, 1))}
      </Tree>
    </DialogFrame>
  )
}
