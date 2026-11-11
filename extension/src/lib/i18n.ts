// Extension i18n. One JSON file per language and namespace in src/locales/<language>/<ns>.json; each
// feature owns its namespace. Static import: it all goes into the bundle
// (the content script is an IIFE, no dynamic import).
//
//   t('common', MESSAGE_KEYS.reconnectOpenHermes)
//   t('common', 'connected_port', { port: 47615 })
//
// Language: `ExtState.language` once it arrives (setLanguage), otherwise the browser's; pt-* → pt-BR, anything else → en.
import enCommon from '../locales/en/common.json'
import enHome from '../locales/en/home.json'
import enPopup from '../locales/en/popup.json'
import enQueue from '../locales/en/queue.json'
import enSearch from '../locales/en/search.json'
import enSidebar from '../locales/en/sidebar.json'
import enSync from '../locales/en/sync.json'
import ptCommon from '../locales/pt-BR/common.json'
import ptHome from '../locales/pt-BR/home.json'
import ptPopup from '../locales/pt-BR/popup.json'
import ptQueue from '../locales/pt-BR/queue.json'
import ptSearch from '../locales/pt-BR/search.json'
import ptSidebar from '../locales/pt-BR/sidebar.json'
import ptSync from '../locales/pt-BR/sync.json'

export const LANGUAGES = ['en', 'pt-BR'] as const
export type Language = (typeof LANGUAGES)[number]

/**
 * Namespaces: common, popup, sync, queue, search,
 * sidebar (includes thumbnails), home.
 */
export const NAMESPACES = ['common', 'popup', 'sync', 'queue', 'search', 'sidebar', 'home'] as const
export type Namespace = (typeof NAMESPACES)[number]

type Catalog = Record<string, string>

const CATALOGS: Record<Language, Record<Namespace, Catalog>> = {
  en: { common: enCommon, popup: enPopup, sync: enSync, queue: enQueue, search: enSearch, sidebar: enSidebar, home: enHome },
  'pt-BR': { common: ptCommon, popup: ptPopup, sync: ptSync, queue: ptQueue, search: ptSearch, sidebar: ptSidebar, home: ptHome }
}

export function pickLanguage(tag: string | null | undefined): Language {
  return tag && /^pt(-|_|$)/i.test(tag) ? 'pt-BR' : 'en'
}

const browserLanguage = (): string | undefined => (typeof navigator === 'undefined' ? undefined : navigator.language)

let current: Language = pickLanguage(browserLanguage())

/** `ExtState.language` is `auto` when the user has not chosen: then the browser language applies. */
export function setLanguage(tag: string | null | undefined): Language {
  current = pickLanguage(!tag || tag === 'auto' ? browserLanguage() : tag)
  return current
}

export function getLanguage(): Language {
  return current
}

export function catalog(lang: Language, ns: Namespace): Readonly<Catalog> {
  return CATALOGS[lang][ns]
}

/** Text for the key in the current language; falls back to en and then to the key itself. `{name}` is interpolated. */
export function t(ns: Namespace, key: string, vars?: Record<string, string | number>): string {
  const raw = CATALOGS[current][ns][key] ?? CATALOGS.en[ns][key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}
