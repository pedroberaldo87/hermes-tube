// Plugin i18n: one namespace per area (`locales/<locale>/<ns>.json`), registered together through
// `ctx.i18n.register` and read with `useT('<ns>')` → key `<ns>.<path>`. JSON strings with
// `{name}` are interpolated here (JSON cannot carry functions). `common` belongs to the shell.
import { usePluginI18n, type PluginContext, type PluginMessages } from '@hermes/plugin-sdk'
import { useCallback } from 'react'
import type { ApiError } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { maybePluginContext } from './ctx'

import enChat from '../locales/en/chat.json'
import enChrome from '../locales/en/chrome.json'
import enCleanup from '../locales/en/cleanup.json'
import enCommon from '../locales/en/common.json'
import enExtras from '../locales/en/extras.json'
import enHistory from '../locales/en/history.json'
import enHome from '../locales/en/home.json'
import enListImport from '../locales/en/list-import.json'
import enManage from '../locales/en/manage.json'
import enOnboarding from '../locales/en/onboarding.json'
import enOrganize from '../locales/en/organize.json'
import enPanes from '../locales/en/panes.json'
import enTabEditor from '../locales/en/tab-editor.json'
import enTheme from '../locales/en/theme.json'
import enWatch from '../locales/en/watch.json'
import ptChat from '../locales/pt-BR/chat.json'
import ptChrome from '../locales/pt-BR/chrome.json'
import ptCleanup from '../locales/pt-BR/cleanup.json'
import ptCommon from '../locales/pt-BR/common.json'
import ptExtras from '../locales/pt-BR/extras.json'
import ptHistory from '../locales/pt-BR/history.json'
import ptHome from '../locales/pt-BR/home.json'
import ptListImport from '../locales/pt-BR/list-import.json'
import ptManage from '../locales/pt-BR/manage.json'
import ptOnboarding from '../locales/pt-BR/onboarding.json'
import ptOrganize from '../locales/pt-BR/organize.json'
import ptPanes from '../locales/pt-BR/panes.json'
import ptTabEditor from '../locales/pt-BR/tab-editor.json'
import ptTheme from '../locales/pt-BR/theme.json'
import ptWatch from '../locales/pt-BR/watch.json'

/** Locale folders (the files live in `locales/<LOCALE>/`). */
export const LOCALES = ['en', 'pt-BR'] as const

/** Ids the Portuguese bundle is registered under (the app uses lowercase ids, e.g. `pt-br`). */
export const PT_LOCALE_IDS = ['pt-br', 'pt-BR', 'pt'] as const

export const NAMESPACES = [
  'common',
  'home',
  'manage',
  'history',
  'cleanup',
  'extras',
  'panes',
  'chrome',
  'tab-editor',
  'onboarding',
  'organize',
  'theme',
  'list-import',
  'chat',
  'watch'
] as const

export type Namespace = (typeof NAMESPACES)[number]

/** Source area that owns each namespace. */
export const NAMESPACE_OWNERS: Record<Namespace, string> = {
  common: 'components',
  home: 'pages/home',
  manage: 'pages/manage',
  history: 'pages/manage/history', // history drawer and "create tab from selection"
  cleanup: 'pages/cleanup',
  extras: 'pages/extras',
  panes: 'panes',
  chrome: 'chrome', // chip and ⌘K
  'tab-editor': 'dialogs/tab-editor',
  onboarding: 'dialogs/onboarding',
  organize: 'dialogs/organize',
  theme: 'dialogs/theme',
  'list-import': 'dialogs/list-import',
  chat: 'chat',
  watch: 'pages/watch' // "Watching" screen and the "Open videos" setting
}

const asMessages = (v: unknown) => v as PluginMessages

export const BUNDLES: Record<(typeof LOCALES)[number], Record<Namespace, PluginMessages>> = {
  en: {
    common: asMessages(enCommon),
    home: asMessages(enHome),
    manage: asMessages(enManage),
    history: asMessages(enHistory),
    cleanup: asMessages(enCleanup),
    extras: asMessages(enExtras),
    panes: asMessages(enPanes),
    chrome: asMessages(enChrome),
    'tab-editor': asMessages(enTabEditor),
    onboarding: asMessages(enOnboarding),
    organize: asMessages(enOrganize),
    theme: asMessages(enTheme),
    'list-import': asMessages(enListImport),
    chat: asMessages(enChat),
    watch: asMessages(enWatch)
  },
  'pt-BR': {
    common: asMessages(ptCommon),
    home: asMessages(ptHome),
    manage: asMessages(ptManage),
    history: asMessages(ptHistory),
    cleanup: asMessages(ptCleanup),
    extras: asMessages(ptExtras),
    panes: asMessages(ptPanes),
    chrome: asMessages(ptChrome),
    'tab-editor': asMessages(ptTabEditor),
    onboarding: asMessages(ptOnboarding),
    organize: asMessages(ptOrganize),
    theme: asMessages(ptTheme),
    'list-import': asMessages(ptListImport),
    chat: asMessages(ptChat),
    watch: asMessages(ptWatch)
  }
}

/** Registers all namespaces (EN + PT-BR) on ctx. Returns the disposer. */
export function registerLocales(ctx: PluginContext): () => void {
  if (typeof ctx.i18n?.register !== 'function') return () => undefined // old host: no bundles
  const pt = BUNDLES['pt-BR'] as unknown as PluginMessages
  const bundles: Record<string, PluginMessages> = { en: BUNDLES.en as unknown as PluginMessages }
  for (const id of PT_LOCALE_IDS) bundles[id] = pt
  return ctx.i18n.register(bundles)
}

export type Vars = Record<string, string | number>

/** Replaces `{name}` with the values; placeholders without a value are left as they are. */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export type Translate = (key: string, vars?: Vars) => string

/** Reactive translator for a namespace: `t('chip.new', {count: 3})` → `common.chip.new`. */
export function useT(ns: Namespace = 'common'): Translate {
  const pt = usePluginI18n(PLUGIN_ID)
  return useCallback((key: string, vars?: Vars) => interpolate(pt(`${ns}.${key}`), vars), [pt, ns])
}

function lookup(tree: unknown, path: string): string | undefined {
  let node = tree
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** Translation outside React (registration, commands). Without translation (host without `ctx.i18n`), uses the built-in EN. */
export function tNow(ns: Namespace, key: string, vars?: Vars): string {
  const full = `${ns}.${key}`
  const t = maybePluginContext()?.i18n?.t
  const hit = typeof t === 'function' ? t(full) : full
  return interpolate(hit !== full ? hit : (lookup(BUNDLES.en[ns], key) ?? full), vars)
}

/** Readable message for a contract error: `common.errors.<code>`, otherwise the backend message. */
export function errorText(t: Translate, error: Pick<ApiError, 'code' | 'message'>): string {
  const key = `errors.${error.code}`
  const text = t(key)
  return text === `common.${key}` || text === key ? error.message : text
}
