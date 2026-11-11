// Small kit pieces: Why ("why it is here", always visible — never in a tooltip), Stat, Count (counter with
// transition and tabular figures), Dot.
import { Codicon } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import type { Why as WhyData, WhyVia } from '../../shared/api-types'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { SkLines, formatNumber, useLocale } from './kit'

export const WHY_ICON: Record<WhyVia, string> = {
  folder: 'folder',
  tag: 'tag',
  channel: 'account',
  theme: 'sparkle',
  hn: 'flame',
  list: 'list-unordered'
}

export interface WhyProps {
  why: WhyData | null | undefined
  /** What the card already shows (the channel). If the reason is that same thing, shows only the reason — never repeats. */
  subject?: string | null
}

/** Subtle line above the card title. Without `why`, the line exists empty (same height, no jump). */
export function Why({ why, subject }: WhyProps) {
  const t = useT()
  if (!why) return <p className={cx('why t-label')} data-part="why" aria-hidden="true" />
  const repeats = !!subject && why.via === 'channel' && why.label.trim().toLocaleLowerCase() === subject.trim().toLocaleLowerCase()
  // The reason is the channel itself, which the card already shows, and there is no detail: the line stays empty. Writing
  // "Channel" on every card (favorites tab, channels tab) told nothing.
  if (repeats && !why.detail) return <p className={cx('why t-label')} data-part="why" data-via={why.via} aria-hidden="true" />
  const label = repeats ? (why.detail ?? '') : why.label
  const detail = repeats ? null : why.detail
  return (
    <p className={cx('why t-label')} data-part="why" data-via={why.via}>
      <span className={cx('sr')}>{t('kit.why.label')}</span>
      <Codicon name={WHY_ICON[why.via] ?? 'info'} size={12} className={cx('why-icon')} />
      <span className={cx('why-label')}>{label}</span>
      {detail ? <span className={cx('why-detail')}>· {detail}</span> : null}
    </p>
  )
}

export interface CountProps {
  value: number
  /** `new` uses the accent (what is new); `neutral` (default) is monochrome. */
  tone?: 'new' | 'neutral'
  /** Screen reader label (e.g. "3 new"). */
  label?: string
}

/** Counter: tabular figures; when it changes, the number enters with a short transition. */
export function Count({ value, tone = 'neutral', label }: CountProps) {
  const locale = useLocale()
  return (
    <span className={cx('count num')} data-part="count" data-tone={tone} aria-label={label}>
      <span key={value} className={cx('count-value')} data-part="count-value">
        {formatNumber(value, locale)}
      </span>
    </span>
  )
}

export interface StatProps {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
}

export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className={cx('stat')} data-part="stat">
      <span className={cx('stat-label t-label')}>{label}</span>
      <span className={cx('stat-value t-title')}>{typeof value === 'number' ? <Count value={value} /> : value}</span>
      {hint ? <span className={cx('stat-hint t-label')}>{hint}</span> : null}
    </div>
  )
}

export function StatSkeleton() {
  return (
    <div className={cx('stat')} data-part="stat" data-skeleton aria-hidden="true">
      <span className={cx('stat-label t-label')}>
        <SkLines widths={['48px']} />
      </span>
      <span className={cx('stat-value t-title')}>
        <SkLines widths={['36px']} />
      </span>
    </div>
  )
}

export type DotTone = 'neutral' | 'new' | 'success' | 'warning' | 'error'

/** Status dot. Only `new` uses the accent; the semantic colors appear only here, in the Banner and in StepProgress. */
export function Dot({ tone = 'neutral', label }: { tone?: DotTone; label?: string }) {
  return (
    <span
      className={cx('dot')}
      data-part="dot"
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
