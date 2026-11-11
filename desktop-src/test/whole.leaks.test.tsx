// Leaks: mount and unmount the WHOLE plugin 20 times (register, chip, pane, the pages
// and the dialogs, with navigation) and unload (unload = the ctx's onDispose). After each round: zero
// live timers, zero gateway event listeners, zero listeners on document/window, zero plugin <style>,
// zero queries in flight or with an observer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STYLE_ATTR } from '../lib/style'
import { flush } from './render'
import { queryClient, sdkMock } from './sdk-mock'
import { DIALOG_SURFACES, PAGES, type WholePlugin, startPlugin } from './whole/mount'

type Add = typeof EventTarget.prototype.addEventListener
type Remove = typeof EventTarget.prototype.removeEventListener

/** Live listeners on document/window (added − removed), per target and type. */
function trackDomListeners() {
  const live = new Map<string, number>()
  const origAdd: Add = EventTarget.prototype.addEventListener
  const origRemove: Remove = EventTarget.prototype.removeEventListener
  const seen = new WeakMap<object, Set<string>>()
  const name = (t: EventTarget) => (t === document ? 'document' : t === window ? 'window' : null)
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: Parameters<Add>[1], opts?: Parameters<Add>[2]) {
    const who = name(this)
    if (who && fn) {
      const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
      const id = `${who}:${type}:${capture}`
      const set = seen.get(fn) ?? new Set<string>()
      if (!set.has(id)) {
        set.add(id)
        seen.set(fn, set)
        live.set(`${who}:${type}`, (live.get(`${who}:${type}`) ?? 0) + 1)
      }
    }
    return origAdd.call(this, type, fn, opts)
  } as Add
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: Parameters<Remove>[1], opts?: Parameters<Remove>[2]) {
    const who = name(this)
    if (who && fn) {
      const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
      const id = `${who}:${type}:${capture}`
      const set = seen.get(fn)
      if (set?.delete(id)) live.set(`${who}:${type}`, (live.get(`${who}:${type}`) ?? 0) - 1)
    }
    return origRemove.call(this, type, fn, opts)
  } as Remove
  return {
    live: () => Object.fromEntries([...live].filter(([, n]) => n !== 0)),
    restore() {
      EventTarget.prototype.addEventListener = origAdd
      EventTarget.prototype.removeEventListener = origRemove
    }
  }
}

function leftovers() {
  const gateway = [...sdkMock.eventListeners].filter(([, set]) => set.size > 0).map(([type, set]) => `${type}×${set.size}`)
  const styles = document.head.querySelectorAll(`style[${STYLE_ATTR}]`).length
  const queries = [...queryClient.queries.values()]
  return {
    timers: vi.getTimerCount(),
    gateway,
    styles,
    fetching: queries.filter((q) => q.state.fetchStatus === 'fetching').map((q) => JSON.stringify(q.queryKey.slice(2))),
    observed: queries.filter((q) => q.observers.size > 0).map((q) => JSON.stringify(q.queryKey.slice(2)))
  }
}

const CLEAN = { timers: 0, gateway: [], styles: 0, fetching: [], observed: [] }

let app: WholePlugin | null = null
let dom: ReturnType<typeof trackDomListeners>

beforeEach(() => {
  vi.useFakeTimers()
  dom = trackDomListeners()
})

afterEach(() => {
  app?.dispose()
  app = null
  dom.restore()
})

async function wholeSession(a: WholePlugin, round: number) {
  await a.mount('chip')
  await a.mount('pane')
  // each round navigates in a different order and opens a different dialog on top
  const pages = [...PAGES.slice(round % PAGES.length), ...PAGES.slice(0, round % PAGES.length)]
  for (const p of pages) await a.mount(p)
  const dialog = DIALOG_SURFACES[round % DIALOG_SURFACES.length]
  await a.mount(`dialog:${dialog}`)
  // the clock moves: scheduled polls, UI timers and the /status poll come into play
  await vi.advanceTimersByTimeAsync(12_000)
  await a.settle()
}

describe('mount and unmount the whole plugin 20 times', () => {
  it('the probe sees what is left (negative proof)', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    const during = leftovers()
    expect(during.styles).toBe(1)
    expect(during.observed.length).toBeGreaterThan(0)
    expect(during.timers).toBeGreaterThan(0) // /status poll scheduled
    app.dispose()
    app = null
    await flush()
    expect(leftovers()).toEqual(CLEAN)
  })

  it('20 rounds: nothing alive after each unload', async () => {
    for (let round = 0; round < 20; round++) {
      app = startPlugin()
      await wholeSession(app, round)
      expect(app.errors).toEqual([])
      app.dispose()
      app = null
      await flush()
      expect({ round, ...leftovers() }).toEqual({ round, ...CLEAN })
      expect(dom.live(), `listeners on document/window in round ${round}`).toEqual({})
    }
  }, 90_000)
})
