// Navigation and invalidation with the whole plugin mounted: an action on one screen updates the other
// mounted ones, without reloading anything. Counts the requests (one shared key = one request for every
// screen that reads it) and checks what each screen shows afterwards.
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { click } from './render'
import { button, drop, key, paneCount, paneParent, paneRow, typeInto } from './whole/dom'
import { type WholePlugin, startPlugin } from './whole/mount'
import { cacheShapeProblems } from './whole/probes'
import { NEELY, VERITASIUM } from './whole/world'

let app: WholePlugin | null = null

afterEach(() => {
  app?.dispose()
  app = null
})

/** Requests per route made during `fn`. */
async function delta(a: WholePlugin, fn: () => void | Promise<void>): Promise<Record<string, number>> {
  const before = a.world.calls.length
  await fn()
  await a.settle(25)
  const out: Record<string, number> = {}
  for (const c of a.world.calls.slice(before)) {
    const k = c.route ?? `? ${c.method} ${c.path}`
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function expandPane(a: WholePlugin, id: string) {
  const item = a.root('pane')?.querySelector(`[role="treeitem"][data-id="${id}"]`)
  if (item?.getAttribute('aria-expanded') === 'false') click(paneRow(a.root('pane'), id)?.querySelector('button[aria-label]') ?? null)
}

describe('an action on one screen updates the other mounted ones', () => {
  it('Manage: move a channel (drop on the folder) → pane and chip follow; one fetch per shared key', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount('manage')
    const pane = app.root('pane')
    expect(paneCount(pane, 'folder:f_science')).toBe('1')
    expect(paneCount(pane, 'unfiled')).toBe('2') // Adam Neely + The Verge

    const calls = await delta(app, () => {
      drop(app?.root('manage')?.querySelector('[data-part="rail-item"][data-folder="f_science"]') ?? null, `channel:${NEELY}`)
    })

    expect(app.world.channel(NEELY)?.folder_id).toBe('f_science')
    expect(calls['POST /channels/batch']).toBe(1)
    // pane (relation=subscribed,followed) + Manage (view: manage): two /channels keys, one fetch each
    expect(calls['GET /channels']).toBe(2)
    expect(calls['GET /state']).toBe(1) // only the pane reads it; one fetch
    expect(calls['GET /status']).toBe(1) // chip, pane and Manage share the key
    expect(paneCount(pane, 'folder:f_science')).toBe('2')
    expect(paneCount(pane, 'unfiled')).toBe('1')
    expandPane(app, 'folder:f_science')
    expect(paneParent(pane, `channel:${NEELY}`)).toBe('folder:f_science')
    expect(app.errors).toEqual([])
    expect(cacheShapeProblems()).toEqual([])
  })

  it('Manage: create a folder in the side list → the mounted pane shows the folder (GET /folders once for both)', async () => {
    app = startPlugin()
    await app.mount('pane')
    await app.mount('manage')
    const manage = app.root('manage')
    click(manage?.querySelector('[data-part="rail-new"]') ?? null)
    const input = manage?.querySelector<HTMLInputElement>('[data-part="rail-input"]') ?? null
    typeInto(input, 'Podcasts')
    const calls = await delta(app, () => key(input, 'Enter'))
    const created = app.world.folders.find((f) => f.name === 'Podcasts')
    expect(created).toBeTruthy()
    expect(calls['POST /folders']).toBe(1)
    expect(calls['GET /folders']).toBe(1)
    expect(app.root('pane')?.querySelector(`[role="treeitem"][data-id="folder:${created?.id}"]`)).not.toBeNull()
    expect(app.text('pane')).toContain('Podcasts')
  })

  it('pane: move a channel to the folder of the tab open in Subscriptions → Subscriptions shows its videos without reloading', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount('home')
    click(app.root('home')?.querySelector('[data-tab-id="tab_science"]') ?? null)
    await app.settle()
    expect(app.text('home')).toContain(`${app.world.channel(VERITASIUM)?.title} episode 1`)
    expect(app.text('home')).not.toContain('Adam Neely episode 1')

    expandPane(app, 'unfiled')
    const calls = await delta(app, () => {
      drop(paneRow(app?.root('pane') ?? null, 'folder:f_science'), `channel:${NEELY}`)
    })

    expect(calls['PATCH /channels/{id}']).toBe(1)
    expect(app.world.channel(NEELY)?.folder_id).toBe('f_science')
    expect(paneCount(app.root('pane'), 'folder:f_science')).toBe('2')
    // the "Science tab" (folder f_science) now includes Adam Neely: the open Subscriptions has to show
    expect(calls['GET /feed'] ?? 0).toBe(1)
    expect(app.text('home')).toContain('Adam Neely episode 1')
    expect(app.errors).toEqual([])
  })

  it('Subscriptions: mark as read → the mounted chip and pane go to zero (without reloading)', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount('home')
    const total = app.world.status().new_total
    expect(total).toBeGreaterThan(0)
    expect(app.text('chip')).toContain(String(total))
    expect(paneCount(app.root('pane'), 'folder:f_tech')).toBe('2')

    const calls = await delta(app, () => {
      click(button(app?.root('home') ?? null, 'Mark as read'))
    })

    expect(calls['POST /read']).toBe(1)
    expect(app.world.status().new_total).toBe(0)
    expect(calls['GET /status']).toBe(1) // chip, pane and Subscriptions: one key, one fetch
    expect(calls['GET /state']).toBe(1) // the pane follows the /status pulse
    expect(app.text('chip')).not.toContain(String(total))
    expect(paneCount(app.root('pane'), 'folder:f_tech')).toBeNull()
    expect(paneCount(app.root('pane'), 'all')).not.toBe(String(total))
    expect(app.errors).toEqual([])
  })

  it('navigating does not reload what chip and pane already show (the nodes stay; only the new page fetches its own data)', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount('home')
    const chipNode = app.root('chip')?.firstElementChild
    const calls = await delta(app, async () => {
      await app?.mount('manage')
      await app?.mount('cleanup')
      await act(async () => undefined)
    })
    expect(app.root('chip')?.firstElementChild).toBe(chipNode)
    // pane: none of its keys was refetched by the navigation
    expect(calls['GET /state'] ?? 0).toBe(0)
    expect(calls['GET /tabs'] ?? 0).toBe(0)
    expect(app.errors).toEqual([])
  })
})
