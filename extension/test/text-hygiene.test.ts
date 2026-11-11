// Repository text hygiene for the extension: English outside the pt-BR locale, and no internal task ids
// (in code, comments, logs or file names). pt-BR strings stay allowed where they are test data: the pt-BR
// locale itself, the tests that check it and the saved YouTube pages (pt-BR UI) used by the scenarios.
import { describe, expect, it } from 'vitest'

// tsconfig.ext.json does not load @types/node: node:fs/node:path come in through a dynamic import with a minimal local type.
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean }
type Fs = { readdirSync(p: string, o: { withFileTypes: true }): Dirent[]; readFileSync(p: string, enc: 'utf8'): string }
const fs = (): Promise<Fs> => import('node:fs' as string) as Promise<Fs>

// the test folder's parent (import.meta.dirname: vitest runs on Node)
const EXT = (import.meta as unknown as { dirname: string }).dirname.replace(/\/test$/, '')
const SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', 'dist'])
const TEXT_EXT = /\.(ts|tsx|js|mjs|json|html|css|svg|md|txt)$/

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdirSync } = await fs()
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(p, out)
    } else if (e.isFile()) out.push(p)
  }
  return out
}

const rel = (p: string) => p.slice(EXT.length + 1)
const isPtBrLocale = (r: string) => r.startsWith('src/locales/pt-BR/')
/** where pt-BR text is test data (locale checks, saved pt-BR YouTube UI) */
const PT_BR_DATA = (r: string) => isPtBrLocale(r) || r.startsWith('test/') || r.startsWith('e2e/scenarios/')

// Portuguese letters (× and ÷ are math, not language)
const ACCENT = /[À-ÖØ-öø-ÿ]/
// internal task ids: a letter E, F or X, two digits and an optional suffix letter, in any case
// (not hex colors like #e02020, nor the X11/x64/x86 of user agents)
const TASK_ID = /(?<![#\w])(?!x11|x64|x86)[efx]\d{2}[a-z]?(?!\w)/i

describe('extension text hygiene', () => {
  it('no Portuguese outside the pt-BR locale and pt-BR test data', async () => {
    const { readFileSync } = await fs()
    const hits: string[] = []
    for (const p of await walk(EXT)) {
      const r = rel(p)
      if (!TEXT_EXT.test(r) || PT_BR_DATA(r)) continue
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => ACCENT.test(line) && hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 100)}`))
    }
    expect(hits).toEqual([])
  })

  it('no internal task ids in files or file names', async () => {
    const { readFileSync } = await fs()
    const hits: string[] = []
    for (const p of await walk(EXT)) {
      const r = rel(p)
      if (/(^|\/)[efx]\d{2}[a-z]?_/i.test(r)) hits.push(`file name: ${r}`)
      if (!TEXT_EXT.test(r)) continue
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => TASK_ID.test(line) && hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 100)}`))
    }
    expect(hits).toEqual([])
  })

  it('feature modules carry no owner tag', async () => {
    const { BACKGROUND_MODULES } = await import('../src/lib/registry-background')
    const { CONTENT_MODULES } = await import('../src/lib/registry-content')
    for (const m of [...BACKGROUND_MODULES, ...CONTENT_MODULES]) expect('OWNER' in m, m.MODULE).toBe(false)
  })
})
