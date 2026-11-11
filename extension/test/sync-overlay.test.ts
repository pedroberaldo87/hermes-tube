// content/sync-overlay: discreet notice over /feed/channels during the visible sync.
// Says what is happening, counts live, says nothing changes in the account, Cancel and Esc cancel, disappears on exit,
// Shadow DOM so it neither inherits nor leaks style, no brand color and no animation with `prefers-reduced-motion`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OVERLAY_TAG, showSyncOverlay } from '../src/content/sync-overlay'
import { setLanguage } from '../src/lib/i18n'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  for (const el of Array.from(document.querySelectorAll(OVERLAY_TAG))) el.remove()
  setLanguage('en')
})

const shadow = () => document.querySelector(OVERLAY_TAG)?.shadowRoot ?? null

describe('sync-overlay', () => {
  it('shows what is happening, the live counter, that nothing changes in the account and the Cancel button', () => {
    setLanguage('pt-BR')
    const o = showSyncOverlay({ onCancel: () => undefined })
    const root = shadow()!
    expect(root).not.toBeNull()
    const text = root.textContent ?? ''
    expect(text).toMatch(/lendo suas inscrições/i)
    expect(text).toMatch(/nada é alterado/i)
    expect(root.querySelector('button')?.textContent).toBe('Cancelar')
    o.update(132)
    expect(root.querySelector('[data-role="count"]')?.textContent).toContain('132')
    // announcement for the screen reader, without stealing focus
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    o.update(140)
    expect(root.querySelector('[data-role="count"]')?.textContent).toContain('140')
    o.remove()
  })

  it('Cancel calls onCancel once and disables the button', () => {
    const onCancel = vi.fn()
    const o = showSyncOverlay({ onCancel })
    const btn = shadow()!.querySelector('button')!
    btn.click()
    btn.click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(btn.disabled).toBe(true)
    o.remove()
  })

  it('Esc cancels; other keys do not; after removal, Esc does nothing', () => {
    const onCancel = vi.fn()
    const o = showSyncOverlay({ onCancel })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onCancel).not.toHaveBeenCalled()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    o.remove()
    const again = vi.fn()
    const o2 = showSyncOverlay({ onCancel: again })
    o2.remove()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(again).not.toHaveBeenCalled()
  })

  it('remove() takes the element off the page and is idempotent; only one notice at a time', () => {
    const a = showSyncOverlay({ onCancel: () => undefined })
    const b = showSyncOverlay({ onCancel: () => undefined })
    expect(document.querySelectorAll(OVERLAY_TAG)).toHaveLength(1)
    a.remove()
    b.remove()
    b.remove()
    expect(document.querySelectorAll(OVERLAY_TAG)).toHaveLength(0)
    expect(b.removed).toBe(true)
  })

  it('isolation: style and buttons stay in the Shadow DOM (the page cannot select, the notice does not leak style)', () => {
    document.head.innerHTML = '<style id="page">* { color: red !important } button { display: none !important }</style>'
    document.body.innerHTML = '<button id="pagebtn">page</button>'
    const o = showSyncOverlay({ onCancel: () => undefined })
    const root = shadow()!
    // nothing of the notice shows up in the page queries
    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(document.querySelectorAll('style')).toHaveLength(1)
    // own style, inside the shadow, with a reset on the host and !important (beats the page's `* {… !important}`)
    const css = root.querySelector('style')?.textContent ?? ''
    expect(css).toMatch(/:host\s*\{[^}]*all:\s*initial\s*!important/)
    expect(css).toMatch(/:host\s*\{[^}]*position:\s*fixed\s*!important/)
    // no fixed brand color: only system colors (Canvas/CanvasText/ButtonFace…)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/i)
    expect(css).toMatch(/Canvas\b/)
    // reduced motion
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*animation:\s*none/)
    // the page is not touched
    expect(document.getElementById('pagebtn')!.getAttribute('style')).toBeNull()
    o.remove()
  })
})
