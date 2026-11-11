// The whole plugin mounted together: ONE register(ctx), ONE query client, ONE REST world.
// Every arrival order between pane, chip, Subscriptions, Manage, Cleanup and the dialogs: screen B mounts without an exception
// and shows data with screen A already loaded (and the reverse). After everything is mounted, each raw cache key
// stores the route's raw response (validated against the generated contract, shared/api-types.ts).
// This class of hole brought Manage down in the real app: the pane stored `{items}` under
// GET /folders and Manage, loaded later, read the same key as a list ("folders.map is not a function").
import { afterEach, describe, expect, it } from 'vitest'
import { restQueryKey } from '../lib/rest'
import { queryClient } from './sdk-mock'
import { SURFACES, type SurfaceId, type WholePlugin, isDialog, isPage, startPlugin } from './whole/mount'
import { cacheShapeProblems, probe, restCacheEntries } from './whole/probes'
import { contractRoutes, isPlainKey, shapeProblems } from './whole/shape'
import { World } from './whole/world'

let app: WholePlugin | null = null

afterEach(() => {
  app?.dispose()
  app = null
})

function expectShown(a: WholePlugin, id: SurfaceId) {
  const r = probe(a, id)
  expect(r.ok, `${id}: ${r.why}`).toBe(true)
}

describe('a single registration', () => {
  it('the real register(ctx) contributes chip, pane and the pages; mounted together, one client and one world', async () => {
    app = startPlugin()
    await app.mount('chip')
    await app.mount('pane')
    await app.mount('home')
    expect(app.mounted().sort()).toEqual(['chip', 'home', 'pane'])
    for (const id of ['chip', 'pane', 'home'] as const) expectShown(app, id)
    // navigate: the page changes, chip and pane stay mounted (the same nodes)
    const paneRoot = app.root('pane')
    await app.mount('manage')
    expect(app.page()).toBe('manage')
    expect(app.root('pane')).toBe(paneRoot)
    expect(app.root('pane')?.isConnected).toBe(true)
    expectShown(app, 'manage')
    expectShown(app, 'pane')
    expect(app.errors).toEqual([])
    expect(app.world.missing).toEqual([])
    // one client: pane and Manage share GET /folders (one key, requested once so far)
    expect(app.world.count('GET /folders')).toBe(2) // pane on mount + Manage on mount (staleTime 0 = refetch)
    expect(queryClient.find(restQueryKey('GET /folders', {}))?.observers.size).toBe(2)
  })
})

describe('every arrival order', () => {
  const pairs: Array<[SurfaceId, SurfaceId]> = []
  for (const a of SURFACES) for (const b of SURFACES) if (a !== b) pairs.push([a, b])

  it.each(pairs)('%s loaded before, %s after: mounts without an exception and shows data', async (a, b) => {
    app = startPlugin()
    await app.mount(a)
    expectShown(app, a)
    // dialog over dialog: the top one covers the bottom one (DialogHost shows the top of the stack); page → page
    // is navigation (the route changes). In the other cases A stays mounted and with data.
    await app.mount(b)
    expectShown(app, b)
    const replaced = (isDialog(a) && isDialog(b)) || (isPage(a) && isPage(b))
    if (!replaced) expectShown(app, a)
    expect(app.errors).toEqual([])
    expect(app.world.missing).toEqual([])
    expect(cacheShapeProblems()).toEqual([])
  })
})

describe('cache shape', () => {
  it('the validator reads the generated contract and flags the wrong shape (negative proof)', () => {
    expect(contractRoutes()).toContain('GET /folders')
    const folder = { id: 'f', name: 'F', parent_id: null, color: null, sort: 0 }
    expect(shapeProblems('GET /folders', { items: [folder] })).toEqual([])
    // the real app defect: only the list under the raw-response key
    expect(shapeProblems('GET /folders', [folder]).join()).toMatch(/expected object/)
    expect(shapeProblems('GET /folders', { items: [{ ...folder, sort: '0' }] }).join()).toMatch(/items\[0\]\.sort: expected number/)
    expect(shapeProblems('GET /status', { new_total: 1 }).join()).toMatch(/required/)
    expect(shapeProblems('GET /channels', { items: [], total: 0, extra: 1 })).toEqual([]) // additive contract
    // differentiator = a name the route does not accept (a separate query, another shape allowed)
    expect(isPlainKey('GET /channels', null, { relation: 'ex', limit: 5 })).toBe(true)
    expect(isPlainKey('GET /channels', null, { view: 'manage' })).toBe(false)
    expect(isPlainKey('GET /feed', null, { source: 'tab:x' })).toBe(false)
  })

  it('the world answers each route with the contract shape', async () => {
    const world = new World()
    for (const route of world.routeKeys()) expect(contractRoutes(), route).toContain(route)
    const get = async (path: string) => ((await world.handle(path, { method: 'GET' })) as { data: unknown }).data
    const samples: Array<[string, string]> = [
      ['GET /status', '/status'],
      ['GET /state', '/state'],
      ['GET /folders', '/folders'],
      ['GET /tags', '/tags'],
      ['GET /tabs', '/tabs'],
      ['GET /channels', '/channels?limit=10'],
      ['GET /feed', '/feed?tab=all-new'],
      ['GET /cleanup', '/cleanup'],
      ['GET /queue', '/queue'],
      ['GET /suggestions', '/suggestions'],
      ['GET /devices', '/devices'],
      ['GET /extras', '/extras'],
      ['GET /ai/status', '/ai/status']
    ]
    for (const [route, path] of samples) expect(shapeProblems(route, await get(path)), route).toEqual([])
  })

  it('everything mounted (all screens and dialogs, in sequence): each raw key stores the route\'s raw response', async () => {
    app = startPlugin()
    for (const id of SURFACES) await app.mount(id)
    await app.settle(20)
    expect(app.errors).toEqual([])
    const entries = restCacheEntries()
    const routes = new Set(entries.filter((e) => e.plain).map((e) => e.route))
    // what the screens actually read (not an empty test)
    for (const r of ['GET /status', 'GET /folders', 'GET /tags', 'GET /tabs', 'GET /state', 'GET /channels', 'GET /cleanup', 'GET /suggestions', 'GET /devices']) {
      expect([...routes], r).toContain(r)
    }
    expect(cacheShapeProblems()).toEqual([])
    // keys with a differentiator stay out of the rule, but never collide with the raw one (the name differentiates)
    const own = entries.filter((e) => !e.plain).map((e) => JSON.stringify(e.key.slice(2)))
    expect(own.length).toBeGreaterThan(0)
  }, 30_000)
})
