// Shared welcome pieces: localized plural, "closes by itself" with countdown and
// "stay here", and the "visible window" shortcut that turns the live wait on/off.
import { Button, useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Stack, formatNumber, useLocale } from '../../components'
import { useT } from '../../lib/i18n'
import { $windowVisible } from '../../lib/status'
import { cx } from '../../lib/style'
import { AUTO_CLOSE_S, pluralCategory } from './model'

export type Countable = 'channels' | 'folders' | 'videos'

/** `plural('channels', 212)` → "212 channels" / "212 canais" (number per the app language). */
export function usePlural(): (what: Countable, count: number) => string {
  const t = useT('onboarding')
  const locale = useLocale()
  return useCallback(
    (what: Countable, count: number) => t(`plural.${what}_${pluralCategory(count)}`, { count: formatNumber(count, locale) }),
    [t, locale]
  )
}

/** Visible window: the live wait only queries while the window is in view. */
export function useWindowVisible(): boolean {
  return useValue($windowVisible)
}

/**
 * Automatic close once the channels arrived: counts `AUTO_CLOSE_S` seconds and calls `onDone` (once).
 * "Stay here" cancels; "See my subscriptions" closes at once.
 */
export function AutoClose({ onDone }: { onDone: () => void }) {
  const t = useT('onboarding')
  const locale = useLocale()
  const [left, setLeft] = useState(AUTO_CLOSE_S)
  const [stayed, setStayed] = useState(false)
  const fired = useRef(false)
  const done = useCallback(() => {
    if (fired.current) return
    fired.current = true
    onDone()
  }, [onDone])

  useEffect(() => {
    if (stayed) return undefined
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000)
    return () => clearInterval(id)
  }, [stayed])

  useEffect(() => {
    if (!stayed && left <= 0) done()
  }, [left, stayed, done])

  return (
    <div data-part="auto-close">
      <Stack direction="row" gap={2} justify="between" wrap>
        <span className={cx('t-label num')} role="status" aria-live="polite">
          {stayed ? null : t('done.closing', { seconds: formatNumber(left, locale) })}
        </span>
        <Stack direction="row" gap={2}>
          {stayed ? null : (
            <Button variant="ghost" size="sm" data-part="auto-close-stay" onClick={() => setStayed(true)}>
              {t('done.stay')}
            </Button>
          )}
          <Button size="sm" data-part="auto-close-now" onClick={done}>
            {t('done.open_now')}
          </Button>
        </Stack>
      </Stack>
    </div>
  )
}
