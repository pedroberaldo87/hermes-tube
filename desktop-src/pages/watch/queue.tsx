// "Up next" on the Watch screen: the queue from `lib/queue`, editable in place.
//   rows      every video of the queue, the one playing marked (▶ in the gutter, "Now playing", `aria-current`).
//             Click plays it (the order stays). On hover/focus: "Play next" and ✕ (remove from the queue only — the
//             video's state and the list it came from do not change).
//   reorder   drag by the handle in the gutter (pointer events on our own rows: a line shows where it lands, the list
//             scrolls by itself near its edges, Escape cancels) or Alt+↑ / Alt+↓ on a focused row.
//   keyboard  ↑ / ↓ move the focus between rows; Delete / Backspace remove the focused row (the focus goes to the row
//             that took its place). Every edit is announced in a polite live region.
//   undo      removing shows a toast with "Undo" (the same toast as the video actions): it puts the video back where it
//             was and, if it was the one playing, plays it again. An undo from a queue that was since replaced does
//             nothing.
// No library: the plugin only imports the SDK and React.
import { Button, Codicon, atom, host, useValue } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FeedItem } from '../../../shared/api-types'
import { Thumb, formatRelative, useLocale } from '../../components'
import type { Translate } from '../../lib/i18n'
import { onShellReset } from '../../lib/lifecycle'
import { playQueued } from '../../lib/player'
import {
  type Queue,
  type RemovedItem,
  getQueue,
  indexOf,
  moveBy,
  moveItem,
  nextOf,
  playNext,
  prevOf,
  queueIndex,
  removeItem,
  restoreItem,
  setQueue
} from '../../lib/queue'
import { cx } from '../../lib/style'
import { UNDO_MS, applyWatchLayer, useWatchOverlay } from './actions'

// ------------------------------------------------------------------ edits (shared by the panel and the toast)

/** Text of the live region (screen readers): the last edit. */
const $announce = atom('')

onShellReset(() => {
  $announce.set('')
})

const titleOf = (it: FeedItem) => it.video.title || it.video.id

function announce(text: string): void {
  $announce.set(text)
}

/** Removes a video from the queue (never its state). Removing the one playing plays the one that took its place. */
export function removeQueued(id: string, t: Translate): boolean {
  const q = getQueue()
  if (!q) return false
  const { queue, removed } = removeItem(q, id)
  if (!removed) return false
  setQueue(queue)
  if (removed.wasCurrent && queue.current) playQueued(queue.current)
  const message = t('next.removed', { title: titleOf(removed.item) })
  announce(message)
  host.notify({
    kind: 'info',
    message,
    durationMs: UNDO_MS,
    action: { label: t('toast.undo'), onClick: () => undoRemove(removed, t) }
  })
  return true
}

/** Puts a removed video back (only in the queue it was removed from). */
export function undoRemove(removed: RemovedItem, t: Translate): boolean {
  const q = getQueue()
  if (!q || q.serial !== removed.serial) return false
  const back = restoreItem(q, removed)
  if (back === q) return false
  setQueue(back)
  if (removed.wasCurrent) playQueued(removed.item.video.id)
  announce(t('next.restored', { title: titleOf(removed.item) }))
  return true
}

function announceMove(q: Queue, id: string, t: Translate): void {
  const i = indexOf(q, id)
  if (i >= 0) announce(t('next.moved', { title: titleOf(q.items[i]), index: i + 1, total: q.items.length }))
}

/** One step up (-1) or down (+1). */
export function moveQueued(id: string, delta: number, t: Translate): boolean {
  const q = getQueue()
  if (!q) return false
  const next = moveBy(q, id, delta)
  if (next === q) return false
  setQueue(next)
  announceMove(next, id, t)
  return true
}

/** From one index to another (the drop of a drag). */
export function moveQueuedTo(from: number, to: number, t: Translate): boolean {
  const q = getQueue()
  if (!q) return false
  const next = moveItem(q, from, to)
  if (next === q) return false
  setQueue(next)
  announceMove(next, q.items[from].video.id, t)
  return true
}

export function playNextQueued(id: string, t: Translate): boolean {
  const q = getQueue()
  if (!q) return false
  const next = playNext(q, id)
  if (next === q) return false
  setQueue(next)
  const it = next.items[indexOf(next, id)]
  announce(t('next.queued_next', { title: titleOf(it) }))
  return true
}

// ------------------------------------------------------------------ drag (pointer events on our own rows)

/** Distance from the list's top/bottom edge where it starts scrolling by itself, and its top speed (px per frame). */
const EDGE_PX = 48
const EDGE_SPEED = 16

interface DragView {
  id: string
  /** Insertion point (0…n, before the row at that index) or `null` when dropping would not move anything. */
  drop: number | null
}

const ROW_SELECTOR = ':scope > [data-part="watch-next-item"]'

const nextFrame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const h = requestAnimationFrame(fn)
    return () => cancelAnimationFrame(h)
  }
  const h = setTimeout(fn, 16)
  return () => clearTimeout(h)
}

function useQueueDrag(list: RefObject<HTMLOListElement | null>, scroller: RefObject<HTMLDivElement | null>, onDrop: (from: number, to: number) => void) {
  const [view, setView] = useState<DragView | null>(null)
  const active = useRef<(() => void) | null>(null)
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop

  // unmounting mid-drag (another video, leaving the section): listeners and timers go away
  useEffect(() => () => active.current?.(), [])

  const start = (e: ReactPointerEvent<HTMLElement>, id: string, from: number) => {
    if (e.button > 0) return
    const listEl = list.current
    if (!listEl) return
    e.preventDefault()
    active.current?.()
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // capture is a nicety (keeps the moves coming outside the window); document listeners do the work
    }
    const doc = listEl.ownerDocument
    let y = e.clientY
    let drop: number | null = null
    let cancelFrame: (() => void) | null = null

    const target = (): number | null => {
      const rows = [...listEl.querySelectorAll<HTMLElement>(ROW_SELECTOR)]
      let at = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (y < r.top + r.height / 2) {
          at = i
          break
        }
      }
      return at === from || at === from + 1 ? null : at
    }
    const update = () => {
      const next = target()
      if (next === drop) return
      drop = next
      setView({ id, drop })
    }
    // near the top/bottom edge of the list: scroll it, faster the closer the pointer is (by elapsed time, not frames)
    let last = 0
    const tick = () => {
      cancelFrame = null
      const sc = scroller.current
      if (!sc) return
      const now = Date.now()
      const frames = last ? Math.min(4, Math.max(1, (now - last) / 16)) : 1
      last = now
      const r = sc.getBoundingClientRect()
      const edge = Math.min(EDGE_PX, r.height / 4)
      let dy = 0
      if (y < r.top + edge) dy = -Math.ceil((frames * EDGE_SPEED * Math.min(edge, r.top + edge - y)) / edge)
      else if (y > r.bottom - edge) dy = Math.ceil((frames * EDGE_SPEED * Math.min(edge, y - (r.bottom - edge))) / edge)
      if (!dy) {
        last = 0
        return
      }
      const max = Math.max(0, sc.scrollHeight - sc.clientHeight)
      const to = Math.min(max, Math.max(0, sc.scrollTop + dy))
      if (to === sc.scrollTop) return
      sc.scrollTop = to
      update()
      cancelFrame = nextFrame(tick)
    }
    const onMove = (ev: PointerEvent) => {
      y = ev.clientY
      update()
      if (!cancelFrame) cancelFrame = nextFrame(tick)
    }
    const finish = (commit: boolean) => {
      stop()
      setView(null)
      if (commit && drop != null) dropRef.current(from, drop > from ? drop - 1 : drop)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish(false)
    }
    const stop = () => {
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerup', onUp)
      doc.removeEventListener('pointercancel', onCancel)
      doc.removeEventListener('keydown', onKey, true)
      cancelFrame?.()
      cancelFrame = null
      if (active.current === stop) active.current = null
    }
    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
    doc.addEventListener('pointercancel', onCancel)
    doc.addEventListener('keydown', onKey, true)
    active.current = stop
    setView({ id, drop: null })
  }

  return { view, start }
}

// ------------------------------------------------------------------ the panel

export interface QueuePanelProps {
  queue: Queue
  t: Translate
  /** Changes on every open: the row being played is brought into view inside the list. */
  seq: number
  /** Clock for relative time (preview/tests). */
  now?: number
}

const rowButtonOf = (list: HTMLElement | null, id: string) =>
  list?.querySelector<HTMLElement>(`[data-part="watch-next-item"][data-video="${id}"] [data-part="watch-next-row"]`) ?? null

export function QueuePanel({ queue, t, seq, now }: QueuePanelProps) {
  const overlay = useWatchOverlay()
  const locale = useLocale()
  const live = useValue($announce)
  const listRef = useRef<HTMLOListElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<string | null>(null)
  const drag = useQueueDrag(listRef, scrollRef, (from, to) => moveQueuedTo(from, to, t))
  const idx = queueIndex(queue)
  const total = queue.items.length
  const prevItem = prevOf(queue)
  const nextItem = nextOf(queue)
  const nextId = nextItem?.video.id ?? null
  const label = queue.origin?.label
  const hintId = `watch-next-hint-${seq}`

  // after a keyboard edit, the focus goes where it belongs (React moved or dropped the focused row)
  useLayoutEffect(() => {
    const id = focusAfter.current
    if (!id) return
    focusAfter.current = null
    rowButtonOf(listRef.current, id)?.focus()
  })

  // on every open, the row being played comes into view inside the list (only the list scrolls, never the page).
  // A passive effect: it runs after the screen's layout effect has set the list's height.
  useEffect(() => {
    const sc = scrollRef.current
    const cur = queue.current
    if (!sc || !cur || sc.scrollHeight <= sc.clientHeight) return
    const row = sc.querySelector<HTMLElement>(`[data-part="watch-next-item"][data-video="${cur}"]`)
    if (!row) return
    const top = row.offsetTop
    if (top < sc.scrollTop || top + row.offsetHeight > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, top - row.offsetHeight)
  }, [seq]) // only on open: an edit never scrolls the list under the pointer

  const remove = (it: FeedItem, i: number) => {
    const neighbour = queue.items[i + 1] ?? queue.items[i - 1]
    focusAfter.current = neighbour?.video.id ?? null
    removeQueued(it.video.id, t)
  }

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, it: FeedItem, i: number) => {
    if (e.metaKey || e.ctrlKey) return
    const id = it.video.id
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (e.altKey) {
      if (!vertical) return
      e.preventDefault()
      e.stopPropagation()
      focusAfter.current = id
      moveQueued(id, e.key === 'ArrowUp' ? -1 : 1, t)
      return
    }
    if (e.shiftKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) remove(it, i) // a held key does not empty the queue
      return
    }
    if (vertical) {
      const to = queue.items[i + (e.key === 'ArrowDown' ? 1 : -1)]
      if (!to) return
      e.preventDefault()
      e.stopPropagation()
      rowButtonOf(listRef.current, to.video.id)?.focus()
    }
  }

  const dragging = drag.view
  return (
    <aside className={cx('watch-next')} data-part="watch-next" aria-label={t('next.label')}>
      <div className={cx('watch-next-head')}>
        <h2 className={cx('watch-next-title t-head')}>{label ? t('next.from', { source: label }) : t('next.title')}</h2>
        <div className={cx('watch-next-nav')}>
          {idx >= 0 ? (
            <span className={cx('watch-next-pos t-label num')} data-part="watch-next-pos">
              {t('next.position', { index: idx + 1, total })}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            data-part="watch-prev"
            disabled={!prevItem}
            aria-label={t('next.previous')}
            aria-keyshortcuts="p"
            title={`${t('next.previous')} · P`}
            onClick={() => prevItem && playQueued(prevItem.video.id)}
          >
            <Codicon name="chevron-left" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            data-part="watch-next-btn"
            disabled={!nextItem}
            aria-label={t('next.next')}
            aria-keyshortcuts="n"
            title={`${t('next.next')} · N`}
            onClick={() => nextItem && playQueued(nextItem.video.id)}
          >
            <Codicon name="chevron-right" size={14} />
          </Button>
        </div>
      </div>
      <div className={cx('watch-next-scroll')} data-part="watch-next-scroll" ref={scrollRef}>
        {total === 0 ? (
          <div className={cx('watch-next-empty')} data-part="watch-next-empty">
            <p className={cx('watch-next-empty-title t-body')}>{t('next.empty')}</p>
            <p className={cx('watch-next-keys t-label')}>{t('next.empty_hint')}</p>
          </div>
        ) : (
          <ol className={cx('watch-next-list')} ref={listRef} aria-label={t('next.list')} data-dragging={dragging ? 'true' : undefined}>
            {queue.items.map((it, i) => {
              const id = it.video.id
              const v = applyWatchLayer(it, overlay[id])
              const current = id === queue.current
              const drop = dragging?.drop == null ? undefined : dragging.drop === i ? 'before' : dragging.drop === total && i === total - 1 ? 'after' : undefined
              return (
                <li
                  key={id}
                  className={cx('watch-next-item')}
                  data-part="watch-next-item"
                  data-video={id}
                  data-state={v.state}
                  data-current={current ? 'true' : 'false'}
                  data-dragging={dragging?.id === id ? 'true' : undefined}
                  data-drop={drop}
                >
                  <span className={cx('watch-next-grip')} data-part="watch-next-grip" aria-hidden="true" title={t('next.drag')} onPointerDown={(e) => drag.start(e, id, i)}>
                    <span className={cx('watch-next-index t-label num')}>{current ? <Codicon name="play" size={12} /> : i + 1}</span>
                    <Codicon name="gripper" size={14} className={cx('watch-next-grip-icon')} />
                  </span>
                  <button
                    type="button"
                    className={cx('bare watch-next-row')}
                    data-part="watch-next-row"
                    aria-current={current ? 'true' : undefined}
                    aria-describedby={hintId}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
                    onClick={() => playQueued(id)}
                    onKeyDown={(e) => onRowKey(e, it, i)}
                  >
                    <span className={cx('watch-next-thumb')}>
                      <Thumb videoId={id} title={it.video.title} durationS={it.video.duration_s} watched={v.state === 'watched'} isShort={it.video.is_short} />
                    </span>
                    <span className={cx('watch-next-body')}>
                      <span className={cx('watch-next-name t-body')}>{it.video.title}</span>
                      <span className={cx('watch-next-sub t-label')}>{it.channel?.title ?? it.video.channel_title ?? ''}</span>
                      {current ? (
                        <span className={cx('watch-next-now t-label')}>{t('next.now_playing')}</span>
                      ) : (
                        <span className={cx('watch-next-when t-label num')}>{formatRelative(it.video.published_at, now ?? Date.now(), locale)}</span>
                      )}
                    </span>
                  </button>
                  <span className={cx('watch-next-tools')}>
                    {current || id === nextId || idx < 0 ? null : (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        data-part="watch-next-playnext"
                        aria-label={t('next.play_next')}
                        title={t('next.play_next')}
                        onClick={() => playNextQueued(id, t)}
                      >
                        <Codicon name="arrow-up" size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      data-part="watch-next-remove"
                      aria-label={t('next.remove')}
                      title={`${t('next.remove')} · Delete`}
                      onClick={() => remove(it, i)}
                    >
                      <Codicon name="close" size={14} />
                    </Button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        {total > 0 ? (
          <div className={cx('watch-next-foot')}>
            <p className={cx('watch-next-keys t-label')} id={hintId}>
              {t('next.edit_keys')}
            </p>
            <p className={cx('watch-next-keys t-label')}>{nextItem || idx < 0 ? t('next.keys') : `${t('next.end')} ${t('next.keys')}`}</p>
          </div>
        ) : null}
      </div>
      <p className={cx('watch-sr')} data-part="watch-next-live" role="status" aria-live="polite">
        {live}
      </p>
    </aside>
  )
}
