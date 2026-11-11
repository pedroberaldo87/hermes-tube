// Channel avatar: the channel's real photo (`thumb`); the initial only shows when there is no photo or it fails.
// The fallback is drawn with a stable tone derived from the name by the SDK itself (`profileColor` +
// `profileColorSoft`, the same rule as the app's profile colors) — no fixed color in the plugin.
import { profileColor, profileColorSoft } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { safeImageUrl } from '../lib/safe-url'
import { cx } from '../lib/style'
import { SkBar, vars, withClass } from './kit'

export interface ChannelAvatarProps {
  title: string
  thumb: string | null | undefined
  /** Side in px (default 28). */
  size?: number
  className?: string
}

function initialOf(title: string): string {
  return (title.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toLocaleUpperCase()
}

/** Fallback tone: a stable hue from the name (SDK); without a name, the theme's secondary text. */
function toneOf(title: string): string {
  try {
    return profileColor(title.trim() || null) ?? 'var(--ui-text-secondary)'
  } catch {
    return 'var(--ui-text-secondary)'
  }
}

function softOf(tone: string): string {
  try {
    return profileColorSoft(tone, 18)
  } catch {
    return 'var(--ui-bg-tertiary)'
  }
}

export function ChannelAvatar({ title, thumb: raw, size = 28, className }: ChannelAvatarProps) {
  // only YouTube's image hosts: a stored thumb from anywhere else is never loaded (tracking, local files)
  const thumb = safeImageUrl(raw)
  const [broken, setBroken] = useState<string | null>(null)
  const style = { width: size, height: size, minWidth: size }
  const classes = withClass(cx('avatar'), className)
  if (thumb && broken !== thumb) {
    return (
      <img
        src={thumb}
        alt=""
        data-part="avatar"
        data-avatar
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(thumb)}
        style={style}
        className={classes}
      />
    )
  }
  const tone = toneOf(title)
  return (
    <span
      aria-hidden="true"
      data-part="avatar"
      data-fallback="true"
      style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.44)), ...vars({ 'avatar-tone': tone, 'avatar-soft': softOf(tone) }) }}
      className={withClass(cx('avatar avatar-fallback'), className)}
    >
      {initialOf(title)}
    </span>
  )
}

export function ChannelAvatarSkeleton({ size = 28 }: { size?: number }) {
  return (
    <span aria-hidden="true" data-part="avatar" data-skeleton style={{ width: size, height: size, minWidth: size }} className={cx('avatar')}>
      <SkBar shape="round" />
    </span>
  )
}
