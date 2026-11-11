// Tab editor (dialog `tab-editor`, opened by openDialog('tab-editor', props) from any screen; registered in
// main.tsx/DIALOGS). `tabId` edits (`PATCH /tabs/{id}`); without it, creates (`POST /tabs`), with an optional `preset`.
// A single form (the engine always evaluates the same rule): `preset.kind` only decides what starts open
// (category → folders/tags; channels → channel search; mixed → everything).
//   left    name (suggested from the choices until the person types) + icon · what goes in (folder tree with checkboxes,
//           tags, channels) · what stays out and filters (exclude channels, no Shorts, unwatched only, N per channel, duration, mode)
//   right   live preview (`POST /feed/preview`, ~300 ms wait, stale response discarded), "N videos · M channels",
//           chips for the active filters, Home cards (compact density) and the empty state explained
//   footer  validation in words, "unsaved changes", server error, delete with confirmation, save (⌘↩)
// On create, the new tab becomes Home's active one (same path as the pane: `home.tab` in ctx.storage, re-read by Home).
// Built-in tab: filters only. Rules: only lib/, components/ and shared/; all text through useT('tab-editor').
import { Button, Codicon, Input, host } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ApiError, Channel, RestRouteKey, Tab } from '../../../shared/api-types'
import { DESKTOP_ROUTES, type DialogProps } from '../../../shared/ids'
import { DialogFrame, EmptyView, GridSkeleton, TreeItemSkeleton, useFormatCount } from '../../components'
import type { DialogControls } from '../../lib/dialogs'
import { errorText, useT } from '../../lib/i18n'
import { openSection } from '../../lib/nav'
import { invalidateRest, restCall, toApiError, useRest } from '../../lib/rest'
import { cx } from '../../lib/style'
import { useLivePreview } from './live'
import {
  type Draft,
  type FilterId,
  ICON_MAX,
  NAME_MAX,
  PREVIEW_LIMIT,
  type SourceGroup,
  buildCreate,
  buildPatch,
  changeIdOf,
  clearFilter,
  coveredChannels,
  draftFromPreset,
  draftFromTab,
  durationProblem,
  emptySuggestion,
  filterChips,
  hasSource,
  isActive,
  nameProblem,
  openGroups,
  rememberHomeTab,
  rulesKey,
  rulesOf,
  suggestName,
  toggleFolder
} from './model'
import { ChannelPicker, ConfirmStrip, FilterRows, FolderTree, Group, PreviewPane, type PreviewState, TagList, chipLabel, plural } from './parts'
import { ensureTabEditorStyles } from './styles'

export { HOME_TAB_KEY } from './model'

/** Routes that change when a tab is created/edited/deleted. */
const CHANGED: RestRouteKey[] = ['GET /tabs', 'GET /status', 'GET /feed']

/** Fixed state for the scenario preview and tests. */
export interface TabEditorSeed {
  draft?: Partial<Draft>
  saveError?: ApiError
  confirm?: 'discard' | 'delete'
}

export type TabEditorDialogProps = DialogProps['tab-editor'] &
  DialogControls & {
    /** Preview/tests only: opens in a fixed state. */
    initial?: TabEditorSeed
  }

const withSeed = (d: Draft, seed?: Partial<Draft>): Draft => (seed ? { ...d, ...seed, keep: { ...d.keep, ...seed.keep } } : d)

const FIRST_SOURCE = '[role="treeitem"][tabindex="0"], [data-part="te-tag"], [data-part="te-picker-search"]'

export function TabEditorDialog({ tabId, preset, onClose, initial }: TabEditorDialogProps) {
  const t = useT('tab-editor')
  const tc = useT()
  const fmt = useFormatCount()
  useLayoutEffect(() => ensureTabEditorStyles(), [])

  const editing = !!tabId
  const tabsQ = useRest('GET /tabs', {})
  const foldersQ = useRest('GET /folders', {})
  const tagsQ = useRest('GET /tags', {})
  const channelsQ = useRest('GET /channels', { query: { limit: 2000 } })
  const tabs = tabsQ.data?.items
  const original: Tab | null = editing ? (tabs?.find((x) => x.id === tabId) ?? null) : null
  const missing = editing && !!tabs && !original
  const builtin = !!original?.builtin
  const folders = useMemo(() => foldersQ.data?.items ?? [], [foldersQ.data])
  const tags = useMemo(() => tagsQ.data?.items ?? [], [tagsQ.data])

  // ---------------------------------------------------------------- draft
  const [draft, setDraft] = useState<Draft | null>(() => (editing ? null : withSeed(draftFromPreset(preset), initial?.draft)))
  const baseline = useRef<Draft | null>(editing ? null : draftFromPreset(preset))
  const [open, setOpen] = useState<ReadonlySet<SourceGroup>>(() => new Set(editing ? [] : openGroups(preset?.kind, draft ?? draftFromPreset(preset))))
  useEffect(() => {
    if (!editing || !original || draft) return
    const d = draftFromTab(original)
    baseline.current = d
    setDraft(withSeed(d, initial?.draft))
    setOpen(new Set(openGroups(undefined, d)))
  }, [editing, original, draft, initial])

  const change = useCallback((patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), [])

  // ---------------------------------------------------------------- channels (list + the ones chosen outside it)
  const listed = useMemo(() => (channelsQ.data?.items ?? []).map((r) => r.channel), [channelsQ.data])
  const listedIds = useMemo(() => new Set(listed.map((c) => c.id)), [listed])
  const outside = draft ? [...draft.channels, ...draft.excludeChannels].filter((id) => !listedIds.has(id)) : []
  const extraQ = useRest('GET /channels', { query: { ids: outside.join(','), limit: 200 } }, { enabled: !!channelsQ.data && outside.length > 0 })
  const allChannels = useMemo(() => {
    const extra = (extraQ.data?.items ?? []).map((r) => r.channel).filter((c) => !listedIds.has(c.id))
    return [...listed, ...extra]
  }, [listed, listedIds, extraQ.data])
  const byChannel = useMemo(() => new Map(allChannels.map((c) => [c.id, c])), [allChannels])
  const activeChannels = useMemo(() => listed.filter(isActive), [listed])
  const resolve = useCallback((id: string): Channel | undefined => byChannel.get(id), [byChannel])

  // ---------------------------------------------------------------- name
  const labels = useMemo(() => {
    if (!draft) return []
    const fById = new Map(folders.map((f) => [f.id, f.name]))
    const tById = new Map(tags.map((x) => [x.id, x.name]))
    return [
      ...draft.folders.map((id) => fById.get(id)),
      ...draft.tags.map((id) => tById.get(id)),
      ...draft.channels.map((id) => byChannel.get(id)?.title)
    ].filter((x): x is string => !!x)
  }, [draft, folders, tags, byChannel])
  const suggestion = suggestName(labels) || (preset?.name ?? '').trim()
  const nameValue = draft ? (draft.nameTouched ? draft.name : suggestion || draft.name) : ''
  const nameProb = draft ? nameProblem(nameValue, tabs, tabId) : null

  // ---------------------------------------------------------------- validation and preview
  const noSource = !!draft && !hasSource(draft)
  const durBad = !!draft && durationProblem(draft)
  const rules = draft ? rulesOf(draft) : null
  const live = useLivePreview(draft && !noSource && !durBad ? rules : null)

  const effective = draft ? { ...draft, name: nameValue } : null
  const patch = original && effective ? buildPatch(original, effective) : null
  const dirty = (() => {
    if (!draft) return false
    if (editing) return !!patch && Object.keys(patch).length > 0
    const base = baseline.current ?? draftFromPreset(preset)
    return (
      rulesKey(rulesOf(draft)) !== rulesKey(rulesOf(base)) ||
      draft.icon.trim() !== '' ||
      (draft.nameTouched && draft.name.trim() !== (preset?.name ?? '').trim() && draft.name.trim() !== suggestion)
    )
  })()

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(initial?.saveError ?? null)
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(initial?.confirm ?? null)
  const canSave = !!draft && !missing && !noSource && !durBad && !nameProb && !saving && !deleting && (!editing || dirty)

  // ---------------------------------------------------------------- focus
  const rootRef = useRef<HTMLDivElement>(null)
  const sourcesRef = useRef<HTMLDivElement>(null)
  const includeSearch = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing && preset?.kind === 'channels') includeSearch.current?.focus()
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusSources = useCallback(() => {
    const rootEl = rootRef.current
    if (!rootEl) return
    if (builtin) {
      rootEl.querySelector<HTMLElement>('[data-part="te-no-shorts"]')?.focus()
      return
    }
    const box = sourcesRef.current
    const first = box?.querySelector<HTMLElement>(`[data-part="te-group-body"] :is(${FIRST_SOURCE})`)
    if (first) {
      first.focus()
      return
    }
    if (open.size === 0) setOpen(new Set<SourceGroup>(['folders']))
    box?.querySelector<HTMLElement>('[data-part="te-group-toggle"]')?.focus()
  }, [builtin, open])

  // ---------------------------------------------------------------- actions
  const undoAction = useCallback(
    (changeId: number | null, name: string) =>
      changeId == null
        ? {}
        : {
            action: {
              label: t('toast.undo'),
              onClick: () => {
                restCall('POST /changes/{id}/undo', { path: { id: changeId } }).then(
                  () => {
                    void invalidateRest(...CHANGED)
                    host.notify({ kind: 'success', message: t('toast.undone', { name }) })
                  },
                  (error: unknown) => host.notify({ kind: 'error', message: t('toast.undo_failed', { error: errorText(tc, toApiError(error)) }) })
                )
              }
            }
          },
    [t, tc]
  )

  const save = useCallback(async () => {
    if (!canSave || !draft) return
    setSaving(true)
    setSaveError(null)
    try {
      if (editing && original) {
        const body = buildPatch(original, { ...draft, name: nameValue })
        const saved = await restCall('PATCH /tabs/{id}', { path: { id: original.id }, body })
        void invalidateRest(...CHANGED)
        const name = saved?.name ?? nameValue.trim()
        host.notify({ kind: 'success', message: t('toast.saved', { name }), ...undoAction(changeIdOf(saved), name) })
        onClose()
      } else {
        const created = await restCall('POST /tabs', { body: buildCreate(draft, nameValue) })
        const name = created?.name ?? nameValue.trim()
        if (created?.id) rememberHomeTab(created.id)
        void invalidateRest(...CHANGED)
        openSection('home')
        host.notify({ kind: 'success', message: t('toast.created', { name }), ...undoAction(changeIdOf(created), name) })
        onClose()
      }
    } catch (error) {
      setSaveError(toApiError(error))
      setSaving(false)
    }
  }, [canSave, draft, editing, original, nameValue, onClose, t, undoAction])

  const remove = useCallback(async () => {
    if (!original || original.builtin) return
    setDeleting(true)
    setSaveError(null)
    try {
      const out = await restCall('DELETE /tabs/{id}', { path: { id: original.id } })
      void invalidateRest(...CHANGED)
      host.notify({ kind: 'success', message: t('toast.deleted', { name: original.name }), ...undoAction(changeIdOf(out), original.name) })
      onClose()
    } catch (error) {
      setDeleting(false)
      setConfirm(null)
      setSaveError(toApiError(error))
    }
  }, [original, onClose, t, undoAction])

  const requestClose = useCallback(() => {
    if (saving || deleting) return
    if (dirty) setConfirm('discard')
    else onClose()
  }, [saving, deleting, dirty, onClose])

  // Esc in a field (or in the channel list) belongs to the field: the dialog stays
  const onEscapeKeyDown = useCallback((e: globalThis.KeyboardEvent) => {
    const target = e.target instanceof Element ? e.target : typeof document !== 'undefined' ? document.activeElement : null
    if (target && rootRef.current?.contains(target) && target.closest('input, textarea, [role="listbox"]')) e.preventDefault()
  }, [])

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void save()
    }
  }

  // ---------------------------------------------------------------- derived texts
  const chips = draft ? filterChips(draft).map((id) => ({ id, label: chipLabel(t, id, draft, fmt, (cid) => byChannel.get(cid)?.title ?? cid) })) : []
  const suggestionId = draft ? emptySuggestion(draft) : null
  const suggestionChip = suggestionId ? (chips.find((c) => c.id === suggestionId) ?? null) : null
  const covered = draft && channelsQ.data ? coveredChannels(draft, allChannels, folders) : null

  let previewState: PreviewState
  if (!draft || noSource) previewState = 'need'
  else if (durBad) previewState = 'invalid'
  else if (live.status === 'idle') previewState = 'need'
  else if (live.status === 'loading') previewState = 'loading'
  else if (live.status === 'error') previewState = 'error'
  else previewState = live.page && live.page.items.length ? 'ready' : 'empty'

  const statusText = noSource ? t('sources.need') : durBad ? t('filters.duration_bad') : editing ? (dirty ? t('footer.unsaved') : t('footer.no_changes')) : t('footer.hint')
  const statusTone = noSource || durBad || (editing && dirty) ? 'warn' : undefined

  // ---------------------------------------------------------------- body
  const title = editing ? (original ? t('title_edit', { name: original.name }) : t('title_edit_loading')) : t('title_create')
  const description = missing ? undefined : editing ? (builtin ? t('subtitle_builtin') : t('subtitle_edit')) : t('subtitle_create')

  let body: ReactNode
  let footer: ReactNode
  const cancelButton = (
    <Button variant="outline" size="sm" data-part="te-cancel" onClick={requestClose}>
      {t('footer.cancel')}
    </Button>
  )

  if (missing) {
    body = (
      <div data-part="tab-editor" data-mode="edit">
        <div data-part="te-missing">
          <EmptyView
            icon="search"
            title={t('load.missing_title')}
            description={t('load.missing_desc')}
            action={
              <Button variant="outline" size="sm" onClick={onClose}>
                {t('load.close')}
              </Button>
            }
          />
        </div>
      </div>
    )
    footer = null
  } else if (!draft) {
    body = <EditorSkeleton t={t} />
    footer = <div className={cx('te-foot')}><div className={cx('te-foot-end')}>{cancelButton}</div></div>
  } else {
    const toggleGroup = (g: SourceGroup) =>
      setOpen((s) => {
        const n = new Set(s)
        if (n.has(g)) n.delete(g)
        else n.add(g)
        return n
      })
    const chosenSum = (n: number) => (n ? plural(t, 'sources.chosen', n, fmt) : t('sources.none'))
    // leave out: only makes sense among the channels the sources bring
    const excludePool = coveredChannels({ ...draft, excludeChannels: [] }, allChannels, folders)

    body = (
      <div ref={rootRef} className={cx('te')} data-part="tab-editor" data-mode={editing ? 'edit' : 'create'} data-builtin={builtin ? 'true' : undefined} onKeyDown={onRootKey}>
        <div className={cx('te-main')}>
          <div className={cx('te-name-row')}>
            <div className={cx('te-field')}>
              <label className={cx('te-label t-label')} htmlFor="te-name">
                {t('name.label')}
              </label>
              <Input
                id="te-name"
                data-part="te-name"
                value={nameValue}
                placeholder={t('name.placeholder')}
                maxLength={NAME_MAX + 20}
                autoComplete="off"
                disabled={builtin || saving}
                aria-invalid={nameProb && nameProb.kind !== 'empty' ? true : undefined}
                aria-describedby="te-name-hint"
                onChange={(e: { target: { value: string } }) => change({ name: e.target.value, nameTouched: true })}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault()
                    focusSources()
                  } else if (e.key === 'Escape') e.currentTarget.blur()
                }}
              />
              <div className={cx('te-hint-row')}>
                <p id="te-name-hint" className={cx('te-hint t-label')} data-part="te-name-hint" data-tone={nameProb ? 'error' : undefined} role={nameProb && nameProb.kind !== 'empty' ? 'alert' : undefined}>
                  {nameProb?.kind === 'duplicate'
                    ? t('name.duplicate', { name: nameProb.name })
                    : nameProb?.kind === 'long'
                      ? t('name.long', { max: fmt(NAME_MAX) })
                      : nameProb?.kind === 'empty'
                        ? suggestion
                          ? t('name.empty')
                          : t('name.empty_no_suggestion')
                        : builtin
                          ? t('name.builtin')
                          : !draft.nameTouched && suggestion
                            ? t('name.suggested')
                            : ''}
                </p>
                {nameProb?.kind === 'empty' && suggestion ? (
                  <Button variant="ghost" size="xs" data-part="te-name-use" onClick={() => change({ name: suggestion, nameTouched: true })}>
                    {t('name.use', { name: suggestion })}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className={cx('te-field')}>
              <label className={cx('te-label t-label')} htmlFor="te-icon">
                {t('icon.label')}
              </label>
              <Input
                id="te-icon"
                className={cx('te-icon-input')}
                data-part="te-icon"
                value={draft.icon}
                placeholder={t('icon.placeholder')}
                maxLength={ICON_MAX}
                autoComplete="off"
                disabled={builtin || saving}
                aria-describedby="te-icon-hint"
                onChange={(e: { target: { value: string } }) => change({ icon: e.target.value })}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Escape') e.currentTarget.blur()
                }}
              />
              <p id="te-icon-hint" className={cx('te-hint t-label')}>
                {t('icon.hint')}
              </p>
            </div>
          </div>

          <section ref={sourcesRef} className={cx('te-section')} data-part="te-sources" aria-labelledby="te-sources-title">
            <h3 id="te-sources-title" className={cx('te-section-title t-head')}>
              {t('sources.title')}
            </h3>
            {builtin ? (
              <p className={cx('te-note t-body')} data-part="te-builtin-note">
                {t(original?.rules.include.favorites ? 'sources.builtin_favorites' : 'sources.builtin_all')}
              </p>
            ) : (
              <>
                <p className={cx('te-note t-label')}>{t('sources.desc')}</p>
                <Group id="folders" title={t('sources.folders')} summary={chosenSum(draft.folders.length)} open={open.has('folders')} onToggle={() => toggleGroup('folders')}>
                  <FolderTree t={t} folders={folders} selected={draft.folders} onToggle={(id) => change({ folders: toggleFolder(draft.folders, id, folders) })} />
                </Group>
                <Group id="tags" title={t('sources.tags')} summary={chosenSum(draft.tags.length)} open={open.has('tags')} onToggle={() => toggleGroup('tags')}>
                  <TagList
                    t={t}
                    tags={tags}
                    selected={draft.tags}
                    onToggle={(id) => change({ tags: draft.tags.includes(id) ? draft.tags.filter((x) => x !== id) : [...draft.tags, id] })}
                  />
                </Group>
                <Group id="channels" title={t('sources.channels')} summary={chosenSum(draft.channels.length)} open={open.has('channels')} onToggle={() => toggleGroup('channels')}>
                  <ChannelPicker
                    t={t}
                    which="include"
                    label={t('channels.search')}
                    placeholder={t('channels.search_placeholder')}
                    chosenLabel={t('channels.chosen')}
                    pool={activeChannels}
                    chosen={draft.channels}
                    resolve={resolve}
                    inputRef={includeSearch}
                    onAdd={(id) => setDraft((d) => (d && !d.channels.includes(id) ? { ...d, channels: [...d.channels, id], excludeChannels: d.excludeChannels.filter((x) => x !== id) } : d))}
                    onRemove={(id) => setDraft((d) => (d ? { ...d, channels: d.channels.filter((x) => x !== id) } : d))}
                  />
                </Group>
              </>
            )}
          </section>

          <section className={cx('te-section')} data-part="te-filters" aria-labelledby="te-filters-title">
            <h3 id="te-filters-title" className={cx('te-section-title t-head')}>
              {t('filters.title')}
            </h3>
            <div className={cx('te-field')}>
              <span className={cx('te-label t-label')}>{t('filters.exclude')}</span>
              <ChannelPicker
                t={t}
                which="exclude"
                label={t('filters.exclude')}
                placeholder={t('filters.exclude_placeholder')}
                chosenLabel={t('filters.excluded')}
                pool={excludePool}
                chosen={draft.excludeChannels}
                resolve={resolve}
                onAdd={(id) => setDraft((d) => (d && !d.excludeChannels.includes(id) ? { ...d, excludeChannels: [...d.excludeChannels, id], channels: d.channels.filter((x) => x !== id) } : d))}
                onRemove={(id) => setDraft((d) => (d ? { ...d, excludeChannels: d.excludeChannels.filter((x) => x !== id) } : d))}
              />
            </div>
            <FilterRows t={t} draft={draft} onChange={change} disabled={saving} />
          </section>
        </div>

        <div className={cx('te-side')}>
          <PreviewPane
            t={t}
            live={live}
            state={previewState}
            channels={covered ? covered.length : null}
            chips={chips}
            onRemoveChip={(id: FilterId) => setDraft((d) => (d ? clearFilter(d, id) : d))}
            suggestion={suggestionChip}
            onClearSuggestion={() => suggestionId && setDraft((d) => (d ? clearFilter(d, suggestionId) : d))}
            onPickSources={focusSources}
          />
        </div>
      </div>
    )

    if (confirm === 'discard') {
      footer = <ConfirmStrip kind="discard" title={t('confirm.discard_title')} description={t('confirm.discard_desc')} yes={t('confirm.discard')} no={t('confirm.keep')} onYes={onClose} onNo={() => setConfirm(null)} />
    } else if (confirm === 'delete' && original) {
      footer = (
        <ConfirmStrip
          kind="delete"
          title={t('confirm.delete_title', { name: original.name })}
          description={t('confirm.delete_desc')}
          yes={t('confirm.delete')}
          no={t('confirm.not_now')}
          busy={deleting}
          onYes={() => void remove()}
          onNo={() => setConfirm(null)}
        />
      )
    } else {
      footer = (
        <div className={cx('te-foot')}>
          {editing && original && !builtin ? (
            <Button variant="ghost" size="sm" data-part="te-delete" disabled={saving} onClick={() => setConfirm('delete')}>
              <Codicon name="trash" size={13} />
              {t('footer.delete')}
            </Button>
          ) : null}
          {saveError ? (
            <p className={cx('te-foot-status te-error t-label')} data-part="te-error" role="alert">
              <Codicon name="error" size={13} className={cx('te-error-icon')} />
              <span>{t('footer.error', { error: saveErrorText(tc, saveError) })}</span>
            </p>
          ) : (
            <p className={cx('te-foot-status t-label')} data-part="te-status" data-tone={statusTone} aria-live="polite">
              {statusText}
            </p>
          )}
          <div className={cx('te-foot-end')}>
            {cancelButton}
            <Button size="sm" data-part="te-primary" disabled={!canSave} loading={saving} title={t('footer.shortcut')} onClick={() => void save()}>
              {saving ? t('footer.saving') : editing ? t('footer.save') : t('footer.create')}
            </Button>
          </div>
        </div>
      )
    }
  }

  return (
    <DialogFrame title={title} description={description} onClose={requestClose} size="xl" footer={footer} onEscapeKeyDown={onEscapeKeyDown}>
      {body}
    </DialogFrame>
  )
}

/** Codes whose message is written for the person (which field was refused, what already exists). */
const DETAILED_CODES: ReadonlySet<string> = new Set(['invalid', 'conflict'])

/**
 * Server error: the translated code text and, for a request the server refused (`invalid`/`conflict`), its message.
 * Anything else (unexpected error, failed transport, timeout) never shows its raw text: it can carry paths, a stack
 * or the local address.
 */
function saveErrorText(tc: (k: string, v?: Record<string, string | number>) => string, error: ApiError): string {
  const text = errorText(tc, error)
  if (!DETAILED_CODES.has(error.code)) return text
  return error.message && text !== error.message ? `${text} (${error.message})` : text
}

/** Loading the tab to edit: the same geometry (name, tree, preview). */
function EditorSkeleton({ t }: { t: (k: string) => string }) {
  return (
    <div className={cx('te')} data-part="tab-editor" data-mode="edit" aria-busy="true">
      <div className={cx('te-main')}>
        <div className={cx('te-name-row')}>
          <div className={cx('te-field')}>
            <span className={cx('te-label t-label')}>{t('name.label')}</span>
            <Input value="" disabled readOnly aria-busy="true" aria-label={t('name.label')} />
          </div>
          <div className={cx('te-field')}>
            <span className={cx('te-label t-label')}>{t('icon.label')}</span>
            <Input value="" disabled readOnly aria-busy="true" aria-label={t('icon.label')} />
          </div>
        </div>
        <section className={cx('te-section')}>
          <h3 className={cx('te-section-title t-head')}>{t('sources.title')}</h3>
          <ul className={cx('tree')} aria-hidden="true">
            <TreeItemSkeleton />
            <TreeItemSkeleton level={2} />
            <TreeItemSkeleton level={2} />
            <TreeItemSkeleton />
          </ul>
        </section>
      </div>
      <div className={cx('te-side')}>
        <section className={cx('te-preview')} data-part="te-preview" data-state="loading" aria-busy="true">
          <div className={cx('te-preview-head')}>
            <h3 className={cx('t-head')}>{t('preview.title')}</h3>
          </div>
          <GridSkeleton density="compact" count={PREVIEW_LIMIT} label={t('preview.grid_label')} />
        </section>
      </div>
    </div>
  )
}
