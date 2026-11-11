// Preview stand-ins faithful to the app where the screenshot needs it: `ConfirmDialog` with a dialog frame (veil,
// header, footer, kit buttons, error inside the dialog), `Tip` that draws the bubble (on hover, or when the
// scenario asks with `data-preview-tip-open="<selector>"`) and the floating menu that escapes the scrolling strip.
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tip } from '../preview/sdk'
import { click, flush, render } from './render'

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)

describe('preview ConfirmDialog', () => {
  it('closed: nothing', () => {
    const v = render(<ConfirmDialog open={false} onClose={() => undefined} onConfirm={() => undefined} title="Delete?" />)
    expect(v.container.innerHTML).toBe('')
  })

  it('open: veil + the app dialog frame (title, description, footer with the kit buttons)', () => {
    const v = render(
      <ConfirmDialog open onClose={() => undefined} onConfirm={() => undefined} title="Delete the “Science” tab?" description="Only the tab goes away." confirmLabel="Delete tab" cancelLabel="Not now" destructive />
    )
    expect(q(v.container, '[data-slot="dialog-overlay"]')).not.toBeNull()
    const box = q(v.container, '[data-slot="dialog-content"]')!
    expect(box.getAttribute('role')).toBe('alertdialog')
    expect(box.closest('[data-slot="confirm-dialog"]')).not.toBeNull()
    expect(box.style.position).toBe('fixed')
    expect(box.className).toMatch(/rounded-xl/)
    expect(box.className).toMatch(/shadow-nous/)
    expect(q(box, '[data-slot="dialog-header"] [data-slot="dialog-title"]')?.textContent).toBe('Delete the “Science” tab?')
    expect(q(box, '[data-slot="dialog-header"] [data-slot="dialog-description"]')?.textContent).toBe('Only the tab goes away.')
    const buttons = [...box.querySelectorAll<HTMLElement>('[data-slot="dialog-footer"] [data-slot="button"]')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Not now', 'Delete tab'])
    expect(buttons[1].className).toMatch(/bg-destructive/)
    expect(box.getAttribute('aria-labelledby')).toBe(q(box, '[data-slot="dialog-title"]')?.id)
  })

  it('confirm calls onConfirm and closes; a failure shows the error inside the dialog, which stays open; cancel closes', async () => {
    const onClose = vi.fn()
    let fail = true
    const onConfirm = vi.fn(() => (fail ? Promise.reject(new Error('no network')) : Promise.resolve()))
    const v = render(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="T" confirmLabel="OK" cancelLabel="No" />)
    const btn = (label: string) => [...v.container.querySelectorAll<HTMLElement>('[data-slot="button"]')].find((b) => b.textContent === label)!
    click(btn('OK'))
    await flush()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(q(v.container, '[data-slot="confirm-error"]')?.textContent).toContain('no network')
    expect(onClose).not.toHaveBeenCalled()
    fail = false
    click(btn('OK'))
    await flush()
    expect(onClose).toHaveBeenCalledTimes(1)
    click(btn('No'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('preview Tip', () => {
  it('without a request from the scenario: only the child (with the tooltip in the attributes), no bubble', () => {
    const v = render(
      <Tip label="Mark as watched · W" delayDuration={150}>
        <Button data-action="watched">w</Button>
      </Tip>
    )
    const b = q(v.container, '[data-action="watched"]')!
    expect(b.getAttribute('data-tip')).toBe('Mark as watched · W')
    expect(q(document.body, '[data-slot="tooltip-content"]')).toBeNull()
  })

  it('the scenario asks for the open tooltip (`data-preview-tip-open` = trigger selector): bubble with the text and the arrow', () => {
    const v = render(
      <div data-preview-tip-open='[data-action="watched"]' style={{ display: 'contents' }}>
        <Tip label="Mark as watched · W">
          <Button data-action="watched">w</Button>
        </Tip>
        <Tip label="Save to Watch later · L">
          <Button data-action="later">l</Button>
        </Tip>
      </div>
    )
    const bubbles = [...v.container.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')]
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0].getAttribute('role')).toBe('tooltip')
    expect(bubbles[0].className).toMatch(/tooltip-bubble/)
    expect(bubbles[0].getAttribute('data-side')).toBe('top')
    expect(bubbles[0].style.position).toBe('fixed')
    expect(q(bubbles[0], '[data-slot="tooltip-label"]')?.textContent).toBe('Mark as watched · W')
    expect(q(bubbles[0], '[data-slot="tooltip-arrow"]')).not.toBeNull()
    expect(q(v.container, '[data-action="watched"]')?.getAttribute('aria-describedby')).toBe(bubbles[0].id)
  })

  it('hover opens after the delay and leaving closes it', () => {
    vi.useFakeTimers()
    const v = render(
      <Tip label="Tip" delayDuration={150}>
        <Button data-action="x">x</Button>
      </Tip>
    )
    const b = q(v.container, '[data-action="x"]')!
    act(() => {
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(q(v.container, '[data-slot="tooltip-content"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(q(v.container, '[data-slot="tooltip-content"]')).not.toBeNull()
    act(() => {
      b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    expect(q(v.container, '[data-slot="tooltip-content"]')).toBeNull()
  })
})

describe('preview floating menu', () => {
  it('open: floats fixed (escapes the scrolling tab strip, like the Radix portal)', () => {
    const v = render(
      <div style={{ overflow: 'hidden', height: 20 }}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger asChild>
            <Button>⋯</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
    const menu = q(v.container, '[role="menu"]')!
    expect(menu.style.position).toBe('fixed')
  })
})
