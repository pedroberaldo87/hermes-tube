// One HermesTube tab: the plugin has a single page in the center and switches sections inside it (our own state, no
// host.navigate to another route). In-page history with a Back button (disabled on the first screen), the Back
// shortcut outside text fields, the Watch section as one more internal tab (short title + ✕ that closes the video).
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedItem } from '../../shared/api-types'
import { DESKTOP_ROUTES, PLUGIN_ID } from '../../shared/ids'
import { SectionFrame, ShellPage } from '../components'
import { setPluginContext } from '../lib/ctx'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import { registerLocales } from '../lib/i18n'
import {
  $nav,
  BACK_SHORTCUT,
  canGoBack,
  closeWatch,
  currentSection,
  goBack,
  isBackShortcut,
  noteDetail,
  openSection,
  showSection,
  useNavRestore
} from '../lib/nav'
import { $watch, setWatchRenderer, watchVideo } from '../lib/player'
import { click, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

const IDS = ['wjZofJX0v4M', 'VMj-3S1tku0', 'ujkD4SxPKOI', 'G_em1hHPnXY']

function item(id: string): FeedItem {
  return {
    video: {
      id,
      channel_id: 'UCYO_jab_esuFRV4b17AJtAw',
      title: `Video ${id} about transformers and the tech behind large language models`,
      published_at: 1_700_000_000,
      description: null,
      channel_title: '3Blue1Brown',
      duration_s: 600,
      is_short: false,
      views: 10,
      first_seen_at: 1_700_000_000,
      origin: 'rss'
    },
    channel: null,
    state: 'new',
    reaction: null,
    is_new: true,
    why: null,
    badges: []
  } as unknown as FeedItem
}
const LIST = IDS.map(item)

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const sections = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-part="shell-section"]')]
const visible = (root: ParentNode) => sections(root).filter((s) => !s.hidden).map((s) => s.getAttribute('data-section'))
const mounted = (root: ParentNode) => sections(root).map((s) => s.getAttribute('data-section'))

function key(el: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(ev)
  })
  return ev
}

/** One stub per section, each with a text field and a counter that survives switching (keep-alive). */
function stub(name: string) {
  return function Stub() {
    return (
      <SectionFrame current={name === 'watch' ? 'home' : (name as 'home')}>
        <div data-testid={name}>
          <input data-testid={`${name}-input`} />
        </div>
      </SectionFrame>
    )
  }
}
const SECTIONS = { home: stub('home'), manage: stub('manage'), cleanup: stub('cleanup'), extras: stub('extras'), watch: stub('watch') }

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  setWatchRenderer(() => null)
})

describe('nav state: sections, stack and Back', () => {
  it('starts on Subscriptions with nowhere to go back to', () => {
    expect(currentSection()).toBe('home')
    expect(canGoBack()).toBe(false)
    expect(goBack()).toBe(false)
  })

  it('switching section is our own state: no host.navigate, and Back returns', () => {
    showSection('manage')
    expect(currentSection()).toBe('manage')
    expect(sdkMock.navigations).toEqual([])
    expect(canGoBack()).toBe(true)
    expect(goBack()).toBe(true)
    expect(currentSection()).toBe('home')
    expect(canGoBack()).toBe(false)
  })

  it('each section appears once in the history: going back and forth does not pile up entries', () => {
    showSection('manage')
    showSection('home')
    showSection('manage')
    showSection('cleanup')
    showSection('manage')
    expect($nav.get().map((e) => e.section)).toEqual(['home', 'cleanup', 'manage'])
  })

  it('openSection (palette, pane, chat) also brings the single page to the front', () => {
    openSection('cleanup')
    expect(currentSection()).toBe('cleanup')
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('Extras only while its page exists', () => {
    showSection('extras')
    expect(currentSection()).toBe(EXTRAS_PAGE_READY ? 'extras' : 'home')
  })

  it('Watch only while a video is open', () => {
    showSection('watch')
    expect(currentSection()).toBe('home')
  })

  it('Home tab X → video → Back = Home tab X (the entry remembers the tab and asks Home to restore it)', () => {
    noteDetail('home', 'tab_x')
    expect(watchVideo(IDS[0], { item: LIST[0], list: LIST, source: 'Science' })).toBe(true)
    expect(currentSection()).toBe('watch')
    expect($nav.get()).toEqual([
      { section: 'home', detail: 'tab_x' },
      { section: 'watch', detail: IDS[0] }
    ])
    const seen: string[] = []
    function Probe() {
      useNavRestore('home', (d) => seen.push(d))
      return null
    }
    render(<Probe />)
    act(() => {
      goBack()
    })
    expect(currentSection()).toBe('home')
    expect(seen).toEqual(['tab_x'])
  })

  it('"Up next" swaps the video without stacking: one Back leaves Watch', () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    for (const id of IDS.slice(1)) watchVideo(id, { list: LIST })
    expect($watch.get()?.id).toBe(IDS[3])
    expect($nav.get().map((e) => e.section)).toEqual(['home', 'watch'])
    goBack()
    expect(currentSection()).toBe('home')
    expect(canGoBack()).toBe(false)
    // the video stays open (the internal tab remains) until ✕
    expect($watch.get()?.id).toBe(IDS[3])
  })

  it('opening a video never opens a center tab of its own', () => {
    watchVideo(IDS[0], { item: LIST[0] })
    expect(sdkMock.workspaceOpens).toEqual([])
    // the single page is brought to the front (from the chat or the pane it may be behind)
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('closeWatch: closes the video, drops Watch from the history and goes back to where it came from', () => {
    showSection('manage')
    watchVideo(IDS[0], { item: LIST[0] })
    closeWatch()
    expect($watch.get()).toBeNull()
    expect(currentSection()).toBe('manage')
    expect($nav.get().map((e) => e.section)).toEqual(['home', 'manage'])
  })
})

describe('Back shortcut', () => {
  const ev = (init: Partial<KeyboardEvent> & { key: string }, target: EventTarget | null = document.body) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: '', target, ...init }) as KeyboardEvent

  it('⌘[ / Ctrl+[ and Alt+←; nothing else', () => {
    expect(BACK_SHORTCUT).toBe('mod+[')
    expect(isBackShortcut(ev({ key: '[', metaKey: true }))).toBe(true)
    expect(isBackShortcut(ev({ key: '[', ctrlKey: true }))).toBe(true)
    expect(isBackShortcut(ev({ key: 'ArrowLeft', altKey: true }))).toBe(true)
    // layouts where [ needs another key: the physical key counts
    expect(isBackShortcut(ev({ key: 'ˆ', code: 'BracketLeft', metaKey: true }))).toBe(true)
    expect(isBackShortcut(ev({ key: '[' }))).toBe(false)
    expect(isBackShortcut(ev({ key: '[', metaKey: true, shiftKey: true }))).toBe(false)
    expect(isBackShortcut(ev({ key: 'ArrowLeft' }))).toBe(false)
    expect(isBackShortcut(ev({ key: 'ArrowLeft', altKey: true, metaKey: true }))).toBe(false)
  })

  it('never from a text field', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    expect(isBackShortcut(ev({ key: '[', metaKey: true }, input))).toBe(false)
    expect(isBackShortcut(ev({ key: 'ArrowLeft', altKey: true }, area))).toBe(false)
  })
})

describe('ShellPage: one page, one section at a time', () => {
  it('a single header (Back · HermesTube · sections); Back disabled, not hidden, on the first screen', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    expect(v.container.querySelectorAll('nav[data-part="section-nav"]')).toHaveLength(1)
    const back = q(v.container, '[data-part="nav-back"]')!
    expect(back).not.toBeNull()
    expect(back.hasAttribute('disabled')).toBe(true)
    expect(back.getAttribute('aria-label')).toBe('Back')
    expect(back.getAttribute('aria-keyshortcuts')).toMatch(/BracketLeft/)
    // Back sits to the left of the brand
    const nav = q(v.container, 'nav[data-part="section-nav"]')!
    const order = [...nav.querySelectorAll('[data-part]')].map((e) => e.getAttribute('data-part'))
    expect(order.indexOf('nav-back')).toBeLessThan(order.indexOf('section-brand'))
    expect(visible(v.container)).toEqual(['home'])
  })

  it('clicking a section tab switches inside the page; the previous section stays mounted (state kept), no navigate', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    const input = q(v.container, '[data-testid="home-input"]') as HTMLInputElement
    input.value = 'kept'
    click(q(v.container, '[data-part="section-tabs"] [data-section="manage"]'))
    expect(visible(v.container)).toEqual(['manage'])
    expect(mounted(v.container)).toEqual(expect.arrayContaining(['home', 'manage']))
    expect(sdkMock.navigations).toEqual([])
    expect(q(v.container, '[data-part="section-tabs"] [data-section="manage"]')?.getAttribute('aria-current')).toBe('page')
    click(q(v.container, '[data-part="nav-back"]'))
    expect(visible(v.container)).toEqual(['home'])
    expect((q(v.container, '[data-testid="home-input"]') as HTMLInputElement).value).toBe('kept')
  })

  it('Back shortcut on the page goes back; typed in a text field it does nothing', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    act(() => showSection('cleanup'))
    const ev = key(q(v.container, '[data-testid="cleanup-input"]')!, '[', { metaKey: true })
    expect(ev.defaultPrevented).toBe(false)
    expect(currentSection()).toBe('cleanup')
    const ok = key(q(v.container, '[data-testid="cleanup"]')!, '[', { metaKey: true })
    expect(ok.defaultPrevented).toBe(true)
    expect(currentSection()).toBe('home')
  })

  it('mouse back button goes back too', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    act(() => showSection('manage'))
    act(() => {
      q(v.container, '[data-testid="manage"]')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 3 }))
    })
    expect(currentSection()).toBe('home')
  })

  it('pages keep their own SectionFrame: inside the shell it does not draw a second header', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    act(() => showSection('manage'))
    expect(v.container.querySelectorAll('nav[data-part="section-nav"]')).toHaveLength(1)
  })

  it('Watch: an internal tab with the short video title and ✕; it mounts only while it is the current section', () => {
    const v = render(<ShellPage sections={SECTIONS} />)
    expect(q(v.container, '[data-section="watch"]')).toBeNull()
    act(() => {
      watchVideo(IDS[0], { item: LIST[0], list: LIST })
    })
    const tab = q(v.container, '[data-part="section-tabs"] [data-section="watch"]')!
    expect(tab).not.toBeNull()
    expect(tab.getAttribute('aria-current')).toBe('page')
    expect((tab.textContent ?? '').length).toBeLessThanOrEqual(30)
    expect(tab.textContent).toMatch(/^Video/)
    expect(visible(v.container)).toEqual(['watch'])
    click(q(v.container, '[data-part="nav-back"]'))
    expect(visible(v.container)).toEqual(['home'])
    // the player stops when you leave (no hidden iframe playing): the Watch section is not kept mounted
    expect(mounted(v.container)).not.toContain('watch')
    // the tab stays while the video is open; clicking it returns
    click(q(v.container, '[data-part="section-tabs"] [data-section="watch"]'))
    expect(visible(v.container)).toEqual(['watch'])
    click(q(v.container, '[data-part="watch-close"]'))
    expect($watch.get()).toBeNull()
    expect(q(v.container, '[data-section="watch"]')).toBeNull()
    expect(visible(v.container)).toEqual(['home'])
    expect(sdkMock.workspaceOpens).toEqual([])
  })

  it('PT-BR: Back and close labels', () => {
    act(() => sdkMock.locale.set('pt-br'))
    const v = render(<ShellPage sections={SECTIONS} />)
    expect(q(v.container, '[data-part="nav-back"]')?.getAttribute('aria-label')).toBe('Voltar')
    act(() => {
      watchVideo(IDS[0], { item: LIST[0] })
    })
    expect(q(v.container, '[data-part="watch-close"]')?.getAttribute('aria-label')).toBe('Fechar vídeo')
  })
})
