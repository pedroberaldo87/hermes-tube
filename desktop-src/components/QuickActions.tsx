// Card quick actions: SDK buttons with the visible shortcut (the SDK's Kbd). The frequent ones (watched,
// later, archive) never go into a three-dot menu. Inside the Grid the buttons leave the Tab order:
// the keyboard uses the shortcuts (w, l, e) on the focused cell.
// Toggle actions (watched, later, 👍/👎): `aria-pressed` shows the state and the `hint` says what the click
// WILL do ("Mark as watched" / "Undo watched") — it goes in the accessible name.
import { Button, Codicon, Kbd, Tip } from '@hermes/plugin-sdk'
import { useContext } from 'react'
import type { VideoState } from '../../shared/api-types'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { PersistentActionsContext, useInGrid } from './kit'

/**
 * Delay of the kit tooltips (ms): short, so the tooltip of icon-only buttons shows almost at once (the app's
 * default is 200). A single constant — quick actions and the tab "⋯" use it.
 */
export const TIP_DELAY_MS = 150

/** Tooltip text: what the click will do + the key ("Mark as watched · W"). */
export function tipText(name: string, shortcut?: string): string {
  return shortcut ? `${name} · ${shortcut.toUpperCase()}` : name
}

export interface QuickAction {
  id: string
  /** Short name (visible label in the featured card). */
  label: string
  /** What the click will do now ("Undo watched"); default = `label`. Goes in the accessible name. */
  hint?: string
  /** Codicon. */
  icon: string
  /** Key shown in the Kbd (the Grid fires the same shortcut). */
  shortcut?: string
  onSelect: () => void
  /** On state (e.g. already in "later"). */
  pressed?: boolean
}

export interface QuickActionsProps {
  actions: readonly QuickAction[]
  /** Group label (default "Quick actions"). */
  label?: string
  /** Shows each action's label next to the icon (default: only inside `VideoCard variant="featured"`). */
  showLabels?: boolean
}

export function QuickActions({ actions, label, showLabels }: QuickActionsProps) {
  const t = useT()
  const inGrid = useInGrid()
  const persistent = useContext(PersistentActionsContext)
  const labels = showLabels ?? persistent
  return (
    <div className={cx('quick')} role="group" aria-label={label ?? t('kit.actions.label')} data-part="quick" data-labels={labels ? 'true' : undefined}>
      {actions.map((a) => {
        const name = a.hint ?? a.label
        const btn = (
          <Button
            key={a.id}
            variant="ghost"
            size="xs"
            className={cx('quick-btn')}
            data-action={a.id}
            aria-label={a.shortcut ? t('kit.shortcut_label', { label: name, key: a.shortcut }) : name}
            aria-pressed={a.pressed === undefined ? undefined : a.pressed}
            tabIndex={inGrid ? -1 : undefined}
            onClick={(e: { stopPropagation: () => void }) => {
              e.stopPropagation()
              a.onSelect()
            }}
          >
            <Codicon name={a.icon} size={14} />
            {labels ? (
              <span className={cx('quick-label')} data-part="quick-label">
                {a.label}
              </span>
            ) : null}
            {a.shortcut ? (
              <Kbd size="sm" className={cx('quick-kbd')}>
                {a.shortcut}
              </Kbd>
            ) : null}
          </Button>
        )
        // icon only (grid, compact, list): fast SDK tooltip; with a visible label (featured) it is redundant.
        // The tooltip (Radix) only opens on top and takes no pointer: clicks and grid shortcuts work the same.
        return labels ? (
          btn
        ) : (
          <Tip key={a.id} label={tipText(name, a.shortcut)} delayDuration={TIP_DELAY_MS} side="top">
            {btn}
          </Tip>
        )
      })}
    </div>
  )
}

export interface StandardQuickActionHandlers {
  watched?: () => void
  later?: () => void
  archive?: () => void
  /** Current video state (marks "watched"/"later" as on). */
  state?: VideoState | null
}

/** The 3 frequent feed actions, with the design language's icons and shortcuts (w · l · e). */
export function useStandardQuickActions(h: StandardQuickActionHandlers): QuickAction[] {
  const t = useT()
  const out: QuickAction[] = []
  if (h.watched) {
    const on = h.state === 'watched'
    out.push({ id: 'watched', label: t('kit.actions.watched'), hint: t(on ? 'kit.actions.watched_undo' : 'kit.actions.watched_do'), icon: 'eye', shortcut: 'w', onSelect: h.watched, pressed: on })
  }
  if (h.later) {
    const on = h.state === 'later'
    out.push({ id: 'later', label: t('kit.actions.later'), hint: t(on ? 'kit.actions.later_undo' : 'kit.actions.later_do'), icon: 'clock', shortcut: 'l', onSelect: h.later, pressed: on })
  }
  if (h.archive) out.push({ id: 'archive', label: t('kit.actions.archive'), hint: t('kit.actions.archive_do'), icon: 'archive', shortcut: 'e', onSelect: h.archive })
  return out
}
