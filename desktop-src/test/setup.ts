// Setup of the vitest `desktop` project (loaded by vitest.config.ts when present).
import { afterEach, vi } from 'vitest'
import { resetShellState } from '../lib/lifecycle'
import { cleanupRendered } from './render'
import { resetSdkMock } from './sdk-mock'

// React 19: enables `act` outside a test renderer
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanupRendered()
  resetShellState()
  resetSdkMock()
  vi.useRealTimers()
})
