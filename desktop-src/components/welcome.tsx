// Welcome: PathCard (the 3 paths of the empty state; the main one carries the accent), PathGroup (grid
// that adapts to the container) and PairingCode (6 large digits, countdown, copy, expiry).
import { Button, Codicon, CopyButton } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { cx } from '../lib/style'
import { SkBar, SkLines, vars } from './kit'

export function PathGroup({ children, label }: { children?: ReactNode; label?: string }) {
  return (
    <div className={cx('paths')} data-part="paths" role="group" aria-label={label}>
      {children}
    </div>
  )
}

// --------------------------------------------------------------- Hero (welcome opening)

export interface HeroProps {
  /** Brand codicon (in a soft square). */
  icon?: string
  /** Welcome title (h1, typography level 1). */
  title: ReactNode
  /** The product line (e.g. `t('kit.welcome.tagline')` — "Your subscriptions. Your way."). */
  tagline?: ReactNode
  /** An optional supporting line. */
  description?: ReactNode
}

/** Centered welcome opening: brand, title (h1) and the product line. Use inside `Page narrow`. */
export function Hero({ icon, title, tagline, description }: HeroProps) {
  return (
    <header className={cx('hero')} data-part="hero">
      {icon ? (
        <span className={cx('hero-mark')} aria-hidden="true">
          <Codicon name={icon} size={22} />
        </span>
      ) : null}
      <h1 className={cx('hero-title t-title')}>{title}</h1>
      {tagline ? <p className={cx('hero-tagline t-head')}>{tagline}</p> : null}
      {description ? <p className={cx('hero-desc t-body')}>{description}</p> : null}
    </header>
  )
}

// --------------------------------------------------------------- PathCard

export interface PathCardProps {
  /** Codicon. */
  icon: string
  title: ReactNode
  description: ReactNode
  actionLabel: ReactNode
  onAction: () => void
  /** The main path (the only one with accent on the screen). */
  primary?: boolean
  /** Marks the recommended path with a visible label ("Recommended"). */
  recommended?: boolean
  /** Short hint next to the action (e.g. Kbd, "1 min"). */
  hint?: ReactNode
}

export function PathCard({ icon, title, description, actionLabel, onAction, primary, recommended, hint }: PathCardProps) {
  const t = useT()
  return (
    <article className={cx('path')} data-part="path-card" data-primary={primary ? 'true' : 'false'} data-recommended={recommended ? 'true' : undefined}>
      <div className={cx('path-top')}>
        <span className={cx('path-icon')} data-part="path-icon" aria-hidden="true">
          <Codicon name={icon} size={20} />
        </span>
        {recommended ? (
          <span className={cx('path-badge t-label')} data-part="path-badge">
            <Codicon name="star-full" size={11} className={cx('path-badge-icon')} />
            {t('kit.path.recommended')}
          </span>
        ) : null}
      </div>
      <h3 className={cx('path-title t-head')} data-part="path-title">
        {title}
      </h3>
      <p className={cx('path-desc t-body')} data-part="path-desc">
        {description}
      </p>
      <div className={cx('path-foot')} data-part="path-foot">
        <Button variant={primary ? 'default' : 'outline'} size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
        {hint ? <span className={cx('path-hint t-label')}>{hint}</span> : null}
      </div>
    </article>
  )
}

export function PathCardSkeleton() {
  return (
    <article className={cx('path')} data-part="path-card" data-skeleton aria-busy="true">
      <div className={cx('path-top')}>
        <span className={cx('path-icon')} data-part="path-icon" aria-hidden="true" />
      </div>
      <div className={cx('path-title t-head')} data-part="path-title" aria-hidden="true">
        <SkLines widths={['56%']} />
      </div>
      <div className={cx('path-desc t-body')} data-part="path-desc" aria-hidden="true">
        <SkLines widths={['100%', '74%']} />
      </div>
      <div className={cx('path-foot')} data-part="path-foot" aria-hidden="true">
        <span style={{ width: 88, height: 28, display: 'block' }}>
          <SkBar shape="block" />
        </span>
      </div>
    </article>
  )
}

export interface PairingCodeProps {
  /** 6 digits. */
  code: string
  /** When it expires (ms since the epoch). */
  expiresAt: number
  onRegenerate?: () => void
  label?: string
}

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PairingCode({ code, expiresAt, onRegenerate, label }: PairingCodeProps) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  const [total] = useState(() => Math.max(1, expiresAt - Date.now()))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const expired = left <= 0
  const digits = code.padEnd(6, ' ').slice(0, 6).split('')
  const title = label ?? t('kit.pairing.label')
  const digit = (d: string, i: number) => (
    <span key={i} className={cx('code-digit')} data-part="code-digit" aria-hidden="true">
      {d}
    </span>
  )
  return (
    <div className={cx('pairing')} data-part="pairing" data-expired={expired ? 'true' : 'false'}>
      <p className={cx('pairing-label t-label')}>{title}</p>
      <div className={cx('code')} role="img" aria-label={`${title}: ${digits.join(' ')}`}>
        {digits.slice(0, 3).map(digit)}
        <span className={cx('code-sep')} aria-hidden="true" />
        {digits.slice(3).map((d, i) => digit(d, i + 3))}
      </div>
      <div className={cx('pairing-foot t-label')}>
        {expired ? (
          <>
            <span>{t('kit.pairing.expired')}</span>
            {onRegenerate ? (
              <Button variant="outline" size="xs" data-part="pairing-regenerate" onClick={onRegenerate}>
                <Codicon name="refresh" size={12} />
                {t('kit.pairing.regenerate')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className={cx('pairing-bar')} aria-hidden="true">
              <span className={cx('pairing-bar-fill')} style={vars({ left: `${Math.round(((left * 1000) / total) * 100)}%` })} />
            </span>
            <span className={cx('num')}>{t('kit.pairing.expires', { time: mmss(left) })}</span>
            <CopyButton text={code} label={t('kit.pairing.copy')} />
          </>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------- PairingSteps (pairing step by step)

export type PairingStatus = 'waiting' | 'paired'

export interface PairingStepsProps {
  code: string
  /** When the code expires (ms since the epoch). */
  expiresAt: number
  onRegenerate?: () => void
  /** `waiting` (default): animated "waiting for the extension…" · `paired`: drawn success. */
  status?: PairingStatus
  /** Step 1 text below the title (default: where the extension icon is). */
  openHint?: ReactNode
  /** Step 3 supporting text (default: "Your subscriptions show up here…"). */
  doneHint?: ReactNode
}

/** 1 open the extension · 2 type the code (PairingCode) · 3 done (waiting… → connected). */
export function PairingSteps({ code, expiresAt, onRegenerate, status = 'waiting', openHint, doneHint }: PairingStepsProps) {
  const t = useT()
  const paired = status === 'paired'
  const steps: Array<{ n: number; state: 'done' | 'current' | 'todo'; title: ReactNode; body: ReactNode }> = [
    { n: 1, state: paired ? 'done' : 'current', title: t('kit.pairing.step_open'), body: <p className={cx('pstep-hint t-body')}>{openHint ?? t('kit.pairing.step_open_hint')}</p> },
    {
      n: 2,
      state: paired ? 'done' : 'current',
      title: t('kit.pairing.step_code'),
      body: <PairingCode code={code} expiresAt={expiresAt} onRegenerate={onRegenerate} />
    },
    {
      n: 3,
      state: paired ? 'done' : 'todo',
      title: t('kit.pairing.step_done'),
      body: (
        <div className={cx('pstep-status')} data-part="pairing-status" data-status={status} role="status" aria-live="polite">
          {paired ? (
            <>
              <span className={cx('pstep-ok')} aria-hidden="true">
                <Codicon name="check" size={14} />
              </span>
              <span className={cx('pstep-status-text t-body')}>{t('kit.pairing.paired')}</span>
            </>
          ) : (
            <>
              <span className={cx('pstep-dots')} aria-hidden="true">
                <span className={cx('pstep-dot')} />
                <span className={cx('pstep-dot')} />
                <span className={cx('pstep-dot')} />
              </span>
              <span className={cx('pstep-status-text t-body')}>{t('kit.pairing.waiting')}</span>
            </>
          )}
          <span className={cx('pstep-hint t-label')}>{doneHint ?? t('kit.pairing.done_hint')}</span>
        </div>
      )
    }
  ]
  return (
    <ol className={cx('psteps')} data-part="pairing-steps" data-status={status} aria-label={t('kit.pairing.steps_label')}>
      {steps.map((s) => (
        <li key={s.n} className={cx('pstep')} data-part="pairing-step" data-step={s.n} data-state={s.state}>
          <span className={cx('pstep-num num')} aria-hidden="true">
            {s.state === 'done' ? <Codicon name="check" size={13} /> : s.n}
          </span>
          <div className={cx('pstep-body')}>
            <p className={cx('pstep-title t-head')}>
              <span className={cx('sr')}>{s.n}. </span>
              {s.title}
            </p>
            {s.body}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function PairingCodeSkeleton() {
  return (
    <div className={cx('pairing')} data-part="pairing" data-skeleton aria-busy="true">
      <p className={cx('pairing-label t-label')} aria-hidden="true">
        <SkLines widths={['96px']} />
      </p>
      <div className={cx('code')} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx('code-digit')} data-part="code-digit" />
        ))}
        <span className={cx('code-sep')} />
        {[3, 4, 5].map((i) => (
          <span key={i} className={cx('code-digit')} data-part="code-digit" />
        ))}
      </div>
    </div>
  )
}
