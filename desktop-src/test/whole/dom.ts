// DOM gestures of the whole-plugin tests (drop, type, key) and pane reads.
import { act } from 'react'

/** Drops `text/plain = data` on `target` (dragover + drop, like a browser drag). */
export function drop(target: Element | null, data: string): void {
  if (!target) throw new Error('drop: alvo ausente')
  const dataTransfer = { getData: (type: string) => (type === 'text/plain' ? data : ''), setData: () => undefined, dropEffect: 'move', effectAllowed: 'move', types: ['text/plain'] }
  for (const type of ['dragover', 'drop']) {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(ev)
    })
  }
}

export function typeInto(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error('typeInto: field missing')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function key(el: Element | null, k: string): void {
  if (!el) throw new Error('key: elemento ausente')
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

export function button(root: ParentNode | null, label: string): HTMLElement | null {
  if (!root) return null
  return (
    [...root.querySelectorAll<HTMLElement>('button')].find(
      (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label
    ) ?? null
  )
}

/** Pane tree row (`folder:<id>`, `channel:<id>`, `all`, `unfiled`). */
export function paneRow(root: ParentNode | null, id: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[role="treeitem"][data-id="${id}"] > [data-part="tree-row"]`) ?? null
}

/** New-video counter of a pane row (`null` = no number). */
export function paneCount(root: ParentNode | null, id: string): string | null {
  return paneRow(root, id)?.querySelector('[class$="tree-count"]')?.textContent ?? null
}

/** Parent folder (in the pane tree) of an item. */
export function paneParent(root: ParentNode | null, id: string): string | null {
  return root?.querySelector(`[role="treeitem"][data-id="${id}"]`)?.parentElement?.closest('[role="treeitem"]')?.getAttribute('data-id') ?? null
}
