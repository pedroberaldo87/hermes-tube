// Extension languages (extension/src/lib/i18n.ts + src/locales/{en,pt-BR}/<ns>.json).
import { describe, expect, it } from 'vitest'
import { MESSAGE_KEYS } from '../../shared/ids'
import { LANGUAGES, NAMESPACES, catalog, pickLanguage, setLanguage, t } from '../src/lib/i18n'

describe('i18n', () => {
  it('all namespaces exist in both languages with the same keys', () => {
    expect([...NAMESPACES].sort()).toEqual(['common', 'home', 'popup', 'queue', 'search', 'sidebar', 'sync'])
    for (const ns of NAMESPACES) {
      expect(Object.keys(catalog('pt-BR', ns)).sort(), ns).toEqual(Object.keys(catalog('en', ns)).sort())
    }
    expect(LANGUAGES).toEqual(['en', 'pt-BR'])
  })

  it('common has the messages the client uses', () => {
    for (const k of [MESSAGE_KEYS.reconnectOpenHermes, 'unpaired', 'unauthorized']) {
      expect(catalog('en', 'common')[k], k).toBeTruthy()
      expect(catalog('pt-BR', 'common')[k], k).toBeTruthy()
    }
  })

  it('picks pt-BR for any pt-*, otherwise en', () => {
    expect(pickLanguage('pt-BR')).toBe('pt-BR')
    expect(pickLanguage('pt')).toBe('pt-BR')
    expect(pickLanguage('pt-PT')).toBe('pt-BR')
    expect(pickLanguage('en-US')).toBe('en')
    expect(pickLanguage('de')).toBe('en')
    expect(pickLanguage(undefined)).toBe('en')
  })

  it('t: switches language, interpolates {var}, falls back to en and then to the key', () => {
    setLanguage('pt-BR')
    expect(t('common', MESSAGE_KEYS.reconnectOpenHermes)).toBe(catalog('pt-BR', 'common')[MESSAGE_KEYS.reconnectOpenHermes])
    setLanguage('en')
    expect(t('common', 'no.such.key')).toBe('no.such.key')
    expect(t('common', 'connected_port', { port: 47615 })).toContain('47615')
  })
})
