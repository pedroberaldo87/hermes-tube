// Mascot: when a starred channel publishes (`fav_new` from `/status`), a short line in the bubble
// (`sayToPet` from the shell; without a mascot it goes to the chip). Rules:
//  - a new device (nothing stored) only learns on the first read — it never dumps the backlog;
//  - what was already seen (latest video per channel) and the daily limit live in `ctx.storage` (they survive
//    a reload): a video published while the app was closed is announced on return;
//  - at most ONE bubble per channel per day (local day); several at once: 2 per channel + 1 summary;
//  - can be turned off: local preference (`MascotSettings`) and, when the backend sends it, `mascot_favorites` in
//    `/status` (contract request) wins; while off it keeps learning (turning it back on dumps nothing);
//  - text through i18n (namespace `chat`), ≤ 120 characters (the mascot cuts there; here with an ellipsis).
import { Codicon, Switch } from '@hermes/plugin-sdk'
import { useState } from 'react'
import type { FavNew, StatusResponse } from '../../shared/api-types'
import { Stack } from '../components'
import { maybePluginContext } from '../lib/ctx'
import { tNow, useT } from '../lib/i18n'
import { onShellReset } from '../lib/lifecycle'
import type { MascotLine } from '../lib/pet'
import { CLASS_PREFIX, cx } from '../lib/style'

/** Keys in the plugin's `ctx.storage`. */
export const MASCOT_KEYS = {
  enabled: 'chat.mascot.enabled',
  /** channel_id → last `latest_video_id` seen. */
  seen: 'chat.mascot.seen',
  /** channel_id → local day (YYYY-MM-DD) of the last bubble. */
  said: 'chat.mascot.said'
} as const

/** Mascot bubble limit (the host cuts at 120). */
export const MASCOT_MAX_CHARS = 120
/** Individual bubbles per read; the rest becomes a summary. */
export const MASCOT_MAX_LINES = 2

type DayLog = Record<string, string>
type Seen = Record<string, string>

// without ctx (tests, old preview): module memory
const memory = new Map<string, unknown>()
onShellReset(() => memory.clear())

function read<T>(key: string, fallback: T): T {
  const storage = maybePluginContext()?.storage
  try {
    if (storage) return storage.get<T>(key, fallback)
  } catch {
    /* unreadable storage: carry on with the default */
  }
  return memory.has(key) ? (memory.get(key) as T) : fallback
}

function write(key: string, value: unknown): void {
  const storage = maybePluginContext()?.storage
  try {
    if (storage) {
      storage.set(key, value)
      return
    }
  } catch {
    /* no storage: memory */
  }
  memory.set(key, value)
}

function isRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function isMascotEnabled(): boolean {
  return read<unknown>(MASCOT_KEYS.enabled, true) !== false
}

export function setMascotEnabled(on: boolean): void {
  write(MASCOT_KEYS.enabled, on)
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function lineFor(f: FavNew): string {
  const channel = clip(f.title || '', 48)
  if (!f.latest_title) return clip(tNow('chat', 'mascot.published_untitled', { channel }), MASCOT_MAX_CHARS)
  const empty = tNow('chat', 'mascot.published', { channel, title: '' })
  const room = Math.max(12, MASCOT_MAX_CHARS - empty.length)
  return clip(tNow('chat', 'mascot.published', { channel, title: clip(f.latest_title, room) }), MASCOT_MAX_CHARS)
}

/** Status with the optional backend setting field (`mascot_favorites`). */
type StatusWithSetting = StatusResponse & { mascot_favorites?: unknown }

/**
 * Mascot lines for a `/status` change (the shell calls this on every new read).
 * `prev` only says whether this is the first read of the session; the truth about what was seen is kept in storage.
 */
export function mascotLines(prev: StatusResponse | null, next: StatusResponse): MascotLine[] {
  void prev
  const favs = (Array.isArray(next?.fav_new) ? next.fav_new : []).filter((f) => f && typeof f.channel_id === 'string')
  const storedSeen = read<unknown>(MASCOT_KEYS.seen, null)
  const firstEver = !isRecord(storedSeen)
  const seen: Seen = firstEver ? {} : { ...storedSeen }
  const day = today()
  const storedSaid = read<unknown>(MASCOT_KEYS.said, {})
  // only today matters: the rest is dropped (the record does not grow)
  const said: DayLog = Object.fromEntries(Object.entries(isRecord(storedSaid) ? storedSaid : {}).filter(([, d]) => d === day))

  const fresh: FavNew[] = []
  for (const f of favs) {
    const vid = f.latest_video_id
    if (!vid) continue
    if (!firstEver && seen[f.channel_id] !== vid && said[f.channel_id] !== day) fresh.push(f)
    seen[f.channel_id] = vid
  }

  const enabled = isMascotEnabled() && (next as StatusWithSetting).mascot_favorites !== false
  const lines: MascotLine[] = []
  if (enabled && fresh.length) {
    const shown = fresh.length > MASCOT_MAX_LINES + 1 ? fresh.slice(0, MASCOT_MAX_LINES) : fresh
    for (const f of shown) lines.push({ id: `fav:${f.channel_id}`, text: lineFor(f) })
    const rest = fresh.length - shown.length
    if (rest > 0) lines.push({ id: 'fav:more', text: clip(tNow('chat', 'mascot.more', { count: rest }), MASCOT_MAX_CHARS) })
    for (const f of fresh) said[f.channel_id] = day
  }
  write(MASCOT_KEYS.seen, seen)
  write(MASCOT_KEYS.said, said)
  return lines
}

/** Setting "the mascot announces when a favorite publishes" (for the plugin's settings page). */
export function MascotSettings() {
  const t = useT('chat')
  const [on, setOn] = useState(isMascotEnabled)
  const id = `${CLASS_PREFIX}mascot-setting`
  return (
    <Stack direction="row" gap={4} align="center" justify="between">
      <Stack direction="row" gap={3} align="start">
        <Codicon name="star" size={16} />
        <Stack gap={1}>
          <label className={cx('t-body')} htmlFor={id}>
            {t('mascot.setting.title')}
          </label>
          <p className={cx('t-label')}>{t('mascot.setting.description')}</p>
        </Stack>
      </Stack>
      <Switch
        id={id}
        checked={on}
        aria-label={t('mascot.setting.title')}
        onCheckedChange={(value: boolean) => {
          setMascotEnabled(!!value)
          setOn(!!value)
        }}
      />
    </Stack>
  )
}
