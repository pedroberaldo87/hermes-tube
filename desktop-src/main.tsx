// Entry point of the Desktop plugin: composes the screens and registers everything at
// once: ONE page route (the single HermesTube tab: Subscriptions, Manage, Cleanup, Extras and Watch
// are sections inside it, switched by lib/nav — never another route, so the plugin never has more than one center
// tab), ONE sidebar entry ("HermesTube" → the page), the pane (a tab next to Files), chip, ⌘K (including
// "Connect a browser or add a channel", the fixed way into the Welcome dialog), chat directive, dialogs and locales.
// The only file that knows every screen.
//
// register(ctx) does no network and starts no polling thread/timer: the /status and /extras poll lives in
// <ShellHost/> (React Query), mounted with the chip, the pane and each page; only the leader works.
import {
  type HermesPlugin,
  PALETTE_AREA,
  type PluginContext,
  type PluginContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  TRANSCRIPT_DIRECTIVE_AREA,
  type TranscriptDirectiveProps
} from '@hermes/plugin-sdk'
import type { ComponentType } from 'react'
import { CHAT_DIRECTIVE, DESKTOP_ROUTES, DIALOG_IDS, PALETTE_COMMANDS, PLUGIN_ID, STATUS_CHIP_ID } from '../shared/ids'
import { ChatVideoCard, mascotLines } from './chat'
import { CONNECT_COMMAND, type PaletteCommand, PluginGate, StatusChip, connectCommand, paletteCommands, paletteContribution } from './chrome'
import { type SectionScreens, ShellPage } from './components'
import { ListImportDialog } from './dialogs/list-import'
import { OnboardingDialog } from './dialogs/onboarding'
import { OrganizeDialog } from './dialogs/organize'
import { TabEditorDialog } from './dialogs/tab-editor'
import { ThemeDialog } from './dialogs/theme'
import { setPluginContext } from './lib/ctx'
import { type DialogRegistry, openDialog, registerDialogs } from './lib/dialogs'
import { registerLocales, tNow } from './lib/i18n'
import { setWatchRenderer } from './lib/player'
import { resetShellState } from './lib/lifecycle'
import { openSection, showSection } from './lib/nav'
import { ShellHost, configureShell } from './lib/shell'
import { bindWindowVisibility } from './lib/status'
import { mountStyles } from './lib/style'
import { CleanupPage } from './pages/cleanup'
import { ExtrasPage } from './pages/extras'
import { HomePage } from './pages/home'
import { ManagePage } from './pages/manage'
import { CreateTabDialog } from './pages/manage/create-tab'
import { HistoryDialog } from './pages/manage/history'
import { SubscriptionsPane } from './panes'
import { showPaneCommand, subscriptionsPane, takeDockMigration } from './panes/contribution'
import { WatchPage } from './pages/watch'

/** Name shown in the plugin inventory (the provisional id changes before release; so may the final name). */
export const PLUGIN_NAME = 'HermesTube'

/** One component per dialog (the type requires every DIALOG_IDS entry). */
export const DIALOGS: DialogRegistry = {
  onboarding: OnboardingDialog,
  'tab-editor': TabEditorDialog,
  organize: OrganizeDialog,
  theme: ThemeDialog,
  'list-import': ListImportDialog,
  history: HistoryDialog,
  'create-tab': CreateTabDialog
}

/**
 * Screens of the single page, one per section. The old Manage/Cleanup/Extras route ids stay in shared/ids.ts
 * (contract with owners.yaml, additions only) but are no longer registered: each registered route opens its own
 * center tab. Everything that opened them now opens the page at the right section (lib/nav.openSection).
 */
const SECTIONS: SectionScreens = {
  home: HomePage,
  manage: ManagePage,
  cleanup: CleanupPage,
  extras: ExtrasPage,
  watch: WatchPage
}

function SinglePage() {
  // the plugin not answering in this profile at all → the explanation, not each screen's generic error
  return (
    <PluginGate>
      <ShellPage sections={SECTIONS} />
    </PluginGate>
  )
}

/**
 * ⌘K commands that used to `host.navigate` to another route: the same command, now opening the single page at the
 * section (chrome/ keeps the labels, icons and keywords).
 */
const SECTION_RUNS: Partial<Record<PaletteCommand['id'], () => void>> = {
  [PALETTE_COMMANDS.openHome]: () => openSection('home'),
  [PALETTE_COMMANDS.cleanup]: () => openSection('cleanup'),
  [PALETTE_COMMANDS.openExtras]: () => openSection('extras'),
  [PALETTE_COMMANDS.organize]: () => {
    openSection('manage')
    openDialog(DIALOG_IDS.organize, {})
  },
  [PALETTE_COMMANDS.newThemeTab]: () => {
    // the page mounts a DialogHost even with the status bar hidden
    openSection('home')
    openDialog(DIALOG_IDS.theme, {})
  }
}

/** The chip ("▶ N new") brings the page to the front itself; this makes it land on Subscriptions. */
function SectionChip() {
  return (
    <span style={{ display: 'contents' }} onClickCapture={() => showSection('home')}>
      <StatusChip />
    </span>
  )
}

/** Icon of the single sidebar entry (the former Home icon). */
const NAV_CODICON = 'play-circle'

function withShell(Component: ComponentType) {
  return () => (
    <>
      <ShellHost />
      <Component />
    </>
  )
}

/** Labelled contributions: redone when the app language changes. */
function labelledContributions(): PluginContribution[] {
  // the single page: its center tab is titled with the plugin's name (the sections are inside)
  const route: PluginContribution = {
    id: 'route-home',
    area: ROUTES_AREA,
    title: tNow('common', 'plugin_name'),
    order: 0,
    data: { path: DESKTOP_ROUTES.home },
    render: withShell(SinglePage)
  }
  // one sidebar entry, "HermesTube", that opens the single page
  const nav: PluginContribution = {
    id: 'nav-home',
    area: SIDEBAR_NAV_AREA,
    order: 0,
    data: { path: DESKTOP_ROUTES.home, label: tNow('common', 'plugin_name'), codicon: NAV_CODICON }
  }
  const palette = paletteCommands().map<PluginContribution>((c, i) => ({
    id: c.id,
    area: PALETTE_AREA,
    order: i,
    data: paletteContribution(SECTION_RUNS[c.id] ? { ...c, run: SECTION_RUNS[c.id] as () => void } : c)
  }))
  // the fixed way into the Welcome dialog (connect a browser, paste a channel, demo), on the single page
  palette.push({ id: CONNECT_COMMAND, area: PALETTE_AREA, order: palette.length, data: connectCommand(() => openSection('home')) })
  const showPane = showPaneCommand()
  if (showPane) palette.push({ ...showPane, order: palette.length })
  return [route, nav, ...palette]
}

/** Contributions registered once (the pane is not re-registered, so the layout adoption does not reopen). */
function fixedContributions(ctx: PluginContext): PluginContribution[] {
  return [
    // tab next to Files/Review; the first load after this version re-docks users who already had the pane
    subscriptionsPane(withShell(SubscriptionsPane), { enforceDock: takeDockMigration(ctx) }),
    {
      id: STATUS_CHIP_ID,
      area: STATUSBAR_AREAS.right,
      order: 130,
      render: withShell(SectionChip)
    },
    {
      id: 'chat-video-card',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: CHAT_DIRECTIVE,
        render: (props: TranscriptDirectiveProps) => <ChatVideoCard {...props} />
      }
    }
  ]
}

export function registerShell(ctx: PluginContext): void {
  // the plugin's own stylesheet, one per document; removed on unload
  ctx.onDispose(mountStyles())
  setPluginContext(ctx)
  registerLocales(ctx)
  bindWindowVisibility(ctx)
  const disposeDialogs = registerDialogs(DIALOGS)
  configureShell({ mascotLines })
  // the Watch screen is registered (a section of the single page, opened on a video click); nothing opens here
  ctx.onDispose(setWatchRenderer(() => <WatchPage />))

  ctx.registerMany(fixedContributions(ctx))
  let disposeLabelled = ctx.registerMany(labelledContributions())
  ctx.i18n?.onLocaleChange?.(() => {
    disposeLabelled()
    disposeLabelled = ctx.registerMany(labelledContributions())
  })

  ctx.onDispose(() => {
    disposeDialogs()
    resetShellState()
  })
}

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: 'Organize your YouTube subscriptions with Hermes: folders, tabs, cleanup and topic tabs.',
  register: registerShell
}

export default plugin
