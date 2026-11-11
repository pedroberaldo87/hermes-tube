// desktop-src structure: no cross imports between pages, dialogs,
// pane/chrome and chat — everything talks through lib/ (openDialog, atoms, routes) and components/; lib/ and
// components/ do not depend on screens; skeletons exist; colors only through theme variables.
import { describe, expect, it } from 'vitest'
import { importSpecifiers, listRepoFiles, readRepoFile, repoFileExists, resolveRelative } from './repo.mjs'

/** Areas with their own owner (the most specific first). */
const AREAS: Array<[string, string]> = [
  ['desktop-src/pages/manage/history/', 'manage-history'],
  ['desktop-src/pages/manage/create-tab/', 'manage-create-tab'],
  ['desktop-src/pages/manage/', 'manage'],
  ['desktop-src/pages/home/', 'home'],
  ['desktop-src/pages/cleanup/', 'cleanup'],
  ['desktop-src/pages/extras/', 'extras-page'],
  ['desktop-src/pages/watch/', 'watch'],
  ['desktop-src/panes/', 'panes'],
  ['desktop-src/chrome/', 'chrome'],
  ['desktop-src/dialogs/tab-editor/', 'tab-editor'],
  ['desktop-src/dialogs/onboarding/', 'onboarding'],
  ['desktop-src/dialogs/organize/', 'organize'],
  ['desktop-src/dialogs/theme/', 'theme'],
  ['desktop-src/dialogs/list-import/', 'list-import-dialog'],
  ['desktop-src/chat/', 'chat'],
  ['desktop-src/lib/', 'lib'],
  ['desktop-src/components/', 'components'],
  ['desktop-src/locales/', 'locales'],
  ['desktop-src/styles/', 'styles'], // the plugin's stylesheets; only lib/style.ts imports them
  ['shared/', 'shared']
]

function areaOf(rel: string): string | null {
  const withSlash = `${rel}/`
  for (const [prefix, area] of AREAS) if (rel.startsWith(prefix) || withSlash === prefix) return area
  return null
}

const SOURCES = listRepoFiles('desktop-src', ['.ts', '.tsx']).filter(
  (f) => !f.startsWith('desktop-src/test/') && !f.startsWith('desktop-src/types/') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')
)

const BARE_ALLOWED = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])

describe('imports', () => {
  it('only the three external specifiers (the rest is relative)', () => {
    const bad: string[] = []
    for (const f of SOURCES)
      for (const s of importSpecifiers(readRepoFile(f)))
        if (!s.startsWith('.') && !BARE_ALLOWED.has(s)) bad.push(`${f} → ${s}`)
    expect(bad).toEqual([])
  })

  it('no screen imports another screen/dialog; lib and components do not import screens', () => {
    const bad: string[] = []
    for (const f of SOURCES) {
      if (f === 'desktop-src/main.tsx') continue // composition: the only place that knows every screen
      const from = areaOf(f)
      const allowed =
        from === 'lib'
          ? ['lib', 'shared', 'locales', 'styles']
          : from === 'styles'
            ? ['styles']
          : from === 'components'
            ? ['components', 'lib', 'shared']
            : [from, 'lib', 'components', 'shared']
      for (const s of importSpecifiers(readRepoFile(f))) {
        if (!s.startsWith('.')) continue
        const to = areaOf(resolveRelative(f, s))
        if (!allowed.includes(to)) bad.push(`${f} (${from}) → ${s} (${to})`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('kit: what the screens use comes from components/index.ts', () => {
  const index = readRepoFile('desktop-src/components/index.ts')
  const exported = (name: string) => new RegExp(`export\\s*(type\\s*)?\\{[^}]*\\b(type\\s+)?${name}\\b[^}]*\\}`).test(index)

  it('re-exports TIP_DELAY_MS and the TabMenuEntry type', () => {
    expect(exported('TIP_DELAY_MS')).toBe(true)
    expect(exported('TabMenuEntry')).toBe(true)
  })

  it('Subscriptions imports TabMenuEntry from the kit (does not derive it from TabBarProps)', () => {
    const home = readRepoFile('desktop-src/pages/home/index.tsx')
    expect(home).not.toMatch(/TabBarProps\['menu'\]/)
    expect(home).toMatch(/type TabMenuEntry[,\s][\s\S]*?\} from '\.\.\/\.\.\/components'/)
  })
})

describe('skeletons', () => {
  const ENTRIES = [
    'desktop-src/main.tsx',
    'desktop-src/pages/home/index.tsx',
    'desktop-src/pages/manage/index.tsx',
    'desktop-src/pages/manage/history/index.tsx',
    'desktop-src/pages/manage/create-tab/index.tsx',
    'desktop-src/pages/cleanup/index.tsx',
    'desktop-src/pages/extras/index.tsx',
    'desktop-src/pages/watch/index.tsx',
    'desktop-src/panes/index.tsx',
    'desktop-src/chrome/index.tsx',
    'desktop-src/dialogs/tab-editor/index.tsx',
    'desktop-src/dialogs/onboarding/index.tsx',
    'desktop-src/dialogs/organize/index.tsx',
    'desktop-src/dialogs/theme/index.tsx',
    'desktop-src/dialogs/list-import/index.tsx',
    'desktop-src/chat/index.tsx'
  ]
  it.each(ENTRIES)('%s exists', (f) => {
    expect(repoFileExists(f)).toBe(true)
  })
})

// ------------------------------------------------------------------ only classes with the plugin prefix
// The app only loads the utility classes it uses itself; plugin layout cannot depend on them.
// In desktop-src/** (outside test/, types/ and preview/), `className` only takes classes with the plugin
// prefix, always through `cx(...)` from lib/style (which derives the prefix from PLUGIN_ID). Kit,
// lib and main files fail; screens still in skeleton only WARN until the owner switches (STRICT_CLASSNAMES tightens it).

/** Files where the rule is already strict (kit + shell). */
const STRICT_CLASSNAMES = [
  'desktop-src/components/',
  'desktop-src/lib/',
  'desktop-src/main.tsx',
  'desktop-src/styles/',
  'desktop-src/pages/home/',
  'desktop-src/pages/cleanup/',
  'desktop-src/pages/manage/',
  'desktop-src/pages/watch/',
  'desktop-src/dialogs/onboarding/',
  'desktop-src/dialogs/organize/',
  'desktop-src/dialogs/tab-editor/',
  'desktop-src/panes/',
  'desktop-src/chrome/',
  'desktop-src/chat/',
]

/** Expression of each `className=` (string literal or the content between braces, with balanced braces). */
export function classNameExpressions(code: string): string[] {
  const out: string[] = []
  const re = /\bclassName\s*=\s*/g
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let i = m.index + m[0].length
    const c = code[i]
    if (c === '"' || c === "'") {
      const end = code.indexOf(c, i + 1)
      out.push(code.slice(i, end + 1))
      continue
    }
    if (c !== '{') continue
    let depth = 0
    const start = i
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) break
    }
    out.push(code.slice(start + 1, i).trim())
  }
  return out
}

/** Problem of a className expression (null = ok). */
export function classNameProblem(expr: string): string | null {
  if (/^["'`]/.test(expr)) return `literal ${expr}`
  // passing the prop itself through (`className={className}`, `props.className`) is allowed
  if (/^[\w.]+$/.test(expr)) return null
  // `cx(...)` or `withClass(cx(...), className)` (kit: own class + the passed one)
  if (!/^(withClass\()?cx\(/.test(expr)) return `outside cx(): ${expr}`
  if (/\bcn\(/.test(expr)) return `cn() with classes: ${expr}`
  // kit names: lowercase, digits and hyphen (the prefix comes from cx)
  for (const lit of expr.matchAll(/(["'`])([^"'`]*)\1/g))
    for (const token of lit[2].split(/\s+/).filter(Boolean))
      if (!/^[a-z0-9][a-z0-9-]*$/.test(token)) return `invalid name "${token}" in ${expr}`
  return null
}

describe('style: className only with classes of the plugin prefix', () => {
  const FILES = SOURCES.filter((f) => !f.startsWith('desktop-src/preview/'))
  const strict = (f: string) => STRICT_CLASSNAMES.some((p) => f === p || f.startsWith(p))

  function problemsOf(f: string): string[] {
    return classNameExpressions(readRepoFile(f))
      .map(classNameProblem)
      .filter((p): p is string => p !== null)
      .map((p) => `${f}: ${p}`)
  }

  it('detector (negative proof)', () => {
    expect(classNameProblem('"flex gap-2"')).toMatch(/literal/)
    expect(classNameProblem("cn('flex', className)")).toMatch(/outside cx/)
    expect(classNameProblem("cx('card', active && 'card-active')")).toBeNull()
    expect(classNameProblem("cx('aspect-video w-40')")).toBeNull()
    expect(classNameProblem("cx('bg-background/80')")).toMatch(/invalid name/)
    expect(classNameProblem("cx('text-[0.6rem]')")).toMatch(/invalid name/)
    expect(classNameProblem('className')).toBeNull()
    expect(classNameProblem("withClass(cx('chip'), className)")).toBeNull()
    expect(classNameProblem("withClass('flex', className)")).toMatch(/outside cx/)
    expect(classNameExpressions('<a className="x y" /><b className={cx(\'a\', { b: c })} />')).toEqual(['"x y"', "cx('a', { b: c })"])
  })

  it('kit, lib and main: strict', () => {
    expect(FILES.filter(strict).flatMap(problemsOf)).toEqual([])
  })

  it('screens: a warning until the owner switches to the kit', () => {
    const pending = FILES.filter((f) => !strict(f)).flatMap(problemsOf)
    if (pending.length) console.warn(`className outside the prefix (switch to the kit):\n  ${pending.join('\n  ')}`)
    expect(Array.isArray(pending)).toBe(true)
  })
})

describe('tema', () => {
  it('no fixed colors (hex, rgb, hsl) in the interface code', () => {
    const bad: string[] = []
    for (const f of SOURCES) {
      const code = readRepoFile(f)
      const m = code.match(/['"`(\s:](#[0-9a-fA-F]{3,8})\b|\brgba?\(|\bhsla?\(/)
      if (m) bad.push(`${f}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
})

// The React Query cache is ONE for the whole plugin. `useRest(route)` stores the raw response under the key
// `restQueryKey(route)`; a separate query on that SAME key, storing another shape (only `items`, for example),
// breaks the screen that comes later. Seen in the real app: Manage crashed with "folders.map is not a function"
// when the pane had already loaded the folders. Outside `lib/`, a custom key only with a differentiator (2nd argument).
describe('shared cache', () => {
  const PLAIN_KEY = /restQueryKey\(\s*['"`][^'"`]+['"`]\s*\)/

  it('detector (negative proof)', () => {
    expect(PLAIN_KEY.test("queryKey: restQueryKey('GET /folders'),")).toBe(true)
    expect(PLAIN_KEY.test("queryKey: restQueryKey('GET /channels', { query: { view: 'manage' } }),")).toBe(false)
    expect(PLAIN_KEY.test('return restQueryKey(routeOf(src), { query: {} })')).toBe(false)
  })

  it('outside lib/, nobody builds its own query on a route\'s raw key', () => {
    const bad = SOURCES.filter((f) => !f.startsWith('desktop-src/lib/') && PLAIN_KEY.test(readRepoFile(f)))
    expect(bad).toEqual([])
  })
})
