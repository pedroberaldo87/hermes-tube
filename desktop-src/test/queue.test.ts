// The Watch queue model (lib/queue): pure operations (create, remove, restore, move, play next, replace) and the
// store that the Watch screen and the player share. The video being played stays marked through every edit.
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedItem } from '../../shared/api-types'
import {
  $queue,
  type QueueOrigin,
  createQueue,
  getQueue,
  moveBy,
  moveItem,
  nextOf,
  openInQueue,
  playNext,
  prevOf,
  queueIndex,
  queueOriginOf,
  removeItem,
  restoreItem,
  sameOrigin,
  setCurrent,
  setQueue
} from '../lib/queue'

const IDS = ['wjZofJX0v4M', 'VMj-3S1tku0', 'ujkD4SxPKOI', 'G_em1hHPnXY', 'aircAruvnKk']

function item(id: string): FeedItem {
  return { video: { id, title: `Video ${id}` } } as unknown as FeedItem
}

const LIST = IDS.map(item)
const FAV: QueueOrigin = { kind: 'list', id: 'Favorites', label: 'Favorites' }
const SCI: QueueOrigin = { kind: 'list', id: 'Science', label: 'Science' }
const ids = (q: { items: readonly FeedItem[] } | null) => q?.items.map((it) => it.video.id) ?? null

beforeEach(() => {
  setQueue(null)
})

describe('createQueue', () => {
  it('copies the list, drops duplicates and marks the current video', () => {
    const source = [...LIST, item(IDS[1])]
    const q = createQueue(FAV, source, IDS[2])
    expect(ids(q)).toEqual(IDS)
    expect(q.current).toBe(IDS[2])
    expect(queueIndex(q)).toBe(2)
    source.length = 0
    expect(q.items).toHaveLength(5) // a copy: the caller's list can change
  })

  it('a current video outside the list leaves nothing marked', () => {
    const q = createQueue(FAV, LIST, 'zzzzzzzzzzz')
    expect(q.current).toBeNull()
    expect(queueIndex(q)).toBe(-1)
    expect(nextOf(q)?.video.id).toBe(IDS[0]) // next = the first one
    expect(prevOf(q)).toBeNull()
  })

  it('every queue gets a new serial (undo is tied to the queue it came from)', () => {
    expect(createQueue(FAV, LIST, IDS[0]).serial).not.toBe(createQueue(FAV, LIST, IDS[0]).serial)
  })
})

describe('next / previous follow the queue order', () => {
  it('in the middle, at the ends', () => {
    const q = createQueue(FAV, LIST, IDS[0])
    expect(prevOf(q)).toBeNull()
    expect(nextOf(q)?.video.id).toBe(IDS[1])
    const last = setCurrent(q, IDS[4])
    expect(nextOf(last)).toBeNull()
    expect(prevOf(last)?.video.id).toBe(IDS[3])
  })

  it('setCurrent ignores a video that is not in the queue', () => {
    const q = createQueue(FAV, LIST, IDS[1])
    expect(setCurrent(q, 'zzzzzzzzzzz')).toBe(q)
  })
})

describe('removeItem / restoreItem', () => {
  it('removing another video keeps the current one; restore puts it back where it was', () => {
    const q = createQueue(FAV, LIST, IDS[1])
    const { queue, removed } = removeItem(q, IDS[3])
    expect(ids(queue)).toEqual([IDS[0], IDS[1], IDS[2], IDS[4]])
    expect(queue.current).toBe(IDS[1])
    expect(removed).toMatchObject({ index: 3, wasCurrent: false })
    const back = restoreItem(queue, removed!)
    expect(ids(back)).toEqual(IDS)
    expect(back.current).toBe(IDS[1])
  })

  it('removing the current video moves to the next one (the previous one at the end; none when empty)', () => {
    const q = createQueue(FAV, LIST, IDS[2])
    const a = removeItem(q, IDS[2])
    expect(a.queue.current).toBe(IDS[3])
    expect(a.removed?.wasCurrent).toBe(true)
    const b = removeItem(setCurrent(q, IDS[4]), IDS[4])
    expect(b.queue.current).toBe(IDS[3])
    const single = createQueue(FAV, [LIST[0]], IDS[0])
    const c = removeItem(single, IDS[0])
    expect(c.queue.items).toEqual([])
    expect(c.queue.current).toBeNull()
    // undo of the current one: back in place and current again
    const back = restoreItem(c.queue, c.removed!)
    expect(ids(back)).toEqual([IDS[0]])
    expect(back.current).toBe(IDS[0])
  })

  it('unknown id: nothing removed, same queue', () => {
    const q = createQueue(FAV, LIST, IDS[0])
    expect(removeItem(q, 'zzzzzzzzzzz')).toEqual({ queue: q, removed: null })
  })

  it('restore after other edits clamps the position and never duplicates', () => {
    const q = createQueue(FAV, LIST, IDS[0])
    const { queue, removed } = removeItem(q, IDS[4])
    const shorter = removeItem(removeItem(queue, IDS[3]).queue, IDS[2]).queue
    expect(ids(restoreItem(shorter, removed!))).toEqual([IDS[0], IDS[1], IDS[4]])
    expect(restoreItem(q, removed!)).toBe(q) // already there
  })
})

describe('moveItem / moveBy / playNext', () => {
  it('moves by index; the current video stays current wherever it goes', () => {
    const q = createQueue(FAV, LIST, IDS[1])
    const moved = moveItem(q, 1, 4)
    expect(ids(moved)).toEqual([IDS[0], IDS[2], IDS[3], IDS[4], IDS[1]])
    expect(moved.current).toBe(IDS[1])
    expect(queueIndex(moved)).toBe(4)
    expect(nextOf(moved)).toBeNull()
    expect(prevOf(moved)?.video.id).toBe(IDS[4])
  })

  it('out of range or no-op: same queue', () => {
    const q = createQueue(FAV, LIST, IDS[1])
    expect(moveItem(q, 2, 2)).toBe(q)
    expect(moveItem(q, -1, 2)).toBe(q)
    expect(moveItem(q, 0, 9)).toBe(q)
    expect(moveBy(q, IDS[0], -1)).toBe(q)
    expect(moveBy(q, IDS[4], 1)).toBe(q)
    expect(moveBy(q, 'zzzzzzzzzzz', 1)).toBe(q)
  })

  it('moveBy: one step up or down', () => {
    const q = createQueue(FAV, LIST, IDS[0])
    expect(ids(moveBy(q, IDS[2], -1))).toEqual([IDS[0], IDS[2], IDS[1], IDS[3], IDS[4]])
    expect(ids(moveBy(q, IDS[2], 1))).toEqual([IDS[0], IDS[1], IDS[3], IDS[2], IDS[4]])
  })

  it('playNext puts the video right after the current one (from before or after it)', () => {
    const q = createQueue(FAV, LIST, IDS[2])
    expect(ids(playNext(q, IDS[4]))).toEqual([IDS[0], IDS[1], IDS[2], IDS[4], IDS[3]])
    expect(ids(playNext(q, IDS[0]))).toEqual([IDS[1], IDS[2], IDS[0], IDS[3], IDS[4]])
    expect(playNext(q, IDS[0]).current).toBe(IDS[2])
    expect(nextOf(playNext(q, IDS[0]))?.video.id).toBe(IDS[0])
  })

  it('playNext on the current video, on the one already next, or with nothing playing: no change', () => {
    const q = createQueue(FAV, LIST, IDS[2])
    expect(playNext(q, IDS[2])).toBe(q)
    expect(playNext(q, IDS[3])).toBe(q)
    const none = createQueue(FAV, LIST, null)
    expect(playNext(none, IDS[3])).toBe(none)
  })
})

describe('origin', () => {
  it('derived from where the video was opened: the list and its name; no list → none', () => {
    expect(queueOriginOf({ list: LIST, source: 'Favorites' })).toEqual(FAV)
    expect(queueOriginOf({ list: LIST, source: null })).toEqual({ kind: 'list', id: '', label: null })
    expect(queueOriginOf({ list: [], source: 'Favorites' })).toBeNull()
    expect(queueOriginOf({})).toBeNull()
    // a caller that knows better (saved playlists, Watch later) passes its own origin
    const later: QueueOrigin = { kind: 'later', id: 'later', label: 'Watch later' }
    expect(queueOriginOf({ list: LIST, source: 'x', origin: later })).toEqual(later)
  })

  it('sameOrigin compares kind and id', () => {
    expect(sameOrigin(FAV, { ...FAV, label: 'Renamed' })).toBe(true)
    expect(sameOrigin(FAV, SCI)).toBe(false)
    expect(sameOrigin(null, FAV)).toBe(false)
  })
})

describe('openInQueue: what opening a video from outside the queue does', () => {
  it('a list replaces the queue (without asking)', () => {
    openInQueue(IDS[1], { list: LIST, source: 'Favorites' })
    expect(ids(getQueue())).toEqual(IDS)
    expect(getQueue()?.current).toBe(IDS[1])
    expect(getQueue()?.origin).toEqual(FAV)
    openInQueue(IDS[0], { list: LIST.slice(0, 2), source: 'Science' })
    expect(ids(getQueue())).toEqual(IDS.slice(0, 2))
    expect(getQueue()?.origin).toEqual(SCI)
  })

  it('the same list again, with the video still queued: keeps the edited queue and only moves the current', () => {
    openInQueue(IDS[0], { list: LIST, source: 'Favorites' })
    setQueue(removeItem(getQueue()!, IDS[2]).queue)
    const serial = getQueue()?.serial
    openInQueue(IDS[3], { list: LIST, source: 'Favorites' })
    expect(ids(getQueue())).toEqual([IDS[0], IDS[1], IDS[3], IDS[4]])
    expect(getQueue()?.current).toBe(IDS[3])
    expect(getQueue()?.serial).toBe(serial)
    // a video the user had removed: a fresh copy of the list
    openInQueue(IDS[2], { list: LIST, source: 'Favorites' })
    expect(ids(getQueue())).toEqual(IDS)
  })

  it('no list (chat, a link): a queued video keeps the queue; anything else drops it', () => {
    openInQueue(IDS[0], { list: LIST, source: 'Favorites' })
    openInQueue(IDS[3], {})
    expect(getQueue()?.current).toBe(IDS[3])
    expect(ids(getQueue())).toEqual(IDS)
    openInQueue('zzzzzzzzzzz', {})
    expect(getQueue()).toBeNull()
    expect($queue.get()).toBeNull()
  })
})
