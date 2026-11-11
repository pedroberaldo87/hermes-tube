// Harness paths. EXT_DIST_DIR and the Chromium arguments come from playwright.config.ts.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HARNESS = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HARNESS, '..', '..', '..')
export const FIXTURES = join(ROOT, 'tests', 'fixtures')

/** Playwright 1.64's Chrome for Testing (chromium-1248): accepts `--load-extension` (stable Chrome does not). */
const CFT = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
)

/** `TUBE_E2E_CHROME` overrides; without the binary, Playwright picks one through `channel: 'chromium'`. */
export function chromeExecutable(): string | undefined {
  const p = process.env.TUBE_E2E_CHROME || CFT
  return existsSync(p) ? p : undefined
}
