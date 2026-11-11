// In-page navigation of the single HermesTube page. The plugin has ONE page in the app's center (the Home route);
// Subscriptions, Manage, Cleanup, Extras and Watch are sections inside it, switched by OUR state — never by
// `host.navigate` to another route (each route would be its own center tab).
//  - `$nav` is the history: a stack of entries (section + what identifies it: the Home tab, the open video).
//    Each section appears at most once; going to a section already in the stack moves it to the top, so going
//    back and forth never piles up entries (Back walks the sections you came through, newest first).
//  - Swapping the video inside Watch (Up next, N/P) only updates the Watch entry: one Back leaves Watch.
//  - `openSection` (palette, pane, chip, chat) also brings the page to the front with `host.navigate(home)`;
//    `showSection` is for clicks inside the page.
//  - Watch is only valid while a video is open (lib/player registers the guard); Extras only with its page.
// No imports from screens: lib/player and the shell read and write this module.
import { atom, host, useValue } from '@hermes/plugin-sdk'
import { createContext, useContext, useEffect, useRef } from 'react'
import { DESKTOP_ROUTES } from '../../shared/ids'
import { EXTRAS_PAGE_READY } from './extras'
import { onShellReset } from './lifecycle'

export type PageSectionKey = 'home' | 'manage' | 'cleanup' | 'extras'
export type SectionKey = PageSectionKey | 'watch'

/** Page sections in the order of the internal tab strip (Watch comes after them, while a video is open). */
export const PAGE_SECTIONS: readonly PageSectionKey[] = ['home', 'manage', 'cleanup', ...(EXTRAS_PAGE_READY ? (['extras'] as const) : [])]

export interface NavEntry {
  section: SectionKey
  /** What identifies the screen inside the section: the Home tab id, the open video id; `null` = nothing in particular. */
  detail: string | null
}

const START: readonly NavEntry[] = [{ section: 'home', detail: null }]

export const $nav = atom<readonly NavEntry[]>(START)

/** "Back landed on this entry": the section restores what the entry remembers (Home: its tab). */
export interface NavRestore {
  section: SectionKey
  detail: string
  seq: number
}

export const $navRestore = atom<NavRestore | null>(null)

const guards = new Map<SectionKey, () => boolean>()
let restoreSeq = 0

onShellReset(() => {
  $nav.set(START)
  $navRestore.set(null)
})

/** A section that may be unavailable (Watch without a video). The guard is read on every switch and Back. */
export function setSectionGuard(section: SectionKey, guard: (() => boolean) | null): void {
  if (guard) guards.set(section, guard)
  else guards.delete(section)
}

export function isSectionAvailable(section: SectionKey): boolean {
  if (section === 'extras' && !EXTRAS_PAGE_READY) return false
  if (section !== 'watch' && !(PAGE_SECTIONS as readonly string[]).includes(section)) return false
  const guard = guards.get(section)
  if (section === 'watch' && !guard) return false
  try {
    return guard ? guard() : true
  } catch {
    return false
  }
}

function valid(stack: readonly NavEntry[]): NavEntry[] {
  const out = stack.filter((e) => isSectionAvailable(e.section))
  return out.length ? out : [...START]
}

export function currentEntry(stack: readonly NavEntry[] = $nav.get()): NavEntry {
  const v = valid(stack)
  return v[v.length - 1]
}

export function currentSection(stack: readonly NavEntry[] = $nav.get()): SectionKey {
  return currentEntry(stack).section
}

export function canGoBack(stack: readonly NavEntry[] = $nav.get()): boolean {
  return valid(stack).length > 1
}

/**
 * Switches to `section` inside the page (no host.navigate). Same section: only updates its detail. Unavailable
 * section: nothing. `detail` undefined keeps what the section's entry remembered.
 */
export function showSection(section: SectionKey, detail?: string | null): void {
  if (!isSectionAvailable(section)) return
  const stack = valid($nav.get())
  const top = stack[stack.length - 1]
  if (top.section === section) {
    if (detail !== undefined && detail !== top.detail) $nav.set([...stack.slice(0, -1), { section, detail }])
    else if (stack.length !== $nav.get().length) $nav.set(stack)
    return
  }
  const old = stack.find((e) => e.section === section)
  const rest = stack.filter((e) => e.section !== section)
  $nav.set([...rest, { section, detail: detail !== undefined ? detail : (old?.detail ?? null) }])
}

/** Brings the single page to the front (opens it if closed). Errors from the app are not ours to show. */
export function frontPage(): void {
  try {
    host.navigate(DESKTOP_ROUTES.home)
  } catch {
    // the app refused the navigation: the section is set anyway and shows the next time the page opens
  }
}

/** From outside the page (palette, pane, chip, chat): the section, and the page in front. */
export function openSection(section: SectionKey, detail?: string | null): void {
  showSection(section, detail)
  frontPage()
}

/** Back: the previous entry. `false` when there is nowhere to go (the first screen). */
export function goBack(): boolean {
  const stack = valid($nav.get())
  if (stack.length <= 1) {
    if (stack.length !== $nav.get().length) $nav.set(stack)
    return false
  }
  const next = stack.slice(0, -1)
  $nav.set(next)
  const target = next[next.length - 1]
  if (target.detail != null) $navRestore.set({ section: target.section, detail: target.detail, seq: ++restoreSeq })
  return true
}

/** The section's screen changed inside it (Home tab, video swapped): updates its entry without stacking. */
export function noteDetail(section: SectionKey, detail: string | null): void {
  const stack = $nav.get()
  let at = -1
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].section === section) {
      at = i
      break
    }
  }
  if (at < 0 || stack[at].detail === detail) return
  const next = [...stack]
  next[at] = { section, detail }
  $nav.set(next)
}

/** Removes a section from the history (the video was closed). */
export function dropSection(section: SectionKey): void {
  const stack = $nav.get()
  if (!stack.some((e) => e.section === section)) return
  const next = stack.filter((e) => e.section !== section)
  $nav.set(next.length ? next : START)
}

// ------------------------------------------------------------------ Watch (the close lives here so the strip has no player import cycle)

let watchCloser: (() => void) | null = null

/** lib/player hands over how to clear the open video. */
export function setWatchCloser(fn: (() => void) | null): void {
  watchCloser = fn
}

/** ✕ of the Watch tab: closes the video, drops Watch from the history and shows where the video came from. */
export function closeWatch(): void {
  try {
    watchCloser?.()
  } finally {
    dropSection('watch')
  }
}

// ------------------------------------------------------------------ hooks

export interface NavView {
  stack: readonly NavEntry[]
  current: SectionKey
  canBack: boolean
}

export function useNav(): NavView {
  const stack = useValue($nav)
  return { stack, current: currentSection(stack), canBack: canGoBack(stack) }
}

/** The section reports its current screen (e.g. Home's active tab) so Back can return to it. */
export function useNavDetail(section: SectionKey, detail: string | null | undefined): void {
  useEffect(() => {
    if (detail !== undefined) noteDetail(section, detail)
  }, [section, detail])
}

/** Called when Back lands on an entry of `section` that remembers a detail (only restores newer than the mount). */
export function useNavRestore(section: SectionKey, onRestore: (detail: string) => void): void {
  const restore = useValue($navRestore)
  const seen = useRef<number>(restore?.seq ?? 0)
  const cb = useRef(onRestore)
  cb.current = onRestore
  useEffect(() => {
    if (!restore || restore.seq <= seen.current) return
    seen.current = restore.seq
    if (restore.section === section) cb.current(restore.detail)
  }, [restore, section])
}

// ------------------------------------------------------------------ inside the shell?

/** `true` inside the shell page: pages skip their own section header (the shell draws one). */
export const InShellContext = createContext(false)

export function useInShell(): boolean {
  return useContext(InShellContext)
}

// ------------------------------------------------------------------ Back shortcut
// ⌘[ on macOS (Ctrl+[ elsewhere) — the system "Back" in Finder/Safari and free in the app's keybinds (the app
// binds ⌘⇧[ / ⌘⌃[ / Alt+[ only) — plus Alt+← (browser Back). Only while focus is inside the page, never from a text field.

export const BACK_SHORTCUT = 'mod+['

export function isMacLike(): boolean {
  try {
    const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined
    const platform = nav?.userAgentData?.platform || nav?.platform || ''
    return /mac|iphone|ipad/i.test(platform)
  } catch {
    return false
  }
}

/** Label for tooltips: "⌘[" on macOS, "Ctrl+[" elsewhere. */
export function backShortcutLabel(): string {
  return isMacLike() ? '⌘[' : 'Ctrl+['
}

/** Value for `aria-keyshortcuts`. */
export function backAriaShortcut(): string {
  return isMacLike() ? 'Meta+BracketLeft Alt+ArrowLeft' : 'Control+BracketLeft Alt+ArrowLeft'
}

export function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function isBackShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>): boolean {
  if (isTextField(e.target) || e.shiftKey) return false
  const bracket = e.key === '[' || e.code === 'BracketLeft'
  if (bracket && !e.altKey && e.metaKey !== e.ctrlKey) return true
  return e.key === 'ArrowLeft' && e.altKey && !e.metaKey && !e.ctrlKey
}
