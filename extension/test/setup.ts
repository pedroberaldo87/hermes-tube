// Setup of the vitest `extension` project (loaded by vitest.config.ts when it exists).
// Before each test: `globalThis.chrome` = new in-memory fake (extension/test/setup-chrome.ts).
// Tests get the fake with `chromeFake()`; the plugin's fake server is in extension/test/setup-net.ts.
import { afterEach, beforeEach, vi } from 'vitest'
import { installChromeFake } from './setup-chrome'

beforeEach(() => {
  installChromeFake()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
