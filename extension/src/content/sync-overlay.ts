// content/sync-overlay — notice over /feed/channels while the user-requested sync reads the list
// in a visible tab (background/sync opens the tab; content/scraper shows this notice when `visible`).
//
// - Says what is happening ("reading your subscriptions"), counts live, makes clear nothing is changed in the account and
//   offers Cancel (button or Esc). Disappears when the read finishes, is cancelled or the module stops.
// - Shadow DOM on its own element (`<tube-sync-overlay>`): the page cannot select or style the content, and the
//   notice's style does not leak. `:host` with `all: initial !important` — in `!important` declarations the inner
//   context wins over the outer one, so not even a page `* {… !important}` reaches the notice.
// - No brand color: only system colors (`Canvas`, `CanvasText`, `ButtonFace`…), light/dark via
//   `color-scheme`. No animation with `prefers-reduced-motion: reduce`. Does not steal focus (role=status, polite).
import { t } from '../lib/i18n'

export const OVERLAY_TAG = 'tube-sync-overlay'

export interface SyncOverlayOptions {
  /** the user asked to stop (button or Esc); called once */
  onCancel: () => void
  doc?: Document
}

export interface SyncOverlay {
  /** count of channels read so far */
  update(count: number): void
  remove(): void
  readonly removed: boolean
}

const CSS = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  left: 50% !important;
  bottom: 24px !important;
  transform: translateX(-50%) !important;
  color-scheme: light dark !important;
  pointer-events: auto !important;
}
.card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid GrayText;
  border-radius: 10px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 22%, transparent);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.15; } }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { font-weight: 600; }
.count { font-variant-numeric: tabular-nums; }
.note { font-size: 12px; opacity: 0.8; }
button {
  flex: none;
  font: inherit;
  padding: 4px 12px;
  border: 1px solid ButtonBorder;
  border-radius: 6px;
  background: ButtonFace;
  color: ButtonText;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
button:disabled { cursor: default; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) {
  .dot { animation: none; }
}
`

/** Shows the notice (replaces a previous one left behind). */
export function showSyncOverlay(opts: SyncOverlayOptions): SyncOverlay {
  const doc = opts.doc ?? document
  const view = doc.defaultView ?? window
  for (const old of Array.from(doc.querySelectorAll(OVERLAY_TAG))) old.remove()

  const host = doc.createElement(OVERLAY_TAG)
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = CSS
  const card = doc.createElement('div')
  card.className = 'card'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')

  const dot = doc.createElement('span')
  dot.className = 'dot'
  dot.setAttribute('aria-hidden', 'true')
  const text = doc.createElement('div')
  text.className = 'text'
  const title = doc.createElement('span')
  title.className = 'title'
  title.textContent = t('sync', 'overlay_title')
  const count = doc.createElement('span')
  count.className = 'count'
  count.dataset.role = 'count'
  count.textContent = t('sync', 'overlay_count', { count: 0 })
  const safe = doc.createElement('span')
  safe.className = 'note'
  safe.textContent = t('sync', 'overlay_safe')
  const keep = doc.createElement('span')
  keep.className = 'note'
  keep.textContent = t('sync', 'overlay_keep')
  text.append(title, count, safe, keep)

  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = t('sync', 'overlay_cancel')
  button.setAttribute('aria-keyshortcuts', 'Escape')

  card.append(dot, text, button)
  root.append(style, card)

  let removed = false
  let cancelled = false
  const cancel = () => {
    if (cancelled || removed) return
    cancelled = true
    button.disabled = true
    try {
      opts.onCancel()
    } catch (e) {
      console.warn('[tube] sync overlay: onCancel failed', e)
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || removed) return
    e.preventDefault()
    e.stopPropagation()
    cancel()
  }
  button.addEventListener('click', cancel)
  view.addEventListener('keydown', onKey, true)
  ;(doc.body ?? doc.documentElement).append(host)

  return {
    update(n: number) {
      if (!removed) count.textContent = t('sync', 'overlay_count', { count: Math.max(0, Math.floor(n)) })
    },
    remove() {
      if (removed) return
      removed = true
      view.removeEventListener('keydown', onKey, true)
      host.remove()
    },
    get removed() {
      return removed
    }
  }
}
