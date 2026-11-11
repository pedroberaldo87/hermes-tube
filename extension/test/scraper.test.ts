// content/scraper: /feed/channels → whole list + complete|partial signal.
// Saved pages (tests/fixtures/mytube/feed-channels*.synthetic.html, read-only) and variations built here.
// Rule: `complete` only when the end of the list was reached, with no error and logged in; any doubt → `partial`.
import { describe, expect, it } from 'vitest'
import type { ChannelIn } from '../../shared/api-types'
import {
  NUDGE_ATTR,
  NUDGE_EVENT,
  detectLogin,
  extractFromInitialData,
  readInitialData,
  scrapeSubscriptions,
  scraper,
  type ScrapeOptions
} from '../src/content/scraper'
import { OVERLAY_TAG } from '../src/content/sync-overlay'

type Fs = { readFileSync(p: string, enc: 'utf8'): string }
const fs = (): Promise<Fs> => import('node:fs' as string) as Promise<Fs>
// base in a variable: Vite rewrites the literal pattern `new URL('…', import.meta.url)` as an asset
const HERE = import.meta.url
const fixture = async (name: string) =>
  (await fs()).readFileSync(decodeURIComponent(new URL(`../../tests/fixtures/mytube/${name}`, HERE).pathname), 'utf8')
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const FEED = new URL('https://www.youtube.com/feed/channels')

/** fake clock: each `sleep` advances time; `onRound` simulates YouTube loading the next page */
function harness(doc: Document, extra: Partial<ScrapeOptions> & { onScroll?: (round: number) => void } = {}): ScrapeOptions {
  let t = 0
  let round = 0
  return {
    doc,
    url: FEED,
    now: () => t,
    sleep: async (ms) => {
      t += ms
    },
    scroll: () => extra.onScroll?.(round++),
    ...extra
  }
}

const SYNTH_IDS = [
  'UCHnyfMqiRRG1u-2MsSQLbXA',
  'UCsBjURrPoezykLs9EqgamOA',
  'UCYO_jab_esuFRV4b17AJtAw',
  'UCsXVk37bltHxD1rDPwtNM8Q',
  'UCKHhA5hN2UohhFDfNXB_cvQ',
  'UCn9Erjy00mpnWeLnRqhsA1g',
  'UCLA_DiR1FfKNvjuUpBHmylQ',
  'UC9-y-6csu5WGm29I7JiwpnA',
  'UCSUu1lih2RifWkKtDOJdsBA',
  'UCj1VqrHhDte54oLgPG4xpuQ'
]
const UC = /^UC[\w-]{22}$/

function expectAllIds(channels: ChannelIn[]) {
  for (const c of channels) expect(c.channel_id, c.title).toMatch(UC)
}

// ---------------------------------------------------------------- pages built here (new fixtures)
const id22 = (n: number) => `UC${String(n).padStart(22, 'x')}`
function itemHtml(n: number, opts: { handleOnly?: boolean } = {}): string {
  const href = opts.handleOnly ? `/@canal${n}` : `/channel/${id22(n)}`
  return (
    `<ytd-channel-renderer><div id="avatar-section"><a id="main-link" href="${href}"><div id="avatar"><img src="https://yt3.ggpht.com/a${n}=s88"></div></a></div>` +
    `<div id="info-section"><a id="channel-info" href="${href}"><ytd-channel-name><yt-formatted-string id="text">Canal ${n}</yt-formatted-string></ytd-channel-name>` +
    `<span id="subscribers">${n}K subscribers</span></a></div></ytd-channel-renderer>`
  )
}
function page(opts: { items?: string; continuation?: boolean; head?: string; masthead?: string } = {}): string {
  return (
    `<!doctype html><html><head>${opts.head ?? '<script>ytcfg.set({"LOGGED_IN":true,"INNERTUBE_API_KEY":"x"});</script>'}</head><body>` +
    `<ytd-app><div id="masthead">${opts.masthead ?? '<button id="avatar-btn"></button>'}</div>` +
    `<ytd-browse page-subtype="channels"><div id="contents">${opts.items ?? ''}` +
    `${opts.continuation ? '<ytd-continuation-item-renderer><tp-yt-paper-spinner active></tp-yt-paper-spinner></ytd-continuation-item-renderer>' : ''}` +
    `</div></ytd-browse></ytd-app></body></html>`
  )
}
/** simulates infinite scroll: each scroll appends the next batch; at the end it removes the continuation */
function infinite(doc: Document, batches: string[][], { stopAfter }: { stopAfter?: number } = {}) {
  let next = 0
  return (round: number) => {
    void round
    if (stopAfter !== undefined && next >= stopAfter) return // network dropped: the continuation stays, nothing arrives
    const batch = batches[next++]
    if (!batch) return
    const contents = doc.querySelector('#contents')!
    const cont = contents.querySelector('ytd-continuation-item-renderer')
    for (const html of batch) cont ? cont.insertAdjacentHTML('beforebegin', html) : contents.insertAdjacentHTML('beforeend', html)
    if (next >= batches.length) cont?.remove()
  }
}

describe('scraper: complete saved page', () => {
  it('feed-channels.synthetic.html → complete, 10 unique channels, all with channel_id', async () => {
    const doc = parse(await fixture('feed-channels.synthetic.html'))
    const r = await scrapeSubscriptions(harness(doc))
    expect(r.signal).toBe('complete')
    expect(r.reason).toBe('end_of_list')
    expect(r.channels.map((c) => c.channel_id).sort()).toEqual([...SYNTH_IDS].sort())
    expectAllIds(r.channels)
    const v = r.channels.find((c) => c.channel_id === 'UCHnyfMqiRRG1u-2MsSQLbXA')!
    expect(v).toMatchObject({ title: 'Veritasium', handle: '@veritasium', url: 'https://www.youtube.com/@veritasium' })
    expect(v.thumb).toMatch(/^https:\/\/yt3\.googleusercontent\.com\/.+=s176-/)
    // lockup with contentId "@handle": the UC… browseId prevails; the lockup avatar is also read
    const nsf = r.channels.find((c) => c.channel_id === 'UCSUu1lih2RifWkKtDOJdsBA')!
    expect(nsf).toMatchObject({ title: 'NASASpaceflight', handle: '@nasaspaceflight' })
    expect(nsf.thumb).toMatch(/^https:\/\//)
    // no handle → /channel/ url
    expect(r.channels.find((c) => c.channel_id === 'UCj1VqrHhDte54oLgPG4xpuQ')).toMatchObject({
      handle: null,
      url: 'https://www.youtube.com/channel/UCj1VqrHhDte54oLgPG4xpuQ'
    })
  })

  it('lockups with the live page class names (camelCase, Nov 2026) are read: name, link, avatar', async () => {
    // class names as a real `yt-lockup-view-model` renders them now (seen on youtube.com); the
    // `yt-lockup-metadata-view-model__title` / `-wiz__title` names match nothing there anymore
    const lockup = (handle: string, name: string) =>
      `<yt-lockup-view-model class="ytd-rich-item-renderer lockup"><div class="ytLockupViewModelContentImage"><img src="https://yt3.googleusercontent.com/${handle}=s88"></div>` +
      `<div class="ytLockupViewModelMetadata"><yt-lockup-metadata-view-model class="ytLockupMetadataViewModelHost"><div class="ytLockupMetadataViewModelTextContainer">` +
      `<h3 class="ytLockupMetadataViewModelHeadingReset"><a class="ytLockupMetadataViewModelTitle" href="/@${handle}"><span>${name}</span></a></h3>` +
      `</div></yt-lockup-metadata-view-model></div></yt-lockup-view-model>`
    const doc = parse(page({ items: lockup('veritasium', 'Veritasium') + lockup('Fireship', 'Fireship') }))
    const r = await scrapeSubscriptions(harness(doc))
    expect(r.stats.unparsed).toBe(0)
    expect(r.channels.map((c) => [c.title, c.handle, c.url])).toEqual([
      ['Veritasium', '@veritasium', 'https://www.youtube.com/@veritasium'],
      ['Fireship', '@fireship', 'https://www.youtube.com/@Fireship']
    ])
    expect(r.channels[0].thumb).toBe('https://yt3.googleusercontent.com/veritasium=s88')
    expect(r.signal).toBe('complete')
  })

  it('ytInitialData: extracts the 3 formats and dedupes by channel_id', async () => {
    const doc = parse(await fixture('feed-channels.synthetic.html'))
    const data = readInitialData(doc)
    expect(data).not.toBeNull()
    const list = extractFromInitialData(data)
    expect(list).toHaveLength(10)
    expectAllIds(list)
  })

  it('feed-channels.dom-only.synthetic.html (DOM fallback): whole list; id only where the link is /channel/', async () => {
    const doc = parse(await fixture('feed-channels.dom-only.synthetic.html'))
    const r = await scrapeSubscriptions(harness(doc))
    // the list is whole (the background completes the ids through the MAIN world or downgrades to partial)
    expect(r.signal).toBe('complete')
    expect(r.channels).toHaveLength(10)
    expect(r.channels.filter((c) => c.channel_id).map((c) => c.channel_id)).toEqual(['UCj1VqrHhDte54oLgPG4xpuQ'])
    expect(r.channels.find((c) => c.title === 'Fireship')).toMatchObject({ handle: '@fireship', url: 'https://www.youtube.com/@Fireship' })
  })

  it('infinite scroll to the end (continuation disappears) → complete with all batches', async () => {
    const doc = parse(page({ items: [1, 2, 3].map((n) => itemHtml(n)).join(''), continuation: true }))
    const scroll = infinite(doc, [[4, 5, 6].map((n) => itemHtml(n)), [7, 8].map((n) => itemHtml(n))])
    const r = await scrapeSubscriptions(harness(doc, { onScroll: scroll }))
    expect(r.signal).toBe('complete')
    expect(r.channels.map((c) => c.channel_id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id22))
    expect(r.channels[0]).toMatchObject({ title: 'Canal 1', thumb: 'https://yt3.ggpht.com/a1=s88' })
    expect(r.stats.rounds).toBeGreaterThanOrEqual(3)
  })
})

describe('scraper: when in doubt, partial', () => {
  it('logged out (login promo, no list) → partial', async () => {
    const doc = parse(
      page({
        head: '<script>ytcfg.set({"LOGGED_IN":false});</script>',
        masthead: '<a href="https://accounts.google.com/ServiceLogin?service=youtube">Sign in</a>',
        items: '<ytd-background-promo-renderer>Don’t miss new videos</ytd-background-promo-renderer>'
      })
    )
    const r = await scrapeSubscriptions(harness(doc, { waitItemsMs: 3000 }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('logged_out')
    expect(detectLogin(doc)).toBe('out')
  })

  it('logged out even with items on the page (LOGGED_IN false) → partial', async () => {
    const doc = parse(page({ head: '<script>ytcfg.set({"LOGGED_IN":false});</script>', items: itemHtml(1) }))
    const r = await scrapeSubscriptions(harness(doc))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('logged_out')
  })

  it('empty list → partial', async () => {
    const doc = parse(page({ items: '' }))
    const r = await scrapeSubscriptions(harness(doc, { waitItemsMs: 3000 }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('empty')
    expect(r.channels).toEqual([])
  })

  it('scroll cut off (continuation stays and nothing arrives) → partial, with what was already read', async () => {
    const doc = parse(page({ items: [1, 2, 3].map((n) => itemHtml(n)).join(''), continuation: true }))
    const scroll = infinite(doc, [[4, 5].map((n) => itemHtml(n)), [6].map((n) => itemHtml(n))], { stopAfter: 1 })
    const r = await scrapeSubscriptions(harness(doc, { onScroll: scroll }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('scroll_stalled')
    expect(r.channels.map((c) => c.channel_id)).toEqual([1, 2, 3, 4, 5].map(id22))
  })

  it('timed out with the list still growing → partial', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const batches = Array.from({ length: 1000 }, (_, i) => [itemHtml(i + 2)])
    const r = await scrapeSubscriptions(harness(doc, { onScroll: infinite(doc, batches), maxMs: 20_000 }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('timeout')
  })

  it('missing selector (DOM with unknown markup, data present) → partial, but with the ids from the data', async () => {
    const html = (await fixture('feed-channels.synthetic.html'))
      .replaceAll('ytd-channel-renderer', 'ytd-novo-renderer')
      .replaceAll('ytd-grid-channel-renderer', 'ytd-novo2-renderer')
      .replaceAll('yt-lockup-view-model', 'yt-novo-view-model')
    const r = await scrapeSubscriptions(harness(parse(html), { waitItemsMs: 3000 }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('selector_missing')
    expect(r.channels).toHaveLength(10)
    expectAllIds(r.channels)
  })

  it('broken name selector (item without a name) → partial', async () => {
    const doc = parse(page({ items: itemHtml(1) + itemHtml(2).replace('id="text"', 'id="other"') }))
    const r = await scrapeSubscriptions(harness(doc))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('unparsed_items')
  })

  it('DOM does not show a channel that is in the data (new renderer not covered) → partial', async () => {
    const html = (await fixture('feed-channels.synthetic.html')).replaceAll('yt-lockup-view-model', 'yt-novo-view-model')
    const r = await scrapeSubscriptions(harness(parse(html)))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('dom_mismatch')
  })

  it('tab closed / module stopped midway (abort) → partial', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const ctrl = new AbortController()
    const scroll = (round: number) => {
      if (round === 1) ctrl.abort()
    }
    const r = await scrapeSubscriptions(harness(doc, { onScroll: scroll, abort: ctrl.signal }))
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('aborted')
  })

  it('outside /feed/channels → partial without scrolling', async () => {
    const doc = parse(page({ items: itemHtml(1) }))
    const r = await scrapeSubscriptions({ ...harness(doc), url: new URL('https://www.youtube.com/feed/subscriptions') })
    expect(r).toMatchObject({ signal: 'partial', reason: 'wrong_page', channels: [] })
  })

  it('unexpected exception → partial (never complete)', async () => {
    const doc = parse(page({ items: itemHtml(1) }))
    const r = await scrapeSubscriptions(
      harness(doc, {
        onScroll: () => {
          throw new Error('boom')
        }
      })
    )
    expect(r.signal).toBe('partial')
    expect(r.reason).toBe('error')
  })
})

// ---------------------------------------------------------------- do not rely on scrolling alone
describe('scraper: before giving up it tries the ways that do not need a visible tab', () => {
  it('stalled scroll: tries stepped scrolling and the page\'s loading, and only then scroll_stalled', async () => {
    const doc = parse(page({ items: [1, 2].map((n) => itemHtml(n)).join(''), continuation: true }))
    const calls: string[] = []
    const r = await scrapeSubscriptions(
      harness(doc, {
        maxStallRounds: 4,
        steppedScroll: async () => void calls.push('stepped'),
        nudge: async () => {
          calls.push('nudge')
          return 'none'
        }
      })
    )
    expect(r).toMatchObject({ signal: 'partial', reason: 'scroll_stalled' })
    expect(calls).toContain('stepped')
    expect(calls).toContain('nudge')
    expect(calls.indexOf('stepped')).toBeLessThan(calls.indexOf('nudge'))
    expect(r.stats.attempts).toEqual(expect.arrayContaining(['stepped_scroll', 'page_nudge:none']))
  })

  it('a small maxStallRounds does not skip the attempts', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const calls: string[] = []
    const r = await scrapeSubscriptions(
      harness(doc, {
        maxStallRounds: 1,
        steppedScroll: async () => void calls.push('stepped'),
        nudge: async () => (calls.push('nudge'), 'unavailable')
      })
    )
    expect(r.reason).toBe('scroll_stalled')
    expect(calls).toEqual(expect.arrayContaining(['stepped', 'nudge']))
  })

  it('stepped scrolling unsticks it (list that only moves with a scroll event) → complete', async () => {
    const doc = parse(page({ items: [1, 2].map((n) => itemHtml(n)).join(''), continuation: true }))
    const load = infinite(doc, [[3, 4].map((n) => itemHtml(n)), [5].map((n) => itemHtml(n))])
    let round = 0
    const r = await scrapeSubscriptions(harness(doc, { steppedScroll: async () => load(round++), nudge: async () => 'none' }))
    expect(r).toMatchObject({ signal: 'complete', reason: 'end_of_list' })
    expect(r.channels.map((c) => c.channel_id)).toEqual([1, 2, 3, 4, 5].map(id22))
  })

  it('loading exposed by the page (MAIN world) unsticks it → complete', async () => {
    const doc = parse(page({ items: [1, 2].map((n) => itemHtml(n)).join(''), continuation: true }))
    const load = infinite(doc, [[3].map((n) => itemHtml(n)), [4].map((n) => itemHtml(n))])
    let round = 0
    const r = await scrapeSubscriptions(
      harness(doc, {
        steppedScroll: async () => undefined,
        nudge: async () => {
          load(round++)
          return 'called:trigger'
        }
      })
    )
    expect(r).toMatchObject({ signal: 'complete' })
    expect(r.channels).toHaveLength(4)
    expect(r.stats.attempts).toContain('page_nudge:called:trigger')
  })

  it('stepped scroll default: scrolls in several steps with a real wait and fires scroll events', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const seen: string[] = []
    // the DOMParser document has no `defaultView`: the event on the document is enough for the proof
    doc.addEventListener('scroll', () => seen.push('scroll'))
    const sleeps: number[] = []
    const r = await scrapeSubscriptions({
      ...harness(doc, { maxStallRounds: 1, nudge: async () => 'none' }),
      sleep: async (ms) => void sleeps.push(ms)
    })
    expect(r.reason).toBe('scroll_stalled')
    expect(seen.filter((s) => s === 'scroll').length).toBeGreaterThanOrEqual(3)
    // short waits between the steps (besides each round's wait)
    expect(sleeps.filter((ms) => ms > 0 && ms < 1000).length).toBeGreaterThanOrEqual(3)
  })

  it('page loading default: event to the MAIN world and reading the result; no listener → unavailable', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const r = await scrapeSubscriptions(harness(doc, { maxStallRounds: 1, steppedScroll: async () => undefined }))
    expect(r.stats.attempts).toContain('page_nudge:unavailable')
    // with the MAIN world listener (installed by the background) the response comes back through the attribute
    const doc2 = parse(page({ items: itemHtml(1), continuation: true }))
    doc2.addEventListener(NUDGE_EVENT, () => doc2.documentElement.setAttribute(NUDGE_ATTR, 'none'))
    const r2 = await scrapeSubscriptions(harness(doc2, { maxStallRounds: 1, steppedScroll: async () => undefined }))
    expect(r2.stats.attempts).toContain('page_nudge:none')
  })

  it('progress: reports the count every round (notice counter)', async () => {
    const doc = parse(page({ items: [1, 2].map((n) => itemHtml(n)).join(''), continuation: true }))
    const counts: number[] = []
    await scrapeSubscriptions(harness(doc, { onScroll: infinite(doc, [[3, 4].map((n) => itemHtml(n))]), onProgress: (n) => counts.push(n) }))
    expect(counts[0]).toBe(2)
    expect(counts.at(-1)).toBe(4)
  })

  it('visible tab hidden by the user midway: hidden rounds do not count as stalled (up to the time cap)', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    let hidden = true
    Object.defineProperty(doc, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') })
    const load = infinite(doc, [[2].map((n) => itemHtml(n))])
    let round = 0
    const r = await scrapeSubscriptions(
      harness(doc, {
        visible: true,
        maxStallRounds: 3,
        steppedScroll: async () => undefined,
        nudge: async () => 'none',
        onScroll: () => {
          round++
          if (round === 10) hidden = false // the user came back to the tab
          if (!hidden) load(round)
        }
      })
    )
    expect(r).toMatchObject({ signal: 'complete' })
    expect(r.channels).toHaveLength(2)
  })

  it('cancelled by the user (abort with reason cancelled) → partial/cancelled', async () => {
    const doc = parse(page({ items: itemHtml(1), continuation: true }))
    const ctrl = new AbortController()
    const r = await scrapeSubscriptions(harness(doc, { abort: ctrl.signal, onScroll: (round) => round === 1 && ctrl.abort('cancelled') }))
    expect(r).toMatchObject({ signal: 'partial', reason: 'cancelled' })
  })
})

describe('command scrape.subscriptions {visible}', () => {
  const run = (payload: { visible?: boolean }) => scraper.commands!['scrape.subscriptions']!(payload)

  it('visible: shows the notice while scraping and removes it at the end; without visible, no notice', async () => {
    // the jsdom page is not /feed/channels: it ends quickly (wrong_page) — what matters is the notice cycle
    const seen: boolean[] = []
    const mo = new MutationObserver(() => seen.push(document.querySelector(OVERLAY_TAG) !== null))
    mo.observe(document.documentElement, { childList: true, subtree: true })
    const r = await run({ visible: true })
    await Promise.resolve()
    mo.disconnect()
    expect(r.reason).toBe('wrong_page')
    expect(seen).toContain(true)
    expect(document.querySelector(OVERLAY_TAG)).toBeNull()
    const seen2: boolean[] = []
    const mo2 = new MutationObserver(() => seen2.push(document.querySelector(OVERLAY_TAG) !== null))
    mo2.observe(document.documentElement, { childList: true, subtree: true })
    await run({})
    await Promise.resolve()
    mo2.disconnect()
    expect(seen2).not.toContain(true)
  })
})

describe('module content/scraper', () => {
  it('attaches only on /feed/channels, declares the command and the real route', () => {
    expect(scraper.matches(FEED, null)).toBe(true)
    expect(scraper.matches(new URL('https://www.youtube.com/watch?v=x'), null)).toBe(false)
    expect(scraper.COMMANDS).toEqual(['scrape.subscriptions'])
    expect(scraper.REAL_ROUTES).toEqual(['POST /ext/sync/subscriptions'])
  })

  it('detectLogin: ytcfg true → in; no clue at all → unknown', () => {
    expect(detectLogin(parse(page()))).toBe('in')
    expect(detectLogin(parse('<html><body></body></html>'))).toBe('unknown')
  })
})
