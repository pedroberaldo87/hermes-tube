// Tab-editor views (collapsible group, folder tree with checkboxes, tags, channel search (with the list of
// chosen ones), filter rows, number field, the live preview and the footer confirmation strips.
// Kit (components/), lib/ and SDK only; all text arrives through `t` (namespace `tab-editor`).
import { Button, Codicon, Input, Switch } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, FeedMode, Folder, Tag } from '../../../shared/api-types'
import { ChannelAvatar, EmptyView, ErrorView, Grid, GridSkeleton, Tree, TreeItem, VideoCard, useFormatCount } from '../../components'
import type { Translate } from '../../lib/i18n'
import { cx } from '../../lib/style'
import type { LivePreview } from './live'
import { type Draft, type FilterId, LONG_MIN_S, MODES, PREVIEW_LIMIT, SHORT_MAX_S, childrenOf, coveredBy, searchChannels } from './model'

// ------------------------------------------------------------------ utilities

export function plural(t: Translate, base: string, count: number, fmt: (n: number) => string, vars: Record<string, string | number> = {}): string {
  return t(`${base}_${count === 1 ? 'one' : 'other'}`, { ...vars, count: fmt(count) })
}

const minutes = (s: number) => Math.round(s / 60)

/** Arrows move focus between `selector` inside `root` (→/↓ next, ←/↑ previous, Home/End). */
export function moveFocus(e: KeyboardEvent<HTMLElement>, selector: string, horizontal = true): boolean {
  const root = e.currentTarget
  const items = [...root.querySelectorAll<HTMLElement>(selector)]
  const i = items.indexOf(e.target as HTMLElement)
  if (i < 0) return false
  const next = (e.key === 'ArrowDown' || (horizontal && e.key === 'ArrowRight')) ? items[i + 1]
    : (e.key === 'ArrowUp' || (horizontal && e.key === 'ArrowLeft')) ? items[i - 1]
      : e.key === 'Home' ? items[0]
        : e.key === 'End' ? items[items.length - 1]
          : undefined
  const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', ...(horizontal ? ['ArrowLeft', 'ArrowRight'] : [])].includes(e.key)
  if (!handled) return false
  e.preventDefault()
  next?.focus()
  return true
}

/** Esc in a field: only leaves the field (the dialog stays). */
function blurOnEscape(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Escape') e.currentTarget.blur()
}

// ------------------------------------------------------------------ collapsible group

export function Group({
  id,
  title,
  summary,
  open,
  onToggle,
  children
}: {
  id: string
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const bodyId = `te-group-${id}`
  return (
    <div className={cx('te-group')} data-part="te-group" data-group={id}>
      <button type="button" className={cx('bare te-group-toggle')} data-part="te-group-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Codicon name="chevron-right" size={12} className={cx('te-caret')} />
        <span className={cx('te-group-title t-head')}>{title}</span>
        {summary ? <span className={cx('te-group-sum t-label')}>{summary}</span> : null}
      </button>
      {open ? (
        <div id={bodyId} className={cx('te-group-body')} data-part="te-group-body">
          {children}
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ folders

export function FolderTree({ t, folders, selected, onToggle }: { t: Translate; folders: readonly Folder[]; selected: readonly string[]; onToggle: (id: string) => void }) {
  const kids = useMemo(() => childrenOf(folders), [folders])
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  if (!folders.length) return <p className={cx('te-note t-label')}>{t('sources.folders_empty')}</p>
  const level = (parent: string | null, depth: number): ReactNode[] =>
    (kids.get(parent) ?? []).map((f) => {
      const cover = selected.includes(f.id) ? null : coveredBy(selected, f.id, folders)
      const state = selected.includes(f.id) ? 'checked' : cover ? 'covered' : 'unchecked'
      const hasKids = (kids.get(f.id) ?? []).length > 0
      const open = hasKids && !collapsed.has(f.id)
      return (
        <TreeItem
          key={f.id}
          id={f.id}
          level={depth}
          selected={state !== 'unchecked'}
          onSelect={() => onToggle(f.id)}
          expanded={hasKids ? open : undefined}
          onToggle={
            hasKids
              ? () =>
                  setCollapsed((c) => {
                    const n = new Set(c)
                    if (n.has(f.id)) n.delete(f.id)
                    else n.add(f.id)
                    return n
                  })
              : undefined
          }
          label={
            <span className={cx('te-folder')} data-state={state} title={cover ? t('sources.covered', { name: byId.get(cover)?.name ?? '' }) : undefined}>
              <span className={cx('te-check')} data-part="te-check" data-state={state} aria-hidden="true">
                {state !== 'unchecked' ? <Codicon name="check" size={10} /> : null}
              </span>
              <span className={cx('te-folder-name')}>{f.name}</span>
            </span>
          }
        >
          {hasKids ? level(f.id, depth + 1) : null}
        </TreeItem>
      )
    })
  return (
    <div className={cx('te-tree')}>
      <Tree label={t('sources.folders')}>{level(null, 1)}</Tree>
    </div>
  )
}

// ------------------------------------------------------------------ tags

export function TagList({ t, tags, selected, onToggle, disabled }: { t: Translate; tags: readonly Tag[]; selected: readonly string[]; onToggle: (id: string) => void; disabled?: boolean }) {
  if (!tags.length) return <p className={cx('te-note t-label')}>{t('sources.tags_empty')}</p>
  return (
    <div className={cx('te-tags')} role="group" aria-label={t('sources.tags')} onKeyDown={(e) => moveFocus(e, '[data-part="te-tag"]')}>
      {tags.map((tag) => {
        const on = selected.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            className={cx('bare chip t-label te-tag')}
            data-part="te-tag"
            data-id={tag.id}
            data-active={on ? 'true' : undefined}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(tag.id)}
          >
            <span className={cx('chip-hash')} aria-hidden="true">
              #
            </span>
            <span className={cx('chip-label')}>{tag.name}</span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ channels (search + chosen)

export interface PickerProps {
  t: Translate
  which: 'include' | 'exclude'
  label: string
  placeholder: string
  chosenLabel: string
  /** Candidates (what the search shows). */
  pool: readonly Channel[]
  chosen: readonly string[]
  resolve: (id: string) => Channel | undefined
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
  disabled?: boolean
}

export function ChannelPicker({ t, which, label, placeholder, chosenLabel, pool, chosen, resolve, onAdd, onRemove, inputRef, disabled }: PickerProps) {
  const [query, setQuery] = useState('')
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const listRef = useRef<HTMLUListElement>(null)
  const skip = useMemo(() => new Set(chosen), [chosen])
  const options = useMemo(() => searchChannels(pool, query, skip, query.trim() ? 8 : 5), [pool, query, skip])

  const optionEls = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-part="te-picker-option"]') ?? [])]

  const add = (id: string, index: number) => {
    onAdd(id)
    // focus stays in the list (the next one at the same position) or goes back to the search
    queueMicrotask(() => {
      const els = optionEls()
      ;(els[Math.min(index, els.length - 1)] ?? ref.current)?.focus()
    })
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      const first = optionEls()[0]
      if (first) {
        e.preventDefault()
        first.focus()
      }
    } else if (e.key === 'Escape') {
      if (query) setQuery('')
      else e.currentTarget.blur()
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && options.length === 1) {
      e.preventDefault()
      add(options[0].id, 0)
    }
  }

  const onOptionKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const els = optionEls()
    const i = els.indexOf(e.target as HTMLElement)
    if (i < 0) return
    if (e.key === 'ArrowUp' && i === 0) {
      e.preventDefault()
      ref.current?.focus()
      return
    }
    if ((e.key === 'Enter' || e.key === ' ') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const id = els[i].getAttribute('data-id')
      if (id) add(id, i)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      ref.current?.focus()
      return
    }
    moveFocus(e, '[data-part="te-picker-option"]', false)
  }

  const onChosenKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const id = (e.target as HTMLElement).closest('[data-part="te-picker-chosen"]')?.getAttribute('data-id')
      if (id) {
        e.preventDefault()
        onRemove(id)
        queueMicrotask(() => ref.current?.focus())
      }
      return
    }
    moveFocus(e, '[data-part="te-picker-remove"]', false)
  }

  return (
    <div className={cx('te-picker')} data-part="te-picker" data-picker={which}>
      <div className={cx('te-search')}>
        <Codicon name="search" size={13} className={cx('te-search-icon')} />
        <Input
          ref={ref}
          type="search"
          className={cx('te-search-input')}
          data-part="te-picker-search"
          value={query}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      {options.length ? (
        <>
          <p className={cx('te-list-label t-label')}>{query.trim() ? t('channels.results') : t('channels.suggestions')}</p>
          <ul ref={listRef} className={cx('te-options')} role="listbox" aria-label={label} onKeyDown={onOptionKey}>
            {options.map((c, i) => (
              <li key={c.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
                  className={cx('bare te-option')}
                  data-part="te-picker-option"
                  data-id={c.id}
                  aria-label={t(which === 'include' ? 'channels.add' : 'channels.leave_out', { name: c.title })}
                  disabled={disabled}
                  onClick={() => add(c.id, i)}
                >
                  <ChannelAvatar title={c.title} thumb={c.thumb} size={24} />
                  <span className={cx('te-option-text')}>
                    <span className={cx('te-option-title t-body')}>{c.title}</span>
                    {c.handle ? <span className={cx('te-option-sub t-label')}>{c.handle}</span> : null}
                  </span>
                  <Codicon name={which === 'include' ? 'add' : 'circle-slash'} size={14} className={cx('te-option-add')} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : query.trim() ? (
        <p className={cx('te-note t-label')} data-part="te-picker-none">
          {t('channels.no_match', { query: query.trim() })}
        </p>
      ) : null}
      {chosen.length ? (
        <>
          <p className={cx('te-list-label t-label')}>{chosenLabel}</p>
          <ul className={cx('te-chosen')} aria-label={chosenLabel} onKeyDown={onChosenKey}>
            {chosen.map((id) => {
              const c = resolve(id)
              const title = c?.title ?? id
              return (
                <li key={id} className={cx('te-chosen-row')} data-part="te-picker-chosen" data-id={id}>
                  <ChannelAvatar title={title} thumb={c?.thumb} size={22} />
                  <span className={cx('te-option-text')}>
                    <span className={cx('te-option-title t-body')}>{title}</span>
                  </span>
                  <button
                    type="button"
                    className={cx('bare te-remove')}
                    data-part="te-picker-remove"
                    aria-label={t('channels.remove', { name: title })}
                    title={t('channels.remove', { name: title })}
                    disabled={disabled}
                    onClick={() => onRemove(id)}
                  >
                    <Codicon name="close" size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ numbers

export function NumberField({
  value,
  onValue,
  part,
  label,
  placeholder,
  disabled,
  min = 0
}: {
  value: number | null
  onValue: (n: number | null) => void
  part: string
  label: string
  placeholder?: string
  disabled?: boolean
  min?: number
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    const parsed = text === '' ? null : Number(text)
    if (parsed !== value) setText(value == null ? '' : String(value))
    // only when the value changes from outside (shortcut, chip, preset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <Input
      type="text"
      inputMode="numeric"
      className={cx('te-num')}
      data-part={part}
      value={text}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e: { target: { value: string } }) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 4)
        setText(v)
        if (v === '') onValue(null)
        else if (Number(v) >= min) onValue(Number(v))
      }}
      onKeyDown={blurOnEscape}
    />
  )
}

// ------------------------------------------------------------------ filters

export function FilterRows({ t, draft, onChange, disabled }: { t: Translate; draft: Draft; onChange: (patch: Partial<Draft>) => void; disabled?: boolean }) {
  const shortOn = draft.minS == null && draft.maxS === SHORT_MAX_S
  const longOn = draft.minS === LONG_MIN_S && draft.maxS == null
  return (
    <div className={cx('te-rows')}>
      <label className={cx('te-row')}>
        <span className={cx('te-row-text')}>
          <span className={cx('t-body')}>{t('filters.no_shorts')}</span>
        </span>
        <Switch data-part="te-no-shorts" checked={draft.noShorts} disabled={disabled} aria-label={t('filters.no_shorts')} onCheckedChange={(v: boolean) => onChange({ noShorts: v })} />
      </label>
      <label className={cx('te-row')}>
        <span className={cx('te-row-text')}>
          <span className={cx('t-body')}>{t('filters.only_new')}</span>
          <span className={cx('te-row-desc t-label')}>{t('filters.only_new_desc')}</span>
        </span>
        <Switch data-part="te-only-new" checked={draft.onlyNew} disabled={disabled} aria-label={t('filters.only_new')} onCheckedChange={(v: boolean) => onChange({ onlyNew: v })} />
      </label>
      <div className={cx('te-row')}>
        <span className={cx('te-row-text')}>
          <span className={cx('t-body')}>{t('filters.per_channel')}</span>
          <span className={cx('te-row-desc t-label')}>{t('filters.per_channel_desc')}</span>
        </span>
        <NumberField
          part="te-per-channel-value"
          value={draft.perChannel}
          min={1}
          label={t('filters.per_channel_value')}
          placeholder="3"
          disabled={disabled || draft.perChannel == null}
          onValue={(n) => n != null && onChange({ perChannel: n })}
        />
        <Switch
          data-part="te-per-channel"
          checked={draft.perChannel != null}
          disabled={disabled}
          aria-label={t('filters.per_channel')}
          onCheckedChange={(v: boolean) => onChange({ perChannel: v ? 3 : null })}
        />
      </div>
      <div className={cx('te-row')}>
        <span className={cx('te-row-text')}>
          <span className={cx('t-body')}>{t('filters.duration')}</span>
          <span className={cx('te-row-desc t-label')}>{t('filters.duration_desc')}</span>
        </span>
        <div className={cx('te-duration')}>
          <NumberField part="te-min" value={draft.minS == null ? null : minutes(draft.minS)} label={t('filters.min')} placeholder={t('filters.min_short')} disabled={disabled} onValue={(n) => onChange({ minS: n == null ? null : n * 60 })} />
          <span className={cx('te-dash')} aria-hidden="true">
            –
          </span>
          <NumberField part="te-max" value={draft.maxS == null ? null : minutes(draft.maxS)} label={t('filters.max')} placeholder={t('filters.max_short')} disabled={disabled} onValue={(n) => onChange({ maxS: n == null ? null : n * 60 })} />
        </div>
        <div className={cx('te-duration')} role="group" aria-label={t('filters.shortcuts')}>
          <button type="button" className={cx('bare chip t-label')} data-part="te-short" data-active={shortOn ? 'true' : undefined} aria-pressed={shortOn} disabled={disabled} onClick={() => onChange(shortOn ? { minS: null, maxS: null } : { minS: null, maxS: SHORT_MAX_S })}>
            {t('filters.short')}
          </button>
          <button type="button" className={cx('bare chip t-label')} data-part="te-long" data-active={longOn ? 'true' : undefined} aria-pressed={longOn} disabled={disabled} onClick={() => onChange(longOn ? { minS: null, maxS: null } : { minS: LONG_MIN_S, maxS: null })}>
            {t('filters.long')}
          </button>
        </div>
      </div>
      <div className={cx('te-row')}>
        <span className={cx('te-row-text')}>
          <span className={cx('t-body')}>{t('filters.mode')}</span>
        </span>
        <div className={cx('te-modes')} role="group" aria-label={t('filters.mode')} onKeyDown={(e) => moveFocus(e, '[data-part="te-mode"]')}>
          {MODES.map((m: FeedMode) => (
            <button
              key={m}
              type="button"
              className={cx('bare te-mode')}
              data-part="te-mode"
              data-mode={m}
              aria-pressed={draft.mode === m}
              disabled={disabled}
              onClick={() => onChange({ mode: m })}
            >
              <span className={cx('t-body')}>{t(`filters.mode_${m}`)}</span>
              <span className={cx('te-mode-desc t-label')}>{t(`filters.mode_${m}_desc`)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ chips for active filters

export function chipLabel(t: Translate, id: FilterId, d: Draft, fmt: (n: number) => string, nameOf: (id: string) => string): string {
  switch (id) {
    case 'exclude':
      return d.excludeChannels.length === 1 ? t('chips.exclude_one', { name: nameOf(d.excludeChannels[0]) }) : t('chips.exclude_other', { count: fmt(d.excludeChannels.length) })
    case 'shorts':
      return t('chips.no_shorts')
    case 'only_new':
      return t('chips.only_new')
    case 'per_channel':
      return t('chips.per_channel', { count: fmt(d.perChannel ?? 0) })
    case 'duration':
      if (d.minS != null && d.maxS != null) return t('chips.range', { min: fmt(minutes(d.minS)), max: fmt(minutes(d.maxS)) })
      if (d.minS != null) return t('chips.min', { min: fmt(minutes(d.minS)) })
      return t('chips.max', { max: fmt(minutes(d.maxS ?? 0)) })
    case 'mode':
      return t(`chips.mode_${d.mode}`)
  }
}

export function FilterChips({ t, chips, onRemove }: { t: Translate; chips: readonly { id: FilterId; label: string }[]; onRemove: (id: FilterId) => void }) {
  if (!chips.length) return null
  return (
    <div className={cx('te-chips')} data-part="te-chips" role="group" aria-label={t('chips.label')}>
      {chips.map((c) => (
        <span key={c.id} className={cx('chip t-label')} data-part="te-chip" data-filter={c.id} data-active="true">
          <span className={cx('chip-label')}>{c.label}</span>
          <button
            type="button"
            className={cx('bare chip-remove')}
            data-part="te-chip-remove"
            aria-label={t('chips.remove', { label: c.label })}
            title={t('chips.remove', { label: c.label })}
            onClick={() => onRemove(c.id)}
          >
            <Codicon name="close" size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ preview

export type PreviewState = 'need' | 'invalid' | 'loading' | 'ready' | 'empty' | 'error'

export function PreviewPane({
  t,
  live,
  state,
  channels,
  chips,
  onRemoveChip,
  suggestion,
  onClearSuggestion,
  onPickSources
}: {
  t: Translate
  live: LivePreview
  state: PreviewState
  /** Covered channels (null = cannot be counted yet). */
  channels: number | null
  chips: readonly { id: FilterId; label: string }[]
  onRemoveChip: (id: FilterId) => void
  /** Empty preview: the filter we suggest removing (chip label). */
  suggestion: { id: FilterId; label: string } | null
  onClearSuggestion: () => void
  onPickSources: () => void
}) {
  const fmt = useFormatCount()
  const page = live.page
  const items = page?.items ?? []
  const videos = page?.counts.total ?? items.length
  const distinct = new Set(items.map((i) => i.video.channel_id)).size
  const showCounts = state === 'ready' || state === 'empty'
  let body: ReactNode
  if (state === 'need') {
    body = (
      <EmptyView
        compact
        icon="layers"
        title={t('preview.need_title')}
        description={t('preview.need_desc')}
        action={
          <Button variant="outline" size="sm" data-part="te-empty-action" onClick={onPickSources}>
            {t('preview.need_action')}
          </Button>
        }
      />
    )
  } else if (state === 'invalid') {
    body = <EmptyView compact icon="warning" title={t('preview.invalid_title')} description={t('filters.duration_bad')} action={<span />} />
  } else if (state === 'loading') {
    body = <GridSkeleton density="compact" count={PREVIEW_LIMIT} label={t('preview.grid_label')} />
  } else if (state === 'error') {
    body = <ErrorView compact error={live.error} title={t('preview.error_title')} onRetry={live.retry} />
  } else if (state === 'empty') {
    body = suggestion ? (
      <EmptyView
        compact
        icon="filter"
        title={t('preview.empty_title')}
        description={t('preview.empty_desc', { filter: suggestion.label })}
        action={
          <Button variant="outline" size="sm" data-part="te-empty-action" onClick={onClearSuggestion}>
            {t('preview.empty_action', { filter: suggestion.label })}
          </Button>
        }
      />
    ) : (
      <EmptyView
        compact
        icon="inbox"
        title={t('preview.empty_sources_title')}
        description={t('preview.empty_sources_desc')}
        action={
          <Button variant="outline" size="sm" data-part="te-empty-action" onClick={onPickSources}>
            {t('preview.empty_sources_action')}
          </Button>
        }
      />
    )
  } else {
    body = (
      <Grid
        items={items}
        getKey={(it) => it.video.id}
        label={t('preview.grid_label')}
        density="compact"
        shortcuts={{}}
        renderItem={(it) => <VideoCard item={it} variant="compact" />}
      />
    )
  }
  return (
    <section className={cx('te-preview')} data-part="te-preview" data-state={state} data-stale={live.stale && (state === 'ready' || state === 'empty') ? 'true' : undefined} aria-busy={state === 'loading' || live.stale}>
      <div className={cx('te-preview-head')}>
        <h3 className={cx('t-head')}>{t('preview.title')}</h3>
        <span className={cx('te-counts t-label')} data-part="te-counts" aria-live="polite">
          {showCounts
            ? `${plural(t, 'preview.videos', videos, fmt)} · ${plural(t, 'preview.channels', channels ?? distinct, fmt)}`
            : state === 'loading'
              ? t('preview.loading')
              : ''}
        </span>
      </div>
      <FilterChips t={t} chips={chips} onRemove={onRemoveChip} />
      <div className={cx('te-grid')} data-part="te-grid">
        {body}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ footer confirmation

export function ConfirmStrip({
  kind,
  title,
  description,
  yes,
  no,
  onYes,
  onNo,
  busy
}: {
  kind: 'discard' | 'delete'
  title: string
  description?: string
  yes: string
  no: string
  onYes: () => void
  onNo: () => void
  busy?: boolean
}) {
  const noRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    noRef.current?.focus()
  }, [])
  return (
    <div className={cx('te-confirm')} data-part="te-confirm" data-kind={kind} role="alertdialog" aria-label={title}>
      <span className={cx('te-confirm-text')}>
        <span className={cx('t-body')}>{title}</span>
        {description ? <span className={cx('te-confirm-desc t-label')}>{description}</span> : null}
      </span>
      <div className={cx('te-foot-end')}>
        <Button ref={noRef} variant="outline" size="sm" data-part="te-confirm-no" onClick={onNo}>
          {no}
        </Button>
        <Button variant="destructive" size="sm" data-part="te-confirm-yes" loading={busy} disabled={busy} onClick={onYes}>
          {yes}
        </Button>
      </div>
    </div>
  )
}
