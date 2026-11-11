// Shared components: VideoCard (reads the `extras` atom), ChannelAvatar, WhyBadge, FolderChip,
// loading/empty/error states and the "no RPC" notice.
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ExtrasState, FeedItem, Folder } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { ChannelAvatar } from '../components/ChannelAvatar'
import { FolderChip } from '../components/FolderChip'
import { VideoCard, VideoCardSkeleton } from '../components/VideoCard'
import { WhyBadge } from '../components/WhyBadge'
import { EmptyView, ErrorView, LoadingState, RpcUnavailableNotice } from '../components/states'
import { setPluginContext } from '../lib/ctx'
import { $extras } from '../lib/extras'
import { registerLocales } from '../lib/i18n'
import { TubeApiError } from '../lib/rest'
import { click, render } from './render'
import { readRepoFile } from './repo.mjs'
import { createMockCtx, sdkMock } from './sdk-mock'

const CHANNEL: Channel = {
  id: 'UCBJycsmduvYEL83R_U4JriQ',
  title: 'Marques Brownlee',
  relation: 'subscribed',
  source: 'extension',
  added_at: 1762000000,
  handle: '@mkbhd',
  thumb: 'https://yt3.ggpht.com/abc=s88',
  url: 'https://www.youtube.com/@mkbhd',
  folder_id: 'f_tech',
  favorite: true,
  muted: false,
  unsubscribed_at: null,
  last_video_at: 1762600000,
  videos_per_week: 2,
  shorts_ratio: 0.1,
  ai_note: null,
  tag_ids: []
}

const ITEM: FeedItem = {
  video: {
    id: 'dQw4w9WgXcQ',
    channel_id: CHANNEL.id,
    title: 'O melhor celular do ano',
    published_at: 1762600000,
    description: null,
    channel_title: CHANNEL.title,
    duration_s: 725,
    is_short: false,
    views: 1_500_000,
    first_seen_at: 1762600100,
    origin: 'rss'
  },
  channel: CHANNEL,
  state: 'new',
  reaction: null,
  is_new: true,
  why: { via: 'folder', label: 'Tech', detail: null },
  badges: []
}

const EXTRAS_OFF: ExtrasState = {
  honest_thumbnails: false,
  hn_lens: false,
  hn_channels: false,
  import_lists: false,
  hn_dataset_ready: false,
  hn_video_count: 0,
  hn_credit: ''
}

beforeEach(() => {
  const { ctx } = createMockCtx(PLUGIN_ID)
  setPluginContext(ctx)
  registerLocales(ctx)
})

describe('VideoCard', () => {
  it('shows title, channel, duration, "why it is here" and the new marker', () => {
    const view = render(<VideoCard item={ITEM} />)
    const text = view.text()
    expect(text).toContain('O melhor celular do ano')
    expect(text).toContain('Marques Brownlee')
    expect(text).toContain('12:05')
    expect(text).toContain('Tech')
    expect(view.container.querySelector('[data-new="true"]')).not.toBeNull()
  })

  it('default thumbnail; with the "honest thumbnails" Extra it switches to hq2.jpg (reactive to the atom)', () => {
    const view = render(<VideoCard item={ITEM} />)
    const img = () => view.container.querySelector('img[data-thumb]')?.getAttribute('src') ?? ''
    expect(img()).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
    act(() => $extras.set({ ...EXTRAS_OFF, honest_thumbnails: true }))
    expect(img()).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hq2.jpg')
    act(() => $extras.set(EXTRAS_OFF))
    expect(img()).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  })

  it('badges from the backend (e.g. hn) show up; without a badge, nothing', () => {
    const plain = render(<VideoCard item={ITEM} />)
    expect(plain.container.querySelector('[data-badge]')).toBeNull()
    const hn = render(<VideoCard item={{ ...ITEM, badges: ['hn'] }} />)
    expect(hn.container.querySelector('[data-badge="hn"]')).not.toBeNull()
  })

  it('opening the video uses ctx.os.openExternal with the YouTube URL', () => {
    const view = render(<VideoCard item={ITEM} />)
    click(view.container.querySelector('[data-open-video]'))
    expect(sdkMock.openedExternal).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
  })

  it('accepts the page\'s quick actions in a slot', () => {
    const view = render(<VideoCard item={ITEM} actions={<button type="button">visto</button>} />)
    expect(view.text()).toContain('visto')
  })

  it('a video without a followed channel (topic tab/HN) uses channel_title', () => {
    const view = render(<VideoCard item={{ ...ITEM, channel: null, why: null }} />)
    expect(view.text()).toContain('Marques Brownlee')
  })

  it('skeleton: valid HTML (no block inside <p>), no React warning, same "why" part', () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')))
    try {
      for (const variant of ['grid', 'compact', 'row', 'featured'] as const) {
        const view = render(<VideoCardSkeleton variant={variant} actions />)
        const why = view.container.querySelector('[data-part="why"]')
        expect(why, variant).not.toBeNull()
        expect(why?.className, variant).toContain('why')
        // <p> only accepts phrasing content: no div/p/article inside
        expect(view.container.querySelectorAll('p div, p p, p article, p section'), variant).toHaveLength(0)
      }
    } finally {
      spy.mockRestore()
    }
    expect(errors.filter((e) => /descendant of|cannot (appear|be a child)|validateDOMNesting/i.test(e))).toEqual([])
  })
})

// ------------------------------------------------------------------ type + duration on every card

describe('type and duration mark (a single one, always in the same place)', () => {
  const withVideo = (video: Partial<FeedItem['video']>, over: Partial<FeedItem> = {}): FeedItem => ({ ...ITEM, ...over, video: { ...ITEM.video, ...video } })
  const marks = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-part="thumb-mark"]')]
  const icon = (el: Element | undefined) => el?.querySelector('[data-slot="codicon"]')?.getAttribute('data-icon') ?? null

  it('video: video icon + duration; alt text/tooltip "Video · 17 min 14 s"', () => {
    const view = render(<VideoCard item={withVideo({ duration_s: 1034, is_short: false })} />)
    const [mark, ...rest] = marks(view.container)
    expect(rest).toHaveLength(0)
    expect(mark.closest('[data-part="thumb"]')).not.toBeNull()
    expect(mark.getAttribute('data-kind')).toBe('video')
    expect(icon(mark)).toBe('device-camera-video')
    expect(mark.textContent).toBe('17:14')
    expect(mark.getAttribute('aria-label')).toBe('Video · 17 min 14 s')
    expect(mark.getAttribute('title')).toBe('Video · 17 min 14 s')
    expect(mark.querySelector('[data-part="thumb-duration"]')?.textContent).toBe('17:14')
  })

  it('Short: upright phone icon + "Short" (+ duration); without a duration, only "Short"', () => {
    const a = render(<VideoCard item={withVideo({ duration_s: 58, is_short: true })} />)
    const [mark] = marks(a.container)
    expect(marks(a.container)).toHaveLength(1)
    expect(mark.getAttribute('data-kind')).toBe('short')
    expect(icon(mark)).toBe('device-mobile')
    expect(mark.textContent).toContain('Short')
    expect(mark.textContent).toContain('0:58')
    expect(mark.getAttribute('aria-label')).toBe('Short · 58 s')
    // the separate Short badge (top corner) no longer exists: a single mark
    expect(a.container.querySelector('[data-part="thumb-short"]')).toBeNull()
    const b = render(<VideoCard item={withVideo({ duration_s: null, is_short: true })} />)
    expect(marks(b.container)[0].textContent).toBe('Short')
    expect(marks(b.container)[0].getAttribute('aria-label')).toBe('Short')
  })

  it('unknown type: duration only (no icon); no duration and no type: nothing (never made up)', () => {
    const a = render(<VideoCard item={withVideo({ duration_s: 312, is_short: null })} />)
    const [mark] = marks(a.container)
    expect(mark.getAttribute('data-kind')).toBe('unknown')
    expect(icon(mark)).toBeNull()
    expect(mark.textContent).toBe('5:12')
    expect(mark.getAttribute('aria-label')).toBe('5 min 12 s')
    const b = render(<VideoCard item={withVideo({ duration_s: null, is_short: null })} />)
    expect(marks(b.container)).toHaveLength(0)
    expect(b.container.querySelector('[data-part="thumb-duration"]')).toBeNull()
    // known type without a duration: only the icon (name in the alt text)
    const c = render(<VideoCard item={withVideo({ duration_s: null, is_short: false })} />)
    expect(marks(c.container)[0].textContent).toBe('')
    expect(marks(c.container)[0].getAttribute('aria-label')).toBe('Video')
  })

  it('horas: \"1:05:55\" e \"Video · 1 h 5 min 55 s\"', () => {
    const view = render(<VideoCard item={withVideo({ duration_s: 3955, is_short: false })} />)
    expect(marks(view.container)[0].textContent).toBe('1:05:55')
    expect(marks(view.container)[0].getAttribute('aria-label')).toBe('Video · 1 h 5 min 55 s')
  })

  it('live / premiere (backend badge): the mark says so; the badge is not repeated on the thumbnail', () => {
    const live = render(<VideoCard item={withVideo({ duration_s: null, is_short: false }, { badges: ['live'] })} />)
    const [mark] = marks(live.container)
    expect(mark.getAttribute('data-kind')).toBe('live')
    expect(icon(mark)).toBe('broadcast')
    expect(mark.textContent).toBe('Live')
    expect(live.container.querySelector('[data-badge="live"]')).toBeNull()
    const premiere = render(<VideoCard item={withVideo({ duration_s: 600, is_short: false }, { badges: ['premiere', 'hn'] })} />)
    expect(marks(premiere.container)[0].getAttribute('data-kind')).toBe('premiere')
    expect(marks(premiere.container)[0].getAttribute('aria-label')).toBe('Premiere · 10 min')
    expect(premiere.container.querySelector('[data-badge="hn"]')).not.toBeNull()
  })

  it('in the 4 variants: on the thumbnail (grid, compact, featured); in the list, in the metadata line', () => {
    for (const variant of ['grid', 'compact', 'featured', 'row'] as const) {
      const view = render(<VideoCard item={withVideo({ duration_s: 1034, is_short: false })} variant={variant} />)
      const found = marks(view.container)
      expect(found, variant).toHaveLength(1)
      const where = variant === 'row' ? '[data-part="meta"]' : '[data-part="thumb"]'
      expect(found[0].closest(where), variant).not.toBeNull()
      view.unmount()
    }
  })

  it('pt-BR: "Vídeo · 17 min 14 s"', () => {
    act(() => sdkMock.locale.set('pt-br'))
    try {
      const view = render(<VideoCard item={withVideo({ duration_s: 1034, is_short: false })} />)
      expect(marks(view.container)[0].getAttribute('aria-label')).toBe('Vídeo · 17 min 14 s')
    } finally {
      act(() => sdkMock.locale.set('en'))
    }
  })

  it('CSS: the mark sits in the bottom-right corner, like on YouTube, and does not hide on hover/focus (the actions are at the top)', () => {
    const css = readRepoFile('desktop-src/styles/video.css')
    const block = (sel: string) => {
      const i = css.indexOf(`${sel} {`)
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
    }
    expect(block('.PFX_thumb-mark')).toMatch(/bottom:/)
    expect(block('.PFX_thumb-mark')).toMatch(/right:/)
    expect(block('.PFX_thumb-mark')).not.toMatch(/top:/)
    expect(block('.PFX_card-actions')).toMatch(/top:/)
    expect(block('.PFX_card-actions')).not.toMatch(/bottom:/)
    // no hover/focus rule hides the mark
    for (const rule of css.split('}')) {
      if (/thumb-mark/.test(rule) && /:hover|:focus/.test(rule)) expect(rule).not.toMatch(/opacity:\s*0\b|display:\s*none|visibility:\s*hidden/)
    }
  })
})

describe('ChannelAvatar', () => {
  it('with a thumb uses the image; without a thumb shows the initial', () => {
    const a = render(<ChannelAvatar title="Marques" thumb="https://yt3.ggpht.com/x" />)
    expect(a.container.querySelector('img')?.getAttribute('src')).toBe('https://yt3.ggpht.com/x')
    const b = render(<ChannelAvatar title="veritasium" thumb={null} />)
    expect(b.container.querySelector('img')).toBeNull()
    expect(b.text()).toBe('V')
  })

  it('a thumb outside the YouTube image hosts is never loaded: the initial is drawn instead', () => {
    for (const bad of [
      'https://tracker.example/pixel.png',
      'http://yt3.ggpht.com/x',
      'file:///etc/passwd',
      'https://ggpht.com.evil.example/x',
      'https://user' + '@yt3.ggpht.com/x',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)'
    ]) {
      const v = render(<ChannelAvatar title="Marques" thumb={bad} />)
      expect(v.container.querySelector('img'), bad).toBeNull()
      expect(v.text()).toBe('M')
    }
    for (const good of ['https://yt3.ggpht.com/abc=s88', 'https://i.ytimg.com/vi/x/hqdefault.jpg', 'https://lh3.googleusercontent.com/a/x']) {
      const v = render(<ChannelAvatar title="Marques" thumb={good} />)
      expect(v.container.querySelector('img')?.getAttribute('src'), good).toBe(good)
    }
  })
})

describe('WhyBadge and FolderChip', () => {
  it('WhyBadge shows the label and marks the source', () => {
    const view = render(<WhyBadge why={{ via: 'theme', label: 'Agentes de IA', detail: 'citado 3×' }} />)
    expect(view.text()).toContain('Agentes de IA')
    expect(view.container.querySelector('[data-via="theme"]')).not.toBeNull()
  })

  it('FolderChip shows the folder name and accepts a click', () => {
    const folder: Folder = { id: 'f_tech', name: 'Tech', parent_id: null, color: null, sort: 0 }
    let clicked = ''
    const view = render(<FolderChip folder={folder} onClick={(f) => (clicked = f.id)} />)
    expect(view.text()).toBe('Tech')
    click(view.container.querySelector('button'))
    expect(clicked).toBe('f_tech')
  })
})

describe('estados', () => {
  it('ErrorView translates the error code and offers try again', () => {
    let retried = 0
    const err = new TubeApiError({ code: 'llm_unavailable', message: 'raw' })
    const view = render(<ErrorView error={err} onRetry={() => retried++} />)
    expect(view.text()).not.toContain('common.')
    expect(view.text().toLowerCase()).toContain('model')
    click(view.container.querySelector('button'))
    expect(retried).toBe(1)
  })

  it('RpcUnavailableNotice shows "open from Desktop with a local backend"', () => {
    const view = render(<RpcUnavailableNotice />)
    expect(view.text()).toMatch(/Desktop/)
    expect(view.text()).not.toContain('common.')
  })

  it('LoadingState and EmptyView render', () => {
    expect(render(<LoadingState />).container.querySelector('[data-slot="loader"]')).not.toBeNull()
    expect(render(<EmptyView title="nothing" />).text()).toContain('nothing')
  })

  it('pt-BR when the active language is Portuguese', () => {
    act(() => sdkMock.locale.set('pt-br'))
    const view = render(<RpcUnavailableNotice />)
    expect(view.text()).toMatch(/Abra/)
  })
})
