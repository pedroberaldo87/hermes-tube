// Internal kit pieces: class joining, skeleton bars, relative time and locale.
// Skeleton: the skeleton line uses the SAME typography class as the real line and a 1lh height, with an
// SDK bar (`Skeleton`) centered — so the skeleton box is the same as the final one (zero layout shift).
import { Skeleton, useI18n } from '@hermes/plugin-sdk'
import { type CSSProperties, createContext, useContext } from 'react'
import { formatCount, formatRelativeTime } from '../lib/format'
import { cssVar, cx } from '../lib/style'

/** Kit class + the `className` passed by the caller (which should also come from `cx`). */
export function withClass(base: string, extra?: string | null): string {
  return extra ? `${base} ${extra}` : base
}

/** Style with the plugin's CSS variables: `vars({ level: 2 })` → `{ '--<prefix>level': 2 }`. */
export function vars(values: Record<string, string | number>): CSSProperties {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(values)) out[cssVar(k)] = v
  return out as CSSProperties
}

/** Skeleton bar (the SDK's Skeleton) with a relative width. */
export function SkBar({ width = '72%', shape }: { width?: string; shape?: 'block' | 'round' }) {
  return <Skeleton className={cx('sk')} data-shape={shape} style={shape ? undefined : vars({ 'sk-w': width })} />
}

/** Skeleton lines inside the box of a text line (they inherit the parent's typography). */
export function SkLines({ widths }: { widths: readonly string[] }) {
  return (
    <>
      {widths.map((w, i) => (
        <span key={i} className={cx('sk-line')}>
          <SkBar width={w} />
        </span>
      ))}
    </>
  )
}

/** Active app locale (for dates and numbers); without an i18n provider, `en`. */
export function useLocale(): string {
  try {
    const value = useI18n() as { locale?: unknown } | null | undefined
    return typeof value?.locale === 'string' && value.locale ? value.locale : 'en'
  } catch {
    return 'en'
  }
}

/** App language in the format the server understands (`ui_locale`): Portuguese → `pt-BR`, the rest → `en`. */
export function useUiLocale(): 'en' | 'pt-BR' {
  return useLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

/** Short localized relative time: (ts in seconds, now in ms) → "2 hr. ago" / "há 3 dias". */
export function formatRelative(tsSeconds: number | null | undefined, nowMs: number, locale: string): string {
  return formatRelativeTime(tsSeconds, nowMs, locale)
}

/** Number with the locale separator and tabular figures (the `num` class handles the drawing). */
export function formatNumber(value: number, locale: string): string {
  return formatCount(value, locale)
}

/** Count in the app language (for text nodes: tabs, sections, chips, tree). */
export function useFormatCount(): (value: number) => string {
  const locale = useLocale()
  return (value: number) => formatCount(value, locale)
}

/** Actions always visible and labelled (VideoCard's `featured` turns it on for the QuickActions inside). */
export const PersistentActionsContext = createContext(false)

/** Inside a Grid (the Provider lives in Grid.tsx). */
export const GridContext = createContext(false)

/** True inside a Grid: inner buttons leave the Tab order (the keyboard uses the shortcuts). */
export function useInGrid(): boolean {
  return useContext(GridContext)
}
