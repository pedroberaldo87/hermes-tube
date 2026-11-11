// Presentation pieces of "Organize with Hermes", built only from the kit (components/) and SDK
// controls. No server state here: index.tsx decides what to show and passes the callbacks.
//   IntroBody / IntroSkeleton — opening (count, what will happen, model) and its skeleton (same geometry)
//   ProgressPanel             — steps + "120 of 400 channels" bar
//   SuggestionList            — groups by folder (new one marked) with accept/reject/swap-folder rows
//   Notice                    — strips (Banner) with `data-part` for tests and preview
import { Button, Codicon, Input } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'
import {
  Banner,
  type BannerTone,
  Dot,
  Section,
  Stack,
  Stat,
  StatSkeleton,
  type Step,
  StepProgress,
  StepProgressSkeleton,
  SuggestionGroup,
  SuggestionRow,
  SuggestionRowSkeleton,
  type SuggestionStatus,
  useFormatCount,
  useLocale
} from '../../components'
import { SkLines, vars } from '../../components/kit'
import type { Channel, Progress } from '../../../shared/api-types'
import { type Translate, useT } from '../../lib/i18n'
import { cx } from '../../lib/style'
import { type Group, type Item, folderKey, pluralKey } from './model'

/** Local decision on a suggestion: accepted/rejected here, or going back to pending after an undo. */
export type Decision = 'accepted' | 'rejected' | 'restoring'

/** Translator with plural (`<key>_one|_other`, by the language's rule) and `{count}` already formatted. */
export function usePlural(): (base: string, count: number, vars?: Record<string, string | number>) => string {
  const t = useT('organize')
  const locale = useLocale()
  const fmt = useFormatCount()
  return (base, count, extra) => t(pluralKey(base, count, locale), { count: fmt(count), ...extra })
}

// ------------------------------------------------------------------ opening

const STEP_IDS = ['read', 'suggest', 'review'] as const

function introSteps(t: Translate): Step[] {
  return STEP_IDS.map((id) => ({ id, label: t(`steps.${id}`), status: 'waiting' as const }))
}

export function IntroBody({
  count,
  selection,
  modelLine,
  onChooseModel
}: {
  count: number
  selection: boolean
  /** `null`: there is no model (the warning above already says so and leads to settings). */
  modelLine: string | null
  onChooseModel: () => void
}) {
  const t = useT('organize')
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <div data-part="organize-count">
          <Stat label={selection ? t('intro.count_selection') : t('intro.count_none')} value={count} />
        </div>
        <p className={cx('section-desc t-body')}>{t('intro.lead')}</p>
      </Stack>
      <Section title={t('intro.steps_label')}>
        <StepProgress steps={introSteps(t)} label={t('intro.steps_label')} />
      </Section>
      {modelLine !== null ? <ModelLine text={modelLine} onChooseModel={onChooseModel} /> : null}
    </Stack>
  )
}

export function ModelLine({ text, onChooseModel }: { text: string; onChooseModel: () => void }) {
  const t = useT('organize')
  return (
    <Stack direction="row" gap={2} align="center" wrap>
      <span className={cx('stat-label t-label')} data-part="organize-model">
        <Codicon name="sparkle" size={12} /> {text}
      </span>
      <Button variant="ghost" size="xs" data-part="organize-model-settings" onClick={onChooseModel}>
        {t('intro.choose_model')}
      </Button>
    </Stack>
  )
}

/** Same geometry as the opening (count, 2-line sentence, 3 steps, model row). */
export function IntroSkeleton() {
  const t = useT('organize')
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <StatSkeleton />
        <div className={cx('section-desc t-body')} aria-hidden="true">
          <SkLines widths={['92%', '58%']} />
        </div>
      </Stack>
      <Section title={t('intro.steps_label')}>
        <StepProgressSkeleton count={3} />
      </Section>
      <span className={cx('stat-label t-label')} aria-hidden="true">
        <SkLines widths={['220px']} />
      </span>
    </Stack>
  )
}

// ------------------------------------------------------------------ progress

export function ProgressPanel({ progress }: { progress: Progress | null }) {
  const t = useT('organize')
  const fmt = useFormatCount()
  const total = progress?.total ?? null
  const done = Math.max(0, progress?.done ?? 0)
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const channels = total != null ? t('progress.channels', { done: fmt(done), total: fmt(total) }) : t('progress.preparing')
  const started = !!progress
  const steps: Step[] = [
    { id: 'read', label: t('steps.read'), status: started ? 'done' : 'running' },
    { id: 'suggest', label: t('steps.suggest'), status: started ? 'running' : 'waiting' },
    { id: 'review', label: t('steps.review'), status: 'waiting' }
  ]
  return (
    <Stack gap={3}>
      <StepProgress steps={steps} label={t('progress.label')} />
      <Stack direction="row" gap={3} align="center">
        <span
          className={cx('pairing-bar')}
          role="progressbar"
          aria-label={t('progress.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={channels}
          data-part="organize-progress"
        >
          <span className={cx('pairing-bar-fill')} style={vars({ left: `${pct}%` })} />
        </span>
        <span className={cx('stat-label t-label num')} aria-hidden="true">
          {channels}
          {total ? <> · {t('progress.percent', { percent: fmt(pct) })}</> : null}
        </span>
      </Stack>
    </Stack>
  )
}

// ------------------------------------------------------------------ suggestion list

export interface ListHandlers {
  onAccept: (items: Item[]) => void
  onReject: (items: Item[]) => void
  onEdit: (channelId: string, folder: string | null) => void
}

export interface SuggestionListProps extends ListHandlers {
  groups: Group[]
  decisions: Readonly<Record<string, Decision>>
  edits: Readonly<Record<string, string>>
  channels: ReadonlyMap<string, Channel>
  /** Existing folders (paths) to suggest in the swap field. */
  folderOptions: readonly string[]
  /** Model per group (only when there is more than one model in the list). */
  showModelPerGroup: boolean
  /** Batches still arriving: reserves the geometry of the next one. */
  arriving: boolean
}

export function statusOf(decision: Decision | undefined): SuggestionStatus {
  return decision === 'accepted' ? 'accepted' : decision === 'rejected' ? 'rejected' : 'pending'
}

export function SuggestionList({
  groups,
  decisions,
  edits,
  channels,
  folderOptions,
  showModelPerGroup,
  arriving,
  onAccept,
  onReject,
  onEdit
}: SuggestionListProps) {
  const t = useT('organize')
  const listId = useId()
  const pendingOf = (items: Item[]) => items.filter((i) => statusOf(decisions[i.suggestion.id]) === 'pending')
  return (
    <div role="group" aria-label={t('review.list_label')} data-part="organize-groups">
      <Stack gap={3}>
        {groups.map((g) => {
          const pending = pendingOf(g.items)
          const model = showModelPerGroup ? (g.items.find((i) => i.suggestion.model)?.suggestion.model ?? null) : null
          return (
            <SuggestionGroup
              key={g.key}
              title={<GroupTitle group={g} />}
              // the count goes in the title, with this dialog's plural ("1 suggestion")
              count={null}
              model={model}
              onAcceptAll={pending.length ? () => onAccept(pending) : undefined}
              onRejectAll={pending.length ? () => onReject(pending) : undefined}
            >
              {g.items.map((item) => (
                <Row
                  key={item.suggestion.id}
                  item={item}
                  decision={decisions[item.suggestion.id]}
                  edit={edits[item.proposal.channelId]}
                  channel={channels.get(item.proposal.channelId)}
                  listId={listId}
                  onAccept={onAccept}
                  onReject={onReject}
                  onEdit={onEdit}
                />
              ))}
            </SuggestionGroup>
          )
        })}
        {arriving ? <ArrivingGroup /> : null}
      </Stack>
      <datalist id={listId}>
        {folderOptions.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </div>
  )
}

function GroupTitle({ group }: { group: Group }) {
  const t = useT('organize')
  const tp = usePlural()
  return (
    <>
      {group.kind === 'tags' ? t('group.tags_only') : group.folder}
      {group.isNew ? (
        <>
          {' '}
          <span className={cx('sgroup-meta t-label')} data-part="organize-new-folder">
            <Dot tone="new" /> {t('group.new')}
          </span>
        </>
      ) : null}{' '}
      <span className={cx('sgroup-meta t-label num')} data-part="organize-group-count">
        {tp('review.suggestions', group.items.length)}
      </span>
    </>
  )
}

function Row({
  item,
  decision,
  edit,
  channel,
  listId,
  onAccept,
  onReject,
  onEdit
}: {
  item: Item
  decision: Decision | undefined
  edit: string | undefined
  channel: Channel | undefined
  listId: string
} & ListHandlers) {
  const t = useT('organize')
  const tp = usePlural()
  const p = item.proposal
  const title = channel?.title ?? p.channelTitle ?? p.channelId
  const status = statusOf(decision)
  const folder = edit ?? p.folder
  const edited = edit !== undefined && folderKey(edit) !== folderKey(p.folder)
  const hashtags = (tags: string[]) => tags.map((tag) => `#${tag}`).join(' ')
  if (p.sameFolder) {
    // the channel stays where it is: the line says what changes ("add tag #math"), not "folder → same folder"
    return (
      <SuggestionRow
        subject={title}
        avatar={{ title, thumb: channel?.thumb ?? null }}
        target={
          <span className={cx('t-label')} data-part="organize-add-tags">
            {tp('row.add_tags', p.newTags.length, { tags: hashtags(p.newTags) })}
          </span>
        }
        reason={[p.fromFolder ? t('row.from', { folder: p.fromFolder }) : null, p.why || null].filter(Boolean).join(' · ')}
        confidence={p.confidence}
        status={status}
        onAccept={() => onAccept([item])}
        onReject={() => onReject([item])}
      />
    )
  }
  const reason = [p.fromFolder ? t('row.from', { folder: p.fromFolder }) : null, p.why || null, p.tags.length ? hashtags(p.tags) : null]
    .filter(Boolean)
    .join(' · ')
  const target = (
    <>
      {status === 'pending' ? (
        <FolderPick channelTitle={title} folder={folder} listId={listId} onCommit={(next) => onEdit(p.channelId, next)} />
      ) : (
        folder
      )}
      {edited ? <span className={cx('sgroup-meta t-label')}>{t('row.edited')}</span> : null}
    </>
  )
  return (
    <SuggestionRow
      subject={title}
      avatar={{ title, thumb: channel?.thumb ?? null }}
      target={target}
      reason={reason}
      confidence={p.confidence}
      status={status}
      onAccept={() => onAccept([item])}
      onReject={() => onReject([item])}
    />
  )
}

/** Folder chip that becomes a field on click: Enter confirms, Esc abandons, leaving the field confirms. */
function FolderPick({
  channelTitle,
  folder,
  listId,
  onCommit
}: {
  channelTitle: string
  folder: string
  listId: string
  onCommit: (folder: string | null) => void
}) {
  const t = useT('organize')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(folder)
  const settled = useRef(false)
  const pickRef = useRef<HTMLButtonElement>(null)

  const open = () => {
    settled.current = false
    setDraft(folder)
    setEditing(true)
  }
  const close = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit) onCommit(cleanFolder(draft))
    setEditing(false)
    // gives focus back to the chip (the keyboard continues from where it was)
    queueMicrotask(() => pickRef.current?.focus())
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(false)
    }
  }

  if (editing) {
    return (
      <Input
        data-part="organize-folder-input"
        aria-label={t('row.folder_input', { channel: channelTitle })}
        title={t('row.folder_hint')}
        list={listId}
        value={draft}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => close(true)}
      />
    )
  }
  return (
    <button
      ref={pickRef}
      type="button"
      className={cx('bare chip t-label')}
      data-part="organize-folder-pick"
      aria-label={t('row.change_folder', { channel: channelTitle })}
      title={t('row.change_folder', { channel: channelTitle })}
      onClick={open}
    >
      <Codicon name="folder" size={12} className={cx('chip-icon')} />
      <span className={cx('chip-label')}>{folder}</span>
      <Codicon name="edit" size={10} className={cx('chip-icon')} />
    </button>
  )
}

/** "A / B /" → "A/B"; empty → null (abandons the swap). The server still validates the path. */
export function cleanFolder(value: string): string | null {
  const parts = value
    .split('/')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  return parts.length ? parts.join('/') : null
}

/** The next batch arriving: the geometry of a group with two lines. */
function ArrivingGroup() {
  const t = useT('organize')
  return (
    <section className={cx('sgroup')} data-part="organize-arriving" data-skeleton aria-busy="true">
      <header className={cx('sgroup-head')}>
        <span className={cx('sgroup-title t-head')} aria-hidden="true">
          <SkLines widths={['140px']} />
        </span>
        <span className={cx('sgroup-meta t-label')}>{t('progress.arriving')}</span>
      </header>
      <div aria-hidden="true">
        <SuggestionRowSkeleton />
        <SuggestionRowSkeleton />
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ strips

export function Notice({
  part,
  tone = 'info',
  title,
  children,
  action,
  icon
}: {
  part: string
  tone?: BannerTone
  title?: ReactNode
  children?: ReactNode
  action?: { label: string; onClick: () => void }
  icon?: string
}) {
  return (
    <div data-part={part}>
      <Banner tone={tone} title={title} action={action} icon={icon}>
        {children}
      </Banner>
    </div>
  )
}
