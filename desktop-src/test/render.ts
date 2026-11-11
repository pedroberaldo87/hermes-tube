// Minimal render for component tests (no @testing-library): createRoot + React 19 act.
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

interface Mounted {
  root: Root
  container: HTMLElement
}

const mounted = new Set<Mounted>()

export interface RenderResult {
  container: HTMLElement
  rerender(ui: ReactElement): void
  unmount(): void
  /** Visible text of the container (normalized spaces). */
  text(): string
}

export function render(ui: ReactElement): RenderResult {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const entry = { root, container }
  mounted.add(entry)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    rerender(next) {
      act(() => {
        root.render(next)
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
      mounted.delete(entry)
    },
    text: () => (container.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
}

export function cleanupRendered(): void {
  for (const m of [...mounted]) {
    act(() => {
      m.root.unmount()
    })
    m.container.remove()
    mounted.delete(m)
  }
}

/** Lets pending promises (mock fetch, effects) settle inside act. */
export async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

/** Advances the fake clock (vi.useFakeTimers) inside act and settles the promises. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await flush()
}

export function click(el: Element | null): void {
  if (!el) throw new Error('click: elemento ausente')
  act(() => {
    ;(el as HTMLElement).click()
  })
}
