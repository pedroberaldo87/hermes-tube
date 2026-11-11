// Header of the single HermesTube page: Back · "HermesTube" · internal tabs (Subscriptions · Manage · Cleanup;
// Extras only with EXTRAS_PAGE_READY; Watch while a video is open, with its short title and a ✕ that closes it).
// The app's sidebar has one entry ("HermesTube" → the page); switching sections is OUR state (lib/nav), never
// `host.navigate` to another route.
//
//   wide     Back + brand + segmented strip; the current one with aria-current="page"; one Tab stop (the current)
//            and arrows/Home/End move focus between the sections (Enter/Space opens)
//   narrow   the strip becomes a compact menu ("Manage ▾"); the switch is container CSS only (both forms are in the
//            DOM; each query only hides one — css-container.test rule)
//
// Why not the SDK's `SegmentedControl`/`Tabs`: the first marks with aria-pressed (a toggle, not navigation) and has no
// arrows; the second is for panels of one screen (role=tab/tabpanel). Here each item is a whole screen.
// `ShellPage` is the single page itself: the header once and one section at a time (below). `SectionFrame` puts the
// header above a page mounted on its own (preview, tests); inside `ShellPage` it only passes the page through.
import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tip, useValue } from '@hermes/plugin-sdk'
import { type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode, useRef } from 'react'
import { useT } from '../lib/i18n'
import {
  InShellContext,
  PAGE_SECTIONS,
  type PageSectionKey,
  type SectionKey,
  backAriaShortcut,
  backShortcutLabel,
  closeWatch,
  goBack,
  isBackShortcut,
  isSectionAvailable,
  showSection,
  useInShell,
  useNav
} from '../lib/nav'
import { $watch, tabTitle } from '../lib/player'
import { cx } from '../lib/style'

export type { SectionKey } from '../lib/nav'

/** Page sections in the strip's order (Watch is added while a video is open). */
export const SECTION_KEYS: readonly PageSectionKey[] = PAGE_SECTIONS

/** Length of the video title on the Watch tab. */
export const WATCH_TAB_MAX = 28

/** Section icons (the ones of the old sidebar menu). */
const SECTION_ICON: Record<SectionKey, string> = {
  home: 'play-circle',
  manage: 'list-flat',
  cleanup: 'trash',
  extras: 'sparkle',
  watch: 'play'
}

export interface SectionNavProps {
  /** Section shown (marked). Default: the current one in lib/nav. */
  current?: SectionKey
}

export function BackButton() {
  const t = useT()
  const { canBack } = useNav()
  const label = t('sections.back')
  return (
    <Tip label={`${label} · ${backShortcutLabel()}`}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cx('secnav-back')}
        data-part="nav-back"
        aria-label={label}
        aria-keyshortcuts={backAriaShortcut()}
        disabled={!canBack}
        onClick={() => goBack()}
      >
        <Codicon name="arrow-left" size={15} />
      </Button>
    </Tip>
  )
}

export function SectionNav({ current: forced }: SectionNavProps) {
  const t = useT()
  const nav = useNav()
  const watch = useValue($watch)
  const current = forced ?? nav.current
  const trackRef = useRef<HTMLDivElement>(null)
  const label = (k: SectionKey) => t(`routes.${k}`)
  const hasWatch = !!watch && isSectionAvailable('watch')
  const watchTitle = hasWatch ? tabTitle(watch?.item?.video.title, t('routes.watch'), WATCH_TAB_MAX) : ''
  // (showSection on the current section is a no-op)
  const go = (k: SectionKey) => showSection(k)

  // roving focus: arrows move (wrapping), Home/End go to the ends; the click/Enter/Space switches
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(trackRef.current?.querySelectorAll<HTMLButtonElement>('button[data-section]') ?? [])]
    const at = buttons.indexOf(e.target as HTMLButtonElement)
    if (at < 0) return
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % buttons.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    if (next < 0) return
    e.preventDefault()
    buttons[next]?.focus()
  }

  const watchCurrent = current === 'watch'
  return (
    <nav className={cx('secnav')} data-part="section-nav" aria-label={t('sections.label')}>
      <BackButton />
      <span className={cx('secnav-brand t-head')} data-part="section-brand">
        <Codicon name="play-circle" size={15} className={cx('secnav-brand-icon')} />
        {t('plugin_name')}
      </span>
      <div className={cx('secnav-track')} data-part="section-tabs" ref={trackRef} onKeyDown={onKeyDown}>
        {SECTION_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={cx('bare secnav-item t-label')}
            data-section={k}
            aria-current={k === current ? 'page' : undefined}
            tabIndex={k === current ? 0 : -1}
            onClick={() => go(k)}
          >
            {label(k)}
          </button>
        ))}
        {hasWatch ? (
          <span className={cx('secnav-watch')} data-part="section-watch" data-current={watchCurrent ? 'true' : undefined}>
            <button
              type="button"
              className={cx('bare secnav-item secnav-watch-item t-label')}
              data-section="watch"
              aria-current={watchCurrent ? 'page' : undefined}
              tabIndex={watchCurrent ? 0 : -1}
              title={watch?.item?.video.title ?? undefined}
              onClick={() => go('watch')}
            >
              <Codicon name={SECTION_ICON.watch} size={11} className={cx('secnav-watch-icon')} />
              <span className={cx('truncate')}>{watchTitle}</span>
            </button>
            <button type="button" className={cx('bare secnav-watch-close')} data-part="watch-close" aria-label={t('sections.close_video')} title={t('sections.close_video')} onClick={() => closeWatch()}>
              <Codicon name="close" size={12} />
            </button>
          </span>
        ) : null}
      </div>
      <div className={cx('secnav-compact')} data-part="section-menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-part="section-menu-trigger"
              aria-label={t('sections.menu', { section: current === 'watch' ? watchTitle : label(current) })}
            >
              <Codicon name={SECTION_ICON[current]} size={14} />
              <span className={cx('truncate')}>{current === 'watch' ? watchTitle : label(current)}</span>
              <Codicon name="chevron-down" size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SECTION_KEYS.map((k) => (
              <DropdownMenuItem key={k} data-section={k} aria-current={k === current ? 'page' : undefined} onSelect={() => go(k)}>
                <Codicon name={k === current ? 'check' : SECTION_ICON[k]} size={14} />
                {label(k)}
              </DropdownMenuItem>
            ))}
            {hasWatch ? (
              <>
                <DropdownMenuItem data-section="watch" aria-current={watchCurrent ? 'page' : undefined} onSelect={() => go('watch')}>
                  <Codicon name={watchCurrent ? 'check' : SECTION_ICON.watch} size={14} />
                  {watchTitle}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-part="watch-close-menu" onSelect={() => closeWatch()}>
                  <Codicon name="close" size={14} />
                  {t('sections.close_video')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}

export interface SectionFrameProps {
  /** Section of this page (marked when the page is mounted on its own). */
  current: SectionKey
  /** The page (a kit `Page`). */
  children: ReactNode
}

/** Header above the page; the page takes the rest of the height (scrolls inside). Inside the shell: the page only. */
export function SectionFrame({ current, children }: SectionFrameProps) {
  const inShell = useInShell()
  if (inShell) return <>{children}</>
  return (
    <div className={cx('sections')} data-part="sections">
      <SectionNav current={current} />
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ the single page

// One center tab: the header and one section shown at a time. main.tsx hands over the screens.
//  - Page sections (Subscriptions, Manage, Cleanup, Extras) mount the first time they are shown and then stay mounted,
//    hidden, so their state survives a switch (Home tab, filters, selection, scroll) and nothing is fetched again.
//  - Watch mounts only while it is the current section: leaving it stops the player (a hidden player would keep
//    playing). Its internal tab stays until ✕.
//  - Back: the header button, ⌘[ / Ctrl+[ or Alt+← while focus is inside the page (never from a text field), and the
//    mouse "back" button.

export type SectionScreens = Partial<Record<SectionKey, ComponentType>>

/** Mouse button 4 ("back" on most mice) arrives as `button === 3`. */
const MOUSE_BACK = 3

export function ShellPage({ sections }: { sections: SectionScreens }) {
  const { current } = useNav()
  const visited = useRef(new Set<SectionKey>())
  if (current !== 'watch') visited.current.add(current)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !isBackShortcut(e)) return
    if (goBack()) e.preventDefault()
  }
  const onMouseUp = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button === MOUSE_BACK && goBack()) e.preventDefault()
  }

  const Watch = sections.watch
  return (
    <InShellContext.Provider value={true}>
      <div className={cx('sections shell')} data-part="shell" data-section={current} onKeyDown={onKeyDown} onMouseUp={onMouseUp}>
        <SectionNav current={current} />
        {PAGE_SECTIONS.filter((k) => visited.current.has(k)).map((k) => {
          const Screen = sections[k]
          return (
            <div key={k} className={cx('shell-section')} data-part="shell-section" data-section={k} hidden={k !== current}>
              {Screen ? <Screen /> : null}
            </div>
          )
        })}
        {current === 'watch' && Watch ? (
          <div key="watch" className={cx('shell-section')} data-part="shell-section" data-section="watch">
            <Watch />
          </div>
        ) : null}
      </div>
    </InShellContext.Provider>
  )
}
