// MV3 service worker — `background.js` output (ESM). All the logic is in lib/background.ts; here only the
// start-up, synchronous at the top of the module (Chrome only wakes the SW for an alarm/message if the listeners are
// registered on the first turn of the event loop).
import { createBackground } from '../lib/background'
import { BACKGROUND_MODULES } from '../lib/registry-background'

const bg = createBackground({ modules: BACKGROUND_MODULES })
bg.start()

/**
 * Debug/harness hooks (only visible in the service worker context: DevTools or Playwright `sw.evaluate`).
 * Nothing here returns the token.
 */
const debug = {
  bootAt: Date.now(),
  refreshState: () => bg.refreshState(),
  dispatch: (message: unknown) => bg.router.dispatch(message),
  status: () => bg.client.status(),
  discover: () => bg.client.discover(),
  pair: (code: string, name?: string) => bg.client.pair(code, name)
}
;(globalThis as unknown as { __tubeDebug: typeof debug }).__tubeDebug = debug
