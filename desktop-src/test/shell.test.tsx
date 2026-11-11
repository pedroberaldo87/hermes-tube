// ShellHost: `GET /status` every ≤ 5 s while the window is visible (stops when hidden), events bring it forward,
// feeds $status (chip/pane) and the mascot through ctx.pet with a fallback; syncs the `extras` atom.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtrasState, StatusResponse } from '../../shared/api-types'
import { STATUS_POLL_MS, eventType } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { $extras } from '../lib/extras'
import { $petFallback } from '../lib/pet'
import { ShellHost, configureShell } from '../lib/shell'
import { $status, $windowVisible, bindWindowVisibility, useStatus } from '../lib/status'
import { advance, flush, render } from './render'
import { createMockCtx, emitEvent, sdkMock } from './sdk-mock'

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 3,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: 1762700000,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 0,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    ...over
  }
}

const EXTRAS: ExtrasState = {
  honest_thumbnails: true,
  hn_lens: false,
  hn_channels: false,
  import_lists: false,
  hn_dataset_ready: false,
  hn_video_count: 0,
  hn_credit: 'HackerTube (ODC-By)'
}

let statusSeq: StatusResponse[] = []
let statusServed = 0

function backend() {
  sdkMock.restHandler = (path) => {
    if (path === '/status') {
      const s = statusSeq[Math.min(statusServed, statusSeq.length - 1)] ?? status()
      statusServed += 1
      return { ok: true, data: s }
    }
    if (path === '/extras') return { ok: true, data: EXTRAS }
    return { ok: false, error: { code: 'not_found', message: path } }
  }
}

const statusCalls = () => sdkMock.restCalls.filter((c) => c.path === '/status').length

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

let handle: ReturnType<typeof createMockCtx>

beforeEach(() => {
  vi.useFakeTimers()
  statusSeq = []
  statusServed = 0
  handle = createMockCtx()
  setPluginContext(handle.ctx)
  bindWindowVisibility(handle.ctx)
  backend()
})

afterEach(() => {
  handle.dispose()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

describe('poll de GET /status', () => {
  it('polls every 5 s while the window is visible and stops when it goes away', async () => {
    render(<ShellHost />)
    await flush()
    expect(statusCalls()).toBe(1)
    await advance(STATUS_POLL_MS)
    expect(statusCalls()).toBe(2)
    await advance(STATUS_POLL_MS)
    expect(statusCalls()).toBe(3)
    setVisibility('hidden')
    expect($windowVisible.get()).toBe(false)
    await advance(STATUS_POLL_MS * 4)
    expect(statusCalls()).toBe(3)
    setVisibility('visible')
    await advance(STATUS_POLL_MS)
    expect(statusCalls()).toBeGreaterThanOrEqual(4)
  })

  it('several mounted ShellHosts (chip, pane, pages) run a single poll', async () => {
    render(
      <div>
        <ShellHost />
        <ShellHost />
        <ShellHost />
      </div>
    )
    await flush()
    await advance(STATUS_POLL_MS * 2)
    expect(statusCalls()).toBe(3)
  })

  it('refresh.done and queue.changed bring the poll forward', async () => {
    render(<ShellHost />)
    await flush()
    expect(statusCalls()).toBe(1)
    emitEvent(eventType('refresh.done'), { channels: 1, new_videos: 2, errors: {}, started_at: 1, finished_at: 2, partial: false })
    await flush()
    expect(statusCalls()).toBe(2)
    emitEvent(eventType('queue.changed'), { queue_ids: ['q1'], pending: 1 })
    await flush()
    expect(statusCalls()).toBe(3)
  })

  it('publishes the snapshot in $status and useStatus reads from the cache without its own poll', async () => {
    statusSeq = [status({ new_total: 7 })]
    function Chip() {
      const q = useStatus()
      return <span data-chip>{q.data ? q.data.new_total : '-'}</span>
    }
    const view = render(
      <div>
        <ShellHost />
        <Chip />
      </div>
    )
    await flush()
    expect($status.get()?.new_total).toBe(7)
    expect(view.container.querySelector('[data-chip]')?.textContent).toBe('7')
  })
})

describe('mascot (ctx.pet with fallback)', () => {
  const lines = (prev: StatusResponse | null, next: StatusResponse) =>
    prev && next.new_total > prev.new_total ? [{ id: 'fav', text: `+${next.new_total - prev.new_total}` }] : []

  it('speaks through ctx.pet when the mascot is visible', async () => {
    configureShell({ mascotLines: lines })
    statusSeq = [status({ new_total: 1 }), status({ new_total: 4 })]
    render(<ShellHost />)
    await flush()
    expect(sdkMock.petLines).toEqual([])
    await advance(STATUS_POLL_MS)
    expect(sdkMock.petLines.map((l) => l.text)).toEqual(['+3'])
    expect(sdkMock.petLines[0].options).toMatchObject({ id: 'fav' })
    expect($petFallback.get()).toBeNull()
  })

  it('without a visible mascot the line goes to the fallback (chip)', async () => {
    sdkMock.petVisible.set(false)
    configureShell({ mascotLines: lines })
    statusSeq = [status({ new_total: 1 }), status({ new_total: 2 })]
    render(<ShellHost />)
    await flush()
    await advance(STATUS_POLL_MS)
    expect(sdkMock.petLines).toEqual([])
    expect($petFallback.get()).toMatchObject({ id: 'fav', text: '+1' })
  })
})

describe('extras atom', () => {
  it('ShellHost reads GET /extras and writes $extras', async () => {
    render(<ShellHost />)
    await flush()
    expect($extras.get()).toEqual(EXTRAS)
  })
})
