// Scenarios behind the public screenshots (desktop-src/test/docs-screenshots/preview.scenarios.tsx): the expected ids,
// and every route answer built only from the invented sample catalog (docs/sample-data/catalog.json) — no real
// channel, no real video, no pt-BR text; ages, durations and the topic reasons as the catalog has them.
import { describe, expect, it } from 'vitest'
import { readRepoFile } from '../test/repo.mjs'

const IDS = [
  'docs-home',
  'docs-new-tab-menu',
  'docs-folder-pane',
  'docs-manage',
  'docs-cleanup',
  'docs-topic-tab-preview',
  'docs-watching-tab',
  'docs-topic-tab'
]

const read = (rel: string) => JSON.parse(readRepoFile(rel))
const catalog = read('docs/sample-data/catalog.json') as {
  folders: Array<{ key: string; name: string }>
  channels: Array<{ id: string; title: string; folder: string; favorite: boolean }>
  videos: Array<{ id: string; channel_id: string; title: string; duration_s: number; age_hours: number }>
  topic: { name: string; channels: Array<{ id: string; title: string }>; videos: Array<{ id: string; channel_id: string; title: string; duration_s: number; age_hours: number; reason: string }> }
}
const demo = read('plugin/data/demo_channels.json') as { channels: Array<{ id: string; title: string }> }

const SAMPLE_VIDEOS = new Map([...catalog.videos, ...catalog.topic.videos].map((v) => [v.id, v]))
const SAMPLE_CHANNELS = new Map([...catalog.channels, ...catalog.topic.channels].map((c) => [c.id, c]))
const REAL_TITLES = demo.channels.map((c) => c.title)
const REAL_IDS = new Set(demo.channels.map((c) => c.id))

const PORTUGUESE = /[ãõçáéíóúâêôà]|\b(de|da|dos|das|em|para|com|que|ao|você|seus|sem|nenhum|vídeos?|canais|favorito|ia)\b/

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

/** Every object in a value that has the given keys. */
function objects<T>(value: unknown, keys: string[], out: T[] = []): T[] {
  if (Array.isArray(value)) for (const v of value) objects(v, keys, out)
  else if (value && typeof value === 'object') {
    if (keys.every((k) => k in value)) out.push(value as T)
    for (const v of Object.values(value)) objects(v, keys, out)
  }
  return out
}

/** Answer of one route: the fixed value, or the function called with an empty request (pending → skipped). */
async function answer(value: unknown, query: Record<string, string> = {}): Promise<unknown> {
  if (typeof value !== 'function') return value
  const req = { method: 'GET', path: '/', params: { id: 'th_test' }, query, body: undefined }
  try {
    return await Promise.race([Promise.resolve((value as (r: unknown) => unknown)(req)), new Promise((r) => setTimeout(() => r(null), 50))])
  } catch {
    return null // a route that answers with an error has no text to check
  }
}

type Scenarios = (typeof import('../test/docs-screenshots/preview.scenarios'))['scenarios']

/** Every answer of every scenario, with a few queries the screens send (tabs, folders, the topic tab). */
async function allAnswers(scenarios: Scenarios): Promise<Array<[string, unknown]>> {
  const queries: Array<Record<string, string>> = [{}, { tab: 'all-new' }, { tab: 'favorites' }, { tab: 'tab_wildlife' }, { tab: 'tab_nature' }, { folder: 'f_tech' }, { ids: [...SAMPLE_VIDEOS.keys()].join(',') }]
  const out: Array<[string, unknown]> = []
  for (const s of scenarios) {
    for (const [route, value] of Object.entries({ ...(s.rest ?? {}), ...(s.rpc ?? {}) })) {
      for (const q of typeof value === 'function' ? queries : [{}]) out.push([`${s.id} ${route} ${JSON.stringify(q)}`, await answer(value, q)])
    }
  }
  return out
}

describe('public screenshot scenarios', () => {
  it('one scenario per README image (plus the topic tab for the video), each with its width', async () => {
    const { scenarios } = await import('../test/docs-screenshots/preview.scenarios')
    expect(scenarios.map((s) => s.id)).toEqual(IDS)
    for (const s of scenarios) {
      expect(typeof s.render, s.id).toBe('function')
      expect(s.widths, s.id).toEqual(s.id === 'docs-folder-pane' ? [320] : [1440])
    }
  })

  it('no real channel, no real id and no pt-BR string in any route answer', async () => {
    const { scenarios } = await import('../test/docs-screenshots/preview.scenarios')
    for (const [where, value] of await allAnswers(scenarios)) {
      const texts = strings(value)
      expect(
        texts.filter((t) => REAL_TITLES.some((n) => t.includes(n))),
        where
      ).toEqual([])
      expect(
        texts.filter((t) => REAL_IDS.has(t)),
        where
      ).toEqual([])
      expect(
        texts.filter((t) => !/^(https?:\/\/|@)/.test(t)).filter((t) => PORTUGUESE.test(t)),
        where
      ).toEqual([])
    }
  })

  it('videos and channels come from the sample catalog, with its titles, durations and ages', async () => {
    const { scenarios } = await import('../test/docs-screenshots/preview.scenarios')
    const now = Date.now() / 1000
    let videos = 0
    let channels = 0
    for (const [where, value] of await allAnswers(scenarios)) {
      for (const v of objects<{ id: string; title: string; duration_s: number; published_at: number; channel_id: string }>(value, ['id', 'title', 'duration_s', 'published_at'])) {
        const s = SAMPLE_VIDEOS.get(v.id)
        expect(s, `${where} video ${v.id}`).toBeDefined()
        expect(v.title, where).toBe(s!.title)
        expect(v.duration_s, where).toBe(s!.duration_s)
        expect(v.channel_id, where).toBe(s!.channel_id)
        expect(Math.abs(now - s!.age_hours * 3600 - v.published_at), `${where} age of ${v.id}`).toBeLessThan(120)
        videos++
      }
      for (const c of objects<{ id: string; title: string; thumb: string | null; relation: string }>(value, ['id', 'title', 'relation', 'thumb'])) {
        const s = SAMPLE_CHANNELS.get(c.id)
        expect(s, `${where} channel ${c.id}`).toBeDefined()
        expect(c.title, where).toBe(s!.title)
        expect(c.thumb, where).toMatch(/^https:\/\/yt3\.googleusercontent\.com\/sample-avatar\/UCsample/)
        channels++
      }
    }
    expect(videos).toBeGreaterThan(40)
    expect(channels).toBeGreaterThanOrEqual(18)
  })

  it('folders are the catalog folders; the topic tab and its preview carry the catalog reasons', async () => {
    const { scenarios } = await import('../test/docs-screenshots/preview.scenarios')
    const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]))
    const folders = (await answer(byId['docs-folder-pane'].rest!['GET /folders'])) as { items: Array<{ name: string }> }
    expect(folders.items.map((f) => f.name)).toEqual(catalog.folders.map((f) => f.name))

    const tabs = (await answer(byId['docs-home'].rest!['GET /tabs'])) as { items: Array<{ id: string; name: string }> }
    expect(tabs.items.map((t) => t.name)).toContain(catalog.topic.name)

    const feed = (await answer(byId['docs-topic-tab'].rest!['GET /feed'], { tab: 'tab_wildlife' })) as { items: Array<{ video: { id: string }; why: { label: string; detail: string } }> }
    expect(feed.items.length).toBeGreaterThan(0)
    for (const it of feed.items) {
      const v = catalog.topic.videos.find((x) => x.id === it.video.id)
      expect(v, it.video.id).toBeDefined()
      expect(it.why).toMatchObject({ label: catalog.topic.name, detail: v!.reason })
    }

    const preview = (await answer(byId['docs-topic-tab-preview'].rest!['GET /themes/{id}'])) as {
      theme: { name: string }
      items: Array<{ video_id: string; reason: string }>
      seeds: Array<{ channel_id: string }>
    }
    expect(preview.theme.name).toBe(catalog.topic.name)
    expect(preview.items.map((i) => [i.video_id, i.reason])).toEqual(catalog.topic.videos.map((v) => [v.id, v.reason]))
    // seeds = channels with 3 or more kept videos; the catalog keeps 2 per topic channel
    expect(Math.max(...catalog.topic.channels.map((c) => catalog.topic.videos.filter((v) => v.channel_id === c.id).length))).toBeLessThan(3)
    expect(preview.seeds).toEqual([])
  })

  it('cleanup proposes three catalog channels', async () => {
    const { scenarios } = await import('../test/docs-screenshots/preview.scenarios')
    const cleanup = (await answer(scenarios.find((s) => s.id === 'docs-cleanup')!.rest!['GET /cleanup'])) as { scan: { candidates: Array<{ channel_id: string }> } }
    expect(cleanup.scan.candidates).toHaveLength(3)
    for (const c of cleanup.scan.candidates) expect(catalog.channels.map((x) => x.id)).toContain(c.channel_id)
  })
})
