// Designed states: loading, empty (always with a way forward), error (with try again) and
// "no RPC". `QueryView` accepts `skeleton` (same geometry as the final view) instead of the Loader.
// Title and text are kit markup, **not** the SDK's `EmptyState`/`ErrorState`: in the real app the
// `ErrorState` draws its own icon (there were two), sets the title in `text-xl` (it overflowed the side pane) and
// stretches the button; the preview showed none of this because the mock was simpler than the real component.
import { Button, Codicon, Loader } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import type { ApiError } from '../../shared/api-types'
import { MESSAGE_KEYS } from '../../shared/ids'
import { errorText, useT } from '../lib/i18n'
import { toApiError } from '../lib/rest'
import { cx } from '../lib/style'
import { withClass } from './kit'

export function LoadingState({ label, className, children }: { label?: string; className?: string; children?: ReactNode }) {
  const t = useT()
  return (
    <div className={withClass(cx('state'), className)} data-part="loading" aria-busy="true">
      {children ?? <Loader label={label ?? t('loading')} />}
    </div>
  )
}

/** Title + text of a state. `data-slot` matches the SDK components' (tests look it up). */
function StateCopy({ slot, title, description }: { slot: 'empty' | 'error'; title: string; description?: string }) {
  return (
    <div className={cx('state-copy')} data-slot={`${slot}-state`} role={slot === 'error' ? 'alert' : undefined}>
      <p className={cx('state-title')} data-slot={`${slot}-title`}>
        {title}
      </p>
      {description ? (
        <p className={cx('state-desc')} data-slot={`${slot}-description`}>
          {description}
        </p>
      ) : null}
    </div>
  )
}

export interface EmptyViewProps {
  title?: string
  description?: string
  /** The way forward (button, link). Every empty state must have one. */
  action?: ReactNode
  /** Codicon in the circle above the title. */
  icon?: string
  /** No minimum height (inside cards and panes). */
  compact?: boolean
}

export function EmptyView({ title, description, action, icon, compact }: EmptyViewProps) {
  const t = useT()
  return (
    <div className={cx('state')} data-part="empty" data-compact={compact ? 'true' : undefined}>
      {icon ? (
        <span className={cx('state-icon')} aria-hidden="true">
          <Codicon name={icon} size={20} />
        </span>
      ) : null}
      <StateCopy slot="empty" title={title ?? t('empty')} description={description} />
      {action ? <div className={cx('state-actions')}>{action}</div> : null}
    </div>
  )
}

/** Contract error (or anything thrown) with an optional "try again". */
export function ErrorView({
  error,
  onRetry,
  title,
  description,
  compact
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  /** What to do; without it, the error text is used. */
  description?: string
  compact?: boolean
}) {
  const t = useT()
  const api: ApiError = toApiError(error)
  return (
    <div className={cx('state')} data-part="error" data-tone="error" data-compact={compact ? 'true' : undefined}>
      <span className={cx('state-icon')} aria-hidden="true">
        <Codicon name="error" size={20} />
      </span>
      <StateCopy slot="error" title={title ?? t('error_title')} description={description ?? errorText(t, api)} />
      {onRetry ? (
        <div className={cx('state-actions')}>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** No RPC on this backend (`-32601`/no `plugin-rpc-v1`): AI and approval only from the local Desktop. */
export function RpcUnavailableNotice({ className }: { className?: string }) {
  const t = useT()
  return (
    <div className={withClass(cx('state'), className)} data-rpc-unavailable data-compact="true">
      <span className={cx('state-icon')} aria-hidden="true">
        <Codicon name="plug" size={20} />
      </span>
      <StateCopy slot="empty" title={t(MESSAGE_KEYS.openDesktopBackend)} />
    </div>
  )
}

interface QueryLike<T> {
  data: T | undefined
  error: unknown
  isPending?: boolean
  isLoading?: boolean
  refetch?: () => unknown
}

/** Renders loading/error/empty for a query and, with data, `children(data)`. */
export function QueryView<T>({
  query,
  children,
  isEmpty,
  empty,
  skeleton
}: {
  query: QueryLike<T>
  children: (data: T) => ReactNode
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  /** Loading with the final geometry (e.g. `<GridSkeleton/>`), instead of the Loader. */
  skeleton?: ReactNode
}) {
  if (query.data !== undefined) {
    if (isEmpty?.(query.data)) return <>{empty ?? <EmptyView />}</>
    return <>{children(query.data)}</>
  }
  if (query.error) return <ErrorView error={query.error} onRetry={query.refetch ? () => void query.refetch?.() : undefined} />
  return <>{skeleton ?? <LoadingState />}</>
}
