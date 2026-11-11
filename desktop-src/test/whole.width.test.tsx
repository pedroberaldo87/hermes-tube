// Live width (jsdom): the surface mounts at one width and the container changes live, crossing
// every container-query limit in the plugin CSS (and the JS limit of Manage). jsdom
// does no layout, so the proof here is structural: the same data nodes (video and channel titles, device,
// suggested folder) stay mounted — the SAME element, with the same text — and nothing throws.
// A controlled ResizeObserver hands the widths to whoever measures (Subscriptions, Manage, grid, tabs, dialog).
// The proof with real layout (Chromium resizing an already mounted scenario) is in whole.width.browser.test.ts.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NARROW_PX as MANAGE_NARROW_PX } from '../pages/manage'
import themeEn from '../locales/en/theme.json'
import { type SurfaceId, type WholePlugin, startPlugin } from './whole/mount'
import { containerLimits, sweep } from './whole/widths'

type Callback = (entries: Array<{ target: Element; contentRect: DOMRectReadOnly }>, ro: unknown) => void

const observers = new Set<FakeResizeObserver>()

class FakeResizeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly cb: Callback) {
    observers.add(this)
  }
  observe(t: Element) {
    this.targets.add(t)
  }
  unobserve(t: Element) {
    this.targets.delete(t)
  }
  disconnect() {
    this.targets.clear()
    observers.delete(this)
  }
}

function rect(width: number): DOMRectReadOnly {
  return { width, height: 640, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 640, toJSON: () => ({}) } as DOMRectReadOnly
}

/** Changes the width of the surface container and notifies every observer (like the browser when the sidebar opens). */
function resize(root: HTMLElement, width: number) {
  root.style.width = `${width}px`
  act(() => {
    for (const ro of [...observers]) {
      const entries = [...ro.targets].map((target) => ({ target, contentRect: rect(width) }))
      if (entries.length) ro.cb(entries, ro)
    }
  })
}

/** Data texts the surface shows, from the world (not from the design). */
function dataTexts(app: WholePlugin, id: SurfaceId): string[] {
  const w = app.world
  if (id === 'dialog:theme') return [themeEn.examples.ex1, themeEn.examples.ex2]
  return [...w.videos.map((v) => v.title), ...w.active().map((c) => c.title), ...w.devices.map((d) => d.name), 'Music theory']
}

/** Innermost nodes whose text is exactly a data value. */
function dataNodes(root: HTMLElement, texts: readonly string[]): Element[] {
  const want = new Set(texts)
  return [...root.querySelectorAll('*')].filter((el) => {
    const t = (el.textContent ?? '').trim()
    return want.has(t) && ![...el.children].some((c) => (c.textContent ?? '').trim() === t)
  })
}

const SURFACES: SurfaceId[] = ['home', 'manage', 'cleanup', 'dialog:onboarding', 'dialog:organize', 'dialog:theme']

let app: WholePlugin | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  app?.dispose()
  app = null
  observers.clear()
  vi.unstubAllGlobals()
})

describe('limites lidos do CSS', () => {
  it('there are container queries with a px width (what the sweep crosses)', () => {
    const limits = containerLimits()
    expect(limits.length).toBeGreaterThan(5)
    expect(new Set(limits.map((l) => l.name)).size).toBeGreaterThan(3)
    const widths = sweep(limits.map((l) => l.px))
    for (const l of limits) {
      expect(widths).toContain(l.px + 1)
      expect(widths).toContain(l.px - 1)
    }
  })
})

describe('live width: nothing disappears when crossing the limits', () => {
  const limits = [...containerLimits().map((l) => l.px), MANAGE_NARROW_PX]
  const widths = sweep(limits)
  const start = Math.max(...limits) + 200

  it.each(SURFACES)('%s', async (id) => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount(id)
    const root = app.root(id) as HTMLElement
    expect(root).not.toBeNull()
    resize(root, start)
    await app.settle()
    const nodes = dataNodes(root, dataTexts(app, id))
    expect(nodes.length, `${id}: no data node to follow`).toBeGreaterThan(0)
    const before = nodes.map((n) => n.textContent)
    const narrowSeen = new Set<string>()
    for (const w of widths) {
      resize(root, w)
      await app.settle(4)
      narrowSeen.add(String(root.querySelector('[data-part="manage"]')?.getAttribute('data-narrow') ?? 'false'))
      const gone = nodes.filter((n) => !n.isConnected).map((n) => n.textContent)
      expect(gone, `${id} at ${w}px: data nodes unmounted`).toEqual([])
      expect(nodes.map((n) => n.textContent), `${id} a ${w}px: texto mudou`).toEqual(before)
      expect(app.root(id)?.querySelector('[data-whole-crash]')).toBeNull()
    }
    // the change really is live: Manage went through both sides of its limit (list ↔ selector)
    if (id === 'manage') expect([...narrowSeen].sort()).toEqual(['false', 'true'])
    expect(app.errors).toEqual([])
  }, 30_000)
})
