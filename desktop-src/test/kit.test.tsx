// Component kit: each component in each variant/state, Grid keyboard, skeleton with the same
// box as the final one, only plugin-prefix classes in the DOM, texts through useT.
import { act, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, FeedItem } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import {
  ApprovalCard,
  ApprovalCardSkeleton,
  Banner,
  ChannelAvatar,
  ChannelAvatarSkeleton,
  ChannelRow,
  ChannelRowSkeleton,
  ChannelTable,
  ChipSkeleton,
  Count,
  DialogFrame,
  Dot,
  EmptyView,
  FilterBar,
  FolderChip,
  Grid,
  GridSkeleton,
  Hero,
  LoadingState,
  ModeSwitch,
  Page,
  PageFrame,
  PairingCode,
  PairingCodeSkeleton,
  PairingSteps,
  PathCard,
  PathCardSkeleton,
  QueryView,
  QuickActions,
  Section,
  Stack,
  Stat,
  StatSkeleton,
  StatusBarItem,
  StepProgress,
  StepProgressSkeleton,
  SuggestionGroup,
  SuggestionRow,
  SuggestionRowSkeleton,
  TabBar,
  TabBarSkeleton,
  TagChip,
  Thumb,
  ThumbSkeleton,
  Toolbar,
  Tree,
  TreeItem,
  TreeItemSkeleton,
  VideoCard,
  VideoCardSkeleton,
  Why,
  formatRelative
} from '../components'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { CLASS_PREFIX } from '../lib/style'
import { click, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

// The base mock draws the SegmentedControl as an empty <div>; here it gets clickable options (like the real one)
// to prove that ModeSwitch passes the 3 densities and forwards the choice.
vi.mock('@hermes/plugin-sdk', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  const { createElement } = await import('react')
  type Opt = { id: string; label: string }
  const SegmentedControl = ({ options, value, onChange }: { options: Opt[]; value: string; onChange: (id: string) => void }) =>
    createElement(
      'div',
      { 'data-slot': 'segmented-control' },
      options.map((o) =>
        createElement('button', { key: o.id, type: 'button', 'data-id': o.id, 'aria-pressed': o.id === value, onClick: () => onChange(o.id) }, o.label)
      )
    )
  return { ...mod, SegmentedControl }
})

// ------------------------------------------------------------------ data

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)

const CHANNEL: Channel = {
  id: 'UCHnyfMqiRRG1u-2MsSQLbXA',
  title: 'Veritasium',
  relation: 'subscribed',
  source: 'extension',
  added_at: 1762000000,
  handle: '@veritasium',
  thumb: null,
  url: 'https://www.youtube.com/@veritasium',
  folder_id: 'f_sci',
  favorite: true,
  muted: false,
  unsubscribed_at: null,
  last_video_at: sec(NOW - 3 * 86400_000),
  videos_per_week: 2,
  shorts_ratio: 0.4,
  ai_note: null,
  tag_ids: []
}

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    video: {
      id,
      channel_id: CHANNEL.id,
      title: `Video ${id}`,
      published_at: sec(NOW - 2 * 3600_000),
      description: 'A description',
      channel_title: CHANNEL.title,
      duration_s: 1500,
      is_short: false,
      views: 1_200_000,
      first_seen_at: sec(NOW),
      origin: 'rss'
    },
    channel: CHANNEL,
    state: 'new',
    reaction: null,
    is_new: true,
    why: { via: 'folder', label: 'Science', detail: null },
    badges: [],
    ...over
  }
}

const ITEMS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff', 'ggggggggggg'].map((id) =>
  item(id)
)

beforeEach(() => {
  const { ctx } = createMockCtx(PLUGIN_ID)
  setPluginContext(ctx)
  registerLocales(ctx)
})

/** Every class in the rendered DOM has the plugin prefix. */
function foreignClasses(root: Element): string[] {
  const bad = new Set<string>()
  for (const el of [root, ...root.querySelectorAll('*')])
    for (const c of el.classList) if (!c.startsWith(CLASS_PREFIX)) bad.add(c)
  return [...bad]
}

function key(el: Element | null, k: string, init: KeyboardEventInit = {}): void {
  if (!el) throw new Error(`key ${k}: elemento ausente`)
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

const active = () => document.activeElement as HTMLElement | null

/** Sequence of structural parts (data-part) of an element: the "box" skeleton and final share. */
function parts(root: Element | null): string[] {
  if (!root) return []
  return [...root.querySelectorAll('[data-part]')].map((e) => e.getAttribute('data-part') ?? '')
}

// ------------------------------------------------------------------ structure

describe('structure', () => {
  it('Page: title, subtitle, actions, bar, strip and scrollable area; PageFrame is an alias', () => {
    const v = render(
      <Page title="Home" subtitle="12 new" actions={<button type="button">act</button>} toolbar={<span>tools</span>} banner={<span>strip</span>}>
        <p>body</p>
      </Page>
    )
    const root = v.container.firstElementChild
    expect(root?.getAttribute('data-part')).toBe('page')
    expect(v.container.querySelector('h1')?.textContent).toBe('Home')
    for (const t of ['12 new', 'act', 'tools', 'strip', 'body']) expect(v.text()).toContain(t)
    expect(v.container.querySelector('[data-part="page-body"]')?.textContent).toBe('body')
    expect(PageFrame).toBe(Page)
  })

  it('Section, Toolbar e Stack', () => {
    const v = render(
      <Stack gap={3} direction="row" wrap>
        <Section title="Tech" count={3} description="desc" actions={<span>a</span>}>
          <Toolbar end={<span>end</span>}>
            <span>start</span>
          </Toolbar>
        </Section>
      </Stack>
    )
    expect(v.container.querySelector('h2')?.textContent).toContain('Tech')
    expect(v.container.querySelector('[data-part="stack"]')?.getAttribute('data-direction')).toBe('row')
    for (const t of ['desc', 'start', 'end', '3']) expect(v.text()).toContain(t)
  })

  it('Banner: tones, action and close; error is an alert', () => {
    let acted = 0
    let dismissed = 0
    const v = render(
      <Banner tone="warning" title="RSS down" action={{ label: 'Retry', onClick: () => acted++ }} onDismiss={() => dismissed++}>
        showing what we have
      </Banner>
    )
    const root = v.container.querySelector('[data-part="banner"]')
    expect(root?.getAttribute('data-tone')).toBe('warning')
    expect(root?.getAttribute('role')).toBe('status')
    click(v.container.querySelector('[data-part="banner-action"]'))
    click(v.container.querySelector('[data-part="banner-dismiss"]'))
    expect([acted, dismissed]).toEqual([1, 1])
    const err = render(<Banner tone="error">boom</Banner>)
    expect(err.container.querySelector('[data-part="banner"]')?.getAttribute('role')).toBe('alert')
  })
})

// ------------------------------------------------------------------ Grid and keyboard

describe('Grid', () => {
  function setup(extra: Partial<Parameters<typeof Grid<FeedItem>>[0]> = {}) {
    const opened: string[] = []
    const actions: string[] = []
    let searched = 0
    const v = render(
      <Grid
        items={ITEMS}
        getKey={(it) => it.video.id}
        label="Feed"
        columns={3}
        onOpen={(it) => opened.push(it.video.id)}
        onAction={(a, it) => actions.push(`${a}:${it.video.id}`)}
        onSearch={() => searched++}
        renderItem={(it) => <span>{it.video.title}</span>}
        {...extra}
      />
    )
    const cells = () => [...v.container.querySelectorAll<HTMLElement>('[role="gridcell"]')]
    return { v, cells, opened, actions, searched: () => searched }
  }

  it('ARIA roles: grid > row > gridcell, label, count; roving tabindex', () => {
    const { v, cells } = setup()
    const grid = v.container.querySelector('[role="grid"]')
    expect(grid?.getAttribute('aria-label')).toBe('Feed')
    expect(grid?.getAttribute('aria-rowcount')).toBe(String(ITEMS.length))
    expect(v.container.querySelectorAll('[role="row"]')).toHaveLength(ITEMS.length)
    expect(cells().map((c) => c.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1])
  })

  it('arrows, j/k, Home/End move focus; focus stays visible (data-focused)', () => {
    const { cells } = setup()
    act(() => cells()[0].focus())
    key(active(), 'ArrowRight')
    expect(active()).toBe(cells()[1])
    key(active(), 'ArrowDown')
    expect(active()).toBe(cells()[4])
    key(active(), 'ArrowLeft')
    expect(active()).toBe(cells()[3])
    key(active(), 'ArrowUp')
    expect(active()).toBe(cells()[0])
    key(active(), 'j')
    key(active(), 'j')
    expect(active()).toBe(cells()[2])
    key(active(), 'k')
    expect(active()).toBe(cells()[1])
    key(active(), 'End')
    expect(active()).toBe(cells()[6])
    key(active(), 'ArrowDown') // last row: stays
    expect(active()).toBe(cells()[6])
    key(active(), 'Home')
    expect(active()).toBe(cells()[0])
    key(active(), 'ArrowUp') // first row: stays
    expect(active()).toBe(cells()[0])
    expect(cells()[0].tabIndex).toBe(0)
    expect(cells()[6].tabIndex).toBe(-1)
  })

  it('Enter opens; w/l/e fire watched/later/archive; / asks for the search', () => {
    const { cells, opened, actions, searched } = setup()
    act(() => cells()[2].focus())
    key(active(), 'Enter')
    key(active(), 'w')
    key(active(), 'l')
    key(active(), 'e')
    key(active(), '/')
    expect(opened).toEqual([ITEMS[2].video.id])
    expect(actions).toEqual([`watched:${ITEMS[2].video.id}`, `later:${ITEMS[2].video.id}`, `archive:${ITEMS[2].video.id}`])
    expect(searched()).toBe(1)
  })

  it('shortcuts with a modifier or coming from a text field do not fire', () => {
    const { cells, actions } = setup()
    act(() => cells()[0].focus())
    key(active(), 'w', { metaKey: true })
    key(active(), 'e', { ctrlKey: true })
    expect(actions).toEqual([])
  })

  it('a removed (archived) item keeps focus on a valid neighbour', () => {
    const { v, cells } = setup()
    act(() => cells()[6].focus())
    v.rerender(
      <Grid items={ITEMS.slice(0, 5)} getKey={(it) => it.video.id} label="Feed" columns={3} renderItem={(it) => <span>{it.video.title}</span>} />
    )
    expect(cells().filter((c) => c.tabIndex === 0)).toHaveLength(1)
    expect(cells()[4].tabIndex).toBe(0)
  })

  it('density becomes an attribute; loading shows the skeleton in the same density', () => {
    const { v } = setup({ density: 'list' })
    expect(v.container.querySelector('[role="grid"]')?.getAttribute('data-density')).toBe('list')
    const loading = render(<Grid items={[]} getKey={() => ''} label="Feed" loading density="compact" renderItem={() => null} />)
    const sk = loading.container.querySelector('[data-part="grid"]')
    expect(sk?.getAttribute('data-density')).toBe('compact')
    expect(sk?.getAttribute('aria-busy')).toBe('true')
    expect(loading.container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
  })

  it('empty shows the empty content', () => {
    const v = render(<Grid items={[]} getKey={() => ''} label="Feed" empty={<p>nothing</p>} renderItem={() => null} />)
    expect(v.text()).toBe('nothing')
  })
})

// ------------------------------------------------------------------ video

describe('Thumb', () => {
  it('lazy 16:9; duration, progress, watched veil, new dot, Short badge and backend badges', () => {
    const v = render(
      <Thumb videoId="KfODG5REyss" title="Quantum" durationS={3955} progress={0.4} watched isNew isShort badges={['hn']} />
    )
    const img = v.container.querySelector('img[data-thumb]')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('src')).toBe('https://i.ytimg.com/vi/KfODG5REyss/mqdefault.jpg')
    expect(v.text()).toContain('1:05:55')
    expect(v.container.querySelector('[data-part="thumb-progress"]')?.getAttribute('aria-valuenow')).toBe('40')
    expect(v.container.querySelector('[data-part="thumb-veil"]')).not.toBeNull()
    expect(v.container.querySelector('[data-part="thumb-new"]')).not.toBeNull()
    expect(v.text()).toContain('Short')
    expect(v.container.querySelector('[data-badge="hn"]')).not.toBeNull()
  })

  it('an image failure tries another resolution and then draws the placeholder', () => {
    const v = render(<Thumb videoId="KfODG5REyss" title="Quantum" />)
    const img = () => v.container.querySelector('img[data-thumb]')
    act(() => {
      img()?.dispatchEvent(new Event('error'))
    })
    expect(img()?.getAttribute('src')).toBe('https://i.ytimg.com/vi/KfODG5REyss/hqdefault.jpg')
    act(() => {
      img()?.dispatchEvent(new Event('error'))
    })
    expect(img()).toBeNull()
    expect(v.container.querySelector('[data-part="thumb-fallback"]')).not.toBeNull()
  })

  it('ThumbSkeleton has the same box', () => {
    const a = render(<Thumb videoId="KfODG5REyss" title="x" />)
    const b = render(<ThumbSkeleton />)
    expect(b.container.firstElementChild?.className).toBe(a.container.firstElementChild?.className)
  })
})

describe('VideoCard', () => {
  const VARIANTS = ['grid', 'compact', 'row', 'featured'] as const

  it.each(VARIANTS)('variant %s: why it is here above the title, channel, relative time, actions', (variant) => {
    const v = render(<VideoCard item={ITEMS[0]} variant={variant} now={NOW} actions={<button type="button">act</button>} />)
    const root = v.container.querySelector('article')
    expect(root?.getAttribute('data-variant')).toBe(variant)
    const order = parts(root)
    expect(order.indexOf('why')).toBeLessThan(order.indexOf('title'))
    expect(order).toContain('meta')
    expect(v.text()).toContain('Science')
    expect(v.text()).toContain('Veritasium')
    expect(v.text()).toMatch(/2 hours? ago|2 hr/)
    expect(v.text()).toContain('act')
  })

  it.each(VARIANTS)('skeleton of variant %s has the same box (no layout shift)', (variant) => {
    const a = render(<VideoCard item={ITEMS[0]} variant={variant} now={NOW} />)
    const b = render(<VideoCardSkeleton variant={variant} />)
    const ra = a.container.querySelector('article')
    const rb = b.container.querySelector('article')
    expect(rb?.className).toBe(ra?.className)
    expect(rb?.getAttribute('data-variant')).toBe(variant)
    expect(rb?.getAttribute('aria-busy')).toBe('true')
    expect(parts(rb)).toEqual(parts(ra).filter((p) => !p.startsWith('thumb-')))
  })

  it('without why: the line exists empty (same height); layout="row" becomes variant row', () => {
    const v = render(<VideoCard item={{ ...ITEMS[0], why: null }} layout="row" now={NOW} />)
    expect(v.container.querySelector('article')?.getAttribute('data-variant')).toBe('row')
    expect(v.container.querySelector('[data-part="why"]')).not.toBeNull()
  })

  it('watched: veil on the thumbnail and state on the card', () => {
    const v = render(<VideoCard item={{ ...ITEMS[0], state: 'watched', is_new: false }} now={NOW} />)
    expect(v.container.querySelector('article')?.getAttribute('data-state')).toBe('watched')
    expect(v.container.querySelector('[data-part="thumb-veil"]')).not.toBeNull()
  })
})

describe('QuickActions', () => {
  it('buttons with a visible shortcut (Kbd) and an accessible label', () => {
    const hits: string[] = []
    const v = render(
      <QuickActions
        label="Actions"
        actions={[
          { id: 'watched', label: 'Watched', icon: 'eye', shortcut: 'w', onSelect: () => hits.push('w') },
          { id: 'later', label: 'Later', icon: 'clock', shortcut: 'l', onSelect: () => hits.push('l'), pressed: true }
        ]}
      />
    )
    const buttons = v.container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].getAttribute('aria-label')).toBe('Watched (w)')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    expect(v.container.querySelectorAll('[data-slot="kbd"]')).toHaveLength(2)
    click(buttons[0])
    expect(hits).toEqual(['w'])
  })

  it('inside the Grid the buttons leave the Tab order (the keyboard uses the shortcuts)', () => {
    const v = render(
      <Grid
        items={[ITEMS[0]]}
        getKey={(it) => it.video.id}
        label="Feed"
        renderItem={() => <QuickActions label="A" actions={[{ id: 'watched', label: 'W', icon: 'eye', shortcut: 'w', onSelect: () => undefined }]} />}
      />
    )
    expect(v.container.querySelector('button')?.tabIndex).toBe(-1)
  })

  it('each icon-only button has the fast SDK tooltip (Tip): "what it does · KEY", no native title', () => {
    const v = render(
      <Grid
        items={[ITEMS[0]]}
        getKey={(it) => it.video.id}
        label="Feed"
        renderItem={() => (
          <QuickActions
            label="A"
            actions={[
              { id: 'watched', label: 'Watched', hint: 'Undo watched', icon: 'eye', shortcut: 'w', onSelect: () => undefined, pressed: true },
              { id: 'archive', label: 'Archive', icon: 'archive', shortcut: 'e', onSelect: () => undefined }
            ]}
          />
        )}
      />
    )
    const buttons = [...v.container.querySelectorAll<HTMLElement>('[data-part="quick"] button')]
    expect(buttons.map((b) => b.getAttribute('data-tip'))).toEqual(['Undo watched · W', 'Archive · E'])
    const delays = new Set(buttons.map((b) => b.getAttribute('data-tip-delay')))
    expect(delays.size).toBe(1)
    expect(Number([...delays][0])).toBeGreaterThanOrEqual(100)
    expect(Number([...delays][0])).toBeLessThanOrEqual(200)
    // no duplicated native tooltip; still outside the Tab order (the grid keyboard uses the shortcuts)
    expect(v.container.querySelectorAll('[title]')).toHaveLength(0)
    for (const b of buttons) expect(b.tabIndex).toBe(-1)
  })

  it('with a visible label (featured) there is no tooltip', () => {
    const v = render(<QuickActions showLabels actions={[{ id: 'later', label: 'Later', icon: 'clock', shortcut: 'l', onSelect: () => undefined }]} />)
    expect(v.container.querySelector('[data-tip]')).toBeNull()
  })
})

// ------------------------------------------------------------------ navigation

describe('navigation', () => {
  it('TabBar: tabs with a counter, active value, switching and "+ new tab"', () => {
    const changes: string[] = []
    let added = 0
    const v = render(
      <TabBar
        label="Tabs"
        value="all"
        onChange={(id) => changes.push(id)}
        onAdd={() => added++}
        tabs={[
          { id: 'all', label: 'All', count: 12 },
          { id: 'tech', label: 'Tech', count: 0 },
          { id: 'ai', label: 'AI', count: 3, icon: 'sparkle' }
        ]}
      />
    )
    const triggers = v.container.querySelectorAll('[data-slot="tabs-trigger"]')
    expect(triggers).toHaveLength(3)
    expect(v.text()).toContain('12')
    expect(triggers[1].querySelector('[data-part="tab-count"]')).toBeNull() // zero is not shown
    click(triggers[2])
    expect(changes).toEqual(['ai'])
    click(v.container.querySelector('[data-part="tab-add"]'))
    expect(added).toBe(1)
    expect(v.container.querySelector('[data-part="tab-add"]')?.textContent).toMatch(/New tab/)
  })

  it('TabBar: dragging a tab onto another reorders (onReorder with the new order); a fixed tab does not drag', () => {
    const orders: string[][] = []
    const v = render(
      <TabBar
        value="a"
        onChange={() => undefined}
        onReorder={(ids) => orders.push(ids)}
        reorderable={(id) => id !== 'later'}
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'later', label: 'Later' }]}
      />
    )
    const tab = (id: string) => v.container.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!
    expect(tab('a').getAttribute('draggable')).toBe('true')
    expect(tab('later').getAttribute('draggable')).not.toBe('true')
    dragTab(tab('c'), tab('a'))
    expect(orders).toEqual([['c', 'a', 'b']])
    // to the right: lands after the target
    dragTab(tab('a'), tab('b'))
    expect(orders[1]).toEqual(['b', 'a', 'c'])
    // dropping on the fixed tab does nothing
    dragTab(tab('a'), tab('later'))
    expect(orders).toHaveLength(2)
  })

  it('TabBar: dragging near the edge scrolls the bar', () => {
    const v = render(
      <TabBar value="a" onChange={() => undefined} onReorder={() => undefined} tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />
    )
    const scroller = v.container.querySelector<HTMLElement>('[data-part="tabbar"] [data-part="tabbar-scroll"]')!
    scroller.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 32, width: 300, height: 32, x: 0, y: 0, toJSON: () => ({}) })
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true })
    const tab = v.container.querySelector<HTMLElement>('[data-tab-id="a"]')!
    fireDrag(tab, 'dragstart', 10)
    fireDrag(scroller, 'dragover', 296)
    expect(scroller.scrollLeft).toBeGreaterThan(0)
    const after = scroller.scrollLeft
    fireDrag(scroller, 'dragover', 3)
    expect(scroller.scrollLeft).toBeLessThan(after)
  })

  it('TabBar: Alt+Shift+←/→ on the tab moves it (keyboard); the fixed tab does not move', () => {
    const orders: string[][] = []
    const v = render(
      <TabBar
        value="b"
        onChange={() => undefined}
        onReorder={(ids) => orders.push(ids)}
        reorderable={(id) => id !== 'later'}
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'later', label: 'Later' }]}
      />
    )
    const tab = (id: string) => v.container.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!
    keyOn(tab('b'), 'ArrowLeft', { altKey: true, shiftKey: true })
    expect(orders).toEqual([['b', 'a']])
    keyOn(tab('later'), 'ArrowLeft', { altKey: true, shiftKey: true }) // fixed: nothing
    keyOn(tab('a'), 'ArrowLeft', { altKey: true, shiftKey: true }) // already the first: nothing
    expect(orders).toEqual([['b', 'a']])
    keyOn(tab('a'), 'ArrowRight', { altKey: true, shiftKey: true })
    expect(orders).toEqual([['b', 'a'], ['b', 'a']])
  })

  it('TabBar: tab menu through right click, Shift+F10 and the "⋯" (active tab only)', () => {
    const picked: string[] = []
    const v = render(
      <TabBar
        value="a"
        onChange={() => undefined}
        menu={(id) => (id === 'later' ? null : [{ id: 'edit', label: `Edit ${id}`, onSelect: () => picked.push(`edit:${id}`) }])}
        menuLabel={(name) => `Options for ${name}`}
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'later', label: 'Later' }]}
      />
    )
    const tab = (id: string) => v.container.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!
    const items = () => [...v.container.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((m) => m.textContent)
    // the subtle "⋯" only on the active tab, outside the Tab order, with an accessible name and no native title
    const more = v.container.querySelectorAll<HTMLElement>('[data-part="tab-more"]')
    expect(more).toHaveLength(1)
    expect(more[0].closest('[data-tab-cell]')?.getAttribute('data-tab-cell')).toBe('a')
    expect(more[0].getAttribute('aria-label')).toBe('Options for A')
    expect(more[0].tabIndex).toBe(-1)
    expect(more[0].hasAttribute('title')).toBe(false)
    expect(items()).toEqual([])
    act(() => {
      tab('b').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(items()).toEqual(['Edit b'])
    click(v.container.querySelector('[role="menuitem"]'))
    expect(picked).toEqual(['edit:b'])
    expect(items()).toEqual([])
    keyOn(tab('a'), 'F10', { shiftKey: true })
    expect(items()).toEqual(['Edit a'])
    // a tab without a menu (Watch later): right click opens nothing
    keyOn(tab('a'), 'Escape')
    act(() => {
      tab('later').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(items().filter((x) => x?.includes('later'))).toEqual([])
  })

  it('TabBar: `addSlot` replaces the default "+" (the screen anchors its own menu there)', () => {
    let added = 0
    const v = render(
      <TabBar
        value="a"
        onChange={() => undefined}
        onAdd={() => added++}
        addSlot={<button type="button" data-x="mine">menu</button>}
        tabs={[{ id: 'a', label: 'A' }]}
      />
    )
    const slot = v.container.querySelector('[data-part="tabbar"] [data-part="tab-add-slot"]')
    expect(slot?.querySelector('[data-x="mine"]')).not.toBeNull()
    expect(v.container.querySelector('[data-part="tab-add"]')).toBeNull()
    expect(slot?.className).toContain(`${CLASS_PREFIX}tab-add-slot`)
    click(slot?.querySelector('[data-x="mine"]') ?? null)
    expect(added).toBe(0)
    // without addSlot nothing changes: the default button is still there
    const plain = render(<TabBar value="a" onChange={() => undefined} onAdd={() => added++} tabs={[{ id: 'a', label: 'A' }]} />)
    expect(plain.container.querySelector('[data-part="tab-add-slot"]')).toBeNull()
    click(plain.container.querySelector('[data-part="tab-add"]'))
    expect(added).toBe(1)
  })

  it('TabBarSkeleton', () => {
    const v = render(<TabBarSkeleton count={4} />)
    expect(v.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
  })

  it('ModeSwitch uses the SDK\'s SegmentedControl with the 3 translated densities', () => {
    let picked = ''
    const v = render(<ModeSwitch value="compact" onChange={(d) => (picked = d)} />)
    const options = [...v.container.querySelectorAll('[data-slot="segmented-control"] button')]
    expect(options.map((o) => o.getAttribute('data-id'))).toEqual(['comfortable', 'compact', 'list'])
    expect(options.map((o) => o.textContent)).toEqual(['Comfortable', 'Compact', 'List'])
    expect(options[1].getAttribute('aria-pressed')).toBe('true')
    click(options[2])
    expect(picked).toBe('list')
  })

  it('StatusBarItem: highlighted counter, note and click', () => {
    let hit = 0
    const v = render(<StatusBarItem icon="play" count={12} label="new" note="refreshing…" title="Open" onClick={() => hit++} />)
    expect(v.text()).toBe('12newrefreshing…')
    expect(v.container.querySelector('button')?.getAttribute('title')).toBe('Open')
    click(v.container.querySelector('button'))
    expect(hit).toBe(1)
    expect(render(<StatusBarItem label="0 new" count={0} />).text()).toBe('0 new')
  })

  it('FilterBar: search, filters, count and clear', () => {
    let q = ''
    let cleared = 0
    const v = render(
      <FilterBar query="" onQueryChange={(x) => (q = x)} resultCount={42} onClear={() => cleared++}>
        <span>chip</span>
      </FilterBar>
    )
    const input = v.container.querySelector('input')
    expect(input).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'rust')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q).toBe('rust')
    expect(v.text()).toContain('42')
    expect(v.text()).toContain('chip')
    click(v.container.querySelector('[data-part="filter-clear"]'))
    expect(cleared).toBe(1)
  })
})

// ------------------------------------------------------------------ channel

describe('canal', () => {
  it('ChannelAvatar and skeleton with the same size', () => {
    const a = render(<ChannelAvatar title="veritasium" thumb={null} size={32} />)
    const b = render(<ChannelAvatarSkeleton size={32} />)
    expect(a.text()).toBe('V')
    expect((a.container.firstElementChild as HTMLElement).style.width).toBe('32px')
    expect((b.container.firstElementChild as HTMLElement).style.width).toBe('32px')
  })

  it('ChannelTable + ChannelRow: table roles, ⭐, folder, tags, new videos, last video', () => {
    let fav = 0
    const v = render(
      <ChannelTable label="Channels">
        <ChannelRow
          channel={CHANNEL}
          folder={{ id: 'f_sci', name: 'Science' }}
          tags={[{ id: 't1', name: 'physics' }]}
          newCount={3}
          lastVideo={{ title: 'Fiber optics', at: sec(NOW - 86400_000) }}
          now={NOW}
          onToggleFavorite={() => fav++}
        />
      </ChannelTable>
    )
    expect(v.container.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe('Channels')
    expect(v.container.querySelectorAll('[role="columnheader"]').length).toBeGreaterThan(3)
    const row = v.container.querySelector('[data-part="channel-row"]')
    expect(row?.getAttribute('role')).toBe('row')
    for (const t of ['Veritasium', 'Science', 'physics', '3', 'Fiber optics']) expect(v.text()).toContain(t)
    const star = v.container.querySelector('[data-part="channel-fav"]')
    expect(star?.getAttribute('aria-pressed')).toBe('true')
    click(star)
    expect(fav).toBe(1)
  })

  it('ChannelRowSkeleton has the same columns', () => {
    const a = render(<ChannelRow channel={CHANNEL} now={NOW} />)
    const b = render(<ChannelRowSkeleton />)
    const ra = a.container.querySelector('[data-part="channel-row"]')
    const rb = b.container.querySelector('[data-part="channel-row"]')
    expect(rb?.className).toBe(ra?.className)
    expect([...(rb?.children ?? [])].map((c) => c.getAttribute('data-col'))).toEqual(
      [...(ra?.children ?? [])].map((c) => c.getAttribute('data-col'))
    )
  })

  it('FolderChip, TagChip (remove) and ChipSkeleton', () => {
    let removed = ''
    const f = render(<FolderChip folder={{ id: 'f', name: 'Tech' }} count={4} active />)
    expect(f.text()).toBe('Tech4')
    const t = render(<TagChip tag={{ id: 't', name: 'rust' }} onRemove={(tag) => (removed = tag.id)} />)
    expect(t.text()).toContain('rust')
    click(t.container.querySelector('[data-part="chip-remove"]'))
    expect(removed).toBe('t')
    expect(render(<ChipSkeleton />).container.querySelector('[data-skeleton]')).not.toBeNull()
  })

  it('Tree + TreeItem: tree with level, expand, select, counter and drag target', () => {
    const log: string[] = []
    const v = render(
      <Tree label="Subscriptions">
        <TreeItem id="f1" label="Tech" level={1} count={5} expanded onToggle={() => log.push('toggle')} onSelect={() => log.push('select')} onDropItem={(data) => log.push(`drop:${data}`)}>
          <TreeItem id="c1" label="Fireship" level={2} count={2} onSelect={() => log.push('select-c1')} />
        </TreeItem>
        <TreeItem id="f2" label="Music" level={1} />
      </Tree>
    )
    const tree = v.container.querySelector('[role="tree"]')
    expect(tree?.getAttribute('aria-label')).toBe('Subscriptions')
    const items = () => [...v.container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
    expect(items().map((i) => i.getAttribute('aria-level'))).toEqual(['1', '2', '1'])
    expect(items()[0].getAttribute('aria-expanded')).toBe('true')
    expect(v.container.querySelector('[role="group"]')).not.toBeNull()
    // keyboard: arrows go up/down; left collapses; Enter selects
    act(() => items()[0].focus())
    key(active(), 'ArrowDown')
    expect(active()).toBe(items()[1])
    key(active(), 'Enter')
    key(active(), 'ArrowUp')
    expect(active()).toBe(items()[0])
    key(active(), 'ArrowLeft')
    expect(log).toEqual(['select-c1', 'toggle'])
    // drop
    const target = items()[0].querySelector('[data-part="tree-row"]') as HTMLElement
    act(() => {
      const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
      Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => 'UCxyz', types: ['text/plain'] } })
      target.dispatchEvent(ev)
    })
    expect(log.at(-1)).toBe('drop:UCxyz')
  })

  it('TreeItemSkeleton respects the indent', () => {
    const v = render(<TreeItemSkeleton level={2} />)
    expect((v.container.firstElementChild as HTMLElement).style.getPropertyValue(`--${CLASS_PREFIX}level`)).toBe('2')
  })
})

// ------------------------------------------------------------------ AI flows

describe('AI flows', () => {
  it('StepProgress: waiting/running/done/failed states; current step marked', () => {
    const v = render(
      <StepProgress
        label="Theme"
        steps={[
          { id: 'expand', label: 'Expand', status: 'done' },
          { id: 'search', label: 'Search', status: 'running', detail: '12/40' },
          { id: 'curate', label: 'Curate', status: 'waiting' },
          { id: 'preview', label: 'Preview', status: 'failed' }
        ]}
      />
    )
    const lis = v.container.querySelectorAll('li')
    expect([...lis].map((l) => l.getAttribute('data-status'))).toEqual(['done', 'running', 'waiting', 'failed'])
    expect(lis[1].getAttribute('aria-current')).toBe('step')
    expect(v.text()).toContain('12/40')
    expect(render(<StepProgressSkeleton count={3} />).container.querySelectorAll('li')).toHaveLength(3)
  })

  it('SuggestionGroup + SuggestionRow: accept/decline one, accept a group, reason and model', () => {
    const log: string[] = []
    const v = render(
      <SuggestionGroup title="Science" count={2} model="claude" onAcceptAll={() => log.push('all')}>
        <SuggestionRow
          subject="Veritasium"
          avatar={{ title: 'Veritasium', thumb: null }}
          target="Science"
          reason="Physics explainers"
          model="claude"
          confidence={0.9}
          onAccept={() => log.push('ok')}
          onReject={() => log.push('no')}
        />
        <SuggestionRow subject="Vox" target="News" reason="r" status="accepted" />
      </SuggestionGroup>
    )
    for (const t of ['Science', 'Veritasium', 'Physics explainers', 'claude', '90%']) expect(v.text()).toContain(t)
    click(v.container.querySelector('[data-part="suggestion-accept"]'))
    click(v.container.querySelector('[data-part="suggestion-reject"]'))
    click(v.container.querySelector('[data-part="group-accept"]'))
    expect(log).toEqual(['ok', 'no', 'all'])
    expect(v.container.querySelectorAll('[data-part="suggestion-row"]')[1].getAttribute('data-status')).toBe('accepted')
    const sk = render(<SuggestionRowSkeleton />)
    expect(sk.container.querySelector('[data-part="suggestion-row"]')?.className).toBe(
      v.container.querySelector('[data-part="suggestion-row"]')?.className
    )
  })

  it('SuggestionGroup count: singular for one, plural otherwise', () => {
    const one = render(<SuggestionGroup title="Science" count={1} />)
    expect(one.text()).toContain('1 suggestion')
    expect(one.text()).not.toContain('1 suggestions')
    const two = render(<SuggestionGroup title="Science" count={2} />)
    expect(two.text()).toContain('2 suggestions')
  })

  it('SuggestionRow with selection: checkbox · avatar 28 · title + reason; without onSelectedChange nothing changes', () => {
    const log: boolean[] = []
    const v = render(
      <SuggestionRow
        subject="Veritasium"
        avatar={{ title: 'Veritasium', thumb: null }}
        target="Science"
        reason="Physics explainers"
        selected={false}
        onSelectedChange={(on) => log.push(on)}
        selectLabel="Select Veritasium"
      />
    )
    const r = v.container.querySelector('[data-part="suggestion-row"]')!
    expect(r.getAttribute('data-selectable')).toBe('true')
    const cells = [...r.children]
    // 1st cell: the checkbox; 2nd: the 28 px avatar; 3rd: title + reason
    const box = cells[0].querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(box).not.toBeNull()
    expect(box.getAttribute('aria-label')).toBe('Select Veritasium')
    expect((cells[1].querySelector('[data-part="avatar"]') as HTMLElement).style.width).toBe('28px')
    expect(cells[2].textContent).toContain('Physics explainers')
    click(box)
    expect(log).toEqual([true])
    const on = render(<SuggestionRow subject="Vox" target="News" reason="r" selected onSelectedChange={(x) => log.push(x)} />)
    const box2 = on.container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(box2.checked).toBe(true)
    expect(box2.getAttribute('aria-label')).toBe('Vox')
    // existing users (no selection) get no checkbox nor attribute
    const plain = render(<SuggestionRow subject="Vox" target="News" reason="r" />)
    expect(plain.container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(plain.container.querySelector('[data-part="suggestion-row"]')?.hasAttribute('data-selectable')).toBe(false)
    // skeleton with the same geometry (same class, same number of cells)
    const sk = render(<SuggestionRowSkeleton selectable />)
    const skRow = sk.container.querySelector('[data-part="suggestion-row"]')!
    expect(skRow.getAttribute('data-selectable')).toBe('true')
    expect(skRow.className).toBe(r.className)
    expect(skRow.children).toHaveLength(r.children.length)
  })

  it('ApprovalCard: shows what will happen; approving is never the first focus', () => {
    const log: string[] = []
    const v = render(
      <ApprovalCard
        title="Unsubscribe 3 channels"
        description="Runs in your browser"
        effects={['Unsubscribe from A', 'Unsubscribe from B', 'Unsubscribe from C']}
        confirmLabel="Unsubscribe 3"
        onConfirm={() => log.push('yes')}
        onCancel={() => log.push('no')}
        autoFocus
      />
    )
    expect(v.container.querySelectorAll('[data-part="approval-effects"] li')).toHaveLength(3)
    const focusables = [...v.container.querySelectorAll<HTMLElement>('button, [tabindex="0"]')]
    expect(focusables[0].getAttribute('data-part')).not.toBe('approval-confirm')
    expect(active()?.getAttribute('data-part')).toBe('approval-cancel')
    click(v.container.querySelector('[data-part="approval-confirm"]'))
    click(v.container.querySelector('[data-part="approval-cancel"]'))
    expect(log).toEqual(['yes', 'no'])
    expect(render(<ApprovalCardSkeleton />).container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ welcome

describe('boas-vindas', () => {
  it('PathCard: the main path carries the accent; the action fires', () => {
    let hit = 0
    const v = render(<PathCard icon="plug" title="Connect" description="Pair the extension" actionLabel="Pair" onAction={() => hit++} primary />)
    expect(v.container.querySelector('[data-part="path-card"]')?.getAttribute('data-primary')).toBe('true')
    click(v.container.querySelector('button'))
    expect(hit).toBe(1)
    expect(parts(render(<PathCardSkeleton />).container.firstElementChild)).toEqual(parts(v.container.firstElementChild))
  })

  it('PairingCode: 6 large digits, countdown, copy, expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    let regenerated = 0
    const v = render(<PairingCode code="482913" expiresAt={NOW + 65_000} onRegenerate={() => regenerated++} />)
    expect([...v.container.querySelectorAll('[data-part="code-digit"]')].map((d) => d.textContent).join('')).toBe('482913')
    expect(v.text()).toContain('1:05')
    expect(v.container.querySelector('[data-slot="copy-button"]')?.getAttribute('data-text')).toBe('482913')
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(v.text()).toContain('1:00')
    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(v.container.querySelector('[data-part="pairing"]')?.getAttribute('data-expired')).toBe('true')
    click(v.container.querySelector('[data-part="pairing-regenerate"]'))
    expect(regenerated).toBe(1)
    expect(render(<PairingCodeSkeleton />).container.querySelectorAll('[data-part="code-digit"]')).toHaveLength(6)
  })
})

// ------------------------------------------------------------------ small pieces

describe('small pieces', () => {
  it('Stat, Count (tabular figures), Why, Dot', () => {
    const v = render(
      <div>
        <Stat label="New" value={12} hint="since yesterday" />
        <Count value={7} tone="new" />
        <Why why={{ via: 'theme', label: 'AI agents', detail: 'cited 3×' }} />
        <Dot tone="new" label="New" />
      </div>
    )
    for (const t of ['New', '12', 'since yesterday', '7', 'AI agents', 'cited 3×']) expect(v.text()).toContain(t)
    expect(v.container.querySelector('[data-part="why"]')?.getAttribute('data-via')).toBe('theme')
    expect(v.container.querySelector('[data-part="dot"]')?.getAttribute('role')).toBe('img')
    expect(render(<StatSkeleton />).container.querySelector('[data-skeleton]')).not.toBeNull()
  })

  it('Count changes its key on change (transition) and exposes the number', () => {
    const v = render(<Count value={1} />)
    const first = v.container.querySelector('[data-part="count-value"]')
    v.rerender(<Count value={2} />)
    const second = v.container.querySelector('[data-part="count-value"]')
    expect(second?.textContent).toBe('2')
    expect(second).not.toBe(first)
  })

  it('EmptyView always with a way forward; LoadingState; QueryView with skeleton', () => {
    const e = render(<EmptyView title="No videos" description="Add a channel" action={<button type="button">Add</button>} icon="inbox" />)
    expect(e.text()).toContain('Add')
    expect(render(<LoadingState />).container.querySelector('[data-slot="loader"]')).not.toBeNull()
    const q = render(<QueryView query={{ data: undefined, error: null, isPending: true }} skeleton={<p>sk</p>}>{() => null}</QueryView>)
    expect(q.text()).toBe('sk')
  })

  it('DialogFrame with a size', () => {
    const v = render(
      <DialogFrame title="T" onClose={() => undefined} size="lg">
        <p>x</p>
      </DialogFrame>
    )
    expect(v.container.querySelector('[data-slot="dialog-content"]')?.getAttribute('data-size')).toBe('lg')
  })

  it('formatRelative: EN and PT-BR', () => {
    expect(formatRelative(sec(NOW - 2 * 3600_000), NOW, 'en')).toMatch(/2 h/)
    expect(formatRelative(sec(NOW - 3 * 86400_000), NOW, 'pt-br')).toMatch(/há 3 dias/)
    expect(formatRelative(null, NOW, 'en')).toBe('')
  })
})

// ------------------------------------------------------------------ visual review

describe('numbers in the app language', () => {
  const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')
  const views = (n: number) => item('kkkkkkkkkkk', { video: { ...ITEMS[0].video, views: n } })

  it('pt-BR: "661 mil visualizações", never "661.3k"', () => {
    act(() => sdkMock.locale.set('pt-br'))
    const v = render(<VideoCard item={views(661_306)} variant="grid" now={NOW} />)
    expect(plain(v.text())).toContain('661 mil visualizações')
    expect(v.text()).not.toMatch(/661\.3k|661k/i)
    const big = render(<VideoCard item={views(14_564_759)} variant="row" now={NOW} />)
    expect(plain(big.text())).toContain('14,6 mi visualizações')
  })

  it('en: "661K views" e "14.6M views"', () => {
    expect(render(<VideoCard item={views(661_306)} now={NOW} />).text()).toContain('661K views')
    expect(render(<VideoCard item={views(14_564_759)} now={NOW} />).text()).toContain('14.6M views')
  })

  it('counters (tab, section, chip, tree) use the language\'s separator', () => {
    act(() => sdkMock.locale.set('pt-br'))
    const v = render(
      <div>
        <TabBar value="a" onChange={() => undefined} tabs={[{ id: 'a', label: 'A', count: 1204 }]} />
        <Section title="S" count={2048} />
        <FolderChip folder={{ id: 'f', name: 'F' }} count={3001} />
        <Tree label="t">
          <TreeItem id="x" label="X" count={4500} />
        </Tree>
      </div>
    )
    for (const n of ['1.204', '2.048', '3.001', '4.500']) expect(v.text()).toContain(n)
  })
})

describe('channel avatar', () => {
  it('real photo when there is a thumb; a letter only when the image fails, with a tone derived from the name', () => {
    const v = render(<ChannelAvatar title="Veritasium" thumb="https://yt3.googleusercontent.com/x=s88" size={24} />)
    const img = v.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://yt3.googleusercontent.com/x=s88')
    expect(img?.getAttribute('data-avatar')).not.toBeNull()
    act(() => {
      img?.dispatchEvent(new Event('error'))
    })
    const fallback = v.container.querySelector<HTMLElement>('[data-part="avatar"][data-fallback="true"]')
    expect(fallback?.textContent).toBe('V')
    // the tone comes from the SDK (profileColor/profileColorSoft), not from a fixed color in the code
    expect(fallback?.style.getPropertyValue(`--${CLASS_PREFIX}avatar-tone`)).not.toBe('')
  })
})

describe('featured card', () => {
  const FEAT = item('fffffffffff', {
    video: { ...ITEMS[0].video, id: 'fffffffffff', title: 'Quantum', description: 'One photon at a time.' },
    why: { via: 'channel', label: 'Veritasium', detail: 'favorite' }
  })
  const actions = (
    <QuickActions actions={[{ id: 'watched', label: 'Watched', icon: 'eye', shortcut: 'w', onSelect: () => undefined }]} />
  )

  it('overline, level-1 title, description, one channel line and labelled actions always visible', () => {
    const v = render(<VideoCard item={FEAT} variant="featured" now={NOW} actions={actions} />)
    const order = parts(v.container.querySelector('article'))
    expect(order.indexOf('why')).toBeLessThan(order.indexOf('title'))
    expect(order.indexOf('title')).toBeLessThan(order.indexOf('excerpt'))
    expect(order.indexOf('excerpt')).toBeLessThan(order.indexOf('meta'))
    expect(v.container.querySelector('[data-part="title"]')?.className).toContain(`${CLASS_PREFIX}t-title`)
    expect(v.text()).toContain('One photon at a time.')
    // actions inside the body (not over the thumbnail) and with a visible label
    const box = v.container.querySelector('[data-part="actions"]')
    expect(box?.closest('[data-part="body"]')).not.toBeNull()
    expect(box?.getAttribute('data-persistent')).toBe('true')
    expect(v.container.querySelector('[data-part="quick-label"]')?.textContent).toBe('Watched')
  })

  it('never repeats metadata: the channel shows only once', () => {
    const v = render(<VideoCard item={FEAT} variant="featured" now={NOW} />)
    expect(v.text().split('Veritasium').length - 1).toBe(1)
    expect(v.text()).toContain('favorite')
    // in the other variants too
    for (const variant of ['grid', 'compact', 'row'] as const) {
      const r = render(<VideoCard item={FEAT} variant={variant} now={NOW} />)
      expect(r.text().split('Veritasium').length - 1).toBe(1)
    }
  })

  it('Why without `subject` shows the label; with the channel repeated shows the reason', () => {
    const plainWhy = render(<Why why={{ via: 'channel', label: 'Veritasium', detail: 'favorite' }} />)
    expect(plainWhy.text()).toContain('Veritasium')
    const dedup = render(<Why why={{ via: 'channel', label: 'Veritasium', detail: 'favorite' }} subject="Veritasium" />)
    expect(dedup.text()).not.toContain('Veritasium')
    expect(dedup.text()).toContain('favorite')
    // only the channel, no detail: the line exists (same height) and stays empty, instead of saying "Channel"
    const bare = render(<Why why={{ via: 'channel', label: 'Veritasium', detail: null }} subject="Veritasium" />)
    expect(bare.text().trim()).toBe('')
  })
})

describe('approval', () => {
  it('the dismiss button never uses the action\'s verb: default "Not now" / "Agora não"', () => {
    const v = render(
      <ApprovalCard title="t" effects={['x']} confirmLabel="Unsubscribe 3" onConfirm={() => undefined} onCancel={() => undefined} autoFocus />
    )
    const cancel = v.container.querySelector('[data-part="approval-cancel"]')
    expect(cancel?.textContent).toBe('Not now')
    expect(active()).toBe(cancel)
    act(() => sdkMock.locale.set('pt-br'))
    const pt = render(<ApprovalCard title="t" effects={['x']} confirmLabel="Cancelar 3 inscrições" onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(pt.container.querySelector('[data-part="approval-cancel"]')?.textContent).toBe('Agora não')
    expect(pt.container.querySelector('[data-part="approval-cancel"]')?.textContent).not.toMatch(/Cancelar/)
    // without autoFocus nobody gets focus; the confirming one never does
    expect(active()?.getAttribute('data-part')).not.toBe('approval-confirm')
    const custom = render(<ApprovalCard title="t" effects={['x']} confirmLabel="ok" cancelLabel="Keep them" onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(custom.container.querySelector('[data-part="approval-cancel"]')?.textContent).toBe('Keep them')
  })
})

describe('skeleton and grid', () => {
  it('GridSkeleton completes the row: the same number of columns as the grid', () => {
    const v = render(<GridSkeleton density="comfortable" count={4} columns={5} />)
    expect(v.container.querySelectorAll('[data-part="card"][data-skeleton]')).toHaveLength(5)
    const two = render(<GridSkeleton density="compact" rows={2} columns={6} />)
    expect(two.container.querySelectorAll('[data-part="card"][data-skeleton]')).toHaveLength(12)
    const list = render(<GridSkeleton density="list" count={3} />)
    expect(list.container.querySelectorAll('[data-part="card"][data-skeleton]')).toHaveLength(3)
  })

  it('Grid marks the entry order of each row (cascade)', () => {
    const v = render(<Grid items={ITEMS.slice(0, 3)} getKey={(it) => it.video.id} label="g" renderItem={(it) => <span>{it.video.id}</span>} />)
    const rows = [...v.container.querySelectorAll<HTMLElement>('[role="row"]')]
    expect(rows.map((r) => r.style.getPropertyValue(`--${CLASS_PREFIX}i`))).toEqual(['0', '1', '2'])
  })
})

describe('TabBar, dialog and welcome', () => {
  it('TabBar has a single indicator that slides to the active tab', () => {
    const v = render(<TabBar value="b" onChange={() => undefined} tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />)
    expect(v.container.querySelectorAll('[data-part="tab-ink"]')).toHaveLength(1)
  })

  it('DialogFrame: the body scrolls inside with an edge shadow; the footer stays outside the scroller', () => {
    const v = render(
      <DialogFrame title="T" onClose={() => undefined} footer={<button type="button">ok</button>}>
        <p>x</p>
      </DialogFrame>
    )
    const scroll = v.container.querySelector('[data-part="dialog-scroll"]')
    expect(scroll?.getAttribute('data-overflow')).toBe('none')
    expect(scroll?.querySelector('[data-part="dialog-body"]')).not.toBeNull()
    expect(scroll?.querySelector('[data-slot="dialog-footer"]')).toBeNull()
  })

  it('DialogFrame passes onEscapeKeyDown to DialogContent; without it, nothing extra in the content', () => {
    /** Props React stored on the node (the SDK mock does not interpret Radix's Esc). */
    const propsOf = (el: Element | null) => {
      const key = el ? Object.keys(el).find((k) => k.startsWith('__reactProps$')) : undefined
      return (key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : {}) as Record<string, unknown>
    }
    const onEsc = vi.fn()
    const v = render(
      <DialogFrame title="T" onClose={() => undefined} onEscapeKeyDown={onEsc}>
        <p>x</p>
      </DialogFrame>
    )
    expect(propsOf(v.container.querySelector('[data-slot="dialog-content"]')).onEscapeKeyDown).toBe(onEsc)
    const plain = render(
      <DialogFrame title="T" onClose={() => undefined}>
        <p>x</p>
      </DialogFrame>
    )
    expect('onEscapeKeyDown' in propsOf(plain.container.querySelector('[data-slot="dialog-content"]'))).toBe(false)
  })

  it('Hero: level-1 title with the product line', () => {
    const v = render(<Hero icon="play" title="Welcome" tagline="Your subscriptions. Your way." />)
    const h1 = v.container.querySelector('h1')
    expect(h1?.textContent).toBe('Welcome')
    expect(h1?.className).toContain(`${CLASS_PREFIX}t-title`)
    expect(v.text()).toContain('Your subscriptions. Your way.')
  })

  it('the recommended PathCard is marked with a visible label', () => {
    const v = render(<PathCard icon="plug" title="Connect" description="d" actionLabel="Pair" onAction={() => undefined} primary recommended />)
    expect(v.container.querySelector('[data-part="path-badge"]')?.textContent).toBe('Recommended')
  })

  it('PairingSteps: numbered steps, animated waiting and drawn success', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const v = render(<PairingSteps code="482913" expiresAt={NOW + 60_000} status="waiting" />)
    const steps = [...v.container.querySelectorAll('[data-part="pairing-step"]')]
    expect(steps.map((s) => s.getAttribute('data-step'))).toEqual(['1', '2', '3'])
    expect(v.container.querySelectorAll('[data-part="code-digit"]')).toHaveLength(6)
    expect(v.container.querySelector('[data-part="pairing-status"]')?.getAttribute('data-status')).toBe('waiting')
    expect(v.text()).toMatch(/Waiting for the extension/)
    const ok = render(<PairingSteps code="482913" expiresAt={NOW + 60_000} status="paired" />)
    expect(ok.container.querySelector('[data-part="pairing-status"]')?.getAttribute('data-status')).toBe('paired')
    expect(ok.text()).toMatch(/Connected/)
    vi.useRealTimers()
  })

  it('QuickActions with a visible label when asked', () => {
    const v = render(<QuickActions showLabels actions={[{ id: 'later', label: 'Later', icon: 'clock', shortcut: 'l', onSelect: () => undefined }]} />)
    expect(v.container.querySelector('[data-part="quick-label"]')?.textContent).toBe('Later')
  })
})

// ------------------------------------------------------------------ global kit rules

function gallery(): ReactElement {
  return (
    <Page title="t" subtitle="s" actions={<span />} toolbar={<span />} banner={<Banner tone="info">i</Banner>}>
      <Section title="s" count={1}>
        <Toolbar end={<span />}>
          <ModeSwitch value="comfortable" onChange={() => undefined} />
          <FilterBar query="" onQueryChange={() => undefined} resultCount={1} onClear={() => undefined} />
        </Toolbar>
        <TabBar label="t" value="a" onChange={() => undefined} onAdd={() => undefined} tabs={[{ id: 'a', label: 'A', count: 2 }]} />
        <TabBarSkeleton count={2} />
        <Grid items={ITEMS.slice(0, 2)} getKey={(it) => it.video.id} label="g" renderItem={(it) => <VideoCard item={it} now={NOW} />} />
        <GridSkeleton density="list" count={2} />
        {(['grid', 'compact', 'row', 'featured'] as const).map((v) => (
          <div key={v}>
            <VideoCard item={{ ...ITEMS[0], badges: ['hn'], video: { ...ITEMS[0].video, is_short: true } }} variant={v} now={NOW} />
            <VideoCardSkeleton variant={v} />
          </div>
        ))}
        <Thumb videoId="KfODG5REyss" progress={0.5} watched isNew />
        <QuickActions label="q" actions={[{ id: 'w', label: 'W', icon: 'eye', shortcut: 'w', onSelect: () => undefined }]} />
        <ChannelTable label="c">
          <ChannelRow channel={CHANNEL} folder={{ id: 'f', name: 'F' }} tags={[{ id: 't', name: 'T' }]} newCount={1} now={NOW} />
          <ChannelRowSkeleton />
        </ChannelTable>
        <FolderChip folder={{ id: 'f', name: 'F' }} onClick={() => undefined} />
        <TagChip tag={{ id: 't', name: 'T' }} onClick={() => undefined} onRemove={() => undefined} />
        <ChipSkeleton />
        <Tree label="t">
          <TreeItem id="a" label="A" count={1} expanded onToggle={() => undefined}>
            <TreeItem id="b" label="B" level={2} avatar={{ title: 'B', thumb: null }} />
          </TreeItem>
          <TreeItemSkeleton level={1} />
        </Tree>
        <StepProgress label="s" steps={[{ id: 'a', label: 'A', status: 'running' }]} />
        <SuggestionGroup title="g" onAcceptAll={() => undefined}>
          <SuggestionRow subject="s" target="t" reason="r" onAccept={() => undefined} onReject={() => undefined} />
        </SuggestionGroup>
        <ApprovalCard title="a" effects={['x']} confirmLabel="ok" onConfirm={() => undefined} onCancel={() => undefined} />
        <PathCard icon="plug" title="p" description="d" actionLabel="a" onAction={() => undefined} />
        <PairingCode code="123456" expiresAt={NOW + 1000} />
        <Stat label="l" value={1} />
        <StatusBarItem label="n" count={2} note="x" onClick={() => undefined} />
        <Count value={1} />
        <Dot tone="warning" />
        <EmptyView title="e" icon="inbox" />
      </Section>
    </Page>
  )
}

describe('kit rules', () => {
  it('the kit DOM only has classes with the plugin prefix', () => {
    const v = render(gallery())
    expect(v.container.querySelectorAll('[class]').length).toBeGreaterThan(50)
    expect(foreignClasses(v.container)).toEqual([])
  })

  it('no raw translation key shows up (EN and PT-BR)', () => {
    const en = render(gallery())
    expect(en.text()).not.toMatch(/common\.|kit\./)
    act(() => sdkMock.locale.set('pt-br'))
    const pt = render(gallery())
    expect(pt.text()).not.toMatch(/common\.|kit\./)
    expect(pt.text()).toMatch(/Nova aba/)
  })
})

// ------------------------------------------------------------------ drag/keyboard helpers

function fireDrag(el: Element, type: string, clientX = 0): void {
  const store: Record<string, string> = {}
  const dataTransfer = {
    setData: (k: string, v: string) => {
      store[k] = v
    },
    getData: (k: string) => store[k] ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
    types: [] as string[]
  }
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX })
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
  act(() => {
    el.dispatchEvent(ev)
  })
}

function dragTab(from: Element, to: Element): void {
  fireDrag(from, 'dragstart')
  fireDrag(to, 'dragenter')
  fireDrag(to, 'dragover')
  fireDrag(to, 'drop')
  fireDrag(from, 'dragend')
}

function keyOn(el: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}
