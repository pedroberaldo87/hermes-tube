// Welcome dialog (`onboarding`, opened by openDialog('onboarding', {step?}) from the empty Subscriptions screen, its
// strips, the Manage header and the ⌘K command "Connect a browser or add a channel"; registered in
// main.tsx/DIALOGS). The first impression for a new install: the product sentence and the 3 paths
// (PathGroup/PathCard; the recommended one — connect the extension — gets the accent):
//   1. connect the extension (pair.tsx: code, step by step, live wait, first sync);
//   2. paste a link or @handle (link.tsx: optimistic, with undo);
//   3. demo mode (demo.tsx: load, follow the videos, clear).
// Connected browsers sit in a discreet section (devices.tsx). Keyboard: 1/2/3 only move the focus to that
// path's button (outside a text field, without modifiers); Enter or a click on the focused button opens it — a
// single key never loads the demo or opens a pairing code. "All paths" goes back, Esc closes. Closes by itself when the channels arrive and, when closing
// after changing something, tells Home (`invalidateRest`). Rules: only lib/, components/ and shared/.
import { Button, Codicon, Kbd } from '@hermes/plugin-sdk'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { DialogProps } from '../../../shared/ids'
import { DialogFrame, Hero, PathCard, PathGroup, Section, Stack } from '../../components'
import type { DialogControls } from '../../lib/dialogs'
import { useT } from '../../lib/i18n'
import { invalidateRest, useRest } from '../../lib/rest'
import { cx } from '../../lib/style'
import { DemoPanel, type DemoState } from './demo'
import { DevicesSection } from './devices'
import { type LinkItem, LinkPanel } from './link'
import type { OnboardingView } from './model'
import { type PairPhase, type PairState, PairPanel } from './pair'
import { PluginOffNotice, RemoteNotice, usePairReach } from './reach'
import { useOnboardingStyles } from './style'

/** Pairing subtitle: asks for the code only while it is the next step; afterwards it says the current state. */
const PAIR_DESC: Partial<Record<PairPhase, string>> = { syncing: 'pair.desc_syncing', done: 'pair.desc_done' }

export type { OnboardingView } from './model'

/** Fixed initial state of each path (scenario preview and tests); without it, the dialog acts on its own. */
export interface OnboardingSeed {
  view: OnboardingView
  pair?: PairState
  link?: { items?: LinkItem[]; draft?: string; fieldError?: 'empty' | 'format' | null }
  demo?: DemoState
}

export type OnboardingDialogProps = DialogProps['onboarding'] &
  DialogControls & {
    /** Preview/tests only: opens in a fixed state. */
    initial?: OnboardingSeed
  }

/** 1/2/3 → the index of the path card whose button gets the focus (same order as on screen). */
const KEY_TO_CARD: Record<string, number> = { '1': 0, '2': 1, '3': 2 }

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

export function OnboardingDialog({ step, onClose, initial }: OnboardingDialogProps) {
  const t = useT('onboarding')
  useOnboardingStyles()
  const [view, setView] = useState<OnboardingView>(initial?.view ?? step ?? 'paths')
  // the demo loads by itself when the user chose it (card or `step: 'demo'`)
  const [autoLoadDemo, setAutoLoadDemo] = useState(!initial && step === 'demo')
  const [pairPhase, setPairPhase] = useState<PairPhase | null>(initial?.pair?.phase ?? null)
  const reach = usePairReach()
  // "my browser is on that computer": the steps for a remote gateway, on request
  const [anyway, setAnyway] = useState(false)
  const backRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const chosen = useRef(false)
  const dirty = useRef(false)

  const markDirty = useCallback(() => {
    dirty.current = true
  }, [])

  /** Closes and tells Home (all of the plugin's queries). */
  const finish = useCallback(() => {
    dirty.current = false
    void invalidateRest()
    onClose()
  }, [onClose])

  // closed via × / Esc after changing something → Home needs to know too
  useEffect(
    () => () => {
      if (dirty.current) void invalidateRest()
    },
    []
  )

  const choose = useCallback((next: OnboardingView) => {
    chosen.current = true
    if (next === 'demo') setAutoLoadDemo(true)
    setView(next)
  }, [])

  // focus when switching path: pane → "all paths" (the link path focuses its own field); back → container
  useEffect(() => {
    if (!chosen.current) return
    if (view === 'paths') rootRef.current?.focus()
    else if (view !== 'link') backRef.current?.focus()
  }, [view])

  // 1/2/3 focus a path's button (the dialog stack only shows the top one; a text field does not trigger it). The
  // key never acts by itself: the demo would load and a pairing code would open without a click
  useEffect(() => {
    if (view !== 'paths' || typeof document === 'undefined') return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      const index = KEY_TO_CARD[e.key]
      if (index === undefined) return
      const cards = rootRef.current?.querySelectorAll('[data-part="path-card"]')
      const button = cards?.[index]?.querySelector<HTMLButtonElement>('[data-part="path-foot"] button')
      if (!button) return
      e.preventDefault()
      button.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view])

  const back = (
    <Stack direction="row">
      <Button ref={backRef} variant="ghost" size="sm" data-part="onboarding-back" onClick={() => choose('paths')}>
        <Codicon name="arrow-left" size={14} />
        {t('back')}
      </Button>
    </Stack>
  )

  let body: ReactNode
  if (view === 'pair') {
    // a code and steps only where they can work: not on another computer's gateway, not where the plugin is off
    // (the preview's fixed states skip the check)
    const blocked = initial ? null : reach.kind === 'remote' && !anyway ? reach : reach.kind === 'off' ? reach : null
    const checking = !initial && reach.kind === 'checking'
    body = (
      <>
        {back}
        <Section title={t('pair.title')} description={blocked ? undefined : t((pairPhase && PAIR_DESC[pairPhase]) || 'pair.desc')}>
          {blocked?.kind === 'remote' ? (
            <RemoteNotice name={blocked.name} local={blocked.local} onAnyway={() => setAnyway(true)} />
          ) : blocked?.kind === 'off' ? (
            <PluginOffNotice profile={blocked.profile} onRetry={blocked.retry} />
          ) : checking ? null : (
            <PairPanel
              seed={initial?.view === 'pair' ? initial.pair : undefined}
              onFinish={finish}
              onDirty={markDirty}
              onPhase={setPairPhase}
              aside={<DevicesSection />}
            />
          )}
        </Section>
        {/* the connected browsers sit inside the pairing panel (left column); here only while it is not drawn yet */}
        {blocked || !checking ? null : <DevicesSection />}
      </>
    )
  } else if (view === 'link') {
    body = (
      <>
        {back}
        <Section title={t('link.title')} description={t('link.desc')}>
          <LinkPanel seed={initial?.view === 'link' ? initial.link : undefined} onFinish={finish} onDirty={markDirty} autoFocus={!initial} />
        </Section>
      </>
    )
  } else if (view === 'demo') {
    body = (
      <>
        {back}
        <Section title={t('demo.title')} description={t('demo.desc')}>
          <DemoPanel seed={initial?.view === 'demo' ? initial.demo : undefined} autoLoad={autoLoadDemo} onFinish={finish} onDirty={markDirty} />
        </Section>
      </>
    )
  } else {
    body = <PathsView onChoose={choose} />
  }

  // the pairing step is the widest: setup and code side by side, so it fits a laptop window without scrolling
  const pairing = view === 'pair'
  return (
    <DialogFrame title={t('title')} onClose={onClose} size={pairing ? 'xl' : 'lg'} className={cx('obdialog')}>
      <div ref={rootRef} tabIndex={-1} data-part="onboarding" data-view={view}>
        <Stack gap={pairing ? 3 : 5}>{body}</Stack>
      </div>
    </DialogFrame>
  )
}

function PathsView({ onChoose }: { onChoose: (view: OnboardingView) => void }) {
  const t = useT('onboarding')
  // demo already loaded → the card becomes "manage demo" (that is where "clear" lives)
  const demo = useRest('GET /demo', {})
  const demoLoaded = demo.data?.loaded === true
  const hint = (label: string, key: string) => (
    <span title={t('paths.key_hint', { key })}>
      {label} · <Kbd>{key}</Kbd>
    </span>
  )
  return (
    <>
      <Hero icon="play-circle" title={t('hero.tagline')} description={t('hero.lead')} />
      <PathGroup label={t('paths.label')}>
        <PathCard
          primary
          icon="plug"
          title={t('paths.pair.title')}
          description={t('paths.pair.desc')}
          actionLabel={t('paths.pair.action')}
          onAction={() => onChoose('pair')}
          hint={hint(t('paths.pair.hint'), '1')}
        />
        <PathCard
          icon="link"
          title={t('paths.link.title')}
          description={t('paths.link.desc')}
          actionLabel={t('paths.link.action')}
          onAction={() => onChoose('link')}
          hint={hint(t('paths.link.hint'), '2')}
        />
        <PathCard
          icon="beaker"
          title={t('paths.demo.title')}
          description={demoLoaded ? t('paths.demo.loaded_desc') : t('paths.demo.desc')}
          actionLabel={demoLoaded ? t('paths.demo.loaded_action') : t('paths.demo.action')}
          onAction={() => onChoose('demo')}
          hint={hint(t('paths.demo.hint'), '3')}
        />
      </PathGroup>
      <DevicesSection />
    </>
  )
}
