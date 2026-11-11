// i18n: every namespace exists in EN and PT-BR; `common` complete in both languages.
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../../shared/api-types'
import { MESSAGE_KEYS } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { LOCALES, NAMESPACES, NAMESPACE_OWNERS, interpolate, registerLocales, tNow } from '../lib/i18n'
import { createMockCtx } from './sdk-mock'
import { listRepoFiles, readRepoFile } from './repo.mjs'

type Tree = { [k: string]: Tree | string }

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)
  )
}

const load = (loc: string, ns: string) => JSON.parse(readRepoFile(`desktop-src/locales/${loc}/${ns}.json`)) as Tree

describe('locale files', () => {
  it('each locale has exactly one file per namespace', () => {
    for (const loc of LOCALES) {
      const files = listRepoFiles(`desktop-src/locales/${loc}`, ['.json']).map((f) => f.split('/').pop()?.replace(/\.json$/, ''))
      expect(files.sort()).toEqual([...NAMESPACES].sort())
    }
  })

  it('every namespace has a declared owner', () => {
    expect(Object.keys(NAMESPACE_OWNERS).sort()).toEqual([...NAMESPACES].sort())
  })

  it('common has the same keys in EN and PT-BR', () => {
    expect(leafKeys(load('pt-BR', 'common')).sort()).toEqual(leafKeys(load('en', 'common')).sort())
  })

  it('common carries the MESSAGE_KEYS and one message per error code', () => {
    for (const loc of LOCALES) {
      const keys = new Set(leafKeys(load(loc, 'common')))
      for (const k of Object.values(MESSAGE_KEYS)) expect(keys.has(k), `${loc}: ${k}`).toBe(true)
      for (const code of ERROR_CODES) expect(keys.has(`errors.${code}`), `${loc}: errors.${code}`).toBe(true)
    }
  })

  it('the other namespaces start as a valid JSON object', () => {
    for (const loc of LOCALES) for (const ns of NAMESPACES) expect(typeof load(loc, ns)).toBe('object')
  })
})

describe('interpolate', () => {
  it('replaces {name} with the values and keeps what did not come', () => {
    expect(interpolate('▶ {count} novos', { count: 12 })).toBe('▶ 12 novos')
    expect(interpolate('{a} e {b}', { a: 'x' })).toBe('x e {b}')
    expect(interpolate('no vars')).toBe('no vars')
  })
})

describe('host without ctx.i18n (older Desktop)', () => {
  it('registerLocales does not break and tNow falls back to the embedded EN', () => {
    const ctx = { ...createMockCtx().ctx, i18n: undefined }
    setPluginContext(ctx)
    expect(() => registerLocales(ctx)()).not.toThrow()
    expect(tNow('common', 'nav.home')).toBe('Subscriptions')
    expect(tNow('common', 'chip.new', { count: 4 })).toBe('▶ 4 new')
    expect(tNow('common', 'does.not.exist')).toBe('common.does.not.exist')
  })
})
