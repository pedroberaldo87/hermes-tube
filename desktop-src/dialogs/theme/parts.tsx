// Parts of New theme tab, built only from the kit: field with examples and options, progress by
// step (StepProgress), preview (VideoCard Grid + seed channels) and the preview skeleton with the same geometry.
import { Button, Checkbox, Codicon, Input, Switch } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useLayoutEffect, useRef } from 'react'
import type { ThemeItem, ThemePreview, ThemeSeed } from '../../../shared/api-types'
import {
  ChannelAvatar,
  Grid,
  GridSkeleton,
  QuickActions,
  Section,
  Stack,
  type Step,
  StepProgress,
  SuggestionRowSkeleton,
  VideoCard,
  useFormatCount
} from '../../components'
import type { Translate } from '../../lib/i18n'
import { openVideo } from '../../lib/format'
import { cssVar, cx } from '../../lib/style'
import {
  type Detail,
  LANGUAGES,
  NAME_MAX,
  type NameProblem,
  QUERY_MAX,
  STAGES,
  type SeedChoice,
  type StepState,
  type ThemeOptions,
  feedItemOf
} from './model'

export const EXAMPLE_KEYS = ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'] as const

/** Keyboard shortcut of 👎 in the grid (the Kbd shows on the button). */
export const DOWN_KEY = 'd'

// ------------------------------------------------------------------ field

export interface FormViewProps {
  t: Translate
  draft: string
  onDraft: (value: string) => void
  options: ThemeOptions
  onOptions: (next: ThemeOptions) => void
  fieldError: 'too_short' | 'invalid' | null
  onSubmit: () => void
  inputRef: RefObject<HTMLInputElement | null>
  /** Strip at the top (e.g. "no AI model configured", before the click). */
  banner?: ReactNode
}

export function FormView({ t, draft, onDraft, options, onOptions, fieldError, onSubmit, inputRef, banner }: FormViewProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    onSubmit()
  }
  return (
    <Stack gap={5}>
      {banner}
      <Stack gap={2}>
        <label htmlFor={id} className={cx('t-head')}>
          {t('field.label')}
        </label>
        <Input
          ref={inputRef}
          id={id}
          data-part="theme-query"
          value={draft}
          placeholder={t('field.placeholder')}
          maxLength={QUERY_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={hintId}
          onChange={(e: { target: { value: string } }) => onDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <p id={hintId} className={cx('t-label')} data-part="theme-field-hint" data-tone={fieldError ? 'error' : undefined} role={fieldError ? 'alert' : undefined}>
          {fieldError ? t(`field.${fieldError}`) : t('field.hint')}
        </p>
      </Stack>
      <Stack gap={2}>
        <span className={cx('t-label')}>{t('examples.label')}</span>
        <Stack direction="row" gap={2} wrap>
          {EXAMPLE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={cx('bare chip t-label')}
              data-part="theme-example"
              onClick={() => {
                onDraft(t(`examples.${k}`))
                inputRef.current?.focus()
              }}
            >
              <Codicon name="sparkle" size={12} className={cx('chip-icon')} />
              <span className={cx('chip-label')}>{t(`examples.${k}`)}</span>
            </button>
          ))}
        </Stack>
      </Stack>
      <Stack gap={2}>
        <span className={cx('t-label')}>{t('options.label')}</span>
        <Stack direction="row" gap={4} wrap align="center">
          <Stack direction="row" gap={1} align="center" wrap>
            <span className={cx('t-label')} id={`${id}-lang`}>
              {t('options.language')}
            </span>
            <div role="group" aria-labelledby={`${id}-lang`} className={cx('stack')} data-direction="row" data-gap="1">
              {LANGUAGES.map((l) => (
                <Button
                  key={l}
                  variant={options.language === l ? 'secondary' : 'ghost'}
                  size="xs"
                  data-part="theme-lang"
                  data-value={l}
                  aria-pressed={options.language === l}
                  onClick={() => onOptions({ ...options, language: l })}
                >
                  {t(`options.lang_${l}`)}
                </Button>
              ))}
            </div>
          </Stack>
          <label className={cx('stack')} data-direction="row" data-gap="2" data-align="center">
            <Switch data-part="theme-classics" checked={options.classics} onCheckedChange={(v: boolean) => onOptions({ ...options, classics: v })} />
            <span className={cx('t-body')}>{t('options.classics')}</span>
            <span className={cx('t-label')}>· {t('options.classics_hint')}</span>
          </label>
        </Stack>
      </Stack>
    </Stack>
  )
}

// ------------------------------------------------------------------ progress

export function detailText(t: Translate, fmt: (n: number) => string, d: Detail | null): string | undefined {
  if (!d) return undefined
  if (d.text !== undefined) return d.text
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(d.vars ?? {})) vars[k] = fmt(v)
  return t(d.key, vars)
}

export function ProgressSteps({ t, states, details }: { t: Translate; states: readonly StepState[]; details: readonly (Detail | null)[] }) {
  const fmt = useFormatCount()
  const steps: Step[] = STAGES.map((stage, i) => ({ id: stage, label: t(`steps.${stage}`), status: states[i], detail: detailText(t, fmt, details[i]) }))
  return <StepProgress steps={steps} label={t('steps.label')} />
}

export function ProgressView({
  t,
  query,
  states,
  details,
  elapsed,
  banner,
  children
}: {
  t: Translate
  query: string
  states: readonly StepState[]
  details: readonly (Detail | null)[]
  /** Time since the request went out (`2:41`); `null` = not known yet. */
  elapsed?: string | null
  /** Strip at the top (e.g. "could not cancel; the job finishes on its own"). */
  banner?: ReactNode
  children?: ReactNode
}) {
  return (
    <Stack gap={5}>
      {banner}
      <Stack gap={1}>
        <Stack direction="row" gap={3} align="center" justify="between">
          <p className={cx('t-head')} data-part="theme-asked">
            {query ? `“${query}”` : t('title')}
          </p>
          {elapsed ? (
            <span className={cx('t-label')} data-part="theme-elapsed" role="timer" aria-label={t('progress.elapsed', { time: elapsed })}>
              <Codicon name="watch" size={12} /> {elapsed}
            </span>
          ) : null}
        </Stack>
        <p className={cx('section-desc t-body')} data-part="theme-lead">
          {t('progress.lead')}
        </p>
        <p className={cx('t-label')} data-part="theme-background-hint">
          {t('progress.background')}
        </p>
      </Stack>
      <ProgressSteps t={t} states={states} details={details} />
      {children ?? (
        <Section title={t('progress.coming')} description={t('progress.coming_desc')}>
          <GridSkeleton density="compact" rows={1} label={t('progress.coming')} />
        </Section>
      )}
    </Stack>
  )
}

// ------------------------------------------------------------------ preview

export interface PreviewBodyProps {
  t: Translate
  preview: ThemePreview
  /** Theme as the user wrote it (without the hints). */
  about: string
  name: string
  onName: (value: string) => void
  problem: NameProblem
  createFolder: boolean
  onCreateFolder: (value: boolean) => void
  choices: Record<string, SeedChoice>
  onChoice: (channelId: string, choice: SeedChoice) => void
  onChoiceAll: (choice: SeedChoice) => void
  inList: ReadonlySet<string>
  thumbs: Readonly<Record<string, string | null>>
  removed: readonly string[]
  onDown: (videoId: string) => void
  /** Strip at the top (partial preview, already saved, save error). */
  banner?: ReactNode
  /** No videos: the empty state (with a way forward). */
  empty?: ReactNode
  disabled?: boolean
  readOnly?: boolean
}

/**
 * The AI's reason ("why is this here") in up to 2 lines in the preview grid, instead of cut off on one.
 * The kit's `Why` is one line (`white-space: nowrap` in styles/misc.css) and has no 2-line option: until the kit gains
 * `lines={2}`, this adapter adjusts only the cards of this grid, after every
 * render (a card that comes back through "undo" too). It reserves the 2 lines on all of them, so titles stay
 * aligned on the same grid row. React does not control `style` on those nodes, so it never undoes anything.
 */
function useTwoLineWhy(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    for (const why of root.querySelectorAll<HTMLElement>('[data-part="card"] [data-part="why"]')) {
      if (why.getAttribute('data-lines') === '2') continue
      why.setAttribute('data-lines', '2')
      why.style.whiteSpace = 'normal'
      why.style.alignItems = 'flex-start'
      why.style.minHeight = `calc(2 * var(${cssVar('lh-label')}))`
      const label = why.querySelector<HTMLElement>(`.${cx('why-label')}`)
      if (label) {
        label.style.whiteSpace = 'normal'
        label.style.overflowWrap = 'anywhere'
        label.style.display = '-webkit-box'
        label.style.setProperty('-webkit-box-orient', 'vertical')
        label.style.setProperty('-webkit-line-clamp', '2')
      }
      const icon = why.querySelector<HTMLElement>(`.${cx('why-icon')}`)
      if (icon) icon.style.marginTop = '2px'
    }
  })
}

export function PreviewBody(props: PreviewBodyProps) {
  const { t, preview, about, name, onName, problem, createFolder, onCreateFolder, choices, onChoice, onChoiceAll, inList, thumbs, removed, onDown, banner, empty, disabled, readOnly } = props
  const fmt = useFormatCount()
  const nameId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  useTwoLineWhy(gridRef)
  const gone = new Set(removed)
  const sourceLabel = (s: ThemeItem['source']) => t(`preview.reason_${s}`)
  const items = preview.items
    .filter((i) => !gone.has(i.video_id))
    .map((i) => feedItemOf(i, preview, sourceLabel))
    .filter((i): i is NonNullable<typeof i> => i !== null)
  const meta = [
    t('preview.about', { query: about }),
    t(`steps.found_${items.length === 1 ? 'one' : 'other'}`, { count: fmt(items.length) }),
    t(`steps.channels_${preview.channel_count === 1 ? 'one' : 'other'}`, { count: fmt(preview.channel_count) })
  ]
  const editable = preview.seeds.filter((s) => !inList.has(s.channel_id))
  return (
    <Stack gap={5}>
      {banner}
      <Stack gap={2}>
        <label htmlFor={nameId} className={cx('t-label')}>
          {preview.theme.icon ? <span aria-hidden="true">{preview.theme.icon} </span> : null}
          {t('preview.name_label')}
        </label>
        <Input
          id={nameId}
          data-part="theme-name"
          value={name}
          disabled={disabled || readOnly}
          maxLength={NAME_MAX + 20}
          aria-invalid={problem ? true : undefined}
          onChange={(e: { target: { value: string } }) => onName(e.target.value)}
        />
        <p className={cx('t-label')} data-part="theme-name-hint" data-tone={problem ? 'error' : undefined} role={problem ? 'alert' : undefined}>
          {problem === 'empty' ? t('preview.name_empty') : problem === 'long' ? t('preview.name_long', { max: fmt(NAME_MAX) }) : meta.join(' · ')}
        </p>
      </Stack>
      {/* read-only (theme already saved): without the 👎 hint, which no longer applies */}
      <Section title={t('preview.videos')} count={items.length} description={items.length && !readOnly ? t('preview.videos_desc') : undefined}>
        {items.length ? (
          <div ref={gridRef} data-part="theme-grid">
          <Grid
            items={items}
            getKey={(it) => it.video.id}
            label={t('preview.grid_label')}
            density="compact"
            shortcuts={readOnly ? {} : { [DOWN_KEY]: 'down' }}
            onOpen={(it) => openVideo(it.video.id)}
            onAction={(action, it) => {
              if (action === 'down' && !disabled && !readOnly) onDown(it.video.id)
            }}
            renderItem={(it) => (
              <VideoCard
                item={it}
                variant="compact"
                actions={
                  readOnly ? undefined : (
                    <QuickActions actions={[{ id: 'down', label: t('preview.down'), icon: 'thumbsdown', shortcut: DOWN_KEY, onSelect: () => !disabled && onDown(it.video.id) }]} />
                  )
                }
              />
            )}
          />
          </div>
        ) : (
          empty
        )}
      </Section>
      <Section
        title={t('preview.seeds')}
        count={preview.seeds.length}
        description={preview.seeds.length ? (readOnly ? undefined : t('preview.seeds_desc')) : t('preview.seeds_empty')}
        actions={
          editable.length > 1 && !readOnly ? (
            <>
              <Button variant="ghost" size="xs" data-part="seeds-ignore-all" disabled={disabled} onClick={() => onChoiceAll('ignore')}>
                {t('preview.ignore_all')}
              </Button>
              <Button variant="ghost" size="xs" data-part="seeds-follow-all" disabled={disabled} onClick={() => onChoiceAll('follow')}>
                {t('preview.follow_all')}
              </Button>
            </>
          ) : undefined
        }
      >
        {preview.seeds.length ? (
          <div role="list" className={cx('sgroup')} data-part="theme-seeds">
            {preview.seeds.map((s) => (
              <SeedRow
                key={s.channel_id}
                t={t}
                seed={s}
                thumb={thumbs[s.channel_id] ?? null}
                choice={choices[s.channel_id] ?? null}
                inList={inList.has(s.channel_id)}
                disabled={disabled}
                readOnly={readOnly}
                onChoice={(c) => onChoice(s.channel_id, c)}
              />
            ))}
          </div>
        ) : null}
      </Section>
      {readOnly ? null : (
        <label className={cx('stack')} data-direction="row" data-gap="2" data-align="center">
          <Checkbox data-part="theme-folder" checked={createFolder} disabled={disabled} onCheckedChange={(v: boolean | 'indeterminate') => onCreateFolder(v === true)} />
          <span className={cx('t-body')}>{problem ? t('preview.folder_plain') : t('preview.folder', { name: name.trim() })}</span>
        </label>
      )}
    </Stack>
  )
}

function SeedRow({
  t,
  seed,
  thumb,
  choice,
  inList,
  disabled,
  readOnly,
  onChoice
}: {
  t: Translate
  seed: ThemeSeed
  thumb: string | null
  choice: SeedChoice | null
  inList: boolean
  disabled?: boolean
  readOnly?: boolean
  onChoice: (c: SeedChoice) => void
}) {
  const fmt = useFormatCount()
  const status = inList ? 'accepted' : choice === 'ignore' ? 'rejected' : 'pending'
  return (
    <div role="listitem" className={cx('srow')} data-part="theme-seed" data-channel={seed.channel_id} data-status={status} data-choice={choice ?? undefined}>
      <ChannelAvatar title={seed.title} thumb={thumb} size={28} />
      <div className={cx('srow-main')}>
        <div className={cx('srow-line t-body')}>
          <span className={cx('srow-subject')}>{seed.title}</span>
        </div>
        <div className={cx('srow-reason t-label')}>{t(`preview.seed_kept_${seed.kept_videos === 1 ? 'one' : 'other'}`, { count: fmt(seed.kept_videos) })}</div>
      </div>
      <div className={cx('srow-actions')} role="group" aria-label={t('preview.seed_choice', { name: seed.title })}>
        {inList ? (
          <span className={cx('srow-status t-label')}>
            <Codicon name="check" size={12} />
            {t('preview.in_list')}
          </span>
        ) : readOnly ? null : (
          <>
            <Button variant={choice === 'ignore' ? 'secondary' : 'ghost'} size="xs" data-part="seed-ignore" aria-pressed={choice === 'ignore'} disabled={disabled} onClick={() => onChoice('ignore')}>
              {t('preview.ignore')}
            </Button>
            <Button variant={choice === 'follow' ? 'secondary' : 'ghost'} size="xs" data-part="seed-follow" aria-pressed={choice === 'follow'} disabled={disabled} onClick={() => onChoice('follow')}>
              <Codicon name="add" size={12} />
              {t('preview.follow')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** Loading the preview (themeId): same geometry as the final — name, compact grid, seeds. */
export function PreviewSkeleton({ t }: { t: Translate }) {
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <span className={cx('t-label')}>{t('preview.name_label')}</span>
        {/* the field itself, disabled and empty: the same box as the final */}
        <Input data-part="theme-name-skeleton" value="" disabled readOnly aria-busy="true" aria-label={t('preview.name_label')} />
        <p className={cx('t-label')} aria-hidden="true">
          {'\u00a0'}
        </p>
      </Stack>
      <Section title={t('preview.videos')} description={t('preview.videos_desc')}>
        <GridSkeleton density="compact" rows={2} label={t('preview.grid_label')} />
      </Section>
      <Section title={t('preview.seeds')} description={t('preview.seeds_desc')}>
        <div className={cx('sgroup')}>
          <SuggestionRowSkeleton />
          <SuggestionRowSkeleton />
        </div>
      </Section>
    </Stack>
  )
}
