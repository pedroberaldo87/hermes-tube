// content/unsubscribe: on the channel page opened by background/queue, `queue.execute` checks that the page belongs to
// the item's channel (id read from the page = item id) **before any click**, clicks "Subscribed" → confirms →
// verifies the button turned into "Subscribe" before saying `done`. Resubscribe: reverse path.
// Saved pages: tests/fixtures/mytube/subscribe-button.synthetic.html (sections by state, read-only) and the real
// channel pages (logged out) in tests/fixtures/youtube/channel/. YouTube's behavior (dialog, button
// swap) is simulated here by click listeners. Never a real channel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { QUEUE_CTL_KEY } from '../src/background/queue'
import {
  QUEUE_OVERLAY_TAG,
  detectLogin,
  executeQueueItem,
  findSubscribeButton,
  readPageChannelIds,
  subscriptionState,
  unsubscribe,
  type QueueExecuteRequest
} from '../src/content/unsubscribe'
import { createRouter } from '../src/lib/router'
import { chromeFake } from './setup-chrome'

type Fs = { readFileSync(p: string, enc: 'utf8'): string }
const fs = (): Promise<Fs> => import('node:fs' as string) as Promise<Fs>
// base in a variable: Vite rewrites the literal pattern `new URL('…', import.meta.url)` as an asset
const HERE = import.meta.url
const fixture = async (rel: string) => (await fs()).readFileSync(decodeURIComponent(new URL(`../../tests/fixtures/${rel}`, HERE).pathname), 'utf8')

const ITEM_ID = 'UCsBjURrPoezykLs9EqgamOA' // Fireship (saved real page)
// The public repository ships without saved third-party pages: tests that read one are skipped there.
const hasRealPages = await fixture('youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html').then(
  () => true,
  () => false
)
const itReal = it.skipIf(!hasRealPages)
const OTHER_ID = 'UCBJycsmduvYEL83R_U4JriQ'
const FAST = { ready: 400, dialog: 300, verify: 300 }

let sections: Record<string, string> = {}

beforeEach(async () => {
  if (!Object.keys(sections).length) {
    const html = await fixture('mytube/subscribe-button.synthetic.html')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const s of Array.from(doc.querySelectorAll('section[data-fixture-state]'))) sections[s.getAttribute('data-fixture-state')!] = s.innerHTML
  }
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

/** listeners the test put on the document (jsdom is the same for the whole file) */
const cleanups: Array<() => void> = []
function on(type: string, fn: (e: Event) => void, capture = false): void {
  document.addEventListener(type, fn, capture)
  cleanups.push(() => document.removeEventListener(type, fn, capture))
}

afterEach(() => {
  for (const off of cleanups.splice(0)) off()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

/** head with the channel identity as YouTube serves it (`canonical`, `og:url`, `itemprop=identifier`, ytInitialData) */
function identityHead(id: string | null, { loggedIn = true }: { loggedIn?: boolean | null } = {}): string {
  const meta = id
    ? `<link rel="canonical" href="https://www.youtube.com/channel/${id}">
       <meta property="og:url" content="https://www.youtube.com/channel/${id}">
       <meta itemprop="identifier" content="${id}">`
    : ''
  const cfg = loggedIn === null ? '' : `<script>ytcfg.set({"LOGGED_IN":${loggedIn}});</script>`
  const data = id ? `<script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"X","externalId":"${id}"}}};</script>` : ''
  return `<meta charset="utf-8"><title>Canal - YouTube</title>${meta}${cfg}${data}`
}

function load(head: string, body: string): void {
  document.head.innerHTML = head
  document.body.innerHTML = `<ytd-app><div id="content">${body}</div></ytd-app>`
}

/** records every click (proof of "zero clicks") */
function clickLog(): Element[] {
  const clicks: Element[] = []
  on('click', (e) => clicks.push(e.target as Element), true)
  return clicks
}

const req = (over: Partial<QueueExecuteRequest> = {}): QueueExecuteRequest => ({
  queue_id: 'q_1',
  action: 'unsubscribe',
  channel_url: `https://www.youtube.com/channel/${ITEM_ID}`,
  channel_id: ITEM_ID,
  channel_title: 'Fireship',
  index: 2,
  total: 5,
  ...over
})

const run = (r: QueueExecuteRequest, extra: Parameters<typeof executeQueueItem>[1] = {}) =>
  executeQueueItem(r, { doc: document, url: r.channel_url, timeouts: FAST, ...extra })

function setHeader(state: string): void {
  const box = document.getElementById('content')!
  box.querySelector('#hdr')?.remove()
  box.insertAdjacentHTML('afterbegin', `<div id="hdr">${sections[state]}</div>`)
}

/** simulated YouTube: a click on the header button opens `opens`; confirming switches the header to `after` */
function youtube({ opens = 'confirm-dialog', after = 'not-subscribed' as string | null, channel = 'Fireship' } = {}) {
  // the confirmation names the channel of the page (the saved dialog says "Fireship")
  const dialog = () => sections['confirm-dialog'].replace('Fireship', channel)
  on('click', (e) => {
    const el = e.target as Element
    if (el.closest('#hdr') && el.closest('button')) {
      if (opens === 'none') return
      if (opens === 'direct') {
        if (after) setHeader(after)
        return
      }
      document.getElementById('content')!.insertAdjacentHTML('beforeend', `<div id="popup">${opens === 'confirm-dialog' ? dialog() : sections[opens]}</div>`)
      return
    }
    if (el.closest('#popup ytd-menu-service-item-renderer:last-child')) {
      document.getElementById('popup')!.remove()
      document.getElementById('content')!.insertAdjacentHTML('beforeend', `<div id="popup">${dialog()}</div>`)
      return
    }
    if (el.closest('#popup #confirm-button')) {
      document.getElementById('popup')!.remove()
      if (after) setHeader(after)
    }
  })
}

function page(state: string, id: string | null = ITEM_ID, opts: { loggedIn?: boolean | null } = {}): void {
  load(identityHead(id, opts), '')
  setHeader(state)
}

describe('reading the page (untrusted data)', () => {
  itReal('channel id: canonical, og:url, itemprop and ytInitialData; real /channel/ and /@handle page', async () => {
    page('subscribed-classic')
    expect(readPageChannelIds(document)).toEqual([ITEM_ID])
    for (const f of ['youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html', 'youtube/channel/handle.Fireship.html']) {
      const d = new DOMParser().parseFromString(await fixture(f), 'text/html')
      expect(readPageChannelIds(d), f).toEqual([ITEM_ID])
    }
  })

  itReal('does not confuse the page\'s channel with other channels cited in it (shelf channelId)', async () => {
    const d = new DOMParser().parseFromString(await fixture('youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html'), 'text/html')
    // the real page cites other channels ("channelId":"UC2Xd…") and must not become an identity source
    expect(d.documentElement.innerHTML).toContain('UC2Xd-TjJByJyK2w1zNwY0zQ')
    expect(readPageChannelIds(d)).not.toContain('UC2Xd-TjJByJyK2w1zNwY0zQ')
  })

  it('sources that disagree with each other all show up (the caller refuses)', () => {
    load(`${identityHead(ITEM_ID)}<meta itemprop="identifier" content="${OTHER_ID}">`, '')
    expect(readPageChannelIds(document).sort()).toEqual([ITEM_ID, OTHER_ID].sort())
  })

  itReal('login: ytcfg LOGGED_IN (real logged-out page) and login promo', async () => {
    const d = new DOMParser().parseFromString(await fixture('youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html'), 'text/html')
    expect(detectLogin(d)).toBe('out')
    page('subscribed-classic', ITEM_ID, { loggedIn: true })
    expect(detectLogin(document)).toBe('in')
    page('subscribed-classic', ITEM_ID, { loggedIn: null })
    expect(detectLogin(document)).toBe('unknown')
  })

  it('button state by attribute/structure, never by text (PT-BR and EN alike)', () => {
    const cases: Array<[string, string]> = [
      ['not-subscribed', 'not_subscribed'],
      ['subscribed-classic', 'subscribed'],
      ['subscribed-view-model', 'subscribed'],
      ['subscribed-pt-br', 'subscribed']
    ]
    for (const [state, want] of cases) {
      page(state)
      const btn = findSubscribeButton(document)
      expect(btn, state).not.toBeNull()
      expect(subscriptionState(btn!), state).toBe(want)
    }
    // swapped text changes nothing: the state comes from the attribute/class
    page('subscribed-view-model')
    const btn = findSubscribeButton(document)!
    btn.setAttribute('aria-label', 'Subscribe to Fireship')
    btn.textContent = 'Subscribe'
    expect(subscriptionState(btn)).toBe('subscribed')
  })

  // Cut of the live channel header (youtube.com, signed out, Nov 2026): the spec-button classes are camelCase now
  // (`ytSpecButtonShapeNextFilled`), no longer `yt-spec-button-shape-next--filled`; signed out, the "Subscribe" button
  // sits in the flexible actions, outside any subscribe-button container.
  const LIVE_BUTTON = (shape: 'Filled' | 'Tonal', label: string) =>
    `<button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNext${shape} ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM" title="" aria-label="${label}" aria-disabled="false">${label}</button>`
  const LIVE_HEADER = (actions: string) =>
    `<yt-page-header-renderer class="pageHeaderRendererHost"><yt-page-header-view-model class="ytPageHeaderViewModelHost">` +
    `<div class="ytPageHeaderViewModelContent"><div class="ytPageHeaderViewModelHeadline"><div class="ytPageHeaderViewModelHeadlineInfo">` +
    `<yt-dynamic-text-view-model class="ytPageHeaderViewModelTitle dynamicTextViewModelHost"><h1 class="dynamicTextViewModelH1">Fireship</h1></yt-dynamic-text-view-model>` +
    `<yt-flexible-actions-view-model class="ytFlexibleActionsViewModelHost"><div class="ytFlexibleActionsViewModelAction">${actions}</div></yt-flexible-actions-view-model>` +
    `</div></div></div></yt-page-header-view-model></yt-page-header-renderer>`

  it('live page class names: the renamed "filled" shape reads as not subscribed', () => {
    load(identityHead(ITEM_ID, { loggedIn: false }), LIVE_HEADER(`<button-view-model class="ytSpecButtonViewModelHost">${LIVE_BUTTON('Filled', 'Subscribe')}</button-view-model>`))
    const btn = document.querySelector('yt-flexible-actions-view-model button')!
    expect(subscriptionState(btn)).toBe('not_subscribed')
  })

  it('live page class names: the renamed "tonal" shape reads as subscribed (counterpart of the old --tonal)', () => {
    load(identityHead(ITEM_ID), LIVE_HEADER(`<yt-subscribe-button-view-model>${LIVE_BUTTON('Tonal', 'Subscribed')}</yt-subscribe-button-view-model>`))
    const btn = findSubscribeButton(document)
    expect(btn).not.toBeNull()
    expect(subscriptionState(btn!)).toBe('subscribed')
  })

  it('live page signed out: the header "Subscribe" outside a subscribe container is not taken (no guessing among actions)', () => {
    load(identityHead(ITEM_ID, { loggedIn: false }), LIVE_HEADER(`<button-view-model class="ytSpecButtonViewModelHost">${LIVE_BUTTON('Filled', 'Subscribe')}</button-view-model>`))
    expect(findSubscribeButton(document)).toBeNull()
  })

  it('only the channel header button counts (a shelf of featured channels is ignored)', () => {
    load(identityHead(ITEM_ID), `<ytd-browse><ytd-channel-renderer>${sections['subscribed-classic'].replace('channel-header-container', 'x-shelf')}</ytd-channel-renderer></ytd-browse>`)
    expect(findSubscribeButton(document)).toBeNull()
  })
})

describe('queue.execute — unsubscribe', () => {
  it('subscribed (classic layout) → clicks, confirms in the dialog and only says done after the button turned into "Subscribe"', async () => {
    page('subscribed-classic')
    youtube()
    const clicks = clickLog()
    const r = await run(req())
    expect(r).toEqual({ status: 'done', error: null })
    expect(clicks).toHaveLength(2)
    expect(clicks[0].closest('#hdr')).not.toBeNull()
    expect(clicks[1].closest('#confirm-button')).not.toBeNull()
    expect(subscriptionState(findSubscribeButton(document)!)).toBe('not_subscribed')
  })

  it('new layout with a menu ("Subscribed ▾" → last item → dialog) also in PT-BR', async () => {
    for (const [state, channel] of [
      ['subscribed-view-model', 'Fireship'],
      ['subscribed-pt-br', 'Manual do Mundo']
    ]) {
      for (const off of cleanups.splice(0)) off() // one simulated YouTube per page
      page(state)
      youtube({ opens: 'menu-open', channel })
      const clicks = clickLog()
      expect(await run(req()), state).toEqual({ status: 'done', error: null })
      expect(clicks.map((c) => (c.closest('#hdr') ? 'header' : c.closest('ytd-menu-service-item-renderer') ? 'menu' : c.closest('#confirm-button') ? 'confirm' : '?'))).toEqual([
        'header',
        'menu',
        'confirm'
      ])
    }
  })

  it('the hidden dialog (aria-hidden) that already exists on the page is not mistaken for the open dialog', async () => {
    page('subscribed-classic')
    document.getElementById('content')!.insertAdjacentHTML('beforeend', sections['confirm-dialog-hidden'])
    const clicks = clickLog()
    youtube({ opens: 'none' })
    const r = await run(req())
    expect(r).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1) // only the header button; no click on the hidden dialog
  })

  it('already not subscribed → done with note not_subscribed, no click (idempotent)', async () => {
    page('not-subscribed')
    youtube()
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'done', error: 'not_subscribed' })
    expect(clicks).toHaveLength(0)
  })

  it('dialog does not appear → failed confirm_not_found (one click, nothing more)', async () => {
    page('subscribed-classic')
    youtube({ opens: 'none' })
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1)
  })

  it('confirmed but the button did not change → failed state_unchanged (never done without verifying)', async () => {
    page('subscribed-classic')
    youtube({ after: null })
    expect(await run(req())).toEqual({ status: 'failed', error: 'state_unchanged' })
  })

  it('page of ANOTHER channel → wrong_channel and ZERO clicks', async () => {
    page('subscribed-classic', OTHER_ID)
    youtube()
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'wrong_channel' })
    expect(clicks).toHaveLength(0)
    expect(subscriptionState(findSubscribeButton(document)!)).toBe('subscribed')
  })

  it('missing or contradictory identity → wrong_channel and zero clicks', async () => {
    for (const head of [identityHead(null), `${identityHead(ITEM_ID)}<meta itemprop="identifier" content="${OTHER_ID}">`]) {
      load(head, '')
      setHeader('subscribed-classic')
      youtube()
      const clicks = clickLog()
      expect(await run(req())).toEqual({ status: 'failed', error: 'wrong_channel' })
      expect(clicks).toHaveLength(0)
    }
  })

  it('tab URL points to another channel (redirect) → wrong_channel, zero clicks', async () => {
    page('subscribed-classic')
    youtube()
    const clicks = clickLog()
    expect(await run(req(), { url: `https://www.youtube.com/channel/${OTHER_ID}` })).toEqual({ status: 'failed', error: 'wrong_channel' })
    expect(clicks).toHaveLength(0)
  })

  it('item with a channel_url and channel_id that do not match → wrong_channel without looking at the page', async () => {
    page('subscribed-classic')
    const clicks = clickLog()
    expect(await run(req({ channel_url: `https://www.youtube.com/channel/${OTHER_ID}` }), { url: `https://www.youtube.com/channel/${ITEM_ID}` })).toEqual({
      status: 'failed',
      error: 'invalid_item'
    })
    expect(clicks).toHaveLength(0)
  })

  itReal('logged out (real saved page) → logged_out, zero clicks', async () => {
    const d = new DOMParser().parseFromString(await fixture('youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html'), 'text/html')
    document.head.innerHTML = d.head.innerHTML
    document.body.innerHTML = d.body.innerHTML
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'logged_out' })
    expect(clicks).toHaveLength(0)
  })

  it('challenge/captcha on the page → challenge, zero clicks', async () => {
    load(identityHead(ITEM_ID), '<form id="captcha-form" action="/sorry/index"><div class="g-recaptcha"></div></form>')
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'challenge' })
    expect(clicks).toHaveLength(0)
  })

  it('button does not appear by the deadline → button_not_found (with a deadline, no blind wait)', async () => {
    load(identityHead(ITEM_ID), '<div id="hdr"><div id="channel-header-container"></div></div>')
    const t0 = Date.now()
    expect(await run(req())).toEqual({ status: 'failed', error: 'button_not_found' })
    expect(Date.now() - t0).toBeLessThan(FAST.ready + 1000)
  })

  it('a button that appears later (page still mounting) is waited for until the deadline', async () => {
    load(identityHead(ITEM_ID), '')
    youtube()
    setTimeout(() => setHeader('subscribed-classic'), 80)
    expect(await run(req())).toEqual({ status: 'done', error: null })
  })
})

describe('queue.execute — never a click on a dialog or menu that is not the unsubscribe one', () => {
  // inline fixtures (the saved file stays read-only): a YouTube dialog that is not ours, menus without the
  // unsubscribe item, and the unsubscribe item recognized by its icon in another language
  const SURVEY = `<ytd-popup-container><tp-yt-paper-dialog role="dialog"><yt-confirm-dialog-renderer><div id="main">
    <yt-formatted-string id="text">Are you enjoying YouTube Premium? Try it free for 1 month.</yt-formatted-string>
    <div id="buttons"><yt-button-renderer id="cancel-button"><yt-button-shape><button>No thanks</button></yt-button-shape></yt-button-renderer>
    <yt-button-renderer id="confirm-button"><yt-button-shape><button>Try it free</button></yt-button-shape></yt-button-renderer></div>
  </div></yt-confirm-dialog-renderer></tp-yt-paper-dialog></ytd-popup-container>`
  const PT_DIALOG = `<ytd-popup-container><tp-yt-paper-dialog role="dialog"><yt-confirm-dialog-renderer><div id="main">
    <yt-formatted-string id="text">Cancelar inscrição de  Fireship?</yt-formatted-string>
    <div id="buttons"><yt-button-renderer id="cancel-button"><yt-button-shape><button>Cancelar</button></yt-button-shape></yt-button-renderer>
    <yt-button-renderer id="confirm-button"><yt-button-shape><button>Cancelar inscrição</button></yt-button-shape></yt-button-renderer></div>
  </div></yt-confirm-dialog-renderer></tp-yt-paper-dialog></ytd-popup-container>`
  const menu = (items: string[]) => `<ytd-popup-container><tp-yt-iron-dropdown><ytd-menu-popup-renderer><tp-yt-paper-listbox role="menu">${items
    .map((i) => `<ytd-menu-service-item-renderer role="menuitem"><tp-yt-paper-item role="option">${i}</tp-yt-paper-item></ytd-menu-service-item-renderer>`)
    .join('')}</tp-yt-paper-listbox></ytd-menu-popup-renderer></tp-yt-iron-dropdown></ytd-popup-container>`

  /** YouTube that opens `popupHtml` on the header click; a click on the last menu item opens the real dialog */
  function opens(popupHtml: string) {
    on('click', (e) => {
      const el = e.target as Element
      if (el.closest('#hdr') && el.closest('button')) {
        document.getElementById('content')!.insertAdjacentHTML('beforeend', `<div id="popup">${popupHtml}</div>`)
        return
      }
      if (el.closest('#popup ytd-menu-service-item-renderer:last-child')) {
        document.getElementById('popup')!.remove()
        document.getElementById('content')!.insertAdjacentHTML('beforeend', `<div id="popup">${sections['confirm-dialog']}</div>`)
        return
      }
      if (el.closest('#popup #confirm-button') && /Fireship/.test(document.getElementById('popup')!.textContent ?? '')) {
        document.getElementById('popup')!.remove()
        setHeader('not-subscribed')
      }
    })
  }

  it('a dialog of something else (survey, promotion) appears after the click → confirm_not_found, no click on it', async () => {
    page('subscribed-classic')
    opens(SURVEY)
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1) // the header button only
    expect(clicks[0].closest('#hdr')).not.toBeNull()
  })

  it('the confirmation names the channel: recognized in another language too (PT-BR)', async () => {
    page('subscribed-classic')
    opens(PT_DIALOG)
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'done', error: null })
    expect(clicks.map((c) => (c.closest('#hdr') ? 'header' : c.closest('#confirm-button') ? 'confirm' : '?'))).toEqual(['header', 'confirm'])
  })

  it('a menu without the unsubscribe item (no icon, no unsubscribe label) → confirm_not_found, never "the last item"', async () => {
    page('subscribed-view-model')
    opens(menu(['All', 'Personalized', 'None', 'Report channel']))
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1)
  })

  it('the unsubscribe item is found by its icon whatever the language and position', async () => {
    page('subscribed-view-model')
    const items = ['Todas', '<yt-icon icon="person_minus"></yt-icon>Anular suscripción', 'Ninguna']
    on('click', (e) => {
      const el = e.target as Element
      if (el.closest('#popup ytd-menu-service-item-renderer:nth-child(2)')) {
        document.getElementById('popup')!.remove()
        document.getElementById('content')!.insertAdjacentHTML('beforeend', `<div id="popup">${sections['confirm-dialog']}</div>`)
      }
    })
    opens(menu(items))
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'done', error: null })
    expect(clicks.map((c) => (c.closest('#hdr') ? 'header' : c.closest('ytd-menu-service-item-renderer') ? 'menu' : c.closest('#confirm-button') ? 'confirm' : '?'))).toEqual([
      'header',
      'menu',
      'confirm'
    ])
  })

  it('a dialog that names ANOTHER channel → confirm_not_found, no click on it', async () => {
    page('subscribed-pt-br') // the page is "Manual do Mundo"; the saved dialog says "Fireship"
    opens(sections['confirm-dialog'])
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1)
  })

  it('a page without any channel name to compare → no confirmation click (fail closed)', async () => {
    load(identityHead(ITEM_ID), '')
    setHeader('subscribed-classic')
    for (const el of Array.from(document.querySelectorAll('#channel-name, title'))) el.remove()
    opens(sections['confirm-dialog'])
    const clicks = clickLog()
    expect(await run(req())).toEqual({ status: 'failed', error: 'confirm_not_found' })
    expect(clicks).toHaveLength(1)
  })
})

describe('queue.execute — resubscribe', () => {
  it('not subscribed → clicks "Subscribe" and verifies it became "Subscribed"', async () => {
    page('not-subscribed')
    youtube({ opens: 'direct', after: 'subscribed-classic' })
    const clicks = clickLog()
    expect(await run(req({ action: 'resubscribe' }))).toEqual({ status: 'done', error: null })
    expect(clicks).toHaveLength(1)
    expect(subscriptionState(findSubscribeButton(document)!)).toBe('subscribed')
  })

  it('already subscribed → done with note already_subscribed, zero clicks', async () => {
    page('subscribed-classic')
    const clicks = clickLog()
    expect(await run(req({ action: 'resubscribe' }))).toEqual({ status: 'done', error: 'already_subscribed' })
    expect(clicks).toHaveLength(0)
  })

  it('same channel check: another channel → wrong_channel, zero clicks', async () => {
    page('not-subscribed', OTHER_ID)
    youtube({ opens: 'direct', after: 'subscribed-classic' })
    const clicks = clickLog()
    expect(await run(req({ action: 'resubscribe' }))).toEqual({ status: 'failed', error: 'wrong_channel' })
    expect(clicks).toHaveLength(0)
  })

  it('clicked and the button did not change → state_unchanged', async () => {
    page('not-subscribed')
    youtube({ opens: 'direct', after: null })
    expect(await run(req({ action: 'resubscribe' }))).toEqual({ status: 'failed', error: 'state_unchanged' })
  })
})

describe('notice and Stop', () => {
  it('shows "unsubscribing 2 of 5 · <channel>" with Stop; the channel text comes from the item, never as HTML', async () => {
    page('not-subscribed')
    await run(req({ channel_title: '<img src=x onerror=alert(1)>Fireship' }))
    const host = document.querySelector(QUEUE_OVERLAY_TAG)
    expect(host).not.toBeNull()
    const root = host!.shadowRoot!
    const text = root.textContent ?? ''
    expect(text).toMatch(/2/)
    expect(text).toMatch(/5/)
    expect(text).toContain('<img src=x onerror=alert(1)>Fireship')
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('button')).not.toBeNull()
    expect(root.querySelector('[role="status"]')).not.toBeNull()
  })

  it('Stop before the click → failed stopped, zero clicks, and asks the queue to stop (chrome.storage)', async () => {
    page('subscribed-classic', ITEM_ID)
    // the button only appears later: there is time to press Stop
    document.getElementById('hdr')!.remove()
    youtube()
    const clicks = clickLog()
    const p = run(req(), { timeouts: { ready: 2000, dialog: 300, verify: 300 } })
    await new Promise((r) => setTimeout(r, 30))
    const stop = document.querySelector(QUEUE_OVERLAY_TAG)!.shadowRoot!.querySelector('button')!
    stop.click()
    setTimeout(() => setHeader('subscribed-classic'), 50)
    expect(await p).toEqual({ status: 'failed', error: 'stopped' })
    expect(clicks.filter((c) => c.closest('#hdr, #popup'))).toHaveLength(0)
    await chromeFake().flush()
    expect(chromeFake().storage.get(QUEUE_CTL_KEY)).toMatchObject({ stopped: true, by: 'overlay' })
  })

  it('Esc on the notice also stops', async () => {
    load(identityHead(ITEM_ID), '')
    const p = run(req(), { timeouts: { ready: 2000, dialog: 300, verify: 300 } })
    await new Promise((r) => setTimeout(r, 30))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await p).toEqual({ status: 'failed', error: 'stopped' })
  })
})

describe('module', () => {
  it('never attaches on its own on any page; only answers the background command', () => {
    for (const u of ['https://www.youtube.com/', `https://www.youtube.com/channel/${ITEM_ID}`, 'https://www.youtube.com/@Fireship', 'https://www.youtube.com/feed/channels']) {
      expect(unsubscribe.matches(new URL(u), null)).toBe(false)
    }
    expect(unsubscribe.COMMANDS).toEqual(['queue.execute'])
    expect(typeof unsubscribe.commands?.['queue.execute']).toBe('function')
  })

  it('a message from a page (postMessage/DOM event) or from another extension triggers nothing', async () => {
    page('subscribed-classic')
    youtube()
    const clicks = clickLog()
    // page tries to ask for the unsubscribe
    window.postMessage({ type: 'queue.execute', payload: req() }, '*')
    document.dispatchEvent(new CustomEvent('queue.execute', { detail: req() }))
    // another extension: the router ignores a sender with another id
    const router = createRouter()
    router.on('queue.execute' as never, (async (p: QueueExecuteRequest) => executeQueueItem(p, { doc: document, url: p.channel_url, timeouts: FAST })) as never)
    const stop = router.listen()
    await new Promise<void>((resolve) => {
      chromeFake().events.message.emit({ type: 'queue.execute', payload: req() }, { id: 'outra-extensao' } as chrome.runtime.MessageSender, () => resolve())
      setTimeout(resolve, 100)
    })
    stop()
    await new Promise((r) => setTimeout(r, 50))
    expect(clicks).toHaveLength(0)
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
  })
})
