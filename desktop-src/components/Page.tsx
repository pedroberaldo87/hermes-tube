// Screen structure: Page (header with title, subtitle and actions; bar; notice strip; scrollable
// area), Section, Toolbar, Banner and Stack. All responsive to the container (the page is the container).
import { Button, Codicon } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { useFormatCount } from './kit'

export interface PageProps {
  /** Title (h1). Without title and actions, the header disappears (e.g. welcome with `Hero`). */
  title?: ReactNode
  /** Line below the title (e.g. "12 new · updated 2 min ago"). */
  subtitle?: ReactNode
  /** Header buttons; the screen's main action is the only one with accent. */
  actions?: ReactNode
  /** Line below the header (tabs, filters, density). */
  toolbar?: ReactNode
  /** Subtle strip for a partial/degraded state (a `Banner`). */
  banner?: ReactNode
  /** Centered composition with a comfortable max width (welcome, page empty states). */
  narrow?: boolean
  children: ReactNode
}

export function Page({ title, subtitle, actions, toolbar, banner, narrow, children }: PageProps) {
  return (
    <div className={cx('page')} data-part="page" data-narrow={narrow ? 'true' : undefined}>
      {title || actions ? (
        <header className={cx('page-head')} data-part="page-head">
          <div className={cx('page-titles')}>
            {title ? <h1 className={cx('page-title t-title truncate')}>{title}</h1> : null}
            {subtitle ? <p className={cx('page-sub t-body truncate')}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={cx('page-actions')}>{actions}</div> : null}
        </header>
      ) : null}
      {toolbar ? (
        <div className={cx('page-toolbar')} data-part="page-toolbar">
          {toolbar}
        </div>
      ) : null}
      {banner ? (
        <div className={cx('page-banner')} data-part="page-banner">
          {banner}
        </div>
      ) : null}
      <div className={cx('page-body')} data-part="page-body">
        <div className={cx('page-inner')}>{children}</div>
      </div>
    </div>
  )
}

export interface SectionProps {
  title?: ReactNode
  /** Count next to the title (tabular figures). */
  count?: number | null
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  id?: string
}

export function Section({ title, count, description, actions, children, id }: SectionProps) {
  const fmt = useFormatCount()
  const head = title || description || actions
  return (
    <section className={cx('section')} data-part="section" id={id}>
      {head ? (
        <div className={cx('section-head')}>
          <div className={cx('section-titles')}>
            {title ? (
              <h2 className={cx('section-title t-head')}>
                <span className={cx('truncate')}>{title}</span>
                {count != null ? <span className={cx('section-count t-label num')}>{fmt(count)}</span> : null}
              </h2>
            ) : null}
            {description ? <p className={cx('section-desc t-body')}>{description}</p> : null}
          </div>
          {actions ? <div className={cx('section-actions')}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface ToolbarProps {
  /** Left side (filters, search); wraps when space runs out. */
  children?: ReactNode
  /** Right side (density, count, secondary actions). */
  end?: ReactNode
}

export function Toolbar({ children, end }: ToolbarProps) {
  return (
    <div className={cx('toolbar')} data-part="toolbar">
      <div className={cx('toolbar-start')}>{children}</div>
      {end ? <div className={cx('toolbar-end')}>{end}</div> : null}
    </div>
  )
}

export type BannerTone = 'info' | 'warning' | 'error'

export interface BannerProps {
  tone?: BannerTone
  title?: ReactNode
  children?: ReactNode
  /** Forward action (e.g. "Try again", "Reconnect"). */
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  /** Codicon instead of the tone's icon. */
  icon?: string
}

const BANNER_ICON: Record<BannerTone, string> = { info: 'info', warning: 'warning', error: 'error' }

export function Banner({ tone = 'info', title, children, action, onDismiss, icon }: BannerProps) {
  const t = useT()
  return (
    <div className={cx('banner t-body')} data-part="banner" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={cx('banner-icon')} aria-hidden="true">
        <Codicon name={icon ?? BANNER_ICON[tone]} size={15} />
      </span>
      <div className={cx('banner-text')}>
        {title ? <strong className={cx('banner-title')}>{title}</strong> : null}
        {children}
      </div>
      {action || onDismiss ? (
        <div className={cx('banner-actions')}>
          {action ? (
            <Button variant="ghost" size="xs" data-part="banner-action" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" size="icon-xs" data-part="banner-dismiss" aria-label={t('kit.banner.dismiss')} onClick={onDismiss}>
              <Codicon name="close" size={14} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export interface StackProps {
  children?: ReactNode
  direction?: 'column' | 'row'
  /** Step of the 4/8 px rhythm: 0, 1 (4), 2 (8), 3 (12), 4 (16), 5 (24), 6 (32). */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'between' | 'end'
  wrap?: boolean
}

export function Stack({ children, direction = 'column', gap = 2, align, justify, wrap }: StackProps) {
  return (
    <div
      className={cx('stack')}
      data-part="stack"
      data-direction={direction}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap ? 'true' : undefined}
    >
      {children}
    </div>
  )
}
