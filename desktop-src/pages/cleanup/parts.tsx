// Cleanup pieces, built with the kit. Channel rows (candidates and Former subscriptions) use the SAME geometry as
// `SuggestionRow` with selection (`data-selectable`: checkbox · 28 avatar · title + reason) — which is why the skeleton is
// the very same `SuggestionRowSkeleton selectable` (zero jump on load). `SuggestionRow` itself does not fit here: it
// asks for a destination (arrow + folder) and only has accept/refuse; the Cleanup row has "Keep".
import { Button, Checkbox, Codicon } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import type { Channel, ChannelRow, CleanupCandidate, CleanupGroup, QueueItem } from '../../../shared/api-types'
import {
  ChannelAvatar,
  ErrorView,
  Hero,
  Section,
  type Step,
  StepProgress,
  SuggestionRowSkeleton,
  formatRelative,
  useLocale
} from '../../components'
import { type Translate, useT } from '../../lib/i18n'
import { cx } from '../../lib/style'
import { EX_RETENTION_DAYS, RULE_GROUPS, type RowFact, SAID_BY_REASON, expiresAt, isActive, plural, trimReason } from './model'

// ------------------------------------------------------------------ format helpers

export function formatDate(tsSeconds: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(tsSeconds * 1000))
  } catch {
    return new Date(tsSeconds * 1000).toISOString().slice(0, 10)
  }
}

function formatDecimal(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
  } catch {
    return String(Math.round(value * 10) / 10)
  }
}

/** Visual list (the kit's group frame) with the list role. */
function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="list" aria-label={label} className={cx('sgroup')} data-part="cleanup-list">
      {children}
    </div>
  )
}

/** Informational row (empty group, no history, no model): same height as a channel row. */
function InfoRow({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div role="listitem" className={cx('srow')} data-part="cleanup-info">
      <Codicon name={icon} size={14} className={cx('srow-arrow')} />
      <div className={cx('srow-main')}>
        <div className={cx('srow-reason t-label')}>{text}</div>
      </div>
      <div className={cx('srow-actions')}>{action}</div>
    </div>
  )
}

// ------------------------------------------------------------------ candidate

export interface CandidateRowProps {
  candidate: CleanupCandidate
  channel: Channel
  facts: ChannelRow | undefined
  selected: boolean
  onSelect: (selected: boolean) => void
  onKeep: () => void
  now: number
}

export function CandidateRow({ candidate, channel, facts, selected, onSelect, onKeep, now }: CandidateRowProps) {
  const t = useT('cleanup')
  const locale = useLocale()
  // the reason first (no trailing period); then only the numbers it did not mention
  const said = SAID_BY_REASON[candidate.group] ?? []
  const fact: Record<RowFact, string | null> = {
    watched: facts && facts.watched_90d != null ? t('row.watched', { count: formatDecimal(facts.watched_90d, locale) }) : null,
    last_video: channel.last_video_at ? t('row.last_video', { when: formatRelative(channel.last_video_at, now, locale) }) : t('row.no_videos'),
    per_week: channel.videos_per_week ? t('row.per_week', { count: formatDecimal(channel.videos_per_week, locale) }) : null
  }
  const order: RowFact[] = ['watched', 'last_video', 'per_week']
  const why = trimReason(candidate.why ?? '')
  const numbers = order.filter((f) => !said.includes(f)).map((f) => fact[f]).filter(Boolean).join(' · ')
  const reason = [why, numbers].filter(Boolean).join(' · ')
  return (
    <div
      role="listitem"
      className={cx('srow')}
      data-part="cleanup-row"
      data-selectable="true"
      data-channel={channel.id}
      data-group={candidate.group}
      data-selected={selected ? 'true' : undefined}
    >
      <span className={cx('srow-lead')}>
        <Checkbox checked={selected} onCheckedChange={(v: boolean | 'indeterminate') => onSelect(v === true)} aria-label={t('row.select', { name: channel.title })} />
      </span>
      <span className={cx('srow-lead')}>
        <ChannelAvatar title={channel.title} thumb={channel.thumb} size={28} />
      </span>
      <div className={cx('srow-main')}>
        <div className={cx('srow-line t-body')} data-part="row-title">
          <span className={cx('srow-subject')}>{channel.title}</span>
        </div>
        {/* up to 3 lines; if there is still not enough room (huge reason on a narrow screen), the cut falls on the trailing numbers
            and the full text goes in the tooltip */}
        <div className={cx('srow-reason srow-reason-wrap t-label')} data-part="row-reason" title={reason}>
          {why ? <span data-part="row-why">{why}</span> : null}
          {why && numbers ? ' · ' : null}
          {numbers}
        </div>
      </div>
      <div className={cx('srow-actions')}>
        <Button variant="ghost" size="xs" data-part="row-keep" aria-label={t('row.keep_label', { name: channel.title })} onClick={onKeep}>
          {t('row.keep')}
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ group

export interface GroupSectionProps {
  group: CleanupGroup
  items: readonly CleanupCandidate[]
  channels: Readonly<Record<string, Channel>>
  facts: ReadonlyMap<string, ChannelRow>
  selected: ReadonlySet<string>
  /** `ignored` group empty and no device sent history (the only empty one that shows: there is something to do). */
  needsHistory: boolean
  onSelect: (channelIds: readonly string[], selected: boolean) => void
  onKeep: (candidate: CleanupCandidate, channel: Channel) => void
  onConnect: () => void
  now: number
}

/** The group's rule, on one line. The model name stays only in the top subtitle ("according to Hermes" here). */
export function groupRule(t: Translate, group: CleanupGroup): string {
  return t(`groups.${group}.rule`)
}

/** A group with nobody in view does not show; the exception is "You don't watch" without history (explains + connect). */
export function GroupSection({ group, items, channels, facts, selected, needsHistory, onSelect, onKeep, onConnect, now }: GroupSectionProps) {
  const t = useT('cleanup')
  const title = t(`groups.${group}.title`)
  const visible = items.filter((c) => channels[c.channel_id])
  const ids = visible.map((c) => c.channel_id)
  const all = ids.length > 0 && ids.every((id) => selected.has(id))
  let body: ReactNode
  if (visible.length) {
    body = visible.map((c) => {
      const ch = channels[c.channel_id]
      if (!ch) return null
      return (
        <CandidateRow
          key={c.id}
          candidate={c}
          channel={ch}
          facts={facts.get(c.channel_id)}
          selected={selected.has(c.channel_id)}
          onSelect={(v) => onSelect([c.channel_id], v)}
          onKeep={() => onKeep(c, ch)}
          now={now}
        />
      )
    })
  } else if (group === 'ignored' && needsHistory) {
    body = (
      <InfoRow
        icon="history"
        text={t('groups.ignored.needs_history')}
        action={
          <Button variant="ghost" size="xs" onClick={onConnect}>
            {t('actions.connect')}
          </Button>
        }
      />
    )
  } else {
    return null
  }
  return (
    <div data-part="cleanup-group" data-group={group}>
      <Section
        title={title}
        count={visible.length}
        description={groupRule(t, group)}
        actions={
          ids.length ? (
            <Button variant="ghost" size="xs" data-part="group-select" aria-pressed={all} onClick={() => onSelect(ids, !all)}>
              {all ? t('groups.clear') : t('groups.select_all', { count: ids.length })}
            </Button>
          ) : null
        }
      >
        <RowList label={t('groups.label', { group: title })}>{body}</RowList>
      </Section>
    </div>
  )
}

/** Loading/scanning: the three groups with real titles and rules and skeleton rows (same geometry). */
export function GroupsSkeleton({ label }: { label: string }) {
  const t = useT('cleanup')
  // fragment: each group is a direct child of the page body, like in the final list
  return (
    <>
      {RULE_GROUPS.map((g, i) => (
        <div key={g} data-part="cleanup-group" data-group={g} data-skeleton aria-busy="true" aria-label={label}>
          <Section title={t(`groups.${g}.title`)} description={groupRule(t, g)}>
            <RowList label={t(`groups.${g}.title`)}>
              {Array.from({ length: 3 - (i % 2) }, (_, k) => (
                <SuggestionRowSkeleton key={k} selectable />
              ))}
            </RowList>
          </Section>
        </div>
      ))}
    </>
  )
}

// ------------------------------------------------------------------ queue

const STEP_STATUS = { approved: 'waiting', running: 'running', done: 'done', failed: 'failed', undone: 'waiting' } as const

/** Notes the extension sends with `done` when the page was already in the target state (nothing was clicked). */
const DONE_NOTES = ['not_subscribed', 'already_subscribed'] as const
type DoneNote = (typeof DONE_NOTES)[number]
const doneNote = (error: string | null | undefined): DoneNote | null => {
  const note = error?.trim()
  return (DONE_NOTES as readonly string[]).includes(note ?? '') ? (note as DoneNote) : null
}

export interface QueueSectionProps {
  items: readonly QueueItem[]
  channelName: (id: string) => string
  offline: boolean
  onUndo: (ids: string[]) => void
  now: number
}

export function QueueSection({ items, channelName, offline, onUndo, now }: QueueSectionProps) {
  const t = useT('cleanup')
  const locale = useLocale()
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n)
  const undoable = items.filter((it) => it.status === 'approved' && !it.id.startsWith('local:'))
  const pending = items.filter(isActive).length
  const steps: Step[] = items.map((it) => {
    const name = channelName(it.channel_id)
    let text: string
    if (it.status === 'approved') text = offline ? t('queue.status.approved_offline') : t('queue.status.approved')
    else if (it.status === 'running') text = t('queue.status.running')
    else if (it.status === 'done') {
      text = t('queue.status.done', { when: formatRelative(it.updated_at, now, locale) })
      const note = doneNote(it.error)
      if (note) text = `${text} · ${t(`queue.note.${note}`)}`
    } else text = it.error?.trim() ? t('queue.status.failed', { reason: it.error.trim() }) : t('queue.status.failed_unknown')
    const canUndo = it.status === 'approved' && !it.id.startsWith('local:')
    return {
      id: it.id,
      label: name,
      status: STEP_STATUS[it.status],
      detail: (
        <>
          {t(`queue.action.${it.action}`)} · {text}
          {canUndo ? (
            <>
              {' '}
              <Button variant="ghost" size="xs" data-part="queue-undo" aria-label={t('queue.undo_label', { name })} onClick={() => onUndo([it.id])}>
                {t('queue.undo')}
              </Button>
            </>
          ) : null}
        </>
      )
    }
  })
  return (
    <div data-part="cleanup-queue">
      <Section
        title={t('queue.title')}
        count={pending || null}
        description={t('queue.description')}
        actions={
          undoable.length > 1 ? (
            <Button variant="ghost" size="xs" data-part="queue-undo-all" onClick={() => onUndo(undoable.map((it) => it.id))}>
              <Codicon name="discard" size={13} />
              {plural(t, 'queue.undo_all', undoable.length, fmt)}
            </Button>
          ) : null
        }
      >
        <StepProgress steps={steps} label={t('queue.label')} />
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ Former subscriptions

export interface ExSectionProps {
  rows: readonly ChannelRow[] | undefined
  error: unknown
  queued: ReadonlySet<string>
  onResubscribe: (channel: Channel) => void
  onRetry: () => void
  now: number
}

export function ExSection({ rows, error, queued, onResubscribe, onRetry, now }: ExSectionProps) {
  const t = useT('cleanup')
  const locale = useLocale()
  let body: ReactNode
  if (rows) {
    body = rows.length ? (
      <RowList label={t('ex.label')}>
        {rows.map((r) => {
          const ch = r.channel
          const until = expiresAt(r)
          const meta = [
            ch.unsubscribed_at ? t('ex.cancelled', { when: formatRelative(ch.unsubscribed_at, now, locale) }) : null,
            until ? t('ex.until', { date: formatDate(until, locale) }) : null
          ].filter(Boolean)
          const inQueue = queued.has(ch.id)
          return (
            <div key={ch.id} role="listitem" className={cx('srow')} data-part="ex-row" data-selectable="true" data-channel={ch.id}>
              {/* empty checkbox column: the avatars line up with those in the candidates list */}
              <span className={cx('srow-lead')} />
              <span className={cx('srow-lead')}>
                <ChannelAvatar title={ch.title} thumb={ch.thumb} size={28} />
              </span>
              <div className={cx('srow-main')}>
                <div className={cx('srow-line t-body')} data-part="row-title">
                  <span className={cx('srow-subject')}>{ch.title}</span>
                </div>
                <div className={cx('srow-reason srow-reason-wrap t-label')} data-part="row-reason">
                  {meta.join(' · ') || ch.handle || '\u00a0'}
                </div>
              </div>
              <div className={cx('srow-actions')}>
                {inQueue ? (
                  <span className={cx('srow-status t-label')} data-part="ex-queued">
                    <Codicon name="clock" size={12} />
                    {t('ex.queued')}
                  </span>
                ) : (
                  <Button variant="outline" size="xs" data-part="ex-resubscribe" aria-label={t('ex.resubscribe_label', { name: ch.title })} onClick={() => onResubscribe(ch)}>
                    {t('ex.resubscribe')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </RowList>
    ) : (
      <RowList label={t('ex.label')}>
        <InfoRow icon="history" text={t('ex.empty', { days: EX_RETENTION_DAYS })} />
      </RowList>
    )
  } else if (error) {
    body = <ErrorView compact title={t('ex.error')} error={error} onRetry={onRetry} />
  } else {
    body = (
      <RowList label={t('ex.label')}>
        <SuggestionRowSkeleton selectable />
        <SuggestionRowSkeleton selectable />
      </RowList>
    )
  }
  return (
    <div data-part="cleanup-ex">
      <Section title={t('ex.title')} count={rows ? rows.length : null} description={t('ex.description', { days: EX_RETENTION_DAYS })}>
        {body}
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ page empty states

/** The three scan criteria, in group order (icon + one short line). */
const CRITERIA = [
  ['stale', 'history'],
  ['ignored', 'eye-closed'],
  ['off_profile', 'compass']
] as const

export function NeverScanned({ onScan, children }: { onScan: () => void; children?: ReactNode }) {
  const t = useT('cleanup')
  return (
    <div className={cx('state')} data-part="empty" data-kind="never">
      <Hero icon="search" title={t('empty.never_title')} description={t('empty.never_desc')} />
      <div role="list" aria-label={t('empty.criteria.label')} className={cx('stack')} data-gap="2" data-align="start" data-part="cleanup-criteria">
        {CRITERIA.map(([group, icon]) => (
          <div key={group} role="listitem" className={cx('stack t-body')} data-direction="row" data-gap="2" data-align="start">
            <Codicon name={icon} size={16} />
            <span>{t(`empty.criteria.${group}`)}</span>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={onScan}>
        <Codicon name="search" size={14} />
        {t('actions.scan_first')}
      </Button>
      {children}
    </div>
  )
}
