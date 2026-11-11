// The channels panel contributed as a TAB of the right column, and the "show the panel" command.
//
// Where it lands (app checkout, apps/desktop/src/components/pane-shell/tree/store.ts, `adoptContributedPanes`):
// a pane outside the tree joins the anchor's group — `data.dock.pane` if that pane is in the tree; otherwise the
// first pane with the same `placement`; otherwise the main one — at position `dock.pos ?? 'center'` (`center` =
// stacks as a tab, silently: the zone's active tab does not change). The app defaults (app/contrib/layout-presets.ts)
// put Review and Files each in ITS OWN zone, Review before Files; Review lives hidden (⌘G). With only
// `placement: 'right'` the panel fell into Review's group and sat alone on screen, with no tab strip (no handle, no
// menu). With `dock: { pane: 'files', pos: 'center' }` it becomes a tab next to Files; without Files in the tree, the
// placement rule applies (first 'right' pane, Review in the defaults); with none, the main one — the old behavior.
//
// Closing: the SDK does not export `registerPaneCloser`, and Close on a plugin with ONE pane just disables the plugin
// (`closeTreePane`). `hideOnly: true` is the door the app gives plugins (Bots uses it): the tab has no ✕; the zone
// menu and the app's automatic ⌘K offer Hide/Show, the hidden state persists and the plugin is never disabled.
//
// One-time migration (`enforce` only on the first load after this version): whoever already has the panel in the
// tree is not re-adopted; the dock's `enforce` re-docks the panel into the Files tab on the first adoption pass of
// that boot (`enforceDockedPanes`). The mark in `ctx.storage` makes later loads register without `enforce`, so a
// drag by the user after that is never undone.
import { type PluginContext, type PluginContribution, PALETTE_AREA, PANES_AREA, icons } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { PANE_ID, PLUGIN_ID } from '../../shared/ids'
import { BUNDLES, LOCALES, tNow, useT } from '../lib/i18n'
import { paneControlsAvailable, showPane } from '../lib/pane-visibility'

/** Same widths as Files (app: store/layout.ts FILE_BROWSER_*): the column does not change when the panel joins. */
export const PANE_SIZE = { width: '237px', minWidth: '10rem', maxWidth: '20rem' } as const

/** Dock anchor: the app's Files pane (core id, no namespace). */
export const DOCK_ANCHOR = 'files'

/** Mark (ctx.storage) that the one-time re-dock was already requested. */
export const DOCK_MIGRATION_KEY = 'pane.dock_migrated_v1'

/** Id of the ⌘K "show the panel" command. */
export const SHOW_PANE_COMMAND = 'show-pane'

/** true only on the first load after the panel became a tab (and writes the mark). No storage: never forces. */
export function takeDockMigration(ctx: PluginContext): boolean {
  try {
    if (ctx.storage.get<boolean>(DOCK_MIGRATION_KEY, false) === true) return false
    ctx.storage.set(DOCK_MIGRATION_KEY, true)
    return true
  } catch {
    return false
  }
}

/** Tab title in the active language (the tab renders this; `title` is read once at registration). */
export function PaneTabTitle() {
  const tc = useT()
  return <>{tc('pane.title')}</>
}

export function subscriptionsPane(render: () => ReactNode, opts: { enforceDock: boolean }): PluginContribution {
  return {
    id: PANE_ID,
    area: PANES_AREA,
    title: tNow('common', 'pane.title'),
    data: {
      placement: 'right',
      dock: { pane: DOCK_ANCHOR, pos: 'center', ...(opts.enforceDock ? { enforce: true } : {}) },
      hideOnly: true,
      collapsible: true,
      ...PANE_SIZE,
      tabTitle: () => <PaneTabTitle />,
      tabTitleText: () => tNow('common', 'pane.title')
    },
    render
  }
}

type PaletteBundle = { palette?: Record<string, { label?: string; keywords?: string }> }

function keywords(): string[] {
  const words = LOCALES.flatMap((loc) => ((BUNDLES[loc].panes as unknown as PaletteBundle).palette?.show?.keywords ?? '').split(/\s+/))
  return [...new Set(words.filter(Boolean))]
}

/** ⌘K "HermesTube: Show channels panel" (label in the active language); null on a Desktop without `host.revealPane`. */
export function showPaneCommand(): PluginContribution | null {
  if (!paneControlsAvailable()) return null
  return {
    id: SHOW_PANE_COMMAND,
    area: PALETTE_AREA,
    data: {
      id: `${PLUGIN_ID}.${SHOW_PANE_COMMAND}`,
      label: tNow('panes', 'palette.show.label'),
      icon: icons.LayoutDashboard,
      keywords: keywords(),
      run: () => void showPane()
    }
  }
}
