// Playwright config for the live probe (real youtube.com, signed out). Not part of scripts/check nor of
// `npm run e2e` (that one only looks at extension/e2e/scenarios/). See README.md in this folder.
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'live.spec.ts',
  outputDir: join(process.env.LIVE_OUT || join(tmpdir(), 'tube-live'), 'test-results'),
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 40 * 60_000,
  expect: { timeout: 15_000 },
  projects: [{ name: 'live' }]
})
