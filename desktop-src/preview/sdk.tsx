// Preview SDK: everything from the sdk-mock (host, i18n, React Query, atoms) and, on top, SIMPLE
// substitutes for the visual controls with the same utility classes the app uses (copied from
// apps/desktop/src/components/ui/*.tsx), so the preview looks like the app over host-compiled.css.
// Not the real SDK: behavior (Radix, focus, portals, animations) and visual details may differ.
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  cloneElement,
  createContext,
  createElement as h,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

export * from '../test/sdk-mock'
// profile color same as the app's (the tests' mock always returns the accent)
export { profileColor, profileColorSoft } from './profile-color.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any */
type P = Record<string, any>

const join = (...xs: unknown[]) => xs.filter((x) => typeof x === 'string' && x).join(' ')

export const cn = (...xs: unknown[]) => join(...xs.flat(Infinity as 1))

// ------------------------------------------------------------------ icons (the app's codicon font)

export const Codicon = ({ name, className, size, spinning, style, ...rest }: P) =>
  h('i', {
    'aria-hidden': true,
    className: join('codicon', `codicon-${name}`, spinning && 'codicon-modifier-spin', className),
    style: { ...(size != null ? { fontSize: size } : {}), ...style },
    ...rest
  })

// ------------------------------------------------------------------ Button / Badge / Kbd / Skeleton

const BUTTON_BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[2.5px] text-xs leading-4 font-medium whitespace-nowrap shadow-none transition-all duration-100 disabled:pointer-events-none disabled:cursor-default disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
const BUTTON_VARIANT: Record<string, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60',
  outline:
    'bg-transparent text-(--ui-text-primary) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-stroke-secondary)_50%,transparent)] hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
  secondary: 'bg-(--ui-bg-quaternary) text-(--ui-text-primary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
  ghost: 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
  text: 'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
  link: 'text-primary underline-offset-4 hover:underline'
}
const BUTTON_SIZE: Record<string, string> = {
  default: 'px-3 py-1.5',
  xs: 'gap-1 px-2 py-0.5 text-[0.6875rem] leading-4',
  sm: 'px-2.5 py-1',
  lg: 'px-5 py-2 text-sm leading-5',
  icon: 'size-9 rounded-[4px]',
  'icon-xs': 'size-6 rounded-[4px]',
  'icon-sm': 'size-8 rounded-[4px]'
}

export const Button = ({ className, variant = 'default', size = 'default', loading, children, type, asChild: _a, ...rest }: P) =>
  h(
    'button',
    {
      'data-slot': 'button',
      type: type ?? 'button',
      'aria-busy': loading ? 'true' : undefined,
      className: join(BUTTON_BASE, BUTTON_VARIANT[variant] ?? '', BUTTON_SIZE[size] ?? '', className),
      ...rest
    },
    children
  )

const BADGE_VARIANT: Record<string, string> = {
  default: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
  outline: 'border border-(--ui-stroke-secondary) text-muted-foreground',
  solid: 'bg-primary text-primary-foreground'
}
export const Badge = ({ className, variant = 'default', size = 'default', children, ...rest }: P) =>
  h(
    'span',
    {
      'data-slot': 'badge',
      className: join(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-[3px] font-medium leading-none whitespace-nowrap',
        BADGE_VARIANT[variant] ?? '',
        size === 'xs' ? 'px-1 py-px text-[0.6rem]' : 'px-1.5 py-0.5 text-[0.65rem]',
        className
      ),
      ...rest
    },
    children
  )

export const Kbd = ({ className, size = 'md', children, ...rest }: P) =>
  h(
    'kbd',
    {
      'data-slot': 'kbd',
      className: join(
        'inline-flex shrink-0 items-center justify-center border [font-family:var(--dt-font-kbd)] font-normal leading-none select-none',
        'border-[color-mix(in_srgb,var(--ui-stroke-secondary)_75%,transparent)] bg-[color-mix(in_srgb,var(--ui-bg-elevated)_94%,var(--dt-foreground)_6%)] text-[color-mix(in_srgb,var(--dt-foreground)_58%,transparent)]',
        size === 'sm' ? 'rounded-[0.2rem] text-[0.625rem]' : 'rounded-[0.25rem] text-[0.6875rem]',
        className
      ),
      ...rest
    },
    children
  )

export const Skeleton = ({ className, ...rest }: P) =>
  h('div', { 'data-slot': 'skeleton', className: join('animate-pulse rounded-md bg-accent', className), ...rest })

// ------------------------------------------------------------------ Tabs (minimal context, no Radix)

const TabsCtx = createContext<{ value?: string; onValueChange?: (v: string) => void }>({})

export const Tabs = ({ className, value, onValueChange, children, ...rest }: P) =>
  h(TabsCtx.Provider, { value: { value, onValueChange } }, h('div', { 'data-slot': 'tabs', className: join('flex flex-col gap-2', className), ...rest }, children))

export const TabsList = ({ className, children, ...rest }: P) =>
  h(
    'div',
    {
      'data-slot': 'tabs-list',
      role: 'tablist',
      className: join('inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground', className),
      ...rest
    },
    children
  )

export function TabsTrigger({ className, value, children, onClick, ...rest }: P) {
  const ctx = useContext(TabsCtx)
  const active = ctx.value === value
  return h(
    'button',
    {
      type: 'button',
      role: 'tab',
      'data-slot': 'tabs-trigger',
      'data-state': active ? 'active' : 'inactive',
      'aria-selected': active,
      tabIndex: active ? 0 : -1,
      className: join(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className
      ),
      onMouseDown: () => ctx.onValueChange?.(value),
      onClick,
      ...rest
    },
    children
  )
}

// ------------------------------------------------------------------ SegmentedControl

export function SegmentedControl({ className, options, value, onChange, sizing = 'equal' }: P) {
  return h(
    'div',
    {
      'data-slot': 'segmented-control',
      className: join('inline-grid w-fit grid-flow-col gap-0.5 rounded-[5px] bg-(--ui-bg-tertiary) p-0.5', sizing === 'equal' ? 'auto-cols-fr' : 'auto-cols-max', className)
    },
    (options as { id: string; label: string }[]).map((o) =>
      h(
        'button',
        {
          key: o.id,
          type: 'button',
          'aria-pressed': value === o.id,
          onClick: () => onChange(o.id),
          className: join(
            'flex items-center justify-center gap-1 rounded-[3px] px-2.5 py-0.5 text-[0.6875rem] font-medium transition-colors',
            value === o.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )
        },
        o.label
      )
    )
  )
}

// ------------------------------------------------------------------ fields, states, copy

export const SearchField = ({ value, onChange, placeholder, ...rest }: P) =>
  h(
    'label',
    {
      'data-slot': 'search-field',
      style: { display: 'flex', alignItems: 'center', gap: 6, height: 28, borderBottom: '1px solid var(--ui-stroke-tertiary)', color: 'var(--ui-text-tertiary)' }
    },
    h(Codicon, { name: 'search', size: 13 }),
    h('input', {
      value,
      placeholder,
      'aria-label': rest['aria-label'],
      onChange: (e: P) => onChange?.(e.target.value),
      style: { flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', fontSize: 12, color: 'var(--ui-text-primary)' }
    })
  )

export const Checkbox = ({ checked, onCheckedChange, ...rest }: P) =>
  h('input', {
    type: 'checkbox',
    'data-slot': 'checkbox',
    checked: !!checked,
    onChange: (e: P) => onCheckedChange?.(e.target.checked),
    style: { accentColor: 'var(--ui-text-primary)', width: 14, height: 14 },
    ...rest
  })

export const CopyButton = ({ text, label }: P) =>
  h(Button, { variant: 'ghost', size: 'xs', 'data-slot': 'copy-button', 'data-text': text, title: label }, h(Codicon, { name: 'copy', size: 13 }), label)

export const Loader = ({ label, className }: P) =>
  h(
    'div',
    { 'data-slot': 'loader', role: 'status', 'aria-label': label, className: join('inline-flex items-center gap-2 text-xs text-muted-foreground', className) },
    h(Codicon, { name: 'loading', spinning: true, size: 14 }),
    label
  )

export const EmptyState = ({ title, description, className }: P) =>
  h(
    'div',
    { 'data-slot': 'empty-state', className: join('grid min-h-48 place-items-center text-center', className) },
    h('div', null, h('div', { className: 'text-sm font-medium' }, title), description ? h('div', { className: 'mt-1 text-xs text-muted-foreground' }, description) : null)
  )

// Faithful to the real component (apps/desktop/src/components/ui/error-state.tsx): own icon when no `icon` is passed,
// text title in h2 `text-xl`, actions in a grid (stretched button). The kit no longer uses it (components/states.tsx).
export const ErrorState = ({ title, description, children, className, icon }: P) =>
  h(
    'div',
    { 'data-slot': 'error-state', role: 'alert', className: join('grid gap-5', className) },
    h(
      'div',
      { className: 'flex flex-col items-center gap-3 text-center' },
      icon ?? h('span', { className: 'codicon codicon-error text-destructive', style: { fontSize: '1.75rem' } }),
      typeof title === 'string' ? h('h2', { className: 'text-center text-xl font-semibold tracking-tight' }, title) : title,
      typeof description === 'string'
        ? h('p', { className: 'max-w-prose text-center text-sm leading-5 text-muted-foreground' }, description)
        : (description ?? null)
    ),
    children ? h('div', { className: 'grid gap-2' }, children) : null
  )

// ------------------------------------------------------------------ floating layer (the preview "portal")
// Without a portal (the import rule does not allow `react-dom` here), what Radix sends to `body` (menu, tip,
// dialog) stays in place, `position: fixed`, and is set in window coordinates. `fixed` escapes the clipping of the
// scrolling strips (the tab bar); the containing block may not be the window (the page's `container-type`
// changes it), so the position measures where (0,0) landed and corrects by the difference.

type Box = { x: number; y: number }
const VIEWPORT_PAD = 8

/**
 * The "portal": `fixed` does not escape the stacking context of an ancestor with `container-type` (the tab bar,
 * the card), and the neighbor below would paint on top. On mount, the node moves up to the preview surface (still
 * inside the React root: events keep arriving) and, before React removes it, goes back to its original place.
 * Outside the preview (tests), it stays where it is.
 */
function useLift(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useLayoutEffect(() => {
    const el = enabled ? ref.current : null
    const parent = el?.parentNode
    const root = el?.parentElement?.closest('[data-preview-surface]')
    if (!el || !parent || !root || parent === root) return
    const next = el.nextSibling
    root.appendChild(el)
    return () => {
      if (el.parentNode === root) parent.insertBefore(el, next && next.parentNode === parent ? next : null)
    }
  }, [ref, enabled])
}

/** Puts the (fixed) node at the window coordinates `place` asks for; `lift` = also moves up to the surface. */
function useFloating(ref: RefObject<HTMLElement | null>, place: (size: DOMRect) => Box | null, lift: boolean): void {
  const placeRef = useRef(place)
  placeRef.current = place
  useLift(ref, lift)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      el.style.left = '0px'
      el.style.top = '0px'
      const origin = el.getBoundingClientRect()
      const at = placeRef.current(origin)
      if (!at) return
      el.style.left = `${Math.round(at.x - origin.left)}px`
      el.style.top = `${Math.round(at.y - origin.top)}px`
      el.style.visibility = 'visible'
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }) // on every render: the content may change size
}

/** Fits `[start, start+size]` in the window (with slack). */
const clampX = (x: number, w: number) => Math.max(VIEWPORT_PAD, Math.min(x, window.innerWidth - w - VIEWPORT_PAD))

const FLOAT_STYLE = { position: 'fixed', left: 0, top: 0, visibility: 'hidden' } as const

/** Anchor that stays in place (React inserts siblings before it); only the child moves up (`useLift`). */
const portalAnchor = (slot: string, child: ReactNode) => h('span', { 'data-slot': slot, style: { display: 'contents' } }, child)

// ------------------------------------------------------------------ DropdownMenu (like Radix: closed by default)
// The tests' mock always draws the content, in flow; here it only exists with `open` (controlled or not),
// floats attached to the trigger (floating layer above: takes no space, does not push the page and is not clipped by the
// scrolling strip; `align="end"` aligns to the right, the rest to the left) and closes on outside click, Esc or on
// picking an item. Surface and item classes copied from the app's menu.

const MENU_SURFACE =
  'rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1 text-xs text-popover-foreground shadow-md backdrop-blur-md min-w-36 overflow-x-hidden overflow-y-auto'
const MENU_ITEM =
  'relative flex items-center gap-2 rounded-md px-2 py-1 text-xs select-none cursor-default outline-hidden hover:bg-(--ui-control-active-background) focus:bg-(--ui-control-active-background) focus:text-foreground'

type MenuState = { open: boolean; set: (open: boolean) => void; anchor: RefObject<HTMLSpanElement | null> }
const MenuCtx = createContext<MenuState | null>(null)

export function DropdownMenu({ open, defaultOpen, onOpenChange, children }: P) {
  const [inner, setInner] = useState<boolean>(!!defaultOpen)
  const controlled = typeof open === 'boolean'
  const isOpen = controlled ? open : inner
  const anchor = useRef<HTMLSpanElement>(null)
  const set = (v: boolean) => {
    if (!controlled) setInner(v)
    onOpenChange?.(v)
  }
  const setRef = useRef(set)
  setRef.current = set
  useEffect(() => {
    if (!isOpen) return
    const down = (e: Event) => {
      if (anchor.current?.contains(e.target as Node)) return
      setRef.current(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRef.current(false)
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [isOpen])
  // Radix's Root draws no DOM; here the wrapper is the anchor (relative position) of the floating content
  return h(
    MenuCtx.Provider,
    { value: { open: isOpen, set, anchor } },
    h('span', { 'data-slot': 'dropdown-menu', ref: anchor, style: { position: 'relative', display: 'inline-flex' } }, children)
  )
}

export function DropdownMenuTrigger({ asChild, children, ...rest }: P) {
  const ctx = useContext(MenuCtx)
  const state = {
    'aria-haspopup': 'menu',
    'aria-expanded': !!ctx?.open,
    'data-state': ctx?.open ? 'open' : 'closed',
    onClick: (e: unknown) => {
      if (asChild && isValidElement(children)) (children.props as P).onClick?.(e)
      ctx?.set(!ctx.open)
    }
  }
  if (asChild && isValidElement(children)) return cloneElement(children, { ...rest, ...state } as P)
  return h('button', { type: 'button', 'data-slot': 'dropdown-menu-trigger', ...rest, ...state }, children)
}

export function DropdownMenuContent(props: P) {
  const ctx = useContext(MenuCtx)
  return ctx?.open ? h(MenuSurface, { ...props, anchor: ctx.anchor }) : null
}

function MenuSurface({ className, align = 'start', sideOffset = 4, anchor, children, ...rest }: P) {
  const ref = useRef<HTMLDivElement>(null)
  useFloating(
    ref,
    (size) => {
      const a = (anchor as RefObject<HTMLElement | null>).current?.getBoundingClientRect()
      if (!a) return null
      const x = align === 'end' ? a.right - size.width : align === 'center' ? a.left + a.width / 2 - size.width / 2 : a.left
      return { x: clampX(x, size.width), y: a.bottom + (Number(sideOffset) || 0) }
    },
    true
  )
  const surface = h(
    'div',
    {
      ref,
      role: 'menu',
      'data-slot': 'dropdown-menu-content',
      'data-state': 'open',
      'data-align': align,
      className: join(MENU_SURFACE, className),
      style: { ...FLOAT_STYLE, zIndex: 50, width: 'max-content', maxWidth: `calc(100vw - ${2 * VIEWPORT_PAD}px)` },
      ...rest
    },
    children
  )
  return portalAnchor('dropdown-menu-portal', surface)
}

export function DropdownMenuItem({ className, onSelect, children, ...rest }: P) {
  const ctx = useContext(MenuCtx)
  return h(
    'div',
    {
      role: 'menuitem',
      tabIndex: -1,
      'data-slot': 'dropdown-menu-item',
      className: join(MENU_ITEM, className),
      onClick: (e: unknown) => {
        onSelect?.(e)
        ctx?.set(false)
      },
      ...rest
    },
    children
  )
}

export const DropdownMenuSeparator = () => h('div', { role: 'separator', 'data-slot': 'dropdown-menu-separator', className: '-mx-1 my-1 h-px bg-(--ui-stroke-tertiary)' })

// ------------------------------------------------------------------ dialog (inline panel, no portal)

export const Dialog = ({ open, children }: P) => (open === false ? null : h('div', { 'data-slot': 'dialog', role: 'dialog' }, children))
export const DialogContent = ({ className, children, showCloseButton: _s, ...rest }: P) =>
  h(
    'div',
    {
      'data-slot': 'dialog-content',
      className,
      style: {
        margin: '24px auto',
        background: 'var(--ui-bg-elevated)',
        border: '1px solid var(--ui-stroke-secondary)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: 'var(--shadow-nous)'
      },
      ...rest
    },
    children
  )
export const DialogHeader = ({ children }: { children?: ReactNode }) => h('div', { 'data-slot': 'dialog-header', style: { display: 'grid', gap: 4 } }, children)
export const DialogFooter = ({ children }: { children?: ReactNode }) =>
  h('div', { 'data-slot': 'dialog-footer', style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, children)
export const DialogTitle = ({ children }: { children?: ReactNode }) =>
  h('h2', { 'data-slot': 'dialog-title', style: { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ui-text-primary)' } }, children)
export const DialogDescription = ({ children }: { children?: ReactNode }) =>
  h('p', { 'data-slot': 'dialog-description', style: { margin: 0, fontSize: 12, color: 'var(--ui-text-tertiary)' } }, children)

// ------------------------------------------------------------------ Tip (tooltip bubble, like the app's)
// The tests' mock only marks the child (`data-tip`); here the bubble really exists, with the app's classes
// (`tooltip-bubble`, `foreground` background, arrow), in the floating layer above the trigger (`side="top"`). Opens on hover
// after the delay (`delayDuration`) or when the SCENARIO asks: an ancestor with `data-preview-tip-open="<selector>"`
// opens the tip of the first trigger the selector finds inside it (only one per scenario). For the screenshot, the requested
// trigger gets focus (no ring): the grid's quick actions only show on card hover/focus.

const TIP_BUBBLE =
  'tooltip-bubble pointer-events-none w-fit select-none bg-foreground px-2 py-1 text-[0.6875rem] font-medium leading-[1.4] text-background'
const TIP_ARROW_W = 10

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const r of refs) {
      if (typeof r === 'function') r(node)
      else if (r) (r as { current: T | null }).current = node
    }
  }
}

/** Did the scenario ask for this trigger's tip to be open? */
function tipRequested(el: HTMLElement | null): boolean {
  const host = el?.closest<HTMLElement>('[data-preview-tip-open]')
  const sel = host?.getAttribute('data-preview-tip-open')
  if (!host || !sel) return false
  try {
    return host.querySelector(sel) === el
  } catch {
    return false
  }
}

export function Tip({ label, children, delayDuration = 150, side = 'top', sideOffset = 5, className }: P) {
  const id = useId()
  const triggerRef = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [hover, setHover] = useState(false)
  const [requested, setRequested] = useState(false)
  useLayoutEffect(() => {
    const el = triggerRef.current
    if (!tipRequested(el)) return
    setRequested(true)
    el?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!label || !isValidElement(children)) return h(Fragment, null, children)
  const open = requested || hover
  const own = children.props as P
  const trigger = cloneElement(children as ReactElement<P>, {
    ref: mergeRefs(own.ref as Ref<HTMLElement> | undefined, triggerRef),
    'data-tip': typeof label === 'string' ? label : '',
    'data-tip-delay': String(delayDuration),
    'aria-describedby': open ? id : own['aria-describedby'],
    onMouseEnter: (e: unknown) => {
      own.onMouseEnter?.(e)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setHover(true), Number(delayDuration) || 0)
    },
    onMouseLeave: (e: unknown) => {
      own.onMouseLeave?.(e)
      clearTimeout(timer.current)
      setHover(false)
    }
  })
  // no wrapper (like `TooltipTrigger asChild`); the fixed bubble does not enter the parent's flow
  return h(Fragment, null, trigger, open ? h(TipBubble, { id, anchor: triggerRef, side, sideOffset, className }, label) : null)
}

function TipBubble({ id, anchor, side, sideOffset, className, children }: P) {
  const ref = useRef<HTMLDivElement>(null)
  const arrow = useRef<SVGSVGElement>(null)
  const below = side === 'bottom'
  useFloating(
    ref,
    (size) => {
      const a = (anchor as RefObject<HTMLElement | null>).current?.getBoundingClientRect()
      if (!a) return null
      const x = clampX(a.left + a.width / 2 - size.width / 2, size.width)
      const gap = (Number(sideOffset) || 0) + 5 // + the arrow
      if (arrow.current) arrow.current.style.left = `${Math.round(a.left + a.width / 2 - x - TIP_ARROW_W / 2)}px`
      return { x, y: below ? a.bottom + gap : a.top - gap - size.height }
    },
    true
  )
  const bubble = h(
    'div',
    {
      ref,
      id,
      role: 'tooltip',
      'data-slot': 'tooltip-content',
      'data-side': below ? 'bottom' : 'top',
      'data-state': 'delayed-open',
      className: join(TIP_BUBBLE, className),
      style: { ...FLOAT_STYLE, zIndex: 60 }
    },
    h('div', { className: 'tooltip-bubble-label', 'data-slot': 'tooltip-label' }, children),
    h(
      'svg',
      {
        ref: arrow,
        'aria-hidden': true,
        'data-slot': 'tooltip-arrow',
        viewBox: '0 0 10 5',
        width: TIP_ARROW_W,
        height: 5,
        style: { position: 'absolute', left: `calc(50% - ${TIP_ARROW_W / 2}px)`, ...(below ? { bottom: '100%', transform: 'rotate(180deg)' } : { top: '100%' }) }
      },
      h('path', { d: 'M0 0h10L5.7 4.3a1 1 0 0 1-1.4 0Z' })
    )
  )
  return portalAnchor('tooltip-portal', bubble)
}

// ------------------------------------------------------------------ ConfirmDialog (the app dialog's frame)
// Like the app's `ConfirmDialog` (components/ui/confirm-dialog.tsx over Radix's Dialog): veil, box centered
// in the window with the dialog skin (`stroke-nous` border, `chat-bubble` background, `shadow-nous`), header
// (title + description), error inside the dialog, footer with "cancel" (ghost) and "confirm" (destructive or
// primary). Focus on confirm; Enter confirms, Esc/veil/cancel close. Failure → shows the error and does not close.

export const ConfirmDialog = (props: P) => (props.open ? h(ConfirmSurface, props) : null)

function ConfirmSurface({ onClose, onOpenChange, onConfirm, title, description, children, confirmLabel, cancelLabel, busyLabel, destructive }: P) {
  const titleId = useId()
  const descId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    onOpenChange?.(false)
    onClose?.()
  }
  const closeRef = useRef(close)
  closeRef.current = busy ? () => undefined : close
  useLift(rootRef) // before positioning: moving up changes the containing block
  useFloating(
    ref,
    (size) => ({ x: clampX(window.innerWidth / 2 - size.width / 2, size.width), y: Math.max(VIEWPORT_PAD, window.innerHeight / 2 - size.height / 2) }),
    false
  )
  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  const run = () => {
    if (busy) return
    setError(null)
    setBusy(true)
    Promise.resolve()
      .then(() => onConfirm?.())
      .then(
        () => {
          setBusy(false)
          onClose?.()
        },
        (e: unknown) => {
          setBusy(false)
          setError(e instanceof Error ? e.message : String(e))
        }
      )
  }
  const header = h(
    'div',
    { 'data-slot': 'dialog-header', className: 'flex flex-col gap-1 text-center sm:text-left' },
    h('h2', { id: titleId, 'data-slot': 'dialog-title', className: 'text-[0.9375rem] font-semibold tracking-tight text-foreground' }, title),
    description
      ? h(
          'p',
          {
            id: descId,
            'data-slot': 'dialog-description',
            className:
              'whitespace-pre-line text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)'
          },
          description
        )
      : null
  )
  const problem = error
    ? h(
        'div',
        {
          role: 'alert',
          'data-slot': 'confirm-error',
          className: 'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'
        },
        h(Codicon, { name: 'warning', size: 14 }),
        h('span', null, error)
      )
    : null
  const footer = h(
    'div',
    { 'data-slot': 'dialog-footer', className: 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end' },
    h(Button, { variant: 'ghost', disabled: busy, onClick: close }, cancelLabel ?? 'Cancel'),
    h(Button, { ref: confirmRef, variant: destructive ? 'destructive' : 'default', disabled: busy, loading: busy, onClick: run }, busy && busyLabel ? busyLabel : (confirmLabel ?? 'Confirm'))
  )
  const box = h(
    'div',
    {
      ref,
      role: 'alertdialog',
      'aria-modal': true,
      'aria-labelledby': titleId,
      'aria-describedby': description ? descId : undefined,
      'data-slot': 'dialog-content',
      'data-state': 'open',
      className:
        'flex max-h-[85vh] max-w-md flex-col rounded-xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) text-[length:var(--conversation-text-font-size)] text-foreground shadow-nous',
      style: { ...FLOAT_STYLE, zIndex: 41, width: 'calc(100vw - 2rem)' },
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key !== 'Enter' || busy) return
        e.preventDefault()
        run()
      }
    },
    h('div', { className: 'grid min-h-0 grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto rounded-[inherit] p-4' }, header, children ?? null, problem, footer)
  )
  const overlay = h('div', {
    'data-slot': 'dialog-overlay',
    'data-state': 'open',
    className: 'pointer-events-auto bg-black/22 backdrop-blur-[0.125rem]',
    style: { position: 'fixed', inset: 0, zIndex: 40 },
    onClick: () => closeRef.current()
  })
  // the frame stays in place (React inserts siblings before it); the layer (veil + box) moves up
  const layer = h('div', { ref: rootRef, 'data-slot': 'dialog-portal', style: { display: 'contents' } }, overlay, box)
  return h('div', { 'data-slot': 'confirm-dialog', 'data-destructive': destructive ? 'true' : undefined, style: { display: 'contents' } }, layer)
}

// ------------------------------------------------------------------ MessageTextContent
// In the app, the bare link of a video becomes the core's embedded player (youtube-nocookie.com, under the embed
// consent). The preview has no such player: it draws a 16:9 frame in its place, labeled "Hermes player", the
// same size the core gives the player (up to 640 px, height up to 1/3 of the window) and with the app's consent facade
// frame (dashed border). With `globalThis.__previewPlayerPoster` set (the public screenshots' Watch scenario), the
// frame shows the video's poster (i.ytimg.com) with a play button instead, like the embed before it starts.
export function MessageTextContent({ text }: P) {
  let host = ''
  let videoId = ''
  try {
    const url = new URL(String(text))
    host = url.hostname.replace(/^www\./, '')
    videoId = url.searchParams.get('v') ?? ''
  } catch {
    host = ''
  }
  if ((globalThis as Record<string, unknown>).__previewPlayerPoster && /^[\w-]{11}$/.test(videoId)) return posterPlayer(String(text), videoId)
  return h(
    'div',
    { 'data-slot': 'message-text', 'data-text': text, 'data-preview-player': '' },
    h(
      'span',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: 'min(640px, 100%, calc(33dvh * 16 / 9))',
          aspectRatio: '16 / 9',
          margin: '8px 0',
          borderRadius: 8,
          border: '1px dashed var(--ui-stroke-tertiary)',
          background: 'color-mix(in srgb, var(--ui-bg-quinary) 30%, transparent)',
          color: 'var(--ui-text-secondary)'
        }
      },
      h(Codicon, { name: 'play-circle', size: 28 }),
      h('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Hermes player'),
      host ? h('span', { style: { fontSize: 11 } }, host) : null
    )
  )
}

/** Poster mode of the player stand-in: same box as the core's player, the video's poster and a play button. */
function posterPlayer(text: string, videoId: string) {
  return h(
    'div',
    { 'data-slot': 'message-text', 'data-text': text, 'data-preview-player': 'poster' },
    h(
      'span',
      {
        style: {
          position: 'relative',
          display: 'block',
          width: 'min(640px, 100%, calc(33dvh * 16 / 9))',
          aspectRatio: '16 / 9',
          margin: '8px 0',
          borderRadius: 8,
          overflow: 'hidden',
          // a video player is dark in both themes (named colors: the interface code has no hex/rgb)
          background: 'black'
        }
      },
      h('img', {
        src: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        alt: '',
        onError: (e: { currentTarget: HTMLImageElement }) => {
          const img = e.currentTarget
          if (!img.src.endsWith('/hqdefault.jpg')) img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        },
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
      }),
      h(
        'span',
        {
          'aria-hidden': true,
          style: {
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 68,
            height: 48,
            marginLeft: -34,
            marginTop: -24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            background: 'color-mix(in srgb, black 72%, transparent)',
            color: 'white'
          }
        },
        h(Codicon, { name: 'play', size: 28 })
      )
    )
  )
}
