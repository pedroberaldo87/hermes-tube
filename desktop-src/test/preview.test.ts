// @vitest-environment node
// Preview outside the app: `node desktop-src/preview/build.mjs` generates a static page with the app's real
// theme + the plugin sheet, the gallery and the reference compositions. No screenshots here (Playwright is
// manual: `--shots`); this test only builds (no network) and checks what the page loads.
import { beforeAll, describe, expect, it } from 'vitest'
import { type PreviewBuild, runPreviewBuild } from '../preview/node.mjs'

const VIEWS = ['gallery', 'home', 'manage', 'cleanup', 'theme', 'welcome', 'pane', 'chat']

describe('static preview', () => {
  let out: PreviewBuild
  beforeAll(() => {
    out = runPreviewBuild()
  }, 60_000)

  it('generates index.html + preview.js and says the SDK controls are stand-ins', () => {
    expect(out.stdout).toMatch(/OK preview/)
    expect(out.html).toMatch(/sdk-mock/)
    expect(out.html).toMatch(/<script[^>]+preview\.js/)
    expect(out.js.length).toBeGreaterThan(1000)
  })

  it('loads the app\'s real CSS (when ref/ exists) before the plugin sheet', () => {
    if (!out.hasHostCss) return
    expect(out.html).toMatch(/host-compiled\.css/)
    expect(out.files).toContain('host-compiled.css')
  })

  it('every composition exists in the preview bundle', () => {
    for (const v of VIEWS) expect(out.js).toContain(`"${v}"`)
  })

  it('the preview does not embed the real plugin with an external React: React ships with it (preview only)', () => {
    expect(out.js).not.toMatch(/from\s+["']@hermes\/plugin-sdk["']/)
  })
})
