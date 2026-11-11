// Pure rules of New theme tab: build the request (text + options as fields), read the numbers of
// each progress step (`progress.step`), step state, validate the name, build the `theme.save`
// edits and keep the running job in `ctx.storage` (resume on reopen). No React; testable on its own.
import type { FeedItem, Progress, SeedAction, ThemeCreateParams, ThemeItem, ThemePreview, ThemeSaveEdits } from '../../../shared/api-types'
import { maybePluginContext } from '../../lib/ctx'
import { THEME_PENDING_KEY, THEME_PENDING_MAX_AGE_MS, type ThemePending, type ThemeStageCounts, clearThemePending, readThemePending, writeThemePending } from '../../lib/jobs'

/** Steps of `theme.create`, in order (contract/rpc.yaml: expand, search, curate, preview). */
export const STAGES = ['expand', 'search', 'curate', 'preview'] as const
export type Stage = (typeof STAGES)[number]
export type StepState = 'waiting' | 'running' | 'done' | 'failed'

/** `ThemeCreateParams.query`: 2–200 characters. */
export const QUERY_MIN = 2
export const QUERY_MAX = 200
/** Tab name: the core refuses empty and more than 40. */
export const NAME_MAX = 40

/** Running job (resume when the dialog reopens; Home follows it in the background). */
export const PENDING_KEY = THEME_PENDING_KEY
/** Key under which Home stores the active tab and reads it on mount (mirror). */
export const HOME_TAB_KEY = 'home.tab'
/** Hermes Desktop settings route (the app's `SETTINGS_ROUTE`). */
export const SETTINGS_PATH = '/settings'
/** Previews without a tab expire in 7 days in the core; the stored one does too. */
export const PENDING_MAX_AGE_MS = THEME_PENDING_MAX_AGE_MS

// ------------------------------------------------------------------ request

export type Language = 'any' | 'pt' | 'en'
export const LANGUAGES: readonly Language[] = ['any', 'pt', 'en']

export interface ThemeOptions {
  language: Language
  classics: boolean
}

export const DEFAULT_OPTIONS: ThemeOptions = { language: 'any', classics: false }

type T = (key: string, vars?: Record<string, string | number>) => string

/** Clean text (one line, single spaces). */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * What goes into `theme.create`: the user's text, cleaned, and the options as fields — `language` only when there is a
 * restriction; `classics: true` only when requested (off = the model decides; `false` would force "never").
 * An older core ignores the fields (it read only `query`).
 */
export function createParams(text: string, options: ThemeOptions): ThemeCreateParams {
  const params: ThemeCreateParams = { query: cleanText(text).slice(0, QUERY_MAX).trimEnd() }
  if (options.language !== 'any') params.language = options.language
  if (options.classics) params.classics = true
  return params
}

/**
 * Strips from the end of the text the hints that an older version of this dialog appended to the request (themes created earlier
 * still have them in `theme.query`), to show the theme as the user wrote it.
 */
export function stripHints(query: string, t: T): string {
  let out = cleanText(query)
  const hints = [t('hints.classics'), ...LANGUAGES.filter((l) => l !== 'any').map((l) => t(`hints.lang_${l}`))]
  for (let changed = true; changed; ) {
    changed = false
    for (const h of hints)
      if (h && out.endsWith(h) && out.length > h.length) {
        out = out.slice(0, -h.length).trimEnd()
        changed = true
      }
  }
  return out
}

// ------------------------------------------------------------------ progress

/** Numbers each step produced (read from progress; never invented). */
export type StageCounts = ThemeStageCounts

const count = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined)

/**
 * Merges the numbers of a `Progress` into those already seen, by `progress.step` (`{name, done, total}` in the screen's
 * unit, contract/events.md): expand = searches planned; search = videos found; curate = evaluated out of
 * found; preview = kept out of evaluated. `total` null = not known yet. Without `step` (older core) nothing
 * changes: the message is never read as a number.
 */
export function absorbProgress(prev: StageCounts, p: Progress | null | undefined): StageCounts {
  const s = p?.step
  if (!s) return prev
  const done = count(s.done)
  const total = s.total == null ? undefined : count(s.total)
  const next: StageCounts = { ...prev }
  if (s.name === 'expand') {
    if (total !== undefined) next.searches = total
  } else if (s.name === 'search') {
    if (total !== undefined) next.found = total
  } else if (s.name === 'curate') {
    if (done !== undefined) next.rated = done
    if (total !== undefined) next.found = total
  } else if (s.name === 'preview') {
    if (done !== undefined) next.kept = done
    if (total !== undefined) next.rated = total
  }
  return next
}

export function sameCounts(a: StageCounts, b: StageCounts): boolean {
  return a.searches === b.searches && a.found === b.found && a.rated === b.rated && a.kept === b.kept
}

/** Step the job is in: the one from `step` or, without it, the usual `stage`. */
export function stageOf(p: Progress | null | undefined): string | null {
  return p?.step?.name ?? p?.stage ?? null
}

/** State of each step: before the current = done, current = running (or failed), after = waiting. */
export function stepStates(stage: string | null | undefined, phase: 'running' | 'done' | 'error'): StepState[] {
  if (phase === 'done') return STAGES.map(() => 'done')
  const at = Math.max(0, stage ? STAGES.indexOf(stage as Stage) : 0)
  return STAGES.map((_, i) => (i < at ? 'done' : i > at ? 'waiting' : phase === 'error' ? 'failed' : 'running'))
}

export interface Detail {
  key: string
  vars?: Record<string, number>
  /** Ready-made text (the older core's message, without `step`): shown as it came. */
  text?: string
}

const plural = (base: string, count: number): Detail => ({ key: `${base}_${count === 1 ? 'one' : 'other'}`, vars: { count } })

/**
 * The number each step produced (or what it is doing), as an i18n key + variables. A core without
 * `progress.step`: the running step shows only its message (never a number taken from it).
 */
export function stepDetails(states: readonly StepState[], counts: StageCounts, progress: Progress | null | undefined): (Detail | null)[] {
  const legacy = !!progress && !progress.step
  return STAGES.map((stage, i) => {
    const state = states[i]
    if (state === 'waiting') return null
    const running = state === 'running'
    if (running && legacy) return progress?.message?.trim() ? { key: '', text: progress.message.trim() } : null
    if (stage === 'expand') return counts.searches != null ? plural('steps.searches', counts.searches) : running ? { key: 'steps.expand_running' } : null
    if (stage === 'search') {
      if (counts.found != null) return plural('steps.found', counts.found)
      return running && counts.searches != null ? plural('steps.search_running', counts.searches) : null
    }
    if (stage === 'curate') {
      if (counts.rated != null && counts.found != null && running) return { key: 'steps.rated_progress', vars: { done: counts.rated, total: counts.found } }
      if (counts.rated != null) return plural('steps.rated', counts.rated)
      if (running && counts.found != null) return plural('steps.rating', counts.found)
      return null
    }
    // preview: how many remained (out of how many evaluated)
    return counts.kept != null ? plural('steps.kept', counts.kept) : null
  })
}

// ------------------------------------------------------------------ preview

export function isThemePreview(value: unknown): value is ThemePreview {
  const v = value as Partial<ThemePreview> | null
  return (
    !!v &&
    typeof v === 'object' &&
    !!v.theme &&
    typeof v.theme.id === 'string' &&
    Array.isArray(v.items) &&
    !!v.videos &&
    typeof v.videos === 'object' &&
    Array.isArray(v.seeds)
  )
}

/** Preview card: the AI's reason in the "why is this here" line. */
export function feedItemOf(item: ThemeItem, preview: ThemePreview, sourceLabel: (source: ThemeItem['source']) => string): FeedItem | null {
  const video = preview.videos[item.video_id]
  if (!video) return null
  return {
    video,
    channel: null,
    state: 'new',
    reaction: null,
    is_new: false,
    why: { via: 'theme', label: item.reason?.trim() || sourceLabel(item.source), detail: null },
    badges: []
  }
}

export type NameProblem = 'empty' | 'long' | null

export function nameProblem(name: string): NameProblem {
  const n = cleanText(name)
  if (!n) return 'empty'
  return [...n].length > NAME_MAX ? 'long' : null
}

export type SeedChoice = Extract<SeedAction, 'follow' | 'ignore'>

/** Default: follow each seed (that is what keeps the new tab); those already in the list do not come in. */
export function defaultChoices(preview: ThemePreview): Record<string, SeedChoice> {
  return Object.fromEntries(preview.seeds.map((s) => [s.channel_id, 'follow' as const]))
}

export interface EditsInput {
  preview: ThemePreview
  name: string
  createFolder: boolean
  choices: Record<string, SeedChoice>
  /** Seeds already in the list (followed or subscribed): no action. */
  inList: ReadonlySet<string>
  removed: readonly string[]
}

export function buildEdits({ preview, name, createFolder, choices, inList, removed }: EditsInput): ThemeSaveEdits {
  const clean = cleanText(name)
  const seedActions: Record<string, SeedAction> = {}
  for (const s of preview.seeds) {
    const choice = choices[s.channel_id]
    if (choice && !inList.has(s.channel_id)) seedActions[s.channel_id] = choice
  }
  const kept = new Set(preview.items.map((i) => i.video_id))
  const edits: ThemeSaveEdits = { name: clean }
  if (preview.theme.icon) edits.icon = preview.theme.icon
  edits.create_folder = createFolder
  if (createFolder) edits.folder_name = clean
  edits.seed_actions = seedActions
  edits.removed_video_ids = removed.filter((id) => kept.has(id))
  return edits
}

// ------------------------------------------------------------------ stored (resume)

/** The running job, kept in `ctx.storage` (lib/jobs: Home follows it in the background too). */
export type Pending = ThemePending

export const readPending = readThemePending
export const writePending = writeThemePending
export const clearPending = clearThemePending

function storage() {
  try {
    return maybePluginContext()?.storage ?? null
  } catch {
    return null
  }
}

/** Asks Home for the active tab (read when Home mounts). */
export function rememberHomeTab(tabId: string): void {
  try {
    storage()?.set(HOME_TAB_KEY, tabId)
  } catch {
    // same
  }
}
