// Chat card stylesheet. Lives here as text because CSS files are only accepted in styles/; it uses the same
// `PFX_` marker and rules as the rest (only prefixed classes, only theme variables, no network, container-based
// responsiveness; the kit's global `prefers-reduced-motion`
// already covers these classes). Could move to `styles/chat.css`.
// Mounted once per document, on the first card (not in register), in its own <style>; the plugin's
// unload (ctx.onDispose) removes it — owned by a token, like the kit's `mountStyles` (a reload does not drop the new one).
import { CLASS_PREFIX, resolveCss } from '../lib/style'
import { maybePluginContext } from '../lib/ctx'
import { onShellReset } from '../lib/lifecycle'

export const CHAT_CSS = [
  '/* root of each directive: block in the reply flow, with the same spacing as a paragraph */',
  '.PFX_chat {',
  '  display: block;',
  '  max-width: 640px;',
  '  margin-block: var(--paragraph-gap, 0.7rem) 0;',
  '  animation: PFX_fade-in var(--PFX_dur-slow) var(--PFX_ease) both;',
  '}',
  '',
  '.PFX_chat:first-child {',
  '  margin-top: 0;',
  '}',
  '',
  '/* stack: consecutive cards touch and share the divider (a single block, corners only at the ends) */',
  '.PFX_chat > .PFX_card {',
  '  border-color: var(--ui-stroke-tertiary);',
  '}',
  '',
  '.PFX_chat + .PFX_chat {',
  '  margin-top: -1px;',
  '}',
  '',
  '.PFX_chat:has(+ .PFX_chat) > .PFX_card {',
  '  border-bottom-left-radius: 0;',
  '  border-bottom-right-radius: 0;',
  '}',
  '',
  '.PFX_chat + .PFX_chat > .PFX_card {',
  '  border-top-left-radius: 0;',
  '  border-top-right-radius: 0;',
  '}',
  '',
  '/* in the stack the card does not lift on hover (it would misalign the divider); the highlight is the surface and the divider on top */',
  '.PFX_chat > .PFX_card:hover,',
  '.PFX_chat > .PFX_card:focus-within {',
  '  z-index: 1;',
  '  transform: none;',
  '}',
  '',
  '/* the "why is this here" line does not exist in chat (the agent explains it itself): no empty line above */',
  ".PFX_chat [data-part='why'] {",
  '  display: none;',
  '}',
  '',
  ".PFX_chat .PFX_card[data-variant='row'] .PFX_card-body {",
  '  gap: 2px;',
  '}',
  '',
  '/* the root does not remount when data arrives, but the card does: the thumbnail (already cached) shows without',
  '   fading in again — the whole card already entered with a fade */',
  '.PFX_chat .PFX_thumb-img {',
  '  opacity: 1;',
  '}',
  '',
  '/* minimal card (unknown video): the bottom line says where it comes from, in a tertiary tone */',
  '.PFX_chat-note {',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  color: var(--PFX_fg3);',
  '  text-overflow: ellipsis;',
  '}',
  '',
  '/* narrow: the kit hides the row actions; in chat they stay, over the corner, on hover/focus */',
  '@container PFX_card (max-width: 360px) {',
  "  .PFX_chat .PFX_card[data-variant='row'] .PFX_card-actions {",
  '    display: block;',
  '    position: absolute;',
  '    left: auto;',
  '    right: 6px;',
  '    bottom: 6px;',
  '  }',
  '',
  "  .PFX_chat .PFX_card[data-variant='row'] .PFX_quick {",
  '    background: var(--PFX_scrim);',
  '    box-shadow: inset 0 0 0 1px var(--ui-stroke-tertiary);',
  '    -webkit-backdrop-filter: blur(8px);',
  '    backdrop-filter: blur(8px);',
  '  }',
  '',
  '  .PFX_chat .PFX_quick-kbd {',
  '    display: none;',
  '  }',
  '',
  '  /* the metadata line keeps the channel and age (no avatar) — nothing cut without an ellipsis */',
  '  .PFX_chat .PFX_card-meta .PFX_avatar {',
  '    display: none;',
  '  }',
  '}',
  '',
  '/* error: a plain link (the video stays reachable) + discreet reason + retry */',
  '.PFX_chat-fallback {',
  '  display: flex;',
  '  flex-wrap: wrap;',
  '  align-items: center;',
  '  gap: 2px var(--PFX_s2);',
  '  min-height: var(--PFX_lh-body);',
  '  color: var(--ui-text-secondary);',
  '}',
  '',
  '.PFX_chat-link {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: var(--PFX_s1);',
  '  min-width: 0;',
  '  color: var(--ui-text-primary);',
  '  text-decoration: underline;',
  '  text-decoration-color: var(--ui-stroke-secondary);',
  '  text-underline-offset: 3px;',
  '  overflow-wrap: anywhere;',
  '}',
  '',
  '.PFX_chat-link:hover {',
  '  text-decoration-color: currentColor;',
  '}',
  '',
  '.PFX_chat-link:focus-visible {',
  '  outline: 2px solid var(--PFX_ring);',
  '  outline-offset: 2px;',
  '  border-radius: 2px;',
  '}',
  '',
  '.PFX_chat-why {',
  '  color: var(--PFX_fg3);',
  '}',
  '',
  '/* rejected directive: the text the model wrote, as prose (nothing clickable) */',
  '.PFX_chat-raw {',
  '  margin-block: var(--paragraph-gap, 0.7rem) 0;',
  '  overflow-wrap: anywhere;',
  '}'
].join('\n')

/** Attribute of the chat <style> (one per document). */
export const CHAT_STYLE_ATTR = `data-${CLASS_PREFIX}chat-styles`

let ownerCtx: unknown = null
let tokenSeq = 0

onShellReset(() => {
  ownerCtx = null
})

/** Ensures the chat stylesheet in the document (idempotent). The plugin's dispose removes it. */
export function ensureChatStyles(doc: Document | undefined = globalThis.document): void {
  if (!doc?.head) return
  const found = [...doc.head.querySelectorAll<HTMLStyleElement>(`style[${CHAT_STYLE_ATTR}]`)]
  for (const extra of found.slice(1)) extra.remove()
  let el = found[0]
  if (!el) {
    el = doc.createElement('style')
    el.setAttribute(CHAT_STYLE_ATTR, '')
    doc.head.appendChild(el)
  }
  const css = resolveCss(CHAT_CSS)
  if (el.textContent !== css) el.textContent = css
  const ctx = maybePluginContext()
  if (ctx && (ownerCtx !== ctx || el.getAttribute(CHAT_STYLE_ATTR) === '')) {
    ownerCtx = ctx
    const token = `${Date.now().toString(36)}-${++tokenSeq}`
    el.setAttribute(CHAT_STYLE_ATTR, token)
    const style = el
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(CHAT_STYLE_ATTR) === token) style.remove()
    })
  }
}
