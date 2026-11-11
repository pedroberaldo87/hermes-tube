// The extension's service worker in the harness: find it, evaluate, stop it through CDP and wait for it to restart.
// Measured: `ServiceWorker.stopAllWorkers` stops the SW; `chrome.alarms` wakes it up again (Playwright's `close`
// event may not fire — the proof is the new request on the server / a different `bootAt`).
import type { BrowserContext, Worker } from '@playwright/test'

export async function extensionServiceWorker(context: BrowserContext, timeout = 15_000): Promise<Worker> {
  const isOurs = (w: Worker) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js')
  const found = context.serviceWorkers().find(isOurs)
  if (found) return found
  return context.waitForEvent('serviceworker', { predicate: isOurs, timeout })
}

export function extensionIdOf(sw: Worker): string {
  return new URL(sw.url()).host
}

/**
 * Stops all the browser's service workers through CDP (from an extension page).
 * Returns the time (ms) of the stop request.
 */
export async function stopServiceWorker(context: BrowserContext, extensionId: string): Promise<number> {
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
    const cdp = await context.newCDPSession(page)
    await cdp.send('ServiceWorker.enable')
    const at = Date.now()
    await cdp.send('ServiceWorker.stopAllWorkers')
    await cdp.detach()
    return at
  } finally {
    await page.close()
  }
}

export interface SwStatusEvent {
  at: number
  /** CDP runningStatus: starting | running | stopping | stopped */
  status: string
}

export interface ServiceWorkerMonitor {
  /** runningStatus changes of background.js, in order */
  readonly events: SwStatusEvent[]
  /** stops all SWs (CDP `ServiceWorker.stopAllWorkers`); returns the time of the stop */
  stop(): Promise<number>
  close(): Promise<void>
}

/**
 * Follows the SW lifecycle through CDP (`ServiceWorker.workerVersionUpdated`), from an extension page that
 * stays open. Measured here (Chrome for Testing 1248): stopped through CDP, the 30 s alarm wakes it up
 * (`stopped` → `starting` → `running`); Playwright does not emit `serviceworker` again — the same `Worker`
 * now points to the new SW (`evaluate` returns the new `bootAt`).
 */
export async function monitorServiceWorker(context: BrowserContext, extensionId: string): Promise<ServiceWorkerMonitor> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
  const cdp = await context.newCDPSession(page)
  const events: SwStatusEvent[] = []
  cdp.on('ServiceWorker.workerVersionUpdated', (e: { versions: Array<{ scriptURL: string; runningStatus: string }> }) => {
    for (const v of e.versions) {
      if (!v.scriptURL.endsWith('/background.js')) continue
      if (events.at(-1)?.status !== v.runningStatus) events.push({ at: Date.now(), status: v.runningStatus })
    }
  })
  await cdp.send('ServiceWorker.enable')
  return {
    events,
    async stop() {
      const at = Date.now()
      await cdp.send('ServiceWorker.stopAllWorkers')
      return at
    },
    async close() {
      await cdp.detach().catch(() => undefined)
      await page.close().catch(() => undefined)
    }
  }
}

/**
 * Minimal view of the service worker scope for `sw.evaluate` (tsconfig.node.json does not load the `chrome`
 * types): `(globalThis as unknown as SwScope).chrome.storage.local.get(…)`.
 */
export interface SwScope {
  chrome: {
    storage: { local: { get(keys?: string | string[] | null): Promise<Record<string, unknown>>; set(items: object): Promise<void> } }
    alarms: { getAll(): Promise<Array<{ name: string; periodInMinutes?: number; scheduledTime: number }>> }
    runtime: { getManifest(): Record<string, unknown>; sendMessage(msg: unknown): Promise<unknown>; id: string }
  }
  __tubeDebug: TubeDebug
}

/** Debug hooks exposed by background/index.ts (`globalThis.__tubeDebug`). */
export interface TubeDebug {
  bootAt: number
  refreshState(): Promise<unknown>
  dispatch(message: unknown): Promise<unknown>
  status(): Promise<{ state: string; port: number | null; device_id: string | null }>
  discover(): Promise<Array<{ port: number; health: { service: string; pairing_open: boolean } }>>
  pair(code: string, name?: string): Promise<{ ok: boolean; data?: { state: string; port: number }; error?: { code: string } }>
}
