// A single entry in the app sidebar ("HermesTube" → Subscriptions) and, inside the pages, a section selector
// that is the same on all three screens (Subscriptions · Manage · Cleanup; Extras only with EXTRAS_PAGE_READY): current section marked,
// keyboard (arrows/Home/End with roving focus), compact menu at narrow width (container CSS only).
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PLUGIN_ID } from '../../shared/ids'
import { SECTION_KEYS, SectionFrame, SectionNav } from '../components'
import { setPluginContext } from '../lib/ctx'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import { registerLocales } from '../lib/i18n'
import { currentSection } from '../lib/nav'
import { CleanupPage } from '../pages/cleanup'
import { HomePage } from '../pages/home'
import { ManagePage } from '../pages/manage'
import { click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'
import { readRepoFile } from './repo.mjs'

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const items = (root: ParentNode) => qa(root, '[data-part="section-tabs"] [data-section]')

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  // pages mounted without a backend: the selector does not depend on any data
  sdkMock.restHandler = () => new Promise(() => undefined)
  sdkMock.requestHandler = () => new Promise(() => undefined)
})

describe('section selector', () => {
  it('sections in order; Extras only when the page exists', () => {
    expect(SECTION_KEYS).toEqual(['home', 'manage', 'cleanup', ...(EXTRAS_PAGE_READY ? ['extras'] : [])])
    const view = render(<SectionNav current="home" />)
    expect(items(view.container).map((b) => b.getAttribute('data-section'))).toEqual([...SECTION_KEYS])
    expect(items(view.container).map((b) => b.textContent)).toEqual(['Subscriptions', 'Manage', 'Cleanup', ...(EXTRAS_PAGE_READY ? ['Extras'] : [])])
    if (!EXTRAS_PAGE_READY) expect(q(view.container, '[data-section="extras"]')).toBeNull()
  })

  it('named navigation, with the HermesTube brand and the current section marked (aria-current)', () => {
    const view = render(<SectionNav current="manage" />)
    const nav = q(view.container, 'nav[data-part="section-nav"]')
    expect(nav?.getAttribute('aria-label')).toBe('HermesTube sections')
    expect(q(view.container, '[data-part="section-brand"]')?.textContent).toBe('HermesTube')
    const marked = items(view.container).filter((b) => b.getAttribute('aria-current') === 'page')
    expect(marked.map((b) => b.getAttribute('data-section'))).toEqual(['manage'])
  })

  it('click switches the section inside the single page (our state, never host.navigate to another route)', () => {
    const view = render(<SectionNav current="home" />)
    click(q(view.container, '[data-part="section-tabs"] [data-section="cleanup"]'))
    expect(currentSection()).toBe('cleanup')
    click(q(view.container, '[data-part="section-tabs"] [data-section="home"]'))
    expect(currentSection()).toBe('home')
    expect(sdkMock.navigations).toEqual([])
  })

  it('keyboard: a single Tab stop (the current one); arrows, Home and End move focus, wrapping around', () => {
    const view = render(<SectionNav current="home" />)
    const tabs = items(view.container)
    expect(tabs.map((b) => b.tabIndex)).toEqual(tabs.map((b) => (b.getAttribute('data-section') === 'home' ? 0 : -1)))
    tabs[0].focus()
    key(tabs[0], 'ArrowRight')
    expect(document.activeElement).toBe(tabs[1])
    key(tabs[1], 'End')
    expect(document.activeElement).toBe(tabs[tabs.length - 1])
    key(tabs[tabs.length - 1], 'ArrowRight')
    expect(document.activeElement).toBe(tabs[0])
    key(tabs[0], 'ArrowLeft')
    expect(document.activeElement).toBe(tabs[tabs.length - 1])
    key(tabs[tabs.length - 1], 'Home')
    expect(document.activeElement).toBe(tabs[0])
    // moving focus does not navigate
    expect(sdkMock.navigations).toEqual([])
  })

  it('compact menu: trigger with the current section; each item navigates (the current one marked)', () => {
    const view = render(<SectionNav current="cleanup" />)
    const menu = q(view.container, '[data-part="section-menu"]')
    expect(menu).not.toBeNull()
    expect(q(menu as HTMLElement, '[data-part="section-menu-trigger"]')?.textContent).toContain('Cleanup')
    const entries = qa(menu as HTMLElement, '[role="menuitem"][data-section]')
    expect(entries.map((e) => e.getAttribute('data-section'))).toEqual([...SECTION_KEYS])
    expect(entries.filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.getAttribute('data-section'))).toEqual(['cleanup'])
    click(entries[1])
    expect(currentSection()).toBe('manage')
    expect(sdkMock.navigations).toEqual([])
  })

  it('PT-BR: labels of the sections and the navigation', () => {
    act(() => sdkMock.locale.set('pt-br'))
    const view = render(<SectionNav current="home" />)
    expect(items(view.container).map((b) => b.textContent).slice(0, 3)).toEqual(['Inscrições', 'Gerenciar', 'Faxina'])
    expect(q(view.container, 'nav')?.getAttribute('aria-label')).toBe('Seções do HermesTube')
  })

  it('CSS: a narrow width swaps the strip for the menu (container queries that only hide)', () => {
    const css = readRepoFile('desktop-src/styles/nav.css')
    expect(css).toMatch(/\.PFX_sections\s*\{[^}]*container-type:\s*inline-size/)
    expect(css).toMatch(/@container PFX_sections \(max-width: \d+px\)\s*\{\s*\.PFX_secnav-track\s*\{\s*display: none;/)
    expect(css).toMatch(/@container PFX_sections \(min-width: \d+px\)\s*\{\s*\.PFX_secnav-compact\s*\{\s*display: none;/)
  })

  it('frame: selector above the page, the page still takes the rest', () => {
    const view = render(
      <SectionFrame current="manage">
        <div data-testid="page" />
      </SectionFrame>
    )
    const frame = q(view.container, '[data-part="sections"]')
    expect(frame?.firstElementChild?.getAttribute('data-part')).toBe('section-nav')
    expect(frame?.lastElementChild?.getAttribute('data-testid')).toBe('page')
  })
})

describe('the three pages carry the same selector, with their own section marked', () => {
  const pages = [
    ['home', HomePage],
    ['manage', ManagePage],
    ['cleanup', CleanupPage]
  ] as const

  for (const [section, Page] of pages) {
    it(section, async () => {
      const view = render(<Page />)
      await flush(6)
      const nav = qa(view.container, 'nav[data-part="section-nav"]')
      expect(nav).toHaveLength(1)
      const marked = items(view.container).filter((b) => b.getAttribute('aria-current') === 'page')
      expect(marked.map((b) => b.getAttribute('data-section'))).toEqual([section])
      expect(q(view.container, '[data-section="extras"]') === null).toBe(!EXTRAS_PAGE_READY)
    })
  }
})
