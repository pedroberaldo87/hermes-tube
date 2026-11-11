// Status chip "▶ N new" (STATUSBAR_AREAS.right, id STATUS_CHIP_ID) and ⌘K palette commands (PALETTE_COMMANDS).
// main.tsx registers both (with a <ShellHost/> next to the chip: the /status poll belongs to the leader).
//
// Chip: one state per situation, never a fake number.
//   loading    ▶ Subscriptions (no number)      new       ▶ 12 new (count in accent)
//   refreshing ▶ 12 refreshing…                 zero      ▶ Nothing new (muted, no accent)
//   error      ▶ — (hint with the reason: profile without the plugin, offline, contract error)
// Error beats stale data: if the last read failed, the chip neither repeats the old number nor shows 0.
// Mascot without a bubble (`sayToPet` → `$petFallback`): ⭐ on the chip and the line in the hint; clicking clears it.
//
// ⌘K: final order, labels (namespace `chrome`), icons and keywords (both languages);
// "Refresh now" reports the result and `detail` shows the live state (refreshing / N new).
// "HermesTube: Connect a browser or add a channel" (`connectCommand`, registered by main.tsx) opens the Welcome dialog.
// Does not import screens/dialogs; dialogs through openDialog, pages through host.navigate.
//
// PluginGate (around the page, in main.tsx): when the plugin does not answer in the active profile at all (`/status`
// AND `/extras` never reach it), the page shows the side panel's explanation — and, on a gateway of another computer,
// the connection's name and the way back — instead of each screen's generic "Something went wrong".
import { atom, host, icons, useValue } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import type { ApiError, KickResult, StatusResponse } from '../../shared/api-types'
import { DESKTOP_ROUTES, DIALOG_IDS, PALETTE_COMMANDS, PLUGIN_ID } from '../../shared/ids'
import { ErrorView, StatusBarItem, formatNumber, formatRelative, useLocale } from '../components'
import { openDialog } from '../lib/dialogs'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import { BUNDLES, LOCALES, type Translate, errorText, tNow, useT } from '../lib/i18n'
import { $petFallback, clearPetFallback } from '../lib/pet'
import { TubeApiError, invalidateRest, restCall, toApiError, useRest } from '../lib/rest'
import { $status, pluginMissing, useGatewayPlace, useStatus } from '../lib/status'
import { cx } from '../lib/style'

// ------------------------------------------------------------------ chip state (pure)

/** Why the read failed: plugin missing in this profile (404/disabled), offline, or contract error. */
export type FailureKind = 'unavailable' | 'offline' | 'error'

const NOT_HERE = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i

export function failureKind(error: unknown): FailureKind {
  if (error instanceof TubeApiError) {
    if (error.code === 'plugin_disabled') return 'unavailable'
    if (error.transport) return NOT_HERE.test(error.message) ? 'unavailable' : 'offline'
    return 'error'
  }
  const api = toApiError(error)
  if (api.code === 'plugin_disabled') return 'unavailable'
  if (api.code !== 'internal') return 'error'
  return NOT_HERE.test(api.message) ? 'unavailable' : 'offline'
}

export type ChipState =
  | { kind: 'loading' }
  | { kind: 'error'; reason: FailureKind; error: ApiError }
  | { kind: 'refreshing'; count: number; lastRssAt: number | null }
  | { kind: 'new'; count: number; lastRssAt: number | null }
  | { kind: 'zero'; lastRssAt: number | null }

export function chipState(q: { data: StatusResponse | undefined | null; error: unknown }): ChipState {
  if (q.error) return { kind: 'error', reason: failureKind(q.error), error: toApiError(q.error) }
  const s = q.data
  if (!s) return { kind: 'loading' }
  const count = Math.max(0, s.new_total | 0)
  if (s.refresh_running) return { kind: 'refreshing', count, lastRssAt: s.last_rss_at }
  return count > 0 ? { kind: 'new', count, lastRssAt: s.last_rss_at } : { kind: 'zero', lastRssAt: s.last_rss_at }
}

function plural(locale: string, n: number): 'one' | 'other' {
  try {
    return new Intl.PluralRules(locale).select(n) === 'one' ? 'one' : 'other'
  } catch {
    return n === 1 ? 'one' : 'other'
  }
}

// ------------------------------------------------------------------ chip

/** Chip rendering for a state (StatusChip wires it to the data; the preview uses it directly). */
/** Fallback atom for an older Desktop without `host.state.profile`. */
const NO_PROFILE_ATOM = atom('default')

export function ChipView({ state, petText, onClick }: { state: ChipState; petText?: string | null; onClick?: () => void }) {
  const t = useT('chrome')
  const tc = useT()
  const locale = useLocale()
  const profile = useValue(host.state?.profile ?? NO_PROFILE_ATOM) || 'default'
  const now = Date.now()
  const updated = (ts: number | null) => (ts ? t('chip.updated', { when: formatRelative(ts, now, locale) }) : '')
  const withPet = (title: string) => [title, petText ? t('chip.pet', { text: petText }) : ''].filter(Boolean).join('\n')

  let label: ReactNode
  let count: number | null = null
  let note: string | null = null
  let title: string
  let reason: FailureKind | undefined

  switch (state.kind) {
    case 'loading':
      label = t('chip.loading')
      title = t('chip.title_loading')
      break
    case 'error': {
      reason = state.reason
      const why =
        state.reason === 'unavailable'
          ? t('chip.reason_unavailable', { profile })
          : state.reason === 'offline'
            ? t('chip.reason_offline')
            : t('chip.reason_error', { error: errorText(tc, state.error) })
      // "▶ —": the dash is punctuation; the reason goes in the hint and to the screen reader
      label = (
        <>
          <span aria-hidden="true">—</span>
          <span className={cx('sr')}>{t('chip.unavailable_label')}</span>
        </>
      )
      title = why
      break
    }
    case 'refreshing':
      count = state.count || null
      note = t('chip.refreshing')
      label = state.count ? t(`chip.new_${plural(locale, state.count)}`) : ''
      title = [t('chip.title_refreshing'), updated(state.lastRssAt)].filter(Boolean).join(' · ')
      break
    case 'new':
      count = state.count
      label = t(`chip.new_${plural(locale, state.count)}`)
      title = [t('chip.title_new', { count: formatNumber(state.count, locale) }), updated(state.lastRssAt)].filter(Boolean).join(' · ')
      break
    case 'zero':
      label = t('chip.none')
      title = [t('chip.title_none'), updated(state.lastRssAt)].filter(Boolean).join(' · ')
      break
  }

  return (
    // wrapper without a box (display: contents) only to expose the state to the test and the preview
    <span data-status-chip data-state={state.kind} data-reason={reason} style={{ display: 'contents' }}>
      <StatusBarItem icon={petText ? 'star-full' : 'play'} count={count} label={label} note={note} title={withPet(title)} onClick={onClick} />
    </span>
  )
}

export function StatusChip() {
  const q = useStatus()
  const fallback = useValue($petFallback)
  const fresh = fallback && (!fallback.ttlMs || Date.now() - fallback.at < fallback.ttlMs) ? fallback : null
  const state = chipState({ data: q.data as StatusResponse | undefined, error: q.error })
  return (
    <ChipView
      state={state}
      petText={fresh?.text ?? null}
      onClick={() => {
        if (fallback) clearPetFallback()
        host.navigate(DESKTOP_ROUTES.home)
      }}
    />
  )
}

// ------------------------------------------------------------------ page gate

/**
 * The page, or — when the plugin is not there in the active profile — the side panel's explanation. One failing
 * route (an older backend) is not "the plugin is off": both `/status` and `/extras` must miss the plugin.
 */
export function PluginGate({ children }: { children: ReactNode }) {
  const t = useT('chrome')
  const status = useStatus()
  const extras = useRest('GET /extras', {})
  const place = useGatewayPlace()
  const profile = useValue(host.state?.profile ?? NO_PROFILE_ATOM) || 'default'
  const missing = !status.data && !extras.data && pluginMissing(status.error) && pluginMissing(extras.error)
  if (!missing) return <>{children}</>
  const hint =
    place.remote && place.name
      ? t('gate.remote', { name: place.name, local: place.local || t('gate.local_default') })
      : t('gate.hint', { profile })
  return (
    <div data-part="plugin-gate">
      <ErrorView
        error={status.error}
        title={t('gate.title', { profile })}
        description={hint}
        onRetry={() => {
          void status.refetch()
          void extras.refetch()
        }}
      />
    </div>
  )
}

// ------------------------------------------------------------------ ⌘K

type CommandId = (typeof PALETTE_COMMANDS)[keyof typeof PALETTE_COMMANDS]
type IconComponent = (typeof icons)[keyof typeof icons]

export interface PaletteCommand {
  id: CommandId
  /** Key under `common.palette.*`. */
  labelKey: string
  /** Final label in the active language (`chrome.palette.<id>.label`). */
  label: () => string
  icon: IconComponent
  /** Words from both languages (find "inscrições" with the app in English and vice versa). */
  keywords: string[]
  run: () => void
  /** Live state after the label (⌘K re-reads on open). */
  detail?: () => string
}

type PaletteBundle = { palette: Record<string, { keywords: string }> }

function keywordsOf(id: CommandId): string[] {
  const words = LOCALES.flatMap((loc) => ((BUNDLES[loc].chrome as unknown as PaletteBundle).palette?.[id]?.keywords ?? '').split(/\s+/))
  return [...new Set(words.filter(Boolean))]
}

const tc = (key: string, vars?: Record<string, string | number>) => tNow('chrome', key, vars)

/** "refreshing…" · "12 new · updated 3 min ago" · "nothing new" — from the leader's last /status. */
export function refreshDetail(status: StatusResponse | null = $status.get()): string {
  if (!status) return ''
  if (status.refresh_running) return tc('detail.refreshing')
  const locale = tc('locale')
  const n = Math.max(0, status.new_total | 0)
  const head = n > 0 ? tc(`detail.new_${plural(locale, n)}`, { count: formatNumber(n, locale) }) : tc('detail.none')
  const when = status.last_rss_at ? tc('detail.updated', { when: formatRelative(status.last_rss_at, Date.now(), locale) }) : ''
  return [head, when].filter(Boolean).join(' · ')
}

async function refreshNow(): Promise<void> {
  try {
    const out: KickResult = await restCall('POST /refresh', { body: { force: true } })
    host.notify({ kind: out.result === 'skipped' ? 'success' : 'info', message: tc(`refresh.${out.result}`) })
  } catch (error) {
    const translate: Translate = (key, vars) => tNow('common', key, vars)
    host.notify({ kind: 'error', message: tc('refresh.failed', { error: errorText(translate, toApiError(error)) }) })
  } finally {
    void invalidateRest('GET /status')
  }
}

function command(id: CommandId, labelKey: string, icon: IconComponent, run: () => void, detail?: () => string): PaletteCommand {
  return { id, labelKey, label: () => tc(`palette.${id}.label`), icon, keywords: keywordsOf(id), run, ...(detail ? { detail } : {}) }
}

/** ⌘K commands, in final order: the frequent first (open, refresh), then create, organize, cleanup, extras. */
export function paletteCommands(): PaletteCommand[] {
  return [
    command(PALETTE_COMMANDS.openHome, 'palette.open-home', icons.MonitorPlay, () => host.navigate(DESKTOP_ROUTES.home)),
    command(PALETTE_COMMANDS.refreshNow, 'palette.refresh-now', icons.RefreshCw, () => void refreshNow(), () => refreshDetail()),
    command(PALETTE_COMMANDS.newThemeTab, 'palette.new-theme-tab', icons.Plus, () => {
      // the page ensures a DialogHost is mounted even with the status bar hidden
      host.navigate(DESKTOP_ROUTES.home)
      openDialog(DIALOG_IDS.theme, {})
    }),
    command(PALETTE_COMMANDS.organize, 'palette.organize', icons.FolderOpen, () => {
      host.navigate(DESKTOP_ROUTES.manage)
      openDialog(DIALOG_IDS.organize, {})
    }),
    command(PALETTE_COMMANDS.cleanup, 'palette.cleanup', icons.Archive, () => host.navigate(DESKTOP_ROUTES.cleanup)),
    ...(EXTRAS_PAGE_READY
      ? [command(PALETTE_COMMANDS.openExtras, 'palette.open-extras', icons.Package, () => host.navigate(DESKTOP_ROUTES.extras))]
      : [])
  ]
}

/** ⌘K id of "Connect a browser or add a channel" (registered next to the PALETTE_COMMANDS ones, like the pane's). */
export const CONNECT_COMMAND = 'connect'

/**
 * `data` of the ⌘K command that opens the Welcome dialog (connect the extension, paste a channel, demo). `open` brings
 * the page to the front first (main.tsx), so a DialogHost is mounted even with the status bar hidden.
 */
export function connectCommand(open: () => void = () => host.navigate(DESKTOP_ROUTES.home)) {
  const words = LOCALES.flatMap((loc) => ((BUNDLES[loc].chrome as unknown as PaletteBundle).palette?.[CONNECT_COMMAND]?.keywords ?? '').split(/\s+/))
  return {
    id: `${PLUGIN_ID}.${CONNECT_COMMAND}`,
    label: tc(`palette.${CONNECT_COMMAND}.label`),
    icon: icons.Plug,
    keywords: [...new Set(words.filter(Boolean))],
    run: () => {
      open()
      openDialog(DIALOG_IDS.onboarding, {})
    }
  }
}

/** `data` of the SDK's PaletteContribution for a command (so main.tsx can register the final label/icon/detail). */
export function paletteContribution(c: PaletteCommand) {
  return {
    id: `${PLUGIN_ID}.${c.id}`,
    label: c.label(),
    icon: c.icon,
    keywords: c.keywords,
    run: c.run,
    ...(c.detail ? { detail: c.detail, detailVariant: 'state' as const } : {})
  }
}
