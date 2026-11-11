// Content script runtime (extension/src/lib/content.ts + content/bootstrap.ts): attaches/detaches modules
// by URL and ExtState, follows YouTube's SPA navigation and dispatches background commands to the owning module.
import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import type { ExtState } from '../../shared/api-types'
import { CONTENT_ATTR, startContent, type ContentModule } from '../src/lib/content'
import { CONTENT_MODULES } from '../src/lib/registry-content'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'

function fakeModule(name: string, matches: ContentModule['matches'], log: string[], extra: Partial<ContentModule> = {}): ContentModule {
  return {
    MODULE: name,
    ROUTES: [],
    REAL_ROUTES: [],
    COMMANDS: [],
    matches,
    start: (ctx) => void log.push(`start:${name}:${ctx.url.pathname}`),
    stop: () => void log.push(`stop:${name}`),
    ...extra
  }
}

const at = (path: string) => new URL(`https://www.youtube.com${path}`)

describe('startContent', () => {
  it('attaches only the modules whose matches accepts the URL and marks the document', async () => {
    const log: string[] = []
    const rt = await startContent({
      modules: [fakeModule('a', (u) => u.pathname === '/feed/channels', log), fakeModule('b', (u) => u.pathname === '/watch', log)],
      url: () => at('/feed/channels')
    })
    expect(log).toEqual(['start:a:/feed/channels'])
    expect(rt.active()).toEqual(['a'])
    expect(document.documentElement.getAttribute(CONTENT_ATTR)).toBe('ready')
    expect(document.documentElement.getAttribute(`${CONTENT_ATTR}-modules`)).toBe('a')
    rt.dispose()
  })

  it('SPA navigation (yt-navigate-finish) re-evaluates: detaches one, attaches another', async () => {
    const log: string[] = []
    let path = '/feed/channels'
    const rt = await startContent({
      modules: [fakeModule('a', (u) => u.pathname === '/feed/channels', log), fakeModule('b', (u) => u.pathname === '/watch', log)],
      url: () => at(path)
    })
    path = '/watch'
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await chromeFake().flush()
    expect(log).toEqual(['start:a:/feed/channels', 'stop:a', 'start:b:/watch'])
    expect(rt.active()).toEqual(['b'])
    rt.dispose()
  })

  it('cached ExtState decides flagged modules and changes live (storage.onChanged)', async () => {
    const log: string[] = []
    const seen: Array<ExtState | null> = []
    await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: { state: { ...EXT_STATE_EXAMPLE, home_on_youtube: false }, fetched_at: 1 } })
    const rt = await startContent({
      modules: [
        fakeModule('home', (u, s) => u.pathname === '/' && !!s?.home_on_youtube, log, {
          start: (ctx) => {
            log.push('start:home')
            ctx.onState((s) => void seen.push(s))
          }
        })
      ],
      url: () => at('/')
    })
    expect(rt.active()).toEqual([])
    await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: { state: { ...EXT_STATE_EXAMPLE, home_on_youtube: true }, fetched_at: 2 } })
    await chromeFake().flush()
    expect(rt.active()).toEqual(['home'])
    await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: { state: { ...EXT_STATE_EXAMPLE, home_on_youtube: false }, fetched_at: 3 } })
    await chromeFake().flush()
    expect(log).toEqual(['start:home', 'stop:home'])
    expect(rt.active()).toEqual([])
    rt.dispose()
  })

  it('background command goes to the owning module and comes back in an envelope', async () => {
    const log: string[] = []
    const rt = await startContent({
      modules: [
        fakeModule('search', () => false, log, {
          COMMANDS: ['search.extract'],
          commands: { 'search.extract': async (p) => ({ payload: { job: p.job_id } }) }
        })
      ],
      url: () => at('/results?search_query=x')
    })
    const res = await chrome.runtime.sendMessage({ type: 'search.extract', payload: { job_id: 'j1' } })
    expect(res).toEqual({ ok: true, data: { payload: { job: 'j1' } } })
    rt.dispose()
  })

  it('an error in one module\'s start does not take down the others', async () => {
    const log: string[] = []
    const rt = await startContent({
      modules: [
        fakeModule('bad', () => true, log, {
          start: () => {
            throw new Error('x')
          }
        }),
        fakeModule('good', () => true, log)
      ],
      url: () => at('/')
    })
    expect(rt.active()).toEqual(['good'])
    rt.dispose()
  })
})

describe('content skeletons: where each module attaches', () => {
  const S = (over: Partial<ExtState> = {}): ExtState => ({ ...EXT_STATE_EXAMPLE, ...over })
  const mod = (name: string) => {
    const m = CONTENT_MODULES.find((x) => x.MODULE === name)
    if (!m) throw new Error(name)
    return m
  }

  it('scraper on /feed/channels; tracker on /watch; search on /results', () => {
    expect(mod('content/scraper').matches(at('/feed/channels'), S())).toBe(true)
    expect(mod('content/scraper').matches(at('/watch?v=abcdefghijk'), S())).toBe(false)
    expect(mod('content/tracker').matches(at('/watch?v=abcdefghijk'), S())).toBe(true)
    expect(mod('content/search').matches(at('/results?search_query=a'), S())).toBe(true)
  })

  it('sidebar only when paired (with state); thumbs only with the Extra; home only on / with home_on_youtube', () => {
    expect(mod('content/sidebar').matches(at('/'), null)).toBe(false)
    expect(mod('content/sidebar').matches(at('/'), S())).toBe(true)
    expect(mod('content/thumbs').matches(at('/'), S({ extras_honest_thumbnails: false }))).toBe(false)
    expect(mod('content/thumbs').matches(at('/'), S({ extras_honest_thumbnails: true }))).toBe(true)
    expect(mod('content/home').matches(at('/'), S({ home_on_youtube: true }))).toBe(true)
    expect(mod('content/home').matches(at('/watch'), S({ home_on_youtube: true }))).toBe(false)
    expect(mod('content/home').matches(at('/'), S({ home_on_youtube: false }))).toBe(false)
  })

  it('unsubscribe only by command (never attaches on its own)', () => {
    expect(mod('content/unsubscribe').matches(at('/@Fireship'), S())).toBe(false)
  })
})
