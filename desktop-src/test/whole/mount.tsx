// The plugin mounted as the app mounts it: ONE real `register(ctx)` (main.tsx) with the sdk-mock, ONE query
// client (the mock's `queryClient` is unique in the module) and ONE coherent REST world (world.ts). The chip and the pane
// stay mounted while the person navigates; the page changes (one at a time, like the app route); dialogs
// open through `openDialog` and are drawn by the DialogHost of the leader ShellHost (the first mounted one).
//
// Each surface mounts in its own React root (like the app areas) behind an error boundary that
// KEEPS the exception (`errors`): a test asserts `errors` is empty instead of relying on the console.
import { Component, type ErrorInfo, type ReactElement, type ReactNode, act } from 'react'
import { DESKTOP_ROUTES, type DesktopRouteKey, type DialogId, type DialogProps, PANE_ID, PLUGIN_ID, STATUS_CHIP_ID } from '../../../shared/ids'
import { $dialogStack, closeAllDialogs, openDialog } from '../../lib/dialogs'
import { showSection } from '../../lib/nav'
import { ShellHost } from '../../lib/shell'
import plugin from '../../main'
import { type RenderResult, flush, render } from '../render'
import { type MockCtxHandle, createMockCtx } from '../sdk-mock'
import { World } from './world'

export type PageId = Extract<DesktopRouteKey, 'home' | 'manage' | 'cleanup'>
export type DialogSurface = Extract<DialogId, 'onboarding' | 'organize' | 'theme' | 'tab-editor'>
export type SurfaceId = 'pane' | 'chip' | PageId | `dialog:${DialogSurface}`

export const PAGES: PageId[] = ['home', 'manage', 'cleanup']
export const DIALOG_SURFACES: DialogSurface[] = ['onboarding', 'organize', 'theme', 'tab-editor']
export const SURFACES: SurfaceId[] = ['pane', 'chip', ...PAGES, ...DIALOG_SURFACES.map((d) => `dialog:${d}` as const)]

export const isDialog = (id: SurfaceId): id is `dialog:${DialogSurface}` => id.startsWith('dialog:')
export const isPage = (id: SurfaceId): id is PageId => (PAGES as string[]).includes(id)

export interface CaughtError {
  surface: string
  error: unknown
}

class Boundary extends Component<{ surface: string; sink: CaughtError[]; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() {
    return { crashed: true }
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.sink.push({ surface: this.props.surface, error })
  }
  render() {
    return this.state.crashed ? <div data-whole-crash={this.props.surface} /> : this.props.children
  }
}

export interface WholePlugin {
  handle: MockCtxHandle
  world: World
  /** Render exceptions caught by the boundaries (must stay empty). */
  errors: CaughtError[]
  mount(id: SurfaceId, props?: Record<string, unknown>): Promise<void>
  unmount(id: SurfaceId): void
  mounted(): SurfaceId[]
  /** Root element of the surface (the dialog: the dialog node in the document). */
  root(id: SurfaceId): HTMLElement | null
  text(id: SurfaceId): string
  /** Current page (at most one). */
  page(): PageId | null
  settle(rounds?: number): Promise<void>
  /** Unmounts everything and unloads the plugin (the ctx's onDispose). */
  dispose(): void
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Registers ONCE (main.tsx) over a world; nothing is mounted yet. */
export function startPlugin(world: World = new World()): WholePlugin {
  world.install()
  const handle = createMockCtx(PLUGIN_ID)
  plugin.register(handle.ctx)
  const errors: CaughtError[] = []
  const views = new Map<string, RenderResult>()
  let currentPage: PageId | null = null
  const openSeqs = new Map<SurfaceId, number>()

  const contribution = (area: string, pred: (r: Record<string, any>) => boolean) => {
    const found = handle.registrations.find((r) => r.area === area && pred(r))
    if (!found?.render) throw new Error(`register(ctx) did not contribute ${area}`)
    return found.render as () => ReactElement
  }
  const renderOf = (id: SurfaceId): (() => ReactElement) => {
    if (id === 'pane') return contribution('panes', (r) => r.id === PANE_ID)
    if (id === 'chip') return contribution('statusBar.right', (r) => r.id === STATUS_CHIP_ID)
    // one page route: every page is a section of it (the section is set before mounting)
    if (isPage(id)) return contribution('routes', (r) => r.data?.path === DESKTOP_ROUTES.home)
    throw new Error(`no contribution for ${id}`)
  }

  const mountRoot = (key: string, ui: ReactElement) => {
    views.set(key, render(<Boundary surface={key} sink={errors}>{ui}</Boundary>))
  }
  const unmountRoot = (key: string) => {
    views.get(key)?.unmount()
    views.delete(key)
  }
  const anyShell = () => [...views.keys()].some((k) => k !== '__shell') || views.has('__shell')

  const api: WholePlugin = {
    handle,
    world,
    errors,
    async mount(id, props = {}) {
      if (isDialog(id)) {
        // a dialog needs a mounted ShellHost (in the app, chip and pane are always there)
        if (!anyShell()) mountRoot('__shell', <ShellHost />)
        const dialog = id.slice('dialog:'.length) as DialogSurface
        act(() => {
          openDialog(dialog, props as DialogProps[DialogSurface])
        })
        openSeqs.set(id, $dialogStack.get().at(-1)?.seq ?? -1)
      } else if (isPage(id)) {
        if (currentPage) unmountRoot(currentPage)
        currentPage = id
        act(() => {
          showSection(id)
        })
        mountRoot(id, renderOf(id)())
      } else {
        if (views.has(id)) return
        mountRoot(id, renderOf(id)())
      }
      await api.settle()
    },
    unmount(id) {
      if (isDialog(id)) {
        const seq = openSeqs.get(id)
        act(() => {
          $dialogStack.set($dialogStack.get().filter((d) => d.seq !== seq))
        })
        openSeqs.delete(id)
        return
      }
      unmountRoot(id)
      if (id === currentPage) currentPage = null
    },
    mounted() {
      const out: SurfaceId[] = [...views.keys()].filter((k) => k !== '__shell') as SurfaceId[]
      const top = $dialogStack.get().at(-1)
      for (const [id, seq] of openSeqs) if (top?.seq === seq) out.push(id)
      return out
    },
    root(id) {
      if (isDialog(id)) {
        const top = $dialogStack.get().at(-1)
        if (!top || top.seq !== openSeqs.get(id)) return null
        return document.querySelector<HTMLElement>('[data-slot="dialog"]')
      }
      return views.get(id)?.container ?? null
    },
    text(id) {
      return norm(api.root(id)?.textContent)
    },
    page: () => currentPage,
    settle: (rounds = 15) => flush(rounds),
    dispose() {
      act(() => closeAllDialogs())
      for (const key of [...views.keys()]) unmountRoot(key)
      currentPage = null
      openSeqs.clear()
      handle.dispose()
    }
  }
  return api
}
