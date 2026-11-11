// Vitest: two projects, both in jsdom.
//  - desktop:   desktop-src/**/*.test.ts(x), the app's React; `@hermes/plugin-sdk` → the SDK mock
//               (desktop-src/test/sdk-mock.ts; the alias points at it even before it exists).
//  - extension: extension/test/**/*.test.ts(x), Preact; optional setup (extension/test/setup.ts).
// No tests → passes (passWithNoTests). Playwright scenarios stay out (npm run e2e).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'

const ROOT = dirname(fileURLToPath(import.meta.url))
const at = (...p: string[]) => join(ROOT, ...p)
const optional = (p: string) => (existsSync(p) ? [p] : [])

export default defineConfig({
  test: {
    passWithNoTests: true,
    testTimeout: 15_000,
    projects: [
      {
        root: ROOT,
        resolve: {
          alias: [
            { find: /^@hermes\/plugin-sdk$/, replacement: at('desktop-src', 'test', 'sdk-mock.ts') },
            { find: /^@shared\//, replacement: `${at('shared')}/` }
          ]
        },
        test: {
          name: 'desktop',
          environment: 'jsdom',
          include: ['desktop-src/**/*.test.ts', 'desktop-src/**/*.test.tsx'],
          setupFiles: optional(at('desktop-src', 'test', 'setup.ts'))
        }
      },
      {
        root: ROOT,
        plugins: [preact()],
        resolve: { alias: [{ find: /^@shared\//, replacement: `${at('shared')}/` }] },
        test: {
          name: 'extension',
          environment: 'jsdom',
          include: ['extension/test/**/*.test.ts', 'extension/test/**/*.test.tsx'],
          setupFiles: optional(at('extension', 'test', 'setup.ts'))
        }
      }
    ]
  }
})
