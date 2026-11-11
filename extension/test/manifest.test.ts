// MV3 manifest (extension/manifest.json): contract permissions (ext-protocol.md), files the build
// generates (background.js, content.js, popup/index.html) and statics from extension/public/.
import { describe, expect, it } from 'vitest'
import manifest from '../manifest.json'

// tsconfig.ext.json does not load @types/node (Node timer types would break the browser code):
// node:fs comes in through a dynamic import with a minimal local type.
type Fs = { existsSync(p: URL): boolean; readdirSync(p: URL): string[]; readFileSync(p: URL, enc: 'utf8'): string }
const fs = (): Promise<Fs> => import('node:fs' as string) as Promise<Fs>
const here = (p: string) => new URL(p, import.meta.url)

type Manifest = typeof manifest & {
  key?: string
  optional_permissions?: string[]
  optional_host_permissions?: string[]
}
const m = manifest as Manifest

describe('manifest.json', () => {
  it('MV3 with the exact contract permissions', () => {
    expect(m.manifest_version).toBe(3)
    expect([...m.permissions].sort()).toEqual(['alarms', 'scripting', 'storage', 'tabs'])
    expect([...m.host_permissions].sort()).toEqual(['http://127.0.0.1/*', 'https://www.youtube.com/*'])
  })

  it('no cookies, webRequest, passwords or broad optional permissions', () => {
    const all = JSON.stringify([m.permissions, m.optional_permissions ?? [], m.optional_host_permissions ?? []])
    for (const bad of ['cookies', 'webRequest', 'declarativeNetRequest', 'history', 'identity', '<all_urls>', 'http://*/*', 'https://*/*']) {
      expect(all).not.toContain(bad)
    }
  })

  it('service worker ESM = background.js (build output)', () => {
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' })
  })

  it('content script content.js on https://www.youtube.com/*', () => {
    expect(m.content_scripts).toEqual([{ matches: ['https://www.youtube.com/*'], js: ['content.js'], run_at: 'document_idle' }])
  })

  it('popup = popup/index.html, with icons that exist in extension/public', async () => {
    const { existsSync } = await fs()
    expect(m.action.default_popup).toBe('popup/index.html')
    expect(Object.keys(m.icons).sort()).toEqual(['128', '16', '48'])
    const icons = [...Object.values(m.icons), ...Object.values(m.action.default_icon)] as string[]
    for (const p of icons) expect(existsSync(here(`../public/${p}`)), p).toBe(true)
  })

  it('no "key" (a stable id comes later)', () => {
    expect('key' in m).toBe(false)
    expect(m.name.length).toBeGreaterThan(0)
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('the build has an entry for everything the manifest references', async () => {
    const { existsSync } = await fs()
    expect(existsSync(here('../src/background/index.ts'))).toBe(true)
    expect(existsSync(here('../src/content/bootstrap.ts'))).toBe(true)
    expect(existsSync(here('../src/popup/index.html'))).toBe(true)
    // main-world.js is not referenced: src/content/main-world.ts does not exist (optional target)
    expect(existsSync(here('../src/content/main-world.ts'))).toBe(false)
  })

  it('the popup page is titled with the product name (as in the manifest and the toolbar)', async () => {
    const { readFileSync } = await fs()
    const html = readFileSync(here('../src/popup/index.html'), 'utf8')
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(m.name)
    expect(m.action.default_title).toBe(m.name)
  })
})
