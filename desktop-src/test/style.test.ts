// The plugin's own stylesheet: mounted once in a <style data-…>, not duplicated on reload (hot reload),
// removed on dispose; CSS only with plugin-prefix classes and only with theme variables.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_ID } from '../../shared/ids'
import plugin from '../main'
import { CLASS_PREFIX, CSS_TOKEN, STYLE_ATTR, cssText, cx, mountStyles, resolveCss } from '../lib/style'
import { CSS_ORDER, CSS_SOURCES } from '../styles'
import { type DesktopBundle, buildDesktopBundle, listRepoFiles, readRepoFile } from './repo.mjs'
import { createMockCtx } from './sdk-mock'

// In vitest `.css?raw` comes out empty (CSS is not processed); here the sheets come from disk, in the real order.
vi.mock('../styles', async () => {
  const actual = await vi.importActual<typeof import('../styles')>('../styles')
  const { readRepoFile: read } = await import('./repo.mjs')
  return { ...actual, CSS_SOURCES: actual.CSS_ORDER.map((n) => read(`desktop-src/styles/${n}.css`)) }
})

const styles = () => document.head.querySelectorAll(`style[${STYLE_ATTR}]`)

afterEach(() => {
  for (const el of [...styles()]) el.remove()
})

describe('prefix', () => {
  it('derived from PLUGIN_ID (no literal) and cx() prefixes each name', () => {
    expect(CLASS_PREFIX.startsWith(PLUGIN_ID)).toBe(true)
    expect(cx('card', false, null, undefined, 'card-title')).toBe(`${CLASS_PREFIX}card ${CLASS_PREFIX}card-title`)
    expect(cx('a b')).toBe(`${CLASS_PREFIX}a ${CLASS_PREFIX}b`)
    expect(cx()).toBe('')
  })

  it('resolveCss swaps the marker for the prefix in classes, variables, containers and animations', () => {
    const out = resolveCss(`.${CSS_TOKEN}card{--${CSS_TOKEN}gap:4px;container-name:${CSS_TOKEN}page;animation:${CSS_TOKEN}pulse 1s}`)
    expect(out).toBe(
      `.${CLASS_PREFIX}card{--${CLASS_PREFIX}gap:4px;container-name:${CLASS_PREFIX}page;animation:${CLASS_PREFIX}pulse 1s}`
    )
    expect(cssText()).not.toContain(CSS_TOKEN)
    expect(cssText()).toContain(`.${CLASS_PREFIX}card`)
  })
})

describe('mountStyles', () => {
  it('mounts a <style> with the plugin CSS and removes it on dispose', () => {
    const dispose = mountStyles()
    expect(styles()).toHaveLength(1)
    expect(styles()[0].textContent).toBe(cssText())
    dispose()
    expect(styles()).toHaveLength(0)
  })

  it('reload without dispose (hot reload) does not duplicate', () => {
    mountStyles()
    mountStyles()
    mountStyles()
    expect(styles()).toHaveLength(1)
  })

  it('a late dispose of the old copy does not take down the new copy\'s sheet', () => {
    const disposeOld = mountStyles()
    const disposeNew = mountStyles()
    disposeOld()
    expect(styles()).toHaveLength(1)
    disposeNew()
    expect(styles()).toHaveLength(0)
  })

  it('disposing twice is harmless', () => {
    const dispose = mountStyles()
    dispose()
    dispose()
    expect(styles()).toHaveLength(0)
  })

  it('the plugin\'s register() mounts the sheet; unload (ctx.onDispose) removes it', () => {
    const handle = createMockCtx(PLUGIN_ID)
    plugin.register(handle.ctx)
    expect(styles()).toHaveLength(1)
    plugin.register(createMockCtx(PLUGIN_ID).ctx) // reload
    expect(styles()).toHaveLength(1)
    handle.dispose()
    // the new copy still owns the sheet
    expect(styles()).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ CSS rules

const CSS_FILES = listRepoFiles('desktop-src', ['.css']).filter((f) => !f.startsWith('desktop-src/preview/'))

/** Removes comments and strings to analyse only the code. */
function stripCss(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
}

const NAMED_COLORS = [
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey', 'silver',
  'maroon', 'navy', 'teal', 'olive', 'lime', 'aqua', 'fuchsia', 'cyan', 'magenta', 'brown', 'gold', 'indigo',
  'violet', 'crimson', 'coral', 'salmon', 'tomato', 'beige', 'ivory', 'khaki', 'lavender', 'plum', 'orchid',
  'turquoise', 'tan', 'chocolate', 'firebrick', 'darkgray', 'lightgray', 'whitesmoke', 'gainsboro', 'snow'
]

/** Looks for fixed colors in a CSS text; returns the offending snippets. */
export function fixedColors(src: string): string[] {
  const code = stripCss(src)
  const bad: string[] = []
  for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) bad.push(m[0])
  for (const m of code.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!from\b)[^)]*/g)) bad.push(m[0])
  // property values: a bare color name
  for (const decl of code.matchAll(/:\s*([^;{}]+)[;}]/g)) {
    const value = decl[1].replace(/var\([^)]*\)/g, '')
    for (const name of NAMED_COLORS) if (new RegExp(`(^|[\\s,(])${name}($|[\\s,)])`, 'i').test(value)) bad.push(`${name} em "${decl[1].trim()}"`)
  }
  return bad
}

/** Class selectors that do not use the prefix marker. */
export function foreignClasses(src: string): string[] {
  const code = stripCss(src)
  const bad: string[] = []
  // only the selector part (before `{`)
  for (const block of code.matchAll(/([^{}]+)\{/g)) {
    const selector = block[1]
    if (/^\s*@/.test(selector)) continue
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (!m[1].startsWith(CSS_TOKEN)) bad.push(`.${m[1]}`)
  }
  return bad
}

describe('CSS rules (desktop-src/**/*.css, outside the preview)', () => {
  it('there are sheets and all of them are included (CSS_ORDER + ?raw import in styles/index.ts)', () => {
    expect(CSS_FILES.length).toBeGreaterThan(0)
    const index = readRepoFile('desktop-src/styles/index.ts')
    const names = CSS_FILES.map((f) => f.replace(/^desktop-src\/styles\//, '').replace(/\.css$/, ''))
    expect([...CSS_ORDER].sort()).toEqual([...names].sort())
    for (const n of names) expect(index).toContain(`from './${n}.css?raw'`)
    expect(CSS_SOURCES.every((s) => s.length > 100)).toBe(true)
  })

  it.each(CSS_FILES)('%s: only prefix classes', (f) => {
    expect(foreignClasses(readRepoFile(f))).toEqual([])
  })

  it.each(CSS_FILES)('%s: no fixed color (only var(--…) and color-mix with variables)', (f) => {
    expect(fixedColors(readRepoFile(f))).toEqual([])
  })

  it.each(CSS_FILES)('%s: no network (@import, url(), @font-face)', (f) => {
    const code = stripCss(readRepoFile(f))
    expect(code).not.toMatch(/@import|url\(|@font-face/)
  })

  it('the detector catches what it should (negative proof)', () => {
    expect(fixedColors('.x{color:#000}')).toEqual(['#000'])
    expect(fixedColors('.x{background:rgb(0 0 0 / 50%)}').length).toBe(1)
    expect(fixedColors('.x{border-color:black}').length).toBe(1)
    expect(fixedColors('.x{color:color-mix(in srgb, var(--ui-base) 50%, transparent)}')).toEqual([])
    expect(fixedColors('.x{mask-image:linear-gradient(to right, transparent, currentColor 8px)}')).toEqual([])
    expect(foreignClasses(`.${CSS_TOKEN}a .flex{}`)).toEqual(['.flex'])
    expect(foreignClasses(`.${CSS_TOKEN}a:hover > .${CSS_TOKEN}b{}`)).toEqual([])
  })

  it('responsive to the container and with prefers-reduced-motion', () => {
    const all = CSS_SOURCES.join('\n')
    expect(all).toMatch(/container-type:\s*inline-size/)
    expect(all).toMatch(/@container\s/)
    expect(all).not.toMatch(/@media[^{]*(min|max)-width/) // nothing by the window
    const reduced = all.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)
    expect(reduced).not.toBeNull()
    expect(reduced?.[1]).toMatch(/transition:\s*none/)
    expect(reduced?.[1]).toMatch(/animation:\s*none/)
  })

  it('the real plugin.js embeds the sheets as readable text (one CSS line per line)', () => {
    const bundle: DesktopBundle = buildDesktopBundle()
    expect(bundle.code).toContain(JSON.stringify(`.${CSS_TOKEN}card-title {`))
    for (const n of CSS_ORDER) expect(bundle.code).toMatch(new RegExp(`desktop-src/styles/${n}\\.css`))
    expect(bundle.code).toContain('function mountStyles(')
  }, 60_000)

  // the title only reserves 2 lines in the grid (aligns the rows); in row/featured/chat the text flows
  it('reserved title height only inside the grid', () => {
    const code = stripCss(CSS_SOURCES.join('\n'))
    const offenders = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, body]) => /\.PFX_card-title/.test(sel.replace(new RegExp(CSS_TOKEN, 'g'), 'PFX_')) && /min-height\s*:\s*calc\(2/.test(body))
      .map(([, sel]) => sel.trim().replace(new RegExp(CSS_TOKEN, 'g'), 'PFX_'))
      .filter((sel) => sel.split(',').some((s) => !/\.PFX_grid\b/.test(s)))
    expect(offenders).toEqual([])
  })

  // an almost imperceptible skeleton (derived from the theme rule, not from the tinted fill) with a shimmer
  it('skeleton: the theme rule tone and a soft shimmer (off with reduced motion)', () => {
    const tokens = stripCss(CSS_SOURCES.join('\n')).replace(new RegExp(CSS_TOKEN, 'g'), 'PFX_')
    const sk = tokens.match(/\.PFX_sk\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sk).toMatch(/--ui-stroke-/)
    expect(sk).not.toMatch(/--ui-bg-tertiary/)
    expect(sk).toMatch(/animation:\s*PFX_shimmer/)
    expect(tokens).toMatch(/@keyframes PFX_shimmer/)
  })

  it('only theme variables of the host or of the plugin itself', () => {
    const all = stripCss(CSS_SOURCES.join('\n'))
    const vars = new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
    const allowed = /^--(ui-|dt-|theme-|font-|radius|PFX_)/
    expect([...vars].filter((v) => !allowed.test(v.replace(CSS_TOKEN, 'PFX_')))).toEqual([])
  })
})
