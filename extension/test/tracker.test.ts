// content/tracker: watched = > 60 % of the video OR > 4 min of real playback (not open-tab time).
// Pure core (`WatchCounter`) with player samples + DOM adapter in jsdom (fake video, `timeupdate` events).
import { describe, expect, it, vi } from 'vitest'
import type { Envelope, WatchEvent } from '../../shared/api-types'
import { WatchCounter, createTracker, tracker, type PlaybackSample } from '../src/content/tracker'

const A = 'AAAAAAAAAAA'
const B = 'BBBBBBBBBBB'

/** plays `seconds` of video in 0.25 s steps (like the real `timeupdate`), returns the events emitted */
function play(
  c: WatchCounter,
  clock: { t: number; pos: Record<string, number> },
  videoId: string,
  seconds: number,
  extra: Partial<PlaybackSample> = {}
): WatchEvent[] {
  const out: WatchEvent[] = []
  const step = 0.25
  for (let i = 0; i < Math.round(seconds / step); i++) {
    clock.t += step * 1000
    clock.pos[videoId] = (clock.pos[videoId] ?? 0) + step
    const ev = c.sample({ videoId, currentTime: clock.pos[videoId], duration: 100, paused: false, ad: false, rate: 1, at: clock.t, ...extra })
    if (ev) out.push(ev)
  }
  return out
}
const newClock = () => ({ t: 1_762_700_000_000, pos: {} as Record<string, number> })

describe('WatchCounter (rule)', () => {
  it('61 % → 1 event (and only 1, even if it keeps going)', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 60)).toEqual([]) // 60 % is not yet > 60 %
    const evs = play(c, k, A, 1)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ video_id: A })
    expect(Number.isInteger(evs[0].watched_at)).toBe(true)
    // UTC seconds of the instant it passed the threshold (within the last second played)
    expect(evs[0].watched_at).toBeGreaterThanOrEqual(Math.floor((k.t - 1000) / 1000))
    expect(evs[0].watched_at).toBeLessThanOrEqual(Math.floor(k.t / 1000))
    expect(play(c, k, A, 30)).toEqual([])
  })

  it('59 % and 3 min → none', () => {
    const c = new WatchCounter()
    const k = newClock()
    // 305 s video: 180 s = 59 %
    expect(play(c, k, A, 180, { duration: 305 })).toEqual([])
  })

  it('4 min 1 s on a long video → 1; exactly 4 min → none', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 240, { duration: 3600 })).toEqual([])
    expect(play(c, k, A, 1, { duration: 3600 })).toHaveLength(1)
  })

  it('live (infinite duration) only by the 4 min rule', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 200, { duration: Infinity })).toEqual([])
    expect(play(c, k, A, 41, { duration: Infinity })).toHaveLength(1)
  })

  it('SPA video change → counters reset', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 50)).toEqual([])
    expect(play(c, k, B, 15)).toEqual([]) // without resetting, 50 + 15 = 65 % would fire
    expect(c.watchedSeconds()).toBeGreaterThan(14) // the 1st sample of the new video only sets the baseline
    expect(c.watchedSeconds()).toBeLessThanOrEqual(15)
    const evs = play(c, k, B, 46)
    expect(evs.map((e) => e.video_id)).toEqual([B])
  })

  it('an ad does not count', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 90, { ad: true, duration: 95 })).toEqual([]) // the ad uses the same <video>
    expect(c.watchedSeconds()).toBe(0)
    expect(play(c, k, A, 35)).toEqual([])
    expect(play(c, k, A, 26)).toHaveLength(1)
  })

  it('an open tab without playing (paused or idle) does not count', () => {
    const c = new WatchCounter()
    let t = 0
    for (let i = 0; i < 600; i++) {
      t += 1000
      expect(c.sample({ videoId: A, currentTime: 5, duration: 100, paused: i % 2 === 0, ad: false, rate: 1, at: t })).toBeNull()
    }
    expect(c.watchedSeconds()).toBe(0)
  })

  it('skipping forward (seek) does not count', () => {
    const c = new WatchCounter()
    let t = 0
    c.sample({ videoId: A, currentTime: 0, duration: 100, paused: false, ad: false, rate: 1, at: t })
    t += 250
    expect(c.sample({ videoId: A, currentTime: 90, duration: 100, paused: false, ad: false, rate: 1, at: t })).toBeNull()
    expect(c.watchedSeconds()).toBe(0)
  })

  it('background video (samples spaced out by throttling) counts real time', () => {
    const c = new WatchCounter()
    let t = 0
    let pos = 0
    c.sample({ videoId: A, currentTime: pos, duration: 3600, paused: false, ad: false, rate: 1, at: t })
    const evs: WatchEvent[] = []
    for (let i = 0; i < 5; i++) {
      t += 60_000
      pos += 60
      const e = c.sample({ videoId: A, currentTime: pos, duration: 3600, paused: false, ad: false, rate: 1, at: t })
      if (e) evs.push(e)
    }
    expect(evs).toHaveLength(1) // 5 real minutes in the background
  })

  it('2× speed counts the video watched (position), not the clock', () => {
    const c = new WatchCounter()
    let t = 0
    let pos = 0
    const evs: WatchEvent[] = []
    for (let i = 0; i < 124; i++) {
      t += 250
      pos += 0.5
      const e = c.sample({ videoId: A, currentTime: pos, duration: 100, paused: false, ad: false, rate: 2, at: t })
      if (e) evs.push(e)
    }
    expect(evs).toHaveLength(1)
  })

  it('one event per video per session: going back to the same video does not repeat', () => {
    const c = new WatchCounter()
    const k = newClock()
    expect(play(c, k, A, 61)).toHaveLength(1)
    play(c, k, B, 5)
    k.pos[A] = 0
    expect(play(c, k, A, 70)).toEqual([])
  })
})

// ---------------------------------------------------------------- DOM adapter (jsdom)

function fakePlayer(doc: Document) {
  doc.body.innerHTML =
    '<ytd-watch-flexy video-id=""><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>' +
    '<ytd-video-owner-renderer><a href="/channel/UCsBjURrPoezykLs9EqgamOA">Fireship</a></ytd-video-owner-renderer></ytd-watch-flexy>' +
    '<div id="inline-preview"><video class="preview"></video></div>'
  const video = doc.querySelector<HTMLVideoElement>('video.html5-main-video')!
  const state = { currentTime: 0, duration: 100, paused: false, playbackRate: 1 }
  for (const k of Object.keys(state) as Array<keyof typeof state>) {
    Object.defineProperty(video, k, { configurable: true, get: () => state[k] })
  }
  return { video, state, player: doc.querySelector('#movie_player')!, flexy: doc.querySelector('ytd-watch-flexy')! }
}

describe('createTracker (DOM)', () => {
  function setup() {
    let t = 1_762_700_000_000
    let url = new URL(`https://www.youtube.com/watch?v=${A}`)
    const sent: WatchEvent[] = []
    let failNext = 0
    const send = vi.fn(async (_type: 'sync.watch', ev: WatchEvent): Promise<Envelope<{ queued: number }>> => {
      if (failNext > 0) {
        failNext--
        return { ok: false, error: { code: 'internal', message: 'no answer from background' } }
      }
      sent.push(ev)
      return { ok: true, data: { queued: sent.length } }
    })
    const p = fakePlayer(document)
    p.flexy.setAttribute('video-id', A)
    const tr = createTracker({ doc: document, url: () => url, now: () => t, send })
    tr.start()
    const tick = (s: number, step = 0.25) => {
      for (let i = 0; i < Math.round(s / step); i++) {
        t += step * 1000
        p.state.currentTime += step
        p.video.dispatchEvent(new Event('timeupdate'))
      }
    }
    return {
      tr,
      p,
      sent,
      send,
      tick,
      failSends: (n: number) => (failNext = n),
      go: (id: string) => {
        url = new URL(`https://www.youtube.com/watch?v=${id}`)
        p.state.currentTime = 0
        p.flexy.setAttribute('video-id', id)
      }
    }
  }

  it('61 % of playback → sync.watch with the video_id and the owner\'s channel_id', async () => {
    const w = setup()
    w.tick(61)
    await vi.waitFor(() => expect(w.sent).toHaveLength(1))
    expect(w.sent[0]).toMatchObject({ video_id: A, channel_id: 'UCsBjURrPoezykLs9EqgamOA' })
    w.tick(20)
    await Promise.resolve()
    expect(w.sent).toHaveLength(1)
    w.tr.stop()
  })

  it('an ad (#movie_player.ad-showing) does not count', async () => {
    const w = setup()
    w.p.player.classList.add('ad-showing')
    w.tick(80)
    w.p.player.classList.remove('ad-showing')
    w.p.state.currentTime = 0
    w.tick(40)
    await Promise.resolve()
    expect(w.sent).toEqual([])
    w.tr.stop()
  })

  it('video change without reloading (URL changes) resets and counts the new one', async () => {
    const w = setup()
    w.tick(50)
    w.go(B)
    w.tick(15)
    await Promise.resolve()
    expect(w.sent).toEqual([])
    w.tick(47)
    await vi.waitFor(() => expect(w.sent.map((e) => e.video_id)).toEqual([B]))
    w.tr.stop()
  })

  it('a preview video (outside #movie_player) is ignored', async () => {
    const w = setup()
    const preview = document.querySelector<HTMLVideoElement>('video.preview')!
    let pos = 0
    Object.defineProperty(preview, 'currentTime', { configurable: true, get: () => pos })
    Object.defineProperty(preview, 'duration', { configurable: true, get: () => 10 })
    Object.defineProperty(preview, 'paused', { configurable: true, get: () => false })
    for (let i = 0; i < 100; i++) {
      pos += 0.25
      preview.dispatchEvent(new Event('timeupdate'))
    }
    await Promise.resolve()
    expect(w.sent).toEqual([])
    w.tr.stop()
  })

  it('failure delivering to the background → retries (without losing or duplicating)', async () => {
    const w = setup()
    w.failSends(1)
    w.tick(61)
    await vi.waitFor(() => expect(w.send).toHaveBeenCalledTimes(1))
    expect(w.sent).toEqual([])
    w.tick(1) // the next sample retries the pending one
    await vi.waitFor(() => expect(w.sent).toHaveLength(1))
    w.tick(10)
    await Promise.resolve()
    expect(w.sent).toHaveLength(1)
    w.tr.stop()
  })

  it('failure delivering and the video ends (no new sample) → retry by timer', async () => {
    vi.useFakeTimers()
    const w = setup()
    w.failSends(2)
    w.tick(61)
    await vi.advanceTimersByTimeAsync(0)
    expect(w.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000) // 1st retry (fails again)
    expect(w.send).toHaveBeenCalledTimes(2)
    expect(w.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(4000) // 2nd (doubled backoff) delivers
    expect(w.sent.map((e) => e.video_id)).toEqual([A])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.send).toHaveBeenCalledTimes(3)
    w.tr.stop()
  })

  it('stop() turns it off: nothing more is counted', async () => {
    const w = setup()
    w.tr.stop()
    w.tick(80)
    await Promise.resolve()
    expect(w.sent).toEqual([])
  })
})

// ---------------------------------------------------------------- owner from the page's player data
// Signed-in live page (Nov 2026): the owner link is `/@handle`, never `/channel/UC…`; the only place the isolated world
// sees the owner's id is the inline `ytInitialPlayerResponse.videoDetails` of the page that was loaded (stale after SPA).

function signedInPage(doc: Document, inlineVideoId: string, inlineChannelId: string) {
  const details = { videoId: inlineVideoId, title: 'Me at the zoo', lengthSeconds: '19', channelId: inlineChannelId, isOwnerViewing: false }
  doc.head.innerHTML =
    '<script>var ytInitialPlayerResponse = {"responseContext":{"serviceTrackingParams":[{"service":"GFEEDBACK","params":[{"key":"channelId","value":"UCother000000000000000000"}]}]},' +
    `"videoDetails":${JSON.stringify(details)},"microformat":{"playerMicroformatRenderer":{"externalChannelId":"${inlineChannelId}"}}};</script>`
  doc.body.innerHTML =
    '<ytd-watch-flexy video-id=""><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>' +
    '<ytd-video-owner-renderer><a href="/@jawed">jawed</a></ytd-video-owner-renderer></ytd-watch-flexy>'
  const video = doc.querySelector<HTMLVideoElement>('video.html5-main-video')!
  const state = { currentTime: 0, duration: 100, paused: false, playbackRate: 1 }
  for (const k of Object.keys(state) as Array<keyof typeof state>) {
    Object.defineProperty(video, k, { configurable: true, get: () => state[k] })
  }
  return { video, state, flexy: doc.querySelector('ytd-watch-flexy')! }
}

describe('createTracker: owner id on the signed-in page', () => {
  const JAWED = 'UC4QobU6STFB0P71PMvOGN5A'

  function run(urlId: string, inlineId: string) {
    let t = 1_762_700_000_000
    const sent: WatchEvent[] = []
    const send = vi.fn(async (_type: 'sync.watch', ev: WatchEvent): Promise<Envelope<{ queued: number }>> => {
      sent.push(ev)
      return { ok: true, data: { queued: sent.length } }
    })
    const p = signedInPage(document, inlineId, JAWED)
    p.flexy.setAttribute('video-id', urlId)
    const tr = createTracker({ doc: document, url: () => new URL(`https://www.youtube.com/watch?v=${urlId}`), now: () => t, send })
    tr.start()
    for (let i = 0; i < 61 * 4; i++) {
      t += 250
      p.state.currentTime += 0.25
      p.video.dispatchEvent(new Event('timeupdate'))
    }
    return { tr, sent }
  }

  it('page loaded on this video: channel_id from videoDetails (the only id the page shows)', async () => {
    const r = run(A, A)
    await vi.waitFor(() => expect(r.sent).toHaveLength(1))
    expect(r.sent[0]).toMatchObject({ video_id: A, channel_id: JAWED })
    r.tr.stop()
    document.head.innerHTML = ''
  })

  it('after a SPA switch the inline data describes another video: channel_id stays null (never a wrong owner)', async () => {
    const r = run(B, A)
    await vi.waitFor(() => expect(r.sent).toHaveLength(1))
    expect(r.sent[0]).toMatchObject({ video_id: B, channel_id: null })
    r.tr.stop()
    document.head.innerHTML = ''
  })
})

describe('content/tracker module', () => {
  it('attaches on /watch and declares the real route', () => {
    expect(tracker.matches(new URL(`https://www.youtube.com/watch?v=${A}`), null)).toBe(true)
    expect(tracker.matches(new URL('https://www.youtube.com/feed/channels'), null)).toBe(false)
    expect(tracker.REAL_ROUTES).toEqual(['POST /ext/sync/watch'])
  })
})
