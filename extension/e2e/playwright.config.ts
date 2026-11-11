// Playwright: extension scenarios in extension/e2e/scenarios/.
// The extension is loaded from EXT_DIST_DIR (produced by `npm run build:ext`) in a persistent
// Chromium — MV3 only loads with `launchPersistentContext`, which the harness handles
// (extension/e2e/harness/**: `context` fixture + `context.route` with saved pages + local stub
// server). Only the common defaults and the Chromium arguments live here.
// Not part of scripts/check; only `npm run e2e` (with EXT_DIST_DIR pointing to a build).
//
// Browser: @playwright/test 1.64.0 uses chromium-1248, already present in
// ~/Library/Caches/ms-playwright — do not run `playwright install`.
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const E2E = dirname(fileURLToPath(import.meta.url))

export const EXT_DIST_DIR = resolve(process.env.EXT_DIST_DIR || join(tmpdir(), 'tube-ext-dist'))

/** Arguments the harness passes to `chromium.launchPersistentContext(userDataDir, …)`. */
export const extensionLaunchArgs = [
  `--disable-extensions-except=${EXT_DIST_DIR}`,
  `--load-extension=${EXT_DIST_DIR}`,
  '--no-first-run',
  '--no-default-browser-check'
]

export default defineConfig({
  testDir: join(E2E, 'scenarios'),
  testMatch: '**/*.spec.ts',
  outputDir: join(E2E, 'test-results'),
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  use: {
    // MV3 extensions need headed Chromium (or the new headless mode, through channel 'chromium')
    channel: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: { args: extensionLaunchArgs }
  },
  projects: [{ name: 'chromium-extension' }]
})
