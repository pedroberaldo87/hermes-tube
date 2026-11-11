// AI flows: StepProgress (steps waiting/running/done/failed), SuggestionGroup + SuggestionRow
// (accept/decline one, accept a group; reason and model in view) and ApprovalCard (destructive action: shows
// exactly what will happen; the approving button is never the first focus).
import { Button, Checkbox, Codicon } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { ChannelAvatar, ChannelAvatarSkeleton } from './ChannelAvatar'
import { ChipSkeleton, FolderChip } from './FolderChip'
import { SkLines, useFormatCount, useLocale } from './kit'

// --------------------------------------------------------------- StepProgress

export type StepStatus = 'waiting' | 'running' | 'done' | 'failed'

export interface Step {
  id: string
  label: ReactNode
  status: StepStatus
  /** Short detail (e.g. "12/40 videos"). */
  detail?: ReactNode
}

const STEP_ICON: Record<StepStatus, string> = {
  waiting: 'circle-large-outline',
  running: 'loading',
  done: 'pass-filled',
  failed: 'error'
}

export function StepProgress({ steps, label }: { steps: readonly Step[]; label: string }) {
  const t = useT()
  return (
    <ol className={cx('steps')} aria-label={label} data-part="steps">
      {steps.map((s) => (
        <li key={s.id} className={cx('step')} data-status={s.status} aria-current={s.status === 'running' ? 'step' : undefined}>
          <span className={cx('step-icon')} aria-hidden="true">
            <Codicon name={STEP_ICON[s.status]} size={s.status === 'running' ? 14 : 15} spinning={s.status === 'running'} />
          </span>
          <span className={cx('step-text')}>
            <span className={cx('step-label t-body')}>
              {s.label}
              <span className={cx('sr')}>{t(`kit.steps.${s.status}`)}</span>
            </span>
            {s.detail ? <span className={cx('step-detail t-label')}>{s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function StepProgressSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ol className={cx('steps')} data-part="steps" data-skeleton aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={cx('step')} data-status="waiting" aria-hidden="true">
          <span className={cx('step-icon')}>
            <Codicon name={STEP_ICON.waiting} size={15} />
          </span>
          <span className={cx('step-text')}>
            <span className={cx('step-label t-body')}>
              <SkLines widths={[`${40 + ((i * 17) % 35)}%`]} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

// --------------------------------------------------------------- SuggestionGroup / SuggestionRow

export interface SuggestionGroupProps {
  title: ReactNode
  count?: number | null
  /** Model that suggested it (in view, not in a tooltip). */
  model?: string | null
  onAcceptAll?: () => void
  onRejectAll?: () => void
  children?: ReactNode
}

/** `kit.suggest.count_one` when the language's plural rule says "one", else `kit.suggest.count`. */
function suggestCountKey(count: number, locale: string): string {
  let rule = count === 1 ? 'one' : 'other'
  try {
    rule = new Intl.PluralRules(locale).select(count)
  } catch {
    // unknown locale: keep the English rule
  }
  return rule === 'one' ? 'kit.suggest.count_one' : 'kit.suggest.count'
}

export function SuggestionGroup({ title, count, model, onAcceptAll, onRejectAll, children }: SuggestionGroupProps) {
  const t = useT()
  const fmt = useFormatCount()
  const locale = useLocale()
  return (
    <section className={cx('sgroup')} data-part="sgroup">
      <header className={cx('sgroup-head')}>
        <h3 className={cx('sgroup-title t-head')}>
          <span className={cx('truncate')}>{title}</span>
          {count != null ? <span className={cx('sgroup-meta t-label num')}>{t(suggestCountKey(count, locale), { count: fmt(count) })}</span> : null}
        </h3>
        {model ? <span className={cx('sgroup-meta t-label')}>{t('kit.suggest.by_model', { model })}</span> : null}
        {onAcceptAll || onRejectAll ? (
          <div className={cx('sgroup-actions')}>
            {onRejectAll ? (
              <Button variant="ghost" size="xs" data-part="group-reject" onClick={onRejectAll}>
                {t('kit.suggest.reject_all')}
              </Button>
            ) : null}
            {onAcceptAll ? (
              <Button variant="secondary" size="xs" data-part="group-accept" onClick={onAcceptAll}>
                <Codicon name="check-all" size={14} />
                {t('kit.suggest.accept_all')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div role="list">{children}</div>
    </section>
  )
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'

export interface SuggestionRowProps {
  /** What changes (e.g. the channel name). */
  subject: ReactNode
  avatar?: { title: string; thumb: string | null | undefined } | null
  /** Where it goes: text becomes a folder chip; or a custom node (tags, tab). */
  target: ReactNode
  /** Reason given by the AI (in view). */
  reason: ReactNode
  model?: string | null
  /** 0..1 */
  confidence?: number | null
  status?: SuggestionStatus
  onAccept?: () => void
  onReject?: () => void
  /** Selection (optional): with `onSelectedChange` the row gets a checkbox before the avatar
   *  (checkbox · avatar 28 · title + reason). Without it, the row does not change. */
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
  /** Accessible label of the checkbox (default: the `subject`, if it is text). */
  selectLabel?: string
}

export function SuggestionRow({
  subject,
  avatar,
  target,
  reason,
  model,
  confidence,
  status = 'pending',
  onAccept,
  onReject,
  selected,
  onSelectedChange,
  selectLabel
}: SuggestionRowProps) {
  const t = useT()
  const meta = [
    model ? t('kit.suggest.by_model', { model }) : null,
    confidence != null ? t('kit.suggest.confidence', { percent: Math.round(confidence * 100) }) : null
  ].filter(Boolean)
  const selectable = !!onSelectedChange
  const avatarNode = avatar ? <ChannelAvatar title={avatar.title} thumb={avatar.thumb} size={28} /> : null
  return (
    <div role="listitem" className={cx('srow')} data-part="suggestion-row" data-status={status} data-selectable={selectable ? 'true' : undefined}>
      {selectable ? (
        <>
          <span className={cx('srow-lead')}>
            <Checkbox
              checked={!!selected}
              onCheckedChange={(v: boolean | 'indeterminate') => onSelectedChange?.(v === true)}
              aria-label={selectLabel ?? (typeof subject === 'string' ? subject : undefined)}
            />
          </span>
          <span className={cx('srow-lead')}>{avatarNode}</span>
        </>
      ) : (
        (avatarNode ?? <span />)
      )}
      <div className={cx('srow-main')}>
        <div className={cx('srow-line t-body')}>
          <span className={cx('srow-subject')}>{subject}</span>
          <Codicon name="arrow-right" size={12} className={cx('srow-arrow')} />
          {typeof target === 'string' ? <FolderChip folder={{ id: target, name: target }} /> : target}
        </div>
        <div className={cx('srow-reason t-label')}>
          {reason}
          {meta.length ? <> · {meta.join(' · ')}</> : null}
        </div>
      </div>
      <div className={cx('srow-actions')}>
        {status === 'pending' ? (
          <>
            {onReject ? (
              <Button variant="ghost" size="icon-xs" data-part="suggestion-reject" aria-label={t('kit.suggest.reject')} onClick={onReject}>
                <Codicon name="close" size={14} />
              </Button>
            ) : null}
            {onAccept ? (
              <Button variant="secondary" size="icon-xs" data-part="suggestion-accept" aria-label={t('kit.suggest.accept')} onClick={onAccept}>
                <Codicon name="check" size={14} />
              </Button>
            ) : null}
          </>
        ) : (
          <span className={cx('srow-status t-label')}>
            <Codicon name={status === 'accepted' ? 'check' : 'close'} size={12} />
            {t(`kit.suggest.${status}`)}
          </span>
        )}
      </div>
    </div>
  )
}

/** `selectable`: same geometry as the row with a checkbox (checkbox · avatar · text). */
export function SuggestionRowSkeleton({ selectable }: { selectable?: boolean } = {}) {
  return (
    <div className={cx('srow')} data-part="suggestion-row" data-skeleton aria-hidden="true" data-selectable={selectable ? 'true' : undefined}>
      {selectable ? (
        <>
          <span className={cx('srow-lead')} />
          <span className={cx('srow-lead')}>
            <ChannelAvatarSkeleton size={28} />
          </span>
        </>
      ) : (
        <ChannelAvatarSkeleton size={28} />
      )}
      <div className={cx('srow-main')}>
        <div className={cx('srow-line t-body')}>
          <SkLines widths={['96px']} />
          <ChipSkeleton width="72px" />
        </div>
        <div className={cx('srow-reason t-label')}>
          <SkLines widths={['62%']} />
        </div>
      </div>
      <div className={cx('srow-actions')} />
    </div>
  )
}

// --------------------------------------------------------------- ApprovalCard

export interface ApprovalCardProps {
  title: ReactNode
  description?: ReactNode
  /** Exactly what will happen, one item per effect. */
  effects: readonly ReactNode[]
  /** Extra preview (e.g. a channel list). */
  children?: ReactNode
  /** Explicit label, with the count (e.g. "Unsubscribe from 12 channels"). */
  confirmLabel: ReactNode
  onConfirm: () => void
  onCancel: () => void
  /** Label of the dismiss button; default "Not now". Never use the action's verb (e.g. "Cancel"
   *  next to "Cancel 3 subscriptions" is ambiguous and dangerous). */
  cancelLabel?: ReactNode
  busy?: boolean
  /** `destructive` (default) paints the approve button as destructive. */
  tone?: 'destructive' | 'default'
  /** Focuses the dismiss button on mount (the confirming one never gets the initial focus). */
  autoFocus?: boolean
}

export function ApprovalCard({
  title,
  description,
  effects,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel,
  busy,
  tone = 'destructive',
  autoFocus
}: ApprovalCardProps) {
  const t = useT()
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (autoFocus) cancelRef.current?.focus()
  }, [autoFocus])
  return (
    <section className={cx('approval')} data-part="approval" aria-labelledby={titleId}>
      <div className={cx('approval-head')}>
        <span className={cx('approval-icon')} aria-hidden="true">
          <Codicon name="shield" size={15} />
        </span>
        <div className={cx('approval-titles')}>
          <h3 id={titleId} className={cx('approval-title t-head')}>
            {title}
          </h3>
          {description ? <p className={cx('approval-desc t-body')}>{description}</p> : null}
        </div>
      </div>
      <p className={cx('approval-label t-label')}>{t('kit.approval.what')}</p>
      <ol className={cx('approval-effects t-body')} data-part="approval-effects">
        {effects.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ol>
      {children}
      <div className={cx('approval-foot')}>
        <Button ref={cancelRef} variant="outline" size="sm" data-part="approval-cancel" onClick={onCancel}>
          {cancelLabel ?? t('kit.approval.not_now')}
        </Button>
        <Button
          variant={tone === 'destructive' ? 'destructive' : 'default'}
          size="sm"
          data-part="approval-confirm"
          loading={busy}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </section>
  )
}

export function ApprovalCardSkeleton({ effects = 3 }: { effects?: number }) {
  return (
    <section className={cx('approval')} data-part="approval" data-skeleton aria-busy="true">
      <div className={cx('approval-head')} aria-hidden="true">
        <span className={cx('approval-icon')} />
        <div className={cx('approval-titles')}>
          <span className={cx('approval-title t-head')}>
            <SkLines widths={['180px']} />
          </span>
        </div>
      </div>
      <ol className={cx('approval-effects t-body')} aria-hidden="true">
        {Array.from({ length: effects }, (_, i) => (
          <li key={i}>
            <SkLines widths={[`${50 + ((i * 13) % 30)}%`]} />
          </li>
        ))}
      </ol>
    </section>
  )
}
