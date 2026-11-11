// "Why it is here" badge (kept for compatibility). New code uses `Why` (a subtle line,
// always visible): the design language forbids hiding the reason in a tooltip — here `detail` shows in the badge.
import { Badge, Codicon } from '@hermes/plugin-sdk'
import type { Why } from '../../shared/api-types'
import { cx } from '../lib/style'
import { withClass } from './kit'
import { WHY_ICON } from './misc'

export function WhyBadge({ why, className }: { why: Why; className?: string }) {
  return (
    <Badge variant="muted" size="xs" className={withClass(cx('why-badge'), className)} data-why data-via={why.via}>
      <Codicon name={WHY_ICON[why.via] ?? 'info'} size={11} />
      <span className={cx('truncate')}>{why.label}</span>
      {why.detail ? <span className={cx('why-detail')}>· {why.detail}</span> : null}
    </Badge>
  )
}
