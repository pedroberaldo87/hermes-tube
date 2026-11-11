// Watch screen stylesheet. Lives here as text because CSS files in styles/ only count if they are listed in
// `styles/index.ts`, so the CSS is kept here with the `PFX_` marker and the kit's rules (only prefixed classes, only
// theme variables, no network, container-based responsiveness — inside the query, `display` only hides). Could move to
// `styles/watch.css` and be registered
// in `styles/index.ts`.
// Mounted once per document, when the screen appears (never in register), in its own <style>; the plugin's
// unload (ctx.onDispose) removes it — owned by a token, like the kit's `mountStyles` (a reload does not drop the new one).
import { maybePluginContext } from '../../lib/ctx'
import { onShellReset } from '../../lib/lifecycle'
import { CLASS_PREFIX, resolveCss } from '../../lib/style'

export const WATCH_CSS = `

/* root: the whole section scrolls; it is the query container (the page goes from ~320 px to full screen) */
.PFX_watch {
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  color: var(--ui-text-primary);
  container-type: inline-size;
  container-name: PFX_watch;
  outline: none;
  /* the core's player width (640 px, height up to 1/3 of the window) */
  --PFX_watch-w: min(640px, calc(33dvh * 16 / 9));
  /* the queue column beside it takes the room the player cannot use (the player's size is the app's), up to this
     width, and the gap between the two */
  --PFX_watch-side: 640px;
  --PFX_watch-gap: var(--PFX_s5);
  /* the core draws its embed card with a 0.5rem margin above and below (inside our wrapper): the queue starts on
     the player's top line, not the wrapper's */
  --PFX_watch-embed-inset: 8px;
  /* room under the page's content (the queue beside the player stops above it: no page scroll for a short page) */
  --PFX_watch-pad-b: 48px;
}

/* --------------------------------------------------------------- the page: one box, one grid
   Behind its top, the video's own thumbnail, blurred and faint: the only color on the screen, changing with each
   video. It fades downward into the theme background (no fixed black: works in light and dark). */
.PFX_watch-page {
  position: relative;
  isolation: isolate;
  padding: var(--PFX_s4) var(--PFX_s5) var(--PFX_watch-pad-b);
}

.PFX_watch-ambient-clip {
  position: absolute;
  z-index: -1;
  top: 0;
  right: 0;
  left: 0;
  height: min(100%, calc(var(--PFX_watch-w) * 9 / 16 + 200px));
  overflow: hidden;
  pointer-events: none;
}

.PFX_watch[data-large='true'] .PFX_watch-ambient-clip {
  height: min(100%, 960px);
}

.PFX_watch-ambient {
  position: absolute;
  top: -20%;
  left: -10%;
  width: 120%;
  max-width: none; /* the app stylesheet caps images at 100%: here it bleeds on purpose */
  height: 120%;
  object-fit: cover;
  filter: blur(72px) saturate(1.4);
  opacity: 0.22;
  pointer-events: none;
  user-select: none;
  mask-image: linear-gradient(to bottom, black 20%, transparent 100%);
}

/* the grid, left-aligned in the section like its header (never centered). Narrow, or without a queue: one column
   exactly as wide as the player, so the line under it and the details share the player's edges; the queue goes
   under the player. The only side padding is the page's. */
.PFX_watch-layout {
  display: grid;
  grid-template-columns: minmax(0, var(--PFX_watch-w));
  grid-template-areas: 'player' 'foot' 'next' 'below';
  align-items: start;
  row-gap: var(--PFX_s3);
  column-gap: var(--PFX_watch-gap);
  min-width: 0;
}

.PFX_watch[data-large='true'] .PFX_watch-layout {
  grid-template-columns: minmax(0, 1fr);
  max-width: 1600px;
}

/* the player's column: the player sits at its start (its left edge is the details' left edge) */
.PFX_watch-stage {
  grid-area: player;
  display: flex;
  justify-content: flex-start;
  min-width: 0;
}

/* wrapper for the core's player. The width repeats the core's cap (640 px, height up to 1/3 of the window) so the
   player fills it at its own size; "Larger player" scales it with zoom (set by the screen). */
.PFX_watch-player {
  flex: none;
  width: var(--PFX_watch-w);
  max-width: 100%;
  min-width: 0;
}

/* under the player: one-time tip (left) and the discreet "Larger player" toggle (right) */
.PFX_watch-foot {
  grid-area: foot;
  display: flex;
  align-items: center;
  gap: var(--PFX_s3);
  min-width: 0;
  min-height: 28px;
  color: var(--PFX_fg3);
}

.PFX_watch-foot-spacer {
  flex: 1 1 auto;
}

/* multi-line when narrow: the icon sits on the first line, the button stays centered */
.PFX_watch-tip {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  margin: 0;
  color: var(--ui-text-secondary);
}

.PFX_watch-tip-icon {
  flex: none;
  height: var(--PFX_lh-label);
  color: var(--PFX_fg3);
}

.PFX_watch .PFX_watch-tip > button {
  align-self: center;
}

.PFX_watch-tip-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.PFX_watch .PFX_watch-foot button {
  flex: none;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-foot button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-larger[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ui-base) 10%, transparent);
  color: var(--ui-text-primary);
}

/* the details: in the player's column, under the line */
.PFX_watch-below {
  grid-area: below;
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s4);
  min-width: 0;
  padding-top: var(--PFX_s1);
}

/* wide: the queue is a column of its own on the right, from the player's top line down, as tall as the section
   allows (the measured height, --PFX_watch-h; not the player's), scrolling inside and staying in view while the
   details scroll. The player's column keeps the core's width (it gives way first when the section narrows). */
@container PFX_watch (min-width: 820px) {
  .PFX_watch[data-queue='true'] .PFX_watch-layout {
    grid-template-columns: minmax(0, var(--PFX_watch-w)) minmax(300px, 1fr);
    grid-template-areas: 'player next' 'foot next' 'below next';
    grid-template-rows: auto auto 1fr;
    max-width: calc(var(--PFX_watch-w) + var(--PFX_watch-gap) + var(--PFX_watch-side));
    margin-inline: auto; /* what is left over on a very wide window is split between the two sides */
  }

  .PFX_watch[data-queue='true'][data-large='true'] .PFX_watch-layout {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    max-width: 1600px;
  }

  /* (scoped by the root: the narrow rule for the same box comes later in this sheet) */
  .PFX_watch .PFX_watch-next {
    position: sticky;
    top: var(--PFX_s4);
    margin-top: var(--PFX_watch-embed-inset);
    max-height: calc(var(--PFX_watch-h, 100dvh) - var(--PFX_s4) - var(--PFX_watch-embed-inset) - var(--PFX_watch-pad-b));
  }
}

@container PFX_watch (max-width: 480px) {
  .PFX_watch-page {
    padding: var(--PFX_s2) var(--PFX_s3) var(--PFX_s6);
  }

  .PFX_watch-title {
    font-size: 18px;
    line-height: 24px;
  }
}

/* --------------------------------------------------------------- what is ours */

.PFX_watch-info {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
}

/* the title is the largest text in the plugin: here the video is the subject of the whole screen */
.PFX_watch-title {
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  letter-spacing: -0.015em;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.PFX_watch-meta {
  display: flex;
  align-items: center;
  gap: var(--PFX_s3);
  min-width: 0;
}

.PFX_watch-byline {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.PFX_watch-byline-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--PFX_s2);
  min-width: 0;
}

.PFX_watch-channel {
  color: var(--ui-text-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* published · duration · views: the dot between them is drawn here */
.PFX_watch-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
  color: var(--PFX_fg3);
}

.PFX_watch-facts > * + *::before {
  content: '·';
  margin: 0 6px;
  color: var(--ui-text-quaternary);
}

/* actions: one highlighted (monochrome: the highlight is contrast, not a color), the rest in groups with a rule */
.PFX_watch-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  padding-top: var(--PFX_s1);
}

.PFX_watch .PFX_watch-primary {
  height: 32px;
  padding-inline: 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--ui-text-primary);
  color: var(--ui-bg-editor);
  font-weight: 600;
  transition:
    background-color var(--PFX_dur) var(--PFX_ease),
    color var(--PFX_dur) var(--PFX_ease),
    border-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch .PFX_watch-primary:hover {
  background: color-mix(in srgb, var(--ui-text-primary) 86%, var(--ui-bg-editor));
  color: var(--ui-bg-editor);
}

/* already watched: the button steps back to an outline — the remaining action is undo */
.PFX_watch .PFX_watch-primary[aria-pressed='true'] {
  border-color: var(--ui-stroke-secondary);
  background: transparent;
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-primary[aria-pressed='true']:hover {
  background: color-mix(in srgb, var(--ui-base) 6%, transparent);
}

.PFX_watch-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
}

.PFX_watch .PFX_watch-group > button {
  height: 26px;
  padding-inline: 10px;
  border-radius: 999px;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-group > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-group > button[data-icon-only='true'] {
  width: 30px;
  padding-inline: 0;
}

.PFX_watch .PFX_watch-group > button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ui-base) 10%, transparent);
  color: var(--ui-text-primary);
}

.PFX_watch-actions-end {
  display: flex;
  margin-left: auto;
}

.PFX_watch .PFX_watch-actions-end > button {
  height: 32px;
  border-radius: 999px;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-actions-end > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch-note {
  margin: 0;
  color: var(--ui-text-secondary);
}

/* description: collapsed to 3 lines; "Show more" opens */
.PFX_watch-desc {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--PFX_s1);
  padding: 14px var(--PFX_s4) 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-base) 4%, transparent);
}

.PFX_watch-desc-text {
  margin: 0;
  color: var(--ui-text-secondary);
  line-height: 20px;
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.PFX_watch-desc[data-open='true'] .PFX_watch-desc-text {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}

/* "Open videos: In Hermes | On YouTube" (the same setting as Home): a preference, not content — discreet footer */
.PFX_watch-mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  padding-top: var(--PFX_s3);
  border-top: 1px solid var(--ui-stroke-tertiary);
  color: var(--PFX_fg3);
}

/* --------------------------------------------------------------- Up next: the queue */

/* narrow: under the player, a box of its own that scrolls inside (the details stay close) */
.PFX_watch-next {
  grid-area: next;
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
  min-height: 0;
  max-height: min(480px, calc(var(--PFX_watch-h, 100dvh) * 0.6));
}

.PFX_watch-next-scroll {
  position: relative; /* rows measure their offset from here (bringing the current one into view) */
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.PFX_watch-next-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--PFX_s2);
  min-height: 32px;
  min-width: 0;
}

.PFX_watch-next-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.005em;
}

/* position in the queue + previous/next: one piece */
.PFX_watch-next-nav {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 2px 0 10px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
}

.PFX_watch-next-pos {
  margin-right: 4px;
  color: var(--PFX_fg3);
  white-space: nowrap;
}

.PFX_watch-next-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.PFX_watch-next-list[data-dragging='true'] {
  cursor: grabbing;
  user-select: none;
}

/* a row: gutter (position, ▶ for the one playing, the drag handle on hover) + the clickable video */
.PFX_watch-next-item {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: stretch;
  border-radius: 12px;
  transition:
    background-color var(--PFX_dur) var(--PFX_ease),
    opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch-next-item:hover {
  background: color-mix(in srgb, var(--ui-base) 5%, transparent);
}

.PFX_watch-next-item[data-current='true'] {
  background: color-mix(in srgb, var(--ui-base) 9%, transparent);
}

.PFX_watch-next-item[data-dragging='true'] {
  opacity: 0.45;
}

/* where the dragged row lands: a line between rows */
.PFX_watch-next-item[data-drop]::before {
  content: '';
  position: absolute;
  z-index: 1;
  right: 6px;
  left: 6px;
  height: 2px;
  border-radius: 1px;
  background: var(--ui-text-primary);
  pointer-events: none;
}

.PFX_watch-next-item[data-drop='before']::before {
  top: -1px;
}

.PFX_watch-next-item[data-drop='after']::before {
  bottom: -1px;
}

.PFX_watch-next-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  color: var(--PFX_fg3);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.PFX_watch-next-index {
  color: var(--PFX_fg3);
}

.PFX_watch-next-item[data-current='true'] .PFX_watch-next-index {
  color: var(--ui-text-primary);
}

.PFX_watch-next-grip-icon {
  display: none;
}

.PFX_watch-next-item:hover .PFX_watch-next-grip-icon,
.PFX_watch-next-item[data-dragging='true'] .PFX_watch-next-grip-icon {
  display: inline-flex;
}

.PFX_watch-next-item:hover .PFX_watch-next-index,
.PFX_watch-next-item[data-dragging='true'] .PFX_watch-next-index {
  display: none;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-item:not([data-dragging='true']) .PFX_watch-next-grip-icon {
  display: none;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-item:not([data-dragging='true']) .PFX_watch-next-index {
  display: inline;
}

.PFX_watch-next-row {
  display: grid;
  grid-template-columns: clamp(96px, 40%, 140px) minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  width: 100%;
  padding: 6px 8px 6px 2px;
  border-radius: 12px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.PFX_watch-next-row:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

.PFX_watch-next-thumb {
  display: block;
  min-width: 0;
}

.PFX_watch-next-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding-top: 1px;
}

.PFX_watch-next-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--ui-text-primary);
  font-weight: 550;
}

.PFX_watch-next-item[data-state='watched'] .PFX_watch-next-name {
  color: var(--ui-text-secondary);
}

.PFX_watch-next-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-secondary);
}

.PFX_watch-next-when {
  color: var(--PFX_fg3);
}

.PFX_watch-next-when:empty {
  display: none;
}

.PFX_watch-next-now {
  color: var(--ui-text-primary);
  font-weight: 600;
}

/* "Play next" and ✕: on hover or keyboard focus, over the row's top right corner */
.PFX_watch-next-tools {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
  background: var(--ui-bg-editor);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch-next-item:hover .PFX_watch-next-tools,
.PFX_watch-next-item:focus-within .PFX_watch-next-tools {
  opacity: 1;
  pointer-events: auto;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-tools {
  opacity: 0;
  pointer-events: none;
}

.PFX_watch .PFX_watch-next-tools > button {
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-next-tools > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch-next-foot {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  padding: 0 var(--PFX_s2) var(--PFX_s2);
}

.PFX_watch-next-keys {
  margin: 0;
  color: var(--PFX_fg3);
}

.PFX_watch-next-empty {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  padding: var(--PFX_s4);
  border: 1px dashed var(--ui-stroke-tertiary);
  border-radius: 12px;
}

.PFX_watch-next-empty-title {
  margin: 0;
  color: var(--ui-text-secondary);
}

/* read by screen readers, not shown */
.PFX_watch-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`

/** Attribute of the screen <style> (one per document). */
export const WATCH_STYLE_ATTR = `data-${CLASS_PREFIX}watch-styles`

let ownerCtx: unknown = null
let tokenSeq = 0

onShellReset(() => {
  ownerCtx = null
})

/** Ensures the screen stylesheet in the document (idempotent). The plugin's dispose removes it. */
export function ensureWatchStyles(doc: Document | undefined = globalThis.document): void {
  if (!doc?.head) return
  const found = [...doc.head.querySelectorAll<HTMLStyleElement>(`style[${WATCH_STYLE_ATTR}]`)]
  for (const extra of found.slice(1)) extra.remove()
  let el = found[0]
  if (!el) {
    el = doc.createElement('style')
    el.setAttribute(WATCH_STYLE_ATTR, '')
    doc.head.appendChild(el)
  }
  const css = resolveCss(WATCH_CSS)
  if (el.textContent !== css) el.textContent = css
  const ctx = maybePluginContext()
  if (ctx && (ownerCtx !== ctx || el.getAttribute(WATCH_STYLE_ATTR) === '')) {
    ownerCtx = ctx
    const token = `${Date.now().toString(36)}-${++tokenSeq}`
    el.setAttribute(WATCH_STYLE_ATTR, token)
    const style = el
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(WATCH_STYLE_ATTR) === token) style.remove()
    })
  }
}
