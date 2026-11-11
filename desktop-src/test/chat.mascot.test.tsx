// Mascot: a bubble when a ⭐ channel publishes (from `fav_new` in `/status`), at most one per channel per
// day (remembered in `ctx.storage`, survives a reload), never on the first read of a new device,
// text through i18n (EN and PT-BR), can be turned off (preference + optional backend field) and short (≤ 120).
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FavNew, StatusResponse } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { mascotLines } from '../chat'
import { MASCOT_KEYS, MascotSettings, isMascotEnabled, setMascotEnabled } from '../chat/mascot'
import enChat from '../locales/en/chat.json'
import ptChat from '../locales/pt-BR/chat.json'
import { setPluginContext } from '../lib/ctx'
import { interpolate, registerLocales } from '../lib/i18n'
import { click, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }
function textOf(tree: unknown, key: string, vars?: Record<string, string | number>): string {
  let node = tree as Tree | string
  for (const part of key.split('.')) node = (node as Tree)[part]
  return interpolate(node as string, vars)
}
const en = (key: string, vars?: Record<string, string | number>) => textOf(enChat, key, vars)
const pt = (key: string, vars?: Record<string, string | number>) => textOf(ptChat, key, vars)

const BASE: StatusResponse = {
  new_total: 0,
  new_by_tab: [],
  fav_new: [],
  ext_endpoint_up: true,
  last_rss_at: null,
  refresh_running: false,
  queue_pending: 0,
  search_pending: 0,
  devices_online: 0,
  ext_port: null,
  rss_down_since: null,
  rss_fallback_channels: 0
}

function fav(channel: string, video: string | null, title: string | null = `Video ${video}`, name = `Channel ${channel}`): FavNew {
  return { channel_id: channel, title: name, count: 1, latest_video_id: video, latest_title: title }
}
const status = (...favs: FavNew[]): StatusResponse => ({ ...BASE, fav_new: favs })

let handle: ReturnType<typeof createMockCtx>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0, 0))
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mascotLines', () => {
  it('first read of a new device: only learns, does not speak', () => {
    expect(mascotLines(null, status(fav('UC1', 'v1')))).toEqual([])
    expect(mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v1')))).toEqual([])
  })

  it('favorite publishes → one line (stable id per channel, text in the app language)', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    const lines = mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2', 'Why the sky is blue', 'Veritasium')))
    expect(lines).toEqual([{ id: 'fav:UC1', text: en('mascot.published', { channel: 'Veritasium', title: 'Why the sky is blue' }) }])
  })

  it('at most one bubble per channel per day; the next day it speaks again', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    expect(mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2')))).toHaveLength(1)
    expect(mascotLines(status(fav('UC1', 'v2')), status(fav('UC1', 'v3')))).toEqual([])
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 0))
    expect(mascotLines(status(fav('UC1', 'v3')), status(fav('UC1', 'v4')))).toEqual([])
    vi.setSystemTime(new Date(2026, 10, 11, 0, 1, 0))
    expect(mascotLines(status(fav('UC1', 'v4')), status(fav('UC1', 'v5')))).toHaveLength(1)
  })

  it('the limit and what was already seen survive a reload (ctx.storage); a video published while the app was closed is announced', () => {
    mascotLines(null, status(fav('UC1', 'v1'), fav('UC2', 'w1')))
    expect(mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2'), fav('UC2', 'w1')))).toHaveLength(1)
    // reload: new context with the same storage
    const saved = new Map(handle.storage)
    handle = createMockCtx(PLUGIN_ID)
    for (const [k, v] of saved) handle.storage.set(k, v)
    setPluginContext(handle.ctx)
    registerLocales(handle.ctx)
    const lines = mascotLines(null, status(fav('UC1', 'v3'), fav('UC2', 'w2')))
    expect(lines.map((l) => l.id)).toEqual(['fav:UC2'])
  })

  it('no new video (channel leaves the list or latest is null) does not speak', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    expect(mascotLines(status(fav('UC1', 'v1')), status())).toEqual([])
    expect(mascotLines(status(), status(fav('UC1', null)))).toEqual([])
    expect(mascotLines(status(fav('UC1', null)), status(fav('UC1', 'v1')))).toEqual([])
  })

  it('video without a title → sentence without a title', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    expect(mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2', null, 'Fireship')))[0].text).toBe(
      en('mascot.published_untitled', { channel: 'Fireship' })
    )
  })

  it('several at once: 2 bubbles per channel + 1 summary; all count toward the daily limit', () => {
    const before = status(...['A', 'B', 'C', 'D', 'E'].map((c) => fav(c, `${c}1`)))
    const after = status(...['A', 'B', 'C', 'D', 'E'].map((c) => fav(c, `${c}2`)))
    mascotLines(null, before)
    const lines = mascotLines(before, after)
    expect(lines.map((l) => l.id)).toEqual(['fav:A', 'fav:B', 'fav:more'])
    expect(lines[2].text).toBe(en('mascot.more', { count: 3 }))
    const later = status(...['A', 'B', 'C', 'D', 'E'].map((c) => fav(c, `${c}3`)))
    expect(mascotLines(after, later)).toEqual([])
  })

  it('short text (the mascot cuts at 120): a long title becomes an ellipsis', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    const [line] = mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2', 'x'.repeat(300))))
    expect(line.text.length).toBeLessThanOrEqual(120)
    expect(line.text.endsWith('…')).toBe(true)
  })

  it('speaks the app language', () => {
    act(() => sdkMock.locale.set('pt-br'))
    mascotLines(null, status(fav('UC1', 'v1')))
    const [line] = mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2', 'Título', 'Canal')))
    expect(line.text).toBe(pt('mascot.published', { channel: 'Canal', title: 'Título' }))
  })

  it('turned off (preference): does not speak, but keeps learning (turning it back on does not dump the backlog)', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    setMascotEnabled(false)
    expect(handle.storage.get(MASCOT_KEYS.enabled)).toBe(false)
    expect(mascotLines(status(fav('UC1', 'v1')), status(fav('UC1', 'v2')))).toEqual([])
    setMascotEnabled(true)
    expect(mascotLines(status(fav('UC1', 'v2')), status(fav('UC1', 'v2')))).toEqual([])
    expect(mascotLines(status(fav('UC1', 'v2')), status(fav('UC1', 'v3')))).toHaveLength(1)
  })

  it('turned off by the backend (optional `mascot_favorites: false` field in /status) wins over the preference', () => {
    mascotLines(null, status(fav('UC1', 'v1')))
    const off = { ...status(fav('UC1', 'v2')), mascot_favorites: false } as StatusResponse
    expect(mascotLines(status(fav('UC1', 'v1')), off)).toEqual([])
  })
})

describe('MascotSettings', () => {
  it('switch turns it on/off and saves the preference; texts in the app language', () => {
    const view = render(<MascotSettings />)
    const sw = view.container.querySelector<HTMLInputElement>('[role="switch"]')!
    expect(sw.checked).toBe(true)
    expect(view.container.textContent).toContain(en('mascot.setting.title'))
    click(sw)
    expect(isMascotEnabled()).toBe(false)
    expect(view.container.querySelector<HTMLInputElement>('[role="switch"]')!.checked).toBe(false)
  })
})
