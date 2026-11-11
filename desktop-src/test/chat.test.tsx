// Chat card `::tube-video{id="…"}`: strict validation (what the model writes is untrusted data),
// batched data (one call for N cards), skeleton with the real thumbnail and the same geometry, unknown
// video → minimal card, error → plain link with try again, optimistic actions with undo and failure,
// keyboard, the chat's own stylesheet (no fixed color, only prefix classes) and i18n EN = PT-BR.
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedItem } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { ChatVideoCard } from '../chat'
import { parseVideoDirective, fallbackText } from '../chat/directive'
import { CHAT_CSS, CHAT_STYLE_ATTR, ensureChatStyles } from '../chat/styles'
import { BATCH_MAX } from '../chat/videos'
import { TIP_DELAY_MS } from '../components'
import enChat from '../locales/en/chat.json'
import ptChat from '../locales/pt-BR/chat.json'
import { setPluginContext } from '../lib/ctx'
import { interpolate, registerLocales } from '../lib/i18n'
import { CSS_TOKEN } from '../lib/style'
import { click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ fixtures

type Tree = { [k: string]: Tree | string }

function textOf(tree: unknown, key: string, vars?: Record<string, string | number>): string {
  let node = tree as Tree | string
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return interpolate(node, vars)
}
const en = (key: string, vars?: Record<string, string | number>) => textOf(enChat, key, vars)
const pt = (key: string, vars?: Record<string, string | number>) => textOf(ptChat, key, vars)

const NOW_S = Math.floor(Date.now() / 1000)
const IDS = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'M7lc1UVf-VE', 'aqz-KE-bpKQ']

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    video: {
      id,
      channel_id: 'UCHnyfMqiRRG1u-2MsSQLbXA',
      title: `Title of ${id}`,
      published_at: NOW_S - 3 * 86400,
      description: null,
      channel_title: 'Veritasium',
      duration_s: 1234,
      is_short: false,
      views: 661306,
      first_seen_at: NOW_S - 3 * 86400,
      origin: 'rss'
    },
    channel: null,
    state: 'new',
    reaction: null,
    is_new: false,
    why: null,
    badges: [],
    ...over
  }
}

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

let calls: Req[]
let routes: Record<string, (req: Req) => unknown>
let handle: ReturnType<typeof createMockCtx>

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET')
    const req: Req = { method, path, query: Object.fromEntries(new URLSearchParams(qs)), body: opts?.body }
    calls.push(req)
    const route = routes[`${method} ${path}`]
    if (!route) return { ok: false, error: { code: 'not_found', message: `no route ${method} ${path}` } }
    return Promise.resolve()
      .then(() => route(req))
      .then(
        (data) => ({ ok: true, data }),
        (error: unknown) => ({ ok: false, error })
      )
  }
}

/** `GET /videos` that knows the given ids (requested order; unknown ones are left out, like the server). */
function knows(...known: string[]) {
  return (req: Req) => ({ items: req.query.ids.split(',').filter((id) => known.includes(id)).map((id) => item(id)) })
}

const videoCalls = () => calls.filter((c) => c.method === 'GET' && c.path === '/videos')
const stateCalls = () => calls.filter((c) => c.method === 'POST' && c.path === '/videos/state')

beforeEach(() => {
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  calls = []
  routes = { 'GET /videos': knows(...IDS), 'POST /videos/state': (req) => ({ changed: (req.body as { video_ids: string[] }).video_ids.length }), 'GET /status': () => ({}) }
  install()
})

const card = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-chat-video="${id}"]`)

// ------------------------------------------------------------------ strict validation

describe('directive validation (untrusted input)', () => {
  const MALICIOUS: Array<[string, unknown]> = [
    ['HTML no id', { id: '"><script>alert(1)</script>' }],
    ['img onerror', { id: '<img src=x onerror=alert(1)>' }],
    ['javascript:', { id: 'javascript:1' }],
    ['10 characters', { id: 'dQw4w9WgXc' }],
    ['12 characters', { id: 'dQw4w9WgXcQQ' }],
    ['character outside the alphabet', { id: 'dQw4w9WgXc!' }],
    ['dot', { id: 'dQw4w9WgX.Q' }],
    ['leading space', { id: ' dQw4w9WgXc' }],
    ['line break', { id: 'dQw4w9WgXc\n' }],
    ['look-alike unicode', { id: 'dQw4w9WgXcԚ' }],
    ['full-width digit', { id: 'dQw4w9WgXc１' }],
    ['whole URL', { id: 'https://youtu.be/dQw4w9WgXcQ' }],
    ['dangerous extra attribute', { id: 'dQw4w9WgXcQ', onclick: 'alert(1)' }],
    ['harmless extra attribute', { id: 'dQw4w9WgXcQ', title: 'x' }],
    ['own __proto__', JSON.parse('{"id":"dQw4w9WgXcQ","__proto__":{"id":"x"}}')],
    ['inherited id (not own)', Object.create({ id: 'dQw4w9WgXcQ' })],
    ['wrong name', { ID: 'dQw4w9WgXcQ' }],
    ['no attributes', {}],
    ['numeric id', { id: 12345678901 }],
    ['id array', { id: ['dQw4w9WgXcQ'] }],
    ['null attrs', null],
    ['attrs array', ['dQw4w9WgXcQ']],
    ['text attrs', 'dQw4w9WgXcQ']
  ]

  it.each(MALICIOUS)('%s → no id', (_name, attrs) => {
    expect(parseVideoDirective(attrs)).toBeNull()
  })

  it.each(MALICIOUS)('%s → plain text only (no element, no network)', async (_name, attrs) => {
    const source = `::tube-video{id="${String((attrs as { id?: unknown } | null)?.id ?? '')}"}`
    const view = render(<ChatVideoCard attrs={attrs as Record<string, string>} source={source} />)
    await flush()
    const c = view.container
    expect(c.querySelector('article, img, a, script, iframe, button, video, object, embed, style')).toBeNull()
    expect(c.textContent).toBe(fallbackText(source))
    expect(calls).toEqual([])
  })

  it('without the original text (older host) renders nothing', () => {
    const view = render(<ChatVideoCard attrs={{ id: 'x"><script>' }} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('HTML in the original text stays text (React escapes it), long text is cut', () => {
    const source = '::tube-video{id="<img src=x onerror=alert(1)>"}'
    const view = render(<ChatVideoCard attrs={{ id: '<img src=x onerror=alert(1)>' }} source={source} />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('<img src=x onerror=alert(1)>')
    const long = `::tube-video{id="${'a'.repeat(4000)}"}`
    expect(fallbackText(long).length).toBeLessThanOrEqual(241)
    expect(fallbackText(long).endsWith('…')).toBe(true)
  })

  it('valid id: 11 characters of the YouTube alphabet (letters, digits, - and _)', () => {
    expect(parseVideoDirective({ id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(parseVideoDirective({ id: 'a-b_c-d_e-f' })).toBe('a-b_c-d_e-f')
  })
})

// ------------------------------------------------------------------ batch

describe('batched data', () => {
  it('N cards in the same render → ONE call (requested order, no repeats)', async () => {
    const view = render(
      <>
        {[...IDS, IDS[0]].map((id, i) => (
          <ChatVideoCard key={i} attrs={{ id }} />
        ))}
      </>
    )
    await flush()
    expect(videoCalls()).toHaveLength(1)
    expect(videoCalls()[0].query.ids).toBe(IDS.join(','))
    for (const id of IDS) expect(card(view.container, id)?.dataset.chatStatus).toBe('ready')
  })

  it(`mais de ${BATCH_MAX} ids → lotes de ${BATCH_MAX}`, async () => {
    const many = Array.from({ length: BATCH_MAX + 10 }, (_, i) => `vid${String(i).padStart(8, '0')}`)
    routes['GET /videos'] = knows(...many)
    render(
      <>
        {many.map((id) => (
          <ChatVideoCard key={id} attrs={{ id }} />
        ))}
      </>
    )
    await flush()
    expect(videoCalls().map((c) => c.query.ids.split(',').length)).toEqual([BATCH_MAX, 10])
  })

  it('a card for the same video mounted later uses the cache (no new call)', async () => {
    const first = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    first.unmount()
    const again = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    expect(card(again.container, IDS[0])?.dataset.chatStatus).toBe('ready')
    await flush()
    expect(videoCalls()).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ states

describe('card states', () => {
  it('loading: real public thumbnail + text skeleton; ready: VideoCard row with the same box', async () => {
    const gate = deferred()
    routes['GET /videos'] = async (req) => {
      await gate.promise
      return knows(...IDS)(req)
    }
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    const root = card(view.container, IDS[0])!
    expect(root.dataset.chatStatus).toBe('loading')
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelector('img')?.getAttribute('src')).toContain(IDS[0])
    expect(root.querySelector('[data-part="title"][data-skeleton]')).not.toBeNull()
    const parts = (el: Element) =>
      [...el.querySelectorAll('[data-part]')].map((e) => (e as HTMLElement).dataset.part).filter((p) => ['card', 'media', 'thumb', 'body', 'title', 'meta'].includes(p!))
    const before = parts(root)
    gate.resolve(undefined)
    await flush()
    // the root is the same node (nothing remounts around it) and the box has the same parts, in the same order
    expect(card(view.container, IDS[0])).toBe(root)
    expect(root.dataset.chatStatus).toBe('ready')
    expect(root.getAttribute('aria-busy')).toBeNull()
    expect(parts(root)).toEqual(before)
    const article = root.querySelector('article')!
    expect(article.dataset.variant).toBe('row')
    expect(root.textContent).toContain(`Title of ${IDS[0]}`)
    expect(root.textContent).toContain('Veritasium')
    expect(root.querySelector('[data-part="thumb-duration"]')?.textContent).toBe('20:34')
    expect(root.querySelector('time')).not.toBeNull()
    expect([...root.querySelectorAll('[data-action]')].map((b) => (b as HTMLElement).dataset.action)).toEqual(['later', 'watched', 'open'])
  })

  it('unknown video → minimal card: public thumbnail and link, only the open action', async () => {
    routes['GET /videos'] = knows()
    const view = render(<ChatVideoCard attrs={{ id: IDS[1] }} />)
    await flush()
    const root = card(view.container, IDS[1])!
    expect(root.dataset.chatStatus).toBe('unknown')
    expect(root.querySelector('img')?.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${IDS[1]}/mqdefault.jpg`)
    expect(root.querySelector('a')?.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${IDS[1]}`)
    expect(root.textContent).toContain(en('card.unknown_title'))
    expect([...root.querySelectorAll('[data-action]')].map((b) => (b as HTMLElement).dataset.action)).toEqual(['open'])
  })

  it('error → plain link with the reason and try again (never an empty card)', async () => {
    routes['GET /videos'] = () => {
      throw { code: 'internal', message: 'boom' }
    }
    const view = render(<ChatVideoCard attrs={{ id: IDS[2] }} />)
    await flush()
    const root = card(view.container, IDS[2])!
    expect(root.dataset.chatStatus).toBe('error')
    expect(root.querySelector('article')).toBeNull()
    expect(root.querySelector('a')?.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${IDS[2]}`)
    expect(root.textContent).toContain(en('card.error'))
    expect(root.textContent).not.toMatch(/\b0\b/)
    routes['GET /videos'] = knows(...IDS)
    click(root.querySelector('[data-chat-retry]'))
    await flush()
    expect(videoCalls()).toHaveLength(2)
    expect(card(view.container, IDS[2])?.dataset.chatStatus).toBe('ready')
  })

  it('error on several cards: one try again requests all of them in a single batch', async () => {
    routes['GET /videos'] = () => {
      throw { code: 'timeout', message: 'slow' }
    }
    const view = render(
      <>
        <ChatVideoCard attrs={{ id: IDS[0] }} />
        <ChatVideoCard attrs={{ id: IDS[1] }} />
      </>
    )
    await flush()
    routes['GET /videos'] = knows(...IDS)
    click(card(view.container, IDS[1])!.querySelector('[data-chat-retry]'))
    await flush()
    expect(videoCalls()).toHaveLength(2)
    expect(videoCalls()[1].query.ids).toBe(`${IDS[0]},${IDS[1]}`)
  })

  it('open: the title link and the action open in the browser (ctx.os), without navigating the app', async () => {
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    click(card(view.container, IDS[0])!.querySelector('[data-action="open"]'))
    await flush()
    expect(sdkMock.openedExternal).toEqual([`https://www.youtube.com/watch?v=${IDS[0]}`])
    expect(sdkMock.navigations).toEqual([])
  })
})

// ------------------------------------------------------------------ optimistic actions

describe('quick actions in chat (optimistic, with undo)', () => {
  it('later: changes at once, saves, notifies with undo; undo goes back to the previous state', async () => {
    const gate = deferred()
    routes['POST /videos/state'] = async () => {
      await gate.promise
      return { changed: 1 }
    }
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    const root = card(view.container, IDS[0])!
    click(root.querySelector('[data-action="later"]'))
    // optimistic: before the response
    expect(root.querySelector('article')?.dataset.state).toBe('later')
    expect(root.querySelector('[data-action="later"]')?.getAttribute('aria-pressed')).toBe('true')
    await flush()
    expect(stateCalls()[0].body).toEqual({ video_ids: [IDS[0]], state: 'later' })
    gate.resolve(undefined)
    await flush()
    const toast = sdkMock.notifications.at(-1)!
    expect(toast.kind).toBe('success')
    expect(toast.message).toBe(en('toast.later'))
    expect((toast.action as { label: string }).label).toBe(en('toast.undo'))
    act(() => (toast.action as { onClick: () => void }).onClick())
    expect(root.querySelector('article')?.dataset.state).toBe('new')
    await flush()
    expect(stateCalls()[1].body).toEqual({ video_ids: [IDS[0]], state: 'new' })
  })

  it('failure: back to what it was and says why', async () => {
    routes['POST /videos/state'] = () => {
      throw { code: 'internal', message: 'db locked' }
    }
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    const root = card(view.container, IDS[0])!
    click(root.querySelector('[data-action="watched"]'))
    expect(root.querySelector('article')?.dataset.state).toBe('watched')
    await flush()
    expect(root.querySelector('article')?.dataset.state).toBe('new')
    const toast = sdkMock.notifications.at(-1)!
    expect(toast.kind).toBe('error')
    expect(String(toast.message)).toContain(en('toast.failed', { error: '' }).trim().replace(/:$/, ''))
  })

  it('toggling off goes back to the state from BEFORE (new is new again) and cards of the same video move together', async () => {
    routes['GET /videos'] = (req) => ({ items: req.query.ids.split(',').map((id) => item(id, { is_new: true })) })
    const view = render(
      <>
        <ChatVideoCard attrs={{ id: IDS[3] }} />
        <ChatVideoCard attrs={{ id: IDS[3] }} />
      </>
    )
    await flush()
    const [a, b] = [...view.container.querySelectorAll<HTMLElement>(`[data-chat-video="${IDS[3]}"]`)]
    expect(a.querySelector('article')?.dataset.new).toBe('true')
    click(a.querySelector('[data-action="watched"]'))
    expect(b.querySelector('article')?.dataset.state).toBe('watched')
    expect(b.querySelector('article')?.dataset.new).toBe('false')
    await flush()
    click(b.querySelector('[data-action="watched"]'))
    expect(a.querySelector('article')?.dataset.state).toBe('new')
    expect(a.querySelector('article')?.dataset.new).toBe('true')
    await flush()
    expect(stateCalls().map((c) => (c.body as { state: string }).state)).toEqual(['watched', 'new'])
  })

  it('"Later" also toggles back to the previous state; watched → later → off goes back to watched', async () => {
    const view = render(<ChatVideoCard attrs={{ id: IDS[1] }} />)
    await flush()
    const root = card(view.container, IDS[1])!
    click(root.querySelector('[data-action="later"]'))
    await flush()
    click(root.querySelector('[data-action="later"]'))
    await flush()
    expect(root.querySelector('article')?.dataset.state).toBe('new')
    click(root.querySelector('[data-action="watched"]'))
    await flush()
    click(root.querySelector('[data-action="later"]'))
    await flush()
    click(root.querySelector('[data-action="later"]'))
    await flush()
    expect(root.querySelector('article')?.dataset.state).toBe('watched')
    expect(stateCalls().map((c) => (c.body as { state: string }).state)).toEqual(['later', 'new', 'watched', 'later', 'watched'])
  })

  it('a video that already came watched from the server: turning it off goes to `seen` (nothing remembered)', async () => {
    routes['GET /videos'] = (req) => ({ items: req.query.ids.split(',').map((id) => item(id, { state: 'watched' })) })
    const view = render(<ChatVideoCard attrs={{ id: IDS[2] }} />)
    await flush()
    const root = card(view.container, IDS[2])!
    click(root.querySelector('[data-action="watched"]'))
    await flush()
    expect(stateCalls().map((c) => (c.body as { state: string }).state)).toEqual(['seen'])
  })

  it('failure when turning off: the memory comes back, and the next click still returns to the previous state', async () => {
    let fails = false
    routes['POST /videos/state'] = (req) => {
      if (fails) throw { code: 'internal', message: 'db locked' }
      return { changed: (req.body as { video_ids: string[] }).video_ids.length }
    }
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    const root = card(view.container, IDS[0])!
    click(root.querySelector('[data-action="watched"]'))
    await flush()
    fails = true
    click(root.querySelector('[data-action="watched"]'))
    await flush()
    expect(root.querySelector('article')?.dataset.state).toBe('watched')
    fails = false
    click(root.querySelector('[data-action="watched"]'))
    await flush()
    expect(root.querySelector('article')?.dataset.state).toBe('new')
    expect(stateCalls().map((c) => (c.body as { state: string }).state)).toEqual(['watched', 'new', 'new'])
  })

  it('buttons with aria-pressed and the kit tooltip (what the click will do · key), as in Subscriptions', async () => {
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    const root = card(view.container, IDS[0])!
    const btn = () => root.querySelector<HTMLElement>('[data-action="watched"]')!
    expect(btn().getAttribute('aria-pressed')).toBe('false')
    expect(btn().getAttribute('data-tip')).toBe('Mark as watched · W')
    expect(btn().getAttribute('data-tip-delay')).toBe(String(TIP_DELAY_MS))
    expect(btn().getAttribute('aria-label')).toContain('Mark as watched')
    click(btn())
    await flush()
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    expect(btn().getAttribute('data-tip')).toBe('Undo watched · W')
    expect(root.querySelector('[data-action="later"]')?.getAttribute('data-tip')).toBe('Save to Watch later · L')
  })

  it('keyboard: l / w / o on the focused card; with a modifier or coming from a text field, nothing', async () => {
    const view = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush()
    const root = card(view.container, IDS[0])!
    const link = root.querySelector<HTMLElement>('[data-open-video]')!
    const press = (target: Element, key: string, extra: KeyboardEventInit = {}) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
      })
    press(link, 'l', { metaKey: true })
    press(link, 'w', { ctrlKey: true })
    expect(stateCalls()).toHaveLength(0)
    press(link, 'l')
    await flush()
    expect(stateCalls().map((c) => (c.body as { state: string }).state)).toEqual(['later'])
    press(link, 'o')
    await flush()
    expect(sdkMock.openedExternal).toHaveLength(1)
    const input = document.createElement('input')
    root.appendChild(input)
    press(input, 'w')
    await flush()
    expect(stateCalls()).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ chat stylesheet

describe('the chat\'s own stylesheet', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')

  it('only prefix classes, no fixed color, no network, no width @media', () => {
    const code = strip(CHAT_CSS)
    for (const block of code.matchAll(/([^{}]+)\{/g)) {
      if (/^\s*@/.test(block[1])) continue
      for (const m of block[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) expect(m[1].startsWith(CSS_TOKEN)).toBe(true)
    }
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/)
    expect(code).not.toMatch(/@import|url\(|@font-face/)
    expect(code).not.toMatch(/@media[^{]*(min|max)-width/)
    const vars = new Set([...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1].replace(CSS_TOKEN, 'PFX_')))
    expect([...vars].filter((v) => !/^--(ui-|dt-|theme-|font-|radius|paragraph-gap|PFX_)/.test(v))).toEqual([])
  })

  it('mounts once per document and leaves on plugin unload', () => {
    const styles = () => document.head.querySelectorAll(`style[${CHAT_STYLE_ATTR}]`)
    for (const el of [...styles()]) el.remove()
    render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    render(<ChatVideoCard attrs={{ id: IDS[1] }} />)
    ensureChatStyles()
    expect(styles()).toHaveLength(1)
    expect(styles()[0].textContent).not.toContain(CSS_TOKEN)
    handle.dispose()
    expect(styles()).toHaveLength(0)
  })
})

// ------------------------------------------------------------------ i18n

describe('texts', () => {
  const keys = (tree: unknown, prefix = ''): string[] =>
    Object.entries(tree as Tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)))

  it('EN = PT-BR keys, none empty, same placeholders', () => {
    expect(keys(enChat).sort()).toEqual(keys(ptChat).sort())
    for (const k of keys(enChat)) {
      expect(en(k).trim()).not.toBe('')
      expect(pt(k).trim()).not.toBe('')
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(ph(textOf(ptChat, k))).toEqual(ph(textOf(enChat, k)))
    }
  })

  it('the card speaks the app language', async () => {
    routes['GET /videos'] = knows()
    act(() => sdkMock.locale.set('pt-br'))
    const view = render(<ChatVideoCard attrs={{ id: IDS[1] }} />)
    await flush()
    expect(view.container.textContent).toContain(pt('card.unknown_title'))
  })
})
