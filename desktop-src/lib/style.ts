// The plugin's own stylesheet. The app only loads the utility classes it uses itself:
// a class the host does not use does not exist and disappears without warning on an update. So all layout and
// all visuals of the plugin live in plugin CSS (desktop-src/styles/*.css), with classes under a unique prefix
// derived from PLUGIN_ID, packaged as text in plugin.js and mounted here in a single <style>.
//
//  - Source CSS writes the `PFX_` marker (classes, variables, containers, animations); `resolveCss`
//    swaps it for the real prefix. No literal of the id outside shared/ids.ts.
//  - Components write `className={cx('card', active && 'card-active')}`.
//  - `mountStyles()` is idempotent: a module reload (hot reload) reuses the <style>; disposing
//    an old copy does not take down the new copy's sheet (owned by token). main.tsx calls it in register and
//    hands the unmounter to `ctx.onDispose` (the host does not track stray <style> elements).
import { PLUGIN_ID } from '../../shared/ids'
import { CSS_SOURCES } from '../styles'

/** Prefix marker in the source CSS. */
export const CSS_TOKEN = 'PFX_'

/** Prefix of every plugin class/variable/animation (e.g. `<id>-card`, `--<id>-gap`). */
export const CLASS_PREFIX = `${PLUGIN_ID.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-`

/** Attribute that marks the plugin's <style> (one per document). */
export const STYLE_ATTR = `data-${CLASS_PREFIX}styles`

type ClassArg = string | false | null | undefined | 0

/** Kit classes with the plugin prefix: `cx('card', on && 'card-on')` → `<p>card <p>card-on`. */
export function cx(...names: ClassArg[]): string {
  const out: string[] = []
  for (const n of names) {
    if (!n) continue
    for (const token of n.split(/\s+/)) if (token) out.push(CLASS_PREFIX + token)
  }
  return out.join(' ')
}

/** Plugin CSS variable name (`--<prefix>name`), for `style={{ [cssVar('level')]: 2 }}`. */
export function cssVar(name: string): string {
  return `--${CLASS_PREFIX}${name}`
}

/** Swaps the marker for the real prefix. */
export function resolveCss(source: string): string {
  return source.split(CSS_TOKEN).join(CLASS_PREFIX)
}

let resolved: string | null = null

/** Final plugin CSS (all sheets, in `CSS_SOURCES` order). */
export function cssText(): string {
  if (resolved === null) resolved = resolveCss(CSS_SOURCES.join('\n'))
  return resolved
}

let tokenSeq = 0

/**
 * Mounts the plugin sheet once per document. Returns the unmounter (idempotent). Without `document`
 * (tests in node) it does nothing.
 */
export function mountStyles(doc: Document | undefined = globalThis.document): () => void {
  if (!doc?.head) return () => undefined
  const found = [...doc.head.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTR}]`)]
  for (const extra of found.slice(1)) extra.remove()
  let el = found[0]
  if (!el) {
    el = doc.createElement('style')
    el.setAttribute(STYLE_ATTR, '')
    doc.head.appendChild(el)
  }
  const css = cssText()
  if (el.textContent !== css) el.textContent = css
  const token = `${Date.now().toString(36)}-${++tokenSeq}`
  el.setAttribute(STYLE_ATTR, token)
  let done = false
  return () => {
    if (done) return
    done = true
    if (el.isConnected && el.getAttribute(STYLE_ATTR) === token) el.remove()
  }
}
